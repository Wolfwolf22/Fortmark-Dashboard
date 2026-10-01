/**
 * Contacts V3 — Preview certification through the real signed-in UI.
 *
 *   CV3_ROLE = admin | agent | broker | transaction_coordinator | member
 *
 * Same synthetic fixture as `contacts-v3-api.spec.ts` (see its header), seeded
 * on the Preview branch and removed afterwards. What this proves that the API
 * spec cannot: that the screens do what the rules say — notes that are always
 * there, a timestamp people can read, a delete that asks first and puts focus
 * somewhere sensible, an activity list that collapses, a stage notice that
 * leaves the stage alone when cancelled, a "Create transaction" that opens the
 * existing dialog with the contact already chosen — at phone and desktop widths,
 * with every control named.
 *
 * Screenshots go to SHOTS_DIR, never into the repository. Platform flakes (a
 * dropped chunk, a Clerk that did not initialise) are reloaded once, COUNTED and
 * reported, never hidden.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { freshToken, refreshingApiFor, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const ROLE = process.env.CV3_ROLE ?? "";
const WRITER = ROLE !== "member";
const IS_ADMIN = ROLE === "admin";
// Transactions are brokerage-wide for these roles; Contacts are brokerage-wide for admin ONLY.
const BROKERAGE_DEALS = ["admin", "broker", "transaction_coordinator"].includes(ROLE);
const FIX = JSON.parse(process.env.CV3_FIX ?? "{}") as Record<string, string>;
const SHOTS = process.env.SHOTS_DIR ?? "test-results/contacts-v3-shots";
mkdirSync(SHOTS, { recursive: true });

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
let platformReloads = 0;
const uncaught: string[] = [];
const chunkErrors: string[] = [];
/** What the browser was told when an API call was not fine — the evidence a "never appeared" needs. */
const apiProblems: string[] = [];
const say = (line: string) => console.log(`[contacts-v3-ui ${ROLE}] ${line}`);

const dialogs = (p: Page) => p.getByRole("dialog");
const drawer = (p: Page) => p.locator('[role="dialog"]').filter({ has: p.getByTestId("lead-notes") });
const overflows = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
/** A count that has stopped changing — a list that refetches after a write is read only once it has settled. */
async function stableCount(loc: Locator): Promise<number> {
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const now = await loc.count();
    if (now === last) return now;
    last = now;
    await loc.page().waitForTimeout(400);
  }
  return last;
}
const STAMP_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{4} · \d{1,2}:\d{2} (AM|PM)$/;

async function settle(p: Page, load: () => Promise<unknown>, ready: Locator, what: string, timeout = 30_000) {
  for (let attempt = 1; ; attempt += 1) {
    const before = chunkErrors.length;
    const problemsBefore = apiProblems.length;
    await load();
    try {
      await expect(ready).toBeVisible({ timeout });
      return;
    } catch (error) {
      const platformPage = (await p.getByText(/Application error: a client-side exception|upstream request failed|We could not load this contact/).count()) > 0;
      const lost = chunkErrors.length > before;
      // A 5xx or a dropped request from the platform in front of the app while this page was loading:
      // reported with the request that failed, and reloaded once per occurrence — never silently.
      const upstream = apiProblems.slice(problemsBefore).filter((p) => /^(50[234]|failed)/.test(p));
      if ((!platformPage && !lost && upstream.length === 0) || attempt >= 4) throw new Error(`${String(error)}\n[api problems while loading ${what}: ${JSON.stringify(apiProblems.slice(problemsBefore)).slice(0, 400)}]`);
      platformReloads += 1;
      say(`platform ${lost ? "dropped a chunk" : upstream.length ? `answered ${upstream.join("; ")}` : "error page"} at ${what}; reloading (${platformReloads})`);
    }
  }
}
const gotoReady = (p: Page, path: string, ready: Locator, timeout = 30_000) =>
  settle(p, () => p.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 }), ready, path, timeout);
