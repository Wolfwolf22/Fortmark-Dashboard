/**
 * Single source of truth for dashboard routing.
 *
 * The workspace is served under a Next.js `basePath` of `/dashboard`
 * (see `next.config.ts`), so Next prefixes `<Link href>`, `router.push`, and
 * `redirect()` automatically and `usePathname()` returns the path *without*
 * the prefix. That means in-app route strings stay unprefixed — do not write
 * `/dashboard/...` in components.
 *
 * The portal (landing + Clerk sign-in) is a different zone at the same
 * origin, so links to it must bypass the basePath and are therefore absolute.
 */

/** Mount point of the dashboard zone. Must match `basePath`. */
export const BASE_PATH = "/dashboard";

/** In-app routes, unprefixed — Next adds the basePath. */
export const ROUTES = {
  home: "/",
  onboarding: "/onboarding",
  transactions: "/transactions",
  listings: "/listings",
  listing: (id: string) => `/listings/${id}`,
  leads: "/leads",
  calendar: "/calendar",
  documents: "/documents",
  reports: "/reports",
  ai: "/ai",
  messages: "/messages",
  settings: "/settings",
} as const;

/**
 * Reduce an operator-configured value to a bare, safe origin.
 *
 * Returns null for anything it cannot vouch for, and never throws. That
 * matters because the result feeds `new URL(path, origin)` inside middleware:
 * an unvalidated value like `app.fortmark.net` (no scheme) or `ht!tp://nope`
 * makes that constructor throw, and a throw from middleware is
 * MIDDLEWARE_INVOCATION_FAILED — a 500 across the entire zone rather than the
 * redirect the visitor should have received.
 *
 * Rules, in order of what they defend against:
 *   - http/https only        — `javascript:` and `data:` can never become a
 *                              redirect target
 *   - hostname required      — rules out `https:///` and similar
 *   - no credentials         — `https://user:pass@host` is refused outright
 *                              rather than silently forwarded
 *   - origin only            — a configured path, query or fragment is dropped,
 *                              so `https://app.fortmark.net/dashboard` cannot
 *                              double the basePath into `/dashboard/dashboard`
 */
export function toSafeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * Canonical portal origin, or an empty string when none can be trusted.
 *
 * Falls back to the browser origin so local development works without extra
 * configuration; server code that needs an absolute URL should pass an
 * explicit origin. An empty return is a supported state, not a failure —
 * `signInUrl` degrades to a relative path that the caller resolves against the
 * request origin.
 */
export function portalOrigin(): string {
  const configured = toSafeOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Path of the portal's Clerk sign-in route (outside this zone's basePath). */
export const SIGN_IN_PATH =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL?.trim() || "/sign-in";

/**
 * A path is only safe to send a user back to if it is same-origin and
 * relative. Anything protocol-relative (`//evil.com`), absolute, or
 * backslash-obfuscated is rejected — this is the open-redirect guard.
 */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  // Backslashes are normalised to `/` by some agents, so `/\evil.com` can
  // escape the origin. Reject them outright.
  if (path.includes("\\")) return false;
  if (path.includes("://")) return false;
  return true;
}

/**
 * Absolute sign-in URL on the portal, carrying a validated return path so the
 * user lands back on the dashboard URL they originally asked for.
 *
 * `returnPath` is the full, basePath-included path (e.g. `/dashboard/leads`)
 * because Clerk redirects the browser, not the Next router.
 */
export function signInUrl(returnPath?: string | null): string {
  const origin = portalOrigin();
  const url = new URL(SIGN_IN_PATH, origin || "http://localhost:3000");
  if (isSafeReturnPath(returnPath)) {
    // Clerk reads this to return the user to where they were headed.
    url.searchParams.set("redirect_url", `${origin}${returnPath}`);
  }
  return origin ? url.toString() : `${SIGN_IN_PATH}${url.search}`;
}

/** Absolute URL of the dashboard home — the post-sign-in destination. */
export function dashboardUrl(): string {
  const origin = portalOrigin();
  return `${origin}${BASE_PATH}`;
}

/** Absolute URL of the portal landing page — the post-sign-out destination. */
export function portalUrl(): string {
  return portalOrigin() || "/";
}

/**
 * Prefixes a repo-root-relative public asset path with the zone `basePath`.
 *
 * Next rewrites `<Link href>`, `router.push()` and `next/image` automatically,
 * but a raw `<img src="/photos/…">` is emitted verbatim and resolves against
 * the origin root — which is the portal zone, not this one. Under
 * `basePath: "/dashboard"` that produced a 404 for every listing plate.
 *
 * Pass any already-absolute or data URL through untouched so remote MLS media
 * keeps working when the media adapter goes live.
 */
export function assetPath(src: string): string {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
  if (src.startsWith(`${BASE_PATH}/`)) return src;
  return src.startsWith("/") ? `${BASE_PATH}${src}` : src;
}

/**
 * Absolute path of a route handler, for use from the browser.
 *
 * The same basePath trap as `assetPath`, one layer down: route handlers are
 * served under `/dashboard`, but `fetch()` is not rewritten by Next the way
 * `<Link>` and `router.push()` are. A bare `fetch("/api/…")` resolves against
 * the origin root — the portal zone — and 404s. Verified against a running
 * server: `/api/chat` → 404, `/dashboard/api/chat` → 401.
 *
 * Every client-side fetch of a dashboard route handler must go through here.
 */
export function apiPath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

/** Deterministic plate shown when listing media is missing or fails to load. */
export const FALLBACK_PLATE = "/photos/plate-01.svg";
