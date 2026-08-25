/**
 * Dashboard authorization regression tests.
 *
 * Pure-function coverage for the two security decisions that do not need a
 * live Clerk session: the approved-user allowlist (fail-closed in every
 * direction) and the open-redirect guard on return paths.
 *
 * Run: npm run test:auth
 */
import { readFileSync } from "node:fs";
import {
  canWrite,
  domainForPath,
  isSample,
  provenanceOf,
  sampleDomains,
  sampleNotice,
  writeDisabledReason,
} from "../lib/data/provenance.ts";
import {
  decideAccess,
  hasClerkKeys,
  isConfigFailure,
  parseAllowlist,
  userRef,
} from "../lib/auth/dashboard-access.ts";
import {
  ACCOUNT_PATH,
  BASE_PATH,
  accountUrl,
  FALLBACK_PLATE,
  apiPath,
  assetPath,
  isSafeReturnPath,
} from "../lib/routes.ts";

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

// Syntactically valid shapes only — never real credentials.
const PK = "pk_test_example";
const SK = "sk_test_example";
const UID_A = "user_2aaaaaaaaaaaaaaaaaaa";
const UID_B = "user_2bbbbbbbbbbbbbbbbbbb";
const env = (extra: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK,
  CLERK_SECRET_KEY: SK,
  ...extra,
});

// --- Clerk key presence ----------------------------------------------------
check("keys present", hasClerkKeys(env()));
check("keys absent when pk missing", !hasClerkKeys({ CLERK_SECRET_KEY: SK }));
check(
  "keys absent when sk is whitespace",
  !hasClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: "   " })
);

// --- Allowlist parsing -----------------------------------------------------
check("allowlist absent", parseAllowlist(undefined).ok === false);
check("allowlist empty string", parseAllowlist("   ").ok === false);
check("allowlist csv accepted", parseAllowlist(`${UID_A},${UID_B}`).ok);
check("allowlist whitespace accepted", parseAllowlist(`${UID_A} ${UID_B}`).ok);
check("allowlist json accepted", parseAllowlist(JSON.stringify([UID_A])).ok);
check("allowlist bad json rejected", parseAllowlist("[not json").ok === false);
check(
  "allowlist json non-array rejected",
  parseAllowlist('{"a":1}').ok === false
);
check("allowlist empty array rejected", parseAllowlist("[]").ok === false);
check(
  "one malformed entry fails the whole config closed",
  parseAllowlist(`${UID_A},not-a-user-id`).ok === false
);
check(
  "over 64 entries rejected",
  parseAllowlist(
    Array.from({ length: 65 }, (_, i) => `user_2${String(i).padStart(19, "0")}`).join(",")
  ).ok === false
);

// --- Access decisions ------------------------------------------------------
check(
  "approved user allowed",
  decideAccess(UID_A, env({ FORTMARK_ALLOWED_CLERK_USER_IDS: UID_A })).ok
);
{
  const d = decideAccess(UID_B, env({ FORTMARK_ALLOWED_CLERK_USER_IDS: UID_A }));
  check("unapproved user denied", !d.ok);
  check("unapproved reason is not_approved", !d.ok && d.reason === "not_approved");
  check(
    "unapproved is not a config failure",
    !d.ok && !isConfigFailure(d.reason)
  );
}
{
  const d = decideAccess(null, env({ FORTMARK_ALLOWED_CLERK_USER_IDS: UID_A }));
  check("anonymous denied", !d.ok);
  check("anonymous reason is not_signed_in", !d.ok && d.reason === "not_signed_in");
}
{
  // Missing production configuration must fail closed, not fall open.
  const d = decideAccess(UID_A, { FORTMARK_ALLOWED_CLERK_USER_IDS: UID_A });
  check("missing Clerk keys denied", !d.ok);
  check("missing keys is a config failure", !d.ok && isConfigFailure(d.reason));
}
{
  const d = decideAccess(UID_A, env());
  check("missing allowlist denied", !d.ok);
  check("missing allowlist is a config failure", !d.ok && isConfigFailure(d.reason));
}
check(
  "empty allowlist denies even a well-formed user",
  !decideAccess(UID_A, env({ FORTMARK_ALLOWED_CLERK_USER_IDS: "[]" })).ok
);

