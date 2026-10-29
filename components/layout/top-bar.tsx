"use client";

/**
 * The dashboard's top navigation — the whole shell chrome.
 *
 * It replaced the left rail. One row on desktop: the FortMark wordmark, the
 * sections as quiet text tabs, the unified search (which opens ⌘K —
 * there is no second search), then the real utilities: create, notifications,
 * settings, theme and the account.
 *
 * The bar is always black. It carries the `dark` token scope itself, so it
 * reads as the brand's black band in both themes and its controls use the
 * dark tokens without a second set of styles.
 *
 * Phones get a compact first row (mark, search, account) and the sections as a
 * horizontally scrolling strip beneath it — every section one tap away, no
 * hamburger, and the strip scrolls inside itself so the page never overflows.
 *
 * Sections come from `NAV_ITEMS` and nowhere else.
 */
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search, Settings } from "lucide-react";
import {
  NAV_ITEMS,
  PRIMARY_NAV,
  SECONDARY_NAV,
  isActivePath,
  type NavItem,
} from "./nav-items";
import { NewMenu } from "./new-menu";
import { NotificationsBell } from "./notifications-bell";
import { ThemeToggle } from "./theme-toggle";
import { useShellLinkClick } from "./page-transition";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileIdentity } from "@/components/profile/profile-identity";
import type { ShellProfile } from "@/lib/profile/display";
import { assetPath } from "@/lib/routes";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

/** Text navigation with one persistent marker for the current section. */
const TAB =
  "relative inline-flex h-11 shrink-0 items-center justify-center px-3 text-[13px] font-medium tracking-[-0.005em] transition-colors duration-150 ease-out";
const TAB_ACTIVE =
  "font-semibold text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-foreground";
const TAB_IDLE =
  "text-muted-foreground hover:text-foreground";

function NavTab({ item, pathname }: { item: NavItem; pathname: string }) {
  const onShellClick = useShellLinkClick();
  const active = isActivePath(item.href, pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={(e) => onShellClick(e, item.href)}
      className={cn(TAB, active ? TAB_ACTIVE : TAB_IDLE)}
    >
      {item.label}
    </Link>
  );
}

/**
 * The secondary sections, behind one control so the bar never wraps at
 * 1280px. When one of them is the current page the trigger takes its name and
 * the selected treatment, so the reader is never on a page the bar hides.
 */
function MoreMenu({ pathname }: { pathname: string }) {
  const onShellClick = useShellLinkClick();
  const current = SECONDARY_NAV.find((item) => isActivePath(item.href, pathname));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(TAB, "gap-1.5", current ? TAB_ACTIVE : TAB_IDLE)}
        aria-label={current ? `More sections (current: ${current.label})` : "More sections"}
      >
        {current ? current.label : "More"}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {SECONDARY_NAV.map((item) => {
          const active = isActivePath(item.href, pathname);
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={(e) => onShellClick(e, item.href)}
                className={cn(active && "font-semibold")}
              >
                <item.icon aria-hidden />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phone strip: every section, scrolling inside itself. */
function MobileNav({ pathname }: { pathname: string }) {
  const onShellClick = useShellLinkClick();
  const strip = React.useRef<HTMLDivElement>(null);

  // Keep the current section in view when the page changes.
  React.useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav aria-label="Primary" className="border-t border-border xl:hidden">
      <div
        ref={strip}
        className="flex gap-1 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:px-6"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={(e) => onShellClick(e, item.href)}
              className={cn(TAB, "text-[13px]", active ? TAB_ACTIVE : TAB_IDLE)}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function TopBar({ profile }: { profile: ShellProfile }) {
  const pathname = usePathname();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const onShellClick = useShellLinkClick();
  const settingsActive = isActivePath("/settings", pathname);

  return (
    <header className="dark sticky top-0 z-40 border-b border-border bg-background text-foreground">
      <div className="mx-auto flex h-16 w-full max-w-[1520px] items-center gap-1 px-3 max-[359px]:h-auto max-[359px]:min-h-16 max-[359px]:flex-wrap max-[359px]:py-2 sm:gap-2 md:px-6 xl:gap-4">
        {/* Brand. `assetPath` because next/image does not apply the zone
            basePath to a string src (see the history in git: the rail's mark
            404ed without it). The link carries the accessible name once. */}
        <Link
          href="/"
          aria-label="FortMark home"
          onClick={(e) => onShellClick(e, "/")}
          className="flex min-h-11 shrink-0 items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Image
            src={assetPath("/brand/fortmark-logomark-white.png")}
            alt=""
            width={45}
            height={20}
            className="h-5 w-auto sm:hidden"
            priority
          />
          <Image
            src={assetPath("/brand/fortmark-wordmark-white.png")}
            alt=""
            width={110}
            height={32}
            className="hidden h-7 w-auto sm:block"
            priority
          />
        </Link>

        <nav aria-label="Primary" className="ml-1 hidden h-16 items-center gap-0.5 xl:flex">
          {PRIMARY_NAV.map((item) => (
            <NavTab key={item.href} item={item} pathname={pathname} />
          ))}
          <MoreMenu pathname={pathname} />
        </nav>

        {/* Unified search. Both controls open the one ⌘K palette. */}
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="ml-auto hidden h-11 min-w-[10rem] max-w-[22rem] flex-1 items-center gap-2.5 rounded-md bg-accent/50 px-3 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:flex"
          aria-label="Search (Command K)"
          data-command-trigger=""
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate text-left">Search clients, deals, listings…</span>
          <Kbd className="border-0 bg-transparent text-muted-foreground">⌘K</Kbd>
        </button>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Search"
          data-command-trigger=""
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex shrink-0 items-center max-[359px]:w-full max-[359px]:justify-end sm:gap-0.5">
          <NewMenu />
          <NotificationsBell />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings"
                aria-label="Settings"
                aria-current={settingsActive ? "page" : undefined}
                onClick={(e) => onShellClick(e, "/settings")}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-150",
                  settingsActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Settings className="h-[18px] w-[18px]" aria-hidden />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <ThemeToggle />
          <div className="ml-0.5 flex items-center border-l border-border pl-0.5 sm:ml-2 sm:pl-2">
            <ProfileIdentity display={profile.display} editable={profile.editable} compact />
          </div>
        </div>
      </div>

      <MobileNav pathname={pathname} />
    </header>
  );
}
