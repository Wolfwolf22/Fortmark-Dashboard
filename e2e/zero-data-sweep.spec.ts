import { expect, test, type Page } from "@playwright/test";
import { apiFor, freshToken, signInCertificationUser } from "./session";

/**
 * ISS-07 closure: every route, on an account with no records at all.
 *
 * This is the test certification failed. On a brand-new account the product
 * showed a projected GCI of $309.6K, a 97.2% list-to-sale ratio, 146
 * documents of which 109 "executed", two unread messages from named people,
 * and a week of appointments. None of it was labelled and none of it was
 * true.
 *
 * So the assertion here is not "the page loads". It is that no route states
 * a brokerage fact it cannot support: no money, no people, no files, no
 * events, no counts — unless the deployment has been switched into the
 * labelled fixture mode by name, which Preview has not.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let api: ReturnType<typeof apiFor>;

const ROUTES = [
  "/dashboard/",
  "/dashboard/ai",
  "/dashboard/leads",
  "/dashboard/transactions",
  "/dashboard/listings",
  "/dashboard/calendar",
  "/dashboard/documents",
  "/dashboard/messages",
  "/dashboard/reports",
  "/dashboard/settings",
];

/**
 * A number with a currency sign is the clearest fabricated fact there is, and
 * the one certification actually caught. `$0` is included: an unavailable
 * subsystem is not zero.
 */
const MONEY = /\$\s?[\d,]+(?:\.\d+)?\s?[KMB]?/g;

/** Phrases the generator produced, each a claim about a person or a file. */
const FABRICATIONS = [
  "Sarah Kaplan",
  "Mike Torres",
  "Shoreline Lending",
  "Broker preview",
  "4-point inspection",
  "Appraisal walkthrough",
  "Pending signature",
  "Lead-based paint",
  "LIST-TO-SALE",
  "MEDIAN DAYS ON MARKET",
  "PROJECTED GCI",
];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  page = await browser.newPage();
  await signInCertificationUser(page);
  // A real sign-in lands on Home, and Home is where the dashboard creates the
  // user's own row from their Clerk identity. Do the same before asking any
  // API about "my" records, so a freshly reset Preview database starts from
  // the state a person would actually be in.
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    if ((await page.locator("main").first().innerText().catch(() => "")).trim().length > 40) break;
  }
  api = apiFor(await freshToken(page));
});

test("the account really is empty", async () => {
  const contacts = await api("/dashboard/api/contacts");
  const transactions = await api("/dashboard/api/transactions");
  expect(contacts.status).toBe(200);
  expect(transactions.status).toBe(200);
  const contactCount = ((contacts.body.contacts ?? contacts.body.items ?? []) as unknown[]).length;
  const txnCount = ((transactions.body.transactions ?? transactions.body.items ?? []) as unknown[]).length;
  console.log(`[zero] contacts=${contactCount} transactions=${txnCount}`);
  expect(contactCount).toBe(0);
  expect(txnCount).toBe(0);
});

test("the deployment is not in fixture mode", async () => {
  const res = await api("/dashboard/api/subsystems");
  expect(res.status).toBe(200);
  const map = res.body.subsystems as Record<string, string>;
  console.log(`[zero] subsystems=${JSON.stringify(map)}`);
  // Every one of them, not merely most: this is the switch the whole
  // invariant hangs on.
  for (const [name, state] of Object.entries(map)) {
    expect(state, `${name} must not be serving sample data here`).toBe("not_configured");
  }
});

test("no route states a brokerage fact it cannot support", async () => {
  test.setTimeout(420_000);
  const findings: string[] = [];
  // With the MLS live, two figures are real facts rather than brokerage
  // claims: FortMark's featured listing price on Home, and MLS list prices on
  // the Listings screen (certified against the feed by mls-live.spec.ts).
  // The featured price is taken from the API, not assumed.
  const featured = await api("/dashboard/api/listings/featured");
  const featuredPrice =
    featured.status === 200 ? String((featured.body.listing as { listPrice?: number } | null)?.listPrice ?? "") : "";
  const digits = (a: string) => a.replace(/\D/g, "");
  for (const route of ROUTES) {
    let text = "";
    // The refused-chunk mitigation can leave a page unhydrated; read it
    // again rather than record an empty page as a clean one.
    for (let load = 0; load < 3; load += 1) {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(2_500);
      text = (await page.locator("main").first().innerText().catch(() => "")).replace(/\s+/g, " ");
      if (text.length > 40) break;
    }
    const amounts = (text.match(MONEY) ?? []).map((a) => a.trim());
    const invented = FABRICATIONS.filter((phrase) => text.includes(phrase));
    console.log(`[zero] ${route}: money=${JSON.stringify(amounts)} invented=${JSON.stringify(invented)} :: ${text.slice(0, 150)}`);
    // Home is the one route whose money comes from a real source: the
    // metrics service reads the actual contact and transaction tables, and
    // on an empty account the honest answer to "pipeline value" is $0. That
    // is a queried zero, not a manufactured one — the difference the whole
    // remediation turns on — and the next test proves the source. Any other
    // figure, there or anywhere else, would be invented.
    const permitted =
      route === "/dashboard/"
        ? amounts.filter((a) => a !== "$0" && !(featuredPrice && digits(a) === featuredPrice))
        : route === "/dashboard/listings"
          ? []
          : amounts;
    if (permitted.length) findings.push(`${route} shows money on an empty account: ${permitted.join(", ")}`);
    if (invented.length) findings.push(`${route} shows generated records: ${invented.join(", ")}`);
  }
  expect(findings, findings.join("\n")).toEqual([]);
});

