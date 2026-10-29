/** Actual named-list adapters, exercising only a synthetic in-process transport. */
import {build} from "esbuild";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),temp=mkdtempSync(join(tmpdir(),"fortmark-property-lists-adapter-"));
try{
 const entry=`
  import assert from "node:assert/strict";
  import {getPropertyLists,createPropertyList,getPropertyList,renamePropertyList,getPropertyListProperties,lookupPropertyListProperty,addPropertyListProperty,removePropertyListProperty,LeadsError} from "./lib/data/adapters/leads.ts";
  import {useDataVersion} from "./lib/data/store.ts";
  const scenario=process.argv[2],base="/dashboard/api/property-lists",source="/dashboard/api/contacts/source",id="list/id?x# space",propertyId="property/id?x# space",contactId="60000000-0000-4000-8000-000000000001",stamp="2026-10-29T15:00:00.000Z";
  const detail=base+"/"+encodeURIComponent(id),propertyBase=detail+"/properties";
  const list={id,name:"Synthetic Research",contactId:null,propertyCount:0,createdAt:stamp,updatedAt:stamp};
  const index={items:[list,{...list,id:"empty-linked",contactId,contactName:"Synthetic Client"}],total:14,page:2,pageSize:12};
  const listing={id:"listing-key",mlsNumber:"A00123",address:"Synthetic property",source:"mls"},lookup={dataset:"synthetic-dataset",listing,alreadySaved:false};
  const property={id:propertyId,listId:id,contactId:null,mlsNumber:listing.mlsNumber,listingId:listing.id,addedAt:stamp,listing:null,syncStatus:"unavailable",checkedAt:stamp},page={items:[property],total:13,page:2,pageSize:12};
  const create=Object.freeze({requestId:"70000000-0000-4000-8000-000000000001",name:"Synthetic Research"}),rename=Object.freeze({name:"Renamed Research",expectedUpdatedAt:stamp}),add=Object.freeze({mlsNumber:"A00123",expectedListingId:listing.id,expectedDataset:lookup.dataset});
  const calls=[],modes=new Map();let sourceMode=scenario,checks=0,sourceCalls=0;
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
  function check(name,value){assert.ok(value,name);checks++;}
  const count=op=>calls.filter(call=>call.op===op).length;
  async function refuses(promise,status,code){await assert.rejects(promise,error=>error instanceof LeadsError&&error.status===status&&error.code===code);checks++;}
  globalThis.fetch=async(path,init={})=>{
    const url=String(path),method=init.method||"GET";
    if(url===source){calls.push({url,method,body:init.body,headers:init.headers,op:"source"});sourceCalls++;if(sourceMode==="source-forbidden")return json({error:"Forbidden"},403);if(sourceMode==="source-lost")throw TypeError("Synthetic source lost");return json({source:sourceMode==="sample"?"sample":"db"});}
    const op=url.startsWith(base+"?")?"index":url===base?"create":url===detail?method==="PATCH"?"rename":"detail":url===detail+"/lookup"?"lookup":url===propertyBase+"?page=2"?"properties":url===propertyBase?"add":"remove";
    assert.ok([base+"?page=2&contactId="+contactId,base,detail,detail+"/lookup",propertyBase+"?page=2",propertyBase,propertyBase+"/"+encodeURIComponent(propertyId)].includes(url),"Unexpected endpoint "+url);
    assert.equal(method,["index","detail","properties"].includes(op)?"GET":op==="rename"?"PATCH":op==="remove"?"DELETE":"POST");
    calls.push({url,method,body:init.body,headers:init.headers,op});const mode=modes.get(op)||"success";
    if(mode==="lost-once"){modes.set(op,"success");throw TypeError("Synthetic read lost once");}if(mode==="gateway-once"){modes.set(op,"success");return json({error:"gateway"},502);}
    if(mode==="lost")throw TypeError("Synthetic possible commit with lost response");
    if(mode==="forbidden")return json({error:"Forbidden"},403);if(mode==="not-found")return json({error:op==="lookup"?"listing_not_found":"Not found"},404);if(mode==="conflict")return json({error:op==="add"?"listing_changed":"conflict"},409);if(mode==="gateway")return json({error:"gateway"},502);if(mode==="invalid")return json({error:"invalid_property_list"},400);
    return json(op==="index"?index:op==="detail"||op==="create"||op==="rename"?{list}:op==="properties"?page:op==="lookup"?lookup:op==="add"?{property}:{removed:true});
  };
  const reads=[["index",()=>getPropertyLists({page:2,contactId}),index],["detail",()=>getPropertyList(id),list],["properties",()=>getPropertyListProperties(id,2),page],["lookup",()=>lookupPropertyListProperty(id,"A00123"),lookup]];
  const writes=[["create",()=>createPropertyList(create),create,list],["rename",()=>renamePropertyList(id,rename),rename,list],["add",()=>addPropertyListProperty(id,add),add,property],["remove",()=>removePropertyListProperty(id,propertyId),undefined,{removed:true}]];
  async function main(){
    if(scenario==="sample"){
      const version=useDataVersion.getState().version;for(const [,run]of[...reads,...writes])await refuses(run(),403,"sample_read_only");check("all named operations are blocked in production sample mode",calls.length===1&&calls[0].op==="source");check("sample guard cannot invent persistent personal lists or mutations",useDataVersion.getState().version===version);
    }else if(scenario==="source-forbidden"){
      const version=useDataVersion.getState().version;for(const [,run]of[...reads,...writes])await refuses(run(),403,"Forbidden");check("source permission failure is not cached or replaced",sourceCalls===8&&calls.every(call=>call.op==="source"));check("no operation or mutation refresh was attempted",useDataVersion.getState().version===version);
    }else if(scenario==="source-lost"){
      await assert.rejects(getPropertyLists({page:2,contactId}),TypeError);checks++;check("source read retries once without fallback",sourceCalls===2&&calls.every(call=>call.op==="source"));sourceMode="recovered";await getPropertyList(id);check("source failure can recover on a later read",sourceCalls===3&&count("detail")===1);
    }else{
      const version=useDataVersion.getState().version;
      for(const [op,run,expected]of reads){modes.set(op,op==="lookup"?"lost-once":"gateway-once");const before=count(op);check(op+" returns exact server DTO",JSON.stringify(await run())===JSON.stringify(expected));check(op+" reads retry once, including POST lookup",count(op)===before+2);const tried=calls.filter(call=>call.op===op).slice(-2);check(op+" retry keeps identical method/body",tried[0].method===tried[1].method&&tried[0].body===tried[1].body);for(const [mode,status,code]of[["forbidden",403,"Forbidden"],["not-found",404,op==="lookup"?"listing_not_found":"Not found"]]){modes.set(op,mode);const start=count(op);await refuses(run(),status,code);check(op+" application refusal never retries or returns fallback",count(op)===start+1);}modes.set(op,"success");}
      check("all named reads leave shared version unchanged",useDataVersion.getState().version===version);check("index filters contain only opaque contact and page",calls.filter(call=>call.op==="index").every(call=>new URL(call.url,"https://synthetic.invalid").searchParams.toString()==="page=2&contactId="+contactId));check("MLS lookup input stays in POST body",calls.filter(call=>call.op==="lookup").every(call=>call.body===JSON.stringify({mlsNumber:"A00123"})&&!call.url.includes("A00123")));check("source is cached across named adapters",sourceCalls===1);
      for(const [op,run,input,expected]of writes){const frozen=input===undefined?undefined:JSON.stringify(input);const start=count(op),v=useDataVersion.getState().version;check(op+" unwraps the acknowledged response",JSON.stringify(await run())===JSON.stringify(expected));check(op+" revalidates shared reads once",count(op)===start+1&&useDataVersion.getState().version===v+1);const sent=calls.filter(call=>call.op===op).at(-1);check(op+" sends only the frozen caller payload",sent.body===frozen);for(const [mode,status,code]of[["lost",null,null],["forbidden",403,"Forbidden"],["not-found",404,"Not found"],["conflict",409,op==="add"?"listing_changed":"conflict"],["gateway",502,"gateway"]]){modes.set(op,mode);const before=count(op),bv=useDataVersion.getState().version;if(mode==="lost"){await assert.rejects(run(),TypeError);checks++;}else await refuses(run(),status,code);check(op+" write never auto-retries "+mode,count(op)===before+1);check(op+" write finally refreshes after "+mode,useDataVersion.getState().version===bv+1);}modes.set(op,"success");await run();check(op+" explicit retry retains request/revision/dataset",calls.filter(call=>call.op===op).at(-1).body===frozen);}
      check("personal create omits any contact assignment",!JSON.parse(calls.find(call=>call.op==="create").body).contactId);check("rename passes opening revision untouched",JSON.parse(calls.find(call=>call.op==="rename").body).expectedUpdatedAt===stamp);check("add passes reviewed dataset untouched",JSON.parse(calls.find(call=>call.op==="add").body).expectedDataset===lookup.dataset);check("list IDs and property IDs remain encoded under the list",calls.filter(call=>["detail","rename","lookup","properties","add","remove"].includes(call.op)).every(call=>call.url.startsWith(detail)));check("client names and search text never appear in URLs",calls.every(call=>!decodeURIComponent(call.url).includes("Synthetic")&&!call.url.includes("A00123")));check("all JSON requests send declared headers",calls.every(call=>call.headers.Accept==="application/json"&&(!call.body||call.headers["Content-Type"]==="application/json")));
    }
    console.log(checks+"/"+checks+" named property-list adapter checks passed ("+scenario+")");
  }
  main().catch(error=>{console.error(error);process.exitCode=1;});
 `;
 const output=await build({stdin:{contents:entry,resolveDir:root,loader:"ts"},bundle:true,platform:"node",format:"cjs",write:false}),path=join(temp,"property-lists-adapter.cjs");writeFileSync(path,output.outputFiles[0].contents);
 for(const scenario of["db","sample","source-forbidden","source-lost"]){const result=spawnSync(process.execPath,[path,scenario],{stdio:"inherit"});if(result.error)throw result.error;if(result.status!==0)throw Error("Property-list adapter checks failed: "+scenario);}
}finally{rmSync(temp,{recursive:true,force:true});}
