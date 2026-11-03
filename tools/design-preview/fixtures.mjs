// Deliberately synthetic, nonpersistent fixtures for visual review only.
import { contactFixtureNow, contactAgents } from "./contact-fixtures.mjs";
import { readSampleContacts, readSampleActionActivity, SAMPLE_ACTOR } from "./sample-session.mjs";
import { ACTIVE_CLIENT_STAGES, LIFECYCLE_STAGES, OPEN_PIPELINE_STAGES } from "../../lib/contacts/stages.ts";
import { effectiveFollowUpStatus } from "../../lib/contacts/follow-up.ts";
import { nextActionAttentionFields, attentionIsOverdue, compareAttention } from "../../lib/metrics/attention.ts";
import { businessDayKey, dayDiff } from "../../lib/metrics/business-day.ts";
import { showingTransport } from "./showing-transport.mjs";
import { getSampleShowingActivity } from "./showing-model.mjs";
import { tourTransport } from "./tour-transport.mjs";
import { savedTourTransport } from "./saved-tour-transport.mjs";
import { transactionTransport } from "./transaction-transport.mjs";
import { readPreviewTransactionBundles, previewTransactionActivity } from "./transaction-model.mjs";
import { previewTransactionPublicId } from "./transaction-fixtures.mjs";
import { isActiveStage } from "../../lib/transactions/stages.ts";
import { projectCommission } from "../../lib/transactions/money.ts";
const previewNow = contactFixtureNow;
const monthStart = new Date(Date.UTC(previewNow.getUTCFullYear(), previewNow.getUTCMonth(), 1)).toISOString().slice(0, 10);
const monthly = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(previewNow.getUTCFullYear(), previewNow.getUTCMonth() - 11 + index, 1));
  return { month: date.toISOString().slice(0, 10), closedCount: 0, closedVolumeCents: 0, commissionCents: 0 };
});
export const metrics = {
  source: "sample", generatedAt: previewNow.toISOString(), scope: "brokerage", contactsScope: "brokerage", monthStart,
  transactions: { availability: "available", data: {
    activeCount: 2, onHoldCount: 0, activeVolumeCents: 1280000, activeVolumeUnpricedCount: 0,
    projectedCommissionCents: 0, projectedCommissionUntermedCount: 2, scheduledClosingsThisMonth: 0,
    closedThisMonthCount: 0, closedThisMonthVolumeCents: 0, monthly,
  } },
  contacts: { availability: "available", data: {
    activeClients: 1, newLeadsThisMonth: 0, followUpsDue: 0,
    lifecycle: [{ stage: "lead", count: 0 }, { stage: "representation", count: 1 }], newLeadsBySource: [],
  } },
  listings: { availability: "not_configured" },
  attention: { availability: "available", data: { items: [], overdueCount: 0, soonCount: 0 } },
  activity: { availability: "available", data: [
    { id: "sample-activity-1", kind: "transaction_stage_changed", summary: "Sample deal moved to financing", subject: "Sample transaction", at: "2026-10-28T14:00:00Z", href: "/transactions" },
    { id: "sample-activity-2", kind: "contact_touch", summary: "Sample client contacted", subject: "Sample client", at: "2026-10-27T14:00:00Z", href: "/contacts" },
    { id: "sample-activity-3", kind: "contact_stage_changed", summary: "Sample client moved to representation", subject: "Sample client", at: "2026-10-26T14:00:00Z", href: "/contacts" },
  ] },
  leaderboard: { availability: "available", data: [{ agentUserId: "sample-agent", name: "Sample Agent", activeCount: 2, closedCount: 0, closedVolumeCents: 0 }] },
};

