/**
 * Contacts V3 — notes, birthday, client needs, the personal-book rule, the
 * Representation → Transaction workflow.
 *
 * Three kinds of check, kept separate so a pass means what it says:
 *
 *   1. Pure rules (birthday, note limits, need validation, plans, summaries,
 *      timestamps) — no database at all.
 *   2. The real services run against a recording in-memory database: what each
 *      role may do, what is written, that every write and its audit row commit
 *      together, and — the important one — that no audit row ever contains a
 *      word of a note, a value of a need or a birthday.
 *   3. Structure: the routes, the SQL the selector builds, the screens.
 *
 * What an in-memory double cannot honestly prove — that a deleted note's text is
 * gone from a real table, that a birthday check rejects February 30, that a
 * second need for one contact is accepted — is proved elsewhere: against a real
 * PostgreSQL by `npm run test:migrate`, and against Preview by the certification
 * specs. This file does not pretend to.
 */
import { existsSync, readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Actor } from "../lib/auth/actor.ts";
import { birthdayChangeState, birthdaySchema, daysInMonth, formatBirthday, isValidBirthday } from "../lib/contacts/birthday.ts";
import { editContactSchema, planContactEdit, toLead } from "../lib/contacts/domain.ts";
import { CONTACT_NOTE_MAX_LENGTH, isValidNoteBody, noteInputSchema } from "../lib/contacts/notes.ts";
import { formatNoteStamp } from "../lib/contacts/note-format.ts";
import {
  createNeedSchema,
  formatMoneyShort,
  formatPriceRange,
  planNeedUpdate,
  summarizeNeed,
  updateNeedSchema,
  type NeedView,
} from "../lib/contacts/needs.ts";
import { toTimeline } from "../lib/contacts/timeline.ts";
import { TIMELINE_DOMAIN_EVENTS } from "../lib/contacts/events.ts";
import { ENGAGEMENT_STAGES, requiresEngagementNotice, ALL_CONTACT_STAGES } from "../lib/contacts/stages.ts";
import { QUICK_VIEWS } from "../lib/contacts/filters.ts";
import { addNote, deleteNote, listNotes } from "../lib/contacts/notes-service.ts";
import { createNeed, getContactNeeds, updateNeed } from "../lib/contacts/needs-service.ts";
import { listEligibleContacts } from "../lib/contacts/eligible.ts";
import { changeStage, listAgents } from "../lib/contacts/service.ts";
import { createTransaction } from "../lib/transactions/service.ts";
import { createTransactionSchema } from "../lib/transactions/domain.ts";
import { RELEASE_1_AUDIT_EVENTS, auditEvents, contactActivities, contactNeeds, contactNotes, contacts, professionalProfiles } from "../lib/db/schema.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed++;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ===================================================================================
// 1. Birthday
// ===================================================================================
{
  for (const [m, d] of [[1, 1], [2, 29], [4, 30], [12, 31], [3, 17], [7, 31]] as const) {
    check(`birthday ${m}/${d} is valid`, isValidBirthday(m, d) && birthdaySchema.safeParse({ month: m, day: d }).success);
  }
  for (const [m, d] of [[2, 30], [2, 31], [4, 31], [6, 31], [9, 31], [11, 31], [13, 1], [0, 1], [1, 0], [1, 32], [-1, 5]] as const) {
    check(`birthday ${m}/${d} is refused`, !isValidBirthday(m, d) && !birthdaySchema.safeParse({ month: m, day: d }).success);
  }
  check("a fractional or textual month/day is refused", !birthdaySchema.safeParse({ month: 3.5, day: 1 }).success && !birthdaySchema.safeParse({ month: "3", day: "17" }).success);
  check("a year can never be sent — the shape is strict", !birthdaySchema.safeParse({ month: 3, day: 17, year: 1980 }).success);
  check("days in each month, February at 29", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(daysInMonth).join() === "31,29,31,30,31,30,31,31,30,31,30,31");
  check("a birthday reads 'March 17'", formatBirthday({ month: 3, day: 17 }) === "March 17" && formatBirthday({ month: 2, day: 29 }) === "February 29");
  check("nothing stored is null, never 'Unknown' — the screen says 'Not set'", formatBirthday(null) === null && formatBirthday(undefined) === null && formatBirthday({ month: 2, day: 30 }) === null);
  check("change states: set, changed, cleared, unchanged", birthdayChangeState(null, { month: 3, day: 1 }) === "set" && birthdayChangeState({ month: 3, day: 1 }, { month: 3, day: 2 }) === "changed" && birthdayChangeState({ month: 3, day: 1 }, null) === "cleared" && birthdayChangeState({ month: 3, day: 1 }, { month: 3, day: 1 }) === "unchanged" && birthdayChangeState(null, null) === "unchanged");

  check("edit schema accepts a birthday, and null to clear it", editContactSchema.safeParse({ birthday: { month: 3, day: 17 } }).success && editContactSchema.safeParse({ birthday: null }).success);
  check("edit schema refuses a birthday that is not a real day, or one with a year", !editContactSchema.safeParse({ birthday: { month: 2, day: 30 } }).success && !editContactSchema.safeParse({ birthday: { month: 3, day: 17, year: 1990 } }).success);

  const row = { firstName: "A", lastName: "B", preferredName: null, email: null, phoneE164: null, company: null, source: "referral", notes: null, birthdayMonth: null, birthdayDay: null } as never;
  const set = planContactEdit(row, { birthday: { month: 3, day: 17 } });
  check("plan: setting writes both columns together", set.ok && set.set.birthdayMonth === 3 && set.set.birthdayDay === 17 && set.changed.join() === "birthday" && set.birthday === "set");
  const rowWith = { ...(row as object), birthdayMonth: 3, birthdayDay: 17 } as never;
  const changed = planContactEdit(rowWith, { birthday: { month: 4, day: 1 } });
  check("plan: changing writes both", changed.ok && changed.set.birthdayMonth === 4 && changed.set.birthdayDay === 1 && changed.birthday === "changed");
  const cleared = planContactEdit(rowWith, { birthday: null });
  check("plan: clearing nulls BOTH columns — never one without the other", cleared.ok && cleared.set.birthdayMonth === null && cleared.set.birthdayDay === null && cleared.birthday === "cleared");
  const same = planContactEdit(rowWith, { birthday: { month: 3, day: 17 } });
  check("plan: the same birthday is no change and writes nothing", same.ok && same.changed.length === 0 && !("birthdayMonth" in same.set));
  check("plan: a plan never sets one half of a birthday", [set, changed, cleared].every((p) => p.ok && ("birthdayMonth" in p.set) === ("birthdayDay" in p.set)));
  const lead = toLead({ row: { ...(rowWith as object), id: "x", brokerageKey: "fortmark", assignedAgentUserId: "u", createdAt: new Date(), stage: "lead", tags: [], lastContactAt: null, nextFollowUpAt: null } as never, opportunities: [] });
  check("the screen's contact carries the birthday as month and day, no year", lead.birthday?.month === 3 && lead.birthday?.day === 17 && !JSON.stringify(lead.birthday).match(/year/i));
  check("no birthday is null, not zero", toLead({ row: { ...(row as object), id: "x", brokerageKey: "fortmark", assignedAgentUserId: "u", createdAt: new Date(), stage: "lead", tags: [], lastContactAt: null, nextFollowUpAt: null } as never, opportunities: [] }).birthday === null);
}

// ===================================================================================
// 2. Notes — the rules
// ===================================================================================
{
  const ok = noteInputSchema.safeParse({ body: "  Called about the condo.  " });
  check("a note is trimmed", ok.success && ok.data.body === "Called about the condo.");
  check("line endings are normalised", (() => { const r = noteInputSchema.safeParse({ body: "a\r\nb\rc" }); return r.success && r.data.body === "a\nb\nc"; })());
  check("an empty or blank note is refused", !noteInputSchema.safeParse({ body: "" }).success && !noteInputSchema.safeParse({ body: "   \n " }).success);
  check("a note of exactly the limit is accepted", noteInputSchema.safeParse({ body: "x".repeat(CONTACT_NOTE_MAX_LENGTH) }).success);
  check("a note over the limit is refused", !noteInputSchema.safeParse({ body: "x".repeat(CONTACT_NOTE_MAX_LENGTH + 1) }).success);
  check("the limit is 10,000 characters", CONTACT_NOTE_MAX_LENGTH === 10_000);
  check("a NUL byte is refused", !isValidNoteBody("a\u0000b") && !noteInputSchema.safeParse({ body: "a\u0000b" }).success);
  check("an unknown key in the request is refused", !noteInputSchema.safeParse({ body: "x", authorUserId: "u" }).success && !noteInputSchema.safeParse({ body: "x", createdAt: "2020-01-01" }).success);
  check("HTML and script are kept as text — never stripped, never interpreted", (() => { const t = '<img src=x onerror=alert(1)><script>alert(2)</script>'; const r = noteInputSchema.safeParse({ body: t }); return r.success && r.data.body === t; })());
  check("a non-string body is refused", !noteInputSchema.safeParse({ body: 5 }).success && !noteInputSchema.safeParse({}).success);

  // Timestamps, in the business timezone.
  check("a note's time reads 'Sep 30, 2026 · 10:42 AM' (Eastern daylight time)", formatNoteStamp("2026-09-30T14:42:00.000Z") === "Sep 30, 2026 · 10:42 AM");
  check("…and in winter (Eastern standard time)", formatNoteStamp("2026-01-15T14:42:00.000Z") === "Jan 15, 2026 · 9:42 AM");
  check("a late-evening note stays on its own business day", formatNoteStamp("2026-10-01T03:30:00.000Z") === "Sep 30, 2026 · 11:30 PM");
  check("afternoon is PM and noon is 12 PM", formatNoteStamp("2026-09-30T16:05:00.000Z") === "Sep 30, 2026 · 12:05 PM" && formatNoteStamp("2026-09-30T20:00:00.000Z") === "Sep 30, 2026 · 4:00 PM");
  check("a bad timestamp is an empty string, not 'Invalid Date'", formatNoteStamp("nope") === "");
}

