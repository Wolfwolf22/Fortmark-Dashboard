import type { NextConfig } from "next";

/**
 * The dashboard is one zone of the FortMark portal. It is served at
 * `https://app.fortmark.net/dashboard` via a rewrite from the portal app, so
 * it runs under a `basePath` of `/dashboard`.
 *
 * With `basePath` set, Next prefixes `<Link href>`, `router.push()`, and
 * `redirect()` automatically, and `usePathname()` returns the path *without*
 * the prefix — so in-app route strings stay unprefixed (see `lib/routes.ts`).
 */
const nextConfig: NextConfig = {
  basePath: "/dashboard",
  images: {
    // Listing media is served locally as SVG plates for now; the real MLS CDN
    // gets added to remotePatterns when the media adapter goes live.
    unoptimized: true,
    dangerouslyAllowSVG: true,
  },
};

export default nextConfig;
