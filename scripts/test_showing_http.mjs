/** Actual showing HTTP boundaries, with synthetic auth/service answers and no network. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = mkdtempSync(join(tmpdir(), "fortmark-showing-http-"));
const next = `export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`;
const auth = `export async function requireCaller(){const s=globalThis.showingHttpState;s.authCalls++;return s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`;
const contacts = `
 export const NO_STORE={'Cache-Control':'private, no-store'};
 export const contactsSource=()=>globalThis.showingHttpState.source;
 export async function actorOrResponse(){const s=globalThis.showingHttpState;s.actorCalls++;return {ok:true,ctx:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}};}
 export function failure(reason){return Response.json({error:reason},{status:reason==='not_found'?404:reason==='forbidden'||reason==='no_identity'?403:reason==='conflict'||reason==='request_conflict'?409:503,headers:NO_STORE});}
 export function unexpected(){return Response.json({error:'Service unavailable'},{status:503,headers:NO_STORE});}
`;
const provider = `export function createContactPropertyMlsProvider(){globalThis.showingHttpState.providers++;return {synthetic:true};}`;
const service = `
 async function run(name,args){const s=globalThis.showingHttpState;s.calls.push({name,args});if(s.throwService)throw Error('Private appointment details');return s.answers[name]??{ok:true,value:s.values[name]};}
 export const getShowings=(...args)=>run('list',args),getShowing=(...args)=>run('detail',args),createShowing=(...args)=>run('create',args),mutateShowing=(...args)=>run('mutate',args),getShowingAgenda=(...args)=>run('agenda',args),getShowingSummary=(...args)=>run('summary',args);
`;
const entry = `
 import assert from 'node:assert/strict';
 import {readShowingBody,readShowingSummaryLimit,showingCallerContext,showingFailure} from './lib/showings/http';
 import * as base from './app/api/showings/route';
 import * as detail from './app/api/showings/[id]/route';
 import * as agenda from './app/api/showings/agenda/route';
 import * as summary from './app/api/showings/summary/route';
 (async()=>{
 const id='22222222-2222-4222-8222-222222222222',url='https://synthetic.invalid/api/showings';
 const record={id,notes:'Private appointment notes'},page={items:[record],total:1,page:1,pageSize:12};
 const s=globalThis.showingHttpState={auth:true,source:'db',role:'agent',authCalls:0,actorCalls:0,providers:0,calls:[],answers:{},values:{list:page,detail:record,create:record,mutate:record,agenda:{showings:page,nextActions:{items:[],total:0,page:1,pageSize:12}},summary:{items:[record],total:1}}};
 let checks=0;function check(value,label){assert.ok(value,label);checks++;}
 const query='?from=2026-11-05T00:00:00.000Z&to=2026-11-06T00:00:00.000Z&status=all&page=2&pageSize=6';
 const context={params:Promise.resolve({id})};
 const post=(body,headers={})=>new Request(url,{method:'POST',body,headers});
 const stream=(bytes,headers={})=>new Request(url,{method:'POST',body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),headers,duplex:'half'});
 const emptyCalls=()=>{s.calls=[];s.providers=0;};
 const privateResponse=response=>response.headers.get('Cache-Control')==='private, no-store';
 check(readShowingSummaryLimit(new URLSearchParams())===3,'summary default is3');
 for(const limit of ['1','12'])check(readShowingSummaryLimit(new URLSearchParams({limit}))===Number(limit),'summary bounded endpoint accepted');
 for(const value of ['limit=0','limit=13','limit=-1','limit=1.5','limit=','limit=3&limit=4','contactId='+id,'q=private'])check(readShowingSummaryLimit(new URLSearchParams(value))===null,'invalid or extra summary parameters rejected');
 check((await readShowingBody(post(JSON.stringify({notes:'Line1\\nLine2'})))).ok,'plain JSON read');
 check((await readShowingBody(post('"'+'x'.repeat(65534)+'"'))).ok,'exact64KiB body accepted');
 check(!(await readShowingBody(stream(new TextEncoder().encode('"'+'x'.repeat(65535)+'"'),{'content-length':'1'}))).ok,'actual stream cap rejects lied length');
 check(!(await readShowingBody(post('{}',{'content-length':'65537'}))).ok,'declared oversized body refused early');
 check(!(await readShowingBody(stream(new Uint8Array([0xff,0xfe])))).ok,'invalid UTF8 refused');
 check(!(await readShowingBody(post('{bad'))).ok,'malformed JSON refused');
 check(!(await readShowingBody(new Request(url,{method:'POST'}))).ok,'missing body refused');
 s.auth=false;emptyCalls();const unauth=await base.GET(new Request(url+query));
 check(unauth.status===401&&privateResponse(unauth)&&s.calls.length===0&&s.providers===0&&s.actorCalls===0,'sign-in gate precedes service and MLS');s.auth=true;
 s.source='sample';const sample=await base.POST(post('{}'));
 check(sample.status===404&&privateResponse(sample)&&s.calls.length===0&&s.actorCalls===0,'sample source never creates showing state');s.source='db';
 const badId=await showingCallerContext('not-a-uuid');check(!badId.ok&&badId.response.status===404&&s.actorCalls===0,'invalid record identifier refused before actor lookup');
 s.role='member';const member=await detail.PATCH(post('{}'),context);
 check(member.status===403&&privateResponse(member)&&s.calls.length===0&&s.providers===0,'member mutation denied before writes');
 const memberRead=await detail.GET(new Request(url+'/'+id),context);check(memberRead.status===200&&s.calls.at(-1).name==='detail','member reads reach owner-scoped service');s.role='agent';
 emptyCalls();const invalid=await base.GET(new Request(url+'?from=bad&to=bad'));
 check(invalid.status===400&&privateResponse(invalid)&&s.calls.length===0&&s.providers===0,'invalid calendar query makes no service or MLS request');
 const listed=await base.GET(new Request(url+query));check(listed.status===200&&privateResponse(listed)&&JSON.stringify(await listed.json())===JSON.stringify(page),'list route returns bare private page');
 check(s.calls.at(-1).args[1].page===2&&s.calls.at(-1).args[1].pageSize===6&&s.providers===1,'bounded query and lazy provider passed to service');
 const single=await detail.GET(new Request(url+'/'+id),context);check((await single.json()).showing.id===id&&privateResponse(single),'detail route wraps showing');
 const compound=await agenda.GET(new Request(url+'/agenda'+query));check((await compound.json()).showings.total===1&&s.calls.at(-1).name==='agenda'&&privateResponse(compound),'agenda preserves compound response');
 const summaryResponse=await summary.GET(new Request(url+'/summary'));check((await summaryResponse.json()).total===1&&s.calls.at(-1).args[2]===3&&privateResponse(summaryResponse),'summary returns safe response with default bounded limit');
 const beforeInvalid=s.calls.length,invalidSummary=await summary.GET(new Request(url+'/summary?limit=13'));
 check(invalidSummary.status===400&&s.calls.length===beforeInvalid,'invalid summary limit never reaches service');
 emptyCalls();const created=await base.POST(post(JSON.stringify({requestId:id,notes:'Private draft'})));
 check(created.status===201&&(await created.json()).showing.id===id&&privateResponse(created),'create route returns201 showing envelope');
 check(s.providers===0&&s.calls[0].name==='create'&&s.calls[0].args[1].notes==='Private draft','create has no MLS provider work');
 const patched=await detail.PATCH(post(JSON.stringify({action:'cancel',requestId:id,reason:'Private reason'})),context);
 check(patched.status===200&&(await patched.json()).showing.id===id&&s.providers===0&&s.calls.at(-1).name==='mutate','mutation has correct envelope and no MLS work');
 const beforeMalformed=s.calls.length,malformed=await base.POST(post('{'));
 check(malformed.status===400&&s.calls.length===beforeMalformed,'malformed write body never reaches service');
 for(const reason of ['time_conflict','property_conflict','conflict','request_conflict']){const response=showingFailure(reason);check(response.status===409&&privateResponse(response)&&JSON.stringify(await response.json())===JSON.stringify({error:reason}),'conflicts reveal no other private records');}
 s.answers.mutate={ok:false,reason:'not_found'};const missing=await detail.PATCH(post('{}'),context);check(missing.status===404&&privateResponse(missing),'out-of-scope service failure remains404');delete s.answers.mutate;
 s.throwService=true;const failed=await base.POST(post('{}'));check(failed.status===503&&privateResponse(failed)&&!JSON.stringify(await failed.json()).includes('Private'),'unexpected failure never echoes details');
 console.log(checks+'/'+checks+' showing HTTP checks passed (synthetic auth/service; no network)');
 })().catch(error=>{console.error(error);process.exitCode=1;});
`;
try {
  const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "showing-http-boundaries", setup(builder) {
    const fixtures = new Map([["next/server", next], ["auth/require-caller", auth], ["contacts/http", contacts], ["contacts/property-mls", provider], ["showings/service", service]]);
    builder.onResolve({ filter: /(?:^next\/server$|auth\/require-caller(?:\.ts)?$|contacts\/http(?:\.ts)?$|contacts\/property-mls(?:\.ts)?$|showings\/service(?:\.ts)?$)/ }, args => {
      const key = [...fixtures.keys()].find(name => args.path.replace(/\.ts$/, "").endsWith(name));
      return key ? { path: key, namespace: "synthetic-showing-http" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "synthetic-showing-http" }, args => ({ contents: fixtures.get(args.path), loader: "ts" }));
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty-server" }));
    builder.onLoad({ filter: /.*/, namespace: "empty-server" }, () => ({ contents: "", loader: "js" }));
  } }] });
  const output = join(folder, "showing-http.cjs");
  writeFileSync(output, bundled.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 30000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("Showing HTTP checks failed");
} finally { rmSync(folder, { recursive: true, force: true }); }
