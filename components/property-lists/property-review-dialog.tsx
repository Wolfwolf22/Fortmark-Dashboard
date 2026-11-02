"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getPropertyListProperty, updatePropertyResearch } from "@/lib/data/adapters/leads";
import type { PropertyView } from "@/lib/contacts/properties";
import type { PropertyReviewStatus } from "@/lib/contacts/property-research";
import { openPropertyResearch, propertyResearchFailure, propertyResearchInput, propertyResearchSaveAcknowledged, propertyVersionChanged, REVIEW_LABELS, reviewPropertyResearch, validPropertyResearchNotes } from "./research";

interface Props { property: PropertyView | null; latest?: PropertyView; readOnly?: boolean; onClose: () => void; onSaved: (property: PropertyView) => void; focusFallback?: () => HTMLElement | null }
export function PropertyReviewDialog(props: Props) { return <Dialog open={Boolean(props.property)} onOpenChange={(open) => !open && props.onClose()}>{props.property && <PropertyReviewForm key={props.property.id} {...props} property={props.property} />}</Dialog>; }

export function PropertyResearchComparison({ property }: { property: PropertyView }) {
  return <div className="min-w-0 space-y-2"><p className="text-xs font-semibold">Saved review · {REVIEW_LABELS[property.reviewStatus]}</p><p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{property.notes || "No private note."}</p></div>;
}

function PropertyReviewForm({ property, latest, readOnly, onClose, onSaved, focusFallback }: Props & { property: PropertyView }) {
  const prefix = useId(), notesRef = useRef<HTMLTextAreaElement>(null), reviewRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => openPropertyResearch(property));
  const [fresh, setFresh] = useState<PropertyView | null>(null), [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const mustReview = conflict || propertyVersionChanged(draft.opening, latest);
  const disabled = saving || loading || Boolean(fresh), changed = draft.notes !== (draft.opening.notes ?? "") || draft.reviewStatus !== (draft.opening.reviewStatus ?? "to_review");
  useEffect(() => { if (fresh) reviewRef.current?.focus(); }, [fresh]);
  async function reviewLatest() {
    if (saving || loading) return;
    setLoading(true); setError(null);
    try { const next = await getPropertyListProperty(property.listId, property.id); reviewPropertyResearch(draft, next, true); if (conflict && next.updatedAt === draft.opening.updatedAt) throw Error("Current version unavailable"); setFresh(next); }
    catch (failure) { setError(propertyResearchFailure(failure, "read")); }
    finally { setLoading(false); }
  }
  function accept(keepDraft: boolean) {
    if (!fresh) return;
    setDraft(reviewPropertyResearch(draft, fresh, keepDraft)); setFresh(null); setConflict(false); setError(null); setTimeout(() => notesRef.current?.focus(), 0);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (readOnly || disabled || mustReview || !changed) return;
    if (!validPropertyResearchNotes(draft.notes)) { setError("Enter no more than 5,000 characters of plain text, without null characters."); notesRef.current?.focus(); return; }
    setSaving(true); setError(null);
    try { const saved = await updatePropertyResearch(property.listId, property.id, propertyResearchInput(draft)); if (!propertyResearchSaveAcknowledged(property, saved)) throw Error("Save not confirmed"); onClose(); onSaved(saved); }
    catch (failure) { if (failure && typeof failure === "object" && "status" in failure && failure.status === 409) setConflict(true); setError(propertyResearchFailure(failure, "save")); }
    finally { setSaving(false); }
  }
  if (readOnly) return <DialogContent focusFallback={focusFallback} className="flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b border-border p-5 pr-10"><div className="flex items-center gap-2.5"><IconWell icon={NotebookPen} /><DialogTitle>Your review</DialogTitle></div><DialogDescription className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">{property.listing?.address || `MLS ${property.mlsNumber}`} · Read-only view.</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto p-5"><PropertyResearchComparison property={latest ?? property} /></div><div className="shrink-0 border-t border-border p-4"><Button type="button" variant="outline" onClick={onClose}>Close</Button></div></DialogContent>;
  return <DialogContent focusFallback={focusFallback} hideClose={saving} className="flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0" onOpenAutoFocus={(event) => { event.preventDefault(); notesRef.current?.focus(); }} onEscapeKeyDown={(event) => saving && event.preventDefault()} onPointerDownOutside={(event) => saving && event.preventDefault()}>
    <DialogHeader className="shrink-0 border-b border-border p-5 pr-10"><div className="flex items-center gap-2.5"><IconWell icon={NotebookPen} /><DialogTitle>Edit review</DialogTitle></div><DialogDescription className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">{property.listing?.address || `MLS ${property.mlsNumber}`} · Private to you, in this list.</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void submit(event)} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
        {mustReview && !fresh && <div className="space-y-2 rounded-panel border border-input bg-tint p-3"><p className="text-xs leading-relaxed">This saved property changed. Your draft is kept. Review the current saved review before continuing.</p><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void reviewLatest()}>{loading ? "Loading saved review…" : "Review saved changes"}</Button></div>}
        {fresh && <div ref={reviewRef} tabIndex={-1} aria-label="Review saved changes" className="space-y-3 rounded-panel border border-input bg-tint p-3"><PropertyResearchComparison property={fresh} /><p className="text-xs leading-relaxed text-muted-foreground">Your draft is still below. Choose which review to continue with.</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => accept(true)}>Keep my draft</Button><Button type="button" size="sm" variant="outline" onClick={() => accept(false)}>Use saved review</Button></div></div>}
        <div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-status`}>Your review</Label><Select value={draft.reviewStatus} disabled={disabled} onValueChange={(reviewStatus: PropertyReviewStatus) => setDraft((current) => ({ ...current, reviewStatus }))}><SelectTrigger id={`${prefix}-status`} className="h-10"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REVIEW_LABELS).map(([value, label]) => <SelectItem key={value} value={value} className="min-h-10">{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-notes`}>Private note</Label><Textarea ref={notesRef} id={`${prefix}-notes`} value={draft.notes} disabled={disabled} maxLength={5000} rows={6} className="min-h-32 resize-y" aria-describedby={`${prefix}-note-help`} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /><p id={`${prefix}-note-help`} className="text-[11px] leading-relaxed text-muted-foreground">Your research only. This note stays in this list and is not sent to anyone. <span className="tabular">{draft.notes.length.toLocaleString()} / 5,000</span></p></div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border p-4"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={disabled || mustReview || !changed}>{saving ? "Saving…" : "Save review"}</Button></div>
    </form>
  </DialogContent>;
}
