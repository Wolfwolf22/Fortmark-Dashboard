import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/auth/require-caller";
import { search } from "@/lib/search/service";
import { isTooLong } from "@/lib/search/query";
import { MAX_QUERY_LENGTH } from "@/lib/search/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Unified search.
 *
 * **POST, deliberately, for a read.** Every other read in this codebase is a
 * GET, and this one is not, because of what a search string contains: a
 * client's name, their phone number, their email, the address of the property
 * they are buying. A GET puts that text in the request line, and the request
 * line is what the platform writes to its access logs — so ordinary use of the
 * palette would quietly accumulate a log of the brokerage's clients, readable
 * by anyone with project access and retained on someone else's schedule. A
 * POST body is not logged that way. The cost is losing HTTP caching, which a
 * per-user authorized search must refuse anyway (`private, no-store`).
 *
 * The same reasoning has not yet been applied to `/api/contacts?q=`, which the
 * leads screen uses and which does place search text in the URL. That is the
 * same exposure and is recorded in docs/SEARCH.md as work to follow.
 *
 * Nothing about scope is accepted from the request. The body carries text and
 * nothing else — no brokerage, no agent, no role — and the caller's identity
 * comes from the verified Clerk session.
 */
const bodySchema = z.object({
  q: z.string().max(MAX_QUERY_LENGTH),
});

export async function POST(request: Request) {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    // An over-long query is refused rather than silently truncated: returning
    // results for a question nobody asked is worse than saying no.
    return NextResponse.json({ error: "invalid_query" }, { status: 400, headers: NO_STORE });
  }
  if (isTooLong(parsed.data.q)) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400, headers: NO_STORE });
  }

  try {
    const results = await search(caller.clerkUserId, parsed.data.q);
    return NextResponse.json(results, { headers: NO_STORE });
  } catch {
    // Core failure — the session resolved but the search itself could not run.
    // A provider failing is not this: that degrades inside the orchestrator.
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE });
  }
}
