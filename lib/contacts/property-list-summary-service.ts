import "server-only";
import type { Ctx } from "./service.ts";
import type { PropertyMlsProvider, PropertyView } from "./properties.ts";
import { getPropertyListProperties } from "./properties-service.ts";
import { loadPropertyList } from "./property-lists-service.ts";
import { summarizePropertyList, type PropertyListSummary } from "./property-list-summary.ts";
import type { PropertyServiceResult } from "./properties-service.ts";
/** Bounded fresh-feed inspection; the UI discloses partial coverage for lists above 96 properties. */
export async function getPropertyListSummary(ctx: Ctx, id: string, provider: PropertyMlsProvider, now = new Date()): Promise<PropertyServiceResult<PropertyListSummary>> {
  const opening = await loadPropertyList(ctx, id); if (!opening.ok) return opening;
  const items: PropertyView[] = []; let total = 0;
  for (let page = 1; page <= 4; page++) { const result = await getPropertyListProperties(ctx, id, provider, { page, pageSize: 24 }, now); if (!result.ok) return result; total = result.value.total; items.push(...result.value.items); if (items.length >= total) break; }
  const current = await loadPropertyList(ctx, id); if (!current.ok) return current;
  if (opening.value.row.updatedAt.getTime() !== current.value.row.updatedAt.getTime()) return { ok: false, reason: "conflict" };
  return { ok: true, value: summarizePropertyList(items, total, now.toISOString()) };
}
