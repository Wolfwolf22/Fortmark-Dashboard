/**
 * Dashboard auth configuration — pure, testable, FAIL-CLOSED.
 *
 * Mirrors the security model already proven in the FortMark MCP server
 * (`lib/auth/oauth-config.ts` there): Clerk must be configured AND an
 * approved-user allowlist must be present and well-formed. Any missing, empty
 * or malformed value yields `{ ok: false }`, which the caller turns into a
 * controlled failure — never an open fallback.
 *
 * Nothing here ever returns, logs or exposes a configured value. Approved users
 * are compared by SHA-256 digest so a raw Clerk user id is never retained.
 */
/**
 * SHA-256 via Web Crypto so this module runs identically in the Node runtime
 * (server components, route handlers) and the Edge runtime (middleware).
 * `node:crypto` is not dependable on the edge, and the allowlist check has to
 * work in middleware — that is where a genuine 403 can be returned.
 */
async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Clerk user identifiers look like `user_<base58…>`. Non-secret shape only. */
export const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]{8,}$/;
export const MAX_ALLOWED_USERS = 64;

/** The single canonical origin the dashboard is served from. */
export const CANONICAL_ORIGIN = "https://app.fortmark.net";
/** The dashboard's basePath — must match `next.config.ts`. */
export const DASHBOARD_BASE_PATH = "/dashboard";
/** Canonical, fully-qualified dashboard root. */
export const CANONICAL_DASHBOARD_URL = `${CANONICAL_ORIGIN}${DASHBOARD_BASE_PATH}`;
/** The upstream sign-in route, served by fortmark-app at the same origin. */
export const SIGN_IN_PATH = "/sign-in";

/** Coarse, content-free reason for a rejected configuration (safe to log). */
export type AuthConfigReject =
  | "clerk_keys_absent"
  | "allowlist_absent"
  | "allowlist_invalid_json"
  | "allowlist_empty"
  | "allowlist_too_many"
  | "allowlist_malformed_entry";

export interface AuthConfig {
  /** SHA-256 digests of the approved Clerk user ids. Never the raw ids. */
  approved: Set<string>;
}

export type AuthConfigResult =
  | { ok: true; config: AuthConfig }
  | { ok: false; reason: AuthConfigReject };

function nonEmpty(v: string | undefined | null): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Both Clerk keys must be present and non-empty. */
export function hasClerkKeys(env: Record<string, string | undefined> = process.env): boolean {
  return (
    nonEmpty(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && nonEmpty(env.CLERK_SECRET_KEY)
  );
}

/**
 * Parse FORTMARK_DASHBOARD_ALLOWED_CLERK_USER_IDS. Accepts a JSON array of
 * strings OR a comma/whitespace-separated list. Every entry must match
 * CLERK_USER_ID_RE; a single malformed entry fails the whole config closed
 * rather than being silently dropped. Returns digests only.
 */
export async function parseAllowlist(
  raw: string | undefined | null
): Promise<AuthConfigResult> {
  if (!nonEmpty(raw)) return { ok: false, reason: "allowlist_absent" };

  let items: unknown[];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return { ok: false, reason: "allowlist_invalid_json" };
      items = parsed;
    } catch {
      return { ok: false, reason: "allowlist_invalid_json" };
    }
  } else {
    items = trimmed.split(/[\s,]+/).filter((s) => s.length > 0);
  }

  if (items.length === 0) return { ok: false, reason: "allowlist_empty" };
  if (items.length > MAX_ALLOWED_USERS) return { ok: false, reason: "allowlist_too_many" };

  const approved = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string" || !CLERK_USER_ID_RE.test(item.trim())) {
      return { ok: false, reason: "allowlist_malformed_entry" };
    }
    approved.add(await sha256Hex(item.trim()));
  }
  return { ok: true, config: { approved } };
}

/**
 * Load the dashboard's auth configuration. Fail-closed: any missing or
 * malformed piece returns `{ ok: false }` with a coarse reason.
 */
export async function loadAuthConfig(
  env: Record<string, string | undefined> = process.env
): Promise<AuthConfigResult> {
  if (!hasClerkKeys(env)) return { ok: false, reason: "clerk_keys_absent" };
  return parseAllowlist(env.FORTMARK_DASHBOARD_ALLOWED_CLERK_USER_IDS);
}

/** Approved-user check by digest — never compares or exposes the raw id. */
export async function isApproved(
  config: AuthConfig,
  clerkUserId: string | undefined | null
): Promise<boolean> {
  if (!nonEmpty(clerkUserId)) return false;
  return config.approved.has(await sha256Hex(clerkUserId));
}

/** Opaque, non-reversible reference for logging (never the raw Clerk user id). */
export async function userRef(clerkUserId: string | undefined | null): Promise<string> {
  if (!nonEmpty(clerkUserId)) return "anon";
  return "u_" + (await sha256Hex(clerkUserId)).slice(0, 12);
}

/**
 * Origins Clerk may accept a session token from, checked against the token's
 * `azp` claim.
 *
 * Values come ONLY from trusted platform configuration (`process.env`) — never
 * from a request `Host`/`Origin` header, which a caller can forge. Production
 * authorizes exactly one origin; arbitrary `*.vercel.app` domains are never
 * authorized in production.
 */
export function getAuthorizedParties(
  env: Record<string, string | undefined> = process.env
): string[] {
  const parties = new Set<string>([CANONICAL_ORIGIN]);

  // Preview only. VERCEL_URL / VERCEL_BRANCH_URL are injected by the platform.
  if (env.VERCEL_ENV === "preview") {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (nonEmpty(host)) parties.add(`https://${host}`);
    }
  }

  if (env.NODE_ENV === "development") {
    parties.add("http://localhost:3000");
    parties.add("http://localhost:3001");
  }

  return Array.from(parties);
}

/**
 * Validate a caller-supplied post-sign-in return target.
 *
 * Open-redirect protection: only a same-origin path INSIDE the dashboard
 * basePath is ever returned. Absolute URLs, protocol-relative URLs, backslash
 * tricks and paths outside `/dashboard` all collapse to the canonical root.
 */
export function safeReturnPath(raw: string | undefined | null): string {
  if (!nonEmpty(raw)) return DASHBOARD_BASE_PATH;
  let value = raw.trim();

  // Reject anything that could escape to another origin.
  if (value.includes("\\")) return DASHBOARD_BASE_PATH;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return DASHBOARD_BASE_PATH; // scheme
  if (value.startsWith("//")) return DASHBOARD_BASE_PATH; // protocol-relative
  if (!value.startsWith("/")) return DASHBOARD_BASE_PATH;

  // Normalize away any traversal before the containment check.
  if (value.includes("..")) return DASHBOARD_BASE_PATH;

  // Must live inside the dashboard zone.
  if (value !== DASHBOARD_BASE_PATH && !value.startsWith(`${DASHBOARD_BASE_PATH}/`)) {
    return DASHBOARD_BASE_PATH;
  }
  return value;
}

/**
 * Absolute canonical sign-in URL carrying a validated return target.
 *
 * Always points at the canonical origin so a visitor who reached a raw
 * deployment URL is returned to `app.fortmark.net` after authenticating.
 */
export function signInUrlFor(returnPath: string | undefined | null): string {
  const target = safeReturnPath(returnPath);
  const url = new URL(SIGN_IN_PATH, CANONICAL_ORIGIN);
  url.searchParams.set("redirect_url", `${CANONICAL_ORIGIN}${target}`);
  return url.toString();
}
