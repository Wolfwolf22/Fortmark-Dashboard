/** Exercise the actual labelled sample Home, Reports, ROI and agent reducers without network access. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "fortmark-gc-sample-metrics-"));
try {
  const entry = String.raw`
import assert from "node:assert/strict";
import { sampleBrokerageMetrics } from "./lib/data/sample-metrics";
import { getDashboardMetrics, getClosedVolumeSeries, getLeadSourceRoi } from "./lib/data/adapters/metrics";
import { getLeaderboard } from "./lib/data/adapters/agents";
import { createSampleTransaction } from "./lib/data/sample-transactions";
import { transactions, leads, agents } from "./lib/data/mock/db";
import { now, rangeFromPreset } from "./lib/dates";
import { ALL_STAGES } from "./lib/transactions/stages";

let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; }
function equal(name, actual, expected) { assert.deepEqual(actual, expected, name); checks++; }
const originalTransactions = [...transactions], originalLeads = [...leads];
const at = now(), stamp = at.toISOString(), range = rangeFromPreset("month", at);
const presets = ["today", "week", "month", "quarter", "year"];
const calls = [];
globalThis.fetch = async (path, init = {}) => {
  calls.push({ path: String(path), method: init.method ?? "GET" });
  assert.equal(String(path), "/dashboard/api/subsystems", "No real metrics or provider endpoint may be contacted");
  assert.equal(init.method ?? "GET", "GET");
  return new Response(JSON.stringify({ subsystems: { reports: "sample", team: "sample" } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
async function snapshot() {
  const [reports, volumes, roi, leaderboard] = await Promise.all([
    Promise.all(presets.map(preset => getDashboardMetrics(range, preset))),
    Promise.all(presets.map(getClosedVolumeSeries)),
    getLeadSourceRoi(range),
    getLeaderboard(range),
  ]);
  return { home: sampleBrokerageMetrics(at), reports, volumes, roi, leaderboard };
}
function unchanged(label, actual, expected) {
  equal(label + " Home totals, monthly series, contacts and attention", actual.home, expected.home);
  equal(label + " all five Reports presets, previous volume and commission/sparkline charts", actual.reports, expected.reports);
  equal(label + " closed volume series for all five presets", actual.volumes, expected.volumes);
  equal(label + " ROI average excludes GC from both total and divisor", actual.roi, expected.roi);
  equal(label + " agent production, closed counts, offers and ranking", actual.leaderboard, expected.leaderboard);
}
async function main() {
  const seeded = await snapshot();
  const ordinary = { ...transactions[0], id: "gc-metrics-ordinary-active", listingId: undefined, address: "Ordinary sample sales control", side: "buyer", transactionType: "residential_sale", stage: "financing", contractPrice: 100000, commissionRate: 0.03, projectedCommission: 3000, contractDate: stamp, closeDate: stamp, agentId: agents[0].id, milestones: [], status: "good", statusLabel: "On track" };
  transactions.push(ordinary, { ...ordinary, id: "gc-metrics-ordinary-closed", side: "listing", stage: "closed", contractPrice: 200000, projectedCommission: 6000 }, { ...ordinary, id: "gc-metrics-ordinary-prior-closed", stage: "closed", contractPrice: 300000, projectedCommission: 9000, closeDate: new Date(range.from.getTime() - 86400000).toISOString() });
  leads.push({ ...leads[0], id: "gc-metrics-ordinary-referral", stage: "past_client", source: "referral", createdDate: stamp });
  const baseline = await snapshot();
  check("ordinary sales remain included in sample Home active and closed metrics", baseline.home.transactions.data.activeCount === seeded.home.transactions.data.activeCount + 1 && baseline.home.transactions.data.closedThisMonthCount === seeded.home.transactions.data.closedThisMonthCount + 1 && baseline.home.transactions.data.activeVolumeCents === seeded.home.transactions.data.activeVolumeCents + 10000000);
  check("ordinary sales remain included in Reports current and previous production", baseline.reports[2].closedVolume === seeded.reports[2].closedVolume + 200000 && baseline.reports[2].closedVolumePrev === seeded.reports[2].closedVolumePrev + 300000 && baseline.reports[2].pipelineValue === seeded.reports[2].pipelineValue + 100000 && baseline.reports[2].projectedGci === seeded.reports[2].projectedGci + 3000);
  const leader = rows => rows.find(row => row.agentId === agents[0].id);
  check("ordinary sales remain included in agent production", leader(baseline.leaderboard).offersMade === leader(seeded.leaderboard).offersMade + 3 && leader(baseline.leaderboard).dealsClosed === leader(seeded.leaderboard).dealsClosed + 1 && leader(baseline.leaderboard).closedDollars === leader(seeded.leaderboard).closedDollars + 200000 && leader(baseline.leaderboard).volume === leader(seeded.leaderboard).volume + 100000);
  check("ROI has a positive converted lead and commission baseline", baseline.roi.some(row => row.converted > 0 && row.closedDollars > 0 && row.roi > 0));

  const gc = createSampleTransaction({ side: "gc", address: "Blank sample GC project", clientName: "Sample GC client" });
  check("actual sample quick-create produces a blank GC setup file", gc.side === "gc" && gc.stage === "opportunity" && gc.contractPrice === 0 && gc.closeDate === undefined && gc.statusLabel === "Setup pending");
  unchanged("Blank GC creation", await snapshot(), baseline);

  const fakeDeadline = { id: "gc-false-closing", key: "closing", label: "GC must not become sales attention", date: stamp, state: "overdue" };
  const contaminated = ALL_STAGES.map((stage, i) => ({ ...ordinary, id: "gc-contaminated-" + stage, side: "gc", transactionType: "general_contractor", address: "Contaminated GC sample " + i, stage, contractPrice: 900000000, commissionRate: 1, projectedCommission: 900000000, milestones: [fakeDeadline] }));
  transactions.push(...contaminated, { ...contaminated[0], id: "gc-contaminated-previous-closed", stage: "closed", closeDate: new Date(range.from.getTime() - 86400000).toISOString() });
  unchanged("Contaminated GC in every sales stage and previous range", await snapshot(), baseline);
  check("sample metric readers never rewrite or normalize stored GC research facts", contaminated.every(row => row.contractPrice === 900000000 && row.projectedCommission === 900000000 && row.milestones[0] === fakeDeadline));

  transactions.splice(0, transactions.length, gc, ...contaminated);
  const onlyGc = await snapshot(), totals = onlyGc.home.transactions.data;
  check("GC-only Home has zero sales counts and money", totals.activeCount === 0 && totals.onHoldCount === 0 && totals.activeVolumeCents === 0 && totals.activeVolumeUnpricedCount === 0 && totals.projectedCommissionCents === 0 && totals.projectedCommissionUntermedCount === 0 && totals.scheduledClosingsThisMonth === 0 && totals.closedThisMonthCount === 0 && totals.closedThisMonthVolumeCents === 0 && totals.monthly.every(point => point.closedCount === 0 && point.closedVolumeCents === 0 && point.commissionCents === 0));
  check("GC-only Reports have no sales pipeline, closings or charts", onlyGc.reports.every(report => report.underContractCount === 0 && report.closedCount === 0 && report.pipelineValue === 0 && report.projectedGci === 0 && report.closedVolume === 0 && report.closedVolumePrev === 0 && report.closedVolumeSpark.every(point => point.value === 0) && report.commissionByPeriod.every(point => point.value === 0)) && onlyGc.volumes.every(series => series.points.every(point => point.value === 0)));
  check("GC-only ROI remains finite zero without a sales denominator", onlyGc.roi.every(row => row.closedDollars === 0 && row.roi === 0 && Number.isFinite(row.roi)));
  check("GC-only roster has no sales offers, counts or production", onlyGc.leaderboard.every(row => row.offersMade === 0 && row.volume === 0 && row.dealsClosed === 0 && row.closedDollars === 0));
  check("GC milestones never appear as sample sales deadline attention", onlyGc.home.attention.data.items.every(item => !item.id.startsWith("deadline:")));
  check("actual adapters only share one synthetic subsystem guard request", calls.length === 1);
  console.log(checks + "/" + checks + " GC sample metrics checks passed (actual adapters and isolated memory; no network)");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  transactions.splice(0, transactions.length, ...originalTransactions);
  leads.splice(0, leads.length, ...originalLeads);
});
`;
  const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false });
  const path = join(temporary, "gc-sample-metrics.cjs");
  writeFileSync(path, bundled.outputFiles[0].contents);
  const run = spawnSync(process.execPath, [path], { stdio: "inherit" });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error("GC sample metrics regression failed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
