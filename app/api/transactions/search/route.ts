import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listSampleTransactions } from "@/lib/data/sample-transactions";
import { actorOrResponse, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { listTransactions } from "@/lib/transactions/service";
import { parseTransactionFilters } from "@/lib/transactions/filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transactions list — private form.
 *
 * **POST, deliberately, for a read.** A deal search term is a property
 * address: the one a named client is under contract on. A GET writes it into
 * the platform's access logs on every keystroke; a POST body is not logged
 * that way. Same reasoning, same shape and same authorization as
 * `POST /api/contacts/search` — the filters run through the list route's own
 * validator, and scope comes from the verified session, never the body.
 */
export async function POST(request: Request) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400, headers: NO_STORE });
  }

  const record = body as Record<string, unknown>;
  const { filters, range } = parseTransactionFilters((key) => {
    const value = record[key];
    return typeof value === "string" ? value : null;
  });

  if (transactionsSource() === "sample") {
    return NextResponse.json({ items: listSampleTransactions(filters, range) }, { headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const items = await listTransactions(actor.ctx, filters, range);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
