"use client";

import { useId, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNoteStamp } from "@/lib/contacts/note-format";
import { formatRelative } from "@/lib/utils";
import { LeadTimeline } from "./lead-timeline";

/** A real touch timestamp only; creation/internal activity is never a fallback. */
export function recordedTouchStamp(value?: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export function ContactTouchHistory({ contactId, name, lastTouchDate, available, refreshKey = 0 }: {
  contactId: string; name: string; lastTouchDate?: string; available: boolean; refreshKey?: number;
}) {
  const [open, setOpen] = useState(false), headingId = useId(), stamp = recordedTouchStamp(lastTouchDate);
  return <section aria-labelledby={headingId} className="mt-4 min-w-0 border-t border-border pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h4 id={headingId} className="text-[11px] font-semibold text-muted-foreground">Most recent touch</h4>
        {stamp ? <><p className="break-words text-[13px] font-semibold leading-relaxed tabular"><time dateTime={stamp}>{formatNoteStamp(stamp)}</time></p><p className="text-xs text-muted-foreground">{formatRelative(stamp)} · Eastern time</p></> : <p className="text-[13px] text-muted-foreground">No recorded touch</p>}
      </div>
      {available && <Button type="button" variant="outline" size="sm" className="min-h-10 shrink-0" onClick={() => setOpen(true)}><History aria-hidden/>Touch history</Button>}
    </div>
    {!available && <p className="mt-2 text-xs text-muted-foreground">Touch history is available for stored contacts.</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden"><DialogHeader className="shrink-0"><DialogTitle className="break-words pr-8 [overflow-wrap:anywhere]">Touch history · {name}</DialogTitle><DialogDescription>Recorded calls, emails, texts, meetings, showings and contacted marks. Notes and next-action changes stay in Activity.</DialogDescription></DialogHeader><div className="min-h-0 max-h-[65dvh] overflow-y-auto pr-1"><LeadTimeline key={contactId} leadId={contactId} refreshKey={refreshKey} touchesOnly/></div></DialogContent></Dialog>
  </section>;
}
