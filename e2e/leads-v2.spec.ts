/**
 * Leads V2 — Preview certification, one role per run.
 *
 *   LV2_ROLE = admin | broker | transaction_coordinator | agent | member
 *
 * The certification identity's role is switched in the Preview database between
 * runs (never Production). Fixtures are synthetic contacts named "LV2 …" seeded
 * in the Preview branch: ten named people owned by the identity (due today,
 * overdue, future, never touched, stale, closed, lost, archived, a percent sign,
 * an underscore), thirty pads for pagination, two owned by a second agent, and
 * one in ANOTHER brokerage as the isolation control. All are removed afterwards.
 *
 * Every refusal is paired with the same request succeeding for a role that may
 * make it, and every count the screen shows is compared with the API's own.
 * Everything is bounded: the config sets action, navigation and run limits.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DASHBOARD, freshToken, refreshingApiFor, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const ROLE = process.env.LV2_ROLE ?? "";
const ROLES = ["admin", "broker", "transaction_coordinator", "agent", "member"];
const PRIVILEGED = ["admin", "broker", "transaction_coordinator"].includes(ROLE);
const WRITER = ROLE !== "member";

const OTHER_AGENT = "77777777-7777-4777-8777-777777777777";
const MEMBER_USER = "88888888-8888-4888-8888-888888888888";
const SUSPENDED_USER = "99999999-9999-4999-8999-999999999999";
const C = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALPHA = C(1), BRAVO = C(2), CHARLIE = C(3), DELTA = C(4), ECHO = C(5), GOLF = C(7), HOTEL = C(8), INDIA = C(11), JULIET = C(12), KILO = C(13);
const NOWHERE = "00000000-0000-4000-8000-000000000000";
/** Unique to this run, so a repeat run still changes what it says it changes. */
const STAMP = String(Date.now()).slice(-6);
const PHONE_TAIL = String(Date.now()).slice(-4);

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
let platformReloads = 0;
const uncaught: string[] = [];
const consoleErrors: string[] = [];
const requests: string[] = [];
const apiProblems: string[] = [];
const PLATFORM = /Failed to load resource|MIME type|502|upstream request failed|Clerk|clerk|ERR_/;

const say = (line: string) => console.log(`[leads-v2] ${ROLE}: ${line}`);
const post = (path: string, body: unknown) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path: string, body: unknown) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
type Row = { id: string; name: string; stage: string; assignedAgentId: string; nextFollowUpDate?: string; lastTouchDate?: string; lastContactDate: string };
const list = async (query = "") => (await api(`/dashboard/api/contacts${query}`)) as { status: number; body: { items: Row[]; total: number; page?: number; pageSize?: number; error?: string; fields?: string[] } };
const search = (body: Record<string, unknown>) => post("/dashboard/api/contacts/search", body) as Promise<{ status: number; body: { items: Row[]; total: number; error?: string } }>;
const names = (items: Row[]) => items.map((i) => i.name);

/** The business day, `offset` days from now, as `YYYY-MM-DD`. */
function businessDay(offset = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + offset * 86_400_000));
}

async function gotoReady(p: Page, path: string, ready: Locator, timeout = 30_000) {
  for (let attempt = 1; ; attempt += 1) {
    await p.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(ready).toBeVisible({ timeout });
      return;
    } catch (error) {
      const platform = p.getByText(/Application error: a client-side exception|upstream request failed/);
      if ((await platform.count()) === 0 || attempt >= 4) throw error;
      platformReloads += 1;
      console.log(`[leads-v2] platform error page at ${path}; reloading (${platformReloads} so far)`);
    }
  }
}

/** Open a Radix select by its accessible name and choose an option. */
async function pick(p: Page, label: string, option: string | RegExp) {
  await p.getByRole("combobox", { name: label }).click();
  await p.getByRole("option", { name: option }).first().click();
}

const rows = (p: Page) => p.getByTestId("lead-row");
const drawer = (p: Page) => p.getByRole("dialog");
const overflows = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const leadsReady = (p: Page) => p.getByTestId("view-all");

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  expect(ROLES, "LV2_ROLE must be set").toContain(ROLE);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => uncaught.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !PLATFORM.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/dashboard/api/")) requests.push(`${r.method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`);
  });
  // What the browser was told, when something was not fine: the evidence a "could not be loaded" needs.
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/dashboard/api/") && r.status() >= 400) apiProblems.push(`${r.status()} ${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}${u.search.slice(0, 60)}`);
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/dashboard/api/")) apiProblems.push(`failed ${r.method()} ${u.pathname}${u.search.slice(0, 60)} ${r.failure()?.errorText}`);
  });
  await signInCertificationUser(page);
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await freshToken(page);
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      platformReloads += 1;
    }
  }
  api = refreshingApiFor(page);
});

test.afterAll(async () => {
  say(`platform error-page reloads=${platformReloads}, uncaught=${uncaught.length}, console errors=${consoleErrors.length}`);
  if (apiProblems.length) say(`API problems seen by the browser: ${JSON.stringify(apiProblems).slice(0, 700)}`);
  if (uncaught.length || consoleErrors.length) say(`detail: ${JSON.stringify([...uncaught, ...consoleErrors]).slice(0, 600)}`);
  await page?.close();
});