test("the zero on Home was asked for, not assumed", async () => {
  // §5: a zero is permitted only when the source is real, was queried, and
  // genuinely returned nothing. Home is the only route showing a figure
  // here, so the claim behind it is checked rather than taken on trust.
  const res = await api("/dashboard/api/metrics");
  expect(res.status).toBe(200);
  const body = res.body as Record<string, Record<string, unknown> | string>;
  console.log(`[zero] metrics source=${body.source} transactions=${JSON.stringify(body.transactions)}`);
  expect(body.source, "the figures are the database's, not the sample set's").toBe("database");
  const transactions = body.transactions as { availability: string; data?: Record<string, number> };
  const contacts = body.contacts as { availability: string };
  expect(transactions.availability, "the transaction domain answered").toBe("available");
  expect(contacts.availability, "the contact domain answered").toBe("available");
  expect(transactions.data?.activeVolumeCents, "and its answer really is nothing").toBe(0);
});

test("each unbacked route says what is missing", async () => {
  test.setTimeout(300_000);
  const EXPECTED: [string, RegExp][] = [
    ["/dashboard/calendar", /Calendar is not connected/i],
    ["/dashboard/documents", /Document storage is not configured/i],
    ["/dashboard/messages", /Messaging is not connected/i],
    ["/dashboard/reports", /Reports are not available/i],
  ];
  for (const [route, sentence] of EXPECTED) {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("main")).toContainText(sentence, { timeout: 30_000 });
    console.log(`[zero] ${route} states its absence`);
  }
});

test("settings shows the real account and brokerage, never generated ones", async () => {
  test.setTimeout(300_000);
  // The real half stays: this is the signed-in identity, from Clerk.
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(page.getByRole("main")).toContainText("FortMark account", { timeout: 20_000 });
      break;
    } catch (error) {
      if (load === 2) throw error;
      console.log(`[zero] settings did not hydrate on load ${load + 1}`);
    }
  }
  for (const [tab, sentence] of [
    // Team is real now: the roster of actual dashboard users, never generated.
    ["team", /Licence details are self-reported by each member/i],
    // Brokerage is real now: the stored, operator-provided identity, or its
    // truthful empty state. Never the generated office.
    ["brokerage", /Brokerage licence \(operator-provided\)|Brokerage profile has not been configured|Brokerage information is not available/i],
    ["integrations", /Integrations are not configured/i],
  ] as const) {
    // Each section is client-rendered, so a refused script chunk leaves the
    // tab strip alone on the page. Load again rather than read an unhydrated
    // shell as an answer.
    for (let load = 0; load < 3; load += 1) {
      await page.goto(`/dashboard/settings?tab=${tab}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      try {
        await expect(page.getByRole("main")).toContainText(sentence, { timeout: 20_000 });
        break;
      } catch (error) {
        if (load === 2) throw error;
        console.log(`[zero] settings/${tab} did not hydrate on load ${load + 1}`);
      }
    }
    await expect(page.getByRole("main")).not.toContainText(/generated for development/i);
    console.log(`[zero] settings/${tab} is truthful`);
  }
});

test("the notification bell claims nothing", async () => {
  test.setTimeout(240_000);
  // The brief is the hydration signal: a click before it resolves reaches
  // static markup rather than a listener.
  const brief = () =>
    page.locator('section[aria-label="Daily brief"]').filter({ hasText: "Active transactions" });
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(brief()).toBeVisible({ timeout: 30_000 });
      break;
    } catch {
      console.log(`[zero] home did not hydrate on load ${load + 1}`);
    }
  }

  const bell = page.getByRole("button", { name: /^Notifications/ });
  await expect(bell).toBeVisible({ timeout: 30_000 });
  // "Notifications (3 unread)" on an account with no records was the finding:
  // a count the product could not justify, on the shell of every page.
  expect(await bell.getAttribute("aria-label")).toBe("Notifications");

  await bell.click();
  await expect(bell).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
  const panel = page.getByText(/Notifications are not connected/i);
  await expect(panel).toBeVisible({ timeout: 15_000 });
  console.log(`[zero] the panel states its absence`);
});
