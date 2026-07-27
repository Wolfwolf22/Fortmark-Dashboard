/**
 * FortMark domain types — the contract between the UI and the data layer.
 * Adapters in `lib/data/adapters/` return these shapes today from mock data;
 * the real MLS / Postgres integrations return the same shapes later.
 */

// ---------------------------------------------------------------------------
// Shared

export type DateRangePreset = "today" | "week" | "month" | "quarter" | "year";

export interface DateRange {
  from: Date;
  to: Date;
}

export type StatusTone = "good" | "warn" | "bad" | "neutral";

// ---------------------------------------------------------------------------
// People

export interface Agent {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  role: "broker" | "agent" | "coordinator";
  licenseNo: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: "buyer" | "seller" | "both";
}

// ---------------------------------------------------------------------------
// Listings

export type ListingStatus =
  | "active"
  | "pending"
  | "underContract"
  | "closed"
  | "expired"
  | "withdrawn";

export type PropertyType =
  | "singleFamily"
  | "condo"
  | "townhouse"
  | "multiFamily"
  | "land";

export interface PriceEvent {
  date: string; // ISO
  price: number;
  kind: "listed" | "reduced" | "increased" | "closed";
}

export interface Listing {
  id: string;
  mlsNumber: string;
  folioNumber: string;
  address: string;
  city: string;
  zip: string;
  neighborhood: string;
  status: ListingStatus;
  propertyType: PropertyType;
  listPrice: number;
  closedPrice?: number;
  beds: number;
  baths: number;
  sqft: number;
  lotSqft?: number;
  yearBuilt: number;
  listedDate: string; // ISO
  closedDate?: string; // ISO
  expiresDate?: string; // ISO
  daysOnMarket: number;
  agentId: string;
  photos: string[]; // URLs — local SVG plates today, MLS media later
  description: string;
  priceHistory: PriceEvent[];
  featured?: boolean;
}

export interface ListingFilters {
  status?: ListingStatus[];
  propertyType?: PropertyType[];
  city?: string[];
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  query?: string;
}

// ---------------------------------------------------------------------------
// Transactions

export type TransactionStage =
  | "offer"
  | "underContract"
  | "inspection"
  | "appraisal"
  | "financing"
  | "clearToClose"
  | "closed";

export const TRANSACTION_STAGES: TransactionStage[] = [
  "offer",
  "underContract",
  "inspection",
  "appraisal",
  "financing",
  "clearToClose",
  "closed",
];

export const TRANSACTION_STAGE_LABELS: Record<TransactionStage, string> = {
  offer: "Offer",
  underContract: "Under contract",
  inspection: "Inspection",
  appraisal: "Appraisal",
  financing: "Financing",
  clearToClose: "Clear to close",
  closed: "Closed",
};

export type MilestoneKey =
  | "offerAccepted"
  | "inspection"
  | "appraisal"
  | "financing"
  | "clearToClose"
  | "closing";

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  offerAccepted: "Offer accepted",
  inspection: "Inspection",
  appraisal: "Appraisal",
  financing: "Financing",
  clearToClose: "Clear to close",
  closing: "Closing",
};

export interface Milestone {
  key: MilestoneKey;
  label: string;
  date: string; // ISO — completed date or due date
  state: "done" | "upcoming" | "overdue";
}

export interface Transaction {
  id: string;
  listingId?: string;
  address: string;
  city: string;
  clientId: string;
  clientName: string;
  side: "list" | "buy";
  stage: TransactionStage;
  contractPrice: number;
  commissionRate: number; // e.g. 0.03
  contractDate: string; // ISO — offer accepted
  closeDate: string; // ISO — scheduled or actual
  agentId: string;
  milestones: Milestone[];
  status: StatusTone; // on track / at risk / off track rollup
  statusLabel: string; // "On track" | "At risk" | "Off track"
}

export interface TransactionFilters {
  stage?: TransactionStage[];
  side?: ("list" | "buy")[];
  agentId?: string;
  query?: string;
}

// ---------------------------------------------------------------------------
// Leads

export type LeadStage =
  | "new"
  | "contacted"
  | "qualified"
  | "touring"
  | "negotiating"
  | "converted"
  | "lost";

export const LEAD_STAGES: LeadStage[] = [
  "new",
  "contacted",
  "qualified",
  "touring",
  "negotiating",
  "converted",
  "lost",
];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  touring: "Touring",
  negotiating: "Negotiating",
  converted: "Converted",
  lost: "Lost",
};

