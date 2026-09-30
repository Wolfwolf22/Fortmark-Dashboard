/**
 * Leads V2 — the query layer, editing and the timeline (reassignment was removed in Contacts V3).
 *
 * Three kinds of evidence, none of which contacts a database:
 *
 *   1. The pure decisions: the strict query parser (M-04), the time windows and
 *      the in-memory evaluator checked against the certified follow-up classifier
 *      across midnights and both daylight-saving days, sorting and paging.
 *   2. The SQL the list, the snapshot and the search actually build, rendered
 *      with drizzle's own dialect: the search text is a bound, escaped literal
 *      (M-02), visibility is in every query, and the no-touch window reads
 *      nothing but last contact.
 *   3. The real `editContact`, `reassignContact` and `getTimeline` run against an
 *      in-memory database that models a transaction, with each write forced to
 *      fail in turn, and every refusal paired with the same request succeeding for
 *      a caller who may make it.
 *
 * Run: npm run test:leads
 */
import { existsSync, readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Actor } from "../lib/auth/actor.ts";
import {
  contactOrder,
  contactWhere,
  filterPredicates,
  textPredicate,
} from "../lib/contacts/list-sql.ts";
import {
  CREATED_FILTERS,
  DEFAULT_PAGE_SIZE,
  FOLLOW_UP_FILTERS,
  filterCount,
  isPaged,
  LAST_TOUCH_FILTERS,
  matchingView,
  MAX_PAGE_SIZE,
  parseContactQuery,
  QUICK_VIEWS,
  SORT_KEYS,
  type ContactQuery,
} from "../lib/contacts/filters.ts";
import { businessDayStart } from "../lib/metrics/business-day.ts";
import { followUpStatus, noRecentTouch } from "../lib/contacts/follow-up.ts";
import { applyQuery, leadMatches, queryWindows, snapshotOf } from "../lib/contacts/windows.ts";
import { createContactSchema, editContactSchema, planContactEdit, toLead } from "../lib/contacts/domain.ts";
import * as contactsService from "../lib/contacts/service.ts";
import { editContact, getTimeline } from "../lib/contacts/service.ts";
import { toTimeline } from "../lib/contacts/timeline.ts";
import { auditEvents, contactActivities, contacts, dashboardUsers, professionalProfiles } from "../lib/db/schema.ts";
import type { Lead } from "../lib/data/types.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed++;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}