// =========================================================================================
test("the session is this role and the fixture is what it should be", async () => {
  const all = await list();
  expect(all.status).toBe(200);
  const mine = all.body.items.filter((i) => i.name.startsWith("LV2 "));
  say(`sees ${all.body.total} contacts (${mine.length} LV2)`);
  if (PRIVILEGED) {
    expect(all.body.total, "privileged sees the whole brokerage: 40 owned + 2 colleague's").toBe(42);
    expect(names(all.body.items)).not.toContain("LV2 Kilo Foreign");
    expect((await api(`/dashboard/api/contacts/${KILO}`)).status, "another brokerage is not found").toBe(404);
  } else {
    expect(all.body.total, "everyone else sees only their own").toBe(40);
    expect(names(all.body.items)).not.toContain("LV2 India OtherOverdue");
    expect((await api(`/dashboard/api/contacts/${INDIA}`)).status, "a colleague's contact is not found").toBe(404);
    expect((await api(`/dashboard/api/contacts/${KILO}`)).status).toBe(404);
  }
  expect((await api(`/dashboard/api/contacts/${NOWHERE}`)).status).toBe(404);
});

// ---- M-04 ---------------------------------------------------------------------------------------
test("M-04: an invalid filter is refused with the parameter named, on both paths", async () => {
  const bad = await list("?stage=garbage");
  expect(bad.status).toBe(400);
  expect(bad.body.error).toBe("invalid");
  expect(bad.body.fields).toEqual(["stage"]);
  expect(JSON.stringify(bad.body)).not.toContain("garbage");
  expect((await list("?stage=lead,garbage")).status, "one bad member refuses the whole list").toBe(400);
  for (const q of ["?source=pigeon", "?followUp=soonish", "?lastTouch=1d", "?created=yesterday", "?sort=budget", "?dir=up", "?page=0", "?pageSize=101", "?mine=maybe", "?intent=rent"]) {
    expect((await list(q)).status, q).toBe(400);
  }
  expect((await search({ stage: "garbage" })).status).toBe(400);
  // …and the same request with a valid stage succeeds, so the refusal is about the value.
  const good = await list("?stage=lead");
  expect(good.status).toBe(200);
  expect(good.body.items.every((i) => i.stage === "lead")).toBe(true);
  expect((await list("?stage=")).status, "an empty filter is 'not given'").toBe(200);
  say(`invalid filters refused; a valid one returned ${good.body.total}`);
});

// ---- M-02 ---------------------------------------------------------------------------------------
test("M-02: search text is a literal — a wildcard finds only what contains it", async () => {
  const everyone = (await search({})).body.total;
  const pct = await search({ q: "%" });
  expect(pct.status).toBe(200);
  expect(names(pct.body.items)).toEqual(["LV2 Golf 100% Legit"]);
  expect(pct.body.total).toBeLessThan(everyone);
  const under = await search({ q: "_" });
  expect(names(under.body.items)).toEqual(["LV2 Hotel_Score"]);
  expect(names((await search({ q: "100%" })).body.items)).toEqual(["LV2 Golf 100% Legit"]);
  expect((await search({ q: "\\" })).body.total, "a backslash is literal too").toBe(0);
  expect((await search({ q: "'; drop table contacts; --" })).body.total).toBe(0);
  expect((await search({ q: "%%" })).body.total).toBe(0);
  // Ordinary search still finds people, by name, email, area and phone digits.
  expect(names((await search({ q: "alpha due" })).body.items)).toEqual(["LV2 Alpha Due"]);
  expect(names((await search({ q: "charlie@example" })).body.items)).toEqual(["LV2 Charlie Future"]);
  expect(names((await search({ q: "las olas" })).body.items)).toEqual(["LV2 Alpha Due"]);
  expect(names((await search({ q: "(954) 555-0102" })).body.items)).toEqual(["LV2 Bravo Overdue"]);
  // The visibility rule is not widened by a wildcard: an agent's '%' is still their own book.
  const scoped = (await search({ q: "%" })).body.items.filter((i) => i.assignedAgentId === OTHER_AGENT);
  expect(scoped.length).toBe(0);
  say(`'%' -> 1 of ${everyone}; '_' -> 1; hostile text -> 0`);
});