// All business projections read the same ephemeral raw transaction book.
function setTransactionGroups(target, at) {
  const rows = readPreviewTransactionBundles().map(bundle => bundle.row).filter(row => row.side !== "gc"), active = rows.filter(row => isActiveStage(row.stage)), closed = rows.filter(row => row.stage === "closed"), month = businessDayKey(at).slice(0, 7);
  const closedMonth = closed.filter(row => row.closedDate?.startsWith(month)), cents = items => items.reduce((sum, row) => sum + (row.contractPriceCents || 0), 0), commission = items => items.reduce((sum, row) => sum + projectCommission(row).grossCents, 0);
  const monthly = Array.from({ length: 12 }, (_, index) => { const value = new Date(`${month}-01T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() - 11 + index); const key = value.toISOString().slice(0, 10), items = closed.filter(row => row.closedDate?.startsWith(key.slice(0, 7))); return { month: key, closedCount: items.length, closedVolumeCents: cents(items), commissionCents: commission(items) }; });
  Object.assign(target.transactions.data, { activeCount: active.length, onHoldCount: rows.filter(row => row.stage === "on_hold").length, activeVolumeCents: cents(active), activeVolumeUnpricedCount: active.filter(row => row.contractPriceCents === null).length, projectedCommissionCents: commission(active), projectedCommissionUntermedCount: active.filter(row => projectCommission(row).basis === "none").length, scheduledClosingsThisMonth: active.filter(row => row.closingDate?.startsWith(month)).length, closedThisMonthCount: closedMonth.length, closedThisMonthVolumeCents: cents(closedMonth), monthly });
  const owners = [...new Set(rows.map(row => row.agentUserId))];
  const brokerageScope = ["admin", "broker", "transaction_coordinator"].includes(SAMPLE_ACTOR.role);
  target.scope = brokerageScope ? "brokerage" : "own";
  target.leaderboard.data = brokerageScope ? owners.map(agentUserId => ({ agentUserId, name: contactAgents.find(agent => agent.id === agentUserId)?.name || "Sample Agent", activeCount: active.filter(row => row.agentUserId === agentUserId).length, closedCount: closedMonth.filter(row => row.agentUserId === agentUserId).length, closedVolumeCents: cents(closedMonth.filter(row => row.agentUserId === agentUserId)) })) : [];
}

function contactFigures(contacts, at, month) {
  const thisMonthContacts = contacts.filter(contact => new Date(contact.createdDate) >= new Date(`${month}T00:00:00Z`));
  const sourceCounts = new Map();
  thisMonthContacts.forEach(contact => sourceCounts.set(contact.source, (sourceCounts.get(contact.source) || 0) + 1));
  const attention = contacts.flatMap(contact => {
    if (!OPEN_PIPELINE_STAGES.includes(contact.stage)) return [];
    const status = effectiveFollowUpStatus(contact, at);
    return status.state === "due_today" || status.state === "overdue" ? [{ id: `follow-up:${contact.id}`, kind: "follow_up_due", label: "Follow up", subject: contact.name, dueDate: status.day, daysAway: status.daysAway, href: `/contacts?open=${contact.id}`, ...(contact.nextAction ? nextActionAttentionFields(contact.nextAction, at) : {}) }] : [];
  });
  return {
    data: {
      activeClients: contacts.filter(contact => ACTIVE_CLIENT_STAGES.includes(contact.stage)).length,
      newLeadsThisMonth: thisMonthContacts.length,
      followUpsDue: attention.length,
      lifecycle: LIFECYCLE_STAGES.map(stage => ({ stage, count: contacts.filter(contact => contact.stage === stage).length })),
      newLeadsBySource: [...sourceCounts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    },
    attention,
  };
}
function transactionAttentionAt(at) {
  return readPreviewTransactionBundles().filter(bundle => bundle.row.side !== "gc" && isActiveStage(bundle.row.stage)).flatMap(bundle => bundle.deadlines.flatMap(deadline => {
    if (deadline.completedAt || deadline.removedAt) return [];
    const dueDate = deadline.dueDate;
    const daysAway = dayDiff(dueDate, businessDayKey(at));
    return daysAway <= 7 ? [{ id: `deadline:${deadline.id}`, kind: daysAway < 0 ? "deadline_overdue" : "deadline_soon", label: deadline.label, subject: bundle.row.addressLine1, dueDate, daysAway, href: `/transactions/${encodeURIComponent(previewTransactionPublicId(bundle.row.id))}` }] : [];
  }));
}
function setContactGroups(target, contacts, at) {
  const derived = contactFigures(contacts, at, target.monthStart);
  target.contacts.data = derived.data;
  const attention = [...derived.attention, ...transactionAttentionAt(at)].sort(compareAttention);
  target.attention.data = { items: attention, overdueCount: attention.filter(attentionIsOverdue).length, soonCount: attention.filter(item => !attentionIsOverdue(item) && item.daysAway <= 7).length };
}
setContactGroups(metrics, readSampleContacts(), previewNow);
setTransactionGroups(metrics, previewNow);
metrics.activity.data = [...getSampleShowingActivity(), ...metrics.activity.data].sort((a, b) => b.at.localeCompare(a.at));

/** A fresh view of the same ephemeral session used by all contact reads. */
export function getPreviewMetrics(at = new Date()) {
  const result = structuredClone(metrics);
  result.generatedAt = at.toISOString();
  setContactGroups(result, readSampleContacts(), at);
  setTransactionGroups(result, at);
  // Match the production Home feed's eight most recent business events.
  result.activity.data = [...new Map([...readSampleActionActivity(), ...getSampleShowingActivity(), ...previewTransactionActivity(), ...result.activity.data].map(item => [item.id, item])).values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  return result;
}

const names = ["calendar", "documents", "messages", "notifications", "market", "team", "brokerage", "integrations", "reports"];
const subsystems = Object.fromEntries(names.map(name => [name, "not_configured"]));
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

export function installPreviewTransport() {
  // No fallback to the browser's real fetch. This preview cannot reach APIs.
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
    if (url.origin !== window.location.origin) return json({ error: "External requests are disabled in the design preview." }, 403);
    const path = url.pathname.replace(/^\/dashboard/, "");
    const transactionResponse = await transactionTransport(path, url, input, init);
    if (transactionResponse) return transactionResponse;
    const savedTourResponse = await savedTourTransport(path, url, input, init);
    if (savedTourResponse) return savedTourResponse;
    const tourResponse = await tourTransport(path, url, input, init);
    if (tourResponse) return tourResponse;
    const showingResponse = await showingTransport(path, url, input, init);
    if (showingResponse) return showingResponse;
    if ((init.method || "GET").toUpperCase() !== "GET") {
      if (path === "/api/search") return json({ query: "", hits: [], providers: { contact: "available", transaction: "available", listing: "not_configured", agent: "available" }, truncated: false });
      return json({ error: "Design preview: changes are disabled." }, 403);
    }
    if (path === "/api/metrics") return json(getPreviewMetrics());
    if (path === "/api/subsystems") return json({ subsystems });
    if (path === "/api/listings/source") return json({ source: "not_configured" });
    return json({ error: "This service is not part of the design preview." }, 404);
  };
}
