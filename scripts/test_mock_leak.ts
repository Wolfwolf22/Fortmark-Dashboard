/**
 * The mock-leak invariant.
 *
 * One property, defended from several directions:
 *
 *   **With the fixture flag unset, no normal product surface may source a
 *   business fact from a generator.**
 *
 * FortMark ships screens whose domain was never implemented — calendar,
 * documents, messages, notifications, market activity, the agent roster, the
 * brokerage record, the integration list and every report. Each was built
 * against `lib/data/mock/db.ts`, and for a long time that generator answered
 * in every environment. Certification found the result on a brand-new account
 * with no records at all: a projected GCI of $309.6K, 146 documents, two
 * unread messages from people who do not exist, and a week of appointments.
 * None of it was labelled, and none of it was true.
 *
 * These checks are deliberately about *source selection*, not vocabulary.
 * Grepping for the word "mock" would pass the day someone renames the file.
 * What is asserted here is that the generator is reachable only through an
 * adapter that asks the server first, that the server says no unless the
 * fixture flag is set by name, and that every screen which can be refused
 * renders the refusal instead of a skeleton, a zero, or an empty list.
 *
 * No database and no network is contacted.
 *
 * Run: npm run test:mock-leak
 */
import { readFileSync, readdirSync } from "node:fs";
import { subsystemAvailability, UNBACKED_SUBSYSTEMS } from "../lib/subsystems/config.ts";

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

/** Source with comments stripped, so a sentence about a rule cannot satisfy it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every .ts/.tsx file under the product directories. */
function productFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(dir);
  return out;
}

const FILES = productFiles();

// --- The server's answer ------------------------------------------------------------
// The flag is the only thing that may turn fiction on, and it must be set by
// name. Everything else — unset, empty, "0", "false", a typo, a generous
// "true" — leaves every subsystem saying it is not connected.

check("with no fixture flag, every unbacked subsystem is not_configured", (() => {
  const map = subsystemAvailability({});
  return UNBACKED_SUBSYSTEMS.every((key) => map[key] === "not_configured");
})());

check("the fixture flag must be the exact string 1", (() => {
  const on = subsystemAvailability({ SAMPLE_DASHBOARD_ENABLED: "1" });
  return UNBACKED_SUBSYSTEMS.every((key) => on[key] === "sample");
})());

check("a generous typo does not enable fiction", (() =>
  ["true", "yes", "on", "TRUE", " 1", "0", "", "enabled"].every((value) =>
    UNBACKED_SUBSYSTEMS.every(
      (key) => subsystemAvailability({ SAMPLE_DASHBOARD_ENABLED: value })[key] === "not_configured"
    )
  ))());

check("the subsystem list covers every domain certification found fabricating", (() => {
  const required = [
    "calendar",
    "documents",
    "messages",
    "notifications",
    "market",
    "team",
    "brokerage",
    "integrations",
    "reports",
  ];
  return required.every((key) => (UNBACKED_SUBSYSTEMS as readonly string[]).includes(key));
})());

check("the availability decision reads the established fixture flag, not a new one", (() => {
  const src = code("lib/subsystems/config.ts");
  const envReads = src.match(/env\.[A-Z_]+/g) ?? [];
  return src.includes("sampleDashboardEnabled") && envReads.length === 0;
})());

// --- Reachability -------------------------------------------------------------------
// The generator may be imported by the guarded adapters and by nothing else.
// This is the check that would fail first if someone wired a generated list
// straight into a page again.

const GENERATOR = "lib/data/mock/db.ts";

/**
 * Who may reach the generator.
 *
 * The eight adapters below are the ones this suite guards function by
 * function further down. The four `sample-*` modules are the labelled sample
 * sets for the domains that DO have a real path — leads, listings,
 * transactions and the Home metrics — and each is reached only through code
 * that decides between `db`/`mls` and `sample` first; the check after this
 * one asserts that decision is actually present in every file that reaches
 * them.
 */
const PERMITTED_IMPORTERS = new Set([
  "lib/data/sample-leads.ts",
  "lib/data/sample-listings.ts",
  "lib/data/sample-metrics.ts",
  "lib/data/sample-transactions.ts",
  "lib/data/adapters/agents.ts",
  "lib/data/adapters/calendar.ts",
  "lib/data/adapters/documents.ts",
  "lib/data/adapters/market.ts",
  "lib/data/adapters/messages.ts",
  "lib/data/adapters/metrics.ts",
  "lib/data/adapters/notifications.ts",
  "lib/data/adapters/settings.ts",
]);

