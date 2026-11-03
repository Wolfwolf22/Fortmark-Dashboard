"use client";
import { useId, useState } from "react";
import { getLead, changeFollowUp } from "@/lib/data/adapters/leads";
import { checkFollowUpDay, followUpStatus } from "@/lib/contacts/follow-up";
import { useQuery } from "@/lib/data/hooks";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { calendarFailure } from "./calendar-state";
import type { Lead } from "@/lib/data/types";

export function CalendarReminderEditor({ contactId, canWrite, onSaved, onBusyChange }: { contactId: string; canWrite: boolean; onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
  const query = useQuery(() => getLead(contactId), [contactId]);
  const denied = [401,403,404].includes((query.error as {status?:number}|null)?.status ?? 0);
  if (denied || (!query.data && query.error)) return <p role="alert" className="text-sm">{calendarFailure(query.error)}</p>;
  if (!query.data) return query.loading ? <Skeleton className="h-24 w-full"/> : <p className="text-sm">This contact is no longer available.</p>;
  if (query.data.id !== contactId) return <Skeleton className="h-24 w-full"/>;
  if (query.data.nextAction) return <p className="text-sm">This reminder now has a timed next action. Refresh Calendar to open the current action.</p>;
  return <ReminderDraft key={contactId} current={query.data} canWrite={canWrite} onSaved={onSaved} onBusyChange={onBusyChange} refetch={query.refetch} unavailable={Boolean(query.error)}/>;
}

/** A background refresh must never silently replace the revision an agent reviewed. */
function ReminderDraft({ current, canWrite, onSaved, onBusyChange, refetch, unavailable }: { current: Lead; canWrite: boolean; onSaved: () => void; onBusyChange: (busy: boolean) => void; refetch: () => void; unavailable: boolean }) {
  const [opening, setOpening] = useState(current), [day, setDay] = useState(() => followUpStatus(current.nextFollowUpDate).day ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [blocked, setBlocked] = useState(false), [fresh, setFresh] = useState<Lead | null>(null), [denied,setDenied] = useState(false), prefix = useId();
  const stale = current.updatedAt !== opening.updatedAt, disabled = busy || !canWrite || unavailable || stale || blocked || fresh !== null;
  async function save(complete: boolean) {
    if (disabled || current.nextAction) return;
    if (!complete && !checkFollowUpDay(day, new Date()).ok) { setError("Choose today or a future reminder date within two years."); return; }
    setBusy(true); onBusyChange(true); setError(null);
    try { await changeFollowUp(opening.id, complete ? { action: "complete", expectedUpdatedAt: opening.updatedAt } : { action: "schedule", day, expectedUpdatedAt: opening.updatedAt }); onSaved(); }
    catch (failure) { setError(calendarFailure(failure)); setBlocked(true); if ([401,403,404].includes((failure as {status?:number}).status ?? 0)) setDenied(true); refetch(); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function review() {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError(null);
    try { const saved = await getLead(opening.id); if (!saved) { setError("This contact is no longer available."); return; } setFresh(saved); }
    catch (failure) { setError(calendarFailure(failure)); if ([401,403,404].includes((failure as {status?:number}).status ?? 0)) setDenied(true); }
    finally { setBusy(false); onBusyChange(false); refetch(); }
  }
  function accept(keep: boolean) {
    if (!fresh || fresh.nextAction) return;
    setOpening(fresh); if (!keep) setDay(followUpStatus(fresh.nextFollowUpDate).day ?? "");
    setFresh(null); setBlocked(false); setError(null); refetch();
  }
  if (denied) return <p role="alert" className="text-sm">{error ?? "This contact is no longer available."}</p>;
  return <section className="space-y-3 rounded-panel border border-border p-4" aria-label="Edit follow-up reminder">
    <Label htmlFor={`${prefix}-day`}>Follow-up date · Eastern time</Label><Input id={`${prefix}-day`} type="date" value={day} disabled={busy || !canWrite || fresh !== null} onChange={event => setDay(event.target.value)}/>
    {(stale || blocked || unavailable) && !fresh && <div role="status" className="space-y-2"><p className="text-sm">The saved reminder needs review. Your proposed date is preserved.</p><Button variant="outline" disabled={busy} onClick={() => void review()}>Review saved reminder</Button></div>}
    {fresh && <div role="status" className="space-y-2 rounded-panel bg-tint p-3"><p className="text-sm font-semibold">Current saved reminder</p>{fresh.nextAction ? <p className="text-sm">This contact now has a timed next action. Refresh Calendar to open it.</p> : <><p className="text-sm">{followUpStatus(fresh.nextFollowUpDate).day ?? "No reminder set"}</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => accept(true)}>Keep my proposed date</Button><Button variant="outline" disabled={busy} onClick={() => accept(false)}>Use saved reminder</Button></div></>}</div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={() => void save(false)}>Save reminder</Button><Button variant="outline" disabled={disabled || !opening.nextFollowUpDate} onClick={() => void save(true)}>Mark complete</Button></div><p className="text-xs text-muted-foreground">Saves the original contact reminder and keeps you in Calendar.</p>
  </section>;
}
