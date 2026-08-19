import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";
import { professionalProfileUiEnabled, profileImageUploadEnabled } from "@/lib/flags";
import { toProfileDetail } from "@/lib/profile/display";
import { getOwnProfile, updateOwnProfile } from "@/lib/profile/service";

export const runtime = "nodejs";

/** Per-user data. Never cached, never statically generated. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The caller's own professional profile.
 *
 * Authorization is re-derived here rather than trusted from the middleware
 * matcher — a route handler is the last line of defence for the data it
 * returns. The Clerk id used to scope every query comes from the verified
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
  // `decideAccess` only returns ok for a signed-in, allowlisted user, so the
  // id is non-null here; the assertion documents that rather than re-checking.
  return { ok: true, clerkUserId: userId as string };
}

/**
 * When the feature is off the route must not exist as far as a caller can
 * tell — 404, not 403, so probing it reveals nothing about the rollout.
 */
function featureOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
}

/** Exactly the pair `POST /api/profile/image` gates on. */
function imageUploadAvailable(): boolean {
  return professionalProfileUiEnabled() && profileImageUploadEnabled();
}

export async function GET() {
  if (!professionalProfileUiEnabled()) return featureOff();

  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  const record = await getOwnProfile(caller.clerkUserId);
  if (!record) {
    // No row yet, or the database is unreachable. Either way the drawer shows
    // an empty editable form rather than an error.
    return NextResponse.json(
      { profile: null, imageUploadEnabled: imageUploadAvailable() },
      { headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      profile: toProfileDetail(record.profile),
      // So the editor's photo control can match what the upload route would
      // actually do. Reported by the SERVER rather than inferred client-side,
      // and it discloses nothing sensitive: a caller can already learn the
      // same fact by posting and reading the status.
      imageUploadEnabled: imageUploadAvailable(),
    },
    { headers: NO_STORE }
  );
}

export async function PATCH(request: NextRequest) {
  if (!professionalProfileUiEnabled()) return featureOff();

  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400, headers: NO_STORE }
    );
  }

  // Role, status, the Clerk id and the verified email are stripped by the Zod
  // schema inside the service, so a crafted body cannot escalate anything.
  const result = await updateOwnProfile(caller.clerkUserId, body);
  if (!result.ok) {
    const status = result.reason === "invalid" ? 400 : result.reason === "no_record" ? 404 : 503;
    // The structured contract when validation failed, otherwise a bare reason.
    // Never an exception message and never a database column name.
    const payload = result.validation ?? { error: result.reason };
    return NextResponse.json(payload, { status, headers: NO_STORE });
  }

  const record = await getOwnProfile(caller.clerkUserId);
  return NextResponse.json(
    {
      profile: record ? toProfileDetail(record.profile) : null,
      completion: result.completion,
      licenseReset: result.licenseReset,
    },
    { headers: NO_STORE }
  );
}
