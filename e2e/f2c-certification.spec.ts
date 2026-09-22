import { expect, test } from "@playwright/test";
import { apiFor, chat, freshToken, signInCertificationUser } from "./session";
import type { Page } from "@playwright/test";

/**
 * F2-C live certification — AI-prepared contact stage change.
 *
 * Real Clerk session, real middleware, real allowlist, real OpenAI, real
 * database. Serial and single-worker: the steps share one fixture.
 *
 * The rendered Confirm button is still not clicked here. The portal's
 * `proxy.ts` derives its authorized parties only from VERCEL_URL and
 * VERCEL_BRANCH_URL, neither of which is the stable alias the browser uses, so
 * the portal rejects a session the dashboard accepts. Fixing that needs a code
 * change to the portal's auth configuration, which §30 reserves for a
 * deliberate decision. Everything below is therefore API-level.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let jwt: string;
let api: ReturnType<typeof apiFor>;
const state: { contactId?: string; actionId?: string; secondActionId?: string } = {};

/**
 * Unique per run. A leftover fixture from a failed run left two contacts
 * sharing a name, and the assistant correctly refused to prepare anything for
 * an ambiguous reference — right behaviour, wrong reason for a test to fail.
 */
const RUN_ID = Date.now().toString(36).toUpperCase().slice(-4);
const FIXTURE = { firstName: "F2CLIVE", lastName: `Jane ${RUN_ID}` };
const NAME = `${FIXTURE.firstName} ${FIXTURE.lastName}`;

async function refresh() {
  jwt = await freshToken(page);
  api = apiFor(jwt);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  jwt = await signInCertificationUser(page);
  api = apiFor(jwt);
  await api("/dashboard/", { headers: { Accept: "text/html" } });
});

test.afterAll(async () => {
  await page?.close();
});

const contactOf = (body: Record<string, unknown>) => body.contact as Record<string, unknown>;

/**
 * The pending proposal for this fixture with the given destination.
 *
 * Selected by destination rather than by contact alone: a conversation can
 * legitimately leave more than one proposal pending for the same person, and
 * picking the first would silently assert against the wrong card.
 */
async function pendingFor(toLabel: string): Promise<Record<string, unknown> | undefined> {
  const pending = await api("/dashboard/api/ai/actions");
  expect(pending.status).toBe(200);
  return (pending.body.actions as Record<string, unknown>[]).find(
    (a) =>
      (a.entity as { id?: string }).id === state.contactId &&
      (a.changes as { to?: string }[])[0]?.to === toLabel
  );
}

/**
 * Contact metrics from the live endpoint.
 *
 * The group carries its own availability, and this asserts it: an unreadable
 * group must never be mistaken for a zero, which is the rule the metrics
 * service exists to enforce.
 */
async function contactMetrics(): Promise<{ activeClients: number; followUpsDue: number }> {
  const res = await api("/dashboard/api/metrics");
  expect(res.status).toBe(200);
  const group = (res.body as { contacts?: { availability?: string; data?: Record<string, number> } }).contacts;
  expect(group?.availability, "contact metrics are readable").toBe("available");
  return {
    activeClients: group!.data!.activeClients,
    followUpsDue: group!.data!.followUpsDue,
  };
}

test("§44 a contact is created in a stage that permits a meaningful move", async () => {
  const created = await api("/dashboard/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...FIXTURE }),
  });
  expect(created.status).toBe(201);
  const contact = contactOf(created.body);
  state.contactId = contact.id as string;
  // Creation is server-controlled and always starts at `lead`, so the fixture
  // is moved into place through the shared domain writer — which also
  // exercises the manual path this phase refactored.
  const moved = await api(`/dashboard/api/contacts/${state.contactId}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "qualified" }),
  });
  expect([200, 201]).toContain(moved.status);
  const staged = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(staged.body).stage).toBe("qualified");

  // A stored follow-up, so §51's disclosure has something real to describe.
  const logged = await api(`/dashboard/api/contacts/${state.contactId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "call",
      summary: "Discussed timing.",
      nextFollowUpAt: "2026-10-02T12:00:00.000Z",
    }),
  });
  expect([200, 201]).toContain(logged.status);
  console.log(`[f2c] fixture at stage=qualified with a follow-up stored`);
});

