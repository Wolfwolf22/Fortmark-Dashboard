"use client";

/**
 * Documents — every transaction document in one table with status chips,
 * a transaction filter, working status actions, and an upload dropzone
 * stub. ?transaction=<id> arrives pre-filtered from the transaction drawer.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { DocumentsTable } from "@/components/documents/documents-table";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getDocuments } from "@/lib/data/adapters/documents";
import { getTransactions } from "@/lib/data/adapters/transactions";
import { useQuery } from "@/lib/data/hooks";
import { DOCUMENT_STATUS_LABELS, DocumentStatus } from "@/lib/data/types";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | DocumentStatus;

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "missing",
  "pendingSignature",
  "executed",
];

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-32 w-full rounded-card" />
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="h-96 w-full rounded-card" />
    </div>
  );
}

function DocumentsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const transactionParam = searchParams.get("transaction");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [transactionId, setTransactionId] = useState<string>(
    transactionParam ?? "all"
  );

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  // Deep link: /documents?transaction=<id> filters to that file on load and
  // on any later navigation that sets the param.
  useEffect(() => {
    if (transactionParam) setTransactionId(transactionParam);
  }, [transactionParam]);

  // One query without the status filter: the chips slice client-side so the
  // counts always reflect the current search and transaction scope.
  const { data: documents, loading } = useQuery(
    () =>
      getDocuments({
        query: debouncedSearch || undefined,
        transactionId: transactionId === "all" ? undefined : transactionId,
      }),
    [debouncedSearch, transactionId]
  );

  const { data: transactions } = useQuery(() => getTransactions(), []);

  const counts = useMemo(() => {
    if (!documents) return undefined;
    const result: Record<StatusFilter, number> = {
      all: documents.length,
      missing: 0,
      pendingSignature: 0,
      executed: 0,
    };
    for (const doc of documents) result[doc.status] += 1;
    return result;
  }, [documents]);

  const visible = useMemo(
    () =>
      status === "all" || !documents
        ? documents
        : documents.filter((d) => d.status === status),
    [documents, status]
  );

  // Active transactions for the filter; keep the selected one listed even
  // if it has since closed so the control stays readable.
  const transactionOptions = useMemo(() => {
    const list = (transactions ?? []).filter((t) => t.stage !== "closed");
    if (transactionId !== "all" && !list.some((t) => t.id === transactionId)) {
      const selected = (transactions ?? []).find((t) => t.id === transactionId);
      if (selected) list.push(selected);
    }
    return list;
  }, [transactions, transactionId]);

  const hasFilters =
    debouncedSearch !== "" || status !== "all" || transactionId !== "all";

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatus("all");
    setTransactionId("all");
    // Drop the deep-link param so a refresh does not re-apply it.
    if (searchParams.get("transaction")) {
      router.replace("/documents", { scroll: false });
    }
  }

  return (
    <div className="space-y-5">
      <UploadDropzone
        transactions={transactions}
        defaultTransactionId={transactionId === "all" ? undefined : transactionId}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search document or address"
            aria-label="Search documents"
            className="pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap items-center gap-1.5"
        >
          {STATUS_FILTERS.map((s) => {
            const active = status === s;
            const label = s === "all" ? "All" : DOCUMENT_STATUS_LABELS[s];
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(s)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold transition-colors duration-150",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-input bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {label}
                {counts && (
                  <span className="tabular text-xs opacity-70">{counts[s]}</span>
                )}
              </button>
            );
          })}
        </div>
        <Select value={transactionId} onValueChange={setTransactionId}>
          <SelectTrigger aria-label="Filter by transaction" className="w-64">
            <SelectValue placeholder="All files" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All files</SelectItem>
            {transactionOptions.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.address} — {t.clientName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DocumentsTable
        documents={visible}
        loading={loading}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DocumentsPageInner />
    </Suspense>
  );
}
