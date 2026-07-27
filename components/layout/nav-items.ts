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
}

/** Rail order fixed by the brief. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/transactions", label: "Transactions", icon: Workflow },
  { href: "/listings", label: "Listings", icon: Building2 },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/reports", label: "Reports", icon: LineChart },
  { href: "/ai", label: "AI", icon: Sparkles },
  { href: "/messages", label: "Messages", icon: MessageSquare },
];

export function pageTitleFor(pathname: string): string {
  if (pathname === "/") return "Home";
  const hit = NAV_ITEMS.find(
    (item) => item.href !== "/" && pathname.startsWith(item.href)
  );
  if (hit) return hit.label;
  if (pathname.startsWith("/settings")) return "Settings";
  return "FortMark";
}
