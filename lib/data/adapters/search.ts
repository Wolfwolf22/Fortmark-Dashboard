/**
 * Search adapter — the browser's view of unified search.
 *
 * It sends text and receives normalised hits. It does not send a brokerage, an
 * agent or a scope, because the server would not believe them: authorization
 * is resolved from the session inside each domain query.
 *
 * There is no sample path here. The old adapter searched the generated
 * brokerage directly from the browser; now a failed request throws and the
 * palette says so. A search that quietly returns invented people would be the
 * worst possible place for fiction — the user would call one of them.
 */
import { apiPath } from "@/lib/routes";
import type { SearchResponse } from "@/lib/search/types";

export class SearchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Search request failed (${status})`);
    this.name = "SearchError";
    this.status = status;
  }
}

/**
 * Run a search.
 *
 * `signal` lets the palette abandon a request the moment the query changes, so
 * a slow answer to "ja" can never overwrite the answer to "jane".
 */
export async function searchAll(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const response = await fetch(apiPath("/api/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ q: query }),
    signal,
  });
  if (!response.ok) throw new SearchError(response.status);
  return (await response.json()) as SearchResponse;
}
