"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Users } from "lucide-react";
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
import { getLeaderboard } from "@/lib/data/adapters/agents";
import { useQuery } from "@/lib/data/hooks";
import { type AgentProduction } from "@/lib/data/types";
import { useDateRange } from "@/lib/stores/date-range";
import { periodSublabel } from "@/lib/dates";
import { cn, formatCurrency } from "@/lib/utils";
import { ExportCsvButton } from "./export-csv-button";
import { buildCsv, csvFilename } from "./export-csv";
import { ReportCard } from "./report-card";

type SortKey = keyof Pick<
  AgentProduction,
  "name" | "offersMade" | "volume" | "dealsClosed" | "closedDollars"
>;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Agent", numeric: false },
  { key: "offersMade", label: "Offers", numeric: true },
  { key: "volume", label: "Active volume", numeric: true },
  { key: "dealsClosed", label: "Deals closed", numeric: true },
  { key: "closedDollars", label: "Closed dollars", numeric: true },
];

/**
 * Agent production — every producing agent's period numbers, sortable by any
 * column. The export mirrors the current sort order.
 */
export function AgentProductionCard() {
  const { preset, range } = useDateRange();
  const from = range.from.getTime();
  const to = range.to.getTime();
  const { data, loading } = useQuery(() => getLeaderboard(range), [
    preset,
    from,
    to,
  ]);

  const [sortKey, setSortKey] = React.useState<SortKey>("closedDollars");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Names read best ascending; numbers best descending.
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const rows = React.useMemo(() => {
    const sorted = [...(data ?? [])].sort((a, b) => {
      const cmp =
        sortKey === "name"
          ? a.name.localeCompare(b.name)
          : a[sortKey] - b[sortKey];
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, sortKey, sortDir]);

  return (
    <ReportCard
      title="Agent production"
      sublabel={periodSublabel(preset)}
      actions={
        <ExportCsvButton
          filename={csvFilename("agent-production", preset)}
          disabled={loading || rows.length === 0}
          getCsv={() =>
            buildCsv(
              COLUMNS.map((c) => c.label),
              rows.map((r) => [
                r.name,
                r.offersMade,
                formatCurrency(r.volume),
                r.dealsClosed,
                formatCurrency(r.closedDollars),
              ])
            )
          }
        />
      }
    >
      {loading || !data ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No agent production to report"
          description="Widen the range to see offers, volume, and closings by agent."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                return (
                  <TableHead
                    key={col.key}
                    aria-sort={
                      active
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={col.numeric ? "text-right" : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm uppercase transition-colors hover:text-foreground",
                        active && "text-foreground"
                      )}
                      aria-label={`Sort by ${col.label.toLowerCase()}`}
                    >
                      {col.label}
                      {active ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                      )}
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.agentId}>
                <TableCell className="font-semibold">{r.name}</TableCell>
                <TableCell className="text-right tabular">
                  {r.offersMade}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatCurrency(r.volume)}
                </TableCell>
                <TableCell className="text-right tabular">
                  {r.dealsClosed}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatCurrency(r.closedDollars)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
