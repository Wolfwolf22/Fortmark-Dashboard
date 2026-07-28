"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Listing } from "@/lib/data/types";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  LISTING_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  formatSqft,
  pricePerSqft,
} from "./listing-meta";

export type ListingSortKey =
  | "address"
  | "city"
  | "status"
  | "propertyType"
  | "listPrice"
  | "beds"
  | "baths"
  | "sqft"
  | "ppsf"
  | "daysOnMarket"
  | "listedDate";

export type SortDirection = "asc" | "desc";

function sortValue(listing: Listing, key: ListingSortKey): string | number {
  switch (key) {
    case "address":
      return listing.address.toLowerCase();
    case "city":
      return listing.city.toLowerCase();
    case "status":
      return LISTING_STATUS_LABELS[listing.status];
    case "propertyType":
      return PROPERTY_TYPE_LABELS[listing.propertyType];
    case "listPrice":
      return listing.listPrice;
    case "beds":
      return listing.beds;
    case "baths":
      return listing.baths;
    case "sqft":
      return listing.sqft;
    case "ppsf":
      return pricePerSqft(listing) ?? 0;
    case "daysOnMarket":
      return listing.daysOnMarket;
    case "listedDate":
      return new Date(listing.listedDate).getTime();
  }
}

/** Stable client-side sort used by the table view. */
export function sortListings(
  rows: Listing[],
  key: ListingSortKey,
  direction: SortDirection
): Listing[] {
  const mult = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (typeof va === "string" && typeof vb === "string") {
      return va.localeCompare(vb) * mult;
    }
    return ((va as number) - (vb as number)) * mult;
  });
}

const COLUMNS: {
  key: ListingSortKey;
  label: string;
  numeric?: boolean;
}[] = [
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "status", label: "Status" },
  { key: "propertyType", label: "Type" },
  { key: "listPrice", label: "Price", numeric: true },
  { key: "beds", label: "Beds", numeric: true },
  { key: "baths", label: "Baths", numeric: true },
  { key: "sqft", label: "Sqft", numeric: true },
  { key: "ppsf", label: "$/sqft", numeric: true },
  { key: "daysOnMarket", label: "DOM", numeric: true },
  { key: "listedDate", label: "Listed", numeric: true },
];

/**
 * Table view of the listings index. Sorting is controlled by the page so
 * pagination stays consistent across view switches.
 */
export function ListingTable({
  listings,
  sortKey,
  sortDirection,
  onSort,
}: {
  listings: Listing[];
  sortKey: ListingSortKey;
  sortDirection: SortDirection;
  onSort: (key: ListingSortKey) => void;
}) {
  const router = useRouter();

  return (
    <Card className="px-6 py-2">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((column) => (
              <TableHead
                key={column.key}
                className={cn(column.numeric && "text-right")}
              >
                <button
                  type="button"
                  onClick={() => onSort(column.key)}
                  aria-label={`Sort by ${column.label.toLowerCase()}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-sm text-micro transition-colors hover:text-foreground",
                    sortKey === column.key && "text-foreground"
                  )}
                >
                  {column.label}
                  {sortKey === column.key ? (
                    sortDirection === "asc" ? (
                      <ArrowUp className="h-3 w-3" aria-hidden />
                    ) : (
                      <ArrowDown className="h-3 w-3" aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
                  )}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const pill = LISTING_STATUS_PILL[listing.status] ?? {
              tone: "neutral" as const,
              label: listing.status,
            };
            const ppsf = pricePerSqft(listing);
            return (
              <TableRow
                key={listing.id}
                className="cursor-pointer"
                onClick={() => router.push(`/listings/${listing.id}`)}
              >
                <TableCell className="max-w-[220px]">
                  <Link
                    href={`/listings/${listing.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-semibold hover:underline"
                  >
                    {listing.address}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {listing.city}
                </TableCell>
                <TableCell>
                  <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {PROPERTY_TYPE_LABELS[listing.propertyType]}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular">
                  {formatCurrency(listing.listPrice)}
                </TableCell>
                <TableCell className="text-right tabular">
                  {listing.beds > 0 ? listing.beds : "—"}
                </TableCell>
                <TableCell className="text-right tabular">
                  {listing.baths > 0 ? listing.baths : "—"}
                </TableCell>
                <TableCell className="text-right tabular">
                  {listing.sqft > 0 ? formatSqft(listing.sqft) : "—"}
                </TableCell>
                <TableCell className="text-right tabular">
                  {ppsf !== undefined ? formatCurrency(ppsf) : "—"}
                </TableCell>
                <TableCell className="text-right tabular">
                  {listing.daysOnMarket}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-muted-foreground tabular">
                  {formatDate(listing.listedDate)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Skeleton matching the table layout. */
export function ListingTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="space-y-3 px-6 py-5">
      <Skeleton className="h-4 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </Card>
  );
}
