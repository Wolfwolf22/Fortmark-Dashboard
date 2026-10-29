import type { LucideIcon } from "lucide-react";
import { IconWell } from "@/components/ui/icon-well";

/** Visual section identity; the shell supplies the route's accessible h1. */
export function PageIntro({ title, description, icon: Icon }: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-start gap-3.5 border-b border-border pb-5 sm:items-center">
      <IconWell icon={Icon} className="mt-1 h-10 w-10 rounded-panel sm:mt-0" />
      <div className="min-w-0">
        <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.035em] sm:text-[30px]">{title}</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
