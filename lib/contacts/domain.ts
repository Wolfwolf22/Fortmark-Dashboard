/**
 * The contact domain's decisions, as pure functions.
 *
 * How a stored contact becomes the screen's `Lead`, what a request may say,
 * and how a person's needs summarise into an intent. Ownership rules are the
 * shared ones in lib/auth/actor.ts, restated here only as the contact row's
 * shape. Nothing here touches a database.
 */
import { z } from "zod";
import type { Lead, LeadIntent, LeadSource, LeadStage } from "../data/types.ts";
import type { ContactActivityRow, ContactOpportunityRow, ContactRow } from "../db/schema.ts";
import { canCreateOwnedFor, canSeeOwned, canWriteOwned, type Actor } from "../auth/actor.ts";
import { centsToDollars } from "../transactions/money.ts";
import { toE164 } from "../profile/normalize.ts";
import { businessDayKey } from "../metrics/business-day.ts";
import { decideFollowUp, type FollowUpOutcome } from "./follow-up.ts";
import { ALL_CONTACT_STAGES } from "./stages.ts";

// --- Who ---------------------------------------------------------------------

type Owned = Pick<ContactRow, "brokerageKey" | "assignedAgentUserId">;

export function canSee(actor: Actor, row: Owned): boolean {
  return canSeeOwned(actor, { brokerageKey: row.brokerageKey, ownerUserId: row.assignedAgentUserId });
}

export function canWrite(actor: Actor, row: Owned): boolean {
  return canWriteOwned(actor, { brokerageKey: row.brokerageKey, ownerUserId: row.assignedAgentUserId });
}

export function canCreateFor(actor: Actor, agentUserId: string): boolean {
  return canCreateOwnedFor(actor, agentUserId);
}

// --- Request shapes -----------------------------------------------------------

const SOURCES = ["referral", "sphere", "sign_call", "website", "open_house", "past_client", "social", "advertising", "walk_in", "other"] as const;
const KINDS = ["buyer", "seller", "landlord", "tenant", "investor", "commercial_buyer", "commercial_seller", "commercial_tenant", "commercial_landlord", "referral_source"] as const;
const ACTIVITY_KINDS = ["call", "email", "sms", "meeting", "showing", "note", "task"] as const;

const cents = z.number().int().nonnegative().max(9_999_999_999_99);
const shortText = z.string().trim().min(1).max(200);

export const opportunityInputSchema = z.object({
  kind: z.enum(KINDS),
  area: z.string().trim().max(200).optional(),
  budgetMinCents: cents.optional(),
  budgetMaxCents: cents.optional(),
  timeframe: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * What a caller may say when adding a person. A name of some kind is
 * required — first, last or preferred — because a contact nobody can name
 * cannot be followed up. Ownership and tenancy are the server's, as with
 * deals: `assignedAgentUserId` is honoured only from a privileged actor.
 */
export const createContactBaseSchema = z.object({
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    preferredName: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(200).optional(),
    source: z.enum(SOURCES).optional(),
    tags: z.array(shortText).max(20).optional(),
    notes: z.string().trim().max(5000).optional(),
    assignedAgentUserId: z.string().uuid().optional(),
    opportunities: z.array(opportunityInputSchema).max(10).optional(),
});

export const createContactSchema = createContactBaseSchema.refine(
  (c) => Boolean(c.firstName || c.lastName || c.preferredName),
  { message: "a name is required", path: ["firstName"] }
);

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const contactStageChangeSchema = z.object({
  stage: z.enum(ALL_CONTACT_STAGES as [LeadStage, ...LeadStage[]]),
});

/** An activity a person logs. System events are written by the service only. */
export const activityInputSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  summary: z.string().trim().min(1).max(1000),
  occurredAt: z.string().datetime().optional(),
  opportunityId: z.string().uuid().optional(),
  /** Set or reschedule the follow-up while logging the touch, as people do. */
  nextFollowUpAt: z.string().datetime().optional(),
  /**
   * Explicitly mark the current follow-up done. Logging a touch alone never
   * clears it — an attempted call may not complete anything.
   */
  completeFollowUp: z.boolean().optional(),
});

