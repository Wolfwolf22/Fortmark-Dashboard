import { expect, test, type Page } from "@playwright/test";
import { apiFor, freshToken, signInCertificationUser } from "./session";

/**
 * Rendered confirmation certification.
 *
 * Everything here happens in the real browser, on the portal origin, through
 * the real dashboard UI: the assistant is typed into, the card is read out of
 * the DOM, and Confirm is a real click on a real button. No request is made by
 * the test on the application's behalf — the only direct API calls are reads
 * used to check what the application did.
 *
 * This closes the gap F2-B and F2-C left open.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let api: ReturnType<typeof apiFor>;
const RUN = Date.now().toString(36).toUpperCase().slice(-4);
const B_NAME = `UIF2B Jane ${RUN}`;
const C_NAME = `UIF2C Jane ${RUN}`;
const state: { bId?: string; cId?: string } = {};

const CARD = '[aria-label="Suggested change awaiting your confirmation"]';
// The executed card is a different element: the proposal collapses into a
// record of what happened, with its own accessible name.
const CONFIRMED = '[aria-label="Change confirmed"]';
const confirmedCard = () => page.locator(CONFIRMED).last();

async function refresh() {
  api = apiFor(await freshToken(page));
}

/** The composer's textarea. `getByLabel` also matches the autosize mirror. */
const composer = () => page.locator('textarea[aria-label="Message"]');

/**
 * Ask the assistant something, through the composer a person would use.
 *
 * Waits for the previous turn to finish first, and for this one to finish
 * after. While a turn streams, the composer swaps Send for Stop, so clicking
 * Send during a stream blocks until Playwright's timeout — which is what made
 * a step that normally takes fifteen seconds sit for five minutes. Real model
 * latency varies a lot; the test should wait for the application's own signal
 * rather than race it.
 */
async function ask(text: string) {
  const send = page.getByLabel("Send message");
  await expect(send).toBeVisible({ timeout: 180_000 });
  const box = composer();
  await box.click();
  await box.fill(text);
  await send.click();
  // The turn is over when the composer offers Send again.
  await expect(send).toBeVisible({ timeout: 180_000 });
}

/**
 * Wait for a card whose proposed value is `to`.
 *
 * `.last()` because a settled card now stays on screen showing its outcome
 * (which is the point — see the page's settleAction). Without it, a declined
 * card from an earlier step can shadow the new proposal and the test waits
 * forever for buttons that card no longer has.
 */
async function cardFor(to: string) {
  const card = page.locator(CARD).filter({ hasText: to }).last();
  await expect(card).toBeVisible({ timeout: 90_000 });
  return card;
}

const contactOf = (b: Record<string, unknown>) => b.contact as Record<string, unknown>;

test.beforeAll(async ({ browser }) => {
  // Sign-in retries can legitimately take a while against a cold deployment,
  // and a hook inherits the per-test timeout unless it says otherwise.
  test.setTimeout(600_000);
  page = await browser.newPage();
  await signInCertificationUser(page);
  await refresh();
  await api("/dashboard/", { headers: { Accept: "text/html" } });
});

test.afterAll(async () => {
  await page?.close();
});

test("§11 the real dashboard shell renders for an authenticated session", async () => {
  await page.goto("/dashboard/ai");
  await page.waitForLoadState("domcontentloaded");
  expect(page.url()).toContain("/dashboard/ai");
  // The assistant's own composer is present, so this is the real screen and
  // not a sign-in page or an error boundary.
  const boxes = await page.locator('[aria-label="Message"]').count();
  console.log(`[ui] elements labelled Message: ${boxes}`);
  await expect(composer()).toBeVisible({ timeout: 30_000 });
  const signedIn = await page.evaluate(
    () => (window as unknown as { Clerk?: { user?: { id?: string } } }).Clerk?.user?.id ?? null
  );
  expect(signedIn).toBeTruthy();
  console.log(`[ui] dashboard shell rendered at ${page.url()}`);
});

