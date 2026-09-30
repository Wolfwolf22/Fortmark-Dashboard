import "server-only";

/**
 * The deals a contact is on — for the contact drawer's Transactions section.
 *
 * Two doors, both closed by default. The contact must be one the caller may see
 * (Contacts scope). And every deal listed must be one the caller may see under
 * TRANSACTION visibility, which is a different rule: a coordinator may see a
 * deal on their own contact that an agent owns, and an agent must never learn of
 * a deal that is not theirs merely because their contact appears on it.
 *
 * Only what a compact row needs leaves here — where, and how far along. No
 * money, no dates, no parties. The relationship is the existing one:
 * `transaction_parties.contact_id`.
 */
import { and, desc, eq } from "drizzle-orm";
import { transactionParties, transactions } from "../db/schema.ts";
import { visibleTo as visibleTransactions } from "../transactions/service.ts";
import { loadContact } from "./access.ts";
import type { Ctx, ServiceResult } from "./service.ts";
import type { LinkedTransaction } from "./linked.ts";

export type { LinkedTransaction };

const MAX = 25;

export async function listLinkedTransactions(ctx: Pick<Ctx, "actor" | "db">, contactId: string): Promise<ServiceResult<LinkedTransaction[]>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  const rows = await ctx.db
    .select({
      id: transactions.id,
      line1: transactions.addressLine1,
      line2: transactions.addressLine2,
      city: transactions.city,
      stage: transactions.stage,
    })
    .from(transactionParties)
    .innerJoin(transactions, eq(transactions.id, transactionParties.transactionId))
    .where(and(eq(transactionParties.contactId, contactId), visibleTransactions(ctx.actor)))
    .orderBy(desc(transactions.createdAt))
    .limit(MAX * 2);
  const seen = new Set<string>();
  const items: LinkedTransaction[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    items.push({ id: r.id, address: r.line2 ? `${r.line1} ${r.line2}` : r.line1, city: r.city, stage: r.stage });
    if (items.length >= MAX) break;
  }
  return { ok: true, value: items };
}
