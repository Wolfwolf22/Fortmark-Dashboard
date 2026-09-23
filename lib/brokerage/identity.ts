/**
 * Brokerage identity — pure rules, no I/O. Importable by tests and by the
 * browser (types, validation messages).
 *
 * The domain answers one question: which licensed brokerage does this
 * dashboard represent? Every stored value is FortMark-owned and
 * operator-provided. The MLS may supplement the DISPLAY (its office phone, as
 * a labelled fallback) but never writes here.
 *
 * Validation is shape only. A brokerage licence number is stored as the
 * operator typed it (normalised), never "verified": there is no licensing
 * authority integration, so nothing here may claim active, expired or good
 * standing.
 */
import { z } from "zod";
import type { DbRole } from "../auth/actor.ts";
import {
  LICENSE_NUMBER_MESSAGE,
  LICENSE_STATES,
  cleanText,
  isValidLicenseNumber,
  toE164,
} from "../profile/normalize.ts";

// --- Who may edit ------------------------------------------------------------

/**
 * Admin and broker only. Transaction coordinators are privileged for records
 * but do not own the brokerage's legal identity; agents and members read it.
 */
export const BROKERAGE_EDITOR_ROLES: readonly DbRole[] = ["admin", "broker"];

export function canEditBrokerage(role: DbRole): boolean {
  return BROKERAGE_EDITOR_ROLES.includes(role);
}

// --- Input -------------------------------------------------------------------

/**
 * The editable fields, and nothing else. `.strict()` refuses any other key —
 * in particular a `brokerageKey`, `id`, role or user id in the body is a 400,
 * not something quietly ignored. The tenant always comes from the session.
 */
export const brokerageInputSchema = z
  .object({
    displayName: z.string().max(200),
    licenseNumber: z.string().max(60).nullish(),
    licenseState: z.string().max(10).nullish(),
    addressLine1: z.string().max(200).nullish(),
    addressLine2: z.string().max(200).nullish(),
    city: z.string().max(120).nullish(),
    state: z.string().max(10).nullish(),
    postalCode: z.string().max(20).nullish(),
    officePhone: z.string().max(40).nullish(),
    website: z.string().max(400).nullish(),
    mlsOfficeId: z.string().max(40).nullish(),
  })
  .strict();

export type BrokerageField = keyof z.infer<typeof brokerageInputSchema>;

export interface BrokerageValues {
  displayName: string;
  licenseNumber: string | null;
  licenseState: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  officePhone: string | null;
  website: string | null;
  mlsOfficeId: string | null;
}

export const BROKERAGE_FIELDS: readonly BrokerageField[] = [
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
  "mlsOfficeId",
];

const US_STATE = new Set<string>(LICENSE_STATES);
const POSTAL = /^\d{5}(?:-\d{4})?$/;
const MLS_OFFICE = /^[A-Z0-9]{2,20}$/;

/**
 * An http(s) website, or null. A bare domain gains `https://`. Anything with
 * another scheme (`javascript:`, `data:`, `ftp:`), embedded credentials, or no
 * dotted host is refused rather than stored.
 */
export function toWebsite(v: unknown): { ok: true; value: string | null } | { ok: false } {
  const s = cleanText(v);
  if (!s) return { ok: true, value: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false };
    if (url.username || url.password) return { ok: false };
    if (!url.hostname.includes(".") || /\s/.test(s)) return { ok: false };
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false };
  }
}

export type BrokerageParse =
  | { ok: true; value: BrokerageValues }
  | { ok: false; fieldErrors: Partial<Record<BrokerageField | "_form", string>> };

/** Validate and normalise one save. Field errors are per field, for the form. */
export function parseBrokerageInput(raw: unknown): BrokerageParse {
  const shape = brokerageInputSchema.safeParse(raw ?? {});
  if (!shape.success) {
    const unknown = shape.error.issues.find((i) => i.code === "unrecognized_keys");
    return {
      ok: false,
      fieldErrors: {
        _form: unknown
          ? "Only brokerage details can be saved here."
          : "Some details were not in a form that could be saved.",
      },
    };
  }
  const input = shape.data;
  const errors: Partial<Record<BrokerageField, string>> = {};

  const displayName = cleanText(input.displayName);
  if (!displayName || displayName.length < 2 || displayName.length > 120) {
    errors.displayName = "Enter the brokerage's name (2–120 characters).";
  }

  const licenseNumber = cleanText(input.licenseNumber)?.toUpperCase() ?? null;
  if (licenseNumber && !isValidLicenseNumber(licenseNumber)) errors.licenseNumber = LICENSE_NUMBER_MESSAGE;

  const licenseState = cleanText(input.licenseState)?.toUpperCase() ?? null;
  if (licenseState && !US_STATE.has(licenseState)) errors.licenseState = "Use a two-letter US state, e.g. FL.";

  const addressLine1 = cleanText(input.addressLine1);
  const addressLine2 = cleanText(input.addressLine2);
  const city = cleanText(input.city);
  for (const [key, value] of [["addressLine1", addressLine1], ["addressLine2", addressLine2], ["city", city]] as const) {
    if (value && value.length > 120) errors[key] = "Keep this under 120 characters.";
  }

  const state = cleanText(input.state)?.toUpperCase() ?? null;
  if (state && !US_STATE.has(state)) errors.state = "Use a two-letter US state, e.g. FL.";

  const postalCode = cleanText(input.postalCode);
  if (postalCode && !POSTAL.test(postalCode)) errors.postalCode = "Use a 5-digit ZIP, or ZIP+4.";

  const rawPhone = cleanText(input.officePhone);
  const officePhone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !officePhone) errors.officePhone = "Enter a 10-digit US phone number.";

  const site = toWebsite(input.website);
  if (!site.ok) errors.website = "Enter a web address starting with http:// or https://.";

  const mlsOfficeId = cleanText(input.mlsOfficeId)?.toUpperCase() ?? null;
  if (mlsOfficeId && !MLS_OFFICE.test(mlsOfficeId)) {
    errors.mlsOfficeId = "Use the MLS office id exactly as the MLS issues it (letters and digits).";
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      displayName: displayName as string,
      licenseNumber,
      licenseState,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      officePhone,
      website: site.ok ? site.value : null,
      mlsOfficeId,
    },
  };
}

/** Field names whose value differs — for the audit event. Names only. */
export function changedFields(before: BrokerageValues | null, after: BrokerageValues): BrokerageField[] {
  return BROKERAGE_FIELDS.filter((f) => (before ? before[f] : null) !== after[f]);
}

// --- Output ------------------------------------------------------------------

/** What the browser receives. No row id, tenant key or user ids. */
export interface BrokerageView extends BrokerageValues {
  updatedAt: string;
}

export interface MlsOfficeView {
  name: string | null;
  phone: string | null;
}

export interface BrokerageResponse {
  identity: BrokerageView | null;
  canEdit: boolean;
  /**
   * The MLS's own description of the configured office, when the MLS is
   * connected and the office currently has a listing in the feed. Display
   * supplement only; never stored.
   */
  mlsOffice: MlsOfficeView | null;
}

export function toBrokerageView(row: BrokerageValues & { updatedAt: Date | string }): BrokerageView {
  const values = Object.fromEntries(BROKERAGE_FIELDS.map((f) => [f, row[f] ?? null])) as unknown as BrokerageValues;
  return {
    ...values,
    displayName: row.displayName,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
