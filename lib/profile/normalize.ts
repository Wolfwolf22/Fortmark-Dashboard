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

/**
 * URL schemes a profile link may use. Anything else — `javascript:`, `data:`,
 * `file:`, `vbscript:`, `blob:`, custom app schemes — is rejected outright
 * rather than escaped, because these values are rendered as `href`s.
 */
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Normalise a user-supplied profile URL, or return null.
 *
 * `https://` is added when a bare host was clearly intended (`fortmark.net`,
 * `www.example.com/x`). A missing scheme is only inferred when the string has
 * no scheme at all — `javascript:alert(1)` is never rescued into
 * `https://javascript:alert(1)`, it is rejected.
 *
 * Plain `http://` input is upgraded to `https://`: every host we link to is a
 * public social or business site, and an insecure outbound link from an
 * institutional dashboard is not worth preserving.
 */
export function toProfileUrl(v: unknown): string | null {
  const raw = typeof v === "string" ? v.trim() : "";
  if (raw.length === 0 || raw.length > 400) return null;
  // Reject control characters and whitespace outright — a URL containing them
  // is either an injection attempt or a paste accident. Hyphens are fine:
  // the class is whitespace plus C0/C1 control characters, nothing more.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) return null;
  // A hostname must contain a dot and no credentials; `https://localhost` and
  // `https://user:pw@host` are not valid professional links.
  if (!url.hostname.includes(".")) return null;
  if (url.username || url.password) return null;

  url.protocol = "https:";
  // Drop a bare trailing slash so `example.com` and `example.com/` agree.
  const out = url.toString();
  return url.pathname === "/" && !url.search && !url.hash ? out.replace(/\/$/, "") : out;
}

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
 * A publishable email address, lowercased, or null.
 *
 * Deliberately conservative rather than RFC-complete: this value is rendered
 * as a `mailto:` on the Home card and the digital card, so the bar is "safe to
 * put in an href", not "provably deliverable". Anything with whitespace,
 * control characters, more than one `@`, or a dotless domain is refused
 * outright instead of being half-repaired.
 *
 * Never used for authentication. The verified sign-in address lives on
 * `dashboard_users.primary_email` and is not writable from here.
 */
export function toEmail(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  if (s.length > 254) return null;
  if (/[\s<>()[\]\\,;:"]/.test(s)) return null;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return null;
  const domain = s.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
  if (domain.includes("..")) return null;
  return s.toLowerCase();
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
    // --- Release 1.1: professional presence -------------------------------
    professionalTitle: z.string().max(120).optional(),
    locationDisplay: z.string().max(120).optional(),
    linkedinUrl: z.string().max(400).optional(),
    instagramUrl: z.string().max(400).optional(),
    facebookUrl: z.string().max(400).optional(),
    personalWebsiteUrl: z.string().max(400).optional(),
    professionalWebsiteUrl: z.string().max(400).optional(),
    whatsappPhoneE164: z.string().max(40).optional(),
    // --- Release A: onboarding --------------------------------------------
    businessEmail: z.string().max(254).optional(),
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
  professionalTitle: string | null;
  locationDisplay: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  personalWebsiteUrl: string | null;
  professionalWebsiteUrl: string | null;
  whatsappPhoneE164: string | null;
  businessEmail: string | null;
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
    professionalTitle: cleanText(input.professionalTitle),
    locationDisplay: cleanText(input.locationDisplay),
    // Every URL goes through the scheme allowlist; an unsafe value becomes
    // null rather than throwing, so one bad paste cannot block a whole save.
    linkedinUrl: toProfileUrl(input.linkedinUrl),
    instagramUrl: toProfileUrl(input.instagramUrl),
    facebookUrl: toProfileUrl(input.facebookUrl),
    personalWebsiteUrl: toProfileUrl(input.personalWebsiteUrl),
    professionalWebsiteUrl: toProfileUrl(input.professionalWebsiteUrl),
    whatsappPhoneE164: toE164(input.whatsappPhoneE164),
    // An unusable address becomes null rather than throwing, matching how the
    // URL fields behave: one bad paste must not block an entire save.
    businessEmail: toEmail(input.businessEmail),
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
  ["professionalTitle", 10],
  ["locationDisplay", 5],
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