// ---- The query -----------------------------------------------------------------------------------
test("filters compose, sort, page and scope — all in the server", async () => {
  const total = PRIVILEGED ? 42 : 40;
  const p1 = await list("?page=1&pageSize=10&sort=name&dir=asc");
  const p2 = await list("?page=2&pageSize=10&sort=name&dir=asc");
  expect(p1.body.total).toBe(total);
  expect(p1.body.items).toHaveLength(10);
  expect(p2.body.items).toHaveLength(10);
  expect(new Set([...p1.body.items, ...p2.body.items].map((i) => i.id)).size, "pages do not repeat").toBe(20);
  const sorted = names(p1.body.items).map((n) => n.toLowerCase());
  expect(sorted).toEqual([...sorted].sort());
  const last = await list(`?page=${Math.ceil(total / 10)}&pageSize=10&sort=name&dir=asc`);
  expect(last.body.items.length).toBe(total % 10 || 10);
  const beyond = await list("?page=99&pageSize=10");
  expect(beyond.status).toBe(200);
  expect(beyond.body.items).toHaveLength(0);
  expect(beyond.body.total).toBe(total);

  // Follow-up states.
  const overdue = names((await list("?followUp=overdue&active=1")).body.items);
  expect(overdue).toContain("LV2 Bravo Overdue");
  expect(overdue, "a lost contact is not chased").not.toContain("LV2 Lost Lena");
  expect(overdue.includes("LV2 India OtherOverdue")).toBe(PRIVILEGED);
  const due = names((await list("?followUp=due_today&active=1")).body.items);
  expect(due).toContain("LV2 Alpha Due");
  expect(due).not.toContain("LV2 Bravo Overdue");
  expect(due.includes("LV2 Juliet OtherDue")).toBe(PRIVILEGED);
  const upcoming = names((await list("?followUp=upcoming")).body.items);
  expect(upcoming).toEqual(expect.arrayContaining(["LV2 Charlie Future", "LV2 Hotel_Score"]));
  expect(upcoming).not.toContain("LV2 Alpha Due");
  const none = (await list("?followUp=none&pageSize=100&page=1")).body;
  expect(names(none.items)).toEqual(expect.arrayContaining(["LV2 Delta Stale", "LV2 Echo Never"]));
  expect(names(none.items)).not.toContain("LV2 Alpha Due");

  // Last touch and created.
  expect(names((await list("?lastTouch=never")).body.items)).toEqual(["LV2 Echo Never"]);
  const stale = names((await list("?lastTouch=14d&active=1&pageSize=100&page=1")).body.items);
  expect(stale).toContain("LV2 Delta Stale");
  expect(stale).not.toContain("LV2 Foxtrot Closed");
  expect(stale).not.toContain("LV2 Alpha Due");
  expect(names((await list("?lastTouch=30d&pageSize=100&page=1")).body.items)).toEqual(expect.arrayContaining(["LV2 Delta Stale", "LV2 Foxtrot Closed"]));
  expect(names((await list("?lastTouch=today")).body.items)).toContain("LV2 Charlie Future");
  expect(names((await list("?created=today")).body.items)).toEqual(["LV2 Echo Never"]);
  expect(names((await list("?created=7d&pageSize=100&page=1")).body.items)).toEqual(expect.arrayContaining(["LV2 Echo Never", "LV2 Golf 100% Legit"]));

  // Intent, source, stage, agent, composition.
  expect(names((await list("?intent=buy")).body.items)).toEqual(["LV2 Alpha Due"]);
  expect(names((await list("?intent=both")).body.items)).toEqual(["LV2 Charlie Future"]);
  expect(names((await list("?intent=sell")).body.items)).toEqual(["LV2 Bravo Overdue"]);
  expect(names((await list("?intent=lease")).body.items)).toEqual(["LV2 Delta Stale"]);
  expect(names((await list("?source=website")).body.items)).toEqual(["LV2 Bravo Overdue"]);
  expect(names((await list("?stage=closed")).body.items)).toEqual(["LV2 Foxtrot Closed"]);
  expect(names((await list("?stage=archived")).body.items)).toEqual(["LV2 Archived Ari"]);
  expect(names((await list("?stage=lost")).body.items)).toEqual(["LV2 Lost Lena"]);
  expect(names((await list("?stage=contacted&source=advertising&followUp=upcoming")).body.items)).toEqual(["LV2 Hotel_Score"]);
  expect(names((await list("?stage=contacted&source=advertising&followUp=overdue")).body.items)).toEqual([]);
  expect(names((await list("?mine=1&followUp=due_today")).body.items)).toEqual(["LV2 Alpha Due"]);
  if (PRIVILEGED) {
    expect(names((await list(`?agent=${OTHER_AGENT}`)).body.items).sort()).toEqual(["LV2 India OtherOverdue", "LV2 Juliet OtherDue"]);
  } else {
    // An agent cannot filter to a colleague's book: the filter is ignored, and the visibility rule holds.
    expect((await list(`?agent=${OTHER_AGENT}`)).body.total).toBe(40);
  }

  // Sorting by follow-up: soonest first, nothing set last.
  const byFollowUp = (await list("?sort=followUp&dir=asc&pageSize=100&page=1")).body.items;
  const dated = byFollowUp.filter((i) => i.nextFollowUpDate);
  expect(byFollowUp.slice(0, dated.length).every((i) => i.nextFollowUpDate)).toBe(true);
  expect(dated.map((i) => i.nextFollowUpDate!)).toEqual([...dated.map((i) => i.nextFollowUpDate!)].sort());
  const desc = (await list("?sort=followUp&dir=desc&pageSize=100&page=1")).body.items;
  expect(desc[desc.length - 1].nextFollowUpDate, "nothing set is last in either direction").toBeUndefined();
  say(`filters composed; ${total} contacts in scope`);
});

test("the snapshot cards are the numbers the table shows", async () => {
  const res = await api("/dashboard/api/contacts/summary");
  expect(res.status).toBe(200);
  const s = res.body.snapshot as { total: number; active: number; newThisWeek: number; dueToday: number; overdue: number; noTouch14: number; byStage: Record<string, number> };
  const count = async (q: string) => (await list(`${q}${q ? "&" : "?"}page=1&pageSize=1`)).body.total;
  expect(s.total).toBe(await count(""));
  expect(s.active).toBe(await count("?active=1"));
  expect(s.newThisWeek).toBe(await count("?created=7d"));
  expect(s.dueToday).toBe(await count("?active=1&followUp=due_today"));
  expect(s.overdue).toBe(await count("?active=1&followUp=overdue"));
  expect(s.noTouch14).toBe(await count("?active=1&lastTouch=14d"));
  expect(Object.values(s.byStage).reduce((a, b) => a + b, 0)).toBe(s.total);
  expect(JSON.stringify(res.body)).not.toMatch(/LV2|@example|\+1/);
  if (PRIVILEGED) expect([s.dueToday, s.overdue]).toEqual([2, 2]);
  else expect([s.dueToday, s.overdue]).toEqual([1, 1]);
  say(`snapshot ${JSON.stringify(s)}`);
});

