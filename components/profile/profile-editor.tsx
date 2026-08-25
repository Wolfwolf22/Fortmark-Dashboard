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
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";
import { ProfileField } from "@/components/profile/profile-field";
import { FORTMARK_BROKERAGE_NAME } from "@/lib/profile/normalize";
import { ProfileImageUpload } from "@/components/profile/profile-image-upload";
import type { ProfileFieldKey } from "@/lib/profile/onboarding";
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
/**
 * Field ORDER only. Every label, placeholder, hint, input type and length
 * limit now comes from `lib/profile/fields.ts`, the same table the onboarding
 * wizard renders from.
 *
 * The editor previously carried its own copies. Two tables describing the same
 * fields is exactly how a label drifts in one surface and not the other, or
 * how a maxLength stops matching the Zod schema — so the descriptions live in
 * one place and these arrays say only "in this order, here".
 */
const TEXT_FIELDS: readonly ProfileFieldKey[] = [
  "preferredDisplayName",
  "legalFirstName",
  "legalLastName",
  "phoneE164",
  // brokerageOffice is absent on purpose: FortMark assigns it. It is rendered
  // below as a locked value, never as an input.
  "licenseNumber",
  "licenseExpiration",
  "nrdsNumber",
];

const PRESENCE_FIELDS: readonly ProfileFieldKey[] = [
  "professionalTitle",
  "locationDisplay",
  // Same keys the onboarding MLS step writes, so Edit Profile shows and saves
  // exactly what the wizard stored rather than a second, drifting copy.
  "mlsAgentId",
  "mlsOrganization",
  "businessEmail",
  "whatsappPhoneE164",
  "linkedinUrl",
  "instagramUrl",
  "facebookUrl",
  "personalWebsiteUrl",
  "professionalWebsiteUrl",
];

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
  professionalTitle: null,
  locationDisplay: null,
  linkedinUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  personalWebsiteUrl: null,
  professionalWebsiteUrl: null,
  whatsappPhoneE164: null,
  businessEmail: null,
  mlsAgentId: null,
  mlsOrganization: null,
  mlsVerificationStatus: "unverified",
  completion: 0,
};

type FormState = Record<string, string>;

function toForm(profile: ProfileDetail | null): FormState {
  const p = profile ?? EMPTY;
  const form: FormState = {};
  const row = p as unknown as Record<string, unknown>;
  for (const key of TEXT_FIELDS) form[key] = (row[key] as string | null) ?? "";
  for (const { key } of LIST_FIELDS) form[key] = p[key].join(", ");
  for (const key of PRESENCE_FIELDS) form[key] = (row[key] as string | null) ?? "";
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
  imageUploadEnabled = true,
}: {
  initial: ProfileDetail | null;
  onSaved: (profile: ProfileDetail | null) => void;
  /** Server-reported. Off ⇒ the photo control says so instead of failing. */
  imageUploadEnabled?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(() => toForm(initial));
  const [completion, setCompletion] = React.useState(initial?.completion ?? 0);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  // Same contract the wizard consumes: field name -> messages.
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<ProfileFieldKey, string[]>>
  >({});
  // Local to this component, like the wizard's. Never a global store.
  const [imageUrl, setImageUrl] = React.useState<string | null>(
    (initial as { imageUrl?: string | null } | null)?.imageUrl ?? null
  );

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
        const detail = (await response.json().catch(() => null)) as
          | { fieldErrors?: Partial<Record<ProfileFieldKey, string[]>>; formErrors?: string[] }
          | null;
        const fields = detail?.fieldErrors ?? {};
        setFieldErrors(fields);
        const invalid = Object.keys(fields) as ProfileFieldKey[];
        setSave({
          status: "error",
          message:
            invalid.length > 0
              ? `Check ${invalid.length === 1 ? "the highlighted field" : `${invalid.length} highlighted fields`} and try again.`
              : (detail?.formErrors?.[0] ??
                "Your profile could not be saved right now. Nothing else is affected."),
        });
        // Focus the first rejected control, in render order.
        const order = [...TEXT_FIELDS, ...PRESENCE_FIELDS];
        const first = order.find((f) => invalid.includes(f));
        if (first) {
          requestAnimationFrame(() => {
            const el = document.getElementById(`field-${first}`);
            if (el instanceof HTMLElement) el.focus();
          });
        }
        return;
      }
      setFieldErrors({});
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
      // Same reason as the photo: the layout's identity strip will not pick up
      // a new display name until the client re-requests the tree.
      router.refresh();
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

      <ProfileImageUpload
        currentUrl={imageUrl}
        displayName={form.preferredDisplayName || "FortMark"}
        onUploaded={setImageUrl}
        disabled={saving}
        uploadEnabled={imageUploadEnabled}
      />

      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-foreground">Brokerage</p>
        <div className="flex items-center gap-2 rounded-panel border border-border bg-foreground/[0.03] px-3 py-2.5">
          <Lock aria-hidden className="size-3.5 shrink-0 text-foreground/55" />
          <span className="truncate text-[13px] font-semibold text-foreground">
            {FORTMARK_BROKERAGE_NAME}
          </span>
          <span className="sr-only">Assigned by FortMark and cannot be changed.</span>
        </div>
        <p className="text-[12px] text-foreground/55">Assigned by FortMark</p>
      </div>

      {TEXT_FIELDS.map((key) => (
        <ProfileField
          key={key}
          name={key}
          value={form[key] ?? ""}
          onValueChange={(v: string) => set(key, v)}
          error={fieldErrors[key]?.[0] ?? null}
          disabled={saving}
        />
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

      <fieldset className="space-y-4 border-t border-border pt-5">
        <legend className="text-sm font-semibold">Professional presence</legend>
        <p className="text-[13px] text-muted-foreground">
          Shown on your Home card and digital business card. Links are
          normalised to https and anything unsafe is discarded on save. Leave a
          field empty to hide it.
        </p>
        {PRESENCE_FIELDS.map((key) => (
          <ProfileField
            key={key}
            name={key}
            value={form[key] ?? ""}
            onValueChange={(v: string) => set(key, v)}
            error={fieldErrors[key]?.[0] ?? null}
            disabled={saving}
          />
        ))}
      </fieldset>

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
