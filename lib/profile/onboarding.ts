/**
 * The onboarding step contract.
 *
 * This module is the single place that says which profile fields belong to
 * which step. The wizard renders from it, the draft API validates against it,
 * and the settings editor reuses the same groups — so a field cannot exist in
 * one surface with different rules in the other. Adding a field here adds it
 * everywhere, or nowhere.
 *
 * It deliberately owns no validation logic of its own: every step schema is
 * *derived* from `profileUpdateSchema`, so the allowlist that keeps role,
 * status, Clerk id and the verified email unwritable applies to each step
 * automatically rather than by being remembered.
 */
import { z } from "zod";
import {
  normalizeProfileUpdate,
  profileUpdateSchema,
  type NormalizedProfileUpdate,
} from "./normalize.ts";

/** Every field a step may write. Keys of the shared update contract only. */
export type ProfileFieldKey = keyof NormalizedProfileUpdate;

export type OnboardingStepId =
  | "identity"
  | "professional"
  | "credentials"
  | "contact"
  | "mls"
  | "review";

export interface OnboardingStep {
  id: OnboardingStepId;
  /** 1-based, and the value persisted to `professional_profiles.onboarding_step`. */
  step: number;
  title: string;
  /** Short sentence shown under the heading. */
  description: string;
  /** Fields this step persists. Empty for informational steps. */
  fields: readonly ProfileFieldKey[];
  /** Whether the user may move on without entering anything. */
  skippable: boolean;
  /**
   * Steps that only apply to licensed roles. Non-licensed roles skip them
   * entirely rather than being shown fields they can never fill in.
   */
  licensedOnly?: boolean;
}

/**
 * The ordered steps.
 *
 * `review` persists nothing.
 *
 * The `mls` step DOES persist as of Release B. Release A left it informational
 * on the reasoning that a column holding an unverified typed claim would
 * invite treating it as verified. That risk is real, and it is answered by
 * `mls_verification_status` — which records the claim AS a claim — rather than
 * by refusing to store the identity at all. Not storing it had its own cost:
 * the user typed an identifier into a step that threw it away.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "identity",
    step: 1,
    title: "Welcome to FortMark",
    description: "Start with your photo and how you would like to be addressed.",
    fields: ["preferredDisplayName", "legalFirstName", "legalLastName"],
    skippable: true,
  },
  {
    id: "professional",
    step: 2,
    title: "Professional identity",
    description: "Your title, office and a short professional biography.",
    // No `brokerageOffice`: it is assigned by FortMark, not entered. The step
    // still SHOWS it, as a locked value — see the wizard.
    fields: ["professionalTitle", "locationDisplay", "biography"],
    skippable: true,
  },
  {
    id: "credentials",
    step: 3,
    title: "Credentials",
    description: "Self-reported licence and association details.",
    fields: [
      "licenseState",
      "licenseType",
      "licenseNumber",
      "licenseExpiration",
      "nrdsNumber",
    ],
    skippable: true,
    licensedOnly: true,
  },
  {
    id: "contact",
    step: 4,
    title: "Contact information",
    description: "How clients reach you, and what appears on your FortMark card.",
    fields: [
      "businessEmail",
      "phoneE164",
      "whatsappPhoneE164",
      "personalWebsiteUrl",
      "professionalWebsiteUrl",
      "linkedinUrl",
      "instagramUrl",
      "facebookUrl",
    ],
    skippable: true,
  },
  {
    id: "mls",
    step: 5,
    title: "Your MLS identity",
    // Says what actually happens. The previous wording promised a verification
    // ahead of connecting listings that nothing in this application performs.
    description: "Record the MLS agent ID you already hold. FortMark stores it as provided.",
    fields: ["mlsAgentId", "mlsOrganization"],
    skippable: true,
  },
  {
    id: "review",
    step: 6,
    title: "Review and finish",
    description: "Check everything over before you finish.",
    fields: [],
    skippable: false,
  },
] as const;

export const FIRST_STEP = ONBOARDING_STEPS[0].step;
export const LAST_STEP = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1].step;

/** Roles that are asked for licence details. */
const LICENSED_ROLES = new Set(["agent", "broker"]);

/** Whether a role should be shown the credentials step at all. */
export function stepAppliesToRole(step: OnboardingStep, role: string | null | undefined): boolean {
  if (!step.licensedOnly) return true;
  return LICENSED_ROLES.has((role ?? "").trim().toLowerCase());
}

/** The steps a given role actually walks through, in order. */
export function stepsForRole(role: string | null | undefined): readonly OnboardingStep[] {
  return ONBOARDING_STEPS.filter((s) => stepAppliesToRole(s, role));
}

