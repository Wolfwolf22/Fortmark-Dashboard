import "server-only";

/**
 * Client needs, server side — and the ONLY door to them.
 *
 * `getContactNeeds` is the authorization-aware read a future assistant or MLS
 * search service must use. It takes the same context as every other contacts
 * function, answers `not_found` for a contact the caller cannot see, and never
 * hands out a row from another book. Nothing reads `contact_needs` directly.
 *
 * Needs are private CRM data. The audit rows written here name the contact, the
 * need, the mechanism and the FIELD NAMES that changed — never the areas, the
 * money, the must-haves or the free-text requirements. There is no delete: a
 * need is paused, fulfilled or archived, so the relationship's history stays.
 *
 * A need write is not a touch and moves nothing on the contact.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { isRecordId } from "../db/ids.ts";
import { auditEvents, contactNeeds, type ContactNeedRow } from "../db/schema.ts";
import { loadContact } from "./access.ts";
import type { Ctx, ServiceResult } from "./service.ts";
import {
  createNeedSchema,
  planNeedUpdate,
  updateNeedSchema,
  type NeedFinancing,
  type NeedKind,
  type NeedPropertyType,
  type NeedStatus,
  type NeedView,
} from "./needs.ts";

type BatchWrite = Parameters<Db["batch"]>[0][number];

const STATUS_RANK: Record<NeedStatus, number> = { active: 0, paused: 1, fulfilled: 2, archived: 3 };

export function toNeedView(row: ContactNeedRow): NeedView {
  return {
    id: row.id,
    kind: row.kind as NeedKind,
    status: row.status as NeedStatus,
    propertyTypes: row.propertyTypes as NeedPropertyType[],
    areas: row.areas,
    priceMinCents: row.priceMinCents ?? null,
    priceMaxCents: row.priceMaxCents ?? null,
    minBeds: row.minBeds ?? null,
    minBaths: row.minBaths == null ? null : Number(row.minBaths),
    minSqft: row.minSqft ?? null,
    targetDate: row.targetDate ?? null,
    timelineNote: row.timelineNote ?? null,
    financing: (row.financing as NeedFinancing | null) ?? null,
    mustHaves: row.mustHaves,
    avoid: row.avoid,
    additionalRequirements: row.additionalRequirements ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** View-shaped changes → columns. Baths go in as an exact decimal string, never a float. */
function toColumns(set: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...set };
  if ("minBaths" in set) out.minBaths = set.minBaths == null ? null : String(set.minBaths);
  return out;
}

/**
 * A contact's needs: active first, then paused, fulfilled and archived, newest
 * change first within each. Scoped like a read of the contact itself.
 */
export async function getContactNeeds(ctx: Ctx, contactId: string): Promise<ServiceResult<NeedView[]>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  const rows = await ctx.db
    .select()
    .from(contactNeeds)
    .where(eq(contactNeeds.contactId, contactId))
    .orderBy(asc(contactNeeds.createdAt))
    .limit(100);
  const views = rows.map(toNeedView);
  views.sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
  );
  return { ok: true, value: views };
}

function auditWrite(
  ctx: Ctx,
  eventType: "contact_need_created" | "contact_need_updated" | "contact_need_status_changed",
  contactId: string,
  needId: string,
  metadata: Record<string, unknown>
): BatchWrite {
  return ctx.db.insert(auditEvents).values({
    eventType,
    actorUserId: ctx.actor.userId,
    targetUserId: null,
    safeMetadata: { contactId, needId, ...metadata },
  });
}

export async function createNeed(ctx: Ctx, contactId: string, input: unknown, now = new Date()): Promise<ServiceResult<NeedView>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const parsed = createNeedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_need" };
  const d = parsed.data;

  const id = randomUUID();
  try {
    await ctx.db.batch([
      ctx.db.insert(contactNeeds).values({
        id,
        contactId,
        kind: d.kind,
        status: d.status ?? "active",
        propertyTypes: d.propertyTypes ?? [],
        areas: d.areas ?? [],
        priceMinCents: d.priceMinCents ?? null,
        priceMaxCents: d.priceMaxCents ?? null,
        minBeds: d.minBeds ?? null,
        minBaths: d.minBaths == null ? null : String(d.minBaths),
        minSqft: d.minSqft ?? null,
        targetDate: d.targetDate ?? null,
        timelineNote: d.timelineNote ?? null,
        financing: d.financing ?? null,
        mustHaves: d.mustHaves ?? [],
        avoid: d.avoid ?? [],
        additionalRequirements: d.additionalRequirements ?? null,
        createdByUserId: ctx.actor.userId,
        updatedByUserId: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
      auditWrite(ctx, "contact_need_created", contactId, id, { mechanism: "create", kind: d.kind }),
    ] as unknown as Parameters<Db["batch"]>[0]);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const created = await ctx.db.select().from(contactNeeds).where(eq(contactNeeds.id, id)).limit(1);
  return created[0] ? { ok: true, value: toNeedView(created[0]) } : { ok: false, reason: "unavailable" };
}

export async function updateNeed(
  ctx: Ctx,
  contactId: string,
  needId: string,
  input: unknown,
  now = new Date()
): Promise<ServiceResult<{ need: NeedView; changed: string[] }>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!isRecordId(needId)) return { ok: false, reason: "not_found" };
  const found = await ctx.db
    .select()
    .from(contactNeeds)
    .where(and(eq(contactNeeds.id, needId), eq(contactNeeds.contactId, contactId)))
    .limit(1);
  if (!found[0]) return { ok: false, reason: "not_found" };
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const parsed = updateNeedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_need" };

  const current = toNeedView(found[0]);
  const plan = planNeedUpdate(current, parsed.data);
  if (!plan.ok) return { ok: false, reason: "invalid_need" };

  if (plan.changed.length > 0) {
    const otherFields = plan.changed.filter((f) => f !== "status");
    const writes: BatchWrite[] = [
      ctx.db
        .update(contactNeeds)
        .set({ ...toColumns(plan.set), updatedByUserId: ctx.actor.userId, updatedAt: now } as never)
        .where(and(eq(contactNeeds.id, needId), eq(contactNeeds.contactId, contactId))),
    ];
    if (otherFields.length > 0) {
      writes.push(auditWrite(ctx, "contact_need_updated", contactId, needId, { mechanism: "edit", fields: otherFields }));
    }
    if (plan.status) {
      writes.push(
        auditWrite(ctx, "contact_need_status_changed", contactId, needId, {
          mechanism: "status",
          fields: ["status"],
          from: plan.status.from,
          to: plan.status.to,
        })
      );
    }
    try {
      await ctx.db.batch(writes as unknown as Parameters<Db["batch"]>[0]);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
  const after = await ctx.db.select().from(contactNeeds).where(eq(contactNeeds.id, needId)).limit(1);
  return after[0] ? { ok: true, value: { need: toNeedView(after[0]), changed: plan.changed } } : { ok: false, reason: "unavailable" };
}

