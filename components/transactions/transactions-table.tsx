"use client";

/**
 * Full transactions table — the board's flat counterpart. Sortable headers,
 * stage filter, 12-row pagination; a row click opens the shared drawer.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  StatusTone,
  Transaction,
  TransactionStage,
  TRANSACTION_STAGES,
  TRANSACTION_STAGE_LABELS,
} from "@/lib/data/types";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { daysToClose, SIDE_SHORT } from "./txn-shared";

const PAGE_SIZE = 12;

type SortKey =
  | "address"
  | "city"
  | "client"
  | "side"
  | "stage"
  | "price"
  | "contractDate"
  | "closeDate"
  | "days"
  | "status";
type SortDir = "asc" | "desc";
type StageFilter = "all" | TransactionStage;

const STATUS_RANK: Record<StatusTone, number> = {
  good: 0,
  warn: 1,
  bad: 2,
  neutral: 3,
};

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "client", label: "Client" },
  { key: "side", label: "Side" },
  { key: "stage", label: "Stage" },
  { key: "price", label: "Contract price", align: "right" },
  { key: "contractDate", label: "Contract date" },
  { key: "closeDate", label: "Close date" },
  { key: "days", label: "Days to close", align: "right" },
  { key: "status", label: "Status" },
];

function sortValue(t: Transaction, key: SortKey): string | number {
  switch (key) {
    case "address":
      return t.address.toLowerCase();
    case "city":
      return t.city.toLowerCase();
    case "client":
      return t.clientName.toLowerCase();
    case "side":
      return t.side;
    case "stage":
      return TRANSACTION_STAGES.indexOf(t.stage);
    case "price":
      return t.contractPrice;
    case "contractDate":
      return new Date(t.contractDate).getTime();
    case "closeDate":
      return new Date(t.closeDate).getTime();
    case "days":
      return daysToClose(t.closeDate);
    case "status":
      return STATUS_RANK[t.status];
  }
}

function TableSkeleton() {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-44" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function TransactionsTable({
  transactions,
  loading,
  onOpen,
}: {
  transactions: Transaction[] | undefined;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [stage, setStage] = useState<StageFilter>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [stage]);

  const rows = useMemo(() => {
    let list = transactions ? [...transactions] : [];
    if (stage !== "all") list = list.filter((t) => t.stage === stage);
    list.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [transactions, stage, sortKey, sortDir]);

  if (!transactions) return <TableSkeleton />;

  const total = rows.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, maxPage);
  const start = (current - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <Card aria-busy={loading} className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="tabular text-[13px] text-muted-foreground">
          {total === 1 ? "1 transaction" : `${total} transactions`}
        </p>
        <Select value={stage} onValueChange={(v) => setStage(v as StageFilter)}>
          <SelectTrigger aria-label="Filter by stage" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {TRANSACTION_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRANSACTION_STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {total === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No transactions match"
          description="Clear the stage filter, adjust the search, or widen the date range."
        />
      ) : (
        <>
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
                          : "none"
                      }
                      className={col.align === "right" ? "text-right" : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "text-micro inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground",
                          active && "text-foreground"
                        )}
                      >
                        {col.label}
                        {active ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />
                        )}
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((t) => {
                const days = daysToClose(t.closeDate);
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(t.id);
                        }}
                        className="text-left font-semibold leading-snug hover:underline"
                      >
                        {t.address}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.city}</TableCell>
                    <TableCell>{t.clientName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{SIDE_SHORT[t.side]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="muted">
                        {TRANSACTION_STAGE_LABELS[t.stage]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {formatCurrency(t.contractPrice)}
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {formatDate(t.contractDate)}
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {formatDate(t.closeDate)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {t.stage === "closed" ? "—" : `${days}d`}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={t.status}>{t.statusLabel}</StatusPill>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="tabular text-[13px] text-muted-foreground">
              Showing {start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(current - 1)}
                disabled={current <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= maxPage}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
