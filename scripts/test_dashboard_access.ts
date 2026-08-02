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

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} dashboard checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
