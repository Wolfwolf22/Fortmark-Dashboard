"use client";

/**
 * Lead detail drawer — the workspace for one relationship. Sections, in the
 * order a person works: who they are (and editing that), where the relationship
 * stands (stage, owner, last touch), the follow-up, logging a touch, what has
 * happened, and notes. Controls a role cannot use are not offered; the server
 * still decides.
 *
 * Two separate things people do about a
 * contact:
 *
 *   - the FOLLOW-UP: a reminder. Schedule, change or mark it complete on its
 *     own; nothing about it says the contact was reached, and last contact is
 *     left alone.
 *   - a TOUCH: something that happened (a call, a showing). Logging one moves
 *     last contact, and may also set the next follow-up in the same step —
 *     "I called Jane today, call again Friday."
 *
 * Logging a touch never clears a follow-up on its own — an attempted call may
 * complete nothing. The reminder changes only when the person picks a date or
 * asks to complete it.
 *
 * Mutations go through the adapter, which bumps the data version so every
 * open list refetches on its own.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useSessionUser } from "@/components/layout/session-user";
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
  getLeadAgents,
  LeadsError,
  changeFollowUp,
  logTouch,
  markContacted,
  reassignLead,
  updateContact,
  updateLeadStage,
  type ContactEdit,
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
import { businessDayKey } from "@/lib/metrics/business-day";
import {
  followUpLabel,
  followUpStatus,
  formatFollowUpDay,
  isFollowUpDue,
  noRecentTouch,
  NO_TOUCH_LABEL,
} from "@/lib/contacts/follow-up";
import { INTENT_LABELS, leadAbilities } from "./lead-shared";
import { LeadEditForm } from "./lead-edit-form";
import { LeadTimeline } from "./lead-timeline";

const TOUCH_KINDS: { value: TouchKind; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
  { value: "meeting", label: "Meeting" },
  { value: "showing", label: "Showing" },
  { value: "note", label: "Note" },
];

/**
 * Today for the date inputs' floor — the business day, the same one that
 * decides what "due" means, not the browser's. A person in another timezone
 * is never offered a day the server would call the past.
 */
