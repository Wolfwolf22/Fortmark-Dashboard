/**
 * Live MLS certification — Preview, real Bridge `miamire`, the exact dashboard
 * path (browser → /dashboard/api/* → lib/mls → Bridge).
 *
 * Nothing here talks to Bridge directly and no credential is handled: every
 * request is an authenticated dashboard request made as the Preview
 * certification user. Assertions are on behaviour, never on a fixed inventory
 * number — the MLS changes by the minute. Logs print counts, statuses and
 * timings only; no listing payload, address or remark is ever printed.
 *
 * Optional: MLS_PRIVATE_LISTINGS="<listingKey>:<parcel>,…" names live records
 * whose broker withheld the address (found out-of-band). Their parcel numbers
 * are used only to assert they never reach a browser payload.
 */
import { expect, test, type Page } from "@playwright/test";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

type Json = Record<string, unknown>;
type Item = Json & { id: string; mlsNumber: string; status: string; city: string; listPrice: number; beds: number; photos: string[]; source: string };

const FORTMARK = "FTMK01";
const WITHHELD = "Address withheld by listing broker";
const PRODUCT_KEYS = new Set([
  "id", "mlsNumber", "folioNumber", "address", "city", "zip", "neighborhood", "status", "propertyType",
  "listPrice", "closedPrice", "beds", "baths", "sqft", "lotSqft", "yearBuilt", "listedDate", "closedDate",
  "expiresDate", "daysOnMarket", "agentId", "listingAgent", "photos", "description", "priceHistory",
  "featured", "source", "coordinates", "listingOffice", "isFortmark", "addressWithheld",
]);
const PRIVATE = (process.env.MLS_PRIVATE_LISTINGS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [key, parcel] = s.split(":");
    return { key, parcel };
  });

let page: Page;
let api: ReturnType<typeof apiFor>;
const timings: Record<string, number> = {};
let sample: Item;

async function timed(label: string, path: string, init?: RequestInit) {
  const t0 = Date.now();
  const r = await api(path, init);
  timings[label] = Date.now() - t0;
  return r;
}
const items = (b: Json) => (b.items as Item[]) ?? [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInCertificationUser(page);
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    if ((await page.locator("main").first().innerText().catch(() => "")).trim().length > 40) break;
  }
  api = apiFor(await freshToken(page));
});

test.afterAll(async () => {
  console.log(`[mls] timings(ms) ${JSON.stringify(timings)}`);
});

// --- Source, first search, product boundary -----------------------------------
test("health reports the MLS as the listing source", async () => {
  const r = await api("/dashboard/api/health");
  expect((r.body.sources as Json).listings).toBe("mls");
  const s = await api("/dashboard/api/listings/source");
  expect(s.body.source).toBe("mls");
});

test("active residential in Fort Lauderdale: real, active, attributed, product-shaped", async () => {
  const r = await timed("search_fll_active", "/dashboard/api/listings?city=Fort%20Lauderdale&status=active&pageSize=24");
  expect(r.status).toBe(200);
  expect(r.body.source).toBe("mls");
  const rows = items(r.body);
  const total = Number(r.body.total);
  console.log(`[mls] fort lauderdale active total=${total} page=${rows.length}`);
  expect(total).toBeGreaterThan(0);
  expect(rows.length).toBeGreaterThan(0);
  for (const l of rows) {
    expect(l.source).toBe("mls");
    expect(l.status).toBe("active");
    expect(l.city.toLowerCase()).toBe("fort lauderdale");
    // Attribution on every row, from the feed — never hard-coded.
    expect(typeof (l.listingOffice as Json | undefined)?.name).toBe("string");
    // Nothing but product fields crosses to the browser.
    for (const k of Object.keys(l)) expect(PRODUCT_KEYS.has(k), `unexpected key ${k}`).toBe(true);
    expect(l.photos.length).toBeLessThanOrEqual(1);
  }
  const offices = new Set(rows.map((l) => (l.listingOffice as Json).mlsId));
  console.log(`[mls] distinct listing offices on one page: ${offices.size}`);
  expect(offices.size).toBeGreaterThan(1);
  const withPhoto = rows.filter((l) => l.photos.length === 1).length;
  console.log(`[mls] rows with a thumbnail: ${withPhoto}/${rows.length}`);
  expect(withPhoto).toBeGreaterThan(0);
  sample = rows.find((l) => l.photos.length === 1 && !l.addressWithheld) ?? rows[0];
});

test("default search is active listings only", async () => {
  const all = await api("/dashboard/api/listings?pageSize=1");
  const active = await api("/dashboard/api/listings?status=active&pageSize=1");
  console.log(`[mls] all-status total=${all.body.total} active total=${active.body.total}`);
  expect(Number(all.body.total)).toBeGreaterThan(Number(active.body.total));
  const closed = await api("/dashboard/api/listings?status=closed&pageSize=12");
  expect(items(closed.body).every((l) => l.status === "closed")).toBe(true);
});

