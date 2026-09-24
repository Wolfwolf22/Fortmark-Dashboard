/**
 * Dashboard shell: top navigation, route motion and Home composition.
 *
 * Runs under plain Node (type stripping, no DOM). Behaviour is asserted on
 * the pure helpers; structure on the component source, where a rendered tree
 * is not available.
 */
import { existsSync, readFileSync } from "node:fs";
import { NAV_ITEMS, PRIMARY_NAV, SECONDARY_NAV, isActivePath, pageTitleFor } from "../components/layout/nav-items.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}
const src = (p: string) => readFileSync(p, "utf8");

// --- One navigation definition ------------------------------------------------------
check("the brokerage core leads the bar in order",
  PRIMARY_NAV.map((i) => i.label).join("|") === "Home|Listings|Leads|Transactions");
check("AI is secondary and last", SECONDARY_NAV.some((i) => i.label === "AI") &&
  NAV_ITEMS[NAV_ITEMS.length - 1].label === "AI");
check("every section is either primary or secondary, once",
  PRIMARY_NAV.length + SECONDARY_NAV.length === NAV_ITEMS.length &&
    new Set(NAV_ITEMS.map((i) => i.href)).size === NAV_ITEMS.length);
check("every nav route is a real page", NAV_ITEMS.every((i) =>
  existsSync(i.href === "/" ? "app/(app)/page.tsx" : `app/(app)${i.href}/page.tsx`)));
const bar = src("components/layout/top-bar.tsx");
check("the top bar reads the one config (no second list)",
  bar.includes("PRIMARY_NAV.map") && bar.includes("SECONDARY_NAV.map") && bar.includes("NAV_ITEMS.map") &&
    !/href:\s*"\/(listings|leads|transactions)"/.test(bar));

// --- Active route ---------------------------------------------------------------------
check("Home is active only on Home", isActivePath("/", "/") && !isActivePath("/", "/listings"));
check("a listing detail keeps Listings active", isActivePath("/listings", "/listings/abc123"));
check("a transaction detail keeps Transactions active", isActivePath("/transactions", "/transactions/t1"));
check("sections match by segment, not prefix", !isActivePath("/lead", "/leads") && !isActivePath("/ai", "/aim"));
check("page titles follow the same rule",
  pageTitleFor("/listings/abc") === "Listings" && pageTitleFor("/settings") === "Settings" && pageTitleFor("/") === "Home");
check("active links are marked for assistive tech",
  (bar.match(/aria-current=\{active \? "page" : undefined\}/g) ?? []).length >= 3);
check("sections are real links, not click handlers on divs",
  bar.includes("<Link") && !/<div[^>]*onClick/.test(bar));
check("a hidden secondary section still shows as current",
  bar.includes("current ? current.label : \"More\"") && bar.includes("current ? TAB_ACTIVE : TAB_IDLE"));

// --- Shell structure --------------------------------------------------------------------
const shell = src("components/layout/app-shell.tsx");
check("the left rail is gone", !existsSync("components/layout/nav-rail.tsx") && !shell.includes("NavRail"));
check("the shell renders the top bar above the page", shell.indexOf("<TopBar profile") < shell.lastIndexOf("<PageTransition>"));
check("no rail padding is left behind", !/pl-16|pl-60/.test(shell));
check("content is wide but bounded", shell.includes("max-w-[1520px]") && bar.includes("max-w-[1520px]"));
check("the bar is always black with the dark token scope", bar.includes('className="dark sticky top-0'));
check("phones get a scrolling section strip, not a hamburger",
  bar.includes("function MobileNav") && bar.includes("overflow-x-auto") && bar.includes("lg:hidden"));
check("the desktop tabs appear only where they fit", bar.includes('className="ml-2 hidden items-center gap-1.5 lg:flex'));
check("search opens the one palette from both controls",
  (bar.match(/onClick=\{\(\) => setCommandOpen\(true\)\}/g) ?? []).length === 2);
check("no notification count is invented", !/unread\s*=\s*\d/.test(src("components/layout/notifications-bell.tsx")));
check("the sidebar pin state is no longer persisted", !src("lib/stores/ui.ts").includes("railPinned"));

// --- Route motion --------------------------------------------------------------------------
const pt = src("components/layout/page-transition.tsx");
const css = src("app/globals.css");
check("navigation is a real router.push, never local state", pt.includes("router.push(href)"));
check("only the page content transitions, keyed by pathname", pt.includes("key={pathname}"));
check("exit fits the brief (180–250 ms)", /EXIT_MS = (1[89]\d|2[0-4]\d|250);/.test(pt) &&
  /fm-page-exit (1[89]\d|2[0-4]\d|250)ms/.test(css));
check("enter fits the brief (300–450 ms)", /fm-page-enter (3\d\d|4[0-4]\d|450)ms/.test(css));
check("a navigation that never lands cannot leave the page invisible", pt.includes("EXIT_SAFETY_MS"));
check("the arriving page never inherits the exit state", pt.includes("leavingFrom === pathname"));
check("reduced motion skips the exit entirely", pt.includes("prefers-reduced-motion: reduce") &&
  /prefersReducedMotion\(\)\) \{\s*router\.push\(href\)/.test(pt));
check("modifier-clicks and new tabs keep native behaviour",
  pt.includes("event.metaKey") && pt.includes("event.ctrlKey") && pt.includes("event.button !== 0"));
check("a settled page has no transform (no fixed-position trap)",
  /@keyframes fm-page-enter[\s\S]{0,200}transform: none/.test(css));
check("phones get shorter, vertical-only motion",
  /max-width: 767px[\s\S]{0,120}fm-page-enter[\s\S]{0,60}animation-duration: 300ms/.test(css) &&
    !/translateX/.test(css));
check("⌘K navigates through the same path",
  src("components/layout/command-palette.tsx").includes("navigate(href)"));

console.log(`\n${passed}/${passed + failures.length} shell checks passed`);
if (failures.length > 0) process.exit(1);
