/**
 * Contact notes — what a request may say and what leaves the server.
 *
 * A note is plain text written by a named person on a timestamp. Add and delete
 * only: a correction is a new note, so history is never quietly rewritten.
 * Deleting removes the text itself (the database row stays as a tombstone), so
 * nothing here ever has a deleted body to return.
 *
 * Plain text end to end: the body is rendered as text, never as markup, and is
 * never searched, logged or written to the audit trail.
 *
 * Pure and isomorphic: the composer, the route and the tests share one limit.
 */
import { z } from "zod";

/** The longest note. Enforced here for a readable refusal and by the database as the last word. */
export const CONTACT_NOTE_MAX_LENGTH = 10_000;

/** Line endings normalised and the ends trimmed; a NUL byte is not text and Postgres would refuse it. */
export function normalizeNoteBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

export function isValidNoteBody(body: string): boolean {
  return body.length >= 1 && body.length <= CONTACT_NOTE_MAX_LENGTH && !body.includes("\u0000");
}

export const noteInputSchema = z
  .object({ body: z.string().max(CONTACT_NOTE_MAX_LENGTH * 2) })
  .strict()
  .transform((v) => ({ body: normalizeNoteBody(v.body) }))
  .refine((v) => isValidNoteBody(v.body), { message: "invalid note", path: ["body"] });

export type NoteInput = z.infer<typeof noteInputSchema>;

/** A live note as the drawer sees it. No ids of people, no deleted notes. */
export interface NoteView {
  id: string;
  body: string;
  /** ISO. Shown in the business timezone by the screen. */
  createdAt: string;
  /** A profile name, when there is one; the screen says "Team member" otherwise. */
  author?: string;
  /** Whether this viewer may delete it. The server decides again on delete. */
  canDelete: boolean;
}
