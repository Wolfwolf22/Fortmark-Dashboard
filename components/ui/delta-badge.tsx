import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Period-over-period delta. Monochrome by default; direction is carried by
 * the arrow icon and sign, not by color, per the chart rules.
 */
export function DeltaBadge({
  value,
  suffix = "%",
  className,
  invertGood = false,
}: {
  /** Signed percentage (e.g. 12.4 or -3.1). */
  value: number;
  suffix?: string;
  className?: string;
  /** When a decrease is the good direction (e.g. days on market). */
  invertGood?: boolean;
}) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold tabular",
        className
      )}
      aria-label={`${up ? "Up" : "Down"} ${Math.abs(value).toFixed(1)}${suffix} versus the prior period${invertGood ? " (lower is better)" : ""}`}
    >
      {up ? (
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      ) : (
        <ArrowDownRight className="h-3 w-3" aria-hidden />
      )}
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}
