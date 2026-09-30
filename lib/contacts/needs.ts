/**
 * Client needs — what a person is trying to accomplish, as structured data.
 *
 * Not an opportunity (no forecast, no won/lost) and not a deal. One contact has
 * many needs, because the same person may buy one home and sell another. The
 * fields are FortMark's own vocabulary so a future search service can turn a
 * need into an MLS query without reading a paragraph — and so this table never
 * carries an MLS vendor's field names. Any translation belongs to that service.
 *
 * Everything here is pure and isomorphic: the form, the routes, the future AI
 * boundary and the tests share one definition of what a valid need is, what a
 * change to one is, and how one reads on a screen.
 */
import { z } from "zod";

export const NEED_KINDS = ["buy", "sell", "rent", "lease", "other"] as const;
export const NEED_STATUSES = ["active", "paused", "fulfilled", "archived"] as const;
export const NEED_FINANCING = ["cash", "conventional", "fha", "va", "other", "unknown"] as const;
export const NEED_PROPERTY_TYPES = ["singleFamily", "condo", "townhouse", "multiFamily", "land", "other"] as const;

export type NeedKind = (typeof NEED_KINDS)[number];
export type NeedStatus = (typeof NEED_STATUSES)[number];
export type NeedFinancing = (typeof NEED_FINANCING)[number];
export type NeedPropertyType = (typeof NEED_PROPERTY_TYPES)[number];

/**
 * `rent` is a person looking to rent a home; `lease` is a commercial or
 * longer-term lease. Landlord and tenant are roles a person plays in a
 * transaction, not what they are looking for, so they are not needs.
 */
export const NEED_KIND_LABELS: Record<NeedKind, string> = {
  buy: "Buying",
  sell: "Selling",
  rent: "Renting",
  lease: "Leasing",
  other: "Other",
};
export const NEED_STATUS_LABELS: Record<NeedStatus, string> = {
  active: "Active",
  paused: "Paused",
  fulfilled: "Fulfilled",
  archived: "Archived",
};
export const NEED_FINANCING_LABELS: Record<NeedFinancing, string> = {
  cash: "Cash",
  conventional: "Conventional",
  fha: "FHA",
  va: "VA",
  other: "Other",
  unknown: "Unknown",
};
export const NEED_PROPERTY_TYPE_LABELS: Record<NeedPropertyType, string> = {
  singleFamily: "Single family",
  condo: "Condo",
  townhouse: "Townhouse",
  multiFamily: "Multi-family",
  land: "Land",
  other: "Other",
};

/** Bounds, kept in step with the database checks (`contact_needs_*_check`). */
export const NEED_LIMITS = {
  propertyTypes: 8,
  areas: 12,
  mustHaves: 20,
  avoid: 20,
  itemLength: 80,
  timelineNote: 200,
  additional: 2000,
  maxCents: 9_999_999_999_99,
  maxBeds: 30,
  maxBaths: 30,
  maxSqft: 1_000_000,
} as const;

