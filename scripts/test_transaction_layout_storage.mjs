/** Actual transaction/Home stores and PersonalStorage against a synthetic owner-scoped CAS transport. */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "fortmark-transaction-layout-"));
const entry = String.raw`
import assert from 'node:assert/strict';
import {PersonalStorage,activatePersonalStorage,getPersonalStorage} from './lib/workspaces/personal-storage';
import {connectTransactionLayoutStorage,useTransactionLayoutStore} from './lib/stores/transaction-layout';
import {connectLayoutStorage,useLayoutStore,DEFAULT_WIDGET_ORDER} from './lib/stores/layout';
import {defaultTransactionLayout,normalizeTransactionLayout,moveVisibleSection} from './lib/transactions/layout-domain';
import {workspaceWriteSchema} from './lib/workspaces/contract';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const defaults=defaultTransactionLayout(),estate=[...defaults.realEstate].reverse(),gc=[...defaults.gc].reverse();
let passed=0,storages=[];
const state=()=>useTransactionLayoutStore.getState();
function backend(){
  const rows=new Map(),writes=[],reads=[];
  const key=(owner,namespace)=>owner+':'+namespace;
  return {rows,writes,reads,key,
    seed(owner,namespace,data,revision=1){rows.set(key(owner,namespace),{data:structuredClone(data),revision});},
    transport(owner){return async(url,options={})=>{
      if(options.method!=='PUT'){
        const namespace=new URL(String(url),'https://synthetic.invalid').searchParams.get('namespace');reads.push({owner,namespace});
        return Response.json({...rows.get(key(owner,namespace))??{data:{},revision:0},userId:owner});
      }
      const body=JSON.parse(options.body);writes.push(structuredClone(body));
      if(body.accountId!==owner)return Response.json({error:'Account changed'},{status:409});
      if(!workspaceWriteSchema.safeParse(body).success)return Response.json({error:'Invalid setting'},{status:400});
      const row=rows.get(key(owner,body.namespace));
      if((row?.revision??0)!==body.revision)return Response.json({error:'Changed workspace'},{status:409});
      const revision=body.revision+1;rows.set(key(owner,body.namespace),{data:structuredClone(body.data),revision});
      return Response.json({userId:owner,revision});
    };},
  };
}
function storage(server,owner=A,namespace='transaction-layout',transport){
  const instance=new PersonalStorage(owner,namespace,namespace==='dashboard-layout'?['layout','notifications']:['layout'],'https://synthetic.invalid/api/personal-workspace',transport??server.transport(owner));
  storages.push(instance);return instance;
}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
async function check(name,work){
  try{await work();passed++;console.log('PASS '+name);}
  finally{connectTransactionLayoutStorage(null);connectLayoutStorage(null);activatePersonalStorage(null);for(const instance of storages)instance.dispose();storages=[];}
}
(async()=>{
await check('loading and disconnected stores refuse writes; forged section IDs never reach storage',async()=>{
  const server=backend(),instance=storage(server);connectTransactionLayoutStorage(instance);
  state().setOrder('realEstate',estate);assert.equal(instance.dirty,false);assert.deepEqual(state().layout,defaults);assert.equal(state().status.phase,'loading');
  await instance.load();assert.equal(state().status.phase,'ready');
  state().setOrder('realEstate',['forged']);state().setOrder('gc',['vendors']);state().setOrder('realEstate',['vendors','vendors']);
  assert.equal(instance.dirty,false);assert.deepEqual(state().layout,defaults);assert.equal(server.writes.length,0);
  connectTransactionLayoutStorage(null);state().setOrder('realEstate',estate);assert.deepEqual(state().layout,defaults);
});
await check('both profile changes save once and a fresh instance restores the complete account order',async()=>{
  const server=backend(),instance=storage(server);connectTransactionLayoutStorage(instance);await instance.load();
  state().setOrder('realEstate',estate);assert.equal(state().status.phase,'saving');state().setOrder('gc',gc);await instance.flush();
  assert.equal(state().status.phase,'ready');assert.equal(instance.dirty,false);assert.equal(server.writes.length,1);
  assert.deepEqual(JSON.parse(server.rows.get(server.key(A,'transaction-layout')).data.layout),{version:1,realEstate:estate,gc});
  const reloaded=storage(server);connectTransactionLayoutStorage(reloaded);await reloaded.load();assert.deepEqual(state().layout,{version:1,realEstate:estate,gc});
  assert.equal(server.reads.at(-1).namespace,'transaction-layout');
});
await check('an older partial layout gains new/hidden defaults without an unsolicited write',async()=>{
  const server=backend(),old={version:1,realEstate:['vendors','listing-term'],gc:['gc-checklist']};server.seed(A,'transaction-layout',{layout:JSON.stringify(old)});
  const instance=storage(server);connectTransactionLayoutStorage(instance);await instance.load();assert.deepEqual(state().layout,normalizeTransactionLayout(old));assert.equal(instance.dirty,false);assert.equal(server.writes.length,0);
  const order=state().layout.realEstate,visible=order.filter(id=>!['listing-term','open-houses','reopen-review'].includes(id));
  state().setOrder('realEstate',moveVisibleSection(order,visible,'file-history','vendors'));await instance.flush();
  const saved=JSON.parse(server.rows.get(server.key(A,'transaction-layout')).data.layout);
  for(const hidden of ['listing-term','open-houses','reopen-review'])assert.equal(saved.realEstate.indexOf(hidden),order.indexOf(hidden));
  assert.equal(new Set(saved.realEstate).size,defaults.realEstate.length);
});
await check('corrupt persisted layout values fall back to defaults without trusting private or forged content',async()=>{
  const server=backend();server.seed(A,'transaction-layout',{layout:JSON.stringify({...defaults,realEstate:['private-transaction-id']})});
  const instance=storage(server);connectTransactionLayoutStorage(instance);await instance.load();assert.deepEqual(state().layout,defaults);assert.equal(instance.dirty,false);
});
await check('Home and transaction orders, notifications, resets and revision streams stay independent',async()=>{
  const server=backend(),notifications={dealMilestones:true,documentStatus:false,newLeads:true,marketDigest:false,weeklySummary:true};
  server.seed(A,'dashboard-layout',{layout:JSON.stringify({widgetOrder:DEFAULT_WIDGET_ORDER,widgetPeriods:{}}),notifications:JSON.stringify(notifications)});
  const home=storage(server,A,'dashboard-layout'),transaction=storage(server);await Promise.all([home.load(),transaction.load()]);
  activatePersonalStorage(home);connectLayoutStorage(home);connectTransactionLayoutStorage(transaction);
  useLayoutStore.getState().setWidgetOrder([...DEFAULT_WIDGET_ORDER].reverse());useLayoutStore.getState().setWidgetPeriod(DEFAULT_WIDGET_ORDER[0],'week');
  state().setOrder('realEstate',estate);state().setOrder('gc',gc);await Promise.all([home.flush(),transaction.flush()]);
  assert.equal(getPersonalStorage(),home);assert.equal(server.rows.size,2);assert.equal(server.rows.get(server.key(A,'dashboard-layout')).data.notifications,JSON.stringify(notifications));
  const transactionBefore=structuredClone(state().layout);useLayoutStore.getState().resetLayout();await home.flush();assert.deepEqual(state().layout,transactionBefore);
  const homeBefore=structuredClone(server.rows.get(server.key(A,'dashboard-layout')));state().reset('realEstate');await transaction.flush();
  assert.deepEqual(state().layout.realEstate,defaults.realEstate);assert.deepEqual(state().layout.gc,gc);assert.deepEqual(server.rows.get(server.key(A,'dashboard-layout')),homeBefore);
});
await check('stale tab CAS preserves the draft, blocks new edits/retry writes and reloads the winning layout',async()=>{
  const server=backend(),winner=storage(server),stale=storage(server);await Promise.all([winner.load(),stale.load()]);
  connectTransactionLayoutStorage(winner);state().setOrder('realEstate',estate);await winner.flush();
  connectTransactionLayoutStorage(stale);state().setOrder('gc',gc);await stale.flush();assert.equal(state().status.phase,'conflict');assert.equal(stale.dirty,true);
  const draft=structuredClone(state().layout),calls=server.writes.length;state().reset('gc');await state().retry();
  assert.deepEqual(state().layout,draft);assert.equal(server.writes.length,calls);assert.deepEqual(JSON.parse(server.rows.get(server.key(A,'transaction-layout')).data.layout).realEstate,estate);
  const reloaded=storage(server);connectTransactionLayoutStorage(reloaded);await reloaded.load();
  assert.equal(state().status.phase,'ready');assert.equal(reloaded.dirty,false);assert.deepEqual(state().layout.realEstate,estate);assert.deepEqual(state().layout.gc,defaults.gc);
});
await check('failed save keeps dirty layout and blocks new changes until explicit retry succeeds',async()=>{
  const server=backend(),normal=server.transport(A);let fail=true;
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{if(options?.method==='PUT'&&fail){fail=false;return Response.json({error:'Unavailable'},{status:503});}return normal(url,options);});
  connectTransactionLayoutStorage(instance);await instance.load();state().setOrder('realEstate',estate);await instance.flush();
  assert.equal(state().status.phase,'error');assert.equal(instance.dirty,true);assert.deepEqual(state().layout.realEstate,estate);
  state().setOrder('gc',gc);assert.deepEqual(state().layout.gc,defaults.gc);await state().retry();assert.equal(state().status.phase,'ready');assert.equal(instance.dirty,false);
  assert.deepEqual(JSON.parse(server.rows.get(server.key(A,'transaction-layout')).data.layout).realEstate,estate);
});
await check('failed initial load is read-only and retry loads the saved account definition',async()=>{
  const server=backend(),normal=server.transport(A);server.seed(A,'transaction-layout',{layout:JSON.stringify({...defaults,realEstate:estate})});let fail=true;
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{if(fail){fail=false;throw Error('Synthetic transport offline');}return normal(url,options);});
  connectTransactionLayoutStorage(instance);await instance.load();assert.equal(state().status.phase,'error');state().setOrder('gc',gc);assert.equal(instance.dirty,false);
  await state().retry();assert.equal(state().status.phase,'ready');assert.deepEqual(state().layout.realEstate,estate);assert.equal(server.writes.length,0);
});
await check('retry during an unfinished initial load cannot erase a later user reorder',async()=>{
  const server=backend(),normal=server.transport(A),wait=deferred();let reads=0;
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{
    if(options?.method!=='PUT'&&++reads===1){await wait.promise;return Response.json({userId:A,revision:0,data:{}});}
    return normal(url,options);
  });
  connectTransactionLayoutStorage(instance);const loading=instance.load();await state().retry();
  if(state().status.phase==='ready'){
    state().setOrder('realEstate',estate);assert.equal(instance.dirty,true);wait.resolve();await loading;
    assert.deepEqual(state().layout.realEstate,estate,'an older load erased the newer unsaved order');assert.equal(instance.dirty,true);
  }else{
    assert.equal(state().status.phase,'loading');wait.resolve();await loading;assert.equal(state().status.phase,'ready');
    state().setOrder('realEstate',estate);assert.deepEqual(state().layout.realEstate,estate);assert.equal(instance.dirty,true);
  }
});
await check('direct concurrent loads keep the newest response and ignore an older response after user edits',async()=>{
  const server=backend(),normal=server.transport(A),wait=deferred();let reads=0;
  server.seed(A,'transaction-layout',{layout:JSON.stringify({...defaults,realEstate:estate})},3);
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{
    if(options?.method!=='PUT'&&++reads===1){await wait.promise;return Response.json({userId:A,revision:0,data:{}});}
    return normal(url,options);
  });
  connectTransactionLayoutStorage(instance);const oldLoad=instance.load();await instance.load();
  assert.deepEqual(state().layout.realEstate,estate);state().setOrder('gc',gc);wait.resolve();await oldLoad;
  assert.deepEqual(state().layout,{version:1,realEstate:estate,gc});assert.equal(instance.dirty,true);assert.equal(state().status.phase,'saving');
});
await check('an obsolete load error cannot disable a newer successful account layout',async()=>{
  const server=backend(),normal=server.transport(A),wait=deferred();let reads=0;
  server.seed(A,'transaction-layout',{layout:JSON.stringify({...defaults,realEstate:estate})},2);
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{
    if(options?.method!=='PUT'&&++reads===1){await wait.promise;return Response.json({error:'Old load failure'},{status:503});}
    return normal(url,options);
  });
  connectTransactionLayoutStorage(instance);const oldLoad=instance.load();await instance.load();wait.resolve();await oldLoad;
  assert.equal(state().status.phase,'ready');assert.deepEqual(state().layout.realEstate,estate);assert.equal(instance.dirty,false);
});
await check('direct reload never discards a dirty layout that has not reached the account',async()=>{
  const server=backend(),instance=storage(server);connectTransactionLayoutStorage(instance);await instance.load();
  state().setOrder('realEstate',estate);assert.equal(instance.dirty,true);await instance.load();
  assert.deepEqual(state().layout.realEstate,estate);assert.equal(instance.dirty,true);assert.notEqual(state().status.phase,'ready');
});
await check('double retry after a failed load starts one replacement request and returns to the saved layout',async()=>{
  const server=backend(),normal=server.transport(A),wait=deferred();let reads=0;
  server.seed(A,'transaction-layout',{layout:JSON.stringify({...defaults,realEstate:estate})});
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{
    if(options?.method!=='PUT'){
      reads++;if(reads===1)return Response.json({error:'First load failed'},{status:503});await wait.promise;
    }
    return normal(url,options);
  });
  connectTransactionLayoutStorage(instance);await instance.load();assert.equal(state().status.phase,'error');
  const first=state().retry(),second=state().retry();await Promise.resolve();
  assert.equal(reads,2,'repeated Retry started an extra concurrent load');assert.equal(state().status.phase,'loading');
  wait.resolve();await Promise.all([first,second]);assert.equal(state().status.phase,'ready');assert.deepEqual(state().layout.realEstate,estate);
});
await check('account invalidation clears unsaved order and prevents any queued write from the old tab',async()=>{
  const server=backend(),old=storage(server);connectTransactionLayoutStorage(old);await old.load();state().setOrder('realEstate',estate);old.invalidate();
  assert.equal(state().status.phase,'signed-out');assert.deepEqual(state().layout,defaults);assert.equal(old.getItem('layout'),null);assert.equal(old.dirty,false);
  state().setOrder('gc',gc);await old.flush();assert.equal(server.writes.length,0);
  const next=storage(server,B);connectTransactionLayoutStorage(next);await next.load();state().setOrder('gc',gc);await next.flush();
  assert.equal(server.rows.has(server.key(A,'transaction-layout')),false);assert.deepEqual(JSON.parse(server.rows.get(server.key(B,'transaction-layout')).data.layout).gc,gc);
});
await check('late old-account GET cannot replace the new account store after disconnect/dispose',async()=>{
  const server=backend(),wait=deferred();const old=storage(server,A,'transaction-layout',async()=>{await wait.promise;return Response.json({userId:A,revision:8,data:{layout:JSON.stringify({...defaults,realEstate:estate})}});});
  connectTransactionLayoutStorage(old);const loading=old.load();
  const next=storage(server,B);connectTransactionLayoutStorage(next);await next.load();old.dispose();wait.resolve();await loading;
  assert.equal(state().status.phase,'ready');assert.deepEqual(state().layout,defaults);assert.equal(old.getItem('layout'),null);
});
await check('disconnected storage notifications cannot replace the current account layout or status',async()=>{
  const server=backend(),old=storage(server),next=storage(server,B);connectTransactionLayoutStorage(old);await old.load();
  connectTransactionLayoutStorage(next);await next.load();state().setOrder('gc',gc);await next.flush();
  old.setItem('layout',JSON.stringify({...defaults,realEstate:estate}));assert.equal(state().status.phase,'ready');assert.deepEqual(state().layout,{version:1,realEstate:defaults.realEstate,gc});
  old.invalidate();assert.equal(state().status.phase,'ready');assert.deepEqual(state().layout,{version:1,realEstate:defaults.realEstate,gc});
});
await check('late save acknowledgement cannot revive invalidated account state or replace the new account',async()=>{
  const server=backend(),normal=server.transport(A),wait=deferred(),started=deferred();
  const old=storage(server,A,'transaction-layout',async(url,options)=>{if(options?.method==='PUT'){started.resolve();await wait.promise;}return normal(url,options);});
  connectTransactionLayoutStorage(old);await old.load();state().setOrder('realEstate',estate);const saving=old.flush();await started.promise;
  old.invalidate();const next=storage(server,B);connectTransactionLayoutStorage(next);await next.load();state().setOrder('gc',gc);await next.flush();
  wait.resolve();await saving;assert.equal(old.getSnapshot().phase,'signed-out');assert.equal(old.getItem('layout'),null);assert.deepEqual(state().layout,{version:1,realEstate:defaults.realEstate,gc});
  assert.ok(server.writes.every(write=>write.accountId===A||write.accountId===B));assert.deepEqual(JSON.parse(server.rows.get(server.key(B,'transaction-layout')).data.layout).realEstate,defaults.realEstate);
});
await check('a response for the wrong signed-in account invalidates instead of adopting its layout',async()=>{
  const server=backend(),instance=storage(server,A,'transaction-layout',async()=>Response.json({userId:B,revision:1,data:{layout:JSON.stringify({...defaults,realEstate:estate})}}));
  connectTransactionLayoutStorage(instance);await instance.load();assert.equal(state().status.phase,'signed-out');assert.deepEqual(state().layout,defaults);assert.equal(instance.getItem('layout'),null);
});
for(const status of [401,403])await check('HTTP'+status+' on save invalidates and clears the account layout',async()=>{
  const server=backend(),normal=server.transport(A),instance=storage(server,A,'transaction-layout',(url,options)=>options?.method==='PUT'?Promise.resolve(Response.json({error:'No access'},{status})):normal(url,options));
  connectTransactionLayoutStorage(instance);await instance.load();state().setOrder('realEstate',estate);await instance.flush();assert.equal(state().status.phase,'signed-out');assert.deepEqual(state().layout,defaults);assert.equal(instance.dirty,false);
});
await check('wrong-account save acknowledgement never marks a local layout saved',async()=>{
  const server=backend(),normal=server.transport(A),instance=storage(server,A,'transaction-layout',(url,options)=>options?.method==='PUT'?Promise.resolve(Response.json({userId:B,revision:1})):normal(url,options));
  connectTransactionLayoutStorage(instance);await instance.load();state().setOrder('realEstate',estate);await instance.flush();assert.equal(state().status.phase,'signed-out');assert.deepEqual(state().layout,defaults);
});
await check('in-flight edits are serialized into the next revision rather than lost on the first acknowledgement',async()=>{
  const server=backend(),normal=server.transport(A),wait=deferred(),started=deferred();let first=true;
  const instance=storage(server,A,'transaction-layout',async(url,options)=>{if(options?.method==='PUT'&&first){first=false;started.resolve();await wait.promise;}return normal(url,options);});
  connectTransactionLayoutStorage(instance);await instance.load();state().setOrder('realEstate',estate);const saving=instance.flush();await started.promise;
  state().setOrder('gc',gc);assert.equal(state().status.phase,'saving');await state().retry();assert.equal(server.writes.length,0);
  wait.resolve();await saving;assert.equal(server.writes.length,2);assert.deepEqual(server.writes.map(write=>write.revision),[0,1]);assert.equal(instance.dirty,false);
  assert.deepEqual(JSON.parse(server.rows.get(server.key(A,'transaction-layout')).data.layout),{version:1,realEstate:estate,gc});
});
await check('a Home revision conflict does not block independent transaction layout saving',async()=>{
  const server=backend(),homeA=storage(server,A,'dashboard-layout'),homeB=storage(server,A,'dashboard-layout'),transaction=storage(server);
  await Promise.all([homeA.load(),homeB.load(),transaction.load()]);
  homeA.setItem('layout',JSON.stringify({widgetOrder:DEFAULT_WIDGET_ORDER,widgetPeriods:{}}));await homeA.flush();
  homeB.setItem('layout',JSON.stringify({widgetOrder:[...DEFAULT_WIDGET_ORDER].reverse(),widgetPeriods:{}}));await homeB.flush();assert.equal(homeB.getSnapshot().phase,'conflict');
  connectTransactionLayoutStorage(transaction);state().setOrder('realEstate',estate);await transaction.flush();assert.equal(state().status.phase,'ready');assert.equal(transaction.dirty,false);
  assert.deepEqual(JSON.parse(server.rows.get(server.key(A,'transaction-layout')).data.layout).realEstate,estate);
});
console.log(passed+'/'+passed+' transaction layout storage checks passed (actual stores; synthetic owner-scoped transport)');
})().catch(error=>{console.error(error);process.exitCode=1;});
`;

try {
  const built = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false });
  const path = join(temporary, "transaction-layout-storage.cjs");
  writeFileSync(path, built.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [path], { encoding: "utf8", timeout: 30000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("Transaction layout storage checks failed");
} finally { rmSync(temporary, { recursive: true, force: true }); }