// Every spelling of the import counts: relative, aliased, type-only, dynamic.
// The question is reachability, not how the path was written.
const importers = FILES.filter(
  (path) => path !== GENERATOR && /\bmock\/db\b/.test(code(path))
);

check("only the guarded adapters can reach the generator", (() => {
  const strays = importers.filter((path) => !PERMITTED_IMPORTERS.has(path));
  if (importers.length === 0) return false; // the detector itself must work
  if (strays.length) console.log(`      stray importers: ${strays.join(", ")}`);
  return strays.length === 0;
})());

check("every consumer of a labelled sample set decides its source first", (() => {
  // These four domains are real. Their sample sets exist so a deployment can
  // be demonstrated, and every path to one must pass a source decision —
  // otherwise a screen with no database quietly shows the demonstration
  // brokerage, which is the listings bug this codebase already fixed once.
  const SAMPLE_MODULES = ["sample-leads", "sample-listings", "sample-metrics", "sample-transactions"];
  // The deciders this codebase actually has, by name. A file that reaches a
  // sample set without consulting one of them is choosing fiction by default.
  const DECIDES =
    /contactsSource|transactionsSource|sampleListingsEnabled|listingAvailability|availableSource|getListingSource|getLeadSource|getTransactionSource|contactsDatabaseEnabled|transactionsDatabaseEnabled|sampleDashboardEnabled|mlsListingsEnabled/;
  const offenders = FILES.filter((path) => {
    if (SAMPLE_MODULES.some((m) => path.endsWith(`${m}.ts`))) return false;
    const src = code(path);
    if (!SAMPLE_MODULES.some((m) => src.includes(m))) return false;
    return !DECIDES.test(src);
  });
  if (offenders.length) console.log(`      undecided sample consumers: ${offenders.join(", ")}`);
  return offenders.length === 0;
})());

check("the clock is not sample data", (() => {
  // `now()` used to live in the generator, so any module wanting the time had
  // to import the fabricated brokerage to get it.
  const dates = code("lib/dates.ts");
  return (
    dates.includes("export const now") &&
    !dates.includes("mock/db") &&
    !code("components/layout/quick-create-dialog.tsx").includes("mock/db")
  );
})());

// --- The guard on every read ---------------------------------------------------------
// Each exported function that touches the generator must ask the server
// first. Asserted per function, so adding a tenth read to an adapter without
// a guard fails here rather than in production.

const GUARDED: Record<string, string[]> = {
  "lib/data/adapters/calendar.ts": ["getEvents", "getEvent", "createEvent"],
  "lib/data/adapters/documents.ts": ["getDocuments", "updateDocumentStatus", "addDocument"],
  "lib/data/adapters/messages.ts": ["getThreads", "getThread", "sendThreadMessage", "markThreadRead"],
  "lib/data/adapters/notifications.ts": ["getNotifications", "getUnreadCount", "markAllNotificationsRead"],
  "lib/data/adapters/market.ts": ["getMarketActivity", "getComplianceItems"],
  "lib/data/adapters/agents.ts": ["getAgents", "getLeaderboard"],
  "lib/data/adapters/settings.ts": ["getTeam", "getBrokerage", "getIntegrations"],
  "lib/data/adapters/metrics.ts": [
    "getDashboardMetrics",
    "getClosedVolumeSeries",
    "getListToSaleRatio",
    "getMedianDaysOnMarket",
    "getLeadSourceRoi",
  ],
};

for (const [path, fns] of Object.entries(GUARDED)) {
  const src = code(path);
  for (const fn of fns) {
    check(`${fn} asks before it answers`, (() => {
      const at = src.indexOf(`function ${fn}(`);
      if (at === -1) return false;
      const body = src.indexOf("{\n", at);
      // The guard must be the first statement: a read that awaits the
      // generator first has already done the thing it is not allowed to do.
      const first = src.slice(body + 2, body + 200).trimStart();
      return first.startsWith('await requireSubsystem("');
    })());
  }
}

check("getAgent finds nobody rather than inventing somebody", (() => {
  // The one lookup that is allowed to answer outside fixture mode, because
  // "no such generated agent" invents nothing and its callers already fall
  // back to the record's own agent name.
  const src = code("lib/data/adapters/agents.ts");
  const at = src.indexOf("function getAgent(");
  const body = src.indexOf("{\n", at);
  return src.slice(body, body + 160).includes('if (!(await isSampleSubsystem("team"))) return undefined;');
})());

