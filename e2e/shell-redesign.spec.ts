/**
 * Home + top navigation redesign — authenticated Preview certification.
 *
 * Screenshots go to SHOTS_DIR (default: test-results/shell-shots), never into
 * the repository. Nothing here writes data.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.SHOTS_DIR ?? "test-results/shell-shots";
mkdirSync(SHOTS, { recursive: true });

let page: Page;
let api: ReturnType<typeof apiFor>;

async function settle(p: Page) {
  // Past the entrance (380 ms) and the hero rise (560 + 180 ms).
  await p.waitForTimeout(900);
}
async function openHome(p: Page) {
  for (let i = 0; i < 3; i += 1) {
    await p.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(p.locator("#home-welcome")).toBeVisible({ timeout: 25_000 });
      // The brief renders its figures only after the client metrics fetch,
      // so seeing them means React has hydrated and handlers are attached.
      await expect(p.locator('section[aria-label="Daily brief"] dl')).toBeVisible({ timeout: 25_000 });
      return;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
const noOverflow = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInCertificationUser(page);
  await openHome(page);
  api = apiFor(await freshToken(page));
});

test.afterAll(async () => {
  await page?.close();
});

test("shell: top navigation, no rail", async () => {
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  const primary = header.getByRole("navigation", { name: "Primary" }).first();
  for (const label of ["Home", "Listings", "Leads", "Transactions"]) {
    await expect(primary.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(primary.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("aside[aria-label='Primary navigation']")).toHaveCount(0);
  const box = await header.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(72);
  expect(box!.x).toBe(0);
  await expect(header.getByRole("button", { name: "Search (Command K)" })).toBeVisible();
  await expect(header.getByRole("link", { name: "FortMark home" })).toBeVisible();
});

test("Welcome: real first name from the profile, one greeting", async () => {
  const h1 = page.locator("#home-welcome");
  const text = (await h1.innerText()).replace(/\s+/g, " ").trim();
  console.log(`[shell] greeting shape: ${text.startsWith("Welcome,") ? "Welcome, <name>" : text}`);
  expect(text).toMatch(/^Welcome(, [^\s@]+)?$/);
  expect(text).not.toMatch(/undefined|null|@/);
  // The name matches the server's own greeting projection.
  const profile = await api("/dashboard/api/profile");
  const card = (profile.body.card ?? null) as { greetingName?: string | null } | null;
  if (card?.greetingName) expect(text).toBe(`Welcome, ${card.greetingName}`);
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
  await expect(page.locator("#home-identity-heading")).toHaveCount(0);
});

for (const [w, h] of [[1440, 900], [1280, 800], [430, 932], [390, 844]] as const) {
  test(`Home at ${w}: no overflow, nav fits, screenshot`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await openHome(page);
    await settle(page);
    expect(await noOverflow(page)).toBe(true);
    // The hero clips its own overflow, so check its panel fits inside it too.
    const fits = await page.evaluate(() => {
      const hero = document.querySelector('section[aria-labelledby="home-welcome"]')!.getBoundingClientRect();
      const panel = document.querySelector('aside[aria-label="Needs attention summary"]')!.getBoundingClientRect();
      return panel.right <= hero.right + 0.5 && panel.left >= hero.left - 0.5;
    });
    expect(fits).toBe(true);
    const header = await page.locator("header").first().boundingBox();
    if (w >= 1024) expect(header!.height).toBeLessThanOrEqual(72); // one row: no wrap
    await page.screenshot({ path: `${SHOTS}/home-${w}.png`, fullPage: w < 1024 });
    await page.screenshot({ path: `${SHOTS}/home-${w}-fold.png` });
  });
}

test("route motion: exit, enter, header persists, active tab follows", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page);
  await settle(page);
  await page.evaluate(() => {
    (window as unknown as { __hdr: Element | null }).__hdr = document.querySelector("header");
    (window as unknown as { __states: string[] }).__states = [];
    new MutationObserver(() => {
      const el = document.querySelector("[data-page-transition]");
      const s = el?.getAttribute("data-page-transition");
      const arr = (window as unknown as { __states: string[] }).__states;
      if (s && arr[arr.length - 1] !== s) arr.push(s);
    }).observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-page-transition"] });
  });
  const nav = page.locator("header").getByRole("navigation", { name: "Primary" }).first();
  const steps: [string, RegExp][] = [
    ["Listings", /\/dashboard\/listings/],
    ["Leads", /\/dashboard\/leads/],
    ["Transactions", /\/dashboard\/transactions/],
    ["Home", /\/dashboard\/?$/],
  ];
  for (const [label, url] of steps) {
    const t0 = Date.now();
    await nav.getByRole("link", { name: label, exact: true }).click();
    if (label === "Listings") {
      await page.waitForTimeout(90);
      await page.screenshot({ path: `${SHOTS}/transition-exit-mid.png` });
    }
    await expect(page).toHaveURL(url, { timeout: 30_000 });
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await page.waitForTimeout(500);
    const el = page.locator("[data-page-transition]");
    await expect(el).toHaveCount(1); // no duplicate page content
    await expect(el).toHaveAttribute("data-page-transition", "enter");
    const opacity = await el.evaluate((n) => getComputedStyle(n).opacity);
    expect(Number(opacity)).toBe(1); // no stuck opacity
    console.log(`[shell] → ${label}: url+settle ${Date.now() - t0} ms`);
  }
  const states = await page.evaluate(() => (window as unknown as { __states: string[] }).__states);
  console.log(`[shell] transition states observed: ${states.join(",")}`);
  expect(states).toContain("exit");
  expect(await page.evaluate(() => (window as unknown as { __hdr: Element | null }).__hdr === document.querySelector("header"))).toBe(true);

  // Back/forward are ordinary history.
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/transactions/, { timeout: 30_000 });
  await expect(nav.getByRole("link", { name: "Transactions", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(page.locator("[data-page-transition]")).toHaveAttribute("data-page-transition", "enter");
});

test("Listings screenshot and nested route keeps Listings active", async () => {
  await page.goto("/dashboard/listings?office=all", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/listings-1440.png` });
  const nav = page.locator("header").getByRole("navigation", { name: "Primary" }).first();
  await expect(nav.getByRole("link", { name: "Listings", exact: true })).toHaveAttribute("aria-current", "page");
  const detail = page.getByRole("link", { name: /^Open listing / }).first();
  if (await detail.count()) {
    await detail.click();
    await expect(page).toHaveURL(/\/dashboard\/listings\/[A-Za-z0-9]+/, { timeout: 30_000 });
    await expect(nav.getByRole("link", { name: "Listings", exact: true })).toHaveAttribute("aria-current", "page");
  } else {
    console.log("[shell] no listing cards on this Preview (MLS state) — nested check via /listings/x");
    await page.goto("/dashboard/listings/does-not-exist", { waitUntil: "domcontentloaded" });
    await expect(nav.getByRole("link", { name: "Listings", exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test("secondary sections: More shows the current one", async () => {
  await page.goto("/dashboard/reports", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const more = page.locator("header").getByRole("button", { name: /More sections/ });
  await expect(more).toHaveAccessibleName(/current: Reports/);
});

test("⌘K still opens from the search control and restores focus", async () => {
  await openHome(page);
  const trigger = page.locator("header").getByRole("button", { name: "Search (Command K)" });
  // The hero is server-rendered, so it can be visible a moment before the
  // client handlers attach; retry the click until hydration has happened.
  await expect(async () => {
    await trigger.click();
    await expect(page.getByPlaceholder("Search people, deals, addresses…")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Search people, deals, addresses…")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("phone: section strip navigates, no overflow, keyboard reachable", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const strip = page.locator("header nav[aria-label='Primary']").last();
  await expect(strip).toBeVisible();
  await strip.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/transactions/, { timeout: 30_000 });
  await expect(strip.getByRole("link", { name: "Transactions", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await noOverflow(page)).toBe(true);
  await strip.getByRole("link", { name: "AI", exact: true }).focus();
  await expect(strip.getByRole("link", { name: "AI", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); // no trap: focus leaves the strip
  expect(await strip.evaluate((n) => n.contains(document.activeElement))).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 30_000 });
  await page.setViewportSize({ width: 1440, height: 900 }); // width change back
  await expect(page.locator("header nav[aria-label='Primary']").first()).toBeVisible();
});

test("reduced motion: no exit state, navigation immediate", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await signInCertificationUser(p);
  await openHome(p);
  await p.evaluate(() => {
    (window as unknown as { __sawExit: boolean }).__sawExit = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-page-transition="exit"]'))
        (window as unknown as { __sawExit: boolean }).__sawExit = true;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await p.locator("header").getByRole("navigation", { name: "Primary" }).first()
    .getByRole("link", { name: "Leads", exact: true }).click();
  await expect(p).toHaveURL(/\/dashboard\/leads/, { timeout: 30_000 });
  expect(await p.evaluate(() => (window as unknown as { __sawExit: boolean }).__sawExit)).toBe(false);
  const dur = await p.locator("[data-page-transition]").evaluate((n) => getComputedStyle(n).animationDuration);
  expect(parseFloat(dur)).toBeLessThan(0.01);
  await ctx.close();
});
