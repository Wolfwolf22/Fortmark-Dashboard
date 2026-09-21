import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { cancelPreparedAction } from "@/lib/ai/actions/service";
import { failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/ai/actions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Decline a proposal.
 *
 * Recorded rather than dismissed in the browser: declining is part of the
 * record, and a card closed client-side would leave a live row that anyone
 * holding the id could still confirm.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const cancelled = await cancelPreparedAction(
      { clerkUserId: caller.clerkUserId, env: process.env, now: new Date() },
      id
    );
    if (!cancelled.ok) return failure(cancelled.reason);
    return NextResponse.json({ cancelled: true }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
