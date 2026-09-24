/**
 * The Home hero's words, as pure functions.
 *
 * Kept free of imports so the plain-Node test harness can load it without the
 * `@/` alias or React.
 */

/**
 * The greeting, exactly as the hero prints it. A resolved first name gives
 * "Welcome, Daniel"; anything else gives a plain "Welcome" — never
 * "Welcome, undefined" and never an email.
 */
export function greetingParts(name: string | null | undefined): { lead: string; name: string | null } {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean || clean.includes("@")) return { lead: "Welcome", name: null };
  return { lead: "Welcome,", name: clean };
}

/** Plain-language due phrase for an attention row. */
export function dueText(daysAway: number): string {
  if (daysAway < -1) return `${Math.abs(daysAway)} days overdue`;
  if (daysAway === -1) return "1 day overdue";
  if (daysAway === 0) return "Due today";
  if (daysAway === 1) return "Due tomorrow";
  return `Due in ${daysAway} days`;
}
