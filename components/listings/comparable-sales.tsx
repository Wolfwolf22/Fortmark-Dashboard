"use client";

import Link from "next/link";
import { Scale, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getComparables } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import { pricePerSqft } from "@/lib/data/listing-sort";
import type { Listing } from "@/lib/data/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatSqft } from "./listing-meta";

/**
 * Closed sales comparable to the listing: same type, same city, closed in
 * the last six months, most recent first.
 *
 * A list of actual closed records, not a valuation. No adjustment grid, no
 * suggested price — those are analysis, and this card only reports what the
 * source holds. An empty result is stated as such rather than widened.
 */
export function ComparableSales({ listing }: { listing: Listing }) {
  const { data, loading, error, refetch } = useQuery(() => getComparables(listing.id), [listing.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparable sales</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <EmptyState
            icon={ServerCrash}
            title="Comparable sales could not be retrieved."
            description="The source is unavailable right now."
            action={
              <Button variant="outline" size="sm" onClick={refetch}>
                Retry
              </Button>
            }
          />
        ) : loading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No comparable sales in the last six months."
            description={`No ${listing.city} sales of this type closed in the window.`}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                  <TableHead className="text-right">Close price</TableHead>
                  <TableHead className="text-right">$/sqft</TableHead>
                  <TableHead className="text-right">Sqft</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((comp) => {
                  const ppsf =
                    comp.closedPrice !== undefined && comp.sqft > 0
                      ? comp.closedPrice / comp.sqft
                      : pricePerSqft(comp);
                  return (
                    <TableRow key={comp.id}>
                      <TableCell>
                        <Link href={`/listings/${comp.id}`} className="font-medium hover:underline">
                          {comp.address}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {comp.closedDate ? formatDate(comp.closedDate) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {comp.closedPrice !== undefined ? formatCurrency(comp.closedPrice) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {ppsf !== undefined ? formatCurrency(Math.round(ppsf)) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {comp.sqft > 0 ? formatSqft(comp.sqft) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
