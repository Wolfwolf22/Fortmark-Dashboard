/**
 * Brokerage identity regression tests (pure; no database).
 *
 * What matters: only brokerage fields are accepted, the tenant never comes
 * from the request, only admin and broker may edit, values are shape-checked
 * without any claim of verification, and the browser never receives ids.
 * The live authorisation matrix runs against Preview in e2e/brokerage.spec.ts.
 * Run: npm run test:brokerage
 */
import { readFileSync } from "node:fs";
import {
  BROKERAGE_EDITOR_ROLES,
  BROKERAGE_FIELDS,
  canEditBrokerage,
  changedFields,
  parseBrokerageInput,
  toBrokerageView,
  toWebsite,
  type BrokerageValues,
} from "../lib/brokerage/identity.ts";

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean) => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
};

const ok = (raw: unknown) => {
  const r = parseBrokerageInput(raw);
  return r.ok ? r.value : null;
};
const errs = (raw: unknown) => {
  const r = parseBrokerageInput(raw);
  return r.ok ? {} : r.fieldErrors;
};

// --- Who may edit -------------------------------------------------------------
check("admin may edit", canEditBrokerage("admin"));
check("broker may edit", canEditBrokerage("broker"));
check("transaction coordinator may not edit", !canEditBrokerage("transaction_coordinator"));
check("agent may not edit", !canEditBrokerage("agent"));
check("member may not edit", !canEditBrokerage("member"));
check("editor roles are exactly admin and broker", BROKERAGE_EDITOR_ROLES.join(",") === "admin,broker");

// --- Minimal valid record (the Preview seed shape) ---------------------------------
const seed = ok({ displayName: "FortMark, LLC", licenseState: "fl" });
check("seed shape is valid", seed !== null);
check("licence state is upper-cased", seed?.licenseState === "FL");
check("the MLS office id is not an operator field", seed !== null && !("mlsOfficeId" in seed));
check("unset fields are null, not invented", seed !== null &&
  [seed.licenseNumber, seed.addressLine1, seed.addressLine2, seed.city, seed.state, seed.postalCode, seed.officePhone, seed.website]
    .every((v) => v === null));
check("empty strings become null", ok({ displayName: "FortMark, LLC", website: "  ", licenseNumber: "" })?.website === null);

// --- Name ------------------------------------------------------------------------
check("name is required", "displayName" in errs({ displayName: "" }));
check("one-character name is refused", "displayName" in errs({ displayName: "F" }));
check("over-long name is refused", "displayName" in errs({ displayName: "x".repeat(121) }));
check("name is trimmed", ok({ displayName: "  FortMark, LLC  " })?.displayName === "FortMark, LLC");
check("missing body is a form error, not a crash", "_form" in errs(undefined) || "displayName" in errs(undefined));

