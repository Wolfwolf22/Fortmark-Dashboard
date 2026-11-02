"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { validTourCoordinates, type TourCoordinates, type TourMap } from "@/lib/showings/tour-domain";

export interface TourMapPoint { id: string; label: string; number: number | "A" | "B"; coordinates: TourCoordinates | null }
interface Props { config: TourMap; points: TourMapPoint[]; selectedId: string | null; onSelect: (id: string) => void; encodedPolyline?: string }
export function decodeTourPolyline(value: string): TourCoordinates[] | null {
  if (value.length > 200000) return null;
  let index = 0, lat = 0, lng = 0; const points: TourCoordinates[] = [];
  function component(): number | null { let result = 0, shift = 0; while (index < value.length && shift <= 30) { const digit = value.charCodeAt(index++) - 63; if (digit < 0 || digit > 63) return null; result |= (digit & 31) << shift; shift += 5; if (digit < 32) return result & 1 ? ~(result >> 1) : result >> 1; } return null; }
  while (index < value.length) { const a = component(), b = component(); if (a === null || b === null) return null; lat += a; lng += b; const point = { lat: lat / 1e5, lng: lng / 1e5 }; if (!validTourCoordinates(point) || points.length >= 20000) return null; points.push(point); }
  return points;
}
export function projectTourPoints(points: TourMapPoint[]): { point: TourMapPoint; x: number; y: number }[] {
  const visible = points.filter((point) => validTourCoordinates(point.coordinates));
  if (!visible.length) return [];
  const lat = visible.map((point) => point.coordinates!.lat), lng = visible.map((point) => point.coordinates!.lng), middleLat = (Math.min(...lat) + Math.max(...lat)) / 2;
  const scaleX = Math.max(0.01, Math.cos(middleLat * Math.PI / 180)), minX = Math.min(...lng) * scaleX, maxX = Math.max(...lng) * scaleX, minY = Math.min(...lat), maxY = Math.max(...lat);
  const ratio = Math.min(440 / Math.max(0.005, maxX - minX), 250 / Math.max(0.005, maxY - minY)), midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  return visible.map((point) => ({ point, x: 270 + (point.coordinates!.lng * scaleX - midX) * ratio, y: 175 - (point.coordinates!.lat - midY) * ratio }));
}
export function TourCoordinateMap({ points, selectedId, onSelect, sample = false }: Pick<Props, "points" | "selectedId" | "onSelect"> & { sample?: boolean }) {
  const prefix = useId(), projected = projectTourPoints(points);
  return <div className="relative min-w-0 overflow-hidden rounded-panel border border-border bg-tint"><svg viewBox="0 0 540 350" className="block h-[240px] w-full text-foreground sm:h-[280px] lg:h-[290px]" preserveAspectRatio="xMidYMid meet" role="group" aria-labelledby={`${prefix}-title ${prefix}-description`}><title id={`${prefix}-title`}>{sample ? "Sample tour map" : "Property location plot"}</title><desc id={`${prefix}-description`}>{sample ? "Illustrative map and route, with numbered sample properties. No street map or live traffic." : "Relative property coordinates, not a street map. Driving times are unavailable until routing is connected."}</desc><defs><pattern id={`${prefix}-grid`} width="42" height="42" patternUnits="userSpaceOnUse"><path d="M 42 0 L 0 0 0 42" fill="none" stroke="currentColor" className="text-border" strokeWidth="1" /></pattern></defs><rect width="540" height="350" fill={`url(#${prefix}-grid)`} />{sample && <><path d="M448 -10 C402 80 495 118 458 202 C428 276 483 300 454 360 L560 360 L560 -10Z" className="fill-background stroke-border" /><path d="M-20 125 C90 165 183 83 310 108 S428 185 550 152 M100 -10 L125 360 M270 -10 L238 360 M-10 244 L550 262" fill="none" className="stroke-background" strokeWidth="14" /><path d="M-20 125 C90 165 183 83 310 108 S428 185 550 152 M100 -10 L125 360 M270 -10 L238 360 M-10 244 L550 262" fill="none" className="stroke-border" strokeWidth="1" />{projected.length > 1 && <polyline points={projected.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="5 5" strokeLinejoin="round" />}</>}{projected.map(({ point, x, y }) => <g key={point.id} role="button" tabIndex={0} aria-label={`Stop ${point.number}: ${point.label}`} aria-pressed={selectedId === point.id} className="cursor-pointer outline-none focus:opacity-70" onClick={() => onSelect(point.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.id); } }}><title>{`${point.number}. ${point.label}`}</title><circle cx={x} cy={y} r={44} fill="transparent" className="sm:[r:24px]" /><circle cx={x} cy={y} r={selectedId === point.id ? 35 : 32} className={`fill-card stroke-foreground ${selectedId === point.id ? "sm:[r:23px]" : "sm:[r:20px]"}`} strokeWidth={selectedId === point.id ? 3 : 1.5} /><text x={x} y={y} dy=".35em" textAnchor="middle" className="fill-foreground text-[26px] font-semibold sm:text-[14px]">{point.number}</text></g>)}{!projected.length && <text x="270" y="175" textAnchor="middle" className="fill-muted-foreground text-[13px]">No displayable property coordinates</text>}</svg><p className="border-t border-border bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">{sample ? "Sample map · illustrative streets and route, without live traffic." : "Location plot · map service not connected. This does not show roads or a driving route."}</p></div>;
}

