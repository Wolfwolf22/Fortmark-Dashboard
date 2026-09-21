import "server-only";

/**
 * The one action a model may prepare: scheduling a contact follow-up.
 *
 * It changes exactly one nullable column, `contacts.next_follow_up_at`, and
 * nothing else. That narrowness is the point of choosing it first — a mistake
 * is undone by setting another date, nothing leaves FortMark, and there is no
 * lifecycle machine to corrupt — so the first run of the confirmation pipeline
 * tests the plumbing rather than the domain.
 *
 * What this module owns: what the action depends on, what a human is shown,
 * and what counts as a valid date. What it does NOT own: whether the caller
 * may do it (the actor and `visibleTo` decide that), or when it happens (only
 * a confirmed execution does).
 */
import { createHash } from "node:crypto";
import { OPEN_PIPELINE_STAGES } from "../../contacts/stages.ts";
import type { ContactRow } from "../../db/schema.ts";
import type { ActionChange } from "./contract.ts";

export const FOLLOWUP_ACTION_TYPE = "contact_followup_schedule";

/** How far ahead a follow-up may be scheduled. Two years is generous. */
export const MAX_FOLLOWUP_DAYS = 730;

/**
 * The instant a `YYYY-MM-DD` follow-up is stored at.
 *
 * Midday UTC, deliberately. The application already reasons in UTC day keys
 * (`dayKey`, `endOfToday` in the metrics modules), and midday is the same
 * calendar day in every US timezone — so a date a person picked never slides
 * onto the day before or after when it is read back. This introduces no new
 * timezone system; it picks the least surprising point inside the one that
 * already exists.
 */
export function followUpInstant(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/** `YYYY-MM-DD` for a stored instant, in the same UTC convention. */
export function followUpDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** "Friday, 25 September 2026" — what a human confirms, never "next Friday". */
export function formatFollowUpDay(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export type DateRejection = "unparseable" | "in_the_past" | "too_far_ahead";

export type DateCheck =
  | { ok: true; day: string }
  | { ok: false; reason: DateRejection };

/**
 * Validate a requested follow-up day.
 *
 * A past date is REJECTED rather than normalised forward. The model may have
 * read "next Friday" against the wrong week, and quietly moving it would hand
 * the user a confirmation card whose date nobody chose — the one thing an
 * authoritative preview exists to prevent. Saying no is recoverable; a silent
 * correction is not.
 */
export function checkFollowUpDay(day: string, now: Date): DateCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, reason: "unparseable" };
  const at = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "unparseable" };
  // Round-trip guard: "2026-02-31" parses in some engines and is not a date.
  if (at.toISOString().slice(0, 10) !== day) return { ok: false, reason: "unparseable" };

  const today = now.toISOString().slice(0, 10);
  if (day < today) return { ok: false, reason: "in_the_past" };

  const horizon = new Date(now.getTime() + MAX_FOLLOWUP_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (day > horizon) return { ok: false, reason: "too_far_ahead" };

  return { ok: true, day };
}

/**
 * The fields this action depends on, hashed.
 *
 * Only three: which contact, the value being replaced, and the stage — because
 * the stage decides whether the follow-up will ever surface, which the preview
 * warns about. A colleague editing a phone number or a note between
 * preparation and confirmation must not invalidate the action; a colleague
 * changing the follow-up date must.
 */
export function followUpFingerprint(row: Pick<ContactRow, "id" | "nextFollowUpAt" | "stage">): string {
  const material = JSON.stringify({
    id: row.id,
    nextFollowUpAt: row.nextFollowUpAt ? row.nextFollowUpAt.toISOString() : null,
    stage: row.stage,
  });
  return createHash("sha256").update(material).digest("hex");
}

/** How a contact is named on the card. Preferred name wins, as elsewhere. */
export function contactDisplayName(row: ContactRow): string {
  const preferred = row.preferredName?.trim();
  if (preferred) return preferred;
  const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return full || "Unnamed contact";
}

/**
 * The diff, built by the server from the stored row.
 *
 * "No follow-up scheduled" is spelled out rather than left blank: a card whose
 * "current" cell is empty reads as a rendering fault, not as a fact.
 */
export function followUpChange(row: ContactRow, day: string): ActionChange {
  return {
    field: "nextFollowUpAt",
    label: "Follow-up",
    from: row.nextFollowUpAt ? formatFollowUpDay(followUpDay(row.nextFollowUpAt)) : null,
    to: formatFollowUpDay(day),
  };
}

/**
 * What the user should know before confirming.
 *
 * The app permits a follow-up on any contact — `logActivity` sets the column
 * whatever the stage — so preparation does NOT invent a second eligibility
 * rule and refuse. But `contactAttention` only chases the open pipeline, so on
 * a lost or closed contact the date would be set and never surfaced. That is
 * worth saying out loud rather than enforcing silently in either direction.
 */
export function followUpWarnings(row: ContactRow): string[] {
  const open = (OPEN_PIPELINE_STAGES as readonly string[]).includes(row.stage);
  if (open) return [];
  return [
    `This contact's stage is "${row.stage}", so the follow-up will be saved but will not appear in your follow-ups due.`,
  ];
}
