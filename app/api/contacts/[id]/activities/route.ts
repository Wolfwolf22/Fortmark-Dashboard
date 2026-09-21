import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleLead } from "@/lib/data/sample-leads";
import { activityInputSchema } from "@/lib/contacts/domain";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { listActivities, logActivity } from "@/lib/contacts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A contact's history, newest first. The sample set keeps none. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  if (contactsSource() === "sample") {
    return getSampleLead(id)
      ? NextResponse.json({ items: [] }, { headers: NO_STORE })
      : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const items = await listActivities(actor.ctx, id);
    if (!items) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(
      {
        items: items.map((a) => ({
          id: a.id,
          kind: a.kind,
          summary: a.summary,
          occurredAt: a.occurredAt.toISOString(),
        })),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return unexpected(error);
  }
}

/** Log a touch — a call, a showing, a note. Stamps last-contacted. */
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
  const parsed = activityInputSchema.safeParse(body);
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join("."))));
    return NextResponse.json({ error: "invalid", fields }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await logActivity(actor.ctx, id, parsed.data);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ contact: result.value }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
