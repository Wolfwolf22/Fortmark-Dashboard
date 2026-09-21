import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { executePreparedAction } from "@/lib/ai/actions/service";
import { failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/ai/actions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Commit a proposal the caller confirmed.
 *
 * This is the only path in FortMark that turns an AI-prepared action into a
 * change, and the model cannot reach it. No tool names this route, no tool
 * takes a url, and the assistant is never told it exists — the button that
 * calls it is pressed by a person in a session this handler authenticates for
 * itself.
 *
 * The request body is ignored entirely. Everything that decides what happens —
 * who is acting, which record, which field, which value — was written to
 * `ai_prepared_actions` at preparation time and is re-read here under the
 * caller's own scope. There is no field a caller could add to this request to
 * change the outcome, because the request carries nothing but an id, and an id
 * that is not theirs is a 404.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const executed = await executePreparedAction(
      { clerkUserId: caller.clerkUserId, env: process.env, now: new Date() },
      id
    );
    if (!executed.ok) return failure(executed.reason);
    // `alreadyExecuted` distinguishes this call from the one that committed,
    // so a retried confirmation is answered truthfully rather than reported as
    // a second scheduling that never happened.
    return NextResponse.json(
      { action: executed.action, alreadyExecuted: executed.alreadyExecuted },
      { headers: NO_STORE }
    );
  } catch (error) {
    return unexpected(error);
  }
}
