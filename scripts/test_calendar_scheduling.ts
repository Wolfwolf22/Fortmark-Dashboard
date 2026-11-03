/** Real business-calendar arithmetic and conflict advisories; no DB, providers or browser clock assumptions. */
import assert from "node:assert/strict";
import { buildCalendarWarnings, calendarItemOccursOnDay, calendarLocalSchedule, calendarQueryWindow, itemsForDay, readCalendarQuery, sortCalendarItems } from "../lib/calendar/scheduling.ts";
import type { CalendarItem } from "../lib/calendar/domain.ts";

let checks = 0;
function check(name: string, condition: unknown): asserts condition { assert.ok(condition, name); checks++; }
function equal(name: string, actual: unknown, expected: unknown): void { assert.deepEqual(actual, expected, name); checks++; }
const showing = (id: string, startsAt: string, endsAt: string, extra: Partial<CalendarItem> = {}): CalendarItem => ({ id, kind: "showing", title: `Appointment ${id}`, subtitle: "Private source", day: "2026-11-02", allDay: false, startsAt, endsAt, status: "scheduled", sourceId: id, sourceHref: `/showings?showing=${id}`, sourceLabel: "Showing", blocksTime: true, reschedule: null, ...extra });
const a = showing("a", "2026-11-02T14:00:00Z", "2026-11-02T15:00:00Z");
const b = showing("b", "2026-11-02T15:00:00Z", "2026-11-02T16:00:00Z");

equal("ordinary day window uses New York rather than UTC midnight", calendarQueryWindow({ fromDay: "2026-11-02", toDay: "2026-11-03" }), { from: "2026-11-02T05:00:00.000Z", to: "2026-11-03T05:00:00.000Z" });
const spring = calendarQueryWindow({ fromDay: "2027-03-14", toDay: "2027-03-15" })!;
const fall = calendarQueryWindow({ fromDay: "2026-11-01", toDay: "2026-11-02" })!;
check("spring calendar day is exactly 23 hours", Date.parse(spring.to) - Date.parse(spring.from) === 23 * 3_600_000);
check("fall calendar day is exactly 25 hours", Date.parse(fall.to) - Date.parse(fall.from) === 25 * 3_600_000);
check("93 calendar days remain allowed even across a fall DST change", calendarQueryWindow({ fromDay: "2026-10-01", toDay: "2027-01-02" }) !== null);
for (const query of [{ fromDay: "2026-10-01", toDay: "2027-01-03" }, { fromDay: "2026-11-02", toDay: "2026-11-02" }, { fromDay: "2026-11-03", toDay: "2026-11-02" }, { fromDay: "2026-02-30", toDay: "2026-03-02" }, { fromDay: "2026-11-02T00:00:00Z", toDay: "2026-11-03" }]) check("invalid or overlong range is refused " + JSON.stringify(query), calendarQueryWindow(query) === null);
equal("query preserves an explicit source filter", readCalendarQuery(new URLSearchParams("fromDay=2026-11-02&toDay=2026-11-03&kinds=showing,next_action")), { fromDay: "2026-11-02", toDay: "2026-11-03", kinds: ["showing", "next_action"] });
equal("omitted sources means the unified source set", readCalendarQuery(new URLSearchParams("fromDay=2026-11-02&toDay=2026-11-03")), { fromDay: "2026-11-02", toDay: "2026-11-03" });
for (const suffix of ["&fromDay=2026-11-02", "&toDay=2026-11-03", "&unexpected=value", "&kinds=", "&kinds=showing,showing", "&kinds=showing,unknown", "&kinds=showing, next_action", "&kinds=showing&kinds=next_action"]) check("ambiguous or unsupported query is refused " + suffix, readCalendarQuery(new URLSearchParams("fromDay=2026-11-02&toDay=2026-11-03" + suffix)) === null);

