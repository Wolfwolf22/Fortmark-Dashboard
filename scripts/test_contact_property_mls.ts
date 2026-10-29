/** Exact MLS sync against synthetic responses. No live settings or network. */
import assert from "node:assert/strict";
import { AmbiguousMlsNumberError, getListingByMlsNumber } from "../lib/mls/service.ts";
import { contactPropertyMlsProvider } from "../lib/contacts/property-mls.ts";
import type { BridgeConfig } from "../lib/mls/config.ts";
let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const config: BridgeConfig = { baseUrl: "https://example.test/odata", dataset: "synthetic", token: "synthetic-only" };
const raw = (extra: Record<string, unknown> = {}) => ({ ListingKey: "synthetic-property-key", ListingId: "A12345678", InternetEntireListingDisplayYN: true,
  InternetAddressDisplayYN: true, UnparsedAddress: "123 Synthetic Avenue", City: "Sample City", PostalCode: "00000", PropertyType: "Residential",
  PropertySubType: "Condominium", StandardStatus: "Active", ListPrice: 620000, BedroomsTotal: 2, BathroomsTotalInteger: 2, LivingArea: 1300,
  ListOfficeName: "Synthetic Listing Office", Media: [], ...extra });
const originalFetch = globalThis.fetch;
const requests: URL[] = [];
let response: Record<string, unknown> = { value: [raw()] };
let status = 200;
globalThis.fetch = async (input) => { requests.push(new URL(String(input))); return new Response(JSON.stringify(response), { status, headers: { "Content-Type": "application/json" } }); };
try {
  const first = await getListingByMlsNumber(config, "  a12345678  ");
  check("exact lookup resolves entered normalized MLS number", first?.id === "synthetic-property-key" && first.mlsNumber === "A12345678");
  check("embedded empty media requires just one request", requests.length === 1 && first.photos.length === 0);
  const filter = requests[0].searchParams.get("$filter")!;
  check("lookup is exact on ListingId and obeys display permission", filter.includes("ListingId eq 'A12345678'") && filter.includes("InternetEntireListingDisplayYN eq true"));
  check("manual research is not narrowed by property type or active status", !filter.includes("PropertyType") && !filter.includes("StandardStatus"));
  check("lookup detects ambiguity with bounded two-row request", requests[0].searchParams.get("$top") === "2");
  check("MLS office attribution survives sync", first.listingOffice?.name === "Synthetic Listing Office");
  check("credentials are never query parameters", !String(requests[0]).includes(config.token));
  const calls = requests.length;
  check("injection is refused before network", await getListingByMlsNumber(config, "A123' or true") === null && requests.length === calls);
  check("blank identifier is refused before network", await getListingByMlsNumber(config, " ") === null && requests.length === calls);
  check("non-number research text is refused", await getListingByMlsNumber(config, "SAMPLE") === null && requests.length === calls);
  response = { value: [raw({ ListingId: "000123" })] };
  check("numeric MLS numbers retain leading zeroes", (await getListingByMlsNumber(config, "000123"))?.mlsNumber === "000123" && requests.at(-1)!.searchParams.get("$filter")?.includes("'000123'"));
  response = { value: [raw({ ListingId: "RX-12345678", PropertyType: "Residential Lease", StandardStatus: "Closed", ListPrice: 3500 })] };
  const lease = await getListingByMlsNumber(config, "rx-12345678");
  check("manual lease/closed lookup retains actual price and status", lease?.mlsNumber === "RX-12345678" && lease.status === "closed" && lease.listPrice === 3500);
  response = { value: [] };
  check("valid empty response means not found", await getListingByMlsNumber(config, "A12345678") === null);
  response = { value: [raw(), raw({ ListingKey: "different-key" })] };
  let ambiguous = false; try { await getListingByMlsNumber(config, "A12345678"); } catch (error) { ambiguous = error instanceof AmbiguousMlsNumberError; }
  check("ambiguous number never picks the first property", ambiguous);
  response = { value: [raw({ ListingId: "DIFFERENT123" })] };
  check("nonconforming upstream cannot attach a different MLS number", await getListingByMlsNumber(config, "A12345678") === null);
  response = { value: [raw({ InternetEntireListingDisplayYN: false })] };
  check("nondisplayable record is never exposed", await getListingByMlsNumber(config, "A12345678") === null);
  response = { value: [raw({ InternetAddressDisplayYN: false, Latitude: 25, Longitude: -80 })] };
  const withheld = await getListingByMlsNumber(config, "A12345678");
  check("address withholding survives contact lookup", withheld?.addressWithheld && !withheld.address.includes("123 Synthetic") && !withheld.coordinates);
  let contextLoads = 0;
  const provider = contactPropertyMlsProvider(config, async () => { contextLoads++; return {}; });
  response = { value: [raw()] };
  const looked = await provider.lookup("A12345678");
  check("provider returns dataset identity with MLS row", looked.ok && looked.value.dataset === "synthetic" && looked.value.listing.source === "mls");
  response = { value: [raw({ ListPrice: 599000, StandardStatus: "Pending" })] };
  const refreshed = await provider.get("synthetic", "synthetic-property-key", "A12345678");
  check("saved property gets current MLS price and status", refreshed.ok && refreshed.value.listing.listPrice === 599000 && refreshed.value.listing.status === "pending");
  check("request scope shares one resolved caller context", contextLoads === 1);
  const beforeDifferentDataset = requests.length;
  const differentDataset = await provider.get("another", "synthetic-property-key", "A12345678");
  check("changed dataset does not cross-feed the saved reference", !differentDataset.ok && differentDataset.reason === "not_configured" && requests.length === beforeDifferentDataset);
  response = { value: [raw({ ListingId: "A87654321" })] };
  const changedNumber = await provider.get("synthetic", "synthetic-property-key", "A12345678");
  check("refresh cannot substitute a different MLS identity", !changedNumber.ok && changedNumber.reason === "not_found");
  response = { value: [raw({ ListingKey: "another-key" })] };
  const changedKey = await provider.get("synthetic", "synthetic-property-key", "A12345678");
  check("refresh cannot substitute a different durable key", !changedKey.ok && changedKey.reason === "not_found");
  status = 503; response = { error: "synthetic upstream detail" };
  const unavailable = await provider.lookup("A12345678");
  check("outage is unavailable, not empty or generated data", !unavailable.ok && unavailable.reason === "unavailable");
  check("upstream detail never leaves provider", !JSON.stringify(unavailable).includes("synthetic upstream detail"));
  status = 200; response = {};
  const malformed = await provider.lookup("A12345678");
  check("malformed successful payload is unavailable rather than no match", !malformed.ok && malformed.reason === "unavailable");
  response = { value: [raw(), raw({ ListingKey: "another-key" })] };
  const duplicate = await provider.lookup("A12345678");
  check("ambiguity is an explicit reviewable answer", !duplicate.ok && duplicate.reason === "ambiguous");
  let missingContextLoads = 0;
  const missing = contactPropertyMlsProvider(null, async () => { missingContextLoads++; return {}; });
  const beforeMissing = requests.length;
  const unconfigured = await missing.lookup("A12345678");
  check("missing MLS is explicit and never sample data", !unconfigured.ok && unconfigured.reason === "not_configured");
  check("unconfigured source performs no context or MLS access", missingContextLoads === 0 && requests.length === beforeMissing);
  console.log(`${passed}/${passed} contact property MLS checks passed (synthetic fetch; no live access)`);
} finally { globalThis.fetch = originalFetch; }
