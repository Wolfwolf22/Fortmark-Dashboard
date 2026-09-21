/**
 * Contacts (CRM foundation) regression tests — Release D.
 *
 * Behavioural coverage for the pure decisions the contact domain rests on:
 * the shared brokerage actor rules, the contact lifecycle, request shapes,
 * and how a stored contact becomes the screen's lead. Plus structural
 * assertions on migration 0006 (additive, with the party→contact link) and
 * on the routes' order of checks.
 *
 * No database is contacted.
 *
 * Run: npm run test:contacts
 */
import { readFileSync } from "node:fs";
import {
  canCreateOwnedFor,
  canSeeOwned,
  canWriteOwned,
  isPrivileged,
  PRIVILEGED_ROLES,
  type Actor,
} from "../lib/auth/actor.ts";
import {
  activityInputSchema,
  contactStageChangeSchema,
  createContactBaseSchema,
  createContactSchema,
  displayName,
  primaryOpportunity,
  toIntent,
  toLead,
} from "../lib/contacts/domain.ts";
import {
  ALL_CONTACT_STAGES,
  canTransition,
  CONTACT_STAGE_LABELS,
  EXIT_STAGES,
  isContactStage,
  LIFECYCLE_STAGES,
} from "../lib/contacts/stages.ts";
import { contactsDatabaseEnabled } from "../lib/flags.ts";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "../lib/data/types.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}

// --- The flag --------------------------------------------------------------------
check("off when unset", !contactsDatabaseEnabled({}));
check("off without the profile database", !contactsDatabaseEnabled({ CONTACTS_DATABASE_ENABLED: "1" }));
check("on with both", contactsDatabaseEnabled({ CONTACTS_DATABASE_ENABLED: "1", PROFILE_DATABASE_ENABLED: "true" }));

// --- Shared actor rules (used by transactions and contacts alike) ------------------
const AGENT: Actor = { userId: "u-a", role: "agent", brokerageKey: "fortmark" };
const BROKER: Actor = { userId: "u-b", role: "broker", brokerageKey: "fortmark" };
const MEMBER: Actor = { userId: "u-m", role: "member", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "u-a", role: "admin", brokerageKey: "elsewhere" };
check("privileged roles are exactly admin, broker, coordinator",
  PRIVILEGED_ROLES.join(",") === "admin,broker,transaction_coordinator" && isPrivileged(BROKER) && !isPrivileged(AGENT));
check("an agent sees their own record", canSeeOwned(AGENT, { brokerageKey: "fortmark", ownerUserId: "u-a" }));
check("an agent does not see a colleague's", !canSeeOwned(AGENT, { brokerageKey: "fortmark", ownerUserId: "u-b" }));
check("the brokerage boundary comes first", !canSeeOwned(OUTSIDER, { brokerageKey: "fortmark", ownerUserId: "u-a" }));
check("a member may not write", !canWriteOwned(MEMBER, { brokerageKey: "fortmark", ownerUserId: "u-m" }));
check("a broker may create for anyone; an agent only for themselves",
  canCreateOwnedFor(BROKER, "u-a") && canCreateOwnedFor(AGENT, "u-a") && !canCreateOwnedFor(AGENT, "u-b"));

// --- Lifecycle ---------------------------------------------------------------------
check("nine lifecycle stages and two exits", LIFECYCLE_STAGES.length === 9 && EXIT_STAGES.length === 2 && ALL_CONTACT_STAGES.length === 11);
check("every stage has a label", ALL_CONTACT_STAGES.every((s) => CONTACT_STAGE_LABELS[s].length > 0));
check("the screen's stages match the module",
  ALL_CONTACT_STAGES.every((s) => LEAD_STAGE_LABELS[s] !== undefined) && LEAD_STAGES.length === 10 && !LEAD_STAGES.includes("archived"));
