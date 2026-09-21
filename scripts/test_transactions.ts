/**
 * Transactions foundation regression tests (Release C).
 *
 * Behavioural coverage for the two pure modules the domain rests on — the
 * integer commission arithmetic and the stage machine — plus structural
 * assertions on migration 0005 (additive only, the types and constraints
 * money and dates require) and on the rules that gate the feature.
 *
 * No database is contacted. The service and routes that arrive in the next
 * commits get their own integration coverage; this file pins what they will
 * be built on.
 *
 * Run: npm run test:transactions
 */
import { readFileSync } from "node:fs";
import { transactionsDatabaseEnabled } from "../lib/flags.ts";
import {
  canCreateFor,
  canSee,
  canWrite,
  createTransactionSchema,
  dateToIso,
  primaryClient,
  rollupStatus,
  stageChangeSchema,
  toMilestone,
  toTransaction,
  type Actor,
} from "../lib/transactions/domain.ts";
import { TRANSACTION_STAGES, TRANSACTION_STAGE_LABELS } from "../lib/data/types.ts";
import {
  applyBps,
  BPS_PER_WHOLE,
  centsToDollars,
  dollarsToCents,
  percentToBps,
  projectCommission,
  type CommissionTerms,
} from "../lib/transactions/money.ts";
import {
  ACTIVE_STAGES,
  ALL_STAGES,
  canTransition,
  isActiveStage,
  isStage,
  isTerminalStage,
  nextStage,
  PAUSED_STAGE,
  STAGE_LABELS,
  stageIndex,
  TERMINAL_STAGES,
} from "../lib/transactions/stages.ts";

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

// --- The flag ------------------------------------------------------------------
check("off when unset", !transactionsDatabaseEnabled({}));
check("off without the profile database",
  !transactionsDatabaseEnabled({ TRANSACTIONS_DATABASE_ENABLED: "1" }));
check("on only with both",
  transactionsDatabaseEnabled({ TRANSACTIONS_DATABASE_ENABLED: "true", PROFILE_DATABASE_ENABLED: "1" }));
check("a bad value is off",
  !transactionsDatabaseEnabled({ TRANSACTIONS_DATABASE_ENABLED: "enabled", PROFILE_DATABASE_ENABLED: "1" }));

// --- Money: integers in, integers out ---------------------------------------
check("bps of a whole", BPS_PER_WHOLE === 10_000);
check("3.00% of $1,000,000 is $30,000", applyBps(100_000_000, 300) === 3_000_000);
check("rounding is to the cent", applyBps(333, 3333) === 111); // 110.98 → 111
check("dollars parse to cents", dollarsToCents("1,250,000") === 125_000_000 && dollarsToCents("$99.99") === 9_999 && dollarsToCents(12.345) === 1_235);
check("a negative or garbage amount is refused", dollarsToCents("-5") === null && dollarsToCents("abc") === null);
check("percent parses to bps", percentToBps("2.5") === 250 && percentToBps("3%") === 300 && percentToBps(100) === 10_000);
check("an impossible percent is refused", percentToBps("101") === null && percentToBps("-1") === null);
check("cents display as dollars", centsToDollars(125_000_000) === 1_250_000);

const terms = (over: Partial<CommissionTerms> = {}): CommissionTerms => ({
  contractPriceCents: 125_000_000, // $1,250,000
  commissionRateBps: 300, // 3%
  commissionFlatCents: null,
  agentSplitBps: 7_000, // 70/30
  transactionFeeCents: 49_500, // $495
  referralFeeBps: null,
  ...over,
});

