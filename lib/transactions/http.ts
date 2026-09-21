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

