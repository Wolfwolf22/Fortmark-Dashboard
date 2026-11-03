import "server-only";
import { NextResponse } from "next/server";
import { requireCaller } from "../auth/require-caller.ts";
import { resolveActor } from "../auth/actor.ts";
import { contactsDatabaseEnabled, transactionsDatabaseEnabled } from "../flags.ts";
import type { Ctx } from "../contacts/service.ts";
import type { CalendarAvailability, CalendarFailure } from "./service.ts";
export const CALENDAR_NO_STORE = { "Cache-Control": "private, no-store" } as const;
export async function calendarCallerContext(): Promise<{ ok: true; ctx: Ctx | null; availability: CalendarAvailability } | { ok: false; response: NextResponse }> {
  const caller = await requireCaller(); if (!caller.ok) return caller;
  const availability = { contacts: contactsDatabaseEnabled(), transactions: transactionsDatabaseEnabled() };
  if (!availability.contacts && !availability.transactions) return { ok: true, ctx: null, availability };
  const resolved = await resolveActor(caller.clerkUserId, true); if (!resolved.ok) return { ok: false, response: NextResponse.json({ error: resolved.reason === "no_identity" ? "no_identity" : "Service unavailable" }, { status: resolved.reason === "no_identity" ? 403 : 503, headers: CALENDAR_NO_STORE }) };
  return { ok: true, ctx: { actor: resolved.actor, db: resolved.db }, availability };
}
export function calendarFailure(reason: CalendarFailure): NextResponse {
  const status = reason === "not_found" ? 404 : reason === "forbidden" ? 403 : ["invalid_calendar_query", "invalid_calendar_reschedule", "invalid_date", "invalid_assignee"].includes(reason) ? 400 : ["not_configured", "unavailable"].includes(reason) ? 503 : 409;
  return NextResponse.json({ error: reason }, { status, headers: CALENDAR_NO_STORE });
}
export function calendarUnexpected(error: unknown): NextResponse { console.error(`[calendar] unexpected failure${error instanceof Error ? `: ${error.name}` : ""}`); return calendarFailure("unavailable"); }
export async function readCalendarBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!request.body || Number(request.headers.get("content-length")) > 65536) return { ok: false };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 65536) { await reader.cancel(); return { ok: false }; } chunks.push(chunk.value); } const value = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.byteLength; } return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)) }; }
  catch { return { ok: false }; } finally { reader.releaseLock(); }
}