{
  const p = projectCommission(terms());
  check("gross from a rate", p.grossCents === 3_750_000 && p.basis === "rate");
  check("no referral means the net is the gross", p.referralCents === 0 && p.netToBrokerageCents === 3_750_000);
  check("agent share is the split of the net", p.agentShareCents === 2_625_000);
  check("agent net deducts the fee", p.agentNetCents === 2_575_500);
  check("brokerage retains the rest plus the fee", p.brokerageRetainedCents === 1_125_000 + 49_500);
  check("the projection is conserved",
    p.agentNetCents + p.brokerageRetainedCents + p.referralCents === p.grossCents);
}
{
  const p = projectCommission(terms({ referralFeeBps: 2_500 })); // 25% referral
  check("referral comes out of the gross", p.referralCents === 937_500 && p.netToBrokerageCents === 2_812_500);
  check("the agent's share is of the net, not the gross", p.agentShareCents === 1_968_750);
  check("still conserved with a referral",
    p.agentNetCents + p.brokerageRetainedCents + p.referralCents === p.grossCents);
}
{
  const p = projectCommission(terms({ commissionFlatCents: 1_000_000 }));
  check("a flat figure wins over a rate", p.grossCents === 1_000_000 && p.basis === "flat");
}
{
  const p = projectCommission(terms({ commissionRateBps: null }));
  check("no terms project nothing, with the basis saying so", p.grossCents === 0 && p.basis === "none" && p.agentNetCents === 0);
}
{
  const p = projectCommission(terms({ agentSplitBps: null }));
  check("no split means no agent projection, not 100%", p.agentShareCents === 0 && p.brokerageRetainedCents === p.netToBrokerageCents);
}
{
  const p = projectCommission(terms({ transactionFeeCents: 999_999_999 }));
  check("a fee larger than the share cannot go negative", p.agentNetCents === 0);
  check("the brokerage never retains more than the net", p.brokerageRetainedCents <= p.netToBrokerageCents);
}
{
  const p = projectCommission(terms({ contractPriceCents: 12.5 as unknown as number }));
  check("a non-integer amount is treated as absent, never rounded into a deal", p.grossCents === 0 && p.basis === "none");
  const q = projectCommission(terms({ commissionRateBps: -300 }));
  check("a negative rate is treated as absent", q.basis === "none");
  const r = projectCommission(terms({ referralFeeBps: 50_000 }));
  check("a referral above 100% is capped at the whole", r.referralCents === r.grossCents);
}

// --- Stages -----------------------------------------------------------------------
check("six active stages in order",
  ACTIVE_STAGES.join(",") === "opportunity,offer,under_contract,due_diligence,financing,closing_prep");
check("four terminal stages", TERMINAL_STAGES.length === 4 && isTerminalStage("closed") && isTerminalStage("fell_through"));
check("every stage has a label", ALL_STAGES.every((s) => typeof STAGE_LABELS[s] === "string" && STAGE_LABELS[s].length > 0));
check("the DB enum and the module agree",
  ALL_STAGES.length === 11 && readFileSync("lib/db/migrations/0005_broad_sumo.sql", "utf8").includes(
    `"transaction_stage" AS ENUM('opportunity', 'offer', 'under_contract', 'due_diligence', 'financing', 'closing_prep', 'closed', 'cancelled', 'withdrawn', 'on_hold', 'fell_through')`));
check("isStage validates", isStage("offer") && !isStage("Offer") && !isStage(3) && !isStage("bogus"));
check("stageIndex is the path position", stageIndex("opportunity") === 0 && stageIndex("closing_prep") === 5 && stageIndex("closed") === -1 && stageIndex(PAUSED_STAGE) === -1);
check("isActiveStage", isActiveStage("financing") && !isActiveStage("closed") && !isActiveStage("on_hold"));

// Forward.
check("forward one", canTransition("offer", "under_contract"));
check("forward several", canTransition("opportunity", "financing"));
// Back one only.
check("back one", canTransition("financing", "due_diligence"));
check("not back two", !canTransition("financing", "under_contract"));
// Closing.
check("closes only from closing prep", canTransition("closing_prep", "closed") && !canTransition("offer", "closed") && !canTransition("financing", "closed"));
// Terminal exits.
check("any active stage may cancel", ACTIVE_STAGES.every((s) => canTransition(s, "cancelled")));
check("any active stage may fall through", ACTIVE_STAGES.every((s) => canTransition(s, "fell_through")));
check("nothing leaves a terminal stage", TERMINAL_STAGES.every((t) => ALL_STAGES.every((s) => !canTransition(t, s))));
// Hold.
check("any active stage may pause", ACTIVE_STAGES.every((s) => canTransition(s, "on_hold")));
check("a paused deal resumes to any active stage", ACTIVE_STAGES.every((s) => canTransition("on_hold", s)));
check("a paused deal cannot close or cancel directly", !canTransition("on_hold", "closed") && !canTransition("on_hold", "cancelled"));
// No-op.
check("same stage is not a transition", ALL_STAGES.every((s) => !canTransition(s, s)));
check("nextStage walks the path", nextStage("opportunity") === "offer" && nextStage("closing_prep") === "closed" && nextStage("closed") === null && nextStage("on_hold") === null);

