/**
 * What the model is allowed to see.
 *
 * Every tool result passes through a function in this file, and every function
 * here is an explicit allow-list: it names the fields it copies and ignores
 * everything else. That is the whole point — a domain record that gains a
 * field tomorrow does not start reaching the model today, and reviewing what
 * the assistant can read means reading one file.
 *
 * Deliberately absent, whatever the domain object carries:
 *
 *   contact notes      free-form text a person wrote about a client, and the
 *                      most sensitive field in the CRM. Out of scope in F1.
 *   documents          out of scope entirely; no tool reads them.
 *   audit records      who did what, for compliance. Not a data source.
 *   internal ids       of anything but the record itself — no brokerage id,
 *                      no Clerk id, no agent user id. Agents appear by name.
 *
 * Money is whole dollars here, not the domain's integer cents, and every money
 * field says so in its name. The model reads these numbers aloud; a unit it
 * has to infer is a unit it will eventually get wrong.
 */
import type { ActivityItem, AttentionItem, BrokerageMetrics, MetricGroup } from "../../metrics/types.ts";
import type { Lead, Transaction } from "../../data/types.ts";

/** Integer cents to whole dollars. Rounded, never truncated mid-cent. */
export function dollars(cents: number): number {
  return Math.round(cents / 100);
}

// --- Contacts ----------------------------------------------------------------

export interface ContactSummaryDto {
  id: string;
  name: string;
  stage: string;
  intent: string;
  assignedAgent?: string;
  nextFollowUp?: string;
}

export interface ContactDto extends ContactSummaryDto {
  email?: string;
  phone?: string;
  source: string;
  budgetUsd?: number;
  area?: string;
  createdOn: string;
  lastContacted: string;
}

/** A day, not an instant: the model reasons about dates, never timezones. */
function day(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString().slice(0, 10);
}

export function contactSummary(lead: Lead): ContactSummaryDto {
  return {
    id: lead.id,
    name: lead.name,
    stage: lead.stage,
    intent: lead.intent,
    assignedAgent: lead.assignedAgentName,
    nextFollowUp: day(lead.nextFollowUpDate),
  };
}

export function contactDetail(lead: Lead): ContactDto {
  return {
    ...contactSummary(lead),
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    source: lead.source,
    // Budget is the stated upper bound of the open opportunity, in dollars.
    budgetUsd: lead.budget && lead.budget > 0 ? lead.budget : undefined,
    area: lead.neighborhood || undefined,
    createdOn: day(lead.createdDate) ?? lead.createdDate,
    lastContacted: day(lead.lastContactDate) ?? lead.lastContactDate,
    // `lead.notes` is NOT copied. See the header.
  };
}

// --- Transactions ------------------------------------------------------------

export interface TransactionSummaryDto {
  id: string;
  address: string;
  city: string;
  client: string;
  side: string;
  stage: string;
  status: string;
  closeDate?: string;
  contractPriceUsd?: number;
  agent?: string;
}

export interface TransactionDto extends TransactionSummaryDto {
  transactionType: string;
  commissionRatePercent?: number;
  projectedCommissionUsd?: number;
  contractDate: string;
  milestones: { label: string; dueDate: string; state: string }[];
}

export function transactionSummary(deal: Transaction): TransactionSummaryDto {
  return {
    id: deal.id,
    address: deal.address,
    city: deal.city,
    client: deal.clientName,
    side: deal.side,
    stage: deal.stage,
    status: deal.statusLabel,
    closeDate: day(deal.closeDate),
    // 0 means "no price entered", which is not a price of zero.
    contractPriceUsd: deal.contractPrice > 0 ? deal.contractPrice : undefined,
    agent: deal.agentName,
  };
}

export function transactionDetail(deal: Transaction): TransactionDto {
  return {
    ...transactionSummary(deal),
    transactionType: deal.transactionType,
    commissionRatePercent:
      deal.commissionRate > 0 ? Number((deal.commissionRate * 100).toFixed(4)) : undefined,
    projectedCommissionUsd: deal.projectedCommission > 0 ? deal.projectedCommission : undefined,
    contractDate: day(deal.contractDate) ?? deal.contractDate,
    milestones: deal.milestones.map((m) => ({
      label: m.label,
      dueDate: day(m.date) ?? m.date,
      state: m.state,
    })),
  };
}

// --- Attention and activity --------------------------------------------------

export interface AttentionDto {
  kind: string;
  what: string;
  subject: string;
  dueDate: string;
  /** Whole days from today. Negative is overdue. */
  daysAway: number;
}

export function attentionItem(item: AttentionItem): AttentionDto {
  return {
    kind: item.kind,
    what: item.label,
    subject: item.subject,
    dueDate: item.dueDate,
    daysAway: item.daysAway,
  };
}

export interface ActivityDto {
  kind: string;
  what: string;
  subject: string;
  on: string;
}

export function activityItem(item: ActivityItem): ActivityDto {
  return {
    kind: item.kind,
    what: item.summary,
    subject: item.subject,
    on: day(item.at) ?? item.at,
  };
}

// --- The business summary ----------------------------------------------------

/**
 * A metric group, flattened for the model.
 *
 * The availability survives the flattening. A group that could not be read
 * arrives as `{ available: false, reason }` and never as zeroes, because the
 * model would otherwise report "you closed nothing this month" when the truth
 * is that nobody could ask.
 */
function group<T, U>(g: MetricGroup<T>, shape: (data: T) => U): { available: false; reason: string } | U {
  if (g.availability !== "available") return { available: false, reason: g.availability };
  return shape(g.data);
}

export function businessSummary(metrics: BrokerageMetrics) {
  return {
    /** `own` = this user's book; `brokerage` = the whole brokerage. */
    coverage: metrics.scope,
    monthStart: metrics.monthStart,
    transactions: group(metrics.transactions, (t) => ({
      available: true as const,
      activeCount: t.activeCount,
      onHoldCount: t.onHoldCount,
      activeVolumeUsd: dollars(t.activeVolumeCents),
      activeDealsWithNoPriceEntered: t.activeVolumeUnpricedCount,
      projectedCommissionUsd: dollars(t.projectedCommissionCents),
      activeDealsWithNoCommissionTerms: t.projectedCommissionUntermedCount,
      scheduledClosingsThisMonth: t.scheduledClosingsThisMonth,
      closedThisMonthCount: t.closedThisMonthCount,
      closedThisMonthVolumeUsd: dollars(t.closedThisMonthVolumeCents),
    })),
    contacts: group(metrics.contacts, (c) => ({
      available: true as const,
      activeClients: c.activeClients,
      newLeadsThisMonth: c.newLeadsThisMonth,
      followUpsDue: c.followUpsDue,
      lifecycle: c.lifecycle.filter((row) => row.count > 0),
    })),
    listings: group(metrics.listings, (l) => ({
      available: true as const,
      activeCount: l.activeCount,
    })),
    attention: group(metrics.attention, (a) => ({
      available: true as const,
      overdueCount: a.overdueCount,
      dueSoonCount: a.soonCount,
    })),
  };
}
