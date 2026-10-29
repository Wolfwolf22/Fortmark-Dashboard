import "server-only";

import { callerListingContext } from "../mls-identity/listing-context.ts";
import { resolveBridgeConfig, type BridgeConfig } from "../mls/config.ts";
import type { ListingContext } from "../mls/normalize.ts";
import { AmbiguousMlsNumberError, getListing, getListingByMlsNumber } from "../mls/service.ts";
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