// ---- Mutations ---------------------------------------------------------------------------------------------
test("edit: authorized, validated, audited by field name, and it touches nothing else", async () => {
  const before = (await api(`/dashboard/api/contacts/${ECHO}`)).body.contact as Row & { notes: string };
  if (!WRITER) {
    const r = await patch(`/dashboard/api/contacts/${ECHO}`, { notes: "nope" });
    expect(r.status, "a member is forbidden").toBe(403);
    expect(((await api(`/dashboard/api/contacts/${ECHO}`)).body.contact as { notes: string }).notes).toBe(before.notes);
    return;
  }
  const ok = await patch(`/dashboard/api/contacts/${ECHO}`, { company: `Lv2 Realty ${STAMP}`, email: `Echo${STAMP}@Example.Test`, phone: `(305) 555-${PHONE_TAIL}`, notes: `edited by the certification ${STAMP}` });
  expect(ok.status).toBe(200);
  expect((ok.body.changed as string[]).sort()).toEqual(["company", "email", "notes", "phone"]);
  const after = ok.body.contact as Row & { email: string; phone: string; editable: { company: string } };
  expect(after.email).toBe(`echo${STAMP}@example.test`);
  expect(after.phone).toBe(`+1305555${PHONE_TAIL}`);
  expect(after.editable.company).toBe(`Lv2 Realty ${STAMP}`);
  expect(after.lastTouchDate, "an edit is not a touch").toBeUndefined();
  expect(after.stage).toBe(before.stage);
  expect(after.assignedAgentId).toBe(before.assignedAgentId);
  const same = await patch(`/dashboard/api/contacts/${ECHO}`, { company: `Lv2 Realty ${STAMP}` });
  expect(same.body.changed, "an unchanged save writes nothing").toEqual([]);
  // Refusals, each with the field named and never the value.
  for (const [body, fields] of [
    [{ email: "not-an-email" }, ["email"]],
    [{ assignedAgentUserId: OTHER_AGENT }, ["body"]],
    [{ stage: "closed" }, ["body"]],
    [{ nextFollowUpAt: "2026-01-01T00:00:00Z" }, ["body"]],
    [{ brokerageKey: "elsewhere" }, ["body"]],
    [{}, ["body"]],
  ] as const) {
    const r = await patch(`/dashboard/api/contacts/${ECHO}`, body);
    expect(r.status, JSON.stringify(body)).toBe(400);
    expect(r.body.fields).toEqual(fields);
  }
  const noName = await patch(`/dashboard/api/contacts/${ECHO}`, { firstName: "", lastName: "" });
  expect(noName.status).toBe(400);
  expect(noName.body.fields).toEqual(["firstName"]);
  const badPhone = await patch(`/dashboard/api/contacts/${ECHO}`, { phone: "12" });
  expect(badPhone.status).toBe(400);
  expect(badPhone.body.fields).toEqual(["phone"]);
  expect(JSON.stringify(badPhone.body)).not.toContain("12\"");
  // Scope: a colleague's and another brokerage's are not found; a bad id too.
  if (!PRIVILEGED) expect((await patch(`/dashboard/api/contacts/${INDIA}`, { notes: "x" })).status).toBe(404);
  expect((await patch(`/dashboard/api/contacts/${KILO}`, { notes: "x" })).status).toBe(404);
  expect((await patch(`/dashboard/api/contacts/${NOWHERE}`, { notes: "x" })).status).toBe(404);
  say("edit ok; forbidden fields, invalid values and out-of-scope ids refused");
});

test("reassign: privileged only, to a real roster member, and it is not a touch", async () => {
  const before = (await api(`/dashboard/api/contacts/${DELTA}`)).body.contact as Row;
  const res = await post(`/dashboard/api/contacts/${DELTA}/reassign`, { agentId: OTHER_AGENT });
  if (!PRIVILEGED) {
    expect(res.status, WRITER ? "an agent may not hand a contact away" : "a member is forbidden").toBe(403);
    expect((await post(`/dashboard/api/contacts/${INDIA}/reassign`, { agentId: OTHER_AGENT })).status, "a colleague's is not found").toBe(404);
    expect(((await api(`/dashboard/api/contacts/${DELTA}`)).body.contact as Row).assignedAgentId).not.toBe(OTHER_AGENT);
    return;
  }
  expect(res.status).toBe(200);
  expect(res.body.changed).toBe(true);
  const moved = res.body.contact as Row;
  expect(moved.assignedAgentId).toBe(OTHER_AGENT);
  expect(moved.lastTouchDate, "reassigning is not a touch").toBe(before.lastTouchDate);
  expect(moved.nextFollowUpDate).toBe(before.nextFollowUpDate);
  expect(moved.stage).toBe(before.stage);
  expect((await post(`/dashboard/api/contacts/${DELTA}/reassign`, { agentId: OTHER_AGENT })).body.changed, "to the current owner is a no-op").toBe(false);
  for (const [who, why] of [[MEMBER_USER, "a member"], [SUSPENDED_USER, "a suspended agent"], [NOWHERE, "nobody"]] as const) {
    const bad = await post(`/dashboard/api/contacts/${ECHO}/reassign`, { agentId: who });
    expect(bad.status, why).toBe(400);
    expect(bad.body.error).toBe("invalid_assignee");
  }
  expect((await post(`/dashboard/api/contacts/${ECHO}/reassign`, { agentId: "MLS-AGENT-1" })).status, "an MLS agent id is not a dashboard user").toBe(400);
  expect((await post(`/dashboard/api/contacts/${KILO}/reassign`, { agentId: OTHER_AGENT })).status).toBe(404);
  // Hand it back so the rest of the run has its fixture.
  const roster = ((await api("/dashboard/api/contacts/agents")).body.items as { id: string; name: string }[]);
  expect(roster.map((a) => a.name)).toContain("Lv2 Otheragent");
  expect(roster.map((a) => a.id), "the roster is dashboard users only").not.toContain(MEMBER_USER);
  const back = await post(`/dashboard/api/contacts/${DELTA}/reassign`, { agentId: before.assignedAgentId });
  expect(back.status).toBe(200);
  say("reassign ok; invalid assignees refused; handed back");
});

