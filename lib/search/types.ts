/**
 * The unified search contract.
 *
 * One shape for every entity FortMark can retrieve, so the palette renders a
 * contact and a transaction with the same code, and so a future server-side
 * caller — FortMark AI resolving "the Brickell deal" — can consume the same
 * providers without importing a line of browser code.
 *
 * Two rules govern what may appear in a hit.
 *
 * **Identification and navigation only.** A hit carries what a person needs to
 * recognise the record and go to it. Not notes, not money, not documents, not
 * audit payloads. Search is a way to find a record, never a way to read one.
 *
 * **A provider that cannot answer says so.** As on Home, "we searched and found
 * nothing" and "we could not search" are different facts, and the palette must
 * be able to tell the reader which one happened.
 *
 * Isomorphic: no server-only imports.
 */

export type SearchEntity = "contact" | "transaction" | "listing" | "agent";

/**
 * Why a row matched. Ranking is a pure function of this plus the entity, so
 * the order of results is explainable by reading two small tables rather than
 * by inspecting a score.
 */
export type MatchKind =
  | "exact_id"
  | "exact_email"
  | "exact_phone"
  | "exact_mls"
  | "prefix"
  | "partial";

export interface SearchHit {
  /** The domain id. Stable, and what a deep link is built from. */
  id: string;
  entity: SearchEntity;
  /** The line a person scans: a name, or a property address. */
  title: string;
  /** What kind of record this is and where it stands. Never a note. */
  subtitle?: string;
  /** One more disambiguating fact — an email, a phone, a closing date. */
  meta?: string;
  /** The canonical destination. Always a route this app actually serves. */
  href: string;
  match: MatchKind;
}

export type ProviderAvailability =
  | "available"
  | "not_configured"
  | "not_permitted"
  | "unavailable";

export type ProviderStates = Record<SearchEntity, ProviderAvailability>;

export interface SearchResponse {
  /** The normalised query the server actually ran. */
  query: string;
  hits: SearchHit[];
  providers: ProviderStates;
  /** True when a provider had more matches than its cap allowed. */
  truncated: boolean;
}

/** Per-provider caps. Small on purpose: the palette is a finder, not a report. */
export const PROVIDER_LIMIT = 5;

/** Nothing below this reaches a database provider. */
export const MIN_QUERY_LENGTH = 2;

/** A remote, billable provider needs more to go on than two characters. */
export const MIN_REMOTE_QUERY_LENGTH = 3;

/** Longer than this is not a search, and is refused rather than truncated. */
export const MAX_QUERY_LENGTH = 120;
