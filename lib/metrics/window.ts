/**
 * The time windows every metric is measured against.
 *
 * Deliberately UTC and deliberately explicit. `closing_date`, `closed_date`
 * and `due_date` are `date` columns — a day, with no zone — so the only
 * timezone decision in the whole metrics layer is which day the server calls
 * "today". Making that decision here, once, in UTC, keeps the answer
 * deterministic: the same instant always produces the same month, and the
 * payload reports the `monthStart` it used so the screen can name its window
 * rather than implying one.
 *
 * Pure and dependency-free, so tests can pin `now` and assert boundaries.
 */

/** `YYYY-MM-DD` for the UTC day containing this instant. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface MonthWindow {
  /** `YYYY-MM-01` */
  start: string;
  /** Last day of the month, `YYYY-MM-DD`. Inclusive. */
  end: string;
}

export function monthWindow(at: Date): MonthWindow {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  // Day 0 of the next month is the last day of this one — no 28/30/31 table,
  // and leap years take care of themselves.
  const end = new Date(Date.UTC(y, m + 1, 0));
  return { start: dayKey(start), end: dayKey(end) };
}

/** The first day of the month `count - 1` months before this one, inclusive. */
export function monthsBackStart(at: Date, count: number): string {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - (count - 1), 1));
  return dayKey(start);
}

/** The `YYYY-MM-01` bucket a `YYYY-MM-DD` day belongs to. */
export function monthBucket(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Every month bucket from `start` to the month of `at`, oldest first. */
export function monthSeries(at: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(dayKey(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - i, 1))));
  }
  return out;
}

/**
 * Whole days from today to a `YYYY-MM-DD` day. Negative when overdue, 0 when
 * it is due today. Both sides are reduced to a UTC midnight first, so the
 * answer is a count of days and never an artefact of the hour of the run.
 */
export function daysUntil(day: string, at: Date): number {
  const due = Date.parse(`${day}T00:00:00.000Z`);
  const today = Date.parse(`${dayKey(at)}T00:00:00.000Z`);
  return Math.round((due - today) / 86_400_000);
}

/** A Postgres `numeric`/`bigint` comes back as a string. Make it a number. */
export function toInt(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
