import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { auditEvents, contactActivities, contactMergeRequests, contactNeeds, contactNotes, contactOpportunities, contactProperties, propertyLists, contacts, transactionParties, transactions, type ContactRow } from "../db/schema.ts";
import { visibleTo as visibleTransactions } from "../transactions/service.ts";
import { canWrite, displayName } from "./domain.ts";
import { agentNames, getContact, type Ctx, type ServiceFailure, type ServiceResult } from "./service.ts";
import { contactFamilyIds, visibleTo } from "./visibility.ts";
import { nextContactUpdatedAt, contactRevision, revisionMatches } from "./reliability.ts";
import { canTransition, requiresEngagementNotice } from "./stages.ts";
import { chooseMergedAction, chooseMergedFollowUp, contactMergeInputSchema, defaultMergeChoices, mergeConflicts, mergeCounts, mergeValues, splitLegacyNote, type ContactMergeInput, type ContactMergeResult, type MergeCounts, type MergeReview, type MergeReviewContact, type MergeValues } from "./merge.ts";
import { contactNextAction } from "./domain.ts";
import { isRecordId } from "../db/ids.ts";
import { CONTACT_NOTE_MAX_LENGTH } from "./notes.ts";

type BatchWrite = Parameters<Db["batch"]>[0][number];
const valuesOf = (row: ContactRow): MergeValues => ({
  name: { firstName: row.firstName ?? "", lastName: row.lastName ?? "", preferredName: row.preferredName ?? "" },
  email: row.email ?? "", phone: row.phoneE164 ?? "", company: row.company ?? "", source: row.source, stage: row.stage,
  birthday: row.birthdayMonth != null && row.birthdayDay != null ? { month: row.birthdayMonth, day: row.birthdayDay } : null,
  about: row.about, personalDetails: row.personalDetails, legacyNotes: row.notes ?? "",
});

/** A concurrency token, not an exported copy of private history. Every row is included. */
function fingerprintSql(ctx: Ctx, id: string): SQL<string> {
  return sql<string>`md5(
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from contact_notes n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from contact_needs n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from contact_activities n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from contact_opportunities n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from property_lists n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from contact_properties n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from transaction_parties n where n.contact_id=${id}::uuid),'[]'::jsonb)::text || '|' ||
    coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from audit_events n where n.safe_metadata->>'contactId' in (${contactFamilyIds(ctx.actor, id)})),'[]'::jsonb)::text
  )`;
}

async function facts(ctx: Ctx, id: string) {
  const result = await ctx.db.execute<{ notes: number; needs: number; activities: number; opportunities: number; fingerprint: string }>(sql`select
    (select count(*)::int from ${contactNotes} where ${contactNotes.contactId}=${id}::uuid) as notes,
    (select count(*)::int from ${contactNeeds} where ${contactNeeds.contactId}=${id}::uuid) as needs,
    (select count(*)::int from ${contactActivities} where ${contactActivities.contactId}=${id}::uuid) as activities,
    (select count(*)::int from ${contactOpportunities} where ${contactOpportunities.contactId}=${id}::uuid) as opportunities,
    ${fingerprintSql(ctx, id)} as fingerprint`);
  const linked = await ctx.db.select({ id: transactions.id }).from(transactionParties).innerJoin(transactions, eq(transactionParties.transactionId, transactions.id))
    .where(and(eq(transactionParties.contactId, id), visibleTransactions(ctx.actor)));
  const transactionIds = [...new Set(linked.map(row => row.id))];
  // List membership remains private even when an admin can see the linked contact.
  const visibleLists = and(eq(propertyLists.contactId, id), eq(propertyLists.ownerUserId, ctx.actor.userId), eq(propertyLists.brokerageKey, ctx.actor.brokerageKey), isNull(propertyLists.archivedAt));
  const lists = await ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(visibleLists);
  const saved = await ctx.db.select({ listId: contactProperties.listId, dataset: contactProperties.dataset, listingId: contactProperties.listingId }).from(contactProperties)
    .innerJoin(propertyLists, eq(contactProperties.listId, propertyLists.id))
    .where(and(eq(contactProperties.contactId, id), isNull(contactProperties.removedAt), visibleLists));
  const propertyKeys = saved.map(row => JSON.stringify([row.listId, row.dataset, row.listingId]));
  const row = result.rows[0];
  return { historyFingerprint: row.fingerprint, transactionIds, propertyKeys,
    counts: { notes: Number(row.notes), needs: Number(row.needs), activities: Number(row.activities), opportunities: Number(row.opportunities), transactions: transactionIds.length, properties: propertyKeys.length, propertyLists: lists.length } as MergeCounts };
}

