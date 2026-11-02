import "server-only";
import { NextResponse } from "next/server";
import { requireCaller } from "../auth/require-caller.ts";
import { isRecordId } from "../db/ids.ts";
import { actorOrResponse, contactsSource, failure, NO_STORE } from "../contacts/http.ts";
import type { Ctx } from "../contacts/service.ts";
import { SHOWING_BODY_BYTES } from "./domain.ts";
import type { ShowingResult } from "./service.ts";

/** The service owns record scope; the HTTP boundary never substitutes sample appointments. */
export async function showingCallerContext(id?: string, write = false): Promise<{ ok: true; ctx: Ctx; clerkUserId: string } | { ok: false; response: NextResponse }> {
  const caller = await requireCaller();
  if (!caller.ok) return caller;
  if (contactsSource() !== "db" || id !== undefined && !isRecordId(id)) return { ok: false, response: failure("not_found") };
  const actor = await actorOrResponse(caller.clerkUserId);
  if (!actor.ok) return actor;
  if (write && actor.ctx.actor.role === "member") return { ok: false, response: failure("forbidden") };
  return { ok: true, ctx: actor.ctx, clerkUserId: caller.clerkUserId };
}

/** Count actual streamed UTF-8 bytes; Content-Length is only an early refusal. */
export async function readShowingBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!request.body || Number(request.headers.get("content-length")) > SHOWING_BODY_BYTES) return { ok: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > SHOWING_BODY_BYTES) { await reader.cancel(); return { ok: false }; }
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) };
  } catch { return { ok: false }; }
  finally { reader.releaseLock(); }
}

export function readShowingSummaryLimit(params: URLSearchParams): number | null {
  if ([...params.keys()].some(key => key !== "limit") || params.getAll("limit").length > 1) return null;
  const value = params.get("limit");
  if (value === null) return 3;
  return /^(?:[1-9]|1[0-2])$/.test(value) ? Number(value) : null;
}

/** Field names and state words only; never echo appointments, feedback or conflicting records. */
export function showingFailure(reason: Extract<ShowingResult<unknown>, { ok: false }>["reason"]): NextResponse {
  switch (reason) {
    case "invalid_showing": return NextResponse.json({ error: reason, fields: ["showing"] }, { status: 400, headers: NO_STORE });
    case "invalid_showing_query": return NextResponse.json({ error: reason, fields: ["from", "to", "page", "pageSize"] }, { status: 400, headers: NO_STORE });
    case "time_conflict": case "property_conflict": return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    default: return failure(reason);
  }
}
