/**
 * Release 1 profile regression tests.
 *
 * Covers the rules that must hold with no database attached: input
 * normalisation, the update allowlist, completion arithmetic, licence-change
 * detection, and — most importantly — that the feature flags cannot hand
 * dashboard authorization to the database in this release.
 *
 * Database-backed behaviour (sync, cross-user scoping, audit rows) is NOT
 * asserted here; it requires a real Preview database and is reported as
 * UNVERIFIED until one exists.
 *
 * Run: npm run test:profile
 */
import {
  cleanText,
  licenseDetailsChanged,
  normalizeProfileUpdate,
  profileCompletion,
  toE164,
  toIsoDate,
  toLicenseState,
  toStringList,
} from "../lib/profile/normalize.ts";
import {
  databaseAccessControlEnabled,
  professionalProfileUiEnabled,
  profileDatabaseEnabled,
} from "../lib/flags.ts";
import { resolveDbRole } from "../lib/profile/roles.ts";
import {
  licenseLabel,
  resolveImageUrl,
  toProfileDetail,
  toProfileDisplay,
} from "../lib/profile/display.ts";
import { readFileSync } from "node:fs";
import { syncCurrentUser, updateOwnProfile } from "../lib/profile/service.ts";

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean) => {
  if (cond) passed++;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
};

// --- Feature flags default safely -----------------------------------------
check("profile database off by default", !profileDatabaseEnabled({}));
check("profile UI off by default", !professionalProfileUiEnabled({}));
check("db access control off by default", !databaseAccessControlEnabled({}));
check("profile database honours truthy", profileDatabaseEnabled({ PROFILE_DATABASE_ENABLED: "true" }));
check("profile database honours 1", profileDatabaseEnabled({ PROFILE_DATABASE_ENABLED: "1" }));
check("profile database ignores junk", !profileDatabaseEnabled({ PROFILE_DATABASE_ENABLED: "maybe" }));
check(
  "profile UI requires the database flag",
  !professionalProfileUiEnabled({ PROFESSIONAL_PROFILE_UI_ENABLED: "true" })
);
check(
  "profile UI on when both set",
  professionalProfileUiEnabled({ PROFESSIONAL_PROFILE_UI_ENABLED: "true", PROFILE_DATABASE_ENABLED: "true" })
);
// The Release 1 invariant: the env var cannot switch the access authority.
check(
  "db access control stays off even when the env var is set",
  !databaseAccessControlEnabled({ DATABASE_ACCESS_CONTROL_ENABLED: "true" })
);
check(
  "db access control stays off with every flag set",
  !databaseAccessControlEnabled({
    DATABASE_ACCESS_CONTROL_ENABLED: "1",
    PROFILE_DATABASE_ENABLED: "true",
    PROFESSIONAL_PROFILE_UI_ENABLED: "true",
  })
);

// --- Text + phone normalisation -------------------------------------------
check("cleanText collapses whitespace", cleanText("  Daniel   Wolf  ") === "Daniel Wolf");
check("cleanText empties to null", cleanText("   ") === null);
check("cleanText rejects non-strings", cleanText(42) === null);
check("E.164 from 10 digits", toE164("(954) 555-0100") === "+19545550100");
check("E.164 from 11 digits with 1", toE164("1-954-555-0100") === "+19545550100");
check("E.164 passthrough", toE164("+447700900123") === "+447700900123");
check("E.164 rejects short input", toE164("5550100") === null);
check("E.164 rejects letters", toE164("call me") === null);
check("E.164 empty is null", toE164("") === null);

// --- State + list + date normalisation ------------------------------------
check("state uppercases", toLicenseState("fl") === "FL");
check("state rejects unknown", toLicenseState("ZZ") === null);
check("state rejects full name", toLicenseState("Florida") === null);
check("list splits a csv string", toStringList("English, Spanish").length === 2);
check("list de-duplicates case-insensitively", toStringList(["Spanish", "spanish"]).length === 1);
check("list drops empties", toStringList(["a", "  ", "b"]).length === 2);
check("list caps length", toStringList(Array.from({ length: 50 }, (_, i) => `x${i}`)).length === 24);
check("iso date accepted", toIsoDate("2027-06-30") === "2027-06-30");
check("impossible day rejected", toIsoDate("2026-02-31") === null);
check("non-iso format rejected", toIsoDate("06/30/2027") === null);
check("absurd year rejected", toIsoDate("1899-01-01") === null);

