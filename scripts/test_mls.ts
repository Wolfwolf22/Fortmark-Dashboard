/**
 * MLS listings regression tests.
 *
 * Behavioural coverage for the listing domain's real source: the flag and
 * credential rules, RESO → domain normalisation, the query the service builds
 * and how it pages and sorts, and how each upstream failure is classified.
 * The service is exercised for real against a local OData stub
 * (`scripts/mls-stub.ts`) through the same `bridgeRequest` the routes use,
 * so what is asserted is what would be sent to Bridge and what would come
 * back — not the shape of the code.
 *
 * Bridge itself is NOT contacted. No credential is needed to run this and
 * none is read. A live call against the real dataset remains a separate,
 * manual verification.
 *
 * Run: npm run test:mls
 */
import { readFileSync } from "node:fs";
import { bridgeRequest, BridgeError, MAX_TOP } from "../lib/mls/bridge.ts";
import {
  listingAvailability,
  mlsListingsEnabled,
  resolveBridgeConfig,
  sampleListingsEnabled,
} from "../lib/mls/config.ts";
import { EMBEDDED_MEDIA_FIELD, PROPERTY_FIELDS, UNVERIFIED_PROPERTY_FIELDS } from "../lib/mls/fields.ts";
import { FORTMARK_LIST_OFFICE_MLS_ID } from "../lib/mls/brokerage.ts";
import {
  WITHHELD_ADDRESS,
  toListing,
  toListingStatus,
  toPhotoUrls,
  toPriceHistory,
  toPropertyType,
  toStreetAddress,
} from "../lib/mls/normalize.ts";
import { andFilters, anyOf, eq, escapeODataString, looksLikeMlsNumber } from "../lib/mls/odata.ts";
import { DEFAULT_PAGE_SIZE, parseListingQuery, toSearchParams } from "../lib/mls/query.ts";
import {
  buildOrderBy,
  buildSearchFilter,
  clampPaging,
  findComparables,
  getFeaturedListing,
  getFortmarkListingSummary,
  getListing,
  MAX_PAGE_SIZE,
  searchListings,
} from "../lib/mls/service.ts";
import { sortListings } from "../lib/data/listing-sort.ts";
import type { ListingSearchQuery } from "../lib/data/types.ts";
import { startStub, type Row } from "./mls-stub.ts";

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

// A syntactically plausible shape only — never a real credential.
const TOKEN = "bridge-token-example";
const env = (extra: Record<string, string | undefined> = {}) => ({
  MLS_LISTINGS_ENABLED: "1",
  BRIDGE_API_TOKEN: TOKEN,
  BRIDGE_DATASET: "testre",
  ...extra,
});

// --- Flag and credential -----------------------------------------------------
check("flag on for exactly 1", mlsListingsEnabled({ MLS_LISTINGS_ENABLED: "1" }));
check("flag off when unset", !mlsListingsEnabled({}));
check("flag off for true", !mlsListingsEnabled({ MLS_LISTINGS_ENABLED: "true" }));
check("flag off for padded 1", !mlsListingsEnabled({ MLS_LISTINGS_ENABLED: " 1" }));

check("credentials alone do not enable the MLS",
  resolveBridgeConfig({ BRIDGE_API_TOKEN: TOKEN, BRIDGE_DATASET: "x" }).ok === false);
check("credentials alone report disabled",
  (resolveBridgeConfig({ BRIDGE_API_TOKEN: TOKEN, BRIDGE_DATASET: "x" }) as { reason?: string }).reason === "disabled");
check("flag without token is missing_token",
  (resolveBridgeConfig({ MLS_LISTINGS_ENABLED: "1", BRIDGE_DATASET: "x" }) as { reason?: string }).reason === "missing_token");
check("flag without dataset is missing_dataset",
  (resolveBridgeConfig({ MLS_LISTINGS_ENABLED: "1", BRIDGE_API_TOKEN: TOKEN }) as { reason?: string }).reason === "missing_dataset");
check("whitespace token is absent",
  (resolveBridgeConfig(env({ BRIDGE_API_TOKEN: "  " })) as { reason?: string }).reason === "missing_token");
{
  const r = resolveBridgeConfig(env({ BRIDGE_BASE_URL: "https://proxy.example/odata///" }));
  check("a full configuration resolves", r.ok);
  check("the base URL override is honoured and trimmed", r.ok && r.config.baseUrl === "https://proxy.example/odata");
  check("the default base URL is Bridge",
    (resolveBridgeConfig(env()) as { config?: { baseUrl: string } }).config?.baseUrl === "https://api.bridgedataoutput.com/api/v2/OData");
}
// --- What a deployment can actually show ------------------------------------
//
// The single most important property here: a MISSING MLS must never resolve to
// generated properties. It used to. Every one of these cases returned
// "sample", so a deployment that had simply never been given a Bridge
// credential served invented addresses and prices through the real screens.
check("nothing configured means nothing to show, not generated rows",
  listingAvailability({}) === "not_configured");
check("a flag on with no token is not configured, not sample",
  listingAvailability({ MLS_LISTINGS_ENABLED: "1" }) === "not_configured");
check("a flag on with no dataset is not configured, not sample",
  listingAvailability({ MLS_LISTINGS_ENABLED: "1", BRIDGE_API_TOKEN: "t" }) === "not_configured");
check("a working MLS is the MLS", listingAvailability(env()) === "mls");

// Fixture mode is something a deployment opts into by name.
check("fixture mode must be asked for by name",
  listingAvailability({ SAMPLE_LISTINGS_ENABLED: "1" }) === "sample");
