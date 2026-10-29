"use client";

/**
 * Transactions — pipeline board (drag to advance) with a table alternative.
 * Search and side filter drive the adapter query; ?open=<txnId> deep-links
 * straight into the shared detail drawer.
 *
 * This is a work list, not a report, so it is deliberately NOT windowed by the
 * global reporting period. That period is set on Home and Reports and has no
 * control here: applying it would filter this list by a setting the user
 * cannot see, and would drop every deal with no contract or closing date yet —
 * which is every deal at the opportunity stage.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, ServerCrash, Workflow } from "lucide-react";
import { PageIntro } from "@/components/common/page-intro";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KanbanBoard } from "@/components/transactions/kanban-board";
import { TransactionDrawer } from "@/components/transactions/transaction-drawer";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getTransactions } from "@/lib/data/adapters/transactions";
import { useQuery } from "@/lib/data/hooks";
import { TRANSACTION_STAGES } from "@/lib/data/types";

type SideFilter = "all" | "listing" | "buyer";
type View = "board" | "table";

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <PageIntro title="Transactions" description="Track each file’s stage, dates, and next milestone." icon={Workflow} />
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="ml-auto h-9 w-40 rounded-full" />
      </div>
      <div className="flex gap-4 overflow-x-hidden pb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex w-[280px] flex-none flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <div className="flex flex-col gap-2 rounded-panel bg-tint p-2">
              {Array.from({ length: (i % 3) + 1 }).map((_, j) => (
                <Skeleton key={j} className="h-28 w-full rounded-panel bg-card" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransactionsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [side, setSide] = useState<SideFilter>("all");
  const [view, setView] = useState<View>("board");

  const openParam = searchParams.get("open");
  const [drawerId, setDrawerId] = useState<string | null>(openParam);
  const [drawerOpen, setDrawerOpen] = useState(openParam !== null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  // Deep link: /transactions?open=<txnId> opens the drawer on load (and on
  // any later navigation that sets the param).
  useEffect(() => {
    if (openParam) {
      setDrawerId(openParam);
      setDrawerOpen(true);
    }
  }, [openParam]);

  const { data: transactions, loading, error, refetch } = useQuery(
    () =>
      getTransactions({
        query: debouncedSearch || undefined,
        side: side === "all" ? undefined : [side],
      }),
    [debouncedSearch, side]
  );
  const tableOnlyCount = transactions?.filter((txn) => !TRANSACTION_STAGES.includes(txn.stage)).length ?? 0;

  function openTransaction(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  function handleDrawerOpenChange(nextOpen: boolean) {
    setDrawerOpen(nextOpen);
    // Drop the deep-link param on close so a refresh does not reopen it.
    if (!nextOpen && searchParams.get("open")) {
      router.replace("/transactions", { scroll: false });
    }
  }

  return (
    <div className="space-y-5">
      <PageIntro title="Transactions" description="Track each file’s stage, dates, and next milestone." icon={Workflow} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address or client"
            aria-label="Search transactions"
            className="pl-9"
          />
        </div>
        <Select value={side} onValueChange={(v) => setSide(v as SideFilter)}>
          <SelectTrigger aria-label="Filter by side" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sides</SelectItem>
            <SelectItem value="listing">Listing side</SelectItem>
            <SelectItem value="buyer">Buyer side</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Segmented
            ariaLabel="Transactions view"
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: "Board" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
      </div>
      {view === "board" && !error && tableOnlyCount > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span>{tableOnlyCount} {tableOnlyCount === 1 ? "paused or exited file is" : "paused or exited files are"} shown in the table.</span>
          <button type="button" className="min-h-10 rounded-md font-semibold text-foreground underline underline-offset-4" onClick={() => setView("table")}>View table</button>
        </p>
      )}
      {error ? (
        <Card>
          <EmptyState
            icon={ServerCrash}
            title="Transactions could not be loaded"
            description="Your files are temporarily unavailable. Retry to load them again."
            action={<Button variant="outline" onClick={refetch} disabled={loading}>{loading ? "Retrying…" : "Retry"}</Button>}
          />
        </Card>
      ) : view === "board" ? (
        <KanbanBoard
          transactions={transactions}
          loading={loading}
          onOpen={openTransaction}
        />
      ) : (
        <TransactionsTable
          transactions={transactions}
          loading={loading}
          onOpen={openTransaction}
        />
      )}
      <TransactionDrawer
        transactionId={drawerId}
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TransactionsPageInner />
    </Suspense>
  );
}
