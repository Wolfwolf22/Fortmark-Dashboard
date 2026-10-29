import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { auditEvents, contacts, contactProperties, propertyLists, type ContactRow, type PropertyListRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { loadContact } from "./access.ts";
import { displayName } from "./domain.ts";
import { createPayloadHash, revisionMatches } from "./reliability.ts";
import type { Ctx, ServiceFailure } from "./service.ts";
import { visibleTo } from "./visibility.ts";
import { createPropertyListInputSchema, renamePropertyListInputSchema, PROPERTY_LIST_PAGE_SIZE, MAX_PROPERTY_LIST_PAGE_SIZE, type PropertyListView, type PropertyListsPage } from "./property-lists.ts";

export type PropertyListFailure = ServiceFailure | "invalid_property_list";
export type PropertyListResult<T> = { ok: true; value: T } | { ok: false; reason: PropertyListFailure };
export interface PropertyListScope { row: PropertyListRow; contact: ContactRow | null; writable: boolean }
type BatchInput = Parameters<Ctx["db"]["batch"]>[0];

/** An admin's visibility of a contact never grants access to somebody else's list. */
export function propertyListVisibility(ctx: Ctx) {
  return and(eq(propertyLists.ownerUserId, ctx.actor.userId), eq(propertyLists.brokerageKey, ctx.actor.brokerageKey), isNull(propertyLists.archivedAt),
    sql`(${propertyLists.contactId} is null or exists(select 1 from ${contacts} where ${contacts.id}=${propertyLists.contactId} and ${visibleTo(ctx.actor)}))`);
}
export async function loadPropertyList(ctx: Ctx, id: string): Promise<PropertyListResult<PropertyListScope>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(propertyLists).where(and(eq(propertyLists.id, id), propertyListVisibility(ctx))).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  const parent = row.contactId ? await loadContact(ctx, row.contactId) : null;
  if (parent && !parent.ok) return parent;
  return { ok: true, value: { row, contact: parent?.ok ? parent.row : null, writable: ctx.actor.role !== "member" && (!parent || parent.writable) } };
}
/** Locks always follow merge order: contact, then list, then membership. */
export function propertyListMutationGuard(ctx: Ctx, scope: PropertyListScope) {
  return and(eq(propertyLists.id, scope.row.id), propertyListVisibility(ctx), scope.row.contactId ? eq(propertyLists.contactId, scope.row.contactId) : isNull(propertyLists.contactId));
}
export function propertyListMutationLocks(ctx: Ctx, scope: PropertyListScope) {
  const locks = [];
  if (scope.row.contactId) locks.push(ctx.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, scope.row.contactId), visibleTo(ctx.actor))).for("update"));
  locks.push(ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(propertyListMutationGuard(ctx, scope)).for("update"));
  return locks;
}
export function propertyListNextUpdatedAt(now: Date) {
  return sql`greatest(date_trunc('milliseconds', ${propertyLists.updatedAt}) + interval '1 millisecond', ${now.toISOString()}::timestamptz)`;
}
export function batchRows(result: unknown, index: number): readonly unknown[] {
  return Array.isArray(result) && Array.isArray(result[index]) ? result[index] : [];
}
export function listAuditColumns(ctx: Ctx, row: { id: SQLWrapper; contactId: SQLWrapper }, action: string, now: Date) {
  return {
    id: sql<string>`${randomUUID()}::uuid`.as("id"), actorUserId: sql<string>`${ctx.actor.userId}::uuid`.as("actor_user_id"), targetUserId: sql<null>`null::uuid`.as("target_user_id"),
    eventType: sql<string>`'property_list_updated'::text`.as("event_type"),
    safeMetadata: sql<Record<string, unknown>>`jsonb_build_object('listId',${row.id},'contactId',${row.contactId},'action',${action}::text)`.as("safe_metadata"),
    createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"),
  };
}
async function listView(ctx: Ctx, row: PropertyListRow, contact?: ContactRow | null): Promise<PropertyListView> {
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(contactProperties).where(and(eq(contactProperties.listId, row.id), isNull(contactProperties.removedAt)));
  return { id: row.id, name: row.name, contactId: row.contactId, ...(contact ? { contactName: displayName(contact) } : {}), propertyCount: count?.n ?? 0, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function getPropertyList(ctx: Ctx, id: string): Promise<PropertyListResult<PropertyListView>> {
  const loaded = await loadPropertyList(ctx, id);
  return loaded.ok ? { ok: true, value: await listView(ctx, loaded.value.row, loaded.value.contact) } : loaded;
}
export async function getPropertyLists(ctx: Ctx, options: { page?: number; pageSize?: number; contactId?: string } = {}): Promise<PropertyListResult<PropertyListsPage>> {
  const page = options.page ?? 1, pageSize = options.pageSize ?? PROPERTY_LIST_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PROPERTY_LIST_PAGE_SIZE) return { ok: false, reason: "invalid_property_list" };
  if (options.contactId) { const parent = await loadContact(ctx, options.contactId); if (!parent.ok) return parent; }
  const where = and(propertyListVisibility(ctx), options.contactId ? eq(propertyLists.contactId, options.contactId) : undefined);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(propertyLists).where(where);
  const total = count?.n ?? 0, actual = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await ctx.db.select({ list: propertyLists, firstName: contacts.firstName, lastName: contacts.lastName, preferredName: contacts.preferredName,
    propertyCount: sql<number>`(select count(*)::int from ${contactProperties} where ${contactProperties.listId}=${propertyLists.id} and ${contactProperties.removedAt} is null)`,
  }).from(propertyLists).leftJoin(contacts, eq(contacts.id, propertyLists.contactId)).where(where).orderBy(desc(propertyLists.updatedAt), desc(propertyLists.id)).limit(pageSize).offset((actual - 1) * pageSize);
  const items: PropertyListView[] = rows.map(({ list: row, firstName, lastName, preferredName, propertyCount }) => ({
    id: row.id, name: row.name, contactId: row.contactId,
    ...(row.contactId ? { contactName: preferredName?.trim() || [firstName, lastName].filter(Boolean).join(" ").trim() || "Unnamed contact" } : {}),
    propertyCount, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }));
  return { ok: true, value: { items, total, page: actual, pageSize } };
}

async function insertList(ctx: Ctx, values: { name: string; contactId: string | null; requestId: string | null; payloadHash: string | null; defaultForContactId: string | null }, now: Date): Promise<void> {
  const parentGuard = values.contactId ? and(eq(contacts.id, values.contactId), visibleTo(ctx.actor)) : undefined;
  const inserted = ctx.db.$with("created_list").as(ctx.db.insert(propertyLists).select(ctx.db.select({
    id: sql<string>`${randomUUID()}::uuid`.as("id"), ownerUserId: sql<string>`${ctx.actor.userId}::uuid`.as("owner_user_id"), brokerageKey: sql<string>`${ctx.actor.brokerageKey}::text`.as("brokerage_key"),
    contactId: sql<string | null>`${values.contactId}::uuid`.as("contact_id"), name: sql<string>`${values.name}::text`.as("name"),
    createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"), updatedAt: sql<Date>`${now.toISOString()}::timestamptz`.as("updated_at"), archivedAt: sql<null>`null::timestamptz`.as("archived_at"),
    createRequestId: sql<string | null>`${values.requestId}::uuid`.as("create_request_id"), createPayloadHash: sql<string | null>`${values.payloadHash}::text`.as("create_payload_hash"),
    defaultForContactId: sql<string | null>`${values.defaultForContactId}::uuid`.as("default_for_contact_id"),
  }).from(sql`(select 1) as list_creation`).where(parentGuard ? sql`exists(select 1 from ${contacts} where ${parentGuard})` : sql`true`)).onConflictDoNothing().returning({ id: propertyLists.id, contactId: propertyLists.contactId }));
  const writes = [];
  if (parentGuard) writes.push(ctx.db.select({ id: contacts.id }).from(contacts).where(parentGuard).for("update"));
  writes.push(ctx.db.with(inserted).insert(auditEvents).select(ctx.db.select(listAuditColumns(ctx, inserted, "create", now)).from(inserted)));
  await ctx.db.batch(writes as unknown as BatchInput);
}

/** The list row is also its durable idempotency receipt; replay reauthorizes its current association. */
export async function createPropertyList(ctx: Ctx, input: unknown, now = new Date()): Promise<PropertyListResult<PropertyListView>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = createPropertyListInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_property_list" };
  const d = parsed.data, payloadHash = createPayloadHash({ name: d.name, contactId: d.contactId ?? null });
  const replay = async (): Promise<PropertyListResult<PropertyListView> | null> => {
    const [row] = await ctx.db.select().from(propertyLists).where(and(eq(propertyLists.ownerUserId, ctx.actor.userId), eq(propertyLists.createRequestId, d.requestId))).limit(1);
    if (!row) return null;
    if (row.createPayloadHash !== payloadHash) return { ok: false, reason: "request_conflict" };
    return getPropertyList(ctx, row.id);
  };
  const previous = await replay(); if (previous) return previous;
  if (d.contactId) { const parent = await loadContact(ctx, d.contactId); if (!parent.ok) return await replay() ?? parent; if (!parent.writable) return { ok: false, reason: "forbidden" }; }
  try { await insertList(ctx, { name: d.name, contactId: d.contactId ?? null, requestId: d.requestId, payloadHash, defaultForContactId: null }, now); }
  catch { try { return await replay() ?? { ok: false, reason: "unavailable" }; } catch { return { ok: false, reason: "unavailable" }; } }
  return await replay() ?? { ok: false, reason: "conflict" };
}

