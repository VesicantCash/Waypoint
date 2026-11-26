import { makeRoute } from "./geo";
import type { LatLng, Route, Stop } from "./types";

/**
 * The three free OpenStreetMap-based services the planner talks to. Each is a plain fetch so it can be swapped for a paid one later.
 *  - OSRM for driving routes (public demo server: fine for personal use, not for heavy traffic)
 *  - Overpass for fuel stations and lodging along the route
 *  - Nominatim for searching a place name and naming a pin
 */
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const NOMINATIM = "https://nominatim.openstreetmap.org";

const M_PER_MI = 1609.344;

export async function fetchRoutes(stops: LatLng[], signal?: AbortSignal): Promise<Route[]> {
  if (stops.length < 2) return [];
  const coords = stops.map(s => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(";");
  const response = await fetch(`${OSRM}/${coords}?overview=full&geometries=geojson&alternatives=true&steps=false`, { signal });
  if (!response.ok) throw new Error(`The routing service answered ${response.status}.`);
  const data = await response.json() as { code: string; message?: string; routes?: { duration: number; geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[] };
  if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.code === "NoRoute" ? "There is no drivable road between those stops." : data.message || "No route found.");
  return data.routes.map(r => makeRoute(r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]), r.duration, r.legs.map(l => l.distance / M_PER_MI), r.legs.map(l => l.duration)));
}

type OverpassElement = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

async function overpass(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  let last: unknown = null;
  for (const url of OVERPASS) {
    try {
      const response = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), signal });
      if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
      return (await response.json() as { elements: OverpassElement[] }).elements;
    } catch (error) { if ((error as Error).name === "AbortError") throw error; last = error; }
  }
  throw last instanceof Error ? last : new Error("The map data service didn't answer.");
}

export type Place = LatLng & { name: string };

const toPlace = (e: OverpassElement, fallback: string): Place | null => {
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (lat === undefined || lng === undefined) return null;
  const t = e.tags ?? {};
  const label = t.brand || t.name || t.operator || fallback;
  return { lat, lng, name: t.name && t.brand && t.name !== t.brand ? `${t.brand} · ${t.name}` : label };
};

/** Fuel stations within about 2.5 miles of a stretch of the route (a list of [lat, lng] points). */
export async function findFuel(corridor: [number, number][], signal?: AbortSignal): Promise<Place[]> {
  const line = corridor.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(",");
  const elements = await overpass(`[out:json][timeout:25];nwr["amenity"="fuel"](around:4000,${line});out center 120;`, signal);
  return elements.map(e => toPlace(e, "Gas station")).filter((p): p is Place => p !== null);
}

/** Hotels and motels within `radiusMiles` of a point. */
export async function findLodging(at: LatLng, radiusMiles = 15, signal?: AbortSignal): Promise<Place[]> {
  const elements = await overpass(`[out:json][timeout:25];nwr["tourism"~"^(hotel|motel)$"](around:${Math.round(radiusMiles * M_PER_MI)},${at.lat},${at.lng});out center 60;`, signal);
  return elements.map(e => toPlace(e, "Hotel")).filter((p): p is Place => p !== null);
}

type NominatimHit = { lat: string; lon: string; display_name: string };

const shortName = (hit: NominatimHit) => hit.display_name.split(",").slice(0, 3).join(",").trim();

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const response = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&countrycodes=us&q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error("The place search didn't answer.");
  return (await response.json() as NominatimHit[]).map(hit => ({ lat: Number(hit.lat), lng: Number(hit.lon), name: shortName(hit) }));
}

export async function nameForPoint(at: LatLng, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=14&lat=${at.lat}&lon=${at.lng}`, { signal });
    if (!response.ok) return null;
    const hit = await response.json() as NominatimHit & { error?: string };
    return hit.error ? null : shortName(hit);
  } catch { return null; }
}

export const googleMapsUrl = (stops: Stop[]) =>
  stops.length < 2 ? "" : `https://www.google.com/maps/dir/${stops.map(s => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`).join("/")}`;
