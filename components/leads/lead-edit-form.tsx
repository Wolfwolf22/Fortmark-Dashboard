"use client";

/**
 * Edit a contact's details: name, email, phone, company, source.
 *
 * Only what changed is sent, so saving an untouched form asks for nothing. The
 * server decides what is valid and names the fields it refused; this form says
 * what to fix in words and puts focus on the first one. Ownership, stage and
 * dates are not here — each has its own control in the drawer — and intent is a
 * summary of the person's needs, which is a different part of the CRM.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadsError, type ContactEdit } from "@/lib/data/adapters/leads";
import { LEAD_SOURCE_LABELS, LEAD_SOURCES_ORDER, type Lead } from "@/lib/data/types";

type Field = "firstName" | "lastName" | "preferredName" | "email" | "phone" | "company";

const MESSAGES: Record<string, string> = {
  firstName: "Add at least a first name, a last name or a preferred name.",
  email: "Enter a valid email address, or leave it empty.",
  phone: "That phone number could not be read. Use a 10-digit US number.",
  company: "Company is too long.",
};

function initial(lead: Lead) {
  return {
    firstName: lead.editable?.firstName ?? lead.name,
    lastName: lead.editable?.lastName ?? "",
    preferredName: lead.editable?.preferredName ?? "",
    email: lead.email,
    phone: lead.phone,
    company: lead.editable?.company ?? "",
  };
}

export function LeadEditForm({
  lead,
  saving,
  onSave,
  onCancel,
}: {
  lead: Lead;
  saving: boolean;
  /** Resolves true on success. A refusal throws `LeadsError`, which this form explains. */
  onSave: (patch: ContactEdit) => Promise<boolean>;
  onCancel: () => void;
}) {
  const start = initial(lead);
  const [values, setValues] = useState(start);
  const [source, setSource] = useState<Lead["source"]>(lead.source);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Focus the first field that needs attention — once the form is enabled again. A field that is
  // still disabled while the request is in flight cannot take focus.
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first && !saving) document.getElementById(`lead-edit-${first === "firstName" ? "first-name" : first}`)?.focus();
  }, [errors, saving]);

  const set = (field: Field) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: ContactEdit = {};
    for (const key of Object.keys(values) as Field[]) {
      if (values[key].trim() !== start[key].trim()) patch[key] = values[key].trim();
    }
    if (source !== lead.source) patch.source = source;

    const after = { ...start, ...patch } as typeof start;
    if (!after.firstName.trim() && !after.lastName.trim() && !after.preferredName.trim()) {
      setErrors({ firstName: MESSAGES.firstName });
      return;
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setErrors({});
    try {
      const ok = await onSave(patch);
      if (!ok) return;
    } catch (error) {
      if (error instanceof LeadsError && error.status === 400 && error.fields.length > 0) {
        const next: Record<string, string> = {};
        for (const f of error.fields) next[f] = MESSAGES[f] ?? "Check this field.";
        setErrors(next);
        return;
      }
      throw error;
    }
  }

  const err = (field: string) => errors[field];
  const props = (field: Field, id: string) => ({
    id,
    value: values[field],
    onChange: set(field),
    disabled: saving,
    "aria-invalid": err(field) ? true : undefined,
    "aria-describedby": err(field) ? `${id}-error` : undefined,
  });
  const Msg = ({ field, id }: { field: string; id: string }) =>
    err(field) ? (
      <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
        {err(field)}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} aria-label="Edit contact" className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lead-edit-first-name">First name</Label>
          <Input {...props("firstName", "lead-edit-first-name")} maxLength={100} autoComplete="off" />
          <Msg field="firstName" id="lead-edit-first-name" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-edit-last-name">Last name</Label>
          <Input {...props("lastName", "lead-edit-last-name")} maxLength={100} autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-edit-preferred-name">Preferred name</Label>
          <Input {...props("preferredName", "lead-edit-preferred-name")} maxLength={100} autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-edit-company">Company</Label>
          <Input {...props("company", "lead-edit-company")} maxLength={200} autoComplete="off" />
          <Msg field="company" id="lead-edit-company" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-edit-email">Email</Label>
          <Input {...props("email", "lead-edit-email")} type="email" maxLength={320} autoComplete="off" />
          <Msg field="email" id="lead-edit-email" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lead-edit-phone">Phone</Label>
          <Input {...props("phone", "lead-edit-phone")} type="tel" maxLength={40} autoComplete="off" />
          <Msg field="phone" id="lead-edit-phone" />
        </div>
      </div>
      <div className="grid gap-1.5 sm:max-w-[16rem]">
        <Label htmlFor="lead-edit-source">Source</Label>
        <Select value={source} onValueChange={(v) => setSource(v as Lead["source"])} disabled={saving}>
          <SelectTrigger id="lead-edit-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_SOURCES_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
