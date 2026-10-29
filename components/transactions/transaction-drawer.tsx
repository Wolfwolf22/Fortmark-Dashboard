"use client";

/**
 * Transaction detail drawer — shared by the Home transactions widget and the
 * Transactions page. Controlled by (transactionId, open, onOpenChange);
 * loads the file through the adapter and renders the milestone timeline.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, ClipboardList, Users, Workflow, type LucideIcon } from "lucide-react";
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
import { IconWell } from "@/components/ui/icon-well";
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
import { SampleDataNotice } from "@/components/listings/sample-data-notice";
import { TransactionProgress } from "./transaction-progress";
import { isActiveStage } from "@/lib/transactions/stages";

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
    <div className="min-w-0">
      <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1.5 break-words text-sm font-semibold leading-snug", numeric && "tabular text-base tracking-tight")}>
        {value}
      </dd>
    </div>
  );
}

function SectionHeading({ icon, children, detail }: { icon: LucideIcon; children: ReactNode; detail?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <IconWell icon={icon} />
        <h3 className="text-[15px] font-semibold">{children}</h3>
      </div>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
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
      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold leading-5">{milestone.label}</p>
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
      <div className="space-y-2 px-5 pt-7">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="mt-3 flex gap-1.5 px-5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="px-5"><Skeleton className="mt-6 h-48 w-full rounded-panel" /></div>
      <div className="mt-6 space-y-3 px-5">
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
  const { data, loading, error, refetch } = useQuery<Transaction | undefined>(
    () => (transactionId ? getTransaction(transactionId) : Promise.resolve(undefined)),
    [transactionId]
  );
  // Guard against stale data from a previously opened transaction.
  const txn = data && data.id === transactionId ? data : undefined;

  // The sample roster only applies to sample rows; a database row states its
  // agent's name on the record.
  const agentId = txn?.source === "sample" ? txn.agentId : null;
  const { data: agent } = useQuery(
    () => (agentId ? getAgent(agentId) : Promise.resolve(undefined)),
    [agentId]
  );

  const [advancing, setAdvancing] = useState(false);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);

  async function advance(to: TransactionStage) {
    if (!txn) return;
    setSaveError(null);
    setAdvancing(true);
    try {
      // The adapter bumps the data version, so the drawer and every open
      // list refetch on their own.
      await updateTransactionStage(txn.id, to);
    } catch {
      setSaveError({ id: txn.id, message: "The stage change could not be confirmed. Review the refreshed stage before trying again." });
      refetch();
    } finally {
      setAdvancing(false);
    }
  }

  const next = txn ? nextStage(txn.stage) : undefined;
  const days = txn ? daysToClose(txn.closeDate) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {txn ? (
          <>
            <SheetHeader className="shrink-0 border-b border-border px-5 pb-5 pt-6 pr-14 sm:px-6 sm:pr-16">
              <div className="mb-3 flex items-center gap-3">
                <IconWell icon={Building2} className="h-10 w-10 rounded-panel" />
                <p className="text-micro">Transaction file</p>
              </div>
              <SheetTitle className="break-words text-2xl font-semibold leading-tight tracking-tight">{txn.address}</SheetTitle>
              <SheetDescription className="pt-0.5 text-[13px]">{txn.city}</SheetDescription>
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
                <Badge variant="outline">{SIDE_LABELS[txn.side]}</Badge>
                <StatusPill tone={isActiveStage(txn.stage) ? txn.status : "neutral"}>{isActiveStage(txn.stage) ? txn.statusLabel : TRANSACTION_STAGE_LABELS[txn.stage]}</StatusPill>
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
            {txn.source === "sample" && (
              <div>
                <SampleDataNotice subject="This deal is generated for development and is not a real transaction." />
              </div>
            )}
            {error && !loading && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-tint p-3 text-sm">
                <p>The latest details could not be refreshed.</p>
                <Button type="button" variant="outline" size="sm" onClick={refetch}>Try again</Button>
              </div>
            )}
            <section aria-label="Transaction stage">
              <SectionHeading icon={Workflow}>Workflow position</SectionHeading>
              <div className="rounded-panel border border-border p-4"><TransactionProgress stage={txn.stage} /></div>
            </section>
            <section aria-label="Deal overview">
              <SectionHeading icon={ClipboardList}>Deal overview</SectionHeading>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-panel border border-border bg-tint p-4">
                <Fact label="Contract price" numeric value={formatCurrency(txn.contractPrice)} />
                <Fact label="Projected gross commission" numeric value={txn.projectedCommission > 0 ? formatCurrency(txn.projectedCommission) : "—"} />
                <Fact label="Close date" numeric value={txn.closeDate ? formatDate(txn.closeDate) : "Not set"} />
                <Fact label="Days to close" numeric value={txn.stage === "closed" ? "Closed" : days === null ? "—" : days < 0 ? `${Math.abs(days)} days past due` : `${days} days`} />
              </dl>
              {txn.listingId && (
                <Link
                  href={`/listings/${txn.listingId}`}
                  className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-md text-[13px] font-semibold underline-offset-4 hover:underline"
                >
                  View listing
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </section>
            <section aria-label="People on this file">
              <SectionHeading icon={Users}>People</SectionHeading>
              <dl className="grid grid-cols-2 gap-4 rounded-panel border border-border p-4">
                <Fact label="Client" value={txn.clientName} />
                <Fact label="Agent" value={txn.agentName ?? agent?.name ?? "—"} />
              </dl>
            </section>
            <section aria-label="Recorded milestones">
              <SectionHeading icon={CalendarDays} detail={txn.milestones.length ? `${txn.milestones.length} recorded` : undefined}>Milestones</SectionHeading>
              {txn.milestones.length ? <ol className="rounded-panel border border-border p-4">
                {txn.milestones.map((m, i) => (
                  <MilestoneRow
                    key={m.id}
                    milestone={m}
                    last={i === txn.milestones.length - 1}
                  />
                ))}
              </ol> : <div className="rounded-panel border border-dashed border-input px-4 py-5">
                <p className="text-sm font-semibold">No milestones recorded</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">This file does not have any recorded deadlines yet.</p>
              </div>}
            </section>
            </div>
            {next && (
              <div className="shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6">
                {saveError?.id === txn.id && <p role="alert" className="mb-3 text-sm text-destructive">{saveError.message}</p>}
                <Button className="min-h-11 w-full justify-between" onClick={() => advance(next)} disabled={advancing}>
                  {next === "closed" ? "Mark closed" : `Advance to ${TRANSACTION_STAGE_LABELS[next].toLowerCase()}`}
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </Button>
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
            <div className="px-5 py-12 sm:px-6">
              <IconWell icon={Building2} className="mb-4 h-10 w-10 rounded-panel" />
              <p role={error ? "alert" : undefined} className="text-sm font-semibold">{error ? "Transaction details could not be loaded" : "This file is no longer available."}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error ? "Try again to load this file." : "Close this panel and choose another transaction."}</p>
              {error && <Button variant="outline" className="mt-4" onClick={refetch}>Try again</Button>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