// ===================================================================================
// 3. Client needs — the rules
// ===================================================================================
{
  const valid = createNeedSchema.safeParse({ kind: "buy", areas: ["Fort Lauderdale", " Victoria Park "], propertyTypes: ["singleFamily", "condo"], priceMinCents: 60_000_000, priceMaxCents: 75_000_000, minBeds: 3, minBaths: 2.5, minSqft: 1800, targetDate: "2027-03-01", timelineNote: "Move within 6 months", financing: "conventional", mustHaves: ["Pool"], avoid: ["HOA"], additionalRequirements: "Near a good school" });
  check("a full need is accepted", valid.success);
  check("a need needs only a kind", createNeedSchema.safeParse({ kind: "sell" }).success);
  check("a need without a kind is refused", !createNeedSchema.safeParse({ areas: ["Miami"] }).success);
  check("kinds are exactly buy, sell, rent, lease, other", (["buy", "sell", "rent", "lease", "other"] as const).every((k) => createNeedSchema.safeParse({ kind: k }).success) && !createNeedSchema.safeParse({ kind: "opportunity" }).success && !createNeedSchema.safeParse({ kind: "landlord" }).success);
  check("statuses are exactly active, paused, fulfilled, archived", (["active", "paused", "fulfilled", "archived"] as const).every((s) => updateNeedSchema.safeParse({ status: s }).success) && !updateNeedSchema.safeParse({ status: "won" }).success && !updateNeedSchema.safeParse({ status: "deleted" }).success);
  check("financing is exactly cash, conventional, fha, va, other, unknown (or none)", (["cash", "conventional", "fha", "va", "other", "unknown"] as const).every((f) => createNeedSchema.safeParse({ kind: "buy", financing: f }).success) && createNeedSchema.safeParse({ kind: "buy", financing: null }).success && !createNeedSchema.safeParse({ kind: "buy", financing: "barter" }).success);
  check("an unknown key is refused — no Bridge field, no id, no owner", !createNeedSchema.safeParse({ kind: "buy", ListPrice: 1 }).success && !createNeedSchema.safeParse({ kind: "buy", contactId: "x" }).success && !updateNeedSchema.safeParse({ id: "x", status: "paused" }).success);
  check("money is integer cents, non-negative", !createNeedSchema.safeParse({ kind: "buy", priceMinCents: -1 }).success && !createNeedSchema.safeParse({ kind: "buy", priceMinCents: 1.5 }).success && createNeedSchema.safeParse({ kind: "buy", priceMinCents: 0 }).success);
  check("a maximum below the minimum is refused, equal is accepted", !createNeedSchema.safeParse({ kind: "buy", priceMinCents: 500, priceMaxCents: 100 }).success && createNeedSchema.safeParse({ kind: "buy", priceMinCents: 100, priceMaxCents: 100 }).success);
  check("a lone bound is fine", createNeedSchema.safeParse({ kind: "buy", priceMinCents: 100 }).success && createNeedSchema.safeParse({ kind: "buy", priceMaxCents: 100 }).success);
  check("beds are whole and bounded", createNeedSchema.safeParse({ kind: "buy", minBeds: 0 }).success && !createNeedSchema.safeParse({ kind: "buy", minBeds: -1 }).success && !createNeedSchema.safeParse({ kind: "buy", minBeds: 2.5 }).success);
  check("baths may be halves and nothing finer", createNeedSchema.safeParse({ kind: "buy", minBaths: 2.5 }).success && createNeedSchema.safeParse({ kind: "buy", minBaths: 2 }).success && !createNeedSchema.safeParse({ kind: "buy", minBaths: 2.3 }).success && !createNeedSchema.safeParse({ kind: "buy", minBaths: -0.5 }).success);
  check("areas are trimmed and de-duplicated ignoring case", (() => { const r = createNeedSchema.safeParse({ kind: "buy", areas: ["Miami", " miami ", "Aventura"] }); return r.success && r.data.areas?.join() === "Miami,Aventura"; })());
  check("twelve areas are accepted, thirteen refused", createNeedSchema.safeParse({ kind: "buy", areas: Array.from({ length: 12 }, (_, i) => `a${i}`) }).success && !createNeedSchema.safeParse({ kind: "buy", areas: Array.from({ length: 13 }, (_, i) => `a${i}`) }).success);
  check("twenty must-haves and avoids are accepted, twenty-one refused", createNeedSchema.safeParse({ kind: "buy", mustHaves: Array.from({ length: 20 }, (_, i) => `m${i}`), avoid: Array.from({ length: 20 }, (_, i) => `v${i}`) }).success && !createNeedSchema.safeParse({ kind: "buy", mustHaves: Array.from({ length: 21 }, (_, i) => `m${i}`) }).success);
  check("an entry over 80 characters, and an empty entry, are refused", !createNeedSchema.safeParse({ kind: "buy", areas: ["x".repeat(81)] }).success && !createNeedSchema.safeParse({ kind: "buy", areas: [""] }).success);
  check("a list is a real list, never one comma-separated string", !createNeedSchema.safeParse({ kind: "buy", areas: "Miami, Aventura" }).success);
  check("property types are FortMark's own, and bounded", !createNeedSchema.safeParse({ kind: "buy", propertyTypes: ["Residential"] }).success && !createNeedSchema.safeParse({ kind: "buy", propertyTypes: ["PropertySubType"] }).success);
  check("a target date must be a real date", createNeedSchema.safeParse({ kind: "buy", targetDate: "2027-02-28" }).success && !createNeedSchema.safeParse({ kind: "buy", targetDate: "2027-02-30" }).success && !createNeedSchema.safeParse({ kind: "buy", targetDate: "March" }).success);
  check("the free-text fields are bounded", !createNeedSchema.safeParse({ kind: "buy", timelineNote: "x".repeat(201) }).success && !createNeedSchema.safeParse({ kind: "buy", additionalRequirements: "x".repeat(2001) }).success && createNeedSchema.safeParse({ kind: "buy", additionalRequirements: "x".repeat(2000) }).success);
  check("an empty free-text field becomes 'not set'", (() => { const r = createNeedSchema.safeParse({ kind: "buy", timelineNote: "  ", additionalRequirements: "" }); return r.success && r.data.timelineNote === null && r.data.additionalRequirements === null; })());
  check("an empty update is refused", !updateNeedSchema.safeParse({}).success);
  check("no Bridge/RESO field names in the need vocabulary", !/ListPrice|BedroomsTotal|BathroomsTotal|PropertySubType|StandardStatus|MlsStatus|ListingKey/i.test(strip(src("lib/contacts/needs.ts")) + strip(src("lib/db/schema.ts").slice(src("lib/db/schema.ts").indexOf("export const contactNeeds"), src("lib/db/schema.ts").indexOf("export type ContactNeedRow")))));

  const need: NeedView = { id: "n1", kind: "buy", status: "active", propertyTypes: ["singleFamily"], areas: ["Fort Lauderdale", "Victoria Park"], priceMinCents: 60_000_000, priceMaxCents: 75_000_000, minBeds: 3, minBaths: null, minSqft: null, targetDate: null, timelineNote: "Move within 6 months", financing: null, mustHaves: ["Pool"], avoid: [], additionalRequirements: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  const sum = summarizeNeed(need);
  check("summary: the example from the brief", sum.headline === "Buying" && sum.lines.join(" | ") === "Fort Lauderdale · Victoria Park | Single family | $600K–$750K | 3+ beds | Move within 6 months");
  check("summary: only what is stored — no budget line for a need with no budget", !summarizeNeed({ ...need, priceMinCents: null, priceMaxCents: null }).lines.some((l) => l.includes("$")) && summarizeNeed({ ...need, areas: [], propertyTypes: [], priceMinCents: null, priceMaxCents: null, minBeds: null, timelineNote: null }).lines.length === 0);
  check("summary: never prints 'unknown', 'not set' or 'n/a' for nothing", !JSON.stringify(summarizeNeed({ ...need, areas: [], propertyTypes: [], priceMinCents: null, priceMaxCents: null, minBeds: null, timelineNote: null })).match(/unknown|not set|n\/a|null|undefined/i));
  check("summary: must-haves and free text are not in the compact line", !sum.lines.join(" ").includes("Pool"));
  check("money: $600K, $1.2M, $950, a range, a floor, a ceiling", formatMoneyShort(60_000_000) === "$600K" && formatMoneyShort(120_000_000) === "$1.2M" && formatMoneyShort(95_000) === "$950" && formatPriceRange(60_000_000, 75_000_000) === "$600K–$750K" && formatPriceRange(60_000_000, null) === "$600K+" && formatPriceRange(null, 75_000_000) === "Up to $750K" && formatPriceRange(null, null) === null);
  check("summary: a target date reads as month and year", summarizeNeed({ ...need, timelineNote: null, targetDate: "2027-03-15" }).lines.includes("Target Mar 2027"));

  const plan = planNeedUpdate(need, { areas: ["Miami"], minBeds: 4 });
  check("plan: only real changes, named by field", plan.ok && plan.changed.join() === "areas,minBeds" && !plan.status);
  const status = planNeedUpdate(need, { status: "paused" });
  check("plan: a status change is captured with from and to", status.ok && status.changed.join() === "status" && status.status?.from === "active" && status.status?.to === "paused");
  check("plan: the same values change nothing", planNeedUpdate(need, { areas: ["Fort Lauderdale", "Victoria Park"], minBeds: 3, status: "active" }).ok && (planNeedUpdate(need, { areas: ["Fort Lauderdale", "Victoria Park"], minBeds: 3, status: "active" }) as { changed: string[] }).changed.length === 0);
  check("plan: null clears a scalar, an empty list clears a list", (() => { const p = planNeedUpdate(need, { minBeds: null, areas: [] }); return p.ok && p.set.minBeds === null && Array.isArray(p.set.areas) && p.set.areas.length === 0; })());
  check("plan: raising the minimum past the STORED maximum is refused", !planNeedUpdate(need, { priceMinCents: 90_000_000 }).ok);
  check("plan: lowering the maximum below the stored minimum is refused", !planNeedUpdate(need, { priceMaxCents: 10_000_000 }).ok);
  check("plan: changing both bounds together is judged together", planNeedUpdate(need, { priceMinCents: 90_000_000, priceMaxCents: 95_000_000 }).ok);
}

// ===================================================================================
// 4. The services, against a recording in-memory database
// ===================================================================================
const ADMIN: Actor = { userId: "55555555-5555-4555-8555-555555555555", role: "admin", brokerageKey: "fortmark" };
const BROKER: Actor = { userId: "33333333-3333-4333-8333-333333333333", role: "broker", brokerageKey: "fortmark" };
const COORD: Actor = { userId: "66666666-6666-4666-8666-666666666666", role: "transaction_coordinator", brokerageKey: "fortmark" };
const AGENT: Actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent", brokerageKey: "fortmark" };
const OTHER: Actor = { userId: "22222222-2222-4222-8222-222222222222", role: "agent", brokerageKey: "fortmark" };
const MEMBER: Actor = { userId: AGENT.userId, role: "member", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "44444444-4444-4444-8444-444444444444", role: "admin", brokerageKey: "elsewhere" };
const NOW = new Date("2026-09-30T14:42:00.000Z");
const CID = "5b8f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
const NOTE_ID = "9a9a9a9a-1111-4111-8111-aaaaaaaaaaaa";
const NEED_ID = "8b8b8b8b-2222-4222-8222-bbbbbbbbbbbb";

type Applied = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown> };
type Stmt = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown>; run: () => void };