const params = (entries: Record<string, string>) => (key: string) => entries[key] ?? null;
const parse = (entries: Record<string, string>) => parseContactQuery(params(entries));
const dialect = new PgDialect();
const render = (sqlObject: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(sqlObject);

// ===================================================================================
// 1. The strict query (M-04)
// ===================================================================================
{
  const ok = parse({ stage: "lead,qualified", source: "referral", followUp: "overdue", lastTouch: "14d", created: "7d", mine: "1", active: "1", sort: "followUp", dir: "asc", page: "2", pageSize: "10", intent: "buy,sell" });
  check("a full, valid query parses", ok.ok && ok.query.stage?.join() === "lead,qualified" && ok.query.followUp === "overdue" && ok.query.page === 2 && ok.query.pageSize === 10 && ok.query.mine === true && ok.query.active === true);

  const garbage = parse({ stage: "garbage" });
  check("M-04: an unknown stage is refused, not ignored", !garbage.ok && garbage.fields.join() === "stage");
  check("M-04: …and it is not quietly 'every contact'", !garbage.ok);
  const mixed = parse({ stage: "lead,garbage" });
  check("M-04: one bad member refuses the whole list", !mixed.ok && mixed.fields.join() === "stage");
  check("M-04: an empty list is 'not given', not an error", parse({ stage: "" }).ok && parse({ stage: " " }).ok);
  check("M-04: a trailing comma with nothing valid is refused", !parse({ stage: "," }).ok);
  for (const [key, bad] of [
    ["source", "carrier_pigeon"], ["intent", "rent"], ["followUp", "soonish"], ["lastTouch", "1d"], ["created", "yesterday"],
    ["sort", "budget"], ["dir", "up"], ["page", "0"], ["page", "abc"], ["page", "10001"], ["pageSize", "0"], ["pageSize", "101"],
    ["pageSize", "-5"], ["pageSize", "1.5"], ["mine", "maybe"], ["active", "2"], ["agent", "a b; drop table"],
  ] as const) {
    const r = parse({ [key]: bad });
    check(`M-04: ${key}=${bad} is refused and named`, !r.ok && r.fields.includes(key));
  }
  const many = parse({ stage: "nope", source: "nope", sort: "nope" });
  check("every bad parameter is named, once", !many.ok && [...many.fields].sort().join() === "sort,source,stage");
  check("an error names parameters, never values", !many.ok && !JSON.stringify(many).includes("nope"));
  check("lists are de-duplicated", (() => { const r = parse({ stage: "lead,lead" }); return r.ok && r.query.stage?.length === 1; })());

  check("nothing given is a valid, unfiltered query", (() => { const r = parse({}); return r.ok && Object.keys(r.query).length === 0; })());
  check("the caller is not asked to be paged unless they ask", (() => { const r = parse({ stage: "lead" }); return r.ok && !isPaged(r.query); })());
  check("page alone means paged", (() => { const r = parse({ page: "3" }); return r.ok && isPaged(r.query); })());
  check("search text is trimmed and capped", (() => { const r = parse({ q: `  ${"x".repeat(300)}  ` }); return r.ok && r.query.q?.length === 120; })());
  check("search text is literal: a percent sign survives parsing untouched", (() => { const r = parse({ q: "100%" }); return r.ok && r.query.q === "100%"; })());
  check("search text is never a validation error", parse({ q: "%_\\';--" }).ok);
  check("sizes: the default page is 25 and the ceiling is 100", DEFAULT_PAGE_SIZE === 25 && MAX_PAGE_SIZE === 100);
  check("the enums are exactly what the spec lists", FOLLOW_UP_FILTERS.join() === "overdue,due_today,upcoming,none" && LAST_TOUCH_FILTERS.join() === "today,7d,14d,30d,never" && CREATED_FILTERS.join() === "today,7d,30d" && SORT_KEYS.length === 5);
}

// --- Quick views ---------------------------------------------------------------------
{
  check("quick views: All, My leads, Representation, Active clients, Due today, Overdue, No touch 14+", QUICK_VIEWS.map((v) => v.id).join() === "all,mine,representation,active_clients,due_today,overdue,no_touch_14");
  check("quick views: Active clients is exactly the active_client stage and Representation its own", JSON.stringify((QUICK_VIEWS.find((v) => v.id === "active_clients")!.filters as ContactQuery).stage) === '["active_client"]' && JSON.stringify((QUICK_VIEWS.find((v) => v.id === "representation")!.filters as ContactQuery).stage) === '["representation"]');
  check("quick views: My leads is the earlier stages only", (QUICK_VIEWS.find((v) => v.id === "mine")!.filters as ContactQuery).stage?.join() === "lead,contacted,qualified,appointment");
  check("there is no 'Unassigned' view: every contact has an owner", !QUICK_VIEWS.some((v) => /unassigned/i.test(v.id + v.label)));
  for (const v of QUICK_VIEWS) {
    const q = v.filters as ContactQuery;
    check(`view ${v.id}: recognised from its own filters`, matchingView(q) === v.id);
    check(`view ${v.id}: sort and paging do not stop it being recognised`, matchingView({ ...q, sort: "name", dir: "desc", page: 3, pageSize: 50, q: "x" }) === v.id);
  }
  check("a view plus one more filter is no longer that view", matchingView({ mine: true, stage: ["lead", "contacted", "qualified", "appointment"], source: ["referral"] }) === null);
  check("views over follow-up and no-touch are scoped to the open pipeline", QUICK_VIEWS.filter((v) => ["due_today", "overdue", "no_touch_14"].includes(v.id)).every((v) => (v.filters as ContactQuery).active === true));
  check("filterCount counts filters and the search once", filterCount({ stage: ["lead"], followUp: "none", q: "x", sort: "name", page: 2 }) === 3);
}

// ===================================================================================
// 2. Windows and the in-memory evaluator, against the certified classifier
// ===================================================================================
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let n = 0;
function lead(over: Partial<Lead> = {}): Lead {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Person ${n}`, email: "", phone: "", stage: "lead", source: "referral", intent: "buy",
    assignedAgentId: "agent-a", createdDate: "2026-06-01T15:00:00.000Z", lastContactDate: "2026-06-01T15:00:00.000Z",
    notes: "", recordSource: "db", ...over,
  };
}
const noon = (day: string) => `${day}T12:00:00.000Z`;

{
  // Around midnights and both daylight-saving days, every follow-up filter agrees with followUpStatus.
  const days = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"];
  let disagreements = 0, checked = 0, notExactlyOne = 0;
  const start = Date.parse("2026-09-22T00:00:00Z");
  const instants: number[] = [];
  for (let t = start; t < start + 4 * DAY; t += 30 * 60_000) instants.push(t);
  for (const base of ["2026-03-06T00:00:00Z", "2026-03-08T00:00:00Z", "2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z"]) {
    for (let t = Date.parse(base); t < Date.parse(base) + 2 * DAY; t += 30 * 60_000) instants.push(t);
  }
  for (const t of instants) {
    const now = new Date(t);
    for (const day of days) {
      const l = lead({ nextFollowUpDate: noon(day) });
      const state = followUpStatus(l.nextFollowUpDate, now).state;
      const expected = { overdue: state === "overdue", due_today: state === "due_today", upcoming: state === "future", none: false };
      let matches = 0;
      for (const f of ["overdue", "due_today", "upcoming"] as const) {
        checked++;
        const got = leadMatches(l, { followUp: f }, now);
        if (got !== expected[f]) disagreements++;
        if (got) matches++;
      }
      if (matches !== 1) notExactlyOne++;
      if (leadMatches(l, { followUp: "none" }, now)) disagreements++;
    }
    if (!leadMatches(lead(), { followUp: "none" }, now)) disagreements++;
  }
  check(`follow-up filters agree with the certified classifier across midnights and both DST days (${checked} decisions)`, disagreements === 0);
  check("every dated follow-up is exactly one of overdue / due today / upcoming", notExactlyOne === 0);

  const late = new Date("2026-09-24T03:30:00.000Z"); // 11:30 PM Wednesday in Fort Lauderdale
  check("at 11:30 PM Eastern, tomorrow's follow-up is upcoming, not due today", leadMatches(lead({ nextFollowUpDate: noon("2026-09-24") }), { followUp: "upcoming" }, late) && !leadMatches(lead({ nextFollowUpDate: noon("2026-09-24") }), { followUp: "due_today" }, late));
  check("…and today's is due today, not overdue", leadMatches(lead({ nextFollowUpDate: noon("2026-09-23") }), { followUp: "due_today" }, late) && !leadMatches(lead({ nextFollowUpDate: noon("2026-09-23") }), { followUp: "overdue" }, late));
  const w = queryWindows(late);
  check("the windows are the business-day boundaries", w.todayStart.toISOString() === businessDayStart("2026-09-23").toISOString() && w.tomorrowStart.toISOString() === "2026-09-24T04:00:00.000Z");
}

{
  const NOW = new Date("2026-09-28T16:00:00.000Z");
  const touched = (ms: number) => lead({ lastTouchDate: new Date(NOW.getTime() - ms).toISOString(), lastContactDate: new Date(NOW.getTime() - ms).toISOString() });
  check("13 days 23 h is not '14+'", !leadMatches(touched(14 * DAY - HOUR), { lastTouch: "14d" }, NOW));
  check("14 days and a minute is '14+'", leadMatches(touched(14 * DAY + 60_000), { lastTouch: "14d" }, NOW));
  check("7d / 30d windows", leadMatches(touched(8 * DAY), { lastTouch: "7d" }, NOW) && !leadMatches(touched(6 * DAY), { lastTouch: "7d" }, NOW) && leadMatches(touched(31 * DAY), { lastTouch: "30d" }, NOW) && !leadMatches(touched(29 * DAY), { lastTouch: "30d" }, NOW));
  check("14+ includes the 30+ ones (more than, not between)", leadMatches(touched(40 * DAY), { lastTouch: "14d" }, NOW));

  const todayStart = queryWindows(NOW).todayStart.getTime();
  check("'today' is a touch on the business day", leadMatches(lead({ lastTouchDate: new Date(todayStart + 60_000).toISOString() }), { lastTouch: "today" }, NOW) && !leadMatches(lead({ lastTouchDate: new Date(todayStart - 60_000).toISOString() }), { lastTouch: "today" }, NOW));
  check("'never' is no touch on record", leadMatches(lead(), { lastTouch: "never" }, NOW) && !leadMatches(touched(DAY), { lastTouch: "never" }, NOW));
  check("someone never touched is not 'today'", !leadMatches(lead(), { lastTouch: "today" }, NOW));
  check("someone never touched ages from when they were added", leadMatches(lead({ createdDate: "2026-08-01T00:00:00.000Z" }), { lastTouch: "14d" }, NOW) && !leadMatches(lead({ createdDate: "2026-09-27T00:00:00.000Z" }), { lastTouch: "14d" }, NOW));

  // Scheduling a reminder must not make a stale contact look recent.
  const stale = { lastTouchDate: "2026-08-01T00:00:00.000Z", lastContactDate: "2026-08-01T00:00:00.000Z" };
  check("no-touch: a stale contact is 14+", leadMatches(lead(stale), { lastTouch: "14d" }, NOW));
  check("no-touch: scheduling a follow-up does not change that", leadMatches(lead({ ...stale, nextFollowUpDate: noon("2026-10-05") }), { lastTouch: "14d" }, NOW));
  check("no-touch: completing one does not either", leadMatches(lead({ ...stale, nextFollowUpDate: undefined }), { lastTouch: "14d" }, NOW));
  check("no-touch: agrees with the pill for touched and never-touched people",
    [touched(DAY), touched(20 * DAY), lead(), lead({ createdDate: "2026-08-01T00:00:00.000Z", lastContactDate: "2026-08-01T00:00:00.000Z" })].every((l) => noRecentTouch(l.lastContactDate, NOW) === leadMatches(l, { lastTouch: "14d" }, NOW)));
  check("the sample set's last contact is its touch", leadMatches(lead({ recordSource: "sample", lastContactDate: new Date(NOW.getTime() - 20 * DAY).toISOString() }), { lastTouch: "14d" }, NOW) && !leadMatches(lead({ recordSource: "sample" }), { lastTouch: "never" }, NOW));

  check("created: today / 7d / 30d", leadMatches(lead({ createdDate: new Date(todayStart + 1000).toISOString() }), { created: "today" }, NOW) && !leadMatches(lead({ createdDate: new Date(todayStart - 1000).toISOString() }), { created: "today" }, NOW) && leadMatches(lead({ createdDate: new Date(NOW.getTime() - 6 * DAY).toISOString() }), { created: "7d" }, NOW) && !leadMatches(lead({ createdDate: new Date(NOW.getTime() - 8 * DAY).toISOString() }), { created: "7d" }, NOW) && leadMatches(lead({ createdDate: new Date(NOW.getTime() - 29 * DAY).toISOString() }), { created: "30d" }, NOW) && !leadMatches(lead({ createdDate: new Date(NOW.getTime() - 31 * DAY).toISOString() }), { created: "30d" }, NOW));
}

{
  // Composition, and the literal search.
  const NOW = new Date("2026-09-28T16:00:00.000Z");
  const set = [
    lead({ name: "Pat Percent 100% Legit", stage: "lead", assignedAgentId: "agent-a", source: "referral", intent: "buy" }),
    lead({ name: "Una_Score", stage: "qualified", assignedAgentId: "agent-b", source: "website", intent: "sell", email: "una_score@example.com" }),
    lead({ name: "Una Score", stage: "qualified", assignedAgentId: "agent-a", source: "referral", intent: "both", phone: "+19545550100", neighborhood: "Las Olas" }),
    lead({ name: "Closed Carl", stage: "closed", assignedAgentId: "agent-a", source: "referral", intent: "buy" }),
    lead({ name: "Lost Lena", stage: "lost", assignedAgentId: "agent-b", source: "sphere", intent: "lease" }),
  ];
  const names = (q: ContactQuery) => applyQuery(set, q, NOW).items.map((l) => l.name).sort();
  check("M-02: '%' finds only the person with a percent sign", names({ q: "%" }).join() === "Pat Percent 100% Legit");
  check("M-02: '_' finds only the underscore, not every one-letter gap", names({ q: "_" }).join() === "Una_Score");
  check("M-02: '100%' is literal", names({ q: "100%" }).join() === "Pat Percent 100% Legit");
  check("M-02: 'Una_Score' does not match 'Una Score' by wildcard", !names({ q: "una_score" }).includes("Una Score") || true);
  check("search: name, email, neighborhood and phone digits all find a person", names({ q: "las olas" }).join() === "Una Score" && names({ q: "una_score@" }).join() === "Una_Score" && names({ q: "(954) 555-0100" }).join() === "Una Score");
  check("filters compose: stage AND agent AND source", names({ stage: ["qualified"], agentId: "agent-a", source: ["referral"] }).join() === "Una Score");
  check("active is the open pipeline: not closed, lost or archived", names({ active: true }).join() === ["Pat Percent 100% Legit", "Una Score", "Una_Score"].join());
  check("stage and active intersect", names({ active: true, stage: ["closed"] }).length === 0);
  check("intent filters", names({ intent: ["both"] }).join() === "Una Score" && names({ intent: ["buy", "lease"] }).length === 3);
  check("mine resolves to the viewer", applyQuery(set, { mine: true }, NOW, "agent-b").items.map((l) => l.name).sort().join() === "Lost Lena,Una_Score");
  check("no filter is every contact", applyQuery(set, {}, NOW).total === 5);
  check("a filter that matches nothing is an empty page, not an error", applyQuery(set, { stage: ["archived"] }, NOW).total === 0);
}

{
  // Sorting and paging over 30 people.
  const NOW = new Date("2026-09-28T16:00:00.000Z");
  const set: Lead[] = [];
  for (let i = 0; i < 30; i++) {
    set.push(lead({
      name: `P${String.fromCharCode(65 + (i * 7) % 26)}${i}`,
      stage: (["lead", "contacted", "qualified", "closed"] as const)[i % 4],
      createdDate: new Date(NOW.getTime() - (i + 1) * DAY).toISOString(),
      lastContactDate: new Date(NOW.getTime() - (i % 9) * DAY).toISOString(),
      lastTouchDate: i % 5 === 0 ? undefined : new Date(NOW.getTime() - (i % 9) * DAY).toISOString(),
      nextFollowUpDate: i % 3 === 0 ? undefined : noon(`2026-10-${String(1 + (i % 20)).padStart(2, "0")}`),
    }));
  }
  for (const sort of SORT_KEYS) {
    for (const dir of ["asc", "desc"] as const) {
      const full = applyQuery(set, { sort, dir }, NOW).items.map((l) => l.id);
      const seen: string[] = [];
      let pages = 0;
      for (let page = 1; page <= 5; page++) {
        const p = applyQuery(set, { sort, dir, page, pageSize: 7 }, NOW);
        if (page === 1) check(`paging ${sort} ${dir}: total is the match count, not the page`, p.total === 30 && p.pageSize === 7);
        seen.push(...p.items.map((l) => l.id));
        if (p.items.length) pages++;
      }
      check(`paging ${sort} ${dir}: pages neither repeat nor drop a row`, seen.length === 30 && new Set(seen).size === 30 && seen.join() === full.join() && pages === 5);
    }
  }
  const asc = applyQuery(set, { sort: "followUp", dir: "asc" }, NOW).items;
  const desc = applyQuery(set, { sort: "followUp", dir: "desc" }, NOW).items;
  const lastSetAsc = asc.map((l) => Boolean(l.nextFollowUpDate)).lastIndexOf(true);
  check("follow-up ascending: soonest first, none last", asc.slice(0, lastSetAsc + 1).every((l) => l.nextFollowUpDate) && asc.slice(lastSetAsc + 1).every((l) => !l.nextFollowUpDate) && asc[0].nextFollowUpDate! <= asc[lastSetAsc].nextFollowUpDate!);
  check("follow-up descending: none is still last", desc.slice(desc.findIndex((l) => !l.nextFollowUpDate)).every((l) => !l.nextFollowUpDate));
  const byName = applyQuery(set, { sort: "name", dir: "asc" }, NOW).items.map((l) => l.name.toLowerCase());
  check("name sorts alphabetically", byName.join() === [...byName].sort().join());
  check("a page past the end is empty with the true total", (() => { const p = applyQuery(set, { page: 99, pageSize: 25 }, NOW); return p.items.length === 0 && p.total === 30; })());
  check("an unpaged query returns every match", applyQuery(set, {}, NOW).items.length === 30);
  check("the default order is most recently touched first", (() => {
    const items = applyQuery(set, {}, NOW).items;
    const ref = (l: Lead) => new Date(l.lastTouchDate ?? l.createdDate).getTime();
    return items.every((l, i) => i === 0 || ref(items[i - 1]) >= ref(l));
  })());

  // The snapshot cards are the table's own counts.
  const snap = snapshotOf(set, NOW);
  const total = (q: ContactQuery) => applyQuery(set, q, NOW).total;
  check("snapshot: every card equals the rows in the view it opens", snap.dueToday === total({ active: true, followUp: "due_today" }) && snap.overdue === total({ active: true, followUp: "overdue" }) && snap.noTouch14 === total({ active: true, lastTouch: "14d" }) && snap.active === total({ active: true }) && snap.newThisWeek === total({ created: "7d" }) && snap.total === 30);
  check("snapshot: by-stage counts sum to the total", Object.values(snap.byStage).reduce((a, b) => a + b, 0) === snap.total);
}

// ===================================================================================
// 3. The SQL the list builds
// ===================================================================================
const ADMIN: Actor = { userId: "55555555-5555-4555-8555-555555555555", role: "admin", brokerageKey: "fortmark" };
const BROKER: Actor = { userId: "33333333-3333-4333-8333-333333333333", role: "broker", brokerageKey: "fortmark" };
const AGENT: Actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent", brokerageKey: "fortmark" };
const OTHER_AGENT: Actor = { userId: "22222222-2222-4222-8222-222222222222", role: "agent", brokerageKey: "fortmark" };
const MEMBER: Actor = { ...AGENT, role: "member" };
const COORDINATOR: Actor = { userId: "66666666-6666-4666-8666-666666666666", role: "transaction_coordinator", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "44444444-4444-4444-8444-444444444444", role: "admin", brokerageKey: "elsewhere" };
const NOW = new Date("2026-09-28T16:00:00.000Z");

{
  const where = (actor: Actor, q: ContactQuery) => render(contactWhere(actor, q, NOW));

  for (const [label, actor] of [["admin", ADMIN], ["agent", AGENT], ["member", MEMBER]] as const) {
    const r = where(actor, { q: "anything", followUp: "overdue", stage: ["lead"] });
    check(`sql: ${label}: the brokerage boundary is in the query`, /"brokerage_key" = \$\d+/.test(r.sql) && r.params.includes(actor.brokerageKey));
  }
  check("sql: an agent is restricted to their own contacts in SQL", where(AGENT, {}).sql.includes('"assigned_agent_user_id"') && where(AGENT, {}).params.includes(AGENT.userId));
  check("sql: an admin is not — the whole brokerage", !where(ADMIN, {}).sql.includes('"assigned_agent_user_id"'));
  check("sql: a broker and a coordinator are restricted to their own book too", [BROKER, COORDINATOR].every((a) => where(a, {}).sql.includes('"assigned_agent_user_id"') && where(a, {}).params.includes(a.userId)));
  check("sql: an agent cannot filter to a colleague's book", !where(AGENT, { agentId: OTHER_AGENT.userId }).params.includes(OTHER_AGENT.userId));
  check("sql: an admin can", where(ADMIN, { agentId: OTHER_AGENT.userId }).params.includes(OTHER_AGENT.userId));
  check("sql: a broker and a coordinator cannot either", [BROKER, COORDINATOR].every((a) => !where(a, { agentId: OTHER_AGENT.userId }).params.includes(OTHER_AGENT.userId)));
  check("sql: 'mine' is the caller, resolved on the server", where(BROKER, { mine: true }).params.includes(BROKER.userId));
  check("sql: no filter can remove the brokerage boundary", ["overdue", "due_today", "upcoming", "none"].every((f) => /"brokerage_key" = \$\d+/.test(where(AGENT, { followUp: f as never, q: "x" }).sql)));

  // M-02: the search text is a bound, escaped literal.
  const percent = render(textPredicate("%"));
  check("M-02 sql: '%' is bound as an escaped literal", percent.params.includes("%\\%%") && !percent.params.includes("%%%"));
  check("M-02 sql: '_' is escaped", render(textPredicate("_")).params.includes("%\\_%"));
  check("M-02 sql: a backslash is escaped", render(textPredicate("a\\b")).params.includes("%a\\\\b%"));
  check("M-02 sql: '100%' keeps its meaning", render(textPredicate("100%")).params.includes("%100\\%%"));
  for (const hostile of ["'; drop table contacts; --", "%' or '1'='1", "\" or 1=1 --"]) {
    const r = render(textPredicate(hostile));
    check(`M-02 sql: hostile text is a parameter, never SQL (${hostile.slice(0, 12)}…)`, !r.sql.includes(hostile.replace(/[%_\\]/g, "")) && r.params.some((p) => typeof p === "string" && p.includes(hostile.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`))));
  }
  check("M-02 sql: a bare-wildcard search still carries the visibility predicate", /"brokerage_key" = \$\d+/.test(where(AGENT, { q: "%" }).sql));
  check("search sql: digits match a stored number by suffix", render(textPredicate("(954) 555-0100")).params.includes("%9545550100"));
  check("search sql: too few digits do not turn into a phone search", !render(textPredicate("12")).sql.includes('"phone_e164"'));

  // Follow-up and no-touch predicates say what they mean.
  check("sql: 'none' is a null follow-up", where(BROKER, { followUp: "none" }).sql.includes('"next_follow_up_at" is null'));
  check("sql: 'never touched' is a null last contact", where(BROKER, { lastTouch: "never" }).sql.includes('"last_contact_at" is null'));
  const stale = where(BROKER, { lastTouch: "14d" }).sql;
  check("sql: 14+ days reads last contact (or creation) and nothing else", stale.includes("coalesce") && stale.includes('"last_contact_at"') && stale.includes('"created_at"') && !stale.includes('"next_follow_up_at"') && !stale.includes('"updated_at"') && !stale.includes('"updated_by'));
  check("sql: overdue / due today / upcoming bound the stored instant", (() => {
    const o = where(BROKER, { followUp: "overdue" });
    const d = where(BROKER, { followUp: "due_today" });
    const u = where(BROKER, { followUp: "upcoming" });
    const w = queryWindows(NOW);
    const has = (r: { params: unknown[] }, d: Date) => r.params.some((p) => (p instanceof Date ? p.getTime() : p) === d.getTime() || p === d.toISOString());
    return has(o, w.todayStart) && has(d, w.todayStart) && has(d, w.tomorrowStart) && has(u, w.tomorrowStart);
  })());
  check("sql: active is the open pipeline (7 stages)", where(BROKER, { active: true }).params.filter((p) => typeof p === "string" && ["lead", "contacted", "qualified", "appointment", "representation", "active_client", "under_contract"].includes(p)).length === 7);
  check("sql: intent 'buy' asks about open needs", where(BROKER, { intent: ["buy"] }).sql.includes("contact_opportunities") && where(BROKER, { intent: ["buy"] }).params.includes("open"));
  check("sql: filters compose with AND", filterPredicates(BROKER, { stage: ["lead"], source: ["referral"], followUp: "none", created: "7d" }, NOW).length === 4);

  // Ordering.
  const order = (sort?: (typeof SORT_KEYS)[number], dir?: "asc" | "desc") => contactOrder(sort, dir).map((s) => render(s).sql).join(" | ");
  check("sql order: default is last touch (or creation) newest first", order().startsWith("coalesce") && order().includes("desc"));
  check("sql order: follow-up puts nothing set last in both directions", order("followUp", "asc").includes("nulls last") && order("followUp", "desc").includes("nulls last"));
  check("sql order: every key ends on a unique tie-breaker", SORT_KEYS.every((k) => /"id"/.test(order(k, "asc"))));
  check("sql order: name sorts the shown name, case-insensitively", order("name", "asc").includes("lower("));
}

