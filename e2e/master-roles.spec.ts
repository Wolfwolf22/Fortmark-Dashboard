/**
 * Master certification — the role matrix, one role per run.
 *
 * The certification identity's role is switched in the Preview database
 * between runs (never in Production), and each run states the role it
 * certifies:
 *
 *   MASTER_ROLE = admin | broker | transaction_coordinator | agent | member
 *
 * What is asserted is the policy the code already has — `lib/auth/actor.ts`
 * (privileged = admin, broker, transaction_coordinator; members read but never
 * write) and `lib/brokerage/identity.ts` (only admin and broker edit the
 * brokerage). Nothing here redefines a role. Every observed answer is also
 * printed as one `[matrix]` line so the master document records what the
 * product does, not what this file expects.
 *
 * Fixtures (all on the Preview branch, removed afterwards):
 *   MINE       a contact and a deal owned by the certification identity
 *   COLLEAGUE  a contact and a deal owned by another agent, same brokerage
 *   FOREIGN    a contact and a deal in ANOTHER brokerage
 *
 * Every refusal is paired with the same request succeeding for a role that may
 * do it, and every "nothing changed" with a read that shows the state.
 *
 * The same pass records the browser's own evidence: no direct Bridge request,
 * no secret-shaped string in the JavaScript it was served, and no uncaught
 * product exception. Platform error pages are counted separately.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { DASHBOARD, freshToken, refreshingApiFor, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const ROLE = process.env.MASTER_ROLE ?? "";
const TAG = process.env.MASTER_TAG ?? "MR0928";
const OUT = process.env.MATRIX_OUT ?? "test-results/matrix.jsonl";
mkdirSync(OUT.replace(/\/[^/]*$/, ""), { recursive: true });

const ROLES = ["admin", "broker", "transaction_coordinator", "agent", "member"];
const PRIVILEGED = ["admin", "broker", "transaction_coordinator"].includes(ROLE);
const WRITER = ROLE !== "member";
const EDITS_BROKERAGE = ["admin", "broker"].includes(ROLE);

const COLLEAGUE_CONTACT = "11111111-1111-4111-8111-111111111201";
const FOREIGN_CONTACT = "11111111-1111-4111-8111-111111111202";
const COLLEAGUE_TXN = "11111111-1111-4111-8111-111111111301";
const FOREIGN_TXN = "11111111-1111-4111-8111-111111111302";
const NOWHERE = "00000000-0000-4000-8000-000000000000";

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
const ids = new Map<string, string>();
const matrix: Record<string, unknown> = { role: ROLE };
let platformReloads = 0;

// --- Browser evidence ----------------------------------------------------------------------
const uncaught: string[] = [];
const consoleErrors: string[] = [];
const platformNoise: string[] = [];
const bridgeRequests: string[] = [];
const scripts = new Map<string, Promise<string>>();
const PLATFORM = /Failed to load resource|MIME type|502|upstream request failed|Clerk|clerk|ERR_/;

const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const record = (key: string, value: unknown) => {
  matrix[key] = value;
  console.log(`[matrix] ${ROLE} ${key}: ${JSON.stringify(value)}`);
};

/** A GET that keeps the response headers (the shared client returns only the body). */
async function rawGet(path: string) {
  const res = await fetch(`${DASHBOARD}${path}`, {
    headers: { Authorization: `Bearer ${await freshToken(page)}`, Accept: "application/json" },
  });
  return { status: res.status, cache: res.headers.get("cache-control") ?? "", vary: res.headers.get("vary") ?? "" };
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
      console.log(`[master] platform error page at ${path}; reloading (${platformReloads} so far)`);
    }
  }
}

const idOf = (label: string) => { const id = ids.get(label); expect(id, `${label} is seeded`).toBeTruthy(); return id!; };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  expect(ROLES, "MASTER_ROLE must be set").toContain(ROLE);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => uncaught.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 200);
    (PLATFORM.test(text) ? platformNoise : consoleErrors).push(text);
  });
  page.on("request", (r) => { if (/bridgedataoutput|bridgeinteractive|api\.bridge/i.test(new URL(r.url()).host)) bridgeRequests.push(new URL(r.url()).host); });
  page.on("response", (r) => {
    const url = r.url();
    if (/\/_next\/static\/.*\.js/.test(url) && !scripts.has(url)) scripts.set(url, r.text().catch(() => ""));
  });
  await signInCertificationUser(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
  api = refreshingApiFor(page);
  const list = await api("/dashboard/api/contacts");
  expect(list.status).toBe(200);
  for (const c of list.body.items as { id: string; name: string }[]) if (c.name.endsWith(TAG)) ids.set(c.name, c.id);
  const txns = await api("/dashboard/api/transactions");
  for (const t of (txns.body.items ?? []) as { id: string; address: string }[]) if (t.address.includes(TAG)) ids.set(t.address, t.id);
  console.log(`[master] role=${ROLE} privileged=${PRIVILEGED} writer=${WRITER} visible fixtures=${ids.size}`);
});

