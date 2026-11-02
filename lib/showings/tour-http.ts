import "server-only";
import { NextResponse } from "next/server";
import { failure, NO_STORE } from "../contacts/http.ts";
import { TOUR_BODY_BYTES } from "./tour-domain.ts";
import type { TourFailure } from "./tour-service.ts";

export async function readTourBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!request.body || Number(request.headers.get("content-length")) > TOUR_BODY_BYTES) return { ok: false };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > TOUR_BODY_BYTES) { await reader.cancel(); return { ok: false }; } chunks.push(chunk.value); }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) };
  } catch { return { ok: false }; } finally { reader.releaseLock(); }
}
export function tourFailure(reason: TourFailure): NextResponse {
  switch (reason) {
    case "invalid_tour_query": case "invalid_tour_plan": case "invalid_route": return NextResponse.json({ error: reason }, { status: 400, headers: NO_STORE });
    case "stale_context": case "source_unavailable": case "unresolved_stops": return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    case "unresolved_endpoint": case "unreachable": case "infeasible": return NextResponse.json({ error: reason }, { status: 422, headers: NO_STORE });
    case "not_configured": return NextResponse.json({ error: reason }, { status: 503, headers: NO_STORE });
    default: return failure(reason);
  }
}
