import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { reassignContactSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { reassignContact } from "@/lib/contacts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hand a contact to another agent: `{ "agentId": "<dashboard user id>" }`.
 *
 * Out of scope is 404; visible but not permitted (an agent, a member) is 403;
 * an assignee who is not a real, active, work-owning dashboard user is 400
 * `invalid_assignee`. The new owner comes from the brokerage's own roster — an
 * MLS listing agent is not a dashboard user and cannot be named.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  if (contactsSource() === "sample") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = reassignContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", fields: ["agentId"] }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await reassignContact(actor.ctx, id, parsed.data.agentId);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ contact: result.value.lead, changed: result.value.changed }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
