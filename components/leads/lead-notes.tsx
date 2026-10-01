"use client";

/**
 * A contact's notes — always on the drawer, never behind Edit Contact.
 *
 * A composer at the top, the notes below, newest first, each with who wrote it
 * and when. A note is added or deleted, never edited: a correction is a new note,
 * so history is not quietly rewritten. Deleting asks first, and removes the
 * text itself (the server leaves only a tombstone).
 *
 * Note text is drawn as a plain text node — never as markup — so anything typed
 * here, including something that looks like HTML or script, is shown as itself
 * and cannot run. The old free-form "notes" field on a contact, when it holds
 * anything, is shown once and read-only as a "Legacy note", with no invented date.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { addNote, deleteNote, getNotes, LeadsError, type NoteView } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import { CONTACT_NOTE_MAX_LENGTH } from "@/lib/contacts/notes";
import { formatNoteStamp } from "@/lib/contacts/note-format";

export function LeadNotes({
  leadId,
  legacyNote,
  canWrite,
  available,
}: {
  leadId: string;
  /** The contact's old free-form notes field, if it holds anything. */
  legacyNote: string;
  canWrite: boolean;
  /** False for the labelled sample set, which has no notes store. */
  available: boolean;
}) {
  const { data, loading, error, refetch } = useQuery<NoteView[]>(() => getNotes(leadId), [leadId]);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NoteView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  // Where focus goes once the confirmation has closed. After a delete the button that opened it is
  // gone with the note, and the dialog's focus trap is still holding focus until it has fully closed —
  // so the move happens in `onCloseAutoFocus`, not before.
  const focusComposerAfterClose = useRef(false);

  // A different contact starts with an empty composer and no stale messages.
  const [forLead, setForLead] = useState(leadId);
  if (forLead !== leadId) {
    setForLead(leadId);
    setBody("");
    setMessage(null);
    setProblem(null);
    setPendingDelete(null);
  }

  // A refused save puts focus back where the fix is.
  useEffect(() => {
    if (problem && !saving) composer.current?.focus();
  }, [problem, saving]);

  const trimmed = body.trim();
  const tooLong = body.length > CONTACT_NOTE_MAX_LENGTH;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || tooLong || saving) return;
    setSaving(true);
    setProblem(null);
    setMessage(null);
    try {
      await addNote(leadId, body);
      setBody("");
      setMessage("Note saved.");
      refetch();
    } catch (err) {
      setProblem(
        err instanceof LeadsError && err.status === 403
          ? "You do not have permission to add notes to this contact."
          : err instanceof LeadsError && err.status === 400
            ? "That note could not be saved. Check its length."
            : "The note could not be saved. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setProblem(null);
    try {
      await deleteNote(leadId, pendingDelete.id);
      focusComposerAfterClose.current = true;
      setPendingDelete(null);
      setMessage("Note deleted.");
      refetch();
    } catch (err) {
      setPendingDelete(null);
      setProblem(
        err instanceof LeadsError && err.status === 404
          ? "That note is already gone."
          : "The note could not be deleted. Try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section aria-labelledby="lead-notes-heading" data-testid="lead-notes">
      <h3 id="lead-notes-heading" className="text-micro">
        Notes
      </h3>

      {!available ? (
        <p className="mt-2 text-sm text-muted-foreground">Notes are not available with sample data.</p>
      ) : (
        <>
          {canWrite && (
            <form onSubmit={submit} className="mt-3 grid gap-2">
              <Textarea
                ref={composer}
                aria-label="Add a note"
                placeholder="Add a note…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                disabled={saving}
                aria-invalid={problem || tooLong ? true : undefined}
                aria-describedby={problem || tooLong ? "lead-note-problem" : undefined}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" disabled={saving || !trimmed || tooLong}>
                  {saving ? "Saving…" : "Save note"}
                </Button>
                {body.length > CONTACT_NOTE_MAX_LENGTH * 0.9 && (
                  <span className="text-xs text-muted-foreground tabular">
                    {body.length.toLocaleString("en-US")} / {CONTACT_NOTE_MAX_LENGTH.toLocaleString("en-US")}
                  </span>
                )}
              </div>
              {(problem || tooLong) && (
                <p id="lead-note-problem" role="alert" className="text-sm text-destructive">
                  {tooLong ? `Notes can be up to ${CONTACT_NOTE_MAX_LENGTH.toLocaleString("en-US")} characters.` : problem}
                </p>
              )}
            </form>
          )}
          {!canWrite && problem && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {problem}
            </p>
          )}
          {message && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {message}
            </p>
          )}

          {!data && loading ? (
            <div className="mt-3 space-y-2" aria-hidden>
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error && !data ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Notes could not be loaded.
            </p>
          ) : data && data.length > 0 ? (
            <ul className="mt-3 divide-y divide-border" aria-label="Notes">
              {data.map((note) => (
                <li key={note.id} className="py-3 first:pt-0" data-testid="note">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground" data-testid="note-author">
                        {note.author ?? "Team member"}
                      </span>
                      <br />
                      <time dateTime={note.createdAt} data-testid="note-time">
                        {formatNoteStamp(note.createdAt)}
                      </time>
                    </p>
                    {note.canDelete && canWrite && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="-mr-2 h-8 px-2 text-muted-foreground"
                        onClick={() => setPendingDelete(note)}
                        aria-label={`Delete note from ${formatNoteStamp(note.createdAt)}`}
                      >
                        <Trash2 aria-hidden />
                        Delete
                      </Button>
                    )}
                  </div>
                  {/* A text node, so nothing in a note can ever be interpreted as markup. */}
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6" data-testid="note-body">
                    {note.body}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No notes yet.</p>
          )}
        </>
      )}

      {legacyNote.trim() && (
        <div className="mt-4 rounded-panel bg-tint p-3" data-testid="legacy-note">
          <p className="text-micro">Legacy note</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{legacyNote}</p>
        </div>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (!focusComposerAfterClose.current) return;
            focusComposerAfterClose.current = false;
            event.preventDefault();
            // A deleted note's own button no longer exists; the composer is the next useful place.
            if (composer.current) composer.current.focus();
            else (event.currentTarget as HTMLElement | null)?.blur();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete note?</DialogTitle>
            <DialogDescription>This will remove the note from the contact&apos;s record.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