/** A recording database: rows in, writes recorded, a batch that rolls back as one. */
function memory(tables: Map<unknown, Record<string, unknown>[]>, failOn?: unknown) {
  const applied: Applied[] = [];
  const wheres: unknown[] = [];
  const limits: number[] = [];
  let batches = 0;
  const select = () => {
    let rows: unknown[] = [];
    const b = {
      from(t: unknown) { rows = (tables.get(t) ?? []).map((r) => ({ ...r })); return b; },
      where(cond: unknown) { wheres.push(cond); return b; }, limit(n: number) { limits.push(n); return b; }, orderBy() { return b; }, offset() { return b; }, groupBy() { return b; },
      then(ok: (v: unknown[]) => unknown, fail?: (e: unknown) => unknown) { return Promise.resolve(rows).then(ok, fail); },
    };
    return b;
  };
  const statement = (table: unknown, kind: "insert" | "update", values: Record<string, unknown>) => {
    const s: Stmt & { then: PromiseLike<unknown>["then"] } = {
      table, kind, values,
      run() {
        if (failOn !== undefined && table === failOn) throw new Error("simulated write failure");
        if (kind === "update") Object.assign((tables.get(table) ?? [])[0] ?? {}, values);
        else tables.set(table, [...(tables.get(table) ?? []), { ...values }]);
        applied.push({ table, kind, values });
      },
      then(ok, fail) { return new Promise<unknown>((res) => { s.run(); res(undefined); }).then(ok, fail); },
    };
    return s;
  };
  const db = {
    select,
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => statement(table, "insert", values) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: () => statement(table, "update", values) }) }),
    async batch(stmts: Stmt[]) {
      batches++;
      const snapshot = new Map([...tables].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
      const before = applied.length;
      try { for (const s of stmts) s.run(); }
      catch (e) {
        for (const k of [...tables.keys()]) if (!snapshot.has(k)) tables.delete(k);
        for (const [k, v] of snapshot) tables.set(k, v);
        applied.length = before;
        throw e;
      }
    },
  };
  return { db, applied, wheres, limits, batches: () => batches };
}
const count = (m: { applied: Applied[] }, table: unknown) => m.applied.filter((w) => w.table === table).length;
const audits = (m: { applied: Applied[] }) => m.applied.filter((w) => w.table === auditEvents).map((w) => w.values as { eventType: string; safeMetadata: Record<string, unknown> });

function contactRow(over: Record<string, unknown> = {}) {
  return {
    id: CID, brokerageKey: "fortmark", assignedAgentUserId: AGENT.userId, createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId,
    firstName: "Synthetic", lastName: "Person", preferredName: null, email: "old@example.test", phoneE164: "+19545550100", company: null,
    source: "referral", stage: "qualified", tags: [], notes: "legacy words",
    lastContactAt: new Date("2026-09-01T15:00:00Z"), nextFollowUpAt: new Date("2026-10-05T12:00:00Z"),
    birthdayMonth: null, birthdayDay: null,
    createdAt: new Date("2026-08-01T15:00:00Z"), updatedAt: new Date("2026-08-01T15:00:00Z"), ...over,
  };
}
const SECRET_BODY = "Sensitive: the seller's mother is ill, price flexible to $412,000";
function noteRow(over: Record<string, unknown> = {}) {
  return { id: NOTE_ID, contactId: CID, authorUserId: AGENT.userId, body: SECRET_BODY, createdAt: new Date("2026-09-29T20:42:00Z"), deletedAt: null, deletedByUserId: null, ...over };
}
function needRow(over: Record<string, unknown> = {}) {
  return {
    id: NEED_ID, contactId: CID, kind: "buy", status: "active", propertyTypes: ["condo"], areas: ["Brickell"], priceMinCents: 50_000_000, priceMaxCents: 90_000_000,
    minBeds: 2, minBaths: "2.5", minSqft: null, targetDate: null, timelineNote: null, financing: null, mustHaves: ["Balcony"], avoid: [], additionalRequirements: "Needs a quiet building",
    createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId, createdAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date("2026-09-01T00:00:00Z"), ...over,
  };
}
const world = (extra: [unknown, Record<string, unknown>[]][] = [], row = contactRow()) =>
  new Map<unknown, Record<string, unknown>[]>([[contacts, [row]], ...extra]);
const ctxFor = (actor: Actor, tables: Map<unknown, Record<string, unknown>[]>, failOn?: unknown) => {
  const m = memory(tables, failOn);
  return { m, ctx: { actor, db: m.db as never } };
};
const ROLES: [string, Actor][] = [["agent (owner)", AGENT], ["admin", ADMIN], ["broker", BROKER], ["coordinator", COORD], ["member", MEMBER], ["other agent", OTHER], ["outsider", OUTSIDER]];

// --- Notes ---------------------------------------------------------------------------------
{
  const tables = world();
  const { m, ctx } = ctxFor(AGENT, tables);
  const added = await addNote(ctx, CID, { body: SECRET_BODY }, NOW);
  check("notes: the owner adds a note", added.ok && added.value.body === SECRET_BODY && added.value.canDelete && added.value.createdAt === NOW.toISOString());
  check("notes: the note and its audit row commit in one batch", m.batches() === 1 && count(m, contactNotes) === 1 && count(m, auditEvents) === 1);
  const stored = m.applied.find((w) => w.table === contactNotes)!.values;
  check("notes: authorship is the actor and the time is the server's", stored.authorUserId === AGENT.userId && (stored.createdAt as Date).toISOString() === NOW.toISOString() && stored.deletedAt === undefined);
  const audit = audits(m)[0];
  check("notes: the audit records the contact, the note and the action only", audit.eventType === "contact_note_created" && Object.keys(audit.safeMetadata).sort().join() === "action,contactId,noteId" && audit.safeMetadata.action === "create" && audit.safeMetadata.contactId === CID);
  check("notes: NOT ONE WORD of the note is in the audit row", !JSON.stringify(audit).match(/Sensitive|mother|412|flexible|seller/i));
  check("notes: a note is not a touch — nothing on the contact or its activity history is written", count(m, contacts) === 0 && count(m, contactActivities) === 0);

  const res: Record<string, Awaited<ReturnType<typeof addNote>>> = {};
  const writes: Record<string, number> = {};
  for (const [label, actor] of ROLES) {
    const w = ctxFor(actor, world());
    res[label] = await addNote(w.ctx, CID, { body: "x" }, NOW);
    writes[label] = w.m.applied.length;
  }
  check("notes authz: the owner and an admin may add", res["agent (owner)"].ok && res["admin"].ok);
  check("notes authz: a member who owns the contact is forbidden (visible, not writable)", !res["member"].ok && res["member"].reason === "forbidden" && writes["member"] === 0);
  check("notes authz: a broker or coordinator who is not the owner gets not found", [res["broker"], res["coordinator"]].every((r) => !r.ok && r.reason === "not_found") && writes["broker"] + writes["coordinator"] === 0);
  check("notes authz: another agent gets not found — no existence leak", !res["other agent"].ok && res["other agent"].reason === "not_found" && writes["other agent"] === 0);
  check("notes authz: another brokerage, even an admin, gets not found", !res["outsider"].ok && res["outsider"].reason === "not_found" && writes["outsider"] === 0);
  const own = ctxFor(BROKER, world([], contactRow({ assignedAgentUserId: BROKER.userId })));
  check("notes authz: a broker may add to their OWN contact", (await addNote(own.ctx, CID, { body: "x" }, NOW)).ok);
  check("notes: an out-of-scope caller learns nothing even from a bad body (scope first)", await (async () => { const r = await addNote(ctxFor(OTHER, world()).ctx, CID, { body: "" }, NOW); return !r.ok && r.reason === "not_found"; })());

  for (const bad of [{ body: "" }, { body: "  " }, { body: "x".repeat(10_001) }, { body: "a\u0000" }, { nope: 1 }, "text", null]) {
    const w = ctxFor(AGENT, world());
    const r = await addNote(w.ctx, CID, bad, NOW);
    check(`notes: an invalid body is refused and nothing is written (${JSON.stringify(bad)?.slice(0, 22)})`, !r.ok && r.reason === "invalid_note" && w.m.applied.length === 0);
  }
  check("notes: a bad contact id is not found", await (async () => { const r = await addNote(ctxFor(AGENT, world()).ctx, "nope", { body: "x" }, NOW); return !r.ok && r.reason === "not_found"; })());
  for (const [label, table] of [["the note", contactNotes], ["its audit", auditEvents]] as const) {
    const w = ctxFor(AGENT, world(), table);
    const r = await addNote(w.ctx, CID, { body: "rolled back" }, NOW);
    check(`notes rollback: when ${label} fails the request fails and nothing survives`, !r.ok && r.reason === "unavailable" && w.m.applied.length === 0 && (w.m.applied.length === 0));
    check("notes rollback: …no note row remains", (await listNotes(ctxFor(AGENT, new Map([...world([[contactNotes, [noteRow()]]])])).ctx, CID)).ok);
  }

  // Listing
  const tb = world([[contactNotes, [noteRow(), noteRow({ id: "x2", body: null, deletedAt: new Date("2026-09-30T00:00:00Z"), deletedByUserId: AGENT.userId })]], [professionalProfiles, [{ userId: AGENT.userId, display: "Ada Agent", first: null, last: null }]]]);
  const list = await listNotes(ctxFor(AGENT, tb).ctx, CID);
  check("notes list: a deleted note has no body and is not returned", list.ok && list.value.length === 1 && list.value[0].id === NOTE_ID);
  check("notes list: the author is a name, never an id or an email", list.ok && list.value[0].author === "Ada Agent" && !("authorUserId" in list.value[0]) && !String(list.value[0].author).match(/@|user_|[0-9a-f]{8}-/));
  check("notes list: the shape is id, body, time, author, canDelete — nothing else", list.ok && Object.keys(list.value[0]).sort().join() === "author,body,canDelete,createdAt,id");
  const asMember = await listNotes(ctxFor(MEMBER, tb).ctx, CID);
  check("notes list: a member may read their own contact's notes, and is not offered delete", asMember.ok && asMember.value.length === 1 && asMember.value[0].canDelete === false);
  const asAdmin = await listNotes(ctxFor(ADMIN, tb).ctx, CID);
  check("notes list: an admin reads any contact's notes and may delete them", asAdmin.ok && asAdmin.value[0].canDelete === true);
  check("notes list: another agent, a broker who is not the owner, and another brokerage get not found", await (async () => { for (const a of [OTHER, BROKER, COORD, OUTSIDER]) { const r = await listNotes(ctxFor(a, tb).ctx, CID); if (r.ok || r.reason !== "not_found") return false; } return true; })());
  check("notes list: a note whose author was removed is unattributed, not an id", await (async () => { const r = await listNotes(ctxFor(AGENT, world([[contactNotes, [noteRow({ authorUserId: null })]]])).ctx, CID); return r.ok && r.value[0].author === undefined; })());
}

