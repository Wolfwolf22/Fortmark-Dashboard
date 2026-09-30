/**
 * How a note's time reads: "Sep 30, 2026 · 10:42 AM".
 *
 * The stored value is a normal timestamp; this is only presentation, in the
 * business timezone FortMark already uses for "today" and "due" (US Eastern), so
 * a note written at 11 PM in Miami is not shown under the next day for someone
 * whose browser is elsewhere. Built from parts rather than a locale string so
 * the middle dot and the AM/PM are the same on every machine.
 *
 * Pure and isomorphic.
 */
const BUSINESS_TIMEZONE = "America/New_York";

export function formatNoteStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return `${parts.month} ${parts.day}, ${parts.year} · ${parts.hour}:${parts.minute} ${(parts.dayPeriod ?? "").toUpperCase()}`;
}