export type LeadSource =
  | "referral"
  | "sphere"
  | "signCall"
  | "website"
  | "openHouse"
  | "pastClient";

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  referral: "Referral",
  sphere: "Sphere",
  signCall: "Sign call",
  website: "Website",
  openHouse: "Open house",
  pastClient: "Past client",
};

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  stage: LeadStage;
  source: LeadSource;
  intent: "buy" | "sell" | "both";
  budget?: number;
  neighborhood?: string;
  assignedAgentId: string;
  createdDate: string; // ISO
  lastContactDate: string; // ISO
  notes: string;
}

// ---------------------------------------------------------------------------
// Calendar

export type EventType =
  | "showing"
  | "inspection"
  | "appraisal"
  | "closing"
  | "openHouse"
  | "deadline";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  showing: "Showing",
  inspection: "Inspection",
  appraisal: "Appraisal",
  closing: "Closing",
  openHouse: "Open house",
  deadline: "Deadline",
};

export interface CalendarEvent {
  id: string;
  type: EventType;
  title: string;
  address?: string;
  start: string; // ISO with time
  end: string; // ISO with time
  agentId: string;
  transactionId?: string;
  listingId?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Documents

export type DocumentStatus = "missing" | "pendingSignature" | "executed";

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  missing: "Missing",
  pendingSignature: "Pending signature",
  executed: "Executed",
};

export interface TransactionDocument {
  id: string;
  transactionId: string;
  address: string; // denormalized for table display
  name: string;
  kind:
    | "contract"
    | "disclosure"
    | "addendum"
    | "inspectionReport"
    | "appraisal"
    | "closingStatement";
  status: DocumentStatus;
  updatedDate: string; // ISO
  dueDate?: string; // ISO
}

// ---------------------------------------------------------------------------
// Market pulse / activity

export interface MarketActivityItem {
  id: string;
  timestamp: string; // ISO
  kind: "priceReduction" | "newComp" | "demandShift" | "newListing" | "closed";
  title: string;
  detail: string;
  neighborhood: string;
  delta?: { value: number; direction: "up" | "down"; unit: "%" | "$" };
}

// ---------------------------------------------------------------------------
// Compliance

export interface ComplianceItem {
  id: string;
  kind: "expiringListing" | "missingDisclosure" | "inspectionDeadline";
  title: string;
  detail: string;
  dueDate: string; // ISO
  severity: StatusTone;
  href: string; // real in-app route the row navigates to
}

// ---------------------------------------------------------------------------
// Messages

export interface MessageThread {
  id: string;
  participantName: string;
  participantRole: "client" | "agent" | "lender" | "inspector" | "title";
  subject: string;
  lastMessageDate: string; // ISO
  unread: boolean;
  messages: ThreadMessage[];
}

export interface ThreadMessage {
  id: string;
  from: "me" | "them";
  body: string;
  date: string; // ISO
}

// ---------------------------------------------------------------------------
// Notifications

export interface AppNotification {
  id: string;
  title: string;
  detail: string;
  date: string; // ISO
  read: boolean;
  href: string;
}

// ---------------------------------------------------------------------------
// Reports / metrics

export interface PeriodPoint {
  label: string; // "Jan", "Wk 3", "Q2" …
  date: string; // ISO period start
  value: number;
}

export interface AgentProduction {
  agentId: string;
  name: string;
  offersMade: number;
  volume: number; // active pipeline volume
  dealsClosed: number;
  closedDollars: number;
}

export interface DashboardMetrics {
  underContractCount: number;
  underContractGoal: number;
  closedCount: number;
  closedGoal: number;
  pipelineValue: number;
  projectedGci: number;
  closedVolume: number;
  closedVolumePrev: number; // prior comparable period
  closedVolumeSpark: PeriodPoint[];
  commissionByPeriod: PeriodPoint[];
  leadSourceBreakdown: { source: LeadSource; count: number }[];
}

// ---------------------------------------------------------------------------
// Search (⌘K)

export interface SearchResult {
  id: string;
  kind: "listing" | "transaction" | "contact";
  title: string;
  subtitle: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Settings

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Broker" | "Agent" | "Transaction coordinator" | "Admin";
  status: "active" | "invited";
}

export interface BrokerageProfile {
  name: string;
  license: string;
  address: string;
  phone: string;
  email: string;
}

export interface IntegrationStatus {
  id: "mls" | "gmail" | "calendar";
  name: string;
  description: string;
  connected: boolean;
}
