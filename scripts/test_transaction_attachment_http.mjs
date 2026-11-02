/** Actual multipart/download/policy routes, isolated auth/service/provider fixtures. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root=fileURLToPath(new URL('../',import.meta.url)),folder=mkdtempSync(join(tmpdir(),'fortmark-attachment-http-'));
const fixtures=new Map([
 ['next/server',`export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`],
 ['auth/require-caller',`export async function requireCaller(){const s=globalThis.attachmentHttp;return s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`],
 ['flags',`export const transactionsDatabaseEnabled=()=>globalThis.attachmentHttp.source==='db';`],
 ['transactions/service',`export async function resolveActor(){const s=globalThis.attachmentHttp;s.actors++;return {ok:true,value:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}}};`],
 ['transactions/transaction-file-storage',`export function createTransactionFileStorage(){globalThis.attachmentHttp.providers++;return {enabled:true}}`],
 ['transactions/attachment-service',`async function run(name,args){const s=globalThis.attachmentHttp;s.calls.push({name,args});if(s.throwService)throw Error('Private filename/blobtoken');if(s.answers[name])return s.answers[name];if(name==='download'){const bytes=new TextEncoder().encode('%PDF-1.7 synthetic');return {ok:true,value:{filename:'Private contract.pdf',contentType:'application/pdf',sizeBytes:bytes.length,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close()}})}}}return {ok:true,value:name==='defaults'||name==='defaultEdit'?s.defaults:s.workspace}};export const uploadTransactionChecklistAttachment=(...a)=>run('upload',a),getTransactionChecklistAttachment=(...a)=>run('download',a),removeTransactionChecklistAttachment=(...a)=>run('remove',a),setTransactionAttachmentRequirement=(...a)=>run('requirement',a),getChecklistAttachmentDefaults=(...a)=>run('defaults',a),updateChecklistAttachmentDefault=(...a)=>run('defaultEdit',a);`],
]);
const entry=String.raw`
import assert from 'node:assert/strict';
import {readTransactionAttachmentForm,transactionAttachmentDownloadHeaders} from './lib/transactions/attachment-http';
import {MAX_TRANSACTION_ATTACHMENT_BYTES} from './lib/transactions/attachment-format';
import {failure} from './lib/transactions/http';
import * as upload from './app/api/transactions/[id]/checklist/[itemId]/attachments/route';
import * as attachment from './app/api/transactions/[id]/attachments/[attachmentId]/route';
import * as requirements from './app/api/transactions/[id]/checklist/requirements/route';
import * as defaults from './app/api/transactions/setup/checklist/route';
(async()=>{
const id='22222222-2222-4222-8222-222222222222',itemId='33333333-3333-4333-8333-333333333333',attachmentId='44444444-4444-4444-8444-444444444444',revision='2026-11-03T15:00:00Z',url='https://synthetic.invalid/api/transactions',context={params:Promise.resolve({id,itemId,attachmentId})};
const s=globalThis.attachmentHttp={auth:true,source:'db',role:'agent',actors:0,providers:0,calls:[],answers:{},workspace:{transaction:{id},checklist:{items:[]},attachmentUploadsEnabled:true},defaults:{items:[],canManage:false}};
let checks=0;function check(v,label){assert.ok(v,label);checks++};const reset=()=>{s.calls=[];s.providers=0;s.actors=0};const privateResponse=r=>r.headers.get('Cache-Control')==='private, no-store';
const json=(value={},method='DELETE',suffix='')=>new Request(url+suffix,{method,body:typeof value==='string'?value:JSON.stringify(value)});
function form(bytes=new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF'),mutate){const body=new FormData();body.set('file',new Blob([bytes],{type:'image/svg+xml'}),'Private entered name.pdf');body.set('requestId',id);body.set('expectedUpdatedAt',revision);body.set('expectedItemUpdatedAt',revision);mutate?.(body);return new Request(url,{method:'POST',body})};
const parsed=await readTransactionAttachmentForm(form(),itemId);check(parsed.ok&&parsed.input.itemId===itemId&&parsed.input.requestId===id&&parsed.file.bytes.length>0,'boundedactualmultipartfieldsandbytesparsed');
for(const mutate of [f=>f.append('requestId',id),f=>f.set('storagePath','private/forged'),f=>f.delete('file'),f=>f.set('file','fake')])check(!(await readTransactionAttachmentForm(form(undefined,mutate),itemId)).ok,'duplicateunexpectedormissingmultipartfieldsrejected');
check(!(await readTransactionAttachmentForm(json({},'POST'),itemId)).ok,'JSONcannotpretendtobemultipart');
const huge=await readTransactionAttachmentForm(form(new Uint8Array(MAX_TRANSACTION_ATTACHMENT_BYTES+1)),itemId);check(!huge.ok&&huge.reason==='file_too_large','actualFilebytesbound4MiBregardlessMIME');
const lies=new Request(url,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=fake','content-length':'1'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_TRANSACTION_ATTACHMENT_BYTES+32769));c.close()}}),duplex:'half'});const lied=await readTransactionAttachmentForm(lies,itemId);check(!lied.ok&&lied.reason==='file_too_large','actualbodyboundcannotbypasswithcontentlength');
const headers=transactionAttachmentDownloadHeaders('name"\r\nInjected: bad.pdf','application/pdf',10);check(headers['X-Content-Type-Options']==='nosniff'&&headers['Content-Disposition'].startsWith('attachment;')&&!headers['Content-Disposition'].includes('\r')&&!headers['Content-Disposition'].includes('\n')&&headers['Cache-Control']==='private, no-store','downloadheadersforceattachmentandpreventinjection');
s.auth=false;const unauth=await upload.POST(form(),context);check(unauth.status===401&&privateResponse(unauth)&&s.actors===0&&s.providers===0&&s.calls.length===0,'authenticationprecedesproviderandservice');s.auth=true;
s.source='sample';const sample=await attachment.GET(new Request(url),context);check(sample.status===404&&s.actors===0&&s.providers===0,'sampledownloadhasnorealstoragefallback');s.source='db';
const invalidId=await upload.POST(form(),{params:Promise.resolve({id,itemId:'invalid'})});check(invalidId.status===404&&s.actors===0&&s.providers===0,'malformeditemIDbeforeactorandprovider');
s.role='member';for(const fn of [upload.POST,attachment.DELETE,requirements.PATCH]){reset();const result=await fn(json({},'POST'),context);check(result.status===403&&privateResponse(result)&&s.providers===0&&s.calls.length===0,'memberwritesrefusedbeforeservice')};
reset();const memberRead=await attachment.GET(new Request(url),context);check(memberRead.status===200&&privateResponse(memberRead)&&memberRead.headers.get('X-Content-Type-Options')==='nosniff'&&memberRead.headers.get('Content-Type')==='application/pdf'&&memberRead.headers.get('Content-Disposition').startsWith('attachment;')&&(await memberRead.text()).startsWith('%PDF'),'authorizedmemberdownloadisbytesnotstorageURL');s.role='agent';
reset();const uploaded=await upload.POST(form(),context);check(uploaded.status===200&&privateResponse(uploaded)&&JSON.stringify(await uploaded.json())===JSON.stringify(s.workspace)&&s.providers===1&&s.calls[0].name==='upload'&&s.calls[0].args[3].itemId===itemId&&s.calls[0].args[4].bytes.length>0,'actualmultipartuploadreturnsbareworkspaceandserverpathidentity');
reset();const removed=await attachment.DELETE(json({requestId:id,expectedUpdatedAt:revision,itemId,expectedItemUpdatedAt:revision,expectedAttachmentUpdatedAt:revision}),context);check(removed.status===200&&s.providers===0&&s.calls[0].name==='remove','softremovalusesCASservicenoproviderdelete');
reset();const ordinaryDefaults=await defaults.GET(new Request(url));check(ordinaryDefaults.status===200&&privateResponse(ordinaryDefaults)&&!(await ordinaryDefaults.json()).canManage,'ordinaryusersmayreadglobaldefaults');
for(const fn of [requirements.PATCH,defaults.PATCH]){reset();const result=await fn(json({},'PATCH'),context);check(result.status===403&&s.calls.length===0&&s.providers===0,'onlyadminmayeditrequirements')};
s.role='admin';reset();const policy=await requirements.PATCH(json({requestId:id,expectedUpdatedAt:revision,itemId,expectedItemUpdatedAt:revision,attachmentRequired:true},'PATCH'),context);check(policy.status===200&&s.calls[0].name==='requirement'&&s.providers===0,'adminperfilepolicyusesguardedservice');
reset();const globalPolicy=await defaults.PATCH(json({requestId:id,templateKey:'opportunity.client',attachmentRequired:true,expectedUpdatedAt:null},'PATCH'));check(globalPolicy.status===200&&s.calls[0].name==='defaultEdit','globalpolicyhasseparateCASreceiptservice');
for(const fn of [attachment.GET,attachment.DELETE,requirements.PATCH]){reset();const req=new Request(url+'?filename=Private',{method:fn===attachment.GET?'GET':'DELETE',...(fn===attachment.GET?{}:{body:'{}'})});const result=await fn(req,context);check(result.status===400&&s.providers===0&&s.calls.length===0,'privatefieldscannotenterquerypayload')};
reset();const badMultipart=await upload.POST(json({},'POST'),context);check(badMultipart.status===400&&s.providers===0&&s.calls.length===0,'badmultipartcannotconstructprovider');
s.answers.download={ok:false,reason:'not_found'};const missing=await attachment.GET(new Request(url),context);check(missing.status===404&&privateResponse(missing)&&!(await missing.text()).includes('storagePath'),'outofscopedownloadisgeneric404');delete s.answers.download;
for(const [code,status] of [['invalid_attachment',400],['file_too_large',413],['attachment_required',409],['attachment_requires_reopen',409],['attachment_limit',409],['attachment_not_configured',503],['attachment_unavailable',503],['vendor_unavailable',409]]){const result=failure(code);check(result.status===status&&privateResponse(result)&&JSON.stringify(await result.json())===JSON.stringify({error:code}),'controlledrefusalneverechoesprivatevalues')};
s.throwService=true;const failed=await attachment.DELETE(json({}),context);check(failed.status===503&&privateResponse(failed)&&!(await failed.text()).includes('Private'),'unexpectederrorsomitfilenamesandtokens');
console.log(checks+'/'+checks+' transaction attachment HTTP checks passed (actual multipart and fake services; no network)');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
try{
 const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'attachment-http-boundaries',setup(builder){
  builder.onResolve({filter:/^\.\/service\.ts$/},args=>args.importer.endsWith('/lib/transactions/http.ts')?{path:'transactions/service',namespace:'synthetic-attachment'}:undefined);
  builder.onResolve({filter:/(?:^next\/server$|auth\/require-caller(?:\.ts)?$|(?:^|\/)flags(?:\.ts)?$|transactions\/service(?:\.ts)?$|transactions\/attachment-service(?:\.ts)?$|transactions\/transaction-file-storage(?:\.ts)?$)/},args=>{const key=[...fixtures.keys()].find(name=>args.path.replace(/\.ts$/,'').endsWith(name));return key?{path:key,namespace:'synthetic-attachment'}:undefined});
  builder.onLoad({filter:/.*/,namespace:'synthetic-attachment'},args=>({contents:fixtures.get(args.path),loader:'ts'}));builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty-server'}));builder.onLoad({filter:/.*/,namespace:'empty-server'},()=>({contents:'',loader:'js'}));
 }}]});
 const output=join(folder,'attachment-http.cjs');writeFileSync(output,result.outputFiles[0].contents);const run=spawnSync(process.execPath,[output],{encoding:'utf8',timeout:30000});process.stdout.write(run.stdout);process.stderr.write(run.stderr);if(run.status!==0)throw Error('Attachment HTTP checks failed');
}finally{rmSync(folder,{recursive:true,force:true})}
