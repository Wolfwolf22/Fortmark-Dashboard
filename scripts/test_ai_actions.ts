/**
 * Prepared-action regression tests (Phase F2-B).
 *
 * F1 asked whether a model could read what it should not. This suite asks the
 * harder question: the model can now propose a change, so what stops a
 * proposal from becoming a change nobody agreed to?
 *
 *   Can the model commit anything?         — the registry, the loop and the
 *                                             chat route are checked for any
 *                                             route to execution.
 *   Can saying "yes" schedule something?   — a turn is run to completion with
 *                                             the model insisting; nothing but
 *                                             a tool call can reach a service,
 *                                             and there is no tool to call.
 *   Can a proposal outlive its facts?      — expiry, single use and the
 *                                             dependency fingerprint.
 *   Can half of it happen?                 — the four writes are asserted to
 *                                             be one batch, not four awaits.
 *   Can a past date be quietly moved?      — every rejection path is exercised.
 *
 * No provider, no key, no network and no database. The parts that genuinely
 * require Postgres — that the batch is a real transaction, that the claim is
 * atomic under a race — cannot be proven here and are proven against a live
 * database in `docs/AI_ACTION_CERTIFICATION.md`. What is asserted here is
 * everything that can be decided from the code and its pure logic, and the
 * suite says plainly which is which.
 *
 * Run: npm run test:ai:actions
 */
import { existsSync, readFileSync } from "node:fs";
import { executeTool, type ToolRequest } from "../lib/ai/tools/execute.ts";
import { findTool, toolsFor, TOOL_NAMES } from "../lib/ai/tools/registry.ts";
import type { ToolContext } from "../lib/ai/tools/types.ts";
import {
  checkFollowUpDay,
  contactDisplayName,
  followUpChange,
  followUpDay,
  followUpFingerprint,
  followUpInstant,
  followUpWarnings,
  formatFollowUpDay,
  FOLLOWUP_ACTION_TYPE,
  MAX_FOLLOWUP_DAYS,
} from "../lib/ai/actions/followup.ts";
import { ACTION_TTL_MS, TERMINAL_ACTION_STATUSES } from "../lib/ai/actions/contract.ts";
import type { ContactRow } from "../lib/db/schema.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

/** Source with comments stripped, so a prose match is never a code match. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const NOW = new Date("2026-09-21T15:00:00.000Z");

/** A contact as the database would hand one back. Values only, no behaviour. */
function contact(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    brokerageKey: "fortmark",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    firstName: "Jane",
    lastName: "Smith",
    preferredName: null,
    stage: "lead",
    nextFollowUpAt: null,
    ...over,
  } as unknown as ContactRow;
}

