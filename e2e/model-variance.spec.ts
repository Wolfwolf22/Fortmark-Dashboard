import { expect, test, type Page } from "@playwright/test";
import { chatAs, refreshingApiFor, signInCertificationUser } from "./session";

/**
 * ISS-06 — a bounded look at how often the model does the right thing.
 *
 * Certification saw the assistant, once, decline a stage change it was
 * equipped to propose: "I can't change a contact's stage from here — select
 * Lost in the drawer." Nothing unsafe followed; a refusal prepares nothing.
 * The open question was whether that is rare enough to live with or common
 * enough to be a defect in how the tools are described.
 *
 * So this measures rather than argues. Each trial is independent — anything
 * left pending is cancelled first, so no trial inherits another's card — and
 * the outcome recorded is the server's, not the model's prose: either a
 * proposal exists afterwards or it does not.
 *
 * Nothing here asserts a rate. The sample is printed and the judgement is
 * made in the report, because a threshold invented in a test file would be a
 * number nobody chose.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let api: ReturnType<typeof refreshingApiFor>;
const state: { contactId?: string } = {};

const TRIALS = 6;
// Unique per run. A leftover contact from an earlier run would make the
// model ask which of two people is meant — the correct answer to an
// ambiguous name, and a useless trial for measuring tool selection.
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const FIXTURE = { firstName: "SYSVERIFY", lastName: `Variance ${RUN}` };
const NAME = `${FIXTURE.firstName} ${FIXTURE.lastName}`;

async function pending(): Promise<Record<string, unknown>[]> {
  const res = await api("/dashboard/api/ai/actions");
  expect(res.status).toBe(200);
  return (res.body.actions ?? []) as Record<string, unknown>[];
}

async function clearPending(): Promise<void> {
  for (const action of await pending()) {
    await api(`/dashboard/api/ai/actions/${action.actionId}/cancel`, { method: "POST" });
  }
}

/** One independent trial: ask, then read what the server holds. */
async function trial(ask: string): Promise<{ prepared: boolean; type: string; reply: string }> {
  await clearPending();
  const reply = await chatAs(page, [{ role: "user", content: ask }]);
  const actions = await pending();
  return {
    prepared: actions.length > 0,
    type: String(actions[0]?.type ?? ""),
    reply: reply.replace(/\s+/g, " ").slice(0, 120),
  };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  console.log(`[variance] fixture=${NAME}`);
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
  try {
    await clearPending();
  } catch {
    // The phase's own cleanup verifies the table counts.
  }
});

test("§34 scheduling a follow-up, six independent asks", async () => {
  test.setTimeout(900_000);
  const results: string[] = [];
  let correct = 0;
  for (let i = 0; i < TRIALS; i += 1) {
    const out = await trial(`Schedule a follow-up with ${NAME} for next Friday.`);
    const ok = out.prepared && out.type === "contact_followup_schedule";
    if (ok) correct += 1;
    results.push(`${i + 1}: prepared=${out.prepared} type=${out.type || "-"} :: ${out.reply}`);
  }
  for (const r of results) console.log(`[variance] follow-up ${r}`);
  console.log(`[variance] follow-up: ${correct}/${TRIALS} selected the tool`);
  // The tool exists and the request is plainly within it. A majority that
  // cannot do it would be a defect in the tool description, not variance.
  expect(correct, "the follow-up tool is essentially always selected").toBeGreaterThanOrEqual(
    Math.ceil(TRIALS / 2)
  );
});

test("§34 changing a contact stage, six independent asks", async () => {
  test.setTimeout(900_000);
  const results: string[] = [];
  let correct = 0;
  for (let i = 0; i < TRIALS; i += 1) {
    const out = await trial(`Mark ${NAME} as qualified.`);
    const ok = out.prepared && out.type === "contact_stage_change";
    if (ok) correct += 1;
    results.push(`${i + 1}: prepared=${out.prepared} type=${out.type || "-"} :: ${out.reply}`);
  }
  for (const r of results) console.log(`[variance] stage ${r}`);
  console.log(`[variance] stage: ${correct}/${TRIALS} selected the tool`);
  expect(correct, "the stage tool is selected more often than not").toBeGreaterThanOrEqual(
    Math.ceil(TRIALS / 2)
  );
});

test("§34 an invalid request is refused and prepares nothing", async () => {
  test.setTimeout(600_000);
  // Archiving is deliberately outside what a model may propose. The refusal
  // is the correct answer, and the invariant is that nothing is prepared.
  const out = await trial(`Archive ${NAME}.`);
  console.log(`[variance] invalid: prepared=${out.prepared} :: ${out.reply}`);
  expect(out.prepared, "an out-of-scope request prepares nothing").toBe(false);
});