// --- Migration 0005: additive, and typed for money and dates ----------------------
{
  const sql = readFileSync("lib/db/migrations/0005_broad_sumo.sql", "utf8");
  const journal = readFileSync("lib/db/migrations/meta/_journal.json", "utf8");
  check("the migration is registered", journal.includes('"tag": "0005_broad_sumo"'));
  check("purely additive — no DROP, no ALTER COLUMN, no DELETE",
    !/DROP (TABLE|TYPE|COLUMN|INDEX)/i.test(sql) && !/ALTER COLUMN/i.test(sql) && !/DELETE FROM/i.test(sql) && !/TRUNCATE/i.test(sql));
  check("four tables are created",
    ["transactions", "transaction_parties", "transaction_deadlines", "transaction_events"].every((t) => sql.includes(`CREATE TABLE "${t}"`)));
  check("money columns are bigint cents, never numeric or float",
    /"contract_price_cents" bigint/.test(sql) && /"commission_flat_cents" bigint/.test(sql) && !/numeric|float|double|real\b/i.test(sql));
  check("rates are integer basis points",
    /"commission_rate_bps" integer/.test(sql) && /"agent_split_bps" integer/.test(sql) && /"referral_fee_bps" integer/.test(sql));
  check("deal dates are dates, not timestamps",
    /"closing_date" date/.test(sql) && /"closed_date" date/.test(sql) && /"due_date" date NOT NULL/.test(sql));
  check("paid money is separate from projected money and nullable",
    /"commission_paid_cents" bigint,/.test(sql) && /"commission_paid_at" timestamp with time zone,/.test(sql));
  check("every deal has a brokerage and an agent",
    /"brokerage_key" text DEFAULT 'fortmark' NOT NULL/.test(sql) && /"agent_user_id" uuid NOT NULL/.test(sql));
  check("removing an agent cannot orphan a deal",
    /transactions_agent_user_id_dashboard_users_id_fk[\s\S]{0,200}ON DELETE restrict/.test(sql));
  check("child rows follow their deal",
    ["transaction_parties", "transaction_deadlines", "transaction_events"].every((t) =>
      new RegExp(`${t}_transaction_id_transactions_id_fk[\\s\\S]{0,200}ON DELETE cascade`).test(sql)));
  check("actors are unlinked, not deleted, with the user",
    /transaction_events_actor_user_id_dashboard_users_id_fk[\s\S]{0,200}ON DELETE set null/.test(sql));
  check("open deadlines have a partial index",
    /transaction_deadlines_open_due_idx[\s\S]{0,120}WHERE "transaction_deadlines"\."completed_at" is null/.test(sql));
  check("the tenant + stage query is indexed", sql.includes('("brokerage_key","stage")'));
  check("the build verifies the new tables by name",
    /RELEASE_C_TABLES[\s\S]{0,300}"transaction_events"/.test(readFileSync("scripts/migrate.mjs", "utf8")));
  check("the flag is documented", /^TRANSACTIONS_DATABASE_ENABLED=$/m.test(readFileSync(".env.example", "utf8")));
  check("the audit catalogue gained the transaction events",
    /"transaction_created",\s*"transaction_updated",\s*"transaction_stage_changed"/.test(readFileSync("lib/db/schema.ts", "utf8")));
}

// --- Authorization: brokerage first, then role, then ownership -----------------
const AGENT: Actor = { userId: "u-agent", role: "agent", brokerageKey: "fortmark" };
const OTHER_AGENT: Actor = { userId: "u-other", role: "agent", brokerageKey: "fortmark" };
const BROKER: Actor = { userId: "u-broker", role: "broker", brokerageKey: "fortmark" };
const TC: Actor = { userId: "u-tc", role: "transaction_coordinator", brokerageKey: "fortmark" };
const MEMBER: Actor = { userId: "u-member", role: "member", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "u-agent", role: "admin", brokerageKey: "another-brokerage" };
const mine = { brokerageKey: "fortmark", agentUserId: "u-agent" };
const theirs = { brokerageKey: "fortmark", agentUserId: "u-other" };

