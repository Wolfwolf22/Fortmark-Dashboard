"use client";

/** A frozen opening snapshot, dirty fields only, and explicit conflict review. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadsError, type ContactEdit } from "@/lib/data/adapters/leads";
import { LEAD_SOURCE_LABELS, LEAD_SOURCES_ORDER, type Lead } from "@/lib/data/types";
import {
  contactEditorChanged,
  contactEditorPatch,
  contactEditorSnapshot,
  reviewContactEditor,
  resolveContactEditorReview,
  type ContactEditorField,
  type ContactEditorReview,
} from "@/lib/contacts/editor";

type Field = "firstName" | "lastName" | "preferredName" | "email" | "phone" | "company";
const FIELD_IDS: Record<ContactEditorField, string> = {
  firstName: "lead-edit-first-name", lastName: "lead-edit-last-name", preferredName: "lead-edit-preferred-name",
  email: "lead-edit-email", phone: "lead-edit-phone", company: "lead-edit-company", source: "lead-edit-source",
};
const FIELD_LABELS: Record<ContactEditorField, string> = {
  firstName: "First name", lastName: "Last name", preferredName: "Preferred name", email: "Email", phone: "Phone", company: "Company", source: "Source",
};
const MESSAGES: Record<string, string> = {
  firstName: "Add at least a first name, a last name or a preferred name.",
  email: "Enter a valid email address, or leave it empty.",
  phone: "That phone number could not be read. Use a 10-digit US number.",
  company: "Company is too long.",
};
interface EditProps {
  lead: Lead;
  saving: boolean;
  onSave: (patch: ContactEdit) => Promise<boolean>;
  onCancel: () => void;
  /** Read the latest contact without dismissing this editor or its draft. */
  onReload?: () => Promise<Lead | undefined>;
}

/** A different contact always gets its own opening snapshot. Same-contact refreshes do not. */
export function LeadEditForm(props: EditProps) {
  return <ContactEditor key={props.lead.id} {...props} />;
}

