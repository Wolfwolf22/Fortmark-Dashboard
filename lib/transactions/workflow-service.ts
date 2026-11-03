import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { auditEvents, contacts, transactionChecklistItems, transactionEvents, transactionOpenHouses, transactionParties, transactionPrivateNotes, transactionReopenRequests, transactionWriteRequests, transactions, type TransactionRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { visibleTo as visibleContacts } from "../contacts/visibility.ts";
import { displayName } from "../contacts/domain.ts";
import { canSee, canWrite } from "./domain.ts";
import { getTransactionWorkspace } from "./workspace-service.ts";
import type { TransactionWorkspace } from "./workspace-domain.ts";
import { isTerminalStage } from "./stages.ts";
import { transactionActorGuard, transactionWriteLocks, nextTransactionRevision, visibleTo, isTransactionGuardConflict, type ServiceResult, type TransactionContext } from "./service.ts";
import { EMPTY_LISTING_PLAN, isListingSide, transactionWorkflowMutationSchema, type TransactionWorkflow } from "./workflow-domain.ts";

type Write = Parameters<TransactionContext["db"]["batch"]>[0][number];
type Batch = Parameters<TransactionContext["db"]["batch"]>[0];
async function load(ctx: TransactionContext, id: string): Promise<ServiceResult<TransactionRow>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(transactions).where(and(eq(transactions.id,id),visibleTo(ctx.actor,true),transactionActorGuard(ctx.actor))).limit(1);
  return row&&canSee(ctx.actor,row)?{ok:true,value:row}:{ok:false,reason:"not_found"};
}
function revisionGuard(ctx:TransactionContext,row:TransactionRow,expected:string){return and(eq(transactions.id,row.id),visibleTo(ctx.actor,true),transactionActorGuard(ctx.actor),eq(transactions.agentUserId,row.agentUserId),eq(transactions.stage,row.stage),sql`date_trunc('milliseconds',${transactions.updatedAt})=${expected}::timestamptz`,row.deletedAt?sql`${transactions.deletedAt} is not null`:isNull(transactions.deletedAt));}

