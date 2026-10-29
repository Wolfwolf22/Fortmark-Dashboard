/** Explicit, reviewable contact merging. No database or transport dependencies. */
import { z } from "zod";
import type { Lead, LeadSource, LeadStage } from "../data/types.ts";
import type { Birthday } from "./birthday.ts";
import type { NextAction } from "./next-action.ts";
import { nextActionDayMirror } from "./next-action.ts";

export const MERGE_FIELDS = ["name", "email", "phone", "company", "source", "stage", "birthday", "about", "personalDetails", "legacyNotes"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  name: "Name", email: "Email", phone: "Phone", company: "Company", source: "Source", stage: "Stage",
  birthday: "Birthday", about: "About this client", personalDetails: "Named details", legacyNotes: "Legacy note",
};
export type MergeSide = "primary" | "duplicate";
export type MergeChoices = Record<MergeField, MergeSide>;
export interface MergeValues {
  name: { firstName: string; lastName: string; preferredName: string };
  email: string; phone: string; company: string; source: LeadSource; stage: LeadStage;
  birthday: Birthday | null; about: string; personalDetails: { label: string; value: string }[]; legacyNotes: string;
}
export interface MergeCounts { notes: number; needs: number; activities: number; opportunities: number; transactions: number }
export interface MergeReviewContact {
  id: string; name: string; updatedAt: string; historyFingerprint: string;
  values: MergeValues; nextAction: NextAction | null; nextFollowUpDate?: string;
  counts: MergeCounts;
}
export interface MergeReview {
  primary: MergeReviewContact; duplicate: MergeReviewContact;
  conflicts: MergeField[]; defaults: MergeChoices; preservedCounts: MergeCounts;
}
export interface ContactMergeResult { primary: Lead; preservedCounts: MergeCounts; mergedContactId: string }

const side = z.enum(["primary", "duplicate"]);
export const contactMergeInputSchema = z.object({
  requestId: z.string().uuid(), primaryId: z.string().uuid(), duplicateId: z.string().uuid(),
  expectedPrimaryUpdatedAt: z.string().datetime({ offset: true }), expectedDuplicateUpdatedAt: z.string().datetime({ offset: true }),
  expectedPrimaryHistoryFingerprint: z.string().min(1).max(128), expectedDuplicateHistoryFingerprint: z.string().min(1).max(128),
  choices: z.object({ name: side, email: side, phone: side, company: side, source: side, stage: side, birthday: side, about: side, personalDetails: side, legacyNotes: side }).strict(),
  nextActionChoice: z.enum(["primary", "duplicate", "none"]), engagementAcknowledged: z.boolean().optional(),
}).strict().refine(input => input.primaryId !== input.duplicateId, { path: ["duplicateId"], message: "Choose two different contacts." });
export type ContactMergeInput = z.infer<typeof contactMergeInputSchema>;

function empty(value: MergeValues[MergeField]): boolean {
  if (value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if ("firstName" in value) return !value.firstName.trim() && !value.lastName.trim() && !value.preferredName.trim();
  return false;
}
export function mergeConflicts(primary: MergeValues, duplicate: MergeValues): MergeField[] {
  return MERGE_FIELDS.filter(field => !empty(primary[field]) && !empty(duplicate[field]) && JSON.stringify(primary[field]) !== JSON.stringify(duplicate[field]));
}
export function defaultMergeChoices(primary: MergeValues, duplicate: MergeValues): MergeChoices {
  return Object.fromEntries(MERGE_FIELDS.map(field => [field, empty(primary[field]) && !empty(duplicate[field]) ? "duplicate" : "primary"])) as MergeChoices;
}
export function mergeValues(review: Pick<MergeReview, "primary" | "duplicate">, choices: MergeChoices): MergeValues {
  return Object.fromEntries(MERGE_FIELDS.map(field => [field, review[choices[field]].values[field]])) as unknown as MergeValues;
}
export function mergeCounts(primary: MergeCounts, duplicate: MergeCounts): MergeCounts {
  return Object.fromEntries(Object.keys(primary).map(key => [key, primary[key as keyof MergeCounts] + duplicate[key as keyof MergeCounts]])) as unknown as MergeCounts;
}
export function chooseMergedAction(review: Pick<MergeReview, "primary" | "duplicate">, choice: ContactMergeInput["nextActionChoice"]): NextAction | null {
  return choice === "none" ? null : review[choice].nextAction;
}
export function chooseMergedFollowUp(review: Pick<MergeReview, "primary" | "duplicate">, choice: ContactMergeInput["nextActionChoice"]): string | null {
  if (choice === "none") return null;
  const record = review[choice];
  return record.nextAction ? nextActionDayMirror(record.nextAction.dueAt) : record.nextFollowUpDate ?? null;
}

/** Note limits are UTF-16 lengths in the editor; never split an astral character. */
export function splitLegacyNote(value: string, limit: number): string[] {
  if (!Number.isSafeInteger(limit) || limit < 2) throw new RangeError("A note chunk needs at least two characters.");
  const chunks: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + limit, value.length);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xD800 && value.charCodeAt(end - 1) <= 0xDBFF) end--;
    chunks.push(value.slice(start, end)); start = end;
  }
  return chunks;
}
