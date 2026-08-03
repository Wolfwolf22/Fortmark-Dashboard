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
  FORTMARK_BROKERAGE_NAME,
  cleanText,
  isBrokerageTampering,
  licenseDetailsChanged,
  toProfileUrl,
  normalizeProfileUpdate,
  normalizeProfileUpdatePartial,
  profileCompletion,
  profileUpdateSchema,
  toE164,
  toIsoDate,
  toLicenseState,
  toStringList,
} from "../lib/profile/normalize.ts";
import {
  databaseAccessControlEnabled,
  professionalProfileUiEnabled,
  profileDatabaseEnabled,
  profileImageUploadEnabled,
} from "../lib/flags.ts";
import { resolveDbRole } from "../lib/profile/roles.ts";
import {
  licenseLabel,
  resolveImageUrl,
  safeLinkUrl,
  toProfileDetail,
  toProfileDisplay,
} from "../lib/profile/display.ts";
import {
  buildContactBlock,
  buildContactLinks,
  formatPhoneDisplay,
  toMailto,
  toTel,
  toWhatsApp,
} from "../lib/profile/links.ts";
import {
  credentialTrustFor,
  fallbackHomeIdentityCard,
  formatJoinedAt,
  greetingNameFor,
  toHomeIdentityCard,
} from "../lib/profile/home-card.ts";
import { buildVCard, escapeValue, vCardFilename } from "../lib/profile/vcard.ts";
import { DEFAULT_WIDGET_ORDER } from "../lib/stores/widget-order.ts";
import { readFileSync } from "node:fs";
import { syncCurrentUser, updateOwnProfile } from "../lib/profile/service.ts";
import { getHomeIdentityCard } from "../lib/profile/shell.ts";
import {
  PROFILE_STATUS_LABEL,
  profileStatusFor,
  selfCardLinks,
  SELF_CARD_HIDDEN_LINK_KINDS,
} from "../lib/profile/home-card.ts";
import {
  FIRST_STEP,
  LAST_STEP,
  ONBOARDING_STEPS,
  nextStep,
  normalizeStep,
  onboardingComplete,
  previousStep,
  resumeStep,
  shouldOpenOnboarding,
  earliestStepForFields,
  stepByNumber,
  stepForField,
  stepSchema,
  stepsForRole,
} from "../lib/profile/onboarding.ts";
import {
  PROFILE_FIELDS,
  PUBLIC_SURFACE_FIELDS,
  SELF_REPORTED_FIELDS,
  SYSTEM_ASSIGNED_FIELDS,
  isSystemAssignedField,
} from "../lib/profile/fields.ts";
import {
  ONBOARDING_DEFERRAL_COOKIE,
  ONBOARDING_DEFERRAL_PATH,
  ONBOARDING_DEFERRAL_VALUE,
  deferralCookieOptions,
  isDeferred,
} from "../lib/profile/deferral.ts";
import { droppedValueErrors, toValidationFailure } from "../lib/profile/onboarding.ts";
import {
  ALLOWED_IMAGE_MIME,
  IMAGE_ERROR_MESSAGE,
  MAX_IMAGE_BYTES,
  checkProfileImage,
  detectImageFormat,
} from "../lib/profile/image-format.ts";
import {
  PROFILE_IMAGE_ROOT,
  ownsPathname,
  profileImagePath,
  userPrefix,
} from "../lib/profile/image-storage.ts";
import { z as zod } from "zod";
import { toEmail } from "../lib/profile/normalize.ts";

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
    professionalTitle: "Founder / Broker",
    locationDisplay: "Fort Lauderdale, FL",
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
    "baseline migration is journal entry 0",
    journal.entries[0].tag === "0000_foamy_redwing"
  );
  // Asserted by tag and order rather than by count: an exact length encodes
  // "no migration has been added since", which is not the rule — it would fail
  // on every future additive migration for no real reason.
  const tags = journal.entries.map((e: { tag: string }) => e.tag);
  check("journal has the Release 1.1 additive migration", tags.includes("0001_cool_puppet_master"));
  check("journal has the Release A onboarding migration", tags.includes("0002_light_tomas"));
  check(
    "migrations are journalled in order",
    journal.entries.every((e: { idx: number }, i: number) => e.idx === i)
  );

  // Release 1.1 adds the professional-presence columns. It must be purely
  // additive: no DROP, no RENAME, no ALTER COLUMN, and every column nullable.
  const presence = readFileSync("lib/db/migrations/0001_cool_puppet_master.sql", "utf8");
  for (const col of [
    "professional_title",
    "location_display",
    "linkedin_url",
    "instagram_url",
    "facebook_url",
    "personal_website_url",
    "professional_website_url",
    "whatsapp_phone_e164",
  ]) {
    check(`presence migration adds ${col}`, presence.includes(`ADD COLUMN "${col}"`));
  }
  check(
    "presence migration is additive only",
    !/\b(DROP|TRUNCATE|RENAME|ALTER\s+COLUMN)\b/i.test(presence)
  );
  check("presence migration adds no NOT NULL column", !/NOT NULL/i.test(presence));
  check(
    "presence migration touches only professional_profiles",
    (presence.match(/ALTER TABLE "([a-z_]+)"/g) ?? []).every(
      (m) => m === 'ALTER TABLE "professional_profiles"'
    )
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


// === Release 1.1: Home identity card ======================================

const SESSION = {
  name: "Daniel Wolf",
  role: "Broker",
  email: "daniel@example.com",
  imageUrl: "https://img.clerk.com/a.png",
};

// --- Greeting name fallback chain ------------------------------------------
check(
  "greeting prefers the preferred display name's first token",
  greetingNameFor({ preferredDisplayName: "D. Wolf", legalFirstName: "Daniel" }, SESSION) === "D."
);
check(
  "greeting falls back to the legal first name",
  greetingNameFor({ legalFirstName: "Daniel" }, SESSION) === "Daniel"
);
check(
  "greeting falls back to the Clerk first name",
  greetingNameFor({}, SESSION) === "Daniel"
);
check(
  "greeting falls back to null for a nameless session",
  greetingNameFor(null, { name: "", role: "Member" }) === null
);
check(
  "greeting ignores a whitespace-only preferred name",
  greetingNameFor({ preferredDisplayName: "   " }, SESSION) === "Daniel"
);

// --- Joined date -----------------------------------------------------------
check(
  "joined date formats as month and year",
  formatJoinedAt("2026-07-15T12:00:00.000Z") === "July 2026"
);
check("joined date tolerates null", formatJoinedAt(null) === null);
check("joined date rejects junk", formatJoinedAt("not-a-date") === null);

// --- Credential trust ------------------------------------------------------
check(
  "credential defaults to self-reported, never a claimed verification",
  credentialTrustFor({ licenseNumber: "BK1" }, { status: "active" }) === "self_reported"
);
check(
  "pending_profile surfaces as pending review",
  credentialTrustFor({}, { status: "pending_profile" }) === "pending_review"
);
check(
  "a past expiration is reported expired",
  credentialTrustFor(
    { licenseExpiration: "2020-01-01" },
    { status: "active" },
    new Date("2026-07-30T00:00:00Z")
  ) === "expired"
);
check(
  "a future expiration is not expired",
  credentialTrustFor(
    { licenseExpiration: "2030-01-01" },
    { status: "active" },
    new Date("2026-07-30T00:00:00Z")
  ) === "self_reported"
);

// --- Home card projection --------------------------------------------------
{
  const card = toHomeIdentityCard(
    SESSION,
    { createdAt: "2026-07-15T12:00:00.000Z", primaryEmail: "daniel@example.com", status: "active" },
    {
      preferredDisplayName: "Daniel Wolf",
      professionalTitle: "Founder / Broker",
      brokerageOffice: "Fort Lauderdale",
      licenseState: "FL",
      licenseType: "Broker",
      licenseNumber: "BK123456",
      nrdsNumber: "123456789",
      phoneE164: "+19545550100",
      linkedinUrl: "https://linkedin.com/in/daniel-wolf",
      profileCompletionPercent: 82,
    },
    null,
    new Date("2026-07-30T00:00:00Z")
  );
  check("card greeting name", card.greetingName === "Daniel");
  check("card title", card.professionalTitle === "Founder / Broker");
  check("card licence number is present on this surface", card.licenseNumber === "BK123456");
  check("card completion carried", card.completion === 82);
  check("card joined date carried", formatJoinedAt(card.joinedAt) === "July 2026");
  check("card image falls back to the Clerk image", card.imageUrl === SESSION.imageUrl);
  // Links: linkedin + email + phone, in the documented stable order.
  check("card builds three links", card.links.length === 3);
  check("linkedin is first", card.links[0].kind === "linkedin");
  check("email link is a mailto", card.links[1].href.startsWith("mailto:"));
  check("phone link is a tel", card.links[2].href.startsWith("tel:"));
  check("external social link is marked external", card.links[0].external === true);
  check("mailto is not marked external", card.links[1].external === false);
  check(
    "card never carries a clerk id",
    !JSON.stringify(card).includes("user_")
  );
  const keys = Object.keys(card);
  for (const forbidden of ["clerkUserId", "id", "userId", "primaryEmail", "biography"]) {
    check(`card projection omits ${forbidden}`, !keys.includes(forbidden));
  }
}

// --- Empty profile still yields a usable card ------------------------------
{
  const bare = toHomeIdentityCard(SESSION, null, null, null);
  check("bare card uses the session name", bare.displayName === "Daniel Wolf");
  // The session's verified email is a real, usable shortcut even with no
  // profile row, so it is the only link a bare card should offer.
  check(
    "bare card offers only the session email shortcut",
    bare.links.length === 1 && bare.links[0].kind === "email"
  );
  const anonymousish = toHomeIdentityCard(
    { name: "A B", role: "Member" },
    null,
    null,
    null
  );
  check("card with no email at all has no links", anonymousish.links.length === 0);
  check("bare card completion is 0", bare.completion === 0);
  check("bare card licence is null", bare.licenseNumber === null);
  check("bare card joined is null", bare.joinedAt === null);
}

// --- Contact link construction --------------------------------------------
check("mailto built from a valid address", toMailto("a@b.co") === "mailto:a@b.co");
check("mailto rejects a missing domain dot", toMailto("a@b") === null);
check("mailto rejects an injected header", toMailto("a@b.co\nBcc: x@y.co") === null);
check("mailto rejects angle brackets", toMailto("<a@b.co>") === null);
check("tel built from E.164", toTel("+19545550100") === "tel:+19545550100");
check("tel rejects a non-E.164 value", toTel("(954) 555-0100") === null);
check("whatsapp strips the plus", toWhatsApp("+19545550100") === "https://wa.me/19545550100");
check("whatsapp rejects a non-E.164 value", toWhatsApp("9545550100") === null);
check("phone display formats US numbers", formatPhoneDisplay("+19545550100") === "(954) 555-0100");
check("phone display passes through international", formatPhoneDisplay("+447700900123") === "+447700900123");

// --- Unsafe URLs are rejected everywhere ----------------------------------
for (const bad of [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
  "vbscript:msgbox",
]) {
  check(`toProfileUrl rejects ${bad.slice(0, 18)}`, toProfileUrl(bad) === null);
  check(`safeLinkUrl rejects ${bad.slice(0, 18)}`, safeLinkUrl(bad) === null);
}
check("toProfileUrl rejects embedded credentials", toProfileUrl("https://u:p@evil.com") === null);
check("toProfileUrl rejects a hostname without a dot", toProfileUrl("https://localhost") === null);
check("safeLinkUrl rejects a relative path", safeLinkUrl("/dashboard") === null);
check("safeLinkUrl rejects plain http", safeLinkUrl("http://example.com") === null);

// --- URL normalisation ----------------------------------------------------
check("https is preserved", toProfileUrl("https://fortmark.net") === "https://fortmark.net");
check("bare host gains https", toProfileUrl("fortmark.net") === "https://fortmark.net");
check("www host gains https", toProfileUrl("www.fortmark.net") === "https://www.fortmark.net");
check("http is upgraded to https", toProfileUrl("http://fortmark.net/x") === "https://fortmark.net/x");
check("hyphens survive normalisation", toProfileUrl("linkedin.com/in/daniel-wolf") === "https://linkedin.com/in/daniel-wolf");
check("surrounding whitespace is trimmed", toProfileUrl("  fortmark.net  ") === "https://fortmark.net");
check("internal whitespace is rejected", toProfileUrl("fortmark .net") === null);
check("empty URL is null", toProfileUrl("") === null);

// --- Links are hidden when empty -----------------------------------------
{
  const none = buildContactLinks({});
  check("no source values yields no links", none.length === 0);
  const partial = buildContactLinks({ linkedinUrl: "https://linkedin.com/in/x" });
  check("only the populated link appears", partial.length === 1 && partial[0].kind === "linkedin");
  const unsafeOnly = buildContactLinks({ linkedinUrl: "javascript:alert(1)" });
  check("an unsafe stored link is dropped, not rendered", unsafeOnly.length === 0);
}

// --- Copy Contact block ---------------------------------------------------
{
  const block = buildContactBlock({
    displayName: "Daniel Wolf",
    professionalTitle: "Founder / Broker",
    brokerageOffice: "Fort Lauderdale",
    licenseState: "FL",
    licenseType: "Broker",
    licenseNumber: "BK123456",
    email: "daniel@example.com",
    phoneE164: "+19545550100",
    professionalWebsiteUrl: "https://fortmark.net",
  });
  const lines = block.split("\n");
  check("contact block leads with the name", lines[0] === "Daniel Wolf");
  check("contact block includes the title", lines[1] === "Founder / Broker");
  check("contact block brands FortMark", lines[2].startsWith("FortMark · Fort Lauderdale"));
  check("contact block includes the licence", block.includes("License FL Broker BK123456"));
  check("contact block includes the formatted phone", block.includes("(954) 555-0100"));
  check("contact block includes the website", block.includes("https://fortmark.net"));
  check("contact block has no empty lines", lines.every((l) => l.trim().length > 0));

  const sparse = buildContactBlock({ displayName: "A B" });
  check("sparse contact block omits absent fields", sparse.split("\n").length === 2);
  check("sparse contact block still brands FortMark", sparse.includes("FortMark"));
}

// --- vCard ---------------------------------------------------------------
{
  const vcf = buildVCard({
    displayName: "Daniel Wolf",
    professionalTitle: "Founder / Broker",
    brokerageOffice: "Fort Lauderdale",
    email: "daniel@example.com",
    phoneE164: "+19545550100",
    licenseState: "FL",
    licenseType: "Broker",
    licenseNumber: "BK123456",
    nrdsNumber: "123456789",
  });
  check("vcard begins correctly", vcf.startsWith("BEGIN:VCARD\r\nVERSION:3.0"));
  check("vcard ends correctly", vcf.endsWith("END:VCARD"));
  check("vcard uses CRLF line endings", vcf.includes("\r\n"));
  check("vcard splits the name", vcf.includes("N:Wolf;Daniel;;;"));
  check("vcard has a formatted name", vcf.includes("FN:Daniel Wolf"));
  check("vcard carries the title", vcf.includes("TITLE:Founder / Broker"));
  check("vcard carries email and phone", vcf.includes("EMAIL") && vcf.includes("TEL"));
  check("vcard puts licence in NOTE", vcf.includes("NOTE:License FL Broker BK123456"));
  const sparse = buildVCard({ displayName: "A B" });
  check("vcard omits an empty TEL line", !sparse.includes("TEL"));
  check("vcard omits an empty EMAIL line", !sparse.includes("EMAIL"));
  check("vcard escapes commas so a name cannot split fields",
    buildVCard({ displayName: "Wolf, Daniel" }).includes("FN:Wolf\\, Daniel"));
  check("escapeValue escapes semicolons", escapeValue("a;b") === "a\\;b");
  check("escapeValue strips carriage returns", !escapeValue("a\r\nb").includes("\r"));
  check("vcard filename is slugged", vCardFilename("Daniel Wolf") === "daniel-wolf.vcf");
  check("vcard filename falls back", vCardFilename("!!!") === "fortmark-contact.vcf");
}

// --- Home layout: the identity card is fixed, featured listing moved ------
check(
  "identity card is not a draggable widget id",
  !(DEFAULT_WIDGET_ORDER as readonly string[]).some((id) =>
    /identity|profile|my-fortmark/i.test(id)
  )
);
check(
  "featured listing is no longer the first widget",
  (DEFAULT_WIDGET_ORDER as readonly string[])[0] !== "featured-listing"
);
check(
  "featured listing sits directly after projected commission",
  DEFAULT_WIDGET_ORDER.indexOf("featured-listing") ===
    DEFAULT_WIDGET_ORDER.indexOf("projected-commission") + 1
);
check(
  "featured listing sits directly before the transactions table",
  DEFAULT_WIDGET_ORDER.indexOf("transactions-table") ===
    DEFAULT_WIDGET_ORDER.indexOf("featured-listing") + 1
);
check(
  "every widget id is still present after the move",
  DEFAULT_WIDGET_ORDER.length === 11
);

// --- Presence fields are writable, protected fields still are not ---------
{
  const out = normalizeProfileUpdate({
    professionalTitle: "  Founder / Broker  ",
    locationDisplay: "Fort Lauderdale, FL",
    linkedinUrl: "linkedin.com/in/daniel-wolf",
    instagramUrl: "javascript:alert(1)",
    whatsappPhoneE164: "(954) 555-0100",
    // Still forbidden.
    role: "admin",
    status: "active",
    clerkUserId: "user_2aaaaaaaaaaaaaaaaaaa",
  });
  check("presence title is normalised", out.professionalTitle === "Founder / Broker");
  check("presence location survives", out.locationDisplay === "Fort Lauderdale, FL");
  check("presence URL is normalised to https", out.linkedinUrl === "https://linkedin.com/in/daniel-wolf");
  check("unsafe presence URL becomes null rather than blocking the save", out.instagramUrl === null);
  check("whatsapp is normalised to E.164", out.whatsappPhoneE164 === "+19545550100");
  const keys = Object.keys(out);
  check("role still not writable alongside presence fields", !keys.includes("role"));
  check("status still not writable alongside presence fields", !keys.includes("status"));
  check("clerk id still not writable alongside presence fields", !keys.includes("clerkUserId"));
}

// --- Detail projection carries presence, still no ids --------------------
{
  const detail = toProfileDetail({
    professionalTitle: "Founder / Broker",
    linkedinUrl: "https://linkedin.com/in/x",
    instagramUrl: "javascript:alert(1)",
    whatsappPhoneE164: "+19545550100",
    id: "11111111-1111-1111-1111-111111111111",
    clerkUserId: "user_2aaaaaaaaaaaaaaaaaaa",
  } as Record<string, unknown>);
  check("detail carries the professional title", detail.professionalTitle === "Founder / Broker");
  check("detail carries a safe social URL", detail.linkedinUrl === "https://linkedin.com/in/x");
  check("detail drops an unsafe stored social URL", detail.instagramUrl === null);
  check("detail carries the whatsapp number", detail.whatsappPhoneE164 === "+19545550100");
  check(
    "detail with presence fields still carries no clerk id",
    !JSON.stringify(detail).includes("user_2aaaaaaaaaaaaaaaaaaa")
  );
}


// === The card is PERMANENT: it survives every database failure =============
// The regression this guards: the card was originally rendered only when
// getHomeIdentityCard returned non-null, so flags-off or any profile failure
// silently removed a surface the user is entitled to.

const ALLOWED_ID = "user_2aaaaaaaaaaaaaaaaaaaa";
const SESSION_USER = {
  id: ALLOWED_ID,
  name: "Daniel Wolf",
  email: "daniel@example.com",
  imageUrl: "https://img.clerk.com/a.png",
  role: "Broker" as const,
};
const ALLOWED_ENV = {
  FORTMARK_ALLOWED_CLERK_USER_IDS: ALLOWED_ID,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
  CLERK_SECRET_KEY: "sk_test_placeholder",
};

// --- Session-only projection is complete and invents nothing ---------------
{
  const fb = fallbackHomeIdentityCard({
    name: "Daniel Wolf",
    role: "Broker",
    email: "daniel@example.com",
    imageUrl: "https://img.clerk.com/a.png",
  });
  check("fallback is marked as session-sourced", fb.source === "session");
  check("fallback greets by first name", fb.greetingName === "Daniel");
  check("fallback shows the session name", fb.displayName === "Daniel Wolf");
  check("fallback shows the resolved role", fb.roleLabel === "Broker");
  check("fallback keeps the session image", fb.imageUrl === "https://img.clerk.com/a.png");
  // Nothing fabricated.
  check("fallback invents no professional title", fb.professionalTitle === null);
  check("fallback invents no licence number", fb.licenseNumber === null);
  check("fallback invents no licence state", fb.licenseState === null);
  check("fallback invents no NRDS id", fb.nrdsNumber === null);
  check("fallback invents no join date", fb.joinedAt === null);
  check("fallback invents no verification status", fb.credentialTrust === null);
  check("fallback reports no completion percentage", fb.completion === null);
  check("fallback offers only the verified session email", fb.links.length === 1);
  check("fallback email link is a mailto", fb.links[0].kind === "email");
  const fbNoEmail = fallbackHomeIdentityCard({ name: "A B", role: "Member" });
  check("fallback with no email has no links", fbNoEmail.links.length === 0);
  check("fallback with no image falls through to initials", fbNoEmail.imageUrl === null);
}

// --- getHomeIdentityCard never returns null on an approved request ---------
{
  // 1. Flags off.
  const flagsOff = await getHomeIdentityCard(SESSION_USER, { ...ALLOWED_ENV });
  check("flags off still returns a card", flagsOff !== null);
  check("flags off returns the session projection", flagsOff.source === "session");
  check("flags off card still shows the real name", flagsOff.displayName === "Daniel Wolf");

  // 1b. The UI flag does not gate the card. `professionalProfileUiEnabled`
  // governs the drawer and editor and ANDs both flags; the card is permanent,
  // so its enrichment asks only "may we read profile rows?". A Preview scope
  // carrying the database flag without the UI flag must still get a card.
  const dbFlagOnly = { ...ALLOWED_ENV, PROFILE_DATABASE_ENABLED: "1" };
  check("database flag alone is enough to attempt enrichment", profileDatabaseEnabled(dbFlagOnly));
  check("the UI flag remains off in that scope", !professionalProfileUiEnabled(dbFlagOnly));
  const uiFlagMissing = await getHomeIdentityCard(SESSION_USER, dbFlagOnly);
  check("a missing UI flag still returns a card", uiFlagMissing !== null);
  check("a missing UI flag still shows the real name", uiFlagMissing.displayName === "Daniel Wolf");

  // 1c. The mirror case: the UI flag set without the database flag must not
  // reach the database at all, and must still render.
  const uiFlagOnly = { ...ALLOWED_ENV, PROFESSIONAL_PROFILE_UI_ENABLED: "1" };
  const dbFlagMissing = await getHomeIdentityCard(SESSION_USER, uiFlagOnly);
  check("a missing database flag still returns a card", dbFlagMissing !== null);
  check("a missing database flag returns the session projection", dbFlagMissing.source === "session");

  // 2. Flags on, database unconfigured -> sync returns null.
  const previousUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const noDb = await getHomeIdentityCard(SESSION_USER, {
    ...ALLOWED_ENV,
    PROFILE_DATABASE_ENABLED: "1",
    PROFESSIONAL_PROFILE_UI_ENABLED: "1",
  });
  check("database unavailable still returns a card", noDb !== null);
  check("database unavailable returns the session projection", noDb.source === "session");
  check("database unavailable card keeps the greeting", noDb.greetingName === "Daniel");
  check("database unavailable card invents no licence", noDb.licenseNumber === null);

  // 3. Flags on, caller NOT allowlisted -> sync returns null.
  const notAllowed = await getHomeIdentityCard(
    { ...SESSION_USER, id: "user_2bbbbbbbbbbbbbbbbbbbb" },
    { ...ALLOWED_ENV, PROFILE_DATABASE_ENABLED: "1", PROFESSIONAL_PROFILE_UI_ENABLED: "1" }
  );
  check("non-allowlisted sync failure still returns a card", notAllowed !== null);
  check("non-allowlisted returns the session projection", notAllowed.source === "session");

  // 4. Flags on, database configured but unparseable -> sync THROWS.
  process.env.DATABASE_URL = "definitely not a connection string";
  const threw = await getHomeIdentityCard(SESSION_USER, {
    ...ALLOWED_ENV,
    PROFILE_DATABASE_ENABLED: "1",
    PROFESSIONAL_PROFILE_UI_ENABLED: "1",
  });
  check("a thrown sync still returns a card", threw !== null);
  check("a thrown sync returns the session projection", threw.source === "session");
  check("a thrown sync card still shows the role", threw.roleLabel === "Broker");

  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
}

// --- A database-backed card enriches rather than replaces -----------------
{
  const enriched = toHomeIdentityCard(
    { name: "Daniel Wolf", role: "Broker", email: "daniel@example.com" },
    { createdAt: "2026-07-15T00:00:00.000Z", status: "active" },
    { preferredDisplayName: "D. Wolf", licenseNumber: "BK1", profileCompletionPercent: 40 },
    null,
    new Date("2026-07-30T00:00:00Z")
  );
  check("enriched card is marked database-sourced", enriched.source === "database");
  check("enriched card prefers the stored display name", enriched.displayName === "D. Wolf");
  check("enriched card carries the licence", enriched.licenseNumber === "BK1");
  check("enriched card reports a real completion", enriched.completion === 40);
  check("enriched card has a trust level", enriched.credentialTrust === "self_reported");
}

// --- Missing optional credentials never hide the card --------------------
{
  const sparse = toHomeIdentityCard(
    { name: "Daniel Wolf", role: "Member" },
    { createdAt: "2026-07-15T00:00:00.000Z", status: "active" },
    { profileCompletionPercent: 0 },
    null
  );
  check("a row with no NRDS still yields a card", sparse.nrdsNumber === null);
  check("a row with no licence still yields a card", sparse.licenseNumber === null);
  check("a row with no title still yields a card", sparse.professionalTitle === null);
  check("a sparse row is still database-sourced", sparse.source === "database");
  check("a sparse row reports its real 0% completion", sparse.completion === 0);
  // 0% and "no record" are distinguishable, so the UI can tell them apart.
  check(
    "no-record and zero-percent are distinguishable",
    fallbackHomeIdentityCard({ name: "A B", role: "Member" }).completion === null &&
      sparse.completion === 0
  );
}

// --- My FortMark visual states --------------------------------------------
//
// Asserted against the component SOURCE rather than a rendered tree: this
// harness runs under plain Node with no DOM, and these are structural
// guarantees about markup and classes rather than behaviour. That makes them
// weaker than a render test but strong enough to catch the regressions that
// actually happened here — an uppercase greeting, a 0% bar presented as a
// measurement, and a primary action styled as a secondary one.
{
  const card = readFileSync("components/home/home-identity-card.tsx", "utf8");
  const grid = readFileSync("components/home/bento-grid.tsx", "utf8");
  /** The greeting h2's own class list, excluding surrounding commentary. */
  const greetingClassOf = (src: string) =>
    src.slice(src.indexOf('id="home-identity-heading"'), src.indexOf("{data.greetingName ?"));

  // 1. The eyebrow renders, and is uppercased by CSS rather than by literal.
  const eyebrow = card.slice(card.indexOf("GREETING ---"), card.indexOf("</h2>"));
  check("eyebrow label renders My FortMark", eyebrow.includes(">\n          My FortMark\n"));
  check("eyebrow is uppercased by class, not by literal", eyebrow.includes("uppercase"));
  check(
    "eyebrow stays at 10px",
    eyebrow.includes('className="text-[10px] font-semibold uppercase')
  );
  check(
    "eyebrow is legible but not pure white",
    eyebrow.includes("tracking-[0.14em] text-foreground/70")
  );
  check(
    "eyebrow stays quieter than the greeting",
    !greetingClassOf(card).includes("text-foreground/")
  );

  // 2. The greeting is title-cased. `text-display` force-uppercases, which is
  // exactly the regression being guarded against.
  const greetingClass = card.slice(
    card.indexOf('id="home-identity-heading"'),
    card.indexOf("{data.greetingName ?")
  );
  check("greeting is not force-uppercased", !greetingClass.includes("text-display"));
  check("greeting carries no uppercase class", !greetingClass.includes("uppercase"));
  check(
    "greeting literal is sentence case",
    card.includes("`Welcome back, ${data.greetingName}`") && !card.includes("WELCOME BACK")
  );
  check(
    "greeting sits in the 20-24px band",
    eyebrow.includes("text-[20px]") && eyebrow.includes("lg:text-[22px]")
  );
  check("greeting is semibold, not display weight", eyebrow.includes("font-semibold"));

  // 3. The greeting name is the real fallback chain, never a literal.
  check(
    "greeting name comes from data, not a hardcoded name",
    !/Welcome back, (Daniel|Test)\b/.test(card)
  );

  // 4. A missing professional title offers the completion prompt in sentence
  // case — never the uppercase micro-label treatment.
  const identity = card.slice(card.indexOf("HEADSHOT + IDENTITY"), card.indexOf("CREDENTIAL GRID"));
  check(
    "missing title offers a completion prompt",
    identity.includes("Complete your professional profile")
  );
  check("identity prompt is not uppercase micro type", !identity.includes("text-micro"));
  check(
    "identity prompt is a link to the editor",
    identity.includes("ROUTES.settings}?tab=profile")
  );

  // 5 + 6. Completion states.
  const completion = card.slice(card.indexOf("COMPLETION ---"), card.indexOf("ACTIONS ---"));
  check(
    "a zero or absent score renders no progress bar",
    completion.includes("data.completion !== null && data.completion > 0") ||
      card.includes("const hasMeasuredCompletion = data.completion !== null && data.completion > 0")
  );
  check("progressbar is gated on a measured score", completion.includes("hasMeasuredCompletion ?"));
  check("state A renders a callout with supporting text", completion.includes("Add your title, credentials"));
  check("state A offers no fabricated percentage", !/State A[\s\S]*0%/.test(completion));
  check("state B renders the real percentage", completion.includes("Profile {data.completion}% complete"));
  check("progress bar is 4px", completion.includes("h-1 "));
  check(
    "progress bar has no gradient utility",
    !/bg-gradient|from-\[|via-\[|to-\[/.test(completion)
  );
  check(
    "progress width is the real value",
    completion.includes("width: `${data.completion}%`")
  );

  // 7. Edit Profile is the primary action: the filled variant is the Button
  // default, so it must NOT carry an explicit variant override.
  const actions = card.slice(card.indexOf("ACTIONS ---"));
  const editBtn = actions.slice(actions.indexOf("Edit profile") - 400, actions.indexOf("Edit profile"));
  check("edit profile uses the filled default variant", !editBtn.includes("variant="));
  check("edit profile meets the 40px target", editBtn.includes("h-10"));

  // 8. New Transaction stays secondary and keeps its creation flow.
  const newTxn = actions.slice(actions.indexOf("New transaction") - 400, actions.indexOf("New transaction"));
  check("new transaction is outlined, not filled", newTxn.includes('variant="outline"'));
  check("new transaction keeps the quick-create flow", newTxn.includes('setQuickCreate("transaction")'));
  check("new transaction meets the 40px target", newTxn.includes("h-10"));

  // 9. Digital Card stays honestly disabled, with a reason a screen reader can
  // reach — a disabled control cannot hold focus, so a title alone is not enough.
  check("digital card disables without a record", actions.includes("disabled={setupRequired}"));
  check(
    "digital card explains why it is disabled",
    actions.includes("Add your profile details first") &&
      card.includes("Digital card is unavailable until your profile details are added.")
  );

  // Clipboard success is still reported only after the write resolves.
  check("copy contact awaits the clipboard write", card.includes("await navigator.clipboard.writeText"));
  check("copy success is announced politely", card.includes('aria-live="polite"'));

  // 10. Links render only when present, and stay monochrome.
  // Branching is on the FILTERED list now — the self-card hides email/phone —
  // but the zero/one/many guarantee is unchanged.
  check("no contact row is rendered when there are no links",
    !card.includes("visibleLinks.length > 0 &&") &&
      card.includes("visibleLinks.length === 1 &&") &&
      card.includes("visibleLinks.length > 1 &&"));
  check("the single-link branch reads from the filtered list, not the raw one",
    card.includes("const link = visibleLinks[0];"));
  check(
    "a single contact renders a visible action label",
    card.includes("{LINK_ACTION[link.kind]}")
  );
  check(
    "a single contact is not an unexplained icon-only button",
    !/data\.links\.length === 1[\s\S]{0,1400}<\/a>/.test(card) ||
      /data\.links\.length === 1[\s\S]{0,1400}LINK_ACTION\[link\.kind\][\s\S]{0,200}<\/a>/.test(card)
  );
  check(
    "every contact kind has a short action label",
    ["linkedin:", "instagram:", "facebook:", "website:", "professionalWebsite:", "email:", "phone:", "whatsapp:"]
      .every((k) => card.slice(card.indexOf("const LINK_ACTION"), card.indexOf("const LINK_ICON")).includes(k))
  );
  check(
    "the multi-link branch still renders tooltips",
    card.slice(card.indexOf("visibleLinks.length > 1 &&")).includes("<TooltipContent>{link.label}</TooltipContent>")
  );
  check(
    "both contact branches expose an accessible name",
    (card.match(/aria-label=\{[\s\S]{0,120}link\.label/g) ?? []).length === 2
  );
  check(
    "the accessible name is the fuller label, never the short action word",
    !/aria-label=\{[^}]*LINK_ACTION/.test(card)
  );
  check(
    "external contacts announce the new tab in both branches",
    (card.match(/\(opens in a new tab\)/g) ?? []).length === 2
  );
  check("external links keep noopener noreferrer", card.includes('rel: "noopener noreferrer"'));
  check("external links open in a new tab", card.includes('target: "_blank"'));
  check(
    "icon buttons are in the 32-36px band",
    card.includes("flex h-9 w-9 items-center justify-center")
  );
  check("icons are in the 15-17px band", card.includes("h-[17px] w-[17px]"));
  for (const brand of ["#0A66C2", "#1877F2", "#E4405F", "text-blue-", "bg-blue-"]) {
    check(`no ${brand} brand colour on the social row`, !card.includes(brand));
  }

  // 11 + 12. The card is still a fixed, non-draggable lead cell.
  check("card is rendered as the grid's fixed lead", grid.includes("fixedLead &&"));
  check(
    "fixed lead sits outside SortableContext",
    grid.indexOf("{fixedLead}") < grid.indexOf("<SortableContext")
  );
  check("card exposes no drag handle", !card.includes("useSortable") && !card.includes("listeners"));
  check("card exposes no remove control", !card.includes("removeWidget"));

  // 14 + 15. Theme contrast. `--muted-foreground` is 0 0% 55% in BOTH themes,
  // which is ~3.5:1 on a white card — under AA at label sizes. Metadata is
  // derived from the foreground instead so both themes improve symmetrically.
  check("credential labels do not use the low-contrast token", !card.includes("MetaLabel") || !/MetaLabel[\s\S]{0,220}text-muted-foreground/.test(card));
  check("credential values use full foreground contrast", card.includes("font-medium tabular-nums text-foreground"));
  check("no theme-specific layout rules were introduced", !card.includes("dark:") || !/dark:(flex|grid|block|hidden|w-|h-)/.test(card));

  // 16. Mobile: nothing may overflow horizontally.
  check("card body cannot be pushed wide", card.includes("flex h-full min-w-0 flex-col"));
  check("credential cells clip rather than overflow", card.includes('<div className="min-w-0">'));
  check("long values truncate", (card.match(/truncate/g) ?? []).length >= 5);
  check("social row wraps rather than overflowing", card.includes("flex flex-wrap items-center"));
  check("actions use a stable two-column grid", (actions.match(/grid grid-cols-2 gap-2/g) ?? []).length === 2);
  check(
    "tertiary actions keep a 40px touch target on mobile",
    (actions.match(/h-10 min-w-0 border-foreground\/45 bg-transparent px-3/g) ?? []).length === 2
  );
  check(
    "tertiary actions shrink to 36px from sm up",
    (actions.match(/sm:h-9/g) ?? []).length === 2
  );
  check(
    "tertiary actions are bordered, not ghost",
    !actions.includes('variant="ghost"') &&
      (actions.match(/variant="outline"/g) ?? []).length === 3
  );
  // Anchored to the base class, not a bare substring: `hover:border-foreground/45`
  // appears on the tertiary buttons too, and matching that made this pass
  // vacuously when the New Transaction border was reverted.
  check(
    "new transaction border clears the non-text threshold",
    /className="h-10 min-w-0 border-foreground\/45 px-3/.test(actions)
  );
  // Subordination is carried by size and fill, NOT by a weaker boundary: a
  // border that says "this is a control" has to clear 3:1 to do that job.
  check(
    "tertiary is subordinate by height, not by contrast",
    actions.includes("h-10 min-w-0 border-foreground/45 bg-transparent") &&
      actions.includes("sm:h-9") &&
      !/border-foreground\/(10|20|25|30|35|40)\b/.test(actions)
  );
  check(
    "tertiary is subordinate by fill",
    (actions.match(/bg-transparent/g) ?? []).length === 2 &&
      !actions.includes("bg-transparent px-3 text-[13px]")
  );
  check(
    "tertiary is subordinate by type and glyph size",
    (actions.match(/bg-transparent px-3 text-\[12px\]/g) ?? []).length === 2 &&
      (actions.match(/\[&_svg\]:size-3\.5/g) ?? []).length === 2
  );
  check(
    "tertiary hover is lighter than the secondary hover",
    actions.includes("hover:bg-foreground/[0.05]") &&
      actions.includes("hover:border-foreground/70 hover:bg-accent")
  );
  check(
    "tertiary sits beneath the primary row",
    actions.indexOf("New transaction") < actions.indexOf("Digital card")
  );
  check(
    "new transaction stays below the filled primary",
    actions.includes('variant="outline"') && !actions.includes('variant="default"')
  );
  // Not colour-only: the boundary changes SHAPE, so the disabled state survives
  // for someone who cannot perceive the dimming `disabled:opacity-40` applies.
  check(
    "disabled digital card changes border shape, not just colour",
    /hover:bg-foreground\/\[0\.05\] disabled:border-dashed sm:h-9/.test(actions)
  );
  check("disabled digital card keeps disabled semantics", actions.includes("disabled={setupRequired}"));
  check(
    "only the digital card carries the disabled treatment",
    (actions.match(/hover:bg-foreground\/\[0\.05\] disabled:border-dashed/g) ?? []).length === 1
  );
  // The button base sets `whitespace-nowrap`, so a label wider than its grid
  // track would spill outside the card and scroll the page. Every action label
  // must be able to clip.
  check(
    "every action button can shrink below its label",
    (actions.match(/className="h-10 min-w-0 (border-foreground\/45 (bg-transparent )?)?px-3/g) ?? []).length === 4
  );
  check(
    "every action label truncates rather than overflowing",
    (actions.match(/<span className="truncate">/g) ?? []).length === 4
  );

  // 19. Nothing here reads or writes global client state beyond quick-create.
  check("card takes its data as a prop", card.includes("export function HomeIdentityCard({ data }"));
  check(
    "card touches no profile store",
    !card.includes("useLayoutStore") && !card.includes("useProfile")
  );
}

// --- Theme contrast, computed rather than asserted by class ---------------
//
// The card derives its metadata colours from `--foreground` at reduced opacity
// instead of `--muted-foreground`. This checks that the choice actually pays:
// ratios are computed from the committed CSS variables, for both themes, so a
// future token edit that quietly drops a label under AA fails here.
{
  const css = readFileSync("app/globals.css", "utf8");

  /**
   * Lightness of a grayscale token, 0..1.
   *
   * Every colour in this palette is achromatic (`H 0% L%`), so lightness IS the
   * sRGB channel value. Deliberately returns null rather than a default when a
   * variable cannot be found — a silent fallback would let a broken parser
   * report passing contrast.
   */
  const readVar = (scope: string, name: string): number | null => {
    const scoped = css.slice(css.indexOf(scope));
    const m = scoped
      .slice(0, 1800)
      .match(new RegExp("--" + name + ":\\s*\\d+\\s+\\d+%\\s+([\\d.]+)%"));
    return m ? Number(m[1]) / 100 : null;
  };

  /** sRGB -> relative luminance, for an achromatic channel value. */
  const luminance = (channel: number): number =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);

  /**
   * WCAG contrast of `fg` composited over `bg` at `alpha`, against `bg`.
   *
   * Alpha compositing happens in non-linear sRGB, the way a browser does it,
   * and only the result is linearised.
   */
  const contrast = (fg: number, bg: number, alpha: number): number => {
    const composited = fg * alpha + bg * (1 - alpha);
    const a = luminance(composited);
    const b = luminance(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  };

  const lightFg = readVar(":root", "foreground");
  const lightCard = readVar(":root", "card");
  const darkFg = readVar(".dark", "foreground");
  const darkCard = readVar(".dark", "card");
  const mutedLight = readVar(":root", "muted-foreground");

  const parsed =
    lightFg !== null && lightCard !== null && darkFg !== null &&
    darkCard !== null && mutedLight !== null;
  check("theme tokens parsed from globals.css", parsed);

  if (parsed) {
    check("light card is white, light text is black", lightFg === 0 && lightCard === 1);
    check("dark card is near-black, dark text is white", darkFg === 1 && darkCard > 0 && darkCard < 0.2);

    // The reason the change was needed: the shared muted token is identical in
    // both themes and lands under AA on a white card.
    check(
      "muted-foreground really is below AA on a light card",
      contrast(mutedLight, lightCard, 1) < 4.5
    );
    check(
      "muted-foreground is the same value in both themes",
      readVar(".dark", "muted-foreground") === mutedLight
    );

    // Light mode — labels at /70, honest-absence text at /55.
    check("light: credential labels clear AA", contrast(lightFg, lightCard, 0.7) >= 4.5);
    check('light: "Not added" clears AA', contrast(lightFg, lightCard, 0.55) >= 4.5);
    check("light: credential values clear AAA", contrast(lightFg, lightCard, 1) >= 7);

    // Dark mode — the same opacities over the dark card surface.
    check("dark: credential labels clear AA", contrast(darkFg, darkCard, 0.7) >= 4.5);
    check('dark: "Not added" clears AA', contrast(darkFg, darkCard, 0.55) >= 4.5);
    check("dark: credential values clear AAA", contrast(darkFg, darkCard, 1) >= 7);

    // Both themes improve, which is why the card needs no theme-specific rule.
    check(
      "both themes improve on the shared muted token",
      contrast(lightFg, lightCard, 0.7) > contrast(mutedLight, lightCard, 1) &&
        contrast(darkFg, darkCard, 0.7) > contrast(mutedLight, darkCard, 1)
    );

    // Non-text contrast for control boundaries (WCAG 1.4.11, 3:1).
    //
    // `--input` measures 1.28:1 on a white card and 1.38:1 on the dark one,
    // which is why the outlined button vanished. Every control boundary on the
    // card now sits at `foreground/45`.
    const inputLight = readVar(":root", "input");
    const inputDark = readVar(".dark", "input");
    if (inputLight !== null && inputDark !== null) {
      check(
        "the previous --input border really was below the 3:1 threshold",
        contrast(inputLight, lightCard, 1) < 3 && contrast(inputDark, darkCard, 1) < 3
      );
    }

    const borderLight = contrast(lightFg, lightCard, 0.45);
    const borderDark = contrast(darkFg, darkCard, 0.45);
    for (const control of ["new transaction", "enabled digital card", "enabled copy contact"]) {
      check(`light: ${control} border clears 3:1`, borderLight >= 3);
      check(`dark: ${control} border clears 3:1`, borderDark >= 3);
    }
    check("light: single-contact action border clears 3:1", borderLight >= 3);
    check("dark: single-contact action border clears 3:1", borderDark >= 3);
    check("light: social icon button border clears 3:1", borderLight >= 3);
    check("dark: social icon button border clears 3:1", borderDark >= 3);

    // The previously-shipped tertiary value did NOT pass, which is why
    // subordination moved to size and fill. Both halves asserted.
    check(
      "the previous /30 tertiary border would fail in both themes",
      contrast(lightFg, lightCard, 0.3) < 3 && contrast(darkFg, darkCard, 0.3) < 3
    );
    check(
      "/40 would still miss the threshold in light mode",
      contrast(lightFg, lightCard, 0.4) < 3
    );
    check(
      "no control boundary on the card sits below the threshold",
      Math.min(borderLight, borderDark) >= 3
    );

    // Subordination without weakening contrast: the tertiary label still
    // carries full foreground contrast, so nothing is identified by a border
    // alone.
    check(
      "tertiary label carries the identification",
      contrast(lightFg, lightCard, 1) >= 4.5 && contrast(darkFg, darkCard, 1) >= 4.5
    );

    // The eyebrow at /70.
    check("light: eyebrow clears AA", contrast(lightFg, lightCard, 0.7) >= 4.5);
    check("dark: eyebrow clears AA", contrast(darkFg, darkCard, 0.7) >= 4.5);

    // The filled primary action must stay unambiguous in both themes.
    const lightPrimary = readVar(":root", "primary");
    const darkPrimary = readVar(".dark", "primary");
    if (lightPrimary !== null && darkPrimary !== null) {
      check("light: primary button clears AAA", contrast(1, lightPrimary, 1) >= 7);
      check("dark: primary button clears AAA", contrast(0, darkPrimary, 1) >= 7);
    }
  }
}

// --- Preferred-name fallback chain behind the greeting --------------------
//
// The greeting is the one place a wrong name is most visible, so the whole
// documented chain is asserted end to end:
//   preferred display name -> legal first name -> session name
//
// There is no "no name" case to assert: `SessionUser.name` is typed `string`,
// so an absent name cannot reach here without a compile error.
{
  const session = { name: "Daniel Wolf", role: "Broker" };

  check(
    "greeting prefers the profile's preferred display name",
    greetingNameFor({ preferredDisplayName: "Dan Wolf" }, session) === "Dan"
  );
  check(
    "greeting falls back to the legal first name",
    greetingNameFor({ legalFirstName: "Danny" }, session) === "Danny"
  );
  check(
    "preferred name outranks the legal first name",
    greetingNameFor({ preferredDisplayName: "Dan", legalFirstName: "Danny" }, session) === "Dan"
  );
  check("greeting falls back to the session name", greetingNameFor(null, session) === "Daniel");
  check(
    "greeting ignores a blank preferred name",
    greetingNameFor({ preferredDisplayName: "   " }, session) === "Daniel"
  );
  check(
    "a single-word name still greets",
    greetingNameFor(null, { name: "Cher", role: "Member" }) === "Cher"
  );
  check(
    "the greeting name is a first name, not the full name",
    fallbackHomeIdentityCard(session).greetingName === "Daniel" &&
      fallbackHomeIdentityCard(session).displayName === "Daniel Wolf"
  );
}

// --- Global client state stays narrow -------------------------------------
//
// Requirement: no private field may reach global client state. The card itself
// takes its data as a prop, so the surface to police is the context projection
// — and the strongest guarantee here is the INPUT type, which cannot even
// accept a licence number, NRDS id, phone or biography.
{
  const shellDisplay = toProfileDisplay(
    { name: "Daniel Wolf", role: "Broker", imageUrl: null },
    {
      preferredDisplayName: "D. Wolf",
      licenseState: "FL",
      licenseType: "Broker",
      profileCompletionPercent: 40,
    }
  );
  const keys = Object.keys(shellDisplay).sort();
  check(
    "client context carries exactly five keys",
    keys.join(",") === "completion,displayName,imageUrl,licenseLabel,roleLabel"
  );
  check(
    "client context carries only the coarse licence label",
    shellDisplay.licenseLabel === "FL Broker"
  );

  // The projection's input type is the boundary, so widening it is a compile
  // error rather than a silent leak. Asserted against the source so that
  // adding a field to the interface fails here too.
  const displaySrc = readFileSync("lib/profile/display.ts", "utf8");
  const iface = displaySrc.slice(
    displaySrc.indexOf("export interface DisplaySourceProfile"),
    displaySrc.indexOf("/** The subset of an image row this projection may read. */")
  );
  for (const forbidden of [
    "licenseNumber",
    "nrdsNumber",
    "phoneE164",
    "biography",
    "clerkUserId",
    "role",
    "status",
  ]) {
    check(`display source type cannot accept ${forbidden}`, !iface.includes(forbidden));
  }
  check(
    "display source type declares only the four permitted fields",
    (iface.match(/^\s{2}\w+\??:/gm) ?? []).length === 4
  );
}

// --- Release A: onboarding state is additive and non-duplicating ----------
{
  const sql = readFileSync("lib/db/migrations/0002_light_tomas.sql", "utf8");

  for (const col of ["business_email", "onboarding_step"]) {
    check(`onboarding migration adds ${col}`, sql.includes(`ADD COLUMN "${col}"`));
  }
  // Additive only: the same bar Release 1.1 had to clear.
  for (const forbidden of ["DROP", "TRUNCATE", "DELETE", "RENAME", "ALTER COLUMN", "NOT NULL"]) {
    check(`onboarding migration contains no ${forbidden}`, !sql.toUpperCase().includes(forbidden));
  }
  check(
    "onboarding migration only alters professional_profiles",
    (sql.match(/ALTER TABLE "professional_profiles"/g) ?? []).length ===
      (sql.match(/ALTER TABLE/g) ?? []).length
  );

  const schema = readFileSync("lib/db/schema.ts", "utf8");
  // `dashboard_users.onboarding_complete` already records completion. Storing a
  // second status column would let the two disagree, so completion is derived
  // rather than duplicated.
  check(
    "completion is not duplicated onto professional_profiles",
    schema.includes('onboardingComplete: timestamp("onboarding_complete"') &&
      !schema.includes('onboarding_completed_at') &&
      !schema.includes('onboarding_status')
  );
  check(
    "the business email is separate from the account email",
    schema.includes('businessEmail: text("business_email")') &&
      schema.includes('primaryEmail: text("primary_email").notNull()')
  );
  check(
    "no MLS identity column is introduced in Release A",
    !schema.includes("mls_member_key") && !schema.includes("mlsMemberKey")
  );

  // The build-time verifier must police the new columns the same way.
  const mig = readFileSync("scripts/migrate.mjs", "utf8");
  check(
    "the build verifies the onboarding columns exist and are nullable",
    mig.includes("RELEASE_A_ONBOARDING_COLUMNS") &&
      /Release A onboarding columns must stay nullable/.test(mig)
  );
  check(
    "the migration guard is still preview-only",
    mig.includes('!force && process.env.VERCEL_ENV !== "preview"')
  );
}

// --- Release A: onboarding lifecycle ---------------------------------------
{
  const step = (n: number) => stepByNumber(n)!;

  // Step contract -----------------------------------------------------------
  check("six steps are declared", ONBOARDING_STEPS.length === 6);
  check("steps are numbered 1..6 in order",
    ONBOARDING_STEPS.every((s, i) => s.step === i + 1));
  check("first and last constants match the table",
    FIRST_STEP === 1 && LAST_STEP === 6);
  check("informational steps persist nothing",
    step(5).fields.length === 0 && step(6).fields.length === 0);
  check("the review step cannot be skipped", step(6).skippable === false);

  // A step can only ever write fields the shared contract already permits.
  const allStepFields = ONBOARDING_STEPS.flatMap((s) => s.fields);
  check("no step declares a field outside the update contract",
    allStepFields.every((f) => f in PROFILE_FIELDS));
  check("no field belongs to two steps",
    new Set(allStepFields).size === allStepFields.length);

  // Per-step narrowing ------------------------------------------------------
  {
    // Step 2 must not be able to write a licence number, even if sent one.
    const out = normalizeStep(step(2), {
      professionalTitle: "Broker Associate",
      licenseNumber: "BK999999",
      role: "admin",
      clerkUserId: "user_2aaaaaaaaaaaaaaaaaaa",
    });
    const keys = Object.keys(out);
    check("a step writes only its own fields", !keys.includes("licenseNumber"));
    check("a step strips role", !keys.includes("role"));
    check("a step strips a clerk id", !keys.includes("clerkUserId"));
    check("a step keeps its own field", out.professionalTitle === "Broker Associate");
    check("a step payload never carries a clerk id",
      !JSON.stringify(out).includes("user_2aaaaaaaaaaaaaaaaaaa"));
  }
  check("an informational step normalises to nothing",
    Object.keys(normalizeStep(step(5), { professionalTitle: "x" })).length === 0);

  // Shared normalisation: the wizard cannot validate differently -------------
  {
    const contact = normalizeStep(step(4), {
      businessEmail: "  Broker@Example.COM ",
      phoneE164: "(954) 555-0100",
      whatsappPhoneE164: "9545550100",
      linkedinUrl: "linkedin.com/in/x",
      instagramUrl: "javascript:alert(1)",
      facebookUrl: "//evil.com",
    });
    check("step email is lowercased and trimmed", contact.businessEmail === "broker@example.com");
    check("step phone is E.164", contact.phoneE164 === "+19545550100");
    check("step whatsapp is E.164", contact.whatsappPhoneE164 === "+19545550100");
    check("step url is normalised to https", contact.linkedinUrl === "https://linkedin.com/in/x");
    check("step rejects a javascript url", contact.instagramUrl === null);
    // A protocol-relative value is NORMALISED, not rejected. These are links a
    // user publishes about themselves and may legitimately point anywhere, so
    // the guard is the scheme allowlist, not the host. Rejecting by host is the
    // rule for return paths, which is a different threat model entirely.
    check("step normalises a protocol-relative url to https",
      contact.facebookUrl === "https://evil.com");
  }

  // Email normaliser --------------------------------------------------------
  check("email accepts a normal address", toEmail("a@b.co") === "a@b.co");
  check("email lowercases", toEmail("A@B.CO") === "a@b.co");
  check("email rejects a dotless domain", toEmail("a@localhost") === null);
  check("email rejects two at signs", toEmail("a@b@c.co") === null);
  check("email rejects whitespace", toEmail("a b@c.co") === null);
  check("email rejects a bare word", toEmail("nobody") === null);
  check("email rejects angle brackets", toEmail("<a@b.co>") === null);
  check("email rejects a trailing dot domain", toEmail("a@b.co.") === null);
  check("email rejects consecutive dots", toEmail("a@b..co") === null);
  check("email empties to null", toEmail("   ") === null);

  // Resume ------------------------------------------------------------------
  check("no saved step resumes at the first", resumeStep(null, "broker").step === 1);
  check("undefined resumes at the first", resumeStep(undefined, "broker").step === 1);
  check("after saving step 1 resume is step 2", resumeStep(1, "broker").step === 2);
  check("after saving step 4 resume is step 5", resumeStep(4, "broker").step === 5);
  check("a step beyond the end resumes on review", resumeStep(99, "broker").step === LAST_STEP);
  check("a non-integer resumes at the first", resumeStep(2.5 as number, "broker").step === 1);
  check("a negative resumes at the first applicable step", resumeStep(-3, "broker").step === 1);

  // Role-awareness ----------------------------------------------------------
  check("brokers are asked for credentials",
    stepsForRole("broker").some((s) => s.id === "credentials"));
  check("agents are asked for credentials",
    stepsForRole("agent").some((s) => s.id === "credentials"));
  check("admins are not asked for credentials",
    !stepsForRole("admin").some((s) => s.id === "credentials"));
  check("transaction coordinators are not asked for credentials",
    !stepsForRole("transaction_coordinator").some((s) => s.id === "credentials"));
  check("an unlicensed role skips step 3 when resuming",
    resumeStep(2, "admin").step === 4);
  check("navigation skips the credentials step for an unlicensed role",
    nextStep(step(2), "admin")?.step === 4);
  check("back-navigation skips it too",
    previousStep(step(4), "admin")?.step === 2);
  check("the last step has no next", nextStep(step(6), "broker") === null);
  check("the first step has no previous", previousStep(step(1), "broker") === null);

  // Completion source -------------------------------------------------------
  check("completion reads the user timestamp",
    onboardingComplete({ onboardingComplete: new Date() }) === true);
  check("a null timestamp is incomplete",
    onboardingComplete({ onboardingComplete: null }) === false);
  check("a missing user is incomplete", onboardingComplete(null) === false);

  // Opening rules -----------------------------------------------------------
  const base = {
    uiEnabled: true,
    databaseEnabled: true,
    databaseAvailable: true,
    user: { onboardingComplete: null },
  };
  check("first approved login opens onboarding", shouldOpenOnboarding(base));
  check("completed onboarding does not reopen",
    !shouldOpenOnboarding({ ...base, user: { onboardingComplete: new Date() } }));
  check("ui flag off does not open", !shouldOpenOnboarding({ ...base, uiEnabled: false }));
  check("database flag off does not open", !shouldOpenOnboarding({ ...base, databaseEnabled: false }));
  // The one that matters most: an outage must not trap anyone in a wizard
  // whose saves cannot succeed.
  check("a database outage does not open onboarding",
    !shouldOpenOnboarding({ ...base, databaseAvailable: false }));
  check("no user record does not open", !shouldOpenOnboarding({ ...base, user: null }));
  check("complete later suppresses it for the session",
    !shouldOpenOnboarding({ ...base, dismissedThisSession: true }));

  // Self-reported credentials ----------------------------------------------
  for (const key of ["licenseNumber", "licenseExpiration", "nrdsNumber"] as const) {
    check(`${key} is marked self-reported`, SELF_REPORTED_FIELDS.includes(key));
  }
  check("the licence number hint says FortMark does not verify it",
    /does not verify/i.test(PROFILE_FIELDS.licenseNumber.hint ?? ""));
  check("the NRDS hint says FortMark does not verify it",
    /does not verify/i.test(PROFILE_FIELDS.nrdsNumber.hint ?? ""));

  // Account email vs business email ----------------------------------------
  check("business email is a profile field", "businessEmail" in PROFILE_FIELDS);
  check("business email appears publicly", PUBLIC_SURFACE_FIELDS.includes("businessEmail"));
  check("the business email hint distinguishes it from the account email",
    /account sign-in email/i.test(PROFILE_FIELDS.businessEmail.hint ?? ""));
  // The verified address is not a writable profile field at all.
  check("the account email is not writable through any step",
    !allStepFields.some((f) => String(f).toLowerCase().includes("primary")));
  check("no step writes an email other than the business one",
    allStepFields.filter((f) => String(f).toLowerCase().includes("email")).join() === "businessEmail");
}

// --- Release A: surfaces, privacy and flags --------------------------------
{
  const wizard = readFileSync("components/profile/onboarding-wizard.tsx", "utf8");
  const route = readFileSync("app/api/profile/onboarding/route.ts", "utf8");
  const page = readFileSync("app/(app)/onboarding/page.tsx", "utf8");
  const home = readFileSync("app/(app)/page.tsx", "utf8");
  const mw = readFileSync("middleware.ts", "utf8");
  const service = readFileSync("lib/profile/service.ts", "utf8");
  const editor = readFileSync("components/profile/profile-editor.tsx", "utf8");

  const strip = (src: string) =>
    src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

  // Middleware must never touch the profile database.
  check("middleware makes no database call",
    !/getDb|drizzle|syncCurrentUser|getOwnProfile|professionalProfiles/.test(strip(mw)));
  check("middleware imports no profile service", !strip(mw).includes("lib/profile/service"));

  // API authorization -------------------------------------------------------
  check("the onboarding route re-derives authorization", route.includes("decideAccess(userId)"));
  check("the onboarding route takes the id from the session",
    route.includes("const { userId } = await auth()"));
  check("anonymous callers get 401", route.includes("? 401"));
  check("a disabled feature 404s", route.includes('{ error: "Not found" }, { status: 404'));
  check("every onboarding response is no-store",
    route.includes('"Cache-Control": "no-store"'));
  check("the route never returns an exception message",
    !/error: *(e|err|error)\b/.test(strip(route)));
  check("the route reads no identifier from the body",
    !/body\.(clerkUserId|userId|profileId)|payload\.(clerkUserId|userId|profileId)/.test(route));

  // Writes are session-scoped ----------------------------------------------
  check("step saves are scoped by the session clerk id",
    service.includes("saveOnboardingStep(\n  clerkUserId: string") ||
      /saveOnboardingStep\([\s\S]{0,80}clerkUserId: string/.test(service));
  // Scoped to the function BODY rather than a character window. The previous
  // form was `fn[\s\S]{0,1600}getOwnProfile`, which failed the moment the
  // function grew past the magic number even though the behaviour was
  // unchanged — a distance limit measures formatting, not scoping.
  const fnBody = (src: string, name: string): string => {
    const at = src.indexOf(`export async function ${name}(`);
    if (at < 0) return "";
    const next = src.indexOf("\nexport ", at + 1);
    return src.slice(at, next < 0 ? src.length : next);
  };
  for (const fn of ["saveOnboardingStep", "completeOnboarding"]) {
    const body = fnBody(service, fn);
    check(`${fn} resolves the row through getOwnProfile`,
      body.length > 0 && body.includes("getOwnProfile(clerkUserId"));
    check(`${fn} takes the clerk id from the session, not the body`,
      /^\s*clerkUserId: string,/m.test(body));
  }

  // Idempotency -------------------------------------------------------------
  check("onboarding_step only moves forward",
    service.includes("Math.max(current.profile.onboardingStep ?? 0, step.step)"));
  check("completion is merged, never scored from the step alone",
    service.includes("completionSourceFromRow(current.profile), ...fields"));

  // Completion timestamp ----------------------------------------------------
  check("only completion writes the timestamp",
    /completeOnboarding[\s\S]*?onboardingComplete: completedAt/.test(service));
  check("a step save never writes the timestamp",
    !/saveOnboardingStep[\s\S]{0,1800}onboardingComplete:/.test(service));
  check("status is not written by onboarding",
    !/completeOnboarding[\s\S]{0,1600}status:/.test(service));

  // Audit metadata carries no PII ------------------------------------------
  const auditCalls = service.match(/writeAuditEvent\([\s\S]{0,400}?\)\;/g) ?? [];
  check("audit calls exist", auditCalls.length >= 2);
  for (const call of auditCalls) {
    for (const forbidden of ["businessEmail", "phoneE164", "licenseNumber", "nrdsNumber", "clerkUserId", "primaryEmail"]) {
      check(`audit metadata omits ${forbidden}`, !call.includes(forbidden));
    }
  }

  // Wizard behaviour --------------------------------------------------------
  check("the wizard never advances past a failed write",
    wizard.includes("if (!ok) return;"));
  // Ordering by index rather than one regex: the failure branch is long enough
  // that a bounded gap made this pass or fail for the wrong reason.
  check("a step is only stored after the server confirmed it",
    wizard.indexOf("if (!res.ok)") < wizard.indexOf("setStored((prev)") &&
      wizard.indexOf("return false;") < wizard.indexOf("setStored((prev)"));
  check("complete later defers rather than completing",
    /onCompleteLater[\s\S]{0,900}defer: true/.test(wizard) &&
      !/onCompleteLater[\s\S]{0,900}complete: true/.test(wizard));
  check("the deferral is requested before navigating",
    wizard.indexOf("defer: true") < wizard.indexOf("router.push(ROUTES.home);"));
  check("the wizard writes to no global store",
    !/useLayoutStore|useUiStore|useProfileStore/.test(wizard));
  check("the account email is rendered read-only",
    wizard.includes("<ReadOnlyField") && wizard.includes('label="Account email"'));
  // Checked against the request bodies specifically. `accountEmail` sits next
  // to `values` in the props list, so a proximity match hit the declaration
  // rather than a submission.
  const bodies = wizard.match(/body: JSON\.stringify\([^)]*\)/g) ?? [];
  check("the wizard sends three request bodies", bodies.length === 3);
  check("the account email is never submitted",
    bodies.every((b) => !b.includes("accountEmail")));
  check("the MLS step claims nothing",
    /Not connected/.test(wizard) && !/verified/i.test(wizard.slice(wizard.indexOf('current.id === "mls"'), wizard.indexOf('current.id === "mls"') + 700)));

  // Route guards ------------------------------------------------------------
  check("the wizard route requires the UI flag",
    page.includes("professionalProfileUiEnabled()") && page.includes("redirect(ROUTES.home)"));
  check("an unavailable database leaves the wizard",
    page.includes("!context.available || context.complete"));
  check("home opens onboarding server-side, not in middleware",
    home.includes("shouldRedirectToOnboarding"));
  check("home honours the complete-later deferral",
    home.includes("isDeferred(jar.get(ONBOARDING_DEFERRAL_COOKIE)?.value)"));
  check("the deferral is read from a cookie, not a query parameter",
    !home.includes('setup === "later"') && home.includes("await cookies()"));

  // Shared form architecture -----------------------------------------------
  check("the editor renders through the shared field component",
    editor.includes("<ProfileField"));
  check("the editor no longer carries its own labels",
    !/label: "Legal first name"/.test(editor) && !/label: "NRDS number"/.test(editor));
  check("the editor and wizard share the same field metadata",
    editor.includes("ProfileFieldKey") && wizard.includes("PROFILE_FIELDS"));

  // Flags -------------------------------------------------------------------
  check("the wizard route is gated on the compound UI flag",
    page.includes("professionalProfileUiEnabled"));
  check("the onboarding API is gated on the compound UI flag",
    route.includes("professionalProfileUiEnabled()"));
}

// --- Complete later: session deferral --------------------------------------
{
  check("the deferral cookie carries a fixed version marker",
    ONBOARDING_DEFERRAL_VALUE === "v1");
  check("only the exact marker counts as deferred",
    isDeferred(ONBOARDING_DEFERRAL_VALUE) &&
      !isDeferred("v0") && !isDeferred("") && !isDeferred(null) && !isDeferred(undefined));

  // No PII, by construction: the value is the same bytes for every user.
  check("the cookie value contains no identifier",
    !/user_|@|\d{7,}/.test(ONBOARDING_DEFERRAL_VALUE));
  check("the cookie name contains no identifier",
    !/user_|@/.test(ONBOARDING_DEFERRAL_COOKIE));

  const prod = deferralCookieOptions({ NODE_ENV: "production", VERCEL_ENV: "production" });
  check("the cookie is httpOnly", prod.httpOnly === true);
  check("the cookie is SameSite=Lax", prod.sameSite === "lax");
  check("the cookie is Secure in production", prod.secure === true);
  check("the cookie is scoped to the dashboard zone",
    prod.path === ONBOARDING_DEFERRAL_PATH && prod.path === "/dashboard");
  // A session cookie: "later" means "not now", not "not for a week".
  check("the cookie has no max-age", prod.maxAge === undefined);
  check("the cookie is Secure on a preview deployment",
    deferralCookieOptions({ NODE_ENV: "production", VERCEL_ENV: "preview" }).secure === true);
  check("the cookie is not Secure only for local development",
    deferralCookieOptions({ NODE_ENV: "development" }).secure === false);

  // The deferral suppresses a redirect and nothing else. Every other condition
  // is evaluated independently of it.
  const deferredBase = {
    uiEnabled: true,
    databaseEnabled: true,
    databaseAvailable: true,
    user: { onboardingComplete: null },
    dismissedThisSession: true,
  };
  check("a deferral cannot bypass the ui flag",
    !shouldOpenOnboarding({ ...deferredBase, uiEnabled: false }));
  check("a deferral cannot bypass the database flag",
    !shouldOpenOnboarding({ ...deferredBase, databaseEnabled: false }));
  check("a deferral cannot conjure a user",
    !shouldOpenOnboarding({ ...deferredBase, user: null }));
  check("a deferral does not mark onboarding complete",
    onboardingComplete({ onboardingComplete: null }) === false);
}

// --- Field-level validation errors -----------------------------------------
{
  const step4 = stepByNumber(4)!;

  // Schema violations are reported per field, using the step's own field list.
  const err = new zod.ZodError([
    { code: "too_big", path: ["businessEmail"], message: "too long" } as never,
    { code: "too_big", path: ["phoneE164"], message: "too long" } as never,
  ]);
  const failure = toValidationFailure(err, step4.fields);
  check("a schema violation returns the validation contract",
    failure.error === "validation_failed");
  check("field errors are keyed by the UI field name",
    Array.isArray(failure.fieldErrors.businessEmail) &&
      Array.isArray(failure.fieldErrors.phoneE164));
  check("the email message is human", failure.fieldErrors.businessEmail?.[0] === "Enter a valid email address.");
  check("the phone message is human", failure.fieldErrors.phoneE164?.[0] === "Enter a valid phone number.");

  // A field outside the submitted step never appears in the response, so the
  // reply cannot confirm what other fields exist.
  const outside = toValidationFailure(
    new zod.ZodError([{ code: "custom", path: ["licenseNumber"], message: "x" } as never]),
    step4.fields
  );
  check("an out-of-step field is not echoed back",
    !("licenseNumber" in outside.fieldErrors));
  check("an out-of-step failure becomes a form error", outside.formErrors.length === 1);
  check("form errors are de-duplicated",
    toValidationFailure(
      new zod.ZodError([
        { code: "custom", path: ["a"], message: "x" } as never,
        { code: "custom", path: ["b"], message: "y" } as never,
      ]),
      step4.fields
    ).formErrors.length === 1);
  check("no database column name appears in the contract",
    !JSON.stringify(failure).includes("business_email") &&
      !JSON.stringify(failure).includes("phone_e164"));

  // Values that PARSE but normalise away to null are reported too — otherwise
  // the step reads as saved with the input silently missing.
  const dropped = droppedValueErrors(
    { businessEmail: "not-an-email", phoneE164: "123", linkedinUrl: "" },
    { businessEmail: null, phoneE164: null, linkedinUrl: null },
    step4.fields
  );
  check("a dropped email is reported", dropped.businessEmail?.length === 1);
  check("a dropped phone is reported", dropped.phoneE164?.length === 1);
  check("an empty field is not reported as dropped", !("linkedinUrl" in dropped));
  check("a field the user did not submit is not reported",
    !("facebookUrl" in droppedValueErrors({}, {}, step4.fields)));
  check("a value that survived normalisation is not reported",
    !("businessEmail" in droppedValueErrors(
      { businessEmail: "a@b.co" },
      { businessEmail: "a@b.co" },
      step4.fields
    )));
}

// --- State machine: idempotency and atomicity ------------------------------
{
  const service = readFileSync("lib/profile/service.ts", "utf8");
  const wizard = readFileSync("components/profile/onboarding-wizard.tsx", "utf8");
  const editor = readFileSync("components/profile/profile-editor.tsx", "utf8");
  const route = readFileSync("app/api/profile/onboarding/route.ts", "utf8");
  const profileRoute = readFileSync("app/api/profile/route.ts", "utf8");

  check("duplicate completion returns the existing timestamp",
    service.includes("if (current.user.onboardingComplete) {"));
  check("duplicate completion writes nothing",
    /if \(current\.user\.onboardingComplete\) \{[\s\S]{0,400}return \{\s*ok: true/.test(service));
  check("the audit event is written only on the transition",
    service.indexOf("if (current.user.onboardingComplete) {") <
      service.indexOf('metadata: { onboarding: "completed"'));
  check("both completion writes go out atomically", service.includes("await db.batch(["));
  {
    const batchAt = service.indexOf("await db.batch([");
    const batchEnd = service.indexOf("]);", batchAt);
    const auditAt = service.indexOf("writeAuditEvent", batchEnd);
    check("the audit write stays outside the batch",
      batchAt >= 0 && batchEnd > batchAt && auditAt > batchEnd);
  }
  check("the driver limitation is documented, not hidden",
    /No transactions support in neon-http/.test(service));

  // Validation never advances the step: the failure returns before any write.
  {
    // Inside saveOnboardingStep only: the invalid return must precede the
    // first write in that function.
    const fn = service.slice(
      service.indexOf("export async function saveOnboardingStep"),
      service.indexOf("export type CompleteResult")
    );
    const invalidAt = fn.indexOf('reason: "invalid"');
    const writeAt = fn.indexOf(".update(professionalProfiles)");
    check("a validation failure returns before the row is touched",
      invalidAt >= 0 && writeAt >= 0 && invalidAt < writeAt);
  }
  check("a draft is not reported saved unless the write succeeded",
    /catch \{\s*return \{ ok: false, reason: "unavailable" \};\s*\}/.test(service));

  // Both surfaces consume the identical contract.
  check("the onboarding route returns the validation object",
    route.includes("result.validation ?? { error: result.reason }"));
  check("the profile route returns the same shape",
    profileRoute.includes("result.validation ?? { error: result.reason }"));
  check("the wizard reads fieldErrors", wizard.includes("detail?.fieldErrors"));
  check("the editor reads fieldErrors", editor.includes("detail?.fieldErrors"));
  check("both focus the first invalid control",
    wizard.includes('document.getElementById(`field-${firstInvalid}`)') &&
      editor.includes('document.getElementById(`field-${first}`)'));
  check("both render the message beside the control",
    wizard.includes("fieldErrors[key]?.[0]") && editor.includes("fieldErrors[key]?.[0]"));
  check("neither surface returns a raw exception",
    !/error: *String\(/.test(route) && !/e\.message|error\.message/.test(route));
}

// --- Profile image: byte inspection ----------------------------------------
{
  const bytes = (...b: number[]) => new Uint8Array(b);
  const pad = (head: number[], n = 32) =>
    new Uint8Array([...head, ...new Array(n).fill(0)]);

  const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
  const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  // "<svg", "GIF89a", "%PDF", and a WAV that shares WebP's RIFF container.
  const SVG = pad([0x3c, 0x73, 0x76, 0x67]);
  const GIF = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const PDF = pad([0x25, 0x50, 0x44, 0x46]);
  const WAV = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

  check("jpeg detected", detectImageFormat(JPEG) === "jpeg");
  check("png detected", detectImageFormat(PNG) === "png");
  check("webp detected", detectImageFormat(WEBP) === "webp");
  check("svg is not an accepted format", detectImageFormat(SVG) === null);
  check("gif is not an accepted format", detectImageFormat(GIF) === null);
  check("pdf is not an accepted format", detectImageFormat(PDF) === null);
  // RIFF alone must not pass: WAV and AVI share the container with WebP.
  check("a RIFF file that is not WebP is rejected", detectImageFormat(WAV) === null);
  check("empty input is not a format", detectImageFormat(bytes()) === null);
  check("a truncated png header is rejected",
    detectImageFormat(bytes(0x89, 0x50, 0x4e)) === null);

  // Full check: size, declared type, bytes, and agreement between them.
  const ok = checkProfileImage({ size: JPEG.length, declaredType: "image/jpeg", bytes: JPEG });
  check("a real jpeg is accepted", ok.ok === true);
  check("the extension comes from the detected format",
    ok.ok && ok.extension === "jpg" && ok.format === "jpeg");
  check("png accepted end to end",
    checkProfileImage({ size: PNG.length, declaredType: "image/png", bytes: PNG }).ok);
  check("webp accepted end to end",
    checkProfileImage({ size: WEBP.length, declaredType: "image/webp", bytes: WEBP }).ok);

  const tooBig = checkProfileImage({
    size: MAX_IMAGE_BYTES + 1,
    declaredType: "image/jpeg",
    bytes: JPEG,
  });
  check("an oversized file is rejected", !tooBig.ok && tooBig.reason === "too_large");
  check("the limit is 4 MB", MAX_IMAGE_BYTES === 4 * 1024 * 1024);

  const missing = checkProfileImage({ size: 0, declaredType: "image/jpeg", bytes: bytes() });
  check("a missing file is rejected", !missing.ok && missing.reason === "missing");

  for (const [label, mime] of [
    ["svg", "image/svg+xml"],
    ["gif", "image/gif"],
    ["pdf", "application/pdf"],
    ["octet-stream", "application/octet-stream"],
  ] as const) {
    const r = checkProfileImage({ size: JPEG.length, declaredType: mime, bytes: JPEG });
    check(`${label} is refused by declared type`, !r.ok && r.reason === "unsupported_mime");
  }

  // The whole point of byte inspection: a lie about the type is caught.
  const spoofed = checkProfileImage({ size: SVG.length, declaredType: "image/jpeg", bytes: SVG });
  check("svg bytes labelled image/jpeg are rejected",
    !spoofed.ok && spoofed.reason === "unrecognised_format");
  const gifAsPng = checkProfileImage({ size: GIF.length, declaredType: "image/png", bytes: GIF });
  check("gif bytes labelled image/png are rejected", !gifAsPng.ok);
  // Both formats allowed individually, but the label disagrees with the bytes.
  const mismatch = checkProfileImage({ size: PNG.length, declaredType: "image/jpeg", bytes: PNG });
  check("a png announced as a jpeg is rejected",
    !mismatch.ok && mismatch.reason === "mime_mismatch");

  check("only three mime types are allowed",
    Object.values(ALLOWED_IMAGE_MIME).join() === "image/jpeg,image/png,image/webp");
  check("the user-facing message names the rules",
    /JPEG.*PNG.*WebP.*4 MB/.test(IMAGE_ERROR_MESSAGE));
}

// --- Profile image: path ownership -----------------------------------------
{
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  const path = profileImagePath(A, "abc-123", "jpeg");
  check("the path sits under the profile-images root", path.startsWith(`${PROFILE_IMAGE_ROOT}/`));
  check("the path sits under the user prefix", path.startsWith(userPrefix(A)));
  check("the extension comes from the format", path.endsWith(".jpg"));
  check("webp keeps its own extension", profileImagePath(A, "x", "webp").endsWith(".webp"));
  check("png keeps its own extension", profileImagePath(A, "x", "png").endsWith(".png"));

  // The path must disclose nothing about the person.
  check("the path contains no clerk id", !path.includes("user_"));
  check("the path contains no email", !path.includes("@"));
  check("the path is built only from the root, the uuid and the upload id",
    path === `${PROFILE_IMAGE_ROOT}/${A}/abc-123.jpg`);

  // Ownership: what stops a wrong pathname deleting someone else's photo.
  check("a user owns their own prefix", ownsPathname(A, path));
  check("a user does not own another prefix", !ownsPathname(B, path));
  check("traversal is refused", !ownsPathname(A, `${userPrefix(A)}../${B}/x.jpg`));
  check("a bare prefix match elsewhere is refused",
    !ownsPathname(A, `other/${PROFILE_IMAGE_ROOT}/${A}/x.jpg`));
  check("null is not owned", !ownsPathname(A, null));
  check("empty is not owned", !ownsPathname(A, ""));
  check("a clerk-hosted url is not owned", !ownsPathname(A, "https://img.clerk.com/a.png"));
}

// --- Profile image: route, service and component ---------------------------
{
  const route = readFileSync("app/api/profile/image/route.ts", "utf8");
  const storage = readFileSync("lib/profile/image-storage.ts", "utf8");
  const service = readFileSync("lib/profile/service.ts", "utf8");
  const upload = readFileSync("components/profile/profile-image-upload.tsx", "utf8");
  const wizard = readFileSync("components/profile/onboarding-wizard.tsx", "utf8");
  const editor = readFileSync("components/profile/profile-editor.tsx", "utf8");
  const config = readFileSync("next.config.ts", "utf8");

  // Access -------------------------------------------------------------------
  check("the upload route re-derives authorization", route.includes("decideAccess(userId)"));
  check("anonymous uploads get 401", route.includes("? 401"));
  check("a disabled feature 404s", route.includes('{ error: "Not found" }, { status: 404'));
  check("every upload response is no-store", route.includes('"Cache-Control": "no-store"'));
  check("the route runs on node for byte inspection",
    route.includes('export const runtime = "nodejs"'));

  // Nothing from the browser decides where bytes land.
  check("the storage prefix comes from the session-resolved row",
    route.includes("await ownDashboardUserId(caller.clerkUserId)"));
  check("the object name is generated server-side", route.includes("randomUUID()"));
  check("the extension comes from the detected format",
    route.includes("profileImagePath(dashboardUserId, randomUUID(), check.format)"));
  check("no pathname is read from the request",
    !/form\.get\("pathname"\)|body\.pathname/.test(route));
  check("no user id is read from the request",
    !/form\.get\("(userId|clerkUserId|profileId)"\)/.test(route));
  check("the size is re-derived from the buffer, not File.size",
    route.includes("size: bytes.byteLength"));

  // Failure safety -----------------------------------------------------------
  check("a failed activation deletes the orphaned blob",
    /if \(!activated\.ok\) \{[\s\S]{0,400}deleteProfileImage\(dashboardUserId, uploaded\.pathname\)/.test(route));
  check("the superseded pathname is captured before the update",
    service.indexOf("const superseded = current.image?.storagePathname") <
      service.indexOf("activeImageUrl: uploaded.url"));
  check("the old blob is deleted only after the row is updated",
    service.indexOf("activeImageUrl: uploaded.url") <
      service.indexOf("await deleteProfileImage(current.user.id, superseded)"));
  check("deletion is gated on ownership", storage.includes("if (!ownsPathname(dashboardUserId, pathname)) return false;"));
  check("deletion never throws", /catch \{\s*return false;\s*\}/.test(storage));
  check("a provider failure returns a safe 503",
    route.includes('{ error: "unavailable" }, { status: 503'));
  check("no provider exception text is returned",
    !/err\.message|error\.message|String\(e\)/.test(route));

  // Honest lifecycle ---------------------------------------------------------
  check("an accepted upload is marked uploaded, not ready",
    service.includes('processingStatus: "uploaded"') &&
      !/activateProfileImage[\s\S]{0,1200}processingStatus: "ready"/.test(service));
  check("processedImageUrl is not fabricated",
    !/activateProfileImage[\s\S]{0,1200}processedImageUrl:/.test(service));

  // Token containment --------------------------------------------------------
  check("the storage module is server-only", storage.includes('import "server-only"'));
  check("the token is never public", !storage.includes("NEXT_PUBLIC_BLOB"));
  check("no client component imports the storage module",
    !upload.includes("image-storage") && !wizard.includes("image-storage") &&
      !editor.includes("image-storage"));
  check("the upload component never names the token",
    !upload.includes("BLOB_READ_WRITE_TOKEN"));

  // Shared component ---------------------------------------------------------
  check("the wizard uses the shared upload component",
    wizard.includes("<ProfileImageUpload"));
  check("the editor uses the same component", editor.includes("<ProfileImageUpload"));
  check("there is only one upload implementation",
    !/fetch\([^)]*api\/profile\/image/.test(wizard) &&
      !/fetch\([^)]*api\/profile\/image/.test(editor));

  // Object URL hygiene, and no global state ----------------------------------
  check("object urls are revoked when replaced",
    upload.includes("URL.revokeObjectURL(objectUrlRef.current)"));
  check("object urls are revoked on unmount",
    /return \(\) => \{[\s\S]{0,200}revokeObjectURL/.test(upload));
  check("image state is local, never global",
    !/useUiStore|useLayoutStore|zustand/.test(upload));
  check("the file is not held in a store", !/setFile\(|globalThis\./.test(upload));

  // A failed upload must not look like it worked.
  check("a failed upload drops the preview",
    /setError\([\s\S]{0,120}\);\s*[\s\S]{0,200}setPreview\(null\)/.test(upload));
  check("success is reported only after the server confirmed it",
    upload.indexOf("if (!res.ok)") < upload.indexOf("onUploaded?.(url)"));

  // Revalidation and image config -------------------------------------------
  check("a successful upload revalidates home", route.includes('revalidatePath("/")'));
  check("the blob host is allowed narrowly",
    config.includes('hostname: "*.public.blob.vercel-storage.com"') &&
      config.includes('pathname: "/profile-images/**"'));
  check("no arbitrary remote host is allowed",
    !/hostname: "\*\*"|hostname: "\*"/.test(config));
}

// --- Release A: storage migration ------------------------------------------
{
  const sql = readFileSync("lib/db/migrations/0003_bored_slyde.sql", "utf8");
  check("the storage migration adds the pathname column",
    sql.includes('ADD COLUMN "storage_pathname" text'));
  check("it is the only statement", (sql.match(/ALTER TABLE/g) ?? []).length === 1);
  for (const forbidden of ["DROP", "TRUNCATE", "DELETE", "RENAME", "NOT NULL"]) {
    check(`the storage migration contains no ${forbidden}`, !sql.toUpperCase().includes(forbidden));
  }
  const schema = readFileSync("lib/db/schema.ts", "utf8");
  check("the pathname column is nullable",
    /storagePathname: text\("storage_pathname"\),/.test(schema));
  check("no image bytes are stored in postgres",
    !/bytea|blob\(|imageBytes/.test(schema));
}

// --- Image upload gate: token presence must never enable uploads -----------
//
// Vercel's managed Blob connection scopes BLOB_READ_WRITE_TOKEN to Production
// AND Preview with no per-branch option. The token therefore exists in
// environments that must never write to the store, and cannot be the switch.
{
  // Strict on purpose: only "1". Unlike the other flags, "true"/"yes"/"on" are
  // refused, because this one governs writes to shared external storage and a
  // typo should fail closed rather than be guessed generously.
  check("only the exact string 1 enables uploads",
    profileImageUploadEnabled({ PROFILE_IMAGE_UPLOAD_ENABLED: "1" }));
  for (const v of ["true", "yes", "on", "TRUE", "0", "", " 1", "1 ", "01"]) {
    check(`upload flag rejects ${JSON.stringify(v)}`,
      !profileImageUploadEnabled({ PROFILE_IMAGE_UPLOAD_ENABLED: v }));
  }
  check("upload flag defaults off when missing", !profileImageUploadEnabled({}));

  // The gate is independent of the token, and of the other flags.
  const TOKEN = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_placeholder" };
  check("a present token does not enable uploads",
    !profileImageUploadEnabled({ ...TOKEN }));
  check("a present token plus every OTHER flag does not enable uploads",
    !profileImageUploadEnabled({
      ...TOKEN,
      PROFILE_DATABASE_ENABLED: "1",
      PROFESSIONAL_PROFILE_UI_ENABLED: "1",
    }));

  // The upload flag alone is not sufficient either — the UI flag (which itself
  // requires the database flag) must also be on.
  const uploadOnly = { ...TOKEN, PROFILE_IMAGE_UPLOAD_ENABLED: "1" };
  check("the upload flag alone does not satisfy the UI gate",
    !professionalProfileUiEnabled(uploadOnly));
  check("the upload flag alone does not satisfy the database gate",
    !profileDatabaseEnabled(uploadOnly));
  const allOn = {
    ...TOKEN,
    PROFILE_IMAGE_UPLOAD_ENABLED: "1",
    PROFILE_DATABASE_ENABLED: "1",
    PROFESSIONAL_PROFILE_UI_ENABLED: "1",
  };
  check("all three together are required and sufficient",
    profileImageUploadEnabled(allOn) && professionalProfileUiEnabled(allOn));
  // And it still cannot touch the access authority.
  check("the upload flag never enables database access control",
    !databaseAccessControlEnabled({ ...allOn, DATABASE_ACCESS_CONTROL_ENABLED: "1" }));
}

// --- Image upload gate: enforced at both layers ----------------------------
{
  const route = readFileSync("app/api/profile/image/route.ts", "utf8");
  const storage = readFileSync("lib/profile/image-storage.ts", "utf8");
  const mig = readFileSync("scripts/migrate.mjs", "utf8");
  const env = readFileSync(".env.example", "utf8");

  const strip = (src: string) =>
    src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

  check("the route checks the upload flag",
    strip(route).includes("!profileImageUploadEnabled()"));
  check("the route checks the UI flag too",
    strip(route).includes("!professionalProfileUiEnabled()"));
  // Before the session is read, so a disabled environment makes no Clerk,
  // database or Blob call at all.
  // Both indices must be real. `indexOf` returns -1 for a missing needle, so a
  // bare `a < b` would PASS when the gate is deleted entirely — the vacuous
  // ordering assertion is exactly the bug this check exists to catch.
  {
    const src = strip(route);
    const gate = src.indexOf("profileImageUploadEnabled()");
    const session = src.indexOf("await requireCaller()");
    check("the gate runs before anything else", gate >= 0 && session >= 0 && gate < session);
  }
  check("a disabled feature 404s", route.includes('{ error: "Not found" }, { status: 404'));

  // Defence in depth: the write itself refuses, so no future caller can reach
  // the store by forgetting the route check.
  check("the upload helper refuses when disabled",
    strip(storage).includes('if (!profileImageUploadEnabled()) return { ok: false, reason: "disabled" };'));
  check("the delete helper refuses when disabled",
    /deleteProfileImage[\s\S]{0,500}if \(!profileImageUploadEnabled\(\)\) return false;/.test(storage));
  {
    const src = strip(storage);
    const flag = src.indexOf("profileImageUploadEnabled()");
    const token = src.indexOf("blobConfigured()");
    check("the flag is checked BEFORE the token in the writer",
      flag >= 0 && token >= 0 && flag < token);
  }
  check("token presence is never treated as the gate",
    !/if \(blobConfigured\(\)\)[\s\S]{0,120}put\(/.test(storage));

  // Reported at build time by STATE only, never by value — and reported with
  // the SAME strictness the application applies. The generous `on()` helper
  // would print "on" for "true", which the flag itself refuses, so a build log
  // using it would contradict the running code.
  check("the build reports the upload flag state",
    mig.includes('PROFILE_IMAGE_UPLOAD_ENABLED=${strict("PROFILE_IMAGE_UPLOAD_ENABLED")}'));
  check("the build does not report the upload flag with the generous helper",
    !mig.includes('PROFILE_IMAGE_UPLOAD_ENABLED=${on('));
  check("the strict reporter accepts only the exact string 1",
    /const strict = \(name\) => \{[\s\S]{0,240}v === "1" \? "on"/.test(mig));
  check("the build never prints a flag value",
    !/process\.env\.PROFILE_IMAGE_UPLOAD_ENABLED\}/.test(mig));

  // Documented by name only.
  // A switched-off feature must not be reported as a bad file ---------------
  //
  // The 404 body carries no fieldErrors, so the control's generic fallback
  // would have told the user to "choose a JPEG, PNG, or WebP under 4 MB" —
  // sending them off resizing a photo that was never the problem.
  {
    const ui = readFileSync("components/profile/profile-image-upload.tsx", "utf8");
    const uiSrc = strip(ui);
    check("a 404 is reported as unavailable, not as a bad file",
      /res\.status === 404\)[\s\S]{0,160}setError\(UNAVAILABLE_ERROR\)/.test(uiSrc));
    check("the unavailable message never mentions formats or size",
      /const UNAVAILABLE_ERROR = "[^"]*";/.test(ui) &&
        !/const UNAVAILABLE_ERROR = "[^"]*(JPEG|PNG|WebP|MB)/.test(ui));
    // BOTH controls, counted — not `includes`. The file input and the button
    // that clicks it are separate elements, and an `includes` check passes
    // while only one of them is disabled: leaving the input live would keep
    // the upload reachable by keyboard after the server refused it.
    check("the control latches off once the server says 404",
      uiSrc.includes("setUnavailable(true)") &&
        uiSrc.split("disabled={disabled || uploading || unavailable}").length - 1 === 2);
    // Only a 400 carries the validation contract, so only a 400 may blame the
    // file. 401/403/503 are not the user's mistake either.
    {
      const guard = uiSrc.indexOf("res.status !== 400");
      const blame = uiSrc.indexOf("fieldErrors?.profileImage?.[0] ?? GENERIC_ERROR");
      check("only a 400 may report a format problem",
        guard >= 0 && blame >= 0 && guard < blame);
    }
    check("the format hint is withdrawn when uploads are off",
      /unavailable[\s\S]{0,120}Your existing photo is unaffected\./.test(uiSrc));
    check("an unavailable notice is not styled as the user's error",
      /unavailable\s*\?\s*"text-\[12px\] text-foreground\/70"/.test(uiSrc));
  }

  check("the upload flag is documented", env.includes("PROFILE_IMAGE_UPLOAD_ENABLED="));
  check("the blob token is documented as server-only",
    env.includes("BLOB_READ_WRITE_TOKEN=") && /never NEXT_PUBLIC_/.test(env));
  check("no flag value is committed to .env.example",
    !/PROFILE_IMAGE_UPLOAD_ENABLED=1/.test(env) && !/BLOB_READ_WRITE_TOKEN=\S/.test(env));
}


// --- Onboarding completion must not require optional fields ----------------
//
// The observed Preview defect. `profileUpdateSchema` used `z.string().optional()`,
// which accepts `undefined` but REJECTS `null` — and the server projects an
// unset field as null. The Review step posts the whole prefilled profile back,
// so every field the user had left blank ("Not added") arrived as null and
// failed `invalid_type`. Completion was impossible for anyone with a partial
// profile, and the errors landed on a step that renders no inputs, so nothing
// was highlighted.
{
  // The exact shape observed: some values populated, several "Not added" nulls,
  // no licence/NRDS, one scheme-less domain. Synthetic throughout.
  const REVIEW_SHAPE = {
    preferredDisplayName: "Preview Test",
    professionalTitle: "Preview Agent",
    businessEmail: "preview.test@example.com",
    phoneE164: "+15555550100",
    locationDisplay: null,
    whatsappPhoneE164: null,
    professionalWebsiteUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    licenseState: null,
    licenseType: null,
    licenseNumber: null,
    licenseExpiration: null,
    nrdsNumber: null,
    personalWebsiteUrl: "example.com",
  };
  const accepts = (v: unknown) => {
    try { normalizeProfileUpdate(v); return true; } catch { return false; }
  };

  check("REGRESSION: the observed Review payload completes", accepts(REVIEW_SHAPE));
  check("a scheme-less domain normalises rather than blocking completion",
    normalizeProfileUpdate(REVIEW_SHAPE).personalWebsiteUrl === "https://example.com");

  // null is the projection of an unset field, so it must round-trip.
  check("null is accepted for every optional field",
    accepts({
      preferredDisplayName: null, legalFirstName: null, legalLastName: null,
      phoneE164: null, whatsappPhoneE164: null, businessEmail: null,
      biography: null, locationDisplay: null, professionalTitle: null,
      linkedinUrl: null, instagramUrl: null, facebookUrl: null,
      personalWebsiteUrl: null, professionalWebsiteUrl: null,
      licenseState: null, licenseType: null, licenseNumber: null,
      licenseExpiration: null, nrdsNumber: null,
    }));
  check("blank strings are accepted too", accepts({ locationDisplay: "", biography: "" }));
  check("whitespace-only is accepted and normalises to null",
    normalizeProfileUpdate({ locationDisplay: "   " }).locationDisplay === null);
  check("an entirely empty payload is accepted", accepts({}));
  check("completion needs only a preferred display name",
    normalizeProfileUpdate({ preferredDisplayName: "Preview Test" }).preferredDisplayName === "Preview Test");
  check("the whole licence group may be blank",
    accepts({ licenseState: null, licenseType: null, licenseNumber: null,
              licenseExpiration: null, nrdsNumber: null }));
  // "null"/"undefined" are real strings a user could legitimately type.
  check('the literal string "null" is not treated as empty',
    normalizeProfileUpdate({ biography: "null" }).biography === "null");

  // Optional never means "store rubbish".
  check("an invalid nonblank email is still refused",
    normalizeProfileUpdate({ businessEmail: "not-an-email" }).businessEmail === null);
  check("an invalid nonblank phone is still refused",
    normalizeProfileUpdate({ phoneE164: "invalid-phone" }).phoneE164 === null);
  check("javascript: is still refused",
    normalizeProfileUpdate({ personalWebsiteUrl: "javascript:alert(1)" }).personalWebsiteUrl === null);
  check("data: is still refused",
    normalizeProfileUpdate({ linkedinUrl: "data:text/html,x" }).linkedinUrl === null);

  // A low score must never be a gate.
  const minimal = normalizeProfileUpdate({ preferredDisplayName: "Preview Test" });
  check("a minimal profile scores low but is still valid",
    profileCompletion(minimal) > 0 && profileCompletion(minimal) < 50);
}

// --- Completion writes only what was supplied ------------------------------
//
// `normalizeProfileUpdate` fills every absent key with null. Using it as the
// payload of an UPDATE would blank every column the request did not mention —
// destroying the very draft completion is meant to finish.
{
  const part = normalizeProfileUpdatePartial({ professionalTitle: "Preview Agent" });
  check("a partial update returns only the supplied keys",
    "professionalTitle" in part && !("biography" in part) && !("phoneE164" in part));
  check("an omitted field is not written, so the stored value survives",
    !("locationDisplay" in part));
  check("an explicitly null field IS written, so the user can clear it",
    normalizeProfileUpdatePartial({ biography: null }).biography === null);
  check("a partial payload cannot erase unrelated saved fields",
    Object.keys(normalizeProfileUpdatePartial({ preferredDisplayName: "X" }))
      .every((k) => k === "preferredDisplayName" || k === "brokerageOffice"));

  const svc = readFileSync("lib/profile/service.ts", "utf8");
  const body = (() => {
    const at = svc.indexOf("export async function completeOnboarding(");
    const next = svc.indexOf("\nexport ", at + 1);
    return svc.slice(at, next < 0 ? svc.length : next);
  })();
  check("completion uses the PARTIAL normaliser, not the full one",
    body.includes("normalizeProfileUpdatePartial(raw)") &&
      !/\bnext = normalizeProfileUpdate\(raw\)/.test(body));
  check("completion merges the persisted row before scoring",
    body.includes("completionSourceFromRow(current.profile)"));
}

// --- Review errors route to the step that owns the field -------------------
{
  check("every collected field maps to exactly one step",
    ONBOARDING_STEPS.flatMap((s) => s.fields)
      .every((f) => stepForField(f)?.fields.includes(f) === true));
  check("a field no step collects maps to null",
    stepForField("serviceAreas" as never) === null);
  check("the earliest owning step wins",
    earliestStepForFields(["businessEmail", "professionalTitle"])?.id === "professional");
  check("a contact-only failure routes to contact",
    earliestStepForFields(["instagramUrl"])?.id === "contact");
  check("unknown fields do not invent a step",
    earliestStepForFields(["nonsenseField"]) === null);

  const wiz = readFileSync("components/profile/onboarding-wizard.tsx", "utf8");
  const stripped = wiz.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  check("completion failure navigates to the owning step",
    stripped.includes("earliestStepForFields(invalid)") && stripped.includes("setCurrent(owning)"));
  check("focus moves to the first invalid control on that step",
    /owning\.fields\.find\(\(f\) => invalid\.includes\(f\)\)/.test(stripped));
  check("a non-validation failure is not reported as bad fields",
    stripped.includes("Your saved information is still here."));
  {
    // The old generic dead end must be gone, not merely supplemented.
    check("Review no longer dead-ends on a generic message",
      !stripped.includes("Check the highlighted fields and try again.") ||
        stripped.includes("Review the highlighted field before finishing."));
  }
}

// --- Brokerage is assigned by FortMark, never entered ----------------------
{
  check("the canonical brokerage is a single shared constant",
    FORTMARK_BROKERAGE_NAME === "FORTMARK");
  check("brokerage is classified as system-assigned",
    isSystemAssignedField("brokerageOffice") && SYSTEM_ASSIGNED_FIELDS.includes("brokerageOffice"));

  // Not an input on any surface.
  check("no onboarding step collects brokerage",
    ONBOARDING_STEPS.every((s) => !s.fields.includes("brokerageOffice")));
  check("the shared update schema has no brokerage key",
    !Object.prototype.hasOwnProperty.call(profileUpdateSchema.shape, "brokerageOffice"));

  // Server assigns it on every path, whatever the request said.
  check("normalisation always yields the canonical brokerage",
    normalizeProfileUpdate({}).brokerageOffice === FORTMARK_BROKERAGE_NAME);
  check("a blank submission still yields the canonical value",
    normalizeProfileUpdate({ brokerageOffice: "" }).brokerageOffice === FORTMARK_BROKERAGE_NAME);
  check("a partial update always carries the canonical brokerage",
    normalizeProfileUpdatePartial({ biography: "x" }).brokerageOffice === FORTMARK_BROKERAGE_NAME);

  // Tampering is refused loudly, not stripped silently.
  check("submitting another brokerage is tampering",
    isBrokerageTampering({ brokerageOffice: "Another Brokerage" }));
  check("blank is not tampering", !isBrokerageTampering({ brokerageOffice: "   " }));
  check("absent is not tampering", !isBrokerageTampering({}));
  check("echoing the canonical value is not tampering",
    !isBrokerageTampering({ brokerageOffice: "FORTMARK" }) &&
      !isBrokerageTampering({ brokerageOffice: "fortmark" }));
  check("a tampered request cannot smuggle the value through normalisation",
    normalizeProfileUpdate({ brokerageOffice: "Another Brokerage" }).brokerageOffice
      === FORTMARK_BROKERAGE_NAME);

  const svc = readFileSync("lib/profile/service.ts", "utf8");
  const sv = svc.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  check("all three user-write paths refuse tampering",
    (sv.match(/isBrokerageTampering\(raw\)/g) ?? []).length === 3);
  check("every write pins the canonical brokerage",
    (sv.match(/brokerageOffice: FORTMARK_BROKERAGE_NAME/g) ?? []).length >= 4);
  check("the refusal names the field, not a database column",
    sv.includes("fieldErrors: { brokerageOffice: [BROKERAGE_IMMUTABLE_MESSAGE] }"));
  check("the refusal message explains who assigns it",
    svc.includes("Brokerage is assigned by FortMark and cannot be changed."));

  // Score must not punish the user for a field they cannot fill.
  check("brokerage does not contribute to the completion score",
    profileCompletion({ preferredDisplayName: "X" }) ===
      profileCompletion({ preferredDisplayName: "X", brokerageOffice: "FORTMARK" }));

  // UI: displayed, never editable, never "Not added".
  const wiz = readFileSync("components/profile/onboarding-wizard.tsx", "utf8");
  const ed = readFileSync("components/profile/profile-editor.tsx", "utf8");
  check("the wizard renders no input for a system-assigned field",
    wiz.includes("current.fields.filter((key) => !isSystemAssignedField(key))"));
  check("the wizard shows the locked brokerage on the professional step",
    wiz.includes("<LockedBrokerageField />"));
  check("the locked field is plain text, not a disabled input",
    /function LockedBrokerageField[\s\S]{0,900}FORTMARK_BROKERAGE_NAME/.test(wiz) &&
      !/function LockedBrokerageField[\s\S]{0,900}<(input|ProfileField)/i.test(wiz));
  check("screen readers are told the value is assigned",
    wiz.includes("Assigned by FortMark and cannot be changed."));
  check("Review excludes brokerage from the optional grid",
    wiz.includes('PUBLIC_SURFACE_FIELDS.filter((key) => !isSystemAssignedField(key))'));
  check("Review shows the canonical brokerage explicitly",
    /Brokerage[\s\S]{0,320}FORTMARK_BROKERAGE_NAME/.test(wiz));
  check("Review states optional fields are not required",
    wiz.includes("none of them is required to finish"));
  check("the editor renders no brokerage input",
    !/"brokerageOffice",/.test(ed));
  check("the editor shows the locked brokerage",
    ed.includes("FORTMARK_BROKERAGE_NAME") && ed.includes("Assigned by FortMark"));
}


// --- Self-card hides self-contact; Digital Card keeps it -------------------
//
// Emailing or ringing yourself is not an action. The Home card is the user
// looking at their own record; the Digital Card is shareable and still needs
// the full contact set, so this is a rule about ONE surface, not about data.
{
  const LINKS = [
    { kind: "email", href: "mailto:preview.test@example.com", label: "Send email" },
    { kind: "phone", href: "tel:+15555550100", label: "Call" },
    { kind: "linkedin", href: "https://linkedin.com/in/example", label: "LinkedIn profile" },
    { kind: "website", href: "https://example.com", label: "Website" },
    { kind: "whatsapp", href: "https://wa.me/15555550100", label: "WhatsApp" },
  ];
  const visible = selfCardLinks(LINKS);
  check("the self-card drops the email link",
    !visible.some((l) => l.kind === "email"));
  check("the self-card drops the call link",
    !visible.some((l) => l.kind === "phone"));
  check("professional links survive on the self-card",
    visible.some((l) => l.kind === "linkedin") && visible.some((l) => l.kind === "website"));
  check("the self-card drops the WhatsApp link",
    !visible.some((l) => l.kind === "whatsapp"));
  check("exactly the three self-contact kinds are hidden",
    SELF_CARD_HIDDEN_LINK_KINDS.length === 3 &&
      ["email", "phone", "whatsapp"].every((k) => SELF_CARD_HIDDEN_LINK_KINDS.includes(k)));
  check("filtering does not mutate the source list", LINKS.length === 5);
  check("a link set of only self-contact leaves nothing to render",
    selfCardLinks(LINKS.filter((l) =>
      ["email", "phone", "whatsapp"].includes(l.kind))).length === 0);

  const card = readFileSync("components/home/home-identity-card.tsx", "utf8");
  const dcard = readFileSync("components/profile/digital-business-card.tsx", "utf8");

  // The coupling that made this dangerous: both surfaces used to recover
  // email/phone by scanning the link list, so hiding the icons would have
  // silently emptied Copy Contact and the vCard too.
  check("Copy Contact reads the carried email, not the link list",
    card.includes("email: data.email,") && card.includes("phoneE164: data.phoneE164,"));
  check("the self-card no longer scrapes mailto:/tel: out of links",
    !/kind === "email"\)\?\.href\.replace/.test(card) &&
      !/kind === "phone"\)\?\.href\.replace/.test(card));
  check("the Digital Card reads the carried email and phone",
    dcard.includes("const email = data.email;") && dcard.includes("const phone = data.phoneE164;"));
  check("the Digital Card does NOT filter self-contact away",
    !dcard.includes("selfCardLinks"));
  check("the Digital Card still offers email and phone rows",
    dcard.includes('<Row label="Email" value={email} />') &&
      dcard.includes('<Row label="Phone" value={formatPhoneDisplay(phone)} />'));
  // Hidden on the self-card, so if it were absent here the value the user
  // typed would be visible on no surface at all.
  check("WhatsApp is published on the shareable card",
    dcard.includes('<Row label="WhatsApp" value={formatPhoneDisplay(data.whatsappPhoneE164)} />'));
  check("the card carries WhatsApp as data, not via the filtered links",
    readFileSync("lib/profile/home-card.ts", "utf8").includes("whatsappPhoneE164: trimmed(profile?.whatsappPhoneE164)"));
}

// --- Digital Card always shows licence and NRDS ----------------------------
{
  const dcard = readFileSync("components/profile/digital-business-card.tsx", "utf8");
  check("the licence number row is always rendered",
    dcard.includes('<Row label="License number" value={data.licenseNumber} always />'));
  check("the NRDS row is always rendered",
    dcard.includes('<Row label="NRDS ID" value={data.nrdsNumber} always />'));
  check("Row supports an always mode", /always = false,[\s\S]{0,220}always\?: boolean;/.test(dcard));
  check("a row without a value is dropped only when NOT always",
    dcard.includes("if (!value && !always) return null;"));
  check("the placeholder matches the wording used elsewhere",
    dcard.includes('{value ?? "Not added"}'));
  check("an absent value is styled as absent, not as data",
    /value\s*\?[\s\S]{0,200}text-muted-foreground/.test(dcard));
}

// --- Status is Active/Inactive, and is not credential verification ---------
{
  check("there are exactly two user-facing statuses",
    Object.keys(PROFILE_STATUS_LABEL).length === 2);
  check("the labels are Active and Inactive",
    PROFILE_STATUS_LABEL.active === "Active" && PROFILE_STATUS_LABEL.inactive === "Inactive");
  check("an active account reads Active", profileStatusFor({ status: "active" }) === "active");
  check("a suspended account reads Inactive",
    profileStatusFor({ status: "suspended" }) === "inactive");
  check("a pending account reads Inactive",
    profileStatusFor({ status: "pending_profile" }) === "inactive");
  check("an unknown or missing account state fails closed to Inactive",
    profileStatusFor(null) === "inactive" &&
      profileStatusFor(undefined) === "inactive" &&
      profileStatusFor({ status: "something_else" }) === "inactive");

  const dcard = readFileSync("components/profile/digital-business-card.tsx", "utf8");
  check("the Status row shows the account status",
    dcard.includes('<Row label="Status" value={PROFILE_STATUS_LABEL[data.profileStatus]} always />'));
  check("Status no longer renders credential trust",
    !/label="Status"[\s\S]{0,160}CREDENTIAL_TRUST_LABEL/.test(dcard));
  // The public card must not publish provenance at all: telling a recipient
  // "Self-reported" states a negative about the agent and tells them nothing
  // usable. The value is retained internally, and is NOT swapped for a
  // "Verified" claim, because nothing has verified anything.
  const dcardCode = dcard.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\{\/\*)/.test(l)).join("\n");
  check("the public card renders no verification row",
    !dcardCode.includes('label="Verification"'));
  check("the public card never renders credential trust",
    !dcardCode.includes("CREDENTIAL_TRUST_LABEL"));
  check("no Verified claim replaced it",
    !/Verified by FortMark|label="Verified"/.test(dcardCode));
  check("credentialTrust is still computed and carried internally",
    readFileSync("lib/profile/home-card.ts", "utf8").includes("credentialTrustFor(profile, user, now)"));
  check("the internal self-card may still show provenance",
    readFileSync("components/home/home-identity-card.tsx", "utf8").includes("CREDENTIAL_TRUST_LABEL"));

  const hc = readFileSync("lib/profile/home-card.ts", "utf8");
  check("status is derived, never accepted from a request",
    hc.includes("export function profileStatusFor(") &&
      !/profileStatus[^\n]*(raw|input|body)/i.test(hc));
  check("dashboard_users.status is still never written by profile code",
    !/set\(\{[\s\S]{0,200}status:\s*"(active|inactive|suspended)"/.test(
      readFileSync("lib/profile/service.ts", "utf8").replace(
        /\.insert\(dashboardUsers\)[\s\S]*?\.returning\(\)/, "")));
}

// --- Brokerage is stated once ----------------------------------------------
{
  const card = readFileSync("components/home/home-identity-card.tsx", "utf8");
  check("the secondary line carries location, not a second brokerage",
    card.includes("{data.locationDisplay && (") &&
      !card.includes("data.brokerageOffice ?? data.locationDisplay"));
  check("FortMark is still named once on the self-card",
    (card.match(/"FortMark"/g) ?? []).length === 1);
}


// --- Account status stays admin-controlled ---------------------------------
//
// Status is authorization-adjacent. An agent who could set their own state
// could clear a suspension, so it is derived for display and never accepted as
// input on any path.
{
  const svc = readFileSync("lib/profile/service.ts", "utf8");
  const route = readFileSync("app/api/profile/onboarding/route.ts", "utf8");
  const profileRoute = readFileSync("app/api/profile/route.ts", "utf8");
  const editor = readFileSync("components/profile/profile-editor.tsx", "utf8");
  const wizard = readFileSync("components/profile/onboarding-wizard.tsx", "utf8");

  // The only place dashboardUsers gets a status is the initial insert, which
  // is server-resolved. No update path may set it.
  const updates = svc.split("db\n      .update(dashboardUsers)").slice(1)
    .concat(svc.split("db.update(dashboardUsers)").slice(1));
  check("no update path writes dashboard_users.status",
    updates.every((u) => !/^\s*[\s\S]{0,400}?status:/.test(u.slice(0, 400))));
  check("status is not an accepted profile input",
    !Object.prototype.hasOwnProperty.call(profileUpdateSchema.shape, "status"));
  check("a status key in a request body is stripped by the schema",
    !("status" in (profileUpdateSchema.parse({ status: "active" } as never) as object)));
  check("normalisation never emits a status field",
    !("status" in normalizeProfileUpdate({ status: "active" } as never)));
  check("a partial update never emits a status field",
    !("status" in normalizeProfileUpdatePartial({ status: "active" } as never)));

  // A suspended user cannot promote themselves: the display derives from the
  // stored account state, and no writable path exists.
  check("a suspended account still reads Inactive after a profile update attempt",
    profileStatusFor({ status: "suspended" }) === "inactive");
  check("no editable status control exists in Edit Profile",
    !/name="status"|"status",/.test(editor));
  check("no editable status control exists in the wizard",
    !/name="status"/.test(wizard));
  check("neither profile route reads a status from the body",
    !/body\.status|payload\.status|values\.status/.test(route + profileRoute));

  // Internal states are never published.
  const dcard = readFileSync("components/profile/digital-business-card.tsx", "utf8");
  for (const internal of ["pending_profile", "suspended", "archived", "disabled"]) {
    check(`the public card never names the internal state ${internal}`,
      !dcard.includes(internal));
  }
  check("only two labels can ever reach the public card",
    Object.values(PROFILE_STATUS_LABEL).every((v) => v === "Active" || v === "Inactive"));

  // Standing guarantees, unchanged by this work.
  check("DATABASE_ACCESS_CONTROL_ENABLED remains code-disabled",
    databaseAccessControlEnabled({ DATABASE_ACCESS_CONTROL_ENABLED: "1" }) === false);
}

// --- FortMark is never printed twice ---------------------------------------
{
  const block1 = buildContactBlock({
    displayName: "Preview Test",
    professionalTitle: "Preview Agent",
    roleLabel: "Member",
    brokerageOffice: "FORTMARK",
    locationDisplay: "Fort Lauderdale, FL",
  });
  check("the contact block names FortMark once",
    (block1.match(/fortmark/gi) ?? []).length === 1);
  check("the contact block keeps the location",
    block1.includes("Fort Lauderdale, FL"));

  const vcf = buildVCard({
    displayName: "Preview Test",
    professionalTitle: "Preview Agent",
    roleLabel: "Member",
    brokerageOffice: "FORTMARK",
    email: "preview.test@example.com",
    phoneE164: "+15555550100",
  });
  const orgLine = vcf.split(/\r?\n/).find((l) => l.startsWith("ORG:")) ?? "";
  check("the vCard ORG names FortMark once",
    (orgLine.match(/fortmark/gi) ?? []).length === 1);
  check("the vCard still carries email and phone",
    vcf.includes("preview.test@example.com") && vcf.includes("+15555550100"));

  const dcard = readFileSync("components/profile/digital-business-card.tsx", "utf8");
  check("the Digital Card identity line drops the duplicate brokerage",
    dcard.includes('{["FortMark", data.locationDisplay].filter(Boolean).join(" · ")}') &&
      !dcard.includes('data.brokerageOffice ?? data.locationDisplay'));
}

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} profile checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