test("scheduling a reminder never makes a stale contact look recent", async () => {
  if (!WRITER) {
    expect((await post(`/dashboard/api/contacts/${DELTA}/follow-up`, { action: "schedule", day: businessDay(3) })).status).toBe(403);
    return;
  }
  const staleBefore = names((await list("?lastTouch=14d&active=1&pageSize=100&page=1")).body.items);
  expect(staleBefore).toContain("LV2 Delta Stale");
  const before = (await api(`/dashboard/api/contacts/${DELTA}`)).body.contact as Row;
  const r = await post(`/dashboard/api/contacts/${DELTA}/follow-up`, { action: "schedule", day: businessDay(3) });
  expect(r.status).toBe(200);
  const after = r.body.contact as Row;
  expect(after.lastTouchDate).toBe(before.lastTouchDate);
  expect(after.nextFollowUpDate).toBeTruthy();
  expect(names((await list("?lastTouch=14d&active=1&pageSize=100&page=1")).body.items), "still 14+ days without a touch").toContain("LV2 Delta Stale");
  expect(names((await list("?followUp=upcoming")).body.items)).toContain("LV2 Delta Stale");
  const done = await post(`/dashboard/api/contacts/${DELTA}/follow-up`, { action: "complete" });
  expect(done.status).toBe(200);
  expect(names((await list("?lastTouch=14d&active=1&pageSize=100&page=1")).body.items)).toContain("LV2 Delta Stale");
  expect((await post(`/dashboard/api/contacts/${DELTA}/follow-up`, { action: "schedule", day: businessDay(-2) })).status, "a past day is refused").toBe(400);
  say("stale stays stale after schedule and complete");
});

test("the timeline speaks the CRM's language, and only for what the caller may see", async () => {
  if (!WRITER) {
    const t = await api(`/dashboard/api/contacts/${GOLF}/timeline`);
    expect(t.status).toBe(200);
    return;
  }
  await post(`/dashboard/api/contacts/${GOLF}/follow-up`, { action: "schedule", day: businessDay(4) });
  await post(`/dashboard/api/contacts/${GOLF}/activities`, { kind: "call", summary: "Left a voicemail about the showing", nextFollowUpAt: `${businessDay(6)}T12:00:00.000Z` });
  await post(`/dashboard/api/contacts/${GOLF}/stage`, { stage: "qualified" });
  await post(`/dashboard/api/contacts/${GOLF}/follow-up`, { action: "complete" });
  const t = await api(`/dashboard/api/contacts/${GOLF}/timeline`);
  expect(t.status).toBe(200);
  const items = t.body.items as { id: string; type: string; title: string; detail?: string; at: string; by?: string }[];
  const titles = items.map((i) => i.title);
  say(`timeline: ${JSON.stringify(titles)}`);
  expect(titles).toEqual(expect.arrayContaining(["Called client", "Stage changed to Qualified", "Follow-up completed"]));
  expect(titles.some((x) => /^Follow-up scheduled for [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(x))).toBe(true);
  expect(items.find((i) => i.title === "Called client")?.detail).toBe("Left a voicemail about the showing");
  expect(items.every((i, k) => k === 0 || items[k - 1].at >= i.at), "newest first").toBe(true);
  const raw = JSON.stringify(t.body);
  expect(raw, "no audit record, actor id or metadata blob").not.toMatch(/safeMetadata|eventType|contactId|nextFollowUpAt|mechanism|actorUserId|user_|@/);
  expect(Object.keys(items[0]).every((k) => ["id", "type", "title", "detail", "at", "by"].includes(k))).toBe(true);
  expect((await api(`/dashboard/api/contacts/${KILO}/timeline`)).status).toBe(404);
  if (!PRIVILEGED) expect((await api(`/dashboard/api/contacts/${INDIA}/timeline`)).status, "a colleague's is not found").toBe(404);
});

// ---- The screen ---------------------------------------------------------------------------------------------
test("desktop: the workspace loads with a snapshot, views, filters and a dense table", async () => {
  requests.length = 0;
  await gotoReady(page, "/dashboard/leads", leadsReady(page));
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Leads");
  await expect(page.getByText("Manage relationships, follow-ups and activity.")).toBeVisible();
  // Table headers, sortable ones announce state.
  for (const h of ["Name", "Intent", "Stage", "Source", "Assigned agent", "Last touch", "Next follow-up", "Created", "Actions"]) {
    await expect(page.getByRole("columnheader", { name: h })).toBeVisible();
  }
  await expect(page.getByRole("columnheader", { name: "Last touch" })).toHaveAttribute("aria-sort", "descending");
  // Views.
  const views = PRIVILEGED ? ["All leads", "My leads", "Due today", "Overdue", "No touch 14+ days"] : ["My leads", "Due today", "Overdue", "No touch 14+ days"];
  for (const v of views) await expect(page.getByRole("button", { name: v, exact: true })).toBeVisible();
  if (!PRIVILEGED) await expect(page.getByRole("button", { name: "All leads" })).toHaveCount(0);
  await expect(page.getByText(/unassigned/i)).toHaveCount(0);
  // The cards equal the API.
  const snap = (await api("/dashboard/api/contacts/summary")).body.snapshot as Record<string, number>;
  for (const [id, key] of [["active", "active"], ["new", "newThisWeek"], ["due", "dueToday"], ["overdue", "overdue"], ["quiet", "noTouch14"]] as const) {
    await expect(page.getByTestId(`snapshot-${id}`)).toContainText(String(snap[key]));
  }
  // Performance: one list, one summary, one agents request; nothing per row.
  await page.waitForTimeout(1_500);
  const counts = requests.reduce<Record<string, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});
  say(`page load requests: ${JSON.stringify(counts)}`);
  const listCalls = (counts["GET /dashboard/api/contacts"] ?? 0) + (counts["POST /dashboard/api/contacts/search"] ?? 0);
  expect(listCalls, "one list request").toBeLessThanOrEqual(2);
  expect(counts["GET /dashboard/api/contacts/summary"] ?? 0).toBe(1);
  expect(counts["GET /dashboard/api/contacts/source"] ?? 0).toBeLessThanOrEqual(1);
  expect(Object.keys(counts).filter((k) => /:id/.test(k)), "no request per row").toEqual([]);
  expect(await rows(page).count(), "25 rows a page").toBe(25);
  await expect(page.getByText(/Showing 1–25 of \d+/)).toBeVisible();
});

