/** Real saved-tour routes and HTTP helpers; all identity/service/provider answers are synthetic. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)), folder = mkdtempSync(join(tmpdir(), "fortmark-saved-tour-http-"));
const fixtures = new Map([
  ["next/server", `export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`],
  ["auth/require-caller", `export async function requireCaller(){const s=globalThis.savedTourHttp;return s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`],
  ["contacts/http", `export const NO_STORE={'Cache-Control':'private, no-store'};export const contactsSource=()=>globalThis.savedTourHttp.source;export async function actorOrResponse(){const s=globalThis.savedTourHttp;s.actorCalls++;return {ok:true,ctx:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}}};export function failure(reason){return Response.json({error:reason},{status:reason==='not_found'?404:reason==='forbidden'?403:['conflict','request_conflict','invalid_transition'].includes(reason)?409:503,headers:NO_STORE})};export function unexpected(){return Response.json({error:'Service unavailable'},{status:503,headers:NO_STORE})}`],
  ["contacts/property-mls", `export function createContactPropertyMlsProvider(){globalThis.savedTourHttp.mls++;return {fake:true}}`],
  ["showings/tour-routing", `export function createTourRoutingProvider(){globalThis.savedTourHttp.roads++;return {map:{kind:'sample'}}}`],
  ["showings/saved-tour-service", `async function run(name,args){const s=globalThis.savedTourHttp;s.calls.push({name,args});if(s.throwService)throw Error('Private notes/endpoints/server key');return s.answers[name]??{ok:true,value:s.values[name]}};export const getSavedShowingTours=(...a)=>run('list',a),getSavedShowingTour=(...a)=>run('get',a),createSavedShowingTour=(...a)=>run('create',a),updateSavedShowingTour=(...a)=>run('edit',a),archiveSavedShowingTour=(...a)=>run('archive',a),reviewSavedShowingTour=(...a)=>run('review',a),scheduleSavedShowingTour=(...a)=>run('schedule',a);`],
]);
const entry = `
import assert from 'node:assert/strict';
import {readSavedTourBody,savedTourFailure} from './lib/showings/saved-tour-http';
import * as base from './app/api/showing-tours/route';
import * as detail from './app/api/showing-tours/[id]/route';
import * as archive from './app/api/showing-tours/[id]/archive/route';
import * as review from './app/api/showing-tours/[id]/review/route';
import * as schedule from './app/api/showing-tours/[id]/schedule/route';
(async()=>{
const id='22222222-2222-4222-8222-222222222222',url='https://synthetic.invalid/api/showing-tours',context={params:Promise.resolve({id})},tour={id,name:'Private draft'},page={items:[tour],total:1,page:1,pageSize:12},reviewValue={tourId:id,reviewToken:'signed-safe-values',slots:[],map:{kind:'sample'}},scheduled={tour,showingIds:[id]};
const s=globalThis.savedTourHttp={auth:true,source:'db',role:'agent',actorCalls:0,mls:0,roads:0,calls:[],answers:{},values:{list:page,get:tour,create:tour,edit:tour,archive:tour,review:reviewValue,schedule:scheduled}};
let checks=0;function check(v,label){assert.ok(v,label);checks++;}const reset=()=>{s.calls=[];s.mls=0;s.roads=0;};const privateResponse=r=>r.headers.get('Cache-Control')==='private, no-store';
const request=(body='{}',method='POST',suffix='')=>new Request(url+suffix,{method,body});
check((await readSavedTourBody(request('"'+'x'.repeat(65534)+'"'))).ok,'exact64KiB body accepted');
const stream=new Request(url,{method:'POST',body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('"'+'x'.repeat(65535)+'"'));c.close()}}),duplex:'half',headers:{'content-length':'1'}});
check(!(await readSavedTourBody(stream)).ok,'actualbyteslimitcannotbypassbydeclaredlength');check(!(await readSavedTourBody(request('{bad'))).ok,'malformedJSONrejected');check(!(await readSavedTourBody(new Request(url,{method:'POST'}))).ok,'missingbodyrejected');
s.auth=false;const unauthorized=await base.POST(request());check(unauthorized.status===401&&privateResponse(unauthorized)&&s.calls.length===0&&s.actorCalls===0,'authgatesallserviceandproviderwork');s.auth=true;
s.source='sample';const sample=await base.GET(new Request(url));check(sample.status===404&&s.calls.length===0&&s.actorCalls===0,'realroutesneverfallbacktosyntheticbook');s.source='db';
const invalidId=await detail.GET(new Request(url),{params:Promise.resolve({id:'bad'})});check(invalidId.status===404&&s.actorCalls===0,'invalidIDgatedbeforeactor');
s.role='member';for(const fn of [base.POST,detail.PATCH,archive.POST,review.POST,schedule.POST]){reset();const result=await fn(request(),context);check(result.status===403&&privateResponse(result)&&s.calls.length===0&&s.mls===0&&s.roads===0,'memberdeniedbeforemutationorpaidreview');}
const memberRead=await detail.GET(new Request(url),context);check(memberRead.status===200&&(await memberRead.json()).tour.id===id,'memberownerreadremainsavailable');s.role='agent';
for(const query of ['?page=0','?pageSize=25','?page=1&page=2','?archived=maybe','?originAddress=Private','?contactId=bad']){reset();const result=await base.GET(new Request(url+query));check(result.status===400&&privateResponse(result)&&s.calls.length===0,'strictboundedgalleryquery');}
reset();const listed=await base.GET(new Request(url+'?page=2&pageSize=6&archived=true&contactId='+id));check(listed.status===200&&privateResponse(listed)&&JSON.stringify(await listed.json())===JSON.stringify(page)&&s.calls[0].args[1].archived===true,'gallerybareDTOandtypedquery');
const created=await base.POST(request(JSON.stringify({requestId:id,originAddress:'Private entered address'})));check(created.status===201&&(await created.json()).tour.id===id&&privateResponse(created)&&s.mls===0&&s.roads===0,'offlinecreatenoproviders');
const edited=await detail.PATCH(request(JSON.stringify({requestId:id,expectedUpdatedAt:'revision'}),'PATCH'),context);check(edited.status===200&&(await edited.json()).tour.id===id&&s.mls===0&&s.roads===0,'offlineeditcorrectenvelope');
const archived=await archive.POST(request(),context);check(archived.status===200&&(await archived.json()).tour.id===id&&s.mls===0&&s.roads===0,'archivecorrectenvelopewithoutprovider');
reset();const reviewed=await review.POST(request(JSON.stringify({expectedUpdatedAt:'revision'})),context);check(reviewed.status===200&&privateResponse(reviewed)&&JSON.stringify(await reviewed.json())===JSON.stringify(reviewValue)&&s.mls===1&&s.roads===1,'explicitreviewonlyconstructsbothproviders');
reset();const applied=await schedule.POST(request(JSON.stringify({requestId:id,reviewToken:'signed',expectedUpdatedAt:'revision'})),context);check(applied.status===200&&privateResponse(applied)&&JSON.stringify(await applied.json())===JSON.stringify(scheduled)&&s.mls===0&&s.roads===0&&s.calls[0].name==='schedule','scheduleofflineatomicserviceandnoGooglecall');
for(const fn of [base.POST,detail.PATCH,archive.POST,review.POST,schedule.POST]){reset();const result=await fn(request('{}','POST','?originAddress=Private'),context);check(result.status===400&&s.calls.length===0&&s.mls===0&&s.roads===0,'allPOST/PATCHrefuseURLpayload');}
reset();const malformed=await review.POST(request('{'),context);check(malformed.status===400&&s.calls.length===0&&s.mls===0&&s.roads===0,'badreviewbodydoesnotconstructproviders');
for(const reason of ['invalid_saved_tour','invalid_saved_tour_query','invalid_route','source_unavailable','stale_review','review_expired','unresolved_stops','time_conflict','unresolved_endpoint','unreachable','infeasible','not_configured','conflict','request_conflict','invalid_transition','not_found','forbidden','unavailable']){const response=savedTourFailure(reason),expected=['invalid_saved_tour','invalid_saved_tour_query','invalid_route'].includes(reason)?400:['source_unavailable','stale_review','review_expired','unresolved_stops','time_conflict','conflict','request_conflict','invalid_transition'].includes(reason)?409:['unresolved_endpoint','unreachable','infeasible'].includes(reason)?422:reason==='not_found'?404:reason==='forbidden'?403:503;check(response.status===expected&&privateResponse(response)&&JSON.stringify(await response.json())===JSON.stringify({error:reason}),'controlledprivatefailurenoendpointorrecordleak');}
s.answers.schedule={ok:false,reason:'stale_review'};const stale=await schedule.POST(request(),context);check(stale.status===409&&(await stale.json()).error==='stale_review','stalereviewrequiresfreshreview');delete s.answers.schedule;
s.throwService=true;const failed=await base.POST(request());check(failed.status===503&&privateResponse(failed)&&!JSON.stringify(await failed.json()).includes('Private'),'unexpectedfailurecontainsnoprivateinput');
console.log(checks+'/'+checks+' saved showing tour HTTP checks passed (synthetic auth/service; no network)');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
try {
  const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "saved-tour-http-boundaries", setup(builder) {
    builder.onResolve({ filter: /(?:^next\/server$|auth\/require-caller(?:\.ts)?$|contacts\/http(?:\.ts)?$|contacts\/property-mls(?:\.ts)?$|showings\/tour-routing(?:\.ts)?$|showings\/saved-tour-service(?:\.ts)?$)/ }, args => { const key = [...fixtures.keys()].find(name => args.path.replace(/\.ts$/, "").endsWith(name)); return key ? { path: key, namespace: "synthetic-saved-tour" } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: "synthetic-saved-tour" }, args => ({ contents: fixtures.get(args.path), loader: "ts" }));
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty-server" })); builder.onLoad({ filter: /.*/, namespace: "empty-server" }, () => ({ contents: "", loader: "js" }));
  } }] });
  const output = join(folder, "saved-tour-http.cjs"); writeFileSync(output, bundled.outputFiles[0].contents); const result = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 30000 }); process.stdout.write(result.stdout); process.stderr.write(result.stderr); if (result.status !== 0) throw Error("Saved tour HTTP checks failed");
} finally { rmSync(folder, { recursive: true, force: true }); }
