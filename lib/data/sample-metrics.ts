/**
 * The sample brokerage, as a metrics payload.
 *
 * This is fiction, and it is only ever reached through `SAMPLE_DASHBOARD_ENABLED`
 * — an explicit, strict, off-by-default switch. It exists so that showing the
 * product to someone never becomes a reason to let a made-up number take the
 * place of a real one on the live path.
 *
 * Two properties keep it honest. It is derived from the same sample sources
 * the sample screens serve, so a demo agrees with itself; and every payload it
 * produces is stamped `source: "sample"`, which the Home screen renders as a
 * visible label rather than a silent footnote.
 */
import { listSampleTransactions } from "./sample-transactions.ts";
import { listSampleLeads } from "./sample-leads.ts";
import { now as sampleNow } from "./mock/db.ts";
import { ACTIVE_STAGES, PAUSED_STAGE } from "../transactions/stages.ts";
import {
  ACTIVE_CLIENT_STAGES,
  LIFECYCLE_STAGES,
  OPEN_PIPELINE_STAGES,
  type ContactStage,
} from "../contacts/stages.ts";
import { available, type BrokerageMetrics, type MonthPoint } from "../metrics/types.ts";
import { dayKey, daysUntil, monthBucket, monthSeries, monthWindow } from "../metrics/window.ts";
import type { LeadSource } from "./types.ts";

const ACTIVE = ACTIVE_STAGES as readonly string[];
const ACTIVE_CLIENTS = ACTIVE_CLIENT_STAGES as readonly string[];
const OPEN_PIPELINE = OPEN_PIPELINE_STAGES as readonly string[];
const MONTHS = 12;

/** Dollars in the sample set; cents everywhere in the contract. */
function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function sampleBrokerageMetrics(at: Date = sampleNow()): BrokerageMetrics {
  const month = monthWindow(at);
  const transactions = listSampleTransactions();
  const leads = listSampleLeads();

  const active = transactions.filter((t) => ACTIVE.includes(t.stage));
  const closed = transactions.filter((t) => t.stage === "closed");
  const closedThisMonth = closed.filter(
    (t) => t.closeDate && t.closeDate.slice(0, 10) >= month.start && t.closeDate.slice(0, 10) <= month.end
  );

  const buckets = new Map<string, MonthPoint>(
    monthSeries(at, MONTHS).map((m) => [m, { month: m, closedCount: 0, closedVolumeCents: 0, commissionCents: 0 }])
  );
  for (const t of closed) {
    if (!t.closeDate) continue;
    const point = buckets.get(monthBucket(t.closeDate.slice(0, 10)));
    if (!point) continue;
    point.closedCount += 1;
    point.closedVolumeCents += cents(t.contractPrice);
    point.commissionCents += cents(t.projectedCommission);
  }

  const stageCounts = new Map<ContactStage, number>();
  for (const lead of leads) {
    stageCounts.set(lead.stage, (stageCounts.get(lead.stage) ?? 0) + 1);
  }
  const newThisMonth = leads.filter((l) => l.createdDate.slice(0, 10) >= month.start);
  const sourceCounts = new Map<LeadSource, number>();
  for (const lead of newThisMonth) {
    sourceCounts.set(lead.source, (sourceCounts.get(lead.source) ?? 0) + 1);
  }

  const followUps = leads.filter(
    (l) => OPEN_PIPELINE.includes(l.stage) && l.nextFollowUpDate && l.nextFollowUpDate.slice(0, 10) <= dayKey(at)
  );

  const attentionItems = [
    ...active.flatMap((t) =>
      t.milestones
        .filter((m) => m.state !== "done")
        .map((m) => ({
          id: `deadline:${t.id}:${m.key}`,
          kind: (daysUntil(m.date.slice(0, 10), at) < 0 ? "deadline_overdue" : "deadline_soon") as
            | "deadline_overdue"
            | "deadline_soon",
          label: m.label,
          subject: `${t.address}, ${t.city}`,
          dueDate: m.date.slice(0, 10),
          daysAway: daysUntil(m.date.slice(0, 10), at),
          href: `/transactions?open=${encodeURIComponent(t.id)}`,
        }))
        .filter((item) => item.daysAway <= 7)
    ),
    ...followUps.map((l) => ({
      id: `follow-up:${l.id}`,
      kind: "follow_up_due" as const,
      label: "Follow up",
      subject: l.name,
      dueDate: l.nextFollowUpDate!.slice(0, 10),
      daysAway: daysUntil(l.nextFollowUpDate!.slice(0, 10), at),
      href: `/leads?open=${encodeURIComponent(l.id)}`,
    })),
  ].sort((a, b) => a.daysAway - b.daysAway || a.subject.localeCompare(b.subject));

  return {
    source: "sample",
    generatedAt: at.toISOString(),
    scope: "brokerage",
    monthStart: month.start,
    transactions: available({
      activeCount: active.length,
      onHoldCount: transactions.filter((t) => t.stage === PAUSED_STAGE).length,
      activeVolumeCents: active.reduce((sum, t) => sum + cents(t.contractPrice), 0),
      activeVolumeUnpricedCount: active.filter((t) => t.contractPrice === 0).length,
      projectedCommissionCents: active.reduce((sum, t) => sum + cents(t.projectedCommission), 0),
      projectedCommissionUntermedCount: active.filter((t) => t.projectedCommission === 0).length,
      scheduledClosingsThisMonth: active.filter(
        (t) => t.closeDate && t.closeDate.slice(0, 10) >= month.start && t.closeDate.slice(0, 10) <= month.end
      ).length,
      closedThisMonthCount: closedThisMonth.length,
      closedThisMonthVolumeCents: closedThisMonth.reduce((sum, t) => sum + cents(t.contractPrice), 0),
      monthly: Array.from(buckets.values()),
    }),
    contacts: available({
      activeClients: leads.filter((l) => ACTIVE_CLIENTS.includes(l.stage)).length,
      newLeadsThisMonth: newThisMonth.length,
      followUpsDue: followUps.length,
      lifecycle: LIFECYCLE_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
      newLeadsBySource: Array.from(sourceCounts.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
    }),
    // Even in fixture mode the MLS is not invented: the sample brokerage has
    // no listing feed, and saying so is the whole point of this project.
    listings: { availability: "not_configured" },
    attention: available({
      items: attentionItems,
      overdueCount: attentionItems.filter((i) => i.daysAway < 0).length,
      soonCount: attentionItems.filter((i) => i.daysAway >= 0).length,
    }),
    activity: available([]),
    leaderboard: { availability: "not_permitted" },
  };
}
