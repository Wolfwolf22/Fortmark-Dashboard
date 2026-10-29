"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { NotebookText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CLIENT_INFO_LIMITS, clientInfoChanged, clientInfoDirty, clientInfoSave, clientInfoSnapshot, clientInfoValuesSchema,
  resolveClientInfoReview, reviewClientInfo,
  type ClientInfoChoices, type ClientInfoContact, type ClientInfoField, type ClientInfoReview, type ClientInfoSave, type ClientInfoValues,
} from "@/lib/contacts/client-info";

interface ClientInfoProps {
  lead: ClientInfoContact;
  canWrite: boolean;
  saving?: boolean;
  onSave: (patch: ClientInfoSave) => Promise<boolean>;
  onReload?: () => Promise<ClientInfoContact | undefined>;
}
interface DraftRow { id: string; label: string; value: string }
const FIELD_LABELS: Record<ClientInfoField, string> = { about: "About", personalDetails: "Named details" };

/** A different client never inherits another client's draft. */
export function ClientInfo(props: ClientInfoProps) {
  return <ClientInfoSection key={props.lead.id} {...props} />;
}

/** Saved values are text nodes throughout, including custom labels. */
function InformationContent({ values }: { values: ClientInfoValues }) {
  const details = values.personalDetails.filter((row) => row.label.trim() || row.value.trim());
  return (
    <div className="min-w-0 space-y-4">
      {values.about.trim() && <p className="whitespace-pre-wrap break-words text-[13px] leading-6 [overflow-wrap:anywhere]" data-testid="client-info-about">{values.about}</p>}
      {details.length > 0 && (
        <dl className="space-y-3" data-testid="client-info-details">
          {details.map((row, index) => (
            <div key={index} className="min-w-0">
              <dt className="break-words text-[11px] font-semibold text-muted-foreground [overflow-wrap:anywhere]">{row.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!values.about.trim() && details.length === 0 && <p className="text-[13px] leading-relaxed text-muted-foreground">No client information added.</p>}
    </div>
  );
}

function ClientInfoSection({ lead, canWrite, saving = false, onSave, onReload }: ClientInfoProps) {
  const prefix = useId();
  const aboutId = `${prefix}-about`;
  const addId = `${prefix}-add`;
  const rowNumber = useRef(0);
  const makeRows = (values: ClientInfoValues) => values.personalDetails.map((row) => ({ ...row, id: `${prefix}-detail-${++rowNumber.current}` }));
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(() => clientInfoSnapshot(lead));
  const [about, setAbout] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<ClientInfoReview | null>(null);
  const [choices, setChoices] = useState<ClientInfoChoices>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  const wasEditing = useRef(false);
  const latest = clientInfoSnapshot(lead);
  const values: ClientInfoValues = { about, personalDetails: rows.map(({ label, value }) => ({ label, value })) };
  const changedRemotely = clientInfoChanged(baseline, latest);
  const missingRevision = lead.recordSource === "db" && (!baseline.expectedUpdatedAt || !Number.isFinite(Date.parse(baseline.expectedUpdatedAt)));
  const mustReview = changedRemotely || conflict || missingRevision;
  const busy = saving || pending || reloading;
  const locked = busy || review !== null;
  const isEditing = editing && canWrite;

  useEffect(() => {
    if (isEditing) document.getElementById(aboutId)?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = isEditing;
  }, [isEditing, aboutId]);
  useEffect(() => { if (review) reviewPanel.current?.focus(); }, [review]);
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget, rows]);

  function open() {
    const opening = clientInfoSnapshot(lead);
    setBaseline(opening);
    setAbout(opening.values.about);
    setRows(makeRows(opening.values));
    setErrors({}); setFailure(null); setNotice(null); setConflict(false); setReview(null); setChoices({});
    setEditing(true);
  }

  function changeRow(id: string, field: "label" | "value", text: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: text } : row));
    setErrors((current) => ({ ...current, [`${id}-${field}`]: "" }));
    setNotice(null);
  }

  function addRow() {
    if (rows.length >= CLIENT_INFO_LIMITS.details || locked) return;
    const id = `${prefix}-detail-${++rowNumber.current}`;
    setRows((current) => [...current, { id, label: "", value: "" }]);
    setNotice(null); setFocusTarget(`${id}-label`);
  }

  function removeRow(index: number) {
    if (locked) return;
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    setRows(next); setErrors({}); setNotice(null);
    setFocusTarget(next[index] ? `${next[index].id}-label` : next[index - 1] ? `${next[index - 1].id}-label` : addId);
  }

  function acceptReview(next: { baseline: typeof baseline; values: ClientInfoValues }) {
    setBaseline(next.baseline); setAbout(next.values.about); setRows(makeRows(next.values));
    setReview(null); setChoices({}); setConflict(false); setErrors({}); setFailure(null);
    setNotice("Latest information reviewed. Check your draft before saving."); setFocusTarget(aboutId);
  }

  async function reviewLatest() {
    if (busy) return;
    setReloading(true); setFailure(null);
    try {
      const fresh = onReload ? await onReload() : lead;
      if (!fresh) throw new Error("The latest contact could not be loaded. Your draft is kept. Try again.");
      const snapshot = clientInfoSnapshot(fresh);
      if (fresh.recordSource === "db" && (!snapshot.expectedUpdatedAt || !Number.isFinite(Date.parse(snapshot.expectedUpdatedAt)))) throw new Error("The saved version is unavailable. Your draft is kept. Reload this contact before saving.");
      if (conflict && snapshot.expectedUpdatedAt === baseline.expectedUpdatedAt) throw new Error("The latest saved version could not be confirmed. Your draft is kept. Try loading it again.");
      const result = reviewClientInfo(baseline, values, snapshot);
      if (result.conflicts.length) { setReview(result); setChoices({}); }
      else acceptReview({ baseline: result.latest, values: result.values });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The latest information could not be loaded. Your draft is kept. Try again.");
    } finally { setReloading(false); }
  }

  function finishReview() {
    if (!review) return;
    const result = resolveClientInfoReview(review, choices);
    if (result) acceptReview(result);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || locked || mustReview || !clientInfoDirty(baseline, values)) return;
    const checked = clientInfoValuesSchema.safeParse(values);
    if (!checked.success) {
      const nextErrors: Record<string, string> = {};
      const nonblank = rows.filter((row) => row.label.trim() || row.value.trim());
      for (const issue of checked.error.issues) {
        const [field, index, part] = issue.path;
        const key = field === "about" ? aboutId : typeof index === "number" && nonblank[index] && (part === "label" || part === "value") ? `${nonblank[index].id}-${part}` : addId;
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors); setFocusTarget(Object.keys(nextErrors)[0] ?? aboutId); return;
    }
    setPending(true); setErrors({}); setFailure(null);
    try {
      const saved = await onSave(clientInfoSave(baseline, checked.data));
      if (saved) setEditing(false);
      else setFailure("Client information could not be saved. Your draft is kept. Review any updated saved details before trying again.");
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 409) {
        setConflict(true); setFailure("The saved contact changed. Your draft is kept. Review the latest information before saving.");
      } else setFailure("Client information could not be saved. Your draft is kept. Try again.");
    } finally { setPending(false); }
  }

  const hasInformation = Boolean(latest.values.about.trim() || latest.values.personalDetails.length);
  return (
    <section className="min-w-0" data-testid="client-info" aria-labelledby={`${prefix}-title`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <IconWell icon={NotebookText} />
          <div className="min-w-0">
            <h3 id={`${prefix}-title`} className="text-[15px] font-semibold leading-snug">About this client</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Reference notes and named details.</p>
          </div>
        </div>
        {!isEditing && canWrite && <Button ref={editButton} type="button" size="sm" variant="outline" className="shrink-0" disabled={saving} onClick={open}>{hasInformation ? "Edit" : "Add information"}</Button>}
      </div>

      {isEditing ? (
        <form className="mt-4 min-w-0 space-y-4" onSubmit={(event) => void save(event)} noValidate>
          {mustReview && !review && (
            <div role="alert" className="space-y-2 rounded-panel border border-border bg-tint p-3">
              <p className="text-sm font-semibold">{missingRevision ? "Load the saved version before editing" : "The saved contact changed while you were editing"}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">Your draft is kept. Review the latest information before saving.</p>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reviewLatest()}>{reloading ? "Loading latest information…" : "Review latest information"}</Button>
            </div>
          )}
          {review && (
            <section ref={reviewPanel} tabIndex={-1} aria-labelledby={`${prefix}-review`} className="min-w-0 space-y-4 rounded-panel border border-input bg-tint p-3">
              <div><h4 id={`${prefix}-review`} className="text-sm font-semibold">Choose which changes to keep</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">These sections changed in both versions. Each choice is reviewed before a separate save.</p></div>
              {review.conflicts.map((field) => (
                <fieldset key={field} className="min-w-0 space-y-3 border-t border-border pt-3">
                  <legend className="pr-2 text-xs font-semibold">{FIELD_LABELS[field]}</legend>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    {(["saved", "mine"] as const).map((choice) => (
                      <div key={choice} className="min-w-0 space-y-2">
                        <p className="text-[11px] font-semibold text-muted-foreground">{choice === "saved" ? "Saved information" : "Your draft"}</p>
                        <InformationContent values={field === "about" ? { about: choice === "saved" ? review.latest.values.about : review.values.about, personalDetails: [] } : { about: "", personalDetails: choice === "saved" ? review.latest.values.personalDetails : review.values.personalDetails }} />
                        <Button type="button" size="sm" variant={choices[field] === choice ? "default" : "outline"} aria-pressed={choices[field] === choice} onClick={() => setChoices((current) => ({ ...current, [field]: choice }))}>{choice === "saved" ? "Use saved information" : "Keep my change"}</Button>
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={review.conflicts.some((field) => !choices[field])} onClick={finishReview}>Finish review</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setReview(null); setFocusTarget(aboutId); }}>Keep editing draft</Button>
              </div>
            </section>
          )}
          {failure && <p role="alert" className="text-xs leading-relaxed text-destructive">{failure}</p>}
          {notice && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{notice}</p>}
          <div className="grid min-w-0 gap-1.5">
            <div className="flex items-baseline justify-between gap-2"><Label htmlFor={aboutId}>About</Label><span id={`${aboutId}-count`} className="text-[11px] text-muted-foreground tabular">{about.length.toLocaleString()} / 2,000</span></div>
            <Textarea id={aboutId} value={about} maxLength={CLIENT_INFO_LIMITS.about} rows={5} className="resize-y" placeholder="Add information you want to remember." disabled={locked} onChange={(event) => { setAbout(event.target.value); setErrors((current) => ({ ...current, [aboutId]: "" })); setNotice(null); }} aria-invalid={Boolean(errors[aboutId])} aria-describedby={`${aboutId}-count${errors[aboutId] ? ` ${aboutId}-error` : ""}`} />
            {errors[aboutId] && <p id={`${aboutId}-error`} className="text-xs text-destructive">{errors[aboutId]}</p>}
          </div>
          <div className="min-w-0 space-y-3">
            <div><h4 className="text-sm font-semibold">Named details</h4><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose a label and value for each detail. Empty rows are left out.</p></div>
            {rows.map((row, index) => (
              <fieldset key={row.id} className="min-w-0 space-y-3 rounded-panel border border-border p-3">
                <legend className="px-1 text-[11px] font-semibold text-muted-foreground">Detail {index + 1}</legend>
                <div className="flex min-w-0 items-end gap-2">
                  <div className="grid min-w-0 flex-1 gap-1.5"><Label htmlFor={`${row.id}-label`}>Label</Label><Input id={`${row.id}-label`} className="h-10" value={row.label} maxLength={CLIENT_INFO_LIMITS.label} disabled={locked} onChange={(event) => changeRow(row.id, "label", event.target.value)} aria-invalid={Boolean(errors[`${row.id}-label`])} aria-describedby={errors[`${row.id}-label`] ? `${row.id}-label-error` : undefined} /></div>
                  <Button type="button" size="icon" variant="ghost" className="h-10 w-10 shrink-0 text-muted-foreground" aria-label={`Remove detail ${index + 1}`} disabled={locked} onClick={() => removeRow(index)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
                {errors[`${row.id}-label`] && <p id={`${row.id}-label-error`} className="text-xs text-destructive">{errors[`${row.id}-label`]}</p>}
                <div className="grid min-w-0 gap-1.5"><Label htmlFor={`${row.id}-value`}>Value</Label><Textarea id={`${row.id}-value`} rows={2} className="resize-y" value={row.value} maxLength={CLIENT_INFO_LIMITS.value} disabled={locked} onChange={(event) => changeRow(row.id, "value", event.target.value)} aria-invalid={Boolean(errors[`${row.id}-value`])} aria-describedby={errors[`${row.id}-value`] ? `${row.id}-value-error` : undefined} /></div>
                {errors[`${row.id}-value`] && <p id={`${row.id}-value-error`} className="text-xs text-destructive">{errors[`${row.id}-value`]}</p>}
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2"><Button id={addId} type="button" size="sm" variant="outline" disabled={locked || rows.length >= CLIENT_INFO_LIMITS.details} onClick={addRow}><Plus className="h-4 w-4" aria-hidden="true" />Add detail</Button><p className="text-[11px] text-muted-foreground tabular">{rows.length} / 20 details</p></div>
            {errors[addId] && <p role="alert" className="text-xs text-destructive">{errors[addId]}</p>}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Button type="submit" size="sm" disabled={locked || mustReview || !clientInfoDirty(baseline, values)}>{pending ? "Saving…" : "Save information"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      ) : (
        <div className="mt-4"><InformationContent values={latest.values} />{!hasInformation && canWrite && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Add a short note or named details for your reference.</p>}</div>
      )}
    </section>
  );
}
