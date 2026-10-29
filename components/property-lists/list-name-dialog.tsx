"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FolderPlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPropertyList, getPropertyList, renamePropertyList } from "@/lib/data/adapters/leads";
import { PROPERTY_LIST_NAME_MAX, type PropertyListView } from "@/lib/contacts/property-lists";
import { propertyListCreateAttempt, propertyListFailure, type PropertyListCreateAttempt } from "./review";

interface ListNameDialogProps { open: boolean; onOpenChange: (open: boolean) => void; contact?: { id: string; name: string }; list?: PropertyListView; onSaved: (list: PropertyListView) => void }
export function ListNameDialog(props: ListNameDialogProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <ListNameForm key={props.list?.id ?? "create"} {...props} />}</Dialog>;
}
export function readablePropertyListName(name: string): boolean {
  return Boolean(name.trim()) && name.trim().length <= PROPERTY_LIST_NAME_MAX && !/[\u0000-\u001f\u007f-\u009f]/u.test(name);
}
/** Close the old modal route before navigating into the newly created list. */
export function finishPropertyListNameSave(saved: PropertyListView, close: (open: boolean) => void, onSaved: (list: PropertyListView) => void): void {
  close(false); onSaved(saved);
}
function ListNameForm({ onOpenChange, contact, list, onSaved }: ListNameDialogProps) {
  const prefix = useId();
  const [name, setName] = useState(list?.name ?? "");
  const [linked, setLinked] = useState(Boolean(contact));
  const [opening, setOpening] = useState(list ?? null);
  const [fresh, setFresh] = useState<PropertyListView | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const retry = useRef<PropertyListCreateAttempt | null>(null);
  const changed = Boolean(list && opening && list.updatedAt !== opening.updatedAt && Date.parse(list.updatedAt) >= Date.parse(opening.updatedAt));
  const mustReview = conflict || changed;
  useEffect(() => { if (fresh) reviewPanel.current?.focus(); }, [fresh]);
  async function reviewLatest() {
    if (!opening || saving || loading) return;
    setLoading(true); setError(null);
    try { const next = await getPropertyList(opening.id); if (next.id !== opening.id || Date.parse(next.updatedAt) < Date.parse(opening.updatedAt) || conflict && next.updatedAt === opening.updatedAt) throw Error("Current version unavailable"); setFresh(next); }
    catch { setError("The current list name could not be loaded. Your draft is kept. Try again."); }
    finally { setLoading(false); }
  }
  function accept(keepDraft: boolean) {
    if (!fresh) return;
    setOpening(fresh); if (!keepDraft) setName(fresh.name); setFresh(null); setConflict(false); setError(null); setTimeout(() => input.current?.focus(), 0);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving || loading || fresh || mustReview) return;
    if (!readablePropertyListName(name)) { setError("Enter a list name using 1 to 120 readable characters."); input.current?.focus(); return; }
    setSaving(true); setError(null);
    try {
      let saved: PropertyListView;
      if (opening) saved = await renamePropertyList(opening.id, { name: name.trim(), expectedUpdatedAt: opening.updatedAt });
      else { retry.current = propertyListCreateAttempt(retry.current, name, linked ? contact?.id : undefined); saved = await createPropertyList(retry.current.input); }
      finishPropertyListNameSave(saved, onOpenChange, onSaved);
    } catch (failure) {
      if (opening && failure && typeof failure === "object" && "status" in failure && failure.status === 409) setConflict(true);
      setError(propertyListFailure(failure, opening ? "rename" : "create"));
    } finally { setSaving(false); }
  }
  return <DialogContent hideClose={saving} className="max-h-[88dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }} onEscapeKeyDown={(event) => saving && event.preventDefault()} onPointerDownOutside={(event) => saving && event.preventDefault()}>
    <DialogHeader className="pr-7"><div className="flex items-center gap-2.5"><IconWell icon={list ? Pencil : FolderPlus} /><DialogTitle>{list ? "Rename list" : "New property list"}</DialogTitle></div><DialogDescription className="text-xs leading-relaxed">{list ? "Change this list's name." : "Give the list a name. It can be personal research or linked to the current contact."}</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-4">
      {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
      {mustReview && !fresh && <div className="space-y-2 rounded-panel border border-input bg-tint p-3"><p className="text-xs leading-relaxed">This list changed. Your name draft is kept. Review its saved version before renaming.</p><Button type="button" size="sm" variant="outline" disabled={saving || loading} onClick={() => void reviewLatest()}>{loading ? "Loading current name…" : "Review current name"}</Button></div>}
      {fresh && <div ref={reviewPanel} tabIndex={-1} aria-label="Review current list name" className="space-y-2 rounded-panel border border-input bg-tint p-3"><p className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">Saved name: <strong>{fresh.name}</strong></p><p className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">Your draft: <strong>{name}</strong></p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => accept(true)}>Keep my name</Button><Button type="button" size="sm" variant="outline" onClick={() => accept(false)}>Use saved name</Button></div></div>}
      <div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-name`}>List name</Label><Input ref={input} id={`${prefix}-name`} value={name} maxLength={PROPERTY_LIST_NAME_MAX} className="h-10" disabled={saving || loading || Boolean(fresh)} onChange={(event) => setName(event.target.value)} /></div>
      {!list && contact && <div className="flex items-start gap-2"><Checkbox id={`${prefix}-contact`} className="mt-1" checked={linked} disabled={saving} onCheckedChange={(checked) => setLinked(checked === true)} /><Label htmlFor={`${prefix}-contact`} className="min-w-0 break-words py-1 text-xs font-normal leading-relaxed [overflow-wrap:anywhere]">Link to {contact.name}</Label></div>}
      {!list && <p className="text-xs leading-relaxed text-muted-foreground">{linked && contact ? "The list stays private to you and appears under this contact's property lists." : "Personal research · this list stays private to you."}</p>}
      <div className="flex flex-wrap justify-between gap-2 pt-1"><Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || loading || Boolean(fresh) || mustReview || !name.trim() || Boolean(opening && name.trim() === opening.name)}>{saving ? "Saving…" : list ? "Save name" : "Create list"}</Button></div>
    </form>
  </DialogContent>;
}