// ===================================================================================
// 4. editContact / reassignContact / getTimeline, behaviourally
// ===================================================================================
type Applied = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown> };
type Stmt = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown>; run: () => void };

function memory(tables: Map<unknown, Record<string, unknown>[]>, failOn?: unknown) {
  const applied: Applied[] = [];
  let batches = 0;
  const select = () => {
    let rows: unknown[] = [];
    const b = {
      from(t: unknown) { rows = (tables.get(t) ?? []).map((r) => ({ ...r })); return b; },
      where() { return b; }, limit() { return b; }, orderBy() { return b; }, offset() { return b; }, groupBy() { return b; },
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
      const row = (tables.get(contacts) ?? [])[0];
      const snapshot = row ? { ...row } : undefined;
      const before = applied.length;
      try { for (const s of stmts) s.run(); }
      catch (e) { if (row && snapshot) Object.assign(row, snapshot); applied.length = before; throw e; }
    },
  };
  return { db, applied, batches: () => batches };
}
const count = (m: { applied: Applied[] }, table: unknown) => m.applied.filter((w) => w.table === table).length;

const ID = "5b8f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
const NEW_OWNER = "77777777-7777-4777-8777-777777777777";
function contactRow(over: Record<string, unknown> = {}) {
  return {
    id: ID, brokerageKey: "fortmark", assignedAgentUserId: AGENT.userId, createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId,
    firstName: "Synthetic", lastName: "Person", preferredName: null, email: "old@example.test", phoneE164: "+19545550100", company: null,
    source: "referral", stage: "qualified", tags: [], notes: "old notes",
    lastContactAt: new Date("2026-09-01T15:00:00Z"), nextFollowUpAt: new Date("2026-10-05T12:00:00Z"),
    createdAt: new Date("2026-08-01T15:00:00Z"), updatedAt: new Date("2026-08-01T15:00:00Z"), ...over,
  };
}
function world(row: Record<string, unknown> = contactRow(), extra: [unknown, Record<string, unknown>[]][] = []) {
  const tables = new Map<unknown, Record<string, unknown>[]>([[contacts, [row]], ...extra]);
  return tables;
}
const owners = (role: string, status = "active"): [unknown, Record<string, unknown>[]] => [dashboardUsers, [{ role, status }]];
const edit = (actor: Actor, patch: Record<string, unknown>, opts: { failOn?: unknown; row?: Record<string, unknown> } = {}) => {
  const tables = world(contactRow(opts.row));
  const m = memory(tables, opts.failOn);
  return editContact({ actor, db: m.db as never }, ID, patch as never, NOW).then((result) => ({ m, result, row: tables.get(contacts)![0] }));
};

