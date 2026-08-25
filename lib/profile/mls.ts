/**
 * MLS identity for a professional profile.
 *
 * WHAT THIS IS: a place for a FortMark professional to record the MLS agent
 * identifier they already hold, so the application has a canonical, persisted
 * identity to key future listing work on.
 *
 * WHAT THIS IS NOT: a connection to any MLS. There is no Matrix credential, no
 * RESO/OData agent-roster feed and no verification endpoint wired into this
 * application, so nothing here can confirm that a typed identifier belongs to
 * the person who typed it. Every value this module accepts is SELF-REPORTED,
 * and `mlsVerificationStatus` exists precisely so that fact stays visible in
 * the data rather than being forgotten once the string is stored.
 *
 * The verification status is server-assigned and is deliberately absent from
 * the update schema — see `normalize.ts`. A user cannot mark themselves
 * verified by any request shape, because the field is not an input at all.
 */
import type { Listing } from "../data/types.ts";

/** The only states Release B can honestly represent. */
export type MlsVerificationStatus = "unverified" | "verified";

/**
 * The default for every row, and the only value this release ever writes.
 *
 * `verified` is reachable only when a real verification mechanism exists and
 * writes it server-side. Nothing in the current codebase does, which is why no
 * code path here returns it.
 */
export const DEFAULT_MLS_VERIFICATION: MlsVerificationStatus = "unverified";

export interface MlsBoardOption {
  value: string;
  label: string;
}

/**
 * Boards a FortMark professional is likely to belong to.
 *
 * "Beaches MLS" matches the wording already used by the integrations list in
 * `lib/data/adapters/settings.ts`, and MIAMI REALTORS is the association
 * behind the Matrix system FortMark's property tooling reads. Kept as an
 * open list with an "Other" escape rather than a closed enum: a board that is
 * missing must not stop someone recording the identifier they hold.
 */
export const MLS_BOARDS: readonly MlsBoardOption[] = [
  { value: "miami_realtors", label: "MIAMI REALTORS" },
  { value: "beaches_mls", label: "Beaches MLS" },
  { value: "broward_palm_beaches_st_lucie", label: "Broward, Palm Beaches & St. Lucie REALTORS" },
  { value: "realtors_palm_beaches", label: "REALTORS of the Palm Beaches" },
  { value: "other", label: "Other" },
] as const;

const BOARD_BY_VALUE = new Map(MLS_BOARDS.map((b) => [b.value, b]));
const BOARD_BY_LABEL = new Map(MLS_BOARDS.map((b) => [b.label.toLowerCase(), b]));

/** Canonicalise a submitted board, preserving an unrecognised legacy value. */
export function canonicalizeMlsBoard(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length === 0) return null;
  if (BOARD_BY_VALUE.has(s)) return s;
  const byLabel = BOARD_BY_LABEL.get(s.toLowerCase());
  if (byLabel) return byLabel.value;
  return s.slice(0, 120);
}

/** Display label for a stored board value. Legacy text is shown as stored. */
export function mlsBoardLabel(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const s = stored.trim();
  if (s.length === 0) return null;
  return BOARD_BY_VALUE.get(s)?.label ?? s;
}

/** Options a select should offer, including any legacy stored value. */
export function mlsBoardOptionsFor(
  stored: string | null | undefined
): readonly MlsBoardOption[] {
  const s = typeof stored === "string" ? stored.trim() : "";
  if (s.length === 0 || BOARD_BY_VALUE.has(s)) return MLS_BOARDS;
  return [{ value: s, label: s }, ...MLS_BOARDS];
}

/**
 * Normalise an MLS agent identifier, or return null.
 *
 * Boards issue these in different shapes — digits at MIAMI, letter-prefixed
 * elsewhere — so the rule is deliberately a FORMAT floor rather than a
 * board-specific pattern: 3–32 characters of letters, digits, hyphen or
 * underscore, uppercased so two people typing the same id agree.
 *
 * Rejecting anything more specific would refuse valid identifiers from boards
 * this list does not enumerate, and accepting anything at all would let a
 * sentence be stored as an identifier. Returning null rather than throwing
 * matches every other normaliser here, so one bad paste cannot block a save;
 * `droppedValueErrors` is what tells the user it was not kept.
 */
