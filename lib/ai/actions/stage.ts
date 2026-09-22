import "server-only";

/**
 * The second action a model may prepare: moving a contact along the lifecycle.
 *
 * It changes exactly one column, `contacts.stage`, and it does so through the
 * application's own `planStageChange` — the same authorization, the same
 * transition graph and the same writes the Leads screen uses. There is no
 * AI-specific lifecycle here, and this module deliberately owns no transition
 * rule of its own.
 *
 * What it does own: which stages this PHASE lets a model propose, and what a
 * person is told before they confirm.
 */
import { createHash } from "node:crypto";
import {
  ACTIVE_CLIENT_STAGES,
  CONTACT_STAGE_LABELS,
  OPEN_PIPELINE_STAGES,
  type ContactStage,
} from "../../contacts/stages.ts";
import { formatFollowUpDay, followUpDay } from "./followup.ts";
import type { ContactRow } from "../../db/schema.ts";
import type { ActionChange } from "./contract.ts";

export const STAGE_ACTION_TYPE = "contact_stage_change";

/**
 * Stages this phase does not let a model touch, in either direction.
 *
 * `archived` is a deliberate human-only filing operation. It is the only
 * near-terminal stage — its single way back is `lead`, which discards where
 * the person had got to — so a confirmed mistake there cannot be fully undone
 * through the interface the way every other stage change can.
 *
 * This is a SCOPE decision about what F2-C authorizes, not a lifecycle rule.
 * The domain graph in `lib/contacts/stages.ts` is untouched: the Leads screen
 * still archives and still restores exactly as it did. A model simply has no
 * way to ask.
 */
export const AI_EXCLUDED_STAGES: readonly ContactStage[] = ["archived"];

/** The stages a model may name as a destination. */
export const AI_PROPOSABLE_STAGES: readonly ContactStage[] = (
  [
    "lead",
    "contacted",
    "qualified",
    "appointment",
    "representation",
    "active_client",
    "under_contract",
    "closed",
    "past_client",
    "lost",
  ] as const
).filter((stage) => !AI_EXCLUDED_STAGES.includes(stage));

export function isAiProposableStage(stage: string): stage is ContactStage {
  return (AI_PROPOSABLE_STAGES as readonly string[]).includes(stage);
}

/**
 * Whether this phase permits proposing a move out of the contact's CURRENT
 * stage. Checked server-side against the stored row, so a model that guesses
 * a live contact id still cannot reach an archived one.
 */
export function stageIsAiManageable(stage: string): boolean {
  return !(AI_EXCLUDED_STAGES as readonly string[]).includes(stage);
}

export const stageLabel = (stage: string): string =>
  CONTACT_STAGE_LABELS[stage as ContactStage] ?? stage;

/**
 * The fields this action depends on, hashed.
 *
 * Only two: which contact, and the stage being moved from — because the
 * current stage is the sole input to whether the transition is valid. A
 * colleague correcting an email, a phone number or even a follow-up date
 * between preparation and confirmation must not invalidate the proposal; a
 * colleague moving the stage must.
 */
export function stageFingerprint(row: Pick<ContactRow, "id" | "stage">): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: row.id, stage: row.stage }))
    .digest("hex");
}

/** The diff, built by the server from the stored row. Labels, never enums. */
export function stageChange(from: string, to: string): ActionChange {
  return {
    field: "stage",
    label: "Stage",
    from: stageLabel(from),
    to: stageLabel(to),
  };
}

const inSet = (set: readonly string[], stage: string) => set.includes(stage);

/**
 * What a person should know before confirming, and nothing else.
 *
 * Every line below is derived from a predicate that already decides real
 * behaviour elsewhere in the application, so each is true or false with no
 * judgement involved. Routine moves inside the early pipeline produce no
 * lines at all — a card that warns about everything trains people to read
 * nothing.
 */
export function stageWarnings(row: ContactRow, to: string): string[] {
  const from = row.stage as string;
  const notes: string[] = [];

  const wasActive = inSet(ACTIVE_CLIENT_STAGES, from);
  const willBeActive = inSet(ACTIVE_CLIENT_STAGES, to);
  if (!wasActive && willBeActive) {
    notes.push("This contact will be counted in Active Clients.");
  } else if (wasActive && !willBeActive) {
    notes.push("This contact will no longer be counted in Active Clients.");
  }

  // Leaving the open pipeline suppresses a stored follow-up without clearing
  // it. That is the current domain behaviour, it is invisible on every other
  // screen, and it is the one consequence worth spelling out — including that
  // the date is kept, so nobody reads this as "the follow-up was deleted".
  const wasOpen = inSet(OPEN_PIPELINE_STAGES, from);
  const willBeOpen = inSet(OPEN_PIPELINE_STAGES, to);
  if (wasOpen && !willBeOpen && row.nextFollowUpAt) {
    const day = formatFollowUpDay(followUpDay(row.nextFollowUpAt));
    notes.push(
      `Their follow-up on ${day} will be kept on the contact but will no longer appear in your follow-ups due.`
    );
  }

  return notes;
}

/** How the proposal reads at the top of the card. */
export function stageSummary(displayName: string, from: string, to: string): string {
  return `Change ${displayName} from ${stageLabel(from)} to ${stageLabel(to)}`;
}
