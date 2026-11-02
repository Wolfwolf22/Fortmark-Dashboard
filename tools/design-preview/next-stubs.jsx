import React, { createContext, forwardRef, useContext, useEffect, useSyncExternalStore } from "react";
import { previewRouteParts } from "./route-parts.mjs";

const NavigationContext = createContext(null);
export function PreviewNavigation({ children }) {
  const location = useSyncExternalStore(
    (notify) => {
      window.addEventListener("popstate", notify);
      return () => window.removeEventListener("popstate", notify);
    },
    () => window.location.search + window.location.hash,
    () => ""
  );
  const params = new URLSearchParams(location.split("#")[0]);
  const parts = previewRouteParts(params.get("view") || "/");
  const route = parts.route;
  const anchor = window.location.hash || parts.hash;
  useEffect(() => {
    if (!anchor) return;
    let observer;
    const focus = () => {
      const target = document.getElementById(decodeURIComponent(anchor.slice(1)));
      if (!target) return false;
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
      observer?.disconnect();
      return true;
    };
    if (!focus()) { observer = new MutationObserver(focus); observer.observe(document.getElementById("root"), { childList: true, subtree: true }); }
    return () => observer?.disconnect();
  }, [location, anchor]);
  const navigate = (href, replace = false) => {
    const url = new URL(window.location.href);
    const scenario = url.searchParams.get("scenario");
    const target = previewRouteParts(href);
    const sameSection = parts.pathname === target.pathname;
    url.search = "";
    url.hash = target.hash;
    url.searchParams.set("view", target.route);
    if (scenario && (sameSection || scenario === "interactive")) url.searchParams.set("scenario", scenario);
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (!target.hash) window.scrollTo(0, 0);
  };
  return <NavigationContext.Provider value={{ route, navigate }}>{children}</NavigationContext.Provider>;
}
export function usePathname() { return useContext(NavigationContext)?.route.split("?")[0] || "/"; }
export function useParams() {
  const route = useContext(NavigationContext)?.route.split("?")[0] || "/";
  const segments = route.split("/").filter(Boolean);
  return { id: ["listings", "transactions"].includes(segments[0]) ? segments[1] : undefined };
}
export function useRouter() {
  const navigation = useContext(NavigationContext);
  return { push: navigation.navigate, replace: (href) => navigation.navigate(href, true), back: () => window.history.back(), refresh: () => window.location.reload() };
}
export function useSearchParams() {
  const route = useContext(NavigationContext)?.route || "/";
  return new URLSearchParams(route.split("?")[1] || "");
}
export const Link = forwardRef(function Link({ href = "/", children, onClick, prefetch, ...props }, ref) {
  const navigation = useContext(NavigationContext);
  const path = typeof href === "string" ? href : href.pathname || "/";
  const interactive = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("scenario") === "interactive";
  const target = previewRouteParts(path);
  return <a {...props} ref={ref} href={`/?view=${encodeURIComponent(target.route)}${interactive ? "&scenario=interactive" : ""}${target.hash}`} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      navigation.navigate(path);
    }
  }}>{children}</a>;
});
export function Image({ src, alt, priority, fill, unoptimized, ...props }) {
  return <img {...props} alt={alt || ""} src={typeof src === "string" ? src : src.src} />;
}
