/**
 * Listings adapter — the browser's view of the listing domain.
 *
 * The server decides what this deployment can show and this module asks it
 * once. In `mls` mode every read is a call to the listings routes, which
 * resolve filtering, sorting and paging upstream and return one page. In
 * `sample` mode — which a deployment switches on by name — the same contract
 * is served locally so quick-create's in-memory rows still appear. Components
 * see one shape either way, and every row carries the `source` it came from.
 *
 * The third state is the one this file used to get wrong. `not_configured`
 * means there is no MLS and no fixture mode, and it now fails the read. It
 * used to be indistinguishable from `sample` here, so a deployment that had
 * simply never been given a Bridge credential answered every listing read
 * from the generator — invented addresses, invented prices, invented
 * photographs — with nothing on the screen or in the payload marking them as
 * fiction. A missing integration is not a licence to make properties up.
 */
import { apiPath } from "@/lib/routes";
import { toSearchParams } from "@/lib/mls/query";
import {
  createSampleListing,
  getSampleComparables,
  getSampleFeaturedListing,
  getSampleListing,
  searchSampleListings,
} from "../sample-listings";
import type { ListingAvailability } from "@/lib/mls/config";
import type { Listing, ListingPage, ListingSearchQuery } from "../types";
import { delay } from "./latency";

/** A failed read, carrying the server's coarse reason for the UI to name. */
export class ListingsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`Listings request failed (${status}: ${code})`);
    this.name = "ListingsError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), { ...init, headers: { Accept: "application/json" } });
  if (!response.ok) {
    let code = "unknown";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // A non-JSON failure body is still a failure; the status says enough.
    }
    throw new ListingsError(code, response.status);
  }
  return (await response.json()) as T;
}

let sourcePromise: Promise<ListingAvailability> | null = null;

/**
 * Which source is live. Asked once per page load; a failure to ask (a
 * signed-out tab, a network blip) is not cached, so the next read retries.
 */
export function getListingSource(): Promise<ListingAvailability> {
  if (!sourcePromise) {
    sourcePromise = request<{ source: ListingAvailability }>("/api/listings/source")
      .then((r) => r.source)
      .catch((error) => {
        sourcePromise = null;
        throw error;
      });
  }
  return sourcePromise;
}

/**
 * What this deployment can show, refusing the state that has nothing to show.
 *
 * Returning an empty page for `not_configured` would be its own falsehood —
 * "the market holds nothing matching" is a claim, and nobody looked. The read
 * fails instead, and the screens name the reason.
 */
async function availableSource(): Promise<"mls" | "sample"> {
  const source = await getListingSource();
  if (source === "not_configured") throw new ListingsError("mls_not_configured", 503);
  return source;
}

export async function searchListings(query: ListingSearchQuery): Promise<ListingPage> {
  if ((await availableSource()) === "sample") {
    await delay();
    return searchSampleListings(query);
  }
  return request<ListingPage>(`/api/listings?${toSearchParams(query).toString()}`);
}

export async function getListing(id: string): Promise<Listing | undefined> {
  if ((await availableSource()) === "sample") {
    await delay(120);
    return getSampleListing(id);
  }
  try {
    const { listing } = await request<{ listing: Listing }>(`/api/listings/${encodeURIComponent(id)}`);
    return listing;
  } catch (error) {
    // Not found is an answer, not a failure: the page shows its own empty
    // state for it. Anything else is a real failure and is thrown.
    if (error instanceof ListingsError && error.status === 404) return undefined;
    throw error;
  }
}

/**
 * Home's listing card, by role (decided server-side):
 *   `fortmark`  broker/admin/coordinator — FortMark's active book by office id
 *   `mine`      an agent — their own listings and co-listings by MLS member
 * `activeCount` is undefined for the sample set, and when the scope cannot be
 * resolved (office not configured, MLS identity not linked) — never zero.
 */
export type FortmarkOfficeState = "configured" | "not_configured" | "unavailable";

export interface HomeListingSummary {
  scope: "fortmark" | "mine" | undefined;
  listing: Listing | undefined;
  activeCount: number | undefined;
  /** FortMark scope: whether FortMark's MLS office is configured. */
  office: FortmarkOfficeState | undefined;
  /** Mine scope: the caller's MLS identity state (`linked` when usable). */
  identity: string | undefined;
}

export async function getFortmarkListingSummary(): Promise<HomeListingSummary> {
  if ((await availableSource()) === "sample") {
    await delay(120);
    return { scope: undefined, listing: getSampleFeaturedListing(), activeCount: undefined, office: undefined, identity: undefined };
  }
  const body = await request<{
    scope?: "fortmark" | "mine";
    listing: Listing | null;
    activeCount?: number | null;
    fortmarkActiveCount?: number | null;
    office?: FortmarkOfficeState;
    identity?: string;
  }>("/api/listings/featured");
  const count = typeof body.activeCount === "number" ? body.activeCount : body.fortmarkActiveCount;
  return {
    scope: body.scope ?? "fortmark",
    listing: body.listing ?? undefined,
    activeCount: typeof count === "number" ? count : undefined,
    office: body.office,
    identity: body.identity,
  };
}

/** Which scope the Listings screen opens with, and whether My Listings works. */
export interface ListingScopeInfo {
  defaultScope: "mine" | "fortmark" | "mls";
  myListings: string;
  fortmarkOffice: FortmarkOfficeState;
}

export async function getListingScopeInfo(): Promise<ListingScopeInfo | null> {
  try {
    const body = await request<{
      source: ListingAvailability;
      defaultScope?: ListingScopeInfo["defaultScope"];
      myListings?: string;
      fortmarkOffice?: FortmarkOfficeState;
    }>("/api/listings/source");
    if (body.source !== "mls" || !body.defaultScope) return null;
    return {
      defaultScope: body.defaultScope,
      myListings: body.myListings ?? "unavailable",
      fortmarkOffice: body.fortmarkOffice ?? "unavailable",
    };
  } catch {
    return null;
  }
}

/** The featured card on Home. */
export async function getFeaturedListing(): Promise<Listing | undefined> {
  return (await getFortmarkListingSummary()).listing;
}

/** Closed sales comparable to a listing, most recent first. */
export async function getComparables(id: string): Promise<Listing[]> {
  if ((await availableSource()) === "sample") {
    await delay(150);
    const subject = getSampleListing(id);
    return subject ? getSampleComparables(subject) : [];
  }
  const { items } = await request<{ items: Listing[] }>(
    `/api/listings/${encodeURIComponent(id)}/comparables`
  );
  return items;
}

/**
 * Quick-create. Only the fixture set accepts new rows — the MLS is the
 * brokerage's listing system and this dashboard does not write to it, and a
 * deployment with no listing source has nowhere to put one.
 */
export async function createListing(
  input: Pick<Listing, "address" | "city" | "listPrice" | "propertyType" | "beds" | "baths" | "sqft">
): Promise<Listing> {
  if ((await availableSource()) === "mls") {
    throw new Error(
      "Listings come from the MLS. Enter a new listing in the MLS and it will appear here."
    );
  }
  await delay(220);
  return createSampleListing(input);
}
