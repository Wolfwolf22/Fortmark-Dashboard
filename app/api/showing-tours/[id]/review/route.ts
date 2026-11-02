import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
import { createTourRoutingProvider } from "@/lib/showings/tour-routing";
import { reviewSavedShowingTour } from "@/lib/showings/saved-tour-service";
import { savedTourCallerContext, readSavedTourBody, savedTourFailure } from "@/lib/showings/saved-tour-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params, caller = await savedTourCallerContext(id, true); if (!caller.ok) return caller.response;
    if ([...new URL(request.url).searchParams.keys()].length) return savedTourFailure("invalid_saved_tour_query");
    const body = await readSavedTourBody(request); if (!body.ok) return savedTourFailure("invalid_saved_tour");
    const result = await reviewSavedShowingTour(caller.ctx, id, body.body, createContactPropertyMlsProvider(caller.clerkUserId, request.signal), createTourRoutingProvider(process.env, { signal: request.signal }));
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : savedTourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
