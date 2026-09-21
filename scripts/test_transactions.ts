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

// --- Summary -------------------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} transaction checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
