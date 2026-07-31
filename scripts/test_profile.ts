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
  toProfileUrl,
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
  check("journal has the Release 1.1 additive migration", journal.entries.length === 2);

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

  // 1. The eyebrow renders, and is uppercased by CSS rather than by literal.
  const eyebrow = card.slice(card.indexOf("GREETING ---"), card.indexOf("</h2>"));
  check("eyebrow label renders My FortMark", eyebrow.includes(">\n          My FortMark\n"));
  check("eyebrow is uppercased by class, not by literal", eyebrow.includes("uppercase"));
  check(
    "eyebrow is quieter than the greeting",
    eyebrow.includes("text-[10px]") && eyebrow.includes("text-foreground/55")
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
  check("social row is gated on having links", card.includes("data.links.length > 0 &&"));
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
    "tertiary actions keep a 40px touch target",
    actions.includes("h-10 min-w-0 px-3 text-[13px] text-foreground/70")
  );
  // The button base sets `whitespace-nowrap`, so a label wider than its grid
  // track would spill outside the card and scroll the page. Every action label
  // must be able to clip.
  check(
    "every action button can shrink below its label",
    (actions.match(/className="h-10 min-w-0 px-3/g) ?? []).length === 4
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

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} profile checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
