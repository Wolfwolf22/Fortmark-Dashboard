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
import { CONTACT_NOTE_MAX_LENGTH } from "../contacts/notes.ts";
import { DEFAULT_VENDOR_DETAIL_FIELDS } from "../transactions/vendor-detail-domain.ts";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
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
  "calendar_item_updated", "calendar_label_updated", "calendar_annotation_updated",
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
  // Release D — contacts.
  "contact_created",
  "contact_updated",
  "contact_stage_changed",
  // Contacts V3 — ids, field names and state words only; never note text,
  // need values or a birthday.
  "contact_note_created",
  "contact_note_deleted",
  "contact_need_created",
  "contact_need_updated",
  "contact_need_status_changed",
  "contact_transaction_linked",
  "property_list_updated",
  "showing_updated",
  "showing_tour_updated",
  // Core V1 — brokerage identity. Field NAMES only in metadata, never values.
  "brokerage_identity_created",
  "brokerage_identity_updated",
  "brokerage_mls_synced",
  "mls_identity_resolved",
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
  "general_contractor",
]);

/** Which side FortMark represents. `dual` is both sides of one deal. */
export const transactionSide = pgEnum("transaction_side", [
  "listing",
  "buyer",
  "dual",
  "landlord",
  "tenant",
  "gc",
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
    /** Verified feed identity. Free-form legacy keys do not imply a live link. */
    listingDataset: text("listing_dataset"),
    listingLinkedAt: timestamp("listing_linked_at", { withTimezone: true }),

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

    /** The operational template selected when this file was initialized. */
    checklistTemplateVersion: text("checklist_template_version").notNull().default("brokerage-starter-v1"),

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
    /** Release D: the contact this party is, once linked. Additive, nullable. */
    contactId: uuid("contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transaction_parties_transaction_idx").on(t.transactionId),
    index("transaction_parties_contact_idx").on(t.contactId),
  ]
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
    removedAt: timestamp("removed_at", { withTimezone: true }),
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

/** Safe receipts make explicit transaction retries recoverable without duplicate writes. */
export const transactionWriteRequests = pgTable("transaction_write_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }),
  action: text("action").notNull(), payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<{ transactionId: string; updatedAt: string; deadlineId?: string; attachmentId?: string; vendorSelectionId?: string; vendorDetailId?: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ name: "transaction_write_requests_pkey", columns: [t.actorUserId, t.requestId] }),
  index("transaction_write_requests_transaction_idx").on(t.transactionId),
  check("transaction_write_requests_hash_check", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check("transaction_write_requests_action_check", sql`${t.action} in ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline','complete_checklist','reopen_checklist','upload_attachment','remove_attachment','set_attachment_requirement','set_vendor','edit_vendor_details','upload_vendor_attachment','remove_vendor_attachment','link_property','unlink_property','link_tour','unlink_tour')`),
]);
export type TransactionWriteRequestRow = typeof transactionWriteRequests.$inferSelect;

/** A file keeps the checklist it was opened with, independently of later template changes. */
export const transactionChecklistItems = pgTable("transaction_checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  templateKey: text("template_key").notNull(), label: text("label").notNull(),
  stage: transactionStage("stage").notNull(), required: boolean("required").notNull().default(true),
  attachmentRequired: boolean("attachment_required").notNull().default(false),
  sortOrder: integer("sort_order").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByUserId: uuid("completed_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("transaction_checklist_items_template_idx").on(t.transactionId, t.templateKey),
  index("transaction_checklist_items_stage_idx").on(t.transactionId, t.stage, t.sortOrder),
  check("transaction_checklist_items_stage_check", sql`${t.stage} in ('opportunity','offer','under_contract','due_diligence','financing','closing_prep')`),
  check("transaction_checklist_items_text_check", sql`char_length(btrim(${t.templateKey})) between 1 and 160 and char_length(btrim(${t.label})) between 1 and 240`),
  check("transaction_checklist_items_order_check", sql`${t.sortOrder} between 0 and 999`),
  check("transaction_checklist_items_completion_check", sql`${t.completedAt} is not null or ${t.completedByUserId} is null`),
]);
export type TransactionChecklistItemRow = typeof transactionChecklistItems.$inferSelect;

export const transactionChecklistAttachments = pgTable("transaction_checklist_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }),
  checklistItemId: uuid("checklist_item_id").notNull().references(() => transactionChecklistItems.id, { onDelete: "restrict" }),
  storagePath: text("storage_path").notNull(), filename: text("filename").notNull(), contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(), sha256: text("sha256").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), removedAt: timestamp("removed_at", { withTimezone: true }),
}, t => [
  uniqueIndex("transaction_checklist_attachments_path_idx").on(t.storagePath),
  index("transaction_checklist_attachments_item_idx").on(t.transactionId, t.checklistItemId),
  check("transaction_checklist_attachments_size_check", sql`${t.sizeBytes} between 1 and 4194304`),
  check("transaction_checklist_attachments_type_check", sql`${t.contentType} in ('application/pdf','image/jpeg','image/png')`),
  check("transaction_checklist_attachments_hash_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  check("transaction_checklist_attachments_filename_check", sql`char_length(${t.filename}) between 1 and 180`),
]);
export type TransactionChecklistAttachmentRow = typeof transactionChecklistAttachments.$inferSelect;

export const transactionChecklistTemplateSettings = pgTable("transaction_checklist_template_settings", {
  brokerageKey: text("brokerage_key").notNull(), templateKey: text("template_key").notNull(), attachmentRequired: boolean("attachment_required").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.brokerageKey, t.templateKey] })]);
export const transactionSetupWriteRequests = pgTable("transaction_setup_write_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), brokerageKey: text("brokerage_key").notNull(), action: text("action").notNull(), payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<{ templateKey: string; updatedAt: string }>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.actorUserId, t.requestId] }), check("transaction_setup_requests_action_check", sql`${t.action}='checklist_default'`), check("transaction_setup_requests_hash_check", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);

export const brokerageVendors = pgTable("brokerage_vendors", {
  id: uuid("id").primaryKey().defaultRandom(), brokerageKey: text("brokerage_key").notNull(), name: text("name").notNull(), company: text("company"), email: text("email"), phone: text("phone"),
  categories: text("categories").array().$type<import("../transactions/vendor-domain.ts").VendorRole[]>().notNull(), approved: boolean("approved").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }), updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("brokerage_vendors_book_idx").on(t.brokerageKey, t.approved), check("brokerage_vendors_name_check", sql`char_length(btrim(${t.name})) between 1 and 160`), check("brokerage_vendors_categories_check", sql`cardinality(${t.categories}) between 1 and 8 and ${t.categories} <@ ARRAY['inspector','mortgage','appraiser','termite','insurance','title','attorney','other']::text[]`)]);
