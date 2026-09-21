import "server-only";

/**
 * HTTP answers for the prepared-action routes.
 *
 * These are the only endpoints that can commit an AI-prepared change, so the
 * mapping is deliberately blunt: anything that is not the caller's own live
 * proposal is a 404, and a proposal that can no longer be committed says which
 * of the several reasons applies, because "expired", "already done" and
 * "the record changed underneath you" are three different things for a person
 * to read and only one of them means try again.
 */
import { NextResponse } from "next/server";
import type { ExecuteFailureReason, PrepareFailureReason } from "./service.ts";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** Ids are opaque; this only rejects obvious junk before a query runs. */
export const ID_SHAPE = /^[0-9a-fA-F-]{36}$/;

type Reason = PrepareFailureReason | ExecuteFailureReason;

export function failure(reason: Reason): NextResponse {
  switch (reason) {
    // Actions switched off is indistinguishable from no such endpoint. A
    // deployment without the feature should not advertise that it has one.
    case "not_configured":
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    // A proposal that is not this caller's does not exist to this caller, and
    // neither does one that never existed. The two must read the same.
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    case "not_permitted":
      return NextResponse.json({ error: "no_identity" }, { status: 403, headers: NO_STORE });
    case "expired":
      return NextResponse.json({ error: "expired" }, { status: 409, headers: NO_STORE });
    case "stale":
      return NextResponse.json({ error: "stale" }, { status: 409, headers: NO_STORE });
    case "already_cancelled":
      return NextResponse.json({ error: "cancelled" }, { status: 409, headers: NO_STORE });
    // Someone else's confirmation holds the claim. Retrying is pointless and
    // would be refused again, so this is not a 5xx.
    case "in_progress":
      return NextResponse.json({ error: "in_progress" }, { status: 409, headers: NO_STORE });
    default:
      return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export function unexpected(error: unknown): NextResponse {
  // Name only. A message can carry a record, a query or a connection string.
  console.error(`[ai-actions] unexpected failure${error instanceof Error ? `: ${error.name}` : ""}`);
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}
