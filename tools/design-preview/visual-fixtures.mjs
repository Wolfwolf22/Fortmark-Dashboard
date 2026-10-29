// Synthetic visual cases only. None describes a real property or client.
const day = (offset) => {
  const value = new Date();
  value.setUTCHours(16, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString();
};
const photo = (number) => `/photos/plate-${String(number).padStart(2, "0")}.svg`;
const baseListing = {
  source: "sample", status: "active", propertyType: "singleFamily", city: "Fort Lauderdale", zip: "33308",
  beds: 3, baths: 2, sqft: 1850, lotSqft: 6000, yearBuilt: 1998, listedDate: day(-12), daysOnMarket: 12,
  agentId: "sample-agent", listingAgent: { name: "Sample Agent" },
  description: "Synthetic property for visual review. The illustrations, address, specifications and prices are sample data and do not describe a real listing.",
  priceHistory: [],
};
export const visualListings = [
  { ...baseListing, id: "sample-coastal", mlsNumber: "SAMPLE-001", address: "Sample Coastal Residence", neighborhood: "Sample coastal area", listPrice: 785000, photos: [photo(1), photo(2), photo(3)], agentRole: "primary" },
  { ...baseListing, id: "sample-courtyard", mlsNumber: "SAMPLE-002", address: "Sample Courtyard House", listPrice: 565000, beds: 4, baths: 3, sqft: 2240, photos: [photo(4)], daysOnMarket: 6, listedDate: day(-6), agentRole: "co_listing" },
  { ...baseListing, id: "sample-condo", mlsNumber: "SAMPLE-003", address: "Sample Waterfront Apartment", propertyType: "condo", listPrice: 425000, beds: 2, baths: 2, sqft: 1180, photos: [photo(5), photo(6), photo(7)], daysOnMarket: 20, listedDate: day(-20) },
  { ...baseListing, id: "sample-empty-photo", mlsNumber: "SAMPLE-004", address: "Sample Property Without Photos", listPrice: 390000, photos: [], propertyType: "townhouse", city: "Hollywood", beds: 2, baths: 2, sqft: 1420 },
  // Simulates the MLS missing-media path without reaching a real image host.
  { ...baseListing, id: "sample-mls-broken-photo", mlsNumber: "PREVIEW-NO-MEDIA", address: "Sample MLS Missing-Media Case", listPrice: 625000, source: "mls", photos: ["/photos/preview-deliberately-missing.jpg"], agentId: "", listingOffice: { name: "Sample office - design fixture" } },
  { ...baseListing, id: "sample-closed", mlsNumber: "SAMPLE-005", address: "Sample Closed Residence", listPrice: 805000, closedPrice: 790000, closedDate: day(-8), status: "closed", photos: [photo(8), photo(9)], priceHistory: [{ date: day(-60), price: 805000, kind: "listed" }, { date: day(-8), price: 790000, kind: "closed" }] },
];

const milestone = (id, label, offset, state, key = "other") => ({ id, label, date: day(offset), state, key });
const baseDeal = {
  source: "sample", city: "Fort Lauderdale", clientId: "sample-client", clientName: "Sample Client", agentId: "sample-agent", agentName: "Sample Agent",
  side: "listing", transactionType: "residential_sale", commissionRate: 0.025,
  contractDate: day(-10), status: "good", statusLabel: "On track",
};
export const visualTransactions = [
  { ...baseDeal, id: "sample-offer", address: "Sample Offer - No Closing Date", listingId: "sample-coastal", stage: "offer", contractPrice: 785000, commissionRate: 0, projectedCommission: 0, milestones: [] },
  { ...baseDeal, id: "sample-diligence", address: "Sample Courtyard House", listingId: "sample-courtyard", clientName: "Sample Buyer", side: "buyer", stage: "due_diligence", contractPrice: 565000, projectedCommission: 14125, closeDate: day(25), status: "warn", statusLabel: "At risk", milestones: [milestone("inspection", "Inspection", -1, "overdue", "inspection"), milestone("appraisal", "Appraisal", 5, "upcoming", "appraisal"), milestone("closing", "Closing", 25, "upcoming", "closing")] },
  { ...baseDeal, id: "sample-financing", address: "Sample Waterfront Apartment", listingId: "sample-condo", clientName: "Sample Apartment Buyer", stage: "financing", contractPrice: 425000, projectedCommission: 10625, closeDate: day(18), milestones: [milestone("inspection", "Inspection", -7, "done", "inspection"), milestone("appraisal", "Appraisal", -3, "done", "appraisal"), milestone("financing", "Financing approval", 4, "upcoming", "financing"), milestone("closing", "Closing", 18, "upcoming", "closing")] },
  { ...baseDeal, id: "sample-closing", address: "Sample Closing Preparation", clientName: "Sample Seller", stage: "closing_prep", contractPrice: 390000, projectedCommission: 9750, closeDate: day(3), milestones: [milestone("inspection", "Inspection", -20, "done", "inspection"), milestone("financing", "Financing", -10, "done", "financing"), milestone("title", "Title review", 1, "upcoming", "title"), milestone("closing", "Closing", 3, "upcoming", "closing")] },
  { ...baseDeal, id: "sample-on-hold", address: "Sample Paused Transaction", clientName: "Sample Paused Client", stage: "on_hold", contractPrice: 620000, projectedCommission: 15500, status: "neutral", statusLabel: "On hold", milestones: [] },
  { ...baseDeal, id: "sample-closed", address: "Sample Closed Residence", listingId: "sample-closed", stage: "closed", contractPrice: 790000, projectedCommission: 19750, closeDate: day(-8), status: "neutral", statusLabel: "Closed", milestones: [milestone("inspection", "Inspection", -30, "done", "inspection"), milestone("closing", "Closing", -8, "done", "closing")] },
];

export const sampleAgent = { id: "sample-agent", name: "Sample Agent", role: "agent", email: "preview@example.com", phone: "", licenseNo: "SAMPLE" };