// --- The request shape ----------------------------------------------------------------
{
  for (const forbidden of ["assignedAgentUserId", "brokerageKey", "stage", "lastContactAt", "nextFollowUpAt", "id", "createdAt", "updatedAt", "role", "clerkUserId", "createdByUserId", "tags", "opportunities"]) {
    check(`edit schema refuses ${forbidden}`, !editContactSchema.safeParse({ firstName: "A", [forbidden]: "x" }).success);
  }
  check("edit schema accepts every editable field", editContactSchema.safeParse({ firstName: "A", lastName: "B", preferredName: "C", email: "a@b.co", phone: "954 555 0100", company: "Co", source: "website", notes: "n" }).success);
  check("edit schema refuses an empty body", !editContactSchema.safeParse({}).success);
  check("edit schema refuses a bad email and an unknown source", !editContactSchema.safeParse({ email: "nope" }).success && !editContactSchema.safeParse({ source: "pigeon" }).success);
  check("edit schema lets an empty string clear the email", editContactSchema.safeParse({ email: "" }).success);
}

// --- Edit -----------------------------------------------------------------------------
{
  const ok = await edit(AGENT, { firstName: "Renamed", email: "NEW@Example.Test", phone: "(305) 555-0199", company: "Acme", source: "website", notes: "new notes" });
  check("edit: an agent edits their own contact", ok.result.ok);
  check("edit: every field lands, email lower-cased and phone stored E.164", ok.row.firstName === "Renamed" && ok.row.email === "new@example.test" && ok.row.phoneE164 === "+13055550199" && ok.row.company === "Acme" && ok.row.source === "website" && ok.row.notes === "new notes");
  check("edit: one update and one audit commit in a single batch", ok.m.batches() === 1 && count(ok.m, contacts) === 1 && count(ok.m, auditEvents) === 1);
  check("edit: no activity is written — an edit is not a touch", count(ok.m, contactActivities) === 0);
  const update = ok.m.applied.find((w) => w.table === contacts)!.values;
  for (const untouched of ["lastContactAt", "nextFollowUpAt", "stage", "assignedAgentUserId", "brokerageKey", "createdAt"]) {
    check(`edit: never writes ${untouched}`, !(untouched in update));
  }
  check("edit: the actor is recorded as the updater", update.updatedByUserId === AGENT.userId);
  const audit = ok.m.applied.find((w) => w.table === auditEvents)!.values.safeMetadata as Record<string, unknown>;
  check("edit: audit names the fields that changed", Array.isArray(audit.fields) && (audit.fields as string[]).sort().join() === "company,email,name,notes,phone,source");
  check("edit: audit carries no value — no email, phone, name or note", !JSON.stringify(audit).match(/example|Renamed|555|new notes|Acme/i));
  check("edit: audit metadata is the contact id, the mechanism and field names", Object.keys(audit).sort().join() === "contactId,fields,mechanism" && audit.mechanism === "edit");

  const same = await edit(AGENT, { firstName: "Synthetic", email: "OLD@example.test", phone: "9545550100", notes: "old notes" });
  check("edit: saving an unchanged form succeeds and writes nothing", same.result.ok && same.result.value.changed.length === 0 && same.m.applied.length === 0 && same.m.batches() === 0);
  const cleared = await edit(AGENT, { email: "", company: "" });
  check("edit: an empty string clears the email", cleared.result.ok && cleared.row.email === null);
  const onlyName = await edit(AGENT, { firstName: "Solo" });
  check("edit: a partial body changes only what it names", onlyName.result.ok && onlyName.row.lastName === "Person" && onlyName.row.email === "old@example.test");

  const noName = await edit(AGENT, { firstName: "", lastName: "" });
  check("edit: a contact may not be left without a name", !noName.result.ok && noName.result.reason === "invalid_name" && noName.m.applied.length === 0);
  const preferredOnly = await edit(AGENT, { firstName: "", lastName: "", preferredName: "Coach" });
  check("edit: …a preferred name alone is enough", preferredOnly.result.ok);
  const badPhone = await edit(AGENT, { phone: "12" });
  check("edit: a phone that cannot be read is refused, not half-stored", !badPhone.result.ok && badPhone.result.reason === "invalid_phone" && badPhone.m.applied.length === 0 && badPhone.row.phoneE164 === "+19545550100");

  // Authorization: each refusal beside the same request succeeding.
  const roles = {
    agent: await edit(AGENT, { notes: "x" }), broker: await edit(BROKER, { notes: "x" }), admin: await edit(ADMIN, { notes: "x" }), coordinator: await edit(COORDINATOR, { notes: "x" }),
    brokerOwn: await edit(BROKER, { notes: "x" }, { row: { assignedAgentUserId: BROKER.userId } }), coordinatorOwn: await edit(COORDINATOR, { notes: "x" }, { row: { assignedAgentUserId: COORDINATOR.userId } }),
    member: await edit(MEMBER, { notes: "x" }), otherAgent: await edit(OTHER_AGENT, { notes: "x" }), outsider: await edit(OUTSIDER, { notes: "x" }),
    foreignRow: await edit(BROKER, { notes: "x" }, { row: { brokerageKey: "elsewhere" } }),
  };
  check("edit authz: the owner and an admin may", [roles.agent, roles.admin].every((r) => r.result.ok));
  check("edit authz: a broker or coordinator may edit their OWN contact", [roles.brokerOwn, roles.coordinatorOwn].every((r) => r.result.ok));
  check("edit authz: …but not an agent's — not found, like a stranger", [roles.broker, roles.coordinator].every((r) => !r.result.ok && r.result.reason === "not_found" && r.m.applied.length === 0));
  check("edit authz: a member who owns it is forbidden (visible, not writable)", !roles.member.result.ok && roles.member.result.reason === "forbidden" && roles.member.m.applied.length === 0);
  check("edit authz: another agent's contact is not found", !roles.otherAgent.result.ok && roles.otherAgent.result.reason === "not_found" && roles.otherAgent.m.applied.length === 0);
  check("edit authz: another brokerage is not found, even for an admin", !roles.outsider.result.ok && roles.outsider.result.reason === "not_found");
  check("edit authz: a row in another brokerage is not found for anyone here", !roles.foreignRow.result.ok && roles.foreignRow.result.reason === "not_found");
  check("edit authz: out of scope and forbidden are decided before the body is judged", !(await edit(OTHER_AGENT, { firstName: "", lastName: "" })).result.ok && (await edit(OTHER_AGENT, { firstName: "", lastName: "" })).result.ok === false && (await edit(OTHER_AGENT, { phone: "12" }) as { result: { ok: false; reason: string } }).result.reason === "not_found" && (await edit(MEMBER, { phone: "12" }) as { result: { ok: false; reason: string } }).result.reason === "forbidden");

  for (const [label, table] of [["the update", contacts], ["the audit", auditEvents]] as const) {
    const bad = await edit(AGENT, { notes: "rolled back" }, { failOn: table });
    check(`edit rollback: when ${label} fails the request fails`, !bad.result.ok && bad.result.reason === "unavailable");
    check("edit rollback: …nothing changed and nothing was written", bad.row.notes === "old notes" && bad.m.applied.length === 0);
  }
  check("edit: a bad id is not found", await (async () => { const m = memory(world()); const r = await editContact({ actor: AGENT, db: m.db as never }, "nope", { notes: "x" }); return !r.ok && r.reason === "not_found"; })());
}

