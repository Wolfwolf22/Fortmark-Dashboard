/**
 * The order results appear in.
 *
 * Two small tables and a tie-break, and that is the whole ranking system. It
 * is written this way on purpose: a user who wonders why one row came first
 * can be told the reason in a sentence, and an engineer can predict the order
 * without running the code. There is no score, no weighting, no learned
 * relevance and nothing that would need an explanation beginning "the model".
 *
 * Pure, dependency-free and total: every comparison ends in a stable answer,
 * so the same hits always come back in the same order.
 */
import type { MatchKind, SearchEntity, SearchHit } from "./types.ts";

/**
 * How the row matched, strongest first.
 *
 * An identifier the user typed in full is the strongest signal there is —
 * nobody types a whole email address by accident — so exact matches lead,
 * ordered by how specific the identifier is. A prefix beats a fragment
 * because `Dan` finding Daniel is what the user meant, while `an` finding him
 * is a coincidence.
 */
const MATCH_RANK: Record<MatchKind, number> = {
  exact_id: 0,
  exact_email: 1,
  exact_phone: 2,
  exact_mls: 3,
  prefix: 4,
  partial: 5,
};

/**
 * Which kind of record wins a tie.
 *
 * People first: a name is usually a person, and the person is the canonical
 * record the rest of the system hangs off. Then the work, then the market,
 * then colleagues.
 */
const ENTITY_RANK: Record<SearchEntity, number> = {
  contact: 0,
  transaction: 1,
  listing: 2,
  agent: 3,
};

export function compareHits(a: SearchHit, b: SearchHit): number {
  const byMatch = MATCH_RANK[a.match] - MATCH_RANK[b.match];
  if (byMatch !== 0) return byMatch;
  const byEntity = ENTITY_RANK[a.entity] - ENTITY_RANK[b.entity];
  if (byEntity !== 0) return byEntity;
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  // The id breaks the last tie, so two identically titled rows never swap
  // places between identical requests.
  return a.id.localeCompare(b.id);
}

export function rankHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort(compareHits);
}

/** Exact matches — the kinds worth promoting above their group. */
export function isExact(match: MatchKind): boolean {
  return MATCH_RANK[match] <= MATCH_RANK.exact_mls;
}

/**
 * The single result to surface above the groups, when there is an obvious one.
 *
 * Only an exact identifier qualifies, and only when nothing else matched as
 * strongly: if two records both match a typed email exactly, neither is "the"
 * answer and the reader should see the group instead of being nudged at one.
 */
export function topResult(ranked: SearchHit[]): SearchHit | undefined {
  const first = ranked[0];
  if (!first || !isExact(first.match)) return undefined;
  const second = ranked[1];
  if (second && second.match === first.match) return undefined;
  return first;
}

/** The order groups are rendered in. */
export const ENTITY_ORDER: SearchEntity[] = ["contact", "transaction", "listing", "agent"];
