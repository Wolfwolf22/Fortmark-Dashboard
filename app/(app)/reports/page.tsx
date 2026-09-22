"use client";

/**
 * Reports — production analytics for the global period. The top-bar period
 * selector re-filters everything here; each card exports its rendered
 * dataset as CSV.
 *
 * Every figure on this page comes from a generator: closed volume, a
 * list-to-sale ratio, median days on market, projected GCI, production per
 * named agent. There is no reporting source behind any of it, and no
 * subset of it can be computed from the real transaction and contact
 * domains without building the analytics domain this product does not yet
 * have. So outside the labelled fixture mode the page states that plainly
 * instead — a Reports page that says reports are unavailable is safe, and
 * one showing an invented $309.6K of projected commission is not.
 */
import { AgentProductionCard } from "@/components/reports/agent-production-table";
import { ClosedVolumeChartCard } from "@/components/reports/closed-volume-chart";
import { LeadSourceRoiCard } from "@/components/reports/lead-source-roi-table";
import { ProductionByAgentCard } from "@/components/reports/production-by-agent";
import { ReportStatTiles } from "@/components/reports/stat-tiles";
import { SubsystemNotConnected, useSubsystem } from "@/components/common/subsystem-state";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsPage() {
  const { loading, state } = useSubsystem("reports");

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (state !== "sample") {
    return (
      <Card className="flex min-h-[20rem] items-center justify-center">
        <SubsystemNotConnected subsystem="reports" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <SampleDataNotice subject="Every figure on this page is generated for development. None of it describes this brokerage." />
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
