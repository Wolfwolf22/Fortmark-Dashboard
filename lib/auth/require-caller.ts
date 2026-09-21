import "server-only";

/**
 * The caller behind an authenticated dashboard route.
 *
 * Authorization is re-derived here rather than trusted from the middleware
 * matcher — a route handler is the last line of defence for the data it
 * returns. The Clerk id comes from the verified session, never from the URL
 * or the body, so there is no request shape that acts as another user.
 *
 * The three profile routes each carry a private copy of this function; new
 * routes use this one so the rule has a single home. Folding the existing
 * copies in is a mechanical follow-up.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { decideAccess, isConfigFailure } from "./dashboard-access.ts";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export type CallerResult =
  | { ok: true; clerkUserId: string }
  | { ok: false; response: NextResponse };

export async function requireCaller(): Promise<CallerResult> {
  const { userId } = await auth();
  const decision = decideAccess(userId);
  if (!decision.ok) {
    // 503 for a broken server config, 401 for anonymous, 403 for a signed-in
    // but unapproved user. The reason is coarse and content-free.
    const status = isConfigFailure(decision.reason)
      ? 503
      : decision.reason === "not_signed_in"
        ? 401
        : 403;
    return {
      ok: false,
      response: NextResponse.json(
        { error: status === 503 ? "Service unavailable" : "Forbidden" },
        { status, headers: NO_STORE }
      ),
    };
  }
  // `decideAccess` only returns ok for a signed-in, allowlisted user, so the
  // id is non-null here; the assertion documents that rather than re-checking.
  return { ok: true, clerkUserId: userId as string };
}
