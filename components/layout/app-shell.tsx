"use client";

/**
 * The client half of the dashboard shell: nav rail, top bar, command palette
 * and the Zustand-backed rail state. Split out of `app/(app)/layout.tsx` so
 * that layout can be an async server component and enforce authentication
 * before any of this renders.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { NavRail } from "@/components/layout/nav-rail";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { SessionUserProvider } from "@/components/layout/session-user";
import { SampleNotice } from "@/components/data/sample-data";
import { domainForPath } from "@/lib/data/provenance";
import { useUiStore } from "@/lib/stores/ui";
import type { PublicSessionUser } from "@/lib/auth/session";
import type { ShellProfile } from "@/lib/profile/display";
import { cn } from "@/lib/utils";

export function AppShell({
  user,
  profile,
  children,
}: {
  user: PublicSessionUser;
  profile: ShellProfile;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // One placement covers every route: the page title lives in the top bar, so
  // this sits directly beneath it. Home and Settings deliberately return null
  // — they mix real and sample data, so their sample parts are labelled
  // individually rather than by a page-wide claim that would be false on the
  // real half.
  const sampleDomain = domainForPath(pathname);
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
          <TopBar profile={profile} />
          <main className="flex min-h-0 flex-1 flex-col p-6">
            {sampleDomain && (
              <SampleNotice domain={sampleDomain} className="mb-4 shrink-0" />
            )}
            {children}
          </main>
        </div>
        <CommandPalette />
      </div>
    </SessionUserProvider>
  );
}
