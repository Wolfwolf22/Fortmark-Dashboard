/**
 * Unified search regression tests — Release E2.
 *
 * Search is a data-access endpoint wearing a text box, so the suite leans
 * hardest on the two ways it could betray that: returning a record the caller
 * may not see, and reporting "nothing found" when in truth nothing was
 * searched. Several checks run the real service with a real (absent) database
 * to prove a failing provider degrades to `unavailable` rather than to an
 * empty result.
 *
 * The rest covers the pure decisions — how a query is classified, how results
 * are ordered — and structural guarantees that every provider carries the
 * ownership predicate and that no sample generator is reachable from the
 * search path.
 *
 * No database is contacted.
 *
 * Run: npm run test:search
 */
import { readFileSync } from "node:fs";
import { search } from "../lib/search/service.ts";
import {
  escapeLike,
  containsPattern,
  isTooLong,
  normalizeQuery,
  parseQuery,
  prefixPattern,
} from "../lib/search/query.ts";
import { compareHits, ENTITY_ORDER, isExact, rankHits, topResult } from "../lib/search/rank.ts";
import {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  MIN_REMOTE_QUERY_LENGTH,
  PROVIDER_LIMIT,
  type SearchHit,
} from "../lib/search/types.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
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

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  id: "1",
  entity: "contact",
  title: "Jane Smith",
  href: "/leads?open=1",
  match: "partial",
  ...over,
});

// --- Reading the query --------------------------------------------------------------
check("whitespace is collapsed and trimmed", normalizeQuery("  2451   Brickell  ") === "2451 Brickell");
check("a tab is whitespace too", normalizeQuery("jane\tsmith") === "jane smith");
check("an email is recognised", parseQuery("Jane@Example.com ").shape === "email");
check("an email is lower-cased for comparison", parseQuery("Jane@Example.COM").lower === "jane@example.com");
check("a formatted phone is recognised and reduced to digits", (() => {
  const q = parseQuery("(954) 555-0100");
  return q.shape === "phone" && q.digits === "9545550100";
})());
check("a bare phone is recognised", parseQuery("9545550100").shape === "phone");
check("an international phone is recognised", parseQuery("+1 954 555 0100").shape === "phone");
check("a house number is not a phone number", parseQuery("2451").shape === "text");
check("a sixteen-digit run is not a phone number", parseQuery("1234567890123456").shape === "text");
check("an MLS number is recognised and upper-cased", (() => {
  const q = parseQuery("a12008414");
  return q.shape === "mls" && q.mls === "A12008414";
})());
check("a uuid is recognised", parseQuery("3f2504e0-4f89-41d3-9a0c-0305e82c3301").shape === "uuid");
check("an address is text", parseQuery("2451 Brickell Ave").shape === "text");
check("an over-long query is refused, not truncated",
  isTooLong("x".repeat(MAX_QUERY_LENGTH + 1)) && !isTooLong("x".repeat(MAX_QUERY_LENGTH)));

// --- LIKE injection -----------------------------------------------------------------
check("a percent sign cannot become a wildcard", escapeLike("100%") === "100\\%");
check("an underscore cannot become a wildcard", escapeLike("a_b") === "a\\_b");
check("a backslash is escaped", escapeLike("a\\b") === "a\\\\b");
check("a query of only wildcards cannot match everything",
  containsPattern("%%%") === "%\\%\\%\\%%" && prefixPattern("%") === "\\%%");

