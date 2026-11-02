import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { getSavedShowingTour, updateSavedShowingTour } from "@/lib/showings/saved-tour-service";
import { savedTourCallerContext, readSavedTourBody, savedTourFailure } from "@/lib/showings/saved-tour-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const { id } = await context.params, caller = await savedTourCallerContext(id); if (!caller.ok) return caller.response;
    if ([...new URL(request.url).searchParams.keys()].length) return savedTourFailure("invalid_saved_tour_query");
    const result = await getSavedShowingTour(caller.ctx, id); return result.ok ? NextResponse.json({ tour: result.value }, { headers: NO_STORE }) : savedTourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { const { id } = await context.params, caller = await savedTourCallerContext(id, true); if (!caller.ok) return caller.response;
    if ([...new URL(request.url).searchParams.keys()].length) return savedTourFailure("invalid_saved_tour_query");
    const body = await readSavedTourBody(request); if (!body.ok) return savedTourFailure("invalid_saved_tour");
    const result = await updateSavedShowingTour(caller.ctx, id, body.body); return result.ok ? NextResponse.json({ tour: result.value }, { headers: NO_STORE }) : savedTourFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
