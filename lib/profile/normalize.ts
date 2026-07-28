/**
 * Pure validation and normalisation for professional profiles.
 *
 * Deliberately free of `server-only` and of any database import so the rules
 * that guard writes can be unit-tested directly. The service layer composes
 * these; it never re-implements them.
 */
import { z } from "zod";

/** US jurisdictions accepted for a real-estate licence. */
export const LICENSE_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
] as const;

export const LICENSE_TYPES = [
  "Sales Associate",
  "Broker Associate",
  "Broker",
  "Property Manager",
  "Other",
] as const;

/** Collapse internal runs of whitespace and trim; empty becomes null. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

/**
 * Best-effort E.164 for US/Canada numbers.
 *
 * Returns null when the input cannot be normalised confidently — storing a
 * half-parsed number is worse than storing nothing, because downstream code
 * would treat it as dialable.
 */
export function toE164(v: unknown): string | null {
  const raw = cleanText(v);
  if (!raw) return null;
  if (/^\+[1-9]\d{7,14}$/.test(raw.replace(/[\s()-]/g, ""))) {
    return raw.replace(/[\s()-]/g, "");
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Uppercase two-letter state, or null when not a known jurisdiction. */
export function toLicenseState(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const up = s.toUpperCase();
  return (LICENSE_STATES as readonly string[]).includes(up) ? up : null;
}

/** Trim, drop empties, de-duplicate case-insensitively, cap length. */
export function toStringList(v: unknown, max = 24): string[] {
  const src = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of src) {
    const s = cleanText(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** ISO date (YYYY-MM-DD) within a sane window, else null. */
export function toIsoDate(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject obvious data-entry errors in both directions.
  const year = Number(m[1]);
  if (year < 1970 || year > 2100) return null;
  // Round-trip guard catches impossible days like 2026-02-31.
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * The only fields a user may change about themselves.
 *
 * Role, status, access authority, Clerk id and the verified primary email are
 * absent by construction — an unknown key is stripped by Zod rather than
 * reaching the update statement.
 */
export const profileUpdateSchema = z
  .object({
    preferredDisplayName: z.string().max(120).optional(),
    legalFirstName: z.string().max(120).optional(),
    legalLastName: z.string().max(120).optional(),
    phoneE164: z.string().max(40).optional(),
    brokerageOffice: z.string().max(160).optional(),
    licenseState: z.string().max(40).optional(),
    licenseType: z.string().max(60).optional(),
    licenseNumber: z.string().max(60).optional(),
    licenseExpiration: z.string().max(20).optional(),
    nrdsNumber: z.string().max(40).optional(),
    biography: z.string().max(2000).optional(),
    languages: z.union([z.array(z.string()), z.string()]).optional(),
    specialties: z.union([z.array(z.string()), z.string()]).optional(),
    serviceAreas: z.union([z.array(z.string()), z.string()]).optional(),
  })
  .strip();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export interface NormalizedProfileUpdate {
  preferredDisplayName: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  phoneE164: string | null;
  brokerageOffice: string | null;
  licenseState: string | null;
  licenseType: string | null;
  licenseNumber: string | null;
  licenseExpiration: string | null;
  nrdsNumber: string | null;
  biography: string | null;
  languages: string[];
  specialties: string[];
  serviceAreas: string[];
}

/** Parse then normalise. Throws only on a schema violation, not on odd values. */
export function normalizeProfileUpdate(raw: unknown): NormalizedProfileUpdate {
  const input = profileUpdateSchema.parse(raw ?? {});
  return {
    preferredDisplayName: cleanText(input.preferredDisplayName),
    legalFirstName: cleanText(input.legalFirstName),
    legalLastName: cleanText(input.legalLastName),
    phoneE164: toE164(input.phoneE164),
    brokerageOffice: cleanText(input.brokerageOffice),
    licenseState: toLicenseState(input.licenseState),
    licenseType: cleanText(input.licenseType),
    // Licence numbers are compared by humans; collapse case and spacing but
    // never claim this verifies anything.
    licenseNumber: cleanText(input.licenseNumber)?.toUpperCase() ?? null,
    licenseExpiration: toIsoDate(input.licenseExpiration),
    nrdsNumber: cleanText(input.nrdsNumber),
    biography: cleanText(input.biography),
    languages: toStringList(input.languages),
    specialties: toStringList(input.specialties),
    serviceAreas: toStringList(input.serviceAreas),
  };
}

/** Fields that count toward completion, and their weights. */
const COMPLETION_FIELDS: Array<[keyof NormalizedProfileUpdate, number]> = [
  ["preferredDisplayName", 10],
  ["legalFirstName", 10],
  ["legalLastName", 10],
  ["phoneE164", 10],
  ["brokerageOffice", 5],
  ["licenseState", 10],
  ["licenseType", 5],
  ["licenseNumber", 10],
  ["licenseExpiration", 10],
  ["biography", 10],
  ["languages", 5],
  ["specialties", 5],
];

/** 0–100, rounded. Weights total 100 so a full profile reads exactly 100. */
export function profileCompletion(p: Partial<NormalizedProfileUpdate>): number {
  let earned = 0;
  let possible = 0;
  for (const [field, weight] of COMPLETION_FIELDS) {
    possible += weight;
    const v = p[field];
    const filled = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
    if (filled) earned += weight;
  }
  if (possible === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((earned / possible) * 100)));
}

/** Licence fields whose change invalidates any prior review. */
export const LICENSE_FIELDS = [
  "licenseState",
  "licenseType",
  "licenseNumber",
  "licenseExpiration",
] as const;

/** True when an update materially changes licence details. */
export function licenseDetailsChanged(
  before: Partial<NormalizedProfileUpdate> | null,
  after: Partial<NormalizedProfileUpdate>
): boolean {
  if (!before) return LICENSE_FIELDS.some((f) => after[f] != null);
  return LICENSE_FIELDS.some((f) => (before[f] ?? null) !== (after[f] ?? null));
}
