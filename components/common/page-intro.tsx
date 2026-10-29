import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconWell } from "@/components/ui/icon-well";

/** Visual section identity; the shell supplies the route's accessible h1. */
export function PageIntro({ title, description, icon: Icon, action }: {
  title: string;
  description: string;
  icon: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5 sm:items-center">
      <div className="flex min-w-0 flex-1 basis-full items-start gap-3.5 sm:basis-0 sm:items-center">
        <IconWell icon={Icon} className="mt-1 h-10 w-10 rounded-panel sm:mt-0" />
        <div className="min-w-0">
          <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.035em] sm:text-[30px]">{title}</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
