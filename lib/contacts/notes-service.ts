import "server-only";

/**
 * Contact notes, server side.
 *
 * Authorization is the contact's: a note is visible to whoever may see the
 * contact, may be added by whoever may write to it, and may be deleted by the
 * same people — the owner, or an admin. Out of scope is `not_found`, so a note
 * on a colleague's contact is indistinguishable from one that does not exist.
 *
 * A note is not a touch: adding one does not move last contact, and deleting one
 * moves nothing. The write and its audit row commit together (`db.batch`), and
 * the audit row carries the contact id, the note id and the action — never a
 * word of the note.
 *
 * Deleting removes the text. The row stays as a tombstone — who deleted it, when
 * — so counts and history reconcile, but the body is gone from the database, not
 * merely hidden by a query.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { isRecordId } from "../db/ids.ts";
import { auditEvents, contactNotes } from "../db/schema.ts";
import { loadContact } from "./access.ts";
import { agentNames, type Ctx, type ServiceResult } from "./service.ts";
import { noteInputSchema, type NoteView } from "./notes.ts";

const MAX_LIST = 100;

type BatchWrite = Parameters<Db["batch"]>[0][number];

function audit(ctx: Ctx, eventType: "contact_note_created" | "contact_note_deleted", contactId: string, noteId: string, action: "create" | "delete"): BatchWrite {
  return ctx.db.insert(auditEvents).values({
    eventType,
    actorUserId: ctx.actor.userId,
    targetUserId: null,
    // Ids and the action. Nothing the note says.
    safeMetadata: { contactId, noteId, action },
  });
}

/** A contact's live notes, newest first. Deleted notes have no body and are not returned. */
export async function listNotes(ctx: Ctx, contactId: string, limit = MAX_LIST): Promise<ServiceResult<NoteView[]>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  const rows = await ctx.db
    .select({
      id: contactNotes.id,
      body: contactNotes.body,
      createdAt: contactNotes.createdAt,
      authorUserId: contactNotes.authorUserId,
    })
    .from(contactNotes)
    .where(and(eq(contactNotes.contactId, contactId), isNull(contactNotes.deletedAt)))
    .orderBy(desc(contactNotes.createdAt))
    .limit(Math.min(Math.max(limit, 1), MAX_LIST));

  const authorIds = Array.from(new Set(rows.map((r) => r.authorUserId).filter((v): v is string => Boolean(v))));
  const names = await agentNames(ctx.db, authorIds);
  if (ctx.viewerName && authorIds.includes(ctx.actor.userId) && !names.has(ctx.actor.userId)) {
    const own = (await ctx.viewerName().catch(() => null))?.trim();
    if (own) names.set(ctx.actor.userId, own);
  }
  return {
    ok: true,
    value: rows
      .filter((r): r is typeof r & { body: string } => r.body !== null)
      .map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        author: r.authorUserId ? names.get(r.authorUserId) : undefined,
        canDelete: access.writable,
      })),
  };
}

export async function addNote(ctx: Ctx, contactId: string, input: unknown, now = new Date()): Promise<ServiceResult<NoteView>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_note" };

  const id = randomUUID();
  try {
    await ctx.db.batch([
      ctx.db.insert(contactNotes).values({
        id,
        contactId,
        authorUserId: ctx.actor.userId,
        body: parsed.data.body,
        createdAt: now,
      }),
      audit(ctx, "contact_note_created", contactId, id, "create"),
    ] as unknown as Parameters<Db["batch"]>[0]);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const own = ctx.viewerName ? (await ctx.viewerName().catch(() => null))?.trim() : undefined;
  const names = await agentNames(ctx.db, [ctx.actor.userId]);
  return {
    ok: true,
    value: {
      id,
      body: parsed.data.body,
      createdAt: now.toISOString(),
      author: names.get(ctx.actor.userId) ?? (own || undefined),
      canDelete: true,
    },
  };
}

/** Remove a note's text and leave a tombstone. Someone else's contact, or a note that is not there: `not_found`. */
export async function deleteNote(ctx: Ctx, contactId: string, noteId: string, now = new Date()): Promise<ServiceResult<{ id: string }>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!isRecordId(noteId)) return { ok: false, reason: "not_found" };
  // Existence is settled before permission, so a caller who cannot write still
  // learns nothing more than "forbidden" about a note that does exist.
  const found = await ctx.db
    .select({ id: contactNotes.id })
    .from(contactNotes)
    .where(and(eq(contactNotes.id, noteId), eq(contactNotes.contactId, contactId), isNull(contactNotes.deletedAt)))
    .limit(1);
  if (!found[0]) return { ok: false, reason: "not_found" };
  if (!access.writable) return { ok: false, reason: "forbidden" };

  try {
    await ctx.db.batch([
      ctx.db
        .update(contactNotes)
        .set({ body: null, deletedAt: now, deletedByUserId: ctx.actor.userId })
        .where(and(eq(contactNotes.id, noteId), eq(contactNotes.contactId, contactId), isNull(contactNotes.deletedAt))),
      audit(ctx, "contact_note_deleted", contactId, noteId, "delete"),
    ] as unknown as Parameters<Db["batch"]>[0]);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, value: { id: noteId } };
}
