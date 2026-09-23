/**
 * Core V1 brokerage identity — live certification on Preview.
 *
 * Runs as the synthetic certification user through the real portal session.
 * Role is not something this runner can choose: it is set in the Preview
 * database between runs, and each run states which phase it certifies.
 *
 *   BROKERAGE_PHASE=empty-readonly  role member, no identity row
 *   BROKERAGE_PHASE=editor          role admin or broker; configures the
 *                                   Preview identity through the UI, runs the
 *                                   validation, injection and office-id matrix,
 *                                   and leaves the seed exactly as specified
 *   BROKERAGE_PHASE=readonly        role agent, member or transaction
 *                                   coordinator, identity present (plus a
 *                                   foreign-brokerage row inserted by SQL)
 *
 * The seed is the only record this spec leaves behind: display name
 * "FortMark, LLC", licence state FL, MLS office id FTMK01, everything else
 * null. Nothing is invented.
 */
import { expect, test, type Page } from "@playwright/test";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

type Json = Record<string, unknown>;
type Identity = Json & {
  displayName: string;
  licenseNumber: string | null;
  licenseState: string | null;
  addressLine1: string | null;
  city: string | null;
  officePhone: string | null;
  website: string | null;
  mlsOfficeId: string | null;
};

const PHASE = process.env.BROKERAGE_PHASE ?? "";
const SEED = {
  displayName: "FortMark, LLC",
  licenseNumber: null,
  licenseState: "FL",
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  officePhone: null,
  website: null,
  mlsOfficeId: "FTMK01",
};
const FOREIGN_NAME = "SYSVERIFY Foreign Brokerage";

let page: Page;
let api: ReturnType<typeof apiFor>;

async function call(path: string, init?: RequestInit) {
  api = apiFor(await freshToken(page));
  return api(path, init);
}
const put = (body: unknown) =>
  call("/dashboard/api/brokerage", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function openBrokerage(expectText: RegExp) {
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard/settings?tab=brokerage", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(page.getByRole("main")).toContainText(expectText, { timeout: 25_000 });
      return;
    } catch (error) {
      if (load === 2) throw error;
      console.log(`[brokerage] settings did not hydrate on load ${load + 1}`);
    }
  }
}

async function openHomeCard() {
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(page.getByRole("main")).toContainText(/FortMark listings/i, { timeout: 30_000 });
      return;
    } catch (error) {
      if (load === 2) throw error;
    }
  }
}

const noHorizontalOverflow = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  expect(["empty-readonly", "editor", "readonly"], "BROKERAGE_PHASE must be set").toContain(PHASE);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInCertificationUser(page);
  // Home runs the profile sync that creates the dashboard identity.
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    if ((await page.locator("main").first().innerText().catch(() => "")).trim().length > 40) break;
  }
  api = apiFor(await freshToken(page));
});

test.afterAll(async () => {
  await page?.close();
});

// --- Every phase: the API contract ------------------------------------------------

test("GET answers the caller's own brokerage, privately, with no ids", async () => {
  const r = await call("/dashboard/api/brokerage");
  expect(r.status).toBe(200);
  const keys = Object.keys(r.body).sort().join(",");
  expect(keys).toBe("canEdit,identity,mlsOffice");
  const identity = r.body.identity as Identity | null;
  if (identity) {
    expect(identity).not.toHaveProperty("id");
    expect(identity).not.toHaveProperty("brokerageKey");
    expect(identity).not.toHaveProperty("createdByUserId");
    expect(identity).not.toHaveProperty("updatedByUserId");
    expect(identity.displayName).not.toBe(FOREIGN_NAME);
  }
  console.log(`[brokerage] phase=${PHASE} canEdit=${r.body.canEdit} configured=${identity !== null}`);
  expect(r.body.canEdit).toBe(PHASE === "editor");
});

test("a brokerage key, role or id in the body is refused", async () => {
  for (const extra of [{ brokerageKey: "sysverify-foreign" }, { role: "admin" }, { id: "00000000-0000-0000-0000-000000000000" }]) {
    const r = await put({ ...SEED, ...extra });
    // A non-editor is refused before the body is even read for shape.
    expect(r.status, JSON.stringify(extra)).toBe(PHASE === "editor" ? 400 : 403);
  }
});

test("general MLS search does not depend on brokerage identity", async () => {
  const r = await call("/dashboard/api/listings?city=Fort%20Lauderdale&status=active&pageSize=12");
  expect(r.status).toBe(200);
  expect(Number(r.body.total)).toBeGreaterThan(100);
});

// --- empty-readonly --------------------------------------------------------------------

