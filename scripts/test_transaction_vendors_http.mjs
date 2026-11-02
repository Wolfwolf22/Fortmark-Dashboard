/** Real vendor routes over synthetic auth/service; no credentials, network or live data. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)), folder = mkdtempSync(join(tmpdir(), "fortmark-vendor-http-"));
const fixtures = new Map([
  ["next/server", `export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`],
  ["auth/require-caller", `export async function requireCaller(){const s=globalThis.vendorHttp;return s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`],
  ["flags", `export const transactionsDatabaseEnabled=()=>globalThis.vendorHttp.source==='db';`],
  ["transactions/service", `export async function resolveActor(){const s=globalThis.vendorHttp;s.actorCalls++;return s.actorFailure?{ok:false,reason:s.actorFailure}:{ok:true,value:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}}};`],
  ["transactions/vendor-service", `async function run(name,args){const s=globalThis.vendorHttp;s.calls.push({name,args});if(s.throwService)throw Error('Private vendor identity and email');return s.answers[name]??{ok:true,value:s.values[name]}};export const listBrokerageVendors=(...a)=>run('list',a),createBrokerageVendor=(...a)=>run('create',a),updateBrokerageVendor=(...a)=>run('edit',a),mutateTransactionVendor=(...a)=>run('assign',a);`],
]);
const entry = `
import assert from 'node:assert/strict';
import * as directory from './app/api/vendors/route';
import * as vendor from './app/api/vendors/[id]/route';
import * as assignment from './app/api/transactions/[id]/vendors/route';
import {vendorFailure} from './lib/transactions/vendor-http';
(async()=>{
 const id='22222222-2222-4222-8222-222222222222',url='https://synthetic.invalid/api/vendors',context={params:Promise.resolve({id})},revision='2026-11-02T17:00:00.000Z';
 const entry={id,name:'Private approved vendor',company:'Private vendor company',email:'vendor@example.test',phone:null,categories:['inspector'],approved:true,updatedAt:revision},file={transaction:{id},vendors:[{id,role:'inspector',status:'selected',vendorId:id,vendorName:entry.name,company:entry.company,email:entry.email,phone:null,approved:true,updatedAt:revision}],canEdit:true,updatedAt:revision};
 const s=globalThis.vendorHttp={auth:true,source:'db',role:'admin',actorCalls:0,calls:[],answers:{},values:{list:{items:[entry],canManage:true},create:entry,edit:entry,assign:file}};
 let n=0;const check=(value,name)=>{assert.ok(value,name);n++},reset=()=>{s.calls=[];s.actorCalls=0},privateResponse=r=>r.headers.get('Cache-Control')==='private, no-store';
 const request=(body={},method='POST',suffix='')=>new Request(url+suffix,{method,body:typeof body==='string'?body:JSON.stringify(body)});
 s.auth=false;for(const fn of [directory.GET,directory.POST,vendor.PATCH,assignment.POST]){reset();const r=await fn(new Request(url),context);check(r.status===401&&s.calls.length===0&&s.actorCalls===0,'verified caller required before any directory or assignment read/write')};s.auth=true;
 s.source='sample';for(const fn of [directory.GET,directory.POST,vendor.PATCH,assignment.POST]){reset();const r=await fn(new Request(url),context);check(r.status===404&&privateResponse(r)&&s.calls.length===0&&s.actorCalls===0,'sample mode has no production vendor fallback')};s.source='db';
 for(const query of ['?role=invalid','?role=inspector&role=title','?approved=true','?q=Private']){reset();const r=await directory.GET(new Request(url+query));check(r.status===400&&s.calls.length===0&&s.actorCalls===0,'directory query accepts only one declared vendor role')};
 reset();const list=await directory.GET(new Request(url+'?role=inspector'));check(list.status===200&&privateResponse(list)&&s.calls[0].name==='list'&&s.calls[0].args[1].role==='inspector'&&(await list.json()).canManage,'valid role filter reaches server scope');
 for(const role of ['agent','member','broker','transaction_coordinator']){s.role=role;for(const fn of [directory.POST,vendor.PATCH]){reset();const r=await fn(request(),context);check(r.status===403&&privateResponse(r)&&s.calls.length===0,'only Admin can create edit approve or retire directory entries')};reset();const r=await directory.GET(new Request(url));check(r.status===200&&s.calls[0].name==='list','all authorized brokerage roles can read their allowed directory projection')};
 s.role='member';reset();const member=await assignment.POST(request(),context);check(member.status===403&&s.calls.length===0,'Member cannot set a vendor even with valid transaction ID');s.role='admin';
 for(const fn of [vendor.PATCH,assignment.POST]){reset();const r=await fn(request(),{params:Promise.resolve({id:'bad'})});check(r.status===404&&s.calls.length===0&&s.actorCalls===0,'bad UUID rejected before actor lookup')};
 for(const fn of [directory.POST,vendor.PATCH,assignment.POST]){reset();const r=await fn(request({},'POST','?email=private@example.test'),context);check(r.status===400&&s.calls.length===0,'write payload cannot travel through private URL values');reset();const bad=await fn(request('{bad'),context);check(bad.status===400&&s.calls.length===0,'invalid JSON cannot reach service');reset();const large=await fn(request('"'+'x'.repeat(65535)+'"'),context);check(large.status===400&&s.calls.length===0,'actual request bytes remain bounded')};
 const createBody={requestId:id,vendor:{name:entry.name,company:entry.company,email:entry.email,phone:null,categories:['inspector'],approved:true}};
 reset();const made=await directory.POST(request(createBody));check(made.status===201&&privateResponse(made)&&JSON.stringify(await made.json())===JSON.stringify(entry)&&s.calls[0].args[1].requestId===id,'directory create returns the actual vendor DTO and stable request');
 reset();const edited=await vendor.PATCH(request({...createBody,expectedUpdatedAt:revision},'PATCH'),context);check(edited.status===200&&privateResponse(edited)&&s.calls[0].name==='edit'&&s.calls[0].args[1]===id&&s.calls[0].args[2].expectedUpdatedAt===revision,'directory edit sends reviewed revision to single writer');
 s.role='agent';const selection={requestId:id,expectedUpdatedAt:revision,role:'inspector',status:'selected',vendorId:id,expectedVendorUpdatedAt:revision,expectedSelectionUpdatedAt:null};reset();const assigned=await assignment.POST(request(selection),context);check(assigned.status===200&&privateResponse(assigned)&&JSON.stringify(await assigned.json())===JSON.stringify(file)&&JSON.stringify(s.calls[0].args[2])===JSON.stringify(selection),'assignment passes all reviewed revisions and returns current file workspace');
 for(const reason of ['vendor_unavailable','conflict','request_conflict','invalid_transition']){s.answers.assign={ok:false,reason};reset();const r=await assignment.POST(request(selection),context);check(r.status===409&&privateResponse(r)&&!JSON.stringify(await r.json()).includes('Private'),'assignment refusal exposes only coarse safe code')};delete s.answers.assign;
 for(const reason of ['not_found','forbidden','invalid_transaction']){const r=vendorFailure(reason);check(r.status===(reason==='not_found'?404:reason==='forbidden'?403:400)&&privateResponse(r),'shared failures preserve scope and permission semantics')};
 s.actorFailure='no_identity';reset();const missing=await directory.GET(new Request(url));check(missing.status===403&&s.calls.length===0,'missing brokerage identity cannot read directory');s.actorFailure=null;
 s.throwService=true;reset();const failed=await directory.GET(new Request(url));check(failed.status===503&&privateResponse(failed)&&!JSON.stringify(await failed.json()).includes('Private'),'unexpected vendor errors do not echo identity values');
 console.log(n+'/'+n+' transaction vendor HTTP checks passed (synthetic auth/service; no network)');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
try {
 const result = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "vendor-http-boundaries", setup(builder) {
  builder.onResolve({ filter: /^\.\/service\.ts$/ }, args => args.importer.endsWith("/lib/transactions/http.ts") ? { path: "transactions/service", namespace: "synthetic-vendor" } : undefined);
  builder.onResolve({ filter: /(?:^next\/server$|auth\/require-caller(?:\.ts)?$|(?:^|\/)flags(?:\.ts)?$|transactions\/service(?:\.ts)?$|transactions\/vendor-service(?:\.ts)?$)/ }, args => { const key = [...fixtures.keys()].find(name => args.path.replace(/\.ts$/, "").endsWith(name)); return key ? { path: key, namespace: "synthetic-vendor" } : undefined; });
  builder.onLoad({ filter: /.*/, namespace: "synthetic-vendor" }, args => ({ contents: fixtures.get(args.path), loader: "ts" }));
  builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty-server" }));builder.onLoad({ filter: /.*/, namespace: "empty-server" }, () => ({ contents: "", loader: "js" }));
 } }] });
 const output = join(folder, "vendor-http.cjs"); writeFileSync(output, result.outputFiles[0].contents); const run = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 30000 });process.stdout.write(run.stdout);process.stderr.write(run.stderr);if (run.status !== 0) throw Error("Vendor HTTP checks failed");
} finally { rmSync(folder, { recursive: true, force: true }); }
