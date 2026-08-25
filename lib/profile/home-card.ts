/**
 * The Home identity card's projection.
 *
 * A third, deliberately separate boundary from `ProfileDisplay` (global client
 * context, five keys) and `ProfileDetail` (the drawer's on-demand fetch).
 *
 * This one is wider than `ProfileDisplay` because the card genuinely shows a
 * licence number and contact shortcuts — but it is delivered differently. It is
 * built on the server for the authenticated Home request and handed straight to
 * the card, so it lives in that one page's per-request payload. It is never put
 * into the global Zustand store, never cached, and never reaches a page the
 * user did not open.
 *
 * Pure by design so the fallback rules are testable: no `server-only`, no
 * database import.
 */
import {
  publicContactEmail,
  resolveImageUrl,
  safeLinkUrl,
  type DisplaySourceImage,
} from "./display.ts";
import { buildContactLinks, type ContactLink } from "./links.ts";
import { titleLabel } from "./titles.ts";

/** How a credential's trustworthiness is described to the user. */
export type CredentialTrust =
  | "self_reported"
  | "pending_review"
  | "broker_reviewed"
  | "fortmark_verified"
  | "expired";

/**
 * Copy for each trust level.
 *
 * Nothing here claims a government or NAR check. Release 1.1 performs no
 * DBPR/NAR integration, so the only honest default is "self-reported" — saying
 * "verified" without a verification would be a false assurance on a compliance
 * surface.
 */
export const CREDENTIAL_TRUST_LABEL: Record<CredentialTrust, string> = {
  self_reported: "Self-reported",
  pending_review: "Pending review",
  broker_reviewed: "Broker reviewed",
  fortmark_verified: "FortMark verified",
  expired: "Expired",
};

/**
 * The only two statuses a user ever sees.
 *
 * Distinct from `CredentialTrust`, which describes whether a LICENCE has been
 * verified. Conflating the two is what put "Self-reported" under a heading
 * called Status — an answer to a question nobody asked. Account state and
 * credential provenance are separate facts and now read as separate rows.
 */
export type ProfileStatus = "active" | "inactive";

export const PROFILE_STATUS_LABEL: Record<ProfileStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

/**
 * Derive the visible status from the server-controlled account state.
 *
 * Read-only by design. `dashboard_users.status` is the account authority, so
 * letting the profile editor write it would let a suspended user clear their
 * own suspension — an access-control regression dressed up as a UX toggle.
 * Anything that is not `active` reads as Inactive.
 */
export function profileStatusFor(
  user: { status?: string | null } | null | undefined
): ProfileStatus {
  return user?.status === "active" ? "active" : "inactive";
}

/**
 * Contact kinds hidden on the Home self-card.
 *
 * The Home card is the user looking at their own record, and offering to email,
 * ring or message yourself is noise. They stay in `links` rather than being
 * dropped at the source, because the Digital Card is shareable and genuinely
 * needs them — this is a presentation rule for one surface, not a change to
 * the data. Copy Contact and the vCard are unaffected.
 */
export const SELF_CARD_HIDDEN_LINK_KINDS: readonly string[] = [
  "email",
  "phone",
  "whatsapp",
];

export function selfCardLinks<T extends { kind: string }>(links: readonly T[]): T[] {
  return links.filter((l) => !SELF_CARD_HIDDEN_LINK_KINDS.includes(l.kind));
}

export interface HomeIdentityCard {
  /**
   * Where this card's data came from.
   *
   * `session` means the database contributed nothing — flags off, unreachable,
   * or no row yet. The card still renders in full; it just shows honest
   * "not added" states instead of credentials it does not have. This is what
   * makes the card permanent rather than conditional.
   */
  source: "database" | "session";
  /** First name for the greeting, or null for the generic form. */
  greetingName: string | null;
  displayName: string;
  professionalTitle: string | null;
  roleLabel: string;
  brokerageOffice: string | null;
  locationDisplay: string | null;
  imageUrl: string | null;
  /** ISO date of the dashboard_users row — the FortMark join date. */
  joinedAt: string | null;
  licenseState: string | null;
  licenseType: string | null;
  licenseNumber: string | null;
  licenseExpiration: string | null;
  nrdsNumber: string | null;
  credentialTrust: CredentialTrust | null;
  /** Account state, as the user sees it. Never null — always Active or Inactive. */
  profileStatus: ProfileStatus;
  /**
   * Carried explicitly rather than parsed back out of `links`.
   *
   * Copy Contact and the Digital Card used to recover these by scanning the
   * link list for `mailto:`/`tel:` entries. That coupling meant hiding the
   * self-card icons would have silently emptied the vCard and the clipboard
   * block too — the display rule would have quietly become a data rule.
   */
  /**
   * The stored ALTERNATIVE address — `professional_profiles.business_email`.
   *
   * Kept separate from `publicContactEmail` below on purpose: this is what the
   * user actually typed, and the two must never collapse into one value or
   * clearing the alternative could not restore the default.
   */
  businessEmail: string | null;
  /**
   * The address actually published: the alternative when set, otherwise the
   * account email. See `publicContactEmail` for why the fallback exists and
   * what makes it safe.
   */
  publicContactEmail: string | null;
  phoneE164: string | null;
  whatsappPhoneE164: string | null;
  /**
   * 0-100, or null when no profile record exists.
   *
   * Null is rendered as "Profile setup required" rather than 0%. A fabricated
   * percentage on a compliance surface is worse than an honest absence, and 0%
   * would imply a real calculation ran against a real record.
   */
  completion: number | null;
  links: ContactLink[];
}

