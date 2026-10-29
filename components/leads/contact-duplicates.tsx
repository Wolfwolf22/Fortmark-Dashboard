"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, CopyCheck, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconWell } from "@/components/ui/icon-well";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBirthday } from "@/lib/contacts/birthday";
import { followUpStatus, formatFollowUpDay } from "@/lib/contacts/follow-up";
import { requiresEngagementNotice } from "@/lib/contacts/stages";
import { formatNextActionDueAt, NEXT_ACTION_KIND_LABELS } from "@/lib/contacts/next-action";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, type LeadSource, type LeadStage } from "@/lib/data/types";
import type { DuplicateSuggestionsPage } from "@/lib/contacts/duplicates";
import type { ContactMergeInput, ContactMergeResult, MergeField, MergeReview, MergeValues } from "@/lib/contacts/merge";
import { contactReviewRequest } from "./contact-import";

type Winner = "primary" | "duplicate";
type Choices = Partial<Record<MergeField, Winner>>;
type PendingChoice = "primary" | "duplicate" | "none";
const FIELDS: MergeField[] = ["name", "email", "phone", "company", "source", "stage", "birthday", "about", "personalDetails", "legacyNotes"];
const LABELS: Record<MergeField, string> = { name: "Name", email: "Email", phone: "Phone", company: "Company", source: "Source", stage: "Stage", birthday: "Birthday", about: "About", personalDetails: "Named details", legacyNotes: "Legacy note" };
const COUNT_LABELS = { notes: "Notes", needs: "Client needs", activities: "Activity records", opportunities: "Legacy opportunities", transactions: "Linked transactions" } as const;
interface ContactDuplicatesProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  onList: (cursor?: string) => Promise<DuplicateSuggestionsPage>;
  onReview: (primaryId: string, duplicateId: string) => Promise<MergeReview>;
  onMerge: (input: ContactMergeInput) => Promise<ContactMergeResult>;
  onDone?: () => void;
  onOpenContact?: (id: string) => void;
}
export function mergeFieldText(field: MergeField, values: MergeValues): string {
  if (field === "name") return [values.name.firstName ? `First: ${values.name.firstName}` : "", values.name.lastName ? `Last: ${values.name.lastName}` : "", values.name.preferredName ? `Preferred: ${values.name.preferredName}` : ""].filter(Boolean).join("\n") || "Not set";
  if (field === "birthday") return formatBirthday(values.birthday) ?? "Not set";
  if (field === "personalDetails") return values.personalDetails.map((row) => `${row.label}: ${row.value}`).join("\n") || "Not set";
  if (field === "source") return LEAD_SOURCE_LABELS[values.source as LeadSource] || values.source || "Not set";
  if (field === "stage") return LEAD_STAGE_LABELS[values.stage as LeadStage] || values.stage || "Not set";
  return String(values[field] ?? "").trim() || "Not set";
}
/** Nonconflicting defaults fill blanks; every conflicting field waits for a choice. */
export function initialMergeChoices(review: MergeReview): Choices {
  return Object.fromEntries(FIELDS.filter((field) => !review.conflicts.includes(field)).map((field) => [field, review.defaults[field]]));
}
export function refreshMergeChoices(review: MergeReview, previous: Choices, explicit: Partial<Record<MergeField, boolean>>): Choices {
  return Object.fromEntries(FIELDS.filter((field) => explicit[field] || !review.conflicts.includes(field)).map((field) => [field, explicit[field] ? previous[field] : review.defaults[field]]));
}
export function initialPendingChoice(review: MergeReview): PendingChoice | null {
  const primary = Boolean(review.primary.nextAction || review.primary.nextFollowUpDate), duplicate = Boolean(review.duplicate.nextAction || review.duplicate.nextFollowUpDate);
  return primary && duplicate ? null : primary ? "primary" : duplicate ? "duplicate" : "none";
}
export function mergeReviewReady(review: MergeReview, choices: Choices, pending: PendingChoice | null): boolean {
  return FIELDS.every((field) => choices[field] === "primary" || choices[field] === "duplicate") && (pending === "none" || pending !== null && Boolean(review[pending].nextAction || review[pending].nextFollowUpDate));
}
export function mergeNeedsEngagement(review: MergeReview, choices: Choices): boolean {
  return Boolean(choices.stage && requiresEngagementNotice(review.primary.values.stage, review[choices.stage].values.stage));
}
export function DuplicateSuggestionsEmpty({ hasMore }: { hasMore: boolean }) {
  return <div className="rounded-panel border border-dashed border-input p-5"><IconWell icon={CopyCheck} /><h3 className="mt-3 text-sm font-semibold">{hasMore ? "No duplicate suggestions found yet" : "No duplicate suggestions found"}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hasMore ? "Continue checking. More contacts remain in this owner’s book." : "You can review again after adding or correcting contacts."}</p></div>;
}
export function mergeFooterBackState(hasResult: boolean, final: boolean, hasReview: boolean): { action: "close" | "choices" | "suggestions"; label: string } {
  if (hasResult) return { action: "close", label: "Close" };
  if (final) return { action: "choices", label: "Back to choices" };
  return hasReview ? { action: "suggestions", label: "Back to suggestions" } : { action: "close", label: "Close" };
}
export function MergeContactCard({ contact, side }: { contact: MergeReview["primary"]; side: Winner }) {
  return <div className="min-w-0 rounded-panel border border-border p-3"><p className="text-micro">{side === "primary" ? "Primary contact" : "Duplicate contact"}</p><h3 className="mt-2 break-words text-base font-semibold [overflow-wrap:anywhere]">{contact.name}</h3><div className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">{contact.values.email && <p className="break-words [overflow-wrap:anywhere]">Email: {contact.values.email}</p>}{contact.values.phone && <p className="break-words [overflow-wrap:anywhere]">Phone: {contact.values.phone}</p>}{contact.values.company && <p className="break-words [overflow-wrap:anywhere]">Company: {contact.values.company}</p>}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{side === "primary" ? "This record remains the contact you work from." : "This record is archived and points to the primary after merge."}</p></div>;
}
export function DuplicateSuggestionCounts({ loaded, scanned, total, hasMore }: { loaded: number; scanned: number; total: number; hasMore: boolean }) {
  return <p role="status" className="text-xs text-muted-foreground tabular">{loaded} {loaded === 1 ? "suggestion" : "suggestions"} loaded · {scanned} of {total} {total === 1 ? "contact" : "contacts"} examined{hasMore ? " · more contacts remain" : ""}</p>;
}
export function PreservedCounts({ review }: { review: Pick<MergeReview, "preservedCounts"> }) {
  return <div className="rounded-panel border border-border bg-tint p-3"><p className="text-xs font-semibold">Records retained from both contacts</p><dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{(Object.keys(COUNT_LABELS) as (keyof typeof COUNT_LABELS)[]).map((field) => <div key={field}><dt className="text-[11px] text-muted-foreground">{COUNT_LABELS[field]}</dt><dd className="mt-1 text-sm font-semibold tabular">{review.preservedCounts[field]}</dd></div>)}</dl></div>;
}
export function MergeSelectedValues({ review, choices }: { review: MergeReview; choices: Record<MergeField, Winner> }) {
  return <dl className="space-y-3">{FIELDS.map((field) => <div key={field} className="min-w-0 border-b border-border pb-3"><dt className="text-xs font-semibold text-muted-foreground">{LABELS[field]}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{mergeFieldText(field, review[choices[field]].values)}</dd></div>)}</dl>;
}

