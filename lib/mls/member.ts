import "server-only";
/**
 * The MLS roster: Member and Office resources (verified in `miamire`
 * 2026-09-23 against the live field catalogue).
 *
 * Server-only. Selects the identifiers the dashboard needs and nothing else —
 * no member email, phones, address or social fields are requested, so none
 * can leak even by accident. Raw records never leave this module.
 */
import type { BridgeConfig } from "./config.ts";
import { bridgeRequest } from "./bridge.ts";
import { anyOf, eq } from "./odata.ts";
import type { MemberCandidate } from "../mls-identity/rules.ts";

/** Member fields read to identify an agent. Verified live. */
export const MEMBER_FIELDS: readonly string[] = [
  "MemberKey",
  "MemberMlsId",
  "OfficeMlsId",
  "MemberStatus",
  "MemberStateLicense",
];

/** Office fields read for FortMark's central record. Verified live. */
export const OFFICE_RECORD_FIELDS: readonly string[] = [
  "OfficeKey",
  "OfficeMlsId",
  "OfficeName",
  "OfficePhone",
  "OfficeStatus",
];

/** Enough to see "more than one" without paging a roster. */
const MEMBER_LOOKUP_TOP = 10;

type Raw = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Members whose state licence is one of `candidates` (spellings of the same
 * number — see `licenseCandidates`). Throws `BridgeError` when the MLS cannot
 * be asked; an empty array means it was asked and holds none.
 */
export async function findMembersByLicense(
  config: BridgeConfig,
  candidates: readonly string[],
  signal?: AbortSignal
): Promise<MemberCandidate[]> {
  if (candidates.length === 0) return [];
  const page = await bridgeRequest<Raw>(
    config,
    "Member",
    {
      $filter: anyOf("MemberStateLicense", candidates),
      $select: MEMBER_FIELDS.join(","),
      $top: MEMBER_LOOKUP_TOP,
    },
    signal
  );
  return page.value
    .map((r) => ({
      memberKey: text(r.MemberKey) ?? "",
      memberMlsId: text(r.MemberMlsId),
      officeMlsId: text(r.OfficeMlsId),
      status: text(r.MemberStatus),
    }))
    .filter((m) => m.memberKey);
}

export interface OfficeRecord {
  officeKey: string | null;
  officeMlsId: string;
  name: string | null;
  phone: string | null;
  status: string | null;
}

/** The Office record for one MLS office id, or null when the MLS has none. */
export async function getOfficeRecord(
  config: BridgeConfig,
  officeMlsId: string,
  signal?: AbortSignal
): Promise<OfficeRecord | null> {
  const page = await bridgeRequest<Raw>(
    config,
    "Office",
    { $filter: eq("OfficeMlsId", officeMlsId), $select: OFFICE_RECORD_FIELDS.join(","), $top: 1 },
    signal
  );
  const r = page.value[0];
  if (!r) return null;
  return {
    officeKey: text(r.OfficeKey),
    officeMlsId: text(r.OfficeMlsId) ?? officeMlsId,
    name: text(r.OfficeName),
    phone: text(r.OfficePhone),
    status: text(r.OfficeStatus),
  };
}