/** Compatibility targets one explicit original-contact default, never all contact memberships. */
export async function getContactDefaultPropertyList(ctx: Ctx, contactId: string, create = false, now = new Date()): Promise<PropertyListResult<PropertyListScope | null>> {
  const parent = await loadContact(ctx, contactId); if (!parent.ok) return parent;
  if (create && !parent.writable) return { ok: false, reason: "forbidden" };
  const find = async () => {
    const [row] = await ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(and(eq(propertyLists.ownerUserId, ctx.actor.userId), eq(propertyLists.brokerageKey, ctx.actor.brokerageKey), eq(propertyLists.defaultForContactId, contactId), isNull(propertyLists.archivedAt))).limit(1);
    return row ? loadPropertyList(ctx, row.id) : null;
  };
  const found = await find(); if (found) return found;
  if (!create) return { ok: true, value: null };
  try { await insertList(ctx, { name: "Saved properties", contactId, requestId: null, payloadHash: null, defaultForContactId: contactId }, now); }
  catch { const recovered = await find(); return recovered ?? { ok: false, reason: "unavailable" }; }
  return await find() ?? { ok: false, reason: "conflict" };
}

export async function renamePropertyList(ctx: Ctx, id: string, input: unknown, now = new Date()): Promise<PropertyListResult<PropertyListView>> {
  const loaded = await loadPropertyList(ctx, id); if (!loaded.ok) return loaded;
  const scope = loaded.value; if (!scope.writable) return { ok: false, reason: "forbidden" };
  const parsed = renamePropertyListInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_property_list" };
  if (!revisionMatches(scope.row.updatedAt, parsed.data.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  if (scope.row.name === parsed.data.name) return { ok: true, value: await listView(ctx, scope.row, scope.contact) };
  const changed = ctx.db.$with("renamed_list").as(ctx.db.update(propertyLists).set({ name: parsed.data.name, updatedAt: propertyListNextUpdatedAt(now) }).where(and(
    propertyListMutationGuard(ctx, scope), sql`date_trunc('milliseconds',${propertyLists.updatedAt})=${parsed.data.expectedUpdatedAt}::timestamptz`,
  )).returning({ id: propertyLists.id, contactId: propertyLists.contactId }));
  try {
    const writes = [...propertyListMutationLocks(ctx, scope), ctx.db.with(changed).insert(auditEvents).select(ctx.db.select(listAuditColumns(ctx, changed, "rename", now)).from(changed)).returning({ id: auditEvents.id })];
    const result = await ctx.db.batch(writes as unknown as BatchInput);
    return batchRows(result, writes.length - 1).length ? getPropertyList(ctx, id) : { ok: false, reason: "conflict" };
  } catch { return { ok: false, reason: "unavailable" }; }
}
