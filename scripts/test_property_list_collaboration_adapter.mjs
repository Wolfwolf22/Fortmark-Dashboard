/** Actual browser adapters, synthetic transport only. */
import { build } from 'esbuild'; import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=mkdtempSync(join(tmpdir(),'fortmark-list-collaboration-adapter-'));
try {
const entry=String.raw`
import assert from 'node:assert/strict';
import {getPropertyLists,getPropertyListSharing,updatePropertyListSharing,getPropertyListShareCandidates,associatePropertyList,getPropertyListSummary} from './lib/data/adapters/leads';
import {useDataVersion} from './lib/data/store';
const scenario=process.argv[2],id='list/id?value# space',stamp='2026-11-06T15:00:00Z',base='/dashboard/api/property-lists',detail=base+'/'+encodeURIComponent(id),calls=[];let lose=false,checks=0;
const list={id,name:'Canonical research',contactId:null,propertyCount:0,createdAt:stamp,updatedAt:stamp},sharing={listId:id,updatedAt:stamp,users:[{id:'recipient',name:'Chosen viewer',role:'agent'}]},summary={total:0,inspected:0,pins:[]},json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(url,init={})=>{const path=String(url),method=init.method||'GET';calls.push({path,method,body:init.body});if(path==='/dashboard/api/contacts/source')return json({source:scenario==='sample'?'sample':'db'});assert.ok(path.startsWith(base),'All paths retain the dashboard API basePath');if(path===detail+'/sharing'){if(method==='PUT'&&lose){lose=false;throw TypeError('Synthetic lost acknowledgement');}return json(sharing);}if(path.startsWith(base+'/share-candidates?'))return json({items:sharing.users,page:2,hasMore:false});if(path===detail+'/association')return json({list});if(path===detail+'/summary')return json(summary);if(path.startsWith(base+'?'))return json({items:[list],total:1,page:1,pageSize:12});throw Error('Unexpected endpoint');};
function check(name,value){assert.ok(value,name);checks++;console.log('PASS '+name);}
async function run(){
if(scenario==='sample'){
 for(const run of[()=>getPropertyListSharing(id),()=>updatePropertyListSharing(id,{expectedUpdatedAt:stamp,userIds:['recipient']}),()=>getPropertyListShareCandidates(),()=>associatePropertyList(id,{expectedUpdatedAt:stamp,contactId:null}),()=>getPropertyListSummary(id)]){await assert.rejects(run,error=>error.status===403&&error.code==='sample_read_only');checks++;}
 check('sample mode never reaches new persistent list endpoints',calls.every(call=>call.path==='/dashboard/api/contacts/source'));
}else{
 await getPropertyLists({scope:'owned',page:2});const index=calls.at(-1);check('My Lists selector uses an explicit server ownership scope',new URL(index.path,'https://synthetic.invalid').searchParams.get('scope')==='owned'&&new URL(index.path,'https://synthetic.invalid').searchParams.get('page')==='2');
 const read=await getPropertyListSharing(id);check('sharing read uses the encoded canonical list ID',read.listId===id&&calls.at(-1).path===detail+'/sharing'&&calls.at(-1).method==='GET');
 await getPropertyListShareCandidates(2);check('team chooser is paginated without contact or name text in URLs',calls.at(-1).path===base+'/share-candidates?page=2');
 const input=Object.freeze({expectedUpdatedAt:stamp,userIds:Object.freeze(['recipient'])}),version=useDataVersion.getState().version;await updatePropertyListSharing(id,input);check('explicit sharing sends only chosen recipients and frozen revision by PUT',calls.at(-1).method==='PUT'&&calls.at(-1).body===JSON.stringify(input)&&useDataVersion.getState().version>version);
 const association=Object.freeze({expectedUpdatedAt:stamp,contactId:null});await associatePropertyList(id,association);check('making a list personal PATCHes its association without creating another list',calls.at(-1).path===detail+'/association'&&calls.at(-1).method==='PATCH'&&calls.at(-1).body===JSON.stringify(association));
 check('summary comes from the scoped production API with no external map call',(await getPropertyListSummary(id)).total===0&&calls.at(-1).path===detail+'/summary');
 lose=true;const before=calls.length;await assert.rejects(updatePropertyListSharing(id,input),TypeError);check('unknown sharing response never automatically repeats a write',calls.length===before+1);await updatePropertyListSharing(id,input);check('explicit same-result check preserves the exact reviewed payload',calls.at(-1).body===calls.at(-2).body&&calls.at(-1).method==='PUT');
 check('new APIs never put client text, notes or viewer names in request URLs',calls.every(call=>!call.path.includes('Chosen')&&!call.path.includes('Canonical')));
}
console.log(checks+'/'+checks+' collaboration adapter checks passed ('+scenario+')');}
run().catch(error=>{console.error(error);process.exitCode=1;});`;
const output=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',write:false}),path=join(temp,'adapter.cjs');writeFileSync(path,output.outputFiles[0].contents);for(const scenario of ['db','sample']){const result=spawnSync(process.execPath,[path,scenario],{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Collaboration adapter check failed');}
} finally {rmSync(temp,{recursive:true,force:true});}
