"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CalendarClock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import {
  NEXT_ACTION_KINDS, NEXT_ACTION_KIND_LABELS, businessLocalToUtc, checkNextActionDueAt, formatNextActionDueAt,
  nextActionDraftSchema, nextActionLocalParts, nextActionMutationSchema, nextActionStatus,
  type NextAction, type NextActionDraft, type NextActionKind, type NextActionMutation,
} from "@/lib/contacts/next-action";
import { followUpStatus, formatFollowUpDay } from "@/lib/contacts/follow-up";
import { OPEN_PIPELINE_STAGES } from "@/lib/contacts/stages";

export interface NextActionContact {
  id: string; updatedAt?: string; stage: string; assignedAgentId?: string; nextAction?: NextAction | null; nextFollowUpDate?: string | null;
}
export interface NextActionAssignee { id: string; name: string }
export interface NextActionOpening { contactId: string; expectedUpdatedAt?: string; action: NextAction | null }
export interface NextActionFormValues { kind: NextActionKind; purpose: string; day: string; time: string; assigneeId: string }
export type NextActionEditorMode = "set" | "complete" | "cancel";
interface NextActionViewProps {
  lead: NextActionContact;
  canWrite: boolean;
  available?: boolean;
  saving?: boolean;
  onSave: (input: NextActionMutation) => Promise<boolean>;
  onReload?: () => Promise<NextActionContact | undefined>;
  loadAssignees: () => Promise<NextActionAssignee[]>;
}

