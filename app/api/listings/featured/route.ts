import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { brokerageMlsOfficeId } from "@/lib/brokerage/service";
import { getSampleFeaturedListing } from "@/lib/data/sample-listings";
import { sampleListingsEnabled } from "@/lib/mls/config";
import { failureResponse, mlsConfig, notConfigured, NO_STORE } from "@/lib/mls/http";
import { getFortmarkListingSummary } from "@/lib/mls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Home widget's spotlight: the highest-priced active sale listing. */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const config = mlsConfig();
  if (!config.ok) {
    // Generated rows are served only where a deployment asked for them by
    // name. "The MLS is not configured" is not a request for invented
    // properties — it is the reason there are none to show.
    if (sampleListingsEnabled()) {
      return NextResponse.json({ listing: getSampleFeaturedListing() ?? null }, { headers: NO_STORE });
    }
    return notConfigured();
  }

  try {
    // FortMark's book is defined by the brokerage's configured MLS office id.
    // Without one there is no FortMark listing to show — and never another
    // office's in its place.
    const office = await brokerageMlsOfficeId(caller.clerkUserId);
    if (!office.ok || !office.officeId) {
      return NextResponse.json(
        { listing: null, fortmarkActiveCount: null, office: office.ok ? "not_configured" : "unavailable" },
        { headers: NO_STORE }
      );
    }
    const summary = await getFortmarkListingSummary(config.config, office.officeId, request.signal);
    return NextResponse.json(
      { listing: summary.featured, fortmarkActiveCount: summary.activeCount, office: "configured" },
      { headers: NO_STORE }
    );
  } catch (error) {
    return failureResponse(error);
  }
}
