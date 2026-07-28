import "server-only";

/**
 * Dashboard browser-session authorization — fail closed.
 *
 * This is the dashboard's own decision layer. It deliberately mirrors the
 * *semantics* of the MCP server's approved-user check (hashed comparison,
 * strict identifier shape, one bad entry fails the whole config) so the same
 * `FORTMARK_ALLOWED_CLERK_USER_IDS` value can govern both — but it is a
 * separate verification flow. An approved browser session is NOT an MCP OAuth
 * token and confers no MCP access.
 *
 * Nothing here returns, logs, or exposes a configured value. Callers get a
 * decision plus a coarse, content-free reason.
 */
import { createHash } from "node:crypto";

/** Clerk user identifiers look like `user_<base58…>`. Non-secret shape check. */
const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]{8,}$/;
const MAX_ALLOWED_USERS = 64;

/** Coarse, content-free reason. Safe to log; never includes a configured value. */
export type AccessDenyReason =
  | "clerk_keys_absent"
  | "allowlist_absent"
  | "allowlist_invalid_json"
  | "allowlist_empty"
  | "allowlist_too_many"
  | "allowlist_invalid_identifier"
  | "not_signed_in"
  | "not_approved";

export type AccessDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AccessDenyReason };

function nonEmpty(v: string | undefined | null): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Both Clerk keys must be present and non-empty, or we fail closed. */
export function hasClerkKeys(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    nonEmpty(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    nonEmpty(env.CLERK_SECRET_KEY)
  );
}

type AllowlistResult =
  | { readonly ok: true; readonly approved: ReadonlySet<string> }
  | { readonly ok: false; readonly reason: AccessDenyReason };

/**
 * Parse `FORTMARK_ALLOWED_CLERK_USER_IDS`. Accepts a JSON array of strings or
 * a comma/whitespace-separated list. Every entry must match the Clerk id
 * shape; a single malformed entry fails the whole config closed rather than
 * being silently dropped. Only digests are retained.
 */
export function parseAllowlist(raw: string | undefined | null): AllowlistResult {
  if (!nonEmpty(raw)) return { ok: false, reason: "allowlist_absent" };

  let items: unknown[];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { ok: false, reason: "allowlist_invalid_json" };
      }
      items = parsed;
    } catch {
      return { ok: false, reason: "allowlist_invalid_json" };
    }
  } else {
    items = trimmed.split(/[\s,]+/).filter((s) => s.length > 0);
  }

  if (items.length === 0) return { ok: false, reason: "allowlist_empty" };
  if (items.length > MAX_ALLOWED_USERS) {
    return { ok: false, reason: "allowlist_too_many" };
  }

  const approved = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string" || !CLERK_USER_ID_RE.test(item)) {
      return { ok: false, reason: "allowlist_invalid_identifier" };
    }
    approved.add(sha256Hex(item));
  }
  if (approved.size === 0) return { ok: false, reason: "allowlist_empty" };
  return { ok: true, approved };
}

/**
 * The full decision for a Clerk user id. Missing keys or a malformed
 * allowlist deny — there is no open fallback in any environment.
 */
export function decideAccess(
  clerkUserId: string | undefined | null,
  env: Record<string, string | undefined> = process.env
): AccessDecision {
  if (!hasClerkKeys(env)) return { ok: false, reason: "clerk_keys_absent" };
  if (!nonEmpty(clerkUserId)) return { ok: false, reason: "not_signed_in" };

  const list = parseAllowlist(env.FORTMARK_ALLOWED_CLERK_USER_IDS);
  if (!list.ok) return { ok: false, reason: list.reason };

  return list.approved.has(sha256Hex(clerkUserId))
    ? { ok: true }
    : { ok: false, reason: "not_approved" };
}

/**
 * True when the denial is a server misconfiguration rather than a statement
 * about this user. Callers use it to choose 503 over 401/403 so an operator
 * can tell "broken config" from "correctly refused".
 */
export function isConfigFailure(reason: AccessDenyReason): boolean {
  return reason !== "not_signed_in" && reason !== "not_approved";
}

/** Opaque, non-reversible reference for logging — never the raw Clerk id. */
export function userRef(clerkUserId: string | undefined | null): string {
  if (!nonEmpty(clerkUserId)) return "anon";
  return "u_" + sha256Hex(clerkUserId).slice(0, 12);
}