export type BrokerageVendorRow = typeof brokerageVendors.$inferSelect;
export const brokerageVendorWriteRequests = pgTable("brokerage_vendor_write_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), brokerageKey: text("brokerage_key").notNull(), vendorId: uuid("vendor_id").notNull().references(() => brokerageVendors.id, { onDelete: "restrict" }), action: text("action").notNull(), payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<{ vendorId: string; updatedAt: string }>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.actorUserId, t.requestId] }), check("brokerage_vendor_requests_action_check", sql`${t.action} in ('create','edit')`), check("brokerage_vendor_requests_hash_check", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);
export const transactionVendorSelections = pgTable("transaction_vendor_selections", {
  id: uuid("id").primaryKey().defaultRandom(), transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }), role: text("role").$type<import("../transactions/vendor-domain.ts").VendorRole>().notNull(), status: text("status").$type<"selected" | "not_needed" | "unset">().notNull(), vendorId: uuid("vendor_id").references(() => brokerageVendors.id, { onDelete: "restrict" }),
  vendorName: text("vendor_name"), company: text("company"), email: text("email"), phone: text("phone"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  detailId: uuid("detail_id").references((): AnyPgColumn => transactionVendorEngagements.id, { onDelete: "restrict" }),
}, t => [uniqueIndex("transaction_vendor_selections_role_idx").on(t.transactionId, t.role), check("transaction_vendor_selections_role_check", sql`${t.role} in ('inspector','mortgage','appraiser','termite','insurance','title','attorney','other')`), check("transaction_vendor_selections_status_check", sql`${t.status} in ('selected','not_needed','unset')`), check("transaction_vendor_selections_vendor_check", sql`(${t.status}='selected' and ${t.vendorId} is not null and ${t.vendorName} is not null) or (${t.status}<>'selected' and ${t.vendorId} is null and ${t.vendorName} is null and ${t.company} is null and ${t.email} is null and ${t.phone} is null)`)]);
export type TransactionVendorSelectionRow = typeof transactionVendorSelections.$inferSelect;

/** Immutable vendor identity per selection generation; replacement never adopts old reports. */
export const transactionVendorEngagements = pgTable("transaction_vendor_engagements", {
  id: uuid("id").primaryKey().defaultRandom(), transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }),
  role: text("role").$type<import("../transactions/vendor-domain.ts").VendorRole>().notNull(), vendorId: uuid("vendor_id").notNull().references(() => brokerageVendors.id, { onDelete: "restrict" }),
  vendorName: text("vendor_name").notNull(), company: text("company"), email: text("email"), phone: text("phone"),
  details: jsonb("details").$type<import("../transactions/vendor-detail-domain.ts").VendorDetailFields>().notNull().default({ ...DEFAULT_VENDOR_DETAIL_FIELDS }),
  createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }), updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("transaction_vendor_engagements_file_idx").on(t.transactionId, t.role, t.createdAt), check("transaction_vendor_engagements_role_check", sql`${t.role} in ('inspector','mortgage','appraiser','termite','insurance','title','attorney','other')`), check("transaction_vendor_engagements_details_check", sql`jsonb_typeof(${t.details})='object'`)]);
export type TransactionVendorEngagementRow = typeof transactionVendorEngagements.$inferSelect;

