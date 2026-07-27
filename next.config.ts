import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Listing media is served locally as SVG plates for now; the real MLS CDN
    // gets added to remotePatterns when the media adapter goes live.
    unoptimized: true,
    dangerouslyAllowSVG: true,
  },
};

export default nextConfig;
