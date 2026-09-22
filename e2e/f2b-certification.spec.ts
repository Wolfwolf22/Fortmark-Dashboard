import { expect, test } from "@playwright/test";
import { apiFor, chat, CERT_USER_ID, signInCertificationUser } from "./session";

/**
 * F2-B live certification against the deployed Preview.
 *
 * Real Clerk session, real middleware, real allowlist, real actor resolution,
 * real OpenAI, real database. The steps are dependent and share one fixture,
 * so they run serially in one worker.
 *
 * Nothing here is mocked and nothing is relaxed. Where a step cannot be run at
 * this level it is skipped loudly rather than asserted weakly.
 */
test.describe.configure({ mode: "serial" });

let jwt: string;
let api: ReturnType<typeof apiFor>;
const state: { contactId?: string; actionId?: string; secondActionId?: string } = {};

const FIXTURE = { firstName: "F2LIVE", lastName: "Jane Smith" };

test.beforeAll(async ({ browser }) => {
  // Sign-in retries are bounded to fit 600s, not the 180s a hook inherits.
  test.setTimeout(600_000);
  const page = await browser.newPage();
  jwt = await signInCertificationUser(page);
  api = apiFor(jwt);
  await page.close();
});

test("§10/§11 the certification identity resolves to an application actor", async () => {
  // Loading the dashboard shell is the application's own sync path: the app
  // layout calls getShellProfile -> syncCurrentUser, which re-checks the
  // allowlist itself and creates the dashboard_users row for an approved
  // user. No fixture is inserted behind the application's back.
  const shell = await api("/dashboard/", { headers: { Accept: "text/html" } });
  console.log(`[cert] dashboard shell -> ${shell.status}`);

  // Actor resolution now succeeds where it returned no_identity before.
  const contacts = await api("/dashboard/api/contacts");
  console.log(`[cert] contacts -> ${contacts.status} ${JSON.stringify(contacts.body).slice(0, 100)}`);
  expect(contacts.status).toBe(200);
});

test("§12 a temporary contact is created with no follow-up", async () => {
  const created = await api("/dashboard/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...FIXTURE, stage: "lead" }),
  });
  expect(created.status).toBe(201);
  const contact = (created.body.contact ?? created.body.item ?? created.body) as Record<string, unknown>;
  state.contactId = contact.id as string;
  expect(state.contactId).toBeTruthy();
  // The DTO omits the key entirely when no follow-up is set, so assert on the
  // key's presence rather than on a value that would be undefined either way.
  expect(Object.keys(contact)).toContain("stage");
  expect(contact.nextFollowUpDate).toBeUndefined();
  console.log(`[cert] fixture contact created, nextFollowUpDate=${contact.nextFollowUpDate}`);
});

