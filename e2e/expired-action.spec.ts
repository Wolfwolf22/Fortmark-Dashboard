import { expect, test } from "@playwright/test";
import { apiFor, signInCertificationUser } from "./session";

/**
 * §19 — an action past its TTL cannot be confirmed.
 *
 * Takes an action id that was prepared earlier and has since aged past the
 * real ten-minute window. The TTL was never shortened; the clock simply ran.
 *
 * Expiry is evaluated against the clock rather than written into the row by a
 * sweeper, so a lapsed action still sits in the table as `prepared` — the
 * point of this test is that neither the read path nor the execute path treats
 * it as live.
 */
const ACTION_ID = process.env.EXPIRED_ACTION_ID ?? "";
const CONTACT_ID = process.env.EXPIRED_CONTACT_ID ?? "";

test("an action past its TTL is reported expired and refuses to execute", async ({ browser }) => {
  test.skip(!ACTION_ID || !CONTACT_ID, "EXPIRED_ACTION_ID and EXPIRED_CONTACT_ID must be set");

  const page = await browser.newPage();
  const jwt = await signInCertificationUser(page);
  const api = apiFor(jwt);

  // It must not be offered as pending.
  const pending = await api("/dashboard/api/ai/actions");
  expect(pending.status).toBe(200);
  const offered = (pending.body.actions as Record<string, unknown>[]).some(
    (a) => a.actionId === ACTION_ID
  );
  console.log(`[expired] offered as pending: ${offered}`);
  expect(offered).toBe(false);

  // Reading it directly must report it as expired, not as live.
  const one = await api(`/dashboard/api/ai/actions/${ACTION_ID}`);
  expect(one.status).toBe(200);
  const action = one.body.action as Record<string, unknown>;
  console.log(`[expired] direct read: status=${action.status} expiresAt=${action.expiresAt}`);
  expect(action.status).toBe("expired");
  expect(new Date(action.expiresAt as string).getTime()).toBeLessThan(Date.now());

  // Confirming must refuse.
  const executed = await api(`/dashboard/api/ai/actions/${ACTION_ID}/execute`, { method: "POST" });
  console.log(`[expired] confirm -> ${executed.status} ${JSON.stringify(executed.body)}`);
  expect(executed.status).toBe(409);
  expect(executed.body.error).toBe("expired");

  // And the contact must be untouched.
  const contact = await api(`/dashboard/api/contacts/${CONTACT_ID}`);
  expect(contact.status).toBe(200);
  const row = contact.body.contact as Record<string, unknown>;
  expect(row.id).toBe(CONTACT_ID);
  expect(row.nextFollowUpDate).toBeUndefined();
  console.log(`[expired] contact untouched: nextFollowUpDate=${row.nextFollowUpDate}`);

  await page.close();
});