export const transactionVendorAttachments = pgTable("transaction_vendor_attachments", {
  id: uuid("id").primaryKey().defaultRandom(), transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }), detailId: uuid("detail_id").notNull().references(() => transactionVendorEngagements.id, { onDelete: "restrict" }),
  kind: text("kind").$type<import("../transactions/vendor-detail-domain.ts").VendorAttachmentKind>().notNull(), storagePath: text("storage_path").notNull(), filename: text("filename").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes").notNull(), sha256: text("sha256").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), removedAt: timestamp("removed_at", { withTimezone: true }),
}, t => [uniqueIndex("transaction_vendor_attachments_path_idx").on(t.storagePath), index("transaction_vendor_attachments_detail_idx").on(t.transactionId, t.detailId), check("transaction_vendor_attachments_kind_check", sql`${t.kind} in ('report','invoice','pre_approval','loan_estimate','insurance_quote','other')`), check("transaction_vendor_attachments_size_check", sql`${t.sizeBytes} between 1 and 4194304`), check("transaction_vendor_attachments_type_check", sql`${t.contentType} in ('application/pdf','image/jpeg','image/png')`), check("transaction_vendor_attachments_hash_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`), check("transaction_vendor_attachments_filename_check", sql`char_length(${t.filename}) between 1 and 180`)]);
export type TransactionVendorAttachmentRow = typeof transactionVendorAttachments.$inferSelect;

// ===========================================================================
// Release D — Contacts (the people layer)
//
// One person, one row, whatever they are to the brokerage this month. A
// contact has a lifecycle stage (the relationship) and any number of
// opportunities (the needs): the same person can be a buyer in Fort
// Lauderdale and a seller in Brickell at once, and a past client next year.
// Activities are the history that "last contacted" and follow-ups are read
// from, never a column someone remembers to update.
//
// Scoped like transactions: brokerage key and assigned agent on every row.
// ===========================================================================

export const contactStage = pgEnum("contact_stage", [
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
  "archived",
]);

export const contactSource = pgEnum("contact_source", [
  "referral",
  "sphere",
  "sign_call",
  "website",
  "open_house",
  "past_client",
  "social",
  "advertising",
  "walk_in",
  "other",
]);

export const opportunityKind = pgEnum("opportunity_kind", [
  "buyer",
  "seller",
  "landlord",
  "tenant",
  "investor",
  "commercial_buyer",
  "commercial_seller",
  "commercial_tenant",
  "commercial_landlord",
  "referral_source",
]);

export const opportunityStatus = pgEnum("opportunity_status", ["open", "won", "lost", "dormant"]);

export const contactActivityKind = pgEnum("contact_activity_kind", [
  "call",
  "email",
  "sms",
  "meeting",
  "showing",
  "note",
  "status_change",
  "task",
  "system",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brokerageKey: text("brokerage_key").notNull().default(FORTMARK_BROKERAGE_KEY),
    assignedAgentUserId: uuid("assigned_agent_user_id")
      .notNull()
      .references(() => dashboardUsers.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** How they like to be addressed; shown over the legal name when set. */
    preferredName: text("preferred_name"),
    email: text("email"),
    /** Normalised to E.164 on write. */
    phoneE164: text("phone_e164"),
    company: text("company"),
    /** Optional, private relationship context; omitted from contact list DTOs. */
    about: text("about").notNull().default(""),
    personalDetails: jsonb("personal_details").$type<{ label: string; value: string }[]>().notNull().default([]),
    /**
     * Birthday, month and day only. A year is deliberately never stored: it is
     * not needed to remember a birthday, it would invite an age calculation
     * nobody asked for, and a `date` column would need a made-up year. Both are
     * set or both are null (see the check below).
     */
    birthdayMonth: smallint("birthday_month"),
    birthdayDay: smallint("birthday_day"),
    source: contactSource("source").notNull().default("other"),
    stage: contactStage("stage").notNull().default("lead"),
    /** Free-form labels, trimmed strings. */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    /** Derived from activities on write; read here so lists need no join. */
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    nextActionId: uuid("next_action_id"),
    nextActionKind: text("next_action_kind"),
    nextActionPurpose: text("next_action_purpose"),
    nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
    nextActionAssignedUserId: uuid("next_action_assigned_user_id").references(() => dashboardUsers.id, { onDelete: "restrict" }),
    /** Merged sources remain archived tombstones; normal reads use the keeper. */
    mergedIntoContactId: uuid("merged_into_contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "restrict" }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_brokerage_stage_idx").on(t.brokerageKey, t.stage),
    index("contacts_agent_idx").on(t.assignedAgentUserId),
    index("contacts_last_contact_idx").on(t.lastContactAt),
    index("contacts_email_idx").on(t.email),
    index("contacts_next_action_due_idx").on(t.nextActionDueAt),
    index("contacts_merged_into_idx").on(t.mergedIntoContactId),
    check("contacts_merge_pointer_check", sql`(${t.mergedIntoContactId} is null and ${t.mergedAt} is null) or (${t.mergedIntoContactId} is not null and ${t.mergedAt} is not null and ${t.mergedIntoContactId} <> ${t.id} and ${t.stage} = 'archived')`),
    check("contacts_next_action_check", sql`(
      (${t.nextActionId} is null and ${t.nextActionKind} is null and ${t.nextActionPurpose} is null and ${t.nextActionDueAt} is null and ${t.nextActionAssignedUserId} is null)
      or (${t.nextActionId} is not null and ${t.nextActionKind} is not null and ${t.nextActionPurpose} is not null and ${t.nextActionDueAt} is not null and ${t.nextActionAssignedUserId} is not null
        and ${t.nextActionKind} in ('call','email','text','meeting','custom') and char_length(${t.nextActionPurpose}) <= 240 and char_length(btrim(${t.nextActionPurpose})) >= 1
        and ${t.nextFollowUpAt} is not null and ${t.nextFollowUpAt} = (((${t.nextActionDueAt} at time zone 'America/New_York')::date + time '12:00') at time zone 'UTC'))
    )`),
    check("contacts_about_check", sql`char_length(${t.about}) <= 2000`),
    check("contacts_personal_details_check", sql`case when jsonb_typeof(${t.personalDetails}) = 'array' then jsonb_array_length(${t.personalDetails}) <= 20 and octet_length(${t.personalDetails}::text) <= 50000 else false end`),
    // Both null, or a real calendar day. February 29 is allowed because the
    // year is unknown; February 30 and April 31 are not.
    check(
      "contacts_birthday_check",
      sql`(${t.birthdayMonth} is null and ${t.birthdayDay} is null) or (${t.birthdayMonth} is not null and ${t.birthdayDay} is not null and ${t.birthdayMonth} between 1 and 12 and ${t.birthdayDay} between 1 and (case ${t.birthdayMonth} when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end))`
    ),
  ]
);

export const contactOpportunities = pgTable(
  "contact_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: opportunityKind("kind").notNull(),
    status: opportunityStatus("status").notNull().default("open"),
    /** Where — a neighbourhood, city or building, as the person said it. */
    area: text("area"),
    budgetMinCents: bigint("budget_min_cents", { mode: "number" }),
    budgetMaxCents: bigint("budget_max_cents", { mode: "number" }),
    timeframe: text("timeframe"),
    notes: text("notes"),
    /** The deal this need became, once it did. */
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contact_opportunities_contact_idx").on(t.contactId),
    index("contact_opportunities_transaction_idx").on(t.transactionId),
  ]
);

export const contactActivities = pgTable(
  "contact_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => contactOpportunities.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
    kind: contactActivityKind("kind").notNull(),
    /** One line a person wrote or the system stated. */
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** Non-sensitive context only, scrubbed as audit metadata is. */
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_activities_contact_occurred_idx").on(t.contactId, t.occurredAt)]
);

// ===========================================================================
// Contacts V3 — notes
//
// A note is something a person wrote about a relationship, on a timestamp, by
// a named author. Add and delete only: a correction is a new note, so history
// is never silently rewritten. Deleting a note REMOVES its text — the row stays
// as a tombstone (who deleted it and when) so counts and audit still reconcile,
// but the body no longer exists anywhere. The check makes that a database
// fact rather than a service convention: a live note has a body, a deleted one
// has none.
//
// Notes are deliberately not `contact_activities`: an activity's one-line
// summary feeds the timeline and its metadata surfaces, and a note's body must
// never travel through them. Notes are not searchable and never appear in audit.
// ===========================================================================


export const contactNotes = pgTable(
  "contact_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Shown by profile name, never as an id. A removed user leaves the note unattributed. */
    authorUserId: uuid("author_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
    /** Null exactly when the note has been deleted. */
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: uuid("deleted_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    index("contact_notes_contact_created_idx").on(t.contactId, t.createdAt.desc()),
    check(
      "contact_notes_body_check",
      sql`(${t.deletedAt} is null and ${t.body} is not null and char_length(${t.body}) between 1 and ${sql.raw(String(CONTACT_NOTE_MAX_LENGTH))}) or (${t.deletedAt} is not null and ${t.body} is null)`
    ),
  ]
);

export type ContactNoteRow = typeof contactNotes.$inferSelect;

// ===========================================================================
// Contacts V3 — client needs
//
// What a person is trying to accomplish, as structured requirements a future
// service can hand to an MLS search without interpreting a paragraph. It is
// NOT an opportunity (no forecast, no won/lost) and NOT a deal: the two older
// tables keep their meaning, and this one holds only what the client asked for.
//
// Many needs per contact — the same person may buy one home and sell another.
// Fields are FortMark's own vocabulary; nothing here is a Bridge/RESO key, and
// any translation to an MLS query belongs to an adapter, not to this table.
//
// The free-text fields are the most likely place for something sensitive, so
// they are bounded here and never searched, logged or written to audit.
// ===========================================================================

export const contactNeedKind = pgEnum("contact_need_kind", ["buy", "sell", "rent", "lease", "other"]);
export const contactNeedStatus = pgEnum("contact_need_status", ["active", "paused", "fulfilled", "archived"]);
export const contactNeedFinancing = pgEnum("contact_need_financing", [
  "cash",
  "conventional",
  "fha",
  "va",
  "other",
  "unknown",
]);

export const contactNeeds = pgTable(
  "contact_needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: contactNeedKind("kind").notNull(),
    kindOther: text("kind_other"),
    status: contactNeedStatus("status").notNull().default("active"),
    /** FortMark property-type values, validated by the service. */
    propertyTypes: text("property_types").array().notNull().default(sql`'{}'::text[]`),
    propertyTypeOther: text("property_type_other"),
    /** Cities / neighbourhoods as FortMark names them. */
    areas: text("areas").array().notNull().default(sql`'{}'::text[]`),
    priceMinCents: bigint("price_min_cents", { mode: "number" }),
    priceMaxCents: bigint("price_max_cents", { mode: "number" }),
    minBeds: smallint("min_beds"),
    /** Half baths are real (2.5), so an exact numeric, never a float. */
    minBaths: numeric("min_baths", { precision: 3, scale: 1 }),
    minSqft: integer("min_sqft"),
    targetDate: date("target_date"),
    timelineNote: text("timeline_note"),
    /** Null when it does not apply (a seller, a lessor) or was not asked. */
    financing: contactNeedFinancing("financing"),
    financingOther: text("financing_other"),
    mustHaves: text("must_haves").array().notNull().default(sql`'{}'::text[]`),
    avoid: text("avoid").array().notNull().default(sql`'{}'::text[]`),
    additionalRequirements: text("additional_requirements"),
    createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contact_needs_contact_status_idx").on(t.contactId, t.status),
    check("contact_needs_price_check", sql`(${t.priceMinCents} is null or ${t.priceMinCents} >= 0) and (${t.priceMaxCents} is null or ${t.priceMaxCents} >= 0) and (${t.priceMinCents} is null or ${t.priceMaxCents} is null or ${t.priceMaxCents} >= ${t.priceMinCents})`),
    check("contact_needs_size_check", sql`(${t.minBeds} is null or ${t.minBeds} between 0 and 30) and (${t.minBaths} is null or (${t.minBaths} between 0 and 30 and (${t.minBaths} * 2) = trunc(${t.minBaths} * 2))) and (${t.minSqft} is null or ${t.minSqft} >= 0)`),
    check("contact_needs_bounds_check", sql`cardinality(${t.propertyTypes}) <= 8 and cardinality(${t.areas}) <= 12 and cardinality(${t.mustHaves}) <= 20 and cardinality(${t.avoid}) <= 20 and (${t.timelineNote} is null or char_length(${t.timelineNote}) <= 200) and (${t.additionalRequirements} is null or char_length(${t.additionalRequirements}) <= 2000)`),
    // Nullable preserves old Other rows; newly saved content is required by
    // the service to explain a selected Other. Inactive descriptions cannot linger.
    check("contact_needs_kind_other_check", sql`${t.kindOther} is null or (${t.kind} = 'other' and char_length(btrim(${t.kindOther})) between 1 and 200)`),
    check("contact_needs_property_type_other_check", sql`${t.propertyTypeOther} is null or ('other' = any(${t.propertyTypes}) and char_length(btrim(${t.propertyTypeOther})) between 1 and 200)`),
    check("contact_needs_financing_other_check", sql`${t.financingOther} is null or (${t.financing} is not null and ${t.financing} = 'other' and char_length(btrim(${t.financingOther})) between 1 and 200)`),
  ]
);

export type ContactNeedRow = typeof contactNeeds.$inferSelect;

export type ContactRow = typeof contacts.$inferSelect;
export type ContactOpportunityRow = typeof contactOpportunities.$inferSelect;
export type ContactActivityRow = typeof contactActivities.$inferSelect;

export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;
export type TransactionPartyRow = typeof transactionParties.$inferSelect;
export type TransactionDeadlineRow = typeof transactionDeadlines.$inferSelect;
export type TransactionEventRow = typeof transactionEvents.$inferSelect;

// ===========================================================================
// Release F2 — AI-prepared actions
//
// The model proposes; a human confirms; FortMark executes. This table is the
// proposal, and it is the reason the model never holds the mutation: a
// prepared action is inert until someone clicks, and everything that decides
// what will happen — actor, brokerage, target, payload — lives here, server
// side, where a browser cannot reach it.
//
// `preview` is stored rather than recomputed so the audit can answer *what the
// human was actually shown*, which is the question that matters if a change is
// later disputed.
//
// Deliberately absent: model reasoning, prompts, conversation history, API
// keys, and any contact field the action does not touch.
// ===========================================================================

export const aiActionStatus = pgEnum("ai_action_status", [
  "prepared",
  "executing",
  "executed",
  "failed",
  "stale",
  "expired",
  "cancelled",
]);

export const aiPreparedActions = pgTable(
  "ai_prepared_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Tenant boundary. Set from the actor server-side, never from a request. */
    brokerageKey: text("brokerage_key").notNull().default(FORTMARK_BROKERAGE_KEY),
    /** The human who prepared it, and the only one who may confirm it. */
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => dashboardUsers.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** The server's own instruction. Never rendered, never sent to a browser. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** The diff the human was shown, exactly as shown. */
    preview: jsonb("preview").$type<Record<string, unknown>>().notNull(),
    /**
     * sha256 over only the target fields this action depends on. A whole-row
     * hash would make an unrelated edit by a colleague invalidate a follow-up
     * date nobody else touched.
     */
    expectedFingerprint: text("expected_fingerprint").notNull(),
    /**
     * sha256 over everything that decides what this proposal would do:
     * tenant, actor, type, target, payload and the expected fingerprint.
     * The partial unique index below makes it the identity of a *pending*
     * proposal, so a model that proposes the same change twice gets the row
     * it already has instead of a second confirmation card. Settled rows are
     * outside the index and never collide.
     */
    pendingKey: text("pending_key"),
    status: aiActionStatus("status").notNull().default("prepared"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    /** Coarse reason only — never an upstream message or a record field. */
    failureReason: text("failure_reason"),
  },
  (t) => [
    index("ai_prepared_actions_actor_status_idx").on(t.actorUserId, t.status),
    index("ai_prepared_actions_target_idx").on(t.targetType, t.targetId),
    index("ai_prepared_actions_expires_idx").on(t.expiresAt),
    // The invariant itself, enforced by the database rather than by a
    // read-then-write that two concurrent prepares could both win.
    uniqueIndex("ai_prepared_actions_pending_key_idx")
      .on(t.pendingKey)
      .where(sql`${t.status} = 'prepared'`),
  ]
);

export type AiPreparedActionRow = typeof aiPreparedActions.$inferSelect;

// ===========================================================================
// Brokerage identity (Core V1) — migration 0009.
//
// What licensed brokerage this dashboard represents. One row per tenant,
// enforced by the database (`brokerage_identities_brokerage_key_key`), and
// bound to the same `brokerage_key` every other domain already scopes by — not
// a second organisation system.
//
// One central FortMark record per `brokerage_key` — never per user. Two kinds
// of field live here (migration 0010 split them):
//
//   OPERATOR-OWNED  display name, brokerage licence, legal office address,
//                   website, preferred office phone. An admin or broker edits
//                   these; the MLS never overwrites them. The licence is
//                   stored, never "verified" — no licensing authority exists
//                   here.
//   SYSTEM-MANAGED  `mls_office_id` and the `mls_office_*` columns. Written
//                   only by the MLS sync from the Office record of the
//                   configured FortMark office (`FORTMARK_MLS_OFFICE_ID`).
//                   Nobody types them.
// ===========================================================================
export const brokerageIdentities = pgTable(
  "brokerage_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brokerageKey: text("brokerage_key").notNull(),
    /** Legal / display name, e.g. "FortMark, LLC". */
    displayName: text("display_name").notNull(),
    /** Brokerage (not agent) licence. Operator-provided; never verified here. */
    licenseNumber: text("license_number"),
    licenseState: text("license_state"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    /** E.164. */
    officePhone: text("office_phone"),
    /** http(s) only. */
    website: text("website"),
    /** The MLS office id FortMark lists under (miamire: FTMK01). System-managed. */
    mlsOfficeId: text("mls_office_id"),
    /** Office record fields as the MLS states them. System-managed (0010). */
    mlsOfficeKey: text("mls_office_key"),
    mlsOfficeName: text("mls_office_name"),
    mlsOfficePhone: text("mls_office_phone"),
    /** When the Office record was last read successfully. */
    mlsSyncedAt: timestamp("mls_synced_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references(() => dashboardUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brokerage_identities_brokerage_key_key").on(t.brokerageKey)]
);

export type BrokerageIdentityRow = typeof brokerageIdentities.$inferSelect;

// ===========================================================================
// MLS member link — migration 0010.
//
// Which MLS member a dashboard user is, resolved by the SERVER from the
// professional licence on their profile (Member.MemberStateLicense). One row
// per user. The licence is the human-entered anchor; `member_key` is the
// stable identifier every later query uses, so the licence is matched once,
// not on every page load.
//
// `license_number` / `license_state` record what was resolved. When the
// profile's licence no longer equals them the link is stale and nothing may
// use it until it is resolved again.
//
// Status is one of MLS_LINK_STATUSES (checked by the database):
//   linked           exactly one active member, in FortMark's MLS office
//   office_mismatch  exactly one member, but another office — broker review
//   not_found        no active member holds this licence in this MLS
//   ambiguous        more than one active member — never guessed
//   conflict         the member is already linked to another dashboard user
//   unavailable      the MLS could not be asked; nothing is concluded
//
// Not a licence verification: "not_found" means the MLS does not show it, not
// that the licence is invalid. Never creates dashboard users.
// ===========================================================================
export const MLS_LINK_STATUSES = [
  "linked",
  "office_mismatch",
  "not_found",
  "ambiguous",
  "conflict",
  "unavailable",
] as const;

export const mlsMemberLinks = pgTable(
  "mls_member_links",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => dashboardUsers.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    /** The licence this row was resolved from (normalised). */
    licenseNumber: text("license_number"),
    licenseState: text("license_state"),
    /** Member.MemberKey — the stable key listing queries use. */
    memberKey: text("member_key"),
    /** Member.MemberMlsId — shown to brokers, matched on listings as a fallback. */
    memberMlsId: text("member_mls_id"),
    /** Member.OfficeMlsId at resolution time. */
    officeMlsId: text("office_mls_id"),
    /** How many active members held the licence (0, 1, or more). */
    candidateCount: integer("candidate_count").notNull().default(0),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mls_member_links_member_key_idx").on(t.memberKey),
    check(
      "mls_member_links_status_check",
      sql`${t.status} in ('linked','office_mismatch','not_found','ambiguous','conflict','unavailable')`
    ),
  ]
);

export type MlsMemberLinkRow = typeof mlsMemberLinks.$inferSelect;

/** Private preferences, keyed by the verified Dashboard identity. No role override. */
export const personalWorkspaces = pgTable("personal_workspaces", {
  ownerUserId: uuid("owner_user_id").notNull().references(()=>dashboardUsers.id,{onDelete:"cascade"}),
  namespace:text("namespace").notNull(),
  data:jsonb("data").$type<Record<string,string>>().notNull().default({}),
  revision:integer("revision").notNull().default(1),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.ownerUserId,t.namespace]})]);

