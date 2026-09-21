/**
 * The contact lifecycle.
 *
 * A person's relationship with the brokerage, from first touch to past
 * client. Not a permanent category: a past client becomes a lead again the
 * next time they need something, and that is a normal forward step here,
 * not a reset. `lost` and `archived` are the ways out; `lost` can be
 * reopened, `archived` cannot except by an explicit restore to `lead`.
 * Pure, importable by tests directly.
 */

export const LIFECYCLE_STAGES = [
  "lead",
  "contacted",
  "qualified",
  "appointment",
  "representation",
  "active_client",
  "under_contract",
  "closed",
  "past_client",
] as const;

export const EXIT_STAGES = ["lost", "archived"] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export type ExitStage = (typeof EXIT_STAGES)[number];
export type ContactStage = LifecycleStage | ExitStage;

export const ALL_CONTACT_STAGES: readonly ContactStage[] = [...LIFECYCLE_STAGES, ...EXIT_STAGES];

export const CONTACT_STAGE_LABELS: Record<ContactStage, string> = {
  lead: "Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment: "Appointment",
  representation: "Representation",
  active_client: "Active client",
  under_contract: "Under contract",
  closed: "Closed",
  past_client: "Past client",
  lost: "Lost",
  archived: "Archived",
};

export function isContactStage(value: unknown): value is ContactStage {
  return typeof value === "string" && (ALL_CONTACT_STAGES as readonly string[]).includes(value);
}

export function isLifecycleStage(stage: ContactStage): stage is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(stage);
}

/**
 * Whether a contact may move from one stage to another.
 *
 *   - within the lifecycle, any move is allowed: relationships do not follow
 *     a strict order (a referral can arrive already at representation), and
 *     correcting a mis-set stage must not need an exit and re-entry
 *   - from any lifecycle stage to lost or archived
 *   - from lost, back to any lifecycle stage (reopened)
 *   - from archived, only to lead (an explicit restore)
 *   - same stage is not a transition
 */
export function canTransition(from: ContactStage, to: ContactStage): boolean {
  if (from === to) return false;
  if (from === "archived") return to === "lead";
  if (from === "lost") return isLifecycleStage(to);
  return true;
}
