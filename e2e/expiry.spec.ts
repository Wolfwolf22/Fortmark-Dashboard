import { expect, test } from "@playwright/test";
import { apiFor, chat, freshToken, signInCertificationUser } from "./session";

/**
 * §19 — a prepared action cannot be confirmed after it expires.
 *
 * Proven against the real clock. The TTL is ten minutes and it is NOT reduced
 * for the test: lowering it would prove that a shortened window closes, which
 * is not the claim. The test simply waits.
 *
 * Kept in its own file so the main certification run stays fast; this one is
 * deliberately slow.
 *
 * The fixture name is unique per run. A previous run left an identically named
 * contact behind, and the assistant then correctly refused to prepare anything
 * for an ambiguous name — right behaviour, but it made this test fail for a
 * reason that had nothing to do with expiry.
 */
const RUN_ID = Date.now().toString(36).toUpperCase();
test.describe.configure({ mode: "serial" });

test("a prepared action expires and is then refused", async ({ browser }) => {
  test.setTimeout(15 * 60_000);

  // The page stays open for the whole test: this run outlives a single Clerk
  // session token, so tokens are refreshed from the live session rather than
  // captured once.
  const page = await browser.newPage();
  let jwt = await signInCertificationUser(page);
  let api = apiFor(jwt);

  const created = await api("/dashboard/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "F2LIVE", lastName: `Expiry ${RUN_ID}`, stage: "lead" }),
  });
  expect(created.status).toBe(201);
  const contactId = (created.body.contact as Record<string, unknown>).id as string;

  await chat(jwt, [
    { role: "user", content: `Schedule a follow-up with F2LIVE Expiry ${RUN_ID} next Friday.` },
  ]);

  const pending = await api("/dashboard/api/ai/actions");
  const actions = pending.body.actions as Record<string, unknown>[];
  const mine = actions.find(
    (a) => (a.entity as { id?: string } | undefined)?.id === contactId
  );
  expect(mine, "the assistant prepared an action for the expiry fixture").toBeTruthy();
  const actionId = mine!.actionId as string;
  const expiresAt = new Date(mine!.expiresAt as string).getTime();
  console.log(`[expiry] prepared; expires in ${Math.round((expiresAt - Date.now()) / 1000)}s`);

  // Wait past the real expiry, plus a small margin for clock skew.
  const waitMs = Math.max(0, expiresAt - Date.now()) + 15_000;
  console.log(`[expiry] waiting ${Math.round(waitMs / 1000)}s for the real TTL to elapse`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  // The token captured before the wait has since expired — that is Clerk
  // behaving correctly, not a failure. Refresh from the live session.
  jwt = await freshToken(page);
  api = apiFor(jwt);

  // It should no longer be offered...
  const after = await api("/dashboard/api/ai/actions");
  expect(after.status, "the refreshed session is accepted").toBe(200);
  const stillPending = (after.body.actions as Record<string, unknown>[]).some(
    (a) => a.actionId === actionId
  );
  expect(stillPending).toBe(false);

  // ...and reading it directly should report it as expired rather than live.
  const one = await api(`/dashboard/api/ai/actions/${actionId}`);
  console.log(`[expiry] direct read status=${(one.body.action as Record<string, unknown>)?.status}`);
  expect((one.body.action as Record<string, unknown>).status).toBe("expired");

  // Confirming must refuse, and must not touch the contact.
  const executed = await api(`/dashboard/api/ai/actions/${actionId}/execute`, { method: "POST" });
  console.log(`[expiry] confirm after expiry -> ${executed.status} ${JSON.stringify(executed.body)}`);
  expect(executed.status).toBe(409);
  expect(executed.body.error).toBe("expired");

  const contact = await api(`/dashboard/api/contacts/${contactId}`);
  expect((contact.body.contact as Record<string, unknown>).nextFollowUpDate).toBeUndefined();
  console.log(`[expiry] contact untouched after refused confirmation`);
  await page.close();
});
