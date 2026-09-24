/**
 * The canonical Home widget order.
 *
 * Extracted from `layout.ts` so it can be imported without pulling in Zustand
 * or the `@/` path alias — the test runner is plain Node with type stripping and
 * resolves neither. Same reason `lib/profile/roles.ts` is separate.
 *
 * The order is the product's argument about what matters. It reads down the
 * page as: what needs acting on, what is being worked, what just happened,
 * how the year is going, and finally the things that are someone else's
 * business or another system's.
 *
 * The four headline figures are deliberately NOT here. They live in the daily
 * brief above the grid, where they cannot be reordered below the fold — a
 * dashboard whose first numbers can be dragged to the bottom is not a brief.
 * The permanent Home identity card is likewise absent: it renders outside the
 * sortable context, so it has no id to reorder, persist or drag.
 */
export const DEFAULT_WIDGET_ORDER = [
  // What to act on. First, because it is the question Home exists to answer.
  "compliance",
  // What is being worked.
  "transactions-table",
  // The MLS book (FortMark's, or the agent's own). Live since Core V1, so it
  // sits with the working modules — after the queue and the deals, never
  // ahead of them, and on a phone before the history below.
  "featured-listing",
  // What just happened.
  "market-pulse",
  // How the year is going.
  "projected-commission",
  "closed-volume",
  "lead-source",
  // Brokerage-wide, and shown only to the roles that may see it.
  "leaderboard",
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];
