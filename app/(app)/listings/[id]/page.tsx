"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgent } from "@/lib/data/adapters/agents";
import { getListing } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import type { Agent, Listing } from "@/lib/data/types";
import { ComparableSales } from "@/components/listings/comparable-sales";
import { ListingGallery } from "@/components/listings/listing-gallery";
import { ListingSummary } from "@/components/listings/listing-summary";
import { PriceHistory } from "@/components/listings/price-history";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const { data, loading, error, refetch } = useQuery<{
    listing: Listing | undefined;
    agent: Agent | undefined;
  }>(async () => {
    const listing = await getListing(id);
    // The sample roster only applies to sample rows; an MLS row states its
    // own agent on the record (see `listingAgent`).
    const agent = listing?.agentId ? await getAgent(listing.agentId) : undefined;
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

      {error ? (
        <Card>
          <EmptyState
            icon={ServerCrash}
            title="This listing could not be retrieved."
            description="The MLS is unavailable right now. Retry in a moment."
            action={
              <Button variant="outline" size="sm" onClick={refetch}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : loading || !data ? (
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
      {listing.source === "sample" && <SampleDataNotice />}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ListingGallery
            photos={listing.photos}
            address={listing.address}
            source={listing.source}
          />
        </div>
        <div className="lg:col-span-2">
          <ListingSummary listing={listing} agent={agent} />
        </div>
      </div>

      {listing.description ? (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed">
              {listing.description}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PriceHistory events={listing.priceHistory} />
        <ComparableSales listing={listing} />
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