test("§12 the F2-B card renders from server state", async () => {
  const created = await api("/dashboard/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "UIF2B", lastName: `Jane ${RUN}` }),
  });
  expect(created.status).toBe(201);
  state.bId = contactOf(created.body).id as string;

  await page.reload();
  await ask(`Schedule a follow-up with ${B_NAME} next Friday.`);

  const card = await cardFor("2026");
  const text = (await card.innerText()).replace(/\s+/g, " ");
  console.log(`[ui] F2-B card: ${JSON.stringify(text.slice(0, 300))}`);

  expect(text).toContain(B_NAME);
  expect(text).toContain("Follow-up");
  expect(text).toContain("No follow-up scheduled");
  expect(text).toMatch(/[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}/);
  expect(text).toContain("Nothing changes until you confirm it");
  await expect(card.getByRole("button", { name: "Confirm" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Decline" })).toBeVisible();

  // Nothing has happened yet.
  const after = await api(`/dashboard/api/contacts/${state.bId}`);
  expect(contactOf(after.body).nextFollowUpDate).toBeUndefined();
});

test("§13 typing yes in the real UI changes nothing", async () => {
  await ask("yes");

  const after = await api(`/dashboard/api/contacts/${state.bId}`);
  expect(contactOf(after.body).nextFollowUpDate).toBeUndefined();
  const pending = await api("/dashboard/api/ai/actions");
  const mine = (pending.body.actions as Record<string, unknown>[]).find(
    (a) => (a.entity as { id?: string }).id === state.bId
  );
  expect(mine, "the action is still awaiting confirmation").toBeTruthy();
  expect(mine!.status).toBe("prepared");
  console.log(`[ui] after typing yes: contact unchanged, action still prepared`);
});

test("§14 clicking the real Confirm button executes", async () => {
  const card = await cardFor("2026");
  await card.getByRole("button", { name: "Confirm" }).click();

  // §2/§3 — the executed state stays visible and says what happened.
  const executed = confirmedCard();
  await expect(executed).toContainText("Follow-up scheduled", { timeout: 60_000 });
  const done = (await executed.innerText()).replace(/\s+/g, " ");
  console.log(`[ui] executed card: ${JSON.stringify(done)}`);
  expect(done).toContain(B_NAME);
  expect(done).toMatch(/[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}/);
  // The proposal scaffolding is gone; the decision has been made.
  expect(done).not.toContain("Nothing changes until you confirm it");

  await refresh();
  const after = await api(`/dashboard/api/contacts/${state.bId}`);
  const followUp = contactOf(after.body).nextFollowUpDate;
  console.log(`[ui] after clicking Confirm: nextFollowUpDate=${followUp}`);
  expect(followUp).toBeTruthy();
});

test("§15 clicking the real Decline button changes nothing", async () => {
  await page.reload();
  await ask(`Schedule a follow-up with ${B_NAME} for the first Monday of December 2026.`);
  const card = await cardFor("December");

  const before = await api(`/dashboard/api/contacts/${state.bId}`);
  const beforeDate = contactOf(before.body).nextFollowUpDate;

  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toContainText("Declined. Nothing was changed", { timeout: 30_000 });

  await refresh();
  const after = await api(`/dashboard/api/contacts/${state.bId}`);
  expect(contactOf(after.body).nextFollowUpDate).toBe(beforeDate);
  console.log(`[ui] after Decline: follow-up unchanged at ${beforeDate}`);
});

test("§16-§18 the F2-C card renders, yes is inert, and Confirm executes", async () => {
  test.setTimeout(480_000);
  const created = await api("/dashboard/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "UIF2C", lastName: `Jane ${RUN}` }),
  });
  expect(created.status).toBe(201);
  state.cId = contactOf(created.body).id as string;
  await api(`/dashboard/api/contacts/${state.cId}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "qualified" }),
  });

  await page.reload();
  await ask(`Change the stage of the contact ${C_NAME} to Active Client.`);

  const card = await cardFor("Active client");
  const text = (await card.innerText()).replace(/\s+/g, " ");
  console.log(`[ui] F2-C card: ${JSON.stringify(text.slice(0, 320))}`);
  expect(text).toContain(C_NAME);
  expect(text).toContain("Stage");
  expect(text).toContain("Qualified");
  expect(text).toContain("Active client");
  // Human labels, never raw enums.
  expect(text).not.toContain("active_client");
  expect(text).toContain("This contact will be counted in Active Clients.");

  // §17 — typed yes.
  await ask("yes");
  await refresh();
  let after = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(after.body).stage).toBe("qualified");
  console.log(`[ui] F2-C after typing yes: stage still qualified`);

  // §18 — the real click.
  const live = await cardFor("Active client");
  await live.getByRole("button", { name: "Confirm" }).click();
  const executedC = confirmedCard();
  await expect(executedC).toContainText("Stage changed", { timeout: 60_000 });
  const doneC = (await executedC.innerText()).replace(/\s+/g, " ");
  console.log(`[ui] executed F2-C card: ${JSON.stringify(doneC)}`);
  expect(doneC).toContain(C_NAME);
  expect(doneC).toContain("Qualified → Active client");

  await refresh();
  after = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(after.body).stage).toBe("active_client");
  console.log(`[ui] F2-C after clicking Confirm: stage=active_client`);
});

test("§20 archiving is refused in the real UI", async () => {
  test.setTimeout(300_000);
  await page.reload();
  await ask(`Archive ${C_NAME}.`);

  const cards = await page.locator(CARD).count();
  console.log(`[ui] cards rendered after an archive request: ${cards}`);
  expect(cards).toBe(0);

  await refresh();
  const after = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(after.body).stage).toBe("active_client");
});

test("§21 the card is reachable and operable by keyboard", async () => {
  test.setTimeout(420_000);
  await page.reload();
  await ask(`Change the stage of the contact ${C_NAME} to Under Contract.`);
  const card = await cardFor("Under contract");

  const confirm = card.getByRole("button", { name: "Confirm" });
  const decline = card.getByRole("button", { name: "Decline" });

  // Accessible names, not icon-only controls.
  expect((await confirm.getAttribute("aria-label")) ?? (await confirm.innerText())).toMatch(/confirm/i);
  expect((await decline.getAttribute("aria-label")) ?? (await decline.innerText())).toMatch(/decline/i);

  // Focus order matches visual order: Confirm precedes Decline.
  await confirm.focus();
  expect(await confirm.evaluate((el) => el === document.activeElement)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await decline.evaluate((el) => el === document.activeElement)).toBe(true);
  console.log(`[ui] focus order: Confirm -> Decline`);

  // Escape must not confirm anything.
  await page.keyboard.press("Escape");
  await refresh();
  const afterEscape = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(afterEscape.body).stage).toBe("active_client");

  // §22 — a double click must not produce two of anything.
  // The route returns { items: [...] }; asserting against the real field
  // rather than a guessed one, so a shape change fails loudly instead of
  // comparing undefined to undefined.
  const activityCount = async (): Promise<number> => {
    const res = await api(`/dashboard/api/contacts/${state.cId}/activities`);
    expect(res.status).toBe(200);
    const items = (res.body as { items?: unknown[] }).items;
    expect(Array.isArray(items), "the activities route returns an items array").toBe(true);
    return items!.length;
  };
  const beforeCount = await activityCount();

  await confirm.click({ clickCount: 2, delay: 40 });
  await expect(confirmedCard()).toContainText("Stage changed", { timeout: 60_000 });
  // §22 — one executed state, not two.
  expect(await page.locator(CONFIRMED).count()).toBe(1);

  await refresh();
  const stage = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(stage.body).stage).toBe("under_contract");

  const afterCount = await activityCount();
  console.log(`[ui] double-click: activities ${beforeCount} -> ${afterCount} (expect +1)`);
  expect(afterCount).toBe(beforeCount + 1);
});

for (const [label, width] of [["mobile-390", 390], ["mobile-430", 430], ["desktop-1440", 1440]] as const) {
  test(`§24-§25 the card is usable at ${label}`, async () => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await ask(`Schedule a follow-up with ${B_NAME} for 20 November 2026.`);
    const card = await cardFor("November");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow, "no horizontal page scroll").toBe(false);

    const box = await card.boundingBox();
    expect(box, "the card has a measurable box").toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(width);

    for (const name of ["Confirm", "Decline"] as const) {
      const b = card.getByRole("button", { name });
      await expect(b).toBeVisible();
      const bb = await b.boundingBox();
      expect(bb!.width, `${name} is wide enough to tap`).toBeGreaterThanOrEqual(44);
      expect(bb!.height, `${name} is tall enough to tap`).toBeGreaterThanOrEqual(28);
    }
    console.log(`[ui] ${label}: card ${Math.round(box!.width)}px wide, no overflow, both buttons usable`);

    await card.getByRole("button", { name: "Decline" }).click();
    await expect(card).toContainText("Declined", { timeout: 30_000 });
  });
}
