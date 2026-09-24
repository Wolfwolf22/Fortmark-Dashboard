/**
 * The quick-create form's closing date, as the adapter receives it.
 *
 * Blank stays blank. The form used to invent a date 45 days out, which the
 * service then turned into a real "Closing" deadline nobody had agreed to.
 * An entered `YYYY-MM-DD` day is kept exactly, stored at noon UTC so the
 * calendar day never shifts across time zones.
 *
 * Pure and dependency-free: safe in the client bundle and in tests.
 */
export function closeDateFromInput(raw: string | null | undefined): string | undefined {
  const day = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return `${day}T12:00:00.000Z`;
}
