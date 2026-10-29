/** Production contact adapters with synthetic fetch only; no network or data store. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "fortmark-import-merge-adapter-"));
try {
  const entry = `
    import assert from "node:assert/strict";
    import { previewContactImport, commitContactImport, getContactDuplicates, getContactMergeReview, mergeContacts, LeadsError } from "./lib/data/adapters/leads.ts";
    import { useDataVersion } from "./lib/data/store.ts";
    const scenario=process.argv[2], base="/dashboard/api/contacts";
    const ids=["60000000-0000-4000-8000-000000000001","60000000-0000-4000-8000-000000000002"];
    const stamp="2026-10-29T15:00:00.000Z", fingerprint="a".repeat(64);
    function freeze(value){if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
    const values={firstName:"Synthetic",lastName:"CSV Client",email:"synthetic.csv@example.com",notes:["Synthetic CSV cell, kept in the POST body.","=1+1 remains plain text."].join(String.fromCharCode(10))};
    const previewInput=freeze({rows:[{rowNumber:2,values}]});
    const preview={rows:[{...previewInput.rows[0],normalized:values,errors:[],candidates:[],fileDuplicates:[],reviewFingerprint:fingerprint,recommendedDecision:"add"}],counts:{total:1,valid:1,invalid:0,matched:0}};
    const importInput=freeze({requestId:"80000000-0000-4000-8000-000000000001",rows:[{...previewInput.rows[0],decision:"add",reviewFingerprint:fingerprint}]});
    const importResult={rows:[{rowNumber:2,status:"added",contactId:ids[0]}],counts:{added:1,updated:0,skipped:0}};
    const counts={notes:2,needs:2,activities:2,opportunities:2,transactions:2};
    const fields=["name","email","phone","company","source","stage","birthday","about","personalDetails","legacyNotes"];
    const choices=Object.fromEntries(fields.map(field=>[field,"primary"]));
    const mergeInput=freeze({requestId:"80000000-0000-4000-8000-000000000002",primaryId:ids[0],duplicateId:ids[1],expectedPrimaryUpdatedAt:stamp,expectedDuplicateUpdatedAt:stamp,expectedPrimaryHistoryFingerprint:fingerprint,expectedDuplicateHistoryFingerprint:fingerprint,choices,nextActionChoice:"none"});
    const mergeValues={name:{firstName:"Synthetic",lastName:"Client",preferredName:""},email:"synthetic@example.com",phone:"+12025550101",company:"Synthetic Company",source:"referral",stage:"lead",birthday:null,about:"",personalDetails:[],legacyNotes:""};
    const record=(id)=>({id,name:"Synthetic Client",updatedAt:stamp,historyFingerprint:fingerprint,values:{...mergeValues,company:id===ids[1]?"Synthetic Other Company":mergeValues.company},nextAction:null,counts:{notes:1,needs:1,activities:1,opportunities:1,transactions:1}});
    const review={primary:record(ids[0]),duplicate:record(ids[1]),conflicts:["company"],defaults:choices,preservedCounts:counts};
    const saved={id:ids[0],name:"Synthetic Client",email:mergeValues.email,phone:mergeValues.phone,stage:"lead",source:"referral",intent:"other",assignedAgentId:"30000000-0000-4000-8000-000000000001",assignedAgentName:"Synthetic Admin",ownedByViewer:true,recordSource:"db",createdDate:stamp,updatedAt:stamp,lastContactDate:stamp,notes:"",editable:{...mergeValues.name,company:mergeValues.company}};
    const mergeResult={primary:saved,preservedCounts:counts,mergedContactId:ids[1]};
    const pairContact=id=>({id,name:"Synthetic Client",email:"synthetic@example.com",stage:"lead",updatedAt:stamp});
    const cursor=btoa(JSON.stringify({v:1,primaryId:ids[0],duplicateId:ids[1]})).replace(/=+$/g,"");
    const duplicatePage={pairs:[{primary:pairContact(ids[0]),duplicate:pairContact(ids[1]),reasons:["email"]}],scannedContacts:2,totalContacts:2,hasMore:false,nextCursor:null};
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
    let checks=0, sourceCalls=0, sourceMode=scenario;
    const calls=[], behavior=new Map();
    function check(name,condition){assert.ok(condition,name);checks++;}
    async function refuses(promise,status,code){await assert.rejects(promise,error=>error instanceof LeadsError&&error.status===status&&(!code||error.code===code));checks++;}
    const count=path=>calls.filter(call=>call.path.split("?")[0]===path).length;
    function response(path){return path.endsWith("/import/preview")?preview:path.endsWith("/merge/review")?review:path.endsWith("/duplicates")?duplicatePage:path.endsWith("/import")?importResult:mergeResult;}
    globalThis.fetch=async(path,init={})=>{
      const call={path:String(path),method:init.method||"GET",headers:init.headers,body:init.body};calls.push(call);
      const clean=call.path.split("?")[0];
      if(clean===base+"/source"){
        sourceCalls++;assert.equal(call.method,"GET");
        if(sourceMode==="source-forbidden")return json({error:"forbidden"},403);
        if(sourceMode==="source-lost")throw new TypeError("Synthetic source response lost");
        return json({source:sourceMode==="sample"?"sample":"db"});
      }
      assert.ok(["/import/preview","/import","/duplicates","/merge/review","/merge"].some(suffix=>clean===base+suffix),"No fallback endpoint: "+clean);
      assert.equal(call.method,clean.endsWith("/duplicates")?"GET":"POST");
      const mode=behavior.get(clean)||"success";
      if(mode==="lost-once"){behavior.set(clean,"success");throw new TypeError("Synthetic response lost once");}
      if(mode==="gateway-once"){behavior.set(clean,"success");return json({error:"gateway"},502);}
      if(mode==="lost")throw new TypeError("Synthetic lost response after a possible commit");
      if(mode==="invalid")return json({error:"invalid_request",fields:["rows",42]},400);
      if(mode==="forbidden")return json({error:"forbidden"},403);
      if(mode==="conflict")return json({error:"conflict"},409);
      if(mode==="gateway")return json({error:"gateway"},502);
      return json(response(clean));
    };
    const reads=[
      [base+"/import/preview",()=>previewContactImport(previewInput),preview],
      [base+"/merge/review",()=>getContactMergeReview(ids[0],ids[1]),review],
      [base+"/duplicates",()=>getContactDuplicates(cursor),duplicatePage],
    ];
    const writes=[
      [base+"/import",()=>commitContactImport(importInput),importInput,importResult],
      [base+"/merge",()=>mergeContacts(mergeInput),mergeInput,mergeResult],
    ];
    async function main(){
      if(scenario==="sample"){
        const version=useDataVersion.getState().version;
        await refuses(previewContactImport(previewInput),403,"sample_read_only");
        await refuses(commitContactImport(importInput),403,"sample_read_only");
        await refuses(getContactMergeReview(ids[0],ids[1]),403,"sample_read_only");
        await refuses(mergeContacts(mergeInput),403,"sample_read_only");
        check("sample duplicates are an explicit empty result",JSON.stringify(await getContactDuplicates(cursor))===JSON.stringify({pairs:[],scannedContacts:0,totalContacts:0,hasMore:false,nextCursor:null}));
        check("sample mode never sends an import, merge or duplicate request",calls.length===1&&sourceCalls===1&&calls[0].path===base+"/source");
        check("blocked sample writes do not claim a server mutation",useDataVersion.getState().version===version);
      }else if(scenario==="source-forbidden"){
        const version=useDataVersion.getState().version;
        for(const [,run] of reads)await refuses(run(),403,"forbidden");
        for(const [,run] of writes)await refuses(run(),403,"forbidden");
        check("source refusal never falls back to samples or an operation",sourceCalls===5&&calls.every(call=>call.path===base+"/source"));
        check("source permission errors are not cached or retried",calls.length===5);
        check("source refusal did not attempt or refresh a mutation",useDataVersion.getState().version===version);
      }else if(scenario==="source-lost"){
        await assert.rejects(previewContactImport(previewInput),TypeError);checks++;
        check("an unanswered source lookup retries only once and never falls back",sourceCalls===2&&calls.every(call=>call.path===base+"/source"));
        sourceMode="recovered";
        check("source selection recovers on the next operation",JSON.stringify(await getContactDuplicates())===JSON.stringify(duplicatePage)&&sourceCalls===3);
        await getContactMergeReview(ids[0],ids[1]);
        check("a recovered source is cached for later reads",sourceCalls===3);
      }else{
        const beforeReadsVersion=useDataVersion.getState().version;
        for(const [path,run,expected] of reads){
          const before=count(path);behavior.set(path,path.endsWith("/merge/review")?"lost-once":"gateway-once");
          check("the real read returns the exact DTO: "+path,JSON.stringify(await run())===JSON.stringify(expected));
          check("read requests retry once, including POST reads: "+path,count(path)===before+2);
          const attempted=calls.filter(call=>call.path.split("?")[0]===path).slice(-2);
          check("a retried read retains its body and method: "+path,attempted[0].body===attempted[1].body&&attempted[0].method===attempted[1].method);
        }
        check("all successful/retried reads leave data version unchanged",useDataVersion.getState().version===beforeReadsVersion);
        const postedPreview=calls.find(call=>call.path===base+"/import/preview");
        check("raw mapped cells travel only in the POST body",postedPreview.body===JSON.stringify(previewInput));
        const postedReview=calls.find(call=>call.path===base+"/merge/review");
        check("merge review uses an ID-only POST read body",postedReview.body===JSON.stringify({primaryId:ids[0],duplicateId:ids[1]}));
        const duplicateReads=calls.filter(call=>call.path.startsWith(base+"/duplicates"));
        check("duplicate pagination puts only its opaque cursor in the URL",duplicateReads.every(call=>call.method==="GET"&&!call.body&&new URL(call.path,"http://synthetic.invalid").searchParams.get("cursor")===cursor&&[...new URL(call.path,"http://synthetic.invalid").searchParams.keys()].join()==="cursor"));
        check("URLs contain no client names, email, CSV cells or mapped notes",calls.every(call=>!decodeURIComponent(call.path).includes("Synthetic")&&!call.path.includes("synthetic.csv")&&!call.path.includes("notes")&&!call.path.includes("firstName")));
        check("all JSON operations send the expected request headers",calls.every(call=>call.headers.Accept==="application/json"&&(!call.body||call.headers["Content-Type"]==="application/json")));
        check("successful source selection is cached across the five adapters",sourceCalls===1);
        for(const [path,run] of reads){
          behavior.set(path,"forbidden");const before=count(path),version=useDataVersion.getState().version;
          await refuses(run(),403,"forbidden");
          check("permission read errors do not retry or return fallback data: "+path,count(path)===before+1&&useDataVersion.getState().version===version);
          behavior.set(path,"success");
        }
        behavior.set(base+"/import/preview","gateway");const gatewayStart=count(base+"/import/preview");
        await refuses(previewContactImport(previewInput),502,"gateway");
        check("a repeatedly unavailable POST read stops after one retry",count(base+"/import/preview")===gatewayStart+2);
        behavior.set(base+"/import/preview","success");
        for(const [path,run,input,expected] of writes){
          const frozen=JSON.stringify(input);let before=count(path),version=useDataVersion.getState().version;
          check("a successful mutation returns the exact result DTO: "+path,JSON.stringify(await run())===JSON.stringify(expected));
          check("a successful mutation refreshes shared reads once: "+path,count(path)===before+1&&useDataVersion.getState().version===version+1);
          let sent=calls.filter(call=>call.path===path).at(-1);
          check("the committed request ID, revisions, fingerprints and choices are intact: "+path,sent.body===frozen&&JSON.stringify(input)===frozen);
          behavior.set(path,"lost");before=count(path);version=useDataVersion.getState().version;
          await assert.rejects(run(),TypeError);checks++;
          const lost=calls.filter(call=>call.path===path).at(-1);
          check("a lost write never auto-retries but always refreshes: "+path,count(path)===before+1&&useDataVersion.getState().version===version+1);
          behavior.set(path,"success");
          await run();const manual=calls.filter(call=>call.path===path).at(-1);
          check("an explicit retry retains the same committed receipt identity and payload: "+path,lost.body===manual.body&&manual.body===frozen&&JSON.parse(manual.body).requestId===input.requestId);
          for(const [mode,status,code] of [["invalid",400,"invalid_request"],["forbidden",403,"forbidden"],["conflict",409,"conflict"],["gateway",502,"gateway"]]){
            behavior.set(path,mode);before=count(path);version=useDataVersion.getState().version;
            await refuses(run(),status,code);
            check("an answered write refusal is never retried: "+path+" "+status,count(path)===before+1);
            check("finally refreshes after a write refusal: "+path+" "+status,useDataVersion.getState().version===version+1);
            check("a refusal leaves the caller's reviewed payload frozen: "+path+" "+status,JSON.stringify(input)===frozen);
          }
          behavior.set(path,"success");
        }
      }
      console.log(checks+"/"+checks+" contact import/merge adapter checks passed ("+scenario+")");
    }
    main().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false });
  const path = join(temp, "contact-import-merge-adapter.cjs");
  writeFileSync(path, output.outputFiles[0].contents);
  for (const scenario of ["db", "sample", "source-forbidden", "source-lost"]) {
    const result = spawnSync(process.execPath, [path, scenario], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Contact import/merge adapter checks failed (${scenario})`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
