import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected } from "@/lib/transactions/http";
import { getSavedTourTransactions } from "@/lib/transactions/tour-link-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { const caller = await requireCaller(); if (!caller.ok) return caller.response; const { id } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id)) return failure("not_found"); if (new URL(request.url).search) return failure("invalid_tour_link"); const actor = await actorOrResponse(caller.clerkUserId); if (!actor.ok) return actor.response; try { const result = await getSavedTourTransactions(actor.ctx, id); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); } }
