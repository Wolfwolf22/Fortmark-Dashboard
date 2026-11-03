import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { listTransactionVendorDetails } from "@/lib/transactions/vendor-detail-service";
import { VENDOR_ROLES, type VendorRole } from "@/lib/transactions/vendor-domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id)) return failure("not_found");
  const query = new URL(request.url).searchParams, role = query.get("role"); if ([...query.keys()].some(key => key !== "role") || query.getAll("role").length > 1 || role !== null && !VENDOR_ROLES.includes(role as VendorRole)) return failure("invalid_vendor_details");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  try { const result = await listTransactionVendorDetails(actor.ctx, id, role ? { role: role as VendorRole } : {}); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
