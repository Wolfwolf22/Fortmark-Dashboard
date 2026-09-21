import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleTransaction } from "@/lib/data/sample-transactions";
import { actorOrResponse, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { getTransaction } from "@/lib/transactions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Database ids are UUIDs; sample ids are short tokens. Both bounded. */
const ID_SHAPE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * One deal. Out of scope is answered exactly like non-existent: the response
 * must not reveal that another agent's deal exists at this id.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  if (transactionsSource() === "sample") {
    const txn = getSampleTransaction(id);
    return txn
      ? NextResponse.json({ transaction: txn }, { headers: NO_STORE })
      : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const txn = await getTransaction(actor.ctx, id);
    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ transaction: txn }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
