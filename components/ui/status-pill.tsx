import { cn } from "@/lib/utils";
import { StatusTone } from "@/lib/data/types";

/**
 * The one place semantic color is allowed: desaturated status pills, never
 * larger than a badge, always carrying a text label.
 */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4",
        tone === "good" && "bg-status-good-bg text-status-good",
        tone === "warn" && "bg-status-warn-bg text-status-warn",
        tone === "bad" && "bg-status-bad-bg text-status-bad",
        tone === "neutral" && "bg-tint text-muted-foreground",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "good" && "bg-status-good",
          tone === "warn" && "bg-status-warn",
          tone === "bad" && "bg-status-bad",
          tone === "neutral" && "bg-muted-foreground"
        )}
      />
      {children}
    </span>
  );
}

/** Map a listing status to pill tone + label. */
export const LISTING_STATUS_PILL: Record<
  string,
  { tone: StatusTone; label: string }
> = {
  active: { tone: "good", label: "Active" },
  pending: { tone: "warn", label: "Pending" },
  underContract: { tone: "warn", label: "Under contract" },
  closed: { tone: "neutral", label: "Closed" },
  expired: { tone: "bad", label: "Expired" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
};
