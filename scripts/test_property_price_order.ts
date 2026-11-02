/** Whole-list price ordering over bounded synthetic MLS reads. Never contacts a live feed. */
import assert from "node:assert/strict";
import { contactPropertyMlsProvider } from "../lib/contacts/property-mls.ts";
import { getListingPrices } from "../lib/mls/service.ts";
let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const config = { baseUrl: "https://example.test/odata", dataset: "synthetic", token: "synthetic-token" };
const originalFetch = globalThis.fetch;
const requests: URL[] = [];
let records: Record<string, unknown>[] = [], active = 0, peak = 0, failedStatus = 0;
globalThis.fetch = async (input) => {
  const url = new URL(String(input)); requests.push(url); active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 2)); active--;
  if (failedStatus) return new Response("synthetic upstream failure", { status: failedStatus });
  const filter = url.searchParams.get("$filter") ?? "";
  const value = records.filter(row => filter.includes(`ListingKey eq '${String(row.ListingKey).replace(/'/g, "''")}'`));
  return new Response(JSON.stringify({ value }), { headers: { "Content-Type": "application/json" } });
};
try {
  const refs = Array.from({ length: 181 }, (_, index) => ({ id: `membership-${index}`, dataset: "synthetic", listingId: `property-${index}` }));
  records = refs.map((row, index) => ({ ListingKey: row.listingId, ListPrice: (181 - index) * 1000, StandardStatus: "Active", InternetEntireListingDisplayYN: true }));
  let contextLoads = 0;
  const provider = contactPropertyMlsProvider(config, async () => { contextLoads++; return {}; });
  const ascending = await provider.orderByPrice!(refs, "asc");
  check("whole list sorts across all upstream batches, including later pages", ascending.ok && ascending.ids[0] === "membership-180" && ascending.ids.at(-1) === "membership-0");
  check("ordering returns every membership exactly once", ascending.ok && ascending.ids.length === refs.length && new Set(ascending.ids).size === refs.length);
  check("fresh price read is bounded to forty keys per call", requests.length === 5 && requests.every(url => Number(url.searchParams.get("$top")) <= 40));
  check("price read concurrency is fixed at four", peak === 4);
  check("only price fields are requested, with no photo hydration", requests.every(url => url.searchParams.get("$select") === "ListingKey,ListPrice,ClosePrice,StandardStatus,InternetEntireListingDisplayYN"));
  check("price ordering always enforces display permission", requests.every(url => url.searchParams.get("$filter")?.includes("InternetEntireListingDisplayYN eq true")));
  check("membership identifiers and credential never go to the MLS URL", requests.every(url => !String(url).includes("membership-") && !String(url).includes(config.token)));
  check("ordering does not depend on unrelated caller profile metadata", contextLoads === 0);
  const descending = await provider.orderByPrice!(refs, "desc");
  check("descending order is global rather than reversing a displayed page", descending.ok && descending.ids[0] === "membership-0" && descending.ids.at(-1) === "membership-180");
  records[0].ListPrice = 500;
  const refreshed = await provider.orderByPrice!(refs, "asc");
  check("a subsequent sort uses the refreshed MLS price", refreshed.ok && refreshed.ids[0] === "membership-0");
  const cases = [
    { id: "closed", dataset: "synthetic", listingId: "closed-key" }, { id: "active", dataset: "synthetic", listingId: "active-key" },
    { id: "hidden", dataset: "synthetic", listingId: "hidden-key" }, { id: "missing", dataset: "synthetic", listingId: "missing-key" },
    { id: "stale-dataset", dataset: "previous", listingId: "closed-key" }, { id: "zero", dataset: "synthetic", listingId: "zero-key" },
  ];
  records = [
    { ListingKey: "closed-key", ListPrice: 999, ClosePrice: 100, StandardStatus: "Closed", InternetEntireListingDisplayYN: true },
    { ListingKey: "active-key", ListPrice: 300, ClosePrice: 50, StandardStatus: "Active", InternetEntireListingDisplayYN: true },
    { ListingKey: "hidden-key", ListPrice: 1, InternetEntireListingDisplayYN: false },
    { ListingKey: "zero-key", ListPrice: 0, InternetEntireListingDisplayYN: true },
  ];
  const knownFirst = await provider.orderByPrice!(cases, "asc");
  check("closed listings sort by their displayed sold price", knownFirst.ok && knownFirst.ids.slice(0, 2).join() === "closed,active");
  check("missing, hidden, old-dataset and unknown prices remain last in stable order", knownFirst.ok && knownFirst.ids.slice(2).join() === "hidden,missing,stale-dataset,zero");
  const highFirst = await provider.orderByPrice!(cases, "desc");
  check("unknown prices remain last in descending order too", highFirst.ok && highFirst.ids.join() === "active,closed,hidden,missing,stale-dataset,zero");
  const calls = requests.length;
  check("empty list performs no MLS request", (await provider.orderByPrice!([], "asc")).ok && requests.length === calls);
  const duplicateId = await provider.orderByPrice!([cases[0], cases[0]], "asc");
  check("duplicate membership identities are refused before MLS access", !duplicateId.ok && requests.length === calls);
  const overLimit = await provider.orderByPrice!(Array.from({ length: 1001 }, (_, index) => ({ id: `limit-${index}`, dataset: "synthetic", listingId: `key-${index}` })), "asc");
  check("oversized ordering fails explicitly without a partial order", !overLimit.ok && requests.length === calls);
  const missingSource = await contactPropertyMlsProvider(null, async () => ({})).orderByPrice!(cases, "asc");
  check("missing configuration is distinct from an empty sorted result", !missingSource.ok && missingSource.reason === "not_configured");
  failedStatus = 503;
  const unavailable = await provider.orderByPrice!(cases, "asc");
  check("an upstream outage never returns a guessed price order", !unavailable.ok && unavailable.reason === "unavailable");
  failedStatus = 0;
  records = [{ ListingKey: "quote' or true", ListPrice: 100, InternetEntireListingDisplayYN: true }];
  const escaped = await getListingPrices(config, ["quote' or true"]);
  check("listing-key quotes remain escaped string values", escaped.get("quote' or true") === 100 && requests.at(-1)!.searchParams.get("$filter")?.includes("ListingKey eq 'quote'' or true'"));
  records.push({ ...records[0], ListPrice: 200 }); let ambiguous = false;
  try { await getListingPrices(config, ["quote' or true"]); } catch { ambiguous = true; }
  check("ambiguous upstream keys cannot silently pick a price", ambiguous);
  console.log(`${passed}/${passed} property price-order checks passed (synthetic MLS; no live access)`);
} finally { globalThis.fetch = originalFetch; }
