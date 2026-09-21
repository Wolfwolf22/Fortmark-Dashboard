/**
 * The transaction domain's decisions, as pure functions.
 *
 * Who may see or change a deal, how a stored row becomes what the screen
 * renders, how a deal's health is rolled up from its deadlines, and what a
 * request is allowed to say. None of it touches a database, so all of it is
 * tested directly, and the service and routes are thin over it.
 */
import { z } from "zod";
import type {
  Milestone,
  MilestoneKey,
  StatusTone,
  Transaction,
  TransactionSide,
  TransactionStage,
  TransactionType,
} from "../data/types.ts";
import type {
  TransactionDeadlineRow,
  TransactionPartyRow,
  TransactionRow,
} from "../db/schema.ts";
import { centsToDollars, projectCommission } from "./money.ts";
import { ALL_STAGES, isTerminalStage, STAGE_LABELS } from "./stages.ts";

// --- Who ---------------------------------------------------------------------

export type DbRole = "admin" | "broker" | "transaction_coordinator" | "agent" | "member";

/** Roles that see and may change every deal in the brokerage. */
export const PRIVILEGED_ROLES: readonly DbRole[] = ["admin", "broker", "transaction_coordinator"];

export interface Actor {
  /** dashboard_users.id — never the Clerk id. */
  userId: string;
  role: DbRole;
  brokerageKey: string;
}

export function isPrivileged(actor: Actor): boolean {
  return PRIVILEGED_ROLES.includes(actor.role);
}

/**
 * May this actor see this row? The brokerage boundary is checked first and
 * unconditionally; within it, a privileged role sees everything and anyone
 * else sees only the deals they are responsible for. A `member` with no deals
 * therefore sees an empty screen, which is correct.
 */
export function canSee(actor: Actor, row: Pick<TransactionRow, "brokerageKey" | "agentUserId">): boolean {
  if (row.brokerageKey !== actor.brokerageKey) return false;
  return isPrivileged(actor) || row.agentUserId === actor.userId;
}

/** May this actor change this row? Same rule as seeing it; members may not. */
export function canWrite(actor: Actor, row: Pick<TransactionRow, "brokerageKey" | "agentUserId">): boolean {
  if (actor.role === "member") return false;
  return canSee(actor, row);
}

/** May this actor create a deal for this agent? Agents only for themselves. */
export function canCreateFor(actor: Actor, agentUserId: string): boolean {
  if (actor.role === "member") return false;
  return isPrivileged(actor) || agentUserId === actor.userId;
}

// --- Request shapes -----------------------------------------------------------

