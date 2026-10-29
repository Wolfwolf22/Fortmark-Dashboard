/** Actual property-list adapters with synthetic transport; never calls a live API. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),temp=mkdtempSync(join(tmpdir(),"fortmark-property-adapter-"));
try{
  const entry=`
    import assert from "node:assert/strict";
    import {getContactProperties,lookupContactProperty,addContactProperty,removeContactProperty,LeadsError} from "./lib/data/adapters/leads.ts";
    import {useDataVersion} from "./lib/data/store.ts";
    const scenario=process.argv[2],contactId="contact/id?x# space",propertyId="property/id?x# space";
    const base="/dashboard/api/contacts/"+encodeURIComponent(contactId)+"/properties",source="/dashboard/api/contacts/source";
    const listing={id:"listing/id?x# space",mlsNumber:"A00123",address:"Synthetic <b>Address</b>",source:"mls"};
    const property={id:propertyId,contactId,mlsNumber:listing.mlsNumber,listingId:listing.id,addedAt:"2026-10-29T15:00:00Z",listing,syncStatus:"available",checkedAt:"2026-10-29T15:00:00Z"};
    const page={items:[property,{...property,id:"retained",listing:null,syncStatus:"unavailable"}],total:14,page:2,pageSize:12},lookup={dataset:"synthetic_mls_a",listing,alreadySaved:false};
    const add=Object.freeze({mlsNumber:"A00123",expectedListingId:listing.id,expectedDataset:lookup.dataset});
    const calls=[],modes=new Map();let checks=0,sourceCalls=0,sourceMode=scenario;
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
    function check(name,value){assert.ok(value,name);checks++;}
    const count=operation=>calls.filter(call=>call.operation===operation).length;
    async function refuses(promise,status,code){await assert.rejects(promise,error=>error instanceof LeadsError&&error.status===status&&error.code===code);checks++;}
    globalThis.fetch=async(path,init={})=>{
      const url=String(path),method=init.method||"GET";
      if(url===source){calls.push({url,method,headers:init.headers,body:init.body,operation:"source"});sourceCalls++;if(sourceMode==="source-forbidden")return json({error:"forbidden"},403);if(sourceMode==="source-lost")throw new TypeError("Synthetic source lost");return json({source:sourceMode==="sample"?"sample":"db"});}
      const operation=url===base+"/lookup"?"lookup":url===base+"/"+encodeURIComponent(propertyId)?"remove":method==="POST"?"add":"list";
      calls.push({url,method,headers:init.headers,body:init.body,operation});
      assert.equal(url,operation==="list"?base+"?page=2":operation==="lookup"?base+"/lookup":operation==="remove"?base+"/"+encodeURIComponent(propertyId):base);
      assert.equal(method,operation==="list"?"GET":operation==="remove"?"DELETE":"POST");
      const mode=modes.get(operation)||"success";
      if(mode==="lost-once"){modes.set(operation,"success");throw new TypeError("Synthetic response lost once");}
      if(mode==="gateway-once"){modes.set(operation,"success");return json({error:"gateway"},502);}
      if(mode==="lost")throw new TypeError("Synthetic response lost after possible commit");
      if(mode==="forbidden")return json({error:"forbidden"},403);
      if(mode==="not-found")return json({error:operation==="lookup"?"listing_not_found":"not_found"},404);
      if(mode==="changed")return json({error:"listing_changed"},409);
      if(mode==="invalid")return json({error:"invalid_property",fields:["mlsNumber"]},400);
      if(mode==="unavailable")return json({error:"unavailable"},503);
      if(mode==="not-configured")return json({error:"not_configured"},503);
      if(mode==="gateway")return json({error:"gateway"},502);
      return json(operation==="list"?page:operation==="lookup"?lookup:operation==="add"?{property}:{removed:true});
    };
    const reads=[["list",()=>getContactProperties(contactId,2),page],["lookup",()=>lookupContactProperty(contactId,"A00123"),lookup]];
    const writes=[["add",()=>addContactProperty(contactId,add),property],["remove",()=>removeContactProperty(contactId,propertyId),{removed:true}]];
    async function main(){
      if(scenario==="sample"){
        const version=useDataVersion.getState().version;
        for(const [,run] of [...reads,...writes])await refuses(run(),403,"sample_read_only");
        check("sample mode blocks every property endpoint",calls.length===1&&calls[0].operation==="source"&&sourceCalls===1);
        check("sample refusals never claim a write or substitute sample MLS properties",useDataVersion.getState().version===version);
      }else if(scenario==="source-forbidden"){
        const version=useDataVersion.getState().version;
        for(const [,run] of [...reads,...writes])await refuses(run(),403,"forbidden");
        check("source refusal is never cached as sample or sent to property endpoints",sourceCalls===4&&calls.every(call=>call.operation==="source"));
        check("source refusal does not revalidate a mutation that was never attempted",useDataVersion.getState().version===version);
      }else if(scenario==="source-lost"){
        await assert.rejects(getContactProperties(contactId,2),TypeError);checks++;
        check("source read retries only once without falling back",sourceCalls===2&&calls.every(call=>call.operation==="source"));
        sourceMode="recovered";await lookupContactProperty(contactId,"A00123");
        check("the source can recover on a later explicit read",sourceCalls===3&&count("lookup")===1);
      }else{
        const version=useDataVersion.getState().version;
        for(const [operation,run,expected] of reads){
          modes.set(operation,operation==="lookup"?"lost-once":"gateway-once");const before=count(operation);
          check("actual "+operation+" read preserves its DTO",JSON.stringify(await run())===JSON.stringify(expected));
          check(operation+" retries one unanswered/gateway read",count(operation)===before+2);
          const attempted=calls.filter(call=>call.operation===operation).slice(-2);check(operation+" retry preserves its body",attempted[0].body===attempted[1].body);
          for(const [mode,status,code] of [["forbidden",403,"forbidden"],["not-found",404,operation==="lookup"?"listing_not_found":"not_found"],["unavailable",503,"unavailable"],["not-configured",503,"not_configured"]]){modes.set(operation,mode);const start=count(operation);await refuses(run(),status,code);check(operation+" application refusal does not retry or become an empty page: "+mode,count(operation)===start+1);}
          modes.set(operation,"success");
        }
        check("property reads never bump the shared data version",useDataVersion.getState().version===version);
        const lookupCall=calls.find(call=>call.operation==="lookup");check("exact MLS number is carried only in a JSON POST body",lookupCall.body===JSON.stringify({mlsNumber:"A00123"})&&lookupCall.method==="POST"&&calls.every(call=>!call.url.includes("A00123")));
        check("read pagination has only the intended page query",calls.filter(call=>call.operation==="list").every(call=>new URL(call.url,"http://synthetic.invalid").searchParams.toString()==="page=2"));
        check("contact and saved-row identifiers are encoded under the same contact endpoint",calls.filter(call=>call.operation!=="source").every(call=>call.url.startsWith(base)));
        check("source choice is cached for subsequent operations",sourceCalls===1);
        for(const [operation,run,expected] of writes){
          const before=count(operation),v=useDataVersion.getState().version;
          check("actual "+operation+" returns the acknowledged result",JSON.stringify(await run())===JSON.stringify(expected));
          check(operation+" revalidates once after success",count(operation)===before+1&&useDataVersion.getState().version===v+1);
          const successful=calls.filter(call=>call.operation===operation).at(-1);
          if(operation==="add")check("add preserves the reviewed dataset and listing identity",successful.body===JSON.stringify(add)&&JSON.parse(successful.body).expectedDataset===lookup.dataset);
          else check("remove sends only scoped IDs with DELETE and no body",successful.method==="DELETE"&&!successful.body);
          for(const [mode,status,code] of [["lost",null,null],["forbidden",403,"forbidden"],["not-found",404,"not_found"],["changed",409,"listing_changed"],["invalid",400,"invalid_property"],["gateway",502,"gateway"]]){
            modes.set(operation,mode);const start=count(operation),beforeVersion=useDataVersion.getState().version;
            if(mode==="lost"){await assert.rejects(run(),TypeError);checks++;}else await refuses(run(),status,code);
            check(operation+" never auto-retries a write: "+mode,count(operation)===start+1);
            check(operation+" finally refreshes a possibly committed/refused write: "+mode,useDataVersion.getState().version===beforeVersion+1);
          }
          modes.set(operation,"success");await run();const retried=calls.filter(call=>call.operation===operation).at(-1);
          check("explicit "+operation+" retry retains the same reference",retried.url===successful.url&&retried.body===successful.body);
        }
        check("caller add payload is unchanged",add.mlsNumber==="A00123"&&add.expectedListingId===listing.id&&add.expectedDataset===lookup.dataset);
        check("all JSON operations use declared headers",calls.every(call=>call.headers.Accept==="application/json"&&(!call.body||call.headers["Content-Type"]==="application/json")));
      }
      console.log(checks+"/"+checks+" contact property adapter checks passed ("+scenario+")");
    }
    main().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const output=await build({stdin:{contents:entry,resolveDir:root,loader:"ts"},bundle:true,platform:"node",format:"cjs",write:false}),path=join(temp,"property-adapter.cjs");writeFileSync(path,output.outputFiles[0].contents);
  for(const scenario of ["db","sample","source-forbidden","source-lost"]){const result=spawnSync(process.execPath,[path,scenario],{stdio:"inherit"});if(result.error)throw result.error;if(result.status!==0)throw Error("Contact property adapter checks failed: "+scenario);}
}finally{rmSync(temp,{recursive:true,force:true});}