export interface HomeCardSourceUser {
  createdAt?: Date | string | null;
  primaryEmail?: string | null;
  status?: string | null;
}

export interface HomeCardSourceProfile {
  preferredDisplayName?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  professionalTitle?: string | null;
  brokerageOffice?: string | null;
  locationDisplay?: string | null;
  licenseState?: string | null;
  licenseType?: string | null;
  licenseNumber?: string | null;
  licenseExpiration?: string | null;
  nrdsNumber?: string | null;
  phoneE164?: string | null;
  whatsappPhoneE164?: string | null;
  /** The publishable address. Distinct from the verified account email. */
  businessEmail?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  personalWebsiteUrl?: string | null;
  professionalWebsiteUrl?: string | null;
  profileCompletionPercent?: number | null;
}

export interface HomeCardSession {
  name: string;
  role: string;
  email?: string | null;
  imageUrl?: string | null;
}

function trimmed(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** First token of a full name, used for the greeting. */
function firstNameOf(v: unknown): string | null {
  const s = trimmed(v);
  if (!s) return null;
  return s.split(/\s+/)[0] ?? null;
}

/**
 * Greeting name, in the order the brief specifies:
 * preferred display name → legal first name → Clerk first name → null.
 *
 * Null means the card renders the generic "Welcome back" with no name, which
 * is always correct rather than guessing.
 */
export function greetingNameFor(
  profile: HomeCardSourceProfile | null | undefined,
  session: HomeCardSession
): string | null {
  return (
    firstNameOf(profile?.preferredDisplayName) ??
    trimmed(profile?.legalFirstName) ??
    firstNameOf(session.name)
  );
}

/**
 * Classify the licence.
 *
 * Only `expired` is inferred, and only from an actual date comparison. Every
 * other state stays at the honest floor — self-reported — because no
 * integration has verified anything. `pending_review` reflects the user record
 * still awaiting profile completion.
 */
export function credentialTrustFor(
  profile: HomeCardSourceProfile | null | undefined,
  user: HomeCardSourceUser | null | undefined,
  now = new Date()
): CredentialTrust {
  const expiration = trimmed(profile?.licenseExpiration);
  if (expiration) {
    const parsed = new Date(`${expiration}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime()) {
      return "expired";
    }
  }
  if (user?.status === "pending_profile") return "pending_review";
  return "self_reported";
}

/**
 * The card every authenticated, allowlisted user gets — with no database at all.
 *
 * This is the floor, not an error state. Authentication and the allowlist have
 * already approved this request, so the card is owed to the user regardless of
 * whether the profile database is enabled, reachable, or populated. Nothing
 * here is invented: every field comes from the Clerk session, and everything
 * the session cannot supply is null so the UI can say "not added".
 */
export function fallbackHomeIdentityCard(session: HomeCardSession): HomeIdentityCard {
  return {
    source: "session",
    greetingName: greetingNameFor(null, session),
    displayName: session.name,
    professionalTitle: null,
    roleLabel: session.role,
    brokerageOffice: null,
    locationDisplay: null,
    imageUrl: resolveImageUrl(null, session),
    // No dashboard_users row means no real join date, and a made-up one would
    // misrepresent tenure.
    joinedAt: null,
    licenseState: null,
    licenseType: null,
    licenseNumber: null,
    licenseExpiration: null,
    nrdsNumber: null,
    // No record has been reviewed, so no trust level applies. Not even
    // "self-reported" — nothing has been reported.
    credentialTrust: null,
    // Authenticated and allowlisted, which is the only authority that exists
    // without a row — and it is exactly what syncCurrentUser would record.
    profileStatus: "active",
    // No profile row at all — the database is off or unreachable. The
    // alternative/account hierarchy deliberately does NOT apply here: it
    // describes what a professional profile publishes, and there is no
    // profile. The degraded card keeps publishing nothing, matching the empty
    // `links` below, so a database outage never starts disclosing an address
    // the user has not been shown the setting for.
    businessEmail: null,
    publicContactEmail: null,
    phoneE164: null,
    whatsappPhoneE164: null,
    completion: null,

    // Nothing publishable exists without a profile row.
    links: buildContactLinks({}),
  };
}

/**
 * Build the card projection.
 *
 * Field-by-field, like the other two projections, so a new schema column can
 * never reach this surface because someone spread a row.
 */
export function toHomeIdentityCard(
  session: HomeCardSession,
  user?: HomeCardSourceUser | null,
  profile?: HomeCardSourceProfile | null,
  image?: DisplaySourceImage | null,
  now = new Date()
): HomeIdentityCard {
  const completion = profile?.profileCompletionPercent;
  const joined = user?.createdAt;
  const joinedDate =
    joined instanceof Date
      ? joined
      : typeof joined === "string" && joined
        ? new Date(joined)
        : null;

  return {
    source: "database",
    greetingName: greetingNameFor(profile, session),
    displayName: trimmed(profile?.preferredDisplayName) ?? session.name,
    // The stored value is a stable catalogue key ("broker_associate"), so it
    // must be rendered through the catalogue on the way out. Without this the
    // card, the digital card and the vCard all printed the raw key at a
    // human — "real_estate_sales_associate" instead of "Real Estate Sales
    // Associate".
    //
    // Only the DISPLAY projections translate. `toProfileDetail` and the
    // onboarding context deliberately keep the raw value, because the editor
    // and the wizard feed it back into a <select> that matches on value.
    //
    // A legacy free-text title is returned unchanged, so rows written before
    // the catalogue existed still read as whatever their owner typed.
    professionalTitle: titleLabel(trimmed(profile?.professionalTitle)),
    roleLabel: session.role,
    brokerageOffice: trimmed(profile?.brokerageOffice),
    locationDisplay: trimmed(profile?.locationDisplay),
    imageUrl: resolveImageUrl(image, session),
    joinedAt:
      joinedDate && !Number.isNaN(joinedDate.getTime()) ? joinedDate.toISOString() : null,
    licenseState: trimmed(profile?.licenseState),
    licenseType: trimmed(profile?.licenseType),
    licenseNumber: trimmed(profile?.licenseNumber),
    licenseExpiration: trimmed(profile?.licenseExpiration),
    nrdsNumber: trimmed(profile?.nrdsNumber),
    credentialTrust: credentialTrustFor(profile, user, now),
    profileStatus: profileStatusFor(user),
    businessEmail: trimmed(profile?.businessEmail),
    publicContactEmail: publicContactEmail(
      trimmed(profile?.businessEmail),
      trimmed(user?.primaryEmail) ?? session.email
    ),
    phoneE164: trimmed(profile?.phoneE164),
    whatsappPhoneE164: trimmed(profile?.whatsappPhoneE164),
    completion:
      typeof completion === "number" && Number.isFinite(completion)
        ? Math.max(0, Math.min(100, Math.round(completion)))
        : 0,
    links: buildContactLinks({
      linkedinUrl: safeLinkUrl(profile?.linkedinUrl),
      instagramUrl: safeLinkUrl(profile?.instagramUrl),
      facebookUrl: safeLinkUrl(profile?.facebookUrl),
      personalWebsiteUrl: safeLinkUrl(profile?.personalWebsiteUrl),
      professionalWebsiteUrl: safeLinkUrl(profile?.professionalWebsiteUrl),
      // The RESOLVED public address, so the shareable contact block, the
      // vCard and the card icons all agree on one answer rather than each
      // re-deciding the hierarchy.
      email: publicContactEmail(
        trimmed(profile?.businessEmail),
        trimmed(user?.primaryEmail) ?? session.email
      ),
      phoneE164: trimmed(profile?.phoneE164),
      whatsappPhoneE164: trimmed(profile?.whatsappPhoneE164),
    }),
  };
}

/**
 * "Joined July 2026" — month and year only.
 *
 * A fixed `en-US` month/year, deliberately not locale-dependent: this string is
 * rendered on the server and hydrated on the client, and a locale-sensitive
 * format is the classic source of a hydration mismatch.
 */
export function formatJoinedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
