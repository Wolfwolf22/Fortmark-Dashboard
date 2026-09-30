import "server-only";

/**
 * Load one contact the caller may see — the door every sub-resource of a
 * contact (notes, needs, linked deals) goes through, so none of them can
 * answer for a contact the parent read would have refused.
 *
 * Out of scope is `not_found`, exactly like a contact that does not exist;
 * visible but not writable is a separate answer for the caller to give.
 */
import { and, eq } from "drizzle-orm";
import { isRecordId } from "../db/ids.ts";
import { contacts, type ContactRow } from "../db/schema.ts";
import { canSee, canWrite } from "./domain.ts";
import { visibleTo } from "./visibility.ts";
import type { Ctx } from "./service.ts";

export type ContactAccess =
  | { ok: true; row: ContactRow; writable: boolean }
  | { ok: false; reason: "not_found" };

export async function loadContact(ctx: Pick<Ctx, "actor" | "db">, id: string): Promise<ContactAccess> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  return { ok: true, row, writable: canWrite(ctx.actor, row) };
}
