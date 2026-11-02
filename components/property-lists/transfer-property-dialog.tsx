"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPropertyListProperty, getPropertyLists, transferProperty } from "@/lib/data/adapters/leads";
import type { PropertyView } from "@/lib/contacts/properties";
import type { PropertyListView } from "@/lib/contacts/property-lists";
import type { PropertyTransferResult } from "@/lib/contacts/property-research";
import { useQuery } from "@/lib/data/hooks";
import { PropertyResearchComparison } from "./property-review-dialog";
import { propertyResearchFailure, propertyTargetLabel, propertyTransferAttempt, propertyVersionChanged, type PropertyTransferAttempt } from "./research";

interface Props { property: PropertyView | null; latest?: PropertyView; sourceName: string; onClose: () => void; onTransferred: (result: PropertyTransferResult, mode: "copy" | "move") => void; focusFallback?: () => HTMLElement | null }
export function TransferPropertyDialog(props: Props) { return <Dialog open={Boolean(props.property)} onOpenChange={(open) => !open && props.onClose()}>{props.property && <TransferPropertyForm key={props.property.id} {...props} property={props.property} />}</Dialog>; }
export function PropertyTransferSummary({ mode, source, target }: { mode: "copy" | "move"; source: string; target: PropertyListView }) {
  return <div className="space-y-1 rounded-panel border border-border bg-tint p-3 text-xs leading-relaxed"><p className="break-words [overflow-wrap:anywhere]">{mode === "copy" ? "Copy to" : "Move to"} <strong>{target.name}</strong> · {target.contactId ? target.contactName ? `For ${target.contactName}` : "Linked to a contact" : "Personal research"}</p><p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{mode === "copy" ? `The original stays in ${source}. Each list will have its own review and private note.` : `The entry will be removed from ${source} after it is saved in the destination.`} The current review and note are carried with it.</p></div>;
}
function TransferPropertyForm({ property, latest, sourceName, onClose, onTransferred, focusFallback }: Props & { property: PropertyView }) {
  const prefix = useId(), heading = useRef<HTMLHeadingElement>(null), reviewRef = useRef<HTMLDivElement>(null), targetRef = useRef<HTMLButtonElement>(null);
  const [opening, setOpening] = useState(property), [mode, setMode] = useState<"copy" | "move">("copy"), [target, setTarget] = useState<PropertyListView | null>(null);
  const [targetPage, setTargetPage] = useState(1), [targets, setTargets] = useState<PropertyListView[]>([]), [listGeneration, setListGeneration] = useState(0);
  const lists = useQuery(async () => ({ requestPage: targetPage, generation: listGeneration, result: await getPropertyLists({ page: targetPage }) }), [targetPage, listGeneration]);
  const answer = lists.data?.requestPage === targetPage && lists.data.generation === listGeneration ? lists.data.result : null;
  const [fresh, setFresh] = useState<PropertyView | null>(null), [conflict, setConflict] = useState(false), [saving, setSaving] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const retry = useRef<PropertyTransferAttempt | null>(null);
  const mustReview = conflict || propertyVersionChanged(opening, latest), busy = saving || loading;
  useEffect(() => { if (answer) { setTargets((current) => { const items = answer.items.filter((item) => item.id !== property.listId); return answer.page === 1 ? items : [...current.filter((old) => !items.some((item) => item.id === old.id)), ...items]; }); if (answer.page < targetPage) setTargetPage(answer.page); } }, [answer, property.listId, targetPage]);
  useEffect(() => { if (fresh) reviewRef.current?.focus(); }, [fresh]);
  const selectedTarget = targets.find((item) => item.id === target?.id), selectedAvailable = Boolean(selectedTarget);
  async function reviewLatest() {
    if (busy) return;
    setLoading(true); setError(null);
    try { const next = await getPropertyListProperty(property.listId, property.id); if (next.id !== property.id || next.listId !== property.listId || Date.parse(next.updatedAt) < Date.parse(opening.updatedAt) || conflict && next.updatedAt === opening.updatedAt) throw Error("Current version unavailable"); setFresh(next); }
    catch (failure) { setError(propertyResearchFailure(failure, "read")); }
    finally { setLoading(false); }
  }
  function refreshLists() { setTargets([]); setTargetPage(1); setListGeneration((value) => value + 1); }
  function accept() { if (!fresh) return; setOpening(fresh); setFresh(null); setConflict(false); setError(null); setTimeout(() => targetRef.current?.focus(), 0); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || mustReview || fresh || !target || !selectedAvailable) return;
    setSaving(true); setError(null);
    try {
      retry.current = propertyTransferAttempt(retry.current, opening, mode, target.id);
      const result = await transferProperty(property.listId, property.id, retry.current.input);
      if (result.targetListId !== target.id || result.property.listId !== target.id || result.property.listingId !== opening.listingId || result.sourceRemoved !== (mode === "move")) throw Error("Transfer not confirmed");
      onClose(); onTransferred(result, mode);
    } catch (failure) { if (failure && typeof failure === "object" && "status" in failure && failure.status === 409 && !("code" in failure && failure.code === "target_has_property")) setConflict(true); setError(propertyResearchFailure(failure, "transfer")); }
    finally { setSaving(false); }
  }
  return <DialogContent focusFallback={focusFallback} hideClose={saving} className="flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0" onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus(); }} onEscapeKeyDown={(event) => saving && event.preventDefault()} onPointerDownOutside={(event) => saving && event.preventDefault()}>
    <DialogHeader className="shrink-0 border-b border-border p-5 pr-10"><div className="flex items-center gap-2.5"><IconWell icon={Copy} /><DialogTitle ref={heading} tabIndex={-1}>Copy or move property</DialogTitle></div><DialogDescription className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">{property.listing?.address || `MLS ${property.mlsNumber}`} · Only lists that you own are available.</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void submit(event)} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
        {mustReview && !fresh && <div className="space-y-2 rounded-panel border border-input bg-tint p-3"><p className="text-xs leading-relaxed">This saved review changed. Your destination and transfer choice are kept. Review the current note and status before continuing.</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reviewLatest()}>{loading ? "Loading saved review…" : "Review saved changes"}</Button></div>}
        {fresh && <div ref={reviewRef} tabIndex={-1} aria-label="Review property before transferring" className="space-y-3 rounded-panel border border-input bg-tint p-3"><PropertyResearchComparison property={fresh} /><Button type="button" size="sm" variant="outline" onClick={accept}>Use this saved review</Button></div>}
        <fieldset disabled={busy || Boolean(fresh)} className="grid min-w-0 gap-2"><legend className="mb-2 text-sm font-medium">Transfer type</legend><div className="grid grid-cols-2 gap-2">{(["copy", "move"] as const).map((value) => <Label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input p-3 text-xs"><input className="h-4 w-4 accent-[currentColor]" type="radio" name={`${prefix}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />{value === "copy" ? "Copy" : "Move"}</Label>)}</div></fieldset>
        <div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-target`}>Destination list</Label><Select value={selectedAvailable ? target!.id : ""} disabled={busy || Boolean(fresh) || targets.length === 0} onValueChange={(id) => { setTarget(targets.find((item) => item.id === id) ?? null); setError(null); }}><SelectTrigger ref={targetRef} id={`${prefix}-target`} className="h-11 min-w-0"><SelectValue placeholder={lists.loading ? "Loading your lists…" : "Choose a list"} /></SelectTrigger><SelectContent className="max-w-[calc(100vw-2rem)]">{targets.map((item) => <SelectItem key={item.id} value={item.id} className="min-h-10 max-w-[26rem] break-words [overflow-wrap:anywhere]">{propertyTargetLabel(item, targets)}</SelectItem>)}</SelectContent></Select></div>
        {target && !selectedAvailable && <p role="status" className="break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">Previously selected: {propertyTargetLabel(target)}. Load or choose its current list before continuing.</p>}
        {lists.error && <p role="alert" className="text-xs leading-relaxed text-destructive">Your destination lists could not be refreshed. Loaded choices are kept.</p>}
        {!lists.loading && answer && targets.length === 0 && answer.total <= answer.page * answer.pageSize && <p className="text-xs leading-relaxed text-muted-foreground">No other lists are available. Close this panel and create another list first.</p>}
        <div className="flex flex-wrap gap-2">{lists.error ? <Button type="button" size="sm" variant="outline" disabled={busy || lists.loading} onClick={lists.refetch}>Retry lists</Button> : answer && answer.total > answer.page * answer.pageSize ? <Button type="button" size="sm" variant="outline" disabled={busy || lists.loading} onClick={() => setTargetPage(answer.page + 1)}>{lists.loading ? "Loading…" : "Load more lists"}</Button> : null}<Button type="button" size="sm" variant="ghost" disabled={busy || lists.loading} onClick={refreshLists}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Refresh lists</Button></div>
        {lists.loading && <p role="status" className="text-xs text-muted-foreground">Loading your lists…</p>}
        {selectedTarget && <PropertyTransferSummary mode={mode} source={sourceName} target={selectedTarget} />}
      </div>
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border p-4"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || mustReview || Boolean(fresh) || !selectedAvailable}>{saving ? "Saving…" : mode === "copy" ? "Copy to list" : "Move to list"}</Button></div>
    </form>
  </DialogContent>;
}
