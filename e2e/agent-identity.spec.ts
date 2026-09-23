/**
 * Core V1 agent MLS identity — live certification on Preview.
 *
 * Licence → MLS Member → FortMark office → My Listings, through the real
 * session and the dashboard's own routes (no direct MLS call from here).
 *
 *   AGENT_PHASE=agent  the certification user as `agent`
 *   AGENT_PHASE=admin  the certification user as `admin`
 *
 * MLS_TEST_LICENSE is a real FortMark member's licence, supplied on the
 * command line only. It is typed with the `SL` prefix, as agents do; the
 * roster stores it without one. It is never printed or written anywhere.
 * Role changes happen in the Preview database between runs.
 */
import { expect, test, type Page } from "@playwright/test";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

type Json = Record<string, unknown>;
const PHASE = process.env.AGENT_PHASE ?? "";
const LICENSE = (process.env.MLS_TEST_LICENSE ?? "").trim();
const TYPED = LICENSE && /^\d+$/.test(LICENSE) ? `SL${LICENSE}` : LICENSE;

let page: Page;
async function call(path: string, init?: RequestInit) {
  return apiFor(await freshToken(page))(path, init);
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const setLicence = (licenseNumber: string | null, licenseState: string | null = "FL") =>
  call("/dashboard/api/profile", json("PATCH", { licenseNumber, licenseState }));
const identity = async () => (await call("/dashboard/api/profile/mls")).body.identity as Json;

async function openSettings(tab: string, expectText: RegExp) {
  for (let load = 0; load < 3; load += 1) {
    await page.goto(`/dashboard/settings?tab=${tab}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(page.getByRole("main")).toContainText(expectText, { timeout: 25_000 });
      return;
    } catch (error) {
      if (load === 2) throw error;
    }
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  expect(["agent", "admin"], "AGENT_PHASE must be set").toContain(PHASE);
  expect(TYPED.length, "MLS_TEST_LICENSE must be supplied").toBeGreaterThan(3);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInCertificationUser(page);
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    if ((await page.locator("main").first().innerText().catch(() => "")).trim().length > 40) break;
  }
  // Finish onboarding through the real route so Home is reachable.
  await call("/dashboard/api/profile/onboarding", json("POST", { complete: true, values: {} }));
});

test.afterAll(async () => {
  await page?.close();
});

test("role on Settings › Profile is the application role", async () => {
  await openSettings("profile", /Account email/);
  const expected = PHASE === "admin" ? "Admin" : "Agent";
  const badge = page.getByRole("main").locator("text=Role").locator("..").getByText(expected, { exact: true });
  await expect(badge).toBeVisible();
  await expect(page.getByRole("main").getByText("Member", { exact: true })).toHaveCount(0);
});

test("licence → MLS member → FortMark: linked, stored, no raw roster data", async () => {
  const saved = await setLicence(TYPED, "FL");
  expect(saved.status).toBe(200);
  // `null` = the licence did not change, so nothing was re-resolved (by design);
  // the stored identity below is the assertion that matters.
  expect([null, "linked"]).toContain(saved.body.mlsState);
  const id = await identity();
  expect(id.state).toBe("linked");
  expect(id.linked).toBe(true);
  expect(id.officeName).toBe("FortMark, LLC");
  const raw = JSON.stringify(id);
  expect(raw).not.toMatch(/MemberKey|memberKey|MemberStateLicense|Email|Phone/);
  if (PHASE === "admin") expect(typeof id.memberMlsId).toBe("string");
  else expect(id).not.toHaveProperty("memberMlsId");
});

test("My Listings: primary and co-listings, sanitised product rows", async () => {
  const mine = await call("/dashboard/api/listings?office=mine&status=active&pageSize=48");
  expect(mine.status).toBe(200);
  const items = mine.body.items as Json[];
  expect(Number(mine.body.total)).toBeGreaterThan(0);
  expect(items.every((l) => l.agentRole === "primary" || l.agentRole === "co_listing")).toBe(true);
  const roles = new Set(items.map((l) => l.agentRole));
  console.log(`[identity] my active listings=${mine.body.total} primary=${items.filter((l) => l.agentRole === "primary").length} co=${items.filter((l) => l.agentRole === "co_listing").length}`);
  expect(roles.has("primary")).toBe(true);
  expect(roles.has("co_listing")).toBe(true);
  expect(items.every((l) => l.isFortmark === true)).toBe(true);
  expect(JSON.stringify(items)).not.toMatch(/ListAgentKey|CoListAgentKey|MemberKey/);

  // Company scope is separate and contains the agent's book here.
  const firm = await call("/dashboard/api/listings?office=fortmark&status=active&pageSize=48");
  const firmIds = new Set((firm.body.items as Json[]).map((l) => l.id));
  expect(items.every((l) => firmIds.has(l.id))).toBe(true);
  expect(Number(firm.body.total)).toBeGreaterThanOrEqual(Number(mine.body.total));
  // General search is unaffected.
  const general = await call("/dashboard/api/listings?city=Fort%20Lauderdale&status=active&pageSize=12");
  expect(Number(general.body.total)).toBeGreaterThan(100);
});

test("Home and the Listings default follow the role", async () => {
  const featured = await call("/dashboard/api/listings/featured");
  const source = await call("/dashboard/api/listings/source");
  if (PHASE === "agent") {
    expect(featured.body.scope).toBe("mine");
    expect(featured.body.identity).toBe("linked");
    const mine = await call("/dashboard/api/listings?office=mine&status=active");
    expect(featured.body.activeCount).toBe(Number(mine.body.total));
    expect(source.body.defaultScope).toBe("mine");
  } else {
    expect(featured.body.scope).toBe("fortmark");
    expect(Number(featured.body.activeCount)).toBeGreaterThan(0);
    expect(source.body.defaultScope).toBe("fortmark");
  }
});

test("rendered: Profile shows the connection; Listings opens on the right scope", async () => {
  await openSettings("profile", /Connected · FortMark, LLC/);
  await expect(page.getByRole("main")).toContainText("Professional licence (self-reported)");
  await expect(page.getByRole("main").getByLabel(/MLS agent id/i)).toHaveCount(0);
  await page.goto("/dashboard/listings", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const scopeName = PHASE === "agent" ? "My listings" : "FortMark listings";
  await expect(page.getByRole("radio", { name: scopeName })).toHaveAttribute("aria-checked", "true", { timeout: 60_000 });
  if (PHASE === "agent") {
    await expect(page.getByRole("main")).toContainText(/You · (Co-listing agent|Listing agent)/, { timeout: 60_000 });
  }
});

test("licence change invalidates the link; another state is not this MLS", async () => {
  try {
    const wrong = await setLicence("SL0000001", "FL");
    expect(wrong.status).toBe(200);
    expect(wrong.body.mlsState).toBe("not_found");
    const mine = await call("/dashboard/api/listings?office=mine");
    expect(mine.status).toBe(409);
    expect(mine.body.error).toBe("mls_identity_not_linked");
    const id = await identity();
    expect(id.linked).toBe(false);
    expect(JSON.stringify(id)).not.toMatch(/invalid/i);

    const otherState = await setLicence(TYPED, "GA");
    expect(otherState.body.mlsState).toBe("not_found");

    const cleared = await setLicence(null, null);
    expect(cleared.status).toBe(200);
    expect((await identity()).state).toBe("no_license");
  } finally {
    const back = await setLicence(TYPED, "FL");
    expect(back.body.mlsState).toBe("linked");
  }
});

test.describe("admin only", () => {
  test.skip(PHASE !== "admin", "phase");

  test("brokerage MLS section is system-managed and synced", async () => {
    const r = await call("/dashboard/api/brokerage");
    expect(r.status).toBe(200);
    const identity = r.body.identity as Json;
    expect(identity.mlsOfficeId).toBe("FTMK01");
    expect(identity.mlsOfficeName).toBe("FortMark, LLC");
    expect(typeof identity.mlsSyncedAt).toBe("string");
    expect(identity).not.toHaveProperty("mlsOfficeKey");
    const put = await call(
      "/dashboard/api/brokerage",
      json("PUT", { displayName: identity.displayName, licenseState: "FL", mlsOfficeId: "ZZZZ99" })
    );
    expect(put.status).toBe(400);
    const sync = await call("/dashboard/api/brokerage/sync", { method: "POST" });
    expect(sync.status).toBe(200);
    expect(sync.body.sync).toBe("synced");
    await openSettings("brokerage", /synced from MLS/i);
    await expect(page.getByRole("main").getByLabel(/MLS office id/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Edit brokerage" }).click();
    await expect(page.getByRole("main").getByLabel(/MLS office id/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("a second account with the same licence is held as conflict, never linked", async () => {
    const other = process.env.CONFLICT_USER_ID ?? "";
    test.skip(!other, "CONFLICT_USER_ID not supplied");
    const r = await call("/dashboard/api/profile/mls", json("POST", { userId: other }));
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("conflict");
    // The certification user keeps its own link.
    expect((await identity()).state).toBe("linked");
    const missing = await call("/dashboard/api/profile/mls", json("POST", { userId: "00000000-0000-4000-8000-000000000000" }));
    expect(missing.status).toBe(404);
  });

  test("Team shows the admin as Admin with MLS status", async () => {
    await openSettings("team", /Licence details are self-reported/);
    await expect(page.getByRole("main").getByText("Admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Connected");
  });
});

test.describe("agent only", () => {
  test.skip(PHASE !== "agent", "phase");

  test("an agent cannot refresh someone else's identity or edit the brokerage", async () => {
    const other = await call("/dashboard/api/profile/mls", json("POST", { userId: "00000000-0000-4000-8000-000000000000" }));
    expect(other.status).toBe(403);
    const sync = await call("/dashboard/api/brokerage/sync", { method: "POST" });
    expect(sync.status).toBe(403);
    const r = await call("/dashboard/api/brokerage");
    expect(r.body.canEdit).toBe(false);
  });
});
