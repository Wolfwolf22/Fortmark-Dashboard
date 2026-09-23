import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { callerListingContext } from "@/lib/mls-identity/listing-context";
import { getSampleFeaturedListing } from "@/lib/data/sample-listings";
import { sampleListingsEnabled } from "@/lib/mls/config";
import { failureResponse, mlsConfig, notConfigured, NO_STORE } from "@/lib/mls/http";
import { getFortmarkListingSummary, getMyListingSummary } from "@/lib/mls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Home's listing card, by role:
 *
 *   broker / admin / transaction coordinator → FortMark's active book (office)
 *   everyone else                            → the agent's own active book
 *                                              (listing or co-listing agent)
 *
 * The scope is decided here from the session, never by the browser. Missing
 * inputs are said as such: an unconfigured office or an unlinked MLS identity
 * is never presented as zero listings, and never replaced by another office's.
 */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const config = mlsConfig();
  if (!config.ok) {
    if (sampleListingsEnabled()) {
      return NextResponse.json({ listing: getSampleFeaturedListing() ?? null }, { headers: NO_STORE });
    }
    return notConfigured();
  }

  try {
    const ctx = await callerListingContext(caller.clerkUserId);

    if (!ctx.privileged) {
      if (!ctx.identity.ok) {
        return NextResponse.json(
          { scope: "mine", listing: null, activeCount: null, identity: ctx.identity.state },
          { headers: NO_STORE }
        );
      }
      const mine = await getMyListingSummary(
        config.config,
        ctx.identity.memberKey,
        { brokerageOfficeId: ctx.officeId },
        request.signal
      );
      return NextResponse.json(
        { scope: "mine", listing: mine.featured, activeCount: mine.activeCount, identity: "linked" },
        { headers: NO_STORE }
      );
    }

    if (!ctx.officeId) {
      return NextResponse.json(
        {
          scope: "fortmark",
          listing: null,
          activeCount: null,
          fortmarkActiveCount: null,
          office: ctx.officeKnown ? "not_configured" : "unavailable",
        },
        { headers: NO_STORE }
      );
    }
    const summary = await getFortmarkListingSummary(config.config, ctx.officeId, request.signal);
    return NextResponse.json(
      {
        scope: "fortmark",
        listing: summary.featured,
        activeCount: summary.activeCount,
        fortmarkActiveCount: summary.activeCount,
        office: "configured",
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return failureResponse(error);
  }
}