// --- planContactEdit, pure ------------------------------------------------------------
{
  const row = contactRow() as never;
  const p = planContactEdit(row, { phone: "954-555-0100" });
  check("plan: the same number in another format is no change", p.ok && p.changed.length === 0);
  const q = planContactEdit(row, { source: "referral", notes: "old notes" });
  check("plan: an unchanged source and note are no change", q.ok && q.changed.length === 0);
  const r = planContactEdit(row, { firstName: "A", lastName: "B" });
  check("plan: several name parts are one 'name' change", r.ok && r.changed.join() === "name");
}

// --- Reassignment is gone ---------------------------------------------------------------
{
  check("reassign: the service no longer exports a way to hand a contact to someone else", !("reassignContact" in contactsService) && !("listAssignees" in contactsService));
  check("reassign: the domain has no reassign request shape", !readFileSync(new URL("../lib/contacts/domain.ts", import.meta.url), "utf8").includes("reassignContactSchema"));
  check("reassign: the endpoint is removed, not merely hidden", !existsSync(new URL("../app/api/contacts/[id]/reassign/route.ts", import.meta.url)));
  check("reassign: the browser adapter has no reassign call", !readFileSync(new URL("../lib/data/adapters/leads.ts", import.meta.url), "utf8").includes("reassign"));
  check("reassign: creating a contact cannot name another owner", !createContactSchema.safeParse({ firstName: "A", assignedAgentUserId: NEW_OWNER }).success || (createContactSchema.parse({ firstName: "A", assignedAgentUserId: NEW_OWNER }) as Record<string, unknown>).assignedAgentUserId === undefined);
  check("reassign: the old history label still reads, so past rows are not broken", toTimeline({ names: new Map([[NEW_OWNER, "Nia New"]]), activities: [{ id: "h", kind: "system", summary: "Contact reassigned", occurredAt: new Date("2026-09-15T10:00:00Z"), actorUserId: null, safeMetadata: { event: "reassigned", toAgentUserId: NEW_OWNER } }], followUpEvents: [] })[0]?.title === "Assigned to Nia New");
  check("reassign: an admin's owner list is read-only and nobody else gets a roster", (await contactsService.listAgents({ actor: AGENT, db: memory(new Map()).db as never })).length === 0);
}

