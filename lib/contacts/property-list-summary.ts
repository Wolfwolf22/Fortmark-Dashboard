import type { PropertyView } from "./properties";
export interface PropertyAreaPin { propertyId: string; listingId: string; label: string; lat: number; lng: number }
export interface PropertyListSummary {
  sample?: boolean;
  total: number; inspected: number; available: number; priced: number; averagePrice: number | null; minPrice: number | null; maxPrice: number | null;
  averageBeds: number | null; averageBaths: number | null; averageSqft: number | null; shortlisted: number;
  cities: { name: string; count: number }[]; pins: PropertyAreaPin[]; locationsMissing: number; truncated: boolean; checkedAt: string;
}
/** Statistics use actual available MLS values; unknown amounts and withheld coordinates are excluded. */
export function summarizePropertyList(items: PropertyView[], total: number, checkedAt: string): PropertyListSummary {
  const listings = items.flatMap(item => item.listing ? [item.listing] : []), positive = (values: number[]) => values.filter(value => Number.isFinite(value) && value > 0), average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const prices = positive(listings.map(listing => listing.listPrice)), cities = new Map<string, number>();
  for (const listing of listings) if (listing.city.trim()) cities.set(listing.city.trim(), (cities.get(listing.city.trim()) ?? 0) + 1);
  const pins = items.flatMap(item => { const listing = item.listing, point = listing?.coordinates; return listing && !listing.addressWithheld && point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? [{ propertyId: item.id, listingId: listing.id, label: listing.address, ...point }] : []; });
  return { total, inspected: items.length, available: listings.length, priced: prices.length, averagePrice: average(prices), minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null, averageBeds: average(positive(listings.map(listing => listing.beds))), averageBaths: average(positive(listings.map(listing => listing.baths))), averageSqft: average(positive(listings.map(listing => listing.sqft))), shortlisted: items.filter(item => item.reviewStatus === "shortlisted").length, cities: [...cities].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), pins, locationsMissing: items.length - pins.length, truncated: items.length < total, checkedAt };
}
