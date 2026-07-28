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

// --- Summary ---------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} profile checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
