/** Actual contact lifecycle routes and streamed multipart parsing, closed service fakes only. */
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'contact-lifecycle-http-'));
const fixtures=new Map([
 ['next/server',`export const NextResponse={json:(value,options={})=>Response.json(value,options)};`],
 ['auth/require-caller',`export async function requireCaller(){return globalThis.s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401})}}`],
 ['@clerk/nextjs/server',`export const currentUser=async()=>null;`],
 ['flags',`export const contactsDatabaseEnabled=()=>globalThis.s.source==='db';`],
 ['contacts/service',`export async function resolveActor(){globalThis.s.actors++;return{ok:true,value:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:globalThis.s.role,brokerageKey:'fortmark'},db:{}}}};export const getContact=async()=>null,editContact=async()=>({ok:false,reason:'not_found'}),changeStage=async()=>({ok:false,reason:'engagement_required'});`],
 ['data/sample-leads',`export const getSampleLead=()=>({id:'synthetic',stage:'lead'});`],
 ['contacts/lifecycle-service',`export async function mutateContactDeletion(...args){const s=globalThis.s;s.calls.push(['delete',args]);if(s.throw)throw Error('secret filename');return s.answer??{ok:true,value:{contactId:args[1],deletedAt:args[2]==='delete'?'2026-11-03T15:00:00Z':null,updatedAt:'2026-11-03T15:01:00Z'}}};export async function listDeletedContacts(...args){globalThis.s.calls.push(['deleted',args]);return{ok:true,value:{items:[],total:0,page:1,pageSize:25}}}`],
 ['contacts/engagement-storage',`export function createContactEngagementStorage(){globalThis.s.storage++;return{enabled:true}}`],
 ['contacts/engagement-service',`async function run(name,args){const s=globalThis.s;s.calls.push([name,args]);if(s.throw)throw Error('private provider key');if(s.answer)return s.answer;if(name==='download')return{ok:true,value:{stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('%PDF-1.7 synthetic %%EOF'));c.close()}}),filename:'Private.pdf',sizeBytes:24}};return{ok:true,value:{file:null,contactUpdatedAt:'2026-11-03T15:00:00Z',canWrite:s.role!=='member',uploadsEnabled:true}}};export const getContactEngagement=(...a)=>run('get',a),uploadContactEngagement=(...a)=>run('upload',a),removeContactEngagement=(...a)=>run('remove',a),downloadContactEngagement=(...a)=>run('download',a);`],
 ['contacts/history-service',`export async function getTouchHistoryPage(...args){globalThis.s.calls.push(['touches',args]);return{ok:true,value:{items:[],hasMore:false,nextCursor:null}}}`],
]);
const entry=String.raw`
import assert from 'node:assert/strict';
import * as contact from './app/api/contacts/[id]/route';
import * as restore from './app/api/contacts/[id]/restore/route';
import * as deleted from './app/api/contacts/deleted/route';
import * as engagement from './app/api/contacts/[id]/engagement/route';
import * as download from './app/api/contacts/[id]/engagement/[fileId]/route';
import * as touches from './app/api/contacts/[id]/touches/route';
import * as stage from './app/api/contacts/[id]/stage/route';
import {readContactEngagementForm,readContactLifecycleBody} from './lib/contacts/lifecycle-http';
(async()=>{
let checks=0;const check=(v,n)=>{assert.ok(v,n);checks++},s=globalThis.s={auth:true,source:'db',role:'agent',calls:[],actors:0,storage:0};
const id='22222222-2222-4222-8222-222222222222',fileId='33333333-3333-4333-8333-333333333333',url='https://synthetic.invalid/api/contacts',context={params:Promise.resolve({id,fileId})},requestId='44444444-4444-4444-8444-444444444444',rev='2026-11-03T15:00:00Z';
const json=(body,method='POST')=>new Request(url,{method,body:JSON.stringify(body)}),reset=()=>{s.calls=[];s.actors=0;s.storage=0},privateResponse=r=>r.headers.get('Cache-Control')==='private, no-store';
const routes=[contact.DELETE,restore.POST,deleted.GET,engagement.GET,engagement.POST,engagement.DELETE,download.GET,touches.GET];
s.auth=false;for(const fn of routes){reset();const r=await fn(new Request(url),context);check(r.status===401&&s.actors===0&&s.calls.length===0&&s.storage===0,'auth precedes service/storage')};s.auth=true;
s.source='sample';for(const fn of routes){reset();const r=await fn(new Request(url),context);check(r.status===404&&privateResponse(r)&&s.actors===0&&s.calls.length===0&&s.storage===0,'sample cannot access private real lifecycle')};
const sampleStage=await stage.POST(json({stage:'representation',engagementAcknowledged:true,expectedUpdatedAt:rev}),context);check(sampleStage.status===403&&(await sampleStage.json()).error==='sample_read_only','sample stage cannot bypass real PDF requirement');s.source='db';
s.role='member';for(const fn of [contact.DELETE,restore.POST,engagement.POST,engagement.DELETE]){reset();const r=await fn(json({}),context);check(r.status===403&&privateResponse(r)&&s.calls.length===0&&s.storage===0,'member cannot mutate lifecycle or construct private store')};s.role='agent';
reset();const erased=await contact.DELETE(json({requestId,expectedUpdatedAt:rev},'DELETE'),context);check(erased.status===200&&privateResponse(erased)&&s.calls[0][1][2]==='delete'&&s.calls[0][1][3].requestId===requestId,'DELETE dispatches recoverable operation and exact request UUID');
reset();const restored=await restore.POST(json({requestId,expectedUpdatedAt:rev}),context);check(restored.status===200&&s.calls[0][1][2]==='restore','restore uses same contact identity and explicit operation');
reset();const history=await touches.GET(new Request(url+'?pageSize=25'),context);check(history.status===200&&privateResponse(history)&&s.calls[0][0]==='touches'&&s.calls[0][1][1]===id,'touch history passes only scoped contact ID');
for(const query of ['?pageSize=101','?cursor=private-client-text','?privateName=Example']){reset();const r=await touches.GET(new Request(url+query),context);check(r.status===400&&s.calls.length===0,'invalid history request cannot read services')};
for(const query of ['?page=1&page=2','?name=Private']){reset();const r=await deleted.GET(new Request(url+query));check(r.status===400&&s.calls.length===0,'deleted list query permits bounded page only')};
const form=()=>{const f=new FormData();f.set('file',new File(['%PDF-1.7 synthetic %%EOF'],'Agreement.pdf',{type:'application/pdf'}));f.set('requestId',requestId);f.set('expectedUpdatedAt',rev);f.set('expectedEngagementId','');f.set('expectedEngagementUpdatedAt','');return f};
reset();const uploaded=await engagement.POST(new Request(url,{method:'POST',body:form()}),context);check(uploaded.status===200&&privateResponse(uploaded)&&s.calls[0][0]==='upload'&&s.calls[0][1][2].requestId===requestId&&s.calls[0][1][2].expectedEngagementId===null&&s.calls[0][1][3].bytes.length>12,'actual multipart parser preserves UUID/revision and bytes without trusting MIME');
const duplicate=form();duplicate.append('requestId',requestId);reset();const dup=await engagement.POST(new Request(url,{method:'POST',body:duplicate}),context);check(dup.status===400&&s.calls.length===0&&s.storage===0,'duplicated multipart fields are refused');
const extra=form();extra.set('storagePath','contact-engagements/private');reset();const overpost=await engagement.POST(new Request(url,{method:'POST',body:extra}),context);check(overpost.status===400&&s.calls.length===0,'client cannot supply storage path');
const large=form();large.set('file',new File([new Uint8Array(4194305)],'TooLarge.pdf'));reset();const tooLarge=await engagement.POST(new Request(url,{method:'POST',body:large}),context);check(tooLarge.status===413&&s.calls.length===0&&s.storage===0,'actual bytes enforce 4MiB before store constructor');
const badForm=await readContactEngagementForm(json({file:'pretend'}));check(!badForm.ok&&badForm.reason==='invalid_engagement','JSON is not a multipart upload');
check(await readContactLifecycleBody(new Request(url,{method:'POST',body:'x'.repeat(8193)}))===null,'JSON streaming body is bounded');
reset();const binary=await download.GET(new Request(url),context);check(binary.status===200&&privateResponse(binary)&&binary.headers.get('X-Content-Type-Options')==='nosniff'&&binary.headers.get('Content-Disposition').startsWith('attachment;')&&binary.headers.get('Content-Type')==='application/pdf','download is authorized private attachment with nosniff');
check(!(await binary.text()).includes('https://'),'download returns bytes rather than provider URL');
s.answer={ok:false,reason:'not_found'};const hidden=await engagement.GET(new Request(url),context);check(hidden.status===404&&!JSON.stringify(await hidden.json()).includes('filename'),'refused scope contains no private document metadata');
for(const [reason,status] of [['engagement_required',409],['engagement_acknowledgement_required',409],['engagement_not_configured',503],['conflict',409],['request_conflict',409]]){s.answer={ok:false,reason};const r=await engagement.GET(new Request(url),context);check(r.status===status&&privateResponse(r),'controlled failure maps honestly')};delete s.answer;s.throw=true;const failed=await engagement.GET(new Request(url),context);check(failed.status===503&&!JSON.stringify(await failed.json()).includes('provider'),'unexpected error does not expose provider details');
console.log(checks+'/'+checks+' contact lifecycle HTTP checks passed (actual routes, closed boundaries)');
})().catch(e=>{console.error(e);process.exitCode=1});`;
try{const output=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'closed-contact-http',setup(b){b.onResolve({filter:/.*/},a=>{const normalized=a.path.replace(/\.ts$/,'');const key=[...fixtures.keys()].find(k=>normalized===k||normalized.endsWith('/'+k)||normalized==='./service'&&a.importer.endsWith('/contacts/http.ts')&&k==='contacts/service');return key?{path:key,namespace:'contact-fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'contact-fixture'},a=>({contents:fixtures.get(a.path),loader:'ts'}));b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});const path=join(dir,'http.cjs');writeFileSync(path,output.outputFiles[0].contents);const result=spawnSync(process.execPath,[path],{encoding:'utf8',timeout:30000});process.stdout.write(result.stdout);process.stderr.write(result.stderr);if(result.status!==0)throw Error('Contact HTTP checks failed');}finally{rmSync(dir,{recursive:true,force:true})}
