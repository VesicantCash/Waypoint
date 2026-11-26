import { project, pointAtMile, sampleBetween } from "./geo";
import type { AutoStop, Route, Settings, Stop } from "./types";
import type { Place } from "./services";

/** Finds the fuel stations along a stretch of route. Injected so the planner can be tested without the network. */
export type FuelFinder = (corridor: [number, number][]) => Promise<Place[]>;
export type LodgingFinder = (at: { lat: number; lng: number }) => Promise<Place[]>;

const MAX_OFF_ROUTE_MILES = 2.5;

export const rangeMiles = (s: Settings) => s.mpg * s.tankGallons;

/**
 * Works out where to fill up. Drive until only the reserve is left, then stop at the farthest station you can reach on what is left.
 * Fuel stops you placed yourself (`fills`, as miles along the route) count as fill-ups. If no station is found in that stretch the stop is marked `approx`: the point on the route where you'll need fuel.
 */
export async function planFuel(route: Route, s: Settings, find: FuelFinder, fills: number[] = []): Promise<AutoStop[]> {
  const full = rangeMiles(s), reserve = full * s.reservePct / 100;
  if (!(full > 0) || full - reserve < 10) return [];
  const stops: AutoStop[] = [];
  let pos = 0, fuel = full * Math.min(100, Math.max(0, s.startFuelPct)) / 100;
  for (let guard = 0; guard < 60; guard++) {
    const limit = pos + fuel - reserve;
    if (limit >= route.miles) break;
    const fill = fills.filter(m => m > pos + 1 && m <= limit).sort((a, b) => a - b)[0]; // a fuel stop you placed counts as a fill-up
    if (fill !== undefined) { pos = fill; fuel = full; continue; }
    if (limit <= pos + 1) { // starting with less fuel than the reserve: fill up right away
      const here = pointAtMile(route, pos);
      stops.push({ id: `fuel-${stops.length}`, kind: "fuel", name: "Fuel up here", lat: here.lat, lng: here.lng, atMile: pos, approx: true });
      fuel = full; continue;
    }
    let best: { place: Place; mile: number } | null = null;
    for (const from of [pos + (limit - pos) * 0.55, pos + 1]) {
      const span = limit - from;
      const places = await find(sampleBetween(route, from, limit, Math.min(120, Math.max(2, Math.ceil(span / 4) + 1))));
      for (const place of places) {
        const at = project(route, place);
        if (at.off > MAX_OFF_ROUTE_MILES || at.mile <= pos + 1 || at.mile > limit) continue;
        if (!best || at.mile > best.mile) best = { place, mile: at.mile };
      }
      if (best) break;
    }
    if (best) stops.push({ id: `fuel-${stops.length}`, kind: "fuel", name: best.place.name, lat: best.place.lat, lng: best.place.lng, atMile: best.mile, approx: false });
    else { const p = pointAtMile(route, limit); stops.push({ id: `fuel-${stops.length}`, kind: "fuel", name: "Fuel needed around here", lat: p.lat, lng: p.lng, atMile: limit, approx: true }); }
    pos = stops[stops.length - 1].atMile; fuel = full;
  }
  return stops;
}

/** The mile each of your stops sits at along the route (the stops are route waypoints, so it is the running total of the legs). */
export function stopMiles(route: Route): number[] {
  const out = [0];
  for (const m of route.legMiles) out.push(out[out.length - 1] + m);
  return out;
}

/**
 * Where each driving day ends. A day ends at an overnight stop you placed, or, when a day would run past your daily limit,
 * at the mile where the limit is reached (a suggested overnight, looked up afterwards).
 */
export function planDays(route: Route, stops: Stop[], maxHours: number): { mile: number; stopId?: string }[] {
  if (!(maxHours > 0) || route.miles <= 0) return [];
  const miles = stopMiles(route), perMile = route.seconds / route.miles, limit = maxHours * 3600;
  const fixed = stops.flatMap((s, i) => s.kind === "overnight" && i > 0 && i < stops.length - 1 && miles[i] !== undefined ? [{ mile: miles[i], stopId: s.id }] : []);
  const out: { mile: number; stopId?: string }[] = [];
  let from = 0;
  for (const cut of [...fixed.map(f => f.mile), route.miles]) {
    while ((cut - from) * perMile > limit + 60) { from += limit / perMile; out.push({ mile: from }); }
    const fixedHere = fixed.find(f => f.mile === cut);
    if (fixedHere) { out.push(fixedHere); from = cut; }
  }
  return out;
}