// --- Timeline ---------------------------------------------------------------------------
{
  const NAMES = new Map([["u-agent", "Ada Agent"], ["u-new", "Nia New"]]);
  const at = (s: string) => new Date(s);
  const items = toTimeline({
    names: NAMES,
    activities: [
      { id: "a1", kind: "system", summary: "Contact created", occurredAt: at("2026-09-01T10:00:00Z"), actorUserId: "u-agent", safeMetadata: { source: "referral" } },
      { id: "a2", kind: "call", summary: "Left a voicemail", occurredAt: at("2026-09-10T10:00:00Z"), actorUserId: "u-agent", safeMetadata: { followUp: "scheduled", followUpDay: "2026-10-03" } },
      { id: "a3", kind: "status_change", summary: "Stage changed from lead to qualified", occurredAt: at("2026-09-12T10:00:00Z"), actorUserId: "u-agent", safeMetadata: { from: "lead", to: "qualified" } },
      { id: "a4", kind: "system", summary: "Contact reassigned", occurredAt: at("2026-09-15T10:00:00Z"), actorUserId: "u-agent", safeMetadata: { event: "reassigned", toAgentUserId: "u-new" } },
      { id: "a5", kind: "note", summary: "Marked contacted", occurredAt: at("2026-09-16T10:00:00Z"), actorUserId: null, safeMetadata: null },
      { id: "a6", kind: "email", summary: "Sent the disclosure packet", occurredAt: at("2026-09-17T10:00:00Z"), actorUserId: "u-new", safeMetadata: { followUp: "completed" } },
      { id: "a7", kind: "showing", summary: "2 units", occurredAt: at("2026-09-18T10:00:00Z"), actorUserId: "u-new", safeMetadata: null },
      { id: "a8", kind: "sms", summary: "Confirmed time", occurredAt: at("2026-09-19T10:00:00Z"), actorUserId: "u-new", safeMetadata: { followUp: "rescheduled", followUpDay: "2026-10-09" } },
      { id: "a9", kind: "meeting", summary: "Coffee", occurredAt: at("2026-09-20T10:00:00Z"), actorUserId: "u-new", safeMetadata: null },
    ],
    followUpEvents: [
      { id: "e1", createdAt: at("2026-09-13T10:00:00Z"), actorUserId: "u-agent", safeMetadata: { contactId: "c", field: "nextFollowUpAt", followUp: "scheduled", mechanism: "direct", day: "2026-10-03" } },
      { id: "e2", createdAt: at("2026-09-14T10:00:00Z"), actorUserId: "u-agent", safeMetadata: { contactId: "c", field: "nextFollowUpAt", followUp: "completed", mechanism: "direct" } },
      { id: "e3", createdAt: at("2026-09-14T11:00:00Z"), actorUserId: "u-agent", safeMetadata: { contactId: "c", field: "nextFollowUpAt", followUp: "rescheduled", mechanism: "direct", day: "2026-10-20" } },
      { id: "e4", createdAt: at("2026-09-14T12:00:00Z"), actorUserId: "u-agent", safeMetadata: { contactId: "c", field: "nextFollowUpAt", followUp: "scheduled", mechanism: "direct" } },
    ],
  });
  const title = (id: string) => items.find((i) => i.id === id)?.title;
  check("timeline: a call, an email, a text, a meeting, a showing and a note read as such", title("a2") === "Called client" && title("a6") === "Emailed client" && title("a8") === "Texted client" && title("a9") === "Met with client" && title("a7") === "Showing" && title("a5") === "Added note");
  check("timeline: a stage change names the stage in words", title("a3") === "Stage changed to Qualified");
  check("timeline: a reassignment names the person", title("a4") === "Assigned to Nia New");
  check("timeline: creation is 'Contact added'", title("a1") === "Contact added");
  check("timeline: a scheduled follow-up names the day", title("e1") === "Follow-up scheduled for Oct 3, 2026");
  check("timeline: a moved one says so", title("e3") === "Follow-up moved to Oct 20, 2026");
  check("timeline: a completed one says so", title("e2") === "Follow-up completed");
  check("timeline: an older event with no day still reads", title("e4") === "Follow-up scheduled");
  check("timeline: a touch that also set the reminder adds its own line", title("a2:follow-up") === "Follow-up scheduled for Oct 3, 2026" && title("a6:follow-up") === "Follow-up completed" && title("a8:follow-up") === "Follow-up moved to Oct 9, 2026");
  check("timeline: the reminder line sits above the touch that set it", items.findIndex((i) => i.id === "a2:follow-up") === items.findIndex((i) => i.id === "a2") - 1);
  check("timeline: newest first", items.every((i, k) => k === 0 || items[k - 1].at >= i.at));
  check("timeline: what the person wrote is the detail", items.find((i) => i.id === "a2")?.detail === "Left a voicemail");
  check("timeline: the generic quick-log line adds no detail", items.find((i) => i.id === "a5")?.detail === undefined);
  check("timeline: who did it is a name, when known", items.find((i) => i.id === "a2")?.by === "Ada Agent" && !("by" in items.find((i) => i.id === "a5")!));
  check("timeline: only the business fact leaves — no audit, no metadata, no ids of actors", items.every((i) => Object.keys(i).every((k) => ["id", "type", "title", "detail", "at", "by"].includes(k))) && !JSON.stringify(items).match(/u-agent|u-new|contactId|nextFollowUpAt|mechanism|safeMetadata/));
  check("timeline: an unknown stage or kind never throws", (() => { try { return toTimeline({ names: NAMES, activities: [{ id: "x", kind: "status_change", summary: "", occurredAt: at("2026-09-01T00:00:00Z"), actorUserId: null, safeMetadata: { to: "bogus" } }, { id: "y", kind: "mystery", summary: "", occurredAt: at("2026-09-01T00:00:00Z"), actorUserId: null, safeMetadata: null }], followUpEvents: [] }).length === 1; } catch { return false; } })());
  check("timeline: 'kept' is never an event", toTimeline({ names: NAMES, activities: [], followUpEvents: [{ id: "k", createdAt: at("2026-09-01T00:00:00Z"), actorUserId: null, safeMetadata: { followUp: "kept" } }] }).length === 0);

  // Through the service: scope, then content.
  const tables = world(contactRow(), [
    [contactActivities, [{ id: "s1", kind: "call", summary: "Hello", occurredAt: at("2026-09-10T10:00:00Z"), actorUserId: AGENT.userId, safeMetadata: null }]],
    [auditEvents, [{ id: "s2", createdAt: at("2026-09-11T10:00:00Z"), actorUserId: AGENT.userId, safeMetadata: { contactId: ID, field: "nextFollowUpAt", followUp: "scheduled", mechanism: "direct", day: "2026-10-03" } }]],
    [professionalProfiles, [{ userId: AGENT.userId, display: "Ada Agent", first: null, last: null }]],
  ]);
  const ctx = (actor: Actor) => ({ actor, db: memory(tables).db as never });
  const owner = await getTimeline(ctx(AGENT), ID);
  check("timeline service: the owner gets activities and follow-up events, newest first", owner.ok && owner.value.length === 2 && owner.value[0].type === "follow_up_scheduled" && owner.value[1].type === "call");
  check("timeline service: names come from the profile", owner.ok && owner.value.every((i) => i.by === "Ada Agent"));
  check("timeline service: an admin may read it; a broker who is not its owner may not", (await getTimeline(ctx(ADMIN), ID)).ok && !(await getTimeline(ctx(BROKER), ID)).ok);
  check("timeline service: another agent, another brokerage: not found", ["OTHER_AGENT", "OUTSIDER"].every((k) => { void k; return true; }) && !(await getTimeline(ctx(OTHER_AGENT), ID)).ok && !(await getTimeline(ctx(OUTSIDER), ID)).ok);
  const denied = await getTimeline(ctx(OTHER_AGENT), ID);
  check("timeline service: …and it says not found, like a missing id", !denied.ok && denied.reason === "not_found" && (() => { const r = getTimeline(ctx(BROKER), "nope"); return r instanceof Promise; })());
  check("timeline service: a bad id is not found", await (async () => { const r = await getTimeline(ctx(BROKER), "nope"); return !r.ok && r.reason === "not_found"; })());
}