// --- Ranking ------------------------------------------------------------------------
check("exact beats prefix beats partial", (() => {
  const ranked = rankHits([
    hit({ id: "c", match: "partial", title: "C" }),
    hit({ id: "a", match: "exact_email", title: "A" }),
    hit({ id: "b", match: "prefix", title: "B" }),
  ]);
  return ranked.map((h) => h.id).join("") === "abc";
})());
check("identifier strength orders the exact matches", (() => {
  const ranked = rankHits([
    hit({ id: "mls", match: "exact_mls" }),
    hit({ id: "id", match: "exact_id" }),
    hit({ id: "phone", match: "exact_phone" }),
    hit({ id: "email", match: "exact_email" }),
  ]);
  return ranked.map((h) => h.id).join(",") === "id,email,phone,mls";
})());
check("people win a tie with deals", (() => {
  const ranked = rankHits([
    hit({ id: "t", entity: "transaction", match: "prefix", title: "A" }),
    hit({ id: "c", entity: "contact", match: "prefix", title: "A" }),
  ]);
  return ranked[0].entity === "contact";
})());
check("ties break on title, then id — never on arrival order", (() => {
  const a = hit({ id: "2", title: "Same" });
  const b = hit({ id: "1", title: "Same" });
  return compareHits(a, b) > 0 && rankHits([a, b])[0].id === "1";
})());
check("ranking is stable across repeated calls", (() => {
  const input = [hit({ id: "b", title: "X" }), hit({ id: "a", title: "X" }), hit({ id: "c", title: "W" })];
  return JSON.stringify(rankHits(input)) === JSON.stringify(rankHits(rankHits(input)));
})());
check("ranking does not mutate its input", (() => {
  const input = [hit({ id: "b" }), hit({ id: "a" })];
  rankHits(input);
  return input[0].id === "b";
})());
check("only an identifier match is exact",
  isExact("exact_id") && isExact("exact_mls") && !isExact("prefix") && !isExact("partial"));
check("a lone exact match is promoted", (() => {
  const ranked = rankHits([hit({ id: "a", match: "exact_email" }), hit({ id: "b", match: "prefix" })]);
  return topResult(ranked)?.id === "a";
})());
check("two equally exact matches promote neither", (() => {
  const ranked = rankHits([
    hit({ id: "a", match: "exact_email" }),
    hit({ id: "b", match: "exact_email", title: "Zed" }),
  ]);
  return topResult(ranked) === undefined;
})());
check("a merely good match is never promoted",
  topResult(rankHits([hit({ match: "prefix" })])) === undefined);
check("nothing is promoted out of nothing", topResult([]) === undefined);
check("groups render people first", ENTITY_ORDER[0] === "contact");

// --- Availability, against the real service -----------------------------------------
const OFF = await search("user_test", "jane", { env: {} });
check("an unconfigured domain reports not_configured, not an empty answer",
  OFF.providers.contact === "not_configured" && OFF.providers.transaction === "not_configured");
check("an unconfigured MLS is not an empty market", OFF.providers.listing === "not_configured");
check("nothing is returned when nothing could be searched", OFF.hits.length === 0);
check("the server echoes the query it actually ran", OFF.query === "jane");

const BROKEN = await search("user_test", "jane", {
  env: { PROFILE_DATABASE_ENABLED: "1", CONTACTS_DATABASE_ENABLED: "1", TRANSACTIONS_DATABASE_ENABLED: "1" },
});
check("a configured but unreachable domain reports unavailable",
  BROKEN.providers.contact === "unavailable" && BROKEN.providers.transaction === "unavailable");
check("an unreachable domain returns no invented rows", BROKEN.hits.length === 0);
check("a failing provider does not throw the request away", typeof BROKEN.query === "string");

const SHORT = await search("user_test", "j", {
  env: { PROFILE_DATABASE_ENABLED: "1", CONTACTS_DATABASE_ENABLED: "1" },
});
check("a one-character query never reaches a provider", SHORT.hits.length === 0);
check("but the palette is still told what is connected",
  SHORT.providers.contact === "available" && SHORT.providers.listing === "not_configured");
check("the minimum is two characters, and the MLS asks for three",
  MIN_QUERY_LENGTH === 2 && MIN_REMOTE_QUERY_LENGTH > MIN_QUERY_LENGTH);
check("an empty query searches nothing", (await search("user_test", "   ", { env: {} })).hits.length === 0);
check("the team provider is declared but unbuilt", OFF.providers.agent === "not_configured");

