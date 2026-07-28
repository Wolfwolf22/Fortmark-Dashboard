/**
 * Small shared bits for the leads feature — labels and follow-up logic used
 * by the summary strip, the table, and the drawer.
 */
import { Lead } from "@/lib/data/types";

export const INTENT_LABELS: Record<Lead["intent"], string> = {
  buy: "Buying",
  sell: "Selling",
  both: "Both",
};

/** A lead untouched for longer than this needs a follow up. */
export const FOLLOW_UP_AFTER_DAYS = 14;

export function needsFollowUp(lastContactDate: string, now = new Date()): boolean {
  const days = (now.getTime() - new Date(lastContactDate).getTime()) / 86400000;
  return days > FOLLOW_UP_AFTER_DAYS;
}

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}