/** The action identity and contact revision are copied when an editor opens. */
export function nextActionOpening(lead: NextActionContact): NextActionOpening {
  return { contactId: lead.id, expectedUpdatedAt: lead.updatedAt, action: lead.nextAction ? { ...lead.nextAction } : null };
}
function actionIdentity(action: NextAction | null): string {
  return action ? JSON.stringify({ id: action.id, kind: action.kind, purpose: action.purpose, dueAt: action.dueAt, assigneeId: action.assigneeId }) : "none";
}
export function nextActionOpeningChanged(opening: NextActionOpening, latest: NextActionOpening): boolean {
  if (opening.contactId !== latest.contactId) return true;
  if (opening.expectedUpdatedAt && latest.expectedUpdatedAt && Date.parse(latest.expectedUpdatedAt) < Date.parse(opening.expectedUpdatedAt)) return false;
  return opening.expectedUpdatedAt !== latest.expectedUpdatedAt || actionIdentity(opening.action) !== actionIdentity(latest.action);
}
export function nextActionSameSource(opening: NextActionOpening, latest: NextActionOpening): boolean {
  return opening.contactId === latest.contactId && (opening.action?.id ?? null) === (latest.action?.id ?? null);
}
export function nextActionSaveRefusal(error: unknown): "assignee" | "conflict" | "other" {
  if (!error || typeof error !== "object" || !("status" in error)) return "other";
  if (error.status === 400 && "code" in error && error.code === "invalid_assignee") return "assignee";
  return error.status === 409 ? "conflict" : "other";
}
/** Roster refresh never substitutes a previously selected or rejected person. */
export function nextActionRosterDraft(draft: NextActionFormValues, people: readonly NextActionAssignee[], ownerId?: string, requiresChoice = false): NextActionFormValues {
  if (draft.assigneeId || requiresChoice) return draft;
  const initial = people.find((person) => person.id === ownerId) ?? (people.length === 1 ? people[0] : undefined);
  return initial ? { ...draft, assigneeId: initial.id } : draft;
}
export function nextActionAssigneeSelection(draft: NextActionFormValues, people: readonly NextActionAssignee[], requiresChoice: boolean): string {
  return !requiresChoice && people.some((person) => person.id === draft.assigneeId) ? draft.assigneeId : "";
}
export function nextActionFormValues(action: NextAction | null, reminder?: string | null, now = new Date()): NextActionFormValues {
  if (action) return { kind: action.kind, purpose: action.purpose, ...nextActionLocalParts(action.dueAt), assigneeId: action.assigneeId };
  return { kind: "call", purpose: "", day: followUpStatus(reminder, now).day ?? nextActionLocalParts(now.toISOString()).day, time: "", assigneeId: "" };
}
/** After explicit review, preserve changed fields and accept newer untouched ones. */
export function reviewedNextActionValues(opening: NextActionOpening, latest: NextActionOpening, draft: NextActionFormValues): NextActionFormValues | null {
  if (!nextActionSameSource(opening, latest)) return null;
  if (!opening.action || !latest.action) return { ...draft };
  const before = nextActionFormValues(opening.action);
  const saved = nextActionFormValues(latest.action);
  const unchangedTime = draft.day === before.day && draft.time === before.time;
  return {
    kind: draft.kind === before.kind ? saved.kind : draft.kind,
    purpose: draft.purpose.trim() === before.purpose.trim() ? saved.purpose : draft.purpose,
    assigneeId: draft.assigneeId === before.assigneeId ? saved.assigneeId : draft.assigneeId,
    day: unchangedTime ? saved.day : draft.day,
    time: unchangedTime ? saved.time : draft.time,
  };
}
type FormFailure = { ok: false; field: string; message: string };
function actionDraft(values: NextActionFormValues, current: NextAction | null, now: Date): { ok: true; next: NextActionDraft; ambiguous: boolean } | FormFailure {
  if (!values.purpose.trim()) return { ok: false, field: "purpose", message: "Add the purpose of this action." };
  if (values.purpose.trim().length > 240 || values.purpose.includes("\0")) return { ok: false, field: "purpose", message: "Use up to 240 characters without unsupported characters." };
  if (!values.day) return { ok: false, field: "day", message: "Choose the due date in Eastern time." };
  if (!values.time) return { ok: false, field: "time", message: "Choose the due time in Eastern time." };
  const converted = businessLocalToUtc(values.day, values.time);
  if (!converted.ok) return { ok: false, field: "time", message: converted.reason === "nonexistent_time" ? "This Eastern time does not exist because the clocks move forward. Choose another time." : "Choose a valid date and time." };
  if (!values.assigneeId) return { ok: false, field: "assigneeId", message: "Choose who will handle this action." };
  // Do not discard seconds or move an existing later DST-fold occurrence when
  // a person changes only the purpose, type or assignee in minute-based inputs.
  const oldLocal = current ? nextActionLocalParts(current.dueAt) : null;
  const dueAt = current && oldLocal?.day === values.day && oldLocal.time === values.time ? current.dueAt : converted.dueAt;
  const allowedDue = checkNextActionDueAt(dueAt, now, current?.dueAt);
  if (!allowedDue.ok) return { ok: false, field: allowedDue.reason === "too_far_ahead" ? "day" : "time", message: allowedDue.reason === "in_the_past" ? "Choose a future due date and time in Eastern time." : allowedDue.reason === "too_far_ahead" ? "Choose a due date within the next two years." : "Choose a valid due date and time." };
  const parsed = nextActionDraftSchema.safeParse({ kind: values.kind, purpose: values.purpose, dueAt, assigneeId: values.assigneeId });
  if (!parsed.success) return { ok: false, field: parsed.error.issues[0]?.path[0] === "assigneeId" ? "assigneeId" : "purpose", message: "Review the action type, purpose and assigned person before saving." };
  return { ok: true, next: parsed.data, ambiguous: converted.ambiguous && dueAt === converted.dueAt };
}