// --- Update allowlist: protected fields cannot be written ------------------
{
  const out = normalizeProfileUpdate({
    preferredDisplayName: "Daniel Wolf",
    // All of the following must be stripped by the schema.
    role: "admin",
    status: "active",
    clerkUserId: "user_2aaaaaaaaaaaaaaaaaaa",
    primaryEmail: "attacker@example.com",
    profileCompletionPercent: 100,
    id: "00000000-0000-0000-0000-000000000000",
    userId: "00000000-0000-0000-0000-000000000000",
  });
  const keys = Object.keys(out);
  check("role is not writable by a profile update", !keys.includes("role"));
  check("status is not writable by a profile update", !keys.includes("status"));
  check("clerk id is not writable by a profile update", !keys.includes("clerkUserId"));
  check("primary email is not writable by a profile update", !keys.includes("primaryEmail"));
  check("completion is not writable by a profile update", !keys.includes("profileCompletionPercent"));
  check("row id is not writable by a profile update", !keys.includes("id") && !keys.includes("userId"));
  check("permitted field survives", out.preferredDisplayName === "Daniel Wolf");
  const serialized = JSON.stringify(out);
  check("normalised update never carries a clerk id", !serialized.includes("user_2aaaaaaaaaaaaaaaaaaa"));
}

// --- Completion arithmetic -------------------------------------------------
check("empty profile is 0%", profileCompletion(normalizeProfileUpdate({})) === 0);
{
  const full = normalizeProfileUpdate({
    preferredDisplayName: "D Wolf",
    legalFirstName: "Daniel",
    legalLastName: "Wolf",
    phoneE164: "9545550100",
    brokerageOffice: "Fort Lauderdale",
    licenseState: "FL",
    licenseType: "Broker",
    licenseNumber: "bk123456",
    licenseExpiration: "2027-06-30",
    biography: "Broker.",
    languages: ["English"],
    specialties: ["Waterfront"],
  });
  check("complete profile is 100%", profileCompletion(full) === 100);
  check("licence number is normalised upper", full.licenseNumber === "BK123456");
  const partial = profileCompletion(
    normalizeProfileUpdate({ preferredDisplayName: "D", legalFirstName: "Daniel" })
  );
  check("partial completion is between 0 and 100", partial > 0 && partial < 100);
}

// --- Licence change detection ---------------------------------------------
{
  const before = normalizeProfileUpdate({
    licenseState: "FL",
    licenseType: "Broker",
    licenseNumber: "BK1",
    licenseExpiration: "2027-01-01",
  });
  const same = normalizeProfileUpdate({
    licenseState: "FL",
    licenseType: "Broker",
    licenseNumber: "bk1",
    licenseExpiration: "2027-01-01",
  });
  const changed = normalizeProfileUpdate({
    licenseState: "FL",
    licenseType: "Broker",
    licenseNumber: "BK2",
    licenseExpiration: "2027-01-01",
  });
  check("identical licence is not a change", !licenseDetailsChanged(before, same));
  check("different licence number is a change", licenseDetailsChanged(before, changed));
  check("first-time licence entry is a change", licenseDetailsChanged(null, before));
  check(
    "biography edit alone is not a licence change",
    !licenseDetailsChanged(before, normalizeProfileUpdate({
      licenseState: "FL", licenseType: "Broker", licenseNumber: "BK1",
      licenseExpiration: "2027-01-01", biography: "new bio",
    }))
  );
}

// --- Server-resolved role mapping -----------------------------------------
check("clerk admin maps to admin", resolveDbRole("admin") === "admin");
check("org-prefixed admin maps to admin", resolveDbRole("org:admin") === "admin");
check("broker maps to broker", resolveDbRole("Broker") === "broker");
check("coordinator label maps", resolveDbRole("Transaction Coordinator") === "transaction_coordinator");
check("unknown role falls back to member", resolveDbRole("superuser") === "member");
check("null role falls back to member", resolveDbRole(null) === "member");
check("empty role falls back to member", resolveDbRole("") === "member");

// --- Release 1 migration ---------------------------------------------------
// The migration is applied by the Vercel preview build (the only context that
// can read Vercel's write-only `sensitive` database variables). These checks
// assert the committed SQL actually creates what the schema and service
// expect, so a bad generate is caught here rather than at deploy time.
{
  const sql = readFileSync("lib/db/migrations/0000_foamy_redwing.sql", "utf8");
  const journal = JSON.parse(readFileSync("lib/db/migrations/meta/_journal.json", "utf8"));

  for (const table of [
    "audit_events",
    "dashboard_users",
    "professional_profiles",
    "profile_images",
  ]) {
    check(`migration creates ${table}`, sql.includes(`CREATE TABLE "${table}"`));
  }
  for (const type of [
    "dashboard_user_role",
    "dashboard_user_status",
    "profile_image_status",
  ]) {
    check(`migration creates the ${type} enum`, sql.includes(`"public"."${type}" AS ENUM`));
  }
  check(
    "migration is the only journal entry and matches the file",
    journal.entries.length === 1 && journal.entries[0].tag === "0000_foamy_redwing"
  );
  // Release 1 is purely additive; a DROP here would mean a regenerate went wrong.
  check("migration drops nothing", !/\bDROP\s+(TABLE|TYPE|COLUMN)\b/i.test(sql));
  check(
    "clerk id is unique so one Clerk user cannot hold two records",
    // `[\s\S]` rather than the `s` flag, which the project's TS target rejects.
    /unique[\s\S]*clerk_user_id|clerk_user_id[\s\S]*unique/i.test(sql)
  );
}