test.describe("empty, read-only", () => {
  test.skip(PHASE !== "empty-readonly", "phase");

  test("no record, and a non-editor may not create one", async () => {
    const r = await call("/dashboard/api/brokerage");
    expect(r.body.identity).toBeNull();
    const w = await put(SEED);
    expect(w.status).toBe(403);
    expect((await call("/dashboard/api/brokerage")).body.identity).toBeNull();
  });

  test("FortMark listings say not configured rather than query another office", async () => {
    const scoped = await call("/dashboard/api/listings?office=fortmark");
    expect(scoped.status).toBe(409);
    expect(scoped.body.error).toBe("fortmark_office_not_configured");
    const featured = await call("/dashboard/api/listings/featured");
    expect(featured.status).toBe(200);
    expect(featured.body.office).toBe("not_configured");
    expect(featured.body.listing).toBeNull();
    expect(featured.body.fortmarkActiveCount).toBeNull();
    await openHomeCard();
    await expect(page.getByRole("main")).toContainText("FortMark's MLS office is not configured.");
  });

  test("Settings says the information is not available, with no controls", async () => {
    await openBrokerage(/Brokerage information is not available\./);
    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: /configure brokerage|edit brokerage/i })).toHaveCount(0);
    await expect(main.locator("input, select")).toHaveCount(0);
  });
});

// --- editor ----------------------------------------------------------------------------

