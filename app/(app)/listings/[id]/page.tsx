"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgent } from "@/lib/data/adapters/agents";
import { getListing } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import type { Agent, Listing } from "@/lib/data/types";
import { CompsStub } from "@/components/listings/comps-stub";
import { ListingGallery } from "@/components/listings/listing-gallery";
import { ListingSummary } from "@/components/listings/listing-summary";
import { PriceHistory } from "@/components/listings/price-history";

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const { data, loading } = useQuery<{
    listing: Listing | undefined;
    agent: Agent | undefined;
  }>(async () => {
    const listing = await getListing(id);
    const agent = listing ? await getAgent(listing.agentId) : undefined;
    return { listing, agent };
  }, [id]);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/listings">
          <ArrowLeft aria-hidden />
          Back to listings
        </Link>
      </Button>

      {loading || !data ? (
        <DetailSkeleton />
      ) : !data.listing ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Listing not found"
            description="This listing may have been removed, or the link is out of date."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/listings">Back to listings</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <DetailBody listing={data.listing} agent={data.agent} />
      )}
    </div>
  );
}

function DetailBody({
  listing,
  agent,
}: {
  listing: Listing;
  agent: Agent | undefined;
}) {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ListingGallery photos={listing.photos} address={listing.address} />
        </div>
        <div className="lg:col-span-2">
          <ListingSummary listing={listing} agent={agent} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-prose text-sm leading-relaxed">
            {listing.description}
          </p>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PriceHistory events={listing.priceHistory} />
        <CompsStub />
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <Skeleton className="aspect-[16/10] w-full rounded-card" />
          <div className="flex gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3] w-20 rounded-panel" />
            ))}
          </div>
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-9 w-44" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-2 gap-3 pt-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <Skeleton className="h-32 w-full rounded-card" />
    </>
  );
}
