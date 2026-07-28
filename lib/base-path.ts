/**
 * basePath helpers.
 *
 * Next prefixes the router, `next/link`, `next/image` and `_next/*` with
 * `basePath` automatically. It does NOT prefix hand-written URL strings, so any
 * raw `<img src>`, `fetch()` target or CSS `url()` must go through here or it
 * will 404 behind the `/dashboard` rewrite.
 *
 * The value is inlined at build time from `next.config.ts`, so this works
 * identically on the server and in the browser.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_DASHBOARD_BASE_PATH ?? "/dashboard";

/** Prefix a public/ asset path: `/brand/x.png` → `/dashboard/brand/x.png`. */
export function assetPath(path: string): string {
  if (!path.startsWith("/")) return `${BASE_PATH}/${path}`;
  return `${BASE_PATH}${path}`;
}

/** Prefix an in-zone API path: `/api/chat` → `/dashboard/api/chat`. */
export function apiPath(path: string): string {
  return assetPath(path);
}
