"use client";

import * as React from "react";
import { Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLeadSourceRoi } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import { LEAD_SOURCE_LABELS } from "@/lib/data/types";
import { useDateRange } from "@/lib/stores/date-range";
import { periodSublabel } from "@/lib/dates";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { ExportCsvButton } from "./export-csv-button";
import { buildCsv, csvFilename } from "./export-csv";
import { ReportCard } from "./report-card";

/** Conversion is undefined with no leads — render a quiet dash instead. */
function conversionLabel(leads: number, converted: number): string {
  return leads > 0 ? formatPercent(converted / leads) : "—";
}

function roiLabel(roi: number): string {
  return `${roi.toFixed(1)}×`;
}

/**
 * Lead-source ROI — leads, conversions, attributed GCI, and spend per source,
 * ranked by return on spend.
 */
export function LeadSourceRoiCard() {
  const { preset, range } = useDateRange();
  const from = range.from.getTime();
  const to = range.to.getTime();
  const { data, loading } = useQuery(() => getLeadSourceRoi(range), [
    preset,
    from,
    to,
  ]);

  const rows = React.useMemo(
    () => [...(data ?? [])].sort((a, b) => b.roi - a.roi),
    [data]
  );
  const empty =
    !loading && rows.every((r) => r.leads === 0 && r.converted === 0);

  return (
    <ReportCard
      title="Lead-source ROI"
      sublabel={periodSublabel(preset)}
      actions={
        <ExportCsvButton
          filename={csvFilename("lead-source-roi", preset)}
          disabled={loading || empty}
          getCsv={() =>
            buildCsv(
              [
                "Source",
                "Leads",
                "Converted",
                "Conversion",
                "Attributed GCI",
                "Spend",
                "ROI",
              ],
              rows.map((r) => [
                LEAD_SOURCE_LABELS[r.source],
                r.leads,
                r.converted,
                conversionLabel(r.leads, r.converted),
                formatCurrency(r.closedDollars),
                formatCurrency(r.spend),
                roiLabel(r.roi),
              ])
            )
          }
        />
      }
    >
      {loading || !data ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : empty ? (
        <EmptyState
          icon={Target}
          title="No leads in this period"
          description="Widen the range or add a lead to see source performance."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Converted</TableHead>
              <TableHead className="text-right">Conversion</TableHead>
              <TableHead className="text-right">Attributed GCI</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">ROI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.source}>
                <TableCell className="font-semibold">
                  {LEAD_SOURCE_LABELS[r.source]}
                </TableCell>
                <TableCell className="text-right tabular">{r.leads}</TableCell>
                <TableCell className="text-right tabular">
                  {r.converted}
                </TableCell>
                <TableCell className="text-right tabular">
                  {conversionLabel(r.leads, r.converted)}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatCurrency(r.closedDollars)}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatCurrency(r.spend)}
                </TableCell>
                <TableCell className="text-right tabular font-semibold">
                  {roiLabel(r.roi)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