interface GoogleMapInstance { fitBounds: (bounds: GoogleBounds, padding?: number) => void; panTo: (point: TourCoordinates) => void; setZoom: (zoom: number) => void }
interface GoogleBounds { extend: (point: TourCoordinates) => void }
interface GoogleOverlay { setMap: (map: GoogleMapInstance | null) => void; getPanes: () => { overlayMouseTarget: HTMLElement } | null; getProjection: () => { fromLatLngToDivPixel: (position: unknown) => { x: number; y: number } | null } }
interface GoogleMapsRuntime {
  Map: new (element: HTMLElement, options: object) => GoogleMapInstance; LatLngBounds: new () => GoogleBounds; LatLng: new (lat: number, lng: number) => unknown;
  OverlayView: { new (): GoogleOverlay; preventMapHitsAndGesturesFrom: (element: HTMLElement) => void };
  Polyline: new (options: object) => { setMap: (map: GoogleMapInstance | null) => void };
}
type MapsWindow = Window & { google?: { maps?: GoogleMapsRuntime }; __fortmarkTourMapReady?: () => void };
let loader: { key: string; promise: Promise<GoogleMapsRuntime> } | null = null;
export function tourMapsScriptUrl(browserKey: string): string { const url = new URL("https://maps.googleapis.com/maps/api/js"); url.searchParams.set("key", browserKey); url.searchParams.set("loading", "async"); url.searchParams.set("callback", "__fortmarkTourMapReady"); url.searchParams.set("v", "weekly"); return url.toString(); }
function loadMaps(browserKey: string): Promise<GoogleMapsRuntime> {
  if (loader) return loader.key === browserKey ? loader.promise : Promise.reject(Error("Map configuration changed. Refresh this page."));
  const existing = (window as MapsWindow).google?.maps;
  if (existing?.Map && existing.OverlayView) return Promise.resolve(existing);
  const promise = new Promise<GoogleMapsRuntime>((resolve, reject) => {
    const script = document.createElement("script"), target = window as MapsWindow;
    let finished = false;
    const timeout = window.setTimeout(() => fail(), 20000);
    function fail() { if (finished) return; finished = true; window.clearTimeout(timeout); script.remove(); delete target.__fortmarkTourMapReady; loader = null; reject(Error("The map could not load.")); }
    target.__fortmarkTourMapReady = () => { const maps = target.google?.maps; if (!maps?.Map || !maps.OverlayView) { fail(); return; } finished = true; window.clearTimeout(timeout); delete target.__fortmarkTourMapReady; resolve(maps); };
    script.src = tourMapsScriptUrl(browserKey); script.async = true; script.onerror = fail; const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce; if (nonce) script.nonce = nonce; document.head.append(script);
  });
  loader = { key: browserKey, promise }; return promise;
}
function GoogleTourMap({ config, points, selectedId, onSelect, encodedPolyline }: Props & { config: Extract<TourMap, { kind: "google" }> }) {
  const canvas = useRef<HTMLDivElement>(null), map = useRef<GoogleMapInstance | null>(null), fit = useRef<(() => void) | null>(null), select = useRef(onSelect), pointRef = useRef(points), selected = useRef(selectedId);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  select.current = onSelect; pointRef.current = points; selected.current = selectedId;
  const [api, setApi] = useState<GoogleMapsRuntime | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  // One billable map instance per mounted configuration. Stops and geometry update below.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setApi(null);
    loadMaps(config.browserKey).then((runtime) => {
      if (cancelled || !canvas.current) return;
      const first = pointRef.current.find((point) => validTourCoordinates(point.coordinates));
      if (!first) { setLoading(false); return; }
      map.current = new runtime.Map(canvas.current, { center: first.coordinates, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "cooperative", styles: [{ stylers: [{ saturation: -100 }] }] });
      setApi(runtime); setLoading(false);
    }).catch(() => { if (!cancelled) { setError("The map could not load. Your itinerary is kept. Check the map configuration or retry."); setLoading(false); } });
    return () => { cancelled = true; map.current = null; fit.current = null; };
  }, [config.browserKey, retry]);
  useEffect(() => {
    const instance = map.current;
    if (!api || !instance || !canvas.current) return;
    const available = points.filter((point) => validTourCoordinates(point.coordinates)), bounds = new api.LatLngBounds();
    available.forEach((point) => bounds.extend(point.coordinates!));
    fit.current = () => { if (available.length > 1) instance.fitBounds(bounds, 45); else if (available.length === 1) { instance.panTo(available[0].coordinates!); instance.setZoom(14); } };
    const overlays = available.map((point) => {
      class NumberedPin extends api.OverlayView {
        button: HTMLButtonElement | null = null;
        onAdd() { const button = document.createElement("button"); button.type = "button"; button.className = "absolute flex h-11 w-11 sm:h-10 sm:w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-foreground bg-card font-sans text-sm font-semibold text-foreground shadow-sm"; button.textContent = String(point.number); button.setAttribute("aria-label", `Stop ${point.number}: ${point.label}`); stylePin(button, selected.current === point.id); button.addEventListener("click", () => select.current(point.id)); api!.OverlayView.preventMapHitsAndGesturesFrom(button); this.getPanes()?.overlayMouseTarget.append(button); this.button = button; buttons.current.set(point.id, button); }
        draw() { const pixel = this.getProjection().fromLatLngToDivPixel(new api!.LatLng(point.coordinates!.lat, point.coordinates!.lng)); if (this.button && pixel) { this.button.style.left = `${pixel.x}px`; this.button.style.top = `${pixel.y}px`; } }
        onRemove() { this.button?.remove(); this.button = null; buttons.current.delete(point.id); }
      }
      const overlay = new NumberedPin(); overlay.setMap(instance); return overlay;
    });
    const path = encodedPolyline ? decodeTourPolyline(encodedPolyline) : null, ink = getComputedStyle(canvas.current).getPropertyValue("--fm-surface").trim() || getComputedStyle(canvas.current).color;
    const line = path?.length ? new api.Polyline({ path, map: instance, strokeColor: ink, strokeOpacity: 0.9, strokeWeight: 4 }) : null;
    fit.current();
    return () => { overlays.forEach((overlay) => overlay.setMap(null)); line?.setMap(null); fit.current = null; };
  }, [api, points, encodedPolyline]);
  useEffect(() => { buttons.current.forEach((button, id) => stylePin(button, id === selectedId)); const point = points.find((point) => point.id === selectedId); if (point?.coordinates && map.current) map.current.panTo(point.coordinates); }, [selectedId, points]);
  return <div className="min-w-0 space-y-2"><div className="relative overflow-hidden rounded-panel border border-border bg-tint"><div ref={canvas} className="h-[260px] w-full text-foreground sm:h-[290px]" role="region" aria-label="Google map of selected tour stops" />{loading && <p role="status" className="absolute inset-x-3 top-3 rounded-lg border border-border bg-card p-3 text-xs">Loading map…</p>}{!loading && !error && <Button type="button" size="sm" variant="outline" className="absolute right-3 top-3 bg-card" onClick={() => fit.current?.()}><Maximize2 aria-hidden="true" />Show all stops</Button>}</div>{error && <div role="alert" className="space-y-2 text-xs leading-relaxed"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry map</Button></div>}</div>;
}
function stylePin(button: HTMLButtonElement, active: boolean) { button.setAttribute("aria-pressed", String(active)); button.style.zIndex = active ? "2" : "1"; for (const token of ["ring-2", "ring-ring", "ring-offset-2", "ring-offset-card"]) button.classList.toggle(token, active); }

export function TourMapView(props: Props) {
  if (props.points.every((point) => !validTourCoordinates(point.coordinates))) return <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-panel border border-dashed border-input bg-tint p-5 text-center"><IconWell icon={MapPin} /><p className="max-w-xs text-xs leading-relaxed text-muted-foreground">No displayable locations are available. Unresolved properties remain in the stop list.</p></div>;
  if (props.config.kind === "google") return <GoogleTourMap {...props} config={props.config} />;
  return <TourCoordinateMap {...props} sample={props.config.kind === "sample"} />;
}