// =============================================================================
// The date rule (§35)
//
// My product preference, in the user's words: future or current date only, and
// a past date is refused rather than normalised.
// =============================================================================
{
  check("today is allowed", checkFollowUpDay("2026-09-21", NOW).ok === true);
  check("tomorrow is allowed", checkFollowUpDay("2026-09-22", NOW).ok === true);

  const past = checkFollowUpDay("2026-09-20", NOW);
  check("yesterday is refused", past.ok === false);
  check("a past date is refused as past, not quietly moved forward",
    past.ok === false && past.reason === "in_the_past");
  // The distinction that matters: nothing in the module returns a corrected
  // day for a rejected input, so there is no path that could silently advance.
  check("no rejection carries a substitute date",
    past.ok === false && !("day" in past));

  check("a date beyond the horizon is refused",
    (() => {
      const far = new Date(NOW.getTime() + (MAX_FOLLOWUP_DAYS + 2) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const result = checkFollowUpDay(far, NOW);
      return result.ok === false && result.reason === "too_far_ahead";
    })());
  check("the horizon itself is allowed",
    (() => {
      const edge = new Date(NOW.getTime() + (MAX_FOLLOWUP_DAYS - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return checkFollowUpDay(edge, NOW).ok === true;
    })());

  for (const bad of ["not a date", "2026-13-01", "2026-02-31", "09/21/2026", "2026-9-1", "", "2026-09-21T00:00:00Z"]) {
    check(`"${bad}" is refused as unparseable`, (() => {
      const result = checkFollowUpDay(bad, NOW);
      return result.ok === false && result.reason === "unparseable";
    })());
  }

  // Midday UTC is the same calendar day everywhere in the US, so a date does
  // not slide when it is read back in a local zone.
  check("a stored follow-up reads back as the day that was confirmed",
    followUpDay(new Date(followUpInstant("2026-09-25"))) === "2026-09-25");
  for (const zone of ["America/New_York", "America/Los_Angeles", "Pacific/Honolulu"]) {
    check(`the confirmed day is unchanged in ${zone}`,
      new Date(followUpInstant("2026-09-25")).toLocaleDateString("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }) === "09/25/2026");
  }
  check("the date a human confirms is spelled out, never relative",
    formatFollowUpDay("2026-09-25") === "Friday, September 25, 2026");
}

// =============================================================================
// The preview (§36)
//
// What the card says is built by the server from the stored row. It is the
// authority, and the model's prose is not.
// =============================================================================
{
  const change = followUpChange(contact(), "2026-09-25");
  check("the change names the field and both sides",
    change.field === "nextFollowUpAt" && change.to === "Friday, September 25, 2026");
  check("an empty current value is spelled out rather than left blank",
    change.from === null);

  const existing = followUpChange(
    contact({ nextFollowUpAt: new Date("2026-09-23T12:00:00.000Z") }),
    "2026-09-25"
  );
  check("replacing an existing follow-up shows what is being replaced",
    existing.from === "Wednesday, September 23, 2026");

  check("the preferred name wins, as it does everywhere else",
    contactDisplayName(contact({ preferredName: "Janie" })) === "Janie");
  check("a nameless contact is described, not rendered blank",
    contactDisplayName(contact({ firstName: null, lastName: null }) ) === "Unnamed contact");

  // Repository truth: the app permits a follow-up at any stage, so preparation
  // warns instead of inventing a second eligibility rule.
  check("an open-pipeline contact needs no warning",
    followUpWarnings(contact({ stage: "lead" })).length === 0);
  check("a lost contact is prepared with a warning, not refused",
    followUpWarnings(contact({ stage: "lost" })).length === 1);
  check("the warning says the date will save but not surface",
    /saved but will not appear/.test(followUpWarnings(contact({ stage: "archived" }))[0]));
}

// =============================================================================
// The fingerprint (§37)
//
// What the action depends on, and just as importantly what it does not.
// =============================================================================
{
  const base = contact();
  check("an unchanged contact keeps its fingerprint",
    followUpFingerprint(base) === followUpFingerprint(contact()));
  check("changing the follow-up date invalidates the action",
    followUpFingerprint(base) !==
      followUpFingerprint(contact({ nextFollowUpAt: new Date("2026-10-01T12:00:00.000Z") })));
  check("changing the stage invalidates the action",
    followUpFingerprint(base) !== followUpFingerprint(contact({ stage: "lost" })));
  check("a different contact never shares a fingerprint",
    followUpFingerprint(base) !==
      followUpFingerprint(contact({ id: "33333333-3333-4333-8333-333333333333" })));
  // A colleague editing an unrelated field must not invalidate a live proposal.
  check("an unrelated edit does not invalidate the action",
    followUpFingerprint(base) === followUpFingerprint(contact({ firstName: "Janet" })));
  check("the fingerprint discloses nothing about the contact",
    /^[0-9a-f]{64}$/.test(followUpFingerprint(base)) &&
      !followUpFingerprint(base).includes("Jane"));
}

// =============================================================================
// Execution is not something the model can do (§39)
// =============================================================================
{
  const registry = code("lib/ai/tools/registry.ts");
  const loop = code("lib/ai/loop.ts");
  const route = code("app/api/chat/route.ts");
  const service = code("lib/ai/actions/service.ts");

  check("no tool executes, confirms, applies or commits",
    !TOOL_NAMES.some((name) => /execute|confirm|apply|commit|approve/.test(name)));
  check("the assistant's path never calls the commit functions",
    !/executePreparedAction/.test(registry) &&
      !/executePreparedAction/.test(loop) &&
      !/executePreparedAction/.test(route));
  check("the assistant's path never names the actions API",
    !/api\/ai\/actions/.test(registry) && !/api\/ai\/actions/.test(loop) && !/api\/ai\/actions/.test(route));
  check("the proposing tool calls only prepare",
    /prepareFollowup/.test(registry) && !/cancelPreparedAction|executePreparedAction/.test(registry));

  // The tool's own words. A model that reads "prepared, awaiting confirmation"
  // and reports "done" is wrong; a model told "scheduled" would be right to.
  const tool = findTool("prepare_contact_followup", { AI_ACTIONS_ENABLED: "1" })!;
  check("the proposing tool exists when actions are enabled", tool !== undefined);
  check("the tool tells the model it has not scheduled anything",
    /does NOT schedule/.test(tool.description) && /cannot confirm it for them/.test(tool.description));
  check("the tool warns the model against reporting it as done",
    /never say the follow-up is set, booked or done/.test(tool.description));
  check("the tool takes no confirmation argument", (() => {
    const props = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
    return props.length === 2 && props.includes("contact_id") && props.includes("date");
  })());
  check("the tool refuses a smuggled confirmation",
    tool.parse({ contact_id: "c-1", date: "2026-09-25", confirmed: true }).ok === false);
  check("the tool refuses a smuggled scope",
    tool.parse({ contact_id: "c-1", date: "2026-09-25", brokerage_id: "other" }).ok === false);

  // The service is the only writer, and it separates the two verbs completely:
  // preparing cannot reach the contact table at all.
  const prepareBlock = service.slice(
    service.indexOf("export async function prepareFollowup"),
    service.indexOf("export async function getPreparedAction")
  );
  check("preparing writes only the proposal row",
    /insert\(aiPreparedActions\)/.test(prepareBlock) &&
      !/update\(contacts\)/.test(prepareBlock) &&
      !/insert\(contactActivities\)/.test(prepareBlock) &&
      !/\.batch\(/.test(prepareBlock));
  check("preparing writes nothing when the date is refused",
    prepareBlock.indexOf("checkFollowUpDay") < prepareBlock.indexOf("insert(aiPreparedActions)"));
  check("preparing writes nothing when the contact is not visible",
    prepareBlock.indexOf("visibleTo(actor)") < prepareBlock.indexOf("insert(aiPreparedActions)"));
}

// =============================================================================
// Saying "yes" to the model accomplishes nothing (§39)
//
// The strongest form of this test is not a prompt — it is that there is no
// tool to call. A model that has decided to confirm has nothing to confirm
// with, so the turn ends as text and the database is untouched.
// =============================================================================
{
  const ctx: ToolContext = {
    clerkUserId: "user_test",
    env: { AI_ACTIONS_ENABLED: "1" },
    now: NOW,
    traceId: "testtrace",
  };
  const attempt = (name: string, input: unknown = {}): ToolRequest => ({ id: "tu_1", name, input });

  // Every name a model might reach for after a user types "yes".
  const GUESSES = [
    "execute_action",
    "confirm_action",
    "apply_action",
    "commit_action",
    "set_followup",
    "update_contact",
    "schedule_followup",
    "confirm_contact_followup",
    "execute_prepared_action",
    "prepare_contact_followup_execute",
  ];
  const outcomes = await Promise.all(
    GUESSES.map(async (name) => [name, await executeTool(attempt(name), ctx)] as const)
  );
  for (const [name, execution] of outcomes) {
    check(`"${name}" does not exist, even with actions enabled`,
      execution.outcome.ok === false && execution.outcome.error === "unknown_tool");
  }

  // And the one tool that does exist reports its own result as not applied, so
  // a model relaying it truthfully cannot claim the change happened.
  const src = code("lib/ai/tools/registry.ts");
  check("the proposing tool's result says it was not applied",
    /prepared: true,\s*applied: false,/.test(src));
  check("the proposing tool's result says what it is waiting for",
    /awaiting: "This is waiting for the user to confirm it/.test(src));
}

// =============================================================================
// The registry guard (§40)
//
// This is the assertion that fails if a future phase adds an execution tool.
// =============================================================================
{
  const types = code("lib/ai/tools/types.ts");
  check("a tool's effect can only be read or propose",
    /export type ToolEffect = "read" \| "propose";/.test(types));
  check("no tool declares anything else",
    toolsFor({ AI_ACTIONS_ENABLED: "1" }).every((tool) => tool.effect === "read" || tool.effect === "propose"));
  check("exactly one tool proposes",
    toolsFor({ AI_ACTIONS_ENABLED: "1" }).filter((tool) => tool.effect === "propose").length === 1);
  check("the one proposing tool is the follow-up one",
    toolsFor({ AI_ACTIONS_ENABLED: "1" }).find((tool) => tool.effect === "propose")!.name ===
      "prepare_contact_followup");

  // Flag off: the tool is not offered, and not dispatchable either. Both
  // matter — advertising and dispatch are separate doors.
  const off = toolsFor({});
  check("actions off: no proposing tool is offered",
    off.length === 9 && off.every((tool) => tool.effect === "read"));
  check("actions off: the proposing tool cannot be dispatched",
    findTool("prepare_contact_followup", {}) === undefined);
  check("actions off: a read tool is still dispatched",
    findTool("get_contact", {}) !== undefined);
  check("the flag is strict: only \"1\" enables actions",
    toolsFor({ AI_ACTIONS_ENABLED: "true" }).length === 9 &&
      toolsFor({ AI_ACTIONS_ENABLED: "0" }).length === 9 &&
      toolsFor({ AI_ACTIONS_ENABLED: " 1 " }).length === 9);
}

// =============================================================================
// Provider parity (§41)
//
// Both vendors see the same tools, or neither does. A capability that exists
// on one provider and not the other is a capability nobody reviewed twice.
// =============================================================================
{
  const { toolDefinitions: anthropicTools } = await import("../lib/ai/providers/anthropic.ts");
  const { toolDefinitions: openaiTools } = await import("../lib/ai/providers/openai.ts");

  for (const [label, env] of [["on", { AI_ACTIONS_ENABLED: "1" }], ["off", {}]] as const) {
    const registry = toolsFor(env);
    const a = anthropicTools(registry);
    const o = openaiTools(registry);
    check(`actions ${label}: both vendors are offered the same tools`,
      JSON.stringify(a.map((t) => t.name)) === JSON.stringify(o.map((t) => t.name)));
    check(`actions ${label}: both vendors see the proposing tool the same way`,
      a.some((t) => t.name === "prepare_contact_followup") ===
        o.some((t) => t.name === "prepare_contact_followup"));
    check(`actions ${label}: neither vendor is offered an execution tool`,
      ![...a.map((t) => t.name), ...o.map((t) => t.name)].some((n) => /execute|confirm|commit/.test(n)));
  }

  check("actions off: the proposing tool is on neither wire",
    !anthropicTools(toolsFor({})).some((t) => t.name === "prepare_contact_followup") &&
      !openaiTools(toolsFor({})).some((t) => t.name === "prepare_contact_followup"));
}

// =============================================================================
// Execution re-establishes everything preparation concluded (§37)
//
// Source-level, because the behaviour needs a database. The live proof is in
// docs/AI_ACTION_CERTIFICATION.md; what is checked here is that the code has
// the shape those live tests assume.
// =============================================================================
{
  const service = code("lib/ai/actions/service.ts");
  const block = service.slice(service.indexOf("export async function executePreparedAction"));

  check("execution claims the action conditionally, from prepared",
    /update\(aiPreparedActions\)[\s\S]{0,200}status: "executing"[\s\S]{0,400}eq\(aiPreparedActions\.status, "prepared"\)/.test(block));
  check("the claim is scoped to the caller and their brokerage",
    /eq\(aiPreparedActions\.actorUserId, actor\.userId\)/.test(block) &&
      /eq\(aiPreparedActions\.brokerageKey, actor\.brokerageKey\)/.test(block));
  check("the claim refuses an expired action in the same statement",
    /expiresAt\} > \$\{ctx\.now\}/.test(block));
  check("execution re-reads the contact under the visibility predicate",
    /from\(contacts\)[\s\S]{0,200}visibleTo\(actor\)/.test(block));
  check("execution recomputes the fingerprint and refuses a stale action",
    /followUpFingerprint\(contact\) !== claimed\.expectedFingerprint/.test(block) &&
      /reason: "stale"/.test(block));
  check("execution takes its instruction from the row, not from a request",
    /claimed\.payload as \{ followUpAt: string; day: string \}/.test(block));

  // The action id is the idempotency key: the claim can succeed once, and the
  // second caller is told the truth about the first.
  check("a second confirmation returns the first result rather than repeating it",
    /case "executed":[\s\S]{0,300}alreadyExecuted: true/.test(service));
  check("a cancelled or stale action is refused by name",
    /case "cancelled":[\s\S]{0,120}already_cancelled/.test(service) &&
      /case "stale":[\s\S]{0,120}reason: "stale"/.test(service));
}

// =============================================================================
// All of it, or none of it (§38)
// =============================================================================
{
  const service = code("lib/ai/actions/service.ts");
  const batch = service.slice(service.indexOf("await db.batch(["), service.indexOf("} catch {", service.indexOf("await db.batch([")));

  check("the four writes are one batch, not four awaits",
    batch.includes("db.batch([") &&
      (batch.match(/\bawait\b/g) ?? []).length === 1);
  check("the batch updates the contact", /update\(contacts\)[\s\S]{0,200}nextFollowUpAt: followUpAt/.test(batch));
  check("the batch records the CRM activity", /insert\(contactActivities\)/.test(batch));
  check("the batch writes the audit event", /insert\(auditEvents\)/.test(batch));
  check("the batch transitions the action to executed",
    /update\(aiPreparedActions\)[\s\S]{0,160}status: "executed"/.test(batch));

  // If the transaction rolls back, nothing may claim otherwise.
  const after = service.slice(service.indexOf("await db.batch(["));
  check("a rolled-back batch marks the action failed, never executed",
    /catch \{[\s\S]{0,400}release\(db, actionId, "failed"/.test(after));
  check("a rolled-back batch reports failure to the caller",
    /catch \{[\s\S]{0,500}return \{ ok: false, reason: "unavailable" \}/.test(after));
}

// =============================================================================
// The audit record names the human (§33) and carries no PII (§34)
// =============================================================================
{
  const service = code("lib/ai/actions/service.ts");

  check("the audit event's actor is the confirming user, not the model",
    /insert\(auditEvents\)[\s\S]{0,200}actorUserId: actor\.userId/.test(service));
  check("the audit event records that it was AI-assisted",
    /mechanism: "ai_assisted"/.test(service));
  check("the audit event links back to the proposal",
    /preparedActionId: actionId/.test(service));
  check("the audit event uses a declared event type",
    /eventType: "contact_updated"/.test(service));
  check("audit metadata goes through the shared scrubber",
    /safeMetadata: scrubMetadata\(\{/.test(service));

  // §34: no contact name, no email, no phone, no follow-up date, no payload.
  const logs = [...service.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map((m) => m[1]).join(" ");
  check("the action service logs no contact detail",
    !/contact\.|displayName|firstName|lastName|email|phone|payload|day|followUpAt/.test(logs));
  const httpLogs = [...code("lib/ai/actions/http.ts").matchAll(/console\.\w+\(([\s\S]*?)\);/g)]
    .map((m) => m[1])
    .join(" ");
  check("the action routes log an error's name and nothing else",
    /error\.name/.test(httpLogs) && !/error\.message|\berror\b\}/.test(httpLogs));
}

// =============================================================================
// The routes (§25-§30)
// =============================================================================
{
  const ROUTES = {
    list: "app/api/ai/actions/route.ts",
    one: "app/api/ai/actions/[id]/route.ts",
    execute: "app/api/ai/actions/[id]/execute/route.ts",
    cancel: "app/api/ai/actions/[id]/cancel/route.ts",
  };
  for (const [name, path] of Object.entries(ROUTES)) {
    check(`the ${name} route exists`, existsSync(path));
    const src = code(path);
    check(`the ${name} route authenticates its caller`, /requireCaller\(\)/.test(src));
    check(`the ${name} route is never cached`,
      /NO_STORE/.test(src) && /dynamic = "force-dynamic"/.test(src));
  }

  const execute = code(ROUTES.execute);
  check("the execute route reads nothing from its body", !/request\.json\(\)/.test(execute));
  check("the execute route accepts only an id, and validates its shape",
    /ID_SHAPE\.test\(id\)/.test(execute));
  check("the execute route takes no actor, brokerage or contact from the caller",
    !/brokerage|contactId|contact_id|actorUserId|userId/.test(execute));
  check("the execute route distinguishes a retry from a first commit",
    /alreadyExecuted/.test(execute));

  // The browser is told what is pending by the server, not by the model.
  const list = code(ROUTES.list);
  check("the pending list is scoped by the service, not by a query parameter",
    !/searchParams/.test(list) && /listPendingActions/.test(list));

  const http = code("lib/ai/actions/http.ts");
  check("an unconfigured deployment does not advertise the endpoint",
    /case "not_configured":[\s\S]{0,140}status: 404/.test(http));
  check("another actor's action is indistinguishable from a missing one",
    /case "not_found":[\s\S]{0,140}status: 404/.test(http));
  check("expiry, staleness and cancellation are told apart for the user",
    /case "expired":[\s\S]{0,140}status: 409/.test(http) &&
      /case "stale":[\s\S]{0,140}status: 409/.test(http) &&
      /case "already_cancelled":[\s\S]{0,140}status: 409/.test(http));
}

// =============================================================================
// The row itself (§13-§16)
// =============================================================================
{
  const schema = readFileSync("lib/db/schema.ts", "utf8");
  const table = schema.slice(schema.indexOf("export const aiPreparedActions"), schema.indexOf("export type AiPreparedActionRow"));

  check("the action row is scoped to a brokerage and an actor",
    /brokerageKey/.test(table) && /actorUserId/.test(table));
  check("the action row stores what it depends on",
    /expectedFingerprint/.test(table));
  check("the action row expires", /expiresAt/.test(table));
  check("an action expires in ten minutes", ACTION_TTL_MS === 10 * 60 * 1000);
  check("the row records why it failed, for the person who confirmed it",
    /failureReason/.test(table));

  // §12: no model reasoning, no conversation, no credentials.
  check("the action row stores no model reasoning or conversation",
    !/reasoning|transcript|conversation|messages|prompt|apiKey|token/i.test(table));

  check("every ending is terminal",
    TERMINAL_ACTION_STATUSES.includes("executed") &&
      TERMINAL_ACTION_STATUSES.includes("cancelled") &&
      TERMINAL_ACTION_STATUSES.includes("expired") &&
      !TERMINAL_ACTION_STATUSES.includes("prepared"));
  check("the action type is the one that was authorized",
    FOLLOWUP_ACTION_TYPE === "contact_followup_schedule");

  // §51: this phase does not retrofit other mutations.
  const statuses = schema.slice(schema.indexOf('pgEnum("ai_action_status"'), schema.indexOf("export const aiPreparedActions"));
  check("no other mutation was retrofitted into this phase",
    !/stage_change|assignment|email|document/i.test(statuses));
}

// =============================================================================
// The confirmation surface (§24, §26-§29)
//
// The card is the thing a person consents to, so what it may be built from is
// as much a security property as anything on the server.
// =============================================================================
{
  const card = code("components/ai/action-card.tsx");
  const page = code("app/(app)/ai/page.tsx");
  const client = code("lib/ai/actions/client.ts");

  // The property this whole design turns on: no authoritative field is ever
  // parsed out of the model's prose.
  check("the thread asks the server what is pending",
    /fetchPendingActions/.test(page) && /api\/ai\/actions/.test(client));
  check("the thread parses no action out of the assistant's text",
    !/JSON\.parse/.test(page) && !/action/i.test(page.slice(page.indexOf("for await"), page.indexOf("if (!text)"))));
  check("the card renders only fields the server supplied",
    /action\.summary/.test(card) && /action\.changes/.test(card) && /action\.warnings/.test(card));

  // Consent has to be informed and deliberate.
  check("the card shows what the value is changing from",
    /change\.from \?\? "No follow-up scheduled"/.test(card));
  check("the card shows what the value is changing to", /change\.to/.test(card));
  check("the card surfaces the server's warnings", /action\.warnings\.map/.test(card));
  check("the card says nothing has happened yet",
    /Nothing changes until you confirm it/.test(card));
  check("confirming is an explicit press, with declining equally reachable",
    /onClick=\{\(\) => void run\("confirmed"\)\}/.test(card) &&
      /onClick=\{\(\) => void run\("declined"\)\}/.test(card) &&
      /: "Confirm"\}/.test(card) && /: "Decline"\}/.test(card));
  check("neither choice is pre-selected or auto-fired",
    !/autoFocus/.test(card) && !/useEffect\([^)]*confirmAction/.test(card));

  // An expired or refused proposal must never read as success.
  check("an expired card stops offering a button",
    /expired \?/.test(card) && /This suggestion expired/.test(card));
  check("a declined card states that nothing changed",
    /Declined\. Nothing was changed/.test(card));
  check("a refused confirmation is shown, not swallowed",
    /role="alert"/.test(card) && /setError\(/.test(card));
  check("the card never reports success on a failed confirmation", (() => {
    const run = card.slice(card.indexOf("async function run("), card.indexOf("const done ="));
    // setSettled is reached only on the success path, before the catch.
    return run.indexOf("setSettled(choice)") < run.indexOf("} catch");
  })());

  // The request carries an id and nothing else.
  check("confirming sends only the action id",
    /confirmAction[\s\S]{0,400}method: "POST"/.test(client) &&
      !/body: JSON\.stringify/.test(client));
  check("the browser fetches through the basePath-aware helper",
    /apiPath\(/.test(client) && !/fetch\("\/api/.test(client));
  check("expiry, staleness and cancellation each get their own wording",
    /expired:/.test(client) && /stale:/.test(client) && /cancelled:/.test(client));
}

// --- Report ------------------------------------------------------------------

console.log(`\n${passed}/${passed + failures.length} AI action checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
