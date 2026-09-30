import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { updateNeed } from "@/lib/contacts/needs-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change a client need, including pausing, fulfilling or archiving it. There is
 * no delete: a need's history stays with the relationship.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; needId: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id, needId } = await context.params;
  if (!ID_SHAPE.test(id) || !ID_SHAPE.test(needId) || contactsSource() === "sample") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await updateNeed(actor.ctx, id, needId, body);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ need: result.value.need, changed: result.value.changed }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
