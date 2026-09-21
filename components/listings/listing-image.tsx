"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
import { FALLBACK_PLATE, assetPath } from "@/lib/routes";
import type { ListingSource } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * Listing media, resolved against the dashboard zone's `basePath`.
 *
 * Every listing image goes through here so the basePath prefix is applied in
 * exactly one place. Raw `<img src>` is deliberate: the sample plates are
 * local SVGs, MLS media is served from the feed's CDN with its own caching,
 * and image optimization is off globally in `next.config.ts` — routing these
 * through `next/image` would add a loader for no gain.
 *
 * Fallback differs by source. A SAMPLE row that fails to load falls back to a
 * deterministic drawn plate, which is what the sample set is made of. An MLS
 * row must never be shown a drawn house in place of the property, so a
 * missing or broken MLS photo shows a neutral "no photo" tile instead.
 * `alt` is preserved either way.
 */
export function ListingImage({
  src,
  alt,
  className,
  source = "sample",
}: {
  src: string | undefined;
  alt: string;
  className?: string;
  source?: ListingSource;
}) {
  const initial = src || (source === "sample" ? FALLBACK_PLATE : undefined);
  const [resolved, setResolved] = React.useState<string | undefined>(initial);

  // A new listing must reset the fallback, or a previously failed card would
  // keep showing the plate after the data changes.
  React.useEffect(
    () => setResolved(src || (source === "sample" ? FALLBACK_PLATE : undefined)),
    [src, source]
  );

  if (!resolved) {
    return (
      <div
        role="img"
        aria-label={alt ? `No photo available for ${alt}` : "No photo available"}
        className={cn("flex items-center justify-center bg-tint text-muted-foreground", className)}
      >
        <ImageOff className="h-5 w-5" aria-hidden />
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- local plates and feed CDN media */
    <img
      src={assetPath(resolved)}
      alt={alt}
      className={cn("object-cover", className)}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        // Sample: fall back once to the plate (guarding a plate that itself
        // 404s). MLS: give up on the URL and show the neutral tile.
        if (source === "sample") {
          if (resolved !== FALLBACK_PLATE) setResolved(FALLBACK_PLATE);
        } else {
          setResolved(undefined);
        }
      }}
    />
  );
}
