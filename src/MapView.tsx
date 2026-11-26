import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AutoStop, LatLng, Route, Stop, StopKind } from "./lib/types";

export type BaseLayer = "dark" | "streets" | "topo";

const BASES: Record<BaseLayer, { url: string; attribution: string; maxZoom: number; subdomains?: string; className?: string }> = {
  // Dark is the standard OpenStreetMap map darkened in the browser (see .wp-dark-tiles), so it needs no key and no second provider.
  dark: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors", maxZoom: 19, className: "wp-dark-tiles" },
  // The standard OpenStreetMap style draws every road down to farm tracks and footpaths.
  streets: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors", maxZoom: 19 },
  topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)", maxZoom: 17, subdomains: "abc" },
};
const TRAILS = "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png";

export const KIND_COLOR: Record<StopKind, string> = { start: "#8be0a6", end: "#ff7a6b", leisure: "#78bcdc", overnight: "#b79cff", fuel: "#f2c14e", food: "#e07fa8", other: "#a3a3a3" };
export const KIND_LABEL: Record<StopKind, string> = { start: "Start", end: "End", leisure: "Leisure", overnight: "Overnight", fuel: "Fuel", food: "Food", other: "Other" };
const GLYPH: Record<StopKind, string> = { start: "S", end: "E", leisure: "L", overnight: "Z", fuel: "F", food: "M", other: "•" };

const icon = (kind: StopKind, small = false, label?: string) => L.divIcon({
  className: "",
  html: `<span class="wp-pin${small ? " small" : ""}" style="--c:${KIND_COLOR[kind]}">${label ?? GLYPH[kind]}</span>`,
  iconSize: small ? [20, 20] : [28, 28], iconAnchor: small ? [10, 10] : [14, 14],
});

type Props = {
  base: BaseLayer; trails: boolean;
  stops: Stop[]; auto: AutoStop[]; routes: Route[]; routeIndex: number; selectedId: string | null;
  pinMode: boolean; flyTarget: (LatLng & { n: number }) | null;
  onPin: (at: LatLng) => void;
  onMove: (id: string, at: LatLng) => void;
  onPickRoute: (index: number) => void;
};

/** The Leaflet map. React owns the data; this component only draws it. */
export default function MapView({ base, trails, stops, auto, routes, routeIndex, selectedId, pinMode, flyTarget, onPin, onMove, onPickRoute }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const baseLayer = useRef<L.TileLayer | null>(null);
  const trailLayer = useRef<L.TileLayer | null>(null);
  const stopLayer = useRef(L.layerGroup());
  const autoLayer = useRef(L.layerGroup());
  const routeLayer = useRef(L.layerGroup());
  const handlers = useRef({ onPin, onMove, onPickRoute, pinMode });
  handlers.current = { onPin, onMove, onPickRoute, pinMode };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: [39.5, -98.35], zoom: 4, zoomControl: false, worldCopyJump: true });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    routeLayer.current.addTo(m); autoLayer.current.addTo(m); stopLayer.current.addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => { if (handlers.current.pinMode) handlers.current.onPin({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current; if (!m) return;
    baseLayer.current?.remove();
    const b = BASES[base];
    baseLayer.current = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom, subdomains: b.subdomains ?? "abc", className: b.className }).addTo(m);
    baseLayer.current.bringToBack();
  }, [base]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    trailLayer.current?.remove(); trailLayer.current = null;
    if (trails) trailLayer.current = L.tileLayer(TRAILS, { attribution: "© waymarkedtrails.org", maxZoom: 18, opacity: 0.85 }).addTo(m);
  }, [trails]);

  useEffect(() => { if (flyTarget) map.current?.flyTo([flyTarget.lat, flyTarget.lng], 12); }, [flyTarget]);

  useEffect(() => { el.current?.classList.toggle("pinning", pinMode); }, [pinMode]);

  useEffect(() => {
    const layer = stopLayer.current; layer.clearLayers();
    stops.forEach(stop => {
      const marker = L.marker([stop.lat, stop.lng], { icon: icon(stop.kind), draggable: true, title: stop.name, zIndexOffset: stop.id === selectedId ? 1000 : 500 });
      marker.bindTooltip(`${KIND_LABEL[stop.kind]} · ${stop.name}`, { direction: "top", offset: [0, -12], className: "wp-tip" });
      marker.on("dragend", () => { const p = marker.getLatLng(); handlers.current.onMove(stop.id, { lat: p.lat, lng: p.lng }); });
      marker.addTo(layer);
    });
  }, [stops, selectedId]);

  useEffect(() => {
    const layer = autoLayer.current; layer.clearLayers();
    auto.forEach(a => {
      const marker = L.marker([a.lat, a.lng], { icon: icon(a.kind, true), title: a.name, zIndexOffset: 100 });
      marker.bindTooltip(`${a.kind === "fuel" ? "Fuel" : "Overnight"} · ${a.name}${a.approx ? " (no station found: approximate)" : ""} · mile ${Math.round(a.atMile)}`, { direction: "top", offset: [0, -8], className: "wp-tip" });
      marker.addTo(layer);
    });
  }, [auto]);

  useEffect(() => {
    const m = map.current, layer = routeLayer.current; if (!m) return;
    layer.clearLayers();
    routes.forEach((route, i) => {
      if (i === routeIndex) return;
      L.polyline(route.line, { color: "#6b6b6b", weight: 5, opacity: 0.8 }).on("click", () => handlers.current.onPickRoute(i)).addTo(layer);
    });
    const chosen = routes[routeIndex];
    if (chosen) {
      const line = L.polyline(chosen.line, { color: "#8be0a6", weight: 5, opacity: 0.95 }).addTo(layer);
      const view = line.getBounds();
      if (!m.getBounds().contains(view)) m.fitBounds(view, { padding: [50, 50] });
    }
  }, [routes, routeIndex]);

  // A stop picked in the list: bring it into view.
  useEffect(() => {
    const stop = stops.find(s => s.id === selectedId);
    if (stop && map.current && !map.current.getBounds().contains([stop.lat, stop.lng])) map.current.panTo([stop.lat, stop.lng]);
  }, [selectedId, stops]);

  return <div ref={el} className="wp-map" />;
}
