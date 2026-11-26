import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { KIND_COLOR, KIND_LABEL, type BaseLayer } from "./MapView";
import TripsPage from "./TripsPage";
import { fmtDuration, fmtMiles, money } from "./lib/geo";
import { buildItinerary, insertIndex, planDays, planFuel, planOvernights, stopMiles, totals } from "./lib/planner";
import { fetchRoutes, findFuel, findLodging, googleMapsUrl, nameForPoint, searchPlaces, type Place } from "./lib/services";
import { loadTrips, newId, normalizeKinds, storeTrips } from "./lib/trips";
import { DEFAULT_SETTINGS, type AutoStop, type LatLng, type Route, type SavedTrip, type Settings, type Stop, type StopKind } from "./lib/types";

type View = "planner" | "trips";
const ADDABLE: StopKind[] = ["leisure", "overnight", "fuel", "food", "other"];
const message = (e: unknown, fallback: string) => e instanceof Error && e.name !== "AbortError" ? e.message : fallback;

export default function App() {
  const [view, setView] = useState<View>("planner");
  const [stops, setStops] = useState<Stop[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeIndex, setRouteIndex] = useState(0);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [auto, setAuto] = useState<AutoStop[]>([]);
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState("");
  const [name, setName] = useState("Untitled trip");
  const [tripId, setTripId] = useState<string | null>(null);
  const [trips, setTrips] = useState<SavedTrip[]>(loadTrips);
  const [note, setNote] = useState("");
  const [pinMode, setPinMode] = useState(true);
  const [addKind, setAddKind] = useState<StopKind>("leisure");
  const [base, setBase] = useState<BaseLayer>("dark");
  const [trails, setTrails] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fly, setFly] = useState<(LatLng & { n: number }) | null>(null);
  const wantRoute = useRef(0);

  const route = routes[routeIndex] ?? null;
  const flash = useCallback((text: string) => { setNote(text); window.setTimeout(() => setNote(current => current === text ? "" : current), 3500); }, []);

  // ── The route follows the stops. ────────────────────────────────────────────────────────────────────────────────────
  const stopKey = stops.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
  useEffect(() => {
    if (stops.length < 2) { setRoutes([]); setRouteError(""); setRouting(false); return; }
    const ctl = new AbortController();
    setRouting(true);
    const timer = window.setTimeout(() => {
      fetchRoutes(stops, ctl.signal)
        .then(found => { setRoutes(found); setRouteIndex(Math.min(wantRoute.current, found.length - 1)); wantRoute.current = 0; setRouteError(""); })
        .catch(e => { if ((e as Error).name !== "AbortError") { setRoutes([]); setRouteError(message(e, "Couldn't get a route.")); } })
        .finally(() => { if (!ctl.signal.aborted) setRouting(false); });
    }, 400);
    return () => { window.clearTimeout(timer); ctl.abort(); };
    // The route depends on where the stops are, not on their names or kinds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey]);

  // ── Fuel and overnight suggestions follow the route, the vehicle and the daily limit. ───────────────────────────────
  const planKey = useMemo(() => JSON.stringify([settings.mpg, settings.tankGallons, settings.startFuelPct, settings.reservePct, settings.maxDriveHours, stops.map(s => [s.id, s.kind])]), [settings, stops]);
  useEffect(() => {
    if (!route) { setAuto([]); setPlanNote(""); return; }
    const ctl = new AbortController();
    setPlanning(true);
    const timer = window.setTimeout(async () => {
      const miles = stopMiles(route);
      const fills = stops.flatMap((s, i) => s.kind === "fuel" ? [miles[i] ?? 0] : []);
      let missed = false;
      const fuelFinder = async (corridor: [number, number][]) => { try { return await findFuel(corridor, ctl.signal); } catch (e) { if ((e as Error).name === "AbortError") throw e; missed = true; return []; } };
      const lodgingFinder = async (at: LatLng) => { try { return await findLodging(at, 15, ctl.signal); } catch (e) { if ((e as Error).name === "AbortError") throw e; missed = true; return []; } };
      try {
        const fuel = await planFuel(route, settings, fuelFinder, fills);
        const nights = await planOvernights(route, planDays(route, stops, settings.maxDriveHours), lodgingFinder);
        if (ctl.signal.aborted) return;
        setAuto([...fuel, ...nights]);
        setPlanNote(missed ? "The station and hotel lookup didn't answer, so some suggestions are approximate points on the route. Change anything to try again." : "");
      } catch (e) { if ((e as Error).name !== "AbortError") setPlanNote(message(e, "Couldn't work out the stops.")); }
      finally { if (!ctl.signal.aborted) setPlanning(false); }
    }, 700);
    return () => { window.clearTimeout(timer); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, planKey]);

  const sum = useMemo(() => totals(route, settings, auto, stops), [route, settings, auto, stops]);
  const itinerary = useMemo(() => route && stops.length >= 2 ? buildItinerary(route, stops, auto) : [], [route, stops, auto]);

  // ── Editing the stops. ──────────────────────────────────────────────────────────────────────────────────────────────
  const nameLater = useCallback((id: string, at: LatLng) => {
    void nameForPoint(at).then(found => { if (found) setStops(cur => cur.map(s => s.id === id && s.name.startsWith("Pin at ") ? { ...s, name: found } : s)); });
  }, []);

  const addStop = useCallback((at: LatLng, label?: string, kind?: StopKind) => {
    const id = newId();
    setStops(cur => {
      const k: StopKind = cur.length === 0 ? "start" : cur.length === 1 ? "end" : kind ?? addKind;
      const stop: Stop = { id, kind: k, name: label ?? `Pin at ${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`, lat: at.lat, lng: at.lng };
      const live = route && route.legMiles.length === cur.length - 1 ? route : null;
      const at2 = cur.length < 2 || !live ? Math.max(cur.length - 1, 0) : insertIndex(live, cur, at);
      return normalizeKinds(cur.length < 2 ? [...cur, stop] : [...cur.slice(0, at2), stop, ...cur.slice(at2)]);
    });
    setSelectedId(id);
    if (!label) nameLater(id, at);
  }, [addKind, route, nameLater]);

  const moveStop = useCallback((id: string, at: LatLng) => {
    setStops(cur => cur.map(s => s.id === id ? { ...s, ...at, name: `Pin at ${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}` } : s));
    nameLater(id, at);
  }, [nameLater]);

  const patchStop = (id: string, patch: Partial<Stop>) => setStops(cur => normalizeKinds(cur.map(s => s.id === id ? { ...s, ...patch } : s)));
  const removeStop = (id: string) => setStops(cur => normalizeKinds(cur.filter(s => s.id !== id)));
  const shift = (index: number, by: number) => setStops(cur => {
    const to = index + by; if (to < 0 || to >= cur.length) return cur;
    const next = [...cur]; [next[index], next[to]] = [next[to], next[index]]; return normalizeKinds(next);
  });
  const reverse = () => setStops(cur => normalizeKinds([...cur].reverse().map((s, i, all) => i === 0 || i === all.length - 1 ? { ...s, kind: "leisure" as StopKind } : s)));
  const roundTrip = () => setStops(cur => cur.length < 1 ? cur : normalizeKinds([...cur.map((s, i) => i === cur.length - 1 && cur.length > 1 ? { ...s, kind: "leisure" as StopKind } : s), { ...cur[0], id: newId(), kind: "end" }]));

  const pinAuto = (a: AutoStop) => {
    if (!route || stops.length < 2) return;
    const id = newId();
    setStops(cur => { const i = insertIndex(route, cur, a); return normalizeKinds([...cur.slice(0, i), { id, kind: a.kind, name: a.name, lat: a.lat, lng: a.lng }, ...cur.slice(i)]); });
    flash(`${a.name} is now one of your stops.`);
  };

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    if (query.trim().length < 3) { setResults([]); setSearchError(""); return; }
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchPlaces(query.trim(), ctl.signal).then(found => { setResults(found); setSearchError(found.length ? "" : "Nothing found. Try a town and state."); })
        .catch(e => { if ((e as Error).name !== "AbortError") setSearchError(message(e, "Search failed.")); })
        .finally(() => { if (!ctl.signal.aborted) setSearching(false); });
    }, 500);
    return () => { window.clearTimeout(timer); ctl.abort(); };
  }, [query]);
  const pickResult = (place: Place) => { addStop(place, place.name); setFly({ lat: place.lat, lng: place.lng, n: Date.now() }); setQuery(""); setResults([]); };

  // ── Saving and recalling trips. ─────────────────────────────────────────────────────────────────────────────────────
  const save = (asNew: boolean) => {
    if (stops.length < 2) { flash("Add a start and an end before saving."); return; }
    const id = !asNew && tripId ? tripId : newId();
    const trip: SavedTrip = { id, name: name.trim() || "Untitled trip", savedAt: new Date().toISOString(), stops, settings, routeIndex, miles: sum.miles };
    const next = [trip, ...trips.filter(t => t.id !== id)];
    if (!storeTrips(next)) { flash("This browser wouldn't save the trip. Export a backup from Saved trips instead."); return; }
    setTrips(next); setTripId(id); flash(`Saved “${trip.name}”.`);
  };
  const open = (trip: SavedTrip) => {
    wantRoute.current = trip.routeIndex ?? 0;
    setStops(normalizeKinds(trip.stops)); setSettings({ ...DEFAULT_SETTINGS, ...trip.settings }); setName(trip.name); setTripId(trip.id);
    setSelectedId(null); setView("planner"); flash(`Opened “${trip.name}”.`);
  };
  const reset = () => { wantRoute.current = 0; setStops([]); setName("Untitled trip"); setTripId(null); setAuto([]); setSelectedId(null); setQuery(""); };
  const removeTrip = (id: string) => { const next = trips.filter(t => t.id !== id); storeTrips(next); setTrips(next); if (tripId === id) setTripId(null); };
  const addTrips = (more: SavedTrip[]) => { const next = [...more, ...trips]; storeTrips(next); setTrips(next); };

  const set = <K extends keyof Settings>(key: K, value: number) => setSettings(cur => ({ ...cur, [key]: Number.isFinite(value) ? value : 0 }));
  const status = routing ? "Finding the route…" : routeError ? routeError : planning ? "Working out fuel and overnight stops…" : "";

  return <div className="wp-app">
    <aside className="wp-side">
      <div className="wp-brand"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden><path d="M16 4a8 8 0 0 0-8 8c0 6 8 16 8 16s8-10 8-16a8 8 0 0 0-8-8z" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="16" cy="12" r="3" fill="currentColor" /></svg><div><b>WAYPOINT</b><small>Road trip planner</small></div></div>
      <nav>
        <p className="wp-label">Plan</p>
        <button className={view === "planner" ? "active" : ""} onClick={() => setView("planner")}>Planner</button>
        <button className={view === "trips" ? "active" : ""} onClick={() => setView("trips")}>Saved trips <em>{trips.length || ""}</em></button>
      </nav>
      <p className="wp-side-note">Maps and routes from OpenStreetMap. Trips are saved in this browser.</p>
    </aside>

    {view === "trips" ? <TripsPage trips={trips} currentId={tripId} onOpen={open} onDelete={removeTrip} onImport={addTrips} /> : <main className="wp-main">
      <section className="wp-mapwrap">
        <MapView base={base} trails={trails} stops={stops} auto={auto} routes={routes} routeIndex={routeIndex} selectedId={selectedId} pinMode={pinMode} flyTarget={fly}
          onPin={at => addStop(at)} onMove={moveStop} onPickRoute={setRouteIndex} />
        <div className="wp-maptools">
          <div className="wp-seg" role="group" aria-label="Map style">{([["dark", "Dark"], ["streets", "Streets"], ["topo", "Topo"]] as const).map(([id, label]) => <button key={id} className={base === id ? "on" : ""} onClick={() => setBase(id)}>{label}</button>)}</div>
          <button className={`wp-chip${trails ? " on" : ""}`} onClick={() => setTrails(v => !v)} aria-pressed={trails} title="Show marked hiking trails on the map">Trails</button>
          <button className={`wp-chip${pinMode ? " on" : ""}`} onClick={() => setPinMode(v => !v)} aria-pressed={pinMode} title="When on, clicking the map drops a stop">Pin mode</button>
          {pinMode && stops.length >= 2 && <select className="wp-kind" value={addKind} onChange={e => setAddKind(e.target.value as StopKind)} aria-label="Kind of stop to drop">{ADDABLE.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>}
        </div>
        {pinMode && <p className="wp-hint">{stops.length === 0 ? "Click the map to drop your start." : stops.length === 1 ? "Click the map to drop your end." : `Click the map to drop a ${KIND_LABEL[addKind].toLowerCase()} stop. Drag any pin to move it.`}</p>}
        {status && <p className={`wp-status${routeError ? " bad" : ""}`} role="status">{status}</p>}
      </section>

      <section className="wp-panel">
        <header className="wp-head">
          <div><span className="wp-eyebrow">Road trip</span><input className="wp-name" value={name} onChange={e => setName(e.target.value)} aria-label="Trip name" /></div>
          <div className="wp-head-actions">
            <button className="wp-btn solid" onClick={() => save(false)}>{tripId ? "Save" : "Save trip"}</button>
            {tripId && <button className="wp-btn" onClick={() => save(true)}>Save as new</button>}
            <button className="wp-btn" onClick={reset}>New</button>
          </div>
        </header>
        {note && <p className="wp-note" role="status">{note}</p>}

        <div className="wp-search">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a town, address or place to add a stop" aria-label="Search for a place" />
          {(results.length > 0 || searching || searchError) && <ul className="wp-results">
            {searching && <li className="muted">Searching…</li>}
            {results.map((r, i) => <li key={i}><button onClick={() => pickResult(r)}>{r.name}</button></li>)}
            {!searching && searchError && <li className="muted">{searchError}</li>}
          </ul>}
        </div>

        <div className="wp-totals">
          <div><span>Distance</span><strong>{route ? fmtMiles(sum.miles) : "—"}</strong></div>
          <div><span>Drive time</span><strong>{route ? fmtDuration(sum.seconds) : "—"}</strong></div>
          <div><span>Fuel used</span><strong>{route ? `${sum.gallons.toFixed(1)} gal` : "—"}</strong></div>
          <div><span>Fuel cost</span><strong>{route ? money(sum.cost) : "—"}</strong></div>
          <div><span>Fuel stops</span><strong>{route ? sum.fuelStops : "—"}</strong></div>
          <div><span>Overnights</span><strong>{route ? sum.nights : "—"}</strong></div>
        </div>
        {route && sum.gallonsToBuy > 0 && <p className="wp-sub">You'll need to buy about {sum.gallonsToBuy.toFixed(1)} gal ({money(sum.gallonsToBuy * settings.gasPrice)}) on top of the tank you start with.</p>}
        {routes.length > 1 && <div className="wp-routes" role="group" aria-label="Route choices">{routes.map((r, i) => <button key={i} className={i === routeIndex ? "on" : ""} onClick={() => setRouteIndex(i)}>{i === 0 ? "Fastest" : `Option ${i + 1}`}<small>{fmtMiles(r.miles)} · {fmtDuration(r.seconds)}</small></button>)}</div>}
        {planNote && <p className="wp-warn">{planNote}</p>}

        <h2 className="wp-h"><i>01</i>Stops<small>{stops.length ? `${stops.length}` : ""}</small></h2>
        {stops.length === 0 && <p className="wp-empty">No stops yet. Click the map or search above to place your start.</p>}
        <ol className="wp-stops">{stops.map((s, i) => <li key={s.id} className={selectedId === s.id ? "sel" : ""} onClick={() => setSelectedId(s.id)}>
          <span className="wp-badge" style={{ background: KIND_COLOR[s.kind] }}>{i === 0 ? "S" : i === stops.length - 1 && stops.length > 1 ? "E" : i}</span>
          <div className="wp-stop-main">
            <input value={s.name} onChange={e => patchStop(s.id, { name: e.target.value })} aria-label={`Name of stop ${i + 1}`} />
            <div className="wp-stop-row">
              {s.kind === "start" || s.kind === "end" ? <span className="wp-kindtag">{KIND_LABEL[s.kind]}</span>
                : <select value={s.kind} onChange={e => patchStop(s.id, { kind: e.target.value as StopKind })} aria-label={`Kind of stop ${i + 1}`}>{ADDABLE.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>}
              <span className="wp-grow" />
              <button onClick={e => { e.stopPropagation(); shift(i, -1); }} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
              <button onClick={e => { e.stopPropagation(); shift(i, 1); }} disabled={i === stops.length - 1} aria-label="Move down" title="Move down">↓</button>
              <button className="danger" onClick={e => { e.stopPropagation(); removeStop(s.id); }} aria-label={`Remove ${s.name}`} title="Remove">✕</button>
            </div>
          </div>
        </li>)}</ol>
        {stops.length >= 2 && <div className="wp-tools">
          <button className="wp-btn" onClick={reverse}>Reverse trip</button>
          <button className="wp-btn" onClick={roundTrip}>Return to start</button>
          <a className="wp-btn" href={googleMapsUrl(stops)} target="_blank" rel="noreferrer">Open in Google Maps</a>
        </div>}

        <h2 className="wp-h"><i>02</i>Vehicle and fuel</h2>
        <div className="wp-fields">
          <label>Miles per gallon<input type="number" min="1" step="0.5" value={settings.mpg} onChange={e => set("mpg", e.target.valueAsNumber)} /></label>
          <label>Tank size (gal)<input type="number" min="1" step="0.5" value={settings.tankGallons} onChange={e => set("tankGallons", e.target.valueAsNumber)} /></label>
          <label>Tank at start (%)<input type="number" min="0" max="100" step="5" value={settings.startFuelPct} onChange={e => set("startFuelPct", e.target.valueAsNumber)} /></label>
          <label>Keep in reserve (%)<input type="number" min="0" max="50" step="5" value={settings.reservePct} onChange={e => set("reservePct", e.target.valueAsNumber)} /></label>
          <label>Gas price ($/gal)<input type="number" min="0" step="0.05" value={settings.gasPrice} onChange={e => set("gasPrice", e.target.valueAsNumber)} /></label>
          <label>Longest driving day (h)<input type="number" min="1" max="24" step="0.5" value={settings.maxDriveHours} onChange={e => set("maxDriveHours", e.target.valueAsNumber)} /></label>
        </div>
        <p className="wp-sub">Range on a full tank: {Math.round(settings.mpg * settings.tankGallons)} mi. Fuel stops are planned so you never dip into the reserve.</p>

        <h2 className="wp-h"><i>03</i>Day by day</h2>
        {itinerary.length === 0 ? <p className="wp-empty">Add a start and an end to see the trip laid out by day.</p>
          : itinerary.map(day => <section key={day.day} className="wp-day">
            <header><b>Day {day.day}</b><span>{fmtMiles(day.endMile - day.startMile)} · {fmtDuration(day.seconds)}</span></header>
            <ul>{day.items.map(item => <li key={item.id} className={item.auto ? "auto" : ""}>
              <i style={{ background: KIND_COLOR[item.kind] }} />
              <span className="wp-mile">mi {Math.round(item.mile)}</span>
              <span className="wp-it-name">{item.name}{item.auto && <em>{item.approx ? " · suggested point" : " · suggested"}</em>}</span>
              {item.auto && <button className="wp-pin-btn" onClick={() => { const a = auto.find(x => x.id === item.id); if (a) pinAuto(a); }} title="Make this one of your stops">Pin</button>}
            </li>)}</ul>
          </section>)}
      </section>
    </main>}
  </div>;
}
