/** Private production showing records. No mock calendar adapter is used here. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getLeadSource } from "./leads";
import type { CreateShowingInput, ShowingAgenda, ShowingMutation, ShowingQuery, ShowingSummary, ShowingView, ShowingsPage } from "../../showings/domain";

export class ShowingError extends Error {
  constructor(readonly code: string, readonly status: number, readonly fields: string[] = []) { super(`Showing request failed (${status}: ${code})`); this.name = "ShowingError"; }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = () => fetch(apiPath(path), { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (!init?.method || init.method === "GET") {
    let first: Response | null = null;
    try { first = await send(); } catch { /* One read retry below. */ }
    response = !first || first.status === 502 || first.status === 504 ? await send() : first;
  } else response = await send();
  if (!response.ok) {
    let code = "unknown", fields: string[] = [];
    try { const body = await response.json(); if (typeof body.error === "string") code = body.error; if (Array.isArray(body.fields)) fields = body.fields.filter((field: unknown): field is string => typeof field === "string"); } catch { /* HTTP status remains authoritative. */ }
    throw new ShowingError(code, response.status, fields);
  }
  return await response.json() as T;
}
async function requireSource() { if (await getLeadSource() !== "db") throw new ShowingError("sample_read_only", 403); }
function queryString(query: ShowingQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to, page: String(query.page ?? 1), ...(query.status ? { status: query.status } : {}), ...(query.contactId ? { contactId: query.contactId } : {}), ...(query.pageSize ? { pageSize: String(query.pageSize) } : {}) });
  return params.toString();
}
export async function getShowings(query: ShowingQuery): Promise<ShowingsPage> { await requireSource(); return request<ShowingsPage>(`/api/showings?${queryString(query)}`); }
export async function getShowingAgenda(query: ShowingQuery): Promise<ShowingAgenda> { await requireSource(); return request<ShowingAgenda>(`/api/showings/agenda?${queryString(query)}`); }
export async function getShowing(id: string): Promise<ShowingView> { await requireSource(); return (await request<{ showing: ShowingView }>(`/api/showings/${encodeURIComponent(id)}`)).showing; }
export async function createShowing(input: CreateShowingInput): Promise<ShowingView> { await requireSource(); try { return (await request<{ showing: ShowingView }>("/api/showings", { method: "POST", body: JSON.stringify(input) })).showing; } finally { bumpDataVersion(); } }
export async function updateShowing(id: string, input: ShowingMutation): Promise<ShowingView> { await requireSource(); try { return (await request<{ showing: ShowingView }>(`/api/showings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).showing; } finally { bumpDataVersion(); } }
export async function getShowingSummary(): Promise<ShowingSummary> { await requireSource(); return request<ShowingSummary>("/api/showings/summary"); }
