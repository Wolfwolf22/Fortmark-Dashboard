"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSavedShowingTour } from "@/lib/data/adapters/saved-showing-tours";
import { createSavedShowingTourInputSchema, type SavedTourSettings } from "@/lib/showings/saved-tour-domain";
import { savedTourAttempt, savedTourFailure, savedToursHref, type SavedTourAttempt } from "./saved-tour-state";

export function SavedTourSaveDialog({ settings, onClose }: { settings: SavedTourSettings | null; onClose: () => void }) { return <Dialog open={Boolean(settings)} onOpenChange={(open) => !open && onClose()}>{settings && <SaveTourForm settings={settings} onClose={onClose} />}</Dialog>; }
function SaveTourForm({ settings, onClose }: { settings: SavedTourSettings; onClose: () => void }) {
  const prefix = useId(), router = useRouter(), input = useRef<HTMLInputElement>(null), [name, setName] = useState(settings.name), [notes, setNotes] = useState(settings.notes), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), retry = useRef<SavedTourAttempt<SavedTourSettings> | null>(null);
  async function save(event: FormEvent) { event.preventDefault(); if (saving) return; const attempt = savedTourAttempt(retry.current, { ...settings, name, notes }), parsed = createSavedShowingTourInputSchema.safeParse(attempt.input); if (!parsed.success) { setError("Enter a name up to 120 characters and private notes up to 4,000 characters."); input.current?.focus(); return; } retry.current = attempt; setSaving(true); setError(null); try { const saved = await createSavedShowingTour(parsed.data); onClose(); router.push(savedToursHref({ tourId: saved.id })); } catch (failure) { setError(savedTourFailure(failure)); } finally { setSaving(false); } }
  return <DialogContent hideClose={saving} className="max-h-[88dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }} onEscapeKeyDown={(event) => saving && event.preventDefault()} onPointerDownOutside={(event) => saving && event.preventDefault()}><DialogHeader className="pr-7"><div className="flex items-center gap-2.5"><IconWell icon={BookmarkPlus} /><DialogTitle>Save tour plan</DialogTitle></div><DialogDescription className="text-xs leading-relaxed">Save these selected properties and settings. A fresh schedule review is required before any appointments change.</DialogDescription></DialogHeader><form onSubmit={(event) => void save(event)} className="min-w-0 space-y-4">{error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}<div className="grid gap-1.5"><Label htmlFor={`${prefix}-name`}>Tour name</Label><Input ref={input} id={`${prefix}-name`} className="h-10" value={name} maxLength={120} disabled={saving} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`${prefix}-notes`}>Private tour notes</Label><Textarea id={`${prefix}-notes`} rows={4} maxLength={4000} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} /></div><p className="text-xs leading-relaxed text-muted-foreground">The saved plan contains your settings and property references. Route geometry and driving estimates are not stored.</p><div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save tour"}</Button></div></form></DialogContent>;
}
