/**
 * Global search adapter (⌘K). Mock-backed today; swap the body for the
 * search service and the palette is untouched.
 */
import { SearchResult } from "../types";
import { clients, leads, listings, transactions } from "../mock/db";
import { formatCurrencyCompact } from "@/lib/utils";
import { delay } from "./latency";

export async function searchAll(query: string): Promise<SearchResult[]> {
  await delay(120);
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const listingHits: SearchResult[] = listings
    .filter(
      (l) =>
        l.address.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.neighborhood.toLowerCase().includes(q) ||
        l.mlsNumber.toLowerCase().includes(q)
    )
    .slice(0, 6)
    .map((l) => ({
      id: `search-${l.id}`,
      kind: "listing" as const,
      title: l.address,
      subtitle: `${l.city} · ${formatCurrencyCompact(l.listPrice)} · MLS ${l.mlsNumber}`,
      href: `/listings/${l.id}`,
    }));

  const txnHits: SearchResult[] = transactions
    .filter(
      (t) =>
        t.address.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q)
    )
    .slice(0, 6)
    .map((t) => ({
      id: `search-${t.id}`,
      kind: "transaction" as const,
      title: t.address,
      subtitle: `${t.clientName} · ${formatCurrencyCompact(t.contractPrice)} · ${t.statusLabel}`,
      href: `/transactions?open=${t.id}`,
    }));

  const contactHits: SearchResult[] = [
    ...clients
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((c) => ({
        id: `search-${c.id}`,
        kind: "contact" as const,
        title: c.name,
        subtitle: `Client · ${c.email}`,
        href: `/messages`,
      })),
    ...leads
      .filter((l) => l.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((l) => ({
        id: `search-${l.id}`,
        kind: "contact" as const,
        title: l.name,
        subtitle: `Lead · ${l.email}`,
        href: `/leads?open=${l.id}`,
      })),
  ];

  return [...listingHits, ...txnHits, ...contactHits];
}
