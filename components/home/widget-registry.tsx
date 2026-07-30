"use client";

/**
 * The Home bento registry: one entry per widget, mapping id → component and
 * grid span. Order comes from the layout store (drag-reorderable); spans are
 * fixed here. Widget components live in `./widgets/` and receive no props —
 * each reads its period via `useWidgetPeriod(id)`.
 */
import type { ComponentType } from "react";
import { WidgetId } from "@/lib/stores/layout";
import FeaturedListingWidget from "./widgets/featured-listing";
import UnderContractWidget from "./widgets/under-contract";
import ClosedWidget from "./widgets/closed";
import PipelineValueWidget from "./widgets/pipeline-value";
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
  "featured-listing": {
    id: "featured-listing",
    component: FeaturedListingWidget,
    // Wide and short since Release 1.1: it sits below the commission chart
    // rather than in the upper-left tile the identity card now owns.
    spanClass: "md:col-span-6 xl:col-span-12",
  },
  "under-contract": {
    id: "under-contract",
    component: UnderContractWidget,
    spanClass: "md:col-span-3 xl:col-span-4",
  },
  closed: {
    id: "closed",
    component: ClosedWidget,
    spanClass: "md:col-span-3 xl:col-span-4",
  },
  "pipeline-value": {
    id: "pipeline-value",
    component: PipelineValueWidget,
    spanClass: "md:col-span-3 xl:col-span-4",
  },
  "closed-volume": {
    id: "closed-volume",
    component: ClosedVolumeWidget,
    spanClass: "md:col-span-3 xl:col-span-4",
  },
  "projected-commission": {
    id: "projected-commission",
    component: ProjectedCommissionWidget,
    spanClass: "md:col-span-6 xl:col-span-8",
  },
  "transactions-table": {
    id: "transactions-table",
    component: TransactionsTableWidget,
    spanClass: "md:col-span-6 xl:col-span-12",
  },
  "lead-source": {
    id: "lead-source",
    component: LeadSourceWidget,
    spanClass: "md:col-span-3 xl:col-span-4",
  },
  leaderboard: {
    id: "leaderboard",
    component: LeaderboardWidget,
    spanClass: "md:col-span-6 xl:col-span-8",
  },
  "market-pulse": {
    id: "market-pulse",
    component: MarketPulseWidget,
    spanClass: "md:col-span-3 xl:col-span-6",
  },
  compliance: {
    id: "compliance",
    component: ComplianceWidget,
    spanClass: "md:col-span-3 xl:col-span-6",
  },
};
