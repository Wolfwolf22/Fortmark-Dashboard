"use client";

/**
 * Route-content motion for the dashboard shell.
 *
 * The shell (top bar, logo, search, account) is rendered by the layout and
 * never moves. Only the page beneath it transitions:
 *
 *   exit   the current page fades, drops a few pixels and settles to 98.5%
 *          (EXIT_MS), then the real navigation happens;
 *   enter  the arriving page rises into place (CSS `fm-page-enter`).
 *
 * Every navigation is a real Next.js navigation — `router.push` to a real
 * route, so deep links, back/forward, prefetching and server redirects are
 * untouched. The exit is played only for navigations the shell starts (top
 * bar, phone strip, ⌘K). Back/forward and in-page links still get the
 * entrance, because it keys on the pathname, not on how it changed.
 *
 * Reduced motion: no exit delay at all, and the global reduced-motion rule in
 * `globals.css` collapses the entrance to an instant render.
 */
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

/** Long enough to read as a departure, short enough not to feel like a wait. */
export const EXIT_MS = 190;
/** If a navigation never lands (same URL, error), the page comes back. */
const EXIT_SAFETY_MS = 1600;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Strip the query/hash so `/listings?office=all` still counts as `/listings`. */
function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

/**
 * Navigate with the exit animation. Falls straight through to `router.push`
 * when the destination is this same page (a query change) or when the reader
 * prefers reduced motion.
 */
export function useShellNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  const setLeavingFrom = useUiStore((s) => s.setLeavingFrom);

  return React.useCallback(
    (href: string) => {
      if (pathOf(href) === pathname || prefersReducedMotion()) {
        router.push(href);
        return;
      }
      setLeavingFrom(pathname);
      window.setTimeout(() => router.push(href), EXIT_MS);
    },
    [router, pathname, setLeavingFrom]
  );
}

/**
 * Click handler for a shell `<Link>`: keeps every native behaviour (new tab,
 * modifier keys, middle click, same-page) and only intercepts a plain
 * left-click to a different route.
 */
export function useShellLinkClick() {
  const navigate = useShellNavigate();
  return React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(href);
    },
    [navigate]
  );
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const leavingFrom = useUiStore((s) => s.leavingFrom);
  const setLeavingFrom = useUiStore((s) => s.setLeavingFrom);
  const leaving = leavingFrom === pathname;

  // Arrived: clear the exit state for good.
  React.useEffect(() => {
    setLeavingFrom(null);
  }, [pathname, setLeavingFrom]);

  // A navigation that never lands must not leave the page invisible.
  React.useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeavingFrom(null), EXIT_SAFETY_MS);
    return () => window.clearTimeout(t);
  }, [leaving, setLeavingFrom]);

  return (
    <div
      key={pathname}
      data-page-transition={leaving ? "exit" : "enter"}
      className={cn("flex min-h-0 flex-1 flex-col", leaving ? "fm-page-exit" : "fm-page-enter")}
    >
      {children}
    </div>
  );
}
