/**
 * Follow-up workflow — Preview certification, through the real signed-in UI.
 *
 * What is being certified: a follow-up is a REMINDER, not an interaction.
 * Setting, changing or completing one directly must never move last contact or
 * write a touch; logging a touch does move last contact, and may change the
 * reminder in the same step. "Due" is judged on the US Eastern business day.
 *
 * Runs against synthetic rows an operator seeds on the Preview database
 * (never Production) and removes afterwards. Three phases, one per role,
 * because the certification user's role is switched between runs:
 *
 *   FU_PHASE=member  read-only: every write is refused and nothing changes
 *   FU_PHASE=agent   the whole workflow on the agent's own contacts
 *   FU_PHASE=broker  brokerage scope: sees and edits a colleague's contact
 *
 * Seed contract (all `last_name = FU_TAG`; `today` = the Eastern date;
 * `last_contact_at` 20 days ago so "No touch in 14 days" applies to all):
 *
 *   FU None          no follow-up                 FU Sched         no follow-up
 *   FU Today         due today                    FU Change        today + 10
 *   FU Overdue       today - 3                    FU Complete      today - 2
 *   FU Future        today + 10                   FU TouchKeep     due today
 *   FU Tomorrow      today + 1                    FU TouchChange   today + 5
 *   FU Lost          stage 'lost', due today      FU TouchComplete today - 1
 *   FU Marked        today + 8
 *   FU Colleague     another agent's, due today   (FU_OTHER_CONTACT)
 *   FU Foreign       another BROKERAGE's          (FU_FOREIGN_CONTACT)
 *
 * Every refusal is paired with the authorized call succeeding, and every
 * "unchanged" assertion with a step that changes the very same field, so a
 * pass cannot come from a harness that never writes.
 *
 * Screenshots go to SHOTS_DIR, never into the repository.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const PHASE = process.env.FU_PHASE ?? "agent";
const TAG = process.env.FU_TAG ?? "FUSYN";
const OTHER = process.env.FU_OTHER_CONTACT ?? "";
const FOREIGN = process.env.FU_FOREIGN_CONTACT ?? "";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/follow-up-shots";
mkdirSync(SHOTS, { recursive: true });

// --- Eastern-time helpers, written independently of the product's own ---------------------
const easternParts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(d).map((p) => [p.type, p.value])
  ) as Record<string, string>;
const nyDay = (d = new Date()) => { const p = easternParts(d); return `${p.year}-${p.month}-${p.day}`; };
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const noon = (day: string) => `${day}T12:00:00.000Z`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pretty = (day: string) => { const [y, m, d] = day.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
/** The instant it is `hh:mm` Eastern on `day`, whichever side of daylight saving. */
function easternInstant(day: string, hh: string, mm: string): Date {
  for (const offset of [4, 5]) {
    const t = new Date(Date.parse(`${day}T${hh}:${mm}:00Z`) + offset * 3_600_000);
    const p = easternParts(t);
    if (nyDay(t) === day && p.hour === hh && p.minute === mm) return t;
  }
  throw new Error(`no Eastern instant for ${day} ${hh}:${mm}`);
}

const TODAY = nyDay();
const name = (label: string) => `${label} ${TAG}`;

let page: Page;
let api: ReturnType<typeof apiFor>;
const ids = new Map<string, string>();

type Snap = { status: number; follow: string | undefined; last: string; acts: number };
async function snap(id: string): Promise<Snap> {
  const c = await api(`/dashboard/api/contacts/${id}`);
  const a = await api(`/dashboard/api/contacts/${id}/activities`);
  const lead = (c.body.contact ?? {}) as { nextFollowUpDate?: string; lastContactDate?: string };
  return { status: c.status, follow: lead.nextFollowUpDate, last: lead.lastContactDate ?? "", acts: Array.isArray(a.body.items) ? (a.body.items as unknown[]).length : -1 };
}
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const followUp = (id: string, body: unknown) => post(`/dashboard/api/contacts/${id}/follow-up`, body);
const touchApi = (id: string, body: Record<string, unknown>) =>
  post(`/dashboard/api/contacts/${id}/activities`, { kind: "call", summary: "Called", ...body });

async function attentionIds(): Promise<string[]> {
  const r = await api("/dashboard/api/metrics");
  expect(r.status).toBe(200);
  const group = r.body.attention as { availability: string; data?: { items: { id: string }[] } };
  expect(group.availability).toBe("available");
  return group.data!.items.map((i) => i.id);
}