// --- Compact display projection: the PII boundary --------------------------
// Everything the shell renders globally comes from this projection. If a field
// that should stay server-side ever reaches it, these fail.
{
  const session = { name: "Daniel Wolf", role: "Broker", imageUrl: "https://img.clerk.com/a.png" };
  const profileRow = {
    // Fields the projection is allowed to read.
    preferredDisplayName: "D. Wolf",
    licenseState: "FL",
    licenseType: "Broker",
    profileCompletionPercent: 70,
    // Fields it must ignore even though they are present on a real row.
    id: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    clerkUserId: "user_2aaaaaaaaaaaaaaaaaaa",
    phoneE164: "+19545550100",
    legalFirstName: "Daniel",
    legalLastName: "Wolf",
    licenseNumber: "BK123456",
    licenseExpiration: "2027-06-30",
    nrdsNumber: "123456789",
    primaryEmail: "daniel@example.com",
    biography: "Broker.",
  };
  const display = toProfileDisplay(session, profileRow, null);
  const serialized = JSON.stringify(display);

  check("display prefers the preferred display name", display.displayName === "D. Wolf");
  check("display role comes from the session", display.roleLabel === "Broker");
  check("display licence label is state and type only", display.licenseLabel === "FL Broker");
  check("display completion is carried", display.completion === 70);

  for (const [label, value] of [
    ["clerk id", "user_2aaaaaaaaaaaaaaaaaaa"],
    ["phone", "+19545550100"],
    ["licence number", "BK123456"],
    ["licence expiration", "2027-06-30"],
    ["NRDS number", "123456789"],
    ["primary email", "daniel@example.com"],
    ["legal first name", "Daniel"],
    ["row id", "11111111-1111-1111-1111-111111111111"],
    ["user id", "22222222-2222-2222-2222-222222222222"],
    ["biography", "Broker."],
  ] as const) {
    check(`display projection never carries the ${label}`, !serialized.includes(value));
  }
  check(
    "display projection has exactly the five permitted keys",
    Object.keys(display).sort().join(",") ===
      "completion,displayName,imageUrl,licenseLabel,roleLabel"
  );

  // Falls back to session identity with no row at all — the database-off shape.
  const bare = toProfileDisplay(session);
  check("display falls back to the session name", bare.displayName === "Daniel Wolf");
  check("display falls back to the session image", bare.imageUrl === session.imageUrl);
  check("display licence label is null without a profile", bare.licenseLabel === null);
  check("display completion defaults to 0", bare.completion === 0);
  check("display clamps an out-of-range completion",
    toProfileDisplay(session, { profileCompletionPercent: 400 }).completion === 100);
}

// --- Licence label ---------------------------------------------------------
check("licence label needs neither field", licenseLabel(null) === null);
check("licence label with state only", licenseLabel({ licenseState: "FL" }) === "FL");
check("licence label with type only", licenseLabel({ licenseType: "Broker" }) === "Broker");
check("licence label ignores blank values", licenseLabel({ licenseState: "   " }) === null);

// --- Top-bar image fallback chain ------------------------------------------
// processed (only when ready) -> active -> Clerk -> null (initials).
{
  const session = { name: "D W", role: "Agent", imageUrl: "https://img.clerk.com/c.png" };
  check(
    "ready processed image wins",
    resolveImageUrl(
      { processedImageUrl: "https://cdn/p.png", activeImageUrl: "https://cdn/a.png", processingStatus: "ready" },
      session
    ) === "https://cdn/p.png"
  );
  check(
    "processed image is ignored while still processing",
    resolveImageUrl(
      { processedImageUrl: "https://cdn/p.png", activeImageUrl: "https://cdn/a.png", processingStatus: "processing" },
      session
    ) === "https://cdn/a.png"
  );
  check(
    "a failed processing run never blanks the active image",
    resolveImageUrl(
      { processedImageUrl: "https://cdn/p.png", activeImageUrl: "https://cdn/a.png", processingStatus: "failed" },
      session
    ) === "https://cdn/a.png"
  );
  check(
    "clerk image is used when there is no active image",
    resolveImageUrl({ clerkImageUrl: "https://cdn/k.png", processingStatus: "clerk_only" }, session) ===
      "https://cdn/k.png"
  );
  check("session image is the last resort", resolveImageUrl(null, session) === session.imageUrl);
  check(
    "no image at all falls through to initials",
    resolveImageUrl(null, { name: "D W", role: "Agent", imageUrl: null }) === null
  );
  // Stored values are treated as untrusted on the way out.
  check(
    "javascript: image url is rejected",
    resolveImageUrl({ activeImageUrl: "javascript:alert(1)", processingStatus: "uploaded" }, {
      name: "D W", role: "Agent", imageUrl: null,
    }) === null
  );
  check(
    "data: image url is rejected",
    resolveImageUrl({ activeImageUrl: "data:image/svg+xml,<svg onload=alert(1)>", processingStatus: "uploaded" }, {
      name: "D W", role: "Agent", imageUrl: null,
    }) === null
  );
  check(
    "protocol-relative image url is rejected",
    resolveImageUrl({ activeImageUrl: "//evil.example.com/a.png", processingStatus: "uploaded" }, {
      name: "D W", role: "Agent", imageUrl: null,
    }) === null
  );
  check(
    "plain http image url is rejected",
    resolveImageUrl({ activeImageUrl: "http://insecure.example.com/a.png", processingStatus: "uploaded" }, {
      name: "D W", role: "Agent", imageUrl: null,
    }) === null
  );
}

