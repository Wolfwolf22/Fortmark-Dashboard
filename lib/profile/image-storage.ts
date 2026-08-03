import "server-only";

/**
 * Profile photo storage on Vercel Blob.
 *
 * Server-only by import guard: `BLOB_READ_WRITE_TOKEN` is read here and must
 * never reach a browser bundle.
 *
 * The store is PUBLIC, and that is a deliberate, bounded decision: these are
 * professional headshots rendered as avatars on the Home card and the digital
 * card, so direct CDN delivery avoids proxying every render through a
 * function. "Public" means unguessable, NOT access-controlled — anyone holding
 * the URL can fetch it. Nothing confidential belongs in this store: no licence
 * documents, no identification, no contracts, no MLS documents.
 */
import { del, put } from "@vercel/blob";
import { profileImageUploadEnabled } from "../flags.ts";
import type { AllowedImageFormat } from "./image-format.ts";

/** Every object this application writes lives under this root. */
export const PROFILE_IMAGE_ROOT = "profile-images";

/**
 * The prefix that belongs to one user.
 *
 * Keyed by the internal dashboard-user UUID, never the Clerk id, never an
 * email, never a display name. The UUID is opaque, is not used to authenticate
 * anything, and does not appear anywhere a visitor could correlate it with a
 * person — a public image URL should not disclose who the account belongs to.
 */
export function userPrefix(dashboardUserId: string): string {
  return `${PROFILE_IMAGE_ROOT}/${dashboardUserId}/`;
}

/**
 * An immutable object path for one upload.
 *
 * The name is generated server-side and the extension comes from the DETECTED
 * format, so neither the filename nor the declared type the browser sent has
 * any influence on where bytes land. Nothing is ever overwritten: a new upload
 * is a new object, so a failure part-way through cannot corrupt the image that
 * is currently live.
 */
export function profileImagePath(
  dashboardUserId: string,
  uploadId: string,
  format: AllowedImageFormat
): string {
  const ext = format === "jpeg" ? "jpg" : format;
  return `${userPrefix(dashboardUserId)}${uploadId}.${ext}`;
}

/**
 * Whether a stored pathname belongs to this user.
 *
 * Checked before every delete. Without it, a pathname read from a row — or one
 * that arrived by any other route — could name another user's object, and the
 * delete would succeed because the token is store-wide.
 *
 * Rejects `..` outright rather than trying to resolve it: a traversal segment
 * has no legitimate reason to appear in a name this module generated, so its
 * presence means the value did not come from here.
 */
export function ownsPathname(dashboardUserId: string, pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string" || pathname.length === 0) return false;
  if (pathname.includes("..")) return false;
  return pathname.startsWith(userPrefix(dashboardUserId));
}

/** Whether the store is configured at all. */
export function blobConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  const t = env.BLOB_READ_WRITE_TOKEN;
  return typeof t === "string" && t.trim().length > 0;
}

export type UploadResult =
  | { ok: true; url: string; pathname: string }
  | { ok: false; reason: "disabled" | "unconfigured" | "provider_unavailable" };

/**
 * Upload one image and return its public URL and pathname.
 *
 * `addRandomSuffix` is left on as a second collision guard on top of the
 * server-generated UUID, and it also means the final URL cannot be predicted
 * from the pathname alone.
 */
export async function uploadProfileImage(input: {
  pathname: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<UploadResult> {
  // Defence in depth. The route already checks this, but the token is present
  // in every environment the managed connection touches, so the write itself
  // refuses rather than trusting every future caller to have checked first.
  if (!profileImageUploadEnabled()) return { ok: false, reason: "disabled" };
  if (!blobConfigured()) return { ok: false, reason: "unconfigured" };
  try {
    const blob = await put(input.pathname, Buffer.from(input.bytes), {
      access: "public",
      contentType: input.contentType,
      addRandomSuffix: true,
      // Immutable objects, so they may be cached hard. A replacement is a new
      // object with a new URL rather than a mutation of this one.
      cacheControlMaxAge: 31536000,
    });
    return { ok: true, url: blob.url, pathname: blob.pathname };
  } catch {
    // Never surfaces the provider's message: it can carry the store id and
    // request details that are of no use to a browser.
    return { ok: false, reason: "provider_unavailable" };
  }
}

/**
 * Delete an object, but only inside the caller's own prefix.
 *
 * Returns false rather than throwing. Deletion is always cleanup — either of a
 * superseded image after a successful replacement, or of an orphan after a
 * failed one — and neither case should be able to fail the operation the user
 * actually asked for.
 */
export async function deleteProfileImage(
  dashboardUserId: string,
  pathname: string | null | undefined
): Promise<boolean> {
  // Same gate as the write: a disabled environment touches the store for
  // nothing at all, not even cleanup.
  if (!profileImageUploadEnabled()) return false;
  if (!blobConfigured()) return false;
  // The ownership gate, not an optimisation: the token can delete anything in
  // the store, so this is what stops a wrong pathname destroying another
  // user's photo.
  if (!ownsPathname(dashboardUserId, pathname)) return false;
  try {
    await del(pathname as string);
    return true;
  } catch {
    return false;
  }
}