const drawer = (p: Page) => p.getByRole("dialog");
const followRegion = (p: Page) => drawer(p).getByRole("region", { name: "Next follow-up" });
const touchForm = (p: Page) => drawer(p).getByRole("form", { name: "Log a touch" });

async function openDrawer(p: Page, id: string) {
  await expect(async () => {
    await p.goto(`/dashboard/leads?open=${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(p.getByTestId("lead-next-follow-up")).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 120_000 });
}
/** One row, found through the list's own search (the table pages at 12 rows). */
async function listRow(p: Page, label: string) {
  await p.getByPlaceholder("Search name, email, or neighborhood").fill(name(label));
  const row = p.getByRole("row", { name: new RegExp(name(label)) });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  return row;
}
const need = (label: string) => { const id = ids.get(name(label)); expect(id, `${label} is seeded`).toBeTruthy(); return id!; };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInCertificationUser(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
  api = apiFor(await freshToken(page));
  const list = await api("/dashboard/api/contacts");
  expect(list.status).toBe(200);
  for (const c of list.body.items as { id: string; name: string }[]) if (c.name.endsWith(TAG)) ids.set(c.name, c.id);
  console.log(`[fu] phase=${PHASE} today(Eastern)=${TODAY} visible synthetic contacts=${ids.size}`);
});

test.afterAll(async () => {
  await page?.close();
});

// =========================================================================================
// MEMBER — read-only
// =========================================================================================
test.describe("member: every write is refused, nothing changes", () => {
  test.skip(PHASE !== "member", "member phase only");

  test("reads work (control), writes are refused", async () => {
    const id = need("FU Today");
    const before = await snap(id);
    expect(before.status).toBe(200);
    expect(before.follow).toBe(noon(TODAY));

    const day = addDays(TODAY, 4);
    const s = await followUp(id, { action: "schedule", day });
    const c = await followUp(id, { action: "complete" });
    const t = await touchApi(id, { completeFollowUp: true });
    console.log(`[fu] member → schedule ${s.status}, complete ${c.status}, touch ${t.status}`);
    expect([s.status, c.status, t.status]).toEqual([403, 403, 403]);

    const other = await followUp(OTHER, { action: "complete" });
    const foreign = await followUp(FOREIGN, { action: "complete" });
    const nowhere = await followUp("00000000-0000-4000-8000-000000000000", { action: "complete" });
    console.log(`[fu] member → colleague ${other.status}, foreign ${foreign.status}, nonexistent ${nowhere.status}`);
    expect([other.status, foreign.status, nowhere.status]).toEqual([404, 404, 404]);
    // No existence leak: a real contact out of scope answers exactly like a missing one.
    expect(JSON.stringify(other.body)).toBe(JSON.stringify(nowhere.body));
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nowhere.body));

    expect(await snap(id)).toEqual(before);
  });

  test("UI: the drawer explains the refusal; the follow-up stays", async () => {
    const id = need("FU Today");
    await openDrawer(page, id);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Due today · ${pretty(TODAY)}`);
    await followRegion(page).getByRole("button", { name: "Change" }).click();
    await followRegion(page).locator("#lead-follow-up-day").fill(addDays(TODAY, 4));
    await followRegion(page).getByRole("button", { name: "Save follow-up" }).click();
    await expect(drawer(page).getByRole("alert")).toHaveText("You do not have permission to change this contact.");
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Due today · ${pretty(TODAY)}`);
    await page.screenshot({ path: `${SHOTS}/member-refused.png` });
  });
});

// =========================================================================================
// AGENT — the whole workflow
// =========================================================================================
test.describe("agent: classification is the same everywhere", () => {
  test.skip(PHASE !== "agent", "agent phase only");

  test("Leads column: none / due today / overdue / future / tomorrow", async () => {
    await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("columnheader", { name: /Follow-up/ })).toBeVisible({ timeout: 30_000 });
    const cell = async (label: string) => (await listRow(page, label)).getByTestId("lead-follow-up-cell");
    await expect(await cell("FU None")).toHaveText("—");
    await expect(await cell("FU Today")).toHaveText("Due today");
    await expect(await cell("FU Overdue")).toHaveText(`Overdue · ${pretty(addDays(TODAY, -3))}`);
    await expect(await cell("FU Future")).toHaveText(pretty(addDays(TODAY, 10)));
    await expect(await cell("FU Tomorrow")).toHaveText(pretty(addDays(TODAY, 1)));
    // The old unlabelled pill is gone; the heuristic says what it measures.
    await expect(page.getByText("Follow up", { exact: true })).toHaveCount(0);
    await expect((await listRow(page, "FU None")).getByText("No touch in 14 days")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/leads-list.png` });
  });

  test("Home Needs attention agrees: due and overdue in; future, tomorrow, none, lost out", async () => {
    const queue = await attentionIds();
    for (const label of ["FU Today", "FU Overdue", "FU Complete", "FU TouchKeep", "FU TouchComplete"]) expect(queue, label).toContain(`follow-up:${need(label)}`);
    for (const label of ["FU Future", "FU Tomorrow", "FU None", "FU Sched", "FU Change", "FU Marked", "FU TouchChange"]) expect(queue, label).not.toContain(`follow-up:${need(label)}`);
    // A lost contact keeps the existing rule: not chased. Control: the same due date on an open stage is.
    expect(queue).not.toContain(`follow-up:${need("FU Lost")}`);
    expect(queue).toContain(`follow-up:${need("FU Today")}`);

    await expect(async () => {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await expect(page.locator('section[aria-label="Daily brief"] dl')).toBeVisible({ timeout: 25_000 });
    }).toPass({ timeout: 120_000 });
    const card = page.getByRole("heading", { name: "Needs attention", level: 3, exact: true }).locator(`xpath=ancestor::*[.//a[contains(@href, "open=${need("FU Overdue")}")]][1]`);
    await expect(card.locator(`a[href*="open=${need("FU Overdue")}"]`).first()).toBeVisible({ timeout: 20_000 });
    for (const label of ["FU Future", "FU Tomorrow", "FU Lost"]) await expect(card.locator(`a[href*="open=${need(label)}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/home-attention.png` });
  });

  test("late evening (11:30 PM Eastern): tomorrow is NOT 'Due today' in the rendered drawer", async () => {
    // The browser's clock says 23:30 Eastern — already the next day in UTC.
    const evening = easternInstant(TODAY, "23", "30");
    expect(evening.toISOString().slice(0, 10)).not.toBe(TODAY); // premise: UTC has rolled over (EDT and EST alike)
    await page.clock.setFixedTime(evening);
    try {
      await openDrawer(page, need("FU Tomorrow"));
      await expect(page.getByTestId("lead-next-follow-up")).toHaveText(pretty(addDays(TODAY, 1)));
      await expect(drawer(page).getByText("Follow-up due today")).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/evening-tomorrow.png` });
      // Controls at the same instant: today's is due, yesterday's is overdue.
      await openDrawer(page, need("FU Today"));
      await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Due today · ${pretty(TODAY)}`);
      await expect(drawer(page).getByText("Follow-up due today")).toBeVisible();
      await openDrawer(page, need("FU TouchComplete"));
      await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Overdue · ${pretty(addDays(TODAY, -1))}`);
    } finally {
      await page.clock.resume();
    }
  });
});

test.describe("agent: direct follow-up control (no touch)", () => {
  test.skip(PHASE !== "agent", "agent phase only");

  test("Schedule on a contact with none: date set, last contact and history untouched", async () => {
    const id = need("FU Sched");
    const before = await snap(id);
    expect(before.follow).toBeUndefined();
    await openDrawer(page, id);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("None set");
    await expect(followRegion(page).getByRole("button", { name: "Mark complete" })).toHaveCount(0);
    const day = addDays(TODAY, 3);
    await followRegion(page).getByRole("button", { name: "Schedule" }).click();
    await followRegion(page).locator("#lead-follow-up-day").fill(day);
    await followRegion(page).getByRole("button", { name: "Save follow-up" }).click();
    await expect(drawer(page).getByRole("status")).toHaveText(`Follow-up set for ${pretty(day)}.`);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(pretty(day));
    const after = await snap(id);
    expect(after.follow).toBe(noon(day));
    expect(after.last).toBe(before.last); // unchanged …
    expect(after.acts).toBe(before.acts); // … and no touch written
    // The no-touch clock did not reset: the pill is still there.
    await expect(drawer(page).getByText("No touch in 14 days")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/drawer-scheduled.png` });
  });

  test("Change: reschedules, still no touch", async () => {
    const id = need("FU Change");
    const before = await snap(id);
    await openDrawer(page, id);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(pretty(addDays(TODAY, 10)));
    const day = addDays(TODAY, 7);
    await followRegion(page).getByRole("button", { name: "Change" }).click();
    await followRegion(page).locator("#lead-follow-up-day").fill(day);
    await followRegion(page).getByRole("button", { name: "Save follow-up" }).click();
    await expect(drawer(page).getByRole("status")).toHaveText(`Follow-up changed to ${pretty(day)}.`);
    const after = await snap(id);
    expect(after.follow).toBe(noon(day));
    expect(after.last).toBe(before.last);
    expect(after.acts).toBe(before.acts);
  });

  test("Mark complete on an overdue follow-up: cleared, no touch, gone from Home", async () => {
    const id = need("FU Complete");
    const before = await snap(id);
    expect(await attentionIds()).toContain(`follow-up:${id}`);
    await openDrawer(page, id);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Overdue · ${pretty(addDays(TODAY, -2))}`);
    await followRegion(page).getByRole("button", { name: "Mark complete" }).click();
    await expect(drawer(page).getByRole("status")).toHaveText("Follow-up marked complete.");
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("None set");
    const after = await snap(id);
    expect(after.follow).toBeUndefined();
    expect(after.last).toBe(before.last);
    expect(after.acts).toBe(before.acts);
    expect(await attentionIds()).not.toContain(`follow-up:${id}`);
  });

  test("API: a past day, a non-day and a mixed body are refused; the same call with today works", async () => {
    const id = need("FU Sched");
    const before = await snap(id);
    const yesterday = await followUp(id, { action: "schedule", day: addDays(TODAY, -1) });
    const junk = await followUp(id, { action: "schedule", day: "2026-02-30" });
    const mixed = await followUp(id, { action: "complete", day: TODAY });
    const pastTouch = await touchApi(id, { nextFollowUpAt: noon(addDays(TODAY, -1)) });
    console.log(`[fu] past day ${yesterday.status}, not a date ${junk.status}, mixed ${mixed.status}, past via touch ${pastTouch.status}`);
    expect([yesterday.status, junk.status, mixed.status, pastTouch.status]).toEqual([400, 400, 400, 400]);
    expect((yesterday.body as { error?: string }).error).toBe("invalid_date");
    expect(await snap(id)).toEqual(before);
    const ok = await followUp(id, { action: "schedule", day: TODAY }); // control: today is allowed
    expect(ok.status).toBe(200);
    expect((ok.body as { followUp?: string }).followUp).toBe("rescheduled");
    expect((await snap(id)).follow).toBe(noon(TODAY));
  });
});

test.describe("agent: log a touch, with and without the reminder", () => {
  test.skip(PHASE !== "agent", "agent phase only");

  async function logInDrawer(summary: string, opts: { day?: string; complete?: boolean } = {}) {
    await touchForm(page).getByLabel("Touch summary").fill(summary);
    if (opts.day) await touchForm(page).locator("#lead-next-follow-up-day").fill(opts.day);
    if (opts.complete) await touchForm(page).getByLabel("Mark current follow-up complete").click();
    await touchForm(page).getByRole("button", { name: "Log touch" }).click();
  }

  test("touch + keep: activity, last contact moves, reminder stays", async () => {
    const id = need("FU TouchKeep");
    const before = await snap(id);
    await openDrawer(page, id);
    await logInDrawer("Left a voicemail");
    await expect(drawer(page).getByRole("status")).toHaveText(`Touch logged. Follow-up kept for ${pretty(TODAY)}.`);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Due today · ${pretty(TODAY)}`);
    const after = await snap(id);
    expect(after.follow).toBe(before.follow);
    expect(after.acts).toBe(before.acts + 1);
    expect(new Date(after.last).getTime()).toBeGreaterThan(new Date(before.last).getTime()); // control: this path DOES move it
    expect(await attentionIds()).toContain(`follow-up:${id}`);
    await expect(drawer(page).getByText("No touch in 14 days")).toHaveCount(0); // a real touch resets the heuristic
  });

  test("touch + new date: activity, last contact moves, reminder changes", async () => {
    const id = need("FU TouchChange");
    const before = await snap(id);
    const day = addDays(TODAY, 12);
    await openDrawer(page, id);
    await logInDrawer("Sent listings", { day });
    await expect(drawer(page).getByRole("status")).toHaveText(`Touch logged. Next follow-up set for ${pretty(day)}.`);
    const after = await snap(id);
    expect(after.follow).toBe(noon(day));
    expect(after.acts).toBe(before.acts + 1);
    expect(new Date(after.last).getTime()).toBeGreaterThan(new Date(before.last).getTime());
  });

  test("touch + complete: activity, last contact moves, reminder cleared", async () => {
    const id = need("FU TouchComplete");
    const before = await snap(id);
    await openDrawer(page, id);
    await logInDrawer("Reached them, showing booked", { complete: true });
    await expect(drawer(page).getByRole("status")).toHaveText("Touch logged. Follow-up marked complete.");
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("None set");
    const after = await snap(id);
    expect(after.follow).toBeUndefined();
    expect(after.acts).toBe(before.acts + 1);
    expect(new Date(after.last).getTime()).toBeGreaterThan(new Date(before.last).getTime());
    expect(await attentionIds()).not.toContain(`follow-up:${id}`);
  });

  test("'Mark contacted today': last contact moves, the future reminder is kept", async () => {
    const id = need("FU Marked");
    const before = await snap(id);
    await openDrawer(page, id);
    await drawer(page).getByRole("button", { name: "Mark contacted today" }).click();
    await expect(async () => {
      const after = await snap(id);
      expect(new Date(after.last).getTime()).toBeGreaterThan(new Date(before.last).getTime());
      expect(after.follow).toBe(before.follow);
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(pretty(addDays(TODAY, 8)));
  });

  test("while typing a date in the touch form, completion is disabled: the date wins", async () => {
    await openDrawer(page, need("FU TouchKeep"));
    await touchForm(page).locator("#lead-next-follow-up-day").fill(addDays(TODAY, 6));
    await expect(touchForm(page).getByLabel("Mark current follow-up complete")).toBeDisabled();
    await touchForm(page).locator("#lead-next-follow-up-day").fill("");
    await expect(touchForm(page).getByLabel("Mark current follow-up complete")).toBeEnabled(); // control
  });
});