check("the browser never decides this for itself", (() => {
  // The flag is server-only; the adapter must ask the route rather than read
  // a bundled copy of the rule.
  const src = code("lib/data/adapters/subsystems.ts");
  return (
    src.includes('apiPath("/api/subsystems")') &&
    !/process\.env/.test(src) &&
    !src.includes("SAMPLE_DASHBOARD_ENABLED")
  );
})());

check("an unanswered availability question refuses the read", (() => {
  const src = code("lib/data/adapters/subsystems.ts");
  return /catch \{\s*throw new SubsystemUnavailableError/.test(src);
})());

check("the availability route is authenticated and uncacheable", (() => {
  const src = code("app/api/subsystems/route.ts");
  return src.includes("requireCaller") && src.includes("private, no-store");
})());

// --- What the screens do with the refusal ---------------------------------------------
// A refused read that renders as a permanent skeleton is the same failure in
// a different costume: the page still never says what is true.

const SCREENS: [string, string][] = [
  ["app/(app)/messages/page.tsx", "messages"],
  ["app/(app)/calendar/page.tsx", "calendar"],
  ["app/(app)/documents/page.tsx", "documents"],
  ["components/settings/team-section.tsx", "team"],
  ["components/settings/brokerage-section.tsx", "brokerage"],
  ["components/settings/integrations-section.tsx", "integrations"],
];

for (const [path, subsystem] of SCREENS) {
  const src = code(path);
  // Rendered, not merely imported: an unused import satisfies nothing.
  check(`${subsystem} says it is not connected instead of showing nothing`, (() =>
    src.includes("unavailableSubsystem(error)") && /<SubsystemNotConnected\b/.test(src))());
  check(`${subsystem} reads the error, not just the loading flag`, (() =>
    /const \{[^}]*\berror\b[^}]*\} = useQuery/.test(src))());
}

check("Reports decides before it renders five generated cards", (() => {
  const src = code("app/(app)/reports/page.tsx");
  return (
    src.includes('useSubsystem("reports")') &&
    src.includes('state !== "sample"') &&
    /<SubsystemNotConnected\b/.test(src)
  );
})());

check("an unanswered availability question leaves Reports silent", (() => {
  const src = code("components/common/subsystem-state.tsx");
  return /state: !error && data \? data\[subsystem\] : "not_configured"/.test(src);
})());

check("the notification bell carries no count it cannot justify", (() => {
  const src = code("components/layout/notifications-bell.tsx");
  return src.includes("unavailableSubsystem(error)") && src.includes("SUBSYSTEM_COPY.notifications");
})());

check("quick create names the missing subsystem rather than blaming the fields", (() => {
  const src = code("components/layout/quick-create-dialog.tsx");
  return src.includes("unavailableSubsystem(e)") && src.includes("SUBSYSTEM_COPY[missing]");
})());

// --- Fixture mode is labelled ---------------------------------------------------------
// Sample data is permitted. Sample data that looks like the brokerage's own
// is not, which is what the notice on each of these screens is for.

const LABELLED: string[] = [
  "app/(app)/messages/page.tsx",
  "app/(app)/calendar/page.tsx",
  "app/(app)/documents/page.tsx",
  "app/(app)/reports/page.tsx",
  "components/settings/team-section.tsx",
  "components/settings/brokerage-section.tsx",
  "components/settings/integrations-section.tsx",
];

for (const path of LABELLED) {
  check(`${path.split("/").pop()} labels its sample data on screen`, (() =>
    code(path).includes("<SampleDataNotice"))());
}

check("every not-connected sentence names the deployment, not the brokerage", (() => {
  const src = readFileSync("components/common/subsystem-state.tsx", "utf8");
  const copy = src.slice(src.indexOf("SUBSYSTEM_COPY"), src.indexOf("unavailableSubsystem"));
  // "You have no messages" is a claim about the reader's business; "messaging
  // is not connected" is a fact about this deployment. Only the second may
  // appear, and no sentence may state a count.
  return (
    UNBACKED_SUBSYSTEMS.every((key) => copy.includes(`${key}: {`)) &&
    !/\byou have no\b|\bno messages\b|\bnothing yet\b/i.test(copy) &&
    !/\b0\b|\$0/.test(copy)
  );
})());

// --- Report ---------------------------------------------------------------------------
console.log(`\n${passed}/${passed + failures.length} mock-leak checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
