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
    // Unchanged: optimization stays off as before (sample plates are SVG).
    // The MLS CDN is declared in remotePatterns below so turning optimization
    // on later does not break live photos.
    unoptimized: true,
    dangerouslyAllowSVG: true,
    /**
     * Profile photos on Vercel Blob.
     *
     * Narrow on purpose: one host family, HTTPS only, and scoped to the
     * `profile-images/` prefix this application writes. No wildcard broad
     * enough to admit an arbitrary internet host.
     *
     * Note that `unoptimized: true` above means the optimizer — and therefore
     * this allowlist — is currently bypassed, and profile photos render
     * through Radix's plain `<img>` in the avatar rather than `next/image`.
     * This is declared now so that turning optimization on later does not
     * silently break profile images, and so the intended boundary is written
     * down rather than implied. It is NOT what makes uploads safe: the upload
     * route rejects anything that is not JPEG, PNG or WebP by inspecting the
     * bytes, so no SVG can reach this host through us regardless of
     * `dangerouslyAllowSVG`.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/profile-images/**",
      },
      /**
       * MLS listing photos. Bridge serves `miamire` media from this one
       * CloudFront distribution (observed 2026-09-22 on the Property `Media`
       * collection). An exact host, HTTPS only — never a wildcard CloudFront
       * pattern, which would admit any distribution on the internet.
       */
      {
        protocol: "https",
        hostname: "dvvjkgh94f2v6.cloudfront.net",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
