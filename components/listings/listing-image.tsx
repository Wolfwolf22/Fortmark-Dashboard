"use client";

import * as React from "react";
import { FALLBACK_PLATE, assetPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Listing media, resolved against the dashboard zone's `basePath`.
 *
 * Every listing image goes through here so the basePath prefix is applied in
 * exactly one place. Raw `<img src>` is deliberate — the plates are local SVGs
 * that need no optimization, and `next/image` would add a loader for no gain.
 *
 * A load failure falls back once to a deterministic plate rather than leaving
 * a broken image; `alt` is preserved either way, so the accessible name never
 * depends on the media loading.
 */
export function ListingImage({
  src,
  alt,
  className,
}: {
  src: string | undefined;
  alt: string;
  className?: string;
}) {
  const initial = src || FALLBACK_PLATE;
  const [resolved, setResolved] = React.useState(initial);

  // A new listing must reset the fallback, or a previously failed card would
  // keep showing the plate after the data changes.
  React.useEffect(() => setResolved(src || FALLBACK_PLATE), [src]);

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- local SVG plates */
    <img
      src={assetPath(resolved)}
      alt={alt}
      className={cn("object-cover", className)}
      onError={() => {
        // Guard against a fallback that itself 404s looping forever.
        if (resolved !== FALLBACK_PLATE) setResolved(FALLBACK_PLATE);
      }}
    />
  );
}
