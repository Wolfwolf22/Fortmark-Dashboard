"use client";

import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Placeholder for the comps engine — no fake comps, just the direction. */
export function CompsStub() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparable sales</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={Scale}
          title="The FortMark comps engine connects here."
          description="Tiered comps (prime, market, broad) will populate from the MLS adapter."
        />
      </CardContent>
    </Card>
  );
}
