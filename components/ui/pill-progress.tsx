import { cn } from "@/lib/utils";

/**
 * The two-tone pill progress bar from the reference treatment: a black fill
 * segment on a gray track, fully rounded. Used for goal counters and
 * comparison bars.
 */
export function PillProgress({
  value,
  max,
  className,
  barClassName,
  label,
}: {
  value: number;
  max: number;
  className?: string;
  barClassName?: string;
  /** Accessible label describing what the bar measures. */
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-label={label}
      className={cn("h-3 w-full overflow-hidden rounded-full bg-track", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
          barClassName
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
