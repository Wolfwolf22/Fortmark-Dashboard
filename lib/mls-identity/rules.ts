/**
 * Agent MLS identity — pure rules, no I/O.
 *
 * The professional licence a FortMark agent enters is the human anchor. The
 * server looks it up in the MLS Member roster (`Member.MemberStateLicense`),
 * and the answer is classified here. Nothing is guessed:
 *
 *   exactly one active member, in FortMark's office  → linked
 *   exactly one active member, another office        → office_mismatch
 *   no active member                                 → not_found
 *   more than one active member                      → ambiguous
 *   the member is already another user's             → conflict
 *   the MLS could not be asked                       → unavailable
 *
 * "not_found" is an MLS fact, not a licence judgement: a real licence can be
 * absent from this MLS, held under another association, or delayed in the
 * feed. Nothing here ever calls a licence invalid.
 */
import type { MLS_LINK_STATUSES } from "../db/schema.ts";

export type MlsLinkStatus = (typeof MLS_LINK_STATUSES)[number];

/** What the dashboard can say about a user's MLS identity. */
export type MlsIdentityState =
  | MlsLinkStatus
  /** The profile holds no licence number, so there is nothing to resolve. */
  | "no_license"
  /** The profile's licence changed since it was resolved; not usable yet. */
  | "stale";

/**
 * The only MLS this dashboard reads is a Florida MLS (`miamire`); a licence
 * issued by another state cannot be in its roster by definition.
 */
export const RESOLVABLE_LICENSE_STATES: readonly string[] = ["FL"];

/**
 * Canonical form for comparison: upper-case, no spaces, dots, hyphens or
 * slashes. The stored profile value is not changed by this.
 */
export function normalizeLicense(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const s = value.toUpperCase().replace(/[\s./-]+/g, "");
  return s.length >= 2 ? s : null;
}

/**
 * Florida real-estate licence prefixes seen in the live roster: sales
 * associate (SL) and broker (BK). Only these two are observed in `miamire`.
 */
const FL_PREFIX = /^(SL|BK)(\d+)$/;

/**
 * Every spelling of one licence the roster might hold.
 *
 * `miamire` stores Florida licences mostly WITHOUT the DBPR prefix (6 of about
 * 50,900 active members carry `SL`/`BK`), while agents usually type it
 * (`SL3xxxxxx`). So `SL1234567` also looks for `1234567`, and a bare
 * `1234567` also looks for `SL1234567` and `BK1234567`. These are spellings of
 * the same number, not fuzzy matching: a different digit never matches.
 */
export function licenseCandidates(value: string | null | undefined): string[] {
  const n = normalizeLicense(value);
  if (!n) return [];
  const out = new Set<string>([n]);
  const prefixed = FL_PREFIX.exec(n);
  if (prefixed) out.add(prefixed[2]);
  else if (/^\d+$/.test(n)) {
    out.add(`SL${n}`);
    out.add(`BK${n}`);
  }
  return [...out];
}

/** The Member fields the resolver reads. Nothing personal leaves the server. */
export interface MemberCandidate {
  memberKey: string;
  memberMlsId: string | null;
  officeMlsId: string | null;
  status: string | null;
}

export type Resolution =
  | {
      status: "linked" | "office_mismatch";
      memberKey: string;
      memberMlsId: string | null;
      officeMlsId: string | null;
      candidateCount: 1;
    }
  | { status: "not_found" | "ambiguous"; candidateCount: number }
  | { status: "unavailable"; candidateCount: 0 };

/** Active in the roster. A missing status is treated as not active. */
export function isActiveMember(m: MemberCandidate): boolean {
  return (m.status ?? "").trim().toLowerCase() === "active";
}

/**
 * Classify the roster's answer for one licence.
 *
 * `expectedOfficeId` is FortMark's MLS office (system configuration). When it
 * is null the member can still be identified, but nothing can confirm it is
 * FortMark's, so the result is `office_mismatch` — never a silent link.
 */
export function classifyMembers(
  members: readonly MemberCandidate[],
  expectedOfficeId: string | null
): Resolution {
  const byKey = new Map<string, MemberCandidate>();
  for (const m of members) if (m.memberKey && isActiveMember(m)) byKey.set(m.memberKey, m);
  const active = [...byKey.values()];
  if (active.length === 0) return { status: "not_found", candidateCount: 0 };
  if (active.length > 1) return { status: "ambiguous", candidateCount: active.length };
  const [m] = active;
  const inFortmark = Boolean(expectedOfficeId && m.officeMlsId && m.officeMlsId === expectedOfficeId);
  return {
    status: inFortmark ? "linked" : "office_mismatch",
    memberKey: m.memberKey,
    memberMlsId: m.memberMlsId,
    officeMlsId: m.officeMlsId,
    candidateCount: 1,
  };
}

/**
 * Whether a stored link still describes the profile's current licence.
 * A changed number OR state makes it stale: never keep the old member.
 */
export function linkMatchesLicense(
  link: { licenseNumber: string | null; licenseState: string | null },
  profile: { licenseNumber: string | null; licenseState: string | null }
): boolean {
  return (
    normalizeLicense(link.licenseNumber) === normalizeLicense(profile.licenseNumber) &&
    (link.licenseState ?? "").toUpperCase() === (profile.licenseState ?? "").toUpperCase()
  );
}

// --- What the browser receives ---------------------------------------------------

/**
 * The browser's view of the caller's MLS identity. No member key, no roster
 * payload, no contact detail from the Member record. `memberMlsId` is included
 * only for broker/admin views (the caller decides).
 */
export interface MlsIdentityView {
  state: MlsIdentityState;
  /** True only when My Listings may use this identity. */
  linked: boolean;
  /** FortMark's office name when linked (from the brokerage record). */
  officeName: string | null;
  checkedAt: string | null;
  memberMlsId?: string | null;
}

export const MLS_STATE_LABEL: Record<MlsIdentityState, string> = {
  linked: "Connected",
  office_mismatch: "Needs broker review",
  not_found: "MLS identity not found",
  ambiguous: "Needs broker review",
  conflict: "Needs broker review",
  unavailable: "MLS check pending",
  no_license: "Not connected",
  stale: "MLS check pending",
};

/** One restrained sentence per state, for Profile and onboarding. */
export const MLS_STATE_DETAIL: Record<MlsIdentityState, string> = {
  linked: "Your professional licence is matched to your MLS membership at FortMark.",
  office_mismatch:
    "The MLS lists this licence under a different office. Your broker will review it; My Listings stays off until then.",
  not_found:
    "We couldn't match this licence to an MLS member. Check the number, or ask your broker. This is not a judgement on the licence itself.",
  ambiguous: "More than one MLS member matched this licence. Your broker will review it.",
  conflict: "This MLS membership is already connected to another FortMark account. Your broker will review it.",
  unavailable: "The MLS could not be reached. Your profile is saved; we'll check again.",
  no_license: "Add your professional licence number and FortMark will connect your MLS membership.",
  stale: "Your licence changed. FortMark will match it to the MLS again.",
};