/** Scoped idempotency receipts. Submitted contact values never enter audit. */
export const contactCreateRequests = pgTable("contact_create_requests", {
  brokerageKey: text("brokerage_key").notNull(),
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: "contact_create_requests_pkey", columns: [t.brokerageKey, t.actorUserId, t.requestId] }),
  check("contact_create_requests_payload_hash_check", sql`length(${t.payloadHash}) = 64`),
]);

/** Durable batch receipts contain safe IDs/counts only, never submitted CSV values. */
export const contactImportRequests = pgTable("contact_import_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(), payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ name: "contact_import_requests_pkey", columns: [t.actorUserId, t.requestId] }), check("contact_import_requests_hash_check", sql`length(${t.payloadHash}) = 64`)]);

export const contactMergeRequests = pgTable("contact_merge_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  keeperId: uuid("keeper_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  sourceId: uuid("source_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(), payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("contact_merge_requests_actor_request_idx").on(t.actorUserId, t.requestId), check("contact_merge_requests_hash_check", sql`length(${t.payloadHash}) = 64`)]);

/** Private named collections; their original compatibility anchor survives contact merges. */
export const propertyLists = pgTable("property_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  brokerageKey: text("brokerage_key").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createRequestId: uuid("create_request_id"),
  createPayloadHash: text("create_payload_hash"),
  defaultForContactId: uuid("default_for_contact_id"),
}, t => [
  index("property_lists_owner_updated_idx").on(t.ownerUserId, t.updatedAt.desc(), t.id.desc()),
  index("property_lists_contact_idx").on(t.contactId),
  uniqueIndex("property_lists_owner_request_idx").on(t.ownerUserId, t.createRequestId).where(sql`${t.createRequestId} is not null`),
  uniqueIndex("property_lists_owner_default_idx").on(t.ownerUserId, t.defaultForContactId).where(sql`${t.defaultForContactId} is not null`),
  check("property_lists_name_check", sql`char_length(${t.name}) between 1 and 120 and btrim(${t.name}) = ${t.name} and ${t.name} !~ '[[:cntrl:]]'`),
  check("property_lists_request_check", sql`(${t.createRequestId} is null and ${t.createPayloadHash} is null) or (${t.createRequestId} is not null and ${t.createPayloadHash} is not null and ${t.createPayloadHash} ~ '^[0-9a-f]{64}$')`),
]);
export type PropertyListRow = typeof propertyLists.$inferSelect;

/** Saved MLS references only. Display fields/media are hydrated afresh, never copied into CRM storage. */
export const contactProperties = pgTable("contact_properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id").notNull().references(() => propertyLists.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  dataset: text("dataset").notNull(),
  listingId: text("listing_id").notNull(),
  mlsNumber: text("mls_number").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  /** Private research text, never MLS display data or audit content. */
  notes: text("notes").notNull().default(""),
  reviewStatus: text("review_status").notNull().default("to_review"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("contact_properties_contact_created_idx").on(t.contactId, t.createdAt.desc(), t.id.desc()),
  index("contact_properties_list_created_idx").on(t.listId, t.createdAt.desc(), t.id.desc()),
  uniqueIndex("contact_properties_live_listing_idx").on(t.listId, t.dataset, t.listingId).where(sql`${t.removedAt} is null`),
  check("contact_properties_dataset_check", sql`${t.dataset} ~ '^[A-Za-z0-9_-]{1,80}$'`),
  check("contact_properties_listing_id_check", sql`char_length(${t.listingId}) between 1 and 256 and btrim(${t.listingId}) = ${t.listingId} and ${t.listingId} !~ '[[:cntrl:]]'`),
  check("contact_properties_mls_number_check", sql`${t.mlsNumber} ~ '^[A-Z0-9][A-Z0-9-]{0,39}$' and ${t.mlsNumber} ~ '[0-9]'`),
  check("contact_properties_notes_check", sql`char_length(${t.notes}) <= 5000`),
  check("contact_properties_review_status_check", sql`${t.reviewStatus} in ('to_review','shortlisted','ruled_out')`),
]);
export type ContactPropertyRow = typeof contactProperties.$inferSelect;

/** Durable transfer receipts contain safe membership/list IDs, never private research text. */
export const propertyTransferRequests = pgTable("property_transfer_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  sourceListId: uuid("source_list_id").notNull().references(() => propertyLists.id, { onDelete: "restrict" }),
  targetListId: uuid("target_list_id").notNull().references(() => propertyLists.id, { onDelete: "restrict" }),
  sourcePropertyId: uuid("source_property_id").notNull().references(() => contactProperties.id, { onDelete: "restrict" }),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<{ propertyId: string; sourceRemoved: boolean; targetListId: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ name: "property_transfer_requests_pkey", columns: [t.actorUserId, t.requestId] }),
  check("property_transfer_requests_hash_check", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check("property_transfer_requests_lists_check", sql`${t.sourceListId} <> ${t.targetListId}`),
]);
export type PropertyTransferRequestRow = typeof propertyTransferRequests.$inferSelect;

/** Owner-private appointments keep only a durable MLS reference and user-entered details. */
export const showings = pgTable("showings", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  brokerageKey: text("brokerage_key").notNull(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  sourcePropertyId: uuid("source_property_id").notNull().references(() => contactProperties.id, { onDelete: "restrict" }),
  dataset: text("dataset").notNull(),
  listingId: text("listing_id").notNull(),
  mlsNumber: text("mls_number").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  meetingDetails: text("meeting_details").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("scheduled"),
  feedbackLikes: text("feedback_likes").notNull().default(""),
  feedbackConcerns: text("feedback_concerns").notNull().default(""),
  feedbackSummary: text("feedback_summary").notNull().default(""),
  visitedAt: timestamp("visited_at", { withTimezone: true }),
  cancelReason: text("cancel_reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createRequestId: uuid("create_request_id").notNull(),
  createPayloadHash: text("create_payload_hash").notNull(),
}, t => [
  index("showings_owner_starts_idx").on(t.ownerUserId, t.startsAt, t.id),
  index("showings_contact_idx").on(t.contactId),
  index("showings_source_property_idx").on(t.sourcePropertyId),
  uniqueIndex("showings_owner_request_idx").on(t.ownerUserId, t.createRequestId),
  check("showings_dataset_check", sql`${t.dataset} ~ '^[A-Za-z0-9_-]{1,80}$'`),
  check("showings_listing_id_check", sql`char_length(${t.listingId}) between 1 and 256 and btrim(${t.listingId}) = ${t.listingId} and ${t.listingId} !~ '[[:cntrl:]]'`),
  check("showings_mls_number_check", sql`${t.mlsNumber} ~ '^[A-Z0-9][A-Z0-9-]{0,39}$' and ${t.mlsNumber} ~ '[0-9]'`),
  check("showings_duration_check", sql`${t.endsAt} - ${t.startsAt} between interval '15 minutes' and interval '240 minutes'`),
  check("showings_status_check", sql`${t.status} in ('scheduled','completed','cancelled')`),
  check("showings_text_bounds_check", sql`char_length(${t.meetingDetails}) <= 1000 and char_length(${t.notes}) <= 2000 and char_length(${t.feedbackLikes}) <= 2000 and char_length(${t.feedbackConcerns}) <= 2000 and char_length(${t.feedbackSummary}) <= 2000 and char_length(${t.cancelReason}) <= 1000`),
  check("showings_completion_check", sql`(${t.status} = 'completed' and ${t.visitedAt} is not null) or (${t.status} <> 'completed' and ${t.visitedAt} is null)`),
  check("showings_cancellation_check", sql`(${t.status} = 'cancelled' and ${t.cancelReason} ~ '[^[:space:]]') or (${t.status} <> 'cancelled' and ${t.cancelReason} = '')`),
  check("showings_create_hash_check", sql`${t.createPayloadHash} ~ '^[0-9a-f]{64}$'`),
]);
export type ShowingRow = typeof showings.$inferSelect;

/** Appointment mutation receipts retain safe IDs/revisions, never meeting details or feedback. */
export const showingMutationRequests = pgTable("showing_mutation_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  showingId: uuid("showing_id").notNull().references(() => showings.id, { onDelete: "restrict" }),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<{ showingId: string; updatedAt: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ name: "showing_mutation_requests_pkey", columns: [t.actorUserId, t.requestId] }),
  index("showing_mutation_requests_showing_idx").on(t.showingId),
  check("showing_mutation_requests_hash_check", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
]);
export type ShowingMutationRequestRow = typeof showingMutationRequests.$inferSelect;

/** Private tour drafts retain user input and IDs only. Routing responses stay transient. */
export const savedShowingTours = pgTable("saved_showing_tours", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  brokerageKey: text("brokerage_key").notNull(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  sourceListId: uuid("source_list_id").notNull().references(() => propertyLists.id, { onDelete: "restrict" }),
  name: text("name").notNull(), notes: text("notes").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  bufferMinutes: integer("buffer_minutes").notNull().default(10),
  firstPropertyId: text("first_property_id").notNull().default("auto"),
  originAddress: text("origin_address").notNull().default(""),
  endMode: text("end_mode").notNull().default("last_property"),
  endAddress: text("end_address").notNull().default(""),
  /** Server-only signing material. Never project into DTOs, audit metadata or review tokens. */
  reviewKey: text("review_key").notNull().default(sql`replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true }),
  createRequestId: uuid("create_request_id").notNull(), createPayloadHash: text("create_payload_hash").notNull(),
}, t => [
  index("saved_showing_tours_owner_idx").on(t.ownerUserId, t.updatedAt, t.id),
  index("saved_showing_tours_contact_idx").on(t.contactId),
  index("saved_showing_tours_list_idx").on(t.sourceListId),
  uniqueIndex("saved_showing_tours_owner_request_idx").on(t.ownerUserId, t.createRequestId),
  check("saved_showing_tours_name_check", sql`char_length(btrim(${t.name})) between 1 and 120`),
  check("saved_showing_tours_text_check", sql`char_length(${t.notes}) <= 4000 and char_length(${t.originAddress}) <= 500 and char_length(${t.endAddress}) <= 500`),
  check("saved_showing_tours_buffer_check", sql`${t.bufferMinutes} between 0 and 60`),
  check("saved_showing_tours_first_check", sql`${t.firstPropertyId} = 'auto' or ${t.firstPropertyId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
  check("saved_showing_tours_end_check", sql`${t.endMode} in ('last_property','return_to_start','address') and (${t.endMode} <> 'address' or char_length(btrim(${t.endAddress})) > 0)`),
  check("saved_showing_tours_hash_check", sql`${t.reviewKey} ~ '^[0-9a-f]{64}$' and ${t.createPayloadHash} ~ '^[0-9a-f]{64}$'`),
]);
export type SavedShowingTourRow = typeof savedShowingTours.$inferSelect;

export const savedTourStops = pgTable("saved_tour_stops", {
  id: uuid("id").primaryKey().defaultRandom(),
  tourId: uuid("tour_id").notNull().references(() => savedShowingTours.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id").notNull().references(() => contactProperties.id, { onDelete: "restrict" }),
  position: integer("position").notNull(), visitMinutes: integer("visit_minutes").notNull(),
  lockTime: boolean("lock_time").notNull().default(false),
  linkedShowingId: uuid("linked_showing_id").references(() => showings.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // SQL migration makes the position constraint deferred for atomic reorder operations.
  unique("saved_tour_stops_position_key").on(t.tourId, t.position),
  uniqueIndex("saved_tour_stops_property_idx").on(t.tourId, t.propertyId),
  index("saved_tour_stops_showing_idx").on(t.linkedShowingId),
  check("saved_tour_stops_position_check", sql`${t.position} between 0 and 7`),
  check("saved_tour_stops_duration_check", sql`${t.visitMinutes} between 15 and 240`),
  check("saved_tour_stops_lock_check", sql`not ${t.lockTime} or ${t.linkedShowingId} is not null`),
]);
export type SavedTourStopRow = typeof savedTourStops.$inferSelect;

export const savedTourRequests = pgTable("saved_tour_requests", {
  actorUserId: uuid("actor_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  tourId: uuid("tour_id").notNull().references(() => savedShowingTours.id, { onDelete: "restrict" }),
  action: text("action").notNull(), payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<{ tourId: string; showingIds?: string[] }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ name: "saved_tour_requests_pkey", columns: [t.actorUserId, t.requestId] }),
  check("saved_tour_requests_action_check", sql`${t.action} in ('edit','archive','schedule')`),
  check("saved_tour_requests_hash_check", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
]);

/** Explicit associations. Readers must independently satisfy both parent scopes. */
export const transactionShowingTours = pgTable("transaction_showing_tours", {
 id: uuid("id").primaryKey().defaultRandom(),
 transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "restrict" }),
 tourId: uuid("tour_id").notNull().references(() => savedShowingTours.id, { onDelete: "restrict" }),
 createdByUserId: uuid("created_by_user_id").references(() => dashboardUsers.id, { onDelete: "set null" }),
 createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
 updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
 removedAt: timestamp("removed_at", { withTimezone: true }),
}, t => [uniqueIndex("transaction_showing_tours_pair_idx").on(t.transactionId,t.tourId), index("transaction_showing_tours_tour_idx").on(t.tourId,t.removedAt)]);
export type TransactionShowingTourRow = typeof transactionShowingTours.$inferSelect;

/** Owner-private color vocabulary. Defaults are virtual until an explicit write materializes them. */
export const calendarLabels = pgTable("calendar_labels", {
  ownerUserId: uuid("owner_user_id").notNull().references(() => dashboardUsers.id, { onDelete: "restrict" }), brokerageKey: text("brokerage_key").notNull(), id: text("id").notNull(), name: text("name").notNull(), color: text("color").$type<import("../calendar/personal-domain.ts").CalendarColor>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.ownerUserId, t.brokerageKey, t.id] }), index("calendar_labels_owner_active_idx").on(t.ownerUserId,t.brokerageKey,t.archivedAt), check("calendar_labels_name_check",sql`char_length(btrim(${t.name})) between 1 and 60`), check("calendar_labels_color_check",sql`${t.color} in ('red','amber','green','blue','purple','teal','slate','pink')`),check("calendar_labels_id_check",sql`${t.id} in ('urgent','important','low-priority','personal') or ${t.id} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`)]);
export type CalendarLabelRow = typeof calendarLabels.$inferSelect;
export const personalCalendarItems = pgTable("personal_calendar_items", {
  id: uuid("id").primaryKey().defaultRandom(), ownerUserId: uuid("owner_user_id").notNull().references(() => dashboardUsers.id,{onDelete:"restrict"}), brokerageKey:text("brokerage_key").notNull(), title:text("title").notNull(),notes:text("notes").notNull().default(""),location:text("location").notNull().default(""),day:date("day").notNull(),allDay:boolean("all_day").notNull(),startsAt:timestamp("starts_at",{withTimezone:true}),endsAt:timestamp("ends_at",{withTimezone:true}),blocksTime:boolean("blocks_time").notNull().default(false),labelId:text("label_id"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),cancelledAt:timestamp("cancelled_at",{withTimezone:true}),
},t=>[index("personal_calendar_items_owner_day_idx").on(t.ownerUserId,t.brokerageKey,t.day),index("personal_calendar_items_owner_time_idx").on(t.ownerUserId,t.brokerageKey,t.startsAt),foreignKey({columns:[t.ownerUserId,t.brokerageKey,t.labelId],foreignColumns:[calendarLabels.ownerUserId,calendarLabels.brokerageKey,calendarLabels.id]}).onDelete("restrict"),check("personal_calendar_items_text_check",sql`char_length(btrim(${t.title})) between 1 and 200 and char_length(${t.notes})<=5000 and char_length(${t.location})<=500`),check("personal_calendar_items_time_check",sql`(${t.allDay} and ${t.startsAt} is null and ${t.endsAt} is null and not ${t.blocksTime}) or (not ${t.allDay} and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.endsAt}>${t.startsAt} and ${t.endsAt}-${t.startsAt}<=interval '7 days' and (${t.startsAt} at time zone 'America/New_York')::date=${t.day})`)]);
export type PersonalCalendarItemRow=typeof personalCalendarItems.$inferSelect;
export const calendarItemAnnotations=pgTable("calendar_item_annotations",{
  ownerUserId:uuid("owner_user_id").notNull().references(()=>dashboardUsers.id,{onDelete:"restrict"}),brokerageKey:text("brokerage_key").notNull(),itemId:text("item_id").notNull(),kind:text("kind").$type<import("../calendar/domain.ts").CalendarKind>().notNull(),sourceId:uuid("source_id").notNull(),labelId:text("label_id"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.ownerUserId,t.brokerageKey,t.itemId,t.kind,t.sourceId]}),index("calendar_annotations_source_idx").on(t.ownerUserId,t.brokerageKey,t.kind,t.sourceId),foreignKey({columns:[t.ownerUserId,t.brokerageKey,t.labelId],foreignColumns:[calendarLabels.ownerUserId,calendarLabels.brokerageKey,calendarLabels.id]}).onDelete("restrict"),check("calendar_annotations_kind_check",sql`${t.kind} in ('showing','tour','transaction_deadline','next_action','reminder')`),check("calendar_annotations_item_check",sql`char_length(${t.itemId}) between 1 and 100`)]);
export type CalendarItemAnnotationRow=typeof calendarItemAnnotations.$inferSelect;
export const calendarWriteRequests=pgTable("calendar_write_requests",{
  actorUserId:uuid("actor_user_id").notNull().references(()=>dashboardUsers.id,{onDelete:"restrict"}),requestId:uuid("request_id").notNull(),brokerageKey:text("brokerage_key").notNull(),action:text("action").notNull(),payloadHash:text("payload_hash").notNull(),result:jsonb("result").$type<{itemId?:string;labelId?:string;annotationItemId?:string;updatedAt:string}>().notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.actorUserId,t.requestId]}),check("calendar_requests_action_check",sql`${t.action} in ('create_item','update_item','cancel_item','create_label','update_label','archive_label','annotate')`),check("calendar_requests_hash_check",sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);
