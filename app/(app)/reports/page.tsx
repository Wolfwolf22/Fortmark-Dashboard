"use client";

/**
 * Reports — production analytics for the global period. The top-bar period
 * selector re-filters everything here; each card exports its rendered
 * dataset as CSV.
 */
import { AgentProductionCard } from "@/components/reports/agent-production-table";
import { ClosedVolumeChartCard } from "@/components/reports/closed-volume-chart";
import { LeadSourceRoiCard } from "@/components/reports/lead-source-roi-table";
import { ProductionByAgentCard } from "@/components/reports/production-by-agent";
import { ReportStatTiles } from "@/components/reports/stat-tiles";

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <ReportStatTiles />
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <ClosedVolumeChartCard />
        <ProductionByAgentCard />
      </div>
      <LeadSourceRoiCard />
      <AgentProductionCard />
    </div>
  );
}
