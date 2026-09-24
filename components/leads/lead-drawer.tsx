"use client";

/**
 * Lead detail drawer — full record, notes, a stage select that advances the
 * lead through the pipeline, and the follow-up loop: log a touch, set or
 * reschedule the next follow-up, or mark the current one complete.
 *
 * Logging a touch never clears a follow-up on its own — an attempted call may
 * complete nothing. The reminder changes only when the person picks a new
 * date or ticks "Mark current follow-up complete".
 *
 * Mutations go through the adapter, which bumps the data version so every
 * open list refetches on its own.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";
import { getAgent } from "@/lib/data/adapters/agents";
import {
  getLead,
  LeadsError,
  logTouch,
  markContacted,
  updateLeadStage,
  type TouchKind,
} from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import {
  Lead,
  LeadStage,
  LEAD_SOURCE_LABELS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
} from "@/lib/data/types";
import { cn, formatCurrency, formatDate, formatRelative, initials } from "@/lib/utils";
import {
  followUpLabel,
  followUpStatus,
  formatFollowUpDay,
  isFollowUpDue,
  noRecentTouch,
  NO_TOUCH_LABEL,
} from "@/lib/contacts/follow-up";
import { INTENT_LABELS } from "./lead-shared";

const TOUCH_KINDS: { value: TouchKind; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
  { value: "meeting", label: "Meeting" },
  { value: "showing", label: "Showing" },
  { value: "note", label: "Note" },
];

/** Today in the reader's calendar, for the date input's floor. */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface LeadDrawerProps {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Fact({
  label,
  value,
  numeric,
}: {
  label: string;
  value: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div>
      <p className="text-micro">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold", numeric && "tabular")}>
        {value}
      </p>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">Loading lead</SheetTitle>
        <SheetDescription className="sr-only">
          Lead details are loading
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-2">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-40 w-full rounded-panel" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </>
  );
}

/** What a refused write means to the person, without the wire detail. */
function describe(error: unknown): string {
  if (error instanceof LeadsError) {
    if (error.code === "invalid_transition") return "That stage change is not allowed from here.";
    if (error.status === 403) return "You do not have permission to change this contact.";
    if (error.status === 404) return "This contact is no longer available.";
  }
  return "The change could not be saved. Try again.";
}

export function LeadDrawer({ leadId, open, onOpenChange }: LeadDrawerProps) {
  const { data, loading } = useQuery<Lead | undefined>(
    () => (leadId ? getLead(leadId) : Promise.resolve(undefined)),
    [leadId]
  );
  // Guard against stale data from a previously opened lead.
  const lead = data && data.id === leadId ? data : undefined;

  // A stored contact carries its agent's name; only the sample roster needs
  // the agents adapter looked up by id.
  const sampleAgentId = lead?.recordSource === "sample" ? lead.assignedAgentId : null;
  const { data: agent } = useQuery(
    () => (sampleAgentId ? getAgent(sampleAgentId) : Promise.resolve(undefined)),
    [sampleAgentId]
  );
  const agentName = lead?.assignedAgentName ?? agent?.name;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The "Log a touch" form. Reset whenever a different lead opens.
  const [touchKind, setTouchKind] = useState<TouchKind>("call");
  const [summary, setSummary] = useState("");
  const [nextDay, setNextDay] = useState("");
  const [complete, setComplete] = useState(false);
  const [formFor, setFormFor] = useState<string | null>(leadId);
  if (formFor !== leadId) {
    setFormFor(leadId);
    setTouchKind("call");
    setSummary("");
    setNextDay("");
    setComplete(false);
    setError(null);
    setNotice(null);
  }

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (!lead || saving) return false;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // The adapter bumps the data version, so the drawer, the table, and
      // the summary strip all refetch on their own.
      await action();
      return true;
    } catch (e) {
      setError(describe(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function changeStage(stage: LeadStage) {
    if (!lead || stage === lead.stage) return;
    void run(() => updateLeadStage(lead.id, stage));
  }

  const followUp = followUpStatus(lead?.nextFollowUpDate);
  const quiet = lead ? noRecentTouch(lead.lastContactDate) : false;
  const hasFollowUp = followUp.state !== "none";

  async function submitTouch(e: FormEvent) {
    e.preventDefault();
    if (!lead) return;
    const text = summary.trim();
    if (!text) {
      setError("Add a short summary of the touch.");
      return;
    }
    const day = nextDay || undefined;
    const completing = !day && complete && hasFollowUp;
    const ok = await run(() =>
      logTouch(lead.id, { kind: touchKind, summary: text, nextFollowUpDay: day, completeFollowUp: completing })
    );
    if (!ok) return;
    setSummary("");
    setNextDay("");
    setComplete(false);
    setNotice(
      day
        ? `Touch logged. Next follow-up set for ${formatFollowUpDay(day)}.`
        : completing
          ? "Touch logged. Follow-up marked complete."
          : hasFollowUp
            ? `Touch logged. Follow-up kept for ${formatFollowUpDay(followUp.day!)}.`
            : "Touch logged."
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto p-6 sm:max-w-xl">
        {lead ? (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle>{lead.name}</SheetTitle>
              <SheetDescription>
                {lead.email} · {lead.phone}
              </SheetDescription>
            </SheetHeader>
            {lead.recordSource === "sample" && (
              <div className="mt-3">
                <SampleDataNotice subject="This contact is generated for development and is not a real person." />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{LEAD_SOURCE_LABELS[lead.source]}</Badge>
              <Badge variant="secondary">{LEAD_STAGE_LABELS[lead.stage]}</Badge>
              {isFollowUpDue(followUp) && (
                <StatusPill tone="warn">
                  {followUp.state === "overdue" ? "Follow-up overdue" : "Follow-up due today"}
                </StatusPill>
              )}
              {quiet && <StatusPill tone="neutral">{NO_TOUCH_LABEL}</StatusPill>}
            </div>
            <div className="flex-1">
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 rounded-panel bg-tint p-4">
                <Fact label="Intent" value={INTENT_LABELS[lead.intent]} />
                <Fact
                  label="Budget"
                  numeric
                  value={lead.budget != null ? formatCurrency(lead.budget) : "—"}
                />
                <Fact label="Neighborhood" value={lead.neighborhood ?? "—"} />
                <Fact
                  label="Assigned agent"
                  value={
                    agentName ? (
                      <span className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {initials(agentName)}
                          </AvatarFallback>
                        </Avatar>
                        {agentName}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Fact label="Created" numeric value={formatDate(lead.createdDate)} />
                <Fact
                  label="Last contact"
                  numeric
                  value={formatRelative(lead.lastContactDate)}
                />
                <Fact
                  label="Next follow-up"
                  numeric
                  value={
                    <span
                      data-testid="lead-next-follow-up"
                      className={cn(
                        followUp.state === "none" && "text-muted-foreground",
                        isFollowUpDue(followUp) && "text-status-warn"
                      )}
                    >
                      {followUpLabel(followUp)}
                    </span>
                  }
                />
              </div>
              <div className="mt-6">
                <p className="text-micro">Stage</p>
                <Select
                  value={lead.stage}
                  onValueChange={(v) => changeStage(v as LeadStage)}
                  disabled={saving}
                >
                  <SelectTrigger
                    aria-label="Lead stage"
                    className="mt-2 w-full sm:w-56"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {LEAD_STAGE_LABELS[stage]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <form
                aria-labelledby="log-touch-heading"
                onSubmit={submitTouch}
                className="mt-6 space-y-3 rounded-panel border border-border p-4"
              >
                <p id="log-touch-heading" className="text-micro">
                  Log a touch
                </p>
                <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <Select
                    value={touchKind}
                    onValueChange={(v) => setTouchKind(v as TouchKind)}
                    disabled={saving}
                  >
                    <SelectTrigger aria-label="Touch type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TOUCH_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label="Touch summary"
                    placeholder="What happened — e.g. left a voicemail"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    maxLength={1000}
                    disabled={saving}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="lead-next-follow-up-day">
                    {hasFollowUp ? "Reschedule follow-up (optional)" : "Set next follow-up (optional)"}
                  </Label>
                  <Input
                    id="lead-next-follow-up-day"
                    type="date"
                    min={localToday()}
                    value={nextDay}
                    onChange={(e) => setNextDay(e.target.value)}
                    disabled={saving}
                    className="w-full sm:w-48"
                  />
                </div>
                {hasFollowUp && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="lead-complete-follow-up"
                      checked={complete && !nextDay}
                      onCheckedChange={(v) => setComplete(v === true)}
                      disabled={saving || Boolean(nextDay)}
                    />
                    <Label htmlFor="lead-complete-follow-up" className="font-normal">
                      Mark current follow-up complete
                    </Label>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {hasFollowUp
                    ? "Leave both empty to keep the current follow-up. A new date replaces it."
                    : "The touch updates last contact. Add a date to be reminded."}
                </p>
                <Button type="submit" disabled={saving || !summary.trim()}>
                  Log touch
                </Button>
              </form>
              {error && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  {notice}
                </p>
              )}
              <p className="text-micro mt-6">Notes</p>
              <p
                className={cn(
                  "mt-2 text-sm leading-6",
                  lead.notes ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {lead.notes || "No notes yet."}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                variant="outline"
                onClick={() => void run(() => markContacted(lead.id))}
                disabled={saving}
              >
                Mark contacted today
              </Button>
              <p className="text-xs text-muted-foreground">
                Sets last contact to now. The follow-up is kept.
              </p>
            </div>
          </>
        ) : loading && leadId ? (
          <DrawerSkeleton />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Lead</SheetTitle>
              <SheetDescription className="sr-only">Lead details</SheetDescription>
            </SheetHeader>
            <p className="mt-8 text-sm text-muted-foreground">
              This lead is no longer available.
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