async function rowsForMerge(ctx: Ctx, primaryId: string, duplicateId: string): Promise<ServiceResult<{ primary: ContactRow; duplicate: ContactRow }>> {
  if (!isRecordId(primaryId) || !isRecordId(duplicateId) || primaryId === duplicateId) return { ok: false, reason: "invalid_merge" };
  const rows = await ctx.db.select().from(contacts).where(and(inArray(contacts.id, [primaryId, duplicateId]), visibleTo(ctx.actor)));
  const primary = rows.find(row => row.id === primaryId), duplicate = rows.find(row => row.id === duplicateId);
  if (!primary || !duplicate) {
    const current = await ctx.db.select({ id: contacts.id, merged: contacts.mergedIntoContactId }).from(contacts).where(and(inArray(contacts.id, [primaryId, duplicateId]), visibleTo(ctx.actor, { includeMerged: true })));
    return { ok: false, reason: current.length === 2 && current.some(row => row.merged) ? "conflict" : "not_found" };
  }
  if (!canWrite(ctx.actor, primary) || !canWrite(ctx.actor, duplicate)) return { ok: false, reason: "forbidden" };
  if (primary.brokerageKey !== duplicate.brokerageKey || primary.assignedAgentUserId !== duplicate.assignedAgentUserId) return { ok: false, reason: "invalid_merge" };
  return { ok: true, value: { primary, duplicate } };
}

export async function getContactMergeReview(ctx: Ctx, primaryId: string, duplicateId: string): Promise<ServiceResult<MergeReview>> {
  const loaded = await rowsForMerge(ctx, primaryId, duplicateId);
  if (!loaded.ok) return loaded;
  const { primary, duplicate } = loaded.value;
  const [a, b, names] = await Promise.all([facts(ctx, primary.id), facts(ctx, duplicate.id), agentNames(ctx.db, [primary.nextActionAssignedUserId, duplicate.nextActionAssignedUserId].filter((value): value is string => Boolean(value)))]);
  const record = (row: ContactRow, info: typeof a): MergeReviewContact => ({
    id: row.id, name: displayName(row), updatedAt: row.updatedAt.toISOString(), historyFingerprint: info.historyFingerprint,
    values: valuesOf(row), nextAction: contactNextAction(row, row.nextActionAssignedUserId ? names.get(row.nextActionAssignedUserId) : undefined),
    ...(row.nextFollowUpAt ? { nextFollowUpDate: row.nextFollowUpAt.toISOString() } : {}), counts: info.counts,
  });
  const first = record(primary, a), second = record(duplicate, b), counts = mergeCounts(a.counts, b.counts);
  counts.transactions = new Set([...a.transactionIds, ...b.transactionIds]).size;
  counts.properties = new Set([...a.propertyKeys, ...b.propertyKeys]).size;
  return { ok: true, value: { primary: first, duplicate: second, defaults: defaultMergeChoices(first.values, second.values), conflicts: mergeConflicts(first.values, second.values), preservedCounts: counts } };
}

