import assert from 'node:assert/strict';
import {PgDialect} from 'drizzle-orm/pg-core';
import {workspaceWriteSchema} from '../lib/workspaces/contract.ts';
import {readWorkspace,writeWorkspace} from '../lib/workspaces/service.ts';
import {DEFAULT_WIDGET_ORDER} from '../lib/stores/widget-order.ts';
const owner='11111111-1111-4111-8111-111111111111';
const base={accountId:owner,namespace:'dashboard-layout',revision:0,data:{layout:JSON.stringify({widgetOrder:DEFAULT_WIDGET_ORDER,widgetPeriods:{}})}};
assert(workspaceWriteSchema.safeParse(base).success);
for(const invalid of [{...base,ownerUserId:owner},{...base,revision:2147483647},{...base,data:{records:'[]'}},{...base,data:{layout:'{"widgetOrder":["forged"],"widgetPeriods":{}}'}}])assert(!workspaceWriteSchema.safeParse(invalid).success);
const spec={schemaVersion:1,scope:'residential-sale',area:{type:'zip',zip:'33301',name:'Fort Lauderdale'}};
const farm={id:'test',name:'Test',spec,savedAt:new Date().toISOString()};
const edge={...base,namespace:'competitive-edge',data:{'fm-competitive-edge:farms:v1':JSON.stringify([farm])}};
assert(workspaceWriteSchema.safeParse(edge).success);
for(const field of ['ownerName','listings','photos','ownerUserId'])assert(!workspaceWriteSchema.safeParse({...edge,data:{'fm-competitive-edge:farms:v1':JSON.stringify([{...farm,[field]:'private'}])}}).success);
let query:any,insert:any;const dialect=new PgDialect();
const fake:any={select:()=>({from:()=>({where:(where:any)=>{query=dialect.sqlToQuery(where);return {limit:async()=>[]};}})}),insert:()=>({values:(value:any)=>{insert=value;return {onConflictDoNothing:()=>({returning:async()=>[{revision:1}]})};}}),update:()=>({set:()=>({where:(where:any)=>{query=dialect.sqlToQuery(where);return {returning:async()=>[]};}})})};
for(const role of ['agent','admin','broker','member'] as const){
 const actor={userId:owner,role,brokerageKey:'fortmark'};
 for(const namespace of ['competitive-edge','dashboard-layout','transaction-layout']){
  assert.deepEqual(await readWorkspace(fake,actor,namespace),{data:{},revision:0});
  assert(query.sql.includes('owner_user_id'));assert.deepEqual(query.params,[owner,namespace]);
  await writeWorkspace(fake,actor,namespace,0,{});assert.equal(insert.ownerUserId,owner);assert.equal(insert.namespace,namespace);
  assert.equal(await writeWorkspace(fake,actor,namespace,4,{}),null);assert.deepEqual(query.params,[owner,namespace,4]);
 }
}
console.log('Personal workspace contract, ownership and conflict checks passed.');
