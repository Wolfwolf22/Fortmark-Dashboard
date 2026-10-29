"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import type { ListingSource } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { ListingImage } from "@/components/listings/listing-image";

/** Framed listing media, with a contained full-screen view of the source photo. */
export function ListingGallery({
  photos,
  address,
  source = "sample",
}: {
  photos: string[];
  address: string;
  source?: ListingSource;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const safeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const main = photos[safeIndex];
  const move = (direction: -1 | 1) => {
    setIndex((current) => (Math.min(current, photos.length - 1) + direction + photos.length) % photos.length);
  };

  if (!main) {
    return (
      <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-card border border-border bg-card p-5 text-center shadow-card">
        <IconWell icon={ImageOff} />
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {source === "mls" ? "The MLS has no photos for this listing" : "No photos yet"}
        </p>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="space-y-3 rounded-card border border-border/70 bg-card p-2 shadow-card dark:border-border">
        <DialogTrigger asChild>
          <button
            type="button"
            className="group relative block w-full overflow-hidden rounded-panel bg-tint text-left"
            aria-label={`Open photo gallery for ${address}`}
          >
            <ListingImage
              src={main}
              alt={`Photo ${safeIndex + 1} of ${photos.length} for ${address}`}
              source={source}
              loading="eager"
              className="aspect-[16/10] w-full"
            />
            <span className="absolute bottom-3 right-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-sm">
              <Expand className="h-3.5 w-3.5" aria-hidden />
              View photos
              <span className="border-l border-border pl-2 font-medium tabular">{safeIndex + 1} / {photos.length}</span>
            </span>
          </button>
        </DialogTrigger>

        {photos.length > 1 && (
          <ThumbnailStrip photos={photos} index={safeIndex} onSelect={setIndex} source={source} />
        )}
      </div>

      <DialogContent
        hideClose
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0"
        onKeyDown={(event) => {
          if (photos.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold leading-snug">{address}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">{source === "sample" ? "Sample listing photos" : "Listing photos"}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Close photo gallery">
              <X aria-hidden />
            </Button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 bg-background p-3 sm:p-6">
          <ListingImage
            src={main}
            alt={`Photo ${safeIndex + 1} of ${photos.length} for ${address}`}
            source={source}
            loading="eager"
            className="h-full w-full object-contain"
          />
        </div>

        <div className="shrink-0 border-t border-border px-4 pb-3 pt-2 sm:px-6 sm:pb-4">
          <div className="mb-2 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3">
            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => move(-1)} disabled={photos.length < 2} aria-label="Previous photo">
              <ChevronLeft aria-hidden />
            </Button>
            <p className="text-center text-[13px] font-medium tabular" role="status" aria-live="polite" aria-atomic="true">
              Photo {safeIndex + 1} of {photos.length}
            </p>
            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => move(1)} disabled={photos.length < 2} aria-label="Next photo">
              <ChevronRight aria-hidden />
            </Button>
          </div>
          {photos.length > 1 && (
            <ThumbnailStrip photos={photos} index={safeIndex} onSelect={setIndex} source={source} viewer />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThumbnailStrip({ photos, index, onSelect, source, viewer = false }: {
  photos: string[];
  index: number;
  onSelect: (index: number) => void;
  source: ListingSource;
  viewer?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const container = strip.current;
    const photo = selected.current;
    if (!container || !photo) return;
    const frame = container.getBoundingClientRect();
    const thumb = photo.getBoundingClientRect();
    if (thumb.left < frame.left || thumb.right > frame.right) {
      // Move only this strip, never the background page behind the viewer.
      container.scrollBy({ left: thumb.left - frame.left - (frame.width - thumb.width) / 2, behavior: "auto" });
    }
  }, [index]);

  return (
    <div ref={strip} className="flex gap-2 overflow-x-auto p-1 [scrollbar-width:thin]" role="group" aria-label={viewer ? "All listing photos" : "Listing photos"}>
      {photos.map((photo, i) => (
        <button
          key={`${photo}-${i}`}
          ref={i === index ? selected : undefined}
          type="button"
          onClick={() => onSelect(i)}
          aria-label={`Show photo ${i + 1} of ${photos.length}`}
          aria-pressed={i === index}
          className={cn(
            "h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 p-0.5 transition-colors duration-150 sm:h-16 sm:w-24",
            i === index ? "border-foreground" : "border-transparent hover:border-input"
          )}
        >
          <ListingImage src={photo} alt="" source={source} className="h-full w-full rounded-md" />
        </button>
      ))}
    </div>
  );
}
