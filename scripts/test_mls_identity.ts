/**
 * Agent MLS identity + role display regression tests (no database).
 *
 * Licence → MLS Member → FortMark office → My Listings, against a local
 * Bridge stub whose Member / Office / Property rows use the exact field names
 * verified live in `miamire` (2026-09-23). Identifiers here are synthetic.
 * Run: npm run test:mls-identity
 */
import { readFileSync } from "node:fs";
import { ROLE_DISPLAY, displayRoleLabel, roleDisplayLabel } from "../lib/profile/roles.ts";
import {
  MLS_STATE_DETAIL,
  MLS_STATE_LABEL,
  classifyMembers,
  licenseCandidates,
  linkMatchesLicense,
  normalizeLicense,
} from "../lib/mls-identity/rules.ts";
import { MEMBER_FIELDS, OFFICE_RECORD_FIELDS, findMembersByLicense, getOfficeRecord } from "../lib/mls/member.ts";
import {
  MemberNotLinkedError,
  OfficeNotConfiguredError,
  buildSearchFilter,
  getFortmarkListingSummary,
  getListing,
  getMyListingSummary,
  searchListings,
} from "../lib/mls/service.ts";
import { WITHHELD_ADDRESS } from "../lib/mls/normalize.ts";
import { mlsStateFor, rosterFor, type RosterSourceRow } from "../lib/team/roster.ts";
import { stepById } from "../lib/profile/onboarding.ts";
import { parseBrokerageInput } from "../lib/brokerage/identity.ts";
import { fortmarkOfficeConfig, officeSyncDue } from "../lib/brokerage/service.ts";
import { stateFor, toIdentityView } from "../lib/mls-identity/service.ts";
import type { ListingSearchQuery } from "../lib/data/types.ts";
import { startStub, type Row } from "./mls-stub.ts";

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean) => {
  if (cond) passed++;
  else {
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
};

// =============================================================================
// 1. Role display — dashboard_users.role is authoritative
// =============================================================================
check("admin displays Admin", roleDisplayLabel("admin") === "Admin");
check("broker displays Broker", roleDisplayLabel("broker") === "Broker");
check("agent displays Agent", roleDisplayLabel("agent") === "Agent");
check("member displays Member", roleDisplayLabel("member") === "Member");
check("transaction coordinator displays its label", roleDisplayLabel("transaction_coordinator") === "Transaction coordinator");
check("an unknown role never escalates", roleDisplayLabel("superuser") === "Member");
// The defect: DB said admin, Clerk metadata defaulted to Member.
check("an admin record wins over a Clerk 'Member' default", displayRoleLabel("admin", "Member") === "Admin");
check("a member record wins over a Clerk 'Admin' claim", displayRoleLabel("member", "Admin") === "Member");
check("no record: the Clerk label is only a bootstrap hint", displayRoleLabel(null, "Agent") === "Agent");
check("one label table serves every surface", Object.keys(ROLE_DISPLAY).length === 5);
{
  const session = readFileSync("lib/auth/session.ts", "utf8");
  check("session resolves the role from the application record", /resolveActor\(clerkUserId/.test(session) && /displayRole\(\s*await applicationRole\(userId\)/.test(session));
  const roster = readFileSync("lib/team/roster.ts", "utf8");
  check("Team uses the same label table", /ROLE_LABEL: Record<DbRole, string> = ROLE_DISPLAY/.test(roster));
  const menu = readFileSync("components/layout/user-menu.tsx", "utf8");
  const profile = readFileSync("components/settings/profile-section.tsx", "utf8");
  check("user menu and Profile render the session role", menu.includes("{user.role}") && profile.includes("{user.role}"));
}

// =============================================================================
// 2. Licence normalisation and candidates
// =============================================================================
check("licence normalises case and punctuation", normalizeLicense(" sl-3.123 456 ") === "SL3123456");
check("too-short licence is nothing", normalizeLicense("S") === null);
check("SL-prefixed licence also looks for the bare number",
  licenseCandidates("SL3123456").sort().join(",") === "3123456,SL3123456");
check("BK-prefixed licence also looks for the bare number",
  licenseCandidates("bk3123456").sort().join(",") === "3123456,BK3123456");
check("bare number also looks for SL and BK spellings",
  licenseCandidates("3123456").sort().join(",") === "3123456,BK3123456,SL3123456");
check("a different digit is never a candidate", !licenseCandidates("SL3123456").includes("3123457"));
check("no licence, no candidates", licenseCandidates(null).length === 0);

// =============================================================================
// 3. Classification — never guess
// =============================================================================
const FTMK = "FTMK01";
const m = (key: string, office: string | null, status: string | null = "Active", id = key.toUpperCase()) => ({
  memberKey: key,
  memberMlsId: id,
  officeMlsId: office,
  status,
});
{
  const r = classifyMembers([m("k1", FTMK)], FTMK);
  check("one active member in FortMark's office links", r.status === "linked" && "memberKey" in r && r.memberKey === "k1");
  const x = classifyMembers([m("k1", "OTHR01")], FTMK);
  check("one active member in another office is a mismatch, not a link", x.status === "office_mismatch");
  check("zero members is not_found", classifyMembers([], FTMK).status === "not_found");
  check("only inactive members is not_found", classifyMembers([m("k1", FTMK, "Inactive")], FTMK).status === "not_found");
  check("a missing status is not active", classifyMembers([m("k1", FTMK, null)], FTMK).status === "not_found");
  const amb = classifyMembers([m("k1", FTMK), m("k2", FTMK)], FTMK);
  check("two active members is ambiguous, never the first", amb.status === "ambiguous" && amb.candidateCount === 2);
  check("the same member twice is still one member", classifyMembers([m("k1", FTMK), m("k1", FTMK)], FTMK).status === "linked");
  check("no configured office never links silently", classifyMembers([m("k1", FTMK)], null).status === "office_mismatch");
}

// =============================================================================
// 4. Licence change invalidates a link
// =============================================================================
{
  const link = { licenseNumber: "SL3123456", licenseState: "FL" };
  check("same licence, different spelling of case/spacing, still matches",
    linkMatchesLicense(link, { licenseNumber: "sl 3123456", licenseState: "fl" }));
  check("changed licence number makes the link stale",
    !linkMatchesLicense(link, { licenseNumber: "SL3123457", licenseState: "FL" }));
  check("changed licence state makes the link stale",
    !linkMatchesLicense(link, { licenseNumber: "SL3123456", licenseState: "GA" }));
  const row = {
    userId: "u1", status: "linked", licenseNumber: "SL3123456", licenseState: "FL",
    memberKey: "k1", memberMlsId: "M1", officeMlsId: FTMK, candidateCount: 1,
    checkedAt: new Date("2026-09-23T00:00:00Z"), linkedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  } as Parameters<typeof stateFor>[0];
  check("a matching linked row reads linked", stateFor(row, { licenseNumber: "SL3123456", licenseState: "FL" }) === "linked");
  check("a changed licence reads stale — the old member is not used",
    stateFor(row, { licenseNumber: "SL9999999", licenseState: "FL" }) === "stale");
  check("no licence reads no_license", stateFor(row, { licenseNumber: null, licenseState: null }) === "no_license");
  check("never resolved reads stale", stateFor(null, { licenseNumber: "SL3123456", licenseState: "FL" }) === "stale");
  const v = toIdentityView(row, { licenseNumber: "SL3123456", licenseState: "FL" }, "FortMark, LLC", false);
  check("identity view carries no member key", !JSON.stringify(v).includes("k1"));
  check("identity view hides the MLS member id from non-privileged callers", !("memberMlsId" in v));
  check("identity view names FortMark when linked", v.linked && v.officeName === "FortMark, LLC");
  const pv = toIdentityView(row, { licenseNumber: "SL3123456", licenseState: "FL" }, "FortMark, LLC", true);
  check("broker/admin view may carry the MLS member id", pv.memberMlsId === "M1");
}

// =============================================================================
// 5. Copy never judges the licence
// =============================================================================
check("not_found copy says MLS, not invalid", !/invalid/i.test(MLS_STATE_DETAIL.not_found) && /match/i.test(MLS_STATE_DETAIL.not_found));
check("no state label claims licence validity", Object.values(MLS_STATE_LABEL).every((l) => !/invalid|verified licen/i.test(l)));
check("unavailable copy keeps the profile", /profile is saved/i.test(MLS_STATE_DETAIL.unavailable));

// =============================================================================
// 6. Member / Office lookups against the stub (live field names)
// =============================================================================
const MEMBERS: Row[] = [
  { MemberKey: "mk-agent", MemberMlsId: "M100", OfficeMlsId: FTMK, MemberStatus: "Active", MemberStateLicense: "3123456", MemberEmail: "private@example.test", MemberMobilePhone: "5550001111" },
  { MemberKey: "mk-other", MemberMlsId: "M200", OfficeMlsId: "OTHR01", MemberStatus: "Active", MemberStateLicense: "3222222", MemberEmail: "x@example.test", MemberMobilePhone: "5550002222" },
  { MemberKey: "mk-dup1", MemberMlsId: "M300", OfficeMlsId: FTMK, MemberStatus: "Active", MemberStateLicense: "3333333", MemberEmail: null, MemberMobilePhone: null },
  { MemberKey: "mk-dup2", MemberMlsId: "M301", OfficeMlsId: FTMK, MemberStatus: "Active", MemberStateLicense: "SL3333333", MemberEmail: null, MemberMobilePhone: null },
  { MemberKey: "mk-gone", MemberMlsId: "M400", OfficeMlsId: FTMK, MemberStatus: "Inactive", MemberStateLicense: "3444444", MemberEmail: null, MemberMobilePhone: null },
];
const OFFICES: Row[] = [
  { OfficeKey: "ok-ftmk", OfficeMlsId: FTMK, OfficeName: "FortMark, LLC", OfficePhone: "954-555-0100", OfficeStatus: "Active", OfficeEmail: "office@example.test" },
];
const base = (over: Partial<ListingSearchQuery> = {}): ListingSearchQuery => ({
  page: 1, pageSize: 24, sortKey: "listedDate", sortDirection: "desc", ...over,
});
const P = (over: Row): Row => ({
  ListingKey: "l", ListingId: "A1", StandardStatus: "Active", PropertyType: "Residential", PropertySubType: "Single Family Residence",
  ListPrice: 500000, City: "Fort Lauderdale", UnparsedAddress: "1 Main St, Fort Lauderdale, FL 33301", ParcelNumber: "PARCEL-1",
  Latitude: 26.1, Longitude: -80.1, ModificationTimestamp: "2026-09-01T00:00:00Z", ListingContractDate: "2026-08-01",
  ListAgentKey: null, ListAgentMlsId: null, ListAgentFullName: "Someone", CoListAgentKey: null, CoListAgentMlsId: null,
  ListOfficeName: "FortMark, LLC", ListOfficeMlsId: FTMK, CoListOfficeMlsId: null,
  InternetEntireListingDisplayYN: true, InternetAddressDisplayYN: true, Media: [], ...over,
});
const PROPS: Row[] = [
  P({ ListingKey: "p-primary", ListingId: "A200", ListPrice: 900000, ListAgentKey: "mk-agent", ListAgentMlsId: "M100" }),
  P({ ListingKey: "p-colist", ListingId: "A201", ListPrice: 1500000, ListAgentKey: "mk-dup1", CoListAgentKey: "mk-agent", CoListAgentMlsId: "M100", CoListOfficeMlsId: FTMK }),
  P({ ListingKey: "p-other", ListingId: "A202", ListPrice: 2500000, ListAgentKey: "mk-dup1" }),
  P({ ListingKey: "p-elsewhere", ListingId: "A203", ListPrice: 700000, ListAgentKey: "mk-other", ListOfficeMlsId: "OTHR01", ListOfficeName: "Other Realty" }),
  P({ ListingKey: "p-private", ListingId: "A204", ListPrice: 800000, ListAgentKey: "mk-agent", InternetAddressDisplayYN: false }),
  P({ ListingKey: "p-hidden", ListingId: "A205", ListPrice: 9900000, ListAgentKey: "mk-agent", InternetEntireListingDisplayYN: false }),
  P({ ListingKey: "p-closed", ListingId: "A206", ListPrice: 600000, StandardStatus: "Closed", ListAgentKey: "mk-agent" }),
];

async function main() {
  const stub = await startStub({ Property: PROPS, Media: [], Member: MEMBERS, Office: OFFICES });
  const cfg = { baseUrl: stub.baseUrl, dataset: "miamire", token: "t" };
  try {
    // --- Member lookup ---------------------------------------------------------
    const one = await findMembersByLicense(cfg, licenseCandidates("SL3123456"));
    check("an SL licence finds the roster's bare-number member", one.length === 1 && one[0].memberKey === "mk-agent");
    check("roster lookup resolves to linked in FortMark's office", classifyMembers(one, FTMK).status === "linked");
    const req = stub.requests.at(-1)!;
    check("roster query goes to the Member resource", req.resource === "Member");
    check("roster query selects only identifiers (no email, phones, address)",
      (req.params.get("$select") ?? "").split(",").sort().join(",") === [...MEMBER_FIELDS].sort().join(",") &&
        !/Email|Phone|Address|SocialMedia/.test(req.params.get("$select") ?? ""));
    check("roster query matches on the state licence field only", /^MemberStateLicense eq/.test(req.params.get("$filter") ?? ""));
    check("returned candidates carry no personal fields", !JSON.stringify(one).includes("private@example.test") && !JSON.stringify(one).includes("5550001111"));

    check("an unknown licence finds nobody", (await findMembersByLicense(cfg, licenseCandidates("SL3999999"))).length === 0);
    const mism = classifyMembers(await findMembersByLicense(cfg, licenseCandidates("3222222")), FTMK);
    check("a member of another office is office_mismatch", mism.status === "office_mismatch");
    const amb = classifyMembers(await findMembersByLicense(cfg, licenseCandidates("3333333")), FTMK);
    check("two roster members for one licence is ambiguous", amb.status === "ambiguous");
    check("an inactive member is not_found",
      classifyMembers(await findMembersByLicense(cfg, licenseCandidates("3444444")), FTMK).status === "not_found");
    check("OData injection in a licence is escaped, not executed",
      (await findMembersByLicense(cfg, licenseCandidates("3123456' or MemberStatus eq 'Active"))).length === 0);

    // --- Office record -----------------------------------------------------------
    const office = await getOfficeRecord(cfg, FTMK);
    check("the Office record resolves FortMark by office id", office?.name === "FortMark, LLC" && office.officeMlsId === FTMK);
    check("office query selects only office identity fields",
      (stub.requests.at(-1)!.params.get("$select") ?? "").split(",").sort().join(",") === [...OFFICE_RECORD_FIELDS].sort().join(","));
    check("an unknown office is null", (await getOfficeRecord(cfg, "ZZZZ99")) === null);

    // --- Upstream unavailable ------------------------------------------------------
    stub.mode = "unauthorized";
    check("an MLS failure throws (resolver stores unavailable, never a guess)",
      await findMembersByLicense(cfg, licenseCandidates("3123456")).then(() => false, () => true));
    stub.mode = "ok";

    // --- My Listings -----------------------------------------------------------------
    const mine = await searchListings(cfg, base({ office: "mine", status: ["active"] }), undefined, { memberKey: "mk-agent", brokerageOfficeId: FTMK });
    const ids = mine.items.map((l) => l.mlsNumber).sort().join(",");
    check("My Listings = primary + co-listing, displayable, active", ids === "A200,A201,A204");
    check("the primary listing is marked primary", mine.items.find((l) => l.mlsNumber === "A200")?.agentRole === "primary");
    check("the co-listing is marked co_listing", mine.items.find((l) => l.mlsNumber === "A201")?.agentRole === "co_listing");
    check("another agent's FortMark listing is excluded", !mine.items.some((l) => l.mlsNumber === "A202"));
    check("another office's listing is excluded", !mine.items.some((l) => l.mlsNumber === "A203"));
    check("a non-displayable listing is excluded even when it is mine", !mine.items.some((l) => l.mlsNumber === "A205"));
    check("closed listings are not in the default active view", !mine.items.some((l) => l.mlsNumber === "A206"));
    const priv = mine.items.find((l) => l.mlsNumber === "A204");
    check("my own withheld-address listing is still sanitised", priv?.address === WITHHELD_ADDRESS && priv?.folioNumber === undefined && priv?.coordinates === undefined);
    const f = stub.requests.at(-1)!.params.get("$filter") ?? "";
    check("My Listings filters by member key, primary or co-listing", f.includes("ListAgentKey eq 'mk-agent'") && f.includes("CoListAgentKey eq 'mk-agent'"));
    check("My Listings never matches on agent name", !/FullName/.test(f));
    check("My Listings browser rows carry no agent keys", !JSON.stringify(mine.items).includes("mk-agent"));

    const withClosed = await searchListings(cfg, base({ office: "mine", status: ["active", "closed"] }), undefined, { memberKey: "mk-agent" });
    check("other statuses are available by filter", withClosed.items.some((l) => l.mlsNumber === "A206"));

    const none = await searchListings(cfg, base({ office: "mine", status: ["active"] }), undefined, { memberKey: "mk-nobody" });
    check("a linked agent with no listings gets a real zero", none.total === 0 && none.items.length === 0);

    const before = stub.requests.length;
    check("My Listings without a linked member is refused before any request",
      await searchListings(cfg, base({ office: "mine" }), undefined, {}).then(() => false, (e) => e instanceof MemberNotLinkedError) &&
        stub.requests.length === before);
    check("buildSearchFilter refuses mine without a key", (() => { try { buildSearchFilter(base({ office: "mine" })); return false; } catch (e) { return e instanceof MemberNotLinkedError; } })());

    const summary = await getMyListingSummary(cfg, "mk-agent", { brokerageOfficeId: FTMK });
    check("Home: my active count counts primary + co-listings", summary.activeCount === 3);
    check("Home: my featured listing is my highest-priced active one (a co-listing here)",
      summary.featured?.mlsNumber === "A201" && summary.featured.agentRole === "co_listing");

    // --- FortMark Listings stay a separate company scope --------------------------------
    const firm = await searchListings(cfg, base({ office: "fortmark", status: ["active"] }), undefined, { brokerageOfficeId: FTMK, memberKey: "mk-agent" });
    check("FortMark Listings = the office's book, not the agent's",
      firm.items.map((l) => l.mlsNumber).sort().join(",") === "A200,A201,A202,A204");
    const ff = stub.requests.at(-1)!.params.get("$filter") ?? "";
    check("FortMark scope filters by office id, never by member", ff.includes("ListOfficeMlsId eq 'FTMK01'") && !ff.includes("ListAgentKey"));
    check("FortMark scope still refuses without an office id",
      await searchListings(cfg, base({ office: "fortmark" }), undefined, { memberKey: "mk-agent" }).then(() => false, (e) => e instanceof OfficeNotConfiguredError));
    const firmSummary = await getFortmarkListingSummary(cfg, FTMK);
    check("FortMark summary counts the office book", firmSummary.activeCount === 4);

    // --- General search is independent ------------------------------------------------------
    const general = await searchListings(cfg, base({ status: ["active"] }));
    check("general MLS search needs neither office nor identity", general.items.length === 5);
    check("general search marks no agent role", general.items.every((l) => l.agentRole === undefined));

    const detail = await getListing(cfg, "p-colist", undefined, { memberKey: "mk-agent" });
    check("detail knows the caller co-lists this listing", detail?.agentRole === "co_listing");
    const detailOther = await getListing(cfg, "p-other", undefined, { memberKey: "mk-agent" });
    check("detail marks no role on someone else's listing", detailOther?.agentRole === undefined);
  } finally {
    await stub.close();
  }

  // ===========================================================================
  // 7. Brokerage: system-managed MLS office
  // ===========================================================================
  check("office id comes from system configuration", fortmarkOfficeConfig({ FORTMARK_MLS_OFFICE_ID: " ftmk01 " }) === "FTMK01");
  check("no configuration means not configured, never a default", fortmarkOfficeConfig({}) === null);
  check("a malformed configured id is refused", fortmarkOfficeConfig({ FORTMARK_MLS_OFFICE_ID: "FT' or 1 eq 1" }) === null);
  check("no source code hard-codes FortMark's office id",
    ["lib/brokerage/service.ts", "lib/mls/service.ts", "lib/mls-identity/service.ts", "app/api/listings/route.ts"].every((f) => !readFileSync(f, "utf8").includes("FTMK01")));
  const now = Date.parse("2026-09-23T12:00:00Z");
  check("a missing record is due for sync", officeSyncDue(null, "FTMK01", now));
  check("a record for another office is due for sync", officeSyncDue({ mlsOfficeId: "OLD01", mlsSyncedAt: "2026-09-23T11:00:00Z" }, "FTMK01", now));
  check("a fresh record is not re-synced per request", !officeSyncDue({ mlsOfficeId: "FTMK01", mlsSyncedAt: "2026-09-23T11:00:00Z" }, "FTMK01", now));
  check("a day-old record is refreshed", officeSyncDue({ mlsOfficeId: "FTMK01", mlsSyncedAt: "2026-09-22T11:00:00Z" }, "FTMK01", now));
  check("nothing to sync without configuration", !officeSyncDue(null, null, now));
  const parse = parseBrokerageInput({ displayName: "FortMark, LLC", mlsOfficeId: "FTMK01" });
  check("an operator cannot type the MLS office id", !parse.ok);

  // ===========================================================================
  // 8. Onboarding and Profile: nobody types MLS or brokerage identity
  // ===========================================================================
  const mlsStep = stepById("mls")!;
  check("onboarding MLS step asks for nothing", mlsStep.fields.length === 0);
  const allFields = ["identity", "professional", "credentials", "contact", "mls", "review"].flatMap((id) => stepById(id as never)?.fields ?? []);
  check("no onboarding step asks for brokerage or MLS office", !allFields.some((f) => /brokerage|office|mls/i.test(String(f))));
  check("the licence is still collected (it is the anchor)", (stepById("credentials")?.fields ?? []).includes("licenseNumber" as never));
  const profileRoute = readFileSync("app/api/profile/route.ts", "utf8");
  const onboardingRoute = readFileSync("app/api/profile/onboarding/route.ts", "utf8");
  check("profile save matches the licence after persisting it",
    profileRoute.indexOf("updateOwnProfile(") < profileRoute.indexOf("matchLicenceAfterSave("));
  check("onboarding save matches the licence after persisting it",
    onboardingRoute.indexOf("saveOnboardingStep(") < onboardingRoute.indexOf("matchLicenceAfterSave("));
  const svc = readFileSync("lib/mls-identity/service.ts", "utf8");
  check("the resolver stores unavailable instead of throwing on MLS failure", /catch \(error\)[\s\S]{0,200}status = "unavailable"/.test(svc));
  check("a second account for the same member is held as conflict", /status = "conflict"/.test(svc));
  check("the resolver never creates dashboard users", !/insert\(dashboardUsers\)/.test(svc));
  check("audit records status and counts only", /metadata: \{ status, candidateCount \}/.test(svc));
  check("the browser components never import the roster module",
    ["components/profile/mls-identity-status.tsx", "components/settings/profile-section.tsx", "components/settings/team-section.tsx", "app/(app)/listings/page.tsx"]
      .every((f) => !readFileSync(f, "utf8").includes("lib/mls/member")));

  // ===========================================================================
  // 9. Team: MLS state for privileged viewers only
  // ===========================================================================
  const rows: RosterSourceRow[] = [
    { userId: "u1", role: "admin", status: "active", accountEmail: "a@x.test", createdAt: null, profile: { preferredDisplayName: "A", legalFirstName: null, legalLastName: null, professionalTitle: null, licenseState: "FL", licenseType: null, licenseNumber: "SL3123456", businessEmail: null }, image: null, mls: { status: "linked", licenseNumber: "SL3123456", licenseState: "FL" } },
    { userId: "u2", role: "agent", status: "active", accountEmail: "b@x.test", createdAt: null, profile: { preferredDisplayName: "B", legalFirstName: null, legalLastName: null, professionalTitle: null, licenseState: "FL", licenseType: null, licenseNumber: "SL1", businessEmail: null }, image: null, mls: null },
  ];
  check("roster state: linked", mlsStateFor(rows[0]) === "linked");
  check("roster state: licence never resolved is pending", mlsStateFor(rows[1]) === "stale");
  const asAdmin = rosterFor(rows, { userId: "u1", privileged: true });
  const asAgent = rosterFor(rows, { userId: "u2", privileged: false });
  check("privileged viewers see MLS state", asAdmin.every((e) => e.mlsState !== undefined));
  check("agents do not see colleagues' MLS diagnostics", asAgent.every((e) => e.mlsState === undefined));
  check("admin row reads Admin on Team", asAdmin.find((e) => e.id === "u1")?.roleLabel === "Admin");

  // ===========================================================================
  // 10. Listing routes: scope decided from the session
  // ===========================================================================
  const listRoute = readFileSync("app/api/listings/route.ts", "utf8");
  check("My Listings without identity is a 409 with the state, not zero", /mls_identity_not_linked/.test(listRoute) && /status: 409/.test(listRoute));
  const featured = readFileSync("app/api/listings/featured/route.ts", "utf8");
  check("Home card: agents get their own book", /getMyListingSummary\(/.test(featured) && /!ctx\.privileged/.test(featured));
  check("Home card: brokers/admins get FortMark's book", /getFortmarkListingSummary\(config\.config, ctx\.officeId/.test(featured));
  const source = readFileSync("app/api/listings/source/route.ts", "utf8");
  check("default scope: privileged → fortmark, linked agent → mine, else mls",
    /ctx\.privileged && ctx\.officeId \? "fortmark" : ctx\.identity\.ok \? "mine" : "mls"/.test(source));
  const ctxSrc = readFileSync("lib/mls-identity/listing-context.ts", "utf8");
  check("listing context reads nothing from the request", !/request|searchParams|body/.test(ctxSrc.replace(/\/\*[\s\S]*?\*\//g, "")));

  console.log(`${passed}/${passed + failures.length} MLS identity checks passed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