function hash(input: ContactMergeInput): string { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
async function replay(ctx: Ctx, requestId: string, payloadHash: string): Promise<ServiceResult<ContactMergeResult> | null> {
  const [receipt] = await ctx.db.select().from(contactMergeRequests).where(and(eq(contactMergeRequests.actorUserId, ctx.actor.userId), eq(contactMergeRequests.requestId, requestId))).limit(1);
  if (!receipt) return null;
  if (receipt.payloadHash !== payloadHash) return { ok: false, reason: "request_conflict" };
  const primary = await getContact(ctx, receipt.keeperId);
  if (!primary) return { ok: false, reason: "not_found" };
  return { ok: true, value: { primary, mergedContactId: receipt.sourceId, preservedCounts: receipt.result.preservedCounts as unknown as MergeCounts } };
}

/** Parent + child row locks, a fresh snapshot guard, and all writes share one transaction. */
export async function mergeContacts(ctx: Ctx, input: unknown, now = new Date()): Promise<ServiceResult<ContactMergeResult>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = contactMergeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_merge" };
  const d = parsed.data, payloadHash = hash(d);
  const previous = await replay(ctx, d.requestId, payloadHash);
  if (previous) return previous;
  const failOrReplay = async (reason: ServiceFailure): Promise<ServiceResult<ContactMergeResult>> => {
    try { return await replay(ctx, d.requestId, payloadHash) ?? { ok: false, reason }; }
    catch { return { ok: false, reason: "unavailable" }; }
  };
  const loaded = await rowsForMerge(ctx, d.primaryId, d.duplicateId);
  if (!loaded.ok) return failOrReplay(loaded.reason);
  const raw = loaded.value;
  if (!revisionMatches(raw.primary.updatedAt, d.expectedPrimaryUpdatedAt) || !revisionMatches(raw.duplicate.updatedAt, d.expectedDuplicateUpdatedAt)) return failOrReplay("conflict");
  const prepared = await getContactMergeReview(ctx, d.primaryId, d.duplicateId);
  if (!prepared.ok) return failOrReplay(prepared.reason);
  const review = prepared.value;
  if (review.primary.historyFingerprint !== d.expectedPrimaryHistoryFingerprint || review.duplicate.historyFingerprint !== d.expectedDuplicateHistoryFingerprint) return failOrReplay("conflict");
  if (d.nextActionChoice !== "none" && !review[d.nextActionChoice].nextAction && !review[d.nextActionChoice].nextFollowUpDate) return { ok: false, reason: "invalid_merge" };
  const selected = mergeValues(review, d.choices), action = chooseMergedAction(review, d.nextActionChoice), follow = chooseMergedFollowUp(review, d.nextActionChoice);
  if (selected.stage !== raw.primary.stage && !canTransition(raw.primary.stage, selected.stage)) return { ok: false, reason: "invalid_transition" };
  if (requiresEngagementNotice(raw.primary.stage, selected.stage) && !d.engagementAcknowledged) return { ok: false, reason: "invalid_merge" };
  const ids = [d.primaryId, d.duplicateId].sort();
  const expected = (id: string, revision: string, fingerprint: string) => sql`exists(select 1 from ${contacts} where ${and(eq(contacts.id, id), eq(contacts.assignedAgentUserId, raw.primary.assignedAgentUserId), visibleTo(ctx.actor), contactRevision(revision))}) and ${fingerprintSql(ctx, id)}=${fingerprint}`;
  const guard = sql`${expected(d.primaryId, d.expectedPrimaryUpdatedAt, d.expectedPrimaryHistoryFingerprint)} and ${expected(d.duplicateId, d.expectedDuplicateUpdatedAt, d.expectedDuplicateHistoryFingerprint)}`;
  const receiptId = randomUUID();
  const writes: BatchWrite[] = [
    ctx.db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, ids), visibleTo(ctx.actor))).orderBy(contacts.id).for("update"),
    ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(inArray(propertyLists.contactId, ids)).orderBy(propertyLists.id).for("update"),
    ctx.db.select({ id: contactNotes.id }).from(contactNotes).where(inArray(contactNotes.contactId, ids)).orderBy(contactNotes.id).for("update"),
    ctx.db.select({ id: contactNeeds.id }).from(contactNeeds).where(inArray(contactNeeds.contactId, ids)).orderBy(contactNeeds.id).for("update"),
    ctx.db.select({ id: contactActivities.id }).from(contactActivities).where(inArray(contactActivities.contactId, ids)).orderBy(contactActivities.id).for("update"),
    ctx.db.select({ id: contactOpportunities.id }).from(contactOpportunities).where(inArray(contactOpportunities.contactId, ids)).orderBy(contactOpportunities.id).for("update"),
    ctx.db.select({ id: transactionParties.id }).from(transactionParties).where(inArray(transactionParties.contactId, ids)).orderBy(transactionParties.id).for("update"),
    ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(inArray(contactProperties.contactId, ids)).orderBy(contactProperties.id).for("update"),
    // A refused snapshot violates this receipt's NOT NULL guard and aborts all writes.
    ctx.db.insert(contactMergeRequests).values({ id: receiptId, actorUserId: ctx.actor.userId, requestId: d.requestId, payloadHash,
      keeperId: sql`case when ${guard} then ${d.primaryId}::uuid else null end`, sourceId: d.duplicateId,
      result: { primaryId: d.primaryId, mergedContactId: d.duplicateId, preservedCounts: review.preservedCounts }, createdAt: now }),
    ctx.db.update(contactNotes).set({ contactId: d.primaryId }).where(eq(contactNotes.contactId, d.duplicateId)),
    ctx.db.update(contactNeeds).set({ contactId: d.primaryId }).where(eq(contactNeeds.contactId, d.duplicateId)),
    ctx.db.update(contactActivities).set({ contactId: d.primaryId }).where(eq(contactActivities.contactId, d.duplicateId)),
    ctx.db.update(contactOpportunities).set({ contactId: d.primaryId }).where(eq(contactOpportunities.contactId, d.duplicateId)),
    ctx.db.update(transactionParties).set({ contactId: d.primaryId }).where(eq(transactionParties.contactId, d.duplicateId)),
    // Preserve independently named lists, including empty and private lists. A property
    // saved to two different lists must remain a member of both after a contact merge.
    ctx.db.update(propertyLists).set({ contactId: d.primaryId }).where(eq(propertyLists.contactId, d.duplicateId)),
    ctx.db.update(contactProperties).set({ contactId: d.primaryId }).where(eq(contactProperties.contactId, d.duplicateId)),
  ];
  const keep = (value: string) => value || null;
  const touches = [raw.primary.lastContactAt, raw.duplicate.lastContactAt].filter((value): value is Date => Boolean(value));
  const tags = [...new Map([...raw.primary.tags, ...raw.duplicate.tags].map(tag => [tag.toLowerCase(), tag])).values()];
  writes.push(ctx.db.update(contacts).set({ firstName: keep(selected.name.firstName), lastName: keep(selected.name.lastName), preferredName: keep(selected.name.preferredName),
    email: keep(selected.email), phoneE164: keep(selected.phone), company: keep(selected.company), source: selected.source, stage: selected.stage,
    birthdayMonth: selected.birthday?.month ?? null, birthdayDay: selected.birthday?.day ?? null,
    about: selected.about, personalDetails: selected.personalDetails, notes: keep(selected.legacyNotes), tags,
    lastContactAt: touches.length ? new Date(Math.max(...touches.map(value => value.getTime()))) : null,
    createdAt: new Date(Math.min(raw.primary.createdAt.getTime(), raw.duplicate.createdAt.getTime())),
    nextActionId: action?.id ?? null, nextActionKind: action?.kind ?? null, nextActionPurpose: action?.purpose ?? null,
    nextActionDueAt: action ? new Date(action.dueAt) : null, nextActionAssignedUserId: action?.assigneeId ?? null,
    nextFollowUpAt: follow ? new Date(follow) : null, updatedAt: nextContactUpdatedAt(now), updatedByUserId: ctx.actor.userId,
  }).where(eq(contacts.id, d.primaryId)));
  for (const record of [review.primary, review.duplicate]) {
    if (record.nextAction && record.nextAction.id !== action?.id) writes.push(ctx.db.insert(contactActivities).values({ contactId: d.primaryId, actorUserId: ctx.actor.userId, kind: "task", summary: "Next action cancelled", occurredAt: now,
      safeMetadata: { event: "next_action_cancelled", actionId: record.nextAction.id, kind: record.nextAction.kind, purpose: record.nextAction.purpose, dueAt: record.nextAction.dueAt, assigneeId: record.nextAction.assigneeId, reason: "Not selected during the reviewed contact merge." } }));
    const legacy = record.values.legacyNotes;
    const chunks = legacy && legacy !== selected.legacyNotes ? splitLegacyNote(legacy, CONTACT_NOTE_MAX_LENGTH) : [];
    // Notes at one instant sort by UUID descending. Keep multi-part text in order.
    const noteIds = chunks.map(() => randomUUID()).sort().reverse();
    for (const [index, body] of chunks.entries()) {
      const noteId = noteIds[index];
      writes.push(ctx.db.insert(contactNotes).values({ id: noteId, contactId: d.primaryId, authorUserId: ctx.actor.userId, body, createdAt: now }));
      writes.push(ctx.db.insert(auditEvents).values({ eventType: "contact_note_created", actorUserId: ctx.actor.userId, safeMetadata: { contactId: d.primaryId, noteId, action: "create", mechanism: "merge", originalContactId: record.id } }));
    }
  }
  writes.push(ctx.db.insert(contactActivities).values({ contactId: d.primaryId, actorUserId: ctx.actor.userId, kind: "task", summary: "Contact files merged", occurredAt: now,
    safeMetadata: { event: "contact_merged", mergedContactId: d.duplicateId } }));
  writes.push(ctx.db.insert(auditEvents).values({ eventType: "contact_updated", actorUserId: ctx.actor.userId,
    safeMetadata: { contactId: d.primaryId, mergedContactId: d.duplicateId, event: "contact_merged", fields: Object.keys(d.choices), nextActionChoice: d.nextActionChoice } }));
  writes.push(ctx.db.update(contacts).set({ mergedIntoContactId: d.primaryId, updatedAt: nextContactUpdatedAt(now), updatedByUserId: ctx.actor.userId }).where(and(eq(contacts.mergedIntoContactId, d.duplicateId), eq(contacts.brokerageKey, raw.primary.brokerageKey), eq(contacts.assignedAgentUserId, raw.primary.assignedAgentUserId))));
  writes.push(ctx.db.update(contacts).set({ stage: "archived", mergedIntoContactId: d.primaryId, mergedAt: now,
    nextActionId: null, nextActionKind: null, nextActionPurpose: null, nextActionDueAt: null, nextActionAssignedUserId: null, nextFollowUpAt: null,
    updatedAt: nextContactUpdatedAt(now), updatedByUserId: ctx.actor.userId }).where(eq(contacts.id, d.duplicateId)));
  try { await ctx.db.batch(writes as unknown as Parameters<Db["batch"]>[0]); }
  catch (error) {
    const recovered = await replay(ctx, d.requestId, payloadHash);
    if (recovered) return recovered;
    let cause: unknown = error;
    for (let depth = 0; cause && typeof cause === "object" && depth < 6; depth++) {
      const current = cause as { code?: string; table?: string; column?: string; cause?: unknown };
      if (current.code === "23502" && current.table === "contact_merge_requests" && current.column === "keeper_id") return { ok: false, reason: "conflict" };
      cause = current.cause;
    }
    return { ok: false, reason: "unavailable" };
  }
  const primary = await getContact(ctx, d.primaryId);
  return primary ? { ok: true, value: { primary, mergedContactId: d.duplicateId, preservedCounts: review.preservedCounts } } : { ok: false, reason: "unavailable" };
}
