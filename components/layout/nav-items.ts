import {
  Building2,
  CalendarDays,
  FileText,
  Home,
  LineChart,
  MessageSquare,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * `primary` sections are the operating core and always sit in the top bar.
   * `secondary` sections live behind "More" on desktop so the bar never wraps,
   * and after the primary ones in the phone strip.
   */
  tier: "primary" | "secondary";
}

/**
 * The one navigation definition. The desktop top bar, the phone strip and the
 * page title all read from here — there is no second list to drift.
 *
 * Order is the product's argument: the brokerage core first (Home, Listings,
 * Leads, Transactions) — the four sections backed by live data. The rest sit
 * behind "More": Reports, Calendar, Documents and Messages say plainly that
 * they are not connected yet, and AI is last because it is a layer inside the
 * operating system, not the product.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home, tier: "primary" },
  { href: "/listings", label: "Listings", icon: Building2, tier: "primary" },
  { href: "/leads", label: "Leads", icon: Users, tier: "primary" },
  { href: "/transactions", label: "Transactions", icon: Workflow, tier: "primary" },
  { href: "/reports", label: "Reports", icon: LineChart, tier: "secondary" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, tier: "secondary" },
  { href: "/documents", label: "Documents", icon: FileText, tier: "secondary" },
  { href: "/messages", label: "Messages", icon: MessageSquare, tier: "secondary" },
  { href: "/ai", label: "AI", icon: Sparkles, tier: "secondary" },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.tier === "primary");
export const SECONDARY_NAV = NAV_ITEMS.filter((item) => item.tier === "secondary");

/**
 * Whether `href` owns `pathname`. Nested routes keep their section: a listing
 * detail (`/listings/abc`) keeps Listings active. Matching is by path segment,
 * so `/lead` could never light up `/leads`.
 */
export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageTitleFor(pathname: string): string {
  if (pathname === "/") return "Home";
  const hit = NAV_ITEMS.find((item) => item.href !== "/" && isActivePath(item.href, pathname));
  if (hit) return hit.label;
  if (isActivePath("/settings", pathname)) return "Settings";
  return "FortMark";
}