test.describe("agent: authorization, display and layout", () => {
  test.skip(PHASE !== "agent", "agent phase only");

  test("another agent's and another brokerage's contacts are 404, exactly like a missing one", async () => {
    const nowhere = await followUp("00000000-0000-4000-8000-000000000000", { action: "complete" });
    const colleague = await followUp(OTHER, { action: "complete" });
    const foreign = await followUp(FOREIGN, { action: "complete" });
    const touchColleague = await touchApi(OTHER, {});
    console.log(`[fu] agent → colleague ${colleague.status}, foreign ${foreign.status}, touch on colleague's ${touchColleague.status}`);
    expect([nowhere.status, colleague.status, foreign.status, touchColleague.status]).toEqual([404, 404, 404, 404]);
    expect(JSON.stringify(colleague.body)).toBe(JSON.stringify(nowhere.body));
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nowhere.body));
    // Control: the identical request on the agent's own contact is allowed.
    const own = await followUp(need("FU Future"), { action: "schedule", day: addDays(TODAY, 11) });
    expect(own.status).toBe(200);
    // And nothing about the colleague's contact changed (the broker phase reads it back).
  });

  test("display: no lone separator without email/phone; the assigned agent is a name, never an id or email", async () => {
    await openDrawer(page, need("FU None"));
    await expect(drawer(page).getByText("Contact details")).toBeAttached(); // the accessible description, visually hidden
    await expect(drawer(page).getByText("·", { exact: true })).toHaveCount(0);
    const agent = drawer(page).getByText("Assigned agent", { exact: true }).locator("xpath=following-sibling::p");
    const text = (await agent.innerText()).trim();
    console.log(`[fu] assigned agent renders as: ${text === "—" ? "—" : text === "Unnamed agent" ? "Unnamed agent" : "<a name>"}`);
    expect(text).not.toBe("—");
    expect(text).not.toMatch(/user_|@|^[0-9a-f-]{20,}$/i);
    await page.screenshot({ path: `${SHOTS}/drawer-none.png` });
  });

  test("drawer at 390px: both sections fit, no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDrawer(page, need("FU Future"));
    const fits = await drawer(page).evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
    expect(fits).toBe(true);
    await followRegion(page).getByRole("button", { name: "Change" }).click();
    expect(await drawer(page).evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true); // editing state too
    await page.screenshot({ path: `${SHOTS}/drawer-390-editing.png` });
    await followRegion(page).getByRole("button", { name: "Cancel" }).click();
    await touchForm(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/drawer-390-touch.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const [label, closeDay] of [["Blank", null], ["Entered", addDays(TODAY, 60)]] as const) {
    test(`quick-create transaction, ${label.toLowerCase()} closing date`, async () => {
      const address = `${label} ${TAG} Way`;
      await page.goto("/dashboard/transactions", { waitUntil: "domcontentloaded", timeout: 60_000 });
      // The view's controls render client-side, so seeing them means handlers are attached.
      await expect(page.getByRole("radio", { name: "Board" })).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        await page.keyboard.press("Escape");
        await page.locator("header").getByRole("button", { name: "New", exact: true }).click({ timeout: 5_000 });
        await page.getByRole("menuitem", { name: "Transaction" }).click({ timeout: 3_000 });
        await expect(page.getByRole("dialog", { name: "New transaction" })).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 60_000 });
      const dlg = page.getByRole("dialog", { name: "New transaction" });
      await dlg.getByLabel("Property address").fill(address);
      await dlg.getByLabel("Client").fill(`FU Client ${TAG}`);
      await dlg.getByLabel("Contract price").fill("450000");
      if (closeDay) await dlg.getByLabel("Close date (optional)").fill(closeDay);
      await dlg.locator('button[type="submit"]').click();
      await expect(dlg).toBeHidden({ timeout: 30_000 });

      const list = await api("/dashboard/api/transactions");
      const item = (list.body.items as { id: string; address: string }[]).find((t) => t.address.startsWith(address));
      expect(item, "the created transaction is listed").toBeTruthy();
      const detail = await api(`/dashboard/api/transactions/${item!.id}`);
      const txn = detail.body.transaction as { closeDate?: string | null; milestones: { key: string; date: string }[] };
      const closing = txn.milestones.filter((m) => m.key === "closing");
      console.log(`[fu] ${label}: closeDate=${txn.closeDate ? "set" : "unset"} closing deadlines=${closing.length}`);
      if (closeDay) {
        expect(txn.closeDate?.slice(0, 10)).toBe(closeDay);
        expect(closing).toHaveLength(1);
        expect(closing[0].date.slice(0, 10)).toBe(closeDay);
      } else {
        expect(txn.closeDate ?? null).toBeNull();
        expect(closing).toHaveLength(0);
      }
    });
  }
});