export type ActivityInput = z.infer<typeof activityInputSchema>;

/**
 * A direct follow-up change: set, reschedule or complete the reminder with no
 * touch logged. A reminder is not an interaction, so this is its own request
 * rather than a flag on an activity. Strict, so a body mixing both shapes is
 * refused instead of half-honoured.
 */
export const followUpChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("schedule"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ action: z.literal("complete") }).strict(),
]);

export type FollowUpChangeInput = z.infer<typeof followUpChangeSchema>;

/**
 * What a logged touch does to the stored follow-up. The rule itself is
 * `decideFollowUp` — shared with the direct control — so this only translates
 * the request: the picked instant becomes its business day, so a client that
 * sends 11 PM Eastern as the next morning's UTC still means the day it picked.
 *
 * Pure, so the rule is testable without a database and the service cannot
 * drift from it.
 */
export function resolveFollowUp(
  current: Date | null,
  input: Pick<ActivityInput, "nextFollowUpAt" | "completeFollowUp">
): { value: Date | null; change: FollowUpOutcome } {
  const day = input.nextFollowUpAt ? businessDayKey(new Date(input.nextFollowUpAt)) : null;
  const decided = decideFollowUp(current, { day, complete: input.completeFollowUp });
  return { value: decided.value, change: decided.outcome };
}

// --- Editing a contact ---------------------------------------------------------------

const EDITABLE_TEXT = { max: 200 } as const;

/**
 * What a person may change about a contact they can write to. Only what the
 * contact row itself holds: how they are named and reached, where they came
 * from, and the notes. Ownership, tenancy, stage, dates and every identifier are
 * NOT here — `.strict()` refuses them rather than ignoring them, so a crafted
 * body that names one is an error, not a silent no-op. An empty string clears a
 * field.
 *
 * Intent is not a contact field: it is summarised from the person's needs
 * (opportunities), a separate domain that is not editable from Leads.
 */
