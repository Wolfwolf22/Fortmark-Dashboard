"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PropertyReviewFilter, PropertySort } from "@/lib/contacts/property-research";
import { PROPERTY_SORTS, REVIEW_FILTERS } from "./research";

export function PropertyResearchFilters({ reviewStatus, sort, onReviewStatus, onSort }: { reviewStatus: PropertyReviewFilter; sort: PropertySort; onReviewStatus: (value: PropertyReviewFilter) => void; onSort: (value: PropertySort) => void }) {
  const prefix = useId();
  return <div className="grid min-w-0 gap-3 rounded-panel border border-border bg-card p-3 sm:grid-cols-2 sm:p-4 lg:max-w-2xl"><div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-review`} className="text-xs">Your review</Label><Select value={reviewStatus} onValueChange={onReviewStatus}><SelectTrigger id={`${prefix}-review`} className="h-10 min-w-0"><SelectValue /></SelectTrigger><SelectContent>{REVIEW_FILTERS.map((item) => <SelectItem key={item.value} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectContent></Select></div><div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-sort`} className="text-xs">Sort properties</Label><Select value={sort} onValueChange={onSort}><SelectTrigger id={`${prefix}-sort`} className="h-10 min-w-0"><SelectValue /></SelectTrigger><SelectContent>{PROPERTY_SORTS.map((item) => <SelectItem key={item.value} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectContent></Select></div></div>;
}
