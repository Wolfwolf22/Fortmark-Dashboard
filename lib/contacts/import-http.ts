import "server-only";
import { NextResponse } from "next/server";
import { IMPORT_LIMITS } from "./import.ts";
import { failure, NO_STORE } from "./http.ts";
import type { ServiceFailure } from "./service.ts";

/** Bound the incoming JSON stream before decoding; no submitted values are logged. */
export async function readImportBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (Number(request.headers.get("content-length")) > IMPORT_LIMITS.bytes || !request.body) return { ok: false };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > IMPORT_LIMITS.bytes) { await reader.cancel(); return { ok: false }; } chunks.push(chunk.value); }
    const combined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined)) };
  } catch { return { ok: false }; }
}
export function importFailure(reason: ServiceFailure | "invalid_import") {
  if (reason === "invalid_import") return NextResponse.json({ error: "invalid_import", fields: ["rows"] }, { status: 400, headers: NO_STORE });
  if (reason === "request_conflict" || reason === "conflict") return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
  return failure(reason);
}