export function stepById(id: OnboardingStepId): OnboardingStep | null {
  return ONBOARDING_STEPS.find((s) => s.id === id) ?? null;
}

export function stepByNumber(step: unknown): OnboardingStep | null {
  if (typeof step !== "number" || !Number.isInteger(step)) return null;
  return ONBOARDING_STEPS.find((s) => s.step === step) ?? null;
}

/**
 * The Zod schema for one step, derived from the shared update contract.
 *
 * `.pick()` rather than a hand-written object: a step can only ever accept
 * fields that `profileUpdateSchema` already permits, so no step can widen the
 * write surface. Informational steps get an empty schema that still strips
 * unknown keys, so posting to them writes nothing.
 */
export function stepSchema(step: OnboardingStep) {
  if (step.fields.length === 0) return z.object({}).strip();
  const mask = Object.fromEntries(step.fields.map((f) => [f, true]));
  return profileUpdateSchema.pick(mask as never).strip();
}

/**
 * Parse and normalise a step's payload, returning ONLY that step's fields.
 *
 * The narrowing is the point: a draft save for step 2 cannot write a licence
 * number even if the client sends one, because the key never survives the
 * pick. Values are normalised by the same functions the full update uses.
 */
export function normalizeStep(
  step: OnboardingStep,
  raw: unknown
): Partial<NormalizedProfileUpdate> {
  const parsed = stepSchema(step).parse(raw ?? {}) as Record<string, unknown>;
  if (step.fields.length === 0) return {};
  // Normalise through the shared function, then keep only this step's keys.
  const normalised = normalizeProfileUpdate(parsed);
  const out: Partial<NormalizedProfileUpdate> = {};
  for (const key of step.fields) {
    // Each key is a literal key of the normalised shape, so this assignment is
    // type-safe field by field even though the loop erases the specific one.
    (out as Record<ProfileFieldKey, unknown>)[key] = normalised[key];
  }
  return out;
}

/**
 * Structured validation failures, keyed by the UI's field name.
 *
 * `fieldErrors` uses the same keys the form renders, so the client can attach
 * a message to a control without a translation table. Database column names
 * are never used — they differ from the field names in several places, and
 * leaking them would tell a caller about the schema for no benefit.
 */
export interface ValidationFailure {
  error: "validation_failed";
  fieldErrors: Partial<Record<ProfileFieldKey, string[]>>;
  formErrors: string[];
}

/**
 * Human messages for the rules the shared schema enforces.
 *
 * Kept beside the field list rather than in the route so both the step API and
 * the full-profile API produce identical wording, and adding a field cannot
 * leave one surface without a message.
 */
const FIELD_MESSAGE: Partial<Record<ProfileFieldKey, string>> = {
  businessEmail: "Enter a valid email address.",
  phoneE164: "Enter a valid phone number.",
  whatsappPhoneE164: "Enter a valid phone number.",
  licenseExpiration: "Enter a date as YYYY-MM-DD.",
  licenseState: "Enter a two-letter state code.",
  linkedinUrl: "Enter a valid web address.",
  instagramUrl: "Enter a valid web address.",
  facebookUrl: "Enter a valid web address.",
  personalWebsiteUrl: "Enter a valid web address.",
  professionalWebsiteUrl: "Enter a valid web address.",
  mlsAgentId:
    "Enter your MLS agent ID — 3 to 32 letters, numbers, hyphens or underscores.",
  mlsOrganization: "Choose your MLS or board.",
};

function messageFor(key: ProfileFieldKey, fallback: string): string {
  return FIELD_MESSAGE[key] ?? fallback;
}

/**
 * Turn a Zod error into the field-error contract.
 *
 * Only keys the caller was allowed to submit are returned. Anything else —
 * including a key Zod complained about because the client sent something it
 * should not have — becomes a form-level message, so the response never
 * confirms the existence of a field outside the step.
 */
export function toValidationFailure(
  error: z.ZodError,
  allowed: readonly ProfileFieldKey[]
): ValidationFailure {
  const fieldErrors: Partial<Record<ProfileFieldKey, string[]>> = {};
  const formErrors: string[] = [];
  const permitted = new Set<string>(allowed);

  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && permitted.has(key)) {
      const field = key as ProfileFieldKey;
      const list = fieldErrors[field] ?? [];
      list.push(messageFor(field, "That value could not be accepted."));
      fieldErrors[field] = list;
    } else {
      formErrors.push("Some values could not be accepted.");
    }
  }

  return { error: "validation_failed", fieldErrors, formErrors: [...new Set(formErrors)] };
}

