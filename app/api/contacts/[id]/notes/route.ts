import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { addNote, listNotes } from "@/lib/contacts/notes-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

/**
 * A contact's notes, newest first. Private CRM data: authenticated, scoped to
 * the contact's own visibility, never cached, and a contact outside the
 * caller's scope is answered exactly like one that does not exist.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id } = await context.params;
  if (!ID_SHAPE.test(id) || contactsSource() === "sample") return NOT_FOUND();

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await listNotes(actor.ctx, id);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ items: result.value }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}

/** Add a note. Body: `{ body }`. A refusal names the field, never what was written. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id } = await context.params;
  if (!ID_SHAPE.test(id) || contactsSource() === "sample") return NOT_FOUND();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await addNote(actor.ctx, id, body);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ note: result.value }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