test("pagination is server-side and does not repeat rows", async () => {
  const q = "/dashboard/api/listings?city=Fort%20Lauderdale&status=active&pageSize=24&sort=listPrice&dir=desc";
  const p1 = await timed("page1", `${q}&page=1`);
  const p2 = await timed("page2", `${q}&page=2`);
  const p3 = await api(`${q}&page=3`);
  expect(p1.body.total).toBe(p2.body.total);
  const ids = [...items(p1.body), ...items(p2.body), ...items(p3.body)].map((l) => l.id);
  console.log(`[mls] 3 pages: ${ids.length} rows, ${new Set(ids).size} distinct`);
  expect(new Set(ids).size).toBe(ids.length);
  expect(items(p2.body).length).toBe(24);
});

test("price, beds, type and city filters apply upstream", async () => {
  const price = await timed("filter_price", "/dashboard/api/listings?status=active&city=Fort%20Lauderdale&minPrice=500000&maxPrice=750000&pageSize=48");
  const pr = items(price.body);
  expect(pr.length).toBeGreaterThan(0);
  expect(pr.every((l) => l.listPrice >= 500000 && l.listPrice <= 750000)).toBe(true);

  const beds = await api("/dashboard/api/listings?status=active&city=Fort%20Lauderdale&minBeds=4&pageSize=48");
  expect(items(beds.body).every((l) => l.beds >= 4)).toBe(true);

  for (const t of ["condo", "singleFamily", "townhouse"]) {
    const r = await api(`/dashboard/api/listings?status=active&city=Fort%20Lauderdale&propertyType=${t}&pageSize=24`);
    const rows = items(r.body);
    console.log(`[mls] type ${t}: total=${r.body.total}`);
    expect(rows.every((l) => l.propertyType === t)).toBe(true);
  }
  for (const t of ["land", "multiFamily"]) {
    const r = await api(`/dashboard/api/listings?status=active&propertyType=${t}&pageSize=24`);
    console.log(`[mls] type ${t}: total=${r.body.total}`);
    expect(Number(r.body.total), `${t} matches real inventory`).toBeGreaterThan(0);
    expect(items(r.body).every((l) => l.propertyType === t)).toBe(true);
  }

  const sunrise = await api("/dashboard/api/listings?status=active&city=Sunrise&pageSize=24");
  expect(Number(sunrise.body.total)).toBeGreaterThan(0);
  expect(items(sunrise.body).every((l) => l.city.toLowerCase() === "sunrise")).toBe(true);
});

test("sorting is applied by the MLS", async () => {
  const base = "/dashboard/api/listings?status=active&city=Fort%20Lauderdale&pageSize=24";
  const asc = items((await api(`${base}&sort=listPrice&dir=asc`)).body).map((l) => l.listPrice);
  const desc = items((await api(`${base}&sort=listPrice&dir=desc`)).body).map((l) => l.listPrice);
  expect(asc.every((v, i) => i === 0 || v >= asc[i - 1])).toBe(true);
  expect(desc.every((v, i) => i === 0 || v <= desc[i - 1])).toBe(true);
  // Bridge orders null list dates first; those rows carry no date ("—") and
  // are exempt. Every dated row must be newest-first.
  const newest = items((await api(`${base}&sort=listedDate&dir=desc`)).body).map((l) => String(l.listedDate)).filter(Boolean);
  expect(newest.length).toBeGreaterThan(0);
  expect(newest.every((v, i) => i === 0 || v <= newest[i - 1])).toBe(true);
  const dom = await api(`${base}&sort=daysOnMarket&dir=asc`);
  expect(dom.body.sortApplied).toBe(true);
});

// --- Exact lookup, detail, media ------------------------------------------------
test("an MLS number resolves to exactly that listing, and its detail loads with photos", async () => {
  const exact = await timed("mls_exact", `/dashboard/api/listings?q=${encodeURIComponent(sample.mlsNumber)}&pageSize=12`);
  const rows = items(exact.body);
  expect(rows.length).toBe(1);
  expect(rows[0].id).toBe(sample.id);

  const d = await timed("detail", `/dashboard/api/listings/${encodeURIComponent(sample.id)}`);
  expect(d.status).toBe(200);
  const l = d.body.listing as Item;
  for (const k of Object.keys(l)) expect(PRODUCT_KEYS.has(k), `unexpected key ${k}`).toBe(true);
  console.log(`[mls] detail photos=${l.photos.length} office=${(l.listingOffice as Json)?.mlsId} fields=${["beds", "baths", "sqft", "lotSqft", "yearBuilt", "daysOnMarket", "description", "listingAgent"].filter((k) => l[k] !== undefined && l[k] !== "" && l[k] !== 0).join(",")}`);
  expect(l.mlsNumber).toBe(sample.mlsNumber);
  expect(l.photos.length).toBeGreaterThan(1);
  expect(l.photos.every((u) => u.startsWith("https://dvvjkgh94f2v6.cloudfront.net/"))).toBe(true);
  // By MLS number too.
  const byMls = await api(`/dashboard/api/listings/${encodeURIComponent(sample.mlsNumber)}`);
  expect((byMls.body.listing as Item).id).toBe(sample.id);
});