const openContact = async (p: Page, id: string) => {
  await gotoReady(p, `/dashboard/contacts?open=${id}`, p.getByTestId("lead-notes"), 45_000);
  await expect(dialogs(p).first().getByRole("heading").first()).toBeVisible();
};
const pickOption = async (p: Page, scope: Locator | Page, name: string | RegExp, option: string | RegExp) => {
  await scope.getByRole("combobox", { name }).click();
  await p.getByRole("option", { name: option }).first().click();
};
/** Click a button that opens a dialog — retrying a click that raced hydration, counted and said, never hidden. */
async function clickToOpen(p: Page, button: Locator, dialog: Locator, what: string) {
  for (let attempt = 1; ; attempt += 1) {
    await button.click();
    try {
      await expect(dialog.first()).toBeVisible({ timeout: 6_000 });
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
      platformReloads += 1;
      say(`${what} did not open on click ${attempt}; retrying (${platformReloads})`);
      await p.waitForTimeout(800);
    }
  }
}
/** Open the New menu and choose an item — retrying a click that raced the page still settling, and saying so. */
async function chooseFromNewMenu(p: Page, item: string) {
  for (let attempt = 1; ; attempt += 1) {
    await p.getByRole("button", { name: "New", exact: true }).click();
    try {
      await p.getByRole("menuitem", { name: item, exact: true }).click({ timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
      platformReloads += 1;
      say(`the New menu did not open on click ${attempt}; retrying (${platformReloads})`);
      await p.keyboard.press("Escape").catch(() => undefined);
      await p.waitForTimeout(800);
    }
  }
}
/** Every interactive control inside `root` has an accessible name — the one rule no screenshot shows. */
async function unnamedControls(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const bad: string[] = [];
    for (const c of Array.from(el.querySelectorAll<HTMLElement>("input:not([type=hidden]), textarea, select, button, [role=combobox], [role=checkbox], [role=radio]"))) {
      if (c.closest("[aria-hidden=true], [hidden]")) continue;
      const text = (c.getAttribute("aria-label") ?? "").trim() || (c.textContent ?? "").trim();
      const labelled = c.id && el.ownerDocument.querySelector(`label[for="${CSS.escape(c.id)}"]`);
      const wrapped = c.closest("label");
      const labelledby = c.getAttribute("aria-labelledby");
      if (!text && !labelled && !wrapped && !labelledby) bad.push(`${c.tagName.toLowerCase()}#${c.id || "?"}.${(c.className || "").toString().slice(0, 30)}`);
    }
    return bad;
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  expect(["admin", "agent", "broker", "transaction_coordinator", "member"], "CV3_ROLE must be a known role").toContain(ROLE);
  expect(FIX.rep1 && FIX.ownlead, "fixture ids").toBeTruthy();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => (/Loading chunk \d+ failed|ChunkLoadError|reading 'loaded'/.test(e.message) ? chunkErrors : uncaught).push(e.message.slice(0, 200)));
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/dashboard/api/") && r.status() >= 400 && r.status() !== 404 && r.status() !== 403) apiProblems.push(`${r.status()} ${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`);
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/dashboard/api/")) apiProblems.push(`failed ${r.method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")} ${r.failure()?.errorText}`);
  });
  await signInCertificationUser(page);
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await freshToken(page);
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      platformReloads += 1;
    }
  }
  api = refreshingApiFor(page);
});

test.afterAll(async () => {
  say(`platform reloads=${platformReloads} (dropped chunks seen=${chunkErrors.length}), product uncaught=${uncaught.length}`);
  if (apiProblems.length) say(`API problems the browser saw: ${JSON.stringify(apiProblems).slice(0, 800)}`);
  if (uncaught.length) say(`detail: ${JSON.stringify(uncaught).slice(0, 500)}`);
  await page?.close();
});

// ---------------------------------------------------------------------------------------------
test("Contacts, not Leads: the nav, the page, the views and the legacy address", async () => {
  await gotoReady(page, "/dashboard/leads?stage=representation", page.getByText(/^CV3 Ownrep One$/), 45_000);
  await expect(page, "the legacy address lands on /contacts with the query kept").toHaveURL(/\/dashboard\/contacts\?stage=representation/);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Leads", exact: true })).toHaveCount(0);
  await expect(page.getByText("Contacts", { exact: true }).first()).toBeVisible();
  if (WRITER) await expect(page.getByRole("button", { name: "New contact" })).toBeVisible();
  for (const [id, label] of [["all", /All contacts|My contacts/], ["mine", /My leads/], ["representation", /Representation/], ["active_clients", /Active clients/], ["due_today", /Due today/], ["overdue", /Overdue/], ["no_touch_14", /No touch 14\+/]] as const) {
    // "My leads" narrows a brokerage-wide list to the viewer's own; a personal book is already only theirs.
    if (id === "mine" && !IS_ADMIN) await expect(page.getByTestId("view-mine"), "a personal book needs no My leads view").toHaveCount(0);
    else await expect(page.getByTestId(`view-${id}`), id).toContainText(label);
  }
  await expect(page.getByTestId("view-unassigned")).toHaveCount(0);
  await expect(page.getByText(/^CV3 Ownrep One$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^CV3 Ownlead$/), "the stage=representation URL is applied").toHaveCount(0);
  // The two views are separate: Active clients is exactly that stage.
  await page.getByTestId("view-active_clients").click();
  await expect(page).toHaveURL(/stage=active_client(&|$)/);
  await expect(page.getByText(/^CV3 Ownactive$/)).toBeVisible();
  await expect(page.getByText(/^CV3 Ownrep One$/)).toHaveCount(0);
  await page.getByTestId("view-representation").click();
  await expect(page.getByText(/^CV3 Ownrep One$/)).toBeVisible();
  await expect(page.getByText(/^CV3 Ownactive$/)).toHaveCount(0);
  if (IS_ADMIN) await expect(page.getByText(/^CV3 Colleague Rep$/), "an admin's Representation view includes colleagues'").toBeVisible();
  else await expect(page.getByText(/^CV3 Colleague Rep$/)).toHaveCount(0);
  // Scope is by role, not by what the Transactions page allows: a personal-book role has no Owner filter
  // and never sees a colleague's contact, even a broker or coordinator whose DEALS are brokerage-wide.
  if (IS_ADMIN) await expect(page.getByRole("combobox", { name: "Filter by agent" })).toBeVisible();
  else {
    await expect(page.getByRole("combobox", { name: "Filter by agent" }), "no Owner filter outside admin").toHaveCount(0);
    await expect(page.getByText(/^CV3 Colleague (Rep|Lead)$/)).toHaveCount(0);
    await expect(page.getByText(/^CV3 Foreign$/)).toHaveCount(0);
  }
  await page.screenshot({ path: `${SHOTS}/${ROLE}-contacts-1440.png` });
});

test("the drawer: one calm hierarchy, nothing about reassignment, and an owner line only where it is true", async () => {
  await openContact(page, FIX.rep1);
  const d = drawer(page);
  const headings = await d.getByRole("heading", { level: 3 }).allInnerTexts();
  const order = ["Details", "Client needs", "Notes", "Activity", "Representation"].map((h) => headings.findIndex((x) => x.toLowerCase().startsWith(h.toLowerCase())));
  expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `section order: ${headings.join(" > ")}`).toBe(true);
  await expect(d.getByText(/reassign|assign to|assignee/i)).toHaveCount(0);
  await expect(d.getByRole("combobox", { name: /agent|owner/i })).toHaveCount(0);
  await expect(d.getByTestId("lead-owner"), "your own contact shows no owner line").toHaveCount(0);
  if (WRITER) {
    for (const name of ["Log touch", "Follow-up", "Change stage", "Edit contact"]) await expect(d.getByRole("button", { name, exact: true })).toBeVisible();
  } else {
    await expect(d.getByRole("button", { name: /Log touch|Follow-up|Change stage|Edit contact/ })).toHaveCount(0);
    await expect(d.getByRole("note")).toContainText("read-only access");
  }
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Representation");
  expect(await unnamedControls(d), "every control in the drawer is named").toEqual([]);
  if (IS_ADMIN) {
    await openContact(page, FIX.colRep);
    await expect(drawer(page).getByTestId("lead-owner")).toContainText(/^Owner:/);
    await expect(drawer(page).getByText(/reassign/i)).toHaveCount(0);
  } else {
    for (const [what, id] of [["a colleague's representation contact", FIX.colRep], ["a colleague's lead", FIX.colLead], ["a contact in another brokerage", FIX.foreign]] as const) {
      await page.goto(`/dashboard/contacts?open=${id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("This contact is no longer available."), `${what} is not openable by ${ROLE}`).toBeVisible({ timeout: 30_000 });
    }
  }
});

