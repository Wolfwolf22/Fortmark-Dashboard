"use client";
import { useState } from "react";
import { NextActionView } from "@/components/leads/next-action";
import { getLead, getNextActionAssignees, updateNextAction } from "@/lib/data/adapters/leads";
import type { NextActionMutation } from "@/lib/contacts/next-action";
import { useQuery } from "@/lib/data/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { calendarFailure } from "./calendar-state";

export function CalendarContactAction({ contactId, canWrite, onSaved, onBusyChange }: { contactId: string; canWrite: boolean; onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
  const query = useQuery(() => getLead(contactId), [contactId]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [denied,setDenied] = useState(false);
  async function save(input: NextActionMutation): Promise<boolean> {
    if (busy || !canWrite || !query.data || query.error) return false;
    setBusy(true); onBusyChange(true); setError(null);
    try {
      const saved = await updateNextAction(contactId, input);
      if (!saved) { setError("This contact is no longer available."); return false; }
      onSaved(); return true;
    } catch (failure) {
      if ([401,403,404].includes((failure as {status?:number}).status ?? 0)) setDenied(true);
      if ((failure as { status?: number }).status === 409) throw failure;
      setError(calendarFailure(failure)); return false;
    } finally { setBusy(false); onBusyChange(false); query.refetch(); }
  }
  if (denied) return <p role="alert" className="text-sm">This contact action is no longer available. Refresh Calendar to review your access.</p>;
  if (query.error) return <div role="alert" className="space-y-3"><p className="text-sm">{calendarFailure(query.error)}</p><Button variant="outline" onClick={query.refetch}>Reload contact action</Button></div>;
  if (!query.data) return query.loading ? <Skeleton className="h-32 w-full"/> : <p className="text-sm">This contact is no longer available.</p>;
  if (query.data.id !== contactId) return <Skeleton className="h-32 w-full"/>;
  return <div className="space-y-3">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<NextActionView lead={query.data} canWrite={canWrite} available={query.data.recordSource !== "sample"} saving={busy} onSave={save} onReload={async () => { try { const next = await getLead(contactId); if (!next) setDenied(true); return next; } catch(failure) { if ([401,403,404].includes((failure as {status?:number}).status ?? 0)) setDenied(true); throw failure; } finally { query.refetch(); } }} loadAssignees={() => getNextActionAssignees(contactId)}/></div>;
}
