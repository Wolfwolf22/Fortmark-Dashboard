/**
 * A contact's birthday — a month and a day, and never a year.
 *
 * The year is not needed to remember a birthday, would invite an age
 * calculation nobody asked for, and is exactly the kind of personal detail
 * this product should not collect by accident. February 29 is valid because
 * the year is unknown. The database enforces the same rule
 * (`contacts_birthday_check`); this is the copy that gives a person a readable
 * refusal before the request is sent.
 *
 * Pure and isomorphic: the form, the route and the tests use one definition.
 */
import { z } from "zod";

export interface Birthday {
  month: number;
  day: number;
}

/** Days in each month with February at 29, since no year is known. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function isValidBirthday(month: unknown, day: unknown): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  const m = month as number;
  const d = day as number;
  return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1];
}

export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** What a request may say: a real month and day, or `null` to clear. Strict — no year. */
export const birthdaySchema = z
  .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
  .strict()
  .refine((b) => isValidBirthday(b.month, b.day), { message: "not a real calendar day", path: ["day"] });

/** "March 17". `null` for nothing stored — the screen says "Not set", never "Unknown". */
export function formatBirthday(birthday: Birthday | null | undefined): string | null {
  if (!birthday || !isValidBirthday(birthday.month, birthday.day)) return null;
  return `${MONTH_NAMES[birthday.month - 1]} ${birthday.day}`;
}

/** How a change reads in history, without saying what the date is. */
export function birthdayChangeState(
  before: Birthday | null,
  after: Birthday | null
): "set" | "changed" | "cleared" | "unchanged" {
  if (!before && !after) return "unchanged";
  if (!before) return "set";
  if (!after) return "cleared";
  return before.month === after.month && before.day === after.day ? "unchanged" : "changed";
}