const SIDES = ["listing", "buyer", "dual", "landlord", "tenant"] as const;
const TYPES = ["residential_sale", "residential_lease", "commercial_sale", "commercial_lease", "land"] as const;
const DEADLINE_KINDS = ["inspection", "financing", "appraisal", "hoa_condo_application", "title", "closing", "possession", "other"] as const;
const PARTY_ROLES = ["buyer", "seller", "landlord", "tenant", "co_agent", "cooperating_agent", "lender", "title_company", "attorney", "escrow_holder", "inspector", "appraiser", "other"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");
const cents = z.number().int().nonnegative().max(9_999_999_999_99);
const bps = z.number().int().nonnegative().max(10_000);
const shortText = z.string().trim().min(1).max(200);

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
  transactionType: z.enum(TYPES),
  side: z.enum(SIDES),
  addressLine1: shortText,
  addressLine2: z.string().trim().max(200).optional(),
  city: shortText,
  state: z.string().trim().length(2).optional(),
  postalCode: z.string().trim().max(12).optional(),
  listingKey: z.string().trim().max(64).optional(),
  mlsNumber: z.string().trim().max(32).optional(),
  contractPriceCents: cents.optional(),
  listPriceCents: cents.optional(),
  commissionRateBps: bps.optional(),
  commissionFlatCents: cents.optional(),
  agentSplitBps: bps.optional(),
  contractExecutionDate: isoDate.optional(),
  closingDate: isoDate.optional(),
  notes: z.string().trim().max(5000).optional(),
  agentUserId: z.string().uuid().optional(),
  parties: z.array(partyInputSchema).max(20).optional(),
  deadlines: z.array(deadlineInputSchema).max(30).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const stageChangeSchema = z.object({
  stage: z.enum(ALL_STAGES as [TransactionStage, ...TransactionStage[]]),
});

// --- Row → screen -----------------------------------------------------------------

/** The party the screen calls "the client", by which side FortMark is on. */
const CLIENT_ROLE_FOR_SIDE: Record<TransactionSide, readonly TransactionPartyRow["role"][]> = {
  listing: ["seller", "landlord"],
  buyer: ["buyer", "tenant"],
  dual: ["buyer", "seller"],
  landlord: ["landlord"],
  tenant: ["tenant"],
};

export function primaryClient(
  side: TransactionSide,
  parties: readonly TransactionPartyRow[]
): TransactionPartyRow | undefined {
  const wanted = CLIENT_ROLE_FOR_SIDE[side];
  const candidates = parties.filter((p) => wanted.includes(p.role));
  return candidates.find((p) => p.isPrimary) ?? candidates[0];
}

/** A `date` column arrives as yyyy-mm-dd; the screen wants ISO. */
export function dateToIso(d: string | null | undefined): string | undefined {
  if (!d) return undefined;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}

export function toMilestone(row: TransactionDeadlineRow, now: Date): Milestone {
  const date = dateToIso(row.dueDate) ?? new Date(0).toISOString();
  const state: Milestone["state"] = row.completedAt
    ? "done"
    : new Date(date).getTime() < now.getTime()
      ? "overdue"
      : "upcoming";
  return { id: row.id, key: row.kind as MilestoneKey, label: row.label, date, state };
}

/**
 * Health rollup, from the deal's own deadlines. Closed and the exit stages
 * are neutral and say which; otherwise any open overdue deadline is "at
 * risk", and one more than a week overdue is "off track".
 */
export function rollupStatus(
  stage: TransactionStage,
  milestones: readonly Milestone[],
  now: Date
): { status: StatusTone; statusLabel: string } {
  if (stage === "closed" || isTerminalStage(stage)) {
    return { status: "neutral", statusLabel: STAGE_LABELS[stage] };
  }
  if (stage === "on_hold") return { status: "neutral", statusLabel: "On hold" };
  const overdue = milestones.filter((m) => m.state === "overdue");
  if (overdue.length === 0) return { status: "good", statusLabel: "On track" };
  const worstDays = Math.max(
    ...overdue.map((m) => (now.getTime() - new Date(m.date).getTime()) / 86_400_000)
  );
  return worstDays > 7
    ? { status: "bad", statusLabel: "Off track" }
    : { status: "warn", statusLabel: "At risk" };
}

export interface RowBundle {
  row: TransactionRow;
  parties: readonly TransactionPartyRow[];
  deadlines: readonly TransactionDeadlineRow[];
  /** Display name of the responsible agent, when known. */
  agentName?: string;
}

/**
 * A stored deal as the screen renders it. Money is converted to dollars only
 * here, at the edge; nothing upstream of this function sees a dollar.
 */
export function toTransaction(bundle: RowBundle, now: Date = new Date()): Transaction {
  const { row, parties, deadlines } = bundle;
  const client = primaryClient(row.side as TransactionSide, parties);
  const milestones = [...deadlines]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dueDate.localeCompare(b.dueDate))
    .map((d) => toMilestone(d, now));
  const projection = projectCommission({
    contractPriceCents: row.contractPriceCents,
    commissionRateBps: row.commissionRateBps,
    commissionFlatCents: row.commissionFlatCents,
    agentSplitBps: row.agentSplitBps,
    transactionFeeCents: row.transactionFeeCents,
    referralFeeBps: row.referralFeeBps,
  });
  const stage = row.stage as TransactionStage;
  return {
    id: row.id,
    listingId: row.listingKey ?? undefined,
    address: row.addressLine2 ? `${row.addressLine1} ${row.addressLine2}` : row.addressLine1,
    city: row.city,
    clientId: client?.id ?? "",
    clientName: client?.displayName ?? "—",
    side: row.side as TransactionSide,
    transactionType: row.transactionType as TransactionType,
    stage,
    contractPrice: centsToDollars(row.contractPriceCents ?? 0),
    commissionRate: (row.commissionRateBps ?? 0) / 10_000,
    projectedCommission: centsToDollars(projection.grossCents),
    contractDate: dateToIso(row.contractExecutionDate) ?? row.createdAt.toISOString(),
    closeDate: dateToIso(row.closedDate) ?? dateToIso(row.closingDate),
    agentId: row.agentUserId,
    agentName: bundle.agentName,
    milestones,
    ...rollupStatus(stage, milestones, now),
    source: "db",
  };
}
