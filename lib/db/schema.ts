/**
 * Release 1 schema — persistent FortMark users and professional profiles.
 *
 * IMPORTANT: none of these tables control dashboard access in Release 1.
 * `FORTMARK_ALLOWED_CLERK_USER_IDS` remains the operational access authority
 * (see `lib/auth/dashboard-access.ts`). A row here records *who someone is*,
 * not *whether they may enter*. Database-backed authorization arrives in a
 * later release behind `DATABASE_ACCESS_CONTROL_ENABLED`.
 */
import {
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
] as const;

export type AuditEventType = (typeof RELEASE_1_AUDIT_EVENTS)[number];
export type DashboardUser = typeof dashboardUsers.$inferSelect;
export type ProfessionalProfile = typeof professionalProfiles.$inferSelect;
export type ProfileImage = typeof profileImages.$inferSelect;
