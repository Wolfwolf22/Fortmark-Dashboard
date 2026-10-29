import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { nextActionInputSchema } from "@/lib/contacts/next-action";
import { listNextActionAssignees, mutateNextAction } from "@/lib/contacts/next-action-service";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Existing readers only; assignment never grants access to a personal book. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id } = await context.params;
  if (!ID_SHAPE.test(id) || contactsSource() === "sample") return failure("not_found");
  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await listNextActionAssignees(actor.ctx, id);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ items: result.value }, { headers: NO_STORE });
  } catch (error) { return unexpected(error); }
}

/** Schedule/edit, complete with outcome and optional successor, or cancel. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id } = await context.params;
  if (!ID_SHAPE.test(id) || contactsSource() === "sample") return failure("not_found");
  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE }); }
  const parsed = nextActionInputSchema.safeParse(body);
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map(issue => issue.path.join(".") || "body")));
    return NextResponse.json({ error: "invalid", fields }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await mutateNextAction(actor.ctx, id, parsed.data);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ contact: result.value }, { headers: NO_STORE });
  } catch (error) { return unexpected(error); }
}