check("an agent sees their own deal", canSee(AGENT, mine));
check("an agent does not see another agent's deal", !canSee(AGENT, theirs));
check("a broker sees every deal in the brokerage", canSee(BROKER, mine) && canSee(BROKER, theirs));
check("a coordinator sees every deal in the brokerage", canSee(TC, theirs));
check("a member sees only their own deals (and owns none)", !canSee(MEMBER, theirs) && canSee(MEMBER, { brokerageKey: "fortmark", agentUserId: "u-member" }));
check("an admin of another brokerage sees nothing here, even with a matching user id", !canSee(OUTSIDER, mine));
check("an agent may change their own deal", canWrite(AGENT, mine));
check("an agent may not change another agent's deal", !canWrite(AGENT, theirs));
check("a member may not change anything", !canWrite(MEMBER, { brokerageKey: "fortmark", agentUserId: "u-member" }));
check("a broker may change any deal", canWrite(BROKER, theirs));
check("an agent may open a deal for themselves only", canCreateFor(AGENT, "u-agent") && !canCreateFor(AGENT, "u-other"));
check("a broker may open a deal for anyone", canCreateFor(BROKER, "u-other"));
check("a member may not open a deal", !canCreateFor(MEMBER, "u-member"));

// --- Request shapes ------------------------------------------------------------------
{
  const good = createTransactionSchema.safeParse({
    transactionType: "residential_sale", side: "buyer", addressLine1: "1 Rio Vista Blvd", city: "Fort Lauderdale",
    contractPriceCents: 125_000_000, commissionRateBps: 300, closingDate: "2026-10-30",
    parties: [{ role: "buyer", displayName: "Alex Kaplan", isPrimary: true }],
  });
  check("a well-formed create parses", good.success);
  check("money must be integer cents", !createTransactionSchema.safeParse({ transactionType: "land", side: "listing", addressLine1: "x", city: "y", contractPriceCents: 12.5 }).success);
  check("a negative amount is refused", !createTransactionSchema.safeParse({ transactionType: "land", side: "listing", addressLine1: "x", city: "y", contractPriceCents: -1 }).success);
  check("a rate above 100% is refused", !createTransactionSchema.safeParse({ transactionType: "land", side: "listing", addressLine1: "x", city: "y", commissionRateBps: 10_001 }).success);
  check("a date must be yyyy-mm-dd", !createTransactionSchema.safeParse({ transactionType: "land", side: "listing", addressLine1: "x", city: "y", closingDate: "10/30/2026" }).success);
  check("an unknown side is refused", !createTransactionSchema.safeParse({ transactionType: "land", side: "list", addressLine1: "x", city: "y" }).success);
  check("the brokerage cannot be supplied", !("brokerageKey" in createTransactionSchema.shape));
  check("the stage cannot be supplied on create", !("stage" in createTransactionSchema.shape));
  check("a stage change takes only a known stage", stageChangeSchema.safeParse({ stage: "closed" }).success && !stageChangeSchema.safeParse({ stage: "done" }).success);
}

// --- Row → screen ---------------------------------------------------------------------
const NOW = new Date("2026-09-21T12:00:00Z");
const ROW = {
  id: "t1", brokerageKey: "fortmark", agentUserId: "u-agent", createdByUserId: "u-agent", updatedByUserId: "u-agent",
  transactionType: "residential_sale", side: "buyer", stage: "financing",
  addressLine1: "2416 NE 26th St", addressLine2: null, city: "Fort Lauderdale", state: "FL", postalCode: "33305", county: null,
  propertySubType: null, listingKey: "key-1", mlsNumber: "A11234567",
  listPriceCents: 129_900_000, offerPriceCents: null, contractPriceCents: 125_000_000,
  commissionRateBps: 300, commissionFlatCents: null, agentSplitBps: 7_000, transactionFeeCents: null, referralFeeBps: null, referralPayee: null,
  commissionPaidCents: null, commissionPaidAt: null,
  contractExecutionDate: "2026-08-15", effectiveDate: null, closingDate: "2026-10-30", closedDate: null, possessionDate: null, cancelledDate: null,
  notes: null, createdAt: new Date("2026-08-15T15:00:00Z"), updatedAt: new Date("2026-08-15T15:00:00Z"),
} as const;
const party = (role: string, name: string, isPrimary = false, id = `p-${name}`) => ({
  id, transactionId: "t1", role, displayName: name, company: null, email: null, phoneE164: null, isPrimary, notes: null, createdAt: NOW,
});
const deadline = (id: string, kind: string, label: string, dueDate: string, completedAt: Date | null = null, sortOrder = 0) => ({
  id, transactionId: "t1", kind, label, dueDate, completedAt, note: null, sortOrder, createdAt: NOW, updatedAt: NOW,
});

check("a date column becomes ISO at midnight UTC", dateToIso("2026-10-30") === "2026-10-30T00:00:00.000Z" && dateToIso(null) === undefined);
check("the client is the primary party for the side",
  primaryClient("buyer", [party("seller", "S"), party("buyer", "B1"), party("buyer", "B2", true)] as never)?.displayName === "B2");
