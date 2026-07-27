import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Quiet empty state: says what's empty and what to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-12 text-center",
        className
      )}
    >
      {Icon && <Icon className="mb-1 h-6 w-6 text-muted-foreground" aria-hidden />}
      <p className="text-sm font-semibold">{title}</p>
      {description && (
        <p className="max-w-xs text-[13px] text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