test.afterAll(async () => {
  console.log(`[master] ${ROLE}: platform error-page reloads=${platformReloads}, platform console noise=${platformNoise.length}`);
  appendFileSync(OUT, JSON.stringify({ ...matrix, platformReloads, platformNoise: platformNoise.length }) + "\n");
  await page?.close();
});

// =========================================================================================
test("the session resolves to this role and the shell says so", async () => {
  await gotoReady(page, "/dashboard", page.locator("#home-welcome"));
  const eyebrow = (await page.locator("section[aria-labelledby='home-welcome']").innerText()).split("\n")[0].trim();
  record("homeEyebrow", eyebrow);
  const label: Record<string, string> = { admin: "Admin", broker: "Broker", transaction_coordinator: "Transaction Coordinator", agent: "Agent", member: "Member" };
  expect(eyebrow.toLowerCase()).toContain(label[ROLE].toLowerCase());
  const t = await page.locator("#home-welcome").innerText();
  expect(t).not.toMatch(/undefined|null|@/);
});

test("contacts: reads follow ownership, and the boundary answers like 'missing'", async () => {
  const mine = idOf(`MROLE Mine ${TAG}`);
  const list = await api("/dashboard/api/contacts");
  const listed = (list.body.items as { id: string }[]).map((c) => c.id);
  record("contactsListed", { mine: listed.includes(mine), colleague: listed.includes(COLLEAGUE_CONTACT), foreign: listed.includes(FOREIGN_CONTACT) });
  expect(listed).toContain(mine); // control: our own is always readable
  expect(listed.includes(COLLEAGUE_CONTACT)).toBe(PRIVILEGED);
  expect(listed).not.toContain(FOREIGN_CONTACT);

  const own = await api(`/dashboard/api/contacts/${mine}`);
  const colleague = await api(`/dashboard/api/contacts/${COLLEAGUE_CONTACT}`);
  const foreign = await api(`/dashboard/api/contacts/${FOREIGN_CONTACT}`);
  const nowhere = await api(`/dashboard/api/contacts/${NOWHERE}`);
  record("contactDetail", { own: own.status, colleague: colleague.status, foreign: foreign.status, nowhere: nowhere.status });
  expect(own.status).toBe(200);
  expect(colleague.status).toBe(PRIVILEGED ? 200 : 404);
  expect(foreign.status).toBe(404);
  expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nowhere.body)); // no existence leak
  if (!PRIVILEGED) expect(JSON.stringify(colleague.body)).toBe(JSON.stringify(nowhere.body));
});

test("contacts: writes follow the role (member reads, never writes)", async () => {
  const mine = idOf(`MROLE Mine ${TAG}`);
  const stage = await post(`/dashboard/api/contacts/${mine}/stage`, { stage: "contacted" });
  const stageColleague = await post(`/dashboard/api/contacts/${COLLEAGUE_CONTACT}/stage`, { stage: "contacted" });
  const stageForeign = await post(`/dashboard/api/contacts/${FOREIGN_CONTACT}/stage`, { stage: "contacted" });
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const followUp = await post(`/dashboard/api/contacts/${mine}/follow-up`, { action: "schedule", day });
  const touch = await post(`/dashboard/api/contacts/${mine}/activities`, { kind: "call", summary: "Role matrix touch" });
  const created = await post("/dashboard/api/contacts", { firstName: "MROLE", lastName: `Created ${TAG}`, source: "other" });
  record("contactWrites", { stageMine: stage.status, stageColleague: stageColleague.status, stageForeign: stageForeign.status, followUp: followUp.status, touch: touch.status, create: created.status });
  expect(stage.status).toBe(WRITER ? 200 : 403);
  expect(followUp.status).toBe(WRITER ? 200 : 403);
  expect(touch.status).toBe(WRITER ? 201 : 403);
  expect(created.status).toBe(WRITER ? 201 : 403);
  expect(stageColleague.status).toBe(PRIVILEGED ? 200 : 404);
  expect(stageForeign.status).toBe(404);
  // State agrees with the answers: a refused write left the contact where it was.
  const after = (await api(`/dashboard/api/contacts/${mine}`)).body.contact as { stage: string; nextFollowUpDate?: string };
  expect(after.stage).toBe(WRITER ? "contacted" : "lead");
  expect(Boolean(after.nextFollowUpDate)).toBe(WRITER);
});