export function ContactDuplicates(props: ContactDuplicatesProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <DuplicateWorkspace {...props} />}</Dialog>;
}
function DuplicateWorkspace({ onList, onReview, onMerge, onOpenChange, onDone, onOpenContact }: ContactDuplicatesProps) {
  const prefix = useId();
  const [page, setPage] = useState<DuplicateSuggestionsPage | null>(null);
  const [pairs, setPairs] = useState<DuplicateSuggestionsPage["pairs"]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<MergeReview | null>(null);
  const [fresh, setFresh] = useState<MergeReview | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [explicit, setExplicit] = useState<Partial<Record<MergeField, boolean>>>({});
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [pendingExplicit, setPendingExplicit] = useState(false);
  const [stale, setStale] = useState(false);
  const [final, setFinal] = useState(false);
  const [engagement, setEngagement] = useState(false);
  const [result, setResult] = useState<ContactMergeResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [moreChecked, setMoreChecked] = useState(false);
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const loader = useRef(onList); loader.current = onList;
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const focusRefresh = useRef(false);
  const active = fresh ?? review;
  const back = mergeFooterBackState(Boolean(result), final, Boolean(review));
  const ready = Boolean(active && mergeReviewReady(active, choices, pending));
  const needsEngagement = Boolean(active && mergeNeedsEngagement(active, choices));
  const focusHeading = () => setTimeout(() => { if (body.current) body.current.scrollTop = 0; heading.current?.focus(); }, 0);
  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    loader.current().then((next) => { if (alive) { setPage(next); setPairs(next.pairs); } }).catch(() => { if (alive) setError("Duplicate suggestions could not be loaded. Try again."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => { if (!loading && focusRefresh.current) { focusRefresh.current = false; refreshButton.current?.focus(); } }, [loading]);
  function refreshSuggestions() { focusRefresh.current = true; setMoreChecked(false); setAttempt((current) => current + 1); }
  function goBack() {
    if (back.action === "close") { onOpenChange(false); return; }
    if (back.action === "choices") { setFinal(false); setEngagement(false); focusHeading(); return; }
    setReview(null); setFresh(null); setError(null); focusHeading();
  }
  async function loadMore() {
    if (!page?.hasMore || !page.nextCursor || busy) return;
    setBusy(true); setError(null); setMoreChecked(true);
    try {
      const next = await onList(page.nextCursor);
      setPairs((current) => [...current, ...next.pairs.filter((pair) => !current.some((old) => old.primary.id === pair.primary.id && old.duplicate.id === pair.duplicate.id))]); setPage(next);
    } catch { setError("More suggestions could not be loaded. Your loaded suggestions are kept. Try again."); }
    finally { setBusy(false); }
  }
  async function begin(primaryId: string, duplicateId: string) {
    setBusy(true); setError(null);
    try { const next = await onReview(primaryId, duplicateId); setReview(next); setFresh(null); setChoices(initialMergeChoices(next)); setExplicit({}); setPending(initialPendingChoice(next)); setPendingExplicit(false); setStale(false); setFinal(false); setEngagement(false); focusHeading(); }
    catch { setError("These contacts could not be reviewed together. Refresh suggestions and try again. Only contacts in the same owner’s book can be merged."); focusHeading(); }
    finally { setBusy(false); }
  }
  async function reload() {
    if (!review || busy) return;
    setBusy(true); setError(null);
    try {
      const next = await onReview(review.primary.id, review.duplicate.id);
      setFresh(next); setChoices(refreshMergeChoices(next, choices, explicit));
      if (!pendingExplicit || pending !== "none" && pending !== null && !(next[pending].nextAction || next[pending].nextFollowUpDate)) setPending(initialPendingChoice(next));
      setFinal(false); setEngagement(false); focusHeading();
    } catch { setError("The latest contact versions could not be loaded. Your merge choices are kept. Try again."); focusHeading(); }
    finally { setBusy(false); }
  }
  function acceptFresh() { if (!fresh) return; setReview(fresh); setFresh(null); setStale(false); setFinal(false); setEngagement(false); focusHeading(); }
  async function merge() {
    if (!review || !ready || stale || fresh || busy || (needsEngagement && !engagement)) return;
    const body = { primaryId: review.primary.id, duplicateId: review.duplicate.id, expectedPrimaryUpdatedAt: review.primary.updatedAt, expectedDuplicateUpdatedAt: review.duplicate.updatedAt,
      expectedPrimaryHistoryFingerprint: review.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: review.duplicate.historyFingerprint,
      choices: choices as Record<MergeField, Winner>, nextActionChoice: pending!, ...(needsEngagement ? { engagementAcknowledged: true as const } : {}) };
    retry.current = contactReviewRequest(retry.current, body);
    setBusy(true); setError(null);
    try { setResult(await onMerge({ ...body, requestId: retry.current.requestId })); onDone?.(); focusHeading(); }
    catch (failure) {
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 409) { setStale(true); setFinal(false); setError("A contact or its history changed. Your choices are kept. Load and review the latest versions before merging."); }
      else setError("The merge did not return a result. Your review is kept. Retrying uses the same request to avoid merging twice.");
      focusHeading();
    } finally { setBusy(false); }
  }
  return (
    <DialogContent hideClose={busy} className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={(event) => busy && event.preventDefault()} onPointerDownOutside={(event) => (busy || review !== null) && event.preventDefault()}>
      <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 sm:p-5 sm:pr-14"><div className="flex items-center gap-2.5"><IconWell icon={result ? Check : GitMerge} /><DialogTitle ref={heading} tabIndex={-1}>{result ? "Contacts merged" : "Review duplicates"}</DialogTitle></div><DialogDescription className="text-xs leading-relaxed">{result ? "The primary contact retains the reviewed information and linked records." : active ? "Choose the primary record and review which information to retain. Nothing is merged yet." : "Email, phone and name matches are suggestions for a person to review."}</DialogDescription></DialogHeader>
      <div ref={body} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
        {!active && !result && <Button ref={refreshButton} type="button" size="sm" variant="outline" disabled={busy || loading} onClick={refreshSuggestions}>Refresh suggestions</Button>}
        {error && <p role="alert" className="rounded-panel border border-border bg-tint p-3 text-sm leading-relaxed">{error}</p>}
        {result ? <><p className="break-words text-lg font-semibold">{result.primary.name}</p><PreservedCounts review={result} /><p className="text-xs leading-relaxed text-muted-foreground">The duplicate remains as an archived record linked to the primary contact. Existing links open the primary record.</p></> : active ? <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(["primary", "duplicate"] as const).map((side) => <MergeContactCard key={side} side={side} contact={active[side]} />)}</div>
          {!final && !fresh && !stale && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void begin(active.duplicate.id, active.primary.id)}>Swap primary and review again</Button>}
          <PreservedCounts review={active} />
          {stale && !fresh && <div role="alert" className="space-y-2 rounded-panel border border-input p-3"><p className="text-sm font-semibold">Fresh review required</p><p className="text-xs leading-relaxed text-muted-foreground">Your choices and both records are kept. They are not applied to newer versions automatically.</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>{busy ? "Loading current versions…" : "Load current versions"}</Button></div>}
          {fresh && <div role="status" className="space-y-2 rounded-panel border border-input p-3"><p className="text-sm font-semibold">Current versions are shown below</p><p className="text-xs leading-relaxed text-muted-foreground">Review changed fields, pending actions and retained-record counts. Earlier explicit choices are kept; new conflicts need a choice.</p><Button type="button" size="sm" disabled={!ready || busy} onClick={acceptFresh}>Use these current versions</Button></div>}
          {final ? <><div className="rounded-panel border border-input p-4"><h3 className="text-sm font-semibold">Final merge review</h3><p className="mt-2 text-sm leading-relaxed">Keep {active.primary.name} as primary. Archive {active.duplicate.name} and retain its notes, needs, activity and linked records on the primary.</p></div><MergeSelectedValues review={active} choices={choices as Record<MergeField, Winner>} /><p className="text-xs leading-relaxed text-muted-foreground">{pending === "none" ? "No pending action or reminder is retained." : `The ${pending === "primary" ? "primary" : "duplicate"} contact’s pending action or reminder is retained.`} {initialPendingChoice(active) === null ? "The other pending schedule is cleared; action history is retained." : ""}</p>{needsEngagement && <div className="flex items-start gap-2 rounded-panel border border-input p-3"><Checkbox id={`${prefix}-engagement`} className="mt-1" checked={engagement} disabled={busy} onCheckedChange={(value) => setEngagement(value === true)} /><Label htmlFor={`${prefix}-engagement`} className="py-1 text-xs font-normal leading-relaxed">I confirm an active brokerage engagement is in place for the retained Representation or Active client stage. FortMark does not verify or store an engagement document here.</Label></div>}</> : <>
            <div className="space-y-4">{FIELDS.map((field) => <fieldset key={field} className="min-w-0 rounded-panel border border-border p-3"><legend className="px-1 text-xs font-semibold">{LABELS[field]}{active.conflicts.includes(field) ? " · choose a version" : ""}</legend><div className="grid min-w-0 gap-3 sm:grid-cols-2">{(["primary", "duplicate"] as const).map((side) => <div key={side} className="min-w-0"><p className="text-[11px] font-semibold text-muted-foreground">{side === "primary" ? "Primary" : "Duplicate"}</p><div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{mergeFieldText(field, active[side].values)}</div><Button type="button" size="sm" variant={choices[field] === side ? "default" : "outline"} className="mt-2" aria-pressed={choices[field] === side} aria-label={`Use ${side} ${LABELS[field].toLowerCase()}`} disabled={busy || stale && !fresh} onClick={() => { setChoices((current) => ({ ...current, [field]: side })); setExplicit((current) => ({ ...current, [field]: true })); setEngagement(false); }}>Use {side === "primary" ? "primary" : "duplicate"}</Button></div>)}</div></fieldset>)}</div>
            <fieldset className="min-w-0 space-y-3 rounded-panel border border-border p-3"><legend className="px-1 text-xs font-semibold">Pending action or reminder{initialPendingChoice(active) === null ? " · choose what to retain" : ""}</legend>{initialPendingChoice(active) === "none" ? <p className="text-xs text-muted-foreground">Neither contact has a pending action or reminder.</p> : <><div className="grid min-w-0 gap-3 sm:grid-cols-2">{(["primary", "duplicate"] as const).map((side) => { const action = active[side].nextAction, reminder = active[side].nextFollowUpDate; return action || reminder ? <div key={side} className="min-w-0"><p className="text-[11px] font-semibold text-muted-foreground">{side === "primary" ? "Primary" : "Duplicate"}</p>{action ? <><p className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">{NEXT_ACTION_KIND_LABELS[action.kind]} · {action.purpose}</p><p className="mt-1 text-xs tabular">{formatNextActionDueAt(action.dueAt)}</p><p className="mt-1 break-words text-xs text-muted-foreground">{action.assigneeName || "Assigned team member"}</p></> : <><p className="mt-1 text-sm font-semibold">Legacy reminder</p><p className="mt-1 text-xs tabular">{formatFollowUpDay(followUpStatus(reminder).day!)}</p></>}<Button type="button" size="sm" className="mt-2" variant={pending === side ? "default" : "outline"} aria-pressed={pending === side} disabled={busy || stale && !fresh} onClick={() => { setPending(side); setPendingExplicit(true); }}>Keep this {action ? "action" : "reminder"}</Button></div> : <p key={side} className="text-xs text-muted-foreground">No pending action or reminder on the {side}.</p>; })}</div><Button type="button" size="sm" variant={pending === "none" ? "default" : "outline"} aria-pressed={pending === "none"} disabled={busy || stale && !fresh} onClick={() => { setPending("none"); setPendingExplicit(true); }}>Keep no pending action or reminder</Button><p className="text-xs leading-relaxed text-muted-foreground">Only the chosen action or reminder remains pending. Other pending actions are cancelled with their history retained. Choosing none clears both pending schedules.</p></>}</fieldset>
          </>}
        </> : loading ? <div className="space-y-3" aria-label="Loading duplicate suggestions">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 w-full rounded-panel" />)}</div> : <>
          <p className="text-xs leading-relaxed text-muted-foreground">Suggestions compare contacts within the same owner’s book. Similar names alone do not confirm a duplicate. Nothing is merged automatically.</p>
          {page && pairs.length === 0 && <DuplicateSuggestionsEmpty hasMore={page.hasMore} />}
          <div className="space-y-3">{pairs.map((pair) => <article key={`${pair.primary.id}:${pair.duplicate.id}`} className="min-w-0 rounded-panel border border-border p-3"><p className="text-xs font-semibold text-muted-foreground">{pair.reasons.map((reason) => reason === "email" ? "Same email" : reason === "phone" ? "Same phone" : "Similar name · advisory").join(" · ")}</p><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">{[pair.primary, pair.duplicate].map((contact) => <div key={contact.id} className="min-w-0"><p className="break-words text-sm font-semibold">{contact.name}</p><p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{[contact.email, contact.phone, contact.company].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">{LEAD_STAGE_LABELS[contact.stage as LeadStage] || contact.stage}</p></div>)}</div><Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => void begin(pair.primary.id, pair.duplicate.id)}>Review these contacts</Button></article>)}</div>
          {page && <DuplicateSuggestionCounts loaded={pairs.length} scanned={page.scannedContacts} total={page.totalContacts} hasMore={page.hasMore} />}
          {(page?.hasMore || moreChecked) && <Button type="button" size="sm" variant="outline" aria-disabled={busy || !page?.hasMore} className="aria-disabled:cursor-default aria-disabled:opacity-60" onClick={() => void loadMore()}>{!page?.hasMore ? "All contacts checked" : busy ? "Checking more contacts…" : "Check more contacts"}</Button>}
          {error && !page && <Button type="button" size="sm" variant="outline" onClick={refreshSuggestions}>Try again</Button>}
        </>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-border bg-card p-4 sm:p-5"><Button type="button" variant="ghost" disabled={busy} onClick={goBack}>{back.label}</Button>{result ? <Button type="button" onClick={() => { onOpenChange(false); onOpenContact?.(result.primary.id); }}>Open primary contact</Button> : active && final ? <Button type="button" disabled={busy || !ready || stale || Boolean(fresh) || needsEngagement && !engagement} onClick={() => void merge()}>{busy ? "Merging reviewed contacts…" : "Merge reviewed contacts"}</Button> : active && <Button type="button" disabled={!ready || busy || stale || Boolean(fresh)} onClick={() => { setFinal(true); setEngagement(false); focusHeading(); }}>Final merge review</Button>}</div>
    </DialogContent>
  );
}
