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
/** Proposals still offering a decision. A settled card keeps no buttons. */
const liveProposals = () =>
  page.locator(CARD).filter({ has: page.getByRole("button", { name: "Confirm" }) });

async function refresh() {
  api = apiFor(await freshToken(page));
}

/**
 * How many activities a contact has.
 *
 * The route returns `{ items: [...] }`; asserting against the real field
 * rather than a guessed one, so a shape change fails loudly instead of
 * comparing undefined to undefined.
 */
async function activityCount(contactId: string): Promise<number> {
  const res = await api(`/dashboard/api/contacts/${contactId}/activities`);
  expect(res.status).toBe(200);
  const items = (res.body as { items?: unknown[] }).items;
  expect(Array.isArray(items), "the activities route returns an items array").toBe(true);
  return items!.length;
}

/**
 * Everything the executed state has to be, in one place.
 *
 * This card is the only thing telling the person their change went through,
 * so "it did not disappear" is not the bar. It has to still name what
 * happened and to whom, no longer offer a decision that has already been
 * made, exist exactly once, and announce itself exactly once.
 */
async function assertExecutedRecord(heading: string, mustContain: (string | RegExp)[]) {
  const executed = confirmedCard();
  await expect(executed).toContainText(heading, { timeout: 60_000 });
  const text = (await executed.innerText()).replace(/\s+/g, " ");
  for (const needle of mustContain) {
    if (needle instanceof RegExp) expect(text).toMatch(needle);
    else expect(text).toContain(needle);
  }
  // Not a bare acknowledgement: the record carries the result, and the
  // proposal scaffolding that described an undecided change is gone.
  expect(text).not.toContain("Confirmed and saved");
  expect(text).not.toContain("Nothing changes until you confirm it");
  // Exactly one executed record, not two.
  await expect(page.locator(CONFIRMED)).toHaveCount(1);
  // No proposal card falsely remains active.
  await expect(liveProposals()).toHaveCount(0);
  // The buttons are gone, not merely disabled — there is nothing left to press.
  expect(await executed.getByRole("button").count()).toBe(0);
  // One accessible status with a name a screen reader can read out.
  expect(await executed.getAttribute("role")).toBe("status");
  expect(await executed.getAttribute("aria-label")).toBe("Change confirmed");
  // ...and only one, so the outcome is not announced twice.
  const nested = await executed.evaluate(
    (el) => el.querySelectorAll('[role="status"],[role="alert"],[aria-live]').length
  );
  expect(nested, "the executed record is one live region, not two").toBe(0);
  return text;
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
  const beforeCount = await activityCount(state.bId!);
  const card = await cardFor("2026");
  await card.getByRole("button", { name: "Confirm" }).click();

  // §2 — the executed state stays visible and says what happened: the action
  // that was taken, who it was taken on, and the value it ended at.
  const done = await assertExecutedRecord("Follow-up scheduled", [
    B_NAME,
    /[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}/,
  ]);
  console.log(`[ui] executed F2-B card: ${JSON.stringify(done)}`);

  await refresh();
  const after = await api(`/dashboard/api/contacts/${state.bId}`);
  const followUp = contactOf(after.body).nextFollowUpDate;
  console.log(`[ui] after clicking Confirm: nextFollowUpDate=${followUp}`);
  expect(followUp).toBeTruthy();

  // §2 — one confirm, one execution. Not one card and two writes.
  const afterCount = await activityCount(state.bId!);
  console.log(`[ui] F2-B activities ${beforeCount} -> ${afterCount} (expect +1)`);
  expect(afterCount).toBe(beforeCount + 1);
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
  const beforeCount = await activityCount(state.cId!);
  await live.getByRole("button", { name: "Confirm" }).click();
  // §3 — the executed record names the action, the contact, and the stage it
  // ended at, with the stage it came from so the move is legible.
  const doneC = await assertExecutedRecord("Stage changed", [
    C_NAME,
    "Qualified → Active client",
  ]);
  console.log(`[ui] executed F2-C card: ${JSON.stringify(doneC)}`);

  await refresh();
  after = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(after.body).stage).toBe("active_client");
  const afterCount = await activityCount(state.cId!);
  console.log(
    `[ui] F2-C after clicking Confirm: stage=active_client, activities ${beforeCount} -> ${afterCount}`
  );
  expect(afterCount).toBe(beforeCount + 1);
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
  const beforeCount = await activityCount(state.cId!);

  await confirm.click({ clickCount: 2, delay: 40 });
  // §4 — it settles into exactly one executed record. A card that vanished
  // would satisfy "not two" and is explicitly not what is being asserted:
  // assertExecutedRecord requires the record to be there and to be singular.
  await assertExecutedRecord("Stage changed", [C_NAME, "Active client → Under contract"]);

  await refresh();
  const stage = await api(`/dashboard/api/contacts/${state.cId}`);
  expect(contactOf(stage.body).stage).toBe("under_contract");

  const afterCount = await activityCount(state.cId!);
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

/**
 * §26 — the record that replaced the proposal has to survive a narrow screen.
 *
 * Measured on one real executed record at three widths rather than by
 * executing three times: the same DOM is re-laid-out, so a difference is the
 * layout's and not the run's.
 */
test("§26 the executed record stays readable at every width", async () => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await ask(`Schedule a follow-up with ${B_NAME} for 3 March 2027.`);
  const card = await cardFor("2027");
  await card.getByRole("button", { name: "Confirm" }).click();
  const record = await assertExecutedRecord("Follow-up scheduled", [B_NAME, "2027"]);
  console.log(`[ui] executed record under measurement: ${JSON.stringify(record)}`);

  for (const [label, width] of [
    ["mobile-390", 390],
    ["mobile-430", 430],
    ["desktop-1440", 1440],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    const executed = confirmedCard();
    await expect(executed).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow, `no horizontal page scroll at ${label}`).toBe(false);

    const box = await executed.boundingBox();
    expect(box, "the executed record has a measurable box").toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(width);

    // Fitting the viewport is not enough: the authoritative result must not be
    // clipped inside the card's own box either.
    const clipped = await executed.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `the executed record is not clipped at ${label}`).toBe(false);

    const still = (await executed.innerText()).replace(/\s+/g, " ");
    expect(still).toContain("Follow-up scheduled");
    expect(still).toContain(B_NAME);
    expect(still).toContain("2027");
    console.log(
      `[ui] executed record at ${label}: ${Math.round(box!.width)}px wide, no overflow, result intact`
    );
  }
});

/**
 * §27 — where focus goes when the button someone pressed stops existing.
 *
 * Confirm is replaced by the record of what it did. If nothing catches focus
 * it falls back to the document, which for a keyboard or screen-reader user
 * means the confirmation they just triggered is never announced and their
 * place on the page is lost.
 */
test("§27 focus survives the confirmation", async () => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await ask(`Schedule a follow-up with ${B_NAME} for 8 April 2027.`);
  const card = await cardFor("2027");
  const confirm = card.getByRole("button", { name: "Confirm" });
  await confirm.focus();
  expect(await confirm.evaluate((el) => el === document.activeElement)).toBe(true);

  await confirm.click();
  await expect(confirmedCard()).toContainText("Follow-up scheduled", { timeout: 60_000 });

  const landed = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName ?? "none",
      inRecord: Boolean(el?.closest('[aria-label="Change confirmed"]')),
    };
  });
  console.log(`[ui] focus after Confirm: ${JSON.stringify(landed)}`);
  expect(landed.inRecord, "focus follows the record that replaced the button").toBe(true);
});
