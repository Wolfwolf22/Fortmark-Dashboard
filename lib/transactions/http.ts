import "server-only";

/**
 * HTTP answers for the transactions routes.
 *
 * One place maps a service outcome to a status and a coarse, content-free
 * reason, so every route says the same thing for the same fault. The
 * distinction that matters most to a caller is kept: a deal that does not
 * exist (or is out of scope, answered identically) is 404; a transition the
 * lifecycle refuses is 409; a caller with no brokerage identity yet is 403
 * with a reason the screen can explain.
 */
import { NextResponse } from "next/server";
import { transactionsDatabaseEnabled } from "../flags.ts";
import { resolveActor, type ServiceFailure } from "./service.ts";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export type TransactionsSource = "db" | "sample";

export function transactionsSource(): TransactionsSource {
  return transactionsDatabaseEnabled() ? "db" : "sample";
}

export function failure(reason: ServiceFailure): NextResponse {
  switch (reason) {
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    case "forbidden":
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
    case "no_identity":
      return NextResponse.json({ error: "no_identity" }, { status: 403, headers: NO_STORE });
    case "invalid_transition":
      return NextResponse.json({ error: "invalid_transition" }, { status: 409, headers: NO_STORE });
    case "conflict": case "request_conflict": case "closing_deadline_conflict": case "invalid_deadline_transition": case "checklist_incomplete": case "checklist_not_ready": case "invalid_checklist_transition": case "attachment_required": case "attachment_requires_reopen": case "attachment_limit": case "vendor_unavailable": case "vendor_detail_not_current":
      return NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE });
    case "invalid_attachment": case "invalid_vendor_details": return NextResponse.json({ error: reason }, { status: 400, headers: NO_STORE });
    case "file_too_large": return NextResponse.json({ error: reason }, { status: 413, headers: NO_STORE });
    case "attachment_not_configured": case "attachment_unavailable": return NextResponse.json({ error: reason }, { status: 503, headers: NO_STORE });
    case "invalid_transaction":
      return NextResponse.json({ error: "invalid", fields: ["transaction"] }, { status: 400, headers: NO_STORE });
    case "invalid_contact":
      return NextResponse.json({ error: "invalid", fields: ["contactId"] }, { status: 400, headers: NO_STORE });
    case "invalid_assignee":
      return NextResponse.json({ error: "invalid_assignee" }, { status: 400, headers: NO_STORE });
    case "disabled":
      // Never reached when the route serves the sample set; kept so a route
      // that forgets to branch on source fails closed rather than open.
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    default:
      return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}

/** Resolve the caller's actor, or the response that explains why not. */
export async function actorOrResponse(clerkUserId: string) {
  const resolved = await resolveActor(clerkUserId);
  if (!resolved.ok) return { ok: false as const, response: failure(resolved.reason) };
  return { ok: true as const, ctx: resolved.value };
}

/** Unexpected throw: logged by category, never by content. */
export function unexpected(error: unknown): NextResponse {
  console.error(`[transactions] unexpected failure${error instanceof Error ? `: ${error.name}` : ""}`);
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}

/** Count actual UTF-8 bytes; request length is only an early refusal. */
export async function readTransactionBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!request.body || Number(request.headers.get("content-length")) > 65536) return { ok: false };
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 65536) { await reader.cancel(); return { ok: false }; } chunks.push(chunk.value); }
    const data = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) };
  } catch { return { ok: false }; } finally { reader.releaseLock(); }
}