// =========================================================================================
// BROKER — brokerage scope
// =========================================================================================
test.describe("broker: sees and edits a colleague's contact; the boundary still holds", () => {
  test.skip(PHASE !== "broker", "broker phase only");

  test("the colleague's contact is visible, and its agent is 'Unnamed agent', not the viewer", async () => {
    const before = await snap(OTHER);
    expect(before.status).toBe(200); // control: a broker reads it (an agent got 404 in the agent phase)
    await openDrawer(page, OTHER);
    const agent = drawer(page).getByText("Assigned agent", { exact: true }).locator("xpath=following-sibling::p");
    await expect(agent).toHaveText("Unnamed agent");
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(`Due today · ${pretty(TODAY)}`);
    await page.screenshot({ path: `${SHOTS}/broker-colleague.png` });
  });

  test("a broker changes and completes the colleague's follow-up, with no touch", async () => {
    const before = await snap(OTHER);
    const day = addDays(TODAY, 5);
    await openDrawer(page, OTHER);
    await followRegion(page).getByRole("button", { name: "Change" }).click();
    await followRegion(page).locator("#lead-follow-up-day").fill(day);
    await followRegion(page).getByRole("button", { name: "Save follow-up" }).click();
    await expect(drawer(page).getByRole("status")).toHaveText(`Follow-up changed to ${pretty(day)}.`);
    let after = await snap(OTHER);
    expect(after.follow).toBe(noon(day));
    expect(after.last).toBe(before.last);
    expect(after.acts).toBe(before.acts);
    await followRegion(page).getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("None set");
    after = await snap(OTHER);
    expect(after.follow).toBeUndefined();
    expect(after.last).toBe(before.last);
    expect(after.acts).toBe(before.acts);
  });

  test("another brokerage's contact is 404 even for a broker, like a missing one", async () => {
    const nowhere = await followUp("00000000-0000-4000-8000-000000000000", { action: "complete" });
    const foreign = await followUp(FOREIGN, { action: "complete" });
    const read = await api(`/dashboard/api/contacts/${FOREIGN}`);
    console.log(`[fu] broker → foreign follow-up ${foreign.status}, foreign read ${read.status}`);
    expect([nowhere.status, foreign.status, read.status]).toEqual([404, 404, 404]);
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nowhere.body));
  });
});
