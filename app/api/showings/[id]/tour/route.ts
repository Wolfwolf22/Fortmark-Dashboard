import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
import { showingCallerContext } from "@/lib/showings/http";
import { createTourRoutingProvider } from "@/lib/showings/tour-routing";
import { readTourContextQuery } from "@/lib/showings/tour-domain";
import { getShowingTour, recommendShowingTour } from "@/lib/showings/tour-service";
import { readTourBody, tourFailure } from "@/lib/showings/tour-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, caller = await showingCallerContext(id); if (!caller.ok) return caller.response;
    const query = readTourContextQuery(new URL(request.url).searchParams); if (!query) return tourFailure("invalid_tour_query");
    const result = await getShowingTour(caller.ctx, id, createContactPropertyMlsProvider(caller.clerkUserId, request.signal), createTourRoutingProvider(process.env, { signal: request.signal }), query);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : tourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, caller = await showingCallerContext(id); if (!caller.ok) return caller.response;
    if ([...new URL(request.url).searchParams.keys()].length) return tourFailure("invalid_tour_query");
    const body = await readTourBody(request); if (!body.ok) return tourFailure("invalid_tour_plan");
    const result = await recommendShowingTour(caller.ctx, id, body.body, createContactPropertyMlsProvider(caller.clerkUserId, request.signal), createTourRoutingProvider(process.env, { signal: request.signal }));
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : tourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
