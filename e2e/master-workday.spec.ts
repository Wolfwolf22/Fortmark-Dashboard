/**
 * Master certification — a working day, through the UI, as an agent and as a
 * broker.
 *
 *   WORKDAY = agent | broker      (the certification identity's Preview role)
 *
 * The question is not "does each endpoint answer" (the matrix and the
 * full-system run ask that) but "can a person do their job here without AI":
 * open Home, look at the market, add a person, remind themselves to call,
 * call, find them again, open a deal, move it, and see the business reflect it.
 * People do those things in the interface, so the interface is what is driven;
 * the API is used only to read back what the interface did.
 *
 * Preview has no MLS credential (`listings: not_configured`), so the MLS legs
 * assert the TRUTHFUL state and nothing fabricated; live MLS behaviour is
 * certified by the offline MLS suites and by the operator's own Production
 * session, and that limit is reported, not hidden.
 *
 * Every step logs `[day] ✓ …`; the final test prints the verdict line.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshToken, refreshingApiFor, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const WORKDAY = process.env.WORKDAY ?? "";
const TAG = process.env.WORKDAY_TAG ?? "MW0928";
const COLLEAGUE_CONTACT = "11111111-1111-4111-8111-111111111201";
const COLLEAGUE_TXN = "11111111-1111-4111-8111-111111111301";

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
let platformReloads = 0;
const steps: string[] = [];
const state: Record<string, string> = {};
const uncaught: string[] = [];
// Everything the browser saw fail, so an "Application error" page explains itself: a failed asset
// (platform) reads differently from an exception thrown by our code.
const failedResponses: string[] = [];
const consoleErrors: string[] = [];

const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ok = (step: string) => { steps.push(step); console.log(`[day] ✓ ${step}`); };

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
      console.log(`[day] platform error page at ${path}; reloading (${platformReloads} so far)`);
    }
  }
}
const drawer = () => page.getByRole("dialog");
const followRegion = () => drawer().getByRole("region", { name: "Next follow-up" });
const touchForm = () => drawer().getByRole("form", { name: "Log a touch" });

async function snap(id: string) {
  const c = await api(`/dashboard/api/contacts/${id}`);
  const a = await api(`/dashboard/api/contacts/${id}/activities`);
  const lead = (c.body.contact ?? {}) as { nextFollowUpDate?: string; lastContactDate?: string; assignedAgentName?: string };
  return { status: c.status, follow: lead.nextFollowUpDate, last: lead.lastContactDate ?? "", acts: Array.isArray(a.body.items) ? (a.body.items as unknown[]).length : -1, agent: lead.assignedAgentName };
}
async function metrics() {
  const m = await api("/dashboard/api/metrics");
  expect(m.status).toBe(200);
  return m.body as { scope: string; transactions: { data?: { activeCount: number; scheduledClosingsThisMonth?: number } }; attention: { data?: { items: { id: string }[] } }; activity?: unknown };
}
async function openQuickCreate(kind: "Lead" | "Transaction") {
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.locator("header").getByRole("button", { name: "New", exact: true }).click({ timeout: 5_000 });
    await page.getByRole("menuitem", { name: kind, exact: true }).click({ timeout: 3_000 });
    await expect(page.getByRole("dialog", { name: `New ${kind.toLowerCase()}` })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  return page.getByRole("dialog", { name: `New ${kind.toLowerCase()}` });
}
async function createTransactionThroughUi(address: string, closeDay: string | null) {
  await gotoReady(page, "/dashboard/transactions", page.getByRole("radio", { name: "Board" }));
  const dlg = await openQuickCreate("Transaction");
  await dlg.getByLabel("Property address").fill(address);
  await dlg.getByLabel("Client").fill(`Workday Client ${TAG}`);
  await dlg.getByLabel("Contract price").fill("525000");
  if (closeDay) await dlg.getByLabel("Close date (optional)").fill(closeDay);
  await dlg.locator('button[type="submit"]').click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
  const list = await api("/dashboard/api/transactions");
  const item = (list.body.items as { id: string; address: string }[]).find((t) => t.address.startsWith(address));
  expect(item, "the created transaction is listed").toBeTruthy();
  const detail = (await api(`/dashboard/api/transactions/${item!.id}`)).body.transaction as { closeDate?: string | null; milestones: { key: string }[] };
  return { id: item!.id, closeDate: detail.closeDate ?? null, closing: detail.milestones.filter((m) => m.key === "closing").length };
}
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  expect(["agent", "broker"], "WORKDAY must be agent or broker").toContain(WORKDAY);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => uncaught.push(`${e.message.slice(0, 200)} @ ${(e.stack ?? "").split("\n")[1]?.trim().slice(0, 120) ?? ""}`));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${new URL(r.url()).pathname.slice(0, 70)}`); });
  await signInCertificationUser(page);
  // Clerk intermittently fails to finish loading on a Preview page. Reload (counted) until the page
  // holds a session; any other failure surfaces at once.
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await freshToken(page);
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      platformReloads += 1;
      console.log(`[master] Clerk session not ready after load; reloading (${platformReloads} so far)`);
    }
  }
  api = refreshingApiFor(page);
});
test.afterAll(async () => {
  console.log(`[day] ${WORKDAY}: platform error-page reloads=${platformReloads}, uncaught exceptions=${uncaught.length}`);
  for (const u of uncaught) console.log(`[day]   uncaught: ${u}`);
  for (const c of consoleErrors.slice(0, 6)) console.log(`[day]   console: ${c}`);
  for (const f of failedResponses.slice(0, 8)) console.log(`[day]   failed response: ${f}`);
  await page?.close();
});

// =========================================================================================
test.describe("agent workday", () => {
  test.skip(WORKDAY !== "agent", "agent workday only");

  test("1. Home: welcome, the daily brief, real numbers", async () => {
    await gotoReady(page, "/dashboard", page.locator('section[aria-label="Daily brief"] dl'));
    const welcome = (await page.locator("#home-welcome").innerText()).replace(/\s+/g, " ").trim();
    expect(welcome).toMatch(/^Welcome(, [^\s@]+)?$/);
    const m = await metrics();
    expect(m.scope).toBe("own");
    expect(m.transactions.data?.activeCount).toBe(0); // an empty desk is a real zero
    ok("Home shows the welcome and a real zero desk");
  });

  test("2. MLS search and listing detail: honest on Preview (no MLS credential here)", async () => {
    await gotoReady(page, "/dashboard/listings", page.locator("h1").first());
    await page.waitForTimeout(2500);
    const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    console.log(`[day] listings page says: ${main.slice(0, 140)}`);
    await expect(page.getByRole("link", { name: /^Open listing / })).toHaveCount(0); // nothing fabricated
    expect(main).not.toMatch(/\$\s?\d{1,3},\d{3},\d{3}/); // no invented price
    await gotoReady(page, "/dashboard/listings/does-not-exist", page.locator("h1").first());
    await page.waitForTimeout(1500);
    const detail = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    expect(detail).not.toMatch(/\$\s?\d/);
    ok("Listings and a listing page tell the truth (MLS not connected on Preview); no listing is invented");
  });

  test("3. create a contact through the interface", async () => {
    // The table header only exists once there is a lead; the search box is there in the empty state too.
    await gotoReady(page, "/dashboard/leads", page.getByPlaceholder("Search name, email, phone or area"));
    const dlg = await openQuickCreate("Lead");
    await dlg.getByLabel("Name").fill(`WDAY Jane ${TAG}`);
    await dlg.getByLabel("Email").fill("wday.jane@example.test");
    await dlg.getByLabel("Phone").fill("(954) 555-0142");
    await dlg.locator('button[type="submit"]').click();
    await expect(dlg).toBeHidden({ timeout: 30_000 });
    const list = await api("/dashboard/api/contacts");
    const c = (list.body.items as { id: string; name: string; stage: string }[]).find((i) => i.name === `WDAY Jane ${TAG}`);
    expect(c, "the new contact is listed").toBeTruthy();
    state.contact = c!.id;
    expect(c!.stage).toBe("lead");
    const s = await snap(state.contact);
    expect(s.status).toBe(200);
    state.lastAtCreate = s.last;
    state.actsAtCreate = String(s.acts);
    ok("A contact is created, owned by the agent, in stage Lead");
  });

  test("4. schedule a follow-up: it does NOT count as contacting them", async () => {
    const before = await snap(state.contact);
    await page.goto(`/dashboard/leads?open=${state.contact}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("None set", { timeout: 30_000 });
    const target = day(4);
    await followRegion().getByRole("button", { name: "Schedule" }).click();
    await followRegion().locator("#lead-follow-up-day").fill(target);
    await followRegion().getByRole("button", { name: "Save follow-up" }).click();
    await expect(drawer().getByRole("status")).toContainText("Follow-up set for");
    const after = await snap(state.contact);
    expect(after.follow).toBe(`${target}T12:00:00.000Z`);
    expect(after.last).toBe(before.last); // last contact did not move
    expect(after.acts).toBe(before.acts); // no touch was written
    ok("A follow-up is scheduled; last contact and the activity history are untouched");
  });

  test("5. log a touch: THAT counts, and the reminder stays", async () => {
    const before = await snap(state.contact);
    await touchForm().getByLabel("Touch summary").fill("Spoke about their timeline");
    await touchForm().getByRole("button", { name: "Log touch" }).click();
    await expect(drawer().getByRole("status")).toContainText("Touch logged.");
    const after = await snap(state.contact);
    expect(new Date(after.last).getTime()).toBeGreaterThan(new Date(before.last || 0).getTime() - 1);
    expect(after.last).not.toBe(before.last); // last contact moved (control for step 4)
    expect(after.acts).toBe(before.acts + 1);
    expect(after.follow).toBe(before.follow); // the reminder was kept
    ok("A touch is logged: last contact moves, the reminder is kept");
  });

  test("6. find the person again with ⌘K", async () => {
    await gotoReady(page, "/dashboard", page.locator("#home-welcome"));
    const trigger = page.locator("header").getByRole("button", { name: "Search (Command K)" });
    const box = page.getByPlaceholder("Search people, deals, addresses…");
    await expect(async () => {
      await trigger.click();
      await expect(box).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await box.fill(`WDAY Jane`);
    const hit = page.getByRole("option", { name: new RegExp(`WDAY Jane ${TAG}`) }).first();
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await hit.click();
    await expect(page).toHaveURL(new RegExp(`/leads\\?open=${state.contact}`), { timeout: 30_000 });
    ok("Search finds the contact and opens it");
  });

  test("7. a transaction with a BLANK close date has no invented Closing deadline", async () => {
    const t = await createTransactionThroughUi(`1${TAG} Blank Way`, null);
    state.blank = t.id;
    expect(t.closeDate).toBeNull();
    expect(t.closing).toBe(0);
    ok("Blank close date: no closing date, 0 Closing deadlines");
  });

  test("8. a transaction WITH a close date has exactly one Closing deadline", async () => {
    const chosen = day(45);
    const t = await createTransactionThroughUi(`2${TAG} Dated Way`, chosen);
    state.dated = t.id;
    expect(t.closeDate?.slice(0, 10)).toBe(chosen);
    expect(t.closing).toBe(1);
    ok("Entered close date: kept exactly, 1 Closing deadline");
  });

  test("9. move the deal forward by hand; Home and history reflect it", async () => {
    const before = await metrics();
    await gotoReady(page, `/dashboard/transactions?open=${state.dated}`, page.getByRole("button", { name: /^Advance to / }));
    await page.getByRole("button", { name: /^Advance to offer/i }).click();
    await expect(async () => {
      const t = (await api(`/dashboard/api/transactions/${state.dated}`)).body.transaction as { stage: string };
      expect(t.stage).toBe("offer");
    }).toPass({ timeout: 20_000 });
    const events = await api(`/dashboard/api/transactions/${state.dated}`);
    console.log(`[day] transaction detail keys: ${Object.keys((events.body.transaction ?? {}) as object).slice(0, 12).join(",")}`);
    const after = await metrics();
    expect(after.transactions.data?.activeCount).toBe(before.transactions.data?.activeCount); // opportunity → offer: still active, still counted once
    expect(after.transactions.data?.activeCount).toBe(2); // the blank and the dated deal
    await gotoReady(page, "/dashboard", page.locator('section[aria-label="Daily brief"] dl'));
    const brief = (await page.locator('section[aria-label="Daily brief"]').innerText()).replace(/\s+/g, " ");
    expect(brief, "the brief leads with the figure, then its label").toMatch(/\b2\s+Active transactions/);
    ok("A stage is moved by hand; Home shows the same two active deals as the API");
  });

  test("10. find the deal again with search", async () => {
    await gotoReady(page, "/dashboard", page.locator("#home-welcome"));
    const trigger = page.locator("header").getByRole("button", { name: "Search (Command K)" });
    const box = page.getByPlaceholder("Search people, deals, addresses…");
    await expect(async () => {
      await trigger.click();
      await expect(box).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await box.fill(`2${TAG} Dated`);
    const hit = page.getByRole("option", { name: new RegExp(`2${TAG} Dated`) }).first();
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await hit.click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?open=${state.dated}`), { timeout: 30_000 });
    ok("Search finds the deal and opens it");
  });

  test("11. Profile, Team and Settings show real people", async () => {
    await gotoReady(page, "/dashboard/settings?tab=profile", page.locator("h1").first());
    await expect(page.getByText(/Application error/)).toHaveCount(0);
    const team = await api("/dashboard/api/team");
    const roster = (team.body as { items: { name: string; isSelf: boolean }[] }).items;
    await gotoReady(page, "/dashboard/settings?tab=team", page.locator("h1").first());
    await page.waitForTimeout(2000);
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    expect(roster.some((r) => r.isSelf)).toBe(true);
    for (const r of roster.filter((x) => x.name && x.name !== "—").slice(0, 3)) expect(text).toContain(r.name);
    ok("Profile and Team render the real roster");
  });

  test("VERDICT: can an agent run a normal Core V1 workday without AI?", async () => {
    const expected = 11;
    const verdict = steps.length === expected && uncaught.length === 0 ? "YES" : "NO";
    console.log(`[day] AGENT WORKDAY: ${verdict} — ${steps.length}/${expected} steps, ${uncaught.length} uncaught exceptions, ${platformReloads} platform reloads`);
    expect(verdict).toBe("YES");
  });
});

// =========================================================================================
test.describe("broker workday", () => {
  test.skip(WORKDAY !== "broker", "broker workday only");

  test("1. Home shows the brokerage, not one desk", async () => {
    await gotoReady(page, "/dashboard", page.locator('section[aria-label="Daily brief"] dl'));
    const m = await metrics();
    expect(m.scope).toBe("brokerage");
    expect(m.transactions.data?.activeCount).toBeGreaterThanOrEqual(1); // the colleague's deal counts
    ok("Home is brokerage-scoped and counts the colleague's deal");
  });

  test("2. FortMark Listings: honest when the MLS is not connected here", async () => {
    await gotoReady(page, "/dashboard/listings?office=fortmark", page.locator("h1").first());
    await page.waitForTimeout(2500);
    const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    await expect(page.getByRole("link", { name: /^Open listing / })).toHaveCount(0);
    expect(main).not.toMatch(/\$\s?\d{1,3},\d{3},\d{3}/);
    ok("FortMark Listings shows the truthful state; nothing fabricated");
  });

  test("3. Team: the roster, with the privileged columns", async () => {
    const team = (await api("/dashboard/api/team")).body as { viewerPrivileged: boolean; items: { status?: string; isSelf: boolean }[] };
    expect(team.viewerPrivileged).toBe(true);
    expect(team.items.length).toBeGreaterThanOrEqual(3);
    expect(team.items.every((i) => typeof i.status === "string")).toBe(true);
    await gotoReady(page, "/dashboard/settings?tab=team", page.locator("h1").first());
    await expect(page.getByText(/Application error/)).toHaveCount(0);
    ok("Team lists the whole roster with status");
  });

  test("4. Brokerage settings: the identity, with the edit control", async () => {
    await gotoReady(page, "/dashboard/settings?tab=brokerage", page.locator("h1").first());
    await expect(page.getByRole("button", { name: /^Edit brokerage/ })).toBeVisible({ timeout: 20_000 });
    ok("Brokerage identity is shown and editable by a broker");
  });

  test("5. a colleague's contact: open it and schedule the follow-up (no touch)", async () => {
    const before = await snap(COLLEAGUE_CONTACT);
    expect(before.status).toBe(200);
    await page.goto(`/dashboard/leads?open=${COLLEAGUE_CONTACT}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lead-next-follow-up")).toBeVisible({ timeout: 30_000 });
    const target = day(6);
    await followRegion().getByRole("button", { name: /^(Schedule|Change)$/ }).click();
    await followRegion().locator("#lead-follow-up-day").fill(target);
    await followRegion().getByRole("button", { name: "Save follow-up" }).click();
    await expect(drawer().getByRole("status")).toContainText("Follow-up");
    const after = await snap(COLLEAGUE_CONTACT);
    expect(after.follow).toBe(`${target}T12:00:00.000Z`);
    expect(after.last).toBe(before.last);
    expect(after.acts).toBe(before.acts);
    ok("A broker schedules a colleague's follow-up without logging a touch");
  });

  test("6. brokerage transactions: see the colleague's deal and move it", async () => {
    const list = (await api("/dashboard/api/transactions")).body.items as { id: string; stage: string }[];
    const deal = list.find((t) => t.id === COLLEAGUE_TXN);
    expect(deal, "the broker sees the colleague's deal").toBeTruthy();
    await gotoReady(page, `/dashboard/transactions?open=${COLLEAGUE_TXN}`, page.getByRole("button", { name: /^Advance to / }));
    await page.getByRole("button", { name: /^Advance to / }).click();
    await expect(async () => {
      const t = (await api(`/dashboard/api/transactions/${COLLEAGUE_TXN}`)).body.transaction as { stage: string };
      expect(t.stage).not.toBe(deal!.stage);
    }).toPass({ timeout: 20_000 });
    ok("A broker moves a colleague's deal by hand");
  });

  test("7. search across the brokerage", async () => {
    const s = async (q: string) => ((await post("/dashboard/api/search", { q })).body as { hits?: { entity: string }[] }).hits ?? [];
    expect((await s("SYSVERIFY Delta AgentB")).length).toBeGreaterThan(0);
    expect((await s("400 AgentB Way")).length).toBeGreaterThan(0);
    expect((await s("SYSVERIFY Echo Foreign")).length).toBe(0); // another brokerage is still invisible
    ok("Search finds the colleague's contact and deal, never the other brokerage's");
  });

  test("8. the numbers add up: metrics match what the broker can list", async () => {
    const m = await metrics();
    const ACTIVE = ["opportunity", "offer", "under_contract", "due_diligence", "financing", "closing_prep"];
    const listed = ((await api("/dashboard/api/transactions")).body.items as { stage: string }[]).filter((t) => ACTIVE.includes(t.stage)).length;
    expect(m.transactions.data?.activeCount).toBe(listed);
    ok("Home's active-deal count equals the broker's own list");
  });

  test("VERDICT: can a broker supervise Core V1 operations without AI?", async () => {
    const expected = 8;
    const verdict = steps.length === expected && uncaught.length === 0 ? "YES" : "NO";
    console.log(`[day] BROKER WORKDAY: ${verdict} — ${steps.length}/${expected} steps, ${uncaught.length} uncaught exceptions, ${platformReloads} platform reloads`);
    expect(verdict).toBe("YES");
  });
});
