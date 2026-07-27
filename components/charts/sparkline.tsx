"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { PeriodPoint } from "@/lib/data/types";
import { chartColor } from "./chart-frame";

/** Minimal monochrome sparkline for stat tiles. Decorative — data is stated in the tile. */
export function Sparkline({
  points,
  height = 44,
}: {
  points: PeriodPoint[];
  height?: number;
}) {
  return (
    <div style={{ width: "100%", height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColor("active")} stopOpacity={0.12} />
              <stop offset="100%" stopColor={chartColor("active")} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={chartColor("active")}
            strokeWidth={2}
            fill="url(#spark-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
