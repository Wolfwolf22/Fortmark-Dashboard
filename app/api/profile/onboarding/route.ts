import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";
import { professionalProfileUiEnabled } from "@/lib/flags";
import { completeOnboarding, saveOnboardingStep } from "@/lib/profile/service";
import {
  ONBOARDING_DEFERRAL_COOKIE,
  ONBOARDING_DEFERRAL_PATH,
  ONBOARDING_DEFERRAL_VALUE,
  deferralCookieOptions,
} from "@/lib/profile/deferral";

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

/**
 * Map a service failure onto a status.
 *
 * The body carries either a reason code or the structured validation contract
 * — never an exception message, and never a database column name. The
 * validation object is built from the shared schemas, so the route contains no
 * validation messages of its own to drift.
 */
function failure(result: {
  reason: string;
  validation?: { error: string; fieldErrors: unknown; formErrors: string[] };
}): NextResponse {
  const status =
    result.reason === "invalid" || result.reason === "unknown_step"
      ? 400
      : result.reason === "no_record"
        ? 404
        : 503;
  const body = result.validation ?? { error: result.reason };
  return NextResponse.json(body, { status, headers: NO_STORE });
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
    if (!result.ok) return failure(result);
    const response = NextResponse.json(
      { ok: true, completion: result.completion, completedAt: result.completedAt },
      { headers: NO_STORE }
    );
    // Finished, so the deferral has nothing left to suppress. Cleared rather
    // than left to expire, so a stale cookie cannot outlive its meaning.
    response.cookies.delete({
      name: ONBOARDING_DEFERRAL_COOKIE,
      path: ONBOARDING_DEFERRAL_PATH,
    });
    return response;
  }

  // "Complete later": defer the automatic redirect for this browser session.
  // Set server-side and HttpOnly, so the decision cannot be steered from the
  // document, and it authorizes nothing — see lib/profile/deferral.ts.
  if (payload.defer === true) {
    const response = NextResponse.json({ ok: true, deferred: true }, { headers: NO_STORE });
    response.cookies.set(
      ONBOARDING_DEFERRAL_COOKIE,
      ONBOARDING_DEFERRAL_VALUE,
      deferralCookieOptions()
    );
    return response;
  }

  const result = await saveOnboardingStep(caller.clerkUserId, payload.step, values);
  if (!result.ok) return failure(result);
  return NextResponse.json(
    { ok: true, completion: result.completion, onboardingStep: result.onboardingStep },
    { headers: NO_STORE }
  );
}