export function toMlsAgentId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, "").trim().toUpperCase();
  if (s.length < 3 || s.length > 32) return null;
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(s)) return null;
  return s;
}

/**
 * Whether a profile carries enough to be keyed on later.
 *
 * The board alone is not an identity — plenty of people belong to a board
 * without the agent id being recorded — so the agent id is what counts.
 */
export function hasMlsIdentity(p: {
  mlsAgentId?: string | null;
}): boolean {
  return typeof p.mlsAgentId === "string" && p.mlsAgentId.trim().length > 0;
}

export interface MlsIdentity {
  mlsAgentId: string | null;
  mlsOrganization: string | null;
  mlsVerificationStatus: MlsVerificationStatus;
  /** Null until a real verification mechanism stamps it. Never set by a user. */
  mlsVerifiedAt: string | null;
}

/** Project the stored columns onto the display contract. */
export function toMlsIdentity(profile: {
  mlsAgentId?: string | null;
  mlsOrganization?: string | null;
  mlsVerificationStatus?: string | null;
  mlsVerifiedAt?: Date | string | null;
} | null | undefined): MlsIdentity {
  const status =
    profile?.mlsVerificationStatus === "verified" ? "verified" : DEFAULT_MLS_VERIFICATION;
  const verifiedAt = profile?.mlsVerifiedAt ?? null;
  return {
    mlsAgentId: profile?.mlsAgentId?.trim() || null,
    mlsOrganization: profile?.mlsOrganization?.trim() || null,
    mlsVerificationStatus: status,
    mlsVerifiedAt:
      verifiedAt instanceof Date
        ? verifiedAt.toISOString()
        : typeof verifiedAt === "string" && verifiedAt.trim().length > 0
          ? verifiedAt
          : null,
  };
}

/**
 * Human wording for a verification state.
 *
 * "Not verified" is stated plainly rather than softened into something that
 * could be mistaken for a pending connection. The identity is recorded; that
 * is all that has happened.
 */
export function mlsStatusLabel(status: MlsVerificationStatus): string {
  return status === "verified" ? "Verified" : "Not verified";
}

/**
 * The listing-linkage layer.
 *
 * This is the seam future listing work keys on: given a profile's MLS
 * identity, return that professional's own listings.
 *
 * It returns an EMPTY match today, and the reason is structural rather than a
 * missing implementation: `lib/data/types.ts` models a listing's `agentId` as
 * FortMark's internal agent identifier and carries no listing-agent MLS id at
 * all, so there is no field to compare an MLS identity against. Inventing a
 * match — keying on `Listing.mlsNumber`, which identifies the PROPERTY, or
 * guessing from the agent's name — would attribute other people's listings to
 * a user, which is worse than showing none.
 *
 * `linkable` reports which half is missing so a caller can say something
 * accurate instead of rendering an empty list that looks like "you have no
 * listings".
 */
export interface MlsListingLink {
  listings: Listing[];
  /** True only when both an identity and a comparable listing field exist. */
  linkable: boolean;
  reason: "no_identity" | "no_listing_agent_mls_field" | "linked";
}

export function listingsForMlsIdentity(
  identity: Pick<MlsIdentity, "mlsAgentId">,
  listings: readonly Listing[]
): MlsListingLink {
  if (!identity.mlsAgentId) {
    return { listings: [], linkable: false, reason: "no_identity" };
  }
  // Deliberately checks the DATA rather than assuming: when a listing-agent
  // MLS id is added to the listing model, this function starts matching
  // without any other change.
  const withAgentMls = listings.filter(
    (l) => typeof (l as { listingAgentMlsId?: unknown }).listingAgentMlsId === "string"
  );
  if (withAgentMls.length === 0) {
    return { listings: [], linkable: false, reason: "no_listing_agent_mls_field" };
  }
  const target = identity.mlsAgentId.toUpperCase();
  return {
    listings: withAgentMls.filter(
      (l) =>
        String((l as { listingAgentMlsId?: unknown }).listingAgentMlsId).toUpperCase() === target
    ),
    linkable: true,
    reason: "linked",
  };
}