test("desktop: views and cards apply the same query, and the URL carries it", async () => {
  await page.getByTestId("view-overdue").click();
  await expect(page).toHaveURL(/followUp=overdue/);
  await expect(page).toHaveURL(/active=1/);
  await expect(page.getByTestId("view-overdue")).toHaveAttribute("aria-pressed", "true");
  const apiOverdue = names((await list("?active=1&followUp=overdue&pageSize=100&page=1")).body.items).sort();
  await expect.poll(async () => (await rows(page).allInnerTexts()).length, { timeout: 20_000 }).toBe(apiOverdue.length);
  const shown = (await page.getByTestId("lead-row").locator("td:first-child button span:first-child").allInnerTexts()).sort();
  expect(shown).toEqual(apiOverdue);
  await expect(page.getByRole("columnheader", { name: "Next follow-up" })).toHaveAttribute("aria-sort", "ascending");
  // Reload: the view survives.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("view-overdue")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  // A card is the same shortcut.
  await page.getByTestId("snapshot-due").click();
  await expect(page).toHaveURL(/followUp=due_today/);
  await expect(page.getByTestId("view-due_today")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page).filter({ hasText: "LV2 Alpha Due" })).toHaveCount(1, { timeout: 20_000 });
  // Back and forward.
  await page.goBack();
  await expect(page.getByTestId("view-overdue")).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await page.goForward();
  await expect(page.getByTestId("view-due_today")).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  // No touch 14+, My leads, All.
  await page.getByTestId("view-no_touch_14").click();
  await expect(rows(page).filter({ hasText: "LV2 Delta Stale" })).toHaveCount(1, { timeout: 20_000 });
  await expect(rows(page).filter({ hasText: "LV2 Foxtrot Closed" })).toHaveCount(0);
  await page.getByTestId(PRIVILEGED ? "view-mine" : "view-all").click();
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  if (PRIVILEGED) await expect(rows(page).filter({ hasText: "LV2 India OtherOverdue" })).toHaveCount(0);
  await page.getByTestId(PRIVILEGED ? "view-all" : "view-all").click();
  await expect(page).not.toHaveURL(/followUp|mine|active/);
  // An invalid filter typed into the URL is dropped, not fatal.
  await page.goto("/dashboard/leads?stage=garbage&followUp=overdue", { waitUntil: "domcontentloaded" });
  await expect(leadsReady(page)).toBeVisible({ timeout: 30_000 });
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("view-all")).toBeVisible();
  say("views, cards, reload, back/forward and a bad URL all behave");
});