export const editContactSchema = z
  .object({
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    preferredName: z.string().trim().max(100).optional(),
    email: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(EDITABLE_TEXT.max).optional(),
    source: z.enum(SOURCES).optional(),
    notes: z.string().trim().max(5000).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to change" });

export type EditContactInput = z.infer<typeof editContactSchema>;

export const reassignContactSchema = z.object({ agentId: z.string().uuid() }).strict();

export type ContactEditField = "name" | "email" | "phone" | "company" | "source" | "notes";

export type ContactEditPlan =
  | { ok: true; set: Partial<Pick<ContactRow, "firstName" | "lastName" | "preferredName" | "email" | "phoneE164" | "company" | "source" | "notes">>; changed: ContactEditField[] }
  | { ok: false; field: "name" | "phone" };

const blankToNull = (v: string | undefined | null): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * What an edit would change, decided without a database.
 *
 * Compares the request against the stored row so only real changes are written
 * and audited — saving an unchanged form is a no-op, not a history line. A name
 * is still required afterwards (first, last or preferred), a phone number that
 * cannot be read confidently is refused rather than stored half-parsed, and an
 * email is stored lower-case as it is on creation.
 */
export function planContactEdit(
  row: Pick<ContactRow, "firstName" | "lastName" | "preferredName" | "email" | "phoneE164" | "company" | "source" | "notes">,
  patch: EditContactInput
): ContactEditPlan {
  const set: Extract<ContactEditPlan, { ok: true }>["set"] = {};
  const changed = new Set<ContactEditField>();
  const apply = <K extends keyof typeof set>(key: K, value: (typeof set)[K], field: ContactEditField, current: unknown) => {
    if (value !== current) {
      set[key] = value;
      changed.add(field);
    }
  };

  if (patch.firstName !== undefined) apply("firstName", blankToNull(patch.firstName), "name", row.firstName ?? null);
  if (patch.lastName !== undefined) apply("lastName", blankToNull(patch.lastName), "name", row.lastName ?? null);
  if (patch.preferredName !== undefined) apply("preferredName", blankToNull(patch.preferredName), "name", row.preferredName ?? null);
  if (patch.email !== undefined) apply("email", blankToNull(patch.email)?.toLowerCase() ?? null, "email", row.email ?? null);
  if (patch.phone !== undefined) {
    const raw = blankToNull(patch.phone);
    const phone = raw === null ? null : toE164(raw);
    if (raw !== null && phone === null) return { ok: false, field: "phone" };
    apply("phoneE164", phone, "phone", row.phoneE164 ?? null);
  }
  if (patch.company !== undefined) apply("company", blankToNull(patch.company), "company", row.company ?? null);
  if (patch.source !== undefined) apply("source", patch.source, "source", row.source);
  if (patch.notes !== undefined) apply("notes", blankToNull(patch.notes), "notes", row.notes ?? null);

  const after = {
    firstName: "firstName" in set ? set.firstName : row.firstName,
    lastName: "lastName" in set ? set.lastName : row.lastName,
    preferredName: "preferredName" in set ? set.preferredName : row.preferredName,
  };
  if (!after.firstName && !after.lastName && !after.preferredName) return { ok: false, field: "name" };
  return { ok: true, set, changed: Array.from(changed) };
}

// --- Row → screen -----------------------------------------------------------------

export function displayName(row: Pick<ContactRow, "firstName" | "lastName" | "preferredName">): string {
  const legal = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return row.preferredName?.trim() || legal || "Unnamed contact";
}

/**
 * The open needs, summarised. A buyer and a seller need at once is "both";
 * any lease-side need is "lease"; an investor is "invest"; anything else the
 * screen cannot summarise honestly is "other". No open need at all — a past
 * client, say — is "other" too, and the drawer shows the opportunities
 * themselves for the detail.
 */
export function toIntent(opportunities: readonly ContactOpportunityRow[]): LeadIntent {
  const open = opportunities.filter((o) => o.status === "open");
  if (open.length === 0) return "other";
  const kinds = new Set(open.map((o) => o.kind));
  const buying = kinds.has("buyer") || kinds.has("commercial_buyer");
  const selling = kinds.has("seller") || kinds.has("commercial_seller");
  if (buying && selling) return "both";
  if (buying) return "buy";
  if (selling) return "sell";
  if (kinds.has("tenant") || kinds.has("landlord") || kinds.has("commercial_tenant") || kinds.has("commercial_landlord")) return "lease";
  if (kinds.has("investor")) return "invest";
  return "other";
}

/** The need the screen leads with: the most recent open one. */
export function primaryOpportunity(
  opportunities: readonly ContactOpportunityRow[]
): ContactOpportunityRow | undefined {
  return [...opportunities]
    .filter((o) => o.status === "open")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export interface ContactBundle {
  row: ContactRow;
  opportunities: readonly ContactOpportunityRow[];
  /** The latest activity, when any; lists carry only this one. */
  latestActivity?: ContactActivityRow;
  agentName?: string;
}

export function toLead(bundle: ContactBundle): Lead {
  const { row, opportunities } = bundle;
  const primary = primaryOpportunity(opportunities);
  const lastContact = row.lastContactAt ?? bundle.latestActivity?.occurredAt ?? row.createdAt;
  return {
    id: row.id,
    name: displayName(row),
    email: row.email ?? "",
    phone: row.phoneE164 ?? "",
    stage: row.stage as LeadStage,
    source: row.source as LeadSource,
    intent: toIntent(opportunities),
    budget: primary?.budgetMaxCents != null ? centsToDollars(primary.budgetMaxCents) : undefined,
    neighborhood: primary?.area ?? undefined,
    assignedAgentId: row.assignedAgentUserId,
    assignedAgentName: bundle.agentName,
    createdDate: row.createdAt.toISOString(),
    lastContactDate: lastContact.toISOString(),
    lastTouchDate: row.lastContactAt?.toISOString(),
    nextFollowUpDate: row.nextFollowUpAt?.toISOString(),
    notes: row.notes ?? "",
    recordSource: "db",
    editable: {
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      preferredName: row.preferredName ?? "",
      company: row.company ?? "",
    },
  };
}