// --- Licence -----------------------------------------------------------------------
check("brokerage licence accepted and upper-cased", ok({ displayName: "FortMark", licenseNumber: "cq1234567" })?.licenseNumber === "CQ1234567");
check("licence with a symbol is refused", "licenseNumber" in errs({ displayName: "FortMark", licenseNumber: "CQ<script>" }));
check("one-character licence is refused", "licenseNumber" in errs({ displayName: "FortMark", licenseNumber: "C" }));
check("licence over 30 is refused", "licenseNumber" in errs({ displayName: "FortMark", licenseNumber: "C".repeat(31) }));
check("licence state must be a US state", "licenseState" in errs({ displayName: "FortMark", licenseState: "ZZ" }));
check("no verification wording in the licence rules",
  !/verified|in good standing|expired|\bactive licen/i.test(readFileSync("lib/brokerage/identity.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));

// --- Address -----------------------------------------------------------------------
const addr = ok({ displayName: "FortMark", addressLine1: "1 Main St", city: "Fort Lauderdale", state: "fl", postalCode: "33301-1234" });
check("structured address accepted", addr?.state === "FL" && addr?.postalCode === "33301-1234");
check("bad ZIP refused", "postalCode" in errs({ displayName: "FortMark", postalCode: "3330" }));
check("letters in ZIP refused", "postalCode" in errs({ displayName: "FortMark", postalCode: "ABCDE" }));
check("address state must be a US state", "state" in errs({ displayName: "FortMark", state: "XX" }));
check("over-long address line refused", "addressLine1" in errs({ displayName: "FortMark", addressLine1: "a".repeat(121) }));

// --- Phone -------------------------------------------------------------------------
check("office phone normalised to E.164", ok({ displayName: "FortMark", officePhone: "(954) 555-0100" })?.officePhone === "+19545550100");
check("short phone refused", "officePhone" in errs({ displayName: "FortMark", officePhone: "555-0100" }));
check("text phone refused", "officePhone" in errs({ displayName: "FortMark", officePhone: "call me" }));

// --- Website -----------------------------------------------------------------------
check("https website kept", toWebsite("https://fortmark.example/").ok);
check("bare domain gains https", ok({ displayName: "FortMark", website: "fortmark.example" })?.website === "https://fortmark.example/");
check("http website allowed", ok({ displayName: "FortMark", website: "http://fortmark.example" })?.website === "http://fortmark.example/");
for (const bad of [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  " javascript:alert(document.cookie)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "ftp://fortmark.example",
  "file:///etc/passwd",
  "https://user:pass@fortmark.example",
  "https://localhost",
  "not a url",
]) {
  check(`website refused: ${bad.slice(0, 24)}`, "website" in errs({ displayName: "FortMark", website: bad }));
}

// --- MLS office id -------------------------------------------------------------------
// System-managed now: an operator cannot type, change or clear it.
for (const key of ["mlsOfficeId", "mlsOfficeName", "mlsOfficePhone", "mlsOfficeKey", "mlsSyncedAt"]) {
  check(`system-managed field refused from a save: ${key}`,
    errs({ displayName: "FortMark", [key]: "FTMK01" })._form === "Only brokerage details can be saved here.");
}

// --- Only brokerage fields; the tenant never comes from the body --------------------------
for (const key of ["brokerageKey", "brokerage_key", "id", "role", "userId", "createdByUserId", "updatedByUserId", "updatedAt", "createdAt"]) {
  const e = errs({ displayName: "FortMark", [key]: "other" });
  check(`unknown key refused: ${key}`, e._form === "Only brokerage details can be saved here.");
}
check("a wrong type is a form error", "_form" in errs({ displayName: 42 }));
check("an array body is refused", "_form" in errs([{ displayName: "FortMark" }]));

// --- Audit diff ------------------------------------------------------------------------
const before: BrokerageValues = seed!;
const after: BrokerageValues = { ...before, officePhone: "+19545550100", website: "https://fortmark.example/" };
check("changed fields names only the changed ones", changedFields(before, after).join(",") === "officePhone,website");
check("no change is an empty list", changedFields(before, before).length === 0);
check("first save lists every set field", changedFields(null, before).join(",") === "displayName,licenseState");

// --- What the browser receives --------------------------------------------------------------
const view = toBrokerageView({
  ...before,
  id: "00000000-0000-0000-0000-000000000001",
  brokerageKey: "fortmark",
  createdByUserId: "u1",
  updatedByUserId: "u2",
  updatedAt: new Date("2026-09-23T00:00:00Z"),
} as BrokerageValues & { updatedAt: Date });
const viewKeys = Object.keys(view).sort().join(",");
check("view carries the operator fields, the synced MLS section and updatedAt",
  viewKeys === [...BROKERAGE_FIELDS, "mlsOfficeId", "mlsOfficeName", "mlsOfficePhone", "mlsSyncedAt", "updatedAt"].sort().join(","));
check("view never carries the MLS office key", !("mlsOfficeKey" in view));
check("view never carries the tenant key, row id or user ids",
  !("brokerageKey" in view) && !("id" in view) && !("createdByUserId" in view) && !("updatedByUserId" in view));

// --- Static: the server binds the tenant and authorises first ---------------------------------
const service = readFileSync("lib/brokerage/service.ts", "utf8");
check("service scopes every query by the actor's brokerage key",
  (service.match(/eq\(brokerageIdentities\.brokerageKey, actor\.brokerageKey\)/g) ?? []).length >= 2);
check("service inserts with the actor's brokerage key", /brokerageKey: actor\.brokerageKey,/.test(service));
check("service never reads a brokerage key from input", !/raw\.brokerageKey|input\.brokerageKey|body\.brokerageKey/.test(service));
check("authorisation runs before validation",
  service.indexOf("canEditBrokerage(actor.role)") > 0 &&
    service.indexOf("canEditBrokerage(actor.role)") < service.indexOf("parseBrokerageInput(raw)"));
check("service resolves the actor from the session id", /resolveActor\(clerkUserId/.test(service));
check("saves are audited with field names", /writeAuditEvent\(/.test(service) && /changedFields: changed/.test(service));
check("upsert is keyed on the unique brokerage key", /onConflictDoUpdate\(\{\s*target: brokerageIdentities\.brokerageKey/.test(service));

const route = readFileSync("app/api/brokerage/route.ts", "utf8");
check("route authenticates every method", (route.match(/await requireCaller\(\)/g) ?? []).length === 2);
check("route passes only the session id and body to the service",
  /saveBrokerage\(caller\.clerkUserId, raw\)/.test(route) && /readBrokerage\(caller\.clerkUserId\)/.test(route));
check("route responses are private, no-store", route.includes('"private, no-store"'));
check("route never reads role or brokerage from the request",
  !/searchParams|headers\(\)\.get|request\.headers/.test(route));

const schema = readFileSync("lib/db/schema.ts", "utf8");
check("one identity per brokerage key (unique index)", /uniqueIndex\("brokerage_identities_brokerage_key_key"\)\.on\(t\.brokerageKey\)/.test(schema));
const migration = readFileSync("lib/db/migrations/0009_steep_warstar.sql", "utf8");
check("migration 0009 is additive only",
  !/\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b|\bUPDATE "/i.test(migration) &&
    (migration.match(/ALTER TABLE "([a-z_]+)"/g) ?? []).every((m) => m === 'ALTER TABLE "brokerage_identities"'));
check("migration 0009 creates the unique index", /CREATE UNIQUE INDEX "brokerage_identities_brokerage_key_key"/.test(migration));

// --- Static: no hard-coded office; general search independent ----------------------------------
const listingsRoute = readFileSync("app/api/listings/route.ts", "utf8");
check("listings route resolves office and identity from the session", /callerListingContext\(caller\.clerkUserId\)/.test(listingsRoute));
const svc = readFileSync("lib/brokerage/service.ts", "utf8");
check("FortMark's office id is system configuration", /FORTMARK_MLS_OFFICE_ID/.test(svc) && /export function fortmarkOfficeConfig/.test(svc));
check("the operator save never writes MLS columns",
  !/mlsOffice(Id|Key|Name|Phone)\s*:/.test(svc.slice(svc.indexOf("export async function saveBrokerage"), svc.indexOf("// --- System sync"))));
check("the office sync never writes operator-owned fields",
  !/licenseNumber|addressLine1|website|officePhone:/.test(svc.slice(svc.indexOf("const mls = {"), svc.indexOf("try {", svc.indexOf("const mls = {")))));
check("the office sync creates a record only with the MLS's own office name", /if \(!before && !office\.name\) return/.test(svc));
check("FortMark scope with no office id is refused, not widened", listingsRoute.includes("fortmark_office_not_configured"));
for (const f of ["lib/mls/service.ts", "lib/mls/normalize.ts", "lib/mls/config.ts", "app/api/listings/route.ts", "app/api/listings/featured/route.ts", "app/api/listings/[id]/route.ts"]) {
  check(`no hard-coded FortMark office id in ${f}`, !readFileSync(f, "utf8").includes("FTMK01"));
}
const section = readFileSync("components/settings/brokerage-section.tsx", "utf8");
check("Settings: privileged empty state", section.includes("Brokerage profile has not been configured."));
check("Settings: read-only empty state", section.includes("Brokerage information is not available."));
check("Settings: licence labelled operator-provided", section.includes("Brokerage licence (operator-provided)"));
check("Settings: MLS phone is labelled as from the MLS", section.includes('"From the MLS"'));
check("Settings: no verification claims in visible copy",
  !/"[^"]*\b(Verified|In good standing|Expired|Active licen)[^"]*"/.test(section));
check("Settings: website link opens safely", section.includes('rel="noopener noreferrer"'));
check("Settings: edit controls only for editors", /canEdit && identity && mode === "view"/.test(section));

console.log(`${passed}/${passed + failed} brokerage checks passed`);
if (failed > 0) process.exit(1);
