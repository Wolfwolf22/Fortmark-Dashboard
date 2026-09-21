/**
 * Release 1 schema — persistent FortMark users and professional profiles.
 *
 * IMPORTANT: none of these tables control dashboard access in Release 1.
 * `FORTMARK_ALLOWED_CLERK_USER_IDS` remains the operational access authority
 * (see `lib/auth/dashboard-access.ts`). A row here records *who someone is*,
 * not *whether they may enter*. Database-backed authorization arrives in a
 * later release behind `DATABASE_ACCESS_CONTROL_ENABLED`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --- Enums -----------------------------------------------------------------
// Release 1 deliberately omits the invitation/approval states (invited,
// onboarding, pending_approval, rejected). Adding them later is an additive
// ALTER TYPE, which is forward-safe.

export const userStatus = pgEnum("dashboard_user_status", [
  "active",
  "pending_profile",
  "suspended",
]);

export const userRole = pgEnum("dashboard_user_role", [
  "admin",
  "broker",
  "transaction_coordinator",
  "agent",
  "member",
]);

export const imageProcessingStatus = pgEnum("profile_image_status", [
  "clerk_only",
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

/**
 * Whether an MLS identity has been confirmed against the issuing board.
 *
 * Two states only, because two is all this application can honestly
 * distinguish: a user typed an identifier, or a real verification mechanism
 * confirmed it. There is no `pending` — nothing is queued anywhere — and no
 * `failed`, which would imply a check ran. Every row written today is
 * `unverified`; `verified` exists so that a later release which DOES verify
 * has somewhere truthful to record it, not as a state a user can reach.
 */
export const mlsVerificationStatus = pgEnum("profile_mls_verification_status", [
  "unverified",
  "verified",
]);

// --- dashboard_users -------------------------------------------------------

export const dashboardUsers = pgTable(
  "dashboard_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk subject. Server-side only — never sent to the browser. */
    clerkUserId: text("clerk_user_id").notNull(),
    primaryEmail: text("primary_email").notNull(),
    status: userStatus("status").notNull().default("pending_profile"),
    role: userRole("role").notNull().default("member"),
    onboardingComplete: timestamp("onboarding_complete", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per Clerk identity — the sync path relies on this for its upsert.
    uniqueIndex("dashboard_users_clerk_user_id_key").on(t.clerkUserId),
    index("dashboard_users_status_idx").on(t.status),
    index("dashboard_users_role_idx").on(t.role),
  ]
);

// --- professional_profiles -------------------------------------------------

