/** Selected Other descriptions: pure contracts and real isolated PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, contactNeeds, contacts, dashboardUsers } from "../lib/db/schema.ts";
import { eq } from "drizzle-orm";
import {
  createNeedSchema, updateNeedSchema, planNeedUpdate, summarizeNeed, needReadDetails,
  NEED_LIMITS, NEED_STATUSES, type NeedView,
} from "../lib/contacts/needs.ts";
import { createNeed, getContactNeeds, updateNeed } from "../lib/contacts/needs-service.ts";
import type { Ctx } from "../lib/contacts/service.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const base: NeedView = {
  id: randomUUID(), kind: "buy", status: "active", propertyTypes: [], areas: [], priceMinCents: null,
  priceMaxCents: null, minBeds: null, minBaths: null, minSqft: null, targetDate: null,
  timelineNote: null, financing: null, mustHaves: [], avoid: [], additionalRequirements: null,
  createdAt: "2026-10-29T15:00:00.000Z", updatedAt: "2026-10-29T15:00:00.000Z",
};
const selected = {
  kind: "other" as const, kindOther: "  Relocation consultation  ",
  propertyTypes: ["condo", "other"] as ("condo" | "other")[], propertyTypeOther: "  Co-op  ",
  financing: "other" as const, financingOther: "  Seller financing  ",
};
const parsed = createNeedSchema.safeParse(selected);
check("all selected Other choices accept their own descriptions", parsed.success);
check("custom descriptions are trimmed", parsed.data.kindOther === "Relocation consultation" && parsed.data.propertyTypeOther === "Co-op" && parsed.data.financingOther === "Seller financing");
for (const field of ["kindOther", "propertyTypeOther", "financingOther"] as const) {
  for (const empty of [undefined, null, "", "   "]) {
    const result = createNeedSchema.safeParse({ ...selected, [field]: empty });
    check(`${field} is required when its Other is selected`, !result.success && result.error.issues.some(issue => issue.path[0] === field));
  }
  check(`${field} accepts its exact cap`, createNeedSchema.safeParse({ ...selected, [field]: "x".repeat(NEED_LIMITS.otherDescription) }).success);
  check(`${field} rejects oversized text`, !createNeedSchema.safeParse({ ...selected, [field]: "x".repeat(NEED_LIMITS.otherDescription + 1) }).success);
  check(`${field} rejects non-text`, !createNeedSchema.safeParse({ ...selected, [field]: 123 }).success);
  check(`${field} rejects NUL before database persistence`, !createNeedSchema.safeParse({ ...selected, [field]: "Invalid\u0000text" }).success);
}
const inactive = createNeedSchema.parse({ kind: "buy", kindOther: "Unsaved draft", propertyTypeOther: "Unsaved property", financingOther: "Unsaved financing" });
check("inactive custom descriptions are cleared before create", inactive.kindOther === null && inactive.propertyTypeOther === null && inactive.financingOther === null);
check("ordinary needs still save without custom fields", createNeedSchema.safeParse({ kind: "buy", propertyTypes: ["condo"], financing: "cash" }).success);

const complete: NeedView = { ...base, ...parsed.data, propertyTypes: parsed.data.propertyTypes ?? [] };
const clear = planNeedUpdate(complete, updateNeedSchema.parse({ kind: "buy", propertyTypes: ["condo"], financing: "cash" }));
check("switching away clears all saved Other fields", clear.ok && clear.set.kindOther === null && clear.set.propertyTypeOther === null && clear.set.financingOther === null);
const stillOther = planNeedUpdate(complete, updateNeedSchema.parse({ kindOther: null }));
check("partial update cannot clear a still-selected required description", !stillOther.ok && stillOther.reason === "other");
check("existing complete Other supports unrelated partial edits", planNeedUpdate(complete, updateNeedSchema.parse({ areas: ["Synthetic area"] })).ok);
check("undefined patch fields leave existing descriptions intact", planNeedUpdate(complete, { kind: undefined }).ok && (planNeedUpdate(complete, { kind: undefined }) as { ok: true; changed: string[] }).changed.length === 0);
const legacy: NeedView = { ...base, kind: "other", propertyTypes: ["other"], financing: "other" };
check("legacy Other is readable without descriptions", summarizeNeed(legacy).headline === "Other" && summarizeNeed(legacy).lines.includes("Other") && needReadDetails(legacy).some(detail => detail.values.includes("Other")));
check("legacy Other can change status without inventing descriptions", planNeedUpdate(legacy, updateNeedSchema.parse({ status: "paused" })).ok);
check("legacy content save asks for missing descriptions", !planNeedUpdate(legacy, updateNeedSchema.parse({ areas: ["New area"] })).ok);
check("legacy Other can fill descriptions with a partial patch", planNeedUpdate(legacy, updateNeedSchema.parse({ kindOther: "Consultation", propertyTypeOther: "Co-op", financingOther: "Seller finance" })).ok);

const { pg, db } = await createLocalContactDb();
const actor = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: randomUUID() };
const ctx: Ctx = { actor, db };
const now = new Date("2026-10-29T15:00:00.000Z");
try {
  await db.insert(dashboardUsers).values([
    { id: actor.userId, clerkUserId: "synthetic_other_owner", primaryEmail: "owner@example.test", role: "agent", status: "active" },
    { id: other.userId, clerkUserId: "synthetic_other_outsider", primaryEmail: "outsider@example.test", role: "agent", status: "active" },
  ]);
  const contactId = randomUUID();
  await db.insert(contacts).values({ id: contactId, assignedAgentUserId: actor.userId, firstName: "Synthetic Other" });
  const created = await createNeed(ctx, contactId, selected, now);
  check("real service persists all selected Other fields", created.ok && created.value.kindOther === "Relocation consultation" && created.value.propertyTypeOther === "Co-op" && created.value.financingOther === "Seller financing");
  for (const field of ["kindOther", "propertyTypeOther", "financingOther"] as const) {
    const invalid = await createNeed(ctx, contactId, { ...selected, [field]: " " }, now);
    check(`server rejects blank selected ${field}`, !invalid.ok && invalid.reason === "invalid_need");
  }
  const reader: Ctx = { db, actor: { ...actor, role: "member" } };
  for (const status of NEED_STATUSES) {
    check(`Other need can become ${status}`, (await updateNeed(ctx, contactId, created.value.id, { status }, now)).ok);
    const read = await getContactNeeds(reader, contactId);
    check(`read-only reader sees descriptions while ${status}`, read.ok && read.value[0].kindOther === "Relocation consultation" && read.value[0].propertyTypeOther === "Co-op" && read.value[0].financingOther === "Seller financing");
    check(`Other descriptions summarize while ${status}`, read.ok && summarizeNeed(read.value[0]).headline.includes("Relocation consultation") && summarizeNeed(read.value[0]).lines.some(line => line.includes("Co-op")) && needReadDetails(read.value[0]).some(detail => detail.values.some(value => value.includes("Seller financing"))));
  }
  const deniedRead = await getContactNeeds({ db, actor: other }, contactId);
  check("Other descriptions do not widen contact visibility", !deniedRead.ok && deniedRead.reason === "not_found");
  const deniedWrite = await updateNeed(reader, contactId, created.value.id, { kindOther: "Cannot save" }, now);
  check("read-only member cannot change descriptions", !deniedWrite.ok && deniedWrite.reason === "forbidden");
  const switchAway = await updateNeed(ctx, contactId, created.value.id, { kind: "buy", propertyTypes: ["condo"], financing: null, kindOther: "Hidden draft", propertyTypeOther: "Hidden draft", financingOther: "Hidden draft" }, now);
  check("real update clears inactive descriptions even if submitted", switchAway.ok && switchAway.value.need.kindOther === null && switchAway.value.need.propertyTypeOther === null && switchAway.value.need.financingOther === null);
  const [stored] = await db.select().from(contactNeeds).where(eq(contactNeeds.id, created.value.id));
  check("inactive descriptions are physically null in PostgreSQL", stored.kindOther === null && stored.propertyTypeOther === null && stored.financingOther === null);
  const switchBack = await updateNeed(ctx, contactId, created.value.id, { kind: "other" }, now);
  check("switching back cannot resurrect a cleared description", !switchBack.ok && switchBack.reason === "invalid_need");

  const legacyId = randomUUID();
  await db.insert(contactNeeds).values({ id: legacyId, contactId, kind: "other", propertyTypes: ["other"], financing: "other" });
  const legacyRead = await getContactNeeds(ctx, contactId);
  check("real legacy rows remain readable after migration", legacyRead.ok && legacyRead.value.some(need => need.id === legacyId && need.kindOther === null && need.propertyTypeOther === null && need.financingOther === null));
  check("real legacy status transition remains supported", (await updateNeed(ctx, contactId, legacyId, { status: "paused" }, now)).ok);
  const legacyEdit = await updateNeed(ctx, contactId, legacyId, { additionalRequirements: "Unrelated content edit" }, now);
  check("legacy content edit cannot silently retain unspecified Other", !legacyEdit.ok && legacyEdit.reason === "invalid_need");
  check("real legacy Other can be completed", (await updateNeed(ctx, contactId, legacyId, { kindOther: "Consultation", propertyTypeOther: "Co-op", financingOther: "Private lending" }, now)).ok);
  const audit = await db.select().from(auditEvents);
  check("custom private descriptions never enter audit metadata", audit.every(event => !/Relocation consultation|Co-op|Seller financing|Private lending|Hidden draft/.test(JSON.stringify(event.safeMetadata))));

  // The database also bounds active descriptions and rejects stale inactive
  // custom text; null remains legal for old rows, by design.
  for (const columns of [
    { kind: "buy", kindOther: "Invalid inactive" },
    { kind: "buy", propertyTypes: [], propertyTypeOther: "Invalid inactive" },
    { kind: "buy", financing: null, financingOther: "Invalid inactive" },
    { kind: "other", kindOther: " " },
    { kind: "other", kindOther: "x".repeat(NEED_LIMITS.otherDescription + 1) },
    { kind: "buy", propertyTypes: ["other"], propertyTypeOther: "x".repeat(NEED_LIMITS.otherDescription + 1) },
    { kind: "buy", financing: "other", financingOther: "x".repeat(NEED_LIMITS.otherDescription + 1) },
  ]) {
    let rejected = false;
    try { await db.insert(contactNeeds).values({ contactId, ...columns } as typeof contactNeeds.$inferInsert); } catch { rejected = true; }
    check("PostgreSQL rejects invalid custom-description state", rejected);
  }
  console.log(`${passed}/${passed} Other need checks passed (isolated PostgreSQL; no live access)`);
} finally { await pg.close(); }
