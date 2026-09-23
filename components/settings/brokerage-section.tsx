"use client";

/**
 * Brokerage — the licensed brokerage this dashboard represents.
 *
 * The record is FortMark-owned and operator-provided (`/api/brokerage`). A
 * broker or admin edits it here; everyone else reads it, with no disabled
 * controls standing in for permissions they do not have. The server decides
 * who may edit — `canEdit` only chooses what to render.
 *
 * FortMark-only: one central record, and nobody chooses a brokerage. The MLS
 * section (office id, name, phone) is SYSTEM-MANAGED — synced from the
 * configured FortMark office's Office record — and is never a form field.
 * Admin/broker edit only operator-owned fields.
 *
 * Two things are deliberately NOT claimed:
 *   - licence status. The licence number is shown as entered; there is no
 *     licensing-authority check behind it, so nothing says verified or active.
 *   - MLS office details as FortMark's own. When the stored office phone is
 *     empty the MLS's phone for the configured office may be shown, labelled
 *     as coming from the MLS, and it is never saved.
 */
import * as React from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BrokerageError,
  getBrokerageState,
  saveBrokerageIdentity,
  syncBrokerageFromMls,
  type BrokerageFieldErrors,
} from "@/lib/data/adapters/brokerage";
import type {
  BrokerageField,
  BrokerageResponse,
  BrokerageValues,
  BrokerageView,
} from "@/lib/brokerage/identity";
import { LICENSE_STATES } from "@/lib/profile/normalize";
import { formatPhoneDisplay } from "@/lib/profile/links";
import { useQuery } from "@/lib/data/hooks";
import { SubsystemNotConnected, unavailableSubsystem } from "@/components/common/subsystem-state";
import { SampleDataNotice } from "@/components/listings/sample-data-notice";
import type { BrokerageProfile } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { SectionSkeleton } from "./section-skeleton";

export function BrokerageSection() {
  const { data, loading, error } = useQuery(() => getBrokerageState(), []);

  const missing = unavailableSubsystem(error);
  if (missing) return <SubsystemNotConnected subsystem={missing} />;
  if (error) return <BrokerageUnavailable notYetSynced={error instanceof BrokerageError && error.status === 403} />;
  if (loading || !data) return <SectionSkeleton rows={4} />;
  if (data.source === "sample") return <SampleBrokerage profile={data.profile} />;
  return <BrokerageIdentityCard initial={data} />;
}

