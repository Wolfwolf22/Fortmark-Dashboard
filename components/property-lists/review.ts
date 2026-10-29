/** URL and review decisions shared by the full-page property-list workflow. */
import type { CreatePropertyListInput } from "@/lib/contacts/property-lists";
import type { PropertyView } from "@/lib/contacts/properties";
import type { ContactPropertyPreview } from "@/components/leads/contact-properties";

export function propertyListsHref({ contactId, listId, page = 1, newList = false }: { contactId?: string | null; listId?: string | null; page?: number; newList?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (contactId) query.set("contactId", contactId);
  if (listId) query.set("list", listId);
  if (page > 1) query.set("page", String(page));
  if (newList) query.set("new", "1");
  return `/property-lists${query.size ? `?${query}` : ""}`;
}
export interface PropertyListCreateAttempt { key: string; input: CreatePropertyListInput }
export function propertyListCreateAttempt(previous: PropertyListCreateAttempt | null, name: string, contactId?: string, makeId: () => string = () => crypto.randomUUID()): PropertyListCreateAttempt {
  const clean = name.trim(), key = JSON.stringify([clean, contactId ?? null]);
  return previous?.key === key ? previous : { key, input: { requestId: makeId(), name: clean, ...(contactId ? { contactId } : {}) } };
}
export function propertyListAddAcknowledged(property: PropertyView | null | undefined, listId: string, preview: ContactPropertyPreview): boolean {
  return Boolean(property?.id && property.listId === listId && property.listingId === preview.result.listing.id && property.mlsNumber.trim().toUpperCase() === preview.query);
}
export function propertyListFailure(error: unknown, operation: "read" | "create" | "rename"): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "sample_read_only") return "Property lists need the contact database connection. Sample contact mode does not store personal research lists.";
  if (status === 401) return "Sign in again to use your property lists.";
  if (status === 403) return "You do not have permission to change property lists.";
  if (status === 404) return "This property list or contact is no longer available. Return to your lists and try again.";
  if (status === 409 && operation === "rename") return "This list changed. Your name draft is kept. Review the current version before saving.";
  if (status === 400) return operation === "read" ? "This list view could not be read. Return to all lists and try again." : "Enter a list name using 1 to 120 readable characters.";
  return operation === "create" ? "Creating the list did not return a result. Your draft is kept. Retry uses the same request to avoid creating it twice." : operation === "rename" ? "The name could not be saved. Your draft is kept. Try again." : "Property lists could not be loaded. Try again.";
}
export function propertyWorkspacePageRecovery(currentPage: number, answer: { requestPage: number; result: { page: number; pageSize: number; total: number } } | null | undefined, settled: boolean): number | null {
  if (!settled || !answer || answer.requestPage !== currentPage) return null;
  const last = Math.max(1, Math.ceil(answer.result.total / Math.max(1, answer.result.pageSize)));
  const next = Math.max(1, Math.min(answer.result.page, last));
  return next === currentPage ? null : next;
}
