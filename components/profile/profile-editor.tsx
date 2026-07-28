"use client";

/**
 * The persisted profile editor.
 *
 * Submits to `PATCH /api/profile`, which normalises and validates server-side.
 * The client mirrors a few of those rules for immediate feedback only — it is
 * never the enforcement point. Role, status, the Clerk id and the verified
 * email are not fields here and are stripped by the server schema regardless.
 *
 * The form re-renders from the server's response after a save, so what is on
 * screen is always what was actually stored — a phone number typed as
 * "(954) 555-0100" comes back as "+19545550100".
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LICENSE_STATES, LICENSE_TYPES } from "@/lib/profile/normalize";
import type { ProfileDetail } from "@/lib/profile/display";
import { apiPath } from "@/lib/routes";

/** Text fields that map one-to-one onto a schema column. */
const TEXT_FIELDS = [
  { key: "preferredDisplayName", label: "Display name", placeholder: "How your name appears" },
  { key: "legalFirstName", label: "Legal first name" },
  { key: "legalLastName", label: "Legal last name" },
  { key: "phoneE164", label: "Phone", placeholder: "(954) 555-0100", type: "tel" },
  { key: "brokerageOffice", label: "Brokerage office" },
  { key: "licenseNumber", label: "License number" },
  { key: "licenseExpiration", label: "License expiration", type: "date" },
  { key: "nrdsNumber", label: "NRDS number" },
] as const;

/** Comma-separated list fields. */
const LIST_FIELDS = [
  { key: "languages", label: "Languages" },
  { key: "specialties", label: "Specialties" },
  { key: "serviceAreas", label: "Service areas" },
] as const;

const EMPTY: ProfileDetail = {
  preferredDisplayName: null,
  legalFirstName: null,
  legalLastName: null,
  phoneE164: null,
  brokerageOffice: null,
  licenseState: null,
  licenseType: null,
  licenseNumber: null,
  licenseExpiration: null,
  nrdsNumber: null,
  biography: null,
  languages: [],
  specialties: [],
  serviceAreas: [],
  completion: 0,
};

type FormState = Record<string, string>;

function toForm(profile: ProfileDetail | null): FormState {
  const p = profile ?? EMPTY;
  const form: FormState = {};
  for (const { key } of TEXT_FIELDS) form[key] = p[key] ?? "";
  for (const { key } of LIST_FIELDS) form[key] = p[key].join(", ");
  form.licenseState = p.licenseState ?? "";
  form.licenseType = p.licenseType ?? "";
  form.biography = p.biography ?? "";
  return form;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; licenseReset: boolean }
  | { status: "error"; message: string };

export function ProfileEditor({
  initial,
  onSaved,
}: {
  initial: ProfileDetail | null;
  onSaved: (profile: ProfileDetail | null) => void;
}) {
  const [form, setForm] = React.useState<FormState>(() => toForm(initial));
  const [completion, setCompletion] = React.useState(initial?.completion ?? 0);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });

  const set = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Any edit invalidates the previous outcome message.
    setSave((prev) => (prev.status === "idle" ? prev : { status: "idle" }));
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSave({ status: "saving" });
    try {
      const response = await fetch(apiPath("/api/profile"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setSave({
          status: "error",
          message:
            response.status === 400
              ? "Some values could not be saved. Check the highlighted formats and try again."
              : "Your profile could not be saved right now. Nothing else is affected.",
        });
        return;
      }
      const body = (await response.json()) as {
        profile: ProfileDetail | null;
        completion: number;
        licenseReset: boolean;
      };
      // Re-seed from the server so the form shows what was actually stored.
      setForm(toForm(body.profile));
      setCompletion(body.completion);
      setSave({ status: "saved", licenseReset: body.licenseReset });
      onSaved(body.profile);
    } catch {
      setSave({
        status: "error",
        message: "Your profile could not be saved right now. Nothing else is affected.",
      });
    }
  }

  const saving = save.status === "saving";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Profile completion</span>
          <span className="text-sm tabular-nums text-muted-foreground">{completion}%</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completion}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile completion"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      {TEXT_FIELDS.map(({ key, label, ...rest }) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`profile-${key}`}>{label}</Label>
          <Input
            id={`profile-${key}`}
            value={form[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
            disabled={saving}
            {...rest}
          />
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="profile-licenseState">License state</Label>
          <Select
            value={form.licenseState || undefined}
            onValueChange={(v) => set("licenseState", v)}
            disabled={saving}
          >
            <SelectTrigger id="profile-licenseState">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {LICENSE_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-licenseType">License type</Label>
          <Select
            value={form.licenseType || undefined}
            onValueChange={(v) => set("licenseType", v)}
            disabled={saving}
          >
            <SelectTrigger id="profile-licenseType">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {LICENSE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {LIST_FIELDS.map(({ key, label }) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`profile-${key}`}>{label}</Label>
          <Input
            id={`profile-${key}`}
            value={form[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
            disabled={saving}
            placeholder="Comma separated"
          />
        </div>
      ))}

      <div className="space-y-1.5">
        <Label htmlFor="profile-biography">Biography</Label>
        <Textarea
          id="profile-biography"
          className="min-h-[120px]"
          value={form.biography ?? ""}
          onChange={(e) => set("biography", e.target.value)}
          disabled={saving}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {save.status === "saved"
            ? save.licenseReset
              ? "Saved. Licence details changed."
              : "Saved."
            : save.status === "error"
              ? save.message
              : ""}
        </p>
      </div>
    </form>
  );
}
