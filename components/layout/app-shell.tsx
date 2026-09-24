"use client";

/**
 * The client half of the dashboard shell: top bar, route-content transition
 * and the command palette. Split out of `app/(app)/layout.tsx` so that layout
 * can be an async server component and enforce authentication before any of
 * this renders.
 *
 * The layout is reused across client navigations, so the top bar — logo,
 * search, account, and the profile photo it already fetched — persists; only
 * the page inside `<PageTransition>` changes.
 */
import * as React from "react";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette } from "@/components/layout/command-palette";
import { PageTransition } from "@/components/layout/page-transition";
import { SessionUserProvider } from "@/components/layout/session-user";
import type { PublicSessionUser } from "@/lib/auth/session";
import type { ShellProfile } from "@/lib/profile/display";

export function AppShell({
  user,
  profile,
  children,
}: {
  user: PublicSessionUser;
  profile: ShellProfile;
  children: React.ReactNode;
}) {
  return (
    <SessionUserProvider user={user}>
      <div className="flex min-h-screen flex-col">
        <TopBar profile={profile} />
        {/* Wide but bounded: dense at 1440, never stretched on ultrawide. */}
        <main className="mx-auto flex min-h-0 w-full max-w-[1520px] flex-1 flex-col px-4 py-5 md:px-6 md:py-6">
          <PageTransition>{children}</PageTransition>
        </main>
        <CommandPalette />
      </div>
    </SessionUserProvider>
  );
}
