import { z } from "zod";

/** Personal view preferences only: never transaction IDs, contents or permissions. */
export const TRANSACTION_SECTION_IDS = [
  "mls-property", "listing-term", "open-houses", "private-notes", "party-links",
  "reopen-review", "showing-tours", "stage-checklist", "commission-estimate",
  "deadlines", "property-contract", "file-notes", "workflow-position", "people",
  "commission-terms", "vendors", "file-history",
] as const;
export type TransactionSectionId = typeof TRANSACTION_SECTION_IDS[number];
export const GC_SECTION_IDS = ["gc-property", "gc-client", "gc-checklist"] as const;
export type GcSectionId = typeof GC_SECTION_IDS[number];
export type FileSectionId = TransactionSectionId | GcSectionId;
export type TransactionLayoutProfile = "realEstate" | "gc";
export const SECTION_LABELS: Record<FileSectionId, string> = {
  "mls-property": "MLS property", "listing-term": "Listing term", "open-houses": "Open houses",
  "private-notes": "Private notes", "party-links": "Client and party links", "reopen-review": "Reopen review",
  "showing-tours": "Showing tours", "stage-checklist": "Stage checklist", "commission-estimate": "Estimated commission",
  deadlines: "Deadlines", "property-contract": "Property and contract", "file-notes": "Private file notes",
  "workflow-position": "Workflow position", people: "People", "commission-terms": "Entered commission terms",
  vendors: "Vendors", "file-history": "File history", "gc-property": "Property information",
  "gc-client": "Client", "gc-checklist": "Project checklist",
};
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
export const transactionLayoutSchema = z.object({
  version: z.literal(1),
  realEstate: z.array(z.enum(TRANSACTION_SECTION_IDS)).max(TRANSACTION_SECTION_IDS.length).refine(unique),
  gc: z.array(z.enum(GC_SECTION_IDS)).max(GC_SECTION_IDS.length).refine(unique),
}).strict();
export type TransactionLayoutData = z.infer<typeof transactionLayoutSchema>;
export function defaultTransactionLayout(): TransactionLayoutData {
  return { version: 1, realEstate: [...TRANSACTION_SECTION_IDS], gc: [...GC_SECTION_IDS] };
}
export function normalizeTransactionLayout(raw: unknown): TransactionLayoutData {
  const parsed = transactionLayoutSchema.safeParse(raw);
  if (!parsed.success) return defaultTransactionLayout();
  return {
    version: 1,
    realEstate: [...parsed.data.realEstate, ...TRANSACTION_SECTION_IDS.filter(id => !parsed.data.realEstate.includes(id))],
    gc: [...parsed.data.gc, ...GC_SECTION_IDS.filter(id => !parsed.data.gc.includes(id))],
  };
}
/** Reorder only the rendered cards. Hidden side-specific cards retain their slots. */
export function moveVisibleSection<T extends string>(order: readonly T[], visible: readonly T[], active: T, target: T): T[] {
  const shown = order.filter(id => visible.includes(id));
  const from = shown.indexOf(active), to = shown.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const moved = [...shown];
  moved.splice(to, 0, moved.splice(from, 1)[0]);
  const visibleSet = new Set(shown);
  let cursor = 0;
  return order.map(id => visibleSet.has(id) ? moved[cursor++] : id);
}
