import React, { createContext, forwardRef, useContext, useSyncExternalStore } from "react";

const NavigationContext = createContext(null);
export function PreviewNavigation({ children }) {
  const location = useSyncExternalStore(
    (notify) => {
      window.addEventListener("popstate", notify);
      return () => window.removeEventListener("popstate", notify);
    },
    () => window.location.search,
    () => ""
  );
  const params = new URLSearchParams(location);
  const route = params.get("view") || "/";
  const navigate = (href, replace = false) => {
    const url = new URL(window.location.href);
    const scenario = url.searchParams.get("scenario");
    const sameSection = (params.get("view") || "/").split("?")[0] === href.split("?")[0];
    url.search = "";
    url.searchParams.set("view", href);
    if (scenario && (sameSection || scenario === "interactive")) url.searchParams.set("scenario", scenario);
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0, 0);
  };
  return <NavigationContext.Provider value={{ route, navigate }}>{children}</NavigationContext.Provider>;
}
export function usePathname() { return useContext(NavigationContext)?.route.split("?")[0] || "/"; }
export function useParams() {
  const route = useContext(NavigationContext)?.route.split("?")[0] || "/";
  const segments = route.split("/").filter(Boolean);
  return { id: segments[0] === "listings" ? segments[1] : undefined };
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
  return <a {...props} ref={ref} href={`/?view=${encodeURIComponent(path)}${interactive ? "&scenario=interactive" : ""}`} onClick={(event) => {
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
