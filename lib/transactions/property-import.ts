/** Pure material for a reviewed import. No MLS snapshot is stored by this helper. */
import type { Listing } from "../data/types.ts";
import type { TransactionPropertyReference } from "./property-domain.ts";

function text(value: unknown, max: number, required = false): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length <= max && (!required || clean.length > 0) && !/[\u0000-\u001f\u007f]/.test(clean) ? clean || null : null;
}
export function transactionPropertyImportValues(reference: TransactionPropertyReference, listing: Listing) {
  const addressLine1 = text(listing.address, 200, true), city = text(listing.city, 200, true), state = text(listing.state, 2, true)?.toUpperCase();
  const postalCode = text(listing.zip, 12), county = text(listing.county, 200);
  const address = !listing.addressWithheld && addressLine1 && city && state && /^[A-Z]{2}$/.test(state) && (!listing.zip || postalCode) && (!listing.county || county)
    ? { addressLine1, addressLine2: null, city, state, postalCode, county } : null;
  const cents = typeof listing.listPrice === "number" && Number.isFinite(listing.listPrice) && listing.listPrice > 0 ? Math.round(listing.listPrice * 100) : null;
  return { reference: { dataset: reference.dataset, listingId: reference.listingId, mlsNumber: reference.mlsNumber }, address, listPriceCents: cents !== null && Number.isSafeInteger(cents) && cents <= 999_999_999_999 ? cents : null };
}
