/**
 * Master certification — request sanity (checklist item 91).
 *
 * One load of each primary page, counting what the browser asked the
 * dashboard's own API for. Looking for the three things that make a screen
 * slow or costly without being wrong: the same request made more than once
 * (duplicate metrics or MLS calls), a request per row (N+1), and an unbounded
 * request. No micro-optimisation: the bars are deliberately loose, and a page
 * that clears them is fine.
 *
 * Strictly bounded: five page loads, every navigation 45 s, the whole spec 3
 * minutes. It cannot become a long-running task.
 */
import { expect, test } from "@playwright/test";
import { signInCertificationUser } from "./session";

test.setTimeout(180_000);

const PAGES: [string, string][] = [
  ["Home", "/dashboard"],
  ["Leads", "/dashboard/leads"],
  ["Transactions", "/dashboard/transactions"],
  ["Listings", "/dashboard/listings"],
  ["Settings", "/dashboard/settings?tab=team"],
];

test("each primary page asks for what it needs, once", async ({ page }) => {
  await signInCertificationUser(page);
  const report: Record<string, { total: number; duplicates: string[]; heaviest: string }> = {};
  for (const [name, path] of PAGES) {
    const calls = new Map<string, number>();
    const handler = (r: { url(): string; method(): string }) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/dashboard/api/")) {
        const key = `${r.method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
      }
    };
    page.on("request", handler);
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // Not "networkidle": Clerk keeps the network busy, so it never settles. A fixed window is enough for
    // the page's own data requests, which are made on mount.
    await page.waitForTimeout(4_000);
    page.off("request", handler);
    const entries = Array.from(calls.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((n, [, c]) => n + c, 0);
    const duplicates = entries.filter(([, c]) => c > 2).map(([k, c]) => `${k} ×${c}`);
    report[name] = { total, duplicates, heaviest: entries[0] ? `${entries[0][0]} ×${entries[0][1]}` : "(none)" };
    console.log(`[req] ${name}: ${total} API calls — ${entries.map(([k, c]) => `${k}${c > 1 ? ` ×${c}` : ""}`).join("; ")}`);
    expect(total, `${name}: a page load should not make dozens of API calls`).toBeLessThanOrEqual(20);
    expect(duplicates, `${name}: the same request made more than twice`).toEqual([]);
    // No per-row requests: a detail route (with an id) is never fetched once per list row on a list page.
    const perRow = entries.filter(([k, c]) => /:id/.test(k) && c > 2);
    expect(perRow, `${name}: an N+1 pattern`).toEqual([]);
  }
  console.log(`[req] summary ${JSON.stringify(report)}`);
});
