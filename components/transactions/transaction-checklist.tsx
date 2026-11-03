"use client";

import { useRef, useState } from "react";
import { Check, ClipboardCheck, RotateCcw, Paperclip,Info,Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconWell } from "@/components/ui/icon-well";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ACTIVE_STAGES } from "@/lib/transactions/stages";
import { TRANSACTION_STAGE_LABELS } from "@/lib/data/types";
import type { TransactionWorkspace } from "@/lib/transactions/workspace-domain";
import type { TransactionChecklistItem, TransactionChecklistMutation } from "@/lib/transactions/checklist-domain";
import { mutateTransactionChecklist } from "@/lib/data/adapters/transaction-workspace";
import { checklistItemSatisfied } from "@/lib/transactions/attachment-domain";
import { transactionAttempt, transactionFailure, transactionSaveAllowed, transactionWriteUncertain } from "./workspace-state";
import { cn } from "@/lib/utils";
import { DEFAULT_CHECKLIST_HELP } from "@/lib/transactions/checklist-domain";
import { Tooltip,TooltipTrigger,TooltipContent } from "@/components/ui/tooltip";

export function formatChecklistCompletion(value: string): string {
  return new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
}
export function checklistActionAvailable(item: TransactionChecklistItem | undefined, action: "complete" | "reopen"): boolean {
  return Boolean(item && (action === "complete" ? !item.completedAt && (!item.attachmentRequired || item.attachments.length > 0) : item.completedAt));
}
export function TransactionChecklistCard({ workspace, canEdit, onReview, onFiles,onHelp }: {
  workspace: TransactionWorkspace;
  canEdit: boolean;
  onReview: (item: TransactionChecklistItem, action: "complete" | "reopen") => void;
  onFiles: (item: TransactionChecklistItem) => void;
  onHelp?: (item:TransactionChecklistItem)=>void;
}) {
  const { checklist, transaction } = workspace;
  const progress = checklist.progress;
  return (
    <Card id="transaction-checklist" tabIndex={-1} className="min-w-0 scroll-mt-44 p-4 sm:scroll-mt-24 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5"><IconWell icon={ClipboardCheck} /><h3 className="text-base font-semibold tracking-tight">Stage checklist</h3></div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Brokerage starter checklist. Record the work completed for this file; dates remain in Deadlines.</p>
        </div>
        <p className="shrink-0 text-xs font-semibold tabular">{progress.completed} of {progress.required} required complete</p>
      </div>
      {progress.required > 0 && <div role="progressbar" aria-label="Required checklist completion" aria-valuemin={0} aria-valuemax={progress.required} aria-valuenow={progress.completed} className="mb-4 h-1.5 overflow-hidden rounded-full bg-track"><span aria-hidden="true" className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, progress.completed / progress.required * 100))}%` }} /></div>}
      {!checklist.items.length ? <p className="text-sm leading-relaxed text-muted-foreground">The checklist is not ready for this file. Refresh the file before moving to a later stage.</p> : <div className="divide-y divide-border">{ACTIVE_STAGES.map(stage => {
        const items = checklist.items.filter(item => item.stage === stage).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
        const required = items.filter(item => item.required), complete = required.filter(item => checklistItemSatisfied(item)).length, current = transaction.stage === stage;
        if (!items.length) return null;
        return <details key={stage} open={current} className="group min-w-0 py-1 first:pt-0 last:pb-0">
          <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-md py-3 text-sm [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="inline-block text-muted-foreground transition-transform group-open:rotate-90">›</span><span className="font-semibold">{TRANSACTION_STAGE_LABELS[stage]}</span>{current && <Badge variant="muted">Current</Badge>}</span>
            <span className="text-xs text-muted-foreground tabular">{complete} / {required.length} required</span>
          </summary>
          <ul className="space-y-3 pb-4 pt-1">{items.map(item => <li key={item.id} className="flex min-w-0 items-start gap-3 rounded-panel border border-border/70 p-3">
            <span aria-hidden="true" className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", checklistItemSatisfied(item) ? "border-primary bg-primary text-primary-foreground" : "border-input")} >{checklistItemSatisfied(item) && <Check className="h-3 w-3" />}</span>
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">{item.label}<Tooltip><TooltipTrigger asChild><button type="button" className="ml-2 inline-flex min-h-8 min-w-8 items-center justify-center align-middle text-muted-foreground" aria-label={`Guidance: ${item.label}`}><Info aria-hidden className="h-3.5 w-3.5"/></button></TooltipTrigger><TooltipContent className="max-w-sm whitespace-pre-wrap p-3 text-xs font-normal leading-relaxed">{item.helpText||DEFAULT_CHECKLIST_HELP[item.templateKey]||"Review and record the supporting work for this checklist item."}</TooltipContent></Tooltip>{workspace.workflow?.canManageHelp&&onHelp&&<Button type="button" size="icon" variant="ghost" className="h-8 w-8 align-middle" aria-label={`Edit guidance: ${item.label}`} onClick={()=>onHelp(item)}><Pencil aria-hidden className="h-3 w-3"/></Button>}</p><div className="mt-1 flex flex-wrap items-center gap-2"><p className="text-[11px] text-muted-foreground">{item.required ? "Required" : "Optional"}</p>{item.attachmentRequired&&<Badge variant="outline">File required</Badge>}</div><Button type="button" variant="ghost" size="sm" className="-ml-2 mt-1 min-h-11" onClick={()=>onFiles(item)} aria-label={`Files for ${item.label}`}><Paperclip aria-hidden className="h-3.5 w-3.5"/>Files ({item.attachments.length})</Button>{item.attachments.length>0&&<p className="line-clamp-2 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.attachments.map(file=>file.filename).join(" · ")}</p>}{!item.completedAt&&item.attachmentRequired&&!item.attachments.length&&<p className="mt-1 text-xs text-muted-foreground">Add the required file before completing this item.</p>}{item.completedAt && <p className="mt-1 text-xs text-muted-foreground tabular">Completed {formatChecklistCompletion(item.completedAt)}</p>}</div>
            {canEdit && <Button type="button" variant={item.completedAt ? "ghost" : "outline"} size="sm" className="min-h-11 min-w-11 shrink-0 self-start" disabled={!item.completedAt&&!checklistActionAvailable(item,"complete")} onClick={() => onReview(item, item.completedAt ? "reopen" : "complete")} aria-label={`${item.completedAt ? "Reopen" : "Complete"}: ${item.label}`}>{item.completedAt ? <><RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /><span className="hidden sm:inline">Reopen</span></> : "Complete"}</Button>}
          </li>)}</ul>
        </details>;
      })}</div>}
    </Card>
  );
}

export function TransactionChecklistReview({ workspace, item, action, onClose, onSaved, onReload }: {
  workspace: TransactionWorkspace;
  item: TransactionChecklistItem;
  action: "complete" | "reopen";
  onClose: () => void;
  onSaved: (workspace: TransactionWorkspace) => void;
  onReload: () => Promise<TransactionWorkspace>;
}) {
  const [opening, setOpening] = useState(workspace), [openingItem, setOpeningItem] = useState(item);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState<string | null>(null), [fresh, setFresh] = useState<TransactionWorkspace | null>(null);
  const attempt = useRef<{ key: string; input: TransactionChecklistMutation } | null>(null);
  const stale = Date.parse(workspace.updatedAt) > Date.parse(opening.updatedAt);
  const currentItem = fresh?.checklist.items.find(candidate => candidate.id === openingItem.id);
  async function reload() { setBusy(true); try { setFresh(await onReload()); setError(null); } catch (failure) { setError(transactionFailure(failure)); } finally { setBusy(false); } }
  function accept() {
    if (!fresh || !fresh.canEdit || !checklistActionAvailable(currentItem, action) || !currentItem) return;
    setOpening(fresh); setOpeningItem(currentItem); setFresh(null); setBlocked(false); setError(null); attempt.current = null;
  }
  async function save(retry = false) {
    if (!transactionSaveAllowed({ busy, retry, uncertain, hasAttempt: Boolean(attempt.current), stale, blocked, canEdit: workspace.canEdit && checklistActionAvailable(openingItem, action) })) return;
    if (!retry) attempt.current = transactionAttempt(attempt.current, { expectedUpdatedAt: opening.updatedAt, itemId: openingItem.id, expectedItemUpdatedAt: openingItem.updatedAt, action });
    setBusy(true);
    try { const next = await mutateTransactionChecklist(opening.transaction.id, attempt.current!.input); setUncertain(false); onSaved(next); onClose(); }
    catch (failure) { setError(transactionFailure(failure)); setUncertain(transactionWriteUncertain(failure)); if ((failure as { status?: number }).status === 409) setBlocked(true); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent focusFallback={() => document.getElementById("transaction-checklist")} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>{action === "complete" ? "Complete checklist item" : "Reopen checklist item"}</DialogTitle><DialogDescription>{TRANSACTION_STAGE_LABELS[openingItem.stage]} · {openingItem.required ? "Required" : "Optional"}</DialogDescription></DialogHeader><p className="break-words text-sm font-semibold leading-relaxed">{openingItem.label}</p><p className="text-sm leading-relaxed text-muted-foreground">{action === "complete" ? "Record this item as completed for this transaction. The active stage advances when its required work is satisfied; this never closes the transaction or completes a deadline." : "This item will be outstanding again. Reopening required work can return an active file to the earliest outstanding stage."}</p>{openingItem.completedAt && <p className="text-xs text-muted-foreground tabular">Completed {formatChecklistCompletion(openingItem.completedAt)}</p>}{(blocked || stale) && !fresh && !uncertain && <div className="space-y-2 rounded-panel border border-border bg-tint p-3"><p role="alert" className="text-sm">This file changed. Review the saved item before continuing.</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>Review saved changes</Button></div>}{fresh && <div className="space-y-3 rounded-panel border border-border bg-tint p-3"><p className="text-sm font-semibold">Latest saved item</p><p className="break-words text-sm">{currentItem?.label ?? "This item is no longer available."}</p>{currentItem && <p className="text-xs text-muted-foreground">{currentItem.completedAt ? `Completed ${formatChecklistCompletion(currentItem.completedAt)}` : "Outstanding"}</p>}{!fresh.canEdit ? <p className="text-sm">This file is now read-only.</p> : checklistActionAvailable(currentItem, action) ? <Button type="button" size="sm" onClick={accept}>Continue with current item</Button> : <p className="text-sm">{action === "complete" ? "This item is already complete." : "This item is already outstanding."} Close this review to return to the file.</p>}</div>}{uncertain && <p role="status" className="text-sm leading-relaxed">The result is unconfirmed. Check save result retries only this reviewed checklist change.</p>}{error && <p role="alert" className="text-sm leading-relaxed">{error}</p>}<DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>{uncertain ? <Button type="button" disabled={busy} onClick={() => void save(true)}>{busy ? "Checking…" : "Check save result"}</Button> : <Button type="button" disabled={busy || blocked || stale || Boolean(fresh) || !workspace.canEdit} onClick={() => void save()}>{busy ? "Saving…" : action === "complete" ? "Confirm complete" : "Confirm reopen"}</Button>}</DialogFooter></DialogContent></Dialog>;
}
