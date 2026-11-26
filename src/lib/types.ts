export type StopKind = "start" | "end" | "leisure" | "overnight" | "fuel" | "food" | "other";

export type LatLng = { lat: number; lng: number };

/** A stop the person placed. The first is the start, the last is the end. */
export type Stop = LatLng & { id: string; kind: StopKind; name: string };

export type Settings = {
  mpg: number;
  tankGallons: number;
  startFuelPct: number;   // how full the tank is at the start, 0-100
  reservePct: number;     // never plan to run lower than this, 0-100 of a tank
  gasPrice: number;       // dollars per gallon
  maxDriveHours: number;  // longest driving day before an overnight is suggested
};

export const DEFAULT_SETTINGS: Settings = { mpg: 25, tankGallons: 14, startFuelPct: 100, reservePct: 15, gasPrice: 3.4, maxDriveHours: 8 };

/** A drivable route from the routing service. `line` is [lat, lng] pairs; `cum` is the miles driven at each point of `line`. */
export type Route = { miles: number; seconds: number; line: [number, number][]; cum: number[]; legMiles: number[]; legSeconds: number[] };

/** A suggested stop worked out from the route: fuel or an overnight. `atMile` is how far along the route it sits. */
export type AutoStop = LatLng & { id: string; kind: "fuel" | "overnight"; name: string; atMile: number; approx: boolean };

export type SavedTrip = { id: string; name: string; savedAt: string; stops: Stop[]; settings: Settings; routeIndex: number; miles: number };
