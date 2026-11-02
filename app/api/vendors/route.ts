import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { listBrokerageVendors, createBrokerageVendor } from "@/lib/transactions/vendor-service";
import { vendorFailure } from "@/lib/transactions/vendor-http";
import { VENDOR_ROLES, type VendorRole } from "@/lib/transactions/vendor-domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (transactionsSource() !== "db") return failure("not_found");
  const params = new URL(request.url).searchParams, role = params.get("role");
  if ([...params.keys()].some(key => key !== "role") || params.getAll("role").length > 1 || role !== null && !VENDOR_ROLES.includes(role as VendorRole)) return failure("invalid_transaction");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  try { const result = await listBrokerageVendors(actor.ctx, role ? { role: role as VendorRole } : {}); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : vendorFailure(result.reason); } catch (error) { return unexpected(error); }
}
export async function POST(request: Request) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  if (transactionsSource() !== "db") return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_transaction");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  if (actor.ctx.actor.role !== "admin") return failure("forbidden");
  const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_transaction");
  try { const result = await createBrokerageVendor(actor.ctx, body.body); return result.ok ? NextResponse.json(result.value, { status: 201, headers: NO_STORE }) : vendorFailure(result.reason); } catch (error) { return unexpected(error); }
}
