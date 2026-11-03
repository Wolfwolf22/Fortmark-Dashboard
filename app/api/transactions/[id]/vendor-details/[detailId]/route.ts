import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { getTransactionVendorDetail, updateTransactionVendorDetail } from "@/lib/transactions/vendor-detail-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; detailId: string }> };
export async function GET(request: Request, context: Context) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id, detailId } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id) || !isRecordId(detailId)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_vendor_details");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  try { const result = await getTransactionVendorDetail(actor.ctx, id, detailId); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
export async function PATCH(request: Request, context: Context) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id, detailId } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id) || !isRecordId(detailId)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_vendor_details");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response; if (actor.ctx.actor.role === "member") return failure("forbidden");
  const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_vendor_details");
  try { const result = await updateTransactionVendorDetail(actor.ctx, id, detailId, body.body); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
