/** Actual property HTTP routes, synthetic auth/service/provider boundaries only. */
import { build } from 'esbuild';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),folder=mkdtempSync(join(tmpdir(),'transaction-property-http-'));
const fixtures=new Map([
 ['next/server',`export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`],
 ['auth/require-caller',`export async function requireCaller(){return globalThis.propertyHttp.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`],
 ['flags',`export const transactionsDatabaseEnabled=()=>globalThis.propertyHttp.source==='db';`],
 ['transactions/service',`export async function resolveActor(){const s=globalThis.propertyHttp;s.actors++;return {ok:true,value:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}}}`],
 ['transactions/property-mls',`export function createTransactionPropertyMlsProvider(){globalThis.propertyHttp.providers++;return {synthetic:true}}`],
 ['transactions/property-service',`async function run(name,args){const s=globalThis.propertyHttp;s.calls.push({name,args});if(s.throwService)throw Error('Private feed/token');if(s.answers[name])return s.answers[name];return {ok:true,value:name==='get'?s.property:name==='lookup'?s.lookup:s.workspace}};export const getTransactionProperty=(...a)=>run('get',a),lookupTransactionProperty=(...a)=>run('lookup',a),mutateTransactionProperty=(...a)=>run('mutate',a)`],
]);
const entry=String.raw`
import assert from 'node:assert/strict';
import * as property from './app/api/transactions/[id]/property/route';
import * as lookup from './app/api/transactions/[id]/property/lookup/route';
import {failure} from './lib/transactions/http';
(async()=>{
const id='22222222-2222-4222-8222-222222222222',url='https://synthetic.invalid/api/transactions',context={params:Promise.resolve({id})},revision='2026-11-05T15:00:00Z';
const s=globalThis.propertyHttp={auth:true,source:'db',role:'agent',actors:0,providers:0,calls:[],answers:{},property:{transactionId:id,reference:null,listing:null,syncStatus:'unlinked'},lookup:{transactionId:id,expectedUpdatedAt:revision,reference:{dataset:'miamire',listingId:'key',mlsNumber:'A00123'},importFingerprint:'a'.repeat(64)},workspace:{transaction:{id},details:{contractPriceCents:74000000}}};
let checks=0;function check(v,name){assert.ok(v,name);checks++};const reset=()=>{s.actors=0;s.providers=0;s.calls=[]};const privateResponse=r=>r.headers.get('Cache-Control')==='private, no-store';const json=(body={},method='PATCH',suffix='')=>new Request(url+suffix,{method,body:typeof body==='string'?body:JSON.stringify(body)});
s.auth=false;for(const fn of [property.GET,property.PATCH,lookup.POST]){reset();const response=await fn(new Request(url),context);check(response.status===401&&privateResponse(response)&&s.actors===0&&s.providers===0&&s.calls.length===0,'authenticationprecedesMLSconstructor')};s.auth=true;
s.source='sample';reset();const sample=await property.GET(new Request(url),context);check(sample.status===404&&s.actors===0&&s.providers===0,'samplecannotcallrealMLS');s.source='db';
reset();const invalid=await lookup.POST(json({},'POST'),{params:Promise.resolve({id:'sample-untrusted'})});check(invalid.status===404&&s.actors===0&&s.providers===0,'invalidUUIDprecedesactorprovider');
for(const fn of [property.GET,property.PATCH,lookup.POST]){reset();const response=await fn(new Request(url+'?address=Private'),context);check(response.status===400&&s.actors===0&&s.providers===0&&s.calls.length===0,'querypayloadneveraccepted')};
s.role='member';for(const fn of [property.PATCH,lookup.POST]){reset();const response=await fn(json({},'POST'),context);check(response.status===403&&privateResponse(response)&&s.providers===0&&s.calls.length===0,'membercannotmutateorlookuplink')};
reset();const memberRead=await property.GET(new Request(url),context);check(memberRead.status===200&&privateResponse(memberRead)&&s.calls[0].name==='get'&&s.providers===1,'memberfreshreaddelegatesscopedservice');s.role='agent';
reset();const found=await lookup.POST(json({mlsNumber:'A00123'},'POST'),context);check(found.status===200&&privateResponse(found)&&JSON.stringify(await found.json())===JSON.stringify(s.lookup)&&s.calls[0].args[1]===id&&s.calls[0].args[2].mlsNumber==='A00123','lookupreturnsreviewreferencefingerprintandrevision');
reset();const mutation={requestId:id,expectedUpdatedAt:revision,action:'link',mlsNumber:'A00123',expectedDataset:'miamire',expectedListingId:'key',expectedImportFingerprint:'a'.repeat(64),importAddress:true,importListPrice:false};const linked=await property.PATCH(json(mutation),context);check(linked.status===200&&privateResponse(linked)&&JSON.stringify(await linked.json())===JSON.stringify(s.workspace)&&s.calls[0].name==='mutate'&&s.calls[0].args[2].importListPrice===false,'mutationreturnsbareworkspaceandpreservesreviewchoices');
reset();const read=await property.GET(new Request(url),context);check(read.status===200&&privateResponse(read)&&JSON.stringify(await read.json())===JSON.stringify(s.property),'GETreturnsbarefreshprojection');
for(const fn of [property.PATCH,lookup.POST]){reset();const response=await fn(json('invalid JSON','POST'),context);check(response.status===400&&s.providers===0&&s.calls.length===0,'badJSONcannotconstructprovider')};
reset();const oversized=await property.PATCH(json({notes:'x'.repeat(65537)}),context);check(oversized.status===400&&s.providers===0&&s.calls.length===0,'actualUTF8bodybounded');
for(const [code,status] of [['invalid_property',400],['property_changed',409],['property_linked',409],['property_import_unavailable',409],['property_ambiguous',409],['property_not_found',404],['property_not_configured',503],['property_unavailable',503]]){const response=failure(code);check(response.status===status&&privateResponse(response)&&JSON.stringify(await response.json())===JSON.stringify({error:code}),'coarsecontrolledfailuredoesnotechoproviderdata')};
s.answers.get={ok:false,reason:'not_found'};const denied=await property.GET(new Request(url),context);check(denied.status===404&&!(await denied.text()).includes('dataset'),'scopefailuregeneric');delete s.answers.get;
s.throwService=true;const failed=await property.PATCH(json(mutation),context);check(failed.status===503&&privateResponse(failed)&&!(await failed.text()).includes('Private'),'unexpectedfailurecontentfree');
console.log(checks+'/'+checks+' transaction property HTTP checks passed (actual routes, injected services; no network)');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
try{
 const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'property-http-boundaries',setup(builder){
  builder.onResolve({filter:/^\.\/service\.ts$/},args=>args.importer.endsWith('/lib/transactions/http.ts')?{path:'transactions/service',namespace:'synthetic-property'}:undefined);
  builder.onResolve({filter:/(?:^next\/server$|auth\/require-caller(?:\.ts)?$|(?:^|\/)flags(?:\.ts)?$|transactions\/(?:service|property-service|property-mls)(?:\.ts)?$)/},args=>{const key=[...fixtures.keys()].find(name=>args.path.replace(/\.ts$/,'').endsWith(name));return key?{path:key,namespace:'synthetic-property'}:undefined});builder.onLoad({filter:/.*/,namespace:'synthetic-property'},args=>({contents:fixtures.get(args.path),loader:'ts'}));builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty-server'}));builder.onLoad({filter:/.*/,namespace:'empty-server'},()=>({contents:'',loader:'js'}));
 }}]});const output=join(folder,'http.cjs');writeFileSync(output,result.outputFiles[0].contents);const run=spawnSync(process.execPath,[output],{encoding:'utf8',timeout:30000});process.stdout.write(run.stdout);process.stderr.write(run.stderr);if(run.status!==0)throw Error('Property HTTP checks failed');
}finally{rmSync(folder,{recursive:true,force:true})}
