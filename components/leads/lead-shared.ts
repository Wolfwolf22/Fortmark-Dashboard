/**
 * Small shared bits for the leads feature — labels used by the summary
 * strip, the table, and the drawer. Follow-up logic lives in
 * `lib/contacts/follow-up.ts`, next to the rule Home uses.
 */
import { Lead } from "@/lib/data/types";

export const INTENT_LABELS: Record<Lead["intent"], string> = {
  buy: "Buying",
  sell: "Selling",
  both: "Buying and selling",
  lease: "Leasing",
  invest: "Investing",
  other: "Other",
};

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}