function BrokerageUnavailable({ notYetSynced }: { notYetSynced: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Brokerage</CardTitle>
        <CardDescription>
          {notYetSynced
            ? "Your dashboard account is still being set up. Open Home once, then come back."
            : "The brokerage details could not be loaded right now. Try again shortly."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

// --- Stored identity -----------------------------------------------------------

type Mode = "view" | "edit";

function BrokerageIdentityCard({ initial }: { initial: BrokerageResponse }) {
  const [state, setState] = React.useState<BrokerageResponse>(initial);
  const [mode, setMode] = React.useState<Mode>("view");
  const [notice, setNotice] = React.useState<string | null>(null);
  const editButton = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef(false);

  // After Save or Cancel, focus goes back to the control that opened the
  // editor, so a keyboard user is not dropped at the top of the page.
  React.useEffect(() => {
    if (mode === "view" && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [mode]);

  const { identity, canEdit, officeConfigured } = state;
  const [syncing, setSyncing] = React.useState(false);

  async function refreshFromMls() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await syncBrokerageFromMls();
      if (result.identity) setState((s) => ({ ...s, identity: result.identity }));
      setNotice(
        result.ok
          ? "MLS office details refreshed."
          : result.status === "not_configured"
            ? "FortMark's MLS office is not configured in the system."
            : "The MLS could not be reached. Try again shortly."
      );
    } finally {
      setSyncing(false);
    }
  }

  function close(saved?: BrokerageResponse) {
    if (saved) {
      setState(saved);
      setNotice("Brokerage details saved.");
    }
    returnFocus.current = true;
    setMode("view");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>Brokerage</CardTitle>
          <CardDescription>
            The licensed brokerage this dashboard represents. A broker or admin maintains these details.
          </CardDescription>
        </div>
        {canEdit && identity && mode === "view" && (
          <Button
            ref={editButton}
            variant="outline"
            size="sm"
            onClick={() => {
              setNotice(null);
              setMode("edit");
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit brokerage
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <p role="status" className={cn("text-sm text-muted-foreground", !notice && "sr-only")}>
          {notice ?? ""}
        </p>
        {mode === "edit" && canEdit ? (
          <BrokerageEditor identity={identity} onSaved={(s) => close(s)} onCancel={() => close()} />
        ) : identity ? (
          <BrokerageDetails
            identity={identity}
            officeConfigured={officeConfigured}
            onRefresh={canEdit ? refreshFromMls : undefined}
            refreshing={syncing}
          />
        ) : canEdit ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Brokerage profile has not been configured.</p>
            <p className="text-sm text-muted-foreground">
              Add FortMark&apos;s legal name, brokerage licence and office. The MLS office is connected by
              the system and needs no entry here.
            </p>
            <Button
              ref={editButton}
              onClick={() => {
                setNotice(null);
                setMode("edit");
              }}
            >
              Configure brokerage
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Brokerage information is not available.</p>
            <p className="text-sm text-muted-foreground">A broker or admin has not entered the brokerage&apos;s details yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const NOT_PROVIDED = "Not provided";

function Row({
  label,
  value,
  hint,
  source,
}: {
  label: string;
  value: React.ReactNode | null;
  hint?: string;
  source?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm [overflow-wrap:anywhere]">
        {value ? (
          <span className="font-medium text-foreground">{value}</span>
        ) : (
          <span className="text-muted-foreground">{NOT_PROVIDED}</span>
        )}
        {source && value && (
          <Badge variant="outline" className="ml-2 align-middle text-[10px] font-medium">
            {source}
          </Badge>
        )}
        {hint && <span className="mt-0.5 block text-[12px] text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <dl className="grid gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function officeAddress(i: BrokerageView): string | null {
  const cityLine = [i.city, [i.state, i.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lines = [i.addressLine1, i.addressLine2, cityLine].filter(Boolean);
  return lines.length > 0 ? lines.join(", ") : null;
}

function displayPhone(v: string | null): string | null {
  if (!v) return null;
  return formatPhoneDisplay(v) ?? v;
}

function BrokerageDetails({
  identity,
  officeConfigured,
  onRefresh,
  refreshing,
}: {
  identity: BrokerageView;
  officeConfigured: boolean;
  onRefresh?: () => void;
  refreshing: boolean;
}) {
  const storedPhone = displayPhone(identity.officePhone);
  const mlsPhone = !storedPhone ? displayPhone(identity.mlsOfficePhone) : null;
  const synced = identity.mlsSyncedAt ? new Date(identity.mlsSyncedAt) : null;
  const updated = new Date(identity.updatedAt);

  return (
    <div className="space-y-6">
      <Group title="Identity">
        <Row label="Brokerage name" value={identity.displayName} />
      </Group>
      <Group title="Licence">
        <Row
          label="Brokerage licence (operator-provided)"
          value={identity.licenseNumber}
          hint="Entered by the brokerage. FortMark does not check licence status."
        />
        <Row label="Licence state" value={identity.licenseState} />
      </Group>
      <Group title="Office">
        <Row
          label="Office address"
          value={officeAddress(identity)}
          source={officeAddress(identity) ? "FortMark record" : undefined}
        />
      </Group>
      <Group title="Contact">
        <Row
          label="Office phone"
          value={storedPhone ?? mlsPhone}
          source={mlsPhone ? "From the MLS" : storedPhone ? "FortMark record" : undefined}
          hint={mlsPhone ? "Shown from the MLS because no office phone has been entered." : undefined}
        />
        <Row
          label="Website"
          value={
            identity.website ? (
              <a
                href={identity.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {identity.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            ) : null
          }
        />
      </Group>
      <Group title="MLS office · synced from MLS">
        <Row
          label="MLS office"
          value={
            identity.mlsOfficeId
              ? [identity.mlsOfficeName, identity.mlsOfficeId].filter(Boolean).join(" · ")
              : null
          }
          hint={
            identity.mlsOfficeId
              ? "System-managed. FortMark listings are this office's listings; agents are matched to it from their licence."
              : officeConfigured
                ? "Waiting for the first sync from the MLS."
                : "FortMark's MLS office is not configured in the system."
          }
        />
        <Row label="MLS office phone" value={displayPhone(identity.mlsOfficePhone)} />
        {synced && !Number.isNaN(synced.getTime()) && (
          <p className="text-[12px] text-muted-foreground sm:col-span-2">
            Last synced {synced.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        {onRefresh && (
          <div className="sm:col-span-2">
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh from MLS"}
            </Button>
          </div>
        )}
      </Group>
      {!Number.isNaN(updated.getTime()) && (
        <p className="text-[12px] text-muted-foreground">
          Last updated {updated.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </p>
      )}
    </div>
  );
}

// --- Editor ---------------------------------------------------------------------

type FormState = Record<BrokerageField, string>;

const EMPTY: FormState = {
  displayName: "",
  licenseNumber: "",
  licenseState: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  officePhone: "",
  website: "",
};

function toForm(identity: BrokerageView | null): FormState {
  if (!identity) return { ...EMPTY };
  return {
    displayName: identity.displayName,
    licenseNumber: identity.licenseNumber ?? "",
    licenseState: identity.licenseState ?? "",
    addressLine1: identity.addressLine1 ?? "",
    addressLine2: identity.addressLine2 ?? "",
    city: identity.city ?? "",
    state: identity.state ?? "",
    postalCode: identity.postalCode ?? "",
    officePhone: displayPhone(identity.officePhone) ?? "",
    website: identity.website ?? "",
  };
}

function toValues(form: FormState): BrokerageValues {
  const v = (s: string) => (s.trim() ? s.trim() : null);
  return {
    displayName: form.displayName.trim(),
    licenseNumber: v(form.licenseNumber),
    licenseState: v(form.licenseState),
    addressLine1: v(form.addressLine1),
    addressLine2: v(form.addressLine2),
    city: v(form.city),
    state: v(form.state),
    postalCode: v(form.postalCode),
    officePhone: v(form.officePhone),
    website: v(form.website),
  };
}

const FIELD_ORDER: BrokerageField[] = [
  "displayName",
  "licenseNumber",
  "licenseState",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "officePhone",
  "website",
];

const fieldId = (f: BrokerageField) => `brokerage-${f}`;

function BrokerageEditor({
  identity,
  onSaved,
  onCancel,
}: {
  identity: BrokerageView | null;
  onSaved: (state: BrokerageResponse) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState<FormState>(() => toForm(identity));
  const [errors, setErrors] = React.useState<BrokerageFieldErrors>({});
  const [saving, setSaving] = React.useState(false);
  const formError = React.useRef<HTMLParagraphElement>(null);

  // Opening the editor puts the cursor in its first field.
  React.useEffect(() => {
    document.getElementById(fieldId("displayName"))?.focus();
  }, []);

  function set(field: BrokerageField, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const result = await saveBrokerageIdentity(toValues(form)).catch(() => ({
      ok: false as const,
      status: 0,
      fieldErrors: { _form: "The brokerage details could not be saved. Try again." } as BrokerageFieldErrors,
    }));
    setSaving(false);
    if (result.ok) {
      onSaved(result.state);
      return;
    }
    setErrors(result.fieldErrors);
    const first = FIELD_ORDER.find((f) => result.fieldErrors[f]);
    // Move focus to the first field that needs attention, or to the form
    // message when the problem is not one field's.
    requestAnimationFrame(() => {
      if (first) document.getElementById(fieldId(first))?.focus();
      else formError.current?.focus();
    });
  }

  function field(
    name: BrokerageField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string; wide?: boolean } = {}
  ) {
    const { hint, wide, ...inputProps } = props;
    const id = fieldId(name);
    const error = errors[name];
    const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    return (
      <div className={cn("min-w-0 space-y-1.5", wide && "sm:col-span-2")}>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          name={name}
          value={form[name]}
          onChange={(e) => set(name, e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={saving}
          {...inputProps}
        />
        {hint && (
          <p id={`${id}-hint`} className="text-[12px] text-muted-foreground">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="text-[12px] font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  function stateSelect(name: "licenseState" | "state", label: string) {
    const id = fieldId(name);
    const error = errors[name];
    return (
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          name={name}
          value={form[name]}
          onChange={(e) => set(name, e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={saving}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Not set</option>
          {LICENSE_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${id}-error`} className="text-[12px] font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Edit brokerage details">
      {errors._form && (
        <p ref={formError} tabIndex={-1} role="alert" className="text-sm font-medium text-destructive">
          {errors._form}
        </p>
      )}
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-foreground">Identity</legend>
        {field("displayName", "Brokerage name", { required: true, wide: true, autoComplete: "organization", maxLength: 120 })}
      </fieldset>
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-foreground">Licence</legend>
        {field("licenseNumber", "Brokerage licence number", {
          maxLength: 30,
          autoComplete: "off",
          hint: "The brokerage's own licence, as issued. Not an agent's licence. FortMark does not check its status.",
        })}
        {stateSelect("licenseState", "Licence state")}
      </fieldset>
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-foreground">Office</legend>
        {field("addressLine1", "Address line 1", { wide: true, autoComplete: "address-line1", maxLength: 120 })}
        {field("addressLine2", "Address line 2", { wide: true, autoComplete: "address-line2", maxLength: 120 })}
        {field("city", "City", { autoComplete: "address-level2", maxLength: 120 })}
        <div className="grid min-w-0 grid-cols-2 gap-4">
          {stateSelect("state", "State")}
          {field("postalCode", "ZIP", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 10 })}
        </div>
      </fieldset>
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-foreground">Contact</legend>
        {field("officePhone", "Office phone", { type: "tel", autoComplete: "tel", maxLength: 20 })}
        {field("website", "Website", { type: "url", inputMode: "url", placeholder: "https://", maxLength: 400 })}
      </fieldset>
      <p className="text-[12px] text-muted-foreground">
        The MLS office is system-managed and synced from the MLS; it is not edited here.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// --- Fixture mode -----------------------------------------------------------------

/** Explicit sample mode only: generated details, labelled, read-only. */
function SampleBrokerage({ profile }: { profile: BrokerageProfile }) {
  return (
    <Card>
      <div className="px-6 pt-6">
        <SampleDataNotice subject="These office details are generated for development and describe no brokerage." />
      </div>
      <CardHeader>
        <CardTitle>Brokerage</CardTitle>
        <CardDescription>Sample office details.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Row label="Brokerage name" value={profile.name} />
          <Row label="Licence" value={profile.license} />
          <Row label="Office address" value={profile.address} />
          <Row label="Office phone" value={profile.phone} />
        </dl>
      </CardContent>
    </Card>
  );
}
