import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { getTransactionProperty, mutateTransactionProperty } from "@/lib/transactions/property-service";
import { createTransactionPropertyMlsProvider } from "@/lib/transactions/property-mls";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_property");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response;
  try { const result = await getTransactionProperty(actor.ctx, id, createTransactionPropertyMlsProvider(caller.clerkUserId, request.signal)); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
export async function PATCH(request: Request, context: Context) {
  const caller = await requireCaller(); if (!caller.ok) return caller.response;
  const { id } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id)) return failure("not_found");
  if ([...new URL(request.url).searchParams.keys()].length) return failure("invalid_property");
  const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response; if (actor.ctx.actor.role === "member") return failure("forbidden");
  const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_property");
  try { const result = await mutateTransactionProperty(actor.ctx, id, body.body, createTransactionPropertyMlsProvider(caller.clerkUserId, request.signal)); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); }
}
