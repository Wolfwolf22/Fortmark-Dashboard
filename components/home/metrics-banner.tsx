"use client";

/**
 * The line that says where Home's numbers came from.
 *
 * It is small and quiet, and it is not optional. Two facts sit in the payload
 * precisely so the screen can state them rather than leave them to be assumed:
 * whose business these figures describe, and whether they are real.
 *
 * The sample case is the reason this exists. A generated brokerage is
 * convincing — that is what makes it useful for a demonstration and dangerous
 * everywhere else — so when Home is showing one it says so, on the page, above
 * the numbers, every time.
 */
import { FlaskConical } from "lucide-react";
import { useHomeMetrics } from "./metrics-provider";
import { monthLabel, scopeLabel } from "./metric-format";

export function HomeMetricsBanner() {
  const { metrics } = useHomeMetrics();
  if (!metrics) return null;

  if (metrics.source === "sample") {
    return (
      <p
        role="status"
        className="mb-5 flex items-center gap-2 rounded-panel bg-tint px-3 py-2 text-[13px] text-muted-foreground"
      >
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold text-foreground">Sample dashboard.</span> These figures are
          generated for demonstration and describe no real business.
        </span>
      </p>
    );
  }

  return (
    <p className="text-micro mb-5">
      {scopeLabel(metrics.scope)} · monthly figures cover {monthLabel(metrics.monthStart)}
    </p>
  );
}
