import { z } from "zod";
import { isValidCalendarDay } from "./calendar-days.ts";
import { ALL_STAGES } from "./stages.ts";
import type { TransactionStage } from "../data/types.ts";

const SIDES = ["listing", "buyer", "dual", "landlord", "tenant"] as const;
const TYPES = ["residential_sale", "residential_lease", "commercial_sale", "commercial_lease", "land"] as const;
const DEADLINE_KINDS = ["inspection", "financing", "appraisal", "hoa_condo_application", "title", "closing", "possession", "other"] as const;
const PARTY_ROLES = ["buyer", "seller", "landlord", "tenant", "co_agent", "cooperating_agent", "lender", "title_company", "attorney", "escrow_holder", "inspector", "appraiser", "other"] as const;

const isoDate = z.string().refine(isValidCalendarDay, "expected a real yyyy-mm-dd date");
const cents = z.number().int().nonnegative().max(9_999_999_999_99);
const bps = z.number().int().nonnegative().max(10_000);
const shortText = z.string().trim().min(1).max(200).refine(value => !value.includes("\u0000"));

export const partyInputSchema = z.object({
  role: z.enum(PARTY_ROLES),
  displayName: shortText,
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  isPrimary: z.boolean().optional(),
});

export const deadlineInputSchema = z.object({
  kind: z.enum(DEADLINE_KINDS),
  label: shortText,
  dueDate: isoDate,
  note: z.string().trim().max(1000).optional(),
});

/**
 * What a caller may say when opening a deal. Money arrives in integer cents
 * and rates in basis points — the browser converts what a person typed; the
 * server never parses a dollar string. Nothing about ownership or tenancy is
 * accepted here: `agentUserId` is optional and only a privileged actor's
 * value is honoured, the brokerage is always the server's.
 */
export const createTransactionSchema = z.object({
  requestId: z.string().uuid().optional(),
  transactionType: z.enum(TYPES),
  side: z.enum(SIDES),
  addressLine1: shortText,
  addressLine2: z.string().trim().max(200).optional(),
  city: shortText,
  state: z.string().trim().length(2).optional(),
  postalCode: z.string().trim().max(12).optional(),
  listingKey: z.string().trim().max(256).optional(),
  mlsNumber: z.string().trim().max(40).optional(),
  contractPriceCents: cents.optional(),
  listPriceCents: cents.optional(),
  commissionRateBps: bps.optional(),
  commissionFlatCents: cents.optional(),
  agentSplitBps: bps.optional(),
  contractExecutionDate: isoDate.optional(),
  closingDate: isoDate.optional(),
  notes: z.string().trim().max(5000).optional(),
  agentUserId: z.string().uuid().optional(),
  /**
   * Open this deal for a contact at Representation. The id is a request, not a
   * fact: the server reloads the contact, checks the caller may see it and that
   * it is at Representation, and builds the client party from the stored
   * contact — never from anything else in the body.
   */
  contactId: z.string().uuid().optional(),
  parties: z.array(partyInputSchema).max(20).optional(),
  deadlines: z.array(deadlineInputSchema).max(30).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/**
 * The deadlines a new transaction starts with. A scheduled closing is a
 * deadline too, so it shows up in "coming up" — but only a closing someone
 * actually entered. No closing date, no Closing deadline.
 */
export function initialDeadlines(
  input: Pick<CreateTransactionInput, "closingDate" | "deadlines">
): NonNullable<CreateTransactionInput["deadlines"]> {
  const deadlines = [...(input.deadlines ?? [])];
  if (input.closingDate && !deadlines.some((d) => d.kind === "closing")) {
    deadlines.push({ kind: "closing", label: "Closing", dueDate: input.closingDate });
  }
  return deadlines;
}

export const stageChangeSchema = z.object({
  stage: z.enum(ALL_STAGES as [TransactionStage, ...TransactionStage[]]),
  requestId: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});
