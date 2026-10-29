/** Private-book duplicate hints. An exact identifier or a name hint never merges people. */
import { toE164 } from "../profile/normalize.ts";
import type { LeadStage } from "../data/types.ts";

export interface DuplicateIdentity {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneE164?: string | null;
}
export type DuplicateReason = "exact_email" | "exact_phone" | "similar_name";
export type ExactDuplicateReason = Exclude<DuplicateReason, "similar_name">;
export type DuplicatePairReason = "email" | "phone" | "similar_name";
export interface DuplicateContact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  stage: LeadStage;
  updatedAt: string;
}
export type DuplicateCandidate = DuplicateContact;
export interface DuplicateMatch { contact: DuplicateContact; reasons: DuplicateReason[] }
export interface ExactDuplicateMatch extends DuplicateMatch { reasons: ExactDuplicateReason[] }
export interface DuplicatePair { primary: DuplicateContact; duplicate: DuplicateContact; reasons: DuplicatePairReason[] }
export interface DuplicateSuggestionsPage {
  pairs: DuplicatePair[];
  /** Primary contacts whose complete pair range has been examined. */
  scannedContacts: number;
  totalContacts: number;
  hasMore: boolean;
  nextCursor: string | null;
}
export interface DuplicateRecord extends DuplicateIdentity {
  id: string;
  company?: string | null;
  stage: LeadStage;
  updatedAt: Date | string;
}
export interface DuplicateCursor { primaryId: string; duplicateId: string }
export const DUPLICATE_PAGE_SIZE = 25;
export const MAX_DUPLICATE_PAGE_SIZE = 50;
export const DUPLICATE_SCAN_CONTACTS = 100;
/** Marks one anchor's whole target range complete without putting private values in a cursor. */
export const COMPLETED_DUPLICATE_ANCHOR = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Do not collapse plus tags, dots or provider-specific mailbox aliases. */
export function normalizeDuplicateEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && !/[\u0000-\u001f\u007f-\u009f]/u.test(email) && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/u.test(email) ? email : null;
}
/** Use the same E.164 interpretation as contact creation; never match empty numbers. */
export function normalizeDuplicatePhone(value: unknown): string | null {
  return typeof value === "string" && value.length <= 40 ? toE164(value) : null;
}
export function normalizeDuplicateName(value: unknown): string {
  return typeof value === "string" && value.length <= 400
    ? value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : "";
}

export function duplicateNameKey(value: DuplicateIdentity): string {
  const legal = [value.firstName, value.lastName].filter(Boolean).join(" ").trim();
  return normalizeDuplicateName(value.firstName?.trim() && value.lastName?.trim() ? legal : value.preferredName?.trim() || value.name || legal);
}

/** Conservative, advisory name hints: two words, then matching family/given name plus a 3-letter prefix. */
export function similarDuplicateNames(left: string, right: string): boolean {
  if (!left || !right || /\p{N}/u.test(left + right)) return false;
  const a = left.split(" "), b = right.split(" ");
  if (a.length < 2 || b.length < 2) return false;
  if (left === right) return true;
  const firstA = a[0], firstB = b[0], lastA = a[a.length - 1], lastB = b[b.length - 1];
  if ([firstA, firstB, lastA, lastB].some(part => [...part].length < 3)) return false;
  return (lastA === lastB && [...firstA].slice(0, 3).join("") === [...firstB].slice(0, 3).join(""))
    || (firstA === firstB && [...lastA].slice(0, 3).join("") === [...lastB].slice(0, 3).join(""));
}

export function duplicateReasons(left: DuplicateIdentity, right: DuplicateIdentity): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  const email = normalizeDuplicateEmail(left.email);
  const phone = normalizeDuplicatePhone(left.phoneE164 ?? left.phone);
  if (email && email === normalizeDuplicateEmail(right.email)) reasons.push("exact_email");
  if (phone && phone === normalizeDuplicatePhone(right.phoneE164 ?? right.phone)) reasons.push("exact_phone");
  if (similarDuplicateNames(duplicateNameKey(left), duplicateNameKey(right))) reasons.push("similar_name");
  return reasons;
}

export function toDuplicateContact(row: DuplicateRecord): DuplicateContact {
  const name = row.preferredName?.trim() || row.name?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || "Unnamed contact";
  return {
    id: row.id, name, stage: row.stage,
    updatedAt: new Date(row.updatedAt).toISOString(),
    ...(row.email ? { email: row.email } : {}),
    ...(row.phoneE164 || row.phone ? { phone: (row.phoneE164 || row.phone)! } : {}),
    ...(row.company ? { company: row.company } : {}),
  };
}

