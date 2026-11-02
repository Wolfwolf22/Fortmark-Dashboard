import { NextResponse } from "next/server";
import { NO_STORE, unexpected } from "@/lib/contacts/http";
import { createContactPropertyMlsProvider } from "@/lib/contacts/property-mls";
import { readShowingBody, showingCallerContext, showingFailure } from "@/lib/showings/http";
import { getShowing, mutateShowing } from "@/lib/showings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const caller = await showingCallerContext(id);
    if (!caller.ok) return caller.response;
    const result = await getShowing(caller.ctx, id, createContactPropertyMlsProvider(caller.clerkUserId, request.signal));
    return result.ok ? NextResponse.json({ showing: result.value }, { headers: NO_STORE }) : showingFailure(result.reason);
  } catch (error) { return unexpected(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const caller = await showingCallerContext(id, true);
    if (!caller.ok) return caller.response;
    const body = await readShowingBody(request);
    if (!body.ok) return showingFailure("invalid_showing");
    const result = await mutateShowing(caller.ctx, id, body.body);
    return result.ok ? NextResponse.json({ showing: result.value }, { headers: NO_STORE }) : showingFailure(result.reason);
  } catch (error) { return unexpected(error); }
}
