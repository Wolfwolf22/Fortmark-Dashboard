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
  | "comingSoon"
  | "pending"
  | "underContract"
  | "closed"
  | "expired"
  | "withdrawn"
  | "hold";

export type PropertyType =
  | "singleFamily"
  | "condo"
  | "townhouse"
  | "multiFamily"
  | "land"
  | "other";

export interface PriceEvent {
  date: string; // ISO
  price: number;
  kind: "listed" | "reduced" | "increased" | "closed";
}

/**
 * Where a listing row came from. `mls` rows are the brokerage's actual MLS
 * feed; `sample` rows are the seeded generators and are labelled as such in
 * the UI. Never rendered as one another.
 */
export type ListingSource = "mls" | "sample";

export interface Listing {
  /** Durable identifier: the RESO ListingKey for MLS rows. Used in URLs. */
  id: string;
  mlsNumber: string;
  /** County parcel / folio number. Absent when the feed does not carry it. */
  folioNumber?: string;
  address: string;
  city: string;
  zip: string;
  /** Subdivision or area. Absent until the feed field is verified. */
  neighborhood?: string;
  status: ListingStatus;
  propertyType: PropertyType;
  listPrice: number;
  closedPrice?: number;
  /** 0 means "not stated" — the spec line and summary treat 0 as unknown. */
  beds: number;
  baths: number;
  sqft: number;
  lotSqft?: number;
  yearBuilt?: number;
  listedDate: string; // ISO
  closedDate?: string; // ISO
  expiresDate?: string; // ISO
  daysOnMarket?: number;
  /** Internal roster id for sample rows; empty for MLS rows (see listingAgent). */
  agentId: string;
  /** Listing agent as stated by the feed, when the feed carries it. */
  listingAgent?: { name: string; phone?: string; email?: string; office?: string };
  /**
   * Listing brokerage as stated by the feed. IDX display rules require the
   * listing office to be attributed wherever a listing is shown.
   */
  listingOffice?: { name?: string; mlsId?: string };
  /**
   * The signed-in agent's role on this listing, when the listing was read for
   * My Listings: `primary` (listing agent) or `co_listing`. Absent elsewhere.
   */
  agentRole?: "primary" | "co_listing";
  /** True when FortMark is the listing (or co-listing) office, by MLS office id. */
  isFortmark?: boolean;
  /**
   * True when the listing broker has withheld the address from internet
   * display (RESO `InternetAddressDisplayYN = false`). `address` then holds a
   * neutral placeholder and coordinates are dropped.
   */
  addressWithheld?: boolean;
  /** URLs. Empty for an MLS row whose media has not been fetched or has none. */
  photos: string[];
  description: string;
  priceHistory: PriceEvent[];
  featured?: boolean;
  source: ListingSource;
  coordinates?: { lat: number; lng: number };
}

export interface ListingFilters {
  /**
   * "fortmark" restricts the search to FortMark's own listings (by MLS office
   * id); "mine" to the signed-in agent's listings and co-listings (by MLS
   * member key). Absent means the whole MLS.
   */
  office?: "fortmark" | "mine";
  status?: ListingStatus[];
  propertyType?: PropertyType[];
  city?: string[];
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  query?: string;
}

/** Sort keys the listings screen exposes. Not every key is server-sortable. */
export type ListingSortKey =
  | "address"
  | "city"
  | "status"
  | "propertyType"
  | "listPrice"
  | "beds"
  | "baths"
  | "sqft"
  | "ppsf"
  | "daysOnMarket"
  | "listedDate";

export type SortDirection = "asc" | "desc";

/** One page of a listing search, as the server resolved it. */
export interface ListingSearchQuery extends ListingFilters {
  page: number;
  pageSize: number;
  sortKey: ListingSortKey;
  sortDirection: SortDirection;
}

export interface ListingPage {
  items: Listing[];
  /** Total rows matching the filter, across all pages. */
  total: number;
  page: number;
  pageSize: number;
  source: ListingSource;
  /**
   * False when the requested sort could not be applied by the source (the
   * MLS cannot sort by a derived value such as $/sqft) and rows arrived in
   * the source's default order instead. The UI says so rather than pretending.
   */
  sortApplied: boolean;
}

// ---------------------------------------------------------------------------
// Transactions
//
// The lifecycle is the brokerage's, not a residential-buyer funnel: six active
// stages from opportunity to closing prep, closed, and four ways out. Values
// match the database enum in `lib/db/schema.ts`; the rules for moving between
// them live in `lib/transactions/stages.ts`.

export type TransactionStage =
  | "opportunity"
  | "offer"
  | "under_contract"
  | "due_diligence"
  | "financing"
  | "closing_prep"
  | "closed"
  | "cancelled"
  | "withdrawn"
  | "on_hold"
  | "fell_through";

/** Pipeline columns, in order. Terminal exits and on-hold are not columns. */
export const TRANSACTION_STAGES: TransactionStage[] = [
  "opportunity",
  "offer",
  "under_contract",
  "due_diligence",
  "financing",
  "closing_prep",
  "closed",
];

/** Stages a deal leaves the pipeline by, other than closing. */
export const TRANSACTION_EXIT_STAGES: TransactionStage[] = [
  "cancelled",
  "withdrawn",
  "fell_through",
];

