import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import { getLeadSource } from "./leads";
import type { ArchiveSavedShowingTourInput, CreateSavedShowingTourInput, ReviewSavedShowingTourInput, SavedShowingToursPage, SavedShowingToursQuery, SavedShowingTourView, SavedTourReview, SavedTourScheduleResult, ScheduleSavedShowingTourInput, UpdateSavedShowingTourInput } from "../../showings/saved-tour-domain";

export class SavedShowingTourError extends Error { constructor(readonly code: string, readonly status: number, readonly fields: string[] = []) { super(`Saved tour request failed (${status}: ${code})`); this.name = "SavedShowingTourError"; } }
async function requireSource() { if (await getLeadSource() !== "db") throw new SavedShowingTourError("sample_read_only", 403); }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = () => fetch(apiPath(path), { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (!init?.method || init.method === "GET") { let first: Response | null = null; try { first = await send(); } catch { /* One metadata read retry. */ } response = !first || first.status === 502 || first.status === 504 ? await send() : first; }
  else response = await send();
  if (!response.ok) { let code = "unknown", fields: string[] = []; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; if (Array.isArray(body.fields)) fields = body.fields.filter((value: unknown): value is string => typeof value === "string"); } catch { /* Status remains authoritative. */ } throw new SavedShowingTourError(code, response.status, fields); }
  return response.json() as Promise<T>;
}
export async function getSavedShowingTours(query: SavedShowingToursQuery = {}): Promise<SavedShowingToursPage> { await requireSource(); const params = new URLSearchParams({ page: String(query.page ?? 1), ...(query.pageSize ? { pageSize: String(query.pageSize) } : {}), ...(query.contactId ? { contactId: query.contactId } : {}), ...(query.sourceListId ? { sourceListId: query.sourceListId } : {}), ...(query.archived !== undefined ? { archived: String(query.archived) } : {}) }); return request<SavedShowingToursPage>(`/api/showing-tours?${params}`); }
export async function getSavedShowingTour(id: string): Promise<SavedShowingTourView> { await requireSource(); return (await request<{ tour: SavedShowingTourView }>(`/api/showing-tours/${encodeURIComponent(id)}`)).tour; }
export async function createSavedShowingTour(input: CreateSavedShowingTourInput): Promise<SavedShowingTourView> { await requireSource(); try { return (await request<{ tour: SavedShowingTourView }>("/api/showing-tours", { method: "POST", body: JSON.stringify(input) })).tour; } finally { bumpDataVersion(); } }
export async function updateSavedShowingTour(id: string, input: UpdateSavedShowingTourInput): Promise<SavedShowingTourView> { await requireSource(); try { return (await request<{ tour: SavedShowingTourView }>(`/api/showing-tours/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).tour; } finally { bumpDataVersion(); } }
export async function archiveSavedShowingTour(id: string, input: ArchiveSavedShowingTourInput): Promise<SavedShowingTourView> { await requireSource(); try { return (await request<{ tour: SavedShowingTourView }>(`/api/showing-tours/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify(input) })).tour; } finally { bumpDataVersion(); } }
/** Billable read: retries are always an explicit user action. */
export async function reviewSavedShowingTour(id: string, input: ReviewSavedShowingTourInput): Promise<SavedTourReview> { await requireSource(); return request<SavedTourReview>(`/api/showing-tours/${encodeURIComponent(id)}/review`, { method: "POST", body: JSON.stringify(input) }); }
export async function scheduleSavedShowingTour(id: string, input: ScheduleSavedShowingTourInput): Promise<SavedTourScheduleResult> { await requireSource(); try { return await request<SavedTourScheduleResult>(`/api/showing-tours/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify(input) }); } finally { bumpDataVersion(); } }
