"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListingStatus, PropertyType } from "@/lib/data/types";
import {
  LISTING_CITIES,
  LISTING_STATUS_OPTIONS,
  MIN_BEDS_OPTIONS,
  PRICE_STEPS,
  PROPERTY_TYPE_OPTIONS,
  isListingFilterStateDefault,
  type ListingFilterState,
} from "./listing-meta";

export type ListingView = "grid" | "table";

/**
 * The full filter row for the Listings index: search, status, type, city,
 * beds, price band, a clear button when anything is active, and the
 * grid/table view toggle.
 */
export function ListingFiltersRow({
  state,
  onChange,
  onClear,
  view,
  onViewChange,
}: {
  state: ListingFilterState;
  onChange: (patch: Partial<ListingFilterState>) => void;
  onClear: () => void;
  view: ListingView;
  onViewChange: (view: ListingView) => void;
}) {
  const filtered = !isListingFilterStateDefault(state);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={state.query}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder="Search address, MLS, or neighborhood"
          aria-label="Search listings"
          className="pl-9"
        />
      </div>

      <Select
        value={state.status}
        onValueChange={(v) => onChange({ status: v as "all" | ListingStatus })}
      >
        <SelectTrigger className="w-[150px]" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {LISTING_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.propertyType}
        onValueChange={(v) =>
          onChange({ propertyType: v as "all" | PropertyType })
        }
      >
        <SelectTrigger className="w-[140px]" aria-label="Filter by property type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {PROPERTY_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={state.city} onValueChange={(v) => onChange({ city: v })}>
        <SelectTrigger className="w-[160px]" aria-label="Filter by city">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All cities</SelectItem>
          {LISTING_CITIES.map((city) => (
            <SelectItem key={city} value={city}>
              {city}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.minBeds}
        onValueChange={(v) =>
          onChange({ minBeds: v as ListingFilterState["minBeds"] })
        }
      >
        <SelectTrigger className="w-[110px]" aria-label="Filter by minimum beds">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MIN_BEDS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.minPrice}
        onValueChange={(v) => onChange({ minPrice: v })}
      >
        <SelectTrigger className="w-[110px]" aria-label="Filter by minimum price">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">No min</SelectItem>
          {PRICE_STEPS.map((step) => (
            <SelectItem key={step.value} value={String(step.value)}>
              {step.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.maxPrice}
        onValueChange={(v) => onChange({ maxPrice: v })}
      >
        <SelectTrigger className="w-[110px]" aria-label="Filter by maximum price">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">No max</SelectItem>
          {PRICE_STEPS.map((step) => (
            <SelectItem key={step.value} value={String(step.value)}>
              {step.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered && (
        <Button variant="muted" size="sm" onClick={onClear}>
          <X aria-hidden />
          Clear filters
        </Button>
      )}

      <div className="ml-auto">
        <Segmented
          ariaLabel="Listing view"
          value={view}
          onChange={onViewChange}
          options={[
            { value: "grid", label: "Grid" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>
    </div>
  );
}