test("transactions: reads and writes follow the role, with the same boundary", async () => {
  const mine = idOf(`10 ${TAG} Mine Way`);
  const list = await api("/dashboard/api/transactions");
  const listed = (list.body.items as { id: string }[]).map((t) => t.id);
  expect(listed).toContain(mine);
  expect(listed.includes(COLLEAGUE_TXN)).toBe(PRIVILEGED);
  expect(listed).not.toContain(FOREIGN_TXN);

  const own = await api(`/dashboard/api/transactions/${mine}`);
  const colleague = await api(`/dashboard/api/transactions/${COLLEAGUE_TXN}`);
  const foreign = await api(`/dashboard/api/transactions/${FOREIGN_TXN}`);
  const nowhere = await api(`/dashboard/api/transactions/${NOWHERE}`);
  expect(own.status).toBe(200);
  expect(colleague.status).toBe(PRIVILEGED ? 200 : 404);
  expect(foreign.status).toBe(404);
  expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nowhere.body));

  const stage = await post(`/dashboard/api/transactions/${mine}/stage`, { stage: "offer" });
  const stageColleague = await post(`/dashboard/api/transactions/${COLLEAGUE_TXN}/stage`, { stage: "under_contract" });
  const stageForeign = await post(`/dashboard/api/transactions/${FOREIGN_TXN}/stage`, { stage: "under_contract" });
  const created = await post("/dashboard/api/transactions", {
    transactionType: "residential_sale", side: "buyer", addressLine1: `30 ${TAG} Created Ct`, city: "Fort Lauderdale", contractPriceCents: 40_000_000,
  });
  record("transactions", {
    listed: { mine: true, colleague: listed.includes(COLLEAGUE_TXN), foreign: listed.includes(FOREIGN_TXN) },
    detail: { own: own.status, colleague: colleague.status, foreign: foreign.status },
    writes: { stageMine: stage.status, stageColleague: stageColleague.status, stageForeign: stageForeign.status, create: created.status },
  });
  expect(stage.status).toBe(WRITER ? 200 : 403);
  expect(stageColleague.status).toBe(PRIVILEGED ? 200 : 404);
  expect(stageForeign.status).toBe(404);
  expect(created.status).toBe(WRITER ? 201 : 403);
  const after = (await api(`/dashboard/api/transactions/${mine}`)).body.transaction as { stage: string };
  expect(after.stage).toBe(WRITER ? "offer" : "opportunity");
});

test("home metrics: the scope is the role's, and the foreign brokerage is never counted", async () => {
  const m = await api("/dashboard/api/metrics");
  expect(m.status).toBe(200);
  const body = m.body as { scope?: string; transactions: { data?: { activeCount: number } } };
  record("metrics", { scope: body.scope, activeTransactions: body.transactions.data?.activeCount });
  expect(body.scope).toBe(PRIVILEGED ? "brokerage" : "own");
  // Own deals: 1 (the one just moved to "offer"); a privileged viewer adds the colleague's. Foreign never.
  expect(body.transactions.data?.activeCount).toBe(PRIVILEGED ? (WRITER ? 3 : 2) : 1 + (WRITER ? 1 : 0) - (WRITER ? 1 : 0));
});

test("team: same roster for everyone who may read it; privileged fields only for privileged viewers", async () => {
  const team = await api("/dashboard/api/team");
  expect(team.status).toBe(200);
  const body = team.body as { source: string; viewerPrivileged: boolean; items: Record<string, unknown>[] };
  const keys = Array.from(new Set(body.items.flatMap((i) => Object.keys(i)))).sort();
  record("team", { source: body.source, viewerPrivileged: body.viewerPrivileged, entries: body.items.length, keys });
  expect(body.source).toBe("db");
  expect(body.viewerPrivileged).toBe(PRIVILEGED);
  expect(body.items.some((i) => i.isSelf === true)).toBe(true);
  expect(body.items.every((i) => "status" in i)).toBe(PRIVILEGED); // status and MLS state are privileged-only
  expect(body.items.every((i) => "mlsState" in i)).toBe(PRIVILEGED);
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/user_[A-Za-z0-9]{10,}/); // no raw Clerk id
  expect(text).not.toMatch(/clerk/i);
});

