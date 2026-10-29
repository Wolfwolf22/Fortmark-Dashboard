/** Optional client reference information, with an explicit saved-version review. */
import { z } from "zod";

export const CLIENT_INFO_LIMITS = { about: 2000, details: 20, label: 60, value: 500 } as const;

export const clientAboutSchema = z.string().trim().max(CLIENT_INFO_LIMITS.about, "Keep About to 2,000 characters or fewer.").refine(value => !value.includes("\u0000"), "Remove unsupported characters from About.");
const detailTextSchema = z.object({ label: z.string(), value: z.string() }).strict();
export const clientPersonalDetailsSchema = z.array(detailTextSchema)
  .transform((rows) => rows.map(({ label, value }) => ({ label: label.trim(), value: value.trim() })).filter((row) => row.label || row.value))
  .pipe(z.array(z.object({
    label: z.string().min(1, "Add a label, or remove this detail.").max(CLIENT_INFO_LIMITS.label, "Keep labels to 60 characters or fewer.").refine(value => !value.includes("\u0000"), "Remove unsupported characters from this label."),
    value: z.string().min(1, "Add a value, or remove this detail.").max(CLIENT_INFO_LIMITS.value, "Keep values to 500 characters or fewer.").refine(value => !value.includes("\u0000"), "Remove unsupported characters from this value."),
  }).strict()).max(CLIENT_INFO_LIMITS.details, "Keep up to 20 named details."));
export const clientInfoValuesSchema = z.object({ about: clientAboutSchema, personalDetails: clientPersonalDetailsSchema }).strict();

export interface ClientPersonalDetail { label: string; value: string }
export interface ClientInfoValues { about: string; personalDetails: ClientPersonalDetail[] }
export interface ClientInfoContact {
  id: string;
  recordSource?: string;
  updatedAt?: string;
  about?: string | null;
  personalDetails?: ClientPersonalDetail[] | null;
}
export interface ClientInfoSnapshot { id: string; expectedUpdatedAt?: string; values: ClientInfoValues }
export type ClientInfoSave = ClientInfoValues & { expectedUpdatedAt?: string };
export type ClientInfoField = keyof ClientInfoValues;
export interface ClientInfoReview { latest: ClientInfoSnapshot; values: ClientInfoValues; conflicts: ClientInfoField[] }
export type ClientInfoChoices = Partial<Record<ClientInfoField, "mine" | "saved">>;

function copyValues(values: ClientInfoValues): ClientInfoValues {
  return { about: values.about, personalDetails: values.personalDetails.map((row) => ({ ...row })) };
}
function comparable(values: ClientInfoValues, field: ClientInfoField): string {
  return field === "about" ? values.about.trim() : JSON.stringify(values.personalDetails.map(({ label, value }) => ({ label: label.trim(), value: value.trim() })).filter((row) => row.label || row.value));
}
export function clientInfoSnapshot(contact: ClientInfoContact): ClientInfoSnapshot {
  return { id: contact.id, expectedUpdatedAt: contact.updatedAt, values: copyValues({ about: contact.about ?? "", personalDetails: contact.personalDetails ?? [] }) };
}
/** A directly reloaded revision can arrive before the parent publishes it. */
export function clientInfoChanged(baseline: ClientInfoSnapshot, latest: ClientInfoSnapshot): boolean {
  if (baseline.id !== latest.id) return true;
  if (baseline.expectedUpdatedAt && latest.expectedUpdatedAt && Date.parse(latest.expectedUpdatedAt) < Date.parse(baseline.expectedUpdatedAt)) return false;
  return baseline.expectedUpdatedAt !== latest.expectedUpdatedAt || (Object.keys(baseline.values) as ClientInfoField[]).some((field) => comparable(baseline.values, field) !== comparable(latest.values, field));
}
export function clientInfoDirty(baseline: ClientInfoSnapshot, draft: ClientInfoValues): boolean {
  return (Object.keys(baseline.values) as ClientInfoField[]).some((field) => comparable(baseline.values, field) !== comparable(draft, field));
}
/** Only this section's values and its frozen revision leave the editor. */
export function clientInfoSave(baseline: ClientInfoSnapshot, draft: ClientInfoValues): ClientInfoSave {
  const values = clientInfoValuesSchema.parse(draft);
  return { ...values, ...(baseline.expectedUpdatedAt ? { expectedUpdatedAt: baseline.expectedUpdatedAt } : {}) };
}
/** Accept newer untouched sections; overlapping edits need a deliberate choice. */
export function reviewClientInfo(baseline: ClientInfoSnapshot, draft: ClientInfoValues, latest: ClientInfoSnapshot): ClientInfoReview {
  if (baseline.id !== latest.id) throw new Error("The refreshed contact does not match this editor.");
  if (baseline.expectedUpdatedAt && latest.expectedUpdatedAt && Date.parse(latest.expectedUpdatedAt) < Date.parse(baseline.expectedUpdatedAt)) throw new Error("A newer saved version was already reviewed. Your draft is kept. Load the latest information again.");
  const values = copyValues(latest.values);
  const conflicts: ClientInfoField[] = [];
  for (const field of ["about", "personalDetails"] as const) {
    const mine = comparable(draft, field);
    const before = comparable(baseline.values, field);
    const saved = comparable(latest.values, field);
    if (mine !== before) {
      if (field === "about") values.about = draft.about;
      else values.personalDetails = draft.personalDetails.map((row) => ({ ...row }));
      if (saved !== before && saved !== mine) conflicts.push(field);
    }
  }
  return { latest: { ...latest, values: copyValues(latest.values) }, values, conflicts };
}
export function resolveClientInfoReview(review: ClientInfoReview, choices: ClientInfoChoices): { baseline: ClientInfoSnapshot; values: ClientInfoValues } | null {
  if (review.conflicts.some((field) => !choices[field])) return null;
  const values = copyValues(review.values);
  if (choices.about === "saved") values.about = review.latest.values.about;
  if (choices.personalDetails === "saved") values.personalDetails = review.latest.values.personalDetails.map((row) => ({ ...row }));
  return { baseline: { ...review.latest, values: copyValues(review.latest.values) }, values };
}
