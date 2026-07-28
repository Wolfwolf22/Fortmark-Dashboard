import type { NextConfig } from "next";

/**
 * Multi-zone dashboard.
 *
 * This app is the `/dashboard` zone of `https://app.fortmark.net`. fortmark-app
 * rewrites `/dashboard` and `/dashboard/:path*` here, so every route, asset and
 * API path this app emits must already carry the `/dashboard` prefix — that is
 * exactly what `basePath` does.
 *
 * `basePath` automatically prefixes: the router, `next/link`, `next/image`,
 * route handlers, and `_next/*` asset URLs. It does NOT prefix hand-written
 * strings — raw `<img src="/…">`, `fetch("/api/…")`, CSS `url()`. Those use the
 * `assetPath()` / `apiPath()` helpers in `lib/base-path.ts`.
 *
 * Stack is deliberately pinned: Next 15 + Tailwind v3. Do not migrate to
 * Next 16 or Tailwind v4 — fortmark-app runs that stack, this zone does not.
 */
const BASE_PATH = "/dashboard";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,

  // Belt and braces behind the proxy: emit fully-prefixed asset URLs.
  // (basePath already covers `_next/*`; this keeps it explicit and stable.)
  images: {
    // Listing media is served locally as SVG plates for now; the real MLS CDN
    // gets added to remotePatterns when the media adapter goes live.
    unoptimized: true,
    dangerouslyAllowSVG: true,
  },

  // The canonical origin is app.fortmark.net. Discourage indexing of the raw
  // deployment URL and of the zone itself when reached directly.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  env: {
    NEXT_PUBLIC_DASHBOARD_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