test("brokerage identity: everyone reads, only admin and broker may edit", async () => {
  const b = await api("/dashboard/api/brokerage");
  expect(b.status).toBe(200);
  const body = b.body as { canEdit: boolean; identity?: Record<string, unknown> | null };
  record("brokerage", { canEdit: body.canEdit });
  expect(body.canEdit).toBe(EDITS_BROKERAGE);
  expect(JSON.stringify(body)).not.toMatch(/brokerageKey|clerk/i);
  // A write from a non-editor is refused before anything is read; the editor's write is covered by e2e/brokerage.spec.ts.
  const denied = await api("/dashboard/api/brokerage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officePhone: "(954) 555-0100" }) });
  record("brokerageWriteStatus", denied.status);
  if (!EDITS_BROKERAGE) expect(denied.status).toBe(403);
  else expect([200, 400]).toContain(denied.status); // an editor is not refused on authority
  // A brokerage key in the body is refused for everyone.
  const forged = await api("/dashboard/api/brokerage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brokerageKey: "elsewhere" }) });
  expect([400, 403]).toContain(forged.status);
});

test("profile and listings answer for every role; unconfigured MLS says so", async () => {
  const profile = await api("/dashboard/api/profile");
  expect(profile.status).toBe(200);
  const escalate = await api("/dashboard/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
  record("profile", { get: profile.status, roleInBody: escalate.status });
  expect(escalate.status).toBe(400);
  const src = await api("/dashboard/api/listings/source");
  const listings = await api("/dashboard/api/listings?limit=3");
  record("listings", { source: (src.body as { source?: string }).source, status: listings.status });
  expect(src.status).toBe(200);
  expect((src.body as { source: string }).source).toBe("not_configured"); // Preview has no Bridge credential
  expect([200, 503]).toContain(listings.status);
  expect(JSON.stringify(listings.body)).not.toMatch(/"listingId"|"ListingKey"/); // nothing fabricated
});

test("search: ownership scopes results; the foreign brokerage never appears; hostile queries dump nothing", async () => {
  const s = async (q: string) => (await post("/dashboard/api/search", { q })).body as { hits?: { entity: string; title: string }[] };
  const mine = await s(`MROLE Mine ${TAG}`);
  expect((mine.hits ?? []).length).toBeGreaterThan(0); // control
  expect(((await s("SYSVERIFY Delta AgentB")).hits ?? []).length > 0).toBe(PRIVILEGED);
  expect((await s("SYSVERIFY Echo Foreign")).hits ?? []).toHaveLength(0);
  expect((await s("900 Foreign Blvd")).hits ?? []).toHaveLength(0);
  expect(((await s("400 AgentB Way")).hits ?? []).length > 0).toBe(PRIVILEGED);
  const abuse: Record<string, number> = {};
  for (const q of ["%", "_", "%%", "\\", "'", "\"", "' OR '1'='1", "a'; drop table contacts;--", "%_%", "x".repeat(3000), "🏠🏠", "  "]) {
    const r = await post("/dashboard/api/search", { q });
    abuse[q.slice(0, 12)] = r.status;
    expect([200, 400], `search ${JSON.stringify(q.slice(0, 12))}`).toContain(r.status);
    if (r.status === 200) {
      // A wildcard must be a character, not a pattern: it may not return the colleague's or foreign rows for a non-privileged viewer.
      const hits = (r.body as { hits?: unknown[] }).hits ?? [];
      expect(hits.length).toBeLessThanOrEqual(50);
      if (["%", "_", "%%", "%_%"].includes(q)) expect(hits).toHaveLength(0);
    }
  }
  record("searchAbuse", abuse);
  // The same on the contacts list's own filter, and bad ids and enums.
  const wild = await api("/dashboard/api/contacts?query=%25");
  expect(wild.status).toBe(200);
  expect(((wild.body as { items?: unknown[] }).items ?? []).length).toBe(0);
  const bad = await Promise.all([
    api("/dashboard/api/contacts/not-a-uuid"), api("/dashboard/api/contacts/%00"), api(`/dashboard/api/contacts/${"a".repeat(300)}`),
    api("/dashboard/api/transactions/not-a-uuid"), api("/dashboard/api/contacts?stage=bogus"), api("/dashboard/api/transactions?stage=bogus"),
  ]);
  record("badInput", bad.map((b) => b.status));
  for (const b of bad) expect(b.status, "bad input is a client error, never a 500").toBeLessThan(500);
  if (WRITER) {
    const badEnum = await post(`/dashboard/api/contacts/${idOf(`MROLE Mine ${TAG}`)}/stage`, { stage: "nonsense" });
    expect(badEnum.status).toBe(400);
  }
});

test("protected routes are private and never cacheable", async () => {
  const seen: Record<string, string> = {};
  for (const path of ["/dashboard/api/contacts", "/dashboard/api/transactions", "/dashboard/api/metrics", "/dashboard/api/team", "/dashboard/api/brokerage", "/dashboard/api/profile", "/dashboard/api/search"]) {
    const r = await rawGet(path);
    seen[path.replace("/dashboard/api/", "")] = `${r.status} ${r.cache}`;
    if (r.status === 405) continue; // POST-only by design
    expect(r.cache, path).toMatch(/no-store|private/);
  }
  record("cache", seen);
});

test("rendered pages: every section loads for this role, with one heading and no error page", async () => {
  const pages: [string, string][] = [
    ["/dashboard", "Home"], ["/dashboard/leads", "Leads"], ["/dashboard/transactions", "Transactions"], ["/dashboard/settings", "Settings"],
    ["/dashboard/listings", "Listings"], ["/dashboard/ai", "AI"],
  ];
  const seen: Record<string, number> = {};
  for (const [path] of pages) {
    await gotoReady(page, path, page.locator("h1").first());
    await expect(page.locator("h1")).toHaveCount(1);
    seen[path.replace("/dashboard", "") || "/"] = (await page.locator("h1").first().innerText()).length;
    await expect(page.getByText(/Application error|upstream request failed/)).toHaveCount(0);
  }
  record("pagesLoaded", Object.keys(seen));
  // The Leads and Transactions screens show the same rows the API does.
  await gotoReady(page, "/dashboard/leads", page.getByRole("columnheader", { name: /Follow-up/ }));
  await page.getByPlaceholder("Search name, email, or neighborhood").fill("SYSVERIFY Delta");
  await page.waitForTimeout(1500);
  const seesColleagueInUi = (await page.getByText("SYSVERIFY Delta AgentB").count()) > 0;
  record("leadsUiSeesColleague", seesColleagueInUi);
  expect(seesColleagueInUi).toBe(PRIVILEGED);
});

test("settings: the Brokerage section offers editing only to editors", async () => {
  await gotoReady(page, "/dashboard/settings", page.locator("h1").first());
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  record("settingsMentions", { team: /Team/.test(body), brokerage: /Brokerage/.test(body) });
  expect(body).toMatch(/Team/);
  expect(body).toMatch(/Brokerage/);
  const edit = page.getByRole("button", { name: /^Edit brokerage|^Edit$/ });
  const canSeeEdit = (await edit.count()) > 0;
  record("brokerageEditControl", canSeeEdit);
  expect(canSeeEdit).toBe(EDITS_BROKERAGE);
});

test("browser evidence: no direct Bridge request, no secret in served JS, no uncaught exception", async () => {
  const bodies = await Promise.all(Array.from(scripts.values()));
  const patterns: [string, RegExp][] = [
    ["openai", /(?<![A-Za-z])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/], ["anthropic", /sk-ant-[A-Za-z0-9_-]{20,}/], ["clerk secret", /sk_(?:live|test)_[A-Za-z0-9]{16,}/],
    ["postgres", /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/], ["neon", /npg_[A-Za-z0-9]{8,}/], ["blob", /vercel_blob_rw_[A-Za-z0-9_]+/], ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];
  const hits = patterns.map(([name, re]) => [name, bodies.filter((b) => re.test(b)).length] as const);
  const dashboardBytes = bodies.reduce((n, b) => n + b.length, 0);
  record("browser", { scriptsScanned: bodies.length, kilobytes: Math.round(dashboardBytes / 1024), secretHits: Object.fromEntries(hits), bridgeRequests: bridgeRequests.length, uncaught: uncaught.length, consoleErrors: consoleErrors.length });
  expect(bodies.length).toBeGreaterThan(5); // control: we really did scan the app
  for (const [name, n] of hits) expect(n, `secret-shaped string (${name}) in served JS`).toBe(0);
  expect(bridgeRequests, "the browser never talks to Bridge").toHaveLength(0);
  expect(uncaught, "uncaught product exceptions").toEqual([]);
  expect(consoleErrors, "product console errors").toEqual([]);
});
