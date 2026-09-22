/**
 * Calendar adapter.
 *
 * There is no calendar provider. Every event below is generated, so each
 * read asks first whether this deployment is in the labelled fixture mode;
 * in ordinary mode the read is refused and the screen says the calendar is
 * not connected. An invented showing on a real agent's Tuesday is exactly
 * the kind of fiction that gets someone to drive to an address.
 */
import { CalendarEvent, DateRange, EventType } from "../types";
import { events } from "../mock/db";
import { bumpDataVersion } from "../store";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";
import { requireSubsystem } from "./subsystems";

export async function getEvents(
  range: DateRange,
  types?: EventType[]
): Promise<CalendarEvent[]> {
  await requireSubsystem("calendar");
  await delay();
  let result = events.filter((e) => inRange(e.start, range));
  if (types?.length) result = result.filter((e) => types.includes(e.type));
  return result.sort((a, b) => a.start.localeCompare(b.start));
}

export async function getEvent(id: string): Promise<CalendarEvent | undefined> {
  await requireSubsystem("calendar");
  await delay(100);
  return events.find((e) => e.id === id);
}

export async function createEvent(
  input: Pick<CalendarEvent, "type" | "title" | "start" | "end"> &
    Partial<Pick<CalendarEvent, "address" | "notes">>
): Promise<CalendarEvent> {
  await requireSubsystem("calendar");
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
