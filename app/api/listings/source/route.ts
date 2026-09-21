import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listingAvailability } from "@/lib/mls/config";
import { NO_STORE } from "@/lib/mls/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which source the listings screen is on.
 *
 * The server owns this decision (the flag and credential are server-only),
 * and the browser asks once rather than carrying a second, drift-prone copy
 * of the rule. In `sample` mode — which a deployment must switch on by name —
 * the browser adapter serves rows locally so quick-create's in-memory
 * additions keep appearing; in `mls` mode every read goes through the routes.
 * In `not_configured` mode there is nothing to show, and the adapter says so
 * rather than reaching for the generator.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  return NextResponse.json({ source: listingAvailability() }, { headers: NO_STORE });
}
