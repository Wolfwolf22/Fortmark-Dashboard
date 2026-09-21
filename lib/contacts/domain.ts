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
  /** Set a follow-up while logging the touch, as people do. */
  nextFollowUpAt: z.string().datetime().optional(),
});

export type ActivityInput = z.infer<typeof activityInputSchema>;

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
    nextFollowUpDate: row.nextFollowUpAt?.toISOString(),
    notes: row.notes ?? "",
    recordSource: "db",
  };
}
