"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pin, PinOff, Settings } from "lucide-react";
import { NAV_ITEMS } from "./nav-items";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu } from "./user-menu";
import { useUiStore } from "@/lib/stores/ui";
import { assetPath } from "@/lib/routes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The left rail: icon-only at 64px, expanding to labels on hover or via the
 * pin toggle. Active item is a solid black tile with a white icon (inverted
 * in dark mode).
 */
export function NavRail() {
  const pathname = usePathname();
  const railPinnedStored = useUiStore((s) => s.railPinned);
  const setRailPinned = useUiStore((s) => s.setRailPinned);
  const [hovered, setHovered] = React.useState(false);
  // Persisted pin state only applies after mount so SSR markup matches.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const railPinned = mounted && railPinnedStored;
  const expanded = railPinned || hovered;

  return (
    <aside
      aria-label="Primary navigation"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-card transition-[width] duration-200 ease-out",
        expanded ? "w-60 shadow-pop" : "w-16"
      )}
    >
      {/* Brand ------------------------------------------------------------
          Two corrections live here.

          1. Every `src` goes through `assetPath`. `next/image` does NOT apply
             the zone `basePath` to a plain string src, and `unoptimized: true`
             in next.config.ts means the optimizer — which would have added it
             — never runs. The emitted URL was therefore `/brand/…`, which
             resolves against the portal zone at the origin root and 404s.
             That 404 was the broken-image icon in this corner.

          2. The wordmark is the real asset, not letterforms. The expanded rail
             previously rendered the plain string "FORTMARK" in a display font
             beside the mark, which is a lookalike rather than the logo.

          Sizes are derived from each asset's INK, not its canvas, and that
          distinction is the whole reason these look balanced.

          The logomark is 1568×700 with zero padding, so its canvas height IS
          its letterform height. The wordmark is 1756×512 but carries 94px of
          transparent padding on every side, so its actual type is only
          1568×324 — 63% of the canvas height. Sizing both by canvas made the
          wordmark render at ~10px of visible type beside a 20px mark, which
          read as a caption rather than a logo.

          So the wordmark box is deliberately TALLER than the mark: at 32px of
          canvas its type is 32 × 324/512 ≈ 20px, matching the mark's 20px.
          The padding is symmetric, so `items-center` centres the ink itself
          and the two align optically without a manual nudge.

          Both keep their true aspect ratios (2.24:1 and 3.43:1), so nothing is
          stretched, and fixed width/height means no layout shift.

          `alt=""` is deliberate and IS the accessible choice here: the link
          already carries `aria-label="FortMark home"`, so describing the
          images too would announce the brand three times to a screen reader.
          The accessible name lives on the link, once. */}
      <div className={cn("flex h-16 shrink-0 items-center", expanded ? "px-5" : "justify-center")}>
        <Link
          href="/"
          // gap-2 rather than gap-3: the wordmark carries its own horizontal
          // padding, so a larger gap reads as a gap-and-a-half.
          className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          aria-label="FortMark home"
        >
          <Image
            src={assetPath("/brand/fortmark-logomark-black.png")}
            alt=""
            width={45}
            height={20}
            className="h-5 w-auto dark:hidden"
            priority
          />
          <Image
            src={assetPath("/brand/fortmark-logomark-white.png")}
            alt=""
            width={45}
            height={20}
            className="hidden h-5 w-auto dark:block"
            priority
          />
          {expanded && (
            <>
              <Image
                src={assetPath("/brand/fortmark-wordmark-black.png")}
                alt=""
                width={110}
                height={32}
                className="h-8 w-auto dark:hidden"
                priority
              />
              <Image
                src={assetPath("/brand/fortmark-wordmark-white.png")}
                alt=""
                width={110}
                height={32}
                className="hidden h-8 w-auto dark:block"
                priority
              />
            </>
          )}
        </Link>
      </div>

      {/* Nav items */}
      <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto py-2", expanded ? "px-3" : "items-center px-0")}>
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl text-sm font-semibold transition-colors duration-150",
                expanded ? "w-full px-3 py-2.5" : "h-10 w-10 justify-center",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {expanded && <span className="truncate">{item.label}</span>}
            </Link>
          );
          return expanded ? (
            link
          ) : (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom cluster */}
      <div
        className={cn(
          "flex shrink-0 flex-col gap-1 border-t border-border py-3",
          expanded ? "px-3" : "items-center"
        )}
      >
        <RailAction expanded={expanded} label={railPinned ? "Unpin rail" : "Pin rail open"}>
          <button
            type="button"
            onClick={() => setRailPinned(!railPinned)}
            aria-pressed={railPinned}
            className={cn(
              "flex items-center gap-3 rounded-xl text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              expanded ? "w-full px-3 py-2.5" : "h-10 w-10 justify-center"
            )}
          >
            {railPinned ? (
              <PinOff className="h-[18px] w-[18px]" aria-hidden />
            ) : (
              <Pin className="h-[18px] w-[18px]" aria-hidden />
            )}
            {expanded && <span>{railPinned ? "Unpin" : "Pin open"}</span>}
          </button>
        </RailAction>

        <NotificationsBell expanded={expanded} />

        <RailAction expanded={expanded} label="Settings">
          <Link
            href="/settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl text-sm font-semibold transition-colors",
              expanded ? "w-full px-3 py-2.5" : "h-10 w-10 justify-center",
              pathname.startsWith("/settings")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Settings className="h-[18px] w-[18px]" aria-hidden />
            {expanded && <span>Settings</span>}
          </Link>
        </RailAction>

        <UserMenu expanded={expanded} />
      </div>
    </aside>
  );
}

function RailAction({
  expanded,
  label,
  children,
}: {
  expanded: boolean;
  label: string;
  children: React.ReactElement;
}) {
  if (expanded) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
