/**
 * Small shared bits for the leads feature — labels used by the workspace, the
 * table and the drawer. Follow-up logic lives in `lib/contacts/follow-up.ts`,
 * next to the rule Home uses; the filters live in `lib/contacts/filters.ts`.
 */
import { useEffect, useState } from "react";
import { Lead } from "@/lib/data/types";

export const INTENT_LABELS: Record<Lead["intent"], string> = {
  buy: "Buying",
  sell: "Selling",
  both: "Buying & selling",
  lease: "Leasing",
  invest: "Investing",
  // `other` is what the domain says when it has no open need to summarise. It
  // is not a stated intent, so the screen does not present it as one.
  other: "Not stated",
};

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/**
 * What the signed-in role is offered. The server decides what is permitted —
 * these only decide what is worth showing, so a member is not handed controls
 * that can only answer "forbidden".
 */
export function leadAbilities(role: string): { canWrite: boolean; sees: "own" | "brokerage" } {
  // Only an admin sees the whole brokerage's contacts. A broker or coordinator
  // has a personal book here, whatever they may see in Transactions.
  return { canWrite: role !== "Member", sees: role === "Admin" ? "brokerage" : "own" };
}

/** True once the viewport is at least `px` wide. False until measured, then live. */
export function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [px]);
  return wide;
}