check("without a primary, the first party for the side is the client",
  primaryClient("listing", [party("buyer", "B"), party("seller", "S1"), party("seller", "S2")] as never)?.displayName === "S1");
check("a deal with no client party has none", primaryClient("buyer", [party("seller", "S")] as never) === undefined);

{
  const done = toMilestone(deadline("d1", "inspection", "Inspection", "2026-08-25", new Date("2026-08-24T00:00:00Z")) as never, NOW);
  const late = toMilestone(deadline("d2", "financing", "Loan commitment", "2026-09-17") as never, NOW); // 4 days overdue
  const soon = toMilestone(deadline("d3", "closing", "Closing", "2026-10-30") as never, NOW);
  check("a completed deadline is done", done.state === "done" && done.key === "inspection");
  check("an open past deadline is overdue", late.state === "overdue");
  check("an open future deadline is upcoming", soon.state === "upcoming");
  check("no overdue deadline is on track", rollupStatus("financing", [done, soon], NOW).statusLabel === "On track");
  check("an overdue deadline is at risk", rollupStatus("financing", [done, late, soon], NOW).status === "warn");
  const veryLate = toMilestone(deadline("d4", "appraisal", "Appraisal", "2026-09-01") as never, NOW);
  check("more than a week overdue is off track", rollupStatus("financing", [veryLate], NOW).status === "bad");
  check("closed is neutral and says so", rollupStatus("closed", [veryLate], NOW).statusLabel === "Closed");
  check("an exit stage is neutral and says which", rollupStatus("fell_through", [veryLate], NOW).statusLabel === "Fell through");
  check("on hold is neutral", rollupStatus("on_hold", [veryLate], NOW).status === "neutral");
}
{
  const t = toTransaction({
    row: ROW as never,
    parties: [party("buyer", "Alex Kaplan", true, "p-1"), party("lender", "Coastal Mortgage")] as never,
    deadlines: [
      deadline("d3", "closing", "Closing", "2026-10-30", null, 2),
      deadline("d1", "inspection", "Inspection", "2026-08-25", new Date("2026-08-24T00:00:00Z"), 0),
      deadline("d2", "financing", "Loan commitment", "2026-09-30", null, 1),
    ] as never,
    agentName: "Dana Reyes",
  }, NOW);
  check("money reaches the screen in dollars", t.contractPrice === 1_250_000 && t.commissionRate === 0.03 && t.projectedCommission === 37_500);
  check("the client is the primary buyer", t.clientName === "Alex Kaplan" && t.clientId === "p-1");
  check("dates are ISO", t.contractDate === "2026-08-15T00:00:00.000Z" && t.closeDate === "2026-10-30T00:00:00.000Z");
  check("milestones are in sort order", t.milestones.map((m) => m.key).join(",") === "inspection,financing,closing");
  check("the listing link is the MLS key", t.listingId === "key-1");
  check("the agent's name is carried and the id is the user id", t.agentName === "Dana Reyes" && t.agentId === "u-agent");
  check("the row is marked as a database row", t.source === "db");
  check("status rolls up from the deadlines", t.statusLabel === "On track");

  const bare = toTransaction({ row: { ...ROW, contractPriceCents: null, commissionRateBps: null, contractExecutionDate: null, closingDate: null, listingKey: null } as never, parties: [], deadlines: [] }, NOW);
  check("no price is 0, not a guess", bare.contractPrice === 0 && bare.projectedCommission === 0);
  check("no close date is absent, not invented", bare.closeDate === undefined);
  check("no contract date falls back to creation", bare.contractDate === "2026-08-15T15:00:00.000Z");
  check("no client is a dash", bare.clientName === "—" && bare.clientId === "");
  check("no listing link when unlinked", bare.listingId === undefined);
}
check("the pipeline columns are the active path plus closed",
  TRANSACTION_STAGES.join(",") === "opportunity,offer,under_contract,due_diligence,financing,closing_prep,closed");
check("every stage has a screen label", ALL_STAGES.every((s) => TRANSACTION_STAGE_LABELS[s].length > 0));

