/** Real services/list SQL against ephemeral PostgreSQL; no environment or network. */
import assert from "node:assert/strict";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { eq } from "drizzle-orm";
import { contactNeeds, dashboardUsers } from "../lib/db/schema.ts";
import { createContactSchema } from "../lib/contacts/domain.ts";
import { createContact, getContact, listContactsPage, type Ctx } from "../lib/contacts/service.ts";
import { createNeed, getContactNeeds, getContactNeedsPage, updateNeed } from "../lib/contacts/needs-service.ts";
import { needReadDetails, NEED_KINDS, NEED_STATUSES } from "../lib/contacts/needs.ts";
import { decodeNeedCursor, encodeNeedCursor, NEED_STATUS_RANK, readNeedsQuery, type NeedCursor } from "../lib/contacts/needs-pagination.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value {
  assert.ok(value, name);
  passed++;
}
const { pg, db } = await createLocalContactDb();
const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "admin" as const, brokerageKey: "fortmark" };
const ctx: Ctx = { actor, db };
const NOW = new Date("2026-10-29T15:00:00.000Z");
async function addContact(name: string, opportunities: { kind: "investor"; area: string; budgetMaxCents: number }[] = []) {
  const result = await createContact(ctx, createContactSchema.parse({ firstName: name, opportunities }));
  check(`created ${name}`, result.ok);
  return result.value;
}
async function list(query: Parameters<typeof listContactsPage>[1] = {}) {
  return listContactsPage(ctx, { ...query, page: 1, pageSize: 100 }, NOW);
}

