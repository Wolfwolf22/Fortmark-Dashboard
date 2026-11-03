/** Stored internal work only. No generated appointments and no external calendar provider. */
import { apiPath } from "@/lib/routes";
import { bumpDataVersion } from "../store";
import type { CalendarPage, CalendarQuery, CalendarRescheduleInput } from "../../calendar/domain";
export class InternalCalendarError extends Error {
  constructor(readonly code: string, readonly status: number) { super(`Calendar request failed (${status}: ${code})`); this.name = "InternalCalendarError"; }
}
async function request<T>(path: string, input?: CalendarRescheduleInput): Promise<T> {
  const send = () => fetch(apiPath(path), { cache: "no-store", ...(input ? { method: "POST", body: JSON.stringify(input) } : {}), headers: { Accept: "application/json", ...(input ? { "Content-Type": "application/json" } : {}) } });
  let response: Response;
  if (input) response = await send();
  else { let first: Response | null = null; try { first = await send(); } catch { /* One safe read retry. */ } response = !first || first.status === 502 || first.status === 504 ? await send() : first; }
  if (!response.ok) { let code = "unknown"; try { const body = await response.json(); if (typeof body.error === "string") code = body.error; } catch { /* Keep HTTP status. */ } throw new InternalCalendarError(code, response.status); }
  return response.json() as Promise<T>;
}
export function getInternalCalendar(query: CalendarQuery): Promise<CalendarPage> {
  const params = new URLSearchParams({ fromDay: query.fromDay, toDay: query.toDay });
  if (query.kinds) params.set("kinds", query.kinds.join(","));
  return request(`/api/calendar?${params}`);
}
export async function rescheduleCalendarItem(input: CalendarRescheduleInput): Promise<{ rescheduled: true }> {
  try { return await request("/api/calendar/reschedule", input); } finally { bumpDataVersion(); }
}
