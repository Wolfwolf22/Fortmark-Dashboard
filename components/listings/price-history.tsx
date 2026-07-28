"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaBadge } from "@/components/ui/delta-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PriceEvent } from "@/lib/data/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PRICE_EVENT_LABELS } from "./listing-meta";

/**
 * Chronological price events for a listing, with each entry's change versus
 * the previous price shown as a monochrome delta badge.
 */
export function PriceHistory({ events }: { events: PriceEvent[] }) {
  const ordered = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price history</CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No price events recorded for this listing yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((event, i) => {
                const prev = i > 0 ? ordered[i - 1] : undefined;
                const delta =
                  prev && prev.price > 0
                    ? ((event.price - prev.price) / prev.price) * 100
                    : undefined;
                return (
                  <TableRow
                    key={`${event.date}-${event.kind}`}
                    className="hover:bg-transparent"
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular">
                      {formatDate(event.date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-semibold">
                      {PRICE_EVENT_LABELS[event.kind]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular">
                      {formatCurrency(event.price)}
                    </TableCell>
                    <TableCell className="text-right">
                      {delta !== undefined ? (
                        <DeltaBadge value={delta} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
