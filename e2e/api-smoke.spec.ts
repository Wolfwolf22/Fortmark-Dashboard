/**
 * Read-only API smoke: every domain the dashboard shell sits on, through the
 * real session. Used as the domain regression for UI-only releases — nothing
 * here writes. Status and shape only; no payload is printed.
 */
import { expect, test, type Page } from "@playwright/test";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

let page: Page;
let api: ReturnType<typeof apiFor>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  page = await browser.newPage();
  await signInCertificationUser(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
  api = apiFor(await freshToken(page));
});

test.afterAll(async () => {
  await page?.close();
});

test("protected APIs refuse an anonymous caller", async ({ request }) => {
  for (const path of ["/dashboard/api/metrics", "/dashboard/api/contacts", "/dashboard/api/transactions", "/dashboard/api/search"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect([401, 403, 307, 302], path).toContain(r.status());
  }
});

test("domains answer through the session", async () => {
  const health = await api("/dashboard/api/health");
  expect(health.status).toBe(200);
  const sources = health.body.sources as Record<string, unknown>;
  console.log(`[smoke] health sources: transactions=${sources.transactions} contacts=${sources.contacts} listings=${sources.listings} homeMetrics=${sources.homeMetrics}`);

  const checks: [string, (b: Record<string, unknown>) => boolean][] = [
    ["/dashboard/api/metrics", (b) => typeof b.transactions === "object" && typeof b.attention === "object"],
    ["/dashboard/api/contacts", (b) => Array.isArray(b.items) || Array.isArray(b.contacts) || typeof b === "object"],
    ["/dashboard/api/transactions", (b) => typeof b === "object"],
    ["/dashboard/api/team", (b) => typeof b === "object"],
    ["/dashboard/api/profile", (b) => typeof b === "object"],
    ["/dashboard/api/profile/mls", (b) => typeof b.identity === "object"],
    ["/dashboard/api/brokerage", (b) => "canEdit" in b],
    ["/dashboard/api/listings/source", (b) => typeof b.source === "string"],
  ];
  for (const [path, shape] of checks) {
    const r = await api(path);
    console.log(`[smoke] ${path.replace("/dashboard", "")} → ${r.status}`);
    expect(r.status, path).toBe(200);
    expect(shape(r.body), `${path} shape`).toBe(true);
  }
  // Unified search is POST-only by design (the query stays out of URLs/logs).
  const s = await api("/dashboard/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: "fort" }),
  });
  console.log(`[smoke] /api/search (POST) → ${s.status}`);
  expect(s.status).toBe(200);
  expect(Array.isArray(s.body.hits)).toBe(true);
});