test.describe("editor", () => {
  test.skip(PHASE !== "editor", "phase");

  test("configure through the UI when empty, or confirm the seed", async () => {
    const before = await call("/dashboard/api/brokerage");
    if (before.body.identity === null) {
      await openBrokerage(/Brokerage profile has not been configured\./);
      const configure = page.getByRole("button", { name: "Configure brokerage" });
      await configure.click();
      // Opening the editor focuses its first field.
      await expect(page.getByLabel("Brokerage name")).toBeFocused();
      await page.getByLabel("Brokerage name").fill(SEED.displayName);
      await page.getByLabel("Licence state").selectOption("FL");
      await page.getByLabel("MLS office id").fill("FTMK01");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status")).toContainText("Brokerage details saved.");
      // Focus returns to the control that now opens the editor.
      await expect(page.getByRole("button", { name: "Edit brokerage" })).toBeFocused();
      console.log("[brokerage] configured through the UI");
    }
    const r = await call("/dashboard/api/brokerage");
    const identity = r.body.identity as Identity;
    for (const [key, value] of Object.entries(SEED)) {
      expect(identity[key], key).toBe(value);
    }
  });

  test("the record persists across a refresh and shows its sources honestly", async () => {
    await openBrokerage(/Brokerage licence \(operator-provided\)/);
    const main = page.getByRole("main");
    await expect(main).toContainText("FortMark, LLC");
    await expect(main).toContainText("FTMK01");
    await expect(main).not.toContainText(/\b(verified|in good standing|expired)\b/i);
    const r = await call("/dashboard/api/brokerage");
    const mls = r.body.mlsOffice as { name: string | null; phone: string | null } | null;
    if (mls?.phone) {
      // No stored phone: the MLS's is shown, labelled, and never saved.
      await expect(main).toContainText("From the MLS");
      expect((r.body.identity as Identity).officePhone).toBeNull();
    }
    console.log(`[brokerage] MLS supplement name=${Boolean(mls?.name)} phone=${Boolean(mls?.phone)}`);
  });

  test("validation refuses bad values field by field", async () => {
    const cases: Array<[Json, string]> = [
      [{ website: "javascript:alert(1)" }, "website"],
      [{ website: "data:text/html,x" }, "website"],
      [{ licenseNumber: "CQ<b>" }, "licenseNumber"],
      [{ licenseState: "ZZ" }, "licenseState"],
      [{ postalCode: "3330" }, "postalCode"],
      [{ officePhone: "123" }, "officePhone"],
      [{ mlsOfficeId: "FTMK01' or 1 eq 1" }, "mlsOfficeId"],
      [{ displayName: "" }, "displayName"],
    ];
    for (const [change, field] of cases) {
      const r = await put({ ...SEED, ...change });
      expect(r.status, field).toBe(400);
      expect(Object.keys(r.body.fieldErrors as Json), field).toContain(field);
    }
    // Nothing above was stored.
    const after = (await call("/dashboard/api/brokerage")).body.identity as Identity;
    expect(after.website).toBeNull();
    expect(after.mlsOfficeId).toBe("FTMK01");
  });

  test("the UI shows a field error accessibly and Cancel restores focus", async () => {
    await openBrokerage(/Brokerage licence \(operator-provided\)/);
    await page.getByRole("button", { name: "Edit brokerage" }).click();
    const website = page.getByLabel("Website");
    await website.fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(website).toHaveAttribute("aria-invalid", "true");
    await expect(website).toBeFocused();
    const describedBy = (await website.getAttribute("aria-describedby")) ?? "";
    expect(describedBy).toContain("brokerage-website-error");
    await expect(page.locator("#brokerage-website-error")).toContainText("http:// or https://");
    for (const label of ["Brokerage name", "Brokerage licence number", "Licence state", "Address line 1", "City", "State", "ZIP", "Office phone", "MLS office id"]) {
      await expect(page.getByLabel(label, { exact: true }), label).toHaveCount(1);
    }
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await noHorizontalOverflow(page), `editor overflow at ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Edit brokerage" })).toBeFocused();
    const r = await call("/dashboard/api/brokerage");
    expect((r.body.identity as Identity).website).toBeNull();
  });

  test("a wrong office id finds no FortMark listings; general search is unaffected", async () => {
    try {
      expect((await put({ ...SEED, mlsOfficeId: "ZZZZ99" })).status).toBe(200);
      const scoped = await call("/dashboard/api/listings?office=fortmark");
      expect(scoped.status).toBe(200);
      expect(Number(scoped.body.total)).toBe(0);
      const featured = await call("/dashboard/api/listings/featured");
      expect(featured.body.office).toBe("configured");
      expect(featured.body.fortmarkActiveCount).toBe(0);
      expect(featured.body.listing).toBeNull();
      const general = await call("/dashboard/api/listings?city=Fort%20Lauderdale&status=active&pageSize=12");
      expect(Number(general.body.total)).toBeGreaterThan(100);
      expect((general.body.items as Json[]).every((l) => l.isFortmark === false)).toBe(true);
    } finally {
      expect((await put(SEED)).status).toBe(200);
    }
  });

  test("a missing office id is 'not configured', never another office", async () => {
    try {
      expect((await put({ ...SEED, mlsOfficeId: null })).status).toBe(200);
      const scoped = await call("/dashboard/api/listings?office=fortmark");
      expect(scoped.status).toBe(409);
      expect(scoped.body.error).toBe("fortmark_office_not_configured");
      const featured = await call("/dashboard/api/listings/featured");
      expect(featured.body.office).toBe("not_configured");
      await openHomeCard();
      await expect(page.getByRole("main")).toContainText("FortMark's MLS office is not configured.");
      const general = await call("/dashboard/api/listings?city=Fort%20Lauderdale&status=active&pageSize=12");
      expect(Number(general.body.total)).toBeGreaterThan(100);
    } finally {
      expect((await put(SEED)).status).toBe(200);
    }
  });

  test("with FTMK01 restored, FortMark's own listings are back", async () => {
    const scoped = await call("/dashboard/api/listings?office=fortmark&status=active");
    expect(scoped.status).toBe(200);
    const total = Number(scoped.body.total);
    expect(total).toBeGreaterThan(0);
    expect((scoped.body.items as Json[]).every((l) => l.isFortmark === true)).toBe(true);
    const featured = await call("/dashboard/api/listings/featured");
    expect(featured.body.office).toBe("configured");
    expect(featured.body.fortmarkActiveCount).toBe(total);
    console.log(`[brokerage] FortMark active listings with FTMK01: ${total}`);
    const identity = (await call("/dashboard/api/brokerage")).body.identity as Identity;
    for (const [key, value] of Object.entries(SEED)) expect(identity[key], key).toBe(value);
  });

  test("the read view fits at 390, 430 and 1440", async () => {
    await openBrokerage(/Brokerage licence \(operator-provided\)/);
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: "Edit brokerage" })).toBeVisible();
      expect(await noHorizontalOverflow(page), `view overflow at ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});

// --- readonly --------------------------------------------------------------------------

test.describe("read-only with a record", () => {
  test.skip(PHASE !== "readonly", "phase");

  test("reads its own brokerage, never the foreign one, and cannot write", async () => {
    const r = await call("/dashboard/api/brokerage");
    const identity = r.body.identity as Identity;
    expect(identity.displayName).toBe(SEED.displayName);
    expect(identity.mlsOfficeId).toBe("FTMK01");
    const w = await put({ ...SEED, website: "https://example.org" });
    expect(w.status).toBe(403);
    const after = (await call("/dashboard/api/brokerage")).body.identity as Identity;
    expect(after.website).toBeNull();
  });

  test("Settings is a plain read view with no edit controls", async () => {
    await openBrokerage(/Brokerage licence \(operator-provided\)/);
    const main = page.getByRole("main");
    await expect(main).toContainText("FortMark, LLC");
    await expect(main).not.toContainText(FOREIGN_NAME);
    await expect(main.getByRole("button", { name: /edit brokerage|configure brokerage|save/i })).toHaveCount(0);
    await expect(main.locator("input, select")).toHaveCount(0);
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await noHorizontalOverflow(page), `read-only overflow at ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("FortMark listings use the configured office for every role", async () => {
    const scoped = await call("/dashboard/api/listings?office=fortmark&status=active");
    expect(scoped.status).toBe(200);
    expect(Number(scoped.body.total)).toBeGreaterThan(0);
  });
});
