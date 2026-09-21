/**
 * Contact list filters, parsed once for both shapes they arrive in.
 *
 * The list screen sends its non-identifying filters in a query string; the
 * search term arrives in a POST body instead (`app/api/contacts/search`).
 * Both paths must agree on what a valid filter is, so both run through here.
 * `read` is a plain key lookup, satisfied by `URLSearchParams.get` or by a
 * JSON object.
 *
 * Isomorphic on purpose: no server-only import, so a test can exercise it
 * without a request.
 */
import type { LeadSource, LeadStage } from "../data/types.ts";
import { ALL_CONTACT_STAGES } from "./stages.ts";

const SOURCES: readonly LeadSource[] = ["referral", "sphere", "sign_call", "website", "open_house", "past_client", "social", "advertising", "walk_in", "other"];

export type FilterReader = (key: string) => string | null;

export function parseContactFilters(read: FilterReader) {
  const list = <T extends string>(raw: string | null, allowed: readonly T[]) => {
    if (!raw) return undefined;
    const picked = raw.split(",").map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s));
    return picked.length ? picked : undefined;
  };
  const q = read("q")?.trim().slice(0, 120);
  const agent = read("agent")?.trim();
  return {
    stage: list(read("stage"), ALL_CONTACT_STAGES as readonly LeadStage[]),
    source: list(read("source"), SOURCES),
    agentId: agent && /^[A-Za-z0-9-]{1,64}$/.test(agent) ? agent : undefined,
    query: q && q.length > 0 ? q : undefined,
  };
}

