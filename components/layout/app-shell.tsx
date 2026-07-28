"use client";

/**
 * The client half of the dashboard shell: nav rail, top bar, command palette
 * and the Zustand-backed rail state. Split out of `app/(app)/layout.tsx` so
 * that layout can be an async server component and enforce authentication
 * before any of this renders.
 */
import * as React from "react";
import { NavRail } from "@/components/layout/nav-rail";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { SessionUserProvider } from "@/components/layout/session-user";
import { useUiStore } from "@/lib/stores/ui";
import type { PublicSessionUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export function AppShell({
  user,
  children,
}: {
  user: PublicSessionUser;
  children: React.ReactNode;
}) {
  const railPinnedStored = useUiStore((s) => s.railPinned);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const railPinned = mounted && railPinnedStored;

  return (
    <SessionUserProvider user={user}>
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
    </SessionUserProvider>
  );
}
