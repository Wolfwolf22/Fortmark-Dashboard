import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleComparables, getSampleListing } from "@/lib/data/sample-listings";
import { sampleListingsEnabled } from "@/lib/mls/config";
import { failureResponse, mlsConfig, notConfigured, NO_STORE } from "@/lib/mls/http";
import { findComparables, getListing } from "@/lib/mls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_SHAPE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Closed sales comparable to a listing: same sub-type, same city, closed in
 * the last six months, most recent first.
 *
 * A list of actual closed records, not a valuation. An empty list means the
 * MLS holds no such sales in the window — that is the answer, and the UI
 * says so rather than widening the search until something appears.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const config = mlsConfig();
  if (!config.ok) {
    // Generated rows only where a deployment asked for them by name.
    if (sampleListingsEnabled()) {
      const subject = getSampleListing(id);
      if (!subject) {
        return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
      }
      return NextResponse.json({ items: getSampleComparables(subject) }, { headers: NO_STORE });
    }
    return notConfigured();
  }

  try {
    const subject = await getListing(config.config, id, request.signal);
    if (!subject) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    const items = await findComparables(config.config, subject, { months: 6, limit: 10 }, request.signal);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    return failureResponse(error);
  }
}
