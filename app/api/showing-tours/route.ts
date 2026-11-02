import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { readSavedShowingToursQuery } from "@/lib/showings/saved-tour-domain";
import { createSavedShowingTour, getSavedShowingTours } from "@/lib/showings/saved-tour-service";
import { savedTourCallerContext, readSavedTourBody, savedTourFailure } from "@/lib/showings/saved-tour-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const caller = await savedTourCallerContext(); if (!caller.ok) return caller.response;
    const query = readSavedShowingToursQuery(new URL(request.url).searchParams); if (!query) return savedTourFailure("invalid_saved_tour_query");
    const result = await getSavedShowingTours(caller.ctx, query); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : savedTourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function POST(request: Request) {
  try { const caller = await savedTourCallerContext(undefined, true); if (!caller.ok) return caller.response;
    if ([...new URL(request.url).searchParams.keys()].length) return savedTourFailure("invalid_saved_tour_query");
    const body = await readSavedTourBody(request); if (!body.ok) return savedTourFailure("invalid_saved_tour");
    const result = await createSavedShowingTour(caller.ctx, body.body); return result.ok ? NextResponse.json({ tour: result.value }, { status: 201, headers: NO_STORE }) : savedTourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
