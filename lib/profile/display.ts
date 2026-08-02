/**
 * The compact profile projection that is allowed to reach the browser.
 *
 * This module is the PII boundary for Release 1. Everything the shell renders
 * globally — top bar, nav rail, avatar — comes from `ProfileDisplay`, and
 * `toProfileDisplay()` is the only way to build one. Fields are copied across
 * explicitly rather than spread, so adding a column to the schema can never
 * widen what the client receives by accident.
 *
 * Deliberately absent, and asserted absent by `scripts/test_profile.ts`:
 *
 *   clerkUserId          raw identifier
 *   phoneE164            contact detail
 *   legalFirstName/Last  legal name (the display name is shown instead)
 *   licenseNumber        full licence identifier
 *   licenseExpiration    compliance date
 *   nrdsNumber           national association identifier
 *   primaryEmail         already carried by the existing session, not re-sent
 *   audit rows, timestamps, row ids
 *
 * The drawer shows the rest, but fetches it on demand from a protected route
 * rather than receiving it in the global client context.
 *
 * Pure by design: no `server-only`, no database import, so it is testable
 * under plain Node.
 */

/** Compact identity for the shell. Safe to serialise into client context. */
export interface ProfileDisplay {
  /** Preferred display name, else the Clerk name. Never a legal name. */
  displayName: string;
  /** Server-resolved role label, e.g. "Broker". Never client-supplied. */
  roleLabel: string;
  /** Coarse licence label, e.g. "FL Broker". Never the licence number. */
  licenseLabel: string | null;
  /** Resolved through the fallback chain below, or null for initials. */
  imageUrl: string | null;
  /** 0–100, used for the completion affordance. */
  completion: number;
}

/**
 * What the shell needs to render the identity strip.
 *
 * Declared here, in the pure module, rather than beside the server code that
 * builds it: `app-shell.tsx` is a client component, and importing a type from
 * a `server-only` module — even as `import type` — puts a client bundle one
 * refactor away from pulling in the database client.
 */
export interface ShellProfile {
  display: ProfileDisplay;
  /**
   * Whether the drawer and editor should be offered. False whenever the UI
   * flag is off or the caller has no persisted record, so the chevron is never
   * shown opening onto an empty panel.
   */
  editable: boolean;
}

/** The subset of a profile row this projection may read. */
export interface DisplaySourceProfile {
  preferredDisplayName?: string | null;
  licenseState?: string | null;
  licenseType?: string | null;
  profileCompletionPercent?: number | null;
}

/** The subset of an image row this projection may read. */
export interface DisplaySourceImage {
  processedImageUrl?: string | null;
  activeImageUrl?: string | null;
  clerkImageUrl?: string | null;
  processingStatus?: string | null;
}

/** Identity already present in the session, used as the fallback layer. */
export interface DisplaySourceSession {
  name: string;
  role: string;
  imageUrl?: string | null;
}

