import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { getChecklistAttachmentDefaults, updateChecklistAttachmentDefault } from "@/lib/transactions/attachment-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (transactionsSource() !== "db") return failure("not_found"); if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_attachment");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  try { const result = await getChecklistAttachmentDefaults(actor.ctx); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
export async function PATCH(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (transactionsSource() !== "db") return failure("not_found"); if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_attachment");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response; if (actor.ctx.actor.role !== "admin") return failure("forbidden");
  const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_attachment");
  try { const result = await updateChecklistAttachmentDefault(actor.ctx, body.body); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
