import "server-only";
import { contactPropertyMlsProvider } from "../contacts/property-mls.ts";
import type { PropertyMlsProvider, PropertyResolution } from "../contacts/properties.ts";
import { callerListingContext } from "../mls-identity/listing-context.ts";
import { bridgeRequest } from "../mls/bridge.ts";
import { resolveBridgeConfig, type BridgeConfig } from "../mls/config.ts";
import { toListing, type ListingContext, type ResoRecord } from "../mls/normalize.ts";
import { andFilters, eq } from "../mls/odata.ts";
import { DISPLAYABLE } from "../mls/service.ts";

/** Optional financial enrichment never adds unverified fields to the global MLS projection. */
export function transactionPropertyMlsProvider(config: BridgeConfig | null, loadContext: () => Promise<ListingContext>, signal?: AbortSignal, options: { baseProvider?: PropertyMlsProvider; request?: typeof bridgeRequest } = {}): PropertyMlsProvider {
  let context: Promise<ListingContext> | undefined;
  const currentContext = () => context ??= loadContext(), base = options.baseProvider ?? contactPropertyMlsProvider(config, currentContext, signal), request = options.request ?? bridgeRequest;
  async function enrich(result: PropertyResolution): Promise<PropertyResolution> {
    if (!result.ok || !config) return result;
    const { listing, dataset } = result.value;
    if (dataset !== config.dataset) return { ok: false, reason: "not_configured" };
    try {
      // Omitting $select asks only for fields the dataset actually publishes.
      const response = await request<ResoRecord>(config, "Property", { $filter: andFilters([DISPLAYABLE, eq("ListingKey", listing.id), eq("ListingId", listing.mlsNumber)]), $top: 2 }, signal);
      if (!response.value.length) return { ok: false, reason: "not_found" };
      if (response.value.length !== 1) return { ok: false, reason: "ambiguous" };
      const record = response.value[0];
      if (!record || typeof record !== "object" || String(record.ListingKey ?? "") !== listing.id || String(record.ListingId ?? "").trim().toUpperCase() !== listing.mlsNumber.trim().toUpperCase()) return { ok: false, reason: "unavailable" };
      const display = record.InternetEntireListingDisplayYN;
      if (display !== true && !(typeof display === "string" && /^(true|y|yes)$/i.test(display.trim()))) return { ok: false, reason: "not_found" };
      const fresh = toListing(record, listing.photos, await currentContext());
      return fresh ? { ok: true, value: { dataset, listing: { ...fresh, financialsStatus: fresh.annualTaxAmount !== undefined || fresh.taxYear !== undefined || fresh.associationFee !== undefined || fresh.associationFeeFrequency !== undefined ? "available" : "not_published" } } } : { ok: false, reason: "not_found" };
    } catch { return { ok: true, value: { dataset, listing: { ...listing, financialsStatus: "unavailable" } } }; }
  }
  return { lookup: async number => enrich(await base.lookup(number)), get: async (dataset, id, number) => enrich(await base.get(dataset, id, number)) };
}
/** Construction is inert; parent authorization always happens before a provider method is called. */
export function createTransactionPropertyMlsProvider(clerkUserId: string, signal?: AbortSignal): PropertyMlsProvider {
  const config = resolveBridgeConfig();
  return transactionPropertyMlsProvider(config.ok ? config.config : null, async () => { const ctx = await callerListingContext(clerkUserId); return { brokerageOfficeId: ctx.officeId, memberKey: ctx.identity.ok ? ctx.identity.memberKey : null }; }, signal);
}