export const professionalProfiles = pgTable(
  "professional_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => dashboardUsers.id, { onDelete: "cascade" }),
    legalFirstName: text("legal_first_name"),
    legalLastName: text("legal_last_name"),
    preferredDisplayName: text("preferred_display_name"),
    /** Normalised to E.164 on write; never rendered in the top bar. */
    phoneE164: text("phone_e164"),
    brokerageOffice: text("brokerage_office"),
    licenseState: text("license_state"),
    licenseType: text("license_type"),
    licenseNumber: text("license_number"),
    licenseExpiration: date("license_expiration"),
    nrdsNumber: text("nrds_number"),
    biography: text("biography"),
    // --- Release 1.1: professional presence -------------------------------
    // All nullable and additive. Titles and locations are display strings;
    // the URL columns hold already-normalised absolute https URLs (the service
    // rejects every other scheme before a write reaches here). Email and phone
    // are deliberately NOT duplicated — `dashboard_users.primary_email` and
    // `phone_e164` above remain the single source for those.
    professionalTitle: text("professional_title"),
    locationDisplay: text("location_display"),
    linkedinUrl: text("linkedin_url"),
    instagramUrl: text("instagram_url"),
    facebookUrl: text("facebook_url"),
    personalWebsiteUrl: text("personal_website_url"),
    professionalWebsiteUrl: text("professional_website_url"),
    /** Separate from `phoneE164` — many agents use a different WhatsApp line. */
    whatsappPhoneE164: text("whatsapp_phone_e164"),
  /**
   * Public/business contact address, distinct from the Clerk sign-in address.
   *
   * `dashboard_users.primary_email` is the verified account email and is
   * read-only here — the onboarding wizard shows it but must never change it.
   * This is the address a professional chooses to publish, which is frequently
   * not the one they log in with.
   */
  businessEmail: text("business_email"),
  // --- Release B: MLS identity ------------------------------------------
  /**
   * The agent identifier issued by the user's MLS or board.
   *
   * SELF-REPORTED. FortMark has no connection to any MLS, so this column
   * records a claim, not a confirmed fact — `mlsVerificationStatus` beside it
   * is what keeps that distinction in the data rather than in a comment.
   *
   * Deliberately NOT unique. Two rows holding the same identifier is a data
   * question for a human, and a unique index would turn it into a failed save
   * for whoever typed it second — including the legitimate owner, if someone
   * else claimed it first. Uniqueness becomes meaningful once verification is
   * real; until then it would only enforce first-come-first-served.
   */
  mlsAgentId: text("mls_agent_id"),
  /** The board or MLS the identifier belongs to. Catalogue value or free text. */
  mlsOrganization: text("mls_organization"),
  /**
   * Server-assigned. Absent from `profileUpdateSchema`, so no request shape
   * can set it — a user cannot mark their own identity verified.
   */
  mlsVerificationStatus: mlsVerificationStatus("mls_verification_status")
    .notNull()
    .default("unverified"),
  /** Stamped only by a real verification. Null on every row this release writes. */
  mlsVerifiedAt: timestamp("mls_verified_at", { withTimezone: true }),
  /**
   * Last onboarding step the user completed, so the wizard can resume.
   *
   * Nullable and additive: null means "never started", which is also what
   * every pre-existing row reads as. Whether onboarding is FINISHED is not
   * stored here — `dashboard_users.onboarding_complete` already answers that,
   * and duplicating it as a status column would create two sources of truth
   * that can disagree.
   */
  onboardingStep: integer("onboarding_step"),
    /** Free-form lists stored as jsonb arrays of trimmed strings. */
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    specialties: jsonb("specialties").$type<string[]>().notNull().default([]),
    serviceAreas: jsonb("service_areas").$type<string[]>().notNull().default([]),
    profileCompletionPercent: integer("profile_completion_percent")
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("professional_profiles_user_id_key").on(t.userId)]
);

// --- profile_images --------------------------------------------------------
// Release 1 stores references only. No upload or processing runs yet, so every
// row starts at `clerk_only`; the processed columns exist so the later
// Cloudinary release is an additive change rather than a table rewrite.

export const profileImages = pgTable(
  "profile_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => dashboardUsers.id, { onDelete: "cascade" }),
    clerkImageUrl: text("clerk_image_url"),
    /** The image currently shown. Never overwritten by a failed processing run. */
    activeImageUrl: text("active_image_url"),
    processedImageUrl: text("processed_image_url"),
    /**
     * The Blob object key for the active upload, e.g.
     * `profile-images/<user-uuid>/<upload-uuid>.jpg`.
     *
     * Stored separately from the display URL because deletion and the
     * ownership-prefix check both need the pathname, and deriving it back out
     * of a CDN URL is guesswork that breaks the moment the URL shape changes.
     * Null for rows whose active image is still the Clerk-hosted one — there is
     * nothing of ours to delete in that case.
     */
    storagePathname: text("storage_pathname"),
    processingStatus: imageProcessingStatus("processing_status")
      .notNull()
      .default("clerk_only"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("profile_images_user_id_key").on(t.userId)]
);

// --- audit_events ----------------------------------------------------------

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for system-initiated events such as the first sync. */
    actorUserId: uuid("actor_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),
    targetUserId: uuid("target_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    /**
     * Non-sensitive context only. Never secrets, tokens, cookies, headers or
     * raw Clerk identifiers — `writeAuditEvent` strips those defensively.
     */
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_events_target_idx").on(t.targetUserId),
    index("audit_events_type_idx").on(t.eventType),
    index("audit_events_created_idx").on(t.createdAt),
  ]
);

