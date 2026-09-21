import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { searchSampleListings } from "@/lib/data/sample-listings";
import { failureResponse, mlsConfig, notConfigured, NO_STORE } from "@/lib/mls/http";
import { parseListingQuery } from "@/lib/mls/query";
import { searchListings } from "@/lib/mls/service";

export const runtime = "nodejs";

/** Per-user, filter-dependent; never cached or statically generated. */
export const dynamic = "force-dynamic";

/**
 * Listing search.
 *
 * Filtering, sorting and paging are resolved server-side against the source
 * — the MLS when configured, otherwise the sample set — so the browser never
 * receives more than one page, and never has to know which source answered
 * beyond the `source` field it is told to label.
 */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const query = parseListingQuery(request.nextUrl.searchParams);

  const config = mlsConfig();
  if (!config.ok) {
    if (config.reason === "disabled") {
      return NextResponse.json(searchSampleListings(query), { headers: NO_STORE });
    }
    return notConfigured();
  }

  try {
    const page = await searchListings(config.config, query, request.signal);
    return NextResponse.json(page, { headers: NO_STORE });
  } catch (error) {
    return failureResponse(error);
  }
}
