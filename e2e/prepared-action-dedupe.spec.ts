import { expect, test, type Page } from "@playwright/test";
import { chatAs, refreshingApiFor, signInCertificationUser } from "./session";

/**
 * ISS-14 — one pending proposal per identical request.
 *
 * Certification watched the model, told "yes" after a follow-up card, call
 * the prepare tool a second time. Two identical cards appeared and the
 * pending list held both. Nothing unsafe followed — typing "yes" still
 * changed nothing, and confirming either card applies the change once — but
 * a confirmation surface may not ask which of two identical proposals to
 * press.
 *
 * Everything here goes through the deployed product: a real Clerk session,
 * the real chat route, the real OpenAI model, the real prepare tool and the
 * real database. The model is free to phrase its answer however it likes;
 * what is asserted is the state of the pending list, which is the server's.
 *
 * Concurrency is proven where it is enforced — the partial unique index —
 * rather than by racing a language model, which would test the model's
 * timing rather than the invariant.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
const state: { contactId?: string; firstActionId?: string } = {};

const FIXTURE = { firstName: "SYSVERIFY", lastName: "Dedupe Dana" };
/** Two different dates, so "a different proposal" has something to differ by. */
const FRIDAY = "Friday";
const MONDAY = "Monday";

/** Every action this actor currently has pending, newest first. */
async function pending(): Promise<Record<string, unknown>[]> {
  const res = await api("/dashboard/api/ai/actions");
  expect(res.status).toBe(200);
  return (res.body.actions ?? []) as Record<string, unknown>[];
}

/** Ask for a follow-up in words the tool can act on, and wait for the turn. */
async function askForFollowUp(day: string): Promise<string> {
  return await chatAs(page, [
    {
      role: "user",
      content: `Schedule a follow-up with ${FIXTURE.firstName} ${FIXTURE.lastName} for next ${day}.`,
    },
  ]);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  // The page stays open for the life of the spec: it is what keeps the
  // Clerk session alive and hands out current tokens.
  page = await browser.newPage();
  await signInCertificationUser(page);
  api = refreshingApiFor(page);

  const created = await api("/dashboard/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...FIXTURE, stage: "lead" }),
  });
  expect(created.status).toBe(201);
  state.contactId = (created.body.contact as Record<string, unknown>).id as string;
});

test.afterAll(async () => {
  // Leave the branch as it was found: cancel anything still pending, then
  // remove the fixture contact.
  try {
    for (const action of await pending()) {
      await api(`/dashboard/api/ai/actions/${action.actionId}/cancel`, { method: "POST" });
    }
  } catch {
    // Best-effort: cancelling is all this spec can do through the product.
    // The contact row has no delete route by design, so the phase's own
    // cleanup removes it and verifies the table counts.
  }
});

test("§29 the same request twice leaves one pending proposal", async () => {
  test.setTimeout(420_000);
  expect(await pending()).toHaveLength(0);

  await askForFollowUp(FRIDAY);
  const first = await pending();
  expect(first, "the assistant prepared exactly one proposal").toHaveLength(1);
  state.firstActionId = first[0].actionId as string;

  // The same request again. Before the fix this produced a second row and a
  // second card; now the server hands back the one it already has.
  await askForFollowUp(FRIDAY);
  const second = await pending();
  console.log(
    `[dedupe] after an identical second request: ${second.length} pending, ids=${second
      .map((a) => String(a.actionId).slice(0, 8))
      .join(",")}`
  );
  expect(second, "an identical request does not add a second proposal").toHaveLength(1);
  expect(second[0].actionId, "and it is the same proposal, not a replacement").toBe(
    state.firstActionId
  );
  // The card a person would see is unchanged too, down to its clock.
  expect(second[0].expiresAt).toBe(first[0].expiresAt);
});

test("§29 a different date is a different proposal", async () => {
  test.setTimeout(420_000);
  await askForFollowUp(MONDAY);
  const actions = await pending();
  console.log(`[dedupe] after a different date: ${actions.length} pending`);
  // Deduplication is not suppression: a genuinely different change must still
  // be proposable while the first one is outstanding.
  expect(actions.length).toBeGreaterThanOrEqual(2);
  const ids = new Set(actions.map((a) => a.actionId));
  expect(ids.size, "the proposals are distinct").toBe(actions.length);
  expect(ids.has(state.firstActionId!), "the first proposal is still pending").toBe(true);
});

test("§29 confirming one proposal leaves the invariant intact", async () => {
  test.setTimeout(420_000);
  const before = await pending();
  const target = before.find((a) => a.actionId === state.firstActionId)!;
  const executed = await api(`/dashboard/api/ai/actions/${target.actionId}/execute`, {
    method: "POST",
  });
  expect(executed.status).toBe(200);

  // The executed proposal leaves the pending list; the other one stays.
  const after = await pending();
  console.log(`[dedupe] after executing one: ${after.length} pending`);
  expect(after.some((a) => a.actionId === state.firstActionId)).toBe(false);

  // The contact has moved, so the same words now describe a different change
  // against a different record state — a new proposal, correctly.
  await askForFollowUp(FRIDAY);
  const reproposed = await pending();
  console.log(`[dedupe] re-asking after execution: ${reproposed.length} pending`);
  expect(
    reproposed.every((a) => a.actionId !== state.firstActionId),
    "the executed proposal is never reused"
  ).toBe(true);
});
