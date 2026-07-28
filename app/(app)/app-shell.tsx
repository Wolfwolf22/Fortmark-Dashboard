"use client";

import * as React from "react";
import { NavRail } from "@/components/layout/nav-rail";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

/**
 * The interactive app shell. Split out of `layout.tsx` so the layout itself can
 * be a SERVER component and enforce authentication before any of this renders.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const railPinnedStored = useUiStore((s) => s.railPinned);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const railPinned = mounted && railPinnedStored;

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
