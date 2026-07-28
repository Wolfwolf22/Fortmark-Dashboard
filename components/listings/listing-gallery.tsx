"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Detail-page gallery: one main image plus a thumbnail strip. Clicking a
 * thumbnail swaps the main image; the selected thumb carries a ring.
 */
export function ListingGallery({
  photos,
  address,
}: {
  photos: string[];
  address: string;
}) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const main = photos[safeIndex];

  if (!main) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-card bg-tint">
        <p className="text-[13px] text-muted-foreground">No photos yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG plates, no optimization needed */}
        <img
          src={main}
          alt={`Photo ${safeIndex + 1} of ${photos.length} for ${address}`}
          className="aspect-[16/10] w-full object-cover"
        />
      </div>

      {photos.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin"
          role="group"
          aria-label="Listing photos"
        >
          {photos.map((photo, i) => (
            <button
              key={photo}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1} of ${photos.length}`}
              aria-pressed={i === safeIndex}
              className={cn(
                "shrink-0 overflow-hidden rounded-panel transition-opacity duration-150",
                i === safeIndex
                  ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                  : "opacity-70 hover:opacity-100"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local SVG plates, no optimization needed */}
              <img
                src={photo}
                alt=""
                className="aspect-[4/3] w-20 object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