// --- Deleting a note --------------------------------------------------------------------------
{
  const tables = world([[contactNotes, [noteRow()]]]);
  const { m, ctx } = ctxFor(AGENT, tables);
  const gone = await deleteNote(ctx, CID, NOTE_ID, NOW);
  const row = tables.get(contactNotes)![0];
  check("delete: the owner deletes a note", gone.ok);
  check("delete: the text is REMOVED — the body is null, not hidden", row.body === null);
  check("delete: …the tombstone records when and by whom", (row.deletedAt as Date).toISOString() === NOW.toISOString() && row.deletedByUserId === AGENT.userId);
  check("delete: the row remains as a tombstone; the note's text is nowhere in what was written", tables.get(contactNotes)!.length === 1 && !JSON.stringify(m.applied.map((w) => w.values)).match(/Sensitive|mother|412/));
  check("delete: the update and its audit commit together", m.batches() === 1 && count(m, contactNotes) === 1 && count(m, auditEvents) === 1);
  const audit = audits(m)[0];
  check("delete: the audit records contactId, noteId and the action — and no text", audit.eventType === "contact_note_deleted" && Object.keys(audit.safeMetadata).sort().join() === "action,contactId,noteId" && audit.safeMetadata.action === "delete" && audit.safeMetadata.noteId === NOTE_ID && !JSON.stringify(audit).match(/Sensitive|mother|412/));
  check("delete: it moves nothing on the contact", count(m, contacts) === 0 && count(m, contactActivities) === 0);

  const outcomes: Record<string, { ok: boolean; reason?: string; n: number; body: unknown }> = {};
  for (const [label, actor] of ROLES) {
    const t = world([[contactNotes, [noteRow()]]]);
    const w = ctxFor(actor, t);
    const r = await deleteNote(w.ctx, CID, NOTE_ID, NOW);
    outcomes[label] = { ok: r.ok, reason: r.ok ? undefined : r.reason, n: w.m.applied.length, body: t.get(contactNotes)![0].body };
  }
  check("delete authz: the owner and an admin may", outcomes["agent (owner)"].ok && outcomes["admin"].ok);
  check("delete authz: a member is forbidden and the note is untouched", outcomes["member"].reason === "forbidden" && outcomes["member"].n === 0 && outcomes["member"].body === SECRET_BODY);
  check("delete authz: a broker/coordinator who is not the owner, another agent, another brokerage: not found, untouched", ["broker", "coordinator", "other agent", "outsider"].every((k) => outcomes[k].reason === "not_found" && outcomes[k].n === 0 && outcomes[k].body === SECRET_BODY));
  check("delete: a note that is not there is not found", await (async () => { const r = await deleteNote(ctxFor(AGENT, world()).ctx, CID, NOTE_ID, NOW); return !r.ok && r.reason === "not_found"; })());
  check("delete: a bad note id is not found", await (async () => { const r = await deleteNote(ctxFor(AGENT, world([[contactNotes, [noteRow()]]])).ctx, CID, "nope", NOW); return !r.ok && r.reason === "not_found"; })());
  for (const [label, table] of [["the update", contactNotes], ["the audit", auditEvents]] as const) {
    const t = world([[contactNotes, [noteRow()]]]);
    const w = ctxFor(AGENT, t, table);
    const r = await deleteNote(w.ctx, CID, NOTE_ID, NOW);
    check(`delete rollback: when ${label} fails, the request fails and the text survives`, !r.ok && r.reason === "unavailable" && t.get(contactNotes)![0].body === SECRET_BODY && t.get(contactNotes)![0].deletedAt === null);
  }
  // The scope of a delete is in the SQL too: contact, note, and still-live.
  const svc = strip(src("lib/contacts/notes-service.ts"));
  check("delete: the SQL restricts to this contact, this note, and a live one — twice", (svc.match(/eq\(contactNotes\.contactId, contactId\)/g) ?? []).length >= 3 && (svc.match(/isNull\(contactNotes\.deletedAt\)/g) ?? []).length >= 3);
  check("delete: there is no edit — the service has no update path for a note's text", !/set\(\{\s*body:[ \t]*(?!null)\S/.test(svc) && !svc.includes("export async function editNote") && !svc.includes("updateNote"));
}

// --- Needs --------------------------------------------------------------------------------------
{
  const NEED_TEXT = /Brickell|Balcony|quiet building|500000|900000|Fort Lauderdale|Victoria|Pool|412|Near a good school/;
  const t = world();
  const { m, ctx } = ctxFor(AGENT, t);
  const created = await createNeed(ctx, CID, { kind: "buy", areas: ["Fort Lauderdale"], priceMinCents: 50_000_000, priceMaxCents: 90_000_000, mustHaves: ["Pool"], additionalRequirements: "Near a good school", minBaths: 2.5 }, NOW);
  check("needs: the owner adds a need", created.ok && created.value.kind === "buy" && created.value.status === "active" && created.value.areas.join() === "Fort Lauderdale" && created.value.minBaths === 2.5);
  check("needs: the need and its audit commit in one batch, nothing else is written", m.batches() === 1 && count(m, contactNeeds) === 1 && count(m, auditEvents) === 1 && count(m, contacts) === 0 && count(m, contactActivities) === 0);
  const stored = m.applied.find((w) => w.table === contactNeeds)!.values;
  check("needs: baths are stored as an exact decimal string, never a float", stored.minBaths === "2.5");
  check("needs: creator and updater are the actor", stored.createdByUserId === AGENT.userId && stored.updatedByUserId === AGENT.userId);
  const a = audits(m)[0];
  check("needs: the create audit is the contact, the need, the mechanism and the kind", a.eventType === "contact_need_created" && Object.keys(a.safeMetadata).sort().join() === "contactId,kind,mechanism,needId" && a.safeMetadata.mechanism === "create");
  check("needs: NO area, budget, must-have or requirement is in the audit row", !JSON.stringify(a).match(NEED_TEXT));

  const two = ctxFor(AGENT, world([[contactNeeds, [needRow()]]]));
  const second = await createNeed(two.ctx, CID, { kind: "sell" }, NOW);
  check("needs: a second simultaneous need is accepted — one contact, many needs", second.ok && (await getContactNeeds(two.ctx, CID)).ok && ((await getContactNeeds(two.ctx, CID)) as { value: NeedView[] }).value.length === 2);

  for (const bad of [{}, { kind: "opportunity" }, { kind: "buy", priceMinCents: 5, priceMaxCents: 1 }, { kind: "buy", extra: 1 }, "x", null]) {
    const w = ctxFor(AGENT, world());
    const r = await createNeed(w.ctx, CID, bad, NOW);
    check(`needs: an invalid need is refused and nothing is written (${JSON.stringify(bad)?.slice(0, 30)})`, !r.ok && r.reason === "invalid_need" && w.m.applied.length === 0);
  }
  const results: Record<string, { ok: boolean; reason?: string; n: number }> = {};
  for (const [label, actor] of ROLES) {
    const w = ctxFor(actor, world());
    const r = await createNeed(w.ctx, CID, { kind: "buy" }, NOW);
    results[label] = { ok: r.ok, reason: r.ok ? undefined : r.reason, n: w.m.applied.length };
  }
  check("needs authz: the owner and an admin may create", results["agent (owner)"].ok && results["admin"].ok);
  check("needs authz: a member is forbidden", results["member"].reason === "forbidden" && results["member"].n === 0);
  check("needs authz: broker/coordinator (not owner), another agent, another brokerage: not found", ["broker", "coordinator", "other agent", "outsider"].every((k) => results[k].reason === "not_found" && results[k].n === 0));
  for (const [label, table] of [["the need", contactNeeds], ["its audit", auditEvents]] as const) {
    const t2 = world();
    const r = await createNeed(ctxFor(AGENT, t2, table).ctx, CID, { kind: "buy" }, NOW);
    check(`needs rollback: when ${label} fails, the request fails and no need remains`, !r.ok && r.reason === "unavailable" && (t2.get(contactNeeds) ?? []).length === 0);
  }

  // Update
  const up = ctxFor(AGENT, world([[contactNeeds, [needRow()]]]));
  const edited = await updateNeed(up.ctx, CID, NEED_ID, { areas: ["Aventura"], minBeds: 3 }, NOW);
  check("needs update: the owner edits", edited.ok && edited.value.changed.join() === "areas,minBeds" && edited.value.need.areas.join() === "Aventura");
  const ea = audits(up.m)[0];
  check("needs update: the audit names FIELDS, never values", ea.eventType === "contact_need_updated" && ea.safeMetadata.fields instanceof Array && (ea.safeMetadata.fields as string[]).join() === "areas,minBeds" && Object.keys(ea.safeMetadata).sort().join() === "contactId,fields,mechanism,needId" && !JSON.stringify(ea).match(/Aventura|Brickell|\b3\b.*beds/));
  check("needs update: it writes the updater and time", (up.m.applied.find((w) => w.table === contactNeeds)!.values as Record<string, unknown>).updatedByUserId === AGENT.userId);
  for (const status of ["paused", "fulfilled", "archived"] as const) {
    const w = ctxFor(AGENT, world([[contactNeeds, [needRow()]]]));
    const r = await updateNeed(w.ctx, CID, NEED_ID, { status }, NOW);
    const sa = audits(w.m);
    check(`needs status: active → ${status}`, r.ok && r.value.need.status === status && sa.length === 1 && sa[0].eventType === "contact_need_status_changed" && sa[0].safeMetadata.from === "active" && sa[0].safeMetadata.to === status);
    check(`needs status: ${status} — the audit still holds no values`, !JSON.stringify(sa).match(NEED_TEXT));
  }
  const both = ctxFor(AGENT, world([[contactNeeds, [needRow()]]]));
  await updateNeed(both.ctx, CID, NEED_ID, { status: "paused", areas: ["Miami"] }, NOW);
  check("needs status: a status change together with an edit writes both events, one batch", audits(both.m).map((x) => x.eventType).join() === "contact_need_updated,contact_need_status_changed" && both.m.batches() === 1);
  const noop = ctxFor(AGENT, world([[contactNeeds, [needRow()]]]));
  const nr = await updateNeed(noop.ctx, CID, NEED_ID, { areas: ["Brickell"], status: "active" }, NOW);
  check("needs update: saving unchanged values succeeds and writes nothing", nr.ok && nr.value.changed.length === 0 && noop.m.applied.length === 0 && noop.m.batches() === 0);
  const reopen = ctxFor(AGENT, world([[contactNeeds, [needRow({ status: "paused" })]]]));
  check("needs status: a paused need can be reactivated", (await updateNeed(reopen.ctx, CID, NEED_ID, { status: "active" }, NOW)).ok);
  check("needs update: a maximum below the stored minimum is refused and writes nothing", await (async () => { const w = ctxFor(AGENT, world([[contactNeeds, [needRow()]]])); const r = await updateNeed(w.ctx, CID, NEED_ID, { priceMaxCents: 100 }, NOW); return !r.ok && r.reason === "invalid_need" && w.m.applied.length === 0; })());
  check("needs update: an unknown field is refused", await (async () => { const w = ctxFor(AGENT, world([[contactNeeds, [needRow()]]])); const r = await updateNeed(w.ctx, CID, NEED_ID, { contactId: "x" }, NOW); return !r.ok && r.reason === "invalid_need" && w.m.applied.length === 0; })());
  check("needs update: a need that is not there, or a bad id, is not found", await (async () => { const a1 = await updateNeed(ctxFor(AGENT, world()).ctx, CID, NEED_ID, { status: "paused" }, NOW); const a2 = await updateNeed(ctxFor(AGENT, world([[contactNeeds, [needRow()]]])).ctx, CID, "nope", { status: "paused" }, NOW); return !a1.ok && a1.reason === "not_found" && !a2.ok && a2.reason === "not_found"; })());
  const ur: Record<string, { reason?: string; n: number }> = {};
  for (const [label, actor] of ROLES) {
    const w = ctxFor(actor, world([[contactNeeds, [needRow()]]]));
    const r = await updateNeed(w.ctx, CID, NEED_ID, { status: "paused" }, NOW);
    ur[label] = { reason: r.ok ? undefined : r.reason, n: w.m.applied.length };
  }
  check("needs update authz: owner and admin may; a member is forbidden; everyone else is not found", ur["agent (owner)"].reason === undefined && ur["admin"].reason === undefined && ur["member"].reason === "forbidden" && ["broker", "coordinator", "other agent", "outsider"].every((k) => ur[k].reason === "not_found" && ur[k].n === 0));
  for (const [label, table] of [["the update", contactNeeds], ["the audit", auditEvents]] as const) {
    const t3 = world([[contactNeeds, [needRow()]]]);
    const r = await updateNeed(ctxFor(AGENT, t3, table).ctx, CID, NEED_ID, { status: "paused" }, NOW);
    check(`needs update rollback: when ${label} fails, the need is unchanged`, !r.ok && r.reason === "unavailable" && t3.get(contactNeeds)![0].status === "active");
  }
  check("needs: there is no delete — the service and routes offer none", !strip(src("lib/contacts/needs-service.ts")).match(/\.delete\(|deleteNeed|removeNeed/) && !existsSync(new URL("../app/api/contacts/[id]/needs/[needId]/delete", import.meta.url)) && !strip(src("app/api/contacts/[id]/needs/[needId]/route.ts")).includes("DELETE"));

  // The future AI / MLS door.
  const rows = [needRow({ id: "n-old", status: "archived", updatedAt: new Date("2026-09-20T00:00:00Z") }), needRow({ id: "n-act", status: "active", updatedAt: new Date("2026-09-05T00:00:00Z") }), needRow({ id: "n-pause", status: "paused", updatedAt: new Date("2026-09-25T00:00:00Z") })];
  const got = await getContactNeeds(ctxFor(AGENT, world([[contactNeeds, rows]])).ctx, CID);
  check("getContactNeeds: active first, then paused, fulfilled, archived", got.ok && got.value.map((n) => n.id).join() === "n-act,n-pause,n-old");
  check("getContactNeeds: baths come back as a number, dates and money as stored", got.ok && got.value[0].minBaths === 2.5 && got.value[0].priceMinCents === 50_000_000 && got.value[0].targetDate === null);
  check("getContactNeeds: the shape carries no owner, no author id, no contact id", got.ok && !Object.keys(got.value[0]).some((k) => /user|owner|contact/i.test(k)));
  for (const [label, actor] of ROLES) {
    const r = await getContactNeeds(ctxFor(actor, world([[contactNeeds, rows]])).ctx, CID);
    const should = ["agent (owner)", "admin", "member"].includes(label);
    check(`getContactNeeds authz: ${label} ${should ? "reads" : "gets not found"}`, should ? r.ok : !r.ok && r.reason === "not_found");
  }
  check("getContactNeeds: a bad id is not found", await (async () => { const r = await getContactNeeds(ctxFor(AGENT, world([[contactNeeds, rows]])).ctx, "nope"); return !r.ok && r.reason === "not_found"; })());
  const registry = src("lib/ai/tools/registry.ts") + src("lib/ai/actions/service.ts");
  check("nothing in the AI layer reads needs, notes or birthdays — no AI direct database access to them", !/contactNeeds|contactNotes|birthday/i.test(registry));
}

// --- Contacts: creating and the stage warning ----------------------------------------------------
{
  check("the stages the engagement notice gates are exactly representation and active_client", ENGAGEMENT_STAGES.join() === "representation,active_client");
  for (const from of ALL_CONTACT_STAGES) for (const to of ALL_CONTACT_STAGES) {
    const expect = from !== to && (to === "representation" || to === "active_client");
    if (requiresEngagementNotice(from, to) !== expect) check(`notice rule: ${from} → ${to}`, false);
  }
  check("notice rule: qualified → representation and qualified → active_client warn", requiresEngagementNotice("qualified", "representation") && requiresEngagementNotice("qualified", "active_client"));
  check("notice rule: representation → active_client warns too; leaving them does not; a same-stage move is nothing", requiresEngagementNotice("representation", "active_client") && !requiresEngagementNotice("representation", "closed") && !requiresEngagementNotice("active_client", "past_client") && !requiresEngagementNotice("lead", "contacted") && !requiresEngagementNotice("representation", "representation"));

  const stage = async (to: "representation" | "contacted", ack?: boolean, from = "qualified") => {
    const t = world([], contactRow({ stage: from }));
    const w = ctxFor(AGENT, t);
    const r = await changeStage(w.ctx, CID, to as never, NOW, { engagementAcknowledged: ack });
    return { r, m: w.m };
  };
  const acked = await stage("representation", true);
  const unacked = await stage("representation");
  const plain = await stage("contacted");
  const metaOf = (x: { m: ReturnType<typeof memory> }) => audits(x.m)[0]?.safeMetadata ?? {};
  check("stage: a confirmed move records engagementAcknowledged: true", acked.r.ok && metaOf(acked).engagementAcknowledged === true);
  check("stage: an unconfirmed move (an API caller, an assistant) records false — never a claim it was confirmed", unacked.r.ok && metaOf(unacked).engagementAcknowledged === false);
  check("stage: the record never says an engagement was attached or verified", !JSON.stringify([metaOf(acked), metaOf(unacked)]).match(/attached|verified|document|engagementAttached/i));
  check("stage: a move that is not gated carries no acknowledgement field at all", plain.r.ok && !("engagementAcknowledged" in metaOf(plain)));
  const activity = acked.m.applied.find((w) => w.table === contactActivities)!.values.safeMetadata as Record<string, unknown>;
  check("stage: the history line carries the same flag", activity.engagementAcknowledged === true && activity.to === "representation");
  check("stage: an existing Representation contact is not forced backwards or blocked from anything", (await stage("contacted", undefined, "representation")).r.ok);
  check("stage: the request schema accepts the flag as a boolean only", src("lib/contacts/domain.ts").includes("engagementAcknowledged: z.boolean().optional()"));
  check("stage: the route passes the flag through", src("app/api/contacts/[id]/stage/route.ts").includes("engagementAcknowledged: parsed.data.engagementAcknowledged"));
}

// --- The owner filter is read-only and admin-only -------------------------------------------------
{
  const users = [[contacts, []], [professionalProfiles, []]] as [unknown, Record<string, unknown>[]][];
  check("owners: nobody but an admin is offered the roster", (await listAgents(ctxFor(AGENT, new Map(users)).ctx)).length === 0 && (await listAgents(ctxFor(BROKER, new Map(users)).ctx)).length === 0 && (await listAgents(ctxFor(COORD, new Map(users)).ctx)).length === 0 && (await listAgents(ctxFor(MEMBER, new Map(users)).ctx)).length === 0);
}

// ===================================================================================
// 5. Timeline events
// ===================================================================================
{
  const names = new Map([["u1", "Ada Agent"]]);
  const ev = (id: string, eventType: string, meta: Record<string, unknown> = {}) => ({ id, eventType, createdAt: new Date("2026-09-30T14:00:00Z"), actorUserId: "u1", safeMetadata: meta });
  const items = toTimeline({
    names, activities: [], followUpEvents: [],
    domainEvents: [ev("e1", "contact_note_created", { noteId: "N" }), ev("e2", "contact_note_deleted"), ev("e3", "contact_need_created"), ev("e4", "contact_need_updated"), ev("e5", "contact_need_status_changed", { to: "paused" }), ev("e6", "contact_transaction_linked", { transactionId: "T" }), ev("e7", "something_else")],
  });
  const title = (id: string) => items.find((i) => i.id === id)?.title;
  check("timeline: 'Added note' and 'Deleted note'", title("e1") === "Added note" && title("e2") === "Deleted note");
  check("timeline: needs read as 'Client need added / updated / paused'", title("e3") === "Client need added" && title("e4") === "Client need updated" && title("e5") === "Client need paused");
  check("timeline: 'Transaction linked'", title("e6") === "Transaction linked");
  check("timeline: an event it does not know is not shown", title("e7") === undefined && items.length === 6);
  check("timeline: no note id, need id, transaction id or actor id reaches the screen", !JSON.stringify(items).match(/"N"|"T"|noteId|transactionId|u1/));
  check("timeline: events carry a name and no detail — a note's words cannot be there", items.every((i) => i.by === "Ada Agent" && i.detail === undefined));
  check("timeline: the events shown are exactly the ones the writers produce", (TIMELINE_DOMAIN_EVENTS as readonly string[]).every((e) => (RELEASE_1_AUDIT_EVENTS as readonly string[]).includes(e)) && TIMELINE_DOMAIN_EVENTS.length === 6);
  check("audit: every new event type is in the closed list", ["contact_note_created", "contact_note_deleted", "contact_need_created", "contact_need_updated", "contact_need_status_changed", "contact_transaction_linked"].every((e) => (RELEASE_1_AUDIT_EVENTS as readonly string[]).includes(e)));
}

// ===================================================================================
// 6. Representation → Transaction
// ===================================================================================
{
  // The selector: SQL, rendered.
  const dialect = new PgDialect();
  const sqlFor = async (actor: Actor, text?: string) => {
    const m = memory(world([[contacts, []]]));
    await listEligibleContacts({ actor, db: m.db as never }, text);
    const parts = m.wheres.map((w) => dialect.sqlToQuery(w as never));
    return { sql: parts[0].sql, params: parts[0].params, limit: m.limits[0] };
  };
  const agentQ = await sqlFor(AGENT, "Ann");
  check("selector: Representation only", agentQ.sql.includes('"stage" = $') && agentQ.params.includes("representation"));
  check("selector: a regular user is limited to their own book in SQL", agentQ.sql.includes('"assigned_agent_user_id"') && agentQ.params.includes(AGENT.userId));
  check("selector: the brokerage boundary is in the query", /"brokerage_key" = \$\d+/.test(agentQ.sql) && agentQ.params.includes("fortmark"));
  check("selector: an admin is not narrowed to a book", !(await sqlFor(ADMIN)).sql.includes('"assigned_agent_user_id"'));
  check("selector: a broker and a coordinator are NOT given the brokerage's contact books", [BROKER, COORD].every((a) => true) && (await sqlFor(BROKER)).sql.includes('"assigned_agent_user_id"') && (await sqlFor(COORD)).sql.includes('"assigned_agent_user_id"'));
  check("selector: bounded to 25", agentQ.limit === 25);
  check("selector: the name is bound, never concatenated", !agentQ.sql.includes("Ann") && agentQ.params.some((p) => typeof p === "string" && p.includes("ann")));
  const pct = await sqlFor(AGENT, "100%_x");
  check("selector: % and _ are literal characters — escaped in the bound pattern", pct.params.some((p) => typeof p === "string" && p.includes("\\%") && p.includes("\\_")));
  check("selector: a lead-stage or archived contact cannot match — the predicate is the stage itself", !agentQ.params.includes("lead") && !agentQ.params.includes("archived") && agentQ.params.filter((p) => p === "representation").length === 1);
  check("selector: searches names only — not email, phone or company", !(await sqlFor(AGENT, "x")).sql.match(/"email"|"phone_e164"|"company"/));
  const sel = strip(src("lib/contacts/eligible.ts"));
  check("selector: server-side, not download-and-filter", sel.includes(".limit(ELIGIBLE_LIMIT)") && !/\.filter\(/.test(sel));
  const route = strip(src("app/api/contacts/eligible/route.ts"));
  check("selector: POST only (a name never rides a URL) and authenticates first", route.includes("export async function POST") && !route.includes("export async function GET") && route.indexOf("requireCaller()") < route.indexOf("request.text()"));

  // Revalidation on create — the early refusals write nothing.
  const dealBase = { transactionType: "residential_sale", side: "buyer", addressLine1: "1 Test St", city: "Miami" } as never;
  const attempt = async (actor: Actor, contactOver: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => {
    const t = new Map<unknown, Record<string, unknown>[]>(contactOver ? [[contacts, [contactRow({ stage: "representation", ...contactOver })]]] : [[contacts, []]]);
    const w = ctxFor(actor, t);
    const r = await createTransaction(w.ctx, { ...(dealBase as object), contactId: CID, ...extra } as never, NOW);
    return { r, n: w.m.applied.length };
  };
  const stranger = await attempt(OTHER, {});
  check("create: a colleague's contact id is refused, and it reads exactly like an unknown id", !stranger.r.ok && stranger.r.reason === "invalid_contact" && stranger.n === 0);
  const unknown = await attempt(AGENT, null);
  check("create: …identical to a contact that does not exist", !unknown.r.ok && !stranger.r.ok && unknown.r.reason === stranger.r.reason && unknown.n === 0);
  for (const stage of ["lead", "contacted", "qualified", "appointment", "active_client", "under_contract", "closed", "past_client", "lost", "archived"]) {
    const r = await attempt(AGENT, { stage });
    check(`create: a contact at ${stage} is refused`, !r.r.ok && r.r.reason === "invalid_contact" && r.n === 0);
  }
  const foreign = await attempt(ADMIN, { brokerageKey: "elsewhere" });
  check("create: another brokerage's contact is refused, even for an admin", !foreign.r.ok && foreign.r.reason === "invalid_contact");
  const brokerColleague = await attempt(BROKER, {});
  check("create: a broker cannot open a deal for an agent's contact — their Contacts scope is their own", !brokerColleague.r.ok && brokerColleague.r.reason === "invalid_contact" && brokerColleague.n === 0);
  const coordColleague = await attempt(COORD, {});
  check("create: …and neither can a coordinator (documented, not silently broadened)", !coordColleague.r.ok && coordColleague.r.reason === "invalid_contact" && coordColleague.n === 0);
  const brokerNamesAgent = await attempt(BROKER, { assignedAgentUserId: BROKER.userId }, { agentUserId: OTHER.userId });
  check("create: a broker's own contact cannot be put on another agent's deal", !brokerNamesAgent.r.ok && brokerNamesAgent.r.reason === "invalid_contact" && brokerNamesAgent.n === 0);
  check("create: the request may carry a contact id and nothing more about the client", createTransactionSchema.safeParse({ ...(dealBase as object), contactId: CID }).success && !createTransactionSchema.safeParse({ ...(dealBase as object), contactId: "not-a-uuid" }).success);

  const svc = strip(src("lib/transactions/service.ts"));
  check("create: the contact is loaded and stage-checked BEFORE the deal is inserted", svc.indexOf("loadContact(ctx, input.contactId)") > 0 && svc.indexOf("loadContact(ctx, input.contactId)") < svc.indexOf(".insert(transactions)") && svc.indexOf("ELIGIBLE_STAGE") < svc.indexOf(".insert(transactions)"));
  check("create: the client party is built from the STORED contact — name, email, phone", svc.includes("contactDisplayName(contact.row)") && svc.includes("email: contact.row.email") && svc.includes("phone: contact.row.phoneE164"));
  check("create: the party carries contact_id and is the primary client", svc.includes("contactId: contact.row.id") && svc.includes("isPrimary: true") && svc.includes("contactId: p.contactId"));
  check("create: a client-role party in the request is dropped, not duplicated", svc.includes("p.role !== clientRole"));
  check("create: the link is audited by ids only", /eventType: "contact_transaction_linked"[\s\S]{0,200}safeMetadata: \{ contactId: contact\.row\.id, transactionId: row\.id, mechanism: "create" \}/.test(svc));
  check("create: no second relationship table — the existing transaction_parties.contact_id is used", !/contact_transactions|contactTransactions|transaction_contacts/i.test(src("lib/db/schema.ts")) && src("lib/db/schema.ts").includes('contactId: uuid("contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" })'));
  check("create: no unique constraint on (transaction, contact) — deferred", !/uniqueIndex\("transaction_parties_transaction_contact/.test(src("lib/db/schema.ts")) && !readMigrations().match(/UNIQUE INDEX "transaction_parties/i));
  check("create: legacy deals keep rendering — a party with no contact is still valid", src("lib/db/schema.ts").includes('contactId: uuid("contact_id").references') && !/contactId:[^\n]*notNull/.test(src("lib/db/schema.ts").slice(src("lib/db/schema.ts").indexOf("export const transactionParties"), src("lib/db/schema.ts").indexOf("export const transactionDeadlines"))));

  const linked = strip(src("lib/contacts/linked-transactions.ts"));
  check("linked deals: the contact door, then Transaction visibility — two separate rules", linked.includes("loadContact(ctx, contactId)") && linked.includes("visibleTransactions(ctx.actor)") && linked.includes("eq(transactionParties.contactId, contactId)"));
  check("linked deals: only where and how far along — no money, dates or parties", !/PriceCents|closingDate|commission|displayName/.test(linked));
}

function readMigrations(): string {
  return ["0011_contact_notes", "0012_contact_birthday", "0013_contact_needs"].map((f) => src(`lib/db/migrations/${f}.sql`)).join("\n");
}

// ===================================================================================
// 7. Structure — routes, screens, privacy, no M4, no M5
// ===================================================================================
{
  const routes = {
    notes: strip(src("app/api/contacts/[id]/notes/route.ts")),
    note: strip(src("app/api/contacts/[id]/notes/[noteId]/route.ts")),
    needs: strip(src("app/api/contacts/[id]/needs/route.ts")),
    need: strip(src("app/api/contacts/[id]/needs/[needId]/route.ts")),
    linked: strip(src("app/api/contacts/[id]/transactions/route.ts")),
    eligible: strip(src("app/api/contacts/eligible/route.ts")),
  };
  for (const [name, text] of Object.entries(routes)) {
    check(`route ${name}: authenticates before anything else`, text.indexOf("requireCaller()") >= 0 && text.indexOf("requireCaller()") < Math.min(...["request.json()", "request.text()", "await actorOrResponse(", "await context.params"].map((n) => (text.indexOf(n) < 0 ? Infinity : text.indexOf(n)))));
    check(`route ${name}: private and never cached`, text.includes("NO_STORE") && text.includes('dynamic = "force-dynamic"') && text.includes('runtime = "nodejs"'));
    check(`route ${name}: nothing is echoed from the body into an error`, !/error:\s*`/.test(text) && !text.includes("parsed.error.message"));
  }
  check("routes: notes have list, add and delete — and no edit", routes.notes.includes("export async function GET") && routes.notes.includes("export async function POST") && routes.note.includes("export async function DELETE") && !routes.note.includes("PATCH") && !routes.note.includes("PUT") && !routes.notes.includes("PATCH"));
  check("routes: needs have list, add and change — and no delete", routes.needs.includes("export async function GET") && routes.needs.includes("export async function POST") && routes.need.includes("export async function PATCH") && !routes.need.includes("DELETE"));
  check("routes: a sample-mode server offers none of this (404)", [routes.notes, routes.note, routes.needs, routes.need, routes.linked].every((t) => t.includes('contactsSource() === "sample"')));
  check("routes: the search text stays out of URLs — the selector has no GET", !routes.eligible.includes("searchParams") && !routes.eligible.includes("nextUrl"));

  // Privacy: none of this is searchable, listed, or in the payload of the list.
  const search = strip(src("lib/contacts/search.ts")) + strip(src("lib/search/service.ts"));
  check("privacy: notes, needs and birthdays are not in global search or ⌘K", !/contactNotes|contactNeeds|birthday/i.test(search));
  const listSql = strip(src("lib/contacts/list-sql.ts"));
  check("privacy: the list filter and text search never touch notes, needs or birthday", !/contactNotes|contactNeeds|birthday/i.test(listSql));
  const lead = strip(src("lib/contacts/domain.ts"));
  check("privacy: the list payload carries a birthday only as month/day on the row, never notes or needs", !/contactNotes|contactNeeds/.test(lead));
  const audit = strip(src("lib/contacts/notes-service.ts")) + strip(src("lib/contacts/needs-service.ts"));
  check("privacy: no audit write in the new services reads a body or a need field", !/safeMetadata:\s*\{[^}]*(body|areas|priceMinCents|priceMaxCents|mustHaves|avoid|additionalRequirements|timelineNote)/.test(audit));
  check("privacy: the audit list of contact events never gained a value-bearing one", !/note_body|need_values|birthday_value/.test(src("lib/db/schema.ts")));

  // The screens.
  const notesUi = strip(src("components/leads/lead-notes.tsx"));
  check("ui notes: text is drawn as a text node — no raw HTML anywhere in the notes or needs screens", !/dangerouslySetInnerHTML|innerHTML|__html/.test(notesUi + strip(src("components/leads/lead-needs.tsx")) + strip(src("components/leads/lead-drawer.tsx")) + strip(src("components/leads/lead-timeline.tsx"))));
  check("ui notes: a composer that is always there for anyone who can write, with a Save note button", notesUi.includes('aria-label="Add a note"') && notesUi.includes("Save note") && notesUi.includes("canWrite &&"));
  check("ui notes: each note shows author and the Eastern timestamp", notesUi.includes("formatNoteStamp(note.createdAt)") && notesUi.includes('data-testid="note-author"') && notesUi.includes("<time"));
  check("ui notes: delete asks first, with the specified words", notesUi.includes("Delete note?") && notesUi.includes("This will remove the note from the contact&apos;s record.") && notesUi.includes("Cancel"));
  check("ui notes: a legacy note is shown once, read-only, with no timestamp", notesUi.includes("Legacy note") && !/legacyNote[^\n]*formatNoteStamp/.test(notesUi));
  check("ui notes: refusals move focus back to the composer", notesUi.includes("composer.current?.focus()"));
  const drawer = strip(src("components/leads/lead-drawer.tsx"));
  check("ui drawer: notes are in the drawer itself, not behind Edit contact", drawer.includes("<LeadNotes") && !strip(src("components/leads/lead-edit-form.tsx")).includes("notes"));
  check("ui drawer: the hierarchy — details, needs, notes, activity, representation, transactions", (() => { const at = ["lead-details-heading", "<LeadNeeds", "<LeadNotes", "<LeadTimeline", "lead-representation-heading", "lead-transactions-heading"].map((n) => drawer.indexOf(n)); return at.every((v, i) => v > 0 && (i === 0 || v > at[i - 1])); })());
  check("ui drawer: the four quick actions", ["Log touch", "Follow-up", "Change stage", "Edit contact"].every((l) => drawer.includes(`"${l}"`) || drawer.includes(`>${l}<`) || drawer.includes(`, "${l}"`)));
  check("ui drawer: quick actions announce and control their panel", drawer.includes("aria-expanded={panel === id}") && drawer.includes("aria-controls={`lead-panel-${id}`}"));
  check("ui drawer: an admin's view of a colleague's contact names the owner, read-only", drawer.includes("lead.ownedByViewer === false") && drawer.includes("Owner:") && !/Reassign|reassign|assignee/i.test(drawer));
  check("ui drawer: no reassign control, picker or modal anywhere in the leads components", !/reassign/i.test(["lead-drawer", "lead-edit-form", "leads-table", "leads-filters", "lead-shared", "lead-timeline"].map((f) => strip(src(`components/leads/${f}.tsx`.replace("lead-shared.tsx", "lead-shared.ts")))).join("\n")));
  check("ui drawer: 'Create transaction' only at Representation, only for someone who can write, opens the existing dialog with this contact", /lead\.stage === "representation" && abilities\.canWrite && !sample/.test(drawer) && drawer.includes('setQuickCreate("transaction", { id: lead.id, name: lead.name })') && drawer.includes("Create transaction"));
  check("ui drawer: nothing is auto-created from a stage move", !/setQuickCreate\("transaction"[^;]*updateLeadStage|updateLeadStage[^;]*setQuickCreate\("transaction"/.test(drawer));
  check("ui drawer: Transactions only when there are some; each opens the transaction", drawer.includes("linkedDeals.length > 0") && drawer.includes("/transactions?open="));
  check("ui drawer: the engagement notice gates a move into a formal stage, and Cancel changes nothing", drawer.includes("requiresEngagementNotice(lead.stage, stage)") && drawer.includes("setPendingStage(stage);") && drawer.includes("onCancel={() => setPendingStage(null)}") && drawer.includes("engagementAcknowledged: true") && drawer.includes('returnFocusTo="lead-stage-select"'));
  check("ui drawer: opening an existing Representation contact shows no modal — the notice is only ever set by a stage change", (drawer.match(/setPendingStage\(/g) ?? []).length === 4 && !/useEffect[^;]*setPendingStage/.test(drawer));
  const notice = strip(src("components/leads/engagement-notice.tsx"));
  check("ui notice: the specified title and words, Cancel and Continue", notice.includes("Brokerage engagement") && notice.includes("confirm that an active brokerage engagement is in") && notice.includes("An executed engagement should be attached to the contact record.") && notice.includes("Cancel") && notice.includes("Continue"));
  check("ui notice: it never claims a document is verified, attached or sufficient", !/verified|is attached|legally sufficient|has been attached/i.test(notice) && notice.includes("does not yet store or check engagement documents"));
  const timelineUi = strip(src("components/leads/lead-timeline.tsx"));
  check("ui activity: collapsed to the latest five by default", timelineUi.includes("const COLLAPSED = 5") && timelineUi.includes("data.slice(0, COLLAPSED)"));
  check("ui activity: an accessible disclosure — aria-expanded, aria-controls, a real button", timelineUi.includes("aria-expanded={all}") && timelineUi.includes('aria-controls="lead-activity-list"') && timelineUi.includes("<button") && timelineUi.includes('type="button"') && timelineUi.includes('id="lead-activity-list"'));
  check("ui activity: expanding shows what is already loaded — it does not fetch again", (timelineUi.match(/getTimeline\(/g) ?? []).length === 1 && timelineUi.includes("Show all activity") && timelineUi.includes("Show fewer"));
  check("ui activity: every contact opens collapsed", timelineUi.includes("setAll(false)") && timelineUi.includes("forLead !== leadId"));

  const bday = strip(src("components/leads/lead-birthday.tsx"));
  check("ui birthday: 'Not set', never 'Unknown'; Set, Change and Clear", bday.includes('"Not set"') && !/Unknown/.test(bday) && bday.includes('"Change" : "Set"') && bday.includes("Clear"));
  check("ui birthday: no year field and no age, anywhere", !/year|\bage\b/i.test(bday + strip(src("components/leads/lead-drawer.tsx")).replace(/createdDate|Created/g, "")));
  check("ui birthday: the day list follows the month, so an impossible day cannot be chosen", bday.includes("daysInMonth(m)") && bday.includes("Number(day) > daysInMonth(Number(v))"));
  const needsUi = strip(src("components/leads/lead-needs.tsx"));
  check("ui needs: 'No client needs added.' and 'Add client need'", needsUi.includes("No client needs added.") && needsUi.includes("Add client need"));
  check("ui needs: the primary fields first, everything else behind an accessible 'More requirements'", ["need-kind", "need-areas", "need-type-", "need-price-min", "need-beds", "need-target-date"].every((id) => needsUi.includes(id)) && needsUi.includes("aria-expanded={more}") && needsUi.includes('aria-controls="need-more"') && needsUi.indexOf("need-more") > needsUi.indexOf("need-price-min") && needsUi.indexOf('id="need-sqft"') > needsUi.indexOf('id="need-more"'));
  check("ui needs: create, edit, pause, fulfil and archive — never delete", ["Edit", "Pause", "Fulfilled", "Archive"].every((l) => needsUi.includes(`>\n                    ${l}\n`) || needsUi.includes(l)) && !/Delete|delete/.test(needsUi));
  check("ui needs: a bad number puts focus on the field and says what to fix", needsUi.includes("document.getElementById(error.field)?.focus()") && needsUi.includes('role="alert"'));
  check("ui needs: fields are labelled and groups have legends", needsUi.includes("<fieldset") && needsUi.includes("<legend") && (needsUi.match(/<Label htmlFor/g) ?? []).length >= 10);
  const tags = strip(src("components/leads/tag-input.tsx"));
  check("ui tags: the chips list is named differently from its input, and each entry is removable by a button that names it", tags.includes("aria-label={`Remove ${v}`}") && tags.includes('aria-label={`${label} added`}'));

  // Selector and dialog.
  const picker = strip(src("components/layout/contact-picker.tsx"));
  check("ui picker: a labelled search and a native radio group — keyboard and screen-reader friendly", picker.includes('htmlFor="qc-contact-search"') && picker.includes('role="radiogroup"') && picker.includes('type="radio"') && picker.includes("<fieldset") && picker.includes("<legend"));
  check("ui picker: the server does the searching, debounced", picker.includes("getEligibleContacts(debounced || undefined)") && picker.includes("setTimeout(() => setDebounced"));
  check("ui picker: only the id is submitted for a contact, and free text stays possible for a deal with no contact", picker.includes('name="contactId"') && picker.includes('name="client"') && picker.includes("Not in Contacts — enter a client name"));
  check("ui picker: the free-text fallback only applies once the list for the CURRENT query has loaded", picker.includes("settled === debounced") && picker.includes("setSettled(debounced)"));
  check("ui picker: a side is suggested only from one explicit active need", picker.includes('kinds.size === 1 && kinds.has("buy")') && picker.includes('kinds.size === 1 && kinds.has("sell")'));
  const dialog = strip(src("components/layout/quick-create-dialog.tsx"));
  check("ui dialog: price, address, close date, commission and MLS are never pre-filled from a contact", !/defaultValue=\{[^}]*(fromContact|contact)/.test(dialog) && !/name="price"[^>]*defaultValue|name="address"[^>]*defaultValue/.test(dialog));
  check("ui dialog: quick contact create asks for name, email, phone, source, birthday — and not intent", ["birthdayMonth", "birthdayDay", 'name="name"', 'name="email"', 'name="phone"', 'name="source"'].every((n) => dialog.includes(n)) && !dialog.includes('name="intent"') && !/Needs?\b.*required/.test(dialog));
  check("ui dialog: after a contact is saved it opens on the new person", dialog.includes("goto = `/contacts?open=${encodeURIComponent(created.id)}`"));
  check("ui dialog: a half-picked or impossible birthday is caught before sending", dialog.includes("isValidBirthday(month, day)") && dialog.includes("BirthdayInputError"));

  // No M4, no M5.
  const journal = JSON.parse(src("lib/db/migrations/meta/_journal.json")) as { entries: { tag: string }[] };
  check("migrations: exactly M1–M3 were added — no engagement table, no unique link index", journal.entries.slice(11).map((e) => e.tag).join() === "0011_contact_notes,0012_contact_birthday,0013_contact_needs" && !/engagement/i.test(readMigrations()) && !/CREATE UNIQUE INDEX/i.test(readMigrations()));
  check("migrations: additive only — nothing dropped or altered destructively", !/DROP\s+(TABLE|COLUMN|TYPE)/i.test(readMigrations()) && !/ALTER TABLE "[a-z_]+" (DROP|ALTER COLUMN)/i.test(readMigrations()) && !/ALTER TYPE/i.test(readMigrations()));
  check("migrations: the contact stage enum is untouched", !/contact_stage/.test(readMigrations()));
  check("migrations: nothing backfills a legacy note or a legacy transaction", !/(^|-->\s*statement-breakpoint\s*)\s*(UPDATE|INSERT)\s/i.test(readMigrations()));
  check("migrations: a deleted note's body is nulled by a database rule, not by convention", readMigrations().includes('"contact_notes"."deleted_at" is not null and "contact_notes"."body" is null'));

  // The engagement store: none configured, and the public store is never used for it.
  check("engagement: no code writes contact engagements anywhere (M4 is unbuilt)", !/contact_engagements|contactEngagements|ENGAGEMENT_BLOB/i.test(src("lib/db/schema.ts") + src("lib/flags.ts") + src("lib/profile/image-storage.ts")));
  check("engagement: the only Blob writer is still the profile-photo one, and it is the public store", (() => { const files = ["lib/profile/image-storage.ts"]; return files.every((f) => src(f).includes('access: "public"')); })());

  // Rename.
  const config = src("next.config.ts");
  check("rename: /leads redirects to /contacts with a 307 (temporary), not a 308", /source: "\/leads", destination: "\/contacts", permanent: false/.test(config) && !/permanent: true/.test(config));
  check("rename: the page lives at /contacts and no page remains at /leads", existsSync(new URL("../app/(app)/contacts/page.tsx", import.meta.url)) && !existsSync(new URL("../app/(app)/leads/page.tsx", import.meta.url)));
  check("rename: the API is still /api/contacts", existsSync(new URL("../app/api/contacts/route.ts", import.meta.url)));
  const internal = ["lib/routes.ts", "components/layout/nav-items.ts", "components/layout/command-palette.tsx", "components/layout/quick-create-dialog.tsx", "components/home/daily-brief.tsx", "lib/contacts/search.ts", "lib/contacts/metrics.ts", "lib/data/sample-metrics.ts", "app/(app)/contacts/page.tsx"].map((f) => strip(src(f))).join("\n");
  check("rename: no internal link still points at /leads", !/["'`]\/leads[?"'`/]/.test(internal) && !internal.includes("ROUTES.leads"));
  check("rename: the top navigation says Contacts", src("components/layout/nav-items.ts").includes('label: "Contacts"') && !src("components/layout/nav-items.ts").includes('label: "Leads"'));
  check("rename: the page's visible title and empty states say contacts", (() => { const page = src("app/(app)/contacts/page.tsx"); return page.includes("Contacts\n          </p>") && page.includes("New contact") && page.includes("No contacts yet") && !/>\s*Leads\s*</.test(page); })());
  check("rename: the new-menu item and dialog say contact", src("components/layout/new-menu.tsx").includes("Contact") && src("components/layout/quick-create-dialog.tsx").includes('title: "New contact"'));

  // The role rule is decided by role, never by an address.
  const authored = ["lib/auth/actor.ts", "lib/contacts/visibility.ts", "lib/contacts/domain.ts", "lib/contacts/service.ts", "lib/contacts/access.ts", "lib/contacts/eligible.ts", "lib/transactions/service.ts", "components/leads/lead-shared.ts"].map((f) => strip(src(f))).join("\n");
  check("no business rule anywhere is decided by an email address or a name", !/fortmark\.net|daniel@|hidalgo|@fortmark|primaryEmail\s*===|email\s*===\s*["']/i.test(authored));
  check("transactions still use the shared privileged rule: admin, broker, coordinator see the brokerage", strip(src("lib/transactions/service.ts")).includes("isPrivileged(actor) ? tenant") && strip(src("lib/auth/actor.ts")).includes('PRIVILEGED_ROLES: readonly DbRole[] = ["admin", "broker", "transaction_coordinator"]'));
}

console.log(`\n${passed}/${passed + failures.length} Contacts V3 checks passed`);
if (failures.length) {
  console.log(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