export function duplicatePair(left: DuplicateRecord, right: DuplicateRecord): DuplicatePair | null {
  if (left.id === right.id) return null;
  const reasons = duplicateReasons(left, right).map(reason => reason === "exact_email" ? "email" : reason === "exact_phone" ? "phone" : reason);
  if (!reasons.length) return null;
  const [primary, duplicate] = left.id < right.id ? [left, right] : [right, left];
  return { primary: toDuplicateContact(primary), duplicate: toDuplicateContact(duplicate), reasons };
}

export function encodeDuplicateCursor(value: DuplicateCursor): string {
  return btoa(JSON.stringify({ v: 1, ...value })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeDuplicateCursor(raw: string): DuplicateCursor | null {
  if (!raw || raw.length > 180 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    return value && Object.keys(value).sort().join() === "duplicateId,primaryId,v" && value.v === 1 && UUID.test(value.primaryId) && UUID.test(value.duplicateId) && value.primaryId < value.duplicateId
      ? { primaryId: value.primaryId, duplicateId: value.duplicateId } : null;
  } catch { return null; }
}
export function readDuplicateQuery(params: URLSearchParams): { pageSize: number; cursor?: string } | null {
  const size = params.get("pageSize");
  if (size !== null && !/^\d{1,2}$/.test(size)) return null;
  const pageSize = size === null ? DUPLICATE_PAGE_SIZE : Number(size);
  if (pageSize < 1 || pageSize > MAX_DUPLICATE_PAGE_SIZE) return null;
  const cursor = params.get("cursor");
  if (cursor !== null && !decodeDuplicateCursor(cursor)) return null;
  return { pageSize, ...(cursor ? { cursor } : {}) };
}

export function compareDuplicatePairIds(a: DuplicateCursor, b: DuplicateCursor): number {
  return a.primaryId === b.primaryId ? (a.duplicateId === b.duplicateId ? 0 : a.duplicateId < b.duplicateId ? -1 : 1) : a.primaryId < b.primaryId ? -1 : 1;
}

/** Deterministic pure equivalent for isolated fixtures. Production uses a bounded SQL pair page. */
export function duplicateSuggestionsFromContacts(rows: readonly DuplicateRecord[], options: { pageSize?: number; cursor?: DuplicateCursor } = {}): DuplicateSuggestionsPage {
  const pageSize = Math.min(Math.max(options.pageSize ?? DUPLICATE_PAGE_SIZE, 1), MAX_DUPLICATE_PAGE_SIZE);
  const ordered = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
  const anchors = ordered.filter(row => !options.cursor || (options.cursor.duplicateId === COMPLETED_DUPLICATE_ANCHOR ? row.id > options.cursor.primaryId : row.id >= options.cursor.primaryId)).slice(0, DUPLICATE_SCAN_CONTACTS);
  const pairs: DuplicatePair[] = [];
  for (const anchor of anchors) {
    for (const target of ordered) {
      if (target.id <= anchor.id) continue;
      const key = { primaryId: anchor.id, duplicateId: target.id };
      if (options.cursor && compareDuplicatePairIds(key, options.cursor) <= 0) continue;
      const pair = duplicatePair(anchor, target);
      if (pair) pairs.push(pair);
      if (pairs.length > pageSize) break;
    }
    if (pairs.length > pageSize) break;
  }
  const shown = pairs.slice(0, pageSize), overflow = pairs.length > shown.length;
  const last = shown[shown.length - 1];
  const lastAnchor = anchors[anchors.length - 1];
  const hasUnscanned = Boolean(lastAnchor && ordered.some(row => row.id > lastAnchor.id));
  const hasMore = overflow || hasUnscanned;
  return {
    pairs: shown, totalContacts: ordered.length,
    scannedContacts: overflow && last ? ordered.filter(row => row.id < last.primary.id).length : lastAnchor ? ordered.filter(row => row.id <= lastAnchor.id).length : ordered.length,
    hasMore, nextCursor: overflow && last ? encodeDuplicateCursor({ primaryId: last.primary.id, duplicateId: last.duplicate.id })
      : hasUnscanned && lastAnchor ? encodeDuplicateCursor({ primaryId: lastAnchor.id, duplicateId: COMPLETED_DUPLICATE_ANCHOR }) : null,
  };
}