test("§44 the real assistant prepares a stage change and changes nothing", async () => {
  const before = await contactMetrics();
  const activeBefore = before.activeClients;

  const reply = await chat(jwt, [
    { role: "user", content: `Move ${NAME} to Active Client.` },
  ]);
  console.log(`[f2c] assistant: ${JSON.stringify(reply.slice(0, 400))}`);
  expect(reply).toMatch(/prepar|review|confirm/i);
  expect(reply).not.toMatch(/\b(done|i've moved|i have moved|updated it|all set)\b/i);

  const mine = await pendingFor("Active client");
  expect(mine, "an action was prepared for the fixture").toBeTruthy();
  state.actionId = mine!.actionId as string;

  console.log(`[f2c] prepared: ${JSON.stringify({
    type: mine!.type, risk: mine!.risk, status: mine!.status,
    summary: mine!.summary, changes: mine!.changes, warnings: mine!.warnings,
  })}`);

  // §16 — server-authored, human labels, both sides.
  expect(mine!.type).toBe("contact_stage_change");
  expect(mine!.risk).toBe("moderate");
  expect(mine!.confirmationRequired).toBe(true);
  const changes = mine!.changes as { field: string; from: string; to: string }[];
  expect(changes).toHaveLength(1);
  expect(changes[0].field).toBe("stage");
  expect(changes[0].from).toBe("Qualified");
  expect(changes[0].to).toBe("Active client");

  // §19 — the deterministic metric consequence.
  expect(mine!.warnings as string[]).toContain("This contact will be counted in Active Clients.");

  // Nothing moved.
  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(after.body).stage).toBe("qualified");
  expect((await contactMetrics()).activeClients).toBe(activeBefore);
  console.log(`[f2c] after prepare: stage=qualified, activeClients unchanged at ${activeBefore}`);
});

test("§45 typing yes executes nothing", async () => {
  const reply = await chat(jwt, [
    { role: "user", content: `Move ${NAME} to Active Client.` },
    { role: "assistant", content: "I've prepared that stage change for your review." },
    { role: "user", content: "yes" },
  ]);
  console.log(`[f2c] reply to yes: ${JSON.stringify(reply.slice(0, 260))}`);

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(after.body).stage).toBe("qualified");
  const one = await api(`/dashboard/api/ai/actions/${state.actionId}`);
  expect((one.body.action as Record<string, unknown>).status).toBe("prepared");
  console.log(`[f2c] after yes: stage unchanged, action still prepared`);
});

test("§47 confirming commits the change and the metric follows", async () => {
  const before = await contactMetrics();

  const executed = await api(`/dashboard/api/ai/actions/${state.actionId}/execute`, { method: "POST" });
  expect(executed.status).toBe(200);
  expect(executed.body.alreadyExecuted).toBe(false);

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(after.body).stage).toBe("active_client");

  // §35/§42 — the metric moves by exactly one, which the card promised.
  const now = await contactMetrics();
  console.log(`[f2c] after confirm: stage=active_client activeClients ${before.activeClients} -> ${now.activeClients}`);
  expect(now.activeClients).toBe(before.activeClients + 1);
});

test("§47 the assistant reads back the new stage from the record", async () => {
  const reply = await chat(jwt, [
    { role: "user", content: `What stage is ${NAME} in now? Answer with just the stage.` },
  ]);
  console.log(`[f2c] readback: ${JSON.stringify(reply.slice(0, 200))}`);
  expect(reply).toMatch(/active client/i);
  expect(reply).not.toMatch(/qualified/i);
});

test("§49 a second confirmation changes nothing twice", async () => {
  const again = await api(`/dashboard/api/ai/actions/${state.actionId}/execute`, { method: "POST" });
  expect(again.status).toBe(200);
  expect(again.body.alreadyExecuted).toBe(true);
  console.log(`[f2c] duplicate execute: alreadyExecuted=true`);
});