test("§12 the real assistant prepares an action and changes nothing", async () => {
  const reply = await chat(jwt, [
    { role: "user", content: "Schedule a follow-up with F2LIVE Jane Smith next Friday." },
  ]);
  console.log(`[cert] assistant reply: ${JSON.stringify(reply.slice(0, 400))}`);

  // §16 — the assistant must not claim the change happened.
  expect(reply.length).toBeGreaterThan(0);
  expect(reply).toMatch(/prepar|review|confirm/i);
  expect(reply).not.toMatch(/\b(done|scheduled it|i've scheduled|all set|booked)\b/i);

  // A prepared action exists, built by the server.
  const pending = await api("/dashboard/api/ai/actions");
  expect(pending.status).toBe(200);
  const actions = pending.body.actions as Record<string, unknown>[];
  expect(actions.length).toBe(1);
  const action = actions[0];
  state.actionId = action.actionId as string;

  console.log(`[cert] prepared action: ${JSON.stringify({
    type: action.type, status: action.status, summary: action.summary,
    changes: action.changes, confirmationRequired: action.confirmationRequired,
  })}`);

  // §13 — the card's fields come from the server's reading of the record.
  expect(action.type).toBe("contact_followup_schedule");
  expect(action.status).toBe("prepared");
  expect(action.confirmationRequired).toBe(true);
  const changes = action.changes as { field: string; from: string | null; to: string }[];
  expect(changes).toHaveLength(1);
  expect(changes[0].field).toBe("nextFollowUpAt");
  expect(changes[0].from).toBeNull();
  // An absolute date, never "next Friday".
  expect(changes[0].to).toMatch(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/);

  // §12 — nothing mutated by preparation.
  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  const contact = after.body.contact as Record<string, unknown>;
  expect(contact.id).toBe(state.contactId);
  expect(contact.nextFollowUpDate).toBeUndefined();
  console.log(`[cert] contact after prepare: nextFollowUpDate=${contact.nextFollowUpDate}`);
});

test("§14 typing yes in the chat executes nothing", async () => {
  const reply = await chat(jwt, [
    { role: "user", content: "Schedule a follow-up with F2LIVE Jane Smith next Friday." },
    { role: "assistant", content: "I've prepared that follow-up for your review." },
    { role: "user", content: "yes, do it" },
  ]);
  console.log(`[cert] reply to "yes": ${JSON.stringify(reply.slice(0, 300))}`);

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  const contact = after.body.contact as Record<string, unknown>;
  expect(contact.id).toBe(state.contactId);
  expect(contact.nextFollowUpDate).toBeUndefined();

  const one = await api(`/dashboard/api/ai/actions/${state.actionId}`);
  expect((one.body.action as Record<string, unknown>).status).toBe("prepared");
  console.log(`[cert] after "yes": contact unchanged, action still prepared`);
});

test("§15 confirming through the execute route commits the change", async () => {
  const executed = await api(`/dashboard/api/ai/actions/${state.actionId}/execute`, { method: "POST" });
  expect(executed.status).toBe(200);
  expect(executed.body.alreadyExecuted).toBe(false);
  expect((executed.body.action as Record<string, unknown>).status).toBe("executed");

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  const contact = after.body.contact as Record<string, unknown>;
  // Midday UTC on the confirmed day, exactly as the card said.
  expect(contact.nextFollowUpDate).toBe("2026-09-25T12:00:00.000Z");
  console.log(`[cert] after confirm: nextFollowUpDate=${contact.nextFollowUpDate}`);
});

test("§17 a second confirmation schedules nothing twice", async () => {
  const again = await api(`/dashboard/api/ai/actions/${state.actionId}/execute`, { method: "POST" });
  expect(again.status).toBe(200);
  expect(again.body.alreadyExecuted).toBe(true);
  expect((again.body.action as Record<string, unknown>).status).toBe("executed");
  console.log(`[cert] duplicate execute: alreadyExecuted=true, no second mutation`);
});

test("§20 another actor's or a nonexistent action is indistinguishable", async () => {
  const bogus = await api("/dashboard/api/ai/actions/11111111-2222-4333-8444-555555555555/execute", {
    method: "POST",
  });
  expect(bogus.status).toBe(404);
  expect(JSON.stringify(bogus.body)).not.toMatch(/contact|follow|jane|brokerage/i);
  console.log(`[cert] unknown action id -> ${bogus.status} ${JSON.stringify(bogus.body)}`);
});

test("§18 an action prepared against stale state is refused", async () => {
  // Prepare a second action against the contact as it now stands.
  const prepared = await chat(jwt, [
    { role: "user", content: "Change the follow-up for F2LIVE Jane Smith to two weeks from today." },
  ]);
  console.log(`[cert] second prepare reply: ${JSON.stringify(prepared.slice(0, 200))}`);

  const pending = await api("/dashboard/api/ai/actions");
  const actions = pending.body.actions as Record<string, unknown>[];
  expect(actions.length).toBeGreaterThan(0);
  state.secondActionId = actions[actions.length - 1].actionId as string;

  // Move the contact's follow-up through the legitimate domain path, which is
  // exactly what a colleague editing the record would do.
  const logged = await api(`/dashboard/api/contacts/${state.contactId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "call",
      summary: "Spoke with client; moved the follow-up.",
      nextFollowUpAt: "2026-12-01T12:00:00.000Z",
    }),
  });
  console.log(`[cert] domain-path follow-up change -> ${logged.status}`);
  expect([200, 201]).toContain(logged.status);

  // Confirming the older action must refuse and must not overwrite.
  const stale = await api(`/dashboard/api/ai/actions/${state.secondActionId}/execute`, { method: "POST" });
  console.log(`[cert] stale confirm -> ${stale.status} ${JSON.stringify(stale.body)}`);
  expect(stale.status).toBe(409);
  expect(stale.body.error).toBe("stale");

  const after = await api(`/dashboard/api/contacts/${state.contactId}`);
  const contact = after.body.contact as Record<string, unknown>;
  expect(String(contact.nextFollowUpDate)).toContain("2026-12-01");
  console.log(`[cert] newer value preserved: ${contact.nextFollowUpDate}`);
});
