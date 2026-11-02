import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
import { readShowingQuery } from "@/lib/showings/domain";
import { showingCallerContext, showingFailure } from "@/lib/showings/http";
import { getShowingAgenda } from "@/lib/showings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const caller = await showingCallerContext();
    if (!caller.ok) return caller.response;
    const query = readShowingQuery(new URL(request.url).searchParams);
    if (!query) return showingFailure("invalid_showing_query");
    const result = await getShowingAgenda(caller.ctx, query, createContactPropertyMlsProvider(caller.clerkUserId, request.signal));
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : showingFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
