/** The production research adapters against an isolated synthetic HTTP transport. */
import {build} from "esbuild";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),temp=mkdtempSync(join(tmpdir(),"fortmark-property-research-adapter-"));
try{
 const entry=`
  import assert from "node:assert/strict";
  import {getPropertyListProperty,getPropertyListProperties,updatePropertyResearch,transferProperty,removePropertyListProperty,LeadsError} from "./lib/data/adapters/leads.ts";
  import {useDataVersion} from "./lib/data/store.ts";
  const scenario=process.argv[2],source="/dashboard/api/contacts/source",listId="list/id? space#",propertyId="property/id? space#",targetListId="70000000-0000-4000-8000-000000000002",stamp="2026-11-02T15:00:00.000Z";
  const base="/dashboard/api/property-lists/"+encodeURIComponent(listId)+"/properties",detail=base+"/"+encodeURIComponent(propertyId),filtered=base+"?page=2&reviewStatus=shortlisted&sort=price_asc";
  const property={id:propertyId,listId,contactId:null,mlsNumber:"A00123",listingId:"listing-key",addedAt:stamp,updatedAt:stamp,notes:"Private research <plain>\\nsecond line",reviewStatus:"shortlisted",listing:null,syncStatus:"unavailable",checkedAt:null},page={items:[property],total:13,totalAll:40,page:2,pageSize:12};
  const patch=Object.freeze({notes:property.notes,reviewStatus:"shortlisted",expectedUpdatedAt:stamp}),transfer=Object.freeze({requestId:"90000000-0000-4000-8000-000000000001",mode:"move",targetListId,expectedUpdatedAt:stamp});
  const moved={...property,id:"new-membership",listId:targetListId},transferResult={property:moved,sourceRemoved:true,targetListId};
  const calls=[],modes=new Map();let sourceMode=scenario,sourceCalls=0,checks=0;
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
  function check(name,value){assert.ok(value,name);checks++;}const count=op=>calls.filter(call=>call.op===op).length;
  async function refuses(run,status,code){await assert.rejects(run(),error=>error instanceof LeadsError&&error.status===status&&error.code===code);checks++;}
  globalThis.fetch=async(path,init={})=>{
    const url=String(path),method=init.method||"GET";
    if(url===source){sourceCalls++;calls.push({op:"source",url,method,headers:init.headers});if(sourceMode==="source-forbidden")return json({error:"Forbidden"},403);if(sourceMode==="source-lost")throw TypeError("source unavailable");return json({source:sourceMode==="sample"?"sample":"db"});}
    assert.ok([detail,filtered,detail+"/transfer"].includes(url),"Unexpected endpoint "+url);
    const op=url===filtered?"filtered":url===detail+"/transfer"?"transfer":method==="PATCH"?"patch":method==="DELETE"?"remove":"detail";
    assert.equal(method,op==="patch"?"PATCH":op==="remove"?"DELETE":op==="transfer"?"POST":"GET");calls.push({op,url,method,body:init.body,headers:init.headers});const mode=modes.get(op)||"success";
    if(mode==="lost-once"){modes.set(op,"success");throw TypeError("read lost once");}if(mode==="gateway-once"){modes.set(op,"success");return json({error:"Service unavailable"},503);}
    if(mode==="lost")throw TypeError("possible commit, response lost");if(mode==="forbidden")return json({error:"Forbidden"},403);if(mode==="missing")return json({error:"Not found"},404);if(mode==="conflict")return json({error:"conflict"},409);if(mode==="duplicate")return json({error:"target_has_property"},409);if(mode==="invalid")return json({error:op==="patch"?"invalid_property_research":"invalid_property_transfer"},400);if(mode==="unavailable")return json({error:"Service unavailable"},503);
    return json(op==="filtered"?page:op==="transfer"?transferResult:op==="remove"?{removed:true}:{property});
  };
  const reads=[["detail",()=>getPropertyListProperty(listId,propertyId),property],["filtered",()=>getPropertyListProperties(listId,2,{reviewStatus:"shortlisted",sort:"price_asc"}),page]];
  const writes=[["patch",()=>updatePropertyResearch(listId,propertyId,patch),patch,property],["transfer",()=>transferProperty(listId,propertyId,transfer),transfer,transferResult],["remove",()=>removePropertyListProperty(listId,propertyId,stamp),{expectedUpdatedAt:stamp},{removed:true}]];
  async function main(){
    const startVersion=useDataVersion.getState().version;
    if(scenario==="sample"){for(const [,run]of[...reads,...writes])await refuses(run,403,"sample_read_only");check("sample mode does not make research or transfer requests",calls.length===1&&calls[0].op==="source");check("sample guards do not simulate persistence",useDataVersion.getState().version===startVersion);}
    else if(scenario==="source-forbidden"){for(const [,run]of[...reads,...writes])await refuses(run,403,"Forbidden");check("source failure is not cached or replaced with sample content",sourceCalls===5&&calls.every(call=>call.op==="source"));check("source refusal leaves shared version untouched",useDataVersion.getState().version===startVersion);}
    else if(scenario==="source-lost"){await assert.rejects(getPropertyListProperty(listId,propertyId),TypeError);checks++;check("source loss retries once, with no fake saved record",sourceCalls===2&&calls.every(call=>call.op==="source"));sourceMode="db";await getPropertyListProperty(listId,propertyId);check("a later real read can recover after source failure",sourceCalls===3&&count("detail")===1);}
    else{
      for(const [op,run,expected]of reads){modes.set(op,"lost-once");const start=count(op);check(op+" returns the exact server DTO",JSON.stringify(await run())===JSON.stringify(expected));check(op+" read retries transport loss once",count(op)===start+2);for(const [mode,status,code]of[["forbidden",403,"Forbidden"],["missing",404,"Not found"],["unavailable",503,"Service unavailable"]]){modes.set(op,mode);const before=count(op);await refuses(run,status,code);check(op+" never substitutes fake data after "+mode,count(op)===before+1);}modes.set(op,"success");}
      check("reads leave version unchanged",useDataVersion.getState().version===startVersion);check("filters and global sort are forwarded to server, not applied on one page",calls.filter(call=>call.op==="filtered").every(call=>call.url===filtered));check("fresh property read is scoped to exact encoded list and property",calls.filter(call=>call.op==="detail").every(call=>call.url===detail));
      for(const [op,run,input,expected]of writes){const frozen=JSON.stringify(input),start=count(op),version=useDataVersion.getState().version;check(op+" unwraps acknowledged server data",JSON.stringify(await run())===JSON.stringify(expected));check(op+" sends one frozen payload",count(op)===start+1&&calls.filter(call=>call.op===op).at(-1).body===frozen);check(op+" revalidates on success",useDataVersion.getState().version===version+1);for(const [mode,status,code]of[["lost",null,null],["forbidden",403,"Forbidden"],["missing",404,"Not found"],["conflict",409,"conflict"],["unavailable",503,"Service unavailable"]]){modes.set(op,mode);const before=count(op),version=useDataVersion.getState().version;if(mode==="lost"){await assert.rejects(run(),TypeError);checks++;}else await refuses(run,status,code);check(op+" never automatically retries a write after "+mode,count(op)===before+1);check(op+" revalidates after refused or uncertain write "+mode,useDataVersion.getState().version===version+1);check(op+" preserves the draft payload after "+mode,calls.filter(call=>call.op===op).at(-1).body===frozen);}modes.set(op,"success");await run();check(op+" explicit retry retains original revision and request identity",calls.filter(call=>call.op===op).at(-1).body===frozen);}
      modes.set("transfer","duplicate");await refuses(()=>transferProperty(listId,propertyId,transfer),409,"target_has_property");check("target duplicate refusal does not rewrite the original request",calls.filter(call=>call.op==="transfer").at(-1).body===JSON.stringify(transfer));
      check("private notes and client text never appear in URLs",calls.every(call=>!decodeURIComponent(call.url).includes("Private research")&&!call.url.includes("A00123")));check("delete carries its observed version to avoid removing a newer note",calls.filter(call=>call.op==="remove").every(call=>JSON.parse(call.body).expectedUpdatedAt===stamp));check("all requests declare JSON headers correctly",calls.every(call=>call.headers.Accept==="application/json"&&(!call.body||call.headers["Content-Type"]==="application/json")));check("source was checked once across the real research adapters",sourceCalls===1);
    }
    console.log(checks+"/"+checks+" property research adapter checks passed ("+scenario+")");
  }main().catch(error=>{console.error(error);process.exitCode=1;});
 `;
 const output=await build({stdin:{contents:entry,resolveDir:root,loader:"ts"},bundle:true,platform:"node",format:"cjs",write:false}),path=join(temp,"property-research-adapter.cjs");writeFileSync(path,output.outputFiles[0].contents);
 for(const scenario of["db","sample","source-forbidden","source-lost"]){const result=spawnSync(process.execPath,[path,scenario],{stdio:"inherit"});if(result.error)throw result.error;if(result.status!==0)throw Error("Property research adapter checks failed: "+scenario);}
}finally{rmSync(temp,{recursive:true,force:true});}
