/**
 * Presentation metadata for every editable profile field.
 *
 * The wizard and the settings editor both render from this table, so a field
 * has one label, one input type, one hint and one length limit wherever it
 * appears. Validation is NOT here — that stays in `normalize.ts`, and this
 * table only describes how to ask for a value.
 *
 * Server-safe on purpose: no JSX and no React import, so a server component can
 * read it to build a review summary without pulling the client bundle in.
 */
import type { ProfileFieldKey } from "./onboarding.ts";

export type FieldKind = "text" | "textarea" | "tel" | "email" | "url" | "date";

export interface FieldMeta {
  key: ProfileFieldKey;
  label: string;
  kind: FieldKind;
  /** Shown under the input. Explains a rule or where the value appears. */
  hint?: string;
  placeholder?: string;
  /** Mirrors the Zod max so the browser and the server agree. */
  maxLength?: number;
  autoComplete?: string;
}

export const PROFILE_FIELDS: Record<ProfileFieldKey, FieldMeta> = {
  preferredDisplayName: {
    key: "preferredDisplayName",
    label: "Preferred display name",
    kind: "text",
    hint: "How your name appears on My FortMark and your digital card.",
    maxLength: 120,
    autoComplete: "name",
  },
  legalFirstName: {
    key: "legalFirstName",
    label: "Legal first name",
    kind: "text",
    maxLength: 120,
    autoComplete: "given-name",
  },
  legalLastName: {
    key: "legalLastName",
    label: "Legal last name",
    kind: "text",
    maxLength: 120,
    autoComplete: "family-name",
  },
  professionalTitle: {
    key: "professionalTitle",
    label: "Professional title",
    kind: "text",
    hint: "For example Real Estate Agent, Broker Associate or Managing Broker.",
    placeholder: "Broker Associate",
    maxLength: 120,
  },
  brokerageOffice: {
    key: "brokerageOffice",
    label: "Brokerage",
    kind: "text",
    hint: "Assigned by FortMark",
    maxLength: 160,
  },
  locationDisplay: {
    key: "locationDisplay",
    label: "Location",
    kind: "text",
    placeholder: "Fort Lauderdale, FL",
    maxLength: 120,
  },
  biography: {
    key: "biography",
    label: "Biography",
    kind: "textarea",
    hint: "A short professional summary.",
    maxLength: 2000,
  },
  licenseState: {
    key: "licenseState",
    label: "Licence state",
    kind: "text",
    hint: "Two-letter state code.",
    placeholder: "FL",
    maxLength: 40,
  },
  licenseType: {
    key: "licenseType",
    label: "Licence type",
    kind: "text",
    placeholder: "Broker",
    maxLength: 60,
  },
  licenseNumber: {
    key: "licenseNumber",
    label: "Licence number",
    kind: "text",
    hint: "Self-reported. FortMark does not verify licence details.",
    maxLength: 60,
  },
  licenseExpiration: {
    key: "licenseExpiration",
    label: "Licence expiration",
    kind: "date",
    hint: "Self-reported.",
    maxLength: 20,
  },
  nrdsNumber: {
    key: "nrdsNumber",
    label: "NRDS ID",
    kind: "text",
    hint: "Self-reported. FortMark does not verify association membership.",
    maxLength: 40,
  },
  businessEmail: {
    key: "businessEmail",
    label: "Business email",
    kind: "email",
    hint: "The address you publish. Separate from your account sign-in email.",
    maxLength: 254,
    autoComplete: "email",
  },
  phoneE164: {
    key: "phoneE164",
    label: "Phone",
    kind: "tel",
    hint: "Stored in international format.",
    maxLength: 40,
    autoComplete: "tel",
  },
  whatsappPhoneE164: {
    key: "whatsappPhoneE164",
    label: "WhatsApp",
    kind: "tel",
    hint: "Optional. Adds a WhatsApp shortcut to your card.",
    maxLength: 40,
  },
  personalWebsiteUrl: {
    key: "personalWebsiteUrl",
    label: "Personal website",
    kind: "url",
    maxLength: 400,
  },
  professionalWebsiteUrl: {
    key: "professionalWebsiteUrl",
    label: "Professional website",
    kind: "url",
    maxLength: 400,
  },
  linkedinUrl: { key: "linkedinUrl", label: "LinkedIn", kind: "url", maxLength: 400 },
  instagramUrl: { key: "instagramUrl", label: "Instagram", kind: "url", maxLength: 400 },
  facebookUrl: { key: "facebookUrl", label: "Facebook", kind: "url", maxLength: 400 },
  languages: { key: "languages", label: "Languages", kind: "text", maxLength: 400 },
  specialties: { key: "specialties", label: "Specialties", kind: "text", maxLength: 400 },
  serviceAreas: { key: "serviceAreas", label: "Service areas", kind: "text", maxLength: 400 },
};

/**
 * Fields the application assigns, which the user can never edit.
 *
 * Separated from the editable set so a form built by iterating fields cannot
 * accidentally render an input for one — the omission is structural rather
 * than something each surface has to remember.
 */
export const SYSTEM_ASSIGNED_FIELDS: readonly ProfileFieldKey[] = ["brokerageOffice"];

export function isSystemAssignedField(key: ProfileFieldKey): boolean {
  return SYSTEM_ASSIGNED_FIELDS.includes(key);
}

/** Fields whose value is only ever self-reported, never verified by FortMark. */
export const SELF_REPORTED_FIELDS: readonly ProfileFieldKey[] = [
  "licenseState",
  "licenseType",
  "licenseNumber",
  "licenseExpiration",
  "nrdsNumber",
];

/** Fields that appear publicly on the Home card or the digital card. */
export const PUBLIC_SURFACE_FIELDS: readonly ProfileFieldKey[] = [
  "preferredDisplayName",
  "professionalTitle",
  "brokerageOffice",
  "locationDisplay",
  "businessEmail",
  "phoneE164",
  "whatsappPhoneE164",
  "personalWebsiteUrl",
  "professionalWebsiteUrl",
  "linkedinUrl",
  "instagramUrl",
  "facebookUrl",
];

export function fieldMeta(key: ProfileFieldKey): FieldMeta {
  return PROFILE_FIELDS[key];
}
