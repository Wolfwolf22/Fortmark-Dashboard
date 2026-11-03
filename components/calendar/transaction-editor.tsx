"use client";
import { useEffect } from "react";
import { TransactionDeadlineEditor } from "@/components/transactions/deadline-editor";
import { TransactionDetailsEditor } from "@/components/transactions/details-editor";
import { getTransactionWorkspace } from "@/lib/data/adapters/transaction-workspace";
import { useQuery } from "@/lib/data/hooks";
import type { CalendarItem } from "@/lib/calendar/domain";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { calendarFailure } from "./calendar-state";
import { Skeleton } from "@/components/ui/skeleton";

export function CalendarTransactionEditor({ item, canWrite, onClose, onSaved, onAccessDenied }: { item: CalendarItem; canWrite: boolean; onClose: () => void; onSaved: () => void; onAccessDenied?: () => void }) {
  const query = useQuery(() => getTransactionWorkspace(item.sourceId), [item.sourceId]);
  const denied = [401,403,404].includes((query.error as {status?:number}|null)?.status ?? 0);
  useEffect(() => { if (denied) onAccessDenied?.(); }, [denied, onAccessDenied]);
  async function reload() {
    try { const next = await getTransactionWorkspace(item.sourceId); return { ...next, canEdit: Boolean(canWrite && next.canEdit) }; }
    catch (failure) {
      if ([401,403,404].includes((failure as {status?:number})?.status ?? 0)) { onAccessDenied?.(); query.refetch(); }
      throw failure;
    }
  }
  if (!query.data || query.error || query.data.transaction.id !== item.sourceId) return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{denied ? "Transaction unavailable" : "Transaction details"}</DialogTitle><DialogDescription>{query.error ? calendarFailure(query.error) : "Loading the current transaction record…"}</DialogDescription></DialogHeader>{query.error ? <Button variant="outline" onClick={query.refetch}>Retry</Button> : <Skeleton className="h-24 w-full"/>}</DialogContent></Dialog>;
  const source = item.reschedule, workspace = { ...query.data, canEdit: Boolean(canWrite && query.data.canEdit) };
  if (source?.kind === "transaction_deadline") {
    const deadline = workspace.deadlines.find(value => value.id === source.deadlineId);
    if (!deadline) return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Deadline no longer available</DialogTitle><DialogDescription>Refresh Calendar to review the current dates.</DialogDescription></DialogHeader><Button onClick={onClose}>Back to Calendar</Button></DialogContent></Dialog>;
    return <TransactionDeadlineEditor key={`${item.sourceId}:${source.deadlineId}`} workspace={workspace} deadline={deadline} action="edit" onClose={onClose} onSaved={onSaved} onReload={reload}/>;
  }
  return <TransactionDetailsEditor key={item.sourceId} workspace={workspace} onClose={onClose} onSaved={onSaved} onReload={reload}/>;
}
