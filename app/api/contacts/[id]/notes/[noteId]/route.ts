import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { deleteNote } from "@/lib/contacts/notes-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete a note: its text is removed and a tombstone remains. Allowed for the
 * contact's owner and for an admin; anyone else is told the note is not there.
 * There is no edit route — a correction is a new note.
 */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string; noteId: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id, noteId } = await context.params;
  if (!ID_SHAPE.test(id) || !ID_SHAPE.test(noteId) || contactsSource() === "sample") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await deleteNote(actor.ctx, id, noteId);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ deleted: true }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
