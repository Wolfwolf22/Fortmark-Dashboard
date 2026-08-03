import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { decideAccess, isConfigFailure } from "@/lib/auth/dashboard-access";
import { professionalProfileUiEnabled, profileImageUploadEnabled } from "@/lib/flags";
import {
  ALLOWED_IMAGE_MIME,
  IMAGE_ERROR_MESSAGE,
  checkProfileImage,
} from "@/lib/profile/image-format";
import {
  deleteProfileImage,
  profileImagePath,
  uploadProfileImage,
} from "@/lib/profile/image-storage";
import { activateProfileImage, ownDashboardUserId } from "@/lib/profile/service";

/** Node, not Edge: the byte inspection and the Blob SDK both need it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The shared field-error contract, keyed by the control the form renders. */
function imageFieldError(status: number): NextResponse {
  return NextResponse.json(
    {
      error: "validation_failed",
      fieldErrors: { profileImage: [IMAGE_ERROR_MESSAGE] },
      formErrors: [],
    },
    { status, headers: NO_STORE }
  );
}

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
 * Replace the caller's profile photo.
 *
 * Everything that decides WHERE the bytes go is derived server-side: the
 * storage prefix comes from the caller's internal row id, the object name is a
 * server-generated UUID, and the extension comes from the format detected in
 * the bytes. Nothing the browser sends — filename, declared type, any id in
 * the body — influences the path.
 *
 * The write order preserves the existing photo on every failure. The upload
 * lands on a NEW immutable path, so until the database row is updated the live
 * image is untouched; if that update fails, the orphan is deleted and the old
 * photo is still live.
 */
export async function POST(request: NextRequest) {
  // All three gates, before anything else. `professionalProfileUiEnabled`
  // already requires PROFILE_DATABASE_ENABLED, so this covers the full set.
  //
  // This runs before the session is even read, so a disabled environment makes
  // no Blob call, no database call and no Clerk round trip — the route simply
  // does not exist as far as a caller can tell.
  if (!professionalProfileUiEnabled() || !profileImageUploadEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return imageFieldError(400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return imageFieldError(400);

  // Read once. The size is re-derived from the actual buffer rather than
  // trusted from `File.size`, which is client-reported.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return imageFieldError(400);
  }

  const check = checkProfileImage({
    size: bytes.byteLength,
    declaredType: file.type,
    bytes,
  });
  if (!check.ok) return imageFieldError(400);

  // The caller's own row id, which is also their storage prefix. Resolved from
  // the session — never from the request.
  const dashboardUserId = await ownDashboardUserId(caller.clerkUserId);
  if (!dashboardUserId) {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  const pathname = profileImagePath(dashboardUserId, randomUUID(), check.format);
  const uploaded = await uploadProfileImage({
    pathname,
    bytes,
    contentType: ALLOWED_IMAGE_MIME[check.format],
  });
  if (!uploaded.ok) {
    // Covers both an unconfigured store and a provider failure. Neither is the
    // caller's fault and neither should leak a provider message.
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  const activated = await activateProfileImage(caller.clerkUserId, uploaded);
  if (!activated.ok) {
    // The database never adopted this object, so it is unreferenced. Delete it
    // best-effort — the ownership check inside makes that safe — and leave the
    // previous photo live.
    await deleteProfileImage(dashboardUserId, uploaded.pathname);
    const status = activated.reason === "no_record" ? 404 : 503;
    return NextResponse.json({ error: activated.reason }, { status, headers: NO_STORE });
  }

  // The Home card and the profile settings both read the active image.
  revalidatePath("/");
  revalidatePath("/settings");

  return NextResponse.json(
    { image: { url: activated.url, status: activated.status } },
    { status: 200, headers: NO_STORE }
  );
}