export const TRANSACTION_STAGE_LABELS: Record<TransactionStage, string> = {
  opportunity: "Opportunity",
  offer: "Offer",
  under_contract: "Under contract",
  due_diligence: "Due diligence",
  financing: "Financing",
  closing_prep: "Closing prep",
  closed: "Closed",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  on_hold: "On hold",
  fell_through: "Fell through",
};

/** Which side FortMark represents. */
export type TransactionSide = "listing" | "buyer" | "dual" | "landlord" | "tenant";

export type TransactionType =
  | "residential_sale"
  | "residential_lease"
  | "commercial_sale"
  | "commercial_lease"
  | "land";

/** A milestone is an entered deadline of one of these kinds. */
export type MilestoneKey =
  | "inspection"
  | "financing"
  | "appraisal"
  | "hoa_condo_application"
  | "title"
  | "closing"
  | "possession"
  | "other";

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  inspection: "Inspection",
  financing: "Financing",
  appraisal: "Appraisal",
  hoa_condo_application: "HOA / condo application",
  title: "Title",
  closing: "Closing",
  possession: "Possession",
  other: "Milestone",
};

export interface Milestone {
  /** Deadline id for database rows; the kind for sample rows. */
  id: string;
  key: MilestoneKey;
  label: string;
  date: string; // ISO — due date
  state: "done" | "upcoming" | "overdue";
}

/** Where a transaction row came from. Sample rows are labelled in the UI. */
export type TransactionSource = "db" | "sample";

export interface Transaction {
  id: string;
  /** MLS ListingKey when the deal is linked to a listing FortMark can see. */
  listingId?: string;
  address: string;
  city: string;
  /** The primary client party's id; empty when none is recorded yet. */
  clientId: string;
  /** The primary client party's name; "—" when none is recorded yet. */
  clientName: string;
  side: TransactionSide;
  transactionType: TransactionType;
  stage: TransactionStage;
  /** Dollars. 0 when no price has been entered. */
  contractPrice: number;
  /** Fraction, e.g. 0.03. 0 when no rate has been entered. */
  commissionRate: number;
  /** Projected gross commission in dollars, from the entered terms. */
  projectedCommission: number;
  /** ISO — contract execution date, or the record's creation when none. */
  contractDate: string;
  /** ISO — scheduled (or actual) closing. Absent until one is entered. */
  closeDate?: string;
  /** The responsible agent: a sample roster id, or a dashboard user id. */
  agentId: string;
  /** The responsible agent's display name, when the source states it. */
  agentName?: string;
  milestones: Milestone[];
  status: StatusTone; // on track / at risk / off track rollup
  statusLabel: string; // "On track" | "At risk" | "Off track" | terminal label
  source: TransactionSource;
}

export interface TransactionFilters {
  stage?: TransactionStage[];
  side?: TransactionSide[];
  agentId?: string;
  query?: string;
}

// ---------------------------------------------------------------------------
// Leads
//
// The screen still says "leads"; the record is a contact — one person whose
// relationship with the brokerage has a stage, and whose needs are
// opportunities. Values match the database enums in `lib/db/schema.ts`; the
// rules for moving between stages live in `lib/contacts/stages.ts`.

export type LeadStage =
  | "lead"
  | "contacted"
  | "qualified"
  | "appointment"
  | "representation"
  | "active_client"
  | "under_contract"
  | "closed"
  | "past_client"
  | "lost"
  | "archived";

/** Stages shown on the pipeline strip, in order. Archived is not one. */
export const LEAD_STAGES: LeadStage[] = [
  "lead",
  "contacted",
  "qualified",
  "appointment",
  "representation",
  "active_client",
  "under_contract",
  "closed",
  "past_client",
  "lost",
];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  lead: "Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  appointment: "Appointment",
  representation: "Representation",
  active_client: "Active client",
  under_contract: "Under contract",
  closed: "Closed",
  past_client: "Past client",
  lost: "Lost",
  archived: "Archived",
};

export type LeadSource =
  | "referral"
  | "sphere"
  | "sign_call"
  | "website"
  | "open_house"
  | "past_client"
  | "social"
  | "advertising"
  | "walk_in"
  | "other";

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  referral: "Referral",
  sphere: "Sphere",
  sign_call: "Sign call",
  website: "Website",
  open_house: "Open house",
  past_client: "Past client",
  social: "Social",
  advertising: "Advertising",
  walk_in: "Walk-in",
  other: "Other",
};

/** What the person needs, summarised from their open opportunities. */
export type LeadIntent = "buy" | "sell" | "both" | "lease" | "invest" | "other";

export type LeadSourceOfRecord = "db" | "sample";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  stage: LeadStage;
  source: LeadSource;
  intent: LeadIntent;
  /** Dollars — the primary open opportunity's upper budget, when stated. */
  budget?: number;
  /** The primary open opportunity's area, when stated. */
  neighborhood?: string;
  /** A sample roster id, or a dashboard user id. */
  assignedAgentId: string;
  /** The assigned agent's display name, when the source states it. */
  assignedAgentName?: string;
  createdDate: string; // ISO
  /** ISO — the latest activity, or creation when there is none. */
  lastContactDate: string;
  nextFollowUpDate?: string; // ISO
  notes: string;
  recordSource: LeadSourceOfRecord;
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

// The ⌘K result shape moved to lib/search/types.ts in Release E2, where it
// covers every searchable entity and carries each provider's availability.
// Two competing result contracts is one too many.

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