function ContactEditor({ lead, saving, onSave, onCancel, onReload }: EditProps) {
  const [baseline, setBaseline] = useState(() => contactEditorSnapshot(lead));
  const [values, setValues] = useState(() => ({ ...baseline.values }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ContactEditorReview | null>(null);
  const [choices, setChoices] = useState<Partial<Record<ContactEditorField, "mine" | "saved">>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reviewPanel = useRef<HTMLElement>(null);

  const latest = contactEditorSnapshot(lead);
  // A fresh explicit read may arrive before the parent publishes it. An older
  // prop must not make a successfully reviewed version look like a new conflict.
  const olderProp = baseline.expectedUpdatedAt && latest.expectedUpdatedAt && Date.parse(latest.expectedUpdatedAt) < Date.parse(baseline.expectedUpdatedAt);
  const changedRemotely = !olderProp && contactEditorChanged(baseline, latest);
  const missingRevision = lead.recordSource === "db" && (!baseline.expectedUpdatedAt || Number.isNaN(Date.parse(baseline.expectedUpdatedAt)));
  const mustReview = conflict || changedRemotely || missingRevision;
  const locked = saving || reviewing || review !== null;

  useEffect(() => { if (review) reviewPanel.current?.focus(); }, [review]);
  useEffect(() => {
    if (!notice || review) return;
    const dirty = (Object.keys(values) as ContactEditorField[]).find(field => values[field] !== baseline.values[field]);
    document.getElementById(FIELD_IDS[dirty ?? "firstName"])?.focus();
  }, [notice, review, values, baseline]);

  useEffect(() => {
    const first = Object.keys(errors)[0] as ContactEditorField | undefined;
    if (first && !saving) document.getElementById(FIELD_IDS[first])?.focus();
  }, [errors, saving]);

  const set = (field: Field) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setNotice(null);
  };

  async function reviewLatest() {
    setReviewing(true);
    setFailure(null);
    try {
      const fresh = onReload ? await onReload() : lead;
      if (!fresh) throw new Error("The latest contact could not be loaded. Your draft is kept. Try again.");
      const next = contactEditorSnapshot(fresh);
      if (fresh.recordSource === "db" && !next.expectedUpdatedAt) throw new Error("The contact revision is unavailable. Your draft is kept. Reload this contact before saving.");
      if (conflict && next.expectedUpdatedAt === baseline.expectedUpdatedAt) throw new Error("The latest saved version could not be confirmed. Your draft is kept. Try loading it again.");
      const result = reviewContactEditor(baseline, values, next);
      if (result.conflicts.length) {
        setReview(result);
        setChoices({});
      } else {
        setBaseline(result.latest);
        setValues(result.values);
        setConflict(false);
        setNotice("Latest details loaded. Your changes are kept. Review them before saving.");
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The latest details could not be loaded. Your draft is kept.");
    } finally {
      setReviewing(false);
    }
  }

  function finishReview() {
    if (!review) return;
    const resolved = resolveContactEditorReview(review, choices);
    if (!resolved) return;
    setBaseline(resolved.baseline);
    setValues(resolved.values);
    setReview(null);
    setChoices({});
    setConflict(false);
    setFailure(null);
    setNotice("Review complete. Check your changes, then save.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || mustReview) return;
    const patch: ContactEdit = contactEditorPatch(baseline, values);
    if (!values.firstName.trim() && !values.lastName.trim() && !values.preferredName.trim()) {
      setErrors({ firstName: MESSAGES.firstName });
      return;
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setErrors({});
    setFailure(null);
    try {
      const ok = await onSave(patch);
      if (!ok) setFailure("Changes have not been saved. Your draft is kept.");
    } catch (error) {
      if (error instanceof LeadsError && error.status === 409) {
        setConflict(true);
        return;
      }
      if (error instanceof LeadsError && error.status === 400 && error.fields.length > 0) {
        const next: Record<string, string> = {};
        for (const field of error.fields) next[field] = MESSAGES[field] ?? "Check this field.";
        setErrors(next);
        return;
      }
      setFailure("Changes could not be saved. Your draft is kept. Try again.");
    }
  }

  const props = (field: Field) => ({
    id: FIELD_IDS[field], value: values[field], onChange: set(field), disabled: locked,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${FIELD_IDS[field]}-error` : undefined,
  });
  const shownValue = (field: ContactEditorField, value: string) => field === "source" ? LEAD_SOURCE_LABELS[value as Lead["source"]] : value || "Empty";

  return (
    <form onSubmit={submit} aria-label="Edit contact" className="space-y-3" noValidate>
      {mustReview && !review && (
        <div role="alert" className="space-y-2 rounded-panel border border-border bg-tint p-3">
          <p className="text-sm font-semibold">{missingRevision ? "Load the saved contact before editing" : "This contact changed while you were editing"}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Your draft is kept. Review the latest saved details before saving changes.</p>
          <Button type="button" size="sm" variant="outline" disabled={saving || reviewing} onClick={() => void reviewLatest()}>
            {reviewing ? "Loading latest details…" : "Review latest details"}
          </Button>
        </div>
      )}
      {review && (
        <section ref={reviewPanel} tabIndex={-1} aria-label="Review conflicting contact changes" className="space-y-3 rounded-panel border border-border bg-tint p-3">
          <p className="text-sm font-semibold">Choose which changes to keep</p>
          <p className="text-xs leading-relaxed text-muted-foreground">These details changed in both your draft and the saved contact. Other saved changes are preserved.</p>
          {review.conflicts.map((field) => (
            <fieldset key={field} className="min-w-0 space-y-2 border-t border-border pt-3">
              <legend className="pr-2 text-xs font-semibold">{FIELD_LABELS[field]}</legend>
              <p className="break-words text-xs leading-relaxed">Saved: {shownValue(field, review.latest.values[field])}</p>
              <p className="break-words text-xs leading-relaxed">Your draft: {shownValue(field, review.values[field])}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={choices[field] === "saved" ? "secondary" : "outline"} aria-pressed={choices[field] === "saved"} onClick={() => setChoices((current) => ({ ...current, [field]: "saved" }))}>Use saved value</Button>
                <Button type="button" size="sm" variant={choices[field] === "mine" ? "secondary" : "outline"} aria-pressed={choices[field] === "mine"} onClick={() => setChoices((current) => ({ ...current, [field]: "mine" }))}>Keep my change</Button>
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={review.conflicts.some((key) => !choices[key])} onClick={finishReview}>Finish review</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setReview(null); setNotice("Your draft is kept. Review the latest saved details before saving."); }}>Keep editing draft</Button>
          </div>
        </section>
      )}
      {notice && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{notice}</p>}
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["firstName", "lastName", "preferredName", "company", "email", "phone"] as Field[]).map((field) => (
          <div key={field} className="grid min-w-0 gap-1.5">
            <Label htmlFor={FIELD_IDS[field]}>{FIELD_LABELS[field]}</Label>
            <Input {...props(field)} type={field === "email" ? "email" : field === "phone" ? "tel" : "text"} maxLength={field === "email" ? 320 : field === "phone" ? 40 : field === "company" ? 200 : 100} autoComplete="off" />
            {errors[field] && <p id={`${FIELD_IDS[field]}-error`} role="alert" className="text-xs text-destructive">{errors[field]}</p>}
          </div>
        ))}
      </div>
      <div className="grid gap-1.5 sm:max-w-[16rem]">
        <Label htmlFor="lead-edit-source">Source</Label>
        <Select value={values.source} onValueChange={(value) => { setValues((current) => ({ ...current, source: value as Lead["source"] })); setNotice(null); }} disabled={locked}>
          <SelectTrigger id="lead-edit-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LEAD_SOURCES_ORDER.map((source) => <SelectItem key={source} value={source}>{LEAD_SOURCE_LABELS[source]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={locked || mustReview}>Save changes</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
