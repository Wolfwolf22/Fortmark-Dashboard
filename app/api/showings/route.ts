import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
import { readShowingQuery } from "@/lib/showings/domain";
import { readShowingBody, showingCallerContext, showingFailure } from "@/lib/showings/http";
import { createShowing, getShowings } from "@/lib/showings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const caller = await showingCallerContext();
    if (!caller.ok) return caller.response;
    const query = readShowingQuery(new URL(request.url).searchParams);
    if (!query) return showingFailure("invalid_showing_query");
    const result = await getShowings(caller.ctx, query, createContactPropertyMlsProvider(caller.clerkUserId, request.signal));
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : showingFailure(result.reason);
  } catch (error) { return unexpected(error); }
}

export async function POST(request: Request) {
  try {
    const caller = await showingCallerContext(undefined, true);
    if (!caller.ok) return caller.response;
    const body = await readShowingBody(request);
    if (!body.ok) return showingFailure("invalid_showing");
    const result = await createShowing(caller.ctx, body.body);
    return result.ok ? NextResponse.json({ showing: result.value }, { status: 201, headers: NO_STORE }) : showingFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
