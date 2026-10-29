import { visualListings, visualTransactions, sampleAgent } from "./visual-fixtures.mjs";
import { sortListings } from "@/lib/data/listing-sort";
import { rejectPreviewWrite } from "./read-only.mjs";

const copy = (value) => value === undefined ? undefined : structuredClone(value);
export class ListingsError extends Error {
  constructor(code, status = 403) { super(`Preview listing request: ${code}`); this.code = code; this.status = status; }
}
export class TransactionsError extends Error {
  constructor(code, status = 403) { super(`Preview transaction request: ${code}`); this.code = code; this.status = status; }
}
const readOnly = rejectPreviewWrite;
export const createListing = readOnly;
export const createTransaction = readOnly;
export const updateTransactionStage = readOnly;
export async function getListingSource() { return "sample"; }
export async function getTransactionSource() { return "sample"; }
export async function getListingScopeInfo() { return { defaultScope: "mls", myListings: "linked", fortmarkOffice: "configured" }; }
export async function searchListings(query) {
  let rows = visualListings.filter(listing => {
    if (query.status?.length && !query.status.includes(listing.status)) return false;
    if (query.propertyType?.length && !query.propertyType.includes(listing.propertyType)) return false;
    if (query.city?.length && !query.city.includes(listing.city)) return false;
    if (query.minBeds !== undefined && listing.beds < query.minBeds) return false;
    if (query.minPrice !== undefined && listing.listPrice < query.minPrice) return false;
    if (query.maxPrice !== undefined && listing.listPrice > query.maxPrice) return false;
    if (query.office === "mine" && !listing.agentRole) return false;
    if (query.office === "fortmark" && listing.id === "sample-mls-broken-photo") return false;
    if (query.query && !`${listing.address} ${listing.mlsNumber} ${listing.neighborhood || ""}`.toLowerCase().includes(query.query.toLowerCase())) return false;
    return true;
  });
  rows = sortListings(rows, query.sortKey, query.sortDirection);
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.max(1, query.pageSize || 12);
  return copy({ source: "sample", items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, sortApplied: true });
}
export async function getListing(id) { return copy(visualListings.find(listing => listing.id === id)); }
export async function getFeaturedListing() { return undefined; }
export async function getFortmarkListingSummary() { throw new ListingsError("mls_not_configured", 503); }
export async function getComparables(id) {
  const subject = visualListings.find(listing => listing.id === id);
  return copy(visualListings.filter(listing => listing.id !== id && listing.status === "closed" && listing.city === subject?.city));
}
export async function getTransactions(filters = {}, range) {
  if (new URLSearchParams(window.location.search).get("scenario") === "unavailable" && !failedOnce) {
    failedOnce = true;
    throw new Error("Design preview: the first transaction request is unavailable. Retry to load the sample records.");
  }
  return copy(visualTransactions.filter(deal => {
    if (filters.stage?.length && !filters.stage.includes(deal.stage)) return false;
    if (filters.side?.length && !filters.side.includes(deal.side)) return false;
    if (filters.agentId && filters.agentId !== deal.agentId) return false;
    if (filters.query && !`${deal.address} ${deal.clientName}`.toLowerCase().includes(filters.query.toLowerCase())) return false;
    if (range && ![deal.contractDate, deal.closeDate].some(value => value && new Date(value) >= range.from && new Date(value) <= range.to)) return false;
    return true;
  }));
}
let failedOnce = false;
export async function getTransaction(id) { return copy(visualTransactions.find(deal => deal.id === id)); }
export async function getAgent(id) { return id === sampleAgent.id ? copy(sampleAgent) : undefined; }
export async function getAgents() { return [copy(sampleAgent)]; }