/** Event types Release 1 is allowed to write. */
export const RELEASE_1_AUDIT_EVENTS = [
  "user_record_created",
  "profile_created",
  "profile_updated",
  "user_synced_from_clerk",
  "bootstrap_admin_assigned",
  "role_changed",
  // Release C — transactions. Additive; the list is closed so a typo cannot
  // invent an event type.
  "transaction_created",
  "transaction_updated",
  "transaction_stage_changed",
] as const;

export type AuditEventType = (typeof RELEASE_1_AUDIT_EVENTS)[number];
export type DashboardUser = typeof dashboardUsers.$inferSelect;
export type ProfessionalProfile = typeof professionalProfiles.$inferSelect;
export type ProfileImage = typeof profileImages.$inferSelect;

// ===========================================================================
// Release C — Transactions
//
// The first brokerage-owned operational domain. Confidential by nature, so
// every row carries the brokerage it belongs to and the agent responsible
// for it, and the service scopes every query by both — authentication alone
// is never authorization here.
//
// Money is stored as integer cents and rates as integer basis points. No
// column holds a float, and no derived figure (gross commission, agent
// portion, net) is persisted: they are computed from the stored inputs by
// `lib/transactions/money.ts` so a rate change can never leave a stale total
// behind. Projected money is never presented as paid money — paid amounts
// have their own columns and are null until money actually moves.
//
// Dates that are dates (a closing date, a deadline) are `date`, not
// timestamps: a Florida closing on the 30th is the 30th in every timezone.
// ===========================================================================

/** Tenant key. One organisation today; a `brokerages` table is an additive
 *  later step, and every query is already written to scope by this. */
export const FORTMARK_BROKERAGE_KEY = "fortmark";

/**
 * Lifecycle. Not a residential-buyer funnel: seller listings and commercial
 * deals live here too, so the stages describe where a deal IS, not what kind
 * of deal it is. Terminal states are explicit rather than a flag on `closed`.
 * Adding a stage later is an additive ALTER TYPE.
 */
export const transactionStage = pgEnum("transaction_stage", [
  "opportunity",
  "offer",
  "under_contract",
  "due_diligence",
  "financing",
  "closing_prep",
  "closed",
  "cancelled",
  "withdrawn",
  "on_hold",
  "fell_through",
]);

export const transactionType = pgEnum("transaction_type", [
  "residential_sale",
  "residential_lease",
  "commercial_sale",
  "commercial_lease",
  "land",
]);

/** Which side FortMark represents. `dual` is both sides of one deal. */
export const transactionSide = pgEnum("transaction_side", [
  "listing",
  "buyer",
  "dual",
  "landlord",
  "tenant",
]);

export const transactionPartyRole = pgEnum("transaction_party_role", [
  "buyer",
  "seller",
  "landlord",
  "tenant",
  "co_agent",
  "cooperating_agent",
  "lender",
  "title_company",
  "attorney",
  "escrow_holder",
  "inspector",
  "appraiser",
  "other",
]);

export const transactionDeadlineKind = pgEnum("transaction_deadline_kind", [
  "inspection",
  "financing",
  "appraisal",
  "hoa_condo_application",
  "title",
  "closing",
  "possession",
  "other",
]);

