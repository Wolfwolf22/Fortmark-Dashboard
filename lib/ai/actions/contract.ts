/**
 * The AI-assisted action contract — TYPES ONLY.
 *
 * Nothing here executes. There is no registry, no prepare tool, no execution
 * endpoint and no import of this module from the assistant's tool registry,
 * the tool loop or the chat route. `scripts/test_ai_tools.ts` asserts all of
 * that, and will fail the moment it stops being true without the review this
 * file exists to inform.
 *
 * It is committed ahead of the implementation because an architecture argued
 * in prose is easy to agree with and hard to check. These types make the
 * claims in `docs/AI_ACTIONS.md` falsifiable: if a proposed design cannot be
 * expressed here, the design is the thing that is wrong.
 *
 * Three properties are expressed structurally rather than described:
 *
 *   1. `confirmationRequired` is the literal `true`. There is no way to spell
 *      an action that does not need a human, so "just this once" would have to
 *      change this file first — which is the review gate.
 *
 *   2. A `PreparedAction` carries no actor, brokerage, role or mutation
 *      payload. Everything that decides what happens stays server-side; this
 *      is what a browser may render, and rendering is all it may do.
 *
 *   3. `ActionChange.from`/`to` are display strings the SERVER resolved. A
 *      relative date the model interpreted never reaches a human unresolved,
 *      because the type has nowhere to put "next Friday".
 *
 * Isomorphic: no server-only import, so the confirmation card and the tests
 * can both hold these shapes.
 */

/**
 * How much a mistake costs, which is not the same as how likely one is.
 *
 *   low       reversible by editing one field; nothing leaves FortMark
 *   moderate  lifecycle state with downstream effects, or a new record
 *   external  leaves FortMark and cannot be recalled
 *
 * Kept as three so confirmation can differ. Scheduling a follow-up and
 * emailing a client are not the same act and must not wear the same dialog.
 */
export type RiskLevel = "low" | "moderate" | "external";

/**
 * The action types the first implementation may eventually carry.
 *
 * A closed union on purpose: an action type that is not named here cannot be
 * prepared, and adding one is a diff somebody reads. Deletion, money,
 * assignment and every external side effect are deliberately absent — see
 * docs/AI_ACTIONS.md §16.
 */
export type ActionType =
  | "contact_followup_schedule"
  | "contact_stage_change"
  | "transaction_stage_change"
  | "contact_activity_log";

export type ActionEntityType = "contact" | "transaction";

/**
 * The lifecycle of one proposal. See docs/AI_ACTIONS.md §7.
 *
 * `executing` is a claim, not a spinner: it is taken by a conditional update
 * and is what makes execution idempotent under a browser retry.
 */
export type ActionStatus =
  | "prepared"
  | "executing"
  | "executed"
  | "failed"
  | "stale"
  | "expired"
  | "cancelled";

/** The statuses from which nothing further can happen. */
export const TERMINAL_ACTION_STATUSES: readonly ActionStatus[] = [
  "executed",
  "failed",
  "stale",
  "expired",
  "cancelled",
];

/**
 * One line of the diff a human confirms.
 *
 * `from` and `to` are what a person reads, resolved by the server: "No
 * follow-up scheduled" → "Friday, 25 September 2026". Never a stored value a
 * human has to decode, and never a relative phrase they have to trust.
 */
export interface ActionChange {
  /** The domain field, for the audit trail. */
  field: string;
  /** What the field is called on screen. */
  label: string;
  /** The current value as a person reads it; null when nothing is set. */
  from: string | null;
  /** The proposed value as a person reads it. Always absolute. */
  to: string;
}

/**
 * What the browser may render — and the whole of it.
 *
 * Fetched from the server by id, never parsed out of what the model streamed:
 * a model that described one change and prepared another must not be able to
 * show a human the description. The server states what it is about to do.
 */
export interface PreparedAction {
  actionId: string;
  type: ActionType;
  risk: RiskLevel;
  entity: {
    type: ActionEntityType;
    id: string;
    /** The address or the person's name — enough to confirm the right one. */
    displayName: string;
  };
  /** One line, server-authored. Never "this will update the record." */
  summary: string;
  changes: ActionChange[];
  /** Duplicates, unusual dates, downstream effects. Shown before the buttons. */
  warnings: string[];
  status: ActionStatus;
  preparedAt: string;
  expiresAt: string;
  /** There is no `false`. See the header. */
  confirmationRequired: true;
}

/**
 * What a `prepare_*` tool returns to the MODEL.
 *
 * An id and a status, and deliberately not the preview: the model does not
 * need the diff to talk about the change, and anything it receives it can
 * paraphrase inaccurately. `awaiting_confirmation` is the only success — there
 * is no shape here that a model could read as "done".
 */
export interface PreparedActionHandle {
  actionId: string;
  status: "awaiting_confirmation";
  /** What the model should tell the user it has done: prepared, not applied. */
  disposition: "prepared_for_review";
}

/** Why a proposal could not be made. No card is shown for any of these. */
export type PrepareFailure =
  | "not_found"
  | "not_permitted"
  | "invalid_transition"
  | "ambiguous_target"
  | "invalid_arguments"
  | "unavailable";

/** Why a confirmed action did not run. The record is unchanged in every case. */
export type ExecuteFailure =
  | "not_found"
  | "not_permitted"
  | "expired"
  | "stale"
  | "invalid_transition"
  | "unavailable";

/**
 * How long a proposal stands. See docs/AI_ACTIONS.md §8.
 *
 * Long enough to read a card, ask a follow-up question and come back; short
 * enough that "move this deal to closed" cannot be clicked tomorrow against a
 * record that has moved on. A starting value, to be raised only with evidence.
 */
export const ACTION_TTL_MS = 10 * 60 * 1000;
