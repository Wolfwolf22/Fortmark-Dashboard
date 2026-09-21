import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleFeaturedListing } from "@/lib/data/sample-listings";
import { failureResponse, mlsConfig, notConfigured, NO_STORE } from "@/lib/mls/http";
import { getFeaturedListing } from "@/lib/mls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Home widget's spotlight: the highest-priced active sale listing. */
export async function GET(request: NextRequest) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const config = mlsConfig();
  if (!config.ok) {
    if (config.reason === "disabled") {
      return NextResponse.json({ listing: getSampleFeaturedListing() ?? null }, { headers: NO_STORE });
    }
    return notConfigured();
  }

  try {
    const listing = await getFeaturedListing(config.config, request.signal);
    return NextResponse.json({ listing }, { headers: NO_STORE });
  } catch (error) {
    return failureResponse(error);
  }
}
