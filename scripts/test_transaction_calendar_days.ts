/** Transaction deadline days stay stable across New York midnight and DST. */
import assert from "node:assert/strict";
import { calendarDayDistance, calendarDayIso, calendarDayKey, daysUntilTransactionDay, formatTransactionDay, isValidCalendarDay, transactionDay, transactionDeadlineState } from "../lib/transactions/calendar-days.ts";
import { closeDateFromInput } from "../lib/transactions/close-date.ts";
let checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; }
for (const value of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01", "2026-11-00", "2026-1-01", "not-a-date"]) check("impossible entered dates are refused", !isValidCalendarDay(value) && !closeDateFromInput(value));
check("leap day is a real entered date", isValidCalendarDay("2028-02-29") && calendarDayIso("2028-02-29") === "2028-02-29T12:00:00.000Z");
const late = new Date("2026-11-03T04:30:00.000Z"), midnight = new Date("2026-11-03T05:00:00.000Z");
check("the New York evening remains on the current day", calendarDayKey(late) === "2026-11-02");
check("midnight starts the next New York day", calendarDayKey(midnight) === "2026-11-03");
check("today is not overdue during its last half hour", transactionDeadlineState("2026-11-02", null, late) === "upcoming");
check("the same deadline becomes overdue after local midnight", transactionDeadlineState("2026-11-02", null, midnight) === "overdue");
check("recorded completion remains done", transactionDeadlineState("2026-11-02", late, midnight) === "done");
check("due today has a zero calendar countdown", daysUntilTransactionDay("2026-11-02", late) === 0);
check("a next-day deadline remains one day away in the evening", daysUntilTransactionDay("2026-11-03", late) === 1);
check("spring daylight-saving change counts calendar days rather than 24-hour blocks", calendarDayDistance("2026-03-09", "2026-03-07") === 2 && daysUntilTransactionDay("2026-03-09", new Date("2026-03-08T04:45:00Z")) === 2);
check("fall daylight-saving change counts calendar days rather than 25-hour blocks", daysUntilTransactionDay("2026-11-02", new Date("2026-11-01T03:45:00Z")) === 2);
check("calendar-only strings do not become a previous-day instant", transactionDay("2026-11-07") === "2026-11-07" && formatTransactionDay("2026-11-07") === "Nov 7, 2026");
check("compatibility date projection displays the same entered day", formatTransactionDay(calendarDayIso("2026-11-07"), true) === "Nov 7");
check("invalid or absent dates remain unknown", transactionDay("bad") === null && formatTransactionDay(null) === "—" && daysUntilTransactionDay(undefined) === null);
check("closing input preserves only a real entered date", closeDateFromInput("") === undefined && closeDateFromInput(" 2026-11-07 ") === "2026-11-07T12:00:00.000Z");
console.log(`${checks}/${checks} transaction calendar day checks passed`);
