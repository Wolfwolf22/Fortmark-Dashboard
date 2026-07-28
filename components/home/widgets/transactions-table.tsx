"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Workflow } from "lucide-react";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { TransactionDrawer } from "@/components/transactions/transaction-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { getTransactions } from "@/lib/data/adapters/transactions";
import { useQuery } from "@/lib/data/hooks";
import {
  TRANSACTION_STAGES,
  TRANSACTION_STAGE_LABELS,
  type Transaction,
  type TransactionStage,
} from "@/lib/data/types";
import { cn, daysBetween, formatCurrency, formatDateShort } from "@/lib/utils";

type StageChoice = "active" | TransactionStage;

type SortKey =
  | "address"
  | "client"
  | "side"
  | "stage"
  | "price"
  | "closeDate"
  | "days"
  | "status";

type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = { good: 0, warn: 1, bad: 2, neutral: 3 };

const COLUMNS: { key: SortKey; label: string; alignRight?: boolean }[] = [
  { key: "address", label: "Property" },
  { key: "client", label: "Client" },
  { key: "side", label: "Side" },
  { key: "stage", label: "Stage" },
  { key: "price", label: "Contract price", alignRight: true },
  { key: "closeDate", label: "Close date" },
  { key: "days", label: "Days to close", alignRight: true },
  { key: "status", label: "Status" },
];

function sortValue(t: Transaction, key: SortKey): string | number {
  switch (key) {
    case "address":
      return t.address.toLowerCase();
    case "client":
      return t.clientName.toLowerCase();
    case "side":
      return t.side;
    case "stage":
      return TRANSACTION_STAGES.indexOf(t.stage);
    case "price":
      return t.contractPrice;
    case "closeDate":
    case "days":
      return new Date(t.closeDate).getTime();
    case "status":
      return STATUS_ORDER[t.status] ?? 4;
  }
}

/**
 * Active transactions table: stage-filterable, sortable, paginated; a row
 * click opens the shared transaction drawer.
 */
export default function TransactionsTableWidget() {
  // Gate persisted period overrides off first paint (hydration safety).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const { preset, range, overridden, setOverride } =
    useWidgetPeriod("transactions-table");
  const [stageChoice, setStageChoice] = React.useState<StageChoice>("active");
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { data, loading, error } = useQuery(
    () =>
      getTransactions(
        {
          stage:
            stageChoice === "active"
              ? TRANSACTION_STAGES.filter((s) => s !== "closed")
              : [stageChoice],
        },
        range
      ),
    [preset, range.from.getTime(), range.to.getTime(), stageChoice]
  );

  const openTransaction = React.useCallback((id: string) => {
    setDrawerId(id);
    setDrawerOpen(true);
  }, []);

  return (
    <>
      <WidgetCard
        icon={Workflow}
        title="Active transactions"
        preset={mounted ? preset : null}
        onPresetChange={setOverride}
        presetOverridden={overridden}
      >
        <TransactionsBody
          rows={data}
          loading={loading}
          error={error}
          stageChoice={stageChoice}
          onStageChange={setStageChoice}
          onOpenTransaction={openTransaction}
        />
      </WidgetCard>
      {/* Rendered outside the card so the expanded dialog doesn't mount a second sheet. */}
      <TransactionDrawer
        transactionId={drawerId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

function TransactionsBody({
  rows,
  loading,
  error,
  stageChoice,
  onStageChange,
  onOpenTransaction,
}: {
  rows: Transaction[] | undefined;
  loading: boolean;
  error: Error | null;
  stageChoice: StageChoice;
  onStageChange: (choice: StageChoice) => void;
  onOpenTransaction: (id: string) => void;
}) {
  const expanded = useWidgetExpanded();
  const pageSize = expanded ? 14 : 8;
  const [sortKey, setSortKey] = React.useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");
  const [page, setPage] = React.useState(0);
  // Stable per mount; rows only render after the client-side fetch resolves.
  const [now] = React.useState(() => new Date());

  React.useEffect(() => setPage(0), [stageChoice]);

  const sorted = React.useMemo(() => {
    if (!rows) return [];
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const filter = (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-micro">Stage</span>
      <Select
        value={stageChoice}
        onValueChange={(v) => onStageChange(v as StageChoice)}
      >
        <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Filter by stage">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">All active</SelectItem>
          {TRANSACTION_STAGES.map((s) => (
            <SelectItem key={s} value={s}>
              {TRANSACTION_STAGE_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (error) {
    return (
      <div>
        {filter}
        <p className="text-[13px] text-muted-foreground">
          Transactions failed to load. Refresh the page to retry.
        </p>
      </div>
    );
  }

  if (loading || !rows) {
    return (
      <div>
        {filter}
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div>
        {filter}
        <EmptyState
          icon={Workflow}
          title="No transactions in this period"
          description="Widen the range or change the stage filter."
        />
      </div>
    );
  }

  return (
    <div>
      {filter}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
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
                  className={cn(col.alignRight && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    aria-label={`Sort by ${col.label.toLowerCase()}`}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground",
                      col.alignRight && "w-full justify-end",
                      active && "text-foreground"
                    )}
                  >
                    {col.label}
                    {active &&
                      (sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ArrowDown className="h-3 w-3" aria-hidden />
                      ))}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((t) => {
            const days = daysBetween(now, t.closeDate);
            return (
              <TableRow
                key={t.id}
                tabIndex={0}
                onClick={() => onOpenTransaction(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenTransaction(t.id);
                  }
                }}
                aria-label={`Open transaction ${t.address}`}
                className="cursor-pointer"
              >
                <TableCell className="max-w-[16rem]">
                  <span className="block truncate font-semibold">{t.address}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{t.clientName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t.side === "list" ? "List" : "Buy"}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {TRANSACTION_STAGE_LABELS[t.stage]}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">
                  {formatCurrency(t.contractPrice)}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  {formatDateShort(t.closeDate)}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap text-right">
                  {t.stage === "closed" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    `${days}d`
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill tone={t.status}>{t.statusLabel}</StatusPill>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {sorted.length > pageSize && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <p className="text-micro tabular">
            Showing {start + 1}–{Math.min(start + pageSize, sorted.length)} of{" "}
            {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="muted"
              size="sm"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 0}
            >
              Previous
            </Button>
            <Button
              variant="muted"
              size="sm"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
