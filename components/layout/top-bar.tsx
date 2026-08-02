"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { pageTitleFor } from "./nav-items";
import { DateRangeSelector } from "./date-range-selector";
import { NewMenu } from "./new-menu";
import { ThemeToggle } from "./theme-toggle";
import { Kbd } from "@/components/ui/kbd";
import { ProfileIdentity } from "@/components/profile/profile-identity";
import type { ShellProfile } from "@/lib/profile/display";
import { useUiStore } from "@/lib/stores/ui";

export function TopBar({ profile }: { profile: ShellProfile }) {
  const pathname = usePathname();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const title = pageTitleFor(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-6 backdrop-blur-sm">
      <h1 className="text-display min-w-0 flex-1 truncate text-xl md:text-2xl">
        {title}
      </h1>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground md:flex lg:w-64"
        aria-label="Search (Command K)"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground transition-colors hover:text-foreground md:hidden"
        aria-label="Search"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>

      <NewMenu />
      <div className="hidden md:block">
        <DateRangeSelector />
      </div>
      <ThemeToggle />

      {/* Identity sits last so it reads as the account corner of the bar. */}
      <div className="ml-1 flex items-center border-l border-border pl-2">
        <ProfileIdentity display={profile.display} editable={profile.editable} />
      </div>
    </header>
  );
}