check("the DB enum matches", readFileSync("lib/db/migrations/0006_natural_energizer.sql", "utf8").includes(
  `"contact_stage" AS ENUM('lead', 'contacted', 'qualified', 'appointment', 'representation', 'active_client', 'under_contract', 'closed', 'past_client', 'lost', 'archived')`));
check("isContactStage validates", isContactStage("lead") && !isContactStage("Lead") && !isContactStage("new"));
check("any move within the lifecycle is allowed", canTransition("lead", "representation") && canTransition("closed", "past_client") && canTransition("past_client", "lead"));
check("correcting backwards is allowed", canTransition("qualified", "contacted"));
check("any lifecycle stage may be lost or archived", LIFECYCLE_STAGES.every((s) => canTransition(s, "lost") && canTransition(s, "archived")));
check("lost reopens to any lifecycle stage, not to archived", canTransition("lost", "qualified") && !canTransition("lost", "archived"));
check("archived restores only to lead", canTransition("archived", "lead") && !canTransition("archived", "qualified") && !canTransition("archived", "lost"));
check("same stage is not a transition", ALL_CONTACT_STAGES.every((s) => !canTransition(s, s)));

// --- Request shapes --------------------------------------------------------------------
check("a name of some kind is required",
  !createContactSchema.safeParse({ email: "a@b.co" }).success && createContactSchema.safeParse({ preferredName: "Sam" }).success);
check("an email must be an email", !createContactSchema.safeParse({ firstName: "S", email: "nope" }).success);
check("the brokerage and stage cannot be supplied",
  !("brokerageKey" in createContactBaseSchema.shape) && !("stage" in createContactBaseSchema.shape));
check("an opportunity budget is integer cents",
  createContactSchema.safeParse({ firstName: "S", opportunities: [{ kind: "buyer", budgetMaxCents: 150_000_000 }] }).success &&
    !createContactSchema.safeParse({ firstName: "S", opportunities: [{ kind: "buyer", budgetMaxCents: 12.5 }] }).success);
check("an unknown opportunity kind is refused", !createContactSchema.safeParse({ firstName: "S", opportunities: [{ kind: "lead" }] }).success);
check("a stage change takes only a known stage", contactStageChangeSchema.safeParse({ stage: "qualified" }).success && !contactStageChangeSchema.safeParse({ stage: "new" }).success);
check("an activity needs a kind a person logs, and a summary",
  activityInputSchema.safeParse({ kind: "call", summary: "Left a voicemail" }).success &&
    !activityInputSchema.safeParse({ kind: "system", summary: "x" }).success &&
    !activityInputSchema.safeParse({ kind: "call", summary: "" }).success);
check("an activity time must be a datetime", !activityInputSchema.safeParse({ kind: "note", summary: "x", occurredAt: "yesterday" }).success);

// --- Row → screen -----------------------------------------------------------------------
const NOW = new Date("2026-09-21T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", brokerageKey: "fortmark", assignedAgentUserId: "u-a", createdByUserId: "u-a", updatedByUserId: "u-a",
  firstName: "Alex", lastName: "Kaplan", preferredName: null, email: "alex@example.com", phoneE164: "+19545550100", company: null,
  source: "referral", stage: "qualified", tags: [], notes: "Pre-approved.", lastContactAt: new Date("2026-09-15T00:00:00Z"), nextFollowUpAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"), updatedAt: NOW, ...over,
});
const opp = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id, contactId: "c1", kind, status: "open", area: null, budgetMinCents: null, budgetMaxCents: null, timeframe: null, notes: null, transactionId: null,
  createdAt: new Date("2026-09-02T00:00:00Z"), updatedAt: NOW, ...over,
});

check("preferred name wins over legal name", displayName({ firstName: "Alexander", lastName: "Kaplan", preferredName: "Alex" }) === "Alex");
check("legal name when no preferred", displayName({ firstName: "Alexander", lastName: "Kaplan", preferredName: null }) === "Alexander Kaplan");
check("a contact with no name is named as such", displayName({ firstName: null, lastName: null, preferredName: null }) === "Unnamed contact");

