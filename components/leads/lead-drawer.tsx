"use client";

/**
 * Contact drawer — the workspace for one relationship.
 *
 * One calm hierarchy, top to bottom: who they are (name, stage, source, and — for
 * an admin looking at a colleague's contact — whose it is), the things you do
 * (quick actions), what they want (client needs), what you have written
 * (notes, always there), what has happened (the latest few items, the rest on
 * request), where the relationship is formal (representation) and the deals they
 * are on. Controls a role cannot use are not offered; the server still decides.
 *
 * Two separate things people do about a contact, kept apart on purpose:
 *
 *   - the FOLLOW-UP: a reminder. Schedule, change or complete it on its own;
 *     nothing about it says the contact was reached, and last contact is left alone.
 *   - a TOUCH: something that happened (a call, a showing). Logging one moves last
 *     contact, and may set the next follow-up in the same step.
 *
 * Logging a touch never clears a follow-up on its own — an attempted call may
 * complete nothing. Moving a contact into Active client or Representation asks
 * for an acknowledgement first (see `EngagementNotice`). There is no reassignment:
 * a contact belongs to the person who created it.
 *
 * Mutations go through the adapter, which bumps the data version so every open
 * list refetches on its own.
 */
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, ArrowRightLeft, CalendarClock, Pencil, Phone, ShieldCheck, UserCheck, UserRound, Workflow, type LucideIcon } from "lucide-react";
import { useSessionUser } from "@/components/layout/session-user";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { IconWell } from "@/components/ui/icon-well";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";
import { getAgent } from "@/lib/data/adapters/agents";
import {
  changeFollowUp,
  getLead,
  getLinkedTransactions,
  LeadsError,
  logTouch,
  markContacted,
  updateContact,
  updateLeadStage,
  type ContactEdit,
  type TouchKind,
} from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import { Lead, LeadStage, LEAD_SOURCE_LABELS, LEAD_STAGES, LEAD_STAGE_LABELS, TRANSACTION_STAGE_LABELS, type TransactionStage } from "@/lib/data/types";
import { cn, formatDate, formatRelative, initials } from "@/lib/utils";
import { businessDayKey } from "@/lib/metrics/business-day";
import { followUpLabel, followUpStatus, formatFollowUpDay, isFollowUpDue, noRecentTouch, NO_TOUCH_LABEL } from "@/lib/contacts/follow-up";
import { allowedStageTransitions, canTransition, requiresEngagementNotice } from "@/lib/contacts/stages";
import type { Birthday } from "@/lib/contacts/birthday";
import { useUiStore } from "@/lib/stores/ui";
import { leadAbilities } from "./lead-shared";
import { EngagementNotice } from "./engagement-notice";
import { LeadBirthday } from "./lead-birthday";
import { LeadEditForm } from "./lead-edit-form";
import { ClientInfo } from "./client-info";
import type { ClientInfoSave } from "@/lib/contacts/client-info";
import { LeadNeeds } from "./lead-needs";
import { LeadNotes } from "./lead-notes";
import { LeadTimeline } from "./lead-timeline";

const TOUCH_KINDS: { value: TouchKind; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
  { value: "meeting", label: "Meeting" },
  { value: "showing", label: "Showing" },
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
  refreshKey?: number;
}

type Panel = "touch" | "followUp" | "stage" | "edit" | null;
const ACTION_ICONS: Record<Exclude<Panel, null>, LucideIcon> = {
  touch: Phone,
  followUp: CalendarClock,
  stage: ArrowRightLeft,
  edit: Pencil,
};

function Fact({ label, value, numeric }: { label: string; value: ReactNode; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] leading-4 text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 break-words text-sm font-semibold leading-snug", numeric && "tabular")}>{value}</p>
    </div>
  );
}

function SectionHeading({ id, icon, children, detail }: { id: string; icon: LucideIcon; children: ReactNode; detail?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <IconWell icon={icon} />
        <h3 id={id} className="text-[15px] font-semibold">{children}</h3>
      </div>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="overflow-y-auto px-5 py-6 sm:px-6">
      <SheetHeader>
        <SheetTitle className="sr-only">Loading contact</SheetTitle>
        <SheetDescription className="sr-only">Contact details are loading</SheetDescription>
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
    </div>
  );
}

