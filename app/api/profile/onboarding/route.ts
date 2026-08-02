import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";
import { professionalProfileUiEnabled } from "@/lib/flags";
import { completeOnboarding, saveOnboardingStep } from "@/lib/profile/service";

export const runtime = "nodejs";

/** Per-user data. Never cached, never statically generated. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Onboarding draft saves and completion.
 *
 * Authorization is re-derived here rather than trusted from the middleware
 * matcher — a route handler is the last line of defence for the data it
 * writes. The Clerk id used to scope the write comes from the verified
 * session, never from the URL or the body, so there is no request shape that
 * addresses another user's row.
 */
async function requireCaller(): Promise<
  { ok: true; clerkUserId: string } | { ok: false; response: NextResponse }
> {
  const { userId } = await auth();
  const decision = decideAccess(userId);
  if (!decision.ok) {
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
  return { ok: true, clerkUserId: userId as string };
}

/**
 * When the feature is off the route must not exist as far as a caller can
 * tell — 404, not 403, so probing reveals nothing about the rollout.
 */
function featureOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
}

/** Map a service failure onto a status. Never leaks an exception message. */
function failure(reason: string): NextResponse {
  const status =
    reason === "invalid" || reason === "unknown_step"
      ? 400
      : reason === "no_record"
        ? 404
        : 503;
  return NextResponse.json({ error: reason }, { status, headers: NO_STORE });
}

/**
 * Save one step, or finish onboarding.
 *
 * `{ step: n, values: {...} }`  saves a draft step.
 * `{ complete: true, values: {...} }`  runs full validation and finishes.
 *
 * Any `clerkUserId`, `userId` or `profileId` in the body is ignored: the
 * schemas strip unknown keys and the write is scoped by the session.
 */
export async function POST(request: NextRequest) {
  if (!professionalProfileUiEnabled()) return featureOff();

  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const values = payload.values ?? {};

  if (payload.complete === true) {
    const result = await completeOnboarding(caller.clerkUserId, values);
    if (!result.ok) return failure(result.reason);
    return NextResponse.json(
      { ok: true, completion: result.completion, completedAt: result.completedAt },
      { headers: NO_STORE }
    );
  }

  const result = await saveOnboardingStep(caller.clerkUserId, payload.step, values);
  if (!result.ok) return failure(result.reason);
  return NextResponse.json(
    { ok: true, completion: result.completion, onboardingStep: result.onboardingStep },
    { headers: NO_STORE }
  );
}
