/** Actual vendor routes/multipart boundary; synthetic auth and services, no network. */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),folder=mkdtempSync(join(tmpdir(),'fortmark-vendor-detail-http-'));
const fixtures=new Map([
 ['next/server',`export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`],
 ['auth/require-caller',`export async function requireCaller(){const s=globalThis.vendorDetailHttp;return s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`],
 ['flags',`export const transactionsDatabaseEnabled=()=>globalThis.vendorDetailHttp.source==='db';`],
 ['transactions/service',`export async function resolveActor(){const s=globalThis.vendorDetailHttp;s.actors++;return {ok:true,value:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}}};`],
 ['transactions/transaction-file-storage',`export function createTransactionFileStorage(){globalThis.vendorDetailHttp.providers++;return {enabled:true}}`],
 ['transactions/vendor-detail-service',`async function run(name,args){const s=globalThis.vendorDetailHttp;s.calls.push({name,args});if(s.throwService)throw Error('Private financing and token');if(s.answers[name])return s.answers[name];if(name==='download'){const bytes=new TextEncoder().encode('%PDF-1.7 synthetic');return {ok:true,value:{filename:'Private report.pdf',contentType:'application/pdf',sizeBytes:bytes.length,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close()}})}}}return {ok:true,value:name==='history'?s.history:s.detail}};export const getTransactionVendorDetail=(...a)=>run('get',a),updateTransactionVendorDetail=(...a)=>run('edit',a),listTransactionVendorDetails=(...a)=>run('history',a),uploadTransactionVendorAttachment=(...a)=>run('upload',a),getTransactionVendorAttachment=(...a)=>run('download',a),removeTransactionVendorAttachment=(...a)=>run('remove',a);`],
]);
const entry=String.raw`
import assert from 'node:assert/strict';
import {readVendorAttachmentForm} from './lib/transactions/vendor-detail-http';
import {MAX_TRANSACTION_ATTACHMENT_BYTES} from './lib/transactions/attachment-format';
import {failure} from './lib/transactions/http';
import * as detail from './app/api/transactions/[id]/vendor-details/[detailId]/route';
import * as history from './app/api/transactions/[id]/vendor-details/route';
import * as upload from './app/api/transactions/[id]/vendor-details/[detailId]/attachments/route';
import * as attachment from './app/api/transactions/[id]/vendor-attachments/[attachmentId]/route';
(async()=>{
const id='22222222-2222-4222-8222-222222222222',detailId='33333333-3333-4333-8333-333333333333',attachmentId='44444444-4444-4444-8444-444444444444',revision='2026-11-04T15:00:00Z',url='https://synthetic.invalid/api/transactions',context={params:Promise.resolve({id,detailId,attachmentId})};
const s=globalThis.vendorDetailHttp={auth:true,source:'db',role:'agent',actors:0,providers:0,calls:[],answers:{},detail:{id:detailId,transactionId:id,isCurrent:true,canEdit:true,details:{notes:''},attachments:[]},history:{items:[],total:0,limit:100}};
let checks=0;function check(v,label){assert.ok(v,label);checks++};const reset=()=>{s.calls=[];s.providers=0;s.actors=0};const privateResponse=r=>r.headers.get('Cache-Control')==='private, no-store';
const json=(value={},method='PATCH')=>new Request(url,{method,body:typeof value==='string'?value:JSON.stringify(value)});
function form(bytes=new TextEncoder().encode('%PDF-1.7 fixture %%EOF'),mutate){const body=new FormData();body.set('file',new Blob([bytes],{type:'image/svg+xml'}),'Private entered name.pdf');body.set('requestId',id);body.set('expectedUpdatedAt',revision);body.set('expectedDetailUpdatedAt',revision);body.set('kind','pre_approval');mutate?.(body);return new Request(url,{method:'POST',body})};
const parsed=await readVendorAttachmentForm(form());check(parsed.ok&&parsed.input.kind==='pre_approval'&&parsed.input.expectedDetailUpdatedAt===revision&&parsed.file.bytes.length>0,'realmultipartcaptureskindandchildrevision');
for(const mutate of [f=>f.append('kind','report'),f=>f.set('storagePath','private/forged'),f=>f.delete('file'),f=>f.set('file','fake'),f=>f.set('kind','secret'),f=>f.set('vendorId',id)])check(!(await readVendorAttachmentForm(form(undefined,mutate))).ok,'duplicateunexpectedorforgedfieldsrefused');
check(!(await readVendorAttachmentForm(json({},'POST'))).ok,'JSONcannotpretendtobefile');
const huge=await readVendorAttachmentForm(form(new Uint8Array(MAX_TRANSACTION_ATTACHMENT_BYTES+1)));check(!huge.ok&&huge.reason==='file_too_large','4MiBboundregardlessMIME');
const lies=new Request(url,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=fake','content-length':'1'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_TRANSACTION_ATTACHMENT_BYTES+32769));c.close()}}),duplex:'half'});const lied=await readVendorAttachmentForm(lies);check(!lied.ok&&lied.reason==='file_too_large','actualstreamboundignorescontentlengthlie');
s.auth=false;for(const fn of [detail.GET,detail.PATCH,upload.POST,attachment.GET,attachment.DELETE,history.GET]){reset();const result=await fn(new Request(url),context);check(result.status===401&&privateResponse(result)&&s.actors===0&&s.providers===0&&s.calls.length===0,'authfirstforallroutes')};s.auth=true;
s.source='sample';reset();const sample=await attachment.GET(new Request(url),context);check(sample.status===404&&s.actors===0&&s.providers===0,'nosamplestoragefallback');s.source='db';
reset();const invalid=await upload.POST(form(),{params:Promise.resolve({id,detailId:'invalid'})});check(invalid.status===404&&s.actors===0&&s.providers===0,'invalidIDprecedesactorprovider');
s.role='member';for(const fn of [detail.PATCH,upload.POST,attachment.DELETE]){reset();const result=await fn(json({},'POST'),context);check(result.status===403&&privateResponse(result)&&s.providers===0&&s.calls.length===0,'memberwriteblockedbeforeservices')};
reset();const member=await detail.GET(new Request(url),context);check(member.status===200&&privateResponse(member)&&s.calls[0].name==='get','memberreadreachesauthorizedservice');
reset();const bytes=await attachment.GET(new Request(url),context);check(bytes.status===200&&privateResponse(bytes)&&bytes.headers.get('Content-Disposition').startsWith('attachment;')&&bytes.headers.get('X-Content-Type-Options')==='nosniff'&&bytes.headers.get('Content-Type')==='application/pdf'&&(await bytes.text()).startsWith('%PDF'),'downloadbytesnotproviderURL');s.role='agent';
reset();const patch={requestId:id,expectedUpdatedAt:revision,expectedDetailUpdatedAt:revision,details:{notes:'private'}};const edited=await detail.PATCH(json(patch),context);check(edited.status===200&&privateResponse(edited)&&JSON.stringify(await edited.json())===JSON.stringify(s.detail)&&s.calls[0].name==='edit'&&s.calls[0].args[2]===detailId&&s.calls[0].args[3].details.notes==='private'&&s.providers===0,'PATCHbareDTOwithpathidentity');
reset();const uploaded=await upload.POST(form(),context);check(uploaded.status===200&&privateResponse(uploaded)&&s.providers===1&&s.calls[0].name==='upload'&&s.calls[0].args[2]===detailId&&s.calls[0].args[3].kind==='pre_approval'&&s.calls[0].args[4].bytes.length>0,'multipartuploadusespathidentityandkind');
reset();const removed=await attachment.DELETE(json({requestId:id,expectedUpdatedAt:revision,expectedDetailUpdatedAt:revision,expectedAttachmentUpdatedAt:revision,detailId},'DELETE'),context);check(removed.status===200&&s.providers===0&&s.calls[0].name==='remove'&&s.calls[0].args[2]===attachmentId,'softremovalnoexternaldelete');
reset();const listed=await history.GET(new Request(url+'?role=mortgage'),context);check(listed.status===200&&privateResponse(listed)&&s.calls[0].args[2].role==='mortgage'&&(await listed.json()).limit===100,'boundedhistorycontrolledrole');
for(const suffix of ['?role=unknown','?role=mortgage&role=title','?notes=Private']){reset();const result=await history.GET(new Request(url+suffix),context);check(result.status===400&&s.providers===0&&s.calls.length===0,'historyrejectsprivateorunknownqueries')};
for(const fn of [detail.GET,detail.PATCH,attachment.GET,attachment.DELETE,upload.POST]){reset();const result=await fn(new Request(url+'?filename=Private'),context);check(result.status===400&&s.providers===0&&s.calls.length===0,'privatefieldsneverroutequerypayload')};
reset();const bad=await upload.POST(json({},'POST'),context);check(bad.status===400&&s.providers===0&&s.calls.length===0,'invalidmultipartdoesnotconstructprovider');
s.answers.edit={ok:false,reason:'vendor_detail_not_current'};const historic=await detail.PATCH(json(patch),context);check(historic.status===409&&JSON.stringify(await historic.json())===JSON.stringify({error:'vendor_detail_not_current'}),'historicalrefusalcontrolled');delete s.answers.edit;
for(const [code,status] of [['invalid_vendor_details',400],['vendor_detail_not_current',409],['invalid_attachment',400],['file_too_large',413],['attachment_limit',409],['attachment_not_configured',503],['attachment_unavailable',503]]){const response=failure(code);check(response.status===status&&privateResponse(response)&&JSON.stringify(await response.json())===JSON.stringify({error:code}),'controllederrorsomitprivatetext')};
s.throwService=true;const failed=await detail.PATCH(json(patch),context);check(failed.status===503&&privateResponse(failed)&&!(await failed.text()).includes('Private'),'unexpectederrorscontentfree');
console.log(checks+'/'+checks+' transaction vendor detail HTTP checks passed (actual routes/multipart, synthetic services; no network)');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
try{
 const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'vendor-detail-http-boundaries',setup(builder){
  builder.onResolve({filter:/^\.\/service\.ts$/},args=>args.importer.endsWith('/lib/transactions/http.ts')?{path:'transactions/service',namespace:'synthetic-vendor-detail'}:undefined);
  builder.onResolve({filter:/(?:^next\/server$|auth\/require-caller(?:\.ts)?$|(?:^|\/)flags(?:\.ts)?$|transactions\/service(?:\.ts)?$|transactions\/vendor-detail-service(?:\.ts)?$|transactions\/transaction-file-storage(?:\.ts)?$)/},args=>{const key=[...fixtures.keys()].find(name=>args.path.replace(/\.ts$/,'').endsWith(name));return key?{path:key,namespace:'synthetic-vendor-detail'}:undefined});
  builder.onLoad({filter:/.*/,namespace:'synthetic-vendor-detail'},args=>({contents:fixtures.get(args.path),loader:'ts'}));builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty-server'}));builder.onLoad({filter:/.*/,namespace:'empty-server'},()=>({contents:'',loader:'js'}));
 }}]});
 const output=join(folder,'vendor-detail-http.cjs');writeFileSync(output,result.outputFiles[0].contents);const run=spawnSync(process.execPath,[output],{encoding:'utf8',timeout:30000});process.stdout.write(run.stdout);process.stderr.write(run.stderr);if(run.status!==0)throw Error('Vendor detail HTTP checks failed');
}finally{rmSync(folder,{recursive:true,force:true})}
