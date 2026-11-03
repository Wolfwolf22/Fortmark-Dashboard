import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { auditEvents, contactLifecycleRequests, contacts, dashboardUsers, type ContactRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { canWrite, displayName } from "./domain.ts";
import { visibleTo } from "./visibility.ts";
import { createPayloadHash, revisionMatches } from "./reliability.ts";
import { contactLifecycleMutationSchema, type ContactLifecycleInput } from "./engagement.ts";
import type { Ctx } from "./service.ts";

export type ContactLifecycleFailure = "not_found" | "forbidden" | "conflict" | "request_conflict" | "invalid_request" | "unavailable" | "engagement_required" | "engagement_acknowledgement_required" | "engagement_not_configured" | "engagement_unavailable" | "invalid_engagement" | "file_too_large";
export type ContactLifecycleResult<T> = { ok: true; value: T } | { ok: false; reason: ContactLifecycleFailure };
export interface ContactLifecycleState { contactId: string; deletedAt: string | null; updatedAt: string }
export interface DeletedContact { id: string; name: string; deletedAt: string; updatedAt: string }
export interface DeletedContactsPage { items: DeletedContact[]; total: number; page: number; pageSize: number }
export type ContactWrite = Parameters<Ctx["db"]["batch"]>[0][number];
export type ContactBatch = Parameters<Ctx["db"]["batch"]>[0];
export const currentContactActor = (ctx: Pick<Ctx,"actor">) => sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`;
export async function lifecycleScope(ctx: Ctx, id: string, includeDeleted = false): Promise<ContactLifecycleResult<ContactRow>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(contacts).where(and(eq(contacts.id,id),visibleTo(ctx.actor,{includeDeleted}),currentContactActor(ctx))).limit(1);
  return row ? {ok:true,value:row}:{ok:false,reason:"not_found"};
}
export function lifecycleLocks(ctx: Ctx,id:string): ContactWrite[] { return [ctx.db.select({id:dashboardUsers.id}).from(dashboardUsers).where(eq(dashboardUsers.id,ctx.actor.userId)).for("no key update"),ctx.db.select({id:contacts.id}).from(contacts).where(eq(contacts.id,id)).for("update")]; }
export function lifecycleRevisionGuard(ctx:Ctx,row:ContactRow,expected:string,includeDeleted=false){return and(eq(contacts.id,row.id),visibleTo(ctx.actor,{includeDeleted}),currentContactActor(ctx),eq(contacts.assignedAgentUserId,row.assignedAgentUserId),sql`date_trunc('milliseconds',${contacts.updatedAt})=${expected}::timestamptz`);}
export function lifecycleAudit(ctx:Ctx,id:string,action:string,now:Date,engagementId?:string):ContactWrite{return ctx.db.insert(auditEvents).values({actorUserId:ctx.actor.userId,eventType:"contact_updated",safeMetadata:{contactId:id,event:action,fields:[action.includes("engagement")?"engagement":"deletedAt"],...(engagementId?{engagementId}:{})},createdAt:now});}
export function lifecycleGuardError(error:unknown){let e=error;for(let i=0;e&&typeof e==="object"&&i<8;i++){const v=e as{code?:string;cause?:unknown};if(v.code&&/^(23|40)/.test(v.code))return true;e=v.cause;}return false;}
export async function listDeletedContacts(ctx:Ctx,page=1):Promise<ContactLifecycleResult<DeletedContactsPage>>{
  if(!Number.isSafeInteger(page)||page<1||page>1_000_000)return{ok:false,reason:"invalid_request"};
  const where=and(visibleTo(ctx.actor,{includeDeleted:true}),isNotNull(contacts.deletedAt),currentContactActor(ctx));
  const [count]=await ctx.db.select({n:sql<number>`count(*)::int`}).from(contacts).where(where);const pageSize=25,effective=Math.min(page,Math.max(1,Math.ceil(count.n/pageSize)));
  const rows=await ctx.db.select({id:contacts.id,firstName:contacts.firstName,lastName:contacts.lastName,preferredName:contacts.preferredName,deletedAt:contacts.deletedAt,updatedAt:contacts.updatedAt}).from(contacts).where(where).orderBy(desc(contacts.deletedAt),contacts.id).limit(pageSize).offset((effective-1)*pageSize);
  const [actor]=await ctx.db.select({id:dashboardUsers.id}).from(dashboardUsers).where(and(eq(dashboardUsers.id,ctx.actor.userId),currentContactActor(ctx))).limit(1);if(!actor)return{ok:false,reason:"forbidden"};
  if(rows.length){const current=await ctx.db.select({id:contacts.id,updatedAt:contacts.updatedAt}).from(contacts).where(and(where,inArray(contacts.id,rows.map(row=>row.id))));if(current.length!==rows.length||current.some(row=>!rows.some(before=>before.id===row.id&&revisionMatches(row.updatedAt,before.updatedAt.toISOString()))))return{ok:false,reason:"conflict"};}
  return{ok:true,value:{items:rows.map(row=>({id:row.id,name:displayName(row),deletedAt:row.deletedAt!.toISOString(),updatedAt:row.updatedAt.toISOString()})),total:count.n,page:effective,pageSize}};
}
export async function mutateContactDeletion(ctx:Ctx,id:string,action:"delete"|"restore",input:unknown,now=new Date()):Promise<ContactLifecycleResult<ContactLifecycleState>>{
  const parsed=contactLifecycleMutationSchema.safeParse(input);if(!parsed.success)return{ok:false,reason:"invalid_request"};const d:ContactLifecycleInput=parsed.data,hash=createPayloadHash({id,action,...d});
  const replay=async():Promise<ContactLifecycleResult<ContactLifecycleState>|null>=>{const [receipt]=await ctx.db.select().from(contactLifecycleRequests).where(and(eq(contactLifecycleRequests.actorUserId,ctx.actor.userId),eq(contactLifecycleRequests.requestId,d.requestId))).limit(1);if(!receipt)return null;const current=await lifecycleScope(ctx,id,true);if(!current.ok)return current;if(!canWrite(ctx.actor,current.value))return{ok:false,reason:"forbidden"};if(receipt.contactId!==id||receipt.brokerageKey!==ctx.actor.brokerageKey||receipt.action!==action||receipt.payloadHash!==hash)return{ok:false,reason:"request_conflict"};return{ok:true,value:{contactId:id,deletedAt:current.value.deletedAt?.toISOString()??null,updatedAt:current.value.updatedAt.toISOString()}};};
  const prior=await replay();if(prior)return prior;const loaded=await lifecycleScope(ctx,id,true);if(!loaded.ok)return loaded;const row=loaded.value;if(!canWrite(ctx.actor,row))return{ok:false,reason:"forbidden"};if(!revisionMatches(row.updatedAt,d.expectedUpdatedAt)||Boolean(row.deletedAt)!==(action==="restore"))return{ok:false,reason:"conflict"};
  const next=new Date(Math.max(now.getTime(),row.updatedAt.getTime()+1)),guard=sql`exists(select 1 from ${contacts} where ${lifecycleRevisionGuard(ctx,row,d.expectedUpdatedAt,true)} and ${action==="delete"?sql`${contacts.deletedAt} is null`:sql`${contacts.deletedAt} is not null`})`;
  try{await ctx.db.batch([...lifecycleLocks(ctx,id),ctx.db.insert(contactLifecycleRequests).values({actorUserId:ctx.actor.userId,requestId:d.requestId,brokerageKey:ctx.actor.brokerageKey,contactId:id,action,payloadHash:sql`case when ${guard} then ${hash}::text else null end`,result:{contactId:id,updatedAt:next.toISOString()},createdAt:now}),ctx.db.update(contacts).set({deletedAt:action==="delete"?now:null,deletedByUserId:action==="delete"?ctx.actor.userId:null,updatedAt:next,updatedByUserId:ctx.actor.userId}).where(lifecycleRevisionGuard(ctx,row,d.expectedUpdatedAt,true)),lifecycleAudit(ctx,id,`contact_${action==="delete"?"deleted":"restored"}`,now)]as unknown as ContactBatch);}catch(error){const recovered=await replay();if(recovered)return recovered;const current=await lifecycleScope(ctx,id,true);if(!current.ok)return current;return{ok:false,reason:lifecycleGuardError(error)?"conflict":"unavailable"};}
  const current=await lifecycleScope(ctx,id,true);return current.ok?{ok:true,value:{contactId:id,deletedAt:current.value.deletedAt?.toISOString()??null,updatedAt:current.value.updatedAt.toISOString()}}:current;
}
