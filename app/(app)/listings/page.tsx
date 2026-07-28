"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getListings } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import { cn } from "@/lib/utils";
import {
  ListingFiltersRow,
  type ListingView,
} from "@/components/listings/listing-filters";
import {
  ListingGrid,
  ListingGridSkeleton,
} from "@/components/listings/listing-grid";
import {
  ListingTable,
  ListingTableSkeleton,
  sortListings,
  type ListingSortKey,
  type SortDirection,
} from "@/components/listings/listing-table";
import {
  DEFAULT_LISTING_FILTER_STATE,
  LISTINGS_PAGE_SIZE,
  toListingFilters,
  type ListingFilterState,
} from "@/components/listings/listing-meta";

export default function ListingsPage() {
  const [filterState, setFilterState] = useState<ListingFilterState>(
    DEFAULT_LISTING_FILTER_STATE
  );
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [view, setView] = useState<ListingView>("grid");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<ListingSortKey>("listedDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Debounce the free-text search so the adapter isn't hit per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(filterState.query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [filterState.query]);

  const { data, loading } = useQuery(
    () => getListings(toListingFilters(filterState, debouncedQuery)),
    [
      filterState.status,
      filterState.propertyType,
      filterState.city,
      filterState.minBeds,
      filterState.minPrice,
      filterState.maxPrice,
      debouncedQuery,
    ]
  );

  const sorted = useMemo(() => {
    if (!data) return [];
    return view === "table" ? sortListings(data, sortKey, sortDirection) : data;
  }, [data, view, sortKey, sortDirection]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / LISTINGS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * LISTINGS_PAGE_SIZE;
  const pageRows = sorted.slice(start, start + LISTINGS_PAGE_SIZE);

  const patchFilters = (patch: Partial<ListingFilterState>) => {
    setFilterState((s) => ({ ...s, ...patch }));
    // The query field resets the page via its debounce instead.
    if (!("query" in patch)) setPage(1);
  };

  const clearFilters = () => {
    setFilterState(DEFAULT_LISTING_FILTER_STATE);
    setDebouncedQuery("");
    setPage(1);
  };

  const handleSort = (key: ListingSortKey) => {
    if (key === sortKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "listedDate" ? "desc" : "asc");
    }
    setPage(1);
  };

  const firstLoad = loading && data === undefined;

  return (
    <div className="space-y-4">
      <ListingFiltersRow
        state={filterState}
        onChange={patchFilters}
        onClear={clearFilters}
        view={view}
        onViewChange={(v) => {
          setView(v);
          setPage(1);
        }}
      />

      {firstLoad ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <p className="text-[13px] text-muted-foreground tabular">
          {total} {total === 1 ? "listing" : "listings"}
        </p>
      )}

      {firstLoad ? (
        view === "grid" ? (
          <ListingGridSkeleton />
        ) : (
          <ListingTableSkeleton />
        )
      ) : total === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title="No listings match these filters."
            description="Clear one or two and try again."
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div
            className={cn(
              "transition-opacity duration-150",
              loading && "opacity-60"
            )}
          >
            {view === "grid" ? (
              <ListingGrid listings={pageRows} />
            ) : (
              <ListingTable
                listings={pageRows}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground tabular">
              Showing {start + 1}–{Math.min(start + LISTINGS_PAGE_SIZE, total)}{" "}
              of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
