"use client";

/**
 * The Home bento registry: one entry per widget, mapping id → component and
 * the grid span it occupies. Order lives in the layout store; span is fixed
 * here. Widget components live in `./widgets/` and receive no props — each
 * reads the shared metrics payload via `useHomeMetrics()`.
 *
 * `spanFor()` in `./widget-visibility` may narrow a span when a module's
 * content has collapsed to a status line; this file holds the span a module
 * takes when it has something to show.
 */
import { ComponentType } from "react";
import { WidgetId } from "@/lib/stores/layout";
import FeaturedListingWidget from "./widgets/featured-listing";
import ClosedVolumeWidget from "./widgets/closed-volume";
import ProjectedCommissionWidget from "./widgets/projected-commission";
import TransactionsTableWidget from "./widgets/transactions-table";
import LeadSourceWidget from "./widgets/lead-source";
import LeaderboardWidget from "./widgets/leaderboard";
import MarketPulseWidget from "./widgets/market-pulse";
import ComplianceWidget from "./widgets/compliance";

export interface WidgetDef {
  id: WidgetId;
  component: ComponentType;
  /** Tailwind col/row span classes for the bento grid. */
  spanClass: string;
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  // Beside the identity card's 4 columns, so both sit in the first viewport.
  compliance: {
    id: "compliance",
    component: ComplianceWidget,
    spanClass: "md:col-span-6 xl:col-span-8",
  },
  "transactions-table": {
    id: "transactions-table",
    component: TransactionsTableWidget,
    spanClass: "md:col-span-6 xl:col-span-8",
  },
  "market-pulse": {
    id: "market-pulse",
    component: MarketPulseWidget,
    spanClass: "md:col-span-3 xl:col-span-6",
  },
  "closed-volume": {
    id: "closed-volume",
    component: ClosedVolumeWidget,
    spanClass: "md:col-span-3 xl:col-span-6",
  },
  "projected-commission": {
    id: "projected-commission",
    component: ProjectedCommissionWidget,
    spanClass: "md:col-span-6 xl:col-span-6",
  },
  "lead-source": {
    id: "lead-source",
    component: LeadSourceWidget,
    spanClass: "md:col-span-3 xl:col-span-6",
  },
  leaderboard: {
    id: "leaderboard",
    component: LeaderboardWidget,
    spanClass: "md:col-span-6 xl:col-span-8",
  },
  "featured-listing": {
    id: "featured-listing",
    component: FeaturedListingWidget,
    spanClass: "md:col-span-6 xl:col-span-12",
  },
};
