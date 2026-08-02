"use client";

/**
 * The profile onboarding wizard.
 *
 * Renders the steps declared in `lib/profile/onboarding.ts` using the shared
 * field components, so it cannot ask for a field the settings editor does not
 * know about, or validate one differently.
 *
 * State rules that matter:
 *   - a step is only marked saved after the SERVER write succeeds
 *   - the step never advances on a failed write
 *   - "Complete later" leaves onboarding incomplete on purpose
 *   - nothing here writes to a global store, so no profile value becomes
 *     ambient client state
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProfileField, ReadOnlyField } from "@/components/profile/profile-field";
import { ProfileImageUpload } from "@/components/profile/profile-image-upload";
import { PROFILE_FIELDS, PUBLIC_SURFACE_FIELDS } from "@/lib/profile/fields";
import {
  type OnboardingStep,
  type ProfileFieldKey,
  nextStep as nextStepFor,
  previousStep as previousStepFor,
} from "@/lib/profile/onboarding";
import { apiPath, ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

export interface OnboardingWizardProps {
  steps: readonly OnboardingStep[];
  /** Step to open on, already resolved server-side from `onboarding_step`. */
  initialStep: number;
  /** Current stored values, for prefilling. Only editable fields. */
  values: Partial<Record<ProfileFieldKey, string | null>>;
  /** Verified Clerk sign-in address. Displayed read-only, never submitted. */
  accountEmail: string | null;
  role: string | null;
  /** Current active profile image, for the step 1 preview. */
  currentImageUrl?: string | null;
}

/** Server contract: field name -> messages. Same shape the editor consumes. */
type FieldErrors = Partial<Record<ProfileFieldKey, string[]>>;

