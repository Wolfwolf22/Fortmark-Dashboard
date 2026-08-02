/**
 * Dashboard authorization regression tests.
 *
 * Pure-function coverage for the two security decisions that do not need a
 * live Clerk session: the approved-user allowlist (fail-closed in every
 * direction) and the open-redirect guard on return paths.
 *
 * Run: npm run test:auth
 */
import {
  decideAccess,
  hasClerkKeys,
  isConfigFailure,
  parseAllowlist,
  userRef,
} from "../lib/auth/dashboard-access.ts";
import {
  BASE_PATH,
  FALLBACK_PLATE,
  apiPath,
  assetPath,
  isSafeReturnPath,
  signInUrl,
} from "../lib/routes.ts";

import { readFileSync } from "node:fs";

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

// --- Incident regression: MIDDLEWARE_INVOCATION_FAILED ---------------------
//
// Production went down with `@clerk/nextjs: Missing publishableKey` thrown from
// edge middleware on every dashboard route. `clerkMiddleware()` throws when a
// key is absent, and a throw from middleware is a 500 for the whole zone. The
// guard added to middleware.ts runs BEFORE Clerk's handler, so a missing key
// degrades to a terminal 503 instead of taking the dashboard down.
{
  const mw = readFileSync("middleware.ts", "utf8");
  // Comment-stripped source. Several of these needles also appear in the
  // comments that explain why they are absent from the code, which would
  // otherwise fail the checks spuriously.
  const mwCode = mw
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

  // Both indices must EXIST as well as be ordered: `indexOf` returns -1 when a
  // needle is absent, and -1 is less than any real index, so an ordering test
  // alone passes vacuously when the guard is deleted.
  const guardAt = mw.indexOf("clerkIsConfigured()");
  const invokeAt = mw.indexOf("clerkHandler(req, event)");
  check(
    "middleware checks Clerk configuration before invoking Clerk",
    guardAt >= 0 && invokeAt >= 0 && guardAt < invokeAt
  );
  check(
    "a missing key returns the unavailable response",
    mw.includes("if (!clerkIsConfigured()) return serviceUnavailable(req)")
  );
  // Middleware cannot import `dashboard-access` — that module hashes with
  // `node:crypto`, which the edge runtime refuses to bundle, so the build
  // fails outright. The rule is therefore restated locally, and these assert
  // the two copies still agree on every case that matters.
  check(
    "middleware stays free of node: imports",
    !/from "node:/.test(mw) && !/require\("node:/.test(mw)
  );
  check(
    "middleware does not import the crypto-bearing access module",
    !mwCode.includes("lib/auth/dashboard-access")
  );
  check(
    "the local guard requires both keys, like hasClerkKeys",
    /nonEmpty\(env\.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\) && nonEmpty\(env\.CLERK_SECRET_KEY\)/.test(mw)
  );
  check(
    "a configuration failure never becomes an access grant",
    !/serviceUnavailable[\s\S]{0,600}NextResponse\.next\(\)/.test(mw)
  );
  check("middleware never calls NextResponse.next()", !mwCode.includes("NextResponse.next()"));
  check(
    "API routes get a JSON 503 when Clerk cannot start",
    /pathname\.startsWith\("\/api\/"\)[\s\S]{0,200}status: 503/.test(mw)
  );
  check("page requests get a terminal 503, not a redirect that could loop",
    /return new NextResponse\([\s\S]{0,200}status: 503/.test(mw));
  check(
    "the unavailable response is never cached",
    (mw.match(/"Cache-Control": "no-store"/g) ?? []).length >= 2
  );
  // The 503 body must be plain text, never the app shell: rendering any part of
  // the dashboard while auth cannot initialise would be the access grant this
  // path exists to prevent.
  check(
    "the unavailable page body is plain text, not markup",
    /Content-Type": "text\/plain/.test(mwCode) && !/<html|__NEXT_DATA__|<body/.test(mwCode)
  );
  check(
    "the unavailable page carries no session or identity data",
    !/userId|sessionClaims|emailAddress/.test(
      mwCode.slice(mwCode.indexOf("function serviceUnavailable"), mwCode.indexOf("const clerkHandler"))
    )
  );

  // A hostile return path must never survive into the sign-in redirect, in any
  // of the forms an attacker can reach the middleware with.
  for (const hostile of [
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/x://evil.com",
    "javascript:alert(1)",
    "evil.com",
  ]) {
    const built = signInUrl(hostile);
    check(
      `hostile return path is not carried into the sign-in url: ${JSON.stringify(hostile)}`,
      !built.includes("evil.com") && !built.includes("javascript:")
    );
  }
  // The legitimate case still round-trips.
  check(
    "a safe return path is preserved",
    signInUrl("/dashboard/leads").includes(encodeURIComponent("/dashboard/leads"))
  );

  // Both keys are required. A publishable key alone must not look configured.
  check("both keys absent fails closed", !hasClerkKeys({}));
  check(
    "publishable key alone fails closed",
    !hasClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x" })
  );
  check(
    "secret key alone fails closed",
    !hasClerkKeys({ CLERK_SECRET_KEY: "sk_live_x" })
  );
  check(
    "blank publishable key fails closed",
    !hasClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "   ", CLERK_SECRET_KEY: "sk_live_x" })
  );
  check(
    "both keys present is configured",
    hasClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x", CLERK_SECRET_KEY: "sk_live_x" })
  );

  // The redirect path that a healthy, signed-out request takes must not throw
  // for any operator-provided app URL. `signInUrl` is the value handed to
  // `new URL(..., origin)`, so it must always yield something resolvable.
  const ORIGIN = "https://app.fortmark.net";
  for (const appUrl of [
    undefined, "", "   ",
    "https://app.fortmark.net", "https://app.fortmark.net/",
    "app.fortmark.net", "https://app.fortmark.net/dashboard",
    "  https://app.fortmark.net  ", "ht!tp://nope", "javascript:alert(1)",
  ]) {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = appUrl;
    let threw = false;
    let resolvable = false;
    try {
      const u = new URL(signInUrl("/dashboard"), ORIGIN);
      resolvable = u.protocol === "https:" || u.protocol === "http:";
    } catch {
      threw = true;
    }
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
    check(`sign-in URL never throws for app url ${JSON.stringify(appUrl)}`, !threw);
    check(`sign-in URL stays http(s) for app url ${JSON.stringify(appUrl)}`, resolvable);
  }

  // The same, for the sign-in path variable.
  for (const signIn of [undefined, "", "/sign-in", "https://app.fortmark.net/sign-in", "not a url", "  /sign-in  "]) {
    const prev = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
    if (signIn === undefined) delete process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
    else process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = signIn;
    let threw = false;
    try {
      new URL(signInUrl("/dashboard"), ORIGIN);
    } catch {
      threw = true;
    }
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
    else process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL = prev;
    check(`sign-in URL never throws for sign-in var ${JSON.stringify(signIn)}`, !threw);
  }
}

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} dashboard checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
