import { expect, test, type Page } from "@playwright/test";
import { signInCertificationUser } from "./session";

/**
 * ISS-03 — the command palette hands focus back.
 *
 * Certification measured `document.activeElement` as BODY after opening the
 * palette with the keyboard and pressing Escape. For someone working by
 * keyboard that is not a cosmetic detail: focus on `<body>` means the next
 * Tab starts again from the top of the document, so every dismissal costs
 * them their place on the page.
 *
 * Every close path is exercised here, at desktop and at phone width. The
 * assertion is the same each time and is deliberately two-sided: focus must
 * land on something real, and it must not be trapped inside a dialog that
 * has closed.
 */
test.describe.configure({ mode: "serial" });

let page: Page;

const PALETTE = "Search FortMark";
const brief = () =>
  page.locator('section[aria-label="Daily brief"]').filter({ hasText: "Active transactions" });

/** Where focus actually is, in terms a failure message can be read from. */
async function focus(): Promise<{ tag: string; label: string; inPalette: boolean }> {
  return await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? "none",
      label: el?.getAttribute("aria-label") ?? el?.getAttribute("placeholder") ?? "",
      inPalette: Boolean(el?.closest('[role="dialog"]')),
    };
  });
}

/** Load Home until its client runtime is up; a refused chunk is not an answer. */
async function openHome(): Promise<void> {
  for (let load = 0; load < 3; load += 1) {
    await page.goto("/dashboard/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await expect(brief()).toBeVisible({ timeout: 30_000 });
      return;
    } catch {
      console.log(`[focus] home did not hydrate on load ${load + 1}`);
    }
  }
  throw new Error("Home never hydrated in three loads");
}

const palette = () => page.getByRole("dialog", { name: PALETTE });
const input = () => page.getByPlaceholder(/Search people/);

/** Open by keystroke, and wait for the input to take focus. */
async function openByKeyboard(key: "Control+k" | "Meta+k"): Promise<void> {
  await page.keyboard.press(key);
  await expect(palette()).toBeVisible({ timeout: 15_000 });
  await expect(input()).toBeFocused({ timeout: 10_000 });
}

async function expectSomewhereSensible(context: string): Promise<void> {
  await expect(palette()).toBeHidden({ timeout: 10_000 });
  const landed = await focus();
  console.log(`[focus] ${context}: ${JSON.stringify(landed)}`);
  expect(landed.tag, `${context}: focus fell to the document body`).not.toBe("BODY");
  expect(landed.tag, `${context}: nothing is focused at all`).not.toBe("none");
  expect(landed.inPalette, `${context}: focus is trapped in the closed palette`).toBe(false);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  page = await browser.newPage();
  await signInCertificationUser(page);
});

test("§32 Ctrl+K then Escape", async () => {
  test.setTimeout(240_000);
  await openHome();
  await openByKeyboard("Control+k");
  await page.keyboard.press("Escape");
  await expectSomewhereSensible("Ctrl+K then Escape");
});

test("§32 Cmd+K then Escape", async () => {
  test.setTimeout(240_000);
  await openByKeyboard("Meta+k");
  await page.keyboard.press("Escape");
  await expectSomewhereSensible("Cmd+K then Escape");
});

test("§32 Ctrl+K toggles closed", async () => {
  test.setTimeout(240_000);
  await openByKeyboard("Control+k");
  await page.keyboard.press("Control+k");
  await expectSomewhereSensible("Ctrl+K toggle");
});

test("§32 opened from the search button, closed by Escape, returns to the button", async () => {
  test.setTimeout(240_000);
  const trigger = page.getByRole("button", { name: "Search (Command K)" });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(palette()).toBeVisible({ timeout: 15_000 });
  await expect(input()).toBeFocused({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expectSomewhereSensible("Escape after opening from the button");
  // This is the one case with a definite right answer, so it is asserted
  // exactly: the control that opened the palette gets focus back.
  await expect(trigger).toBeFocused({ timeout: 10_000 });
});

test("§32 clicking outside closes it without losing focus", async () => {
  test.setTimeout(240_000);
  await openByKeyboard("Control+k");
  await page.mouse.click(4, 4);
  await expectSomewhereSensible("click outside");
});

test("§32 selecting a result navigates and still leaves focus somewhere", async () => {
  test.setTimeout(300_000);
  await openByKeyboard("Control+k");
  // Quick actions are always present and need no records behind them, so
  // this case does not depend on the fixture state of the database.
  const action = palette().getByRole("option").first();
  await expect(action).toBeVisible({ timeout: 15_000 });
  await action.click();
  // The navigation unmounts whatever opened the palette; the search control
  // in the top bar is part of the shell and survives it.
  await expectSomewhereSensible("selecting a result");
});

test("§32 at phone width, the same holds", async () => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome();
  const trigger = page.getByRole("button", { name: "Search", exact: true });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(palette()).toBeVisible({ timeout: 15_000 });
  await expect(input()).toBeFocused({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expectSomewhereSensible("phone width, Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
});