const item = z.string().trim().min(1).max(NEED_LIMITS.itemLength);
/** A list of short strings: trimmed, de-duplicated ignoring case, bounded. */
const list = (max: number) =>
  z
    .array(item)
    .max(max)
    .transform((values) => {
      const seen = new Set<string>();
      return values.filter((v) => {
        const key = v.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
const cents = z.number().int().min(0).max(NEED_LIMITS.maxCents);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "not a real date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const fields = {
  propertyTypes: z.array(z.enum(NEED_PROPERTY_TYPES)).max(NEED_LIMITS.propertyTypes).transform((v) => Array.from(new Set(v))),
  areas: list(NEED_LIMITS.areas),
  priceMinCents: cents.nullable(),
  priceMaxCents: cents.nullable(),
  minBeds: z.number().int().min(0).max(NEED_LIMITS.maxBeds).nullable(),
  minBaths: z
    .number()
    .min(0)
    .max(NEED_LIMITS.maxBaths)
    .refine((v) => Number.isInteger(v * 2), "whole or half baths")
    .nullable(),
  minSqft: z.number().int().min(0).max(NEED_LIMITS.maxSqft).nullable(),
  targetDate: day.nullable(),
  timelineNote: optionalText(NEED_LIMITS.timelineNote).nullable(),
  financing: z.enum(NEED_FINANCING).nullable(),
  mustHaves: list(NEED_LIMITS.mustHaves),
  avoid: list(NEED_LIMITS.avoid),
  additionalRequirements: optionalText(NEED_LIMITS.additional).nullable(),
};

const priceOrdered = (v: { priceMinCents?: number | null; priceMaxCents?: number | null }) =>
  v.priceMinCents == null || v.priceMaxCents == null || v.priceMaxCents >= v.priceMinCents;

/** Creating a need: a kind, and whatever else is known. Strict, so nothing unknown is half-honoured. */
export const createNeedSchema = z
  .object({ kind: z.enum(NEED_KINDS), ...fields, status: z.enum(NEED_STATUSES).optional() })
  .partial({ propertyTypes: true, areas: true, mustHaves: true, avoid: true })
  .partial({
    priceMinCents: true,
    priceMaxCents: true,
    minBeds: true,
    minBaths: true,
    minSqft: true,
    targetDate: true,
    timelineNote: true,
    financing: true,
    additionalRequirements: true,
  })
  .strict()
  .refine(priceOrdered, { message: "maximum is below minimum", path: ["priceMaxCents"] });

/** Changing a need: any field, or its status. `null` clears a scalar; an empty list clears a list. */
export const updateNeedSchema = z
  .object({ kind: z.enum(NEED_KINDS), status: z.enum(NEED_STATUSES), ...fields })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" })
  .refine(priceOrdered, { message: "maximum is below minimum", path: ["priceMaxCents"] });

export type CreateNeedInput = z.infer<typeof createNeedSchema>;
export type UpdateNeedInput = z.infer<typeof updateNeedSchema>;

/** A need as the screen and the future AI service see it. Nothing here is an id of a person. */
export interface NeedView {
  id: string;
  kind: NeedKind;
  status: NeedStatus;
  propertyTypes: NeedPropertyType[];
  areas: string[];
  priceMinCents: number | null;
  priceMaxCents: number | null;
  minBeds: number | null;
  minBaths: number | null;
  minSqft: number | null;
  targetDate: string | null;
  timelineNote: string | null;
  financing: NeedFinancing | null;
  mustHaves: string[];
  avoid: string[];
  additionalRequirements: string | null;
  createdAt: string;
  updatedAt: string;
}

export const NEED_EDITABLE_FIELDS = [
  "kind",
  "propertyTypes",
  "areas",
  "priceMinCents",
  "priceMaxCents",
  "minBeds",
  "minBaths",
  "minSqft",
  "targetDate",
  "timelineNote",
  "financing",
  "mustHaves",
  "avoid",
  "additionalRequirements",
] as const;
export type NeedField = (typeof NEED_EDITABLE_FIELDS)[number] | "status";

export type NeedPlan =
  | { ok: true; set: Partial<Omit<NeedView, "id" | "createdAt" | "updatedAt">>; changed: NeedField[]; status?: { from: NeedStatus; to: NeedStatus } }
  | { ok: false; reason: "price" };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What an update would change, without a database. Only real changes are written
 * and audited, and what is audited is the NAMES of the fields — never the areas,
 * the money or the requirements. The price ordering is checked against what is
 * stored too, so raising the minimum past a stored maximum is refused.
 */
export function planNeedUpdate(current: NeedView, patch: UpdateNeedInput): NeedPlan {
  const set: Record<string, unknown> = {};
  const changed: NeedField[] = [];
  for (const field of NEED_EDITABLE_FIELDS) {
    if (!(field in patch)) continue;
    const next = (patch as Record<string, unknown>)[field];
    if (next === undefined) continue;
    if (!same(next, current[field])) {
      set[field] = next;
      changed.push(field);
    }
  }
  let status: { from: NeedStatus; to: NeedStatus } | undefined;
  if (patch.status !== undefined && patch.status !== current.status) {
    set.status = patch.status;
    changed.push("status");
    status = { from: current.status, to: patch.status };
  }
  const min = "priceMinCents" in set ? (set.priceMinCents as number | null) : current.priceMinCents;
  const max = "priceMaxCents" in set ? (set.priceMaxCents as number | null) : current.priceMaxCents;
  if (min != null && max != null && max < min) return { ok: false, reason: "price" };
  return { ok: true, set: set as Extract<NeedPlan, { ok: true }>["set"], changed, ...(status ? { status } : {}) };
}

// --- How a need reads ---------------------------------------------------------------

/** "$600K", "$1.2M", "$950". Whole dollars in, no invented precision. */
export function formatMoneyShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `$${trim(dollars / 1_000)}K`;
  return `$${Math.round(dollars)}`;
}
const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");

export function formatPriceRange(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return min === max ? formatMoneyShort(min) : `${formatMoneyShort(min)}–${formatMoneyShort(max)}`;
  if (min != null) return `${formatMoneyShort(min)}+`;
  if (max != null) return `Up to ${formatMoneyShort(max)}`;
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatTarget(dayKey: string): string {
  const [y, m] = dayKey.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * A compact summary from what is actually stored, and nothing else: a need with
 * no budget has no budget line, not "Budget: unknown". Ordered as a person reads
 * it — what, where, how much, how big, when.
 */
export function summarizeNeed(need: NeedView): { headline: string; lines: string[] } {
  const lines: string[] = [];
  if (need.areas.length) lines.push(need.areas.join(" · "));
  if (need.propertyTypes.length) lines.push(need.propertyTypes.map((t) => NEED_PROPERTY_TYPE_LABELS[t]).join(", "));
  const price = formatPriceRange(need.priceMinCents, need.priceMaxCents);
  if (price) lines.push(price);
  const size = [
    need.minBeds != null ? `${need.minBeds}+ beds` : null,
    need.minBaths != null ? `${need.minBaths}+ baths` : null,
    need.minSqft != null ? `${need.minSqft.toLocaleString("en-US")}+ sq ft` : null,
  ].filter(Boolean);
  if (size.length) lines.push(size.join(" · "));
  const when = [need.targetDate ? `Target ${formatTarget(need.targetDate)}` : null, need.timelineNote].filter(Boolean);
  if (when.length) lines.push(when.join(" · "));
  return { headline: NEED_KIND_LABELS[need.kind], lines };
}