check("fixture mode is strict about its value",
  !sampleListingsEnabled({ SAMPLE_LISTINGS_ENABLED: "true" }) &&
    !sampleListingsEnabled({ SAMPLE_LISTINGS_ENABLED: "yes" }) &&
    !sampleListingsEnabled({ SAMPLE_LISTINGS_ENABLED: " 1 " }) &&
    sampleListingsEnabled({ SAMPLE_LISTINGS_ENABLED: "1" }));
check("a real MLS always beats the fixture flag",
  listingAvailability({ ...env(), SAMPLE_LISTINGS_ENABLED: "1" }) === "mls");

// --- OData helpers -----------------------------------------------------------
check("single quotes are doubled", escapeODataString("O'Brien's") === "O''Brien''s");
check("eq escapes its value", eq("City", "L'Isle") === "City eq 'L''Isle'");
check("anyOf with one value is an eq", anyOf("F", ["a"]) === "F eq 'a'");
check("anyOf with several values is an or", anyOf("F", ["a", "b"]) === "F eq 'a' or F eq 'b'");
check("anyOf with none is absent", anyOf("F", []) === undefined);
check("andFilters parenthesises and drops blanks",
  andFilters(["A eq 1", undefined, "", "B eq 2"]) === "(A eq 1) and (B eq 2)");
check("an MLS number is recognised", looksLikeMlsNumber("A11234567") && looksLikeMlsNumber("F10471234") && looksLikeMlsNumber("RX-10987654"));
check("an address is not an MLS number", !looksLikeMlsNumber("2416 NE 26th St") && !looksLikeMlsNumber("Rio Vista"));
check("a bare digit run is not an MLS number", !looksLikeMlsNumber("1234567"));

// --- Normalisation -----------------------------------------------------------
check("Active maps", toListingStatus("Active") === "active");
check("Active Under Contract is underContract", toListingStatus("Active Under Contract") === "underContract");
check("Coming Soon maps", toListingStatus("Coming Soon") === "comingSoon");
check("Canceled groups with withdrawn", toListingStatus("Canceled") === "withdrawn" && toListingStatus("Withdrawn") === "withdrawn");
check("an unknown status is hold, never active", toListingStatus("Something New") === "hold" && toListingStatus(undefined) === "hold");

check("SFR maps", toPropertyType("Residential", "Single Family Residence") === "singleFamily");
check("condo maps", toPropertyType("Residential", "Condominium") === "condo");
check("duplex is multi-family", toPropertyType("Residential", "Duplex") === "multiFamily");
check("land by PropertyType", toPropertyType("Land", "Unimproved Land") === "land");
check("an unknown sub-type is other, not a guess", toPropertyType("Residential", "Mobile Home") === "other");

check("structured address is preferred",
  toStreetAddress({ StreetNumber: "2416", StreetDirPrefix: "NE", StreetName: "26th", StreetSuffix: "St", UnparsedAddress: "2416 NE 26th St, Fort Lauderdale, FL 33305" }) === "2416 NE 26th St");
check("a unit is appended",
  toStreetAddress({ StreetNumber: "100", StreetName: "Bayview", StreetSuffix: "Dr", UnitNumber: "12B" }) === "100 Bayview Dr #12B");
check("falls back to the unparsed address", toStreetAddress({ UnparsedAddress: "517 Bayview Dr" }) === "517 Bayview Dr");

const FULL: Row = {
  ListingKey: "key-1",
  ListingId: "A11234567",
  StandardStatus: "Closed",
  PropertyType: "Residential",
  PropertySubType: "Single Family Residence",
  ListPrice: 1285000,
  ClosePrice: 1250000,
  CloseDate: "2026-08-01",
  StreetNumber: "2416",
  StreetDirPrefix: "NE",
  StreetName: "26th",
  StreetSuffix: "St",
  City: "Fort Lauderdale",
  PostalCode: "33305",
  ParcelNumber: "494236010010",
  BedroomsTotal: 4,
  BathroomsTotalInteger: 3,
  LivingArea: 2450,
  LotSizeSquareFeet: 8500,
  YearBuilt: 1998,
  DaysOnMarket: 24,
  ListingContractDate: "2026-06-15",
  ModificationTimestamp: "2026-08-02T10:00:00Z",
  PublicRemarks: "Renovated in 2023.",
  Latitude: 26.15,
  Longitude: -80.12,
  ListOfficeName: "Other Realty",
  ListOfficeMlsId: "OTHR01",
  CoListOfficeMlsId: null,
  InternetEntireListingDisplayYN: true,
  InternetAddressDisplayYN: true,
};

{
  const l = toListing(FULL);
  check("a full record converts", l !== null);
  check("id is the ListingKey", l?.id === "key-1");
  check("mlsNumber is the ListingId", l?.mlsNumber === "A11234567");
  check("folio is the parcel number", l?.folioNumber === "494236010010");
  check("status and type map", l?.status === "closed" && l?.propertyType === "singleFamily");
  check("closed price and date carry", l?.closedPrice === 1250000 && l?.closedDate?.startsWith("2026-08-01") === true);
  check("numbers carry", l?.beds === 4 && l?.baths === 3 && l?.sqft === 2450 && l?.lotSqft === 8500 && l?.yearBuilt === 1998 && l?.daysOnMarket === 24);
  check("listed date is ISO", l?.listedDate === new Date("2026-06-15").toISOString());
  check("coordinates carry", l?.coordinates?.lat === 26.15 && l?.coordinates?.lng === -80.12);
  check("source is mls", l?.source === "mls");
  check("agent is absent when the feed does not carry it", l?.listingAgent === undefined);
  check("agentId is empty for an MLS row (no sample roster lookup)", l?.agentId === "");
  check("price history is the list event and the close",
    l?.priceHistory.length === 2 && l.priceHistory[0].kind === "listed" && l.priceHistory[1].kind === "closed");
  check("photos default to none", l?.photos.length === 0);
}
{
  const sparse = toListing({ ListingKey: "k", ListingId: "A1", StandardStatus: "Active", ModificationTimestamp: "2026-09-01T00:00:00Z" });
  check("a sparse record converts", sparse !== null);
  check("missing numbers are 0 (the domain's 'not stated')", sparse?.beds === 0 && sparse?.sqft === 0 && sparse?.listPrice === 0);
  check("missing optionals are absent, not invented",
    sparse?.yearBuilt === undefined && sparse?.daysOnMarket === undefined && sparse?.lotSqft === undefined && sparse?.neighborhood === undefined && sparse?.folioNumber === undefined);
  check("a missing list date stays unknown — modification time is not a list date", sparse?.listedDate === "");
  check("no price history without a list date and price", toPriceHistory({ ListPrice: 1 }).length === 0);
}
check("a record without a key is rejected", toListing({ ListingId: "A1" }) === null);
check("a record without an MLS number is rejected", toListing({ ListingKey: "k" }) === null);