test("notes: always there, timestamped, plain text; delete asks first and keeps focus sensible", async () => {
  test.skip(!WRITER, "member path is below");
  await openContact(page, FIX.rep1);
  const d = drawer(page);
  const composer = d.getByLabel("Add a note");
  await expect(composer, "the composer is on the drawer — not behind Edit contact").toBeVisible();
  await expect(d.getByRole("button", { name: "Save note" })).toBeDisabled();
  const xss = '<img src=x onerror="window.__xss=1"> <b>bold?</b> & "q"';
  const unique = `run-${Date.now()}`;
  await composer.fill(`${xss} ${unique}`);
  await d.getByRole("button", { name: "Save note" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Note saved." })).toBeVisible();
  await expect(composer, "the composer is emptied after a save").toHaveValue("");
  // The NEW note — identified by this run's token, not by text an earlier run also wrote.
  const first = d.getByTestId("note").filter({ hasText: unique });
  await expect(first).toHaveCount(1);
  await expect(first.getByTestId("note-body")).toContainText('<img src=x onerror="window.__xss=1"> <b>bold?</b> & "q"');
  await expect(d.getByTestId("note").first(), "newest first").toContainText(unique);
  expect(await first.getByTestId("note-time").innerText(), "Eastern business time, readable").toMatch(STAMP_RE);
  expect((await first.getByTestId("note-author").innerText()).trim().length).toBeGreaterThan(0);
  await expect(first.locator("img, b, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss), "nothing in a note ran").toBeUndefined();
  // The legacy note is shown once, read-only, with no date.
  const legacy = d.getByTestId("legacy-note");
  await expect(legacy).toContainText("Legacy note");
  await expect(legacy).toContainText("Legacy words here");
  await expect(legacy.getByRole("textbox")).toHaveCount(0);
  await expect(legacy.locator("time")).toHaveCount(0);
  // Limit: a clear message, Save disabled.
  await composer.fill("x".repeat(10_001));
  await expect(d.getByRole("alert").filter({ hasText: "Notes can be up to 10,000 characters." })).toBeVisible();
  await expect(d.getByRole("button", { name: "Save note" })).toBeDisabled();
  await composer.fill("");
  // Delete: Cancel keeps it, focus returns to the button that opened the dialog.
  const before = await stableCount(d.getByTestId("note"));
  const del = first.getByRole("button", { name: /Delete note from/ });
  await del.click();
  const confirm = page.getByRole("dialog", { name: "Delete note?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("This will remove the note from the contact's record.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(d.getByTestId("note")).toHaveCount(before);
  await expect(del, "focus returns to the control that opened the dialog").toBeFocused();
  // Delete for real.
  await del.click();
  await page.getByRole("dialog", { name: "Delete note?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(d.getByRole("status").filter({ hasText: "Note deleted." })).toBeVisible();
  await expect(d.getByTestId("note")).toHaveCount(before - 1);
  await expect(composer, "after a delete, focus lands on the composer — the deleted note's button is gone").toBeFocused();
  say("notes: composer, timestamp, plain text, legacy note, limit, cancel/confirm delete, focus");
});

test("notes: a member reads their contact's notes and is offered nothing to change", async () => {
  test.skip(WRITER, "writers are above");
  await openContact(page, FIX.ownlead);
  const d = drawer(page);
  await expect(d.getByTestId("note").filter({ hasText: "Seeded note" })).toBeVisible();
  await expect(d.getByLabel("Add a note")).toHaveCount(0);
  await expect(d.getByRole("button", { name: /Delete note|Save note|Add client need|Add another|Set|Change|Clear/ })).toHaveCount(0);
  await expect(d.getByTestId("lead-birthday-value")).toBeVisible();
  await expect(d.getByRole("note")).toContainText("read-only access");
  await expect(d.getByText("No client needs added.").or(d.getByTestId("need-summary").first())).toBeVisible();
  expect(await unnamedControls(d)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/${ROLE}-drawer-readonly.png` });
});

test("activity: the latest five, an accessible disclosure, the rest on request", async () => {
  await openContact(page, FIX.ownlead);
  const d = drawer(page);
  const items = d.getByTestId("timeline-item");
  await expect(items.first()).toBeVisible({ timeout: 30_000 });
  await expect(items, "collapsed by default").toHaveCount(5);
  const toggle = d.getByRole("button", { name: "Show all activity" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-controls", "lead-activity-list");
  await expect(d.getByRole("heading", { name: /^Activity \(\d+\)$/ })).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(d.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  expect(await items.count(), "everything that was loaded").toBeGreaterThanOrEqual(7);
  await page.keyboard.press("Space");
  await expect(items, "collapses again with the keyboard").toHaveCount(5);
  await expect(d.getByRole("button", { name: "Show all activity" })).toHaveAttribute("aria-expanded", "false");
  // Another contact opens collapsed.
  await d.getByRole("button", { name: "Show all activity" }).click();
  await openContact(page, FIX.rep1);
  await expect(drawer(page).getByRole("button", { name: "Show fewer" })).toHaveCount(0);
});

test("birthday: Not set → March 17 → February 29 → Not set; no year, no age; impossible days cannot be picked", async () => {
  test.skip(!WRITER, "member is read-only");
  await openContact(page, FIX.rep2);
  const d = drawer(page);
  const value = d.getByTestId("lead-birthday-value");
  await expect(value).toHaveText("Not set");
  await d.getByRole("button", { name: "Set", exact: true }).click();
  await expect(d.getByRole("combobox", { name: "Day" }), "day is disabled until a month is chosen").toBeDisabled();
  await pickOption(page, d, "Month", "March");
  await pickOption(page, d, "Day", /^17$/);
  await d.getByRole("button", { name: "Save birthday" }).click();
  await expect(value).toHaveText("March 17");
  await expect(d.getByRole("status").filter({ hasText: "Birthday saved." })).toBeVisible();
  // Change to February: 30 and 31 are not offered, 29 is.
  await d.getByRole("button", { name: "Change", exact: true }).click();
  await pickOption(page, d, "Month", "February");
  await d.getByRole("combobox", { name: "Day" }).click();
  const days = await page.getByRole("option").allInnerTexts();
  expect(days.length, "February has 29 selectable days, no year").toBe(29);
  expect(days).not.toContain("30");
  await page.getByRole("option", { name: /^29$/ }).click();
  await d.getByRole("button", { name: "Save birthday" }).click();
  await expect(value).toHaveText("February 29");
  await expect(d.getByText(/\b(19|20)\d{2}\b.*birth|age\s+\d|years old/i)).toHaveCount(0);
  await d.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(value).toHaveText("Not set");
  await expect(value).not.toHaveText(/unknown/i);
  say("birthday: set, change, Feb 29, clear");
});

test("client needs: a small form, progressive disclosure, several at once, pause, no delete", async () => {
  test.skip(!WRITER, "member is read-only");
  await openContact(page, FIX.rep2);
  const d = drawer(page);
  await expect(d.getByText("No client needs added.")).toBeVisible();
  await d.getByRole("button", { name: "Add client need" }).click();
  const form = d.getByRole("form", { name: "Client need" });
  await expect(form.getByLabel("Need type")).toBeVisible();
  for (const hidden of ["Minimum square feet", "Financing", "Must-haves", "Avoid", "Additional requirements"]) await expect(form.getByLabel(hidden), `${hidden} is behind 'More requirements'`).toHaveCount(0);
  const more = form.getByRole("button", { name: /^(More|Fewer) requirements$/ });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // The error path first: a maximum below the minimum puts focus on the field.
  await form.getByLabel("Budget minimum ($)").fill("750000");
  await form.getByLabel("Budget maximum ($)").fill("600000");
  await form.getByRole("button", { name: "Save need" }).click();
  await expect(form.getByRole("alert")).toContainText("The maximum budget is below the minimum.");
  await expect(form.getByLabel("Budget maximum ($)"), "focus moves to the field to fix").toBeFocused();
  // Fill it in properly.
  await form.getByLabel("Budget minimum ($)").fill("600000");
  await form.getByLabel("Budget maximum ($)").fill("750000");
  await form.getByLabel("Areas", { exact: true }).fill("Fort Lauderdale");
  await page.keyboard.press("Enter");
  await form.getByLabel("Areas", { exact: true }).fill("Victoria Park");
  await form.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(form.getByRole("button", { name: "Remove Victoria Park" })).toBeVisible();
  await form.getByLabel("Single family").check();
  await form.getByLabel("Minimum beds").fill("3");
  await form.getByLabel("Minimum baths").fill("2.5");
  await form.getByLabel("Timeline note").fill("Move within 6 months");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await form.getByLabel("Minimum square feet").fill("1800");
  await pickOption(page, form, "Financing", "Conventional");
  await form.getByLabel("Must-haves").fill("Pool");
  await page.keyboard.press("Enter");
  await form.getByLabel("Avoid").fill("Busy street");
  await page.keyboard.press("Enter");
  await form.getByLabel("Additional requirements").fill("<b>Quiet</b> building");
  expect(await unnamedControls(form), "the form's controls are all named").toEqual([]);
  await page.screenshot({ path: `${SHOTS}/${ROLE}-needs-form-1440.png` });
  await form.getByRole("button", { name: "Save need" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Client need added." })).toBeVisible();
  const summary = d.getByTestId("need-summary").first();
  await expect(summary).toContainText("Buying");
  await expect(summary).toContainText("Fort Lauderdale · Victoria Park");
  await expect(summary).toContainText("$600K–$750K");
  await expect(summary).toContainText("3+ beds · 2.5+ baths · 1,800+ sq ft");
  await expect(summary).toContainText("Move within 6 months");
  await expect(summary, "only what is stored — no 'unknown', no empty labels").not.toContainText(/unknown|not set|null|undefined/i);
  await expect(summary.getByText("Quiet")).toHaveCount(0);
  // Several at once.
  await d.getByRole("button", { name: "Add another" }).click();
  await pickOption(page, d.getByRole("form", { name: "Client need" }), "Need type", "Selling");
  await d.getByRole("form", { name: "Client need" }).getByRole("button", { name: "Save need" }).click();
  await expect(d.getByTestId("need-summary")).toHaveCount(2);
  // Edit, then pause.
  await d.getByTestId("need-summary").first().locator("xpath=..").getByRole("button", { name: "Edit" }).click();
  await d.getByRole("form", { name: "Client need" }).getByLabel("Minimum beds").fill("4");
  await d.getByRole("form", { name: "Client need" }).getByRole("button", { name: "Save changes" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Client need updated." })).toBeVisible();
  await d.getByTestId("need-summary").first().locator("xpath=..").getByRole("button", { name: "Pause" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Client need paused." })).toBeVisible();
  const others = d.getByRole("button", { name: /^Other needs \(1\)$/ });
  await expect(others).toHaveAttribute("aria-expanded", "false");
  await others.click();
  await expect(d.getByTestId("lead-needs").getByText("Paused", { exact: true })).toBeVisible();
  await expect(d.getByTestId("lead-timeline").getByText("Client need paused").first(), "the timeline says so — in words, no values").toBeVisible();
  await expect(d.getByRole("button", { name: /delete/i }).filter({ hasText: /need/i })).toHaveCount(0);
  say("needs: error focus, disclosure, summary from stored values only, two at once, edit, pause");
});

test("the stage notice: Cancel changes nothing; Continue moves; an existing Representation contact is not asked", async () => {
  test.skip(!WRITER, "member is read-only");
  // An existing Representation record opens with no modal.
  await openContact(page, FIX.rep1);
  await expect(page.getByRole("dialog", { name: "Brokerage engagement" })).toHaveCount(0);
  // A lead moves into Representation.
  await openContact(page, FIX.ownlead);
  const d = drawer(page);
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Lead");
  await d.getByRole("button", { name: "Change stage" }).click();
  const choose = async (label: string | RegExp) => {
    await d.getByRole("combobox", { name: "Contact stage" }).click();
    await page.getByRole("option", { name: label, exact: typeof label === "string" }).click();
  };
  await choose("Representation");
  const notice = page.getByRole("dialog", { name: "Brokerage engagement" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("confirm that an active brokerage engagement is in place");
  await expect(notice).toContainText("An executed engagement should be attached to the contact record.");
  await expect(notice).toContainText("does not yet store or check engagement documents");
  await expect(notice).not.toContainText(/verified|has been attached|legally sufficient/i);
  await notice.getByRole("button", { name: "Cancel" }).click();
  await expect(notice).toHaveCount(0);
  await expect(d.getByTestId("lead-stage-badge"), "Cancel leaves the stage alone").toHaveText("Lead");
  expect(((await api(`/dashboard/api/contacts/${FIX.ownlead}`)) as unknown as { body: { contact: { stage: string } } }).body.contact.stage, "…on the server too").toBe("lead");
  await expect(d.getByRole("combobox", { name: "Contact stage" }), "focus returns to the control").toBeFocused();
  await choose("Representation");
  await page.getByRole("dialog", { name: "Brokerage engagement" }).getByRole("button", { name: "Continue" }).click();
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Representation");
  await expect(d.getByRole("button", { name: "Create transaction" }), "Representation offers the deal").toBeVisible();
  // Into Active client: the notice again.
  await choose("Active client");
  await expect(page.getByRole("dialog", { name: "Brokerage engagement" })).toBeVisible();
  await page.getByRole("dialog", { name: "Brokerage engagement" }).getByRole("button", { name: "Continue" }).click();
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Active client");
  await expect(d.getByRole("button", { name: "Create transaction" }), "Active client is not eligible for a new deal").toHaveCount(0);
  // A move that is not gated asks nothing.
  await choose("Contacted");
  await expect(page.getByRole("dialog", { name: "Brokerage engagement" })).toHaveCount(0);
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Contacted");
  await choose("Lead");
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Lead");
  say("stage notice: cancel, continue (representation, active client), ungated, existing record untouched");
});

test("Representation → Transaction: the CTA, the chosen contact, nothing pre-filled, and the linked deal", async () => {
  test.skip(!WRITER, "member cannot open a deal");
  await openContact(page, FIX.ownlead);
  await expect(drawer(page).getByRole("button", { name: "Create transaction" }), "a lead has no Create transaction").toHaveCount(0);
  await openContact(page, FIX.rep2);
  const d = drawer(page);
  await d.getByRole("button", { name: "Create transaction" }).click();
  const dlg = page.getByRole("dialog", { name: "New transaction" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("picked-contact"), "the contact is already chosen").toHaveText("CV3 Ownrep Two");
  await expect(dlg.getByRole("radiogroup"), "…so there is no list to pick from").toHaveCount(0);
  await expect(dlg.getByLabel("Property address")).toHaveValue("");
  await expect(dlg.getByLabel("Contract price")).toHaveValue("");
  await expect(dlg.getByLabel("Close date (optional)")).toHaveValue("");
  await expect(dlg.getByLabel("City")).toHaveValue("");
  await expect(dlg.getByText(/commission|MLS/i)).toHaveCount(0);
  await dlg.getByLabel("Property address").fill("CV3 UI Deal Street");
  await dlg.getByLabel("City").fill("Miami");
  await dlg.getByLabel("Contract price").fill("850000");
  await dlg.getByRole("button", { name: "Open file" }).click();
  await expect(page).toHaveURL(/\/dashboard\/transactions/, { timeout: 45_000 });
  await expect(page.getByText("CV3 UI Deal Street").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("CV3 Ownrep Two").first(), "the client shown on the deal is the contact").toBeVisible();
  // The contact's drawer now lists it.
  await openContact(page, FIX.rep2);
  const linked = drawer(page).getByTestId("lead-transactions");
  await expect(linked).toContainText("CV3 UI Deal Street");
  await linked.getByRole("link", { name: /CV3 UI Deal Street/ }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/transactions\?open=/, { timeout: 30_000 });
  say("create from contact: dialog preselected, nothing pre-filled, deal linked and listed in the drawer");
});

test("a new transaction's contact selector: Representation only, server-searched, scoped, free text still possible", async () => {
  test.skip(!WRITER, "member cannot open a deal");
  await gotoReady(page, "/dashboard/transactions", page.getByRole("combobox", { name: "Filter by side" }), 45_000);
  await chooseFromNewMenu(page, "Transaction");
  const dlg = page.getByRole("dialog", { name: "New transaction" });
  await expect(dlg).toBeVisible();
  const group = dlg.getByRole("radiogroup", { name: "Contacts at Representation" });
  await expect(group.getByText("CV3 Ownrep One")).toBeVisible();
  await expect(group.getByText("CV3 Ownrep Two")).toBeVisible();
  for (const never of ["CV3 Ownlead", "CV3 Ownactive", "CV3 Ownarchived", "CV3 Foreign"]) await expect(group.getByText(never), never).toHaveCount(0);
  if (IS_ADMIN) await expect(group.getByText("CV3 Colleague Rep"), "an admin sees the brokerage's Representation contacts").toBeVisible();
  else await expect(group.getByText("CV3 Colleague Rep")).toHaveCount(0);
  await dlg.getByLabel("Search contacts at Representation").fill("two");
  await expect(group.getByText("CV3 Ownrep Two")).toBeVisible();
  await expect(group.getByText("CV3 Ownrep One")).toHaveCount(0);
  await dlg.getByLabel("Search contacts at Representation").fill("%");
  await expect(group.getByText("No matching contact at Representation.")).toBeVisible();
  await dlg.getByLabel("Search contacts at Representation").fill("");
  await group.getByLabel("CV3 Ownrep One").check();
  await expect(dlg.getByLabel("Client name", { exact: true }), "a chosen contact needs no typed name").toHaveCount(0);
  await group.getByLabel("Not in Contacts — enter a client name").check();
  await expect(dlg.getByLabel("Client name", { exact: true })).toBeVisible();
  expect(await unnamedControls(dlg)).toEqual([]);
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New", exact: true }), "focus returns to the New button").toBeFocused();
});

test("the boundary: deals are brokerage-wide for this role, but the deal dialog never opens another agent's contact book", async () => {
  test.skip(!WRITER || !BROKERAGE_DEALS || IS_ADMIN, "only broker and coordinator sit on this boundary");
  await gotoReady(page, "/dashboard/transactions", page.getByRole("combobox", { name: "Filter by side" }), 45_000);
  await expect(page.getByText("CV3 Colleague Avenue").first(), "the colleague's deal is visible").toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("CV3 Legacy Street").first(), "the undated opportunity deal is visible").toBeVisible();
  await chooseFromNewMenu(page, "Transaction");
  const dlg = page.getByRole("dialog", { name: "New transaction" });
  await expect(dlg).toBeVisible();
  const group = dlg.getByRole("radiogroup", { name: "Contacts at Representation" });
  await expect(group.getByText("CV3 Ownrep One")).toBeVisible();
  await expect(group.getByText("CV3 Colleague Rep"), "another agent's private contact is not offered").toHaveCount(0);
  await dlg.getByLabel("Search contacts at Representation").fill("colleague");
  await expect(group.getByText("No matching contact at Representation."), "searching for it by name finds nothing").toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toHaveCount(0);
});

test("quick create a contact: name, email, phone, source, birthday — no intent — and it opens on the person", async () => {
  test.skip(!WRITER, "member cannot add contacts");
  await gotoReady(page, "/dashboard/contacts", page.getByTestId("view-all"), 45_000);
  const dlg = page.getByRole("dialog", { name: "New contact" });
  await clickToOpen(page, page.getByRole("button", { name: "New contact" }), dlg, "the New contact dialog");
  for (const label of ["Name", "Email", "Phone", "Source (optional)", "Birthday month (optional)", "Birthday day"]) await expect(dlg.getByLabel(label), label).toBeVisible();
  await expect(dlg.getByLabel("Intent")).toHaveCount(0);
  expect(await unnamedControls(dlg)).toEqual([]);
  // A half-picked birthday is caught before anything is sent.
  await dlg.getByLabel("Name").fill("CV3 Quick Person");
  await pickOption(page, dlg, "Birthday month (optional)", "March");
  await dlg.getByRole("button", { name: "Add contact" }).click();
  await expect(dlg.getByText("Pick a real birthday date (month and day), or leave both empty.")).toBeVisible();
  await pickOption(page, dlg, "Birthday day", /^17$/);
  await dlg.getByRole("button", { name: "Add contact" }).click();
  await expect(page).toHaveURL(/\/dashboard\/contacts\?open=/, { timeout: 45_000 });
  const d = drawer(page);
  await expect(d.getByRole("heading", { name: "CV3 Quick Person" })).toBeVisible({ timeout: 30_000 });
  await expect(d.getByTestId("lead-birthday-value")).toHaveText("March 17");
  await expect(d.getByText("No client needs added.")).toBeVisible();
  await expect(d.getByTestId("lead-stage-badge")).toHaveText("Lead");
});

test("Transactions: the list is not windowed by the hidden period; the legacy deal renders; scope is the role's", async () => {
  await gotoReady(page, "/dashboard/transactions", page.getByRole("combobox", { name: "Filter by side" }), 45_000);
  await expect(page.getByText("CV3 Legacy Street").first(), "an undated, contact-less deal still renders").toBeVisible({ timeout: 45_000 });
  if (BROKERAGE_DEALS) await expect(page.getByText("CV3 Colleague Avenue").first()).toBeVisible();
  else await expect(page.getByText("CV3 Colleague Avenue")).toHaveCount(0);
  await expect(page.getByText("No transactions found")).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
for (const [w, h] of [[390, 844], [430, 932], [1280, 800], [1440, 900]] as const) {
  test(`responsive ${w}x${h}: contacts, the drawer and every new control fit without sideways scrolling`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await gotoReady(page, "/dashboard/contacts", page.getByTestId("view-all"), 45_000);
    expect(await overflows(page), "contacts page").toBe(false);
    await openContact(page, FIX.rep1);
    const d = drawer(page);
    expect(await overflows(page), "page behind the drawer").toBe(false);
    const fits = async (what: string) =>
      expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${what} at ${w}px`).toBe(true);
    await fits("drawer");
    if (WRITER) {
      await d.getByLabel("Add a note").fill("x".repeat(200));
      await fits("drawer with a note in the composer");
      await d.getByLabel("Add a note").fill("");
      await d.getByRole("button", { name: /Add client need|Add another/ }).click();
      await d.getByRole("form", { name: "Client need" }).getByRole("button", { name: "More requirements" }).click();
      await fits("drawer with the needs form and its extra fields open");
      await page.screenshot({ path: `${SHOTS}/${ROLE}-needs-form-${w}.png` });
      await d.getByRole("form", { name: "Client need" }).getByRole("button", { name: "Cancel" }).click();
      await d.getByRole("button", { name: "Set", exact: true }).or(d.getByRole("button", { name: "Change", exact: true })).first().click();
      await fits("drawer with the birthday editor open");
      await d.getByRole("button", { name: "Cancel" }).first().click();
    }
    await page.screenshot({ path: `${SHOTS}/${ROLE}-drawer-${w}.png` });
    await page.keyboard.press("Escape");
    if (WRITER) {
      await openContact(page, FIX.rep2);
      await d.getByRole("button", { name: "Create transaction" }).click();
      const dlg = page.getByRole("dialog", { name: "New transaction" });
      await expect(dlg).toBeVisible();
      expect(await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `transaction dialog at ${w}px`).toBe(true);
      await page.screenshot({ path: `${SHOTS}/${ROLE}-txn-dialog-${w}.png` });
      await dlg.getByRole("button", { name: "Cancel" }).click();
      await page.keyboard.press("Escape");
    }
    expect(await overflows(page), "page after closing").toBe(false);
  });
}

test("reduced motion: the drawer still opens and closes", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openContact(page, FIX.rep1);
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
});