/** Called only within an already-authorized workspace; the caller rechecks the parent after these awaits. */
export async function readTransactionWorkflow(ctx:TransactionContext,row:TransactionRow):Promise<TransactionWorkflow>{
  const [notes,openHouses,requests]=await Promise.all([
    ctx.db.select().from(transactionPrivateNotes).where(and(eq(transactionPrivateNotes.transactionId,row.id),isNull(transactionPrivateNotes.removedAt))).orderBy(desc(transactionPrivateNotes.createdAt),transactionPrivateNotes.id).limit(200),
    ctx.db.select().from(transactionOpenHouses).where(and(eq(transactionOpenHouses.transactionId,row.id),isNull(transactionOpenHouses.removedAt))).orderBy(desc(transactionOpenHouses.startsAt),transactionOpenHouses.id).limit(100),
    ctx.db.select().from(transactionReopenRequests).where(eq(transactionReopenRequests.transactionId,row.id)).orderBy(desc(transactionReopenRequests.createdAt),transactionReopenRequests.id).limit(50),
  ]);
  const writable=canWrite(ctx.actor,row)&&!row.deletedAt,active=writable&&!isTerminalStage(row.stage)&&row.side!=="gc";
  return {deletedAt:row.deletedAt?.toISOString()??null,deletedReason:row.deletedReason,listingPlan:row.listingPlan??EMPTY_LISTING_PLAN,
    notes:notes.map(n=>({id:n.id,body:n.body,createdAt:n.createdAt.toISOString(),updatedAt:n.updatedAt.toISOString(),canEdit:active&&(n.authorUserId===ctx.actor.userId||ctx.actor.role==="admin")})),
    openHouses:openHouses.map(h=>({id:h.id,startsAt:h.startsAt.toISOString(),endsAt:h.endsAt.toISOString(),attendance:h.attendance,notes:h.notes,status:h.status as "planned"|"completed"|"cancelled",createdAt:h.createdAt.toISOString(),updatedAt:h.updatedAt.toISOString()})),
    reopenRequests:requests.map(r=>({id:r.id,reason:r.reason,status:r.status as "pending"|"approved"|"denied",decisionReason:r.decisionReason,previousClosedDate:r.previousClosedDate,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),canDecide:writable&&row.stage==="closed"&&ctx.actor.role==="admin"&&r.status==="pending"})),
    canArchive:writable&&["closed","cancelled","fell_through"].includes(row.stage),canRestore:canWrite(ctx.actor,row)&&Boolean(row.deletedAt),canRequestReopen:writable&&row.stage==="closed"&&!requests.some(r=>r.status==="pending"),canManageHelp:active&&ctx.actor.role==="admin"};
}
async function replay(ctx:TransactionContext,id:string,requestId:string,hash:string):Promise<ServiceResult<TransactionWorkspace>|null>{
  const [receipt]=await ctx.db.select().from(transactionWriteRequests).where(and(eq(transactionWriteRequests.actorUserId,ctx.actor.userId),eq(transactionWriteRequests.requestId,requestId))).limit(1);
  if(!receipt)return null;
  const current=await load(ctx,receipt.transactionId);if(!current.ok)return current;if(!canWrite(ctx.actor,current.value))return {ok:false,reason:"forbidden"};
  if(receipt.transactionId!==id||receipt.action!=="workflow"||receipt.payloadHash!==hash)return {ok:false,reason:"request_conflict"};
  return getTransactionWorkspace(ctx,id,{includeDeleted:true});
}
export async function mutateTransactionWorkflow(ctx:TransactionContext,id:string,input:unknown,now=new Date()):Promise<ServiceResult<TransactionWorkspace>>{
  const parsed=transactionWorkflowMutationSchema.safeParse(input);if(!parsed.success)return {ok:false,reason:"invalid_workflow"};
  const d=parsed.data,hash=createPayloadHash({id,...d}),previous=await replay(ctx,id,d.requestId,hash);if(previous)return previous;
  const loaded=await load(ctx,id);if(!loaded.ok)return loaded;const row=loaded.value;
  if(!canWrite(ctx.actor,row))return {ok:false,reason:"forbidden"};
  if(row.side==="gc")return {ok:false,reason:"gc_not_configured"};
  if(!revisionMatches(row.updatedAt,d.expectedUpdatedAt))return {ok:false,reason:"conflict"};
  if(row.deletedAt&&d.action!=="restore"||!row.deletedAt&&d.action==="restore")return {ok:false,reason:"workflow_not_allowed"};
  const terminal=isTerminalStage(row.stage);
  if(terminal&&!["archive","restore","request_reopen","decide_reopen"].includes(d.action))return {ok:false,reason:"invalid_transition"};
  const next=nextTransactionRevision(row,now),parentGuard=revisionGuard(ctx,row,d.expectedUpdatedAt),conditions:SQL[]=[sql`exists(select 1 from ${transactions} where ${parentGuard})`],childWrites:Write[]=[],locks:Write[]=[];
  let recordId:string|undefined,fields:string[]=[],parent:Partial<typeof transactions.$inferInsert>={updatedAt:next,updatedByUserId:ctx.actor.userId};
  if(d.action==="archive"){
    if(!["closed","cancelled","fell_through"].includes(row.stage))return {ok:false,reason:"workflow_not_allowed"};
    if(row.stage==="closed"&&!d.closedAcknowledged||row.stage!=="closed"&&!d.reason)return {ok:false,reason:"terminal_reason_required"};
    parent={...parent,deletedAt:now,deletedReason:d.reason||null};fields=["deletedAt","deletedReason"];
  }else if(d.action==="restore"){parent={...parent,deletedAt:null,deletedReason:null};fields=["deletedAt"];
  }else if(d.action==="listing_plan"){
    if(!isListingSide(row.side))return {ok:false,reason:"workflow_not_allowed"};
    if(d.plan.status==="extended"&&(!row.listingPlan.expirationDate||!d.plan.expirationDate||d.plan.expirationDate<=row.listingPlan.expirationDate))return {ok:false,reason:"invalid_workflow"};
    parent={...parent,listingPlan:d.plan};fields=["listingPlan"];
  }else if(d.action==="add_party"){
    const [contact]=await ctx.db.select().from(contacts).where(and(eq(contacts.id,d.contactId),visibleContacts(ctx.actor))).limit(1);
    if(!contact)return {ok:false,reason:"invalid_contact"};if(!revisionMatches(contact.updatedAt,d.expectedContactUpdatedAt))return {ok:false,reason:"conflict"};
    locks.push(ctx.db.select({id:contacts.id}).from(contacts).where(and(eq(contacts.id,d.contactId),visibleContacts(ctx.actor))).for("share"));
    conditions.push(sql`exists(select 1 from ${contacts} where ${contacts.id}=${d.contactId}::uuid and ${visibleContacts(ctx.actor)} and date_trunc('milliseconds',${contacts.updatedAt})=${d.expectedContactUpdatedAt}::timestamptz)`,sql`(select count(*) from ${transactionParties} where ${transactionParties.transactionId}=${id}::uuid)<20`,sql`not exists(select 1 from ${transactionParties} where ${transactionParties.transactionId}=${id}::uuid and ${transactionParties.contactId}=${d.contactId}::uuid and ${transactionParties.role}=${d.role})`);
    recordId=randomUUID();childWrites.push(ctx.db.insert(transactionParties).values({id:recordId,transactionId:id,contactId:contact.id,role:d.role,displayName:displayName(contact),email:contact.email,phoneE164:contact.phoneE164,isPrimary:false,createdAt:now}));fields=["parties"];
  }else if(d.action==="checklist_help"){
    if(ctx.actor.role!=="admin")return {ok:false,reason:"forbidden"};recordId=d.itemId;
    const guard=and(eq(transactionChecklistItems.id,d.itemId),eq(transactionChecklistItems.transactionId,id),sql`date_trunc('milliseconds',${transactionChecklistItems.updatedAt})=${d.expectedItemUpdatedAt}::timestamptz`);
    conditions.push(sql`exists(select 1 from ${transactionChecklistItems} where ${guard})`);locks.push(ctx.db.select({id:transactionChecklistItems.id}).from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId,id)).orderBy(transactionChecklistItems.id).for("update"));
    childWrites.push(ctx.db.update(transactionChecklistItems).set({helpText:d.helpText,updatedAt:next}).where(guard));fields=["helpText"];
  }else if(d.action==="add_note"){
    conditions.push(sql`(select count(*) from ${transactionPrivateNotes} where ${transactionPrivateNotes.transactionId}=${id}::uuid and ${transactionPrivateNotes.removedAt} is null)<200`);recordId=randomUUID();childWrites.push(ctx.db.insert(transactionPrivateNotes).values({id:recordId,transactionId:id,authorUserId:ctx.actor.userId,body:d.body,createdAt:now,updatedAt:next}));fields=["privateNotes"];
  }else if(d.action==="edit_note"||d.action==="remove_note"){
    recordId=d.recordId;const guard=and(eq(transactionPrivateNotes.id,d.recordId),eq(transactionPrivateNotes.transactionId,id),isNull(transactionPrivateNotes.removedAt),sql`date_trunc('milliseconds',${transactionPrivateNotes.updatedAt})=${d.expectedRecordUpdatedAt}::timestamptz`,ctx.actor.role==="admin"?undefined:eq(transactionPrivateNotes.authorUserId,ctx.actor.userId));
    conditions.push(sql`exists(select 1 from ${transactionPrivateNotes} where ${guard})`);locks.push(ctx.db.select({id:transactionPrivateNotes.id}).from(transactionPrivateNotes).where(eq(transactionPrivateNotes.transactionId,id)).orderBy(transactionPrivateNotes.id).for("update"));
    childWrites.push(ctx.db.update(transactionPrivateNotes).set({...d.action==="edit_note"?{body:d.body}:{removedAt:now},updatedAt:next}).where(guard));fields=["privateNotes"];
  }else if(d.action==="add_open_house"||d.action==="edit_open_house"||d.action==="remove_open_house"){
    if(!isListingSide(row.side))return {ok:false,reason:"workflow_not_allowed"};fields=["openHouses"];
    if(d.action==="add_open_house"){
      conditions.push(sql`(select count(*) from ${transactionOpenHouses} where ${transactionOpenHouses.transactionId}=${id}::uuid and ${transactionOpenHouses.removedAt} is null)<100`);recordId=randomUUID();childWrites.push(ctx.db.insert(transactionOpenHouses).values({id:recordId,transactionId:id,...d.openHouse,startsAt:new Date(d.openHouse.startsAt),endsAt:new Date(d.openHouse.endsAt),createdAt:now,updatedAt:next}));
    }else{
      recordId=d.recordId;const guard=and(eq(transactionOpenHouses.id,d.recordId),eq(transactionOpenHouses.transactionId,id),isNull(transactionOpenHouses.removedAt),sql`date_trunc('milliseconds',${transactionOpenHouses.updatedAt})=${d.expectedRecordUpdatedAt}::timestamptz`);
      conditions.push(sql`exists(select 1 from ${transactionOpenHouses} where ${guard})`);locks.push(ctx.db.select({id:transactionOpenHouses.id}).from(transactionOpenHouses).where(eq(transactionOpenHouses.transactionId,id)).orderBy(transactionOpenHouses.id).for("update"));
      childWrites.push(ctx.db.update(transactionOpenHouses).set(d.action==="remove_open_house"?{removedAt:now,updatedAt:next}:{...d.openHouse,startsAt:new Date(d.openHouse.startsAt),endsAt:new Date(d.openHouse.endsAt),updatedAt:next}).where(guard));
    }
  }else if(d.action==="request_reopen"){
    if(row.stage!=="closed")return {ok:false,reason:"workflow_not_allowed"};const [pending]=await ctx.db.select({id:transactionReopenRequests.id}).from(transactionReopenRequests).where(and(eq(transactionReopenRequests.transactionId,id),eq(transactionReopenRequests.status,"pending"))).limit(1);if(pending)return {ok:false,reason:"reopen_pending"};
    conditions.push(sql`not exists(select 1 from ${transactionReopenRequests} where ${transactionReopenRequests.transactionId}=${id}::uuid and ${transactionReopenRequests.status}='pending')`);recordId=randomUUID();childWrites.push(ctx.db.insert(transactionReopenRequests).values({id:recordId,transactionId:id,requestedByUserId:ctx.actor.userId,reason:d.reason,previousClosedDate:row.closedDate,createdAt:now,updatedAt:next}));fields=["reopenRequest"];
  }else if(d.action==="decide_reopen"){
    if(ctx.actor.role!=="admin")return {ok:false,reason:"forbidden"};if(row.stage!=="closed")return {ok:false,reason:"workflow_not_allowed"};recordId=d.recordId;
    const guard=and(eq(transactionReopenRequests.id,d.recordId),eq(transactionReopenRequests.transactionId,id),eq(transactionReopenRequests.status,"pending"),sql`date_trunc('milliseconds',${transactionReopenRequests.updatedAt})=${d.expectedRecordUpdatedAt}::timestamptz`);
    conditions.push(sql`exists(select 1 from ${transactionReopenRequests} where ${guard})`);locks.push(ctx.db.select({id:transactionReopenRequests.id}).from(transactionReopenRequests).where(eq(transactionReopenRequests.transactionId,id)).orderBy(transactionReopenRequests.id).for("update"));
    childWrites.push(ctx.db.update(transactionReopenRequests).set({status:d.approved?"approved":"denied",decidedByUserId:ctx.actor.userId,decisionReason:d.reason,updatedAt:next}).where(guard));if(d.approved)parent={...parent,stage:"closing_prep",closedDate:null};fields=d.approved?["reopenRequest","stage","closedDate"]:["reopenRequest"];
  }
  const guard=sql.join(conditions,sql` and `),safe={action:d.action,fields,...recordId?{recordId}:{}};
  // Contact locks precede the parent, matching contact merge's lock order.
  const parentLocks=transactionWriteLocks(ctx,id,true),before=parentLocks.slice(0,1),after=parentLocks.slice(1);
  const writes:Write[]=[...before,...(d.action==="add_party"?locks:[]),...after,...(d.action!=="add_party"?locks:[]),ctx.db.insert(transactionWriteRequests).values({actorUserId:ctx.actor.userId,requestId:d.requestId,transactionId:id,action:"workflow",payloadHash:sql`case when ${guard} then ${hash}::text else null end`,result:{transactionId:id,updatedAt:next.toISOString(),...recordId?{recordId}:{}},createdAt:now}),ctx.db.update(transactions).set(parent).where(parentGuard),...childWrites,
    ctx.db.insert(transactionEvents).values({transactionId:id,actorUserId:ctx.actor.userId,eventType:"transaction_updated",safeMetadata:safe,createdAt:now}),ctx.db.insert(auditEvents).values({eventType:"transaction_updated",actorUserId:ctx.actor.userId,safeMetadata:{transactionId:id,...safe},createdAt:now})];
  try{await ctx.db.batch(writes as unknown as Batch);}catch(error){const recovered=await replay(ctx,id,d.requestId,hash);if(recovered)return recovered;const current=await load(ctx,id);if(!current.ok)return current;return {ok:false,reason:isTransactionGuardConflict(error)?"conflict":"unavailable"};}
  return getTransactionWorkspace(ctx,id,{includeDeleted:true});
}
