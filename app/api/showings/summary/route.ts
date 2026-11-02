import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
import { readShowingSummaryLimit, showingCallerContext, showingFailure } from "@/lib/showings/http";
import { getShowingSummary } from "@/lib/showings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const caller = await showingCallerContext();
    if (!caller.ok) return caller.response;
    const limit = readShowingSummaryLimit(new URL(request.url).searchParams);
    if (limit === null) return showingFailure("invalid_showing_query");
    const result = await getShowingSummary(caller.ctx, createContactPropertyMlsProvider(caller.clerkUserId, request.signal), limit);
    return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : showingFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
