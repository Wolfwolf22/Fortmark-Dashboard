import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { listPendingActions } from "@/lib/ai/actions/service";
import { failure, NO_STORE, unexpected } from "@/lib/ai/actions/http";

export const runtime = "nodejs";

/** Per-user and confidential; never cached or statically generated. */
export const dynamic = "force-dynamic";

/**
 * The proposals waiting for this caller.
 *
 * This is how a prepared action reaches the screen. The assistant's reply is
 * plain text, and text from a model is not authority: the thread asks the
 * server what is actually pending, and renders that. Nothing shown on a
 * confirmation card is ever parsed out of the model's prose, so a model that
 * describes a change it did not prepare produces no card, and a model that
 * misdescribes one it did prepare is contradicted by what the card says.
 */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  try {
    const pending = await listPendingActions({
      clerkUserId: caller.clerkUserId,
      env: process.env,
      now: new Date(),
    });
    if (!pending.ok) return failure(pending.reason);
    return NextResponse.json({ actions: pending.actions }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
