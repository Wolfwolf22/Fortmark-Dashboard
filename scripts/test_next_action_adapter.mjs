/** Actual production browser adapter, with synthetic fetch only; no network. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "fortmark-next-action-adapter-"));
try {
  const entry = `
    import assert from "node:assert/strict";
    import { getNextActionAssignees, updateNextAction, LeadsError } from "./lib/data/adapters/leads.ts";
    import { useDataVersion } from "./lib/data/store.ts";
    const scenario = process.argv[2];
    const id = "synthetic/id?x# space";
    const endpoint = "/dashboard/api/contacts/" + encodeURIComponent(id) + "/next-action";
    const sourceEndpoint = "/dashboard/api/contacts/source";
    const assignees = [{id:"30000000-0000-4000-8000-000000000001",name:"Synthetic Admin"}];
    const actionId = "40000000-0000-4000-8000-000000000001";
    const observedRevision = "2026-10-29T15:00:00.000Z";
    const next = Object.freeze({kind:"call",purpose:"Synthetic purpose <b>plain text</b>",dueAt:"2026-10-30T16:30:00.000Z",assigneeId:assignees[0].id});
    const set = Object.freeze({action:"set",expectedUpdatedAt:observedRevision,expectedActionId:actionId,next});
    const saved = {id,recordSource:"db",updatedAt:"2026-10-29T15:00:01.000Z",nextAction:{...next,id:actionId,assigneeName:assignees[0].name}};
    const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
    let checks=0, sourceCalls=0, readCalls=0, writes=0;
    let sourceMode=scenario, readMode="success", writeMode="success";
    const calls=[];
    function check(name,condition){assert.ok(condition,name);checks++;}
    async function refuses(promise,status,code){await assert.rejects(promise,error=>error instanceof LeadsError && error.status===status && (!code || error.code===code));checks++;}
    globalThis.fetch=async (path,init={})=>{
      const call={path:String(path),method:init.method||"GET",headers:init.headers,body:init.body};calls.push(call);
      if(call.path===sourceEndpoint){
        sourceCalls++;
        check("source selection is a read",call.method==="GET"&&!call.body);
        if(sourceMode==="db"&&sourceCalls===1)throw new TypeError("Synthetic source response lost");
        if(sourceMode==="source-forbidden")return json({error:"forbidden"},403);
        if(sourceMode==="source-lost")throw new TypeError("Synthetic source unavailable");
        return json({source:sourceMode==="sample"?"sample":"db"});
      }
      assert.equal(call.path,endpoint,"unexpected endpoint: no fallback transport is allowed");
      if(call.method==="GET"){
        readCalls++;
        if(readMode==="gateway-once"){readMode="success";return json({error:"gateway"},502);}
        if(readMode==="lost-once"){readMode="success";throw new TypeError("Synthetic assignee response lost");}
        if(readMode==="gateway-always")return json({error:"gateway"},504);
        if(readMode==="forbidden")return json({error:"forbidden"},403);
        if(readMode==="not-found")return json({error:"not_found"},404);
        if(readMode==="unauthorized")return json({error:"unauthorized"},401);
        return json({items:assignees});
      }
      assert.equal(call.method,"POST","mutations use the one explicit POST endpoint");
      writes++;
      if(writeMode==="lost")throw new TypeError("Synthetic lost mutation response");
      if(writeMode==="conflict")return json({error:"conflict"},409);
      if(writeMode==="forbidden")return json({error:"forbidden"},403);
      if(writeMode==="gateway")return json({error:"gateway"},502);
      if(writeMode==="invalid")return json({error:"invalid_date",fields:["dueAt",42]},400);
      return json({contact:saved});
    };
    async function main(){
      if(scenario==="sample"){
        const version=useDataVersion.getState().version;
        check("sample source exposes no structured assignees",(await getNextActionAssignees(id)).length===0);
        await refuses(updateNextAction(id,set),403,"sample_read_only");
        check("sample mode never contacts the action read or write endpoint",readCalls===0&&writes===0&&calls.every(call=>call.path===sourceEndpoint));
        check("sample source is cached without a second lookup",sourceCalls===1);
        check("a locally refused sample mutation did not claim a server write",useDataVersion.getState().version===version);
      }else if(scenario==="source-forbidden"){
        const version=useDataVersion.getState().version;
        await refuses(getNextActionAssignees(id),403,"forbidden");
        await refuses(updateNextAction(id,set),403,"forbidden");
        check("source permission failures are not retried or cached as sample",sourceCalls===2&&readCalls===0&&writes===0);
        check("no mutation or fallback was attempted after source refusal",calls.every(call=>call.path===sourceEndpoint)&&useDataVersion.getState().version===version);
      }else if(scenario==="source-lost"){
        await assert.rejects(getNextActionAssignees(id),TypeError);checks++;
        check("an unanswered source read retries only once",sourceCalls===2&&readCalls===0&&writes===0);
        sourceMode="recovered";
        const recovered=await getNextActionAssignees(id);
        check("a failed source selection can recover on the next read",sourceCalls===3&&readCalls===1&&recovered[0].id===assignees[0].id);
        check("source recovery never substituted a sample or wrote",writes===0);
      }else{
        readMode="gateway-once";
        check("the real assignee read returns its scoped response",JSON.stringify(await getNextActionAssignees(id))===JSON.stringify(assignees));
        check("source and gateway reads each retry once",sourceCalls===2&&readCalls===2);
        check("contact ID is encoded beneath the dashboard action endpoint",calls.filter(call=>call.path!==sourceEndpoint).every(call=>call.path===endpoint));
        check("reads send JSON Accept without a write body or content type",calls.every(call=>call.headers.Accept==="application/json"&&!call.body&&!call.headers["Content-Type"]));
        const beforeRead=readCalls;
        readMode="lost-once";await getNextActionAssignees(id);
        check("an unanswered assignee read retries once with cached source",readCalls===beforeRead+2&&sourceCalls===2);
        for(const [readCase,status,code] of [["forbidden",403,"forbidden"],["not-found",404,"not_found"],["unauthorized",401,"unauthorized"]]){
          readMode=readCase;const before=readCalls;
          await refuses(getNextActionAssignees(id),status,code);
          check("an application read refusal is not retried or replaced: "+readCase,readCalls===before+1&&writes===0);
        }
        readMode="gateway-always";const beforeGateway=readCalls;
        await refuses(getNextActionAssignees(id),504,"gateway");
        check("repeated gateway failure stops after the single read retry",readCalls===beforeGateway+2);
        readMode="success";
        const frozen=JSON.stringify(set);
        const version=useDataVersion.getState().version;
        const result=await updateNextAction(id,set);
        check("a saved mutation returns the actual contact response",JSON.stringify(result)===JSON.stringify(saved));
        check("success revalidates shared reads exactly once",useDataVersion.getState().version===version+1&&writes===1);
        let write=calls.filter(call=>call.method==="POST").at(-1);
        check("the POST carries the frozen revision, pending ID and full draft",JSON.stringify(JSON.parse(write.body))===frozen&&JSON.stringify(set)===frozen);
        check("a mutation uses JSON request headers",write.headers.Accept==="application/json"&&write.headers["Content-Type"]==="application/json");
        const commands=[
          Object.freeze({action:"complete",expectedUpdatedAt:observedRevision,actionId,outcome:"Synthetic completed outcome",next}),
          Object.freeze({action:"cancel",expectedUpdatedAt:observedRevision,actionId,reason:"Synthetic cancelled reason"}),
        ];
        for(const command of commands){
          await updateNextAction(id,command);write=calls.filter(call=>call.method==="POST").at(-1);
          check("the "+command.action+" payload passes its observed revision and identity unchanged",write.body===JSON.stringify(command));
        }
        for(const [writeCase,status,code] of [["lost",null,null],["conflict",409,"conflict"],["forbidden",403,"forbidden"],["gateway",502,"gateway"],["invalid",400,"invalid_date"]]){
          writeMode=writeCase;const beforeWrites=writes, beforeVersion=useDataVersion.getState().version;
          if(writeCase==="lost"){await assert.rejects(updateNextAction(id,set),TypeError);checks++;}
          else await refuses(updateNextAction(id,set),status,code);
          check("a refused or unanswered mutation is never retried: "+writeCase,writes===beforeWrites+1);
          check("shared reads revalidate after a possibly committed/refused write: "+writeCase,useDataVersion.getState().version===beforeVersion+1);
          check("the caller's frozen draft remains intact: "+writeCase,JSON.stringify(set)===frozen);
        }
        check("all mutations stay on the scoped contact endpoint",calls.filter(call=>call.method==="POST").every(call=>call.path===endpoint));
      }
      console.log(checks+"/"+checks+" next-action adapter checks passed ("+scenario+")");
    }
    main().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false });
  const path = join(temp, "next-action-adapter.cjs");
  writeFileSync(path, output.outputFiles[0].contents);
  for (const scenario of ["db", "sample", "source-forbidden", "source-lost"]) {
    const result = spawnSync(process.execPath, [path, scenario], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Next-action adapter checks failed (${scenario})`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
