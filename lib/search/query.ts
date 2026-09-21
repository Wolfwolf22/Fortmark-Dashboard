/**
 * Reading what the user typed.
 *
 * People do not announce what they are looking for. They type `jane@x.com`,
 * or `(954) 555-0100`, or `A12008414`, or `2451 Brickell`, and expect the
 * right thing back. So the query is classified once, here, and the providers
 * are told what shape it is rather than each guessing again.
 *
 * Deliberately conservative. This is pattern recognition on obvious forms, not
 * natural-language understanding: there is no parser for "deals closing next
 * month", and pretending otherwise would be the "AI search" this phase is
 * explicitly not building. Anything unrecognised is simply text, which every
 * provider knows how to match.
 *
 * Pure and dependency-free, so both the palette and the server can use it and
 * the tests can call it directly.
 */
import { MAX_QUERY_LENGTH } from "./types.ts";

export type QueryShape = "email" | "phone" | "mls" | "uuid" | "text";

export interface ParsedQuery {
  /** Trimmed, whitespace-collapsed, as the server will echo it back. */
  text: string;
  /** Lower-cased, for case-insensitive comparison. */
  lower: string;
  shape: QueryShape;
  /** Digits only, when the query is a phone number. */
  digits?: string;
  /** Upper-cased, when the query looks like an MLS number. */
  mls?: string;
}

/** A single-line query: no tabs, no runs of spaces, no leading or trailing space. */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function isTooLong(raw: string): boolean {
  return normalizeQuery(raw).length > MAX_QUERY_LENGTH;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A RESO-style listing id: one or two letters then digits, e.g. A12008414. */
const MLS = /^[A-Za-z]{1,2}\d{6,12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Punctuation a person actually types around a phone number. */
const PHONE_PUNCTUATION = /^[\d\s()+.-]+$/;

/**
 * Classify the query.
 *
 * Order matters: an email is unambiguous, an MLS number cannot be a phone
 * number (it has letters), and a run of digits long enough to be a phone
 * number is treated as one. A short run of digits — a house number, say — is
 * left as text, because `2451` is far more likely to be the start of an
 * address than a phone number.
 */
export function parseQuery(raw: string): ParsedQuery {
  const text = normalizeQuery(raw);
  const lower = text.toLowerCase();

  if (EMAIL.test(text)) return { text, lower, shape: "email" };
  if (UUID.test(text)) return { text, lower, shape: "uuid" };
  if (MLS.test(text)) return { text, lower, shape: "mls", mls: text.toUpperCase() };

  if (PHONE_PUNCTUATION.test(text)) {
    const digits = text.replace(/\D/g, "");
    // Seven digits is a local number; fifteen is E.164's ceiling.
    if (digits.length >= 7 && digits.length <= 15) {
      return { text, lower, shape: "phone", digits };
    }
  }

  return { text, lower, shape: "text" };
}

/**
 * Escape a value for use inside a SQL `LIKE` pattern.
 *
 * Without this a query containing `%` matches everything and a query
 * containing `_` matches any character — a user typing a literal underscore
 * would get nonsense, and a pattern of all `%` would ask the database to
 * return the entire table.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `dan` → `dan%` — an anchored prefix, which an index can serve. */
export function prefixPattern(value: string): string {
  return `${escapeLike(value)}%`;
}

/** `brickell` → `%brickell%` — a containment scan, used only where narrow. */
export function containsPattern(value: string): string {
  return `%${escapeLike(value)}%`;
}
