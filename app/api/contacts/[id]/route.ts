import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleLead } from "@/lib/data/sample-leads";
import { actorOrResponse, contactsSource, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { getContact } from "@/lib/contacts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One contact. Out of scope is answered exactly like non-existent. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  if (contactsSource() === "sample") {
    const lead = getSampleLead(id);
    return lead
      ? NextResponse.json({ contact: lead }, { headers: NO_STORE })
      : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const contact = await getContact(actor.ctx, id);
    if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ contact }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
