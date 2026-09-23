import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { callerListingContext } from "@/lib/mls-identity/listing-context";
import { getSampleListing } from "@/lib/data/sample-listings";
import { sampleListingsEnabled } from "@/lib/mls/config";
import { failureResponse, mlsConfig, notConfigured, NO_STORE } from "@/lib/mls/http";
import { getListing } from "@/lib/mls/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Identifiers are ListingKeys or MLS numbers: bounded, printable, no slashes. */
const ID_SHAPE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * One listing with its photos, by durable identifier.
 *
 * A row that does not exist and a row that cannot be reached are different
 * answers: 404 for the first, a classified 5xx for the second, so the
 * detail page can say "not found" only when that is actually known.
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
      const listing = getSampleListing(id);
      return listing
        ? NextResponse.json({ listing }, { headers: NO_STORE })
        : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    return notConfigured();
  }

  try {
    const ctx = await callerListingContext(caller.clerkUserId);
    const listing = await getListing(config.config, id, request.signal, {
      brokerageOfficeId: ctx.officeId,
      memberKey: ctx.identity.ok ? ctx.identity.memberKey : null,
    });
    if (!listing) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ listing }, { headers: NO_STORE });
  } catch (error) {
    return failureResponse(error);
  }
}