/**
 * Values that parsed but normalised away to null.
 *
 * The normalisers are deliberately forgiving — an unusable URL or phone number
 * becomes null rather than throwing, so one bad paste cannot block a whole
 * save. That is right for storage and wrong for feedback: silently dropping
 * what someone typed looks like the field simply did not save. This reports
 * those fields so the user is told, while the good values still persist.
 */
export function droppedValueErrors(
  submitted: Record<string, unknown>,
  normalised: Partial<Record<ProfileFieldKey, unknown>>,
  allowed: readonly ProfileFieldKey[]
): Partial<Record<ProfileFieldKey, string[]>> {
  const out: Partial<Record<ProfileFieldKey, string[]>> = {};
  for (const key of allowed) {
    const raw = submitted[key];
    const typed = typeof raw === "string" ? raw.trim() : "";
    if (typed.length > 0 && normalised[key] === null) {
      out[key] = [messageFor(key, "That value could not be accepted.")];
    }
  }
  return out;
}

/**
 * The step that owns a field, or null when no step collects it.
 *
 * Derived from `ONBOARDING_STEPS` rather than written out, so a field cannot be
 * moved between steps and leave a stale map behind.
 */
export function stepForField(key: ProfileFieldKey): OnboardingStep | null {
  return ONBOARDING_STEPS.find((s) => s.fields.includes(key)) ?? null;
}

/**
 * The earliest step containing any of these fields.
 *
 * This is what stops Review being a dead end. Completion validates the whole
 * profile, so it can reject a value belonging to a step the user left long ago
 * — and Review renders no inputs, so attaching the error there would show the
 * user nothing at all. Routing back to the owning step puts the message beside
 * the control that can actually fix it.
 */
export function earliestStepForFields(
  keys: readonly string[]
): OnboardingStep | null {
  let best: OnboardingStep | null = null;
  for (const key of keys) {
    const step = stepForField(key as ProfileFieldKey);
    if (!step) continue;
    if (!best || step.step < best.step) best = step;
  }
  return best;
}

/**
 * Where the wizard should resume.
 *
 * `onboardingStep` is the last step that SAVED successfully, so the user
 * resumes on the one after it. Anything out of range — null, zero, a value
 * from a future release, a hand-edited row — falls back to the first step
 * rather than to a step that may not exist.
 */
export function resumeStep(
  onboardingStep: number | null | undefined,
  role?: string | null
): OnboardingStep {
  const applicable = stepsForRole(role);
  const first = applicable[0] ?? ONBOARDING_STEPS[0];
  if (typeof onboardingStep !== "number" || !Number.isInteger(onboardingStep)) return first;
  const next = applicable.find((s) => s.step > onboardingStep);
  // Past the end means every step was saved; land on review to finish.
  return next ?? applicable[applicable.length - 1] ?? first;
}

/** The step after `step` for this role, or null when it is the last one. */
export function nextStep(step: OnboardingStep, role?: string | null): OnboardingStep | null {
  const applicable = stepsForRole(role);
  return applicable.find((s) => s.step > step.step) ?? null;
}

/** The step before `step` for this role, or null when it is the first one. */
export function previousStep(step: OnboardingStep, role?: string | null): OnboardingStep | null {
  const applicable = stepsForRole(role).filter((s) => s.step < step.step);
  return applicable[applicable.length - 1] ?? null;
}

/**
 * Whether onboarding is finished.
 *
 * Reads `dashboard_users.onboarding_complete` and nothing else. There is
 * deliberately no second status column: two records of the same fact can
 * disagree, and then nothing says which one is right.
 */
export function onboardingComplete(user: { onboardingComplete?: Date | string | null } | null): boolean {
  return Boolean(user?.onboardingComplete);
}

/**
 * Whether the wizard should open on its own for this request.
 *
 * Every condition must hold. In particular a missing profile row is NOT
 * treated as "show the wizard" on its own — the caller passes
 * `databaseAvailable: false` when the profile store could not be reached, and
 * an unreachable database must land on the ordinary session-only dashboard
 * rather than trapping the user in onboarding they cannot save.
 */
export function shouldOpenOnboarding(input: {
  uiEnabled: boolean;
  databaseEnabled: boolean;
  databaseAvailable: boolean;
  user: { onboardingComplete?: Date | string | null } | null;
  dismissedThisSession?: boolean;
}): boolean {
  if (!input.uiEnabled || !input.databaseEnabled) return false;
  if (!input.databaseAvailable) return false;
  if (!input.user) return false;
  if (onboardingComplete(input.user)) return false;
  if (input.dismissedThisSession) return false;
  return true;
}
