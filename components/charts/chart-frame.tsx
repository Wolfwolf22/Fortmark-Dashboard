"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";

/**
 * Shared Recharts wrapper: fixed height, responsive width, and the
 * monochrome defaults documented in docs/DESIGN-SYSTEM.md. Chart series use
 * the chart tokens only — black active, grays for the rest.
 */
export function ChartFrame({
  height = 220,
  children,
  className,
}: {
  height?: number;
  children: React.ReactElement;
  className?: string;
}) {
  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Monochrome tooltip container for Recharts `content` props. */
export function ChartTooltipFrame({
  label,
  rows,
}: {
  label?: React.ReactNode;
  rows: { name: string; value: React.ReactNode }[];
}) {
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      {label && <p className="mb-1 font-bold">{label}</p>}
      {rows.map((row) => (
        <p key={row.name} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>{row.name}</span>
          <span className="font-semibold tabular text-foreground">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Read a chart CSS variable as an hsl() color for Recharts props. */
export function chartColor(
  token: "active" | "2" | "3" | "4" | "5" | "grid"
): string {
  return `hsl(var(--chart-${token === "active" ? "active" : token}))`;
}