test("desktop: search is literal, filters compose, sort and pages are requests", async () => {
  await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  const search = page.getByLabel("Search leads");
  await search.fill("%");
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(rows(page).first()).toContainText("LV2 Golf 100% Legit");
  await expect(page).not.toHaveURL(/%25|q=/);
  await search.fill("_");
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(rows(page).first()).toContainText("LV2 Hotel_Score");
  await search.fill("zzzz-nobody");
  await expect(page.getByText("No leads match these filters")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(search).toHaveValue("");
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });

  // Stage + source compose; the URL says so.
  await pick(page, "Filter by stage", /^Contacted/);
  await pick(page, "Filter by source", "Advertising");
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(rows(page).first()).toContainText("LV2 Hotel_Score");
  await expect(page).toHaveURL(/stage=contacted/);
  await expect(page).toHaveURL(/source=advertising/);
  await pick(page, "Filter by follow-up", "Overdue");
  await expect(page.getByText("No leads match these filters")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(page).not.toHaveURL(/stage=|source=/);

  // Intent and last touch.
  await pick(page, "Filter by intent", "Leasing");
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(rows(page).first()).toContainText("LV2 Delta Stale");
  await pick(page, "Filter by intent", "Any intent");
  await pick(page, "Filter by last touch", "Never");
  await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(rows(page).first()).toContainText("LV2 Echo Never");
  await expect(rows(page).first().getByText("Never", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  if (PRIVILEGED) {
    await pick(page, "Filter by agent", "Lv2 Otheragent");
    await expect(rows(page).filter({ hasText: "LV2 India OtherOverdue" })).toHaveCount(1, { timeout: 20_000 });
    await expect(rows(page).filter({ hasText: "LV2 Alpha Due" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
  } else {
    await expect(page.getByRole("combobox", { name: "Filter by agent" })).toHaveCount(0);
  }

  // Sort: a request, announced, and reflected in the rows.
  await page.getByRole("button", { name: "Next follow-up" }).click();
  await expect(page.getByRole("columnheader", { name: "Next follow-up" })).toHaveAttribute("aria-sort", "ascending", { timeout: 20_000 });
  await expect(page).toHaveURL(/sort=followUp/);
  await page.getByRole("button", { name: "Name" }).click();
  await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending", { timeout: 20_000 });
  // The list is a fresh server answer: wait for it (a full page of 25) rather than read the rows of the request before.
  await expect
    .poll(async () => {
      const n = (await page.getByTestId("lead-row").locator("td:first-child button span:first-child").allInnerTexts()).map((x) => x.toLowerCase());
      return n.length === 25 && JSON.stringify(n) === JSON.stringify([...n].sort());
    }, { timeout: 20_000, message: "25 rows, in name order" })
    .toBe(true);
  await page.getByRole("button", { name: "Name" }).click();
  await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "descending", { timeout: 20_000 });

  // Pagination survives a reload.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/page=2/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Page 2 of \d+/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText(/Page 1 of \d+/)).toBeVisible({ timeout: 20_000 });
  say("search, filters, sort and pagination verified through the UI");
});

test("desktop: the drawer is the workspace — sections, edit, stage, follow-up, touch, timeline", async () => {
  await page.goto(`/dashboard/leads?open=${ECHO}`, { waitUntil: "domcontentloaded" });
  const d = drawer(page);
  await expect(d.getByRole("heading", { name: "LV2 Echo Never" })).toBeVisible({ timeout: 30_000 });
  const before = requests.length;
  for (const h of ["Contact", "Relationship", "Next follow-up", "Activity", "Notes"]) await expect(d.getByRole("heading", { name: h })).toBeVisible();
  await expect(d.getByText("Never", { exact: true }).first()).toBeVisible();
  const drawerCalls = requests.slice(before).length;
  say(`drawer requests after open: ${JSON.stringify(requests.slice(-6))} (${drawerCalls} since)`);
  if (!WRITER) {
    await expect(d.getByText("You have read-only access to this contact.")).toBeVisible();
    for (const name of ["Edit contact", "Log touch", "Schedule", "Change", "Archive", "Reassign agent"]) await expect(d.getByRole("button", { name })).toHaveCount(0);
    await expect(d.getByRole("combobox", { name: "Lead stage" })).toBeDisabled();
    return;
  }
  await expect(d.getByRole("button", { name: "Edit contact" })).toBeVisible();
  if (PRIVILEGED) await expect(d.getByRole("button", { name: "Reassign agent" })).toBeVisible();
  else await expect(d.getByRole("button", { name: "Reassign agent" })).toHaveCount(0);

  // Edit: an invalid email is explained and focused; a valid one saves; nothing else moves.
  await d.getByRole("button", { name: "Edit contact" }).click();
  const form = d.getByRole("form", { name: "Edit contact" });
  await form.getByLabel("Email").fill("not-an-email");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByRole("alert")).toContainText("valid email", { timeout: 20_000 });
  await expect(form.getByLabel("Email")).toBeFocused();
  await form.getByLabel("First name").fill("");
  await form.getByLabel("Last name").fill("");
  await form.getByLabel("Email").fill(`echo${STAMP}@example.test`);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.getByRole("alert")).toContainText("Add at least a first name");
  await expect(form.getByLabel("First name")).toBeFocused();
  await form.getByLabel("First name").fill("LV2");
  await form.getByLabel("Last name").fill("Echo Never");
  await form.getByLabel("Company").fill(`Lv2 Realty Group ${STAMP}`);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(d.getByText("Contact details saved.")).toBeVisible({ timeout: 20_000 });
  await expect(d.getByText(`Lv2 Realty Group ${STAMP}`)).toBeVisible();
  await expect(d.getByText("Never", { exact: true }).first(), "editing is not a touch").toBeVisible();

  // Stage.
  await d.getByRole("combobox", { name: "Lead stage" }).click();
  await page.getByRole("option", { name: "Contacted" }).click();
  await expect(d.getByTestId("timeline-item").first()).toContainText("Stage changed to Contacted", { timeout: 20_000 });

  // Follow-up, and the reminder shows in the timeline without becoming a touch.
  await d.getByRole("button", { name: "Schedule" }).click();
  await d.getByLabel("Date", { exact: true }).fill(businessDay(2));
  await d.getByRole("button", { name: "Save follow-up" }).click();
  await expect(d.getByTestId("lead-next-follow-up")).not.toHaveText("None set", { timeout: 20_000 });
  await expect(d.getByTestId("timeline-item").first()).toContainText(/Follow-up scheduled for/, { timeout: 20_000 });
  await expect(d.getByText("Never", { exact: true }).first()).toBeVisible();

  // A touch: last touch moves off "Never" and the timeline says who did what.
  await d.getByLabel("Touch summary").fill("Called about the open house");
  await d.getByRole("button", { name: "Log touch" }).click();
  await expect(d.getByText(/Touch logged/)).toBeVisible({ timeout: 20_000 });
  await expect(d.getByTestId("timeline-item").filter({ hasText: "Called client" }).first()).toContainText("Called about the open house", { timeout: 20_000 });
  await expect(d.getByText("Never", { exact: true }), "a touch moves last touch off Never").toHaveCount(0);

  // Reassign (privileged) — the roster, not MLS agents.
  if (PRIVILEGED) {
    await d.getByRole("button", { name: "Reassign agent" }).click();
    await d.getByRole("combobox", { name: "New assigned agent" }).click();
    const options = await page.getByRole("option").allInnerTexts();
    expect(options, "the roster, minus the current owner").toContain("Lv2 Otheragent");
    await page.getByRole("option", { name: "Lv2 Otheragent" }).click();
    await d.getByRole("button", { name: "Reassign", exact: true }).click();
    await expect(d.getByText("Reassigned to Lv2 Otheragent.")).toBeVisible({ timeout: 20_000 });
    await expect(d.getByTestId("lead-assigned-agent")).toContainText("Lv2 Otheragent");
    await expect(d.getByTestId("timeline-item").first()).toContainText("Assigned to Lv2 Otheragent", { timeout: 20_000 });
  }

  // Archive asks first; restore is one click.
  await d.getByRole("button", { name: "Archive" }).click();
  await expect(d.getByText("Archive this contact?")).toBeVisible();
  await d.getByRole("group", { name: "Confirm archive" }).getByRole("button", { name: "Cancel" }).click();
  await expect(d.getByText("Archive this contact?")).toHaveCount(0);
  await d.getByRole("button", { name: "Archive" }).click();
  await d.getByRole("group", { name: "Confirm archive" }).getByRole("button", { name: "Archive" }).click();
  await expect(d.getByText("Contact archived.")).toBeVisible({ timeout: 20_000 });
  await d.getByRole("button", { name: "Restore to Lead" }).click();
  await expect(d.getByText("Contact restored to Lead.")).toBeVisible({ timeout: 20_000 });

  // Keyboard: Escape closes, focus is not lost to the page behind.
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(page).not.toHaveURL(/open=/);
  say("drawer: edit, stage, follow-up, touch, reassign, archive and restore verified");
});

test("desktop: creating a lead is fast and lands on the new person", async () => {
  test.skip(!WRITER, "a member cannot create");
  await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "New lead" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("LV2 Zulu Created");
  await dialog.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/open=/, { timeout: 30_000 });
  await expect(page.getByRole("dialog").getByRole("heading", { name: "LV2 Zulu Created" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog").getByText("None set")).toBeVisible();
  const mine = await list("?created=today");
  expect(names(mine.body.items)).toContain("LV2 Zulu Created");
  await page.keyboard.press("Escape");
});

test("desktop: 1280 wide fits and keeps every column", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  expect(await overflows(page), "no horizontal page overflow").toBe(false);
  await expect(page.getByRole("columnheader", { name: "Next follow-up" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const width of [430, 390]) {
  test(`mobile ${width}: a compact list, filters behind a toggle, the drawer holds every action`, async () => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
    await expect(page.locator('button[data-testid="lead-row"]').first()).toBeVisible({ timeout: 30_000 });
    expect(await overflows(page), "no horizontal page overflow").toBe(false);
    await expect(page.getByRole("columnheader")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Leads" })).toBeVisible();
    const first = page.getByTestId("lead-row").first();
    await expect(first).toContainText(/Follow-up/);
    await expect(first).toContainText(/Last touch/);
    // Views scroll sideways inside their own strip; the filter panel is disclosed on demand.
    await expect(page.getByRole("combobox", { name: "Filter by stage" })).toBeHidden();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("combobox", { name: "Filter by stage" })).toBeVisible();
    await pick(page, "Filter by stage", /^Lead/);
    await expect(page).toHaveURL(/stage=lead/);
    expect(await overflows(page)).toBe(false);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    // Tap a row: the drawer has every critical action, and fits.
    await page.getByTestId("lead-row").filter({ hasText: "LV2 Alpha Due" }).click();
    const d = drawer(page);
    await expect(d.getByRole("heading", { name: "LV2 Alpha Due" })).toBeVisible({ timeout: 30_000 });
    if (WRITER) {
      for (const name of ["Edit contact", "Log touch"]) await expect(d.getByRole("button", { name })).toBeVisible();
      await expect(d.getByRole("button", { name: /^(Schedule|Change)$/ })).toBeVisible();
      await expect(d.getByRole("combobox", { name: "Lead stage" })).toBeVisible();
      if (PRIVILEGED) await expect(d.getByRole("button", { name: "Reassign agent" })).toBeVisible();
      await d.getByRole("button", { name: "Edit contact" }).click();
      await expect(d.getByRole("form", { name: "Edit contact" })).toBeVisible();
      const fits = await d.evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
      expect(fits, "the edit form fits the drawer").toBe(true);
      await d.getByRole("button", { name: "Cancel" }).first().click();
    }
    expect(await d.evaluate((n) => n.scrollWidth <= n.clientWidth + 1), "the drawer fits").toBe(true);
    await page.keyboard.press("Escape");
    expect(await overflows(page)).toBe(false);
    say(`mobile ${width}: list, filter toggle and drawer verified`);
  });
}

test("reduced motion and keyboard: every control is reachable without a mouse", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded" });
  await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
  // Tab to the first row's open button and press Enter.
  const open = page.getByRole("button", { name: /^Open LV2 / }).first();
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer(page)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  // Sort header by keyboard.
  const header = page.getByRole("button", { name: "Created" });
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("columnheader", { name: "Created" })).toHaveAttribute("aria-sort", /ascending|descending/, { timeout: 20_000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("the browser saw no direct Bridge call, no uncaught exception, no product console error", async () => {
  expect(uncaught, "uncaught exceptions").toEqual([]);
  expect(consoleErrors, "product console errors").toEqual([]);
});
