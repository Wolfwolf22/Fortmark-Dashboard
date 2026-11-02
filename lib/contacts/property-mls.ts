import "server-only";

import { callerListingContext } from "../mls-identity/listing-context.ts";
import { resolveBridgeConfig, type BridgeConfig } from "../mls/config.ts";
import type { ListingContext } from "../mls/normalize.ts";
import { AmbiguousMlsNumberError, getListing, getListingByMlsNumber, getListingPrices } from "../mls/service.ts";
import type { PropertyMlsProvider, PropertyResolution } from "./properties.ts";

/** Request-scoped provider. No MLS or identity access occurs before a scoped service calls it. */
export function contactPropertyMlsProvider(
  config: BridgeConfig | null,
  loadContext: () => Promise<ListingContext>,
  signal?: AbortSignal,
): PropertyMlsProvider {
  let context: Promise<ListingContext> | undefined;
  const currentContext = () => context ??= loadContext();
  async function resolve(mlsNumber: string, listingId?: string): Promise<PropertyResolution> {
    if (!config) return { ok: false, reason: "not_configured" };
    try {
      const ctx = await currentContext();
      const listing = listingId
        ? await getListing(config, listingId, signal, ctx)
        : await getListingByMlsNumber(config, mlsNumber, signal, ctx);
      if (!listing || listing.source !== "mls" || listing.mlsNumber.trim().toUpperCase() !== mlsNumber.trim().toUpperCase()
        || listingId && listing.id !== listingId) return { ok: false, reason: "not_found" };
      return { ok: true, value: { dataset: config.dataset, listing } };
    } catch (error) {
      // No upstream response, credential, contact id or query is logged or returned.
      return { ok: false, reason: error instanceof AmbiguousMlsNumberError ? "ambiguous" : "unavailable" };
    }
  }
  return {
    lookup: (number) => resolve(number),
    get: (dataset, id, number) => !config || dataset !== config.dataset
      ? Promise.resolve({ ok: false as const, reason: "not_configured" as const })
      : resolve(number, id),
    async orderByPrice(refs, direction) {
      if (!config) return { ok: false as const, reason: "not_configured" as const };
      if (refs.length > 1000 || new Set(refs.map(row => row.id)).size !== refs.length) return { ok: false as const, reason: "unavailable" as const };
      const keys = [...new Set(refs.filter(row => row.dataset === config.dataset).map(row => row.listingId))];
      const batches = Array.from({ length: Math.ceil(keys.length / 40) }, (_, index) => keys.slice(index * 40, (index + 1) * 40));
      const prices = new Map<string, number>();
      let next = 0, failed = false;
      try {
        await Promise.all(Array.from({ length: Math.min(4, batches.length) }, async () => {
          while (next < batches.length && !failed) {
            const index = next++;
            try { for (const [key, price] of await getListingPrices(config, batches[index], signal)) prices.set(key, price); }
            catch (error) { failed = true; throw error; }
          }
        }));
        const ordered = refs.map((row, index) => ({ id: row.id, index, price: row.dataset === config.dataset ? prices.get(row.listingId) : undefined }));
        ordered.sort((a, b) => a.price === undefined ? b.price === undefined ? a.index - b.index : 1 : b.price === undefined ? -1 : (direction === "asc" ? a.price - b.price : b.price - a.price) || a.index - b.index);
        return { ok: true as const, ids: ordered.map(row => row.id) };
      } catch { return { ok: false as const, reason: "unavailable" as const }; }
    },
  };
}

/** Uses the dashboard's existing authenticated MLS connection. Samples are never saved as live data. */
export function createContactPropertyMlsProvider(clerkUserId: string, signal?: AbortSignal): PropertyMlsProvider {
  const config = resolveBridgeConfig();
  return contactPropertyMlsProvider(config.ok ? config.config : null, async () => {
    const ctx = await callerListingContext(clerkUserId);
    return { brokerageOfficeId: ctx.officeId, memberKey: ctx.identity.ok ? ctx.identity.memberKey : null };
  }, signal);
}
