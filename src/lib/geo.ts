import type { LatLng, Route } from "./types";

const R_MI = 3958.8;
const rad = (d: number) => d * Math.PI / 180;

/** Great-circle distance in miles. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Builds the route object from the raw line: miles driven at every point. */
export function makeRoute(line: [number, number][], seconds: number, legMiles: number[], legSeconds: number[]): Route {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] }));
  return { miles: cum[cum.length - 1] ?? 0, seconds, line, cum, legMiles, legSeconds };
}

/** The point on the route after driving `mile` miles. */
export function pointAtMile(route: Route, mile: number): LatLng {
  const { line, cum } = route;
  if (!line.length) return { lat: 0, lng: 0 };
  if (mile <= 0) return { lat: line[0][0], lng: line[0][1] };
  if (mile >= cum[cum.length - 1]) return { lat: line[line.length - 1][0], lng: line[line.length - 1][1] };
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= mile) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo] || 1, t = (mile - cum[lo]) / span;
  return { lat: line[lo][0] + (line[hi][0] - line[lo][0]) * t, lng: line[lo][1] + (line[hi][1] - line[lo][1]) * t };
}

/** Where a point sits along the route: the mile of the nearest route point, and how far off the route it is (miles). */
export function project(route: Route, p: LatLng): { mile: number; off: number } {
  let best = Infinity, mile = 0;
  // Coarse then fine: the line can have tens of thousands of points.
  const step = Math.max(1, Math.floor(route.line.length / 4000));
  let bestI = 0;
  for (let i = 0; i < route.line.length; i += step) {
    const d = (route.line[i][0] - p.lat) ** 2 + ((route.line[i][1] - p.lng) * Math.cos(rad(p.lat))) ** 2;
    if (d < best) { best = d; bestI = i; }
  }
  if (step > 1) for (let i = Math.max(0, bestI - step); i <= Math.min(route.line.length - 1, bestI + step); i++) {
    const d = (route.line[i][0] - p.lat) ** 2 + ((route.line[i][1] - p.lng) * Math.cos(rad(p.lat))) ** 2;
    if (d < best) { best = d; bestI = i; }
  }
  mile = route.cum[bestI] ?? 0;
  return { mile, off: haversine(p, { lat: route.line[bestI][0], lng: route.line[bestI][1] }) };
}

/** Roughly n evenly spaced [lat, lng] points of the route between two miles (for a corridor search). */
export function sampleBetween(route: Route, fromMile: number, toMile: number, n = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) { const p = pointAtMile(route, fromMile + (toMile - fromMile) * (i / (n - 1))); out.push([p.lat, p.lng]); }
  return out;
}

export const fmtMiles = (m: number) => `${m >= 100 ? Math.round(m).toLocaleString("en-US") : m.toFixed(1)} mi`;
export function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60), h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