{
  const urls = toPhotoUrls([
    { MediaURL: "https://cdn.example/3.jpg", Order: 3, MediaCategory: "Photo" },
    { MediaURL: "https://cdn.example/1.jpg", Order: 1 },
    { MediaURL: "http://insecure.example/2.jpg", Order: 2 },
    { MediaURL: "https://cdn.example/doc.pdf", Order: 0, MediaCategory: "Document" },
    { Order: 4 },
  ]);
  check("photos are ordered by Order", urls[0] === "https://cdn.example/1.jpg" && urls[1] === "https://cdn.example/3.jpg");
  check("only https media is kept", !urls.some((u) => u.startsWith("http:")));
  check("non-photo media is dropped", !urls.some((u) => u.endsWith(".pdf")));
  check("a record without a URL is dropped", urls.length === 2);
}

// --- Query parsing -----------------------------------------------------------
{
  const q = parseListingQuery(new URLSearchParams("status=active,closed,bogus&propertyType=condo&city=Fort%20Lauderdale,Hollywood&minPrice=500000&maxPrice=abc&minBeds=3&q=Rio%20Vista&page=2&pageSize=24&sort=listPrice&dir=asc"));
  check("statuses are validated against the domain", q.status?.length === 2 && !q.status.includes("bogus" as never));
  check("types parse", q.propertyType?.[0] === "condo");
  check("cities parse", q.city?.length === 2 && q.city[0] === "Fort Lauderdale");
  check("a non-numeric price is dropped", q.minPrice === 500000 && q.maxPrice === undefined);
  check("beds parse", q.minBeds === 3);
  check("query text parses", q.query === "Rio Vista");
  check("paging parses", q.page === 2 && q.pageSize === 24);
  check("sort parses", q.sortKey === "listPrice" && q.sortDirection === "asc");
}
{
  const q = parseListingQuery(new URLSearchParams("page=-3&pageSize=0&sort=nope&dir=sideways&minPrice=-1"));
  check("bad paging falls back", q.page === 1 && q.pageSize === DEFAULT_PAGE_SIZE);
  check("bad sort falls back", q.sortKey === "listedDate" && q.sortDirection === "desc");
  check("a negative price is dropped", q.minPrice === undefined);
}
check("a city carrying filter syntax is dropped",
  parseListingQuery(new URLSearchParams("city=Miami' or 1 eq 1 or 'x")).city === undefined);
check("query text is length-capped",
  (parseListingQuery(new URLSearchParams(`q=${"x".repeat(500)}`)).query ?? "").length === 120);
{
  const q: ListingSearchQuery = { status: ["active"], city: ["Hollywood"], minBeds: 2, query: "A11234567", page: 3, pageSize: 12, sortKey: "beds", sortDirection: "asc" };
  const round = parseListingQuery(toSearchParams(q));
  check("query round-trips through the URL", JSON.stringify(round) === JSON.stringify({ ...q, propertyType: undefined, minPrice: undefined, maxPrice: undefined }) || (round.status?.[0] === "active" && round.city?.[0] === "Hollywood" && round.minBeds === 2 && round.query === "A11234567" && round.page === 3 && round.sortKey === "beds" && round.sortDirection === "asc"));
  check("defaults are omitted from the URL", toSearchParams({ page: 1, pageSize: DEFAULT_PAGE_SIZE, sortKey: "listedDate", sortDirection: "desc" }).toString() === "");
}

// --- The filter the service builds -----------------------------------------
const base = (over: Partial<ListingSearchQuery> = {}): ListingSearchQuery => ({ page: 1, pageSize: 12, sortKey: "listedDate", sortDirection: "desc", ...over });
{
  const f = buildSearchFilter(base());
  check("sales only by default (leases share statuses on this MLS)", f === "(InternetEntireListingDisplayYN eq true) and (PropertyType eq 'Residential')");
}
check("status filter uses RESO names",
  buildSearchFilter(base({ status: ["underContract", "withdrawn"] })).includes("StandardStatus eq 'Active Under Contract' or StandardStatus eq 'Withdrawn' or StandardStatus eq 'Canceled'"));
check("type filter maps to sub-types under Residential",
  buildSearchFilter(base({ propertyType: ["condo"] })) === "(InternetEntireListingDisplayYN eq true) and ((PropertyType eq 'Residential') and (PropertySubType eq 'Condominium'))");
check("land swaps to the dataset's land property types (miamire: Land/Boat Docks, Commercial Land)",
  buildSearchFilter(base({ propertyType: ["land"] })) ===
    "(InternetEntireListingDisplayYN eq true) and (PropertyType eq 'Land' or PropertyType eq 'Land/Boat Docks' or PropertyType eq 'Commercial Land')");
