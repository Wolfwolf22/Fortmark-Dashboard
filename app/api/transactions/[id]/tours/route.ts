import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { isRecordId } from "@/lib/db/ids";
import { actorOrResponse, failure, NO_STORE, transactionsSource, unexpected, readTransactionBody } from "@/lib/transactions/http";
import { getTransactionTours, mutateTransactionTour } from "@/lib/transactions/tour-link-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function contextFor(request: Request, context: Context) { const caller = await requireCaller(); if (!caller.ok) return caller; const { id } = await context.params; if (transactionsSource() !== "db" || !isRecordId(id)) return { ok: false as const, response: failure("not_found") }; if (new URL(request.url).search) return { ok: false as const, response: failure("invalid_tour_link") }; const actor = await actorOrResponse(caller.clerkUserId); return actor.ok ? { ok: true as const, id, ctx: actor.ctx } : actor; }
export async function GET(request: Request, context: Context) { const actor = await contextFor(request, context); if (!actor.ok) return actor.response; try { const result = await getTransactionTours(actor.ctx, actor.id); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); } }
export async function POST(request: Request, context: Context) { const actor = await contextFor(request, context); if (!actor.ok) return actor.response; if (actor.ctx.actor.role === "member") return failure("forbidden"); const body = await readTransactionBody(request); if (!body.ok) return failure("invalid_tour_link"); try { const result = await mutateTransactionTour(actor.ctx, actor.id, body.body); return result.ok ? NextResponse.json(result.value, { headers: NO_STORE }) : failure(result.reason); } catch (error) { return unexpected(error); } }
