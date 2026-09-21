"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchX, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ListingsError, searchListings } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import type { ListingSortKey, SortDirection } from "@/lib/data/types";
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
} from "@/components/listings/listing-table";
import {
  DEFAULT_LISTING_FILTER_STATE,
  LISTINGS_PAGE_SIZE,
  toListingFilters,
  type ListingFilterState,
} from "@/components/listings/listing-meta";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";

/** What the screen says for each coarse failure the routes can report. */
function failureCopy(error: Error): { title: string; description: string } {
  const code = error instanceof ListingsError ? error.code : "unknown";
  switch (code) {
    case "mls_not_configured":
      return {
        title: "The MLS connection is not configured.",
        description: "Listings are switched to the MLS but the credential is missing. An administrator needs to set it.",
      };
    case "mls_rejected_query":
      return {
        title: "The MLS rejected this search.",
        description: "One of the filters is not supported by this MLS. Clear the search text and try again.",
      };
    case "mls_rate_limited":
      return {
        title: "The MLS is asking us to slow down.",
        description: "Wait a moment and retry.",
      };
    case "mls_timeout":
      return {
        title: "The MLS did not answer in time.",
        description: "Retry in a moment. If it keeps happening the MLS may be having trouble.",
      };
    default:
      return {
        title: "Listings could not be retrieved.",
        description: "The MLS is unavailable right now. Retry in a moment.",
      };
  }
}

export default function ListingsPage() {
  const [filterState, setFilterState] = useState<ListingFilterState>(
    DEFAULT_LISTING_FILTER_STATE
  );
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [view, setView] = useState<ListingView>("grid");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<ListingSortKey>("listedDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Debounce the free-text search so the source isn't hit per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(filterState.query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [filterState.query]);

  // Sorting and paging are resolved by the source, so both are part of the
  // query rather than applied to a page already in hand.
  const { data, loading, error, refetch } = useQuery(
    () =>
      searchListings({
        ...toListingFilters(filterState, debouncedQuery),
        page,
        pageSize: LISTINGS_PAGE_SIZE,
        sortKey: view === "table" ? sortKey : "listedDate",
        sortDirection: view === "table" ? sortDirection : "desc",
      }),
    [
      filterState.status,
      filterState.propertyType,
      filterState.city,
      filterState.minBeds,
      filterState.minPrice,
      filterState.maxPrice,
      debouncedQuery,
      page,
      view,
      sortKey,
      sortDirection,
    ]
  );

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / LISTINGS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * LISTINGS_PAGE_SIZE;
  const rows = useMemo(() => data?.items ?? [], [data]);

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

      {data?.source === "sample" && <SampleDataNotice />}

      {firstLoad ? (
        <Skeleton className="h-4 w-24" />
      ) : error ? null : (
        <p className="text-[13px] text-muted-foreground tabular">
          {total} {total === 1 ? "listing" : "listings"}
          {data && !data.sortApplied && view === "table" && (
            <> · this MLS cannot sort by that column; rows are in the MLS&rsquo;s order</>
          )}
        </p>
      )}

      {error ? (
        <Card>
          <EmptyState
            icon={ServerCrash}
            title={failureCopy(error).title}
            description={failureCopy(error).description}
            action={
              <Button variant="outline" size="sm" onClick={refetch}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : firstLoad ? (
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
              <ListingGrid listings={rows} />
            ) : (
              <ListingTable
                listings={rows}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground tabular">
              Showing {start + 1}–{Math.min(start + rows.length, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1 || loading}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount || loading}
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
