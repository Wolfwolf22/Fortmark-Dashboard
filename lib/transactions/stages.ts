/**
 * The transaction lifecycle.
 *
 * One ordered path from opportunity to closed, plus four terminal ways out.
 * Not a residential-buyer funnel: a seller listing and a commercial lease
 * move through the same stages, because the stages describe where a deal IS
 * rather than what kind of deal it is.
 *
 * Transitions are explicit. A deal moves one way along the path, may step
 * back one stage (a financing contingency reopened), may leave to a terminal
 * state from any active stage, and may return from `on_hold` to where it
 * paused. `closed` is final. Pure, importable by tests directly.
 */

export const ACTIVE_STAGES = [
  "opportunity",
  "offer",
  "under_contract",
  "due_diligence",
  "financing",
  "closing_prep",
] as const;

export const TERMINAL_STAGES = ["closed", "cancelled", "withdrawn", "fell_through"] as const;

export const PAUSED_STAGE = "on_hold" as const;

export type ActiveStage = (typeof ACTIVE_STAGES)[number];
export type TerminalStage = (typeof TERMINAL_STAGES)[number];
export type TransactionStage = ActiveStage | TerminalStage | typeof PAUSED_STAGE;

export const ALL_STAGES: readonly TransactionStage[] = [
  ...ACTIVE_STAGES,
  PAUSED_STAGE,
  ...TERMINAL_STAGES,
];

export const STAGE_LABELS: Record<TransactionStage, string> = {
  opportunity: "Opportunity",
  offer: "Offer",
  under_contract: "Under contract",
  due_diligence: "Due diligence",
  financing: "Financing",
  closing_prep: "Closing prep",
  closed: "Closed",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  on_hold: "On hold",
  fell_through: "Fell through",
};

export function isActiveStage(stage: TransactionStage): stage is ActiveStage {
  return (ACTIVE_STAGES as readonly string[]).includes(stage);
}

export function isTerminalStage(stage: TransactionStage): stage is TerminalStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function isStage(value: unknown): value is TransactionStage {
  return typeof value === "string" && (ALL_STAGES as readonly string[]).includes(value);
}

/** Position along the active path; terminal and paused stages have none. */
export function stageIndex(stage: TransactionStage): number {
  return (ACTIVE_STAGES as readonly string[]).indexOf(stage);
}

/**
 * Whether a deal may move from one stage to another.
 *
 *   - forward one or more stages along the active path
 *   - back exactly one stage (a reopened contingency), never further
 *   - from any active stage to any terminal stage, or to on_hold
 *   - from on_hold back to any active stage
 *   - `closed` only from `closing_prep` — a deal cannot close from an offer
 *   - nothing leaves a terminal stage
 *
 * `from === to` is not a transition and is refused so a no-op cannot write
 * an event claiming a change.
 */
export function canTransition(from: TransactionStage, to: TransactionStage): boolean {
  if (from === to) return false;
  if (isTerminalStage(from)) return false;
  if (from === PAUSED_STAGE) return isActiveStage(to);
  // from is active
  if (to === PAUSED_STAGE) return true;
  if (to === "closed") return from === "closing_prep";
  if (isTerminalStage(to)) return true;
  const a = stageIndex(from);
  const b = stageIndex(to as ActiveStage);
  return b > a || b === a - 1;
}

export function nextStage(stage: TransactionStage): ActiveStage | "closed" | null {
  if (!isActiveStage(stage)) return null;
  const i = stageIndex(stage);
  return i === ACTIVE_STAGES.length - 1 ? "closed" : ACTIVE_STAGES[i + 1];
}
