"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { getLead } from "@/lib/data/adapters/leads";
import { createShowing } from "@/lib/data/adapters/showings";
import { useQuery } from "@/lib/data/hooks";
import type { PropertyView } from "@/lib/contacts/properties";
import type { Lead } from "@/lib/data/types";
import { createShowingInputSchema, type CreateShowingInput, type ShowingView } from "@/lib/showings/domain";
import { ShowingContactPicker } from "./contact-picker";
import { ShowingScheduleFields } from "./schedule-fields";
import { canSubmitShowingSchedule, defaultShowingSchedule, showingFailure, showingScheduleValue, showingWriteAttempt, type ShowingWriteAttempt } from "./shared";

interface Props { property: PropertyView | null; listName: string; defaultContactId?: string | null; onClose: () => void; onCreated: (showing: ShowingView) => void; focusFallback?: () => HTMLElement | null }
export function PlanShowingDialog(props: Props) { return <Dialog open={Boolean(props.property)} onOpenChange={(open) => !open && props.onClose()}>{props.property && <PlanShowingForm key={props.property.id} {...props} property={props.property} />}</Dialog>; }
function PlanShowingForm({ property, listName, defaultContactId, onClose, onCreated, focusFallback }: Props & { property: PropertyView }) {
  const prefix = useId(), heading = useRef<HTMLHeadingElement>(null), [draft, setDraft] = useState(defaultShowingSchedule), [chosen, setChosen] = useState<Lead | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null), alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) { if (body.current) body.current.scrollTop = 0; alert.current?.focus(); } }, [error]);
  const context = useQuery(() => defaultContactId ? getLead(defaultContactId) : Promise.resolve(undefined), [defaultContactId]);
  const selected = chosen ?? (context.data ?? null), retry = useRef<ShowingWriteAttempt<Omit<CreateShowingInput, "requestId">> | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    if (!selected) { setError("Choose the contact who will attend this showing."); return; }
    const schedule = showingScheduleValue(draft);
    if (!schedule.ok) { setError(schedule.message); document.getElementById(`${prefix}-${schedule.field === "day" ? "day" : schedule.field === "meetingDetails" ? "meeting" : schedule.field}`)?.focus(); return; }
    const payload = { propertyId: property.id, contactId: selected.id, ...schedule.value };
    if (!canSubmitShowingSchedule(schedule.value, payload, retry.current)) { setError("Choose a future showing within the next two years, lasting 15 to 240 minutes."); document.getElementById(`${prefix}-day`)?.focus(); return; }
    const attempt = showingWriteAttempt(retry.current, payload);
    if (!createShowingInputSchema.safeParse(attempt.input).success) { setError("Check the contact, dates and text limits before saving."); return; }
    retry.current = attempt;
    setSaving(true); setError(null);
    try { const saved = await createShowing(retry.current.input); if (saved.status !== "scheduled" || saved.sourcePropertyId !== property.id || saved.contactId !== selected.id) throw Error("Plan not confirmed"); onClose(); onCreated(saved); }
    catch (failure) { setError(showingFailure(failure, "create")); }
    finally { setSaving(false); }
  }
  return <DialogContent focusFallback={focusFallback} hideClose={saving} className="flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0" onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus(); }} onEscapeKeyDown={(event) => saving && event.preventDefault()} onPointerDownOutside={(event) => saving && event.preventDefault()}>
    <DialogHeader className="shrink-0 border-b border-border p-5 pr-10"><div className="flex items-center gap-2.5"><IconWell icon={CalendarClock} /><DialogTitle ref={heading} tabIndex={-1}>Plan showing</DialogTitle></div><DialogDescription className="break-words text-xs leading-relaxed [overflow-wrap:anywhere]">{property.listing?.address || `MLS ${property.mlsNumber}`} · {listName}</DialogDescription></DialogHeader>
    <form className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}><div ref={body} className="min-h-0 space-y-5 overflow-y-auto p-5">{error && <p ref={alert} tabIndex={-1} role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}{defaultContactId && context.loading && !chosen && <p role="status" className="text-xs text-muted-foreground">Loading the contact linked to this list…</p>}{defaultContactId && (context.error || !context.loading && !context.data) && !chosen && <div role="alert" className="text-xs leading-relaxed">The linked contact could not be loaded. Choose an available contact below, or <button type="button" className="min-h-10 px-1 font-semibold underline" onClick={context.refetch}>retry the linked contact</button>.</div>}<ShowingContactPicker selected={selected} onChange={setChosen} disabled={saving} /><div className="border-t border-border pt-4"><ShowingScheduleFields prefix={prefix} value={draft} disabled={saving} onChange={setDraft} /></div></div><div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border p-4"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || !selected}>{saving ? "Saving…" : "Save showing plan"}</Button></div></form>
  </DialogContent>;
}
