import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-tint px-1.5 text-[10px] font-semibold text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
