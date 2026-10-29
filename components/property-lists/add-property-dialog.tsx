"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContactPropertyListing, contactPropertyFailure, propertyPreviewMatchesInput, reviewedContactPropertyAddInput, type ContactPropertyPreview } from "@/components/leads/contact-properties";
import { addPropertyListProperty, lookupPropertyListProperty } from "@/lib/data/adapters/leads";
import { normalizePropertyMlsNumber, PROPERTY_MLS_NUMBER_MAX } from "@/lib/contacts/properties";
import { propertyListAddAcknowledged } from "./review";

interface AddPropertyDialogProps { open: boolean; onOpenChange: (open: boolean) => void; listId: string; listName: string; onAdded: () => void }
export function AddPropertyDialog(props: AddPropertyDialogProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <AddPropertyForm {...props} />}</Dialog>;
}
function AddPropertyForm({ onOpenChange, listId, listName, onAdded }: AddPropertyDialogProps) {
  const prefix = useId();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ContactPropertyPreview | null>(null);
  const [finding, setFinding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const current = propertyPreviewMatchesInput(preview, query) ? preview : null;
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => { if (current) { previewHeading.current?.focus(); } }, [current]);
  function changeQuery(next: string) { sequence.current++; setQuery(next); setPreview(null); setFinding(false); setError(null); }
  async function lookup(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    const mlsNumber = normalizePropertyMlsNumber(query);
    if (!mlsNumber) { setError(contactPropertyFailure({ code: "invalid_property" }, "lookup")); input.current?.focus(); return; }
    const request = ++sequence.current;
    setFinding(true); setPreview(null); setError(null);
    try { const result = await lookupPropertyListProperty(listId, mlsNumber); if (request === sequence.current) setPreview({ query: mlsNumber, result }); }
    catch (failure) { if (request === sequence.current) { setError(contactPropertyFailure(failure, "lookup")); input.current?.focus(); } }
    finally { if (request === sequence.current) setFinding(false); }
  }
  async function add() {
    if (!current || current.result.alreadySaved || saving) return;
    const frozen = current;
    setSaving(true); setError(null);
    try {
      const property = await addPropertyListProperty(listId, reviewedContactPropertyAddInput(frozen));
      if (!propertyListAddAcknowledged(property, listId, frozen)) throw new Error("The saved list reference was not confirmed");
      onAdded(); onOpenChange(false);
    } catch (failure) {
      setError(contactPropertyFailure(failure, "add"));
      if (failure && typeof failure === "object" && "code" in failure && ["listing_changed", "listing_not_found", "ambiguous"].includes(String(failure.code))) setPreview(null);
      setTimeout(() => { if (body.current) body.current.scrollTop = 0; input.current?.focus(); }, 0);
    } finally { setSaving(false); }
  }
  return <DialogContent hideClose={saving} className="flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }} onEscapeKeyDown={(event) => saving && event.preventDefault()} onPointerDownOutside={(event) => saving && event.preventDefault()}>
    <DialogHeader className="shrink-0 border-b border-border p-4 pr-12"><div className="flex items-center gap-2.5"><IconWell icon={Building2} /><DialogTitle>Add property</DialogTitle></div><DialogDescription className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">Find an MLS number, review the property, then add it to {listName}.</DialogDescription></DialogHeader>
    <div ref={body} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      <form onSubmit={(event) => void lookup(event)} className="space-y-3"><div className="grid gap-1.5"><Label htmlFor={`${prefix}-mls`}>MLS number</Label><Input ref={input} id={`${prefix}-mls`} className="h-10" value={query} maxLength={PROPERTY_MLS_NUMBER_MAX} autoCapitalize="characters" autoCorrect="off" spellCheck={false} disabled={saving} aria-invalid={Boolean(error)} aria-describedby={error ? `${prefix}-error` : undefined} onChange={(event) => changeQuery(event.target.value)} /></div><div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={finding || saving || !query.trim()}>{finding ? "Finding property…" : "Find property"}</Button>{query && <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { changeQuery(""); input.current?.focus(); }}>Clear search</Button>}</div></form>
      {error && <p id={`${prefix}-error`} role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
      {current && <div className="space-y-3 border-t border-border pt-4"><h3 ref={previewHeading} tabIndex={-1} className="text-sm font-semibold">Property found</h3><ContactPropertyListing listing={current.result.listing} />{current.result.alreadySaved && <p role="status" className="text-xs font-semibold">Already in this property list.</p>}</div>}
    </div>
    <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border bg-card p-4"><Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Close</Button>{current && !current.result.alreadySaved && <Button type="button" disabled={saving} onClick={() => void add()}>{saving ? "Adding property…" : "Add to list"}</Button>}</div>
  </DialogContent>;
}