function trimmed(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/**
 * Only ever return an image URL the browser can actually load, and never a
 * `javascript:` or `data:` URL — these values round-trip through the database,
 * so they are treated as untrusted input on the way out.
 */
function safeImageUrl(v: unknown): string | null {
  const s = trimmed(v);
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s;
  // Relative paths are resolved by the caller's basePath helper.
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return null;
}

/**
 * Only ever return an outbound link the browser may safely navigate to.
 *
 * The same defence as `safeImageUrl`, for anchors instead of images: these
 * values round-trip through the database, so they are treated as untrusted on
 * the way out no matter what validated them on the way in. Only absolute https
 * URLs survive.
 */
export function safeLinkUrl(v: unknown): string | null {
  const s = trimmed(v);
  if (!s) return null;
  if (!/^https:\/\//i.test(s)) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Image fallback chain: processed → active → Clerk → null (initials).
 *
 * A processed image only wins when processing actually succeeded, so a failed
 * or in-flight Cloudinary run in a later release can never blank an avatar
 * that is currently rendering fine.
 */
export function resolveImageUrl(
  image: DisplaySourceImage | null | undefined,
  session: DisplaySourceSession
): string | null {
  if (image) {
    if (image.processingStatus === "ready") {
      const processed = safeImageUrl(image.processedImageUrl);
      if (processed) return processed;
    }
    const active = safeImageUrl(image.activeImageUrl);
    if (active) return active;
    const clerk = safeImageUrl(image.clerkImageUrl);
    if (clerk) return clerk;
  }
  return safeImageUrl(session.imageUrl);
}

/**
 * Coarse licence label. State and type only — enough to identify the licence
 * at a glance without putting the number into every page's client payload.
 */
export function licenseLabel(profile: DisplaySourceProfile | null | undefined): string | null {
  const state = trimmed(profile?.licenseState);
  const type = trimmed(profile?.licenseType);
  if (state && type) return `${state} ${type}`;
  return state ?? type ?? null;
}

/**
 * Build the client-safe projection.
 *
 * Every argument is optional except the session, so the shell renders
 * identically when the database is off, unreachable, or has no row yet —
 * that is the Release 1 guarantee that a profile problem is never an access
 * problem.
 */
export function toProfileDisplay(
  session: DisplaySourceSession,
  profile?: DisplaySourceProfile | null,
  image?: DisplaySourceImage | null
): ProfileDisplay {
  const completion = profile?.profileCompletionPercent;
  return {
    displayName: trimmed(profile?.preferredDisplayName) ?? session.name,
    roleLabel: session.role,
    licenseLabel: licenseLabel(profile),
    imageUrl: resolveImageUrl(image, session),
    completion:
      typeof completion === "number" && Number.isFinite(completion)
        ? Math.max(0, Math.min(100, Math.round(completion)))
        : 0,
  };
}

// --- the drawer's on-demand projection --------------------------------------
// A second, wider boundary: the caller's OWN record, fetched from a protected
// route only when the drawer opens. It is never part of the global client
// context, so a page that does not open the drawer never ships these fields.

/** Editable profile fields plus the read-only completion figure. */
export interface ProfileDetail {
  preferredDisplayName: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  phoneE164: string | null;
  brokerageOffice: string | null;
  licenseState: string | null;
  licenseType: string | null;
  licenseNumber: string | null;
  licenseExpiration: string | null;
  nrdsNumber: string | null;
  biography: string | null;
  languages: string[];
  specialties: string[];
  serviceAreas: string[];
  professionalTitle: string | null;
  locationDisplay: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  personalWebsiteUrl: string | null;
  professionalWebsiteUrl: string | null;
  whatsappPhoneE164: string | null;
  /**
   * The address the user chose to publish. Distinct from the verified Clerk
   * sign-in address, which is not part of this projection at all — it belongs
   * to the account, not the profile, and is never editable from here.
   */
  businessEmail: string | null;
  completion: number;
}

/** Anything with the profile columns — a Drizzle row satisfies it. */
export type DetailSourceProfile = Partial<
  Record<Exclude<keyof ProfileDetail, "completion">, unknown>
> & { profileCompletionPercent?: number | null };

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Copy the caller's own record onto the detail shape.
 *
 * Field-by-field for the same reason as `toProfileDisplay`: a new column must
 * never reach a client because someone spread a row. Row ids, `userId`,
 * timestamps, status, role and audit data are all absent by construction.
 */
export function toProfileDetail(profile: DetailSourceProfile | null | undefined): ProfileDetail {
  const completion = profile?.profileCompletionPercent;
  return {
    preferredDisplayName: trimmed(profile?.preferredDisplayName),
    legalFirstName: trimmed(profile?.legalFirstName),
    legalLastName: trimmed(profile?.legalLastName),
    phoneE164: trimmed(profile?.phoneE164),
    brokerageOffice: trimmed(profile?.brokerageOffice),
    licenseState: trimmed(profile?.licenseState),
    licenseType: trimmed(profile?.licenseType),
    licenseNumber: trimmed(profile?.licenseNumber),
    licenseExpiration: trimmed(profile?.licenseExpiration),
    nrdsNumber: trimmed(profile?.nrdsNumber),
    biography: trimmed(profile?.biography),
    languages: list(profile?.languages),
    specialties: list(profile?.specialties),
    serviceAreas: list(profile?.serviceAreas),
    professionalTitle: trimmed(profile?.professionalTitle),
    locationDisplay: trimmed(profile?.locationDisplay),
    // Re-validated on the way out: these round-trip through the database, and
    // a row written before the scheme allowlist existed must not become an href.
    linkedinUrl: safeLinkUrl(profile?.linkedinUrl),
    instagramUrl: safeLinkUrl(profile?.instagramUrl),
    facebookUrl: safeLinkUrl(profile?.facebookUrl),
    personalWebsiteUrl: safeLinkUrl(profile?.personalWebsiteUrl),
    professionalWebsiteUrl: safeLinkUrl(profile?.professionalWebsiteUrl),
    whatsappPhoneE164: trimmed(profile?.whatsappPhoneE164),
    businessEmail: trimmed(profile?.businessEmail),
    completion:
      typeof completion === "number" && Number.isFinite(completion)
        ? Math.max(0, Math.min(100, Math.round(completion)))
        : 0,
  };
}
