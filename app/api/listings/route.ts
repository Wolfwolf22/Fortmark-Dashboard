import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { brokerageMlsOfficeId } from "@/lib/brokerage/service";
import { searchSampleListings } from "@/lib/data/sample-listings";
import { sampleListingsEnabled } from "@/lib/mls/config";
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
    // Generated rows are served only where a deployment asked for them by
    // name. "The MLS is not configured" is not a request for invented
    // properties — it is the reason there are none to show.
    if (sampleListingsEnabled()) {
      return NextResponse.json(searchSampleListings(query), { headers: NO_STORE });
    }
    return notConfigured();
  }

  // The brokerage's MLS office id, from brokerage identity. General search
  // works without it (rows are simply not flagged as FortMark's); the
  // FortMark scope refuses rather than widening to the whole MLS.
  const office = await brokerageMlsOfficeId(caller.clerkUserId);
  const officeId = office.ok ? office.officeId : null;
  if (query.office === "fortmark" && !officeId) {
    return NextResponse.json(
      { error: office.ok ? "fortmark_office_not_configured" : "fortmark_office_unavailable" },
      { status: office.ok ? 409 : 503, headers: NO_STORE }
    );
  }

  try {
    const page = await searchListings(config.config, query, request.signal, { brokerageOfficeId: officeId });
    return NextResponse.json(page, { headers: NO_STORE });
  } catch (error) {
    return failureResponse(error);
  }
}
