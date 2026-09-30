/**
 * Transactions visibility — Preview certification, one role per run.
 *
 *   TXV_ROLE = admin | agent
 *
 * What is being certified: the Transactions page is a WORK LIST. It must show
 * a deal that has no contract or closing date (every opportunity-stage deal),
 * at the default "Month" reporting period, without sending any date window.
 * Scope is the role's: an admin sees the brokerage, an agent only their own.
 *
 * Fixture (synthetic, Preview database only, removed afterwards): two
 * opportunity-stage deals with no dates — "TXV 1 Mine Street" owned by the
 * certification identity and "TXV 2 Colleague Avenue" owned by a second user.
 * Ids arrive as TXV_MINE and TXV_COLLEAGUE.
 */
import { expect, test, type Page } from "@playwright/test";
import { freshToken, refreshingApiFor, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const ROLE = process.env.TXV_ROLE ?? "";
const MINE = process.env.TXV_MINE ?? "";
const COLLEAGUE = process.env.TXV_COLLEAGUE ?? "";

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
const sent: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  expect(["admin", "agent"], "TXV_ROLE must be admin or agent").toContain(ROLE);
  expect(MINE && COLLEAGUE, "fixture ids are required").toBeTruthy();
  page = await (await browser.newContext()).newPage();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/dashboard/api/transactions")) sent.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  await signInCertificationUser(page);
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await freshToken(page);
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
  }
  api = refreshingApiFor(page);
});

test.afterAll(async () => {
  await page?.close();
});

test("the API returns the role's scope for an undated deal", async () => {
  const res = await api("/dashboard/api/transactions");
  expect(res.status).toBe(200);
  const items = (res.body as { items: { id: string; address: string }[] }).items;
  const ids = items.map((i) => i.id);
  expect(ids, "own undated deal is listed").toContain(MINE);
  if (ROLE === "admin") {
    expect(ids, "admin sees the colleague's deal").toContain(COLLEAGUE);
    expect((await api(`/dashboard/api/transactions/${COLLEAGUE}`)).status).toBe(200);
  } else {
    expect(ids, "an agent does not see a colleague's deal").not.toContain(COLLEAGUE);
    expect((await api(`/dashboard/api/transactions/${COLLEAGUE}`)).status, "and it is not found").toBe(404);
  }
});

test("the signed-in page shows the undated deal at the default period, with no date window sent", async () => {
  sent.length = 0;
  await page.goto("/dashboard/transactions", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByText("TXV 1 Mine Street").first()).toBeVisible({ timeout: 60_000 });
  if (ROLE === "admin") {
    await expect(page.getByText("TXV 2 Colleague Avenue").first()).toBeVisible();
  } else {
    await expect(page.getByText("TXV 2 Colleague Avenue")).toHaveCount(0);
  }
  await expect(page.getByText("No transactions found")).toHaveCount(0);
  const listCalls = sent.filter((s) => /^GET \/dashboard\/api\/transactions(\?|$)/.test(s));
  expect(listCalls.length, "the page asked for the list").toBeGreaterThan(0);
  for (const call of listCalls) expect(call, "no reporting period is sent").not.toMatch(/[?&](from|to)=/);
  console.log(`[txv] role=${ROLE} list calls: ${JSON.stringify(listCalls)}`);
});

test("the table view lists the same deals", async () => {
  await page.getByRole("radio", { name: "Table" }).click().catch(async () => {
    await page.getByRole("button", { name: "Table" }).click();
  });
  await expect(page.getByText("TXV 1 Mine Street").first()).toBeVisible({ timeout: 30_000 });
  if (ROLE === "admin") await expect(page.getByText("TXV 2 Colleague Avenue").first()).toBeVisible();
});
