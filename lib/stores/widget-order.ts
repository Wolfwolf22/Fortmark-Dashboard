/**
 * The canonical Home widget order.
 *
 * Extracted from `layout.ts` so it can be imported without pulling in Zustand
 * or the `@/` path alias — the test runner is plain Node with type stripping and
 * resolves neither. Same reason `lib/profile/roles.ts` is separate.
 *
 * The permanent Home identity card is deliberately NOT in this list. It is
 * rendered outside the sortable context, so it has no id here to reorder,
 * persist, or drag.
 */
export const DEFAULT_WIDGET_ORDER = [
  "under-contract",
  "closed",
  "pipeline-value",
  "closed-volume",
  "projected-commission",
  // Release 1.1 moved the featured listing out of the upper-left slot, which
  // the permanent identity card now occupies, to a wide card between the
  // commission chart and the transactions table.
  "featured-listing",
  "transactions-table",
  "lead-source",
  "leaderboard",
  "market-pulse",
  "compliance",
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];
