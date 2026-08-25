"use client";

/**
 * Transaction detail drawer — shared by the Home transactions widget and the
 * Transactions page. Controlled by (transactionId, open, onOpenChange);
 * loads the file through the adapter and renders the milestone timeline.
 */
import Link from "next/link";
import { canWrite, writeDisabledReason } from "@/lib/data/provenance";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { getAgent } from "@/lib/data/adapters/agents";
import {
  getTransaction,
  updateTransactionStage,
} from "@/lib/data/adapters/transactions";
import { useQuery } from "@/lib/data/hooks";
import {
  Milestone,
  Transaction,
  TransactionStage,
  TRANSACTION_STAGE_LABELS,
} from "@/lib/data/types";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { daysToClose, nextStage, SIDE_LABELS } from "./txn-shared";

export interface TransactionDrawerProps {
  transactionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Fact({
  label,
  value,
  numeric,
}: {
  label: string;
  value: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div>
      <p className="text-micro">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold", numeric && "tabular")}>
        {value}
      </p>
    </div>
  );
}

function MilestoneRow({
  milestone,
  last,
}: {
  milestone: Milestone;
  last: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[9px] top-6 w-px bg-border"
        />
      )}
      {milestone.state === "done" ? (
        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        </span>
      ) : milestone.state === "overdue" ? (
        <span
          aria-hidden
          className="h-5 w-5 flex-none rounded-full border-2 border-status-bad bg-status-bad-bg"
        />
      ) : (
        <span
          aria-hidden
          className="h-5 w-5 flex-none rounded-full border-2 border-input bg-card"
        />
      )}
      <div className="flex flex-1 items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-5">{milestone.label}</p>
          <p className="tabular mt-0.5 text-xs text-muted-foreground">
            {formatDate(milestone.date)}
          </p>
        </div>
        <span
          className={cn(
            "pt-0.5 text-xs",
            milestone.state === "overdue"
              ? "font-semibold text-status-bad"
              : "font-medium text-muted-foreground"
          )}
        >
          {milestone.state === "done"
            ? "Done"
            : milestone.state === "overdue"
              ? "Overdue"
              : "Upcoming"}
        </span>
      </div>
    </li>
  );
}

function DrawerSkeleton() {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">Loading transaction</SheetTitle>
        <SheetDescription className="sr-only">
          Transaction details are loading
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-2">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-32 w-full rounded-panel" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </>
  );
}

export function TransactionDrawer({
  transactionId,
  open,
  onOpenChange,
}: TransactionDrawerProps) {
  const { data, loading } = useQuery<Transaction | undefined>(
    () => (transactionId ? getTransaction(transactionId) : Promise.resolve(undefined)),
    [transactionId]
  );
  // Guard against stale data from a previously opened transaction.
  const txn = data && data.id === transactionId ? data : undefined;

  const agentId = txn?.agentId ?? null;
  const { data: agent } = useQuery(
    () => (agentId ? getAgent(agentId) : Promise.resolve(undefined)),
    [agentId]
  );

  const [advancing, setAdvancing] = useState(false);

  async function advance(to: TransactionStage) {
    if (!txn) return;
    setAdvancing(true);
    try {
      // The adapter bumps the data version, so the drawer and every open
      // list refetch on their own.
      // A sample-backed domain accepts this write into an in-memory
      // fixture and loses it on reload. Refuse it rather than let the
      // change look saved.
      if (!canWrite("transactions")) return;
      await updateTransactionStage(txn.id, to);
    } finally {
      setAdvancing(false);
    }
  }

  const next = txn ? nextStage(txn.stage) : undefined;
  const days = txn ? daysToClose(txn.closeDate) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto p-6 sm:max-w-xl">
        {txn ? (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle>{txn.address}</SheetTitle>
              <SheetDescription>{txn.city}</SheetDescription>
            </SheetHeader>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{SIDE_LABELS[txn.side]}</Badge>
              <Badge variant="muted">{TRANSACTION_STAGE_LABELS[txn.stage]}</Badge>
              <StatusPill tone={txn.status}>{txn.statusLabel}</StatusPill>
            </div>
            {txn.listingId && (
              <div className="mt-3">
                <Link
                  href={`/listings/${txn.listingId}`}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  View listing
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            )}
            <div className="flex-1">
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 rounded-panel bg-tint p-4">
                <Fact
                  label="Contract price"
                  numeric
                  value={formatCurrency(txn.contractPrice)}
                />
                <Fact
                  label="GCI at close"
                  numeric
                  value={formatCurrency(txn.contractPrice * txn.commissionRate)}
                />
                <Fact label="Close date" numeric value={formatDate(txn.closeDate)} />
                <Fact
                  label="Days to close"
                  numeric
                  value={
                    txn.stage === "closed"
                      ? "Closed"
                      : days < 0
                        ? `${Math.abs(days)} days past due`
                        : `${days} days`
                  }
                />
                <Fact label="Client" value={txn.clientName} />
                <Fact label="Listing agent" value={agent?.name ?? "—"} />
              </div>
              <p className="text-micro mt-6">Milestones</p>
              <ol className="mt-3">
                {txn.milestones.map((m, i) => (
                  <MilestoneRow
                    key={m.key}
                    milestone={m}
                    last={i === txn.milestones.length - 1}
                  />
                ))}
              </ol>
            </div>
            {txn.stage !== "closed" && next && !canWrite("transactions") && (
              <p role="note" className="mt-2 text-[12px] text-muted-foreground">
                {writeDisabledReason("transactions")}
              </p>
            )}
            {txn.stage !== "closed" && next && (
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button
                  onClick={() => advance(next)}
                  disabled={advancing || !canWrite("transactions")}
                >
                  Advance to {TRANSACTION_STAGE_LABELS[next].toLowerCase()}
                </Button>
                {txn.stage === "clearToClose" && (
                  <Button
                    variant="ghost"
                    onClick={() => advance("closed")}
                    disabled={advancing}
                  >
                    Mark closed
                  </Button>
                )}
              </div>
            )}
          </>
        ) : loading && transactionId ? (
          <DrawerSkeleton />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Transaction</SheetTitle>
              <SheetDescription className="sr-only">
                Transaction details
              </SheetDescription>
            </SheetHeader>
            <p className="mt-8 text-sm text-muted-foreground">
              This file is no longer available.
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
