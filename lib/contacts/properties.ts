/** A deliberately manual list: one exact MLS lookup, review, then save a reference. */
import { z } from "zod";
import type { Listing } from "../data/types.ts";

export const PROPERTY_PAGE_SIZE = 12;
export const MAX_PROPERTY_PAGE_SIZE = 24;
export const PROPERTY_MLS_NUMBER_MAX = 40;
export const PROPERTY_LISTING_ID_MAX = 256;
export const PROPERTY_BODY_BYTES = 2048;

/** Preserve leading zeroes and punctuation that can be part of an MLS identifier. */
export function normalizePropertyMlsNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length <= PROPERTY_MLS_NUMBER_MAX && /^[A-Z0-9][A-Z0-9-]*$/.test(normalized) && /\d/.test(normalized) ? normalized : null;
}
export function isPropertyListingId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= PROPERTY_LISTING_ID_MAX && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
export function isPropertyDataset(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}
const mlsNumber = z.string().transform((value, ctx) => {
  const normalized = normalizePropertyMlsNumber(value);
  if (!normalized) { ctx.addIssue({ code: "custom", message: "Enter an exact MLS number." }); return z.NEVER; }
  return normalized;
});
export const propertyLookupInputSchema = z.object({ mlsNumber }).strict();
export const addPropertyInputSchema = z.object({
  mlsNumber,
  expectedListingId: z.string().refine(isPropertyListingId, "Invalid listing reference."),
  expectedDataset: z.string().refine(isPropertyDataset, "Invalid MLS source."),
}).strict();
export type AddPropertyInput = z.infer<typeof addPropertyInputSchema>;

export type PropertyResolution =
  | { ok: true; value: { dataset: string; listing: Listing } }
  | { ok: false; reason: "not_found" | "unavailable" | "not_configured" | "ambiguous" };
export interface PropertyMlsProvider {
  lookup(mlsNumber: string): Promise<PropertyResolution>;
  get(dataset: string, listingId: string, mlsNumber: string): Promise<PropertyResolution>;
}
export interface PropertyView {
  id: string;
  contactId: string;
  mlsNumber: string;
  listingId: string;
  addedAt: string;
  listing: Listing | null;
  syncStatus: "available" | "not_found" | "unavailable" | "not_configured";
  checkedAt: string | null;
}
export interface PropertyPage { items: PropertyView[]; total: number; page: number; pageSize: number }
export interface PropertyLookup { dataset: string; listing: Listing; alreadySaved: boolean }

export function readPropertyQuery(params: URLSearchParams): { page: number; pageSize: number } | null {
  if ([...params.keys()].some(key => key !== "page" && key !== "pageSize")) return null;
  const rawPage = params.get("page"), rawSize = params.get("pageSize");
  if ((rawPage !== null && !/^\d{1,7}$/.test(rawPage)) || (rawSize !== null && !/^\d{1,2}$/.test(rawSize))) return null;
  const page = rawPage === null ? 1 : Number(rawPage), pageSize = rawSize === null ? PROPERTY_PAGE_SIZE : Number(rawSize);
  return page >= 1 && page <= 1_000_000 && pageSize >= 1 && pageSize <= MAX_PROPERTY_PAGE_SIZE ? { page, pageSize } : null;
}
