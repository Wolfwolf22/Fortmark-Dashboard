import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { transactionAttachmentDownloadHeaders } from "@/lib/transactions/attachment-http";
import { getTransactionVendorAttachment, removeTransactionVendorAttachment } from "@/lib/transactions/vendor-detail-service";
import { createTransactionFileStorage } from "@/lib/transactions/transaction-file-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; attachmentId: string }> };
export async function GET(request: Request, context: Context) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id, attachmentId } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id) || !isRecordId(attachmentId)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_attachment");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  try { const result = await getTransactionVendorAttachment(actor.ctx, id, attachmentId, createTransactionFileStorage(process.env, { signal: request.signal })); return result.ok ? new Response(result.value.stream, { headers: transactionAttachmentDownloadHeaders(result.value.filename, result.value.contentType, result.value.sizeBytes) }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
export async function DELETE(request: Request, context: Context) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id, attachmentId } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id) || !isRecordId(attachmentId)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_attachment");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response; if (actor.ctx.actor.role === "member") return failure("forbidden");
  const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_attachment");
  try { const result = await removeTransactionVendorAttachment(actor.ctx, id, attachmentId, body.body); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