/** What a refused write means to the person, without the wire detail. */
function describe(error: unknown): string {
  if (error instanceof LeadsError) {
    if (error.code === "invalid_transition") return "That stage change is not allowed from here.";
    if (error.status === 403) return "You do not have permission to change this contact.";
    if (error.status === 404) return "This contact is no longer available.";
    if (error.code === "invalid_date") return "Pick today or a later date.";
    if (error.status === 409) return "This contact changed. Review the refreshed details before trying again.";
  }
  return "The change could not be saved. Try again.";
}

export function LeadDrawer({ leadId, open, onOpenChange, refreshKey = 0 }: LeadDrawerProps) {
  const { data, loading, error: loadError, refetch } = useQuery<Lead | undefined>(() => (leadId ? getLead(leadId) : Promise.resolve(undefined)), [leadId, refreshKey]);
  // Guard against stale data from a previously opened lead.
  const lead = data && data.id === leadId ? data : undefined;
  const sample = lead?.recordSource === "sample";

  // A stored contact carries its owner's name; only the sample roster needs the agents adapter.
  const sampleAgentId = sample ? lead?.assignedAgentId : null;
  const { data: agent } = useQuery(() => (sampleAgentId ? getAgent(sampleAgentId) : Promise.resolve(undefined)), [sampleAgentId]);
  const ownerName = lead?.assignedAgentName ?? agent?.name;

  const abilities = leadAbilities(useSessionUser().role);
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);

  const linked = useQuery(() => (leadId && lead && !sample ? getLinkedTransactions(leadId) : Promise.resolve([])), [leadId, lead?.id, sample, refreshKey]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmArchiveFrom, setConfirmArchiveFrom] = useState<LeadStage | null>(null);
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null);
  const [pendingStageFrom, setPendingStageFrom] = useState<LeadStage | null>(null);
  const [stageFocusTarget, setStageFocusTarget] = useState<LeadStage | null>(null);

  useEffect(() => {
    if (!stageFocusTarget || lead?.stage !== stageFocusTarget || saving) return;
    const target = document.getElementById(stageFocusTarget === "archived" ? "lead-stage-restore" : "lead-stage-select");
    if (target) { target.focus(); setStageFocusTarget(null); }
  }, [stageFocusTarget, lead?.stage, saving, panel]);

  // The direct follow-up control (no touch involved).
  const [followUpDay, setFollowUpDay] = useState("");

  // The "Log a touch" form. Reset whenever a different contact opens.
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
    setFollowUpDay("");
    setError(null);
    setNotice(null);
    setPanel(null);
    setConfirmArchive(false);
    setConfirmArchiveFrom(null);
    setPendingStage(null);
    setPendingStageFrom(null);
    setStageFocusTarget(null);
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
      refetch();
      return false;
    } finally {
      setSaving(false);
    }
  }

  function togglePanel(next: Exclude<Panel, null>) {
    setError(null);
    setNotice(null);
    setPanel((current) => (current === next ? null : next));
  }

  /** Moving into a formally-engaged stage asks first; anything else goes straight through. */
  function changeStage(stage: LeadStage) {
    if (!lead || saving || !canTransition(lead.stage, stage)) return;
    if (requiresEngagementNotice(lead.stage, stage)) {
      setPendingStage(stage);
      setPendingStageFrom(lead.stage);
      return;
    }
    void run(() => updateLeadStage(lead.id, stage, { expectedStage: lead.stage }));
  }

  async function confirmEngagement() {
    if (!lead || !pendingStage || !pendingStageFrom) return;
    const stage = pendingStage;
    const ok = await run(() => updateLeadStage(lead.id, stage, { engagementAcknowledged: true, expectedStage: pendingStageFrom }));
    setPendingStage(null);
    setPendingStageFrom(null);
    if (ok) setNotice(`Stage changed to ${LEAD_STAGE_LABELS[stage]}.`);
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
      setPanel(null);
      setNotice(changed.length > 0 ? "Contact details saved." : "No changes to save.");
      return true;
    } catch (e) {
      if (e instanceof LeadsError && (e.status === 409 || (e.status === 400 && e.fields.length > 0))) throw e;
      setError(describe(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveBirthday(next: Birthday | null, expectedUpdatedAt?: string): Promise<boolean> {
    if (!lead) return false;
    const ok = await run(() => updateContact(lead.id, { birthday: next, expectedUpdatedAt }));
    if (ok) setNotice(next ? "Birthday saved." : "Birthday cleared.");
    return ok;
  }

  async function saveClientInfo(patch: ClientInfoSave): Promise<boolean> {
    if (!lead || saving) return false;
    setSaving(true); setError(null); setNotice(null);
    try {
      const { changed } = await updateContact(lead.id, patch);
      setNotice(changed.length ? "Client information saved." : "No changes to save.");
      return true;
    } catch (error) {
      refetch();
      if (error instanceof LeadsError && error.status === 409) throw error;
      setError(describe(error));
      return false;
    } finally { setSaving(false); }
  }

  async function archive(to: LeadStage) {
    if (!lead || !canTransition(lead.stage, to)) return;
    const expectedStage = to === "archived" ? confirmArchiveFrom : lead.stage;
    if (!expectedStage) return;
    if (expectedStage !== lead.stage) {
      setConfirmArchive(false);
      setConfirmArchiveFrom(null);
      setError("This contact changed. Review the refreshed stage before archiving.");
      setStageFocusTarget(lead.stage);
      return;
    }
    const ok = await run(() => updateLeadStage(lead.id, to, { expectedStage }));
    if (!ok) return;
    setConfirmArchive(false);
    setConfirmArchiveFrom(null);
    setStageFocusTarget(to);
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
    setFollowUpDay("");
    setPanel(null);
    setNotice(`Follow-up ${rescheduling ? "changed to" : "set for"} ${formatFollowUpDay(day)}.`);
  }

  async function completeCurrentFollowUp() {
    if (!lead) return;
    const ok = await run(() => changeFollowUp(lead.id, { action: "complete" }));
    if (ok) {
      setPanel(null);
      setNotice("Follow-up marked complete.");
    }
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
    const ok = await run(() => logTouch(lead.id, { kind: touchKind, summary: text, nextFollowUpDay: day, completeFollowUp: completing }));
    if (!ok) return;
    setSummary("");
    setNextDay("");
    setComplete(false);
    setPanel(null);
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

  const heading = "text-sm font-semibold";
  const shownOwner = ownerName ?? (sample ? undefined : "Unnamed agent");
  const stageChoices = lead?.stage === "archived" ? [lead.stage] : LEAD_STAGES.filter(stage =>
    lead && (stage === lead.stage || allowedStageTransitions(lead.stage).includes(stage)));
  const linkedDeals = linked.data ?? [];
  const engaged = lead?.stage === "representation" || lead?.stage === "active_client";

  const actionButton = (id: Exclude<Panel, null>, label: string) => {
    const ActionIcon = ACTION_ICONS[id];
    return (
    <Button
      key={id}
      type="button"
      size="sm"
      variant={panel === id ? "secondary" : "outline"}
      aria-expanded={panel === id}
      aria-controls={`lead-panel-${id}`}
      disabled={saving}
      onClick={() => togglePanel(id)}
      className="justify-start"
    >
      <ActionIcon aria-hidden />
      {label}
    </Button>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {lead ? (
          <>
            <SheetHeader className="max-h-[42dvh] shrink-0 overflow-y-auto border-b border-border px-5 pb-5 pt-6 pr-14 sm:px-6 sm:pr-16">
              <div className="mb-3 flex items-center gap-3">
                <Avatar aria-hidden className="h-11 w-11 rounded-panel border border-border shadow-card">
                  <AvatarFallback className="rounded-panel bg-tint text-sm font-semibold text-foreground">{initials(lead.name)}</AvatarFallback>
                </Avatar>
                <p className="text-micro">Contact file</p>
              </div>
              <SheetTitle className="break-words text-2xl font-semibold leading-tight tracking-tight">{lead.name}</SheetTitle>
              {/* Only what exists: a contact with no email or phone has no subtitle, not a lone separator. */}
              {[lead.email, lead.phone].filter(Boolean).length > 0 ? (
                <SheetDescription className="break-words pt-0.5 text-[13px] [overflow-wrap:anywhere]">{[lead.email, lead.phone].filter(Boolean).join(" · ")}</SheetDescription>
              ) : (
                <SheetDescription className="sr-only">Contact details</SheetDescription>
              )}
            <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
              <Badge variant="secondary" data-testid="lead-stage-badge">
                {LEAD_STAGE_LABELS[lead.stage]}
              </Badge>
              <Badge variant="outline">{LEAD_SOURCE_LABELS[lead.source]}</Badge>
              {isFollowUpDue(followUp) && (
                <StatusPill tone="warn">{followUp.state === "overdue" ? "Follow-up overdue" : "Follow-up due today"}</StatusPill>
              )}
              {quiet && <StatusPill tone="neutral">{NO_TOUCH_LABEL}</StatusPill>}
            </div>
            {/* An admin looking at a colleague's contact is told whose it is. Read-only: never a control. */}
            {lead.ownedByViewer === false && shownOwner && (
              <p className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground" data-testid="lead-owner">
                Owner:
                {shownOwner !== "Unnamed agent" && (
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[9px]">{initials(shownOwner)}</AvatarFallback>
                  </Avatar>
                )}
                <span className={cn("min-w-0 break-words font-medium", shownOwner === "Unnamed agent" ? "text-muted-foreground" : "text-foreground")}>{shownOwner}</span>
              </p>
            )}
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
            {sample && (
              <SampleDataNotice subject="This contact is generated for development and is not a real person." />
            )}
            {loadError && !loading && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-tint p-3 text-sm">
                <p>The latest contact details could not be refreshed.</p>
                <Button type="button" size="sm" variant="outline" onClick={refetch}>Try again</Button>
              </div>
            )}
            {!abilities.canWrite && (
              <p role="note" className="rounded-panel border border-border bg-tint px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
                You have read-only access to this contact.
              </p>
            )}

              {/* --- Quick actions -------------------------------------------- */}
              {abilities.canWrite && (
                <div role="group" aria-label="Contact actions">
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {actionButton("touch", "Log touch")}
                    {actionButton("followUp", "Follow-up")}
                    {actionButton("stage", "Change stage")}
                    {actionButton("edit", "Edit contact")}
                  </div>

                  {panel === "touch" && (
                    <form id="lead-panel-touch" aria-labelledby="log-touch-heading" onSubmit={submitTouch} className="mt-3 space-y-4 rounded-panel border border-border bg-tint p-4">
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
                          autoFocus
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="lead-next-follow-up-day">{hasFollowUp ? "Also change the follow-up (optional)" : "Also set a follow-up (optional)"}</Label>
                        <Input id="lead-next-follow-up-day" type="date" min={businessToday()} value={nextDay} onChange={(e) => setNextDay(e.target.value)} disabled={saving} className="w-full sm:w-48" />
                      </div>
                      {hasFollowUp && (
                        <div className="flex items-center gap-2">
                          <Checkbox id="lead-complete-follow-up" checked={complete && !nextDay} onCheckedChange={(v) => setComplete(v === true)} disabled={saving || Boolean(nextDay)} />
                          <Label htmlFor="lead-complete-follow-up" className="font-normal">
                            Mark current follow-up complete
                          </Label>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {hasFollowUp ? "This touch updates last contact. Leave both empty to keep the current follow-up." : "This touch updates last contact. Add a date to be reminded."}
                      </p>
                      <Button type="submit" disabled={saving || !summary.trim()}>
                        Log touch
                      </Button>
                    </form>
                  )}

                  {panel === "followUp" && (
                    <div id="lead-panel-followUp" className="mt-3 rounded-panel border border-border bg-tint p-4">
                      <h3 id="follow-up-heading" className={heading}>
                        Next follow-up
                      </h3>
                      <p className="tabular mt-1.5 text-sm">{followUpLabel(followUp, { withDate: true })}</p>
                      <form onSubmit={saveFollowUp} className="mt-3 flex flex-wrap items-end gap-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="lead-follow-up-day">{hasFollowUp ? "New date" : "Date"}</Label>
                          <Input id="lead-follow-up-day" type="date" min={businessToday()} value={followUpDay} onChange={(e) => setFollowUpDay(e.target.value)} disabled={saving} className="w-44" autoFocus />
                        </div>
                        <Button type="submit" size="sm" disabled={saving || !followUpDay}>
                          Save follow-up
                        </Button>
                        {hasFollowUp && (
                          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void completeCurrentFollowUp()}>
                            Mark complete
                          </Button>
                        )}
                      </form>
                      <p className="mt-3 text-xs text-muted-foreground">A reminder only. It does not count as a touch.</p>
                    </div>
                  )}

                  {panel === "stage" && (
                    <div id="lead-panel-stage" className="mt-3 rounded-panel border border-border bg-tint p-4">
                      <p className={heading}>Stage</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select value={lead.stage} onValueChange={(v) => changeStage(v as LeadStage)} disabled={saving || lead.stage === "archived"}>
                          <SelectTrigger id="lead-stage-select" aria-label="Contact stage" className="w-full sm:w-56">
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
                        {lead.stage === "archived" ? (
                          <Button id="lead-stage-restore" type="button" size="sm" variant="outline" disabled={saving} onClick={() => void archive("lead")}>
                            Restore to Lead
                          </Button>
                        ) : canTransition(lead.stage, "archived") && (confirmArchive ? (
                          <span role="group" aria-label="Confirm archive" className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] text-muted-foreground">Archive this contact?</span>
                            <Button type="button" size="sm" disabled={saving} onClick={() => void archive("archived")}>
                              Archive
                            </Button>
                            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setConfirmArchive(false); setConfirmArchiveFrom(null); }}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setConfirmArchiveFrom(lead.stage); setConfirmArchive(true); }}>
                            Archive
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {panel === "edit" && (
                    <div id="lead-panel-edit" className="mt-3">
                      <LeadEditForm lead={lead} saving={saving} onSave={saveEdit} onCancel={() => setPanel(null)} onReload={async () => {
                        const fresh = await getLead(lead.id);
                        refetch();
                        return fresh;
                      }} />
                    </div>
                  )}
                </div>
              )}

              {/* --- Details -------------------------------------------------- */}
              <section aria-labelledby="lead-details-heading">
                <SectionHeading id="lead-details-heading" icon={UserRound}>Details</SectionHeading>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5 rounded-panel border border-border bg-tint p-4">
                  <Fact label="Company" value={lead.editable?.company || "—"} />
                  <Fact label="Last touch" numeric value={lead.lastTouchDate || sample ? formatRelative(lead.lastContactDate) : "Never"} />
                  <div>
                    <p className="text-[11px] leading-4 text-muted-foreground">Next follow-up</p>
                    <p
                      data-testid="lead-next-follow-up"
                      className={cn("mt-1.5 break-words text-sm font-semibold leading-snug tabular", followUp.state === "none" && "font-normal text-muted-foreground", isFollowUpDue(followUp) && "text-status-warn")}
                    >
                      {followUpLabel(followUp, { withDate: true })}
                    </p>
                  </div>
                  <Fact label="Created" numeric value={formatDate(lead.createdDate)} />
                  <div className="col-span-2 border-t border-border pt-4">
                    {sample ? (
                      <Fact label="Birthday" value={<span className="font-normal text-muted-foreground">Not available with sample data</span>} />
                    ) : (
                      <LeadBirthday key={lead.id} value={lead.birthday} revision={lead.updatedAt} canWrite={abilities.canWrite} saving={saving} onSave={saveBirthday} />
                    )}
                  </div>
                </div>
                <div className="mt-4 rounded-panel border border-border p-4">
                  <ClientInfo lead={lead} canWrite={abilities.canWrite && !sample} saving={saving} onSave={saveClientInfo} onReload={async () => {
                    const fresh = await getLead(lead.id);
                    refetch();
                    return fresh;
                  }} />
                </div>
              </section>

              {/* --- Client needs --------------------------------------------- */}
              <LeadNeeds key={`needs-${lead.id}`} leadId={lead.id} canWrite={abilities.canWrite} available={!sample} refreshKey={refreshKey} />

              {/* --- Notes ----------------------------------------------------- */}
              <LeadNotes key={`notes-${lead.id}`} leadId={lead.id} legacyNote={lead.notes} canWrite={abilities.canWrite} available={!sample} refreshKey={refreshKey} />

              {/* --- Activity --------------------------------------------------- */}
              <LeadTimeline key={`timeline-${lead.id}`} leadId={lead.id} refreshKey={refreshKey} />

              {/* --- Representation -------------------------------------------- */}
              {engaged && (
                <section aria-labelledby="lead-representation-heading" data-testid="lead-representation">
                  <SectionHeading id="lead-representation-heading" icon={ShieldCheck}>Representation</SectionHeading>
                  <div className="mt-3 rounded-panel border border-border p-4">
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    Engagement documents are not stored in FortMark yet. Confirm an active brokerage engagement is in place before you open a deal.
                  </p>
                  {lead.stage === "representation" && abilities.canWrite && !sample && (
                    <Button type="button" size="sm" className="mt-3" onClick={() => setQuickCreate("transaction", { id: lead.id, name: lead.name })}>
                      Create transaction
                    </Button>
                  )}
                  </div>
                </section>
              )}

              {/* --- Transactions ----------------------------------------------- */}
              {linkedDeals.length > 0 && (
                <section aria-labelledby="lead-transactions-heading" data-testid="lead-transactions">
                  <SectionHeading id="lead-transactions-heading" icon={Workflow} detail={`${linkedDeals.length} linked`}>Transactions</SectionHeading>
                  <ul className="mt-3 overflow-hidden rounded-panel border border-border divide-y divide-border">
                    {linkedDeals.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/transactions?open=${encodeURIComponent(t.id)}`}
                          className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <span className="min-w-0 break-words font-medium">
                            {t.address}
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t.city}</span>
                            <span className="mt-2 inline-block text-xs text-muted-foreground">{TRANSACTION_STAGE_LABELS[t.stage as TransactionStage] ?? t.stage}</span>
                          </span>
                          <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {linked.error && (
                <div role="alert" className="rounded-panel border border-border bg-tint p-4 text-sm">
                  <p>Linked transactions could not be loaded.</p>
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={linked.refetch}>Try again</Button>
                </div>
              )}
            </div>
            {abilities.canWrite && (
              <div className="shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6">
                {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
                {notice && <p role="status" className="mb-3 text-sm text-muted-foreground">{notice}</p>}
                <Button variant="outline" className="min-h-11 w-full" onClick={() => void run(() => markContacted(lead.id))} disabled={saving}>
                  <UserCheck aria-hidden />
                  Mark contacted today
                </Button>
                <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">Sets last contact to now. The follow-up is kept.</p>
              </div>
            )}
            <EngagementNotice target={pendingStage} busy={saving} onCancel={() => setPendingStage(null)} onContinue={() => void confirmEngagement()} returnFocusTo="lead-stage-select" />
          </>
        ) : loading && leadId ? (
          <DrawerSkeleton />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Contact</SheetTitle>
              <SheetDescription className="sr-only">Contact details</SheetDescription>
            </SheetHeader>
            {/* Only a real 404 means the contact is gone (or not yours). A failed load is said to be a failed load. */}
            {loadError && leadId ? (
              <div role="alert" className="grid gap-3 overflow-y-auto px-5 py-12 text-sm text-muted-foreground sm:px-6">
                <IconWell icon={UserRound} className="mb-1 h-10 w-10 rounded-panel" />
                <p>We could not load this contact. Check your connection and try again.</p>
                <div>
                  <Button variant="outline" onClick={refetch}>Try again</Button>
                </div>
              </div>
            ) : (
              <p className="overflow-y-auto px-5 py-12 text-sm text-muted-foreground sm:px-6">This contact is no longer available.</p>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
