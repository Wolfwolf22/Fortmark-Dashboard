import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleLead } from "@/lib/data/sample-leads";
import { contactStageChangeSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { changeStage } from "@/lib/contacts/service";

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
    return NextResponse.json({ error:"sample_read_only" }, { status:403,headers:NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  if(!parsed.data.expectedUpdatedAt)return failure("invalid_revision");
  try {
    const result = await changeStage(actor.ctx, id, parsed.data.stage, new Date(), {
      engagementAcknowledged: parsed.data.engagementAcknowledged,
      expectedStage: parsed.data.expectedStage,
      expectedUpdatedAt:parsed.data.expectedUpdatedAt,
    });
    if (!result.ok) {
      if (result.reason === "conflict") return NextResponse.json({ error: "conflict" }, { status: 409, headers: NO_STORE });
      return failure(result.reason);
    }
    return NextResponse.json({ contact: result.value }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
