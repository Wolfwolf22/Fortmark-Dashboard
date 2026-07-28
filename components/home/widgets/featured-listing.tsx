"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import { WidgetCard } from "@/components/widgets/widget-card";
import { getAgent } from "@/lib/data/adapters/agents";
import { getFeaturedListing } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import type { Agent, Listing } from "@/lib/data/types";
import { formatCurrency, initials } from "@/lib/utils";
import { ListingImage } from "@/components/listings/listing-image";

/**
 * The spotlight card on Home: the brokerage's featured listing with photo,
 * price, and listing agent. Period-independent; the whole body links to the
 * listing detail page.
 */
export default function FeaturedListingWidget() {
  const { data, loading, error } = useQuery<{
    listing: Listing | undefined;
    agent: Agent | undefined;
  }>(async () => {
    const listing = await getFeaturedListing();
    const agent = listing ? await getAgent(listing.agentId) : undefined;
    return { listing, agent };
  }, []);

  return (
    <WidgetCard
      icon={Building2}
      title="Featured listing"
      preset={null}
      expandable={false}
      contentClassName="flex flex-col"
    >
      {error ? (
        <p className="text-[13px] text-muted-foreground">
          The featured listing failed to load. Refresh the page to retry.
        </p>
      ) : loading || !data ? (
        <FeaturedSkeleton />
      ) : !data.listing ? (
        <EmptyState
          icon={Building2}
          title="No listing to feature"
          description="Add an active listing and it will be spotlighted here."
        />
      ) : (
        <FeaturedBody listing={data.listing} agent={data.agent} />
      )}
    </WidgetCard>
  );
}

function FeaturedBody({
  listing,
  agent,
}: {
  listing: Listing;
  agent: Agent | undefined;
}) {
  const pill = LISTING_STATUS_PILL[listing.status] ?? {
    tone: "neutral" as const,
    label: listing.status,
  };

  return (
    <Link
      href={`/listings/${listing.id}`}
      aria-label={`Open listing ${listing.address}`}
      className="group -m-2 flex flex-1 flex-col gap-4 rounded-panel p-2 transition-colors duration-150 hover:bg-tint"
    >
      <div className="relative overflow-hidden rounded-panel">
        <ListingImage
          src={listing.photos[0]}
          alt={listing.address}
          className="aspect-[4/3] w-full transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <StatusPill tone={pill.tone} className="absolute left-3 top-3 backdrop-blur-sm">
          {pill.label}
        </StatusPill>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div>
          <p className="text-lg font-bold leading-snug">{listing.address}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {listing.city} · {listing.neighborhood}
          </p>
        </div>

        <p className="font-display text-3xl leading-none tabular">
          {formatCurrency(listing.listPrice)}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-micro tabular">MLS {listing.mlsNumber}</span>
          <span className="text-micro tabular">Folio {listing.folioNumber}</span>
          <span className="text-micro tabular">
            {listing.daysOnMarket} {listing.daysOnMarket === 1 ? "day" : "days"} on market
          </span>
        </div>

        {agent && (
          <div className="mt-auto flex items-center gap-2.5 border-t border-border pt-3">
            <Avatar className="h-7 w-7">
              <AvatarFallback>{initials(agent.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{agent.name}</p>
              <p className="text-micro">Listing agent</p>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Skeleton className="aspect-[4/3] w-full rounded-panel" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="mt-auto flex items-center gap-2.5 border-t border-border pt-3">
        <Skeleton className="h-7 w-7 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}