equal("spring-forward gap is not silently shifted", calendarLocalSchedule("2027-03-14", "02:30"), { ok: false, reason: "nonexistent_time" });
equal("impossible calendar date is not normalized", calendarLocalSchedule("2026-02-30", "10:00"), { ok: false, reason: "invalid" });
equal("new repeated fall time chooses its earlier occurrence and declares ambiguity", calendarLocalSchedule("2026-11-01", "01:30"), { ok: true, startsAt: "2026-11-01T05:30:00.000Z", ambiguous: true, preservedExistingTime: false });
equal("unchanged later repeated instant remains on the later occurrence", calendarLocalSchedule("2026-11-01", "01:30", "2026-11-01T06:30:25.000Z"), { ok: true, startsAt: "2026-11-01T06:30:25.000Z", ambiguous: true, preservedExistingTime: true });
equal("changed repeated local time gets an intentional new earlier instant", calendarLocalSchedule("2026-11-01", "01:45", "2026-11-01T06:30:00.000Z"), { ok: true, startsAt: "2026-11-01T05:45:00.000Z", ambiguous: true, preservedExistingTime: false });
equal("invalid original source instant cannot throw or fabricate a preserved time", calendarLocalSchedule("2026-11-02", "10:00", "invalid"), { ok: true, startsAt: "2026-11-02T15:00:00.000Z", ambiguous: false, preservedExistingTime: false });

const overnight = showing("overnight", "2026-11-03T04:30:00Z", "2026-11-03T05:30:00Z");
check("an actual overnight interval occurs on both New York days", calendarItemOccursOnDay(overnight, "2026-11-02") && calendarItemOccursOnDay(overnight, "2026-11-03"));
const endsMidnight = { ...overnight, endsAt: "2026-11-03T05:00:00Z" };
check("exclusive midnight end never leaks into the next day", calendarItemOccursOnDay(endsMidnight, "2026-11-02") && !calendarItemOccursOnDay(endsMidnight, "2026-11-03"));
const startsMidnight = { ...overnight, startsAt: "2026-11-03T05:00:00Z" };
check("midnight start belongs only to the new day", !calendarItemOccursOnDay(startsMidnight, "2026-11-02") && calendarItemOccursOnDay(startsMidnight, "2026-11-03"));
const deadline: CalendarItem = { ...a, id: "deadline", kind: "transaction_deadline", allDay: true, blocksTime: false, startsAt: null, endsAt: null };
const task: CalendarItem = { ...a, id: "task", kind: "next_action", blocksTime: false, endsAt: null };
const tour: CalendarItem = { ...task, id: "tour", kind: "tour" };
check("date-only facts remain on their source date", calendarItemOccursOnDay(deadline, "2026-11-02") && !calendarItemOccursOnDay(deadline, "2026-11-01"));
check("a task point has no invented duration across a midnight boundary", calendarItemOccursOnDay({ ...task, startsAt: "2026-11-03T04:59:59Z" }, "2026-11-02") && !calendarItemOccursOnDay({ ...task, startsAt: "2026-11-03T04:59:59Z" }, "2026-11-03"));
for (const broken of [{ ...a, startsAt: "invalid" }, { ...a, endsAt: null }, { ...a, endsAt: a.startsAt }, { ...a, startsAt: "2026-02-30T10:00:00Z" }]) check("invalid stored intervals cannot become visible appointment time", !calendarItemOccursOnDay(broken, "2026-11-02") && buildCalendarWarnings([broken, a]).length === 0);
const mixed = [b, task, deadline, overnight, a], original = JSON.stringify(mixed);
equal("daily grouping places all-day facts first then actual instants with deterministic IDs", itemsForDay(mixed, "2026-11-02").map(item => item.id), ["deadline", "a", "task", "b", "overnight"]);
equal("global chronological sorting handles explicit offsets rather than lexical ISO ordering", sortCalendarItems([showing("later", "2026-11-02T10:00:00-05:00", "2026-11-02T11:00:00-05:00"), showing("earlier", "2026-11-02T14:30:00Z", "2026-11-02T14:45:00Z")]).map(item => item.id), ["earlier", "later"]);
equal("grouping never mutates source records", JSON.stringify(mixed), original);

