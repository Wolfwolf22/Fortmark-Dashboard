"use client";

/**
 * Which widgets the grid renders, and how wide.
 *
 * Both decisions became necessary the moment the data became real. With the
 * generators in place every card always had something to show, so a fixed
 * layout was fine. Now two cards can be permanently empty for a given reader —
 * an agent is never shown a brokerage leaderboard, and the MLS is not
 * connected — and a full-width panel that says "not available" is the loudest
 * element on a quiet page.
 *
 * So: a module with nothing to say for this reader is not rendered at all, and
 * a module whose content has collapsed to a status line takes the space of a
 * status line.
 *
 * This hides presentation, never facts. The metrics payload still carries
 * every availability, `/api/health` still reports every source, and no figure
 * is invented or suppressed — a zero is still shown as a zero.
 */
import type { BrokerageMetrics } from "@/lib/metrics/types";
import { leaderboardVisible, mlsIsCompact } from "@/lib/metrics/home-layout";
import type { WidgetId } from "@/lib/stores/layout";
import { WIDGETS } from "./widget-registry";

export function visibleWidgets(
  order: readonly WidgetId[],
  metrics: BrokerageMetrics | undefined
): WidgetId[] {
  // Before the payload arrives, render the layout that does not depend on it,
  // so the grid does not visibly reshuffle when metrics land.
  return order.filter((id) => (id === "leaderboard" ? leaderboardVisible(metrics) : true));
}

/** A status line takes the room of a status line. */
const MLS_COMPACT_SPAN = "md:col-span-3 xl:col-span-4";

export function spanFor(id: WidgetId, metrics: BrokerageMetrics | undefined): string {
  if (id === "featured-listing" && mlsIsCompact(metrics)) return MLS_COMPACT_SPAN;
  return WIDGETS[id].spanClass;
}
