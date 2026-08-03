import "server-only";

/**
 * Release 1 feature flags.
 *
 * Every flag defaults to **off**, and "off" must always mean "the dashboard
 * behaves exactly as it does today" — never "access is denied". The profile
 * features fail closed; the existing allowlist path is untouched by them.
 */

/** Any string map — lets tests pass a bare object without faking ProcessEnv. */
export type EnvLike = Record<string, string | undefined>;

function enabled(name: string, env: EnvLike = process.env): boolean {
  const v = env[name];
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** Read/write FortMark user + profile rows. Off ⇒ no database traffic at all. */
export function profileDatabaseEnabled(env: EnvLike = process.env): boolean {
  return enabled("PROFILE_DATABASE_ENABLED", env);
}

/**
 * Permit Blob writes for profile photos.
 *
 * A SEPARATE gate from the profile UI on purpose. Vercel's managed Blob
 * connection scopes `BLOB_READ_WRITE_TOKEN` to Production *and* Preview and
 * offers no per-branch option, so the token exists in environments that must
 * never write to the store. Token presence therefore cannot be the switch —
 * if it were, connecting the store would have silently enabled uploads
 * everywhere at once.
 *
 * Deliberately strict: only the exact string "1" enables it. "true", "yes" and
 * "on" are all rejected, unlike the other flags, because this one governs
 * writes to shared external storage and a typo should fail closed rather than
 * guess generously.
 *
 * It authorizes nobody. Clerk authentication and the allowlist are still
 * required, and the caller must also pass `professionalProfileUiEnabled`,
 * which itself requires the database flag.
 */
export function profileImageUploadEnabled(env: EnvLike = process.env): boolean {
  return env.PROFILE_IMAGE_UPLOAD_ENABLED === "1";
}

/**
 * Render the top-bar identity, drawer and profile editor. Requires the
 * database flag — the UI has nothing to show without it, and enabling the UI
 * alone would render empty chrome.
 */
export function professionalProfileUiEnabled(env: EnvLike = process.env): boolean {
  return enabled("PROFESSIONAL_PROFILE_UI_ENABLED", env) && profileDatabaseEnabled(env);
}

/**
 * Hand dashboard authorization to the database.
 *
 * Hard-disabled in Release 1. The constant below is the guard: even if the
 * environment variable is set, this returns false, so a stray Vercel setting
 * cannot silently change who may enter the dashboard mid-release.
 */
const RELEASE_1_FORCES_ALLOWLIST_AUTHORITY = true;

export function databaseAccessControlEnabled(env: EnvLike = process.env): boolean {
  if (RELEASE_1_FORCES_ALLOWLIST_AUTHORITY) return false;
  return enabled("DATABASE_ACCESS_CONTROL_ENABLED", env);
}
