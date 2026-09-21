import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleLead, updateSampleLeadStage } from "@/lib/data/sample-leads";
import { contactStageChangeSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { changeStage } from "@/lib/contacts/service";
import { canTransition } from "@/lib/contacts/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Move a contact to another stage. A refused move is 409, never silence. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = contactStageChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", fields: ["stage"] }, { status: 400, headers: NO_STORE });
  }

  if (contactsSource() === "sample") {
    const current = getSampleLead(id);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    if (!canTransition(current.stage, parsed.data.stage)) return failure("invalid_transition");
    return NextResponse.json({ contact: updateSampleLeadStage(id, parsed.data.stage) }, { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await changeStage(actor.ctx, id, parsed.data.stage);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ contact: result.value }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