const adjacent = buildCalendarWarnings([b, a]);
check("back-to-back appointments are a planning warning and never a timed overlap", adjacent.length === 1 && adjacent[0].kind === "planning_buffer" && adjacent[0].gapMinutes === 0);
check("planning-buffer wording makes no invented traffic or driving claim", adjacent[0].message.includes("15-minute planning buffer") && adjacent[0].message.includes("Driving time has not been calculated"));
equal("zero planning buffer permits an exact adjacent boundary", buildCalendarWarnings([a, b], { bufferMinutes: 0 }), []);
equal("exactly the chosen buffer leaves no short-gap warning", buildCalendarWarnings([a, { ...b, startsAt: "2026-11-02T15:15:00Z" }]), []);
check("one second below the explicit buffer remains a warning", buildCalendarWarnings([a, { ...b, startsAt: "2026-11-02T15:14:59Z" }])[0].kind === "planning_buffer");
const overlapping = showing("overlap", "2026-11-02T14:45:00Z", "2026-11-02T15:30:00Z");
check("actual overlap survives even when planning buffer is zero", buildCalendarWarnings([a, overlapping], { bufferMinutes: 0 })[0].kind === "overlap");
const nested = showing("nested", "2026-11-02T14:15:00Z", "2026-11-02T14:30:00Z");
const chain = buildCalendarWarnings([a, nested, overlapping, b], { bufferMinutes: 0 });
equal("overlap chains inspect every actual pair including a containing interval", chain.map(warning => warning.itemIds), [["a", "nested"], ["a", "overlap"], ["overlap", "b"]]);
equal("warning identities and order are stable regardless of input order", buildCalendarWarnings([b, overlapping, a]), buildCalendarWarnings([a, overlapping, b]));
equal("tasks, tour plans and all-day deadlines never block showing availability", buildCalendarWarnings([a, task, tour, deadline]), []);
equal("completed and cancelled visits never become current scheduling conflicts", buildCalendarWarnings([a, { ...overlapping, status: "completed" }, { ...nested, status: "cancelled" }]), []);
equal("a nonblocking showing never becomes an appointment warning", buildCalendarWarnings([a, { ...overlapping, blocksTime: false }]), []);
equal("duplicate rendering of one source never conflicts with itself", buildCalendarWarnings([a, a]), []);
const acrossMidnight = buildCalendarWarnings([overnight, showing("after-midnight", "2026-11-03T05:25:00Z", "2026-11-03T06:00:00Z")]);
check("overnight overlap is attributed to its actual New York conflict day", acrossMidnight.length === 1 && acrossMidnight[0].day === "2026-11-03" && acrossMidnight[0].kind === "overlap");
const bothFolds = [showing("early-fold", "2026-11-01T05:15:00Z", "2026-11-01T05:45:00Z"), showing("late-fold", "2026-11-01T06:15:00Z", "2026-11-01T06:45:00Z")];
check("identical-looking repeated local times remain separate actual instants", buildCalendarWarnings(bothFolds).length === 0 && itemsForDay(bothFolds, "2026-11-01").length === 2);
const personal: CalendarItem = { ...overlapping, id: "personal:private", kind: "personal", blocksTime: true };
check("a personal time block and showing produce an advisory overlap", buildCalendarWarnings([a, personal])[0].kind === "overlap");
check("personal-to-personal overlap remains advisory", buildCalendarWarnings([personal, { ...personal, id: "personal:second" }])[0].kind === "overlap");
check("a timed personal block participates in the explicit planning buffer", buildCalendarWarnings([a, { ...b, kind: "personal" }])[0].kind === "planning_buffer");
equal("personal nonblocking times do not claim availability", buildCalendarWarnings([a, { ...personal, blocksTime: false }]), []);
equal("all-day personal facts never block time even with an accidental blocking flag", buildCalendarWarnings([a, { ...personal, allDay: true, startsAt: null, endsAt: null }]), []);
check("personal intervals retain honest overnight day membership", calendarItemOccursOnDay({ ...overnight, kind: "personal" }, "2026-11-02") && calendarItemOccursOnDay({ ...overnight, kind: "personal" }, "2026-11-03"));
check("warnings do not mutate or reject the underlying personal appointment", personal.status === "scheduled" && personal.startsAt === overlapping.startsAt && buildCalendarWarnings([a, personal])[0].message.includes("appointments"));
for (const bufferMinutes of [-1, 61, 1.5, Number.NaN]) { assert.throws(() => buildCalendarWarnings([a, b], { bufferMinutes }), RangeError); checks++; }
const previousTz = process.env.TZ;
try {
  process.env.TZ = "Pacific/Honolulu";
  const hawaii = JSON.stringify({ items: itemsForDay(mixed, "2026-11-02"), window: calendarQueryWindow({ fromDay: "2026-11-01", toDay: "2026-11-02" }), warnings: buildCalendarWarnings([a, b]), local: calendarLocalSchedule("2026-11-01", "01:30") });
  process.env.TZ = "Asia/Tokyo";
  equal("server or viewer timezone cannot alter any scheduling result", JSON.stringify({ items: itemsForDay(mixed, "2026-11-02"), window: calendarQueryWindow({ fromDay: "2026-11-01", toDay: "2026-11-02" }), warnings: buildCalendarWarnings([a, b]), local: calendarLocalSchedule("2026-11-01", "01:30") }), hawaii);
} finally { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
console.log(`${checks}/${checks} calendar scheduling checks passed (pure domains, no external access)`);
