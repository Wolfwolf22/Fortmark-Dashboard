"use client";

import { NavRail } from "@/components/layout/nav-rail";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const railPinned = useUiStore((s) => s.railPinned);

  return (
    <div className="min-h-screen">
      <NavRail />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200",
          railPinned ? "pl-60" : "pl-16"
        )}
      >
        <TopBar />
        <main className="flex min-h-0 flex-1 flex-col p-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
