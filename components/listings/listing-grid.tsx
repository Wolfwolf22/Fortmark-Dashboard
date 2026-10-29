"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import type { Listing } from "@/lib/data/types";
import { formatCurrency } from "@/lib/utils";
import { specLine } from "./listing-meta";
import { ListingImage } from "@/components/listings/listing-image";

/** Responsive card grid — each card links to the listing detail page. */
export function ListingGrid({ listings }: { listings: Listing[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  const pill = LISTING_STATUS_PILL[listing.status] ?? {
    tone: "neutral" as const,
    label: listing.status,
  };

  return (
    <Link
      href={`/listings/${listing.id}`}
      aria-label={`Open listing ${listing.address}, ${listing.city}`}
      className="group block h-full rounded-card"
    >
      <Card className="flex h-full flex-col p-2 transition-shadow duration-150 group-hover:shadow-card-hover">
        <div className="relative overflow-hidden rounded-panel border border-border/60 bg-tint">
          <ListingImage
            src={listing.photos[0]}
            source={listing.source}
            alt={listing.address}
            className="aspect-[4/3] w-full motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.015]"
          />
          <StatusPill
            tone={pill.tone}
            className="absolute left-3 top-3 shadow-sm"
          >
            {pill.label}
          </StatusPill>
        </div>

        <div className="flex flex-1 flex-col px-3 pb-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 break-words text-[25px] font-semibold leading-tight tracking-[-0.035em] tabular">
              {formatCurrency(listing.listPrice)}
            </p>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
          </div>
          <p className="mt-2 break-words text-[15px] font-semibold leading-snug">{listing.address}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {listing.city}
            {listing.neighborhood && <> · {listing.neighborhood}</>}
          </p>
          {listing.agentRole && (
            <p className="mt-2 text-xs font-medium leading-relaxed text-muted-foreground">
              {listing.agentRole === "co_listing" ? "You · Co-listing agent" : "You · Listing agent"}
            </p>
          )}
          <div className="mt-auto pt-4">
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-[13px] font-medium leading-relaxed tabular">{specLine(listing)}</p>
              {listing.daysOnMarket !== undefined && (
                <p className="text-xs leading-relaxed text-muted-foreground tabular">
                  {listing.daysOnMarket}{" "}
                  {listing.daysOnMarket === 1 ? "day" : "days"} on market
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/** Skeleton matching the card grid layout. */
export function ListingGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="p-2">
          <Skeleton className="aspect-[4/3] w-full rounded-panel" />
          <div className="space-y-2 px-3 pb-3 pt-4">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