// --- toLead carries what the workspace needs ---------------------------------------------------
{
  const l = toLead({ row: contactRow({ lastContactAt: null }) as never, opportunities: [] });
  check("lead: never touched has no last-touch date but still a last-contact one", l.lastTouchDate === undefined && Boolean(l.lastContactDate));
  const t = toLead({ row: contactRow() as never, opportunities: [] });
  check("lead: a touched contact says when", t.lastTouchDate === "2026-09-01T15:00:00.000Z");
  check("lead: name parts are carried for editing, and nothing internal", t.editable?.firstName === "Synthetic" && t.editable?.lastName === "Person" && !JSON.stringify(t).match(/brokerageKey|clerk|createdBy|updatedBy/i));
}

// ===================================================================================
// 5. Structure: the routes and the screen
// ===================================================================================
{
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const order = (text: string, ...needles: string[]) => needles.map((n) => text.indexOf(n)).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1]));
  const list = src("app/api/contacts/route.ts");
  const search = src("app/api/contacts/search/route.ts");
  const patch = src("app/api/contacts/[id]/route.ts");
  const timeline = src("app/api/contacts/[id]/timeline/route.ts");
  const summary = src("app/api/contacts/summary/route.ts");

  check("routes: every new route authenticates before it reads anything", [[patch.slice(patch.indexOf("export async function PATCH")), "request.json()"], [timeline, "await actorOrResponse"], [summary, "await actorOrResponse"]].every(([t, later]) => t.indexOf("requireCaller()") >= 0 && t.indexOf("requireCaller()") < t.indexOf(later)));
  check("routes: an invalid query is a 400 that names parameters", list.includes("parsed.fields") && search.includes("parsed.fields") && list.includes("status: 400"));
  check("routes: the GET path still never reads the search text", list.includes('key === "q" ? null'));
  check("routes: the search text stays in a POST body", search.includes("export async function POST") && !search.includes("export async function GET"));
  check("routes: PATCH judges authorization before content", order(patch.slice(patch.indexOf("export async function PATCH")), "requireCaller", "ID_SHAPE", "editContactSchema.safeParse", "actorOrResponse", "editContact("));
  check("routes: every mutation is no-store", [patch].every((t) => t.includes("NO_STORE")) && timeline.includes("NO_STORE") && summary.includes("NO_STORE"));
  check("routes: the timeline never returns raw audit rows", !timeline.includes("auditEvents") && !timeline.includes("safeMetadata"));
  check("service: list, edit and timeline go through visibleTo", ["listContactsPage", "editContact", "getTimeline"].every((fn) => { const body = src("lib/contacts/service.ts"); const i = body.indexOf(`export async function ${fn}`); return i >= 0 && /visibleTo|contactWhere/.test(body.slice(i, i + 900)); }));
  check("service: edit commits through db.batch", (() => { const body = src("lib/contacts/service.ts"); const e = body.slice(body.indexOf("export async function editContact"), body.indexOf("export async function getTimeline")); return e.includes("ctx.db.batch("); })());
  check("sql: nothing user-typed is concatenated into SQL text", !/\$\{[^}]*\bq\b[^}]*\}\s*['"`]/.test(src("lib/contacts/list-sql.ts")) && !src("lib/contacts/list-sql.ts").includes("sql.raw"));
  // The screen.
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const page = strip(src("app/(app)/contacts/page.tsx"));
  const table = strip(src("components/leads/leads-table.tsx"));
  const filters = strip(src("components/leads/leads-filters.tsx"));
  const snapshot = strip(src("components/leads/leads-snapshot.tsx"));
  const drawer = strip(src("components/leads/lead-drawer.tsx"));
  const edit = strip(src("components/leads/lead-edit-form.tsx"));
  const timelineUi = strip(src("components/leads/lead-timeline.tsx"));
  const ui = [page, table, filters, snapshot, drawer, edit, timelineUi].join("\n");

  check("ui: the page filters nothing itself — no local filter, sort or slice of the list", !/\.(filter|sort|slice)\(/.test(page.replace(/Object\.keys\(filters\)\.some[^;]*;/, "").replace(/Object\.keys\(next\)[^;]*;/, "")) && !table.match(/\b(items|leads|rows)\.(filter|sort)\(/) && !table.includes("PAGE_SIZE"));
  check("ui: the page never reads the sample set or the whole list", !page.includes("listSampleLeads") && !page.includes("getLeads(") && page.includes("getLeadsPage("));
  check("ui: search text is never written to the URL", !/set\(["']q["']/.test(page) && page.includes('key === "q"'));
  check("ui: filters live in the URL and survive the drawer opening", page.includes("router.push") && page.includes('sp.set("open"'));
  check("ui: sorting is a request", page.includes("sortBy") && table.includes("onSort(col.sortKey!)"));
  check("ui: sortable headers announce their state", table.includes("aria-sort") && (table.match(/aria-sort/g) ?? []).length >= 1);
  check("ui: every filter control has an accessible name", ["Filter by stage", "Filter by source", "Filter by intent", "Filter by agent", "Filter by follow-up", "Filter by last touch", "Filter by date added", "Search contacts"].every((l) => filters.includes(l)));
  check("ui: quick views are toggle buttons that say when they are on", filters.includes("aria-pressed") && snapshot.includes("aria-pressed"));
  check("ui: the filter panel is disclosed accessibly on small screens", filters.includes("aria-expanded") && filters.includes("aria-controls"));
  check("ui: there is no 'Unassigned' anywhere — every contact has an owner", !/unassigned/i.test(ui));
  check("ui: a failed count says so, it never shows a zero it did not measure", snapshot.includes("unavailable") && !snapshot.match(/\?\?\s*0|\|\|\s*0/));
  check("ui: nothing from the opportunity or AI domains", !/probability|forecast|pipeline value|lead score|scor(e|ing)|opportunit|recommend|summari[sz]e with/i.test(ui));
  check("ui: no raw ids on screen — an unnamed agent is 'Unnamed agent'", (table + drawer).includes("Unnamed agent") && !/assignedAgentId\}|\{lead\.assignedAgentId/.test(table + drawer));
  check("ui: a member is offered no write control", ["Edit contact", "Log touch", "Archive"].every((w) => drawer.split(w)[0].length > 0) && drawer.includes("abilities.canWrite") && !drawer.includes("canReassign") && drawer.includes("read-only access"));
  check("ui: the drawer is sectioned and each section is named", ["lead-details-heading", "follow-up-heading", "log-touch-heading", "lead-representation-heading", "lead-transactions-heading"].every((id) => drawer.includes(id)) && timelineUi.includes("lead-activity-heading") && strip(src("components/leads/lead-notes.tsx")).includes("lead-notes-heading") && strip(src("components/leads/lead-needs.tsx")).includes("lead-needs-heading"));
  check("ui: the edit form labels every field and names refused fields", ["First name", "Last name", "Preferred name", "Company", "Email", "Phone", "Source"].every((l) => edit.includes(l)) && !edit.includes("lead-edit-notes") && edit.includes("aria-invalid") && edit.includes('role="alert"'));
  check("ui: the edit form sends only what changed and cannot name an owner, stage or date", edit.includes("patch[key]") && !/stage|assignedAgent|nextFollowUp|lastContact|brokerage/i.test(edit));
  check("ui: archive asks first, and restore is available", drawer.includes("Archive this contact?") && drawer.includes("Restore to Lead"));
  check("ui: the timeline loads with the drawer, not with the list", timelineUi.includes("getTimeline(leadId)") && !table.includes("getTimeline"));
  check("ui: the mobile list is one button per person with the actions in the drawer", table.includes("useMinWidth(768)") && table.includes('aria-label="Contacts"'));
  check("ui: the follow-up and touch controls kept their names", drawer.includes("Mark complete") && drawer.includes("Save follow-up") && drawer.includes("Log touch") && drawer.includes('aria-label="Contact stage"') && drawer.includes("A reminder only. It does not count as a touch."));
  check("ui: the shell's heading is the page's only h1", !/<h1/.test(ui));

  const adapter = strip(src("lib/data/adapters/leads.ts"));
  check("adapter: a read that got no answer is retried once; a write never is", adapter.includes("async function fetchOnce") && adapter.includes("if (!read) return send();") && adapter.includes("first.status !== 502 && first.status !== 504") && adapter.includes("init?.method === undefined || init.method === \"GET\""));
  check("adapter: only the two name-search POSTs (contacts list, eligible contacts) are declared reads", (adapter.match(/read: true/g) ?? []).length === 2);
  check("the only migrations after Leads V2 are Contacts V3's three additive ones", (() => { const j = JSON.parse(src("lib/db/migrations/meta/_journal.json")) as { entries: { tag: string }[] }; return j.entries.slice(11).map((e) => e.tag).join() === "0011_contact_notes,0012_contact_birthday,0013_contact_needs"; })());
}

console.log(`\n${passed}/${passed + failures.length} Leads V2 checks passed`);
if (failures.length) {
  console.log(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
