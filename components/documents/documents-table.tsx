"use client";

/**
 * Documents table — sortable by name, status, and updated; 12-row pages.
 * The transaction cell deep-links into the transaction drawer; the row menu
 * carries the working status actions (mark executed, request signature).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
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
import { updateDocumentStatus } from "@/lib/data/adapters/documents";
import { canWrite, writeDisabledReason } from "@/lib/data/provenance";
import {
  DOCUMENT_STATUS_LABELS,
  DocumentStatus,
  TransactionDocument,
} from "@/lib/data/types";
import { cn, formatDateShort, formatRelative } from "@/lib/utils";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_ORDER,
  DOCUMENT_STATUS_TONE,
  isPastDue,
} from "./doc-shared";

const PAGE_SIZE = 12;

type SortKey = "name" | "status" | "updated";
type SortDir = "asc" | "desc";

const COLUMNS: { id: string; label: string; sortKey?: SortKey }[] = [
  { id: "name", label: "Document", sortKey: "name" },
  { id: "transaction", label: "Transaction" },
  { id: "status", label: "Status", sortKey: "status" },
  { id: "updated", label: "Updated", sortKey: "updated" },
  { id: "due", label: "Due" },
];

function sortValue(doc: TransactionDocument, key: SortKey): string | number {
  switch (key) {
    case "name":
      return doc.name.toLowerCase();
    case "status":
      return DOCUMENT_STATUS_ORDER[doc.status];
    case "updated":
      return new Date(doc.updatedDate).getTime();
  }
}

function TableSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="mb-4 h-4 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function DocumentsTable({
  documents,
  loading,
  hasFilters,
  onClearFilters,
}: {
  documents: TransactionDocument[] | undefined;
  loading: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = documents ? [...documents] : [];
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
  }, [documents, sortKey, sortDir]);

  if (!documents) return <TableSkeleton />;

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
      setSortDir(key === "updated" ? "desc" : "asc");
    }
    setPage(1);
  }

  async function setStatus(id: string, status: DocumentStatus) {
    setBusyId(id);
    try {
      // A sample-backed domain accepts this write into an in-memory
      // fixture and loses it on reload. Refuse it rather than let the
      // change look saved.
      if (!canWrite("documents")) return;
      await updateDocumentStatus(id, status);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card aria-busy={loading} className="p-6">
      <p className="tabular mb-4 text-[13px] text-muted-foreground">
        {total === 1 ? "1 document" : `${total} documents`}
      </p>
      {total === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents match"
          description={
            hasFilters
              ? "Clear the search or filters, or pick a different file."
              : "Drop a file in the panel above to add the first document."
          }
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((col) => {
                  if (!col.sortKey) {
                    return <TableHead key={col.id}>{col.label}</TableHead>;
                  }
                  const active = sortKey === col.sortKey;
                  return (
                    <TableHead
                      key={col.id}
                      aria-sort={
                        active
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sortKey!)}
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
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((doc) => {
                const overdue = isPastDue(doc);
                const busy = busyId === doc.id;
                const hasActions = doc.status !== "executed";
                return (
                  <TableRow key={doc.id} className={cn(busy && "opacity-60")}>
                    <TableCell>
                      <span className="block font-semibold leading-snug">
                        {doc.name}
                      </span>
                      <span className="text-micro mt-0.5 block">
                        {DOCUMENT_KIND_LABELS[doc.kind]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/transactions?open=${doc.transactionId}`}
                        className="whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground hover:underline"
                      >
                        {doc.address}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={DOCUMENT_STATUS_TONE[doc.status]}>
                        {DOCUMENT_STATUS_LABELS[doc.status]}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-muted-foreground">
                      {formatRelative(doc.updatedDate)}
                    </TableCell>
                    <TableCell>
                      {doc.dueDate ? (
                        <span
                          className={cn(
                            "tabular whitespace-nowrap",
                            overdue
                              ? "font-semibold text-status-bad"
                              : "text-muted-foreground"
                          )}
                        >
                          {formatDateShort(doc.dueDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {hasActions && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              aria-label={`Actions for ${doc.name}`}
                            >
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!canWrite("documents")}
                              onSelect={() => setStatus(doc.id, "executed")}
                            >
                              Mark executed
                            </DropdownMenuItem>
                            {doc.status === "missing" && (
                              <DropdownMenuItem
                                disabled={!canWrite("documents")}
                                onSelect={() =>
                                  setStatus(doc.id, "pendingSignature")
                                }
                              >
                                Request signature
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
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
