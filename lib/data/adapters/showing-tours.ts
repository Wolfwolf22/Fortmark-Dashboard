/** Tour suggestions are reads. A potentially billable POST is never automatically retried. */
import { apiPath } from "@/lib/routes";
import { getLeadSource } from "./leads";
import type { TourContext, TourPlanInput, TourRecommendation } from "../../showings/tour-domain";

export class ShowingTourError extends Error { constructor(readonly code: string, readonly status: number) { super(`Tour request failed (${status}: ${code})`); this.name = "ShowingTourError"; } }
async function request<T>(path: string, input?: TourPlanInput): Promise<T> {
  if (await getLeadSource() !== "db") throw new ShowingTourError("sample_read_only", 403);
  const send = () => fetch(apiPath(path), { ...(input ? { method: "POST", body: JSON.stringify(input) } : {}), headers: { Accept: "application/json", ...(input ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (input) response = await send();
  else { let first: Response | null = null; try { first = await send(); } catch { /* Retry this metadata read once. */ } response = !first || first.status === 502 || first.status === 504 ? await send() : first; }
  if (!response.ok) { let code = "unknown"; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; } catch { /* Keep HTTP status. */ } throw new ShowingTourError(code, response.status); }
  return response.json() as Promise<T>;
}
export function getShowingTourContext(showingId: string, page = 1): Promise<TourContext> { return request<TourContext>(`/api/showings/${encodeURIComponent(showingId)}/tour?${new URLSearchParams({ page: String(page) })}`); }
export function getShowingTourRecommendation(showingId: string, input: TourPlanInput): Promise<TourRecommendation> { return request<TourRecommendation>(`/api/showings/${encodeURIComponent(showingId)}/tour`, input); }
