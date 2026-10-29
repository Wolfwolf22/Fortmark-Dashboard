import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconWell } from "@/components/ui/icon-well";

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
        "flex flex-col items-center justify-center gap-2 py-9 text-center",
        className
      )}
    >
      {Icon && <IconWell icon={Icon} className="mb-1.5" />}
      <p className="text-sm font-semibold">{title}</p>
      {description && (
        <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
