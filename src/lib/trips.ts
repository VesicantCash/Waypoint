import { DEFAULT_SETTINGS, type SavedTrip, type Stop } from "./types";

const KEY = "waypoint:trips";

export function loadTrips(): SavedTrip[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedTrip[];
    return Array.isArray(list) ? list.filter(t => t && typeof t.id === "string" && Array.isArray(t.stops)).map(t => ({ ...t, settings: { ...DEFAULT_SETTINGS, ...t.settings } })) : [];
  } catch { return []; }
}

export function storeTrips(trips: SavedTrip[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(trips)); return true; } catch { return false; }
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** First stop is the start, last is the end, everything between keeps its kind (but is never start or end). */
export function normalizeKinds(stops: Stop[]): Stop[] {
  return stops.map((s, i) => {
    if (i === 0) return s.kind === "start" ? s : { ...s, kind: "start" };
    if (i === stops.length - 1) return s.kind === "end" ? s : { ...s, kind: "end" };
    return s.kind === "start" || s.kind === "end" ? { ...s, kind: "leisure" } : s;
  });
}

/** Reads a backup file; returns the trips in it, or an error message. */
export function parseBackup(text: string): { trips: SavedTrip[] } | { error: string } {
  try {
    const data = JSON.parse(text) as { trips?: SavedTrip[] } | SavedTrip[];
    const list = Array.isArray(data) ? data : data.trips;
    if (!Array.isArray(list)) return { error: "That file isn't a Waypoint backup." };
    const trips = list.filter(t => t && typeof t.name === "string" && Array.isArray(t.stops) && t.stops.every(s => typeof s.lat === "number" && typeof s.lng === "number"))
      .map(t => ({ ...t, id: newId(), settings: { ...DEFAULT_SETTINGS, ...t.settings }, routeIndex: t.routeIndex ?? 0, miles: t.miles ?? 0 }));
    return trips.length ? { trips } : { error: "No trips found in that file." };
  } catch { return { error: "That file couldn't be read." }; }
}
