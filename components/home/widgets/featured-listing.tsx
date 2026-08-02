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
 * The featured listing on Home. Since Release 1.1 this is a wide, short card
 * sitting between the commission chart and the transactions table — the
 * upper-left tile it used to occupy now belongs to the permanent identity card.
 *
 * The layout is horizontal from `sm` up: image on the left at a fixed ratio,
 * details beside it. It stacks on the narrowest screens so nothing overflows.
 * Period-independent; the whole body links to the listing detail page.
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
      className="group -m-2 flex flex-col gap-4 rounded-panel p-2 transition-colors duration-150 hover:bg-tint sm:flex-row sm:items-center sm:gap-5"
    >
      <div className="relative shrink-0 overflow-hidden rounded-panel sm:w-56 lg:w-64">
        <ListingImage
          src={listing.photos[0]}
          alt={listing.address}
          className="aspect-[16/10] w-full transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <StatusPill tone={pill.tone} className="absolute left-3 top-3 backdrop-blur-sm">
          {pill.label}
        </StatusPill>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-snug">{listing.address}</p>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {listing.city} · {listing.neighborhood}
            </p>
          </div>
          <p className="font-display text-2xl leading-none tabular">
            {formatCurrency(listing.listPrice)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-micro tabular">MLS {listing.mlsNumber}</span>
          <span className="text-micro tabular">
            {listing.daysOnMarket} {listing.daysOnMarket === 1 ? "day" : "days"} on market
          </span>
          {agent && (
            <span className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[9px]">{initials(agent.name)}</AvatarFallback>
              </Avatar>
              <span className="text-micro">{agent.name} · Listing agent</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
      <Skeleton className="aspect-[16/10] w-full shrink-0 rounded-panel sm:w-56 lg:w-64" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
