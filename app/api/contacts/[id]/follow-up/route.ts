import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { followUpChangeSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { changeFollowUp } from "@/lib/contacts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set, reschedule or complete a contact's follow-up — with no touch logged.
 *
 * `{ "action": "schedule", "day": "YYYY-MM-DD" }` or `{ "action": "complete" }`.
 * It changes the reminder and nothing about the relationship: last contact
 * and the activity history are untouched. Logging a call while also moving the
 * reminder is the activities route, which is a different thing.
 *
 * Out of scope is 404, read-only is 403, a day that cannot be scheduled (not a
 * real date, in the past, too far ahead) is 400 `invalid_date`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  // The sample set is edited in the browser by the adapter; there is nothing
  // for the server to write.
  if (contactsSource() === "sample") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = followUpChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", fields: ["action", "day"] }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await changeFollowUp(actor.ctx, id, parsed.data);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json(
      { contact: result.value.lead, followUp: result.value.outcome },
      { headers: NO_STORE }
    );
  } catch (error) {
    return unexpected(error);
  }
}