// --- Authorization --------------------------------------------------------------------
check("every provider query carries the ownership predicate", (() => {
  for (const path of ["lib/contacts/search.ts", "lib/transactions/search.ts"]) {
    const src = code(path);
    const reads = (src.match(/^\s*\.from\(/gm) ?? []).length;
    const guarded = (src.match(/visibleTo\(ctx\.actor\)/g) ?? []).length;
    if (reads === 0 || guarded < reads) return false;
    if (!src.includes('visibleTo } from "./service.ts"')) return false;
  }
  return true;
})());
check("scope is never accepted from the request", (() => {
  const route = code("app/api/search/route.ts");
  const service = code("lib/search/service.ts");
  return (
    route.includes("caller.clerkUserId") &&
    !/brokerage|agentId|actor/i.test(route) &&
    // The body schema admits one field, and it is text.
    /z\.object\(\{\s*q: z\.string\(\)/.test(route) &&
    service.includes("resolveActor as resolveBrokerageActor")
  );
})());
check("the route authenticates before it searches", (() => {
  const src = readFileSync("app/api/search/route.ts", "utf8");
  return src.indexOf("await requireCaller()") < src.indexOf("search(caller.clerkUserId");
})());
check("results are never filtered in the browser", (() => {
  const palette = code("components/layout/command-palette.tsx");
  // cmdk filtering is off, and the component does no matching of its own over
  // the returned hits — what the server authorized is what is rendered.
  return !/hits\.filter\(\(h[^)]*\)\s*=>[\s\S]{0,80}(title|subtitle|includes\(trimmed)/.test(palette);
})());

// --- Privacy ---------------------------------------------------------------------------
check("no provider selects a sensitive column", (() => {
  for (const path of ["lib/contacts/search.ts", "lib/transactions/search.ts"]) {
    const src = code(path);
    const selected = src.slice(src.indexOf("const COLUMNS"), src.indexOf("};", src.indexOf("const COLUMNS")));
    if (/notes|tags|budget|commission|contractPrice|listPrice|safeMetadata/i.test(selected)) return false;
  }
  return true;
})());
check("the hit contract has no field for a record's contents", (() => {
  const src = code("lib/search/types.ts");
  const shape = src.slice(src.indexOf("interface SearchHit"), src.indexOf("}", src.indexOf("interface SearchHit")));
  return !/notes|price|amount|document|metadata/i.test(shape);
})());
check("search text is kept out of the URL", (() => {
  const route = code("app/api/search/route.ts");
  const adapter = code("lib/data/adapters/search.ts");
  return (
    route.includes("export async function POST") &&
    !route.includes("export async function GET") &&
    adapter.includes('method: "POST"') &&
    !/api\/search\?/.test(adapter)
  );
})());
check("no search response is cacheable", (() => {
  const route = readFileSync("app/api/search/route.ts", "utf8");
  return route.includes('"Cache-Control": "private, no-store"');
})());
check("the query is never logged", (() => {
  for (const path of ["app/api/search/route.ts", "lib/search/service.ts", "lib/contacts/search.ts", "lib/transactions/search.ts"]) {
    if (/console\.(log|info|warn|error)/.test(code(path))) return false;
  }
  return true;
})());

// --- No fiction --------------------------------------------------------------------------
check("nothing on the search path can reach a sample generator", (() => {
  for (const path of [
    "lib/search/service.ts",
    "lib/search/query.ts",
    "lib/search/rank.ts",
    "lib/contacts/search.ts",
    "lib/transactions/search.ts",
    "lib/data/adapters/search.ts",
    "app/api/search/route.ts",
  ]) {
    if (/data\/mock|sample-metrics|sample-transactions|sample-leads|mock\/db/.test(readFileSync(path, "utf8"))) {
      return false;
    }
  }
  return true;
})());
check("a failed search surfaces as a failure, not as no results", (() => {
  const adapter = code("lib/data/adapters/search.ts");
  const palette = code("components/layout/command-palette.tsx");
  return (
    adapter.includes("throw new SearchError") &&
    /setFailed\(true\)/.test(palette) &&
    palette.includes("Search is unavailable right now")
  );
})());
check("the palette distinguishes not-searched from not-found", (() => {
  const palette = code("components/layout/command-palette.tsx");
  return (
    palette.includes("Nothing could be searched") &&
    /is not connected/.test(palette) &&
    /temporarily unavailable/.test(palette)
  );
})());

// --- The service is reusable by something that is not a browser ---------------------------
check("the search service imports no browser code", (() => {
  for (const path of ["lib/search/service.ts", "lib/contacts/search.ts", "lib/transactions/search.ts"]) {
    const src = readFileSync(path, "utf8");
    if (/from "react|next\/|@\/components/.test(src)) return false;
  }
  return true;
})());
check("the palette owns no query logic of its own", (() => {
  const palette = code("components/layout/command-palette.tsx");
  // Classification and ordering belong to the shared modules, so a future
  // server-side caller gets identical behaviour.
  return palette.includes("topResult") && palette.includes("ENTITY_ORDER") && !/parseQuery|rankHits/.test(palette);
})());

// --- Caps ---------------------------------------------------------------------------------
check("each provider is capped, and asks for one extra to know there is more", (() => {
  const src = code("lib/search/service.ts");
  return PROVIDER_LIMIT === 5 && src.includes("PROVIDER_LIMIT + 1") && src.includes("slice(0, PROVIDER_LIMIT)");
})());
check("commands never reach the database", (() => {
  const palette = code("components/layout/command-palette.tsx");
  const actions = palette.slice(palette.indexOf("const ACTIONS"), palette.indexOf("const DEBOUNCE_MS"));
  return !/searchAll|fetch/.test(actions);
})());
check("a stale answer cannot overwrite a newer one", (() => {
  const palette = code("components/layout/command-palette.tsx");
  return (
    palette.includes("new AbortController()") &&
    palette.includes("controller.abort()") &&
    /ticket !== sequence\.current/.test(palette)
  );
})());

// --- Focus goes back somewhere ------------------------------------------------------------
// Certification measured `document.activeElement` as BODY after opening the
// palette with the keyboard and pressing Escape. A keyboard user who loses
// their place restarts from the top of the document on the next Tab, so the
// palette must hand focus back deliberately rather than leave it to Radix,
// which has nothing to restore when the palette was opened by a keystroke.
check("the palette decides where focus lands when it closes", (() => {
  const palette = code("components/layout/command-palette.tsx");
  return (
    palette.includes("onCloseAutoFocus={restoreFocus}") &&
    /const restoreFocus = React\.useCallback/.test(palette)
  );
})());
check("focus never goes to the document body", (() => {
  const palette = code("components/layout/command-palette.tsx");
  return /node === document\.body/.test(palette) && /return false/.test(palette);
})());
check("a hidden or detached opener is not focused", (() => {
  const palette = code("components/layout/command-palette.tsx");
  return (
    /!node\.isConnected/.test(palette) &&
    /offsetParent !== null \|\| node\.getClientRects\(\)\.length > 0/.test(palette)
  );
})());
check("the search control is the fallback, and it exists to be found", (() => {
  const palette = code("components/layout/command-palette.tsx");
  const topBar = code("components/layout/top-bar.tsx");
  return (
    palette.includes('querySelectorAll<HTMLElement>("[data-command-trigger]")') &&
    (topBar.match(/data-command-trigger/g) ?? []).length === 2
  );
})());
check("selecting a result does not restore focus to a row that is navigating away", (() => {
  const palette = code("components/layout/command-palette.tsx");
  const at = palette.indexOf("const go = (href: string) => {");
  return at !== -1 && palette.slice(at, at + 200).includes("opener.current = null;");
})());
check("the dialog primitive forwards the close handler to its content", (() => {
  const command = code("components/ui/command.tsx");
  return /<DialogContent[^>]*onCloseAutoFocus=\{onCloseAutoFocus\}/.test(command);
})());

// --- Report ---------------------------------------------------------------------------------
console.log(`\n${passed}/${passed + failures.length} search checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
