// Deliberately synthetic, nonpersistent fixtures for visual review only.
const monthStart = "2026-10-01";
const monthly = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 10 + index, 1));
  return { month: date.toISOString().slice(0, 10), closedCount: 0, closedVolumeCents: 0, commissionCents: 0 };
});
export const metrics = {
  source: "sample", generatedAt: "2026-10-28T16:00:00.000Z", scope: "brokerage", contactsScope: "brokerage", monthStart,
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

const names = ["calendar", "documents", "messages", "notifications", "market", "team", "brokerage", "integrations", "reports"];
const subsystems = Object.fromEntries(names.map(name => [name, "not_configured"]));
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

export function installPreviewTransport() {
  // No fallback to the browser's real fetch. This preview cannot reach APIs.
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
    if (url.origin !== window.location.origin) return json({ error: "External requests are disabled in the design preview." }, 403);
    const path = url.pathname.replace(/^\/dashboard/, "");
    if ((init.method || "GET").toUpperCase() !== "GET") {
      if (path === "/api/search") return json({ query: "", hits: [], providers: { contact: "available", transaction: "available", listing: "not_configured", agent: "available" }, truncated: false });
      return json({ error: "Design preview: changes are disabled." }, 403);
    }
    if (path === "/api/metrics") return json(metrics);
    if (path === "/api/subsystems") return json({ subsystems });
    if (path === "/api/transactions/source") return json({ source: "db" });
    if (path === "/api/transactions") return json({ items: [] });
    if (path === "/api/listings/source") return json({ source: "not_configured" });
    return json({ error: "This service is not part of the design preview." }, 404);
  };
}