check("land plus residential is an or of both",
  buildSearchFilter(base({ propertyType: ["land", "condo"] })).includes("or (PropertyType eq 'Land' or PropertyType eq 'Land/Boat Docks'"));
check("multi-family includes Residential Income (where miamire files duplexes)",
  buildSearchFilter(base({ propertyType: ["multiFamily"] })).includes("(PropertyType eq 'Residential Income')"));
check("miamire land types normalise to land",
  toPropertyType("Land/Boat Docks", "Residential") === "land" && toPropertyType("Commercial Land", "Agriculture") === "land");
check("miamire income property normalises to multi-family", toPropertyType("Residential Income", "Duplex") === "multiFamily");
check("every search leads with the IDX display clause", buildSearchFilter(base({})).startsWith("(InternetEntireListingDisplayYN eq true)"));
check("other cannot be expressed and is ignored",
  buildSearchFilter(base({ propertyType: ["other"] })) === "(InternetEntireListingDisplayYN eq true) and (PropertyType eq 'Residential')");
check("price bounds and beds",
  buildSearchFilter(base({ minPrice: 500000, maxPrice: 1000000, minBeds: 3 })).includes("(ListPrice ge 500000) and (ListPrice le 1000000) and (BedroomsTotal ge 3)"));
check("a NaN bound is dropped", !buildSearchFilter(base({ minPrice: Number.NaN })).includes("NaN"));
check("an MLS number is an exact ListingId lookup",
  buildSearchFilter(base({ query: "a11234567" })).includes("ListingId eq 'A11234567'"));
check("free text searches the unparsed address",
  buildSearchFilter(base({ query: "26th St" })).includes("contains(UnparsedAddress,'26th St')"));
check("free text is OData-escaped",
  buildSearchFilter(base({ query: "O'Neil" })).includes("'O''Neil'"));
check("cities are escaped", buildSearchFilter(base({ city: ["L'Isle"] })).includes("City eq 'L''Isle'"));

check("a sortable key becomes a RESO orderby", buildOrderBy("listPrice", "asc").orderby === "ListPrice asc" && buildOrderBy("listPrice", "asc").applied);
check("a derived key cannot be sorted upstream and says so",
  !buildOrderBy("ppsf", "desc").applied && !buildOrderBy("address", "asc").applied && buildOrderBy("ppsf", "desc").orderby === "ModificationTimestamp desc");
check("paging is clamped", clampPaging(0, 0).page === 1 && clampPaging(0, 0).pageSize === 1 && clampPaging(2, 9999).pageSize === Math.min(MAX_PAGE_SIZE, MAX_TOP));

// --- The service, against the stub -----------------------------------------
const PROPS: Row[] = [
  { ...FULL, ListOfficeName: "FortMark, LLC", ListOfficeMlsId: FORTMARK_LIST_OFFICE_MLS_ID, ListingKey: "k1", ListingId: "A10000001", StandardStatus: "Active", ClosePrice: undefined, CloseDate: undefined, ListPrice: 900000, BedroomsTotal: 3, ListingContractDate: "2026-09-01", ModificationTimestamp: "2026-09-10T00:00:00Z", UnparsedAddress: "1 Rio Vista Blvd, Fort Lauderdale, FL 33301", City: "Fort Lauderdale", PropertySubType: "Single Family Residence" },
  { ...FULL, ListOfficeName: "FortMark, LLC", ListOfficeMlsId: FORTMARK_LIST_OFFICE_MLS_ID, Media: [{ MediaURL: "https://cdn.example/k2-embedded-2.jpg", Order: 2, MediaCategory: "Photo" }, { MediaURL: "https://cdn.example/k2-embedded-1.jpg", Order: 1, MediaCategory: "Photo" }], ListingKey: "k2", ListingId: "A10000002", StandardStatus: "Active", ClosePrice: undefined, CloseDate: undefined, ListPrice: 2400000, BedroomsTotal: 5, ListingContractDate: "2026-08-20", ModificationTimestamp: "2026-09-09T00:00:00Z", UnparsedAddress: "2 Bayview Dr, Fort Lauderdale, FL 33305", City: "Fort Lauderdale", PropertySubType: "Single Family Residence" },
  { ...FULL, ListingKey: "k3", ListingId: "A10000003", StandardStatus: "Active", ClosePrice: undefined, CloseDate: undefined, ListPrice: 650000, BedroomsTotal: 2, ListingContractDate: "2026-07-01", ModificationTimestamp: "2026-09-08T00:00:00Z", UnparsedAddress: "3 Ocean Ave #4, Hollywood, FL 33019", City: "Hollywood", PropertySubType: "Condominium" },
  { ...FULL, ListingKey: "k4", ListingId: "A10000004", StandardStatus: "Closed", ClosePrice: 1200000, CloseDate: "2026-08-15", ListPrice: 1250000, BedroomsTotal: 4, ListingContractDate: "2026-05-01", ModificationTimestamp: "2026-08-16T00:00:00Z", UnparsedAddress: "4 Rio Vista Blvd, Fort Lauderdale, FL 33301", City: "Fort Lauderdale", PropertySubType: "Single Family Residence" },
  { ...FULL, ListingKey: "k5", ListingId: "A10000005", StandardStatus: "Closed", ClosePrice: 980000, CloseDate: "2025-01-15", ListPrice: 999000, BedroomsTotal: 3, ListingContractDate: "2024-11-01", ModificationTimestamp: "2025-01-16T00:00:00Z", UnparsedAddress: "5 Old Sale St, Fort Lauderdale, FL 33301", City: "Fort Lauderdale", PropertySubType: "Single Family Residence" },
  { ...FULL, ListingKey: "k6", ListingId: "A10000006", StandardStatus: "Active", PropertyType: "Residential Lease", ClosePrice: undefined, CloseDate: undefined, ListPrice: 4500, BedroomsTotal: 2, ListingContractDate: "2026-09-05", ModificationTimestamp: "2026-09-11T00:00:00Z", UnparsedAddress: "6 Rental Way, Fort Lauderdale, FL 33301", City: "Fort Lauderdale", PropertySubType: "Condominium" },
];
const MEDIA: Row[] = [
  { ResourceRecordKey: "k1", MediaURL: "https://cdn.example/k1-2.jpg", Order: 2, MediaCategory: "Photo" },
  { ResourceRecordKey: "k1", MediaURL: "https://cdn.example/k1-1.jpg", Order: 1, MediaCategory: "Photo" },
  { ResourceRecordKey: "k2", MediaURL: "https://cdn.example/k2-1.jpg", Order: 1, MediaCategory: "Photo" },
];

