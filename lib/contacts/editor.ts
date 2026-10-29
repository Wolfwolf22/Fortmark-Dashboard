/** Opening snapshots and explicit conflict review; no network or ambient state. */
import type { Lead } from "../data/types.ts";

export const CONTACT_TEXT_FIELDS = ["firstName", "lastName", "preferredName", "email", "phone", "company"] as const;
export const CONTACT_EDIT_FIELDS = [...CONTACT_TEXT_FIELDS, "source"] as const;
export type ContactEditorField = (typeof CONTACT_EDIT_FIELDS)[number];
export type ContactEditorValues = Record<(typeof CONTACT_TEXT_FIELDS)[number], string> & { source: Lead["source"] };
export interface ContactEditorSnapshot {
  id: string;
  expectedUpdatedAt?: string;
  values: ContactEditorValues;
}
export type ContactEditorPatch = Partial<ContactEditorValues> & { expectedUpdatedAt?: string };
export interface ContactEditorReview {
  latest: ContactEditorSnapshot;
  values: ContactEditorValues;
  conflicts: ContactEditorField[];
}
export type ContactEditorChoices = Partial<Record<ContactEditorField, "mine" | "saved">>;

export function contactEditorSnapshot(lead: Lead): ContactEditorSnapshot {
  return {
    id: lead.id,
    expectedUpdatedAt: lead.updatedAt,
    values: {
      firstName: lead.editable?.firstName ?? lead.name,
      lastName: lead.editable?.lastName ?? "",
      preferredName: lead.editable?.preferredName ?? "",
      email: lead.email,
      phone: lead.phone,
      company: lead.editable?.company ?? "",
      source: lead.source,
    },
  };
}

export function contactEditorChanged(baseline: ContactEditorSnapshot, latest: ContactEditorSnapshot): boolean {
  return baseline.id !== latest.id || baseline.expectedUpdatedAt !== latest.expectedUpdatedAt ||
    CONTACT_EDIT_FIELDS.some((key) => baseline.values[key].trim() !== latest.values[key].trim());
}

/** Diff against the frozen opening snapshot, never a changing prop. */
export function contactEditorPatch(baseline: ContactEditorSnapshot, values: ContactEditorValues): ContactEditorPatch {
  const patch: ContactEditorPatch = {};
  for (const key of CONTACT_TEXT_FIELDS) {
    if (values[key].trim() !== baseline.values[key].trim()) patch[key] = values[key].trim();
  }
  if (values.source !== baseline.values.source) patch.source = values.source;
  if (Object.keys(patch).length && baseline.expectedUpdatedAt) patch.expectedUpdatedAt = baseline.expectedUpdatedAt;
  return patch;
}

/** Keep dirty fields, accept newer untouched fields, and name overlapping edits for review. */
export function reviewContactEditor(baseline: ContactEditorSnapshot, values: ContactEditorValues, latest: ContactEditorSnapshot): ContactEditorReview {
  if (baseline.id !== latest.id) throw new Error("The refreshed contact does not match this editor.");
  const merged = { ...latest.values };
  const conflicts: ContactEditorField[] = [];
  for (const key of CONTACT_EDIT_FIELDS) {
    const mine = values[key].trim();
    const before = baseline.values[key].trim();
    const saved = latest.values[key].trim();
    if (mine !== before) {
      // All values share a string representation; source is checked by the server.
      Object.assign(merged, { [key]: values[key] });
      if (saved !== before && saved !== mine) conflicts.push(key);
    }
  }
  return { latest, values: merged, conflicts };
}

/** Every overlapping edit needs a deliberate choice before a new baseline is adopted. */
export function resolveContactEditorReview(review: ContactEditorReview, choices: ContactEditorChoices): { baseline: ContactEditorSnapshot; values: ContactEditorValues } | null {
  if (review.conflicts.some((key) => !choices[key])) return null;
  const values = { ...review.values };
  for (const key of review.conflicts) {
    if (choices[key] === "saved") Object.assign(values, { [key]: review.latest.values[key] });
  }
  return { baseline: review.latest, values };
}
