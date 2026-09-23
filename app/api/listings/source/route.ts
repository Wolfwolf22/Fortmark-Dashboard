import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listingAvailability } from "@/lib/mls/config";
import { NO_STORE } from "@/lib/mls/http";
import { callerListingContext } from "@/lib/mls-identity/listing-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which source the listings screen is on, and which scope it opens with.
 *
 * The server owns both decisions (flags, credential, role and MLS identity are
 * server-side). `defaultScope`:
 *   broker / admin / coordinator  → "fortmark" (the office's inventory)
 *   an agent with a linked MLS id → "mine"     (their listings + co-listings)
 *   anyone else                   → "mls"      (whole-MLS search)
 * `myListings` says whether My Listings can work for this caller and, if not,
 * why — so the screen can say "not connected" instead of showing zero.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const source = listingAvailability();
  if (source !== "mls") return NextResponse.json({ source }, { headers: NO_STORE });
  const ctx = await callerListingContext(caller.clerkUserId);
  const defaultScope = ctx.privileged && ctx.officeId ? "fortmark" : ctx.identity.ok ? "mine" : "mls";
  return NextResponse.json(
    {
      source,
      defaultScope,
      myListings: ctx.identity.ok ? "linked" : ctx.identity.state,
      fortmarkOffice: ctx.officeId ? "configured" : ctx.officeKnown ? "not_configured" : "unavailable",
    },
    { headers: NO_STORE }
  );
}