export function OnboardingWizard({
  steps,
  initialStep,
  values,
  accountEmail,
  role,
  currentImageUrl = null,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [current, setCurrent] = React.useState<OnboardingStep>(
    () => steps.find((s) => s.step === initialStep) ?? steps[0]
  );
  const [stored, setStored] = React.useState(values);
  // Local to this component. Image state never enters a global store.
  const [imageUrl, setImageUrl] = React.useState<string | null>(currentImageUrl);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const index = steps.findIndex((s) => s.step === current.step);
  const isLast = index === steps.length - 1;

  // Focus the new step's heading so a keyboard or screen-reader user lands on
  // the change rather than staying on a button that no longer means anything.
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [current.step]);

  function readForm(): Record<string, string> {
    const out: Record<string, string> = {};
    const form = formRef.current;
    if (!form) return out;
    // `FormData` rather than `elements.namedItem`: the latter returns a
    // RadioNodeList when names collide, and reading `.value` off that is a
    // different thing than reading the field.
    const data = new FormData(form);
    for (const key of current.fields) {
      const v = data.get(key);
      out[key] = typeof v === "string" ? v : "";
    }
    return out;
  }

  /** Save the current step. Returns true only when the server confirmed it. */
  async function saveCurrent(): Promise<boolean> {
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const body = { step: current.step, values: readForm() };
      const res = await fetch(apiPath("/api/profile/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { error?: string; fieldErrors?: FieldErrors; formErrors?: string[] }
          | null;
        const fields = detail?.fieldErrors ?? {};
        setFieldErrors(fields);
        const invalid = Object.keys(fields);
        setFormError(
          invalid.length > 0
            ? `Check ${invalid.length === 1 ? "the highlighted field" : `${invalid.length} highlighted fields`} and try again.`
            : (detail?.formErrors?.[0] ?? "That did not save. Please try again.")
        );
        // Move focus to the first control the server rejected, in the order
        // the step declares them rather than object-key order, so focus lands
        // where the eye already is.
        const firstInvalid = current.fields.find((f) => invalid.includes(f));
        if (firstInvalid) {
          requestAnimationFrame(() => {
            const el = document.getElementById(`field-${firstInvalid}`);
            if (el instanceof HTMLElement) el.focus();
          });
        }
        return false;
      }
      setStored((prev) => ({ ...prev, ...body.values }));
      return true;
    } catch {
      setFormError("That did not save. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onNext() {
    // Informational steps persist nothing, so there is nothing to confirm.
    const ok = current.fields.length === 0 ? true : await saveCurrent();
    if (!ok) return; // never advance past a failed write
    const next = nextStepFor(current, role);
    if (next) setCurrent(next);
  }

  function onBack() {
    const prev = previousStepFor(current, role);
    if (prev) setCurrent(prev);
  }

  async function onCompleteLater() {
    // Save what is valid, then leave. Onboarding stays incomplete by design.
    if (current.fields.length > 0) await saveCurrent();
    // Ask the server to set the session deferral cookie. It is HttpOnly, so it
    // has to be set here rather than from the document — and it must land
    // BEFORE navigating, or Home would redirect straight back.
    try {
      await fetch(apiPath("/api/profile/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defer: true }),
      });
    } catch {
      // Deferral is a convenience. If it fails the user still reaches Home;
      // the wizard may prompt again, which is the safe direction to fail.
    }
    router.push(ROUTES.home);
    router.refresh();
  }

  async function onFinish() {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(apiPath("/api/profile/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true, values: stored }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { fieldErrors?: FieldErrors; formErrors?: string[] }
          | null;
        if (detail?.fieldErrors) setFieldErrors(detail.fieldErrors);
        setFormError(
          detail?.formErrors?.[0] ??
            "Could not finish setup. Check the highlighted fields and try again."
        );
        return;
      }
      router.push(ROUTES.home);
      // Refresh so the Home card and completion state reflect the new profile.
      router.refresh();
    } catch {
      setFormError("Could not finish setup. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {/* STEP INDICATOR ---------------------------------------------------- */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">
          Step {index + 1} of {steps.length}
        </p>
        <ol className="mt-2 flex gap-1.5" aria-label="Onboarding progress">
          {steps.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.step === current.step ? "step" : undefined}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= index ? "bg-foreground/70" : "bg-foreground/10"
              )}
            >
              <span className="sr-only">
                {s.title}
                {i < index ? " (completed)" : s.step === current.step ? " (current)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[20px] font-semibold leading-tight outline-none lg:text-[22px]"
        >
          {current.title}
        </h1>
        <p className="mt-1 text-[13px] text-foreground/70">{current.description}</p>
      </div>

      {/* FIELDS ------------------------------------------------------------ */}
      <form ref={formRef} className="space-y-5" onSubmit={(e) => e.preventDefault()}>
        {current.id === "identity" && (
          <ProfileImageUpload
            currentUrl={imageUrl}
            displayName={stored.preferredDisplayName || accountEmail || "FortMark"}
            onUploaded={setImageUrl}
            disabled={saving}
          />
        )}

        {current.id === "contact" && accountEmail && (
          <ReadOnlyField
            label="Account email"
            value={accountEmail}
            hint="Your verified sign-in address. It cannot be changed here, and is not published unless you enter it below."
          />
        )}

        {current.fields.map((key) => (
          <ProfileField
            key={key}
            name={key}
            defaultValue={stored[key] ?? ""}
            error={fieldErrors[key]?.[0] ?? null}
            disabled={saving}
          />
        ))}

        {current.id === "credentials" && (
          <p className="rounded-panel border border-border bg-foreground/[0.03] p-3 text-[12px] text-foreground/70">
            Licence and NRDS details are self-reported. FortMark displays them as
            provided and does not verify them with any authority.
          </p>
        )}

        {current.id === "mls" && (
          <div className="rounded-panel border border-border bg-foreground/[0.03] p-4">
            <p className="text-[13px] font-semibold text-foreground">Not connected</p>
            <p className="mt-1 text-[12px] leading-snug text-foreground/70">
              Connecting your MLS identity will bring your own listings into the
              dashboard. Verification and connection arrive in the next release —
              nothing is stored or claimed on your behalf yet.
            </p>
          </div>
        )}

        {current.id === "review" && (
          <ReviewSummary values={stored} accountEmail={accountEmail} />
        )}
      </form>

      {formError && (
        <p role="alert" className="text-[13px] font-medium text-destructive">
          {formError}
        </p>
      )}

      {/* ACTIONS ----------------------------------------------------------- */}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          className="h-10 min-w-0 border border-foreground/45 bg-transparent px-3 text-[12px] sm:h-9"
          onClick={onCompleteLater}
          disabled={saving}
        >
          Complete later
        </Button>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button
            variant="outline"
            className="h-10 min-w-0 border-foreground/45 px-3 text-[13px]"
            onClick={onBack}
            disabled={saving || index === 0}
          >
            <ArrowLeft />
            <span className="truncate">Back</span>
          </Button>
          {isLast ? (
            <Button size="lg" className="h-10 min-w-0 px-3 text-[13px]" onClick={onFinish} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />}
              <span className="truncate">{saving ? "Finishing" : "Finish setup"}</span>
            </Button>
          ) : (
            <Button size="lg" className="h-10 min-w-0 px-3 text-[13px]" onClick={onNext} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              <span className="truncate">{saving ? "Saving" : "Save and continue"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Announced only after the server confirmed the write. */}
      <p aria-live="polite" className="sr-only">
        {saving ? "Saving your details" : ""}
      </p>
    </Card>
  );
}

/** Final read-back. Shows what will appear publicly, and what is missing. */
function ReviewSummary({
  values,
  accountEmail,
}: {
  values: Partial<Record<ProfileFieldKey, string | null>>;
  accountEmail: string | null;
}) {
  return (
    <div className="space-y-4">
      {accountEmail && (
        <div className="text-[13px]">
          <span className="text-foreground/55">Account email</span>
          <p className="font-medium text-foreground">{accountEmail}</p>
        </div>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {PUBLIC_SURFACE_FIELDS.map((key) => {
          const v = values[key];
          return (
            <div key={key} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/70">
                {PROFILE_FIELDS[key].label}
              </dt>
              <dd className="mt-1 truncate text-[13px] font-medium text-foreground">
                {v && v.trim().length > 0 ? (
                  v
                ) : (
                  <span className="font-normal text-foreground/55">Not added</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-[12px] text-foreground/55">
        These fields appear on My FortMark and your digital card. Anything left
        blank simply does not appear.
      </p>
    </div>
  );
}