// --- Structural: routes and adapter --------------------------------------------------
{
  const list = readFileSync("app/api/transactions/route.ts", "utf8");
  const detail = readFileSync("app/api/transactions/[id]/route.ts", "utf8");
  const stage = readFileSync("app/api/transactions/[id]/stage/route.ts", "utf8");
  const source = readFileSync("app/api/transactions/source/route.ts", "utf8");
  const service = readFileSync("lib/transactions/service.ts", "utf8");
  const adapter = readFileSync("lib/data/adapters/transactions.ts", "utf8");
  for (const [name, src] of [["list", list], ["detail", detail], ["stage", stage], ["source", source]] as const) {
    check(`${name} route authenticates first`, src.indexOf("await requireCaller()") < src.indexOf("transactionsSource()"));
    check(`${name} route is dynamic and node`, src.includes('export const dynamic = "force-dynamic"') && src.includes('export const runtime = "nodejs"'));
  }
  check("the service is server-only", service.includes('import "server-only"'));
  check("every query is scoped by the caller's visibility", (service.match(/visibleTo\(ctx\.actor\)/g) ?? []).length >= 3);
  check("the brokerage is always the server's", service.includes("brokerageKey: ctx.actor.brokerageKey") && !/brokerageKey: input/.test(service));
  check("a named agent is honoured only for a privileged actor", /input\.agentUserId && isPrivileged\(ctx\.actor\)/.test(service));
  check("a stage change checks the lifecycle before writing", service.indexOf("canTransition(from, to)") < service.indexOf(".update(transactions)"));
  check("every write records history", (service.match(/recordEvent\(/g) ?? []).length >= 3);
  check("history metadata is scrubbed", /FORBIDDEN_META/.test(service));
  check("closing stamps the closed date", /closedDate: to === "closed" \? today/.test(service));
  check("out of scope is answered like not found", /reason: "not_found"/.test(service) && stage.includes('status: 404'));
  check("a refused move is 409, not silence", /invalid_transition/.test(stage) && readFileSync("lib/transactions/http.ts", "utf8").includes("status: 409"));
  check("the list route caps its rows", /MAX_LIST_ROWS/.test(service) && /\.limit\(MAX_LIST_ROWS\)/.test(service));
  check("validation errors name fields, never values", /fields \}/.test(list) && !/parsed\.error\.issues\.map\(\(i\) => i\.message/.test(list));
  check("the adapter asks the server which source is live", adapter.includes('"/api/transactions/source"'));
  check("the adapter converts dollars to cents before they leave the browser", adapter.includes("Math.round(input.contractPrice * 100)"));
  check("a refused move surfaces to the board", readFileSync("components/transactions/kanban-board.tsx", "utf8").includes(".catch(() => bumpDataVersion())"));
  check("the drawer labels sample rows", readFileSync("components/transactions/transaction-drawer.tsx", "utf8").includes('txn.source === "sample"'));
  // A cancelled or on-hold deal is a real row that is not a pipeline column.
  check("the board tolerates a deal outside the pipeline columns",
    /if \(column in map\) map\[column\]\.push\(t\);/.test(readFileSync("components/transactions/kanban-board.tsx", "utf8")));
}

// --- Search text never travels in a URL --------------------------------------
//
// A deal search term is a property address: the one a named client is under
// contract on. Same exposure as a contact's name, same treatment.
{
  const listRoute = readFileSync("app/api/transactions/route.ts", "utf8");
  const searchRoute = readFileSync("app/api/transactions/search/route.ts", "utf8");
  const adapter = readFileSync("lib/data/adapters/transactions.ts", "utf8");
  check("the GET path refuses to read a search term", /key === "q" \? null/.test(listRoute));
  check("the adapter sends a search term in a POST body",
    /filters\?\.query[\s\S]{0,200}"\/api\/transactions\/search"[\s\S]{0,120}method: "POST"/.test(adapter));
  check("a search term is never appended to a URL",
    !/p\.set\("q"/.test(adapter) && !/\?q=/.test(adapter));
  check("the private search route authenticates first",
    searchRoute.indexOf("await requireCaller()") < searchRoute.indexOf("request.json()"));
  check("the private search route runs the same authorized service",
    searchRoute.includes("listTransactions(actor.ctx, filters, range)") &&
      searchRoute.includes("actorOrResponse(caller.clerkUserId)"));
  check("both paths share one filter validator",
    listRoute.includes("parseTransactionFilters") && searchRoute.includes("parseTransactionFilters"));
  check("the date window still travels in the URL, being non-identifying",
    /read\("from"\)/.test(readFileSync("lib/transactions/filters.ts", "utf8")));
}

// --- Summary -------------------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} transaction checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
