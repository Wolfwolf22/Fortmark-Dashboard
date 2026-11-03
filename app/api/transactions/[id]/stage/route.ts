import { NextRequest, NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { getSampleTransaction } from "@/lib/data/sample-transactions";
import { stageChangeSchema } from "@/lib/transactions/domain";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { changeStage } from "@/lib/transactions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_SHAPE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Move a deal to another stage.
 *
 * The lifecycle decides what is allowed (`lib/transactions/stages.ts`); a
 * refused move is 409 with the reason named, never silently ignored — the
 * board's optimistic drop must be told so it can snap the card back.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const { id } = await context.params;
  if (!ID_SHAPE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_transaction");
  const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_transaction");
  const parsed = stageChangeSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", fields: ["stage"] }, { status: 400, headers: NO_STORE });
  }

  if (transactionsSource() === "sample") {
    const current = getSampleTransaction(id);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ error: "sample_read_only" }, { status: 403, headers: NO_STORE });
  }

  if (!parsed.data.requestId || !parsed.data.expectedUpdatedAt) return NextResponse.json({ error: "invalid", fields: ["requestId", "expectedUpdatedAt"] }, { status: 400, headers: NO_STORE });
  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor.response;
  try {
    const result = await changeStage(actor.ctx, id, parsed.data.stage, new Date(), { requestId: parsed.data.requestId, expectedUpdatedAt: parsed.data.expectedUpdatedAt,closeAcknowledgement:parsed.data.closeAcknowledgement,reason:parsed.data.reason });
    if (!result.ok) return failure(result.reason);
    return NextResponse.json({ transaction: result.value }, { headers: NO_STORE });
  } catch (error) {
    return unexpected(error);
  }
}
