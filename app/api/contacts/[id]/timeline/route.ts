import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleLead } from "@/lib/data/sample-leads";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { getTimeline } from "@/lib/contacts/service";
import { getTimelinePage } from "@/lib/contacts/history-service";
import { readHistoryQuery } from "@/lib/contacts/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A contact's timeline: what happened, newest first, in the domain's words.
 * Scoped like a read of the contact — out of scope answers as not found. It
 * returns a headline, optional detail, a time and (when known) a name; never an
 * audit record, an id of an actor, or an email.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const paged = params.has("pageSize") || params.has("cursor");
  const query = readHistoryQuery(params);
  if (!query) return NextResponse.json({ error: "Invalid history cursor or page size" }, { status: 400, headers: NO_STORE });
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  if (contactsSource() === "sample") {
    return getSampleLead(id)
      ? NextResponse.json({ items: [], ...(paged ? { nextCursor: null, hasMore: false } : {}) }, { headers: NO_STORE })
      : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    if (paged) {
      const result = await getTimelinePage(actor.ctx, id, query);
      if (!result.ok) return failure(result.reason);
      return NextResponse.json(result.value, { headers: NO_STORE });
    }
    const result = await getTimeline(actor.ctx, id);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ items: result.value }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