/** For each suggested overnight, the hotel or motel nearest the route around that mile (or the bare point if none is found). */
export async function planOvernights(route: Route, days: { mile: number; stopId?: string }[], find: LodgingFinder): Promise<AutoStop[]> {
  const out: AutoStop[] = [];
  for (const day of days) {
    if (day.stopId) continue;
    const at = pointAtMile(route, day.mile);
    let pick: Place | null = null;
    try {
      let bestScore = Infinity;
      for (const place of await find(at)) {
        const on = project(route, place);
        if (on.off > 8) continue;
        const score = Math.abs(on.mile - day.mile) + on.off * 2 + (on.mile > day.mile ? 25 : 0); // prefer stopping a little early over going past the limit
        if (score < bestScore) { bestScore = score; pick = place; }
      }
    } catch { /* the lodging lookup is a nicety: fall through to the bare point */ }
    out.push(pick
      ? { id: `night-${out.length}`, kind: "overnight", name: pick.name, lat: pick.lat, lng: pick.lng, atMile: project(route, pick).mile, approx: false }
      : { id: `night-${out.length}`, kind: "overnight", name: "Overnight around here", lat: at.lat, lng: at.lng, atMile: day.mile, approx: true });
  }
  return out;
}

export type Totals = { miles: number; seconds: number; gallons: number; cost: number; fuelStops: number; nights: number; gallonsToBuy: number };

export function totals(route: Route | null, s: Settings, auto: AutoStop[], stops: Stop[]): Totals {
  const miles = route?.miles ?? 0, gallons = s.mpg > 0 ? miles / s.mpg : 0;
  const startGallons = s.tankGallons * s.startFuelPct / 100;
  const nights = auto.filter(a => a.kind === "overnight").length + stops.filter((x, i) => x.kind === "overnight" && i > 0 && i < stops.length - 1).length;
  return { miles, seconds: route?.seconds ?? 0, gallons, cost: gallons * s.gasPrice, fuelStops: auto.filter(a => a.kind === "fuel").length + stops.filter(x => x.kind === "fuel").length, nights, gallonsToBuy: Math.max(0, gallons - startGallons) };
}

export type ItineraryItem = { id: string; kind: Stop["kind"] | AutoStop["kind"]; name: string; mile: number; auto: boolean; approx?: boolean };
export type ItineraryDay = { day: number; startMile: number; endMile: number; seconds: number; items: ItineraryItem[] };

/** The trip laid out day by day: your stops and the suggested fuel / overnight stops in driving order, split at each overnight. */
export function buildItinerary(route: Route, stops: Stop[], auto: AutoStop[]): ItineraryDay[] {
  const miles = stopMiles(route), perMile = route.seconds / Math.max(route.miles, 1e-9);
  const items: ItineraryItem[] = [
    ...stops.map((s, i) => ({ id: s.id, kind: s.kind, name: s.name, mile: miles[i] ?? route.miles, auto: false })),
    ...auto.map(a => ({ id: a.id, kind: a.kind, name: a.name, mile: a.atMile, auto: true, approx: a.approx })),
  ].sort((a, b) => a.mile - b.mile || (a.kind === "start" ? -1 : b.kind === "start" ? 1 : 0));
  const days: ItineraryDay[] = [];
  let current: ItineraryDay = { day: 1, startMile: 0, endMile: 0, seconds: 0, items: [] };
  items.forEach((item, index) => {
    current.items.push(item); current.endMile = item.mile;
    if (item.kind === "overnight" && index < items.length - 1) {
      current.seconds = (current.endMile - current.startMile) * perMile; days.push(current);
      current = { day: days.length + 1, startMile: item.mile, endMile: item.mile, seconds: 0, items: [{ ...item, id: `${item.id}-morning`, name: `Leave ${item.name}`, auto: false, approx: false }] };
    }
  });
  current.seconds = (current.endMile - current.startMile) * perMile; days.push(current);
  return days;
}

/** Where in your list of stops a new stop belongs so the route still runs start to end in order. */
export function insertIndex(route: Route, stops: Stop[], at: { lat: number; lng: number }): number {
  const mile = project(route, at).mile, miles = stopMiles(route);
  for (let i = 1; i < stops.length; i++) if (mile < (miles[i] ?? Infinity)) return i;
  return Math.max(1, stops.length - 1);
}
