/**
 * Home metrics regression tests — Release E1.
 *
 * The suite exists to defend one property above all others: **a number on the
 * dashboard is a claim about the business, and a source that cannot answer
 * must never produce one.** Several checks below run the real service with a
 * real (absent) database to prove that a failure surfaces as `unavailable`
 * rather than as a confident zero, and that no flag combination lets the
 * sample brokerage stand in for a live domain.
 *
 * The rest covers the arithmetic and the calendar: integer-cent commission
 * through the one implementation of it, month boundaries across year ends and
 * leap years, and the lifecycle definitions that decide what "active" counts.
 *
 * No database is contacted.
 *
 * Run: npm run test:metrics
 */
import { readFileSync } from "node:fs";
import { brokerageMetrics } from "../lib/metrics/service.ts";
import {
  available,
  unavailableAs,
  type BrokerageMetrics,
  type MetricGroup,
} from "../lib/metrics/types.ts";
import {
  dayKey,
  daysUntil,
  monthBucket,
  monthSeries,
  monthWindow,
  monthsBackStart,
  toInt,
} from "../lib/metrics/window.ts";
import { projectCommission } from "../lib/transactions/money.ts";
import { ACTIVE_STAGES, ALL_STAGES, PAUSED_STAGE, TERMINAL_STAGES } from "../lib/transactions/stages.ts";
import {
  ACTIVE_CLIENT_STAGES,
  ALL_CONTACT_STAGES,
  LIFECYCLE_STAGES,
  OPEN_PIPELINE_STAGES,
} from "../lib/contacts/stages.ts";
import { sampleDashboardEnabled } from "../lib/flags.ts";
import { sampleBrokerageMetrics } from "../lib/data/sample-metrics.ts";
import { isFirstUse, leaderboardVisible, mlsIsCompact } from "../lib/metrics/home-layout.ts";
import { DEFAULT_WIDGET_ORDER } from "../lib/stores/widget-order.ts";

/**
 * A file's code, with comments stripped.
 *
 * Absence assertions have to read code, not prose: a comment explaining why a
 * health score is a bad idea contains the word "score", and a test that greps
 * the raw file would fail the very file that got it right.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every widget the Home grid can render, taken from the order itself. */
const HOME_WIDGETS = [...DEFAULT_WIDGET_ORDER];

function widgetSource(id: string): string {
  return readFileSync(`components/home/widgets/${id}.tsx`, "utf8");
}

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

const NOW = new Date("2026-09-21T15:30:00Z");

// --- The calendar ------------------------------------------------------------------
check("the month window is the whole calendar month", (() => {
  const w = monthWindow(NOW);
  return w.start === "2026-09-01" && w.end === "2026-09-30";
})());
check("a 31-day month ends on the 31st", monthWindow(new Date("2026-01-14T00:00:00Z")).end === "2026-01-31");
check("February is 28 days in a common year", monthWindow(new Date("2026-02-05T00:00:00Z")).end === "2026-02-28");
check("February is 29 days in a leap year", monthWindow(new Date("2028-02-05T00:00:00Z")).end === "2028-02-29");
check("the window does not shift with the hour of the run",
  monthWindow(new Date("2026-09-01T00:00:00Z")).start === monthWindow(new Date("2026-09-30T23:59:59Z")).start);
check("the series crosses a year boundary backwards", (() => {
  const series = monthSeries(new Date("2026-02-10T00:00:00Z"), 4);
  return series.join(",") === "2025-11-01,2025-12-01,2026-01-01,2026-02-01";
})());
check("the series is oldest first and ends on this month",
  monthSeries(NOW, 12).length === 12 && monthSeries(NOW, 12)[11] === "2026-09-01");
check("months back agrees with the series", monthsBackStart(NOW, 12) === monthSeries(NOW, 12)[0]);
check("a day maps to its month bucket", monthBucket("2026-09-30") === "2026-09-01");
check("today is zero days away, not overdue", daysUntil("2026-09-21", NOW) === 0);
check("yesterday is overdue by one", daysUntil("2026-09-20", NOW) === -1);
check("a week out is seven", daysUntil("2026-09-28", NOW) === 7);
check("days are whole even late in the day",
  daysUntil("2026-09-22", new Date("2026-09-21T23:59:59Z")) === 1);
