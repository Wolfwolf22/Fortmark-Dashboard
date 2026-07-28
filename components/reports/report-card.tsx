import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared shell for the Reports cards: title + period sublabel on the left,
 * actions (export, view toggles) on the right, content below.
 */
export function ReportCard({
  title,
  sublabel,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  /** Period sublabel, e.g. "This month". */
  sublabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold leading-tight">{title}</h2>
          {sublabel && <p className="text-micro mt-0.5">{sublabel}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      <div className={cn("min-h-0 flex-1 px-6 pb-6", contentClassName)}>
        {children}
      </div>
    </Card>
  );
}
