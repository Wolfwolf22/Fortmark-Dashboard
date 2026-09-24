/**
 * Follow-up capture and the truthful closing date — Preview certification.
 *
 * Runs in two phases against synthetic rows the operator seeds and removes on
 * the Preview database (never Production):
 *
 *   FU_PHASE=member  the certification user as a `member`, which may read its
 *                    own contacts but write none. Proves the refusals: 403 on
 *                    its own contact, 404 on a colleague's, the drawer says so,
 *                    and the follow-up survives.
 *   FU_PHASE=agent   the same user as an `agent`. Creates its own synthetic
 *                    contacts through the API and drives the rendered drawer:
 *                    due, future, kept, completed, rescheduled; Home's queue;
 *                    the list column; quick-create blank vs entered closing.
 *
 * Inputs: FU_TAG (marks every synthetic name/address), FU_MEMBER_CONTACT (the
 * cert user's seeded contact, follow-up due today), FU_OTHER_CONTACT (a
 * colleague's seeded contact). Screenshots go to SHOTS_DIR, not the repo.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { apiFor, freshToken, signInCertificationUser } from "./session";

test.describe.configure({ mode: "serial" });

const PHASE = process.env.FU_PHASE ?? "agent";
const TAG = process.env.FU_TAG ?? "FUSYN";
const MEMBER_CONTACT = process.env.FU_MEMBER_CONTACT ?? "";
const OTHER_CONTACT = process.env.FU_OTHER_CONTACT ?? "";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/follow-up-shots";
mkdirSync(SHOTS, { recursive: true });

// Home counts a follow-up due through the end of today, UTC.
const todayDay = new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const noon = (day: string) => `${day}T12:00:00.000Z`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pretty = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

let page: Page;
let api: ReturnType<typeof apiFor>;

async function openDrawer(p: Page, id: string) {
  await expect(async () => {
    await p.goto(`/dashboard/leads?open=${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(p.getByTestId("lead-next-follow-up")).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 120_000 });
}
const drawer = (p: Page) => p.getByRole("dialog");

async function logTouchInDrawer(p: Page, summary: string, opts: { day?: string; complete?: boolean } = {}) {
  const d = drawer(p);
  await d.getByLabel("Touch summary").fill(summary);
  if (opts.day) await d.locator("#lead-next-follow-up-day").fill(opts.day);
  if (opts.complete) await d.getByLabel("Mark current follow-up complete").click();
  await d.getByRole("button", { name: "Log touch" }).click();
}

async function contact(id: string) {
  const r = await api(`/dashboard/api/contacts/${id}`);
  return { status: r.status, lead: (r.body.contact ?? r.body.lead ?? r.body) as { nextFollowUpDate?: string; lastContactDate: string } };
}

async function attentionIds(): Promise<string[]> {
  const r = await api("/dashboard/api/metrics");
  expect(r.status).toBe(200);
  const group = r.body.attention as { availability: string; data?: { items: { id: string }[] } };
  expect(group.availability).toBe("available");
  return group.data!.items.map((i) => i.id);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInCertificationUser(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
  api = apiFor(await freshToken(page));
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("member phase: refusals leave the follow-up alone", () => {
  test.skip(PHASE !== "member", "member phase only");

  test("API: 403 on own contact, 404 on a colleague's, follow-up kept", async () => {
    expect(MEMBER_CONTACT && OTHER_CONTACT).toBeTruthy();
    const before = await contact(MEMBER_CONTACT);
    expect(before.status).toBe(200);
    expect(before.lead.nextFollowUpDate?.slice(0, 10)).toBe(todayDay);

    const own = await api(`/dashboard/api/contacts/${MEMBER_CONTACT}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "call", summary: "should be refused", completeFollowUp: true }),
    });
    console.log(`[fu] member → own contact: ${own.status}`);
    expect(own.status).toBe(403);

    const other = await api(`/dashboard/api/contacts/${OTHER_CONTACT}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "call", summary: "should be refused", completeFollowUp: true }),
    });
    console.log(`[fu] member → colleague's contact: ${other.status}`);
    expect(other.status).toBe(404);

    const after = await contact(MEMBER_CONTACT);
    expect(after.lead.nextFollowUpDate).toBe(before.lead.nextFollowUpDate);
    expect(after.lead.lastContactDate).toBe(before.lead.lastContactDate);
  });

  test("UI: the drawer explains the refusal and still shows the due follow-up", async () => {
    await openDrawer(page, MEMBER_CONTACT);
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("Due today");
    await logTouchInDrawer(page, "Tried to complete it", { complete: true });
    await expect(drawer(page).getByRole("alert")).toHaveText("You do not have permission to change this contact.");
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText("Due today");
    await page.screenshot({ path: `${SHOTS}/member-refused.png` });
  });
});

test.describe("agent phase: capture, keep, complete, reschedule", () => {
  test.skip(PHASE !== "agent", "agent phase only");

  let dueId = "";
  let futureId = "";
  const futureDay = plusDays(10);
  const rescheduleDay = plusDays(7);

  test("API: create a due and a future follow-up", async () => {
    for (const [label, day] of [["Due", todayDay], ["Future", futureDay]] as const) {
      const made = await api("/dashboard/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: `FU ${label}`, lastName: TAG, source: "other" }),
      });
      expect(made.status).toBe(201);
      const id = (made.body.contact as { id: string }).id;
      const set = await api(`/dashboard/api/contacts/${id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "call", summary: "Intro call", nextFollowUpAt: noon(day) }),
      });
      expect(set.status).toBe(201);
      expect((set.body.contact as { nextFollowUpDate: string }).nextFollowUpDate.slice(0, 10)).toBe(day);
      if (label === "Due") dueId = id;
      else futureId = id;
    }
    const ids = await attentionIds();
    expect(ids).toContain(`follow-up:${dueId}`);
    expect(ids).not.toContain(`follow-up:${futureId}`);
  });

  test("API: a plain touch keeps the due follow-up; still in Home's queue", async () => {
    const r = await api(`/dashboard/api/contacts/${dueId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "call", summary: "No answer" }),
    });
    expect(r.status).toBe(201);
    expect((r.body.contact as { nextFollowUpDate?: string }).nextFollowUpDate?.slice(0, 10)).toBe(todayDay);
    expect(await attentionIds()).toContain(`follow-up:${dueId}`);
  });

  test("API: a colleague's contact is still 404 for an agent", async () => {
    const r = await api(`/dashboard/api/contacts/${OTHER_CONTACT}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "call", summary: "should be refused", completeFollowUp: true }),
    });
    expect(r.status).toBe(404);
  });

  test("Home: the due follow-up is in Needs attention, the future one is not", async () => {
    await expect(async () => {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await expect(page.locator('section[aria-label="Daily brief"] dl')).toBeVisible({ timeout: 25_000 });
    }).toPass({ timeout: 120_000 });
    await expect(page.locator(`a[href*="open=${dueId}"]`).first()).toBeAttached({ timeout: 20_000 });
    await expect(page.locator(`a[href*="open=${futureId}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/home-attention.png` });
  });

  test("Leads list: stored follow-up column, truthful heuristic label", async () => {
    await page.goto("/dashboard/leads", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.getByRole("columnheader", { name: /Follow-up/ })).toBeVisible({ timeout: 30_000 });
    const dueRow = page.getByRole("row", { name: new RegExp(`FU Due ${TAG}`) });
    const futureRow = page.getByRole("row", { name: new RegExp(`FU Future ${TAG}`) });
    await expect(dueRow.getByTestId("lead-follow-up-cell")).toHaveText("Due today");
    await expect(futureRow.getByTestId("lead-follow-up-cell")).toHaveText(pretty(futureDay));
    // The old unlabelled heuristic pill is gone everywhere on the page.
    await expect(page.getByText("Follow up", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/leads-list.png` });
  });

  test("Drawer: plain touch keeps it, completion clears it, a date sets it", async () => {
    await openDrawer(page, dueId);
    const next = page.getByTestId("lead-next-follow-up");
    await expect(next).toHaveText("Due today");
    await expect(drawer(page).getByText("Follow-up due today")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/drawer-due.png` });

    await logTouchInDrawer(page, "Left a voicemail");
    await expect(drawer(page).getByRole("status")).toHaveText(`Touch logged. Follow-up kept for ${pretty(todayDay)}.`);
    await expect(next).toHaveText("Due today");

    // A new date disables completion: the date wins.
    await drawer(page).locator("#lead-next-follow-up-day").fill(rescheduleDay);
    await expect(drawer(page).getByLabel("Mark current follow-up complete")).toBeDisabled();
    await drawer(page).locator("#lead-next-follow-up-day").fill("");

    await logTouchInDrawer(page, "Reached them, booked a showing", { complete: true });
    await expect(drawer(page).getByRole("status")).toHaveText("Touch logged. Follow-up marked complete.");
    await expect(next).toHaveText("None set");
    await expect(drawer(page).getByLabel("Mark current follow-up complete")).toHaveCount(0);
    expect(await attentionIds()).not.toContain(`follow-up:${dueId}`);
    await page.screenshot({ path: `${SHOTS}/drawer-completed.png` });

    await logTouchInDrawer(page, "Asked to reconnect next week", { day: rescheduleDay });
    await expect(drawer(page).getByRole("status")).toHaveText(`Touch logged. Next follow-up set for ${pretty(rescheduleDay)}.`);
    await expect(next).toHaveText(pretty(rescheduleDay));
    const stored = await contact(dueId);
    expect(stored.lead.nextFollowUpDate).toBe(noon(rescheduleDay));
    await page.screenshot({ path: `${SHOTS}/drawer-rescheduled.png` });
  });

  test("Drawer: 'Mark contacted today' keeps the future follow-up", async () => {
    await openDrawer(page, futureId);
    await drawer(page).getByRole("button", { name: "Mark contacted today" }).click();
    await expect(async () => {
      const c = await contact(futureId);
      expect(Date.now() - new Date(c.lead.lastContactDate).getTime()).toBeLessThan(120_000);
      expect(c.lead.nextFollowUpDate).toBe(noon(futureDay));
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId("lead-next-follow-up")).toHaveText(pretty(futureDay));
  });

  test("Drawer at 390: form fits without horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDrawer(page, futureId);
    const fits = await drawer(page).evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
    expect(fits).toBe(true);
    await page.screenshot({ path: `${SHOTS}/drawer-390.png`, fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const [label, closeDay] of [["Blank", null], ["Entered", plusDays(60)]] as const) {
    test(`Quick-create transaction, ${label.toLowerCase()} closing date`, async () => {
      const address = `${label} ${TAG} Way`;
      await expect(async () => {
        await page.goto("/dashboard/transactions", { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.locator("header").getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("menuitem", { name: "Transaction" }).click({ timeout: 5_000 });
        await expect(page.getByRole("dialog", { name: "New transaction" })).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 90_000 });
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
      expect(detail.status).toBe(200);
      const txn = detail.body.transaction as { closeDate?: string | null; milestones: { key: string; date: string }[] };
      const closing = txn.milestones.filter((m) => m.key === "closing");
      console.log(`[fu] ${label}: closeDate=${txn.closeDate ? "set" : "unset"} closing milestones=${closing.length}`);
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