check("days cross a month boundary", daysUntil("2026-10-01", NOW) === 10);
check("the day key is the UTC day", dayKey(NOW) === "2026-09-21");

// --- Postgres gives back strings ----------------------------------------------------
check("a bigint sum arrives as a string and becomes a number", toInt("285000000") === 285_000_000);
check("a null sum is zero, not NaN", toInt(null) === 0 && toInt(undefined) === 0);
check("rubbish never becomes NaN", toInt("nonsense") === 0);
check("a large cent total survives", toInt("999999999999") === 999_999_999_999);

// --- Money -------------------------------------------------------------------------
const RATE_DEAL = {
  contractPriceCents: 1_250_000_00,
  commissionRateBps: 250,
  commissionFlatCents: null,
  agentSplitBps: 7000,
  transactionFeeCents: 495_00,
  referralFeeBps: null,
};
check("commission is exact integer cents", projectCommission(RATE_DEAL).grossCents === 3_125_000);
check("commission never drifts into a float",
  Number.isInteger(projectCommission(RATE_DEAL).grossCents) &&
    Number.isInteger(projectCommission(RATE_DEAL).agentNetCents));
check("a deal with no terms projects nothing and says so", (() => {
  const p = projectCommission({
    contractPriceCents: 900_000_00,
    commissionRateBps: null,
    commissionFlatCents: null,
    agentSplitBps: null,
    transactionFeeCents: null,
    referralFeeBps: null,
  });
  return p.grossCents === 0 && p.basis === "none";
})());
check("a missing contract price is not inferred from anything", (() => {
  const p = projectCommission({
    contractPriceCents: null,
    commissionRateBps: 300,
    commissionFlatCents: null,
    agentSplitBps: null,
    transactionFeeCents: null,
    referralFeeBps: null,
  });
  return p.grossCents === 0 && p.basis === "none";
})());
check("summing many deals stays integral", (() => {
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    total += projectCommission({ ...RATE_DEAL, contractPriceCents: 333_333_33 + i }).grossCents;
  }
  return Number.isInteger(total);
})());
check("metrics never re-implement commission arithmetic", (() => {
  const src = readFileSync("lib/transactions/metrics.ts", "utf8");
  return src.includes("projectCommission") && !/commissionRateBps\s*[*\/]/.test(src);
})());

// --- Lifecycle ----------------------------------------------------------------------
check("active excludes every terminal stage",
  TERMINAL_STAGES.every((s) => !(ACTIVE_STAGES as readonly string[]).includes(s)));
check("active excludes on hold", !(ACTIVE_STAGES as readonly string[]).includes(PAUSED_STAGE));
check("closed is terminal, not active",
  (TERMINAL_STAGES as readonly string[]).includes("closed") && ALL_STAGES.length === 11);