// --- Non-disclosure --------------------------------------------------------
check("userRef never contains the raw id", !userRef(UID_A).includes(UID_A));
check("userRef is stable", userRef(UID_A) === userRef(UID_A));
check("userRef distinguishes users", userRef(UID_A) !== userRef(UID_B));
check("userRef handles anonymous", userRef(null) === "anon");
{
  const serialized = JSON.stringify(
    decideAccess(UID_B, env({ FORTMARK_ALLOWED_CLERK_USER_IDS: `${UID_A},${UID_B}` }))
  );
  check("decision never serialises a configured id", !serialized.includes(UID_A));
}

// --- Open-redirect guard ---------------------------------------------------
check("relative dashboard path allowed", isSafeReturnPath("/dashboard/leads"));
check("query string preserved path allowed", isSafeReturnPath("/dashboard/x?a=b"));
check("protocol-relative rejected", !isSafeReturnPath("//evil.com"));
check("absolute url rejected", !isSafeReturnPath("https://evil.com"));
check("backslash obfuscation rejected", !isSafeReturnPath("/\\evil.com"));
check("embedded scheme rejected", !isSafeReturnPath("/x://evil.com"));
check("javascript scheme rejected", !isSafeReturnPath("javascript:alert(1)"));
check("bare word rejected", !isSafeReturnPath("evil.com"));
check("empty rejected", !isSafeReturnPath(""));
check("null rejected", !isSafeReturnPath(null));

// --- basePath asset resolution (Phase 13 regression) -----------------------
// Raw <img src> is not rewritten by Next under a basePath, which 404'd every
// listing plate in production. These lock the helper's behaviour.
check("asset gains the basePath prefix", assetPath("/photos/plate-01.svg") === "/dashboard/photos/plate-01.svg");
check("already-prefixed asset is untouched", assetPath("/dashboard/photos/p.svg") === "/dashboard/photos/p.svg");
check("absolute https URL passes through", assetPath("https://cdn.example.com/a.jpg") === "https://cdn.example.com/a.jpg");
check("protocol-relative URL passes through", assetPath("//cdn.example.com/a.jpg") === "//cdn.example.com/a.jpg");
check("data URL passes through", assetPath("data:image/png;base64,AAAA") === "data:image/png;base64,AAAA");
check("empty src stays empty", assetPath("") === "");
check("fallback plate is basePath-resolvable", assetPath(FALLBACK_PLATE) === `${BASE_PATH}/photos/plate-01.svg`);
check("relative (non-rooted) src is not mangled", assetPath("photos/p.svg") === "photos/p.svg");

// --- basePath route-handler resolution -------------------------------------
// Same trap one layer down: fetch() is not rewritten either, so a bare
// "/api/chat" resolves to the portal zone. Verified against a running server —
// /api/chat returns 404, /dashboard/api/chat returns 401.
check("api path gains the basePath prefix", apiPath("/api/profile") === "/dashboard/api/profile");
check("api chat path gains the basePath prefix", apiPath("/api/chat") === "/dashboard/api/chat");
check("already-prefixed api path is untouched", apiPath("/dashboard/api/profile") === "/dashboard/api/profile");
check("relative api path is not mangled", apiPath("api/profile") === "api/profile");
check("api path is basePath-consistent", apiPath("/api/x").startsWith(`${BASE_PATH}/`));

