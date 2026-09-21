/**
 * Listings adapter — the browser's view of the listing domain.
 *
 * The server decides the source (MLS or the labelled sample set) and this
 * module asks it once. In `mls` mode every read is a call to the listings
 * routes, which resolve filtering, sorting and paging upstream and return one
 * page. In `sample` mode the same contract is served locally so quick-create's
 * in-memory rows still appear. Components see one shape either way, and every
 * row carries the `source` it came from.
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
import type { Listing, ListingPage, ListingSearchQuery, ListingSource } from "../types";
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

let sourcePromise: Promise<ListingSource> | null = null;

/**
 * Which source is live. Asked once per page load; a failure to ask (a
 * signed-out tab, a network blip) is not cached, so the next read retries.
 */
export function getListingSource(): Promise<ListingSource> {
  if (!sourcePromise) {
    sourcePromise = request<{ source: ListingSource }>("/api/listings/source")
      .then((r) => r.source)
      .catch((error) => {
        sourcePromise = null;
        throw error;
      });
  }
  return sourcePromise;
}

export async function searchListings(query: ListingSearchQuery): Promise<ListingPage> {
  if ((await getListingSource()) === "sample") {
    await delay();
    return searchSampleListings(query);
  }
  return request<ListingPage>(`/api/listings?${toSearchParams(query).toString()}`);
}

export async function getListing(id: string): Promise<Listing | undefined> {
  if ((await getListingSource()) === "sample") {
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

/** The featured card on Home: highest-priced active listing. */
export async function getFeaturedListing(): Promise<Listing | undefined> {
  if ((await getListingSource()) === "sample") {
    await delay(120);
    return getSampleFeaturedListing();
  }
  const { listing } = await request<{ listing: Listing | null }>("/api/listings/featured");
  return listing ?? undefined;
}

/** Closed sales comparable to a listing, most recent first. */
export async function getComparables(id: string): Promise<Listing[]> {
  if ((await getListingSource()) === "sample") {
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
 * Quick-create. Only the sample set accepts new rows — the MLS is the
 * brokerage's listing system and this dashboard does not write to it.
 */
export async function createListing(
  input: Pick<Listing, "address" | "city" | "listPrice" | "propertyType" | "beds" | "baths" | "sqft">
): Promise<Listing> {
  if ((await getListingSource()) === "mls") {
    throw new Error(
      "Listings come from the MLS. Enter a new listing in the MLS and it will appear here."
    );
  }
  await delay(220);
  return createSampleListing(input);
}