function businessToday(): string {
  return businessDayKey(new Date());
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
    if (error.code === "invalid_date") return "Pick today or a later date.";
    if (error.code === "invalid_assignee") return "That person cannot be assigned contacts.";
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

  const abilities = leadAbilities(useSessionUser().role);
  const { data: roster } = useQuery(
    () => (abilities.canReassign ? getLeadAgents() : Promise.resolve([] as { id: string; name: string }[])),
    [abilities.canReassign]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editing the details, reassigning the owner, and confirming an archive.
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);

  // The direct follow-up control (no touch involved).
  const [editingFollowUp, setEditingFollowUp] = useState(false);
  const [followUpDay, setFollowUpDay] = useState("");

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
    setEditingFollowUp(false);
    setFollowUpDay("");
    setError(null);
    setNotice(null);
    setEditing(false);
    setReassigning(false);
    setNewOwner("");
    setConfirmArchive(false);
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

  async function saveEdit(patch: ContactEdit): Promise<boolean> {
    if (!lead) return false;
    // A refusal is the form's to explain (it names the fields), so it is not
    // swallowed into the drawer-level message.
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { changed } = await updateContact(lead.id, patch);
      setEditing(false);
      setNotice(changed.length > 0 ? "Contact details saved." : "No changes to save.");
      return true;
    } catch (e) {
      if (e instanceof LeadsError && e.status === 400 && e.fields.length > 0) throw e;
      setError(describe(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmReassign() {
    if (!lead || !newOwner) return;
    const target = roster?.find((a) => a.id === newOwner)?.name ?? "the new agent";
    const ok = await run(() => reassignLead(lead.id, newOwner));
    if (!ok) return;
    setReassigning(false);
    setNewOwner("");
    setNotice(`Reassigned to ${target}.`);
  }

  async function archive(to: LeadStage) {
    if (!lead) return;
    const ok = await run(() => updateLeadStage(lead.id, to));
    if (!ok) return;
    setConfirmArchive(false);
    setNotice(to === "archived" ? "Contact archived." : "Contact restored to Lead.");
  }

  const followUp = followUpStatus(lead?.nextFollowUpDate);
  const quiet = lead ? noRecentTouch(lead.lastContactDate) : false;
  const hasFollowUp = followUp.state !== "none";

  async function saveFollowUp(e: FormEvent) {
    e.preventDefault();
    if (!lead || !followUpDay) return;
    const day = followUpDay;
    const rescheduling = hasFollowUp;
    const ok = await run(() => changeFollowUp(lead.id, { action: "schedule", day }));
    if (!ok) return;
    setEditingFollowUp(false);
    setFollowUpDay("");
    setNotice(`Follow-up ${rescheduling ? "changed to" : "set for"} ${formatFollowUpDay(day)}.`);
  }

  async function completeCurrentFollowUp() {
    if (!lead) return;
    const ok = await run(() => changeFollowUp(lead.id, { action: "complete" }));
    if (ok) setNotice("Follow-up marked complete.");
  }

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

  const heading = "text-micro";
  const ownerName = agentName ?? (lead?.recordSource === "sample" ? undefined : "Unnamed agent");
  const otherAgents = (roster ?? []).filter((a) => a.id !== lead?.assignedAgentId);
  const stageChoices = lead && !LEAD_STAGES.includes(lead.stage) ? [...LEAD_STAGES, lead.stage] : LEAD_STAGES;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto p-6 sm:max-w-xl">
        {lead ? (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle>{lead.name}</SheetTitle>
              {/* Only what exists: a contact with no email or phone has no
                  subtitle, not a lone separator. */}
              {[lead.email, lead.phone].filter(Boolean).length > 0 ? (
                <SheetDescription>{[lead.email, lead.phone].filter(Boolean).join(" · ")}</SheetDescription>
              ) : (
                <SheetDescription className="sr-only">Contact details</SheetDescription>
              )}
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

            {!abilities.canWrite && (
              <p role="note" className="mt-4 rounded-panel bg-tint px-3 py-2 text-[13px] text-muted-foreground">
                You have read-only access to this contact.
              </p>
            )}

            <div className="flex-1 space-y-6">
              {/* --- Identity ------------------------------------------------ */}
              <section aria-labelledby="lead-identity-heading" className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="lead-identity-heading" className={heading}>
                    Contact
                  </h3>
                  {abilities.canWrite && !editing && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        setError(null);
                        setNotice(null);
                        setEditing(true);
                      }}
                    >
                      <Pencil aria-hidden />
                      Edit contact
                    </Button>
                  )}
                </div>
                {editing ? (
                  <div className="mt-3">
                    <LeadEditForm lead={lead} saving={saving} onSave={saveEdit} onCancel={() => setEditing(false)} />
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 rounded-panel bg-tint p-4">
                    <Fact label="Email" value={lead.email || "—"} />
                    <Fact label="Phone" numeric value={lead.phone || "—"} />
                    <Fact label="Company" value={lead.editable?.company || "—"} />
                    <Fact label="Source" value={LEAD_SOURCE_LABELS[lead.source]} />
                    <Fact label="Intent" value={lead.intent === "other" ? "Not stated" : INTENT_LABELS[lead.intent]} />
                    <Fact label="Budget" numeric value={lead.budget != null ? formatCurrency(lead.budget) : "—"} />
                    <Fact label="Neighborhood" value={lead.neighborhood ?? "—"} />
                    <Fact label="Created" numeric value={formatDate(lead.createdDate)} />
                  </div>
                )}
              </section>

              {/* --- Relationship -------------------------------------------- */}
              <section aria-labelledby="lead-relationship-heading">
                <h3 id="lead-relationship-heading" className={heading}>
                  Relationship
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 rounded-panel bg-tint p-4">
                  <Fact
                    label="Assigned agent"
                    value={
                      ownerName ? (
                        <span className="flex items-center gap-2" data-testid="lead-assigned-agent">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px]">{initials(ownerName)}</AvatarFallback>
                          </Avatar>
                          <span className={cn(ownerName === "Unnamed agent" && "font-normal text-muted-foreground")}>{ownerName}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    }
                  />
                  <Fact
                    label="Last touch"
                    numeric
                    value={
                      lead.lastTouchDate || lead.recordSource === "sample" ? formatRelative(lead.lastContactDate) : "Never"
                    }
                  />
                </div>
                {abilities.canReassign && (
                  <div className="mt-3">
                    {reassigning ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="lead-reassign-agent">Reassign to</Label>
                          <Select value={newOwner} onValueChange={setNewOwner} disabled={saving}>
                            <SelectTrigger id="lead-reassign-agent" aria-label="New assigned agent" className="w-56">
                              <SelectValue placeholder="Choose an agent" />
                            </SelectTrigger>
                            <SelectContent>
                              {otherAgents.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" size="sm" disabled={saving || !newOwner} onClick={() => void confirmReassign()}>
                          Reassign
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => {
                            setReassigning(false);
                            setNewOwner("");
                          }}
                        >
                          Cancel
                        </Button>
                        {otherAgents.length === 0 && (
                          <p className="basis-full text-xs text-muted-foreground">There is no one else on your team to assign this to.</p>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          setError(null);
                          setNotice(null);
                          setReassigning(true);
                        }}
                      >
                        Reassign agent
                      </Button>
                    )}
                  </div>
                )}
                <div className="mt-4">
                  <p className={heading}>Stage</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Select value={lead.stage} onValueChange={(v) => changeStage(v as LeadStage)} disabled={saving || !abilities.canWrite}>
                      <SelectTrigger aria-label="Lead stage" className="w-full sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stageChoices.map((stage) => (
                          <SelectItem key={stage} value={stage}>
                            {LEAD_STAGE_LABELS[stage]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {abilities.canWrite &&
                      (lead.stage === "archived" ? (
                        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void archive("lead")}>
                          Restore to Lead
                        </Button>
                      ) : confirmArchive ? (
                        <span role="group" aria-label="Confirm archive" className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-muted-foreground">Archive this contact?</span>
                          <Button type="button" size="sm" disabled={saving} onClick={() => void archive("archived")}>
                            Archive
                          </Button>
                          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setConfirmArchive(false)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setConfirmArchive(true)}>
                          Archive
                        </Button>
                      ))}
                  </div>
                </div>
              </section>

              {/* --- Follow-up ------------------------------------------------ */}
              <section aria-labelledby="follow-up-heading" className="rounded-panel border border-border p-4">
                <h3 id="follow-up-heading" className={heading}>
                  Next follow-up
                </h3>
                <p
                  data-testid="lead-next-follow-up"
                  className={cn(
                    "mt-1 text-sm font-semibold tabular",
                    followUp.state === "none" && "font-normal text-muted-foreground",
                    isFollowUpDue(followUp) && "text-status-warn"
                  )}
                >
                  {followUpLabel(followUp, { withDate: true })}
                </p>
                {abilities.canWrite &&
                  (editingFollowUp ? (
                    <form onSubmit={saveFollowUp} className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="lead-follow-up-day">{hasFollowUp ? "New date" : "Date"}</Label>
                        <Input
                          id="lead-follow-up-day"
                          type="date"
                          min={businessToday()}
                          value={followUpDay}
                          onChange={(e) => setFollowUpDay(e.target.value)}
                          disabled={saving}
                          className="w-44"
                        />
                      </div>
                      <Button type="submit" size="sm" disabled={saving || !followUpDay}>
                        Save follow-up
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => {
                          setEditingFollowUp(false);
                          setFollowUpDay("");
                        }}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          setError(null);
                          setNotice(null);
                          setEditingFollowUp(true);
                        }}
                      >
                        {hasFollowUp ? "Change" : "Schedule"}
                      </Button>
                      {hasFollowUp && (
                        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void completeCurrentFollowUp()}>
                          Mark complete
                        </Button>
                      )}
                    </div>
                  ))}
                <p className="mt-3 text-xs text-muted-foreground">A reminder only. It does not count as a touch.</p>
              </section>

              {/* --- Log a touch ---------------------------------------------- */}
              {abilities.canWrite && (
                <form
                  aria-labelledby="log-touch-heading"
                  onSubmit={submitTouch}
                  className="space-y-3 rounded-panel border border-border p-4"
                >
                  <h3 id="log-touch-heading" className={heading}>
                    Log a touch
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <Select value={touchKind} onValueChange={(v) => setTouchKind(v as TouchKind)} disabled={saving}>
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
                      {hasFollowUp ? "Also change the follow-up (optional)" : "Also set a follow-up (optional)"}
                    </Label>
                    <Input
                      id="lead-next-follow-up-day"
                      type="date"
                      min={businessToday()}
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
                      ? "This touch updates last contact. Leave both empty to keep the current follow-up."
                      : "This touch updates last contact. Add a date to be reminded."}
                  </p>
                  <Button type="submit" disabled={saving || !summary.trim()}>
                    Log touch
                  </Button>
                </form>
              )}

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-muted-foreground">
                  {notice}
                </p>
              )}

              {/* --- Activity ------------------------------------------------- */}
              <LeadTimeline leadId={lead.id} />

              {/* --- Notes ---------------------------------------------------- */}
              <section aria-labelledby="lead-notes-heading">
                <h3 id="lead-notes-heading" className={heading}>
                  Notes
                </h3>
                <p className={cn("mt-2 whitespace-pre-wrap text-sm leading-6", lead.notes ? "text-foreground" : "text-muted-foreground")}>
                  {lead.notes || "No notes yet."}
                </p>
              </section>
            </div>
            {abilities.canWrite && (
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button variant="outline" onClick={() => void run(() => markContacted(lead.id))} disabled={saving}>
                  Mark contacted today
                </Button>
                <p className="text-xs text-muted-foreground">Sets last contact to now. The follow-up is kept.</p>
              </div>
            )}
          </>
        ) : loading && leadId ? (
          <DrawerSkeleton />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Lead</SheetTitle>
              <SheetDescription className="sr-only">Lead details</SheetDescription>
            </SheetHeader>
            <p className="mt-8 text-sm text-muted-foreground">This lead is no longer available.</p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