check("the metrics module imports the lifecycle rather than listing stages", (() => {
  const src = readFileSync("lib/transactions/metrics.ts", "utf8");
  return (
    src.includes('from "./stages.ts"') &&
    src.includes("ACTIVE_STAGES") &&
    // No hand-written stage list: the one definition wins.
    !/\[\s*"opportunity"\s*,/.test(src)
  );
})());
check("scheduled closings and actual closings are separate figures", (() => {
  const src = readFileSync("lib/transactions/metrics.ts", "utf8");
  return (
    src.includes("scheduledClosingsThisMonth") &&
    src.includes("closedThisMonthCount") &&
    // Scheduled reads the scheduled date; closed reads the closed date.
    /scheduled:[\s\S]{0,400}closingDate/.test(src) &&
    /closedCount:[\s\S]{0,400}closedDate/.test(src)
  );
})());
check("active client is defined once and shared",
  ACTIVE_CLIENT_STAGES.join(",") === "representation,active_client,under_contract" &&
    readFileSync("lib/contacts/metrics.ts", "utf8").includes("ACTIVE_CLIENT_STAGES") &&
    readFileSync("lib/data/sample-metrics.ts", "utf8").includes("ACTIVE_CLIENT_STAGES"));
check("the open pipeline excludes both exits",
  !(OPEN_PIPELINE_STAGES as readonly string[]).includes("lost") &&
    !(OPEN_PIPELINE_STAGES as readonly string[]).includes("archived") &&
    OPEN_PIPELINE_STAGES.every((s) => (LIFECYCLE_STAGES as readonly string[]).includes(s)));
check("closed and past client are not chased for follow-up",
  !(OPEN_PIPELINE_STAGES as readonly string[]).includes("closed") &&
    !(OPEN_PIPELINE_STAGES as readonly string[]).includes("past_client"));
check("every contact stage still has a home", ALL_CONTACT_STAGES.length === 11);
check("follow-up duty comes from a stored date, never from silence", (() => {
  const src = readFileSync("lib/contacts/metrics.ts", "utf8");
  return src.includes("nextFollowUpAt") && !/lastContactAt[\s\S]{0,80}14/.test(src);
})());

// --- Authorization -------------------------------------------------------------------
check("transaction aggregates use the list's own visibility predicate", (() => {
  const src = readFileSync("lib/transactions/metrics.ts", "utf8");
  const uses = src.match(/visibleTo\(ctx\.actor\)/g) ?? [];
  return src.includes('import { visibleTo } from "./service.ts"') && uses.length >= 4;
})());
check("contact aggregates use the list's own visibility predicate", (() => {
  const src = readFileSync("lib/contacts/metrics.ts", "utf8");
  const uses = src.match(/visibleTo\(ctx\.actor\)/g) ?? [];
  return src.includes('import { visibleTo } from "./service.ts"') && uses.length >= 4;
})());
check("no metrics query runs without the predicate", (() => {
  for (const path of ["lib/transactions/metrics.ts", "lib/contacts/metrics.ts"]) {
    const src = code(path);
    // Query builders only — `Array.from` is not a table read.
    const selects = src.match(/^\s*\.from\(/gm) ?? [];
    const guarded = (src.match(/visibleTo\(ctx\.actor\)/g) ?? []).length;
    // agentNames and activeAgentCount are display-name and headcount lookups
    // on the user tables; they carry no brokerage-owned rows, so they are the
    // only reads permitted to run without the ownership predicate.
    const exceptions = (src.match(/^\s*\.from\((?:professionalProfiles|dashboardUsers)\)/gm) ?? []).length;
    if (selects.length - exceptions > guarded) return false;
  }
  return true;
})());
check("the leaderboard refuses a non-privileged caller twice over", (() => {
  const service = readFileSync("lib/metrics/service.ts", "utf8");
  const metrics = readFileSync("lib/transactions/metrics.ts", "utf8");
  return (
    /privileged\s*\?[\s\S]{0,200}not_permitted/.test(service) &&
    /if \(!isPrivileged\(ctx\.actor\)\) return \[\]/.test(metrics)
  );
})());
check("the route authenticates before it aggregates", (() => {
  const src = readFileSync("app/api/metrics/route.ts", "utf8");
  return src.indexOf("await requireCaller()") < src.indexOf("brokerageMetrics(");
})());
check("the caller id comes from the session, never the request", (() => {
  const src = code("app/api/metrics/route.ts");
  return src.includes("caller.clerkUserId") && !/searchParams|req\.|params/.test(src);
})());
check("scope is reported so the screen can name whose numbers these are", (() => {
  const src = readFileSync("lib/metrics/service.ts", "utf8");
  return /scope: privileged \? "brokerage" : "own"/.test(src);
})());

// --- Availability: the core promise ---------------------------------------------------
check("zero and unavailable are different values", (() => {
  const zero: MetricGroup<{ n: number }> = available({ n: 0 });
  const down: MetricGroup<{ n: number }> = unavailableAs("unavailable");
  return zero.availability === "available" && zero.data.n === 0 && down.data === undefined;
})());

/** Flags off. Nothing is configured, so nothing may claim a number. */
const OFF = await brokerageMetrics("user_test", { now: NOW, env: {} });
check("an unconfigured domain reports not_configured, not zero",
  OFF.transactions.availability === "not_configured" && OFF.transactions.data === undefined);
check("an unconfigured contact domain reports not_configured",
  OFF.contacts.availability === "not_configured" && OFF.contacts.data === undefined);
check("an unconfigured MLS is not zero active listings",
  OFF.listings.availability === "not_configured" && OFF.listings.data === undefined);
check("attention and activity degrade with their domains",
  OFF.attention.availability === "not_configured" && OFF.activity.availability === "not_configured");
check("the leaderboard is withheld from a caller with no privileged identity",
  OFF.leaderboard.availability === "not_permitted");
check("the real service never labels itself sample", OFF.source === "database");
check("the reported month is the month the figures cover", OFF.monthStart === "2026-09-01");
check("an unresolved caller is scoped to their own book", OFF.scope === "own");

/**
 * Flags on, no database. This is the failure that matters: the domain is
 * switched on, so the dashboard is expected to show figures, and the source
 * cannot answer. It must say so.
 */
const BROKEN = await brokerageMetrics("user_test", {
  now: NOW,
  env: { PROFILE_DATABASE_ENABLED: "1", TRANSACTIONS_DATABASE_ENABLED: "1", CONTACTS_DATABASE_ENABLED: "1" },
});
check("a configured but unreachable source reports unavailable",
  BROKEN.transactions.availability === "unavailable" && BROKEN.transactions.data === undefined);
check("a configured but unreachable contact source reports unavailable",
  BROKEN.contacts.availability === "unavailable");
check("a broken source never produces a zeroed dashboard",
  BROKEN.transactions.data === undefined && BROKEN.contacts.data === undefined);
check("a broken source never produces sample figures", BROKEN.source === "database");
check("a broken source does not throw the page away",
  typeof BROKEN.generatedAt === "string" && BROKEN.monthStart === "2026-09-01");

// --- Fixture mode ----------------------------------------------------------------------
check("fixture mode is off unless explicitly set to 1",
  !sampleDashboardEnabled({}) &&
    !sampleDashboardEnabled({ SAMPLE_DASHBOARD_ENABLED: "true" }) &&
    !sampleDashboardEnabled({ SAMPLE_DASHBOARD_ENABLED: "yes" }) &&
    sampleDashboardEnabled({ SAMPLE_DASHBOARD_ENABLED: "1" }));
check("the sample payload labels itself", sampleBrokerageMetrics(NOW).source === "sample");
check("even the sample brokerage does not invent an MLS",
  sampleBrokerageMetrics(NOW).listings.availability === "not_configured");
check("the sample payload is internally consistent", (() => {
  const s = sampleBrokerageMetrics(NOW);
  if (s.transactions.availability !== "available") return false;
  const t = s.transactions.data;
  return t.monthly.length === 12 && t.activeCount >= 0 && Number.isInteger(t.activeVolumeCents);
})());
check("a failed live domain can never be replaced by the sample set", (() => {
  const src = readFileSync("app/api/metrics/route.ts", "utf8");
  // Sample may only stand in where BOTH domains are not_configured — never
  // where one is `unavailable`, which is a failure, not an absence.
  return (
    /not_configured"[\s\S]{0,200}not_configured"/.test(src) &&
    !src.includes('=== "unavailable"') &&
    src.indexOf("sampleDashboardEnabled()") < src.indexOf("sampleBrokerageMetrics()")
  );
})());
check("the metrics service cannot reach the sample generators at all", (() => {
  for (const path of ["lib/metrics/service.ts", "lib/transactions/metrics.ts", "lib/contacts/metrics.ts"]) {
    const src = readFileSync(path, "utf8");
    if (/data\/mock|sample-metrics|sample-transactions|sample-leads/.test(src)) return false;
  }
  return true;
})());
check("the browser adapter does not swallow a metrics failure", (() => {
  const src = readFileSync("lib/data/adapters/metrics.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function getBrokerageMetrics"));
  return /throw new MetricsError/.test(fn.slice(0, 400));
})());

// --- The screen -------------------------------------------------------------------------
check("Home asks for metrics exactly once", (() => {
  const provider = readFileSync("components/home/metrics-provider.tsx", "utf8");
  const calls = (provider.match(/getBrokerageMetrics\(\)/g) ?? []).length;
  if (calls !== 1) return false;
  // No widget may fetch its own copy.
  return HOME_WIDGETS.every((w) => !widgetSource(w).includes("getBrokerageMetrics"));
})());
check("no Home widget still reads the generated metric series",
  HOME_WIDGETS.every((w) => !widgetSource(w).includes("getDashboardMetrics")));
check("the invented brokerage goals are gone from Home",
  HOME_WIDGETS.every((w) => !/goal/i.test(code(`components/home/widgets/${w}.tsx`))) &&
    !/goal/i.test(code("components/home/daily-brief.tsx")));
check("every widget renders unavailability through the one shared component",
  HOME_WIDGETS.filter((w) => w !== "featured-listing" && w !== "transactions-table").every((w) =>
    widgetSource(w).includes("MetricState")
  ));
check("Home says out loud when it is showing a sample", (() => {
  const src = readFileSync("components/home/daily-brief.tsx", "utf8");
  return src.includes('metrics.source === "sample"') && src.includes("Sample dashboard");
})());
check("Home does not feature a generated listing", (() => {
  const src = code("components/home/widgets/featured-listing.tsx");
  return (
    /const connected = data\?\.listing\?\.source === "mls"/.test(src) &&
    /!connected \?[\s\S]{0,120}UnavailableBody/.test(src)
  );
})());

// --- Home hierarchy: what the real-data transition forced ---------------------------
check("needs attention leads the page", DEFAULT_WIDGET_ORDER[0] === "compliance");
check("the MLS module cannot lead the page",
  DEFAULT_WIDGET_ORDER[DEFAULT_WIDGET_ORDER.length - 1] === "featured-listing");
check("the headline figures are not reorderable widgets",
  !HOME_WIDGETS.some((id) => ["under-contract", "pipeline-value", "closed"].includes(id)));
check("the removed KPI cards are really gone", (() => {
  for (const gone of ["under-contract", "pipeline-value", "closed"]) {
    try {
      widgetSource(gone);
      return false;
    } catch {
      // Absent, as intended.
    }
  }
  return true;
})());
check("the brief carries the four headline figures", (() => {
  const src = readFileSync("components/home/daily-brief.tsx", "utf8");
  return ["Active transactions", "Pipeline value", "Projected commission", "Active clients"].every(
    (label) => src.includes(`label: "${label}"`)
  );
})());
check("a figure the source cannot state is an em dash, never a zero", (() => {
  const src = code("components/home/daily-brief.tsx");
  return src.includes('{figure.value ?? "—"}') && /value: deals \? /.test(src);
})());
check("the brief does not greet twice", (() => {
  const src = code("components/home/daily-brief.tsx");
  return !/Good morning|Welcome back/.test(src);
})());
check("the brief names the scope it is reporting", (() => {
  const src = readFileSync("components/home/daily-brief.tsx", "utf8");
  return src.includes("scopeLabel(metrics.scope)");
})());
check("the brief is a divided field, not four cards", (() => {
  const src = readFileSync("components/home/daily-brief.tsx", "utf8");
  // Hairline rules drawn by a 1px gap over the border colour; no card shells.
  return src.includes("gap-px border-y border-border bg-border") && !/\bCard\b/.test(src);
})());

// --- Role-aware presentation ---------------------------------------------------------
const WITH_LEADERBOARD = { ...OFF, leaderboard: available([]) } as BrokerageMetrics;
check("an agent is not shown a brokerage leaderboard",
  !leaderboardVisible(OFF) && OFF.leaderboard.availability === "not_permitted");
check("a broker is", leaderboardVisible(WITH_LEADERBOARD));
check("an unresolved payload shows no leaderboard either", !leaderboardVisible(undefined));
check("the MLS module is compact until the MLS is connected",
  mlsIsCompact(OFF) &&
    mlsIsCompact(undefined) &&
    !mlsIsCompact({ ...OFF, listings: available({ activeCount: 3 }) } as BrokerageMetrics));

// --- First use ------------------------------------------------------------------------
const EMPTY_BROKERAGE = {
  ...OFF,
  transactions: available({
    activeCount: 0, onHoldCount: 0, activeVolumeCents: 0, activeVolumeUnpricedCount: 0,
    projectedCommissionCents: 0, projectedCommissionUntermedCount: 0,
    scheduledClosingsThisMonth: 0, closedThisMonthCount: 0, closedThisMonthVolumeCents: 0,
    monthly: monthSeries(NOW, 12).map((month) => ({ month, closedCount: 0, closedVolumeCents: 0, commissionCents: 0 })),
  }),
  contacts: available({
    activeClients: 0, newLeadsThisMonth: 0, followUpsDue: 0,
    lifecycle: LIFECYCLE_STAGES.map((stage) => ({ stage, count: 0 })),
    newLeadsBySource: [],
  }),
} as BrokerageMetrics;
check("a genuinely empty brokerage is offered somewhere to start", isFirstUse(EMPTY_BROKERAGE));
check("one deal is enough to stop offering it", (() => {
  const withDeal = {
    ...EMPTY_BROKERAGE,
    transactions: available({ ...EMPTY_BROKERAGE.transactions.data!, activeCount: 1 }),
  } as BrokerageMetrics;
  return !isFirstUse(withDeal);
})());
check("one contact is enough to stop offering it", (() => {
  const lifecycle = LIFECYCLE_STAGES.map((stage, i) => ({ stage, count: i === 0 ? 1 : 0 }));
  const withContact = {
    ...EMPTY_BROKERAGE,
    contacts: available({ ...EMPTY_BROKERAGE.contacts.data!, lifecycle }),
  } as BrokerageMetrics;
  return !isFirstUse(withContact);
})());
check("a closed deal last spring stops offering it", (() => {
  const monthly = monthSeries(NOW, 12).map((month, i) => ({
    month, closedCount: i === 3 ? 1 : 0, closedVolumeCents: 0, commissionCents: 0,
  }));
  const withHistory = {
    ...EMPTY_BROKERAGE,
    transactions: available({ ...EMPTY_BROKERAGE.transactions.data!, monthly }),
  } as BrokerageMetrics;
  return !isFirstUse(withHistory);
})());
check("an unreachable database is never mistaken for a new brokerage",
  !isFirstUse(BROKEN) && !isFirstUse(OFF));
check("the recent-activity feed reads events, not the audit log", (() => {
  const txn = readFileSync("lib/transactions/metrics.ts", "utf8");
  const contact = readFileSync("lib/contacts/metrics.ts", "utf8");
  return (
    txn.includes("transactionEvents") &&
    contact.includes("contactActivities") &&
    !txn.includes("auditEvents") &&
    !contact.includes("auditEvents")
  );
})());
check("needs-attention has no score, only dated facts", (() => {
  const src = code("components/home/widgets/compliance.tsx");
  return !/score|health|\/100/i.test(src) && src.includes("daysAway");
})());

// --- Focus order matches what is on screen -------------------------------------------
check("the identity card is repositioned in the DOM, never by a CSS order", (() => {
  const src = code("components/home/bento-grid.tsx");
  // A visual-only reorder would leave eleven profile controls first in the tab
  // order while rendering them last on screen.
  return (
    !/\border-(first|last|none|\d)\b/.test(src) &&
    /visible\.slice\(0, 1\)[\s\S]{0,200}fixedLead[\s\S]{0,200}visible\.slice\(1\)/.test(src)
  );
})());
check("the identity card is still permanent", (() => {
  const src = code("components/home/bento-grid.tsx");
  // Rendered outside the sortable list, so there is nothing to drag or persist.
  return /SortableContext items=\{visible\}/.test(src) && !/SortableWidget[^>]*fixedLead/.test(src);
})());

// --- The readiness probe -----------------------------------------------------------------
check("the probe reports sources and nothing else", (() => {
  const src = code("app/api/health/route.ts");
  return (
    src.includes("transactionsSource()") &&
    src.includes("contactsSource()") &&
    src.includes("listingSource()") &&
    // Never a count, a record, or an environment variable.
    !/process\.env|count|rows|DATABASE/.test(src)
  );
})());
check("the probe is reachable without a session", (() => {
  const src = readFileSync("middleware.ts", "utf8");
  return /isPublicRoute = createRouteMatcher\(\[[\s\S]{0,400}"\/api\/health"/.test(src);
})());
check("nothing else was made public", (() => {
  const src = readFileSync("middleware.ts", "utf8");
  const block = src.slice(src.indexOf("createRouteMatcher(["), src.indexOf("]);"));
  const routes = block.match(/"[^"]+"/g) ?? [];
  return routes.length === 2 && routes.includes('"/api/health"') && routes.includes('"/__clerk/(.*)"');
})());

// --- Report -------------------------------------------------------------------------------
console.log(`\n${passed}/${passed + failures.length} metrics checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
