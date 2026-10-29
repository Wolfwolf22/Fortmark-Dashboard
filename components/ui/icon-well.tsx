import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Decorative icon surface. Keep the glyph opaque and the effect small. */
export function IconWell({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("fm-icon-glass inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", className)}>
      <Icon className="relative h-4 w-4" strokeWidth={1.65} />
    </span>
  );
}
