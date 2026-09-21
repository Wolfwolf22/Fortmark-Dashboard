import "server-only";

/**
 * Unified search.
 *
 * One question asked of every domain that can answer it, with the answers
 * normalised into one shape and ordered by one explainable rule.
 *
 * Three properties matter more than anything else here.
 *
 * **Every provider enforces its own authorization.** Nothing is fetched and
 * then filtered: each domain query carries the same `visibleTo` predicate its
 * list screen uses, so an unauthorized row is never loaded, never counted and
 * never cached. Scope comes from the verified session, never from the request.
 *
 * **Providers fail independently.** A broken MLS integration must not delete
 * the contacts a user was typing towards. Each provider reports its own
 * availability, and the orchestrator returns whatever succeeded alongside an
 * honest account of what did not.
 *
 * **It knows nothing about the browser.** No React, no route handler, no
 * component. That is deliberate: the same providers are what a server-side AI
 * tool will call in Phase F to work out which client "Jane" refers to, and it
 * must be able to do so without importing a command palette.
 */
import { resolveActor as resolveBrokerageActor, type Actor } from "../auth/actor.ts";
import type { Db } from "../db/client.ts";
import { contactsDatabaseEnabled, transactionsDatabaseEnabled, type EnvLike } from "../flags.ts";
import { resolveBridgeConfig } from "../mls/config.ts";
import { searchListings } from "../mls/service.ts";
import { searchContacts } from "../contacts/search.ts";
import { searchTransactions } from "../transactions/search.ts";
import { parseQuery, type ParsedQuery } from "./query.ts";
import { rankHits } from "./rank.ts";
import {
  MIN_QUERY_LENGTH,
  MIN_REMOTE_QUERY_LENGTH,
  PROVIDER_LIMIT,
  type ProviderAvailability,
  type ProviderStates,
  type SearchHit,
  type SearchResponse,
} from "./types.ts";

type Ctx = { actor: Actor; db: Db };

/** One provider's outcome: what it found, and whether it could look. */
interface ProviderResult {
  availability: ProviderAvailability;
  hits: SearchHit[];
  /** True when the provider had more matches than its cap allowed. */
  more: boolean;
}

const NOTHING = (availability: ProviderAvailability): ProviderResult => ({
  availability,
  hits: [],
  more: false,
});

/**
 * Why a domain cannot be searched, in the same vocabulary Home uses.
 *
 * `disabled` is a deployment that has not connected this domain;
 * `no_identity` is a caller whose profile has not synced yet; anything else is
 * a database that could not be reached. Three different sentences, kept apart.
 */
function unavailableReason(
  reason: "disabled" | "unavailable" | "no_identity"
): ProviderAvailability {
  if (reason === "disabled") return "not_configured";
  if (reason === "no_identity") return "not_permitted";
  return "unavailable";
}

/**
 * Run one database provider.
 *
 * It asks for one row more than the cap so "there are more" is known without a
 * second counting query, then trims. A thrown query becomes `unavailable` —
 * never an empty result, which would tell the user their brokerage has no
 * matching clients when in truth nobody looked.
 */
async function runDatabaseProvider(
  enabled: boolean,
  clerkUserId: string,
  query: ParsedQuery,
  run: (ctx: Ctx, query: ParsedQuery, limit: number) => Promise<SearchHit[]>
): Promise<ProviderResult> {
  const resolved = await resolveBrokerageActor(clerkUserId, enabled);
  if (!resolved.ok) return NOTHING(unavailableReason(resolved.reason));
  try {
    const hits = await run(
      { actor: resolved.actor, db: resolved.db },
      query,
      PROVIDER_LIMIT + 1
    );
    return {
      availability: "available",
      hits: hits.slice(0, PROVIDER_LIMIT),
      more: hits.length > PROVIDER_LIMIT,
    };
  } catch {
    return NOTHING("unavailable");
  }
}

/**
 * Listings.
 *
 * Reached over the network and billed per call, so it is held to a longer
 * minimum query than the local providers: two characters is a reasonable
 * thing to ask a database and a wasteful thing to ask an MLS on every
 * keystroke. Not configured stays `not_configured`; a failing call stays
 * `unavailable`. Neither is ever an empty list of listings, which would state
 * as fact that the market holds nothing matching.
 */
async function runListingProvider(env: EnvLike, query: ParsedQuery): Promise<ProviderResult> {
  const config = resolveBridgeConfig(env);
  if (!config.ok) return NOTHING("not_configured");
  if (query.text.length < MIN_REMOTE_QUERY_LENGTH) return NOTHING("available");
  try {
    const page = await searchListings(config.config, {
      query: query.text,
      page: 1,
      pageSize: PROVIDER_LIMIT,
      sortKey: "listedDate",
      sortDirection: "desc",
    });
    return {
      availability: "available",
      hits: page.items.map((listing) => ({
        id: listing.id,
        entity: "listing" as const,
        title: listing.address,
        subtitle: [listing.city, listing.status].filter(Boolean).join(" · "),
        meta: listing.mlsNumber ? `MLS ${listing.mlsNumber}` : undefined,
        href: `/listings/${encodeURIComponent(listing.id)}`,
        match: query.shape === "mls" ? ("exact_mls" as const) : ("partial" as const),
      })),
      more: page.total > PROVIDER_LIMIT,
    };
  } catch {
    return NOTHING("unavailable");
  }
}

export interface SearchOptions {
  env?: EnvLike;
}

/**
 * Search everything this caller may see.
 *
 * `clerkUserId` comes from the verified session. No brokerage id, agent id or
 * scope of any kind is accepted from the request — the only input is text.
 */
export async function search(
  clerkUserId: string,
  rawQuery: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const env = options.env ?? process.env;
  const query = parseQuery(rawQuery);

  // Too short to mean anything. The providers are not woken, and the palette
  // shows commands instead — which is the useful thing to show at one letter.
  if (query.text.length < MIN_QUERY_LENGTH) {
    return {
      query: query.text,
      hits: [],
      providers: idleProviders(env),
      truncated: false,
    };
  }

  const [contactResult, transactionResult, listingResult] = await Promise.all([
    runDatabaseProvider(contactsDatabaseEnabled(env), clerkUserId, query, searchContacts),
    runDatabaseProvider(transactionsDatabaseEnabled(env), clerkUserId, query, searchTransactions),
    runListingProvider(env, query),
  ]);

  return {
    query: query.text,
    hits: rankHits([...contactResult.hits, ...transactionResult.hits, ...listingResult.hits]),
    providers: {
      contact: contactResult.availability,
      transaction: transactionResult.availability,
      listing: listingResult.availability,
      // No per-agent destination exists to navigate to yet, so the provider is
      // declared and unbuilt rather than faked against the sample roster.
      agent: "not_configured",
    },
    truncated: contactResult.more || transactionResult.more || listingResult.more,
  };
}

/**
 * What the providers would have been, without asking them.
 *
 * Reported for a too-short query so the palette can already say "the MLS is
 * not connected" before the user has typed enough to search.
 */
function idleProviders(env: EnvLike): ProviderStates {
  return {
    contact: contactsDatabaseEnabled(env) ? "available" : "not_configured",
    transaction: transactionsDatabaseEnabled(env) ? "available" : "not_configured",
    listing: resolveBridgeConfig(env).ok ? "available" : "not_configured",
    agent: "not_configured",
  };
}
