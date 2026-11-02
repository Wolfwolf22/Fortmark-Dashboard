import type { PropertyPage, PropertyView } from "@/lib/contacts/properties";
import type { PropertyListView } from "@/lib/contacts/property-lists";
import type { PropertyResearchInput, PropertyReviewFilter, PropertyReviewStatus, PropertySort, PropertyTransferInput } from "@/lib/contacts/property-research";
import { PROPERTY_NOTES_MAX, PROPERTY_REVIEW_LABELS } from "@/lib/contacts/property-research";
import { propertyWorkspacePageRecovery } from "./review";

export const REVIEW_LABELS = PROPERTY_REVIEW_LABELS;
export const REVIEW_FILTERS: { value: PropertyReviewFilter; label: string }[] = [{ value: "all", label: "All properties" }, ...Object.entries(REVIEW_LABELS).map(([value, label]) => ({ value: value as PropertyReviewStatus, label }))];
export const PROPERTY_SORTS: { value: PropertySort; label: string }[] = [{ value: "added_desc", label: "Date added · newest" }, { value: "added_asc", label: "Date added · oldest" }, { value: "price_asc", label: "Price · low to high" }, { value: "price_desc", label: "Price · high to low" }];

export interface PropertyResearchDraft { opening: PropertyView; notes: string; reviewStatus: PropertyReviewStatus }
export function validPropertyResearchNotes(notes: string): boolean { return notes.length <= PROPERTY_NOTES_MAX && !notes.includes("\0"); }
export function openPropertyResearch(property: PropertyView): PropertyResearchDraft { return { opening: property, notes: property.notes ?? "", reviewStatus: property.reviewStatus ?? "to_review" }; }
export function propertyResearchInput(draft: PropertyResearchDraft): PropertyResearchInput { return { notes: draft.notes, reviewStatus: draft.reviewStatus, expectedUpdatedAt: draft.opening.updatedAt }; }
export function propertyResearchSaveAcknowledged(opening: PropertyView, saved: PropertyView): boolean { return saved.id === opening.id && saved.listId === opening.listId && saved.listingId === opening.listingId; }
export function propertyVersionChanged(opening: PropertyView, latest: PropertyView | null | undefined): boolean { return Boolean(latest && latest.id === opening.id && latest.listId === opening.listId && latest.updatedAt !== opening.updatedAt && Date.parse(latest.updatedAt) >= Date.parse(opening.updatedAt)); }
/** Only the explicit review choice changes the version used by a subsequent write. */
export function reviewPropertyResearch(draft: PropertyResearchDraft, latest: PropertyView, keepDraft: boolean): PropertyResearchDraft {
  if (latest.id !== draft.opening.id || latest.listId !== draft.opening.listId || Date.parse(latest.updatedAt) < Date.parse(draft.opening.updatedAt)) throw Error("Saved property changed identity or moved");
  return keepDraft ? { ...draft, opening: latest } : openPropertyResearch(latest);
}
export interface PropertyTransferAttempt { key: string; input: PropertyTransferInput }
export function propertyTransferAttempt(previous: PropertyTransferAttempt | null, opening: PropertyView, mode: "copy" | "move", targetListId: string, makeId: () => string = () => crypto.randomUUID()): PropertyTransferAttempt {
  const key = JSON.stringify([opening.id, opening.listId, opening.updatedAt, mode, targetListId]);
  return previous?.key === key ? previous : { key, input: { requestId: makeId(), mode, targetListId, expectedUpdatedAt: opening.updatedAt } };
}
export function propertyTargetLabel(list: PropertyListView, others: PropertyListView[] = []): string {
  const context = list.contactId ? list.contactName ? `For ${list.contactName}` : "Linked to a contact" : "Personal research";
  const ambiguous = others.some((other) => other.id !== list.id && other.name === list.name && (other.contactName ?? other.contactId) === (list.contactName ?? list.contactId));
  return `${list.name} · ${context}${ambiguous ? ` · List ${list.id.slice(-6)}` : ""}`;
}
export interface PropertyResearchPageAnswer { requestPage: number; requestView: string; result: PropertyPage }
export function propertyResearchViewKey(reviewStatus: PropertyReviewFilter, sort: PropertySort): string { return `${reviewStatus}:${sort}`; }
export function propertyResearchPageRecovery(page: number, view: string, answer: PropertyResearchPageAnswer | null | undefined, settled: boolean): number | null { return answer?.requestView === view ? propertyWorkspacePageRecovery(page, answer, settled) : null; }
export function propertyResearchFailure(error: unknown, operation: "save" | "transfer" | "read"): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "target_has_property") return "The destination already contains this property. Nothing was overwritten and the source entry was kept. Choose another list.";
  if (status === 401) return "Sign in again to use your property lists. Your draft is kept.";
  if (status === 403) return "You no longer have permission to change this property list. Your draft is kept.";
  if (status === 404) return "This list or saved property is no longer available. Your draft is kept; close this panel and refresh your lists.";
  if (status === 409) return "This saved property changed. Your choices are kept. Review its current notes and status before continuing.";
  if (status === 400) return operation === "save" ? "Choose a review status and enter no more than 5,000 characters of plain text." : "Choose a different list that you own.";
  if (operation === "read") return "The current saved review could not be loaded. Your draft is kept. Try again.";
  return operation === "save" ? "The save did not return a result. Your draft is kept. Retry to confirm; the same review will not be applied twice." : "The transfer did not return a result. Your choices are kept. Retry uses the same request to avoid transferring it twice.";
}