// --- Account management links leave the zone correctly ---------------------
{
  const section = readFileSync("components/settings/profile-section.tsx", "utf8");
  check("account settings links to the account route, not the landing page",
    section.includes("accountUrl()") && !section.includes("portalUrl()"));
  check("the account path is the one the portal actually serves",
    ACCOUNT_PATH === "/account");
  // The dashboard basePath must NOT be applied — /account is a portal route.
  check("the account url is not prefixed with the dashboard basePath",
    !accountUrl().includes(BASE_PATH));
  check("the account url ends at the account route",
    accountUrl().endsWith(ACCOUNT_PATH));
  check("an unset origin still yields a portal-root-relative path",
    accountUrl().startsWith("/") || /^https?:\/\//.test(accountUrl()));
}

// --- Middleware survives an unverifiable session ---------------------------
//
// The failure this covers actually happened in Preview: a browser presented a
// Clerk cookie minted by a different instance than the deployment's secret key
// belonged to, Clerk threw `jwk-kid-mismatch`, the throw escaped the
// middleware, and Vercel turned it into MIDDLEWARE_INVOCATION_FAILED — a 500
// on every route, including ones needing no session.
//
// Structural assertions: the recovery path cannot be exercised without a real
// Clerk instance, so this pins the SHAPE that makes the crash impossible.
{
  const mw = readFileSync("middleware.ts", "utf8");

  check("clerk's handler is wrapped rather than exported directly",
    mw.includes("const clerkHandler = clerkMiddleware(") &&
      /export default async function middleware\(/.test(mw));
  check("the wrapper catches a throw from clerk",
    /try \{[\s\S]{0,200}await clerkHandler\(req, event\)[\s\S]{0,200}\} catch/.test(mw));
  check("a verification failure recovers instead of propagating",
    mw.includes("return recoverFromAuthFailure(req)"));

  // The recovery must fail CLOSED — signed out, never through to content.
  check("recovery only ever redirects to sign-in or errors",
    mw.includes("NextResponse.redirect(") && mw.includes("status: 503"));
  check("recovery never calls next()",
    !/recoverFromAuthFailure[\s\S]{0,900}NextResponse\.next\(\)/.test(mw));

  // Clearing the JWT alone leaves Clerk's client-side hints claiming a session
  // still exists, which is its own loop.
  for (const cookie of ["__session", "__client_uat", "__clerk_db_jwt"]) {
    check(`recovery clears ${cookie}`, mw.includes(`"${cookie}"`));
  }
  check("all clerk session cookies are cleared together",
    /CLERK_SESSION_COOKIES[\s\S]{0,200}response\.cookies\.delete/.test(mw));

  // Loop guard: a browser that keeps re-presenting a bad cookie must not be
  // bounced forever.
  check("a reset marker guards against a redirect loop",
    mw.includes("RESET_MARKER") && mw.includes("req.cookies.get(RESET_MARKER)"));
  check("the second failure stops redirecting and explains itself",
    /req\.cookies\.get\(RESET_MARKER\)[\s\S]{0,400}status: 503/.test(mw));
  check("the marker expires so a later failure is treated as new",
    /maxAge: \d+/.test(mw));
  check("the marker is httpOnly so the page cannot forge it",
    /RESET_MARKER[\s\S]{0,300}httpOnly: true/.test(mw));

  // The error text can carry instance identifiers and the token's key id.
  check("the caught error is never logged or inspected",
    !/catch \(\s*\w+\s*\)[\s\S]{0,300}console\./.test(mw));
  check("recovery responses are never cached",
    (mw.match(/Cache-Control": "no-store/g) ?? []).length >= 2);

  // The authorization rules themselves must be untouched by the wrapper.
  check("the allowlist/session rules still run inside clerk's handler",
    /clerkHandler = clerkMiddleware\([\s\S]{0,600}const \{ userId \} = await auth\(\)/.test(mw));
  check("authorized parties are still passed to clerk",
    mw.includes("authorizedParties: getAuthorizedParties()"));
}

// --- Sample data must never pass as real -----------------------------------
//
// The dashboard renders a real professional profile beside fabricated
// pipelines, listings and commissions. Rendered identically they are
// indistinguishable, and a $10.8M pipeline looks exactly like a real business.
// These assertions keep the labelling truthful in BOTH directions: no
// fabricated surface unlabelled, and no real surface mislabelled.
{
  // The one real domain, and it must stay real.
  check("the professional profile is live, not sample", !isSample("profile"));
  check("the profile is never in the sample list", !sampleDomains().includes("profile"));
  check("the profile carries no sample notice", sampleNotice("profile") === "");
  check("the profile is writable", canWrite("profile"));

  // Everything else is fabricated today and must say so.
  for (const domain of ["transactions", "listings", "leads", "calendar",
                        "documents", "reports", "messages", "ai", "market",
                        "agents", "team", "brokerage", "integrations"] as const) {
    check(`${domain} is declared sample`, isSample(domain));
    check(`${domain} has a notice`, sampleNotice(domain).length > 0);
    check(`${domain} refuses writes`, !canWrite(domain));
    check(`${domain} explains why writes are refused`,
      writeDisabledReason(domain).startsWith("Available once"));
  }

  // The notice has to state the CONSEQUENCE, not just the category.
  check("the notice says it is not the user's live business",
    /not your live business/.test(sampleNotice("transactions")));
  check("the notice says nothing is saved",
    /nothing here is saved/i.test(sampleNotice("transactions")));

  // provenance and writability are the same fact, so they cannot disagree.
  for (const domain of sampleDomains()) {
    check(`${domain} cannot be sample and writable at once`,
      provenanceOf(domain) === "sample" && !canWrite(domain));
  }

  // Route mapping. Mixed pages return null ON PURPOSE — a page-wide "this is
  // sample data" claim would be false on their real half.
  check("a fully-sample route maps to its domain",
    domainForPath("/transactions") === "transactions");
  check("a nested route maps too", domainForPath("/listings/abc-123") === "listings");
  check("a trailing slash does not break the match",
    domainForPath("/leads/") === "leads");
  check("Home is not labelled page-wide", domainForPath("/") === null);
  check("Settings is not labelled page-wide", domainForPath("/settings") === null);
  check("Onboarding is never labelled", domainForPath("/onboarding") === null);
  check("an unknown route is not labelled", domainForPath("/nope") === null);
}

// --- Every fabricated surface is wired to the labelling --------------------
{
  const widgets = [
    "closed-volume", "closed", "compliance", "featured-listing", "lead-source",
    "leaderboard", "market-pulse", "pipeline-value", "projected-commission",
    "transactions-table", "under-contract",
  ];
  for (const w of widgets) {
    const src = readFileSync(`components/home/widgets/${w}.tsx`, "utf8");
    check(`${w} declares its data source`, /domain="[a-z]+"/.test(src));
  }

  // Required, not optional — a new widget cannot forget to declare itself.
  const card = readFileSync("components/widgets/widget-card.tsx", "utf8");
  check("WidgetCard requires a domain", /\n  domain: DataDomain;/.test(card));
  check("WidgetCard renders the chip", card.includes("<SampleChip domain={domain}"));

  // The chip and notice refuse to label a live domain.
  const badge = readFileSync("components/data/sample-data.tsx", "utf8");
  check("the chip renders nothing for a live domain",
    (badge.match(/if \(!isSample\(domain\)\) return null;/g) ?? []).length === 2);

  // One placement covers every route, directly under the page title.
  const shell = readFileSync("components/layout/app-shell.tsx", "utf8");
  check("the shell renders the page notice",
    shell.includes("<SampleNotice domain={sampleDomain}") &&
      shell.includes("domainForPath(pathname)"));

  // Mixed pages label their sample parts individually.
  for (const section of ["team", "brokerage", "integrations"]) {
    const src = readFileSync(`components/settings/${section}-section.tsx`, "utf8");
    check(`settings ${section} carries a notice`, src.includes("<SampleNotice"));
  }
  const profileSection = readFileSync("components/settings/profile-section.tsx", "utf8");
  check("the real profile section is NOT labelled sample",
    !profileSection.includes("SampleNotice"));
}

// --- No write can reach a sample-backed store ------------------------------
{
  const surfaces: Array<[string, string]> = [
    ["components/layout/quick-create-dialog.tsx", "create"],
    ["components/transactions/kanban-board.tsx", "drag to a new stage"],
    ["components/transactions/transaction-drawer.tsx", "advance a stage"],
    ["components/leads/lead-drawer.tsx", "change a lead stage"],
    ["components/documents/documents-table.tsx", "change a document status"],
  ];
  for (const [path, what] of surfaces) {
    const src = readFileSync(path, "utf8");
    check(`${what} consults provenance`, src.includes("canWrite("));
  }

  // Guarding the handler alone would leave an enabled control that silently
  // does nothing — worse than a disabled one, because the user believes it
  // worked. The CONTROL must be disabled too.
  const dialog = readFileSync("components/layout/quick-create-dialog.tsx", "utf8");
  check("the create button is disabled, not just the handler",
    /disabled=\{busy \|\| !canWrite\(KIND_DOMAIN\[kind\]\)\}/.test(dialog));
  check("the create handler refuses as well",
    /if \(!canWrite\(KIND_DOMAIN\[kind\]\)\) return;/.test(dialog));
  check("the dialog says why it cannot save",
    dialog.includes("writeDisabledReason(KIND_DOMAIN[kind])"));

  const kanban = readFileSync("components/transactions/kanban-board.tsx", "utf8");
  check("kanban cards are not draggable while sample-backed",
    /useDraggable\(\{\s*\n\s*disabled: !writable,/.test(kanban));

  const leadDrawer = readFileSync("components/leads/lead-drawer.tsx", "utf8");
  check("the lead stage control is disabled",
    /disabled=\{saving \|\| !canWrite\("leads"\)\}/.test(leadDrawer));

  const txnDrawer = readFileSync("components/transactions/transaction-drawer.tsx", "utf8");
  check("the advance control is disabled",
    /disabled=\{advancing \|\| !canWrite\("transactions"\)\}/.test(txnDrawer));

  const docs = readFileSync("components/documents/documents-table.tsx", "utf8");
  check("document status items are disabled",
    (docs.match(/disabled=\{!canWrite\("documents"\)\}/g) ?? []).length >= 2);
}

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} dashboard checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