try {
  await db.insert(dashboardUsers).values({ id: actor.userId, clerkUserId: "synthetic_needs_actor", primaryEmail: "synthetic@example.test", role: "admin", status: "active" });
  const contact = await addContact("Needs lifecycle");
  check("new contact has no invented intent, budget or area", contact.intent === "other" && contact.budget === undefined && contact.neighborhood === undefined);
  const created = await createNeed(ctx, contact.id, {
    kind: "buy", areas: ["Island 100%", "Second_Area"], priceMaxCents: 75_000_000,
    financing: "cash", mustHaves: ["Private requirement"], avoid: ["Private exclusion"], additionalRequirements: "Private detailed instruction",
  }, NOW);
  check("structured need created through real service", created.ok);
  const buying = await list({ intent: ["buy"] });
  check("new structured buying contact appears in Buying SQL filter", buying.items.some((c) => c.id === contact.id));
  const row = buying.items.find((c) => c.id === contact.id)!;
  check("list DTO uses structured intent/budget/areas", row.intent === "buy" && row.budget === 750_000 && row.neighborhood === "Island 100% · Second_Area");
  check("list DTO carries a revision", typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt)));
  check("search finds second structured area", (await list({ q: "second_area" })).items.some((c) => c.id === contact.id));
  check("structured area percent remains literal", (await list({ q: "100%" })).items.some((c) => c.id === contact.id) && !(await list({ q: "100_" })).items.some((c) => c.id === contact.id));
  for (const privateText of ["Private requirement", "Private exclusion", "Private detailed instruction", "cash"]) {
    check(`private requirement not searched: ${privateText}`, !(await list({ q: privateText })).items.some((c) => c.id === contact.id));
    check(`private requirement not in list DTO: ${privateText}`, !JSON.stringify(row).includes(privateText));
  }

  const reader: Ctx = { ...ctx, actor: { ...actor, role: "member" } };
  for (const status of NEED_STATUSES) {
    check(`status ${status} saves`, (await updateNeed(ctx, contact.id, created.value.id, { status }, NOW)).ok);
    const read = await getContactNeeds(reader, contact.id);
    check(`read-only viewer can read ${status} requirements`, read.ok && read.value[0].status === status);
    const details = needReadDetails(read.value[0]);
    check(`all ${status} requirements readable without editing`, ["Cash", "Private requirement", "Private exclusion", "Private detailed instruction"].every((v) => details.some((d) => d.values.includes(v))));
    check(`${status} contributes to Buying only while active`, (await list({ intent: ["buy"] })).items.some((c) => c.id === contact.id) === (status === "active"));
    const current = await getContact(ctx, contact.id);
    check(`${status} clears dormant budget and area`, status === "active" || (current?.budget === undefined && current?.neighborhood === undefined && current?.intent === "other"));
  }
  check("read-only viewer still cannot change a need", !(await updateNeed(reader, contact.id, created.value.id, { financing: "conventional" }, NOW)).ok);
  const outsider: Ctx = { ...ctx, actor: { ...actor, brokerageKey: "elsewhere" } };
  check("need areas cannot widen brokerage visibility", (await listContactsPage(outsider, { q: "Island", intent: ["buy"] }, NOW)).total === 0);
  check("private need read stays scoped", !(await getContactNeeds(outsider, contact.id)).ok);

  const legacy = await addContact("Legacy investor", [{ kind: "investor", area: "Legacy Harbor", budgetMaxCents: 90_000_000 }]);
  check("untouched legacy investor retains intent and budget", legacy.intent === "invest" && legacy.budget === 900_000 && legacy.neighborhood === "Legacy Harbor");
  check("legacy intent and area remain filterable", (await list({ intent: ["invest"], q: "Legacy Harbor" })).items.some((c) => c.id === legacy.id));
  const adopted = await createNeed(ctx, legacy.id, { kind: "rent", areas: ["New Harbor"], priceMaxCents: 400_000 }, NOW);
  check("legacy contact can adopt structured needs", adopted.ok);
  check("rent maps to lease in real SQL", (await list({ intent: ["lease"], q: "New Harbor" })).items.some((c) => c.id === legacy.id));
  check("structured rows suppress legacy area and investor filter", !(await list({ q: "Legacy Harbor" })).items.some((c) => c.id === legacy.id) && !(await list({ intent: ["invest"] })).items.some((c) => c.id === legacy.id));
  for (const status of ["paused", "fulfilled", "archived"] as const) {
    check(`adopted need becomes ${status}`, (await updateNeed(ctx, legacy.id, adopted.value.id, { status }, NOW)).ok);
    const current = await getContact(ctx, legacy.id);
    check(`${status} never resurrects legacy investor/budget/area`, current?.intent === "other" && current.budget === undefined && current.neighborhood === undefined);
    check(`${status} SQL also suppresses legacy intent/area`, !(await list({ intent: ["invest"] })).items.some((c) => c.id === legacy.id) && !(await list({ q: "Legacy Harbor" })).items.some((c) => c.id === legacy.id));
  }
  check("reactivation succeeds", (await updateNeed(ctx, legacy.id, adopted.value.id, { status: "active" }, NOW)).ok);
  check("reactivation restores same structured summary", (await getContact(ctx, legacy.id))?.intent === "lease");

  for (const kind of NEED_KINDS) {
    const c = await addContact(`Kind ${kind}`);
    const result = await createNeed(ctx, c.id, { kind, ...(kind === "other" ? { kindOther: "Synthetic other need" } : {}) }, NOW);
    check(`${kind} need saves`, result.ok);
    const expected = kind === "rent" || kind === "lease" ? "lease" : kind;
    check(`${kind} matches identical DTO and SQL intent`, (await getContact(ctx, c.id))?.intent === expected && (await list({ intent: [expected] })).items.some((r) => r.id === c.id));
  }
  const both = await addContact("Multiple active needs");
  const earlier = await createNeed(ctx, both.id, { kind: "buy", priceMaxCents: 60_000_000, areas: ["Area A"] }, NOW);
  const later = await createNeed(ctx, both.id, { kind: "sell", priceMaxCents: 80_000_000, areas: ["Area B", "area a"] }, new Date(NOW.getTime() + 1000));
  check("multiple active needs save", earlier.ok && later.ok);
  const bothRow = await getContact(ctx, both.id);
  check("buy and sell aggregate to Both", bothRow?.intent === "both" && (await list({ intent: ["both"] })).items.some((c) => c.id === both.id));
  check("budget uses most recently updated active need and areas deduplicate", bothRow?.budget === 800_000 && bothRow.neighborhood === "Area B · area a");
  check("latest need can explicitly leave upper budget absent", (await updateNeed(ctx, both.id, later.value.id, { priceMaxCents: null }, new Date(NOW.getTime() + 2000))).ok);
  check("an absent current upper budget never borrows another need's amount", (await getContact(ctx, both.id))?.budget === undefined);

  const paged = await addContact("Longstanding needs");
  const fixtures = Array.from({ length: 135 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    contactId: paged.id, kind: "buy" as const,
    status: i < 60 ? "active" as const : i < 100 ? "paused" as const : i < 120 ? "fulfilled" as const : "archived" as const,
    areas: [`Synthetic area ${i}`], createdAt: new Date(NOW.getTime() + i * 1000), updatedAt: NOW,
  }));
  await db.insert(contactNeeds).values(fixtures);
  const newest = await createNeed(ctx, paged.id, { kind: "sell", areas: ["New active after old 135"] }, new Date(NOW.getTime() + 100_000));
  check("a new active need can be added after 135 historical rows", newest.ok);
  const allRows = await db.select().from(contactNeeds).where(eq(contactNeeds.contactId, paged.id));
  const expected = allRows.sort((a, b) => NEED_STATUS_RANK[a.status] - NEED_STATUS_RANK[b.status] || b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id)).map((r) => r.id);
  const seen: string[] = [];
  let cursor: NeedCursor | undefined;
  let token: string | null = null;
  do {
    const page = await getContactNeedsPage(reader, paged.id, { pageSize: 25, cursor });
    check("each needs page reauthorizes read access", page.ok);
    check("each page is bounded to 25", page.value.items.length <= 25);
    check("page metadata agrees on continuation", page.value.hasMore === Boolean(page.value.nextCursor));
    seen.push(...page.value.items.map((n) => n.id));
    token = page.value.nextCursor;
    if (token) {
      cursor = decodeNeedCursor(token) ?? undefined;
      check("server needs cursor roundtrips", cursor !== undefined && readNeedsQuery(new URLSearchParams({ pageSize: "25", cursor: token }))?.cursor?.id === cursor.id);
      const denied = await getContactNeedsPage(outsider, paged.id, { pageSize: 25, cursor });
      check("an older-page cursor does not bypass scope", !denied.ok && denied.reason === "not_found");
    }
  } while (token);
  check("all 136 needs are reachable without duplicates or skips at tied timestamps", seen.length === 136 && new Set(seen).size === 136 && seen.join() === expected.join());
  check("new active need is first, not hidden behind the oldest100", seen[0] === newest.value.id);
  check("legacy bounded read also begins with newest active need", (await getContactNeeds(ctx, paged.id)).ok && (await getContactNeeds(ctx, paged.id) as { ok: true; value: { id: string }[] }).value[0].id === newest.value.id);
  for (const bad of ["", "bad!", encodeNeedCursor({ rank: 4, at: NOW.toISOString(), id: newest.value.id }), encodeNeedCursor({ rank: 0, at: "nope", id: newest.value.id }), encodeNeedCursor({ rank: 0, at: NOW.toISOString(), id: "not-an-id" })]) {
    check("malformed needs cursor is rejected", decodeNeedCursor(bad) === null);
  }
  for (const size of ["0", "101", "-1", "NaN", "1.5"]) check("unbounded/invalid page size is rejected", readNeedsQuery(new URLSearchParams({ pageSize: size })) === null);
  console.log(`\n${passed}/${passed} needs consistency checks passed (ephemeral PostgreSQL; no live access)`);
} finally {
  await pg.close();
}