const stub = await startStub({ Property: PROPS, Media: MEDIA });
const cfg = { baseUrl: stub.baseUrl, dataset: "testre", token: TOKEN };

try {
  // Credential transport.
  await bridgeRequest(cfg, "Property", { $top: 1 });
  {
    const r = stub.requests.at(-1)!;
    check("the token travels in the Authorization header", r.hasBearer && r.bearerValue === TOKEN);
    check("the token never appears in the URL", !r.path.includes(TOKEN) && !r.params.toString().includes(TOKEN));
    check("the dataset is in the path", r.path === "/testre/Property");
  }
  check("$top is capped at the upstream limit", (await (async () => { await bridgeRequest(cfg, "Property", { $top: 9999 }); return stub.requests.at(-1)!.params.get("$top"); })()) === String(MAX_TOP));

  // Search: sales only, filtering, sorting, paging, count.
  {
    const page = await searchListings(cfg, base({ pageSize: 2 }));
    check("a lease is never mixed into a sales search", !page.items.some((l) => l.mlsNumber === "A10000006"));
    check("total reflects the server-side count, not the page", page.total === 5 && page.items.length === 2);
    check("default order is newest listing first", page.items[0].mlsNumber === "A10000001" && page.items[1].mlsNumber === "A10000002");
    check("the page is marked mls", page.source === "mls" && page.sortApplied);
    const req = stub.requests.at(-1)!;
    check("the projection is the verified field set plus embedded media", req.params.get("$select") === [...PROPERTY_FIELDS, EMBEDDED_MEDIA_FIELD].join(","));
    check("no unverified field is ever selected", !UNVERIFIED_PROPERTY_FIELDS.some((f) => (req.params.get("$select") ?? "").split(",").includes(f)));
    check("$count is requested", req.params.get("$count") === "true");
  }
  {
    const page2 = await searchListings(cfg, base({ pageSize: 2, page: 2 }));
    check("page two skips the first page upstream", stub.requests.at(-1)!.params.get("$skip") === "2" && page2.items[0].mlsNumber === "A10000003");
    check("page two carries the same total", page2.total === 5);
  }
  {
    const active = await searchListings(cfg, base({ status: ["active"], city: ["Fort Lauderdale"] }));
    check("status and city filter upstream", active.items.length === 2 && active.items.every((l) => l.status === "active" && l.city === "Fort Lauderdale"));
  }
  {
    const cheap = await searchListings(cfg, base({ maxPrice: 700000, sortKey: "listPrice", sortDirection: "asc" }));
    check("price bound and sort apply upstream", cheap.items.length === 1 && cheap.items[0].mlsNumber === "A10000003");
    check("the orderby sent is the RESO field", stub.requests.at(-1)!.params.get("$orderby") === "ListPrice asc");
  }
  {
    const beds = await searchListings(cfg, base({ minBeds: 4, sortKey: "beds", sortDirection: "desc" }));
    check("beds filter and sort apply upstream", beds.items.map((l) => l.mlsNumber).join(",") === "A10000002,A10000004");
  }
  {
    const derived = await searchListings(cfg, base({ sortKey: "ppsf", sortDirection: "desc" }));
    check("a derived sort is reported as not applied", !derived.sortApplied && derived.items.length === 5);
  }
  {
    const byMls = await searchListings(cfg, base({ query: "a10000004" }));
    check("an MLS number query is an exact hit", byMls.items.length === 1 && byMls.items[0].mlsNumber === "A10000004");
    const byText = await searchListings(cfg, base({ query: "Rio Vista" }));
    check("free text matches the unparsed address",
      byText.items.map((l) => l.mlsNumber).sort().join(",") === "A10000001,A10000004");
  }

  // Detail and media.
  {
    const l = await getListing(cfg, "k1");
    check("a listing resolves by key", l?.mlsNumber === "A10000001");
    check("photos are fetched and ordered", l?.photos.join(",") === "https://cdn.example/k1-1.jpg,https://cdn.example/k1-2.jpg");
    const mediaReq = stub.requests.findLast((r) => r.resource === "Media")!;
    check("media is filtered by the listing key and ordered", mediaReq.params.get("$filter") === "ResourceRecordKey eq 'k1'" && mediaReq.params.get("$orderby") === "Order");
  }
  {
    const before = stub.requests.length;
    const l = await getListing(cfg, "A10000003");
    check("a listing resolves by MLS number when the key misses", l?.id === "k3");
    check("the MLS-number fallback is a second query, not a guess", stub.requests.slice(before).filter((r) => r.resource === "Property").length === 2);
    check("a listing with no media has no photos, and still resolves", l?.photos.length === 0);
  }
  check("an unknown id is null, not an error", (await getListing(cfg, "nope-000")) === null);
  check("a blank id is null without a request", (await (async () => { const n = stub.requests.length; const r = await getListing(cfg, "  "); return r === null && stub.requests.length === n; })()));

  // Featured.
  {
    const f = await getFeaturedListing(cfg);
    check("featured is the highest-priced active sale", f?.mlsNumber === "A10000002");
    check("featured carries only its first photo", f?.photos.length === 1);
  }

  // FortMark's own book, embedded photos and IDX display rules.
{
  const K7 = { ...FULL, ListingKey: "k7", ListingId: "A10000007", StandardStatus: "Active", PropertyType: "Commercial Sale", CoListOfficeMlsId: FORTMARK_LIST_OFFICE_MLS_ID, ClosePrice: undefined, CloseDate: undefined, ListPrice: 3100000, BedroomsTotal: 0, ListingContractDate: "2026-06-01", ModificationTimestamp: "2026-09-01T00:00:00Z", UnparsedAddress: "7 Commerce Way, Miami, FL 33130", City: "Miami", PropertySubType: "Office" };
  const K8 = { ...FULL, ListingKey: "k8", ListingId: "A10000008", StandardStatus: "Active", InternetAddressDisplayYN: false, ClosePrice: undefined, CloseDate: undefined, ListPrice: 700000, BedroomsTotal: 3, ListingContractDate: "2026-05-01", ModificationTimestamp: "2026-05-02T00:00:00Z", UnparsedAddress: "8 Private Ln, Fort Lauderdale, FL 33301", City: "Fort Lauderdale", PropertySubType: "Single Family Residence" };
  const K9 = { ...FULL, ListingKey: "k9", ListingId: "A10000009", StandardStatus: "Active", InternetEntireListingDisplayYN: false, ListOfficeMlsId: FORTMARK_LIST_OFFICE_MLS_ID, ClosePrice: undefined, CloseDate: undefined, ListPrice: 9900000, ListingContractDate: "2026-05-01", ModificationTimestamp: "2026-05-03T00:00:00Z", City: "Miami", PropertySubType: "Single Family Residence" };
  const book = await startStub({ Property: [...PROPS, K7, K8, K9], Media: MEDIA });
  const bookCfg = { baseUrl: book.baseUrl, dataset: "miamire", token: "t" };
  try {
    const own = await searchListings(bookCfg, base({ office: "fortmark", pageSize: 20 }));
    const ids = own.items.map((l) => l.mlsNumber).sort().join(",");
    check("FortMark scope filters by office id, listing or co-listing", ids === "A10000001,A10000002,A10000007");
    check("FortMark scope includes every property type", own.items.some((l) => l.mlsNumber === "A10000007"));
    check("every FortMark-scoped row is flagged isFortmark", own.items.every((l) => l.isFortmark === true));
    const ownReq = book.requests.at(-1)!;
    check("office filter is an id match, never a name match",
      (ownReq.params.get("$filter") ?? "").includes(`ListOfficeMlsId eq '${FORTMARK_LIST_OFFICE_MLS_ID}'`) &&
      (ownReq.params.get("$filter") ?? "").includes(`CoListOfficeMlsId eq '${FORTMARK_LIST_OFFICE_MLS_ID}'`) &&
      !(ownReq.params.get("$filter") ?? "").includes("ListOfficeName"));
    const wide = await searchListings(bookCfg, base({ pageSize: 20 }));
    check("MLS-wide rows from other offices are not flagged FortMark",
      wide.items.filter((l) => !["A10000001", "A10000002"].includes(l.mlsNumber)).every((l) => l.isFortmark === false));
    check("a results page carries one thumbnail per row", wide.items.every((l) => l.photos.length <= 1));
    check("a listing excluded from internet display is never shown", !wide.items.some((l) => l.mlsNumber === "A10000009") && !own.items.some((l) => l.mlsNumber === "A10000009"));

    const withheld = wide.items.find((l) => l.mlsNumber === "A10000008");
    check("a withheld address is replaced, not shown", withheld?.address === WITHHELD_ADDRESS && withheld?.addressWithheld === true);
    check("a withheld address drops coordinates and folio", withheld?.coordinates === undefined && withheld?.folioNumber === undefined);

    const n = book.requests.length;
    const detail = await getListing(bookCfg, "k2");
    check("detail photos come from the record's embedded media, in order",
      detail?.photos.join(",") === "https://cdn.example/k2-embedded-1.jpg,https://cdn.example/k2-embedded-2.jpg");
    check("embedded media means no Media resource request", !book.requests.slice(n).some((r) => r.resource === "Media"));
    check("listing office is attributed", detail?.listingOffice?.name === "FortMark, LLC" && detail?.listingOffice?.mlsId === FORTMARK_LIST_OFFICE_MLS_ID);
    check("an excluded listing is not found by id", (await getListing(bookCfg, "k9")) === null);

    const summary = await getFortmarkListingSummary(bookCfg);
    check("FortMark summary counts active FortMark listings server-side", summary.activeCount === 3);
    check("FortMark featured is FortMark's highest-priced active displayable listing", summary.featured?.mlsNumber === "A10000007");
    check("FortMark featured never comes from another office", summary.featured?.isFortmark === true);
  } finally {
    await book.close();
  }
}
{
  const none = await startStub({ Property: [{ ...FULL, ListingKey: "z1", ListingId: "A19999999", StandardStatus: "Active" }], Media: [] });
  try {
    const summary = await getFortmarkListingSummary({ baseUrl: none.baseUrl, dataset: "miamire", token: "t" });
    check("no FortMark listings is a zero count and no featured row, not another office's listing",
      summary.activeCount === 0 && summary.featured === null);
  } finally {
    await none.close();
  }
}

// --- Live-certification invariants (static; 2026-09-23) ----------------------
{
  // No mock mixing: every listings route reaches the sample set only on the
  // branch where the MLS is NOT configured. With Bridge configured, a route
  // either answers from the MLS or fails — it never substitutes generated rows.
  const routes = [
    "app/api/listings/route.ts",
    "app/api/listings/[id]/route.ts",
    "app/api/listings/featured/route.ts",
    "app/api/listings/[id]/comparables/route.ts",
  ];
  for (const file of routes) {
    const full = readFileSync(file, "utf8");
    const src = full.slice(full.indexOf("export async function GET"));
    const gate = src.indexOf("if (!config.ok)");
    const firstSample = src.search(/getSample|searchSample|sampleListingsEnabled\(\)/);
    const tryBlock = src.indexOf("try {", gate);
    check(`${file}: sample rows only inside the not-configured branch`,
      gate > 0 && (firstSample === -1 || (firstSample > gate && firstSample < tryBlock)));
    check(`${file}: an MLS failure is a failure response, not a fallback`, /catch \(error\) \{\s*return failureResponse\(error\)/.test(src));
  }
  const widget = readFileSync("components/home/widgets/featured-listing.tsx", "utf8");
  check("Home says there are no active FortMark listings rather than borrowing another office's",
    widget.includes("No active FortMark listings"));
  check("Home's listing card reads the FortMark summary only", widget.includes("getFortmarkListingSummary") && !widget.includes("searchListings"));
  check("an MLS failure on Home degrades only the listing card", widget.includes("The featured listing failed to load"));
  const search = readFileSync("lib/search/service.ts", "utf8");
  check("⌘K listing hits are built from the sanitised Listing, not a raw record",
    search.includes("title: listing.address") && !search.includes("UnparsedAddress"));
  check("the search listing provider never touches the sample set", !/sample/i.test(search.slice(search.indexOf("async function runListingProvider"), search.indexOf("async function runListingProvider") + 1200)));
}

// Comparables.
  {
    const subject = (await getListing(cfg, "k1"))!;
    const comps = await findComparables(cfg, subject, { months: 6, limit: 10 });
    check("comparables are closed sales of the same type and city", comps.length === 1 && comps[0].mlsNumber === "A10000004");
    check("a sale outside the window is excluded", !comps.some((c) => c.mlsNumber === "A10000005"));
    const req = stub.requests.at(-1)!;
    check("comparables exclude the subject itself", (req.params.get("$filter") ?? "").includes("ListingKey ne 'k1'"));
    check("comparables are most recent first", req.params.get("$orderby") === "CloseDate desc");
    check("an 'other' subject yields no comparables and no request",
      await (async () => { const n = stub.requests.length; const r = await findComparables(cfg, { ...subject, propertyType: "other" }); return r.length === 0 && stub.requests.length === n; })());
  }

  // Failure classification — each is what the routes map to a status.
  stub.mode = "unauthorized";
  check("401 is unauthorized", await searchListings(cfg, base()).then(() => false, (e) => e instanceof BridgeError && e.kind === "unauthorized" && e.status === 401));
  stub.mode = "bad_request";
  check("400 is bad_request", await searchListings(cfg, base()).then(() => false, (e) => e instanceof BridgeError && e.kind === "bad_request"));
  stub.mode = "rate_limited";
  check("429 is rate_limited", await searchListings(cfg, base()).then(() => false, (e) => e instanceof BridgeError && e.kind === "rate_limited"));
  stub.mode = "ok";
  check("a failure message never carries the token",
    await searchListings({ ...cfg, baseUrl: stub.baseUrl }, base({ query: "x" })).then(() => true, (e) => !String(e.message).includes(TOKEN) && !String((e as BridgeError).detail).includes(TOKEN)));
  {
    // An unknown field in a filter is what Bridge 400s on; the stub does the same.
    check("an unknown field is a bad_request",
      await bridgeRequest(cfg, "Property", { $filter: "NotAField eq 'x'" }).then(() => false, (e) => e instanceof BridgeError && e.kind === "bad_request"));
  }
  {
    // A media outage must not take the listing down with it.
    const only = await startStub({ Property: PROPS, Media: [] });
    try {
      const cfgOnly = { ...cfg, baseUrl: only.baseUrl };
      const l = await getListing(cfgOnly, "k1");
      check("no media rows is an empty gallery", l !== null && l.photos.length === 0);
    } finally {
      await only.close();
    }
  }
  {
    const ac = new AbortController();
    ac.abort();
    check("a caller abort is not reported as a Bridge fault",
      await bridgeRequest(cfg, "Property", {}, ac.signal).then(() => false, (e) => !(e instanceof BridgeError)));
  }
} finally {
  await stub.close();
}

// --- Client-side sort (shared by the sample source and the table view) -----
{
  const a = toListing({ ...FULL, ListingKey: "a", ListingId: "A1", DaysOnMarket: 30, ListPrice: 500 })!;
  const b = toListing({ ...FULL, ListingKey: "b", ListingId: "A2", DaysOnMarket: undefined, ListPrice: 900 })!;
  const c = toListing({ ...FULL, ListingKey: "c", ListingId: "A3", DaysOnMarket: 5, ListPrice: 700 })!;
  check("sort by price ascending", sortListings([a, b, c], "listPrice", "asc").map((l) => l.id).join("") === "acb");
  check("sort by price descending", sortListings([a, b, c], "listPrice", "desc").map((l) => l.id).join("") === "bca");
  check("sort tolerates an absent DOM (treated as 0)", sortListings([a, b, c], "daysOnMarket", "asc").map((l) => l.id).join("") === "bca");
  check("sort by status uses display order, not spelling",
    sortListings([{ ...a, status: "closed" }, { ...b, status: "active" }, { ...c, status: "pending" }], "status", "asc").map((l) => l.status).join(",") === "active,pending,closed");
}

// --- Structural: routes and adapter ------------------------------------------
{
  const search = readFileSync("app/api/listings/route.ts", "utf8");
  const detail = readFileSync("app/api/listings/[id]/route.ts", "utf8");
  const comps = readFileSync("app/api/listings/[id]/comparables/route.ts", "utf8");
  const featured = readFileSync("app/api/listings/featured/route.ts", "utf8");
  const source = readFileSync("app/api/listings/source/route.ts", "utf8");
  const http = readFileSync("lib/mls/http.ts", "utf8");
  const adapter = readFileSync("lib/data/adapters/listings.ts", "utf8");
  const config = readFileSync("lib/mls/config.ts", "utf8");
  const bridge = readFileSync("lib/mls/bridge.ts", "utf8");

  for (const [name, src] of [["search", search], ["detail", detail], ["comparables", comps], ["featured", featured], ["source", source]] as const) {
    check(`${name} route authenticates before anything else`,
      src.indexOf("await requireCaller()") < src.indexOf("mlsConfig()") || (name === "source" && src.includes("await requireCaller()")));
    check(`${name} route is dynamic and node`, src.includes('export const dynamic = "force-dynamic"') && src.includes('export const runtime = "nodejs"'));
  }
  for (const [name, src] of [["search", search], ["detail", detail], ["comparables", comps], ["featured", featured]] as const) {
    // The correction at the heart of this release. A route may reach for the
    // generator only when a deployment asked for fixture mode BY NAME. It used
    // to reach for it whenever the MLS flag happened to be off, which made
    // "nobody configured an MLS" indistinguishable from "show me invented
    // properties" — and the second is never what the first meant.
    check(`${name} route serves generated rows only in explicit fixture mode`,
      /if \(sampleListingsEnabled\(\)\)/.test(src) &&
        src.includes("return notConfigured()"));
    check(`${name} route no longer treats an absent MLS as a request for fiction`,
      !/config\.reason === "disabled"/.test(src));
    check(`${name} route never forwards an upstream body`, !/error\.(message|detail)/.test(src));
  }
  check("flag on with a missing credential is 503, never sample rows",
    http.includes("status: 503") && /console\.error\([\s\S]{0,200}missing_token/.test(http));
  check("a rejected credential is logged as ours to fix, without the token",
    /unauthorized[\s\S]{0,300}rejected BRIDGE_API_TOKEN/.test(http) && !/config\.token|\.token\b/.test(http));
  // The adapter is the path that actually served invented properties: the
  // route would 503, but the browser had already been told "sample" and never
  // asked. It must now fail the read instead of reaching for the generator.
  check("the adapter refuses to invent listings when nothing is configured",
    /availableSource\(\)/.test(adapter) &&
      /source === "not_configured"\) throw new ListingsError\("mls_not_configured", 503\)/.test(adapter));
  check("no listing read still consults the raw source directly", (() => {
    const body = adapter.slice(adapter.indexOf("export async function searchListings"));
    return !/await getListingSource\(\)/.test(body);
  })());
  check("the probe reports what can be shown, in the same vocabulary",
    readFileSync("app/api/health/route.ts", "utf8").includes("listings: listingAvailability()") &&
      source.includes("listingAvailability()"));
  check("fixture mode is documented for an operator",
    /^SAMPLE_LISTINGS_ENABLED=$/m.test(readFileSync(".env.example", "utf8")));

  check("an id must be a bounded printable token", detail.includes("ID_SHAPE") && /\{1,64\}/.test(detail));
  check("the MLS module is server-only", config.includes('import "server-only"') && bridge.includes('import "server-only"'));
  check("the credential is never a client value", !config.includes("NEXT_PUBLIC_BRIDGE") && !readFileSync(".env.example", "utf8").includes("NEXT_PUBLIC_BRIDGE"));
  check("the token is sent only as a bearer header", bridge.includes("Authorization: `Bearer ${config.token}`") && !/token=/.test(bridge));
  check("the adapter asks the server which source is live", adapter.includes('"/api/listings/source"'));
  check("the adapter refuses to create a listing in MLS mode", /=== "mls"\)[\s\S]{0,200}throw new Error/.test(adapter));
  check("the adapter reads through the routes in MLS mode", adapter.includes("`/api/listings?${") && adapter.includes("/comparables"));
  check("a 404 is 'not found', not a failure", /status === 404\) return undefined/.test(adapter));
  check("the listings screen labels the sample source", readFileSync("app/(app)/listings/page.tsx", "utf8").includes('data?.source === "sample" && <SampleDataNotice />'));
  check("the detail page labels the sample source", readFileSync("app/(app)/listings/[id]/page.tsx", "utf8").includes('listing.source === "sample" && <SampleDataNotice />'));
  check("an MLS row without a photo never shows a drawn house",
    /source === "sample" \? FALLBACK_PLATE : undefined/.test(readFileSync("components/listings/listing-image.tsx", "utf8")));
  check("the build reports the listings source", /listings MLS_LISTINGS_ENABLED=/.test(readFileSync("scripts/migrate.mjs", "utf8")));
  check("the build never prints the token", !/\$\{process\.env\.BRIDGE_API_TOKEN\}/.test(readFileSync("scripts/migrate.mjs", "utf8")));
  check("the variables are documented by name only", /^BRIDGE_API_TOKEN=$/m.test(readFileSync(".env.example", "utf8")) && /^MLS_LISTINGS_ENABLED=$/m.test(readFileSync(".env.example", "utf8")));
}

// --- Summary -----------------------------------------------------------------
const total = passed + failures.length;
console.log(`\n${passed}/${total} MLS checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
