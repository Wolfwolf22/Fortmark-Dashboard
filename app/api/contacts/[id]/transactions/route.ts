import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, contactsSource, failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/contacts/http";
import { listLinkedTransactions } from "@/lib/contacts/linked-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The deals a contact is on, compact. The contact must be in the caller's
 * Contacts scope, and each deal must be visible under Transaction visibility;
 * a deal the caller may not see is simply not listed.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  const { id } = await context.params;
  if (!ID_SHAPE.test(id) || contactsSource() === "sample") {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await listLinkedTransactions(actor.ctx, id);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ items: result.value }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
