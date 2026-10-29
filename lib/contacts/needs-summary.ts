/** The same source-precedence and kind vocabulary used by list SQL and DTOs. */
import type { ContactNeedRow, ContactOpportunityRow } from "../db/schema.ts";
import type { LeadIntent } from "../data/types.ts";

export const STRUCTURED_INTENT_KINDS = {
  buying: ["buy"],
  selling: ["sell"],
  leasing: ["rent", "lease"],
} as const;
export const LEGACY_INTENT_KINDS = {
  buying: ["buyer", "commercial_buyer"],
  selling: ["seller", "commercial_seller"],
  leasing: ["tenant", "landlord", "commercial_tenant", "commercial_landlord"],
  investing: ["investor"],
} as const;

type SummaryNeed = Pick<ContactNeedRow, "id" | "kind" | "status" | "areas" | "priceMaxCents" | "createdAt" | "updatedAt">;

/** Priority matches the existing single-intent table vocabulary. */
export function classifyIntent(flags: { buying: boolean; selling: boolean; leasing: boolean; investing?: boolean }): LeadIntent {
  if (flags.buying && flags.selling) return "both";
  if (flags.buying) return "buy";
  if (flags.selling) return "sell";
  if (flags.leasing) return "lease";
  if (flags.investing) return "invest";
  return "other";
}

export interface ContactNeedSummary {
  intent: LeadIntent;
  /** Upper budget of the most recently updated active need; never a forecast. */
  budgetMaxCents?: number;
  /** Distinct areas on active needs. No requirements/free text leave this projection. */
  areas: string[];
}

/**
 * Once any structured need exists, that store is authoritative, even if every
 * need is paused or fulfilled. Falling back then would resurrect old intent.
 * Legacy open opportunities remain usable only before a contact adopts needs.
 */
export function projectContactNeedSummary(
  needs: readonly SummaryNeed[],
  opportunities: readonly ContactOpportunityRow[]
): ContactNeedSummary {
  if (needs.length > 0) {
    const active = needs.filter((n) => n.status === "active").sort((a, b) =>
      b.updatedAt.getTime() - a.updatedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
    );
    const kinds = new Set(active.map((n) => n.kind));
    const has = (values: readonly string[]) => values.some((value) => kinds.has(value as SummaryNeed["kind"]));
    const seen = new Set<string>();
    const areas: string[] = [];
    for (const need of active) for (const raw of need.areas) {
      const area = raw.trim();
      if (!area || seen.has(area.toLowerCase())) continue;
      seen.add(area.toLowerCase());
      areas.push(area);
    }
    return {
      intent: classifyIntent({ buying: has(STRUCTURED_INTENT_KINDS.buying), selling: has(STRUCTURED_INTENT_KINDS.selling), leasing: has(STRUCTURED_INTENT_KINDS.leasing) }),
      budgetMaxCents: active[0]?.priceMaxCents ?? undefined,
      areas,
    };
  }

  const open = opportunities.filter((o) => o.status === "open").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const kinds = new Set(open.map((o) => o.kind));
  const has = (values: readonly string[]) => values.some((value) => kinds.has(value as ContactOpportunityRow["kind"]));
  return {
    intent: classifyIntent({ buying: has(LEGACY_INTENT_KINDS.buying), selling: has(LEGACY_INTENT_KINDS.selling), leasing: has(LEGACY_INTENT_KINDS.leasing), investing: has(LEGACY_INTENT_KINDS.investing) }),
    budgetMaxCents: open[0]?.budgetMaxCents ?? undefined,
    areas: Array.from(new Map(open.flatMap((o) => o.area?.trim() ? [[o.area.trim().toLowerCase(), o.area.trim()] as const] : [])).values()),
  };
}
