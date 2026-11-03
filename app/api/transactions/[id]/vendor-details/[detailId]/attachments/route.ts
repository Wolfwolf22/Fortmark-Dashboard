import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { readVendorAttachmentForm } from "@/lib/transactions/vendor-detail-http";
import { uploadTransactionVendorAttachment } from "@/lib/transactions/vendor-detail-service";
import { createTransactionFileStorage } from "@/lib/transactions/transaction-file-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string; detailId: string }> }) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id, detailId } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id) || !isRecordId(detailId)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_attachment");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response; if (actor.ctx.actor.role === "member") return failure("forbidden");
  const body = await readVendorAttachmentForm(request); if (!body.ok) return failure(body.reason);
  try { const result = await uploadTransactionVendorAttachment(actor.ctx, id, detailId, body.input, body.file, createTransactionFileStorage(process.env, { signal: request.signal })); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