// --- FortMark's own book -------------------------------------------------------
test("FortMark listings are exactly FTMK01's, and Home's count agrees", async () => {
  const r = await timed("fortmark", "/dashboard/api/listings?office=fortmark&status=active&pageSize=48");
  const rows = items(r.body);
  console.log(`[mls] fortmark active total=${r.body.total}`);
  expect(Number(r.body.total)).toBeGreaterThan(0);
  for (const l of rows) {
    expect(l.isFortmark).toBe(true);
    expect(l.status).toBe("active");
  }
  expect(rows.filter((l) => (l.listingOffice as Json).mlsId === FORTMARK).length).toBeGreaterThan(0);
  const f = await timed("featured", "/dashboard/api/listings/featured");
  expect(f.body.fortmarkActiveCount).toBe(Number(r.body.total));
  const featured = f.body.listing as Item;
  expect(featured.isFortmark).toBe(true);
  expect(featured.listPrice).toBe(Math.max(...rows.map((l) => l.listPrice)));
});

// --- Display compliance --------------------------------------------------------
test("withheld addresses never reach the browser — detail, search, ⌘K", async () => {
  test.skip(PRIVATE.length === 0, "no restricted-address listing supplied");
  for (const { key, parcel } of PRIVATE) {
    const d = await api(`/dashboard/api/listings/${encodeURIComponent(key)}`);
    expect(d.status).toBe(200);
    const l = d.body.listing as Item;
    expect(l.address).toBe(WITHHELD);
    expect(l.addressWithheld).toBe(true);
    expect(l.folioNumber).toBeUndefined();
    expect(l.coordinates).toBeUndefined();
    const raw = JSON.stringify(d.body);
    expect(parcel && raw.includes(parcel)).toBeFalsy();

    const list = await api(`/dashboard/api/listings?q=${encodeURIComponent(l.mlsNumber)}`);
    const row = items(list.body)[0];
    expect(row?.address).toBe(WITHHELD);
    expect(parcel && JSON.stringify(list.body).includes(parcel)).toBeFalsy();

    const s = await api("/dashboard/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: l.mlsNumber }) });
    const hit = ((s.body.hits as Json[]) ?? []).find((h) => h.entity === "listing");
    expect(hit?.title).toBe(WITHHELD);
    expect(parcel && JSON.stringify(s.body).includes(parcel)).toBeFalsy();
  }
  console.log(`[mls] restricted-address listings certified: ${PRIVATE.length}`);
});

// --- Unified search ------------------------------------------------------------
test("⌘K search finds a listing by MLS number next to the CRM providers", async () => {
  const s = await timed("search_api", "/dashboard/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: sample.mlsNumber }) });
  expect(s.status).toBe(200);
  const providers = s.body.providers as Json;
  expect(providers.listing).toBe("available");
  expect(["available", "not_configured"]).toContain(providers.contact);
  const hits = (s.body.hits as Json[]) ?? [];
  const hit = hits.find((h) => h.entity === "listing");
  expect(hit?.href).toBe(`/listings/${encodeURIComponent(sample.id)}`);
});

// --- Comparables ---------------------------------------------------------------
test("comparables are real closed sales of the same kind", async () => {
  const subject = items((await api("/dashboard/api/listings?status=active&city=Sunrise&propertyType=singleFamily&pageSize=1")).body)[0];
  test.skip(!subject, "no Sunrise single-family subject right now");
  const r = await timed("comparables", `/dashboard/api/listings/${encodeURIComponent(subject.id)}/comparables`);
  expect(r.status).toBe(200);
  const comps = (r.body.items as Item[]) ?? (r.body.comparables as Item[]) ?? [];
  console.log(`[mls] comparables returned=${comps.length}`);
  expect(comps.every((c) => c.status === "closed" && c.propertyType === "singleFamily")).toBe(true);
  expect(comps.every((c) => !JSON.stringify(c).includes("InternetAddressDisplayYN"))).toBe(true);
});

// --- Rendered application ------------------------------------------------------
async function noHorizontalOverflow(p: Page) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test("rendered: Listings — MLS search and FortMark listings, detail, deep link, Home, ⌘K", async () => {
  test.setTimeout(600_000);
  const bridgeCalls: string[] = [];
  const imageHosts = new Set<string>();
  const scripts: string[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.hostname.includes("bridgedataoutput")) bridgeCalls.push(u.hostname);
    if (req.resourceType() === "image") imageHosts.add(u.hostname);
  });
  page.on("response", async (res) => {
    if (res.request().resourceType() === "script" && res.ok()) {
      try { scripts.push(await res.text()); } catch { /* ignore */ }
    }
  });

  // MLS search (default: active).
  await page.goto("/dashboard/listings", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const main = page.getByRole("main");
  await expect(main).toContainText(/\d[\d,]* listings/, { timeout: 60_000 });
  const mlsCountText = (await main.innerText()).match(/([\d,]+) listings/)?.[1] ?? "";
  await expect(page.getByRole("link", { name: /^Open listing / }).first()).toBeVisible();
  const firstImg = page.locator('a[aria-label^="Open listing "] img').first();
  await expect(firstImg).toBeVisible();
  await expect.poll(() => firstImg.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 30_000 }).toBe(true);

  // FortMark listings.
  await page.getByRole("radio", { name: "FortMark listings" }).or(page.getByRole("button", { name: "FortMark listings" })).first().click();
  await expect(page).toHaveURL(/office=fortmark/);
  await expect.poll(async () => (await main.innerText()).match(/([\d,]+) listings?/)?.[1] ?? "", { timeout: 60_000 }).not.toBe(mlsCountText);
  const fmCount = Number(((await main.innerText()).match(/([\d,]+) listings?/)?.[1] ?? "0").replace(/,/g, ""));
  console.log(`[mls] rendered: mls=${mlsCountText} fortmark=${fmCount}`);
  expect(fmCount).toBeGreaterThan(0);
  expect(fmCount).toBeLessThan(100);
  // Back to MLS: no stale FortMark rows.
  await page.getByRole("radio", { name: "MLS search" }).or(page.getByRole("button", { name: "MLS search" })).first().click();
  await expect(page).not.toHaveURL(/office=fortmark/);
  await expect.poll(async () => (await main.innerText()).match(/([\d,]+) listings/)?.[1] ?? "", { timeout: 60_000 }).toBe(mlsCountText);

  // Detail from a card.
  await page.getByRole("link", { name: /^Open listing / }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/listings\/[A-Za-z0-9]+/);
  await expect(main).toContainText(/Listing courtesy of /, { timeout: 60_000 });
  await expect(main).toContainText(/MLS/);
  const gallery = page.locator("main img").first();
  await expect.poll(() => gallery.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
  const detailUrl = page.url();
  const detailMls = (await main.innerText()).match(/MLS\s*([A-Z]\d{6,})/)?.[1];

  // Deep link reload + back/forward.
  await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
  await expect(main).toContainText(/Listing courtesy of /, { timeout: 60_000 });
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL(detailUrl);

  // Responsive: listings + detail.
  for (const width of [390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
    await expect(main).toContainText(/Listing courtesy of /, { timeout: 60_000 });
    expect(await noHorizontalOverflow(page), `detail overflow at ${width}`).toBe(true);
    await page.goto("/dashboard/listings", { waitUntil: "domcontentloaded" });
    await expect(main).toContainText(/\d[\d,]* listings/, { timeout: 60_000 });
    expect(await noHorizontalOverflow(page), `listings overflow at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Home: FortMark listing card.
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(main).toContainText(/FortMark listings/, { timeout: 60_000 });
  await expect(main).toContainText(new RegExp(`${fmCount}\\s+active listing`));
  await expect(main).not.toContainText(/MLS not connected|once the MLS feed is connected/i);

  // ⌘K: MLS number → listing → detail.
  if (detailMls) {
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search people, deals, addresses…");
    await expect(input).toBeVisible();
    await input.fill(detailMls);
    const option = page.getByRole("option").filter({ hasText: `MLS ${detailMls}` }).first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await option.click();
    await expect(page).toHaveURL(/\/dashboard\/listings\//);
  }

  // Network and bundle.
  console.log(`[mls] browser→bridge requests=${bridgeCalls.length} image hosts=${[...imageHosts].join(",")}`);
  expect(bridgeCalls.length).toBe(0);
  const leaked = scripts.filter((s) => /bridgedataoutput|BRIDGE_API_TOKEN/.test(s)).length;
  console.log(`[mls] scripts scanned=${scripts.length} containing bridge host or token name=${leaked}`);
  expect(leaked).toBe(0);
});
