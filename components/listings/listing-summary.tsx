"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import type { Agent, Listing } from "@/lib/data/types";
import { formatCurrency, formatDate, initials } from "@/lib/utils";
import { PROPERTY_TYPE_LABELS, formatSqft } from "./listing-meta";

/**
 * The right-hand summary panel on the listing detail page: status, price,
 * address, key specs, and the listing agent.
 */
export function ListingSummary({
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
  const isClosed = listing.status === "closed" && listing.closedPrice !== undefined;

  const specs: { label: string; value: string }[] = [
    { label: "Beds", value: listing.beds > 0 ? String(listing.beds) : "—" },
    { label: "Baths", value: listing.baths > 0 ? String(listing.baths) : "—" },
    {
      label: "Sqft",
      value: listing.sqft > 0 ? formatSqft(listing.sqft) : "—",
    },
    {
      label: "Lot sqft",
      value: listing.lotSqft ? formatSqft(listing.lotSqft) : "—",
    },
    { label: "Year built", value: String(listing.yearBuilt) },
    { label: "Type", value: PROPERTY_TYPE_LABELS[listing.propertyType] },
    { label: "MLS", value: listing.mlsNumber },
    { label: "Folio", value: listing.folioNumber },
    { label: "Days on market", value: String(listing.daysOnMarket) },
    { label: "Listed", value: formatDate(listing.listedDate) },
  ];

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex items-center gap-2">
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </div>

        <div>
          {isClosed ? (
            <>
              <p className="text-micro">Closed price</p>
              <p className="mt-1 text-3xl font-bold leading-none tabular">
                {formatCurrency(listing.closedPrice as number)}
              </p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                Listed at{" "}
                <span className="line-through tabular">
                  {formatCurrency(listing.listPrice)}
                </span>
                {listing.closedDate && <> · closed {formatDate(listing.closedDate)}</>}
              </p>
            </>
          ) : (
            <>
              <p className="text-micro">List price</p>
              <p className="mt-1 text-3xl font-bold leading-none tabular">
                {formatCurrency(listing.listPrice)}
              </p>
            </>
          )}
        </div>

        <div>
          <h2 className="text-display text-2xl">{listing.address}</h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {listing.city}, FL {listing.zip} · {listing.neighborhood}
          </p>
        </div>

        <Separator />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {specs.map((spec) => (
            <div key={spec.label}>
              <dt className="text-micro">{spec.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular">
                {spec.value}
              </dd>
            </div>
          ))}
        </dl>

        {agent && (
          <>
            <Separator />
            <div>
              <p className="text-micro">Listing agent</p>
              <div className="mt-2.5 flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{initials(agent.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{agent.name}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    <a
                      href={`tel:${agent.phone}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {agent.phone}
                    </a>
                    {" · "}
                    <a
                      href={`mailto:${agent.email}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {agent.email}
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