/** Pure submit conversion: no source or revision is read from a changing prop. */
export function nextActionEditorInput(opening: NextActionOpening, mode: NextActionEditorMode, values: NextActionFormValues, outcome: string, reason: string, scheduleNext: boolean, now = new Date()): { ok: true; input: NextActionMutation } | FormFailure {
  if (!opening.expectedUpdatedAt || !Number.isFinite(Date.parse(opening.expectedUpdatedAt))) return { ok: false, field: "review", message: "Load the saved contact version before saving. Your draft is kept." };
  if (mode !== "set" && !opening.action) return { ok: false, field: "review", message: "The original action is no longer available. Review the saved action before continuing." };
  let next: NextActionDraft | undefined;
  if (mode === "set" || (mode === "complete" && scheduleNext)) {
    const converted = actionDraft(values, mode === "set" ? opening.action : null, now);
    if (!converted.ok) return converted;
    next = converted.next;
  }
  if (mode === "complete" && (!outcome.trim() || outcome.trim().length > 1000 || outcome.includes("\0"))) return { ok: false, field: "outcome", message: "Describe the outcome in 1 to 1,000 characters." };
  if (mode === "cancel" && (!reason.trim() || reason.trim().length > 500 || reason.includes("\0"))) return { ok: false, field: "reason", message: "Add a cancellation reason in 1 to 500 characters." };
  const input = mode === "set"
    ? { action: "set" as const, expectedUpdatedAt: opening.expectedUpdatedAt, expectedActionId: opening.action?.id ?? null, next: next! }
    : mode === "complete"
      ? { action: "complete" as const, expectedUpdatedAt: opening.expectedUpdatedAt, actionId: opening.action!.id, outcome: outcome.trim(), ...(next ? { next } : {}) }
      : { action: "cancel" as const, expectedUpdatedAt: opening.expectedUpdatedAt, actionId: opening.action!.id, reason: reason.trim() };
  const parsed = nextActionMutationSchema.safeParse(input);
  return parsed.success ? { ok: true, input: parsed.data } : { ok: false, field: "review", message: "The saved action could not be confirmed. Your draft is kept. Reload the latest action." };
}

function ActionSummary({ action }: { action: NextAction | null }) {
  if (!action) return <p className="text-[13px] leading-relaxed text-muted-foreground">No next action scheduled.</p>;
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-[11px] font-semibold text-muted-foreground">{NEXT_ACTION_KIND_LABELS[action.kind]}</p>
      <p className="whitespace-pre-wrap break-words text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{action.purpose}</p>
      <p className="text-[13px] leading-relaxed tabular"><time dateTime={action.dueAt}>{formatNextActionDueAt(action.dueAt)}</time></p>
      <p className="flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words [overflow-wrap:anywhere]">{action.assigneeName || "Assigned team member"}</span></p>
    </div>
  );
}

export function NextActionView(props: NextActionViewProps) {
  return <NextActionWorkspace key={props.lead.id} {...props} />;
}