// --- Drawer detail projection ----------------------------------------------
// Wider than the display projection by design — it is the caller's own record,
// fetched on demand from a protected route — but still never a raw row.
{
  const detail = toProfileDetail({
    preferredDisplayName: "D. Wolf",
    phoneE164: "+19545550100",
    licenseNumber: "BK123456",
    languages: ["English", 42, "Spanish"],
    profileCompletionPercent: 55,
    // Must not survive the copy.
    id: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    role: "admin",
    status: "active",
    clerkUserId: "user_2aaaaaaaaaaaaaaaaaaa",
    createdAt: new Date(0),
  } as Record<string, unknown>);
  const keys = Object.keys(detail);

  check("detail carries the caller's own phone", detail.phoneE164 === "+19545550100");
  check("detail carries the licence number", detail.licenseNumber === "BK123456");
  check("detail drops non-string list entries", detail.languages.join(",") === "English,Spanish");
  check("detail defaults absent lists to empty", detail.specialties.length === 0);
  check("detail carries completion", detail.completion === 55);
  for (const forbidden of ["id", "userId", "role", "status", "clerkUserId", "createdAt", "updatedAt"]) {
    check(`detail projection omits ${forbidden}`, !keys.includes(forbidden));
  }
  check(
    "detail projection never carries a clerk id",
    !JSON.stringify(detail).includes("user_2aaaaaaaaaaaaaaaaaaa")
  );
}

// --- The allowlist gate runs BEFORE any database access --------------------
// This is the Release 1 invariant that stops an arbitrary signed-in Clerk user
// from provisioning an active dashboard record for themselves.
//
// It is asserted by making the database deliberately unusable: DATABASE_URL is
// set to a string the driver cannot parse, so any code path that reaches
// `getDb()` throws. A caller who is turned away therefore returns null, while
// an allowlisted caller throws — which is exactly what proves the gate is
// ordered ahead of the connection rather than merely present somewhere.
{
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "definitely not a connection string";

  const ALLOWED = "user_2aaaaaaaaaaaaaaaaaaaa";
  const OTHER = "user_2bbbbbbbbbbbbbbbbbbbb";
  const env = {
    PROFILE_DATABASE_ENABLED: "1",
    FORTMARK_ALLOWED_CLERK_USER_IDS: ALLOWED,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
    CLERK_SECRET_KEY: "sk_test_placeholder",
  };
  const identity = (clerkUserId: string) => ({
    clerkUserId,
    email: null,
    name: null,
    imageUrl: null,
    roleLabel: null,
  });

  const outcome = async (user: string): Promise<"returned" | "reached-db"> => {
    try {
      await syncCurrentUser(identity(user), env);
      return "returned";
    } catch {
      return "reached-db";
    }
  };

  check(
    "a signed-in but non-allowlisted user cannot provision a record",
    (await outcome(OTHER)) === "returned"
  );
  check(
    "the non-allowlisted caller never reaches the database at all",
    (await syncCurrentUser(identity(OTHER), env)) === null
  );
  check(
    "an allowlisted caller does proceed to the database layer",
    (await outcome(ALLOWED)) === "reached-db"
  );
  check(
    "sync is refused outright when the feature flag is off",
    (await syncCurrentUser(identity(ALLOWED), { ...env, PROFILE_DATABASE_ENABLED: "0" })) === null
  );

  // The flag is a hard gate on writes too, ahead of the connection.
  const offResult = await updateOwnProfile(ALLOWED, { biography: "x" }, {
    ...env,
    PROFILE_DATABASE_ENABLED: "0",
  });
  check(
    "updates are refused outright when the feature flag is off",
    !offResult.ok && offResult.reason === "unavailable"
  );

  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
}

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} profile checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
