// Raw synthetic transaction facts: money in cents/basis points, dates as
// calendar days, explicit completed deadlines and immutable source fixtures.
import { visualTransactions } from "./visual-fixtures.mjs";
import { contactFixtureNow, SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { contactTransactionIds } from "./import-merge-fixtures.mjs";
import { calendarDayKey } from "../../lib/transactions/calendar-days.ts";

const day = offset => new Date(Date.parse(`${calendarDayKey(contactFixtureNow)}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const stamp = offset => new Date(contactFixtureNow.getTime() + offset * 86400000).toISOString();
const fixtureAliases = visualTransactions.map((deal, index) => [deal.id, `88000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]);
const ids = new Map(fixtureAliases), names = new Map(fixtureAliases.map(([alias, id]) => [id, alias]));
export const previewTransactionId = id => ids.get(id) || id;
export const previewTransactionPublicId = id => names.get(id) || id;
const closingOffsets = [null, 25, 18, 3, null, -8];
const deadlineSpecs = [[], [["inspection", "Inspection", -1, false], ["appraisal", "Appraisal", 5, false], ["closing", "Closing", 25, false]], [["inspection", "Inspection", -7, true], ["appraisal", "Appraisal", -3, true], ["financing", "Financing approval", 4, false], ["closing", "Closing", 18, false], ["title", "Title documents", 0, false]], [["inspection", "Inspection", -20, true], ["financing", "Financing", -10, true], ["title", "Title review", 1, false], ["closing", "Closing", 3, false]], [], [["inspection", "Inspection", -30, true], ["closing", "Closing", -8, true]]];
export const sampleTransactionBundles = visualTransactions.map((deal, index) => {
  const id = previewTransactionId(deal.id), updatedAt = new Date(contactFixtureNow.getTime() - 3600000).toISOString();
  const row = { id, brokerageKey: "design-preview", agentUserId: SAMPLE_AGENT_ID, createdByUserId: SAMPLE_AGENT_ID, updatedByUserId: SAMPLE_AGENT_ID, stage: deal.stage, transactionType: deal.transactionType, side: deal.side,
    addressLine1: deal.address, addressLine2: null, city: deal.city, state: "FL", postalCode: "33308", county: "Broward", propertySubType: null, listingKey: deal.listingId || null, mlsNumber: null,
    listPriceCents: null, offerPriceCents: null, contractPriceCents: Math.round(deal.contractPrice * 100), commissionRateBps: index === 0 || index === 4 ? null : Math.round(deal.commissionRate * 10000), commissionFlatCents: index === 4 ? Math.round(deal.projectedCommission * 100) : null, agentSplitBps: null, transactionFeeCents: null, referralFeeBps: null, referralPayee: null, commissionPaidCents: null, commissionPaidAt: null,
    contractExecutionDate: index === 0 ? null : day(-10), effectiveDate: null, closingDate: closingOffsets[index] === null ? null : day(closingOffsets[index]), closedDate: deal.stage === "closed" ? day(-8) : null, possessionDate: null, cancelledDate: null,
    notes: index === 1 ? "Confirm the inspection report and coordinate the next review with the client." : index === 0 ? "Confirm the offer terms before entering the contract dates." : "Keep the file notes current as the transaction progresses.", createdAt: stamp(-35), updatedAt };
  const linked = Object.entries(contactTransactionIds).filter(([, linkedIds]) => linkedIds.includes(deal.id)).map(([contactId]) => contactId);
  const role = deal.side === "listing" ? "seller" : "buyer";
  const parties = (linked.length ? linked : [null]).map((contactId, position) => ({ id: `89000000-0000-4000-8000-${String((index + 1) * 100 + position).padStart(12, "0")}`, transactionId: id, role, displayName: deal.clientName, company: null, email: null, phone: null, isPrimary: position === 0, contactId, createdAt: stamp(-35), updatedAt }));
  const deadlines = deadlineSpecs[index].map(([kind, label, offset, done], position) => ({ id: `90000000-0000-4000-8000-${String((index + 1) * 100 + position).padStart(12, "0")}`, transactionId: id, kind, label, dueDate: day(offset), note: kind === "inspection" ? "Review the report before the entered deadline." : "", completedAt: done ? `${day(offset)}T16:00:00.000Z` : null, removedAt: null, sortOrder: position, createdAt: stamp(-35), updatedAt }));
  const history = Array.from({ length: index === 2 ? 25 : 1 }, (_, position) => ({ id: `91000000-0000-4000-8000-${String((index + 1) * 100 + position).padStart(12, "0")}`, eventType: position ? "transaction_updated" : "transaction_created", action: position ? "edit" : "create", fields: position ? ["notes"] : ["stage", "side", "transactionType"], createdAt: stamp(-35 + position) }));
  return { row, parties, deadlines, history };
});
export const SAMPLE_FOREIGN_TRANSACTION_ID = "88000000-0000-4000-8000-000000000999";
sampleTransactionBundles.push({ row: { ...structuredClone(sampleTransactionBundles[0].row), id: SAMPLE_FOREIGN_TRANSACTION_ID, brokerageKey: "other-design-preview", agentUserId: SAMPLE_COLLEAGUE_ID, addressLine1: "Sample other brokerage private file" }, parties: [], deadlines: [], history: [] });