function NextActionWorkspace({ lead, canWrite, available = true, saving = false, onSave, onReload, loadAssignees }: NextActionViewProps) {
  const prefix = useId();
  const [mode, setMode] = useState<NextActionEditorMode | null>(null);
  const [opening, setOpening] = useState(() => nextActionOpening(lead));
  const [values, setValues] = useState(() => nextActionFormValues(null));
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [scheduleNext, setScheduleNext] = useState(false);
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<NextActionOpening | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [assignees, setAssignees] = useState<NextActionAssignee[]>([]);
  const [assigneeState, setAssigneeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [assigneeAttempt, setAssigneeAttempt] = useState(0);
  const [assigneeChoiceRequired, setAssigneeChoiceRequired] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const loader = useRef(loadAssignees); loader.current = loadAssignees;
  const focusWhoAfterLoad = useRef(false);
  const requireAssigneeChoice = useRef(false);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const current = nextActionOpening(lead);
  const canSchedule = (OPEN_PIPELINE_STAGES as readonly string[]).includes(lead.stage);
  const editing = mode !== null && canWrite && available;
  const needsSchedule = editing && (mode === "set" || (mode === "complete" && scheduleNext));
  const missingRevision = !opening.expectedUpdatedAt || !Number.isFinite(Date.parse(opening.expectedUpdatedAt));
  const mustReview = missingRevision || conflict || nextActionOpeningChanged(opening, current);
  const busy = saving || pending || reviewing;
  const locked = busy || review !== null;
  const state = nextActionStatus(lead.nextAction);
  const localTime = values.day && values.time ? businessLocalToUtc(values.day, values.time) : null;
  const assigneeSelection = nextActionAssigneeSelection(values, assignees, assigneeChoiceRequired);
  const assigneeError = errors.assigneeId || (assigneeState === "ready" && values.assigneeId && !assigneeSelection ? "This person is no longer available. Refresh the team list and choose another person." : "");
  const id = (field: string) => `${prefix}-${field}`;

  useEffect(() => {
    if (!needsSchedule) return;
    let active = true;
    setAssigneeState("loading");
    loader.current().then((next) => {
      if (!active) return;
      setAssignees(next); setAssigneeState("ready");
      setValues((draft) => nextActionRosterDraft(draft, next, lead.assignedAgentId, requireAssigneeChoice.current));
      if (focusWhoAfterLoad.current) { focusWhoAfterLoad.current = false; setFocusTarget(next.length ? "assigneeId" : "assignee-help"); }
    }).catch(() => { if (active) { setAssigneeState("error"); if (focusWhoAfterLoad.current) setFocusTarget("assignee-retry"); } });
    return () => { active = false; };
  }, [lead.id, lead.assignedAgentId, needsSchedule, assigneeAttempt]);
  useEffect(() => { if (review) panel.current?.focus(); }, [review]);
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "summary") summaryHeading.current?.focus();
    else document.getElementById(`${prefix}-${focusTarget}`)?.focus();
    setFocusTarget(null);
  }, [focusTarget, prefix, mode, review]);

  function open(nextMode: NextActionEditorMode) {
    const baseline = nextActionOpening(lead);
    setOpening(baseline); setValues(nextActionFormValues(nextMode === "set" ? baseline.action : null, lead.nextFollowUpDate));
    setMode(nextMode); setOutcome(""); setReason(""); setScheduleNext(false); setReview(null); setConflict(false); setErrors({}); setFailure(null); setNotice(null);
    setAssigneeChoiceRequired(false); requireAssigneeChoice.current = false; focusWhoAfterLoad.current = false;
    setFocusTarget(nextMode === "set" ? "purpose" : nextMode === "complete" ? "outcome" : "reason");
  }
  function close() { setMode(null); setReview(null); setFocusTarget("summary"); }
  function change(field: keyof NextActionFormValues, text: string) {
    setValues((draft) => ({ ...draft, [field]: text }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: "" })); setNotice(null);
    if (field === "assigneeId") { setAssigneeChoiceRequired(false); requireAssigneeChoice.current = false; }
  }
  function retryAssignees() { focusWhoAfterLoad.current = true; setAssigneeAttempt((attempt) => attempt + 1); }
  async function loadLatest() {
    if (busy) return;
    setReviewing(true); setFailure(null);
    try {
      const fresh = onReload ? await onReload() : lead;
      if (!fresh || fresh.id !== opening.contactId || !fresh.updatedAt || !Number.isFinite(Date.parse(fresh.updatedAt))) throw new Error("The latest saved action could not be loaded. Your draft is kept. Try again.");
      const next = nextActionOpening(fresh);
      if (Date.parse(fresh.updatedAt) < Date.parse(opening.expectedUpdatedAt ?? "") || (conflict && fresh.updatedAt === opening.expectedUpdatedAt)) throw new Error("The latest saved version could not be confirmed. Your draft is kept. Try loading it again.");
      setReview(next);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The latest action could not be loaded. Your draft is kept. Try again."); }
    finally { setReviewing(false); }
  }
  function keepDraft() {
    if (!review || !nextActionSameSource(opening, review)) return;
    if (mode === "set") {
      const merged = reviewedNextActionValues(opening, review, values);
      if (!merged) return;
      setValues(merged);
    }
    setOpening(review); setReview(null); setConflict(false); setErrors({}); setFailure(null);
    setNotice(mode === "set" ? "Saved action reviewed. Your changes are kept and untouched fields use the saved information. Check your draft before saving." : "Saved action reviewed. Your draft is kept. Check it before saving."); setFocusTarget(mode === "set" ? "purpose" : mode === "complete" ? "outcome" : "reason");
  }
  function startOver() {
    if (!review) return;
    setOpening(review); setValues(nextActionFormValues(review.action, lead.nextFollowUpDate));
    setMode("set"); setOutcome(""); setReason(""); setScheduleNext(false); setReview(null); setConflict(false); setErrors({}); setFailure(null); setNotice("Saved action loaded. Your earlier draft was replaced."); setFocusTarget("purpose");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || !canWrite || !available || locked || mustReview) return;
    if (needsSchedule && !canSchedule) { setFailure("New actions can only be scheduled while this contact is in the open pipeline."); return; }
    if (needsSchedule && (assigneeState !== "ready" || !assigneeSelection)) { setErrors({ assigneeId: "Choose an eligible person after the team list loads." }); setFocusTarget("assigneeId"); return; }
    const converted = nextActionEditorInput(opening, mode, values, outcome, reason, scheduleNext);
    if (!converted.ok) { setErrors({ [converted.field]: converted.message }); setFocusTarget(converted.field); return; }
    setPending(true); setFailure(null); setErrors({});
    try {
      if (await onSave(converted.input)) { close(); setNotice(converted.input.action === "complete" ? "Action completed. Contacted status is unchanged." : converted.input.action === "cancel" ? "Action cancelled." : "Next action saved."); }
      else setFailure("The action could not be saved. Your draft is kept. Review any updated saved action before trying again.");
    } catch (error) {
      const refusal = nextActionSaveRefusal(error);
      if (refusal === "assignee") {
        setErrors({ assigneeId: "This person is no longer available. Refresh the team list and choose another person." });
        setAssigneeChoiceRequired(true); requireAssigneeChoice.current = true;
        setAssigneeState("loading"); retryAssignees();
      } else if (refusal === "conflict") { setConflict(true); setFailure("The saved contact or action changed. Your draft is kept. Review the latest action before saving."); }
      else setFailure("The action could not be saved. Your draft is kept. Try again.");
    } finally { setPending(false); }
  }
  const errorFor = (field: string) => errors[field] ? <p id={id(`${field}-error`)} className="text-xs leading-relaxed text-destructive">{errors[field]}</p> : null;
  return (
    <section className="min-w-0 rounded-card border border-border bg-card p-4 shadow-card" aria-labelledby={id("title")} data-testid="next-action">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5"><IconWell icon={CalendarClock} /><h3 ref={summaryHeading} id={id("title")} tabIndex={-1} className="text-[15px] font-semibold">Next action</h3></div>
        {lead.nextAction && <StatusPill tone={state.state === "overdue" || state.state === "due_today" ? "warn" : "neutral"}>{state.state === "overdue" ? "Overdue" : state.state === "due_today" ? "Due today" : "Upcoming"}</StatusPill>}
      </div>
      <div className="mt-4"><ActionSummary action={lead.nextAction ?? null} /></div>
      {!available && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Next actions are available for stored contacts.</p>}
      {!lead.nextAction && available && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{lead.nextFollowUpDate ? `A reminder is set for ${formatFollowUpDay(followUpStatus(lead.nextFollowUpDate).day!)}. Add a purpose, time and person to make it an action.` : "Choose what happens next, when it is due, and who will handle it."}</p>}
      {!editing && canWrite && available && (
        <div className="mt-4 flex flex-wrap gap-2">
          {lead.nextAction ? <><Button type="button" size="sm" disabled={saving} onClick={() => open("complete")}>Complete action</Button>{canSchedule && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => open("set")}>Edit action</Button>}<Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => open("cancel")}>Cancel action</Button></> : canSchedule ? <Button type="button" size="sm" disabled={saving} onClick={() => open("set")}>Schedule action</Button> : <p className="text-xs leading-relaxed text-muted-foreground">New actions can be scheduled when this contact is in the open pipeline.</p>}
        </div>
      )}
      {notice && <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">{notice}</p>}
      {editing && (
        <form onSubmit={(event) => void submit(event)} noValidate className="mt-4 min-w-0 space-y-4 border-t border-border pt-4">
          <h4 className="text-sm font-semibold">{mode === "complete" ? "Complete this action" : mode === "cancel" ? "Cancel this action" : opening.action ? "Edit this action" : "Schedule an action"}</h4>
          {needsSchedule && !canSchedule && <p role="alert" className="text-xs leading-relaxed text-muted-foreground">This contact left the open pipeline. Your draft is kept, but a new action cannot be scheduled in this stage.</p>}
          {mustReview && !review && <div role="alert" className="space-y-2 rounded-panel border border-border bg-tint p-3"><p className="text-sm font-semibold">The saved contact or action changed</p><p className="text-xs leading-relaxed text-muted-foreground">Your draft is kept. Review the saved action before continuing.</p><Button id={id("review")} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void loadLatest()}>{reviewing ? "Loading saved action…" : "Review saved action"}</Button></div>}
          {review && <section ref={panel} tabIndex={-1} aria-labelledby={id("review-title")} className="min-w-0 space-y-3 rounded-panel border border-input bg-tint p-3"><h5 id={id("review-title")} className="text-sm font-semibold">Review the saved action</h5><div className="grid min-w-0 gap-4 sm:grid-cols-2"><div><p className="mb-2 text-[11px] font-semibold text-muted-foreground">When this editor opened</p><ActionSummary action={opening.action} /></div><div><p className="mb-2 text-[11px] font-semibold text-muted-foreground">Current saved action</p><ActionSummary action={review.action} /></div></div><p className="text-xs leading-relaxed text-muted-foreground">{nextActionSameSource(opening, review) ? "This is the same action. You can keep your draft after reviewing these saved details." : "The original action was replaced or removed. Your draft cannot complete or cancel a different action. Starting over replaces your unsaved fields."}</p><div className="flex flex-wrap gap-2">{nextActionSameSource(opening, review) && <Button type="button" size="sm" onClick={keepDraft}>Keep my draft</Button>}{canSchedule && <Button type="button" size="sm" variant="outline" onClick={startOver}>Start over with saved action</Button>}<Button type="button" size="sm" variant="ghost" onClick={() => { setReview(null); setFocusTarget(mode === "complete" ? "outcome" : mode === "cancel" ? "reason" : "purpose"); }}>Keep reviewing my draft</Button></div></section>}
          {failure && <p role="alert" className="text-xs leading-relaxed text-destructive">{failure}</p>}
          {errors.review && <p role="alert" className="text-xs leading-relaxed text-destructive">{errors.review}</p>}
          {mode === "complete" && <><div className="grid gap-1.5"><Label htmlFor={id("outcome")}>Outcome</Label><Textarea id={id("outcome")} rows={3} maxLength={1000} value={outcome} disabled={locked} onChange={(event) => { setOutcome(event.target.value); setErrors((currentErrors) => ({ ...currentErrors, outcome: "" })); }} aria-invalid={Boolean(errors.outcome)} aria-describedby={errors.outcome ? id("outcome-error") : id("completion-help")} /><p id={id("completion-help")} className="text-xs leading-relaxed text-muted-foreground">Record what happened. Completing a task does not mark this client as contacted.</p>{errorFor("outcome")}</div>{(canSchedule || scheduleNext) && <div className="flex min-h-10 items-center gap-2"><Checkbox id={id("schedule-next")} checked={scheduleNext} disabled={locked} onCheckedChange={(checked) => { setScheduleNext(checked === true); setErrors({}); }} /><Label htmlFor={id("schedule-next")} className="py-2 font-normal">Schedule another action in the same save</Label></div>}{!canSchedule && scheduleNext && <p className="text-xs leading-relaxed text-muted-foreground">Clear the next-action option to complete only the current task. Your outcome is kept.</p>}</>}
          {mode === "cancel" && <div className="grid gap-1.5"><Label htmlFor={id("reason")}>Cancellation reason</Label><Textarea id={id("reason")} rows={3} maxLength={500} value={reason} disabled={locked} onChange={(event) => { setReason(event.target.value); setErrors((currentErrors) => ({ ...currentErrors, reason: "" })); }} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? id("reason-error") : undefined} />{errorFor("reason")}<p className="text-xs leading-relaxed text-muted-foreground">The cancellation and reason stay in the contact&apos;s activity.</p></div>}
          {needsSchedule && <div className="min-w-0 space-y-4">
            {mode === "complete" && <h5 className="text-sm font-semibold">Following action</h5>}
            <div className="grid gap-1.5"><Label htmlFor={id("kind")}>Type</Label><Select value={values.kind} onValueChange={(value) => change("kind", value)} disabled={locked}><SelectTrigger id={id("kind")} className="h-10"><SelectValue /></SelectTrigger><SelectContent>{NEXT_ACTION_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{NEXT_ACTION_KIND_LABELS[kind]}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><div className="flex items-baseline justify-between gap-2"><Label htmlFor={id("purpose")}>Purpose</Label><span className="text-[11px] text-muted-foreground tabular">{values.purpose.length} / 240</span></div><Textarea id={id("purpose")} rows={2} maxLength={240} value={values.purpose} disabled={locked} onChange={(event) => change("purpose", event.target.value)} aria-invalid={Boolean(errors.purpose)} aria-describedby={errors.purpose ? id("purpose-error") : undefined} />{errorFor("purpose")}</div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="grid min-w-0 gap-1.5"><Label htmlFor={id("day")}>Due date</Label><Input id={id("day")} type="date" className="h-10 min-w-0" value={values.day} disabled={locked} onChange={(event) => change("day", event.target.value)} aria-invalid={Boolean(errors.day)} aria-describedby={errors.day ? id("day-error") : id("timezone")} />{errorFor("day")}</div><div className="grid min-w-0 gap-1.5"><Label htmlFor={id("time")}>Due time</Label><Input id={id("time")} type="time" step={60} className="h-10 min-w-0" value={values.time} disabled={locked} onChange={(event) => change("time", event.target.value)} aria-invalid={Boolean(errors.time)} aria-describedby={errors.time ? id("time-error") : id("timezone")} />{errorFor("time")}</div></div>
            <p id={id("timezone")} className="-mt-2 text-xs leading-relaxed text-muted-foreground">Eastern time (America/New_York).{localTime?.ok && localTime.ambiguous ? " This time occurs twice when clocks change; the earlier occurrence is used for a newly selected time." : ""}</p>
            <div className="grid min-w-0 gap-1.5"><Label htmlFor={id("assigneeId")}>Who</Label>{assigneeState === "loading" || assigneeState === "idle" ? <><Skeleton className="h-10 w-full rounded-lg" /><p role="status" className="sr-only">Loading eligible team members</p></> : assigneeState === "error" ? <div role="alert" className="rounded-panel border border-border bg-tint p-3 text-xs"><p>Eligible team members could not be loaded. Your draft is kept.</p><Button id={id("assignee-retry")} type="button" size="sm" variant="outline" className="mt-2" disabled={locked} onClick={retryAssignees}>Try again</Button></div> : <><Select value={assigneeSelection} onValueChange={(value) => change("assigneeId", value)} disabled={locked || assignees.length === 0}><SelectTrigger id={id("assigneeId")} className="h-10 min-w-0" aria-invalid={Boolean(assigneeError)} aria-describedby={assigneeError ? id("assigneeId-error") : id("assignee-help")}><SelectValue placeholder="Choose a person" /></SelectTrigger><SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select>{assignees.length === 0 && <p className="text-xs leading-relaxed text-muted-foreground">No eligible team members are available. The contact owner or an administrator must have an active account.</p>}<Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={locked} onClick={retryAssignees}>Refresh eligible people</Button></>}{assigneeError && <p id={id("assigneeId-error")} role="alert" className="text-xs leading-relaxed text-destructive">{assigneeError}</p>}<p id={id("assignee-help")} tabIndex={-1} className="text-xs leading-relaxed text-muted-foreground">Only eligible team members who can already access this contact are listed.</p></div>
            <p className="text-xs leading-relaxed text-muted-foreground">Scheduling an action does not send a call, email or message.</p>
          </div>}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Button type="submit" size="sm" disabled={locked || mustReview || (needsSchedule && (!canSchedule || assigneeState !== "ready" || !assigneeSelection))}>{pending ? "Saving…" : mode === "complete" ? scheduleNext ? "Complete and schedule next" : "Complete action" : mode === "cancel" ? "Cancel action" : "Save action"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>{opening.action ? "Keep current action" : "Cancel"}</Button></div>
        </form>
      )}
    </section>
  );
}
