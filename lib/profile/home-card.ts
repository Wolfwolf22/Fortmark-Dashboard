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
import { resolveImageUrl, safeLinkUrl, type DisplaySourceImage } from "./display.ts";
import { buildContactLinks, type ContactLink } from "./links.ts";

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
    completion: null,
    // The verified session email is a genuine, usable shortcut, so it is the
    // one link a session-only card can honestly offer.
    links: buildContactLinks({ email: session.email ?? null }),
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
    professionalTitle: trimmed(profile?.professionalTitle),
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
      email: trimmed(session.email) ?? trimmed(user?.primaryEmail),
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
