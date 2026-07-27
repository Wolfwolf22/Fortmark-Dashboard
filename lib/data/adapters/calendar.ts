/**
 * Calendar adapter. Mock-backed today; swap the bodies for the calendar
 * provider and the UI is untouched.
 */
import { CalendarEvent, DateRange, EventType } from "../types";
import { events } from "../mock/db";
import { bumpDataVersion } from "../store";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";

export async function getEvents(
  range: DateRange,
  types?: EventType[]
): Promise<CalendarEvent[]> {
  await delay();
  let result = events.filter((e) => inRange(e.start, range));
  if (types?.length) result = result.filter((e) => types.includes(e.type));
  return result.sort((a, b) => a.start.localeCompare(b.start));
}

export async function getEvent(id: string): Promise<CalendarEvent | undefined> {
  await delay(100);
  return events.find((e) => e.id === id);
}

export async function createEvent(
  input: Pick<CalendarEvent, "type" | "title" | "start" | "end"> &
    Partial<Pick<CalendarEvent, "address" | "notes">>
): Promise<CalendarEvent> {
  await delay(200);
  const created: CalendarEvent = {
    id: `event-${events.length + 1}-new`,
    agentId: "agent-1",
    ...input,
  };
  events.push(created);
  bumpDataVersion();
  return created;
}