check("buyer + seller is both", toIntent([opp("o1", "buyer"), opp("o2", "seller")] as never) === "both");
check("a closed need does not count", toIntent([opp("o1", "buyer"), opp("o2", "seller", { status: "won" })] as never) === "buy");
check("a tenant is leasing", toIntent([opp("o1", "tenant")] as never) === "lease");
check("an investor is investing", toIntent([opp("o1", "investor")] as never) === "invest");
check("no open need is other, not a guess", toIntent([]) === "other" && toIntent([opp("o1", "referral_source")] as never) === "other");
check("the primary need is the newest open one",
  primaryOpportunity([opp("old", "buyer", { createdAt: new Date("2026-01-01") }), opp("new", "seller", { createdAt: new Date("2026-09-10") }), opp("closed", "buyer", { status: "won", createdAt: new Date("2026-09-20") })] as never)?.id === "new");

{
  const lead = toLead({
    row: row() as never,
    opportunities: [opp("o1", "buyer", { area: "Rio Vista", budgetMaxCents: 150_000_000 })] as never,
    agentName: "Dana Reyes",
  });
  check("the lead carries the contact's identity", lead.name === "Alex Kaplan" && lead.email === "alex@example.com" && lead.phone === "+19545550100");
  check("stage and source carry", lead.stage === "qualified" && lead.source === "referral");
  check("intent, area and budget come from the primary need", lead.intent === "buy" && lead.neighborhood === "Rio Vista" && lead.budget === 1_500_000);
  check("last contact is the stamped column", lead.lastContactDate === "2026-09-15T00:00:00.000Z");
  check("the agent's name is carried and the id is the user id", lead.assignedAgentName === "Dana Reyes" && lead.assignedAgentId === "u-a");
  check("the row is marked as a database row", lead.recordSource === "db");
}
{
  const lead = toLead({ row: row({ lastContactAt: null, email: null, phoneE164: null, notes: null }) as never, opportunities: [] });
  check("no touch yet means last contact is creation", lead.lastContactDate === "2026-09-01T00:00:00.000Z");
  check("absent identity fields are empty strings, budget and area absent", lead.email === "" && lead.phone === "" && lead.budget === undefined && lead.neighborhood === undefined && lead.notes === "");
}

// --- Migration 0006 -----------------------------------------------------------------------
{
  const sql = readFileSync("lib/db/migrations/0006_natural_energizer.sql", "utf8");
  check("the migration is registered", readFileSync("lib/db/migrations/meta/_journal.json", "utf8").includes('"tag": "0006_natural_energizer"'));
  check("purely additive", !/DROP (TABLE|TYPE|COLUMN|INDEX)/i.test(sql) && !/ALTER COLUMN/i.test(sql) && !/DELETE FROM/i.test(sql));
  check("three tables are created", ["contacts", "contact_opportunities", "contact_activities"].every((t) => sql.includes(`CREATE TABLE "${t}"`)));
  check("the party→contact link is an added nullable column", sql.includes('ALTER TABLE "transaction_parties" ADD COLUMN "contact_id" uuid;'));
  check("the link unlinks rather than cascades", /transaction_parties_contact_id_contacts_id_fk[\s\S]{0,200}ON DELETE set null/.test(sql));
  check("every contact has a brokerage and an agent", /"brokerage_key" text DEFAULT 'fortmark' NOT NULL/.test(sql) && /"assigned_agent_user_id" uuid NOT NULL/.test(sql));
  check("removing an agent cannot orphan a contact", /contacts_assigned_agent_user_id_dashboard_users_id_fk[\s\S]{0,200}ON DELETE restrict/.test(sql));
  check("needs and history follow their contact",
    /contact_opportunities_contact_id_contacts_id_fk[\s\S]{0,200}ON DELETE cascade/.test(sql) && /contact_activities_contact_id_contacts_id_fk[\s\S]{0,200}ON DELETE cascade/.test(sql));
  check("a need may point at the deal it became, and survives the deal's removal", /contact_opportunities_transaction_id_transactions_id_fk[\s\S]{0,200}ON DELETE set null/.test(sql));
  check("budgets are integer cents", /"budget_max_cents" bigint/.test(sql) && !/numeric|float/i.test(sql));
  check("the build verifies the new tables by name", /RELEASE_D_TABLES = \["contacts", "contact_opportunities", "contact_activities"\]/.test(readFileSync("scripts/migrate.mjs", "utf8")));
  check("the flag is documented", /^CONTACTS_DATABASE_ENABLED=$/m.test(readFileSync(".env.example", "utf8")));
}

