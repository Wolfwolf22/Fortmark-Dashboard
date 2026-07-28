"use client";

import Link from "next/link";
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
      <Card className="flex h-full flex-col p-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
        <div className="relative overflow-hidden rounded-panel">
          <ListingImage
            src={listing.photos[0]}
            alt={listing.address}
            className="aspect-[4/3] w-full transition-transform duration-200 group-hover:scale-[1.02]"
          />
          <StatusPill
            tone={pill.tone}
            className="absolute left-3 top-3 backdrop-blur-sm"
          >
            {pill.label}
          </StatusPill>
        </div>

        <div className="flex flex-1 flex-col gap-0.5 px-2 pb-2 pt-3">
          <p className="text-lg font-bold leading-snug tabular">
            {formatCurrency(listing.listPrice)}
          </p>
          <p className="text-sm font-semibold leading-snug">{listing.address}</p>
          <p className="text-[13px] text-muted-foreground">
            {listing.city} · {listing.neighborhood}
          </p>
          <div className="mt-auto space-y-0.5 pt-2">
            <p className="text-micro tabular">{specLine(listing)}</p>
            <p className="text-[12px] text-muted-foreground tabular">
              {listing.daysOnMarket}{" "}
              {listing.daysOnMarket === 1 ? "day" : "days"} on market
            </p>
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
        <Card key={i} className="p-3">
          <Skeleton className="aspect-[4/3] w-full rounded-panel" />
          <div className="space-y-2 px-2 pb-2 pt-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </Card>
      ))}
    </div>
  );
}