// --- transactions ------------------------------------------------------------

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant boundary. Set server-side, never from a request. */
    brokerageKey: text("brokerage_key").notNull().default(FORTMARK_BROKERAGE_KEY),
    /**
     * The agent responsible. `restrict` on delete: a deal must never lose its
     * agent silently — reassign first, then remove the user.
     */
    agentUserId: uuid("agent_user_id")
      .notNull()
      .references(() => dashboardUsers.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),

    transactionType: transactionType("transaction_type").notNull(),
    side: transactionSide("side").notNull(),
    stage: transactionStage("stage").notNull().default("opportunity"),

    // --- Property ----------------------------------------------------------
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull().default("FL"),
    postalCode: text("postal_code"),
    county: text("county"),
    /** RESO PropertySubType as the MLS states it, when linked. Free text. */
    propertySubType: text("property_sub_type"),
    /** Link to the MLS record when this deal is a listing FortMark can see. */
    listingKey: text("listing_key"),
    mlsNumber: text("mls_number"),

    // --- Money: integer cents and basis points only ---------------------
    listPriceCents: bigint("list_price_cents", { mode: "number" }),
    offerPriceCents: bigint("offer_price_cents", { mode: "number" }),
    contractPriceCents: bigint("contract_price_cents", { mode: "number" }),
    /** Commission as basis points of the contract price (300 = 3.00%). */
    commissionRateBps: integer("commission_rate_bps"),
    /** Or a flat commission, when the agreement is not a percentage. */
    commissionFlatCents: bigint("commission_flat_cents", { mode: "number" }),
    /** The agent's share of the brokerage's gross, in basis points. */
    agentSplitBps: integer("agent_split_bps"),
    transactionFeeCents: bigint("transaction_fee_cents", { mode: "number" }),
    /** A referral owed out of the gross, in basis points of the gross. */
    referralFeeBps: integer("referral_fee_bps"),
    referralPayee: text("referral_payee"),
    /** Money that actually moved. Null until it does. */
    commissionPaidCents: bigint("commission_paid_cents", { mode: "number" }),
    commissionPaidAt: timestamp("commission_paid_at", { withTimezone: true }),

    // --- Dates that are dates ---------------------------------------------
    contractExecutionDate: date("contract_execution_date"),
    effectiveDate: date("effective_date"),
    /** Scheduled closing. */
    closingDate: date("closing_date"),
    /** Actual closing, stamped when the deal closes. */
    closedDate: date("closed_date"),
    possessionDate: date("possession_date"),
    cancelledDate: date("cancelled_date"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_brokerage_stage_idx").on(t.brokerageKey, t.stage),
    index("transactions_agent_idx").on(t.agentUserId),
    index("transactions_closing_date_idx").on(t.closingDate),
    index("transactions_listing_key_idx").on(t.listingKey),
    index("transactions_mls_number_idx").on(t.mlsNumber),
  ]
);

// --- transaction_parties ------------------------------------------------------
// People and companies on a deal. Free-standing for now; when the contact
// model lands (Release D) a nullable `contact_id` joins these to it — an
// additive column, not a rewrite.

export const transactionParties = pgTable(
  "transaction_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    role: transactionPartyRole("role").notNull(),
    displayName: text("display_name").notNull(),
    company: text("company"),
    email: text("email"),
    /** Normalised to E.164 on write. */
    phoneE164: text("phone_e164"),
    /** The principal for this role when several share it (two buyers). */
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transaction_parties_transaction_idx").on(t.transactionId)]
);

// --- transaction_deadlines ----------------------------------------------------
// Entered deadlines, tracked as entered. The system records what a person
// typed and whether it was met; it does not interpret the contract.

export const transactionDeadlines = pgTable(
  "transaction_deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    kind: transactionDeadlineKind("kind").notNull(),
    /** Display label — "Inspection period ends", "Loan commitment". */
    label: text("label").notNull(),
    dueDate: date("due_date").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transaction_deadlines_transaction_idx").on(t.transactionId),
    // "What is coming up" only ever asks about open deadlines.
    index("transaction_deadlines_open_due_idx")
      .on(t.dueDate)
      .where(sql`${t.completedAt} is null`),
  ]
);

// --- transaction_events -------------------------------------------------------
// Per-deal history: who changed what, when. Powers the activity view and is
// the record a broker reads when asked "what happened on this file".

export const transactionEvents = pgTable(
  "transaction_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    /** Non-sensitive context only, scrubbed the same way as `audit_events`. */
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transaction_events_transaction_created_idx").on(t.transactionId, t.createdAt)]
);

export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;
export type TransactionPartyRow = typeof transactionParties.$inferSelect;
export type TransactionDeadlineRow = typeof transactionDeadlines.$inferSelect;
export type TransactionEventRow = typeof transactionEvents.$inferSelect;