// --- Structural: routes, service, adapter ------------------------------------------------
{
  const files = {
    list: "app/api/contacts/route.ts",
    detail: "app/api/contacts/[id]/route.ts",
    stage: "app/api/contacts/[id]/stage/route.ts",
    activities: "app/api/contacts/[id]/activities/route.ts",
    source: "app/api/contacts/source/route.ts",
    agents: "app/api/contacts/agents/route.ts",
  } as const;
  for (const [name, path] of Object.entries(files)) {
    const src = readFileSync(path, "utf8");
    check(`${name} route authenticates first`, src.indexOf("await requireCaller()") < src.indexOf("contactsSource()"));
    check(`${name} route is dynamic and node`, src.includes('export const dynamic = "force-dynamic"') && src.includes('export const runtime = "nodejs"'));
  }
  const service = readFileSync("lib/contacts/service.ts", "utf8");
  check("the service is server-only", service.includes('import "server-only"'));
  check("the service resolves its actor through the shared module", service.includes('from "../auth/actor.ts"') && !/dashboardUsers\.clerkUserId/.test(service));
  check("every query is scoped by visibility", (service.match(/visibleTo\(ctx\.actor\)/g) ?? []).length >= 4);
  check("the brokerage is always the server's", service.includes("brokerageKey: ctx.actor.brokerageKey") && !/brokerageKey: input/.test(service));
  check("a stage change checks the lifecycle before writing", service.indexOf("canTransition(from, to)") < service.indexOf(".update(contacts)"));
  check("logging a touch stamps last contact without moving it backwards", /row\.lastContactAt > occurredAt \? row\.lastContactAt : occurredAt/.test(service));
  check("the agents list never returns emails or Clerk ids", /name: names\.get\(u\.id\)/.test(service) && !/primaryEmail|clerkUserId/.test(service.slice(service.indexOf("export async function listAgents"))));
  check("the agents route is empty for a non-privileged caller", readFileSync(files.agents, "utf8").includes("if (!isPrivileged(actor.ctx.actor))"));
  check("the transactions service now uses the shared actor too",
    /resolveActor as resolveBrokerageActor[^}]*\} from "\.\.\/auth\/actor\.ts"/.test(readFileSync("lib/transactions/service.ts", "utf8")));
  check("a named assignee must be able to own work, in both services",
    /agentUserId !== ctx\.actor\.userId && !\(await canOwnRecords\(ctx\.db, agentUserId\)\)/.test(service) &&
      /agentUserId !== ctx\.actor\.userId && !\(await canOwnRecords\(ctx\.db, agentUserId\)\)/.test(readFileSync("lib/transactions/service.ts", "utf8")) &&
      /status === "active" && user\.role !== "member"/.test(readFileSync("lib/auth/actor.ts", "utf8")));
  check("an invalid assignee is a 400, not a crash", readFileSync("lib/contacts/http.ts", "utf8").includes('"invalid_assignee" }, { status: 400'));
  const adapter = readFileSync("lib/data/adapters/leads.ts", "utf8");
  check("the adapter asks the server which source is live", adapter.includes('"/api/contacts/source"'));
  check("the adapter converts a typed budget to cents", adapter.includes("Math.round(input.budget * 100)"));
  check("a 404 is 'not found', not a failure", /status === 404\) return undefined/.test(adapter));
}

// --- Summary --------------------------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} contact checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