test("§50 archiving is refused, and the domain is untouched", async () => {
  const reply = await chat(jwt, [
    { role: "user", content: `Archive ${NAME}.` },
  ]);
  console.log(`[f2c] archive request: ${JSON.stringify(reply.slice(0, 300))}`);

  const pending = await api("/dashboard/api/ai/actions");
  const archiving = (pending.body.actions as Record<string, unknown>[]).filter(
    (a) => JSON.stringify(a.changes).toLowerCase().includes("archiv")
  );
  expect(archiving).toHaveLength(0);

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(after.body).stage).toBe("active_client");

  // The manual lifecycle still archives — proving the AI scope is a proposal
  // restriction, not a change to the domain.
  const manual = await api(`/dashboard/api/contacts/${state.contactId}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "archived" }),
  });
  console.log(`[f2c] manual archive -> ${manual.status}`);
  expect([200, 201]).toContain(manual.status);
  const archived = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(archived.body).stage).toBe("archived");

  // And a model cannot move it back out.
  const back = await chat(jwt, [
    { role: "user", content: `Move ${NAME} back to Lead.` },
  ]);
  console.log(`[f2c] from-archived request: ${JSON.stringify(back.slice(0, 260))}`);
  const stillArchived = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(stillArchived.body).stage).toBe("archived");

  // Restore by hand for the remaining tests.
  const restored = await api(`/dashboard/api/contacts/${state.contactId}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "lead" }),
  });
  expect([200, 201]).toContain(restored.status);
});

test("§51 the follow-up consequence is disclosed, then proves true", async () => {
  await refresh();
  // From an open-pipeline stage with a stored follow-up, to one outside it.
  const reply = await chat(jwt, [
    { role: "user", content: `Change the stage of the contact ${NAME} to Lost.` },
  ]);
  console.log(`[f2c] lost request: ${JSON.stringify(reply.slice(0, 260))}`);

  const mine = await pendingFor("Lost");
  expect(mine, "a lost proposal was prepared").toBeTruthy();
  const warnings = mine!.warnings as string[];
  console.log(`[f2c] lost warnings: ${JSON.stringify(warnings)}`);
  expect(warnings.some((w) => /follow-up on .* will be kept/.test(w))).toBe(true);
  expect(warnings.some((w) => /no longer appear in your follow-ups due/.test(w))).toBe(true);

  const executed = await api(`/dashboard/api/ai/actions/${mine!.actionId}/execute`, { method: "POST" });
  expect(executed.status).toBe(200);

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  const contact = contactOf(after.body);
  expect(contact.stage).toBe("lost");
  // Retained, exactly as the card promised — kept, not deleted.
  expect(contact.nextFollowUpDate).toBe("2026-10-02T12:00:00.000Z");
  // …and suppressed, which is the other half of the promise.
  const metrics = await contactMetrics();
  console.log(`[f2c] after lost: nextFollowUpDate=${contact.nextFollowUpDate} (retained) followUpsDue=${metrics.followUpsDue}`);
  expect(metrics.followUpsDue).toBe(0);
});

test("§48 a stage that moved underneath is refused as stale", async () => {
  await refresh();
  // The model is not deterministic: on one run it declined to prepare a
  // perfectly valid transition ("I can't change contact stages from chat"),
  // which is a model wobble rather than a product refusal — the tool was
  // offered and the transition is legal. The staleness mechanic is what this
  // step certifies, so it asks a second time rather than failing on phrasing.
  let mine: Record<string, unknown> | undefined;
  for (const phrasing of [
    `Change the stage of the contact ${NAME} to Contacted.`,
    `Please prepare a stage change for the contact ${NAME} so their stage becomes Contacted.`,
  ]) {
    const reply = await chat(jwt, [{ role: "user", content: phrasing }]);
    console.log(`[f2c] stale setup: ${JSON.stringify(reply.slice(0, 180))}`);
    mine = await pendingFor("Contacted");
    if (mine) break;
  }
  expect(mine, "a proposal was prepared").toBeTruthy();
  state.secondActionId = mine!.actionId as string;

  // Move the stage through the shared domain writer, as a colleague would.
  const manual = await api(`/dashboard/api/contacts/${state.contactId}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "qualified" }),
  });
  expect([200, 201]).toContain(manual.status);

  const stale = await api(`/dashboard/api/ai/actions/${state.secondActionId}/execute`, { method: "POST" });
  console.log(`[f2c] stale confirm -> ${stale.status} ${JSON.stringify(stale.body)}`);
  expect(stale.status).toBe(409);
  expect(stale.body.error).toBe("stale");

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  expect(contactOf(after.body).stage).toBe("qualified");
  console.log(`[f2c] newer stage preserved: qualified`);
});
