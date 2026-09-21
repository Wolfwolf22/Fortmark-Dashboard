import "server-only";

/**
 * HTTP answers for the contacts routes. Same mapping as transactions: out of
 * scope is 404, a refused move is 409, no brokerage identity is 403 with a
 * reason the screen can explain, and nothing upstream-authored is forwarded.
 */
import { NextResponse } from "next/server";
import { contactsDatabaseEnabled } from "../flags.ts";
import { resolveActor, type Ctx, type ServiceFailure } from "./service.ts";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export type ContactsSource = "db" | "sample";

export function contactsSource(): ContactsSource {
  return contactsDatabaseEnabled() ? "db" : "sample";
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
    case "invalid_assignee":
      return NextResponse.json({ error: "invalid_assignee" }, { status: 400, headers: NO_STORE });
    case "disabled":
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    default:
      return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function actorOrResponse(
  clerkUserId: string
): Promise<{ ok: true; ctx: Ctx } | { ok: false; response: NextResponse }> {
  const resolved = await resolveActor(clerkUserId);
  if (!resolved.ok) return { ok: false, response: failure(resolved.reason) };
  return { ok: true, ctx: resolved.value };
}

export function unexpected(error: unknown): NextResponse {
  console.error(`[contacts] unexpected failure${error instanceof Error ? `: ${error.name}` : ""}`);
  return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
}

export const ID_SHAPE = /^[A-Za-z0-9-]{1,64}$/;
