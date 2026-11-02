import "server-only";
import { NextResponse } from "next/server";
import { failure, NO_STORE } from "../contacts/http.ts";
import { SAVED_TOUR_BODY_BYTES } from "./saved-tour-domain.ts";
import { showingCallerContext } from "./http.ts";
import type { SavedTourFailure } from "./saved-tour-service.ts";

export const savedTourCallerContext = showingCallerContext;
export async function readSavedTourBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!request.body || Number(request.headers.get("content-length")) > SAVED_TOUR_BODY_BYTES) return { ok: false };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > SAVED_TOUR_BODY_BYTES) { await reader.cancel(); return { ok: false }; } chunks.push(chunk.value); }
    const data = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) };
  } catch { return { ok: false }; } finally { reader.releaseLock(); }
}
export function savedTourFailure(reason: SavedTourFailure): NextResponse {
  switch (reason) {
    case "invalid_saved_tour": case "invalid_saved_tour_query": case "invalid_route": return NextResponse.json({ error: reason }, { status: 400, headers: NO_STORE });
    case "source_unavailable": case "stale_review": case "review_expired": case "unresolved_stops": case "time_conflict": return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    case "unresolved_endpoint": case "unreachable": case "infeasible": return NextResponse.json({ error: reason }, { status: 422, headers: NO_STORE });
    case "not_configured": return NextResponse.json({ error: reason }, { status: 503, headers: NO_STORE });
    default: return failure(reason);
  }
}
