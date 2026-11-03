import "server-only";

import { and, desc, eq, inArray,or, sql } from "drizzle-orm";
import { auditEvents, contactActivities } from "../db/schema.ts";
import { loadContact } from "./access.ts";
import { contactFamilyIds } from "./visibility.ts";
import { agentNames, type Ctx, type ServiceResult } from "./service.ts";
import { TIMELINE_DOMAIN_EVENTS } from "./events.ts";
import { toTimeline, type TimelineItem } from "./timeline.ts";
import { HISTORY_PAGE_SIZE, MAX_HISTORY_PAGE_SIZE, historyPage, type HistoryCursor, type HistoryPage } from "./history.ts";
import { lifecycleScope } from "./lifecycle-service.ts";

/** Merge three scoped streams without hiding older history behind a fixed cap. */
export async function getTimelinePage(ctx: Ctx, contactId: string, options: { pageSize?: number; cursor?: HistoryCursor } = {}): Promise<ServiceResult<HistoryPage<TimelineItem>>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  const pageSize = Math.min(Math.max(options.pageSize ?? HISTORY_PAGE_SIZE, 1), MAX_HISTORY_PAGE_SIZE);
  const cursor = options.cursor;
  const activityStamp = sql`date_trunc('milliseconds', ${contactActivities.occurredAt})`;
  const eventStamp = sql`date_trunc('milliseconds', ${auditEvents.createdAt})`;
  const activityId = sql`${contactActivities.id}::text`;
  const eventId = sql`${auditEvents.id}::text`;
  // Include the boundary source row: a touch can emit both an interaction and
  // a follow-up at one instant. The pure merge removes only the visible cursor
  // item, leaving its older sibling accessible on the next page.
  const boundary = (stamp: ReturnType<typeof sql>, identifier: ReturnType<typeof sql>) => cursor
    ? sql`(${stamp} < ${cursor.at}::timestamptz or (${stamp} = ${cursor.at}::timestamptz and ${identifier} <= ${cursor.id}))`
    : undefined;
  const limit = pageSize + 2;
  const [activities, followUps, domainEvents] = await Promise.all([
    ctx.db.select({ id: contactActivities.id, kind: contactActivities.kind, summary: contactActivities.summary, occurredAt: contactActivities.occurredAt, actorUserId: contactActivities.actorUserId, safeMetadata: contactActivities.safeMetadata })
      .from(contactActivities).where(and(eq(contactActivities.contactId, contactId), boundary(activityStamp, activityId)))
      .orderBy(desc(activityStamp), desc(activityId)).limit(limit),
    ctx.db.select({ id: auditEvents.id, createdAt: auditEvents.createdAt, actorUserId: auditEvents.actorUserId, safeMetadata: auditEvents.safeMetadata })
      .from(auditEvents).where(and(eq(auditEvents.eventType, "contact_updated"), sql`${auditEvents.safeMetadata}->>'contactId' in (${contactFamilyIds(ctx.actor, contactId)})`,
        sql`${auditEvents.safeMetadata}->>'field' = 'nextFollowUpAt'`, sql`${auditEvents.safeMetadata}->>'followUp' in ('scheduled', 'rescheduled', 'completed')`, boundary(eventStamp, eventId)))
      .orderBy(desc(eventStamp), desc(eventId)).limit(limit),
    ctx.db.select({ id: auditEvents.id, eventType: auditEvents.eventType, createdAt: auditEvents.createdAt, actorUserId: auditEvents.actorUserId, safeMetadata: auditEvents.safeMetadata })
      .from(auditEvents).where(and(inArray(auditEvents.eventType, [...TIMELINE_DOMAIN_EVENTS]), sql`${auditEvents.safeMetadata}->>'contactId' in (${contactFamilyIds(ctx.actor, contactId)})`, boundary(eventStamp, eventId)))
      .orderBy(desc(eventStamp), desc(eventId)).limit(limit),
  ]);
  const userIds = new Set<string>();
  for (const activity of activities) {
    if (activity.actorUserId) userIds.add(activity.actorUserId);
    const to = activity.safeMetadata?.toAgentUserId;
    if (typeof to === "string") userIds.add(to);
    const assignee = activity.safeMetadata?.assigneeId;
    if (typeof assignee === "string") userIds.add(assignee);
  }
  for (const event of [...followUps, ...domainEvents]) if (event.actorUserId) userIds.add(event.actorUserId);
  const names = await agentNames(ctx.db, [...userIds]);
  const items = toTimeline({ activities, followUpEvents: followUps, domainEvents, names, limit: Number.MAX_SAFE_INTEGER });
  return { ok: true, value: historyPage(items, pageSize, item => ({ at: item.at, id: item.id }), cursor) };
}

/** Only recorded outreach/visits and explicit contacted marks for this contact. */
export async function getTouchHistoryPage(ctx:Ctx,contactId:string,options:{pageSize?:number;cursor?:HistoryCursor}={}):Promise<ServiceResult<HistoryPage<TimelineItem>>>{
 const access=await lifecycleScope(ctx,contactId);if(!access.ok)return access;const pageSize=Math.min(Math.max(options.pageSize??HISTORY_PAGE_SIZE,1),MAX_HISTORY_PAGE_SIZE),cursor=options.cursor,stamp=sql`date_trunc('milliseconds',${contactActivities.occurredAt})`,id=sql`${contactActivities.id}::text`;
 const rows=await ctx.db.select().from(contactActivities).where(and(eq(contactActivities.contactId,contactId),or(inArray(contactActivities.kind,["call","email","sms","meeting","showing"]),sql`${contactActivities.safeMetadata}->>'event'='contact_marked'`),cursor?sql`(${stamp}<${cursor.at}::timestamptz or (${stamp}=${cursor.at}::timestamptz and ${id}<${cursor.id}))`:undefined)).orderBy(desc(stamp),desc(id)).limit(pageSize+1);
 const names=await agentNames(ctx.db,[...new Set(rows.flatMap(row=>row.actorUserId?[row.actorUserId]:[]))]),current=await lifecycleScope(ctx,contactId);if(!current.ok)return current;
 const items=toTimeline({activities:rows,followUpEvents:[],names,limit:Number.MAX_SAFE_INTEGER}).filter(item=>["call","email","text","meeting","showing","contacted"].includes(item.type));return{ok:true,value:historyPage(items,pageSize,item=>({id:item.id,at:item.at}),cursor)};
}
