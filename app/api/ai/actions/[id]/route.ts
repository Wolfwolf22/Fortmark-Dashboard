import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getPreparedAction } from "@/lib/ai/actions/service";
import { failure, ID_SHAPE, NO_STORE, unexpected } from "@/lib/ai/actions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One proposal, as the card should render it. Scoped to its own actor. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const found = await getPreparedAction(
      { clerkUserId: caller.clerkUserId, env: process.env, now: new Date() },
      id
    );
    if (!found.ok) return failure(found.reason);
    return NextResponse.json({ action: found.action }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
