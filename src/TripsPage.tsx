import { useRef, useState } from "react";
import { fmtMiles } from "./lib/geo";
import { parseBackup } from "./lib/trips";
import type { SavedTrip } from "./lib/types";

type Props = { trips: SavedTrip[]; currentId: string | null; onOpen: (t: SavedTrip) => void; onDelete: (id: string) => void; onImport: (t: SavedTrip[]) => void };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function TripsPage({ trips, currentId, onOpen, onDelete, onImport }: Props) {
  const [sure, setSure] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ app: "waypoint", exportedAt: new Date().toISOString(), trips }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `waypoint-trips-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const result = parseBackup(await f.text());
    if ("error" in result) setMessage(result.error); else { onImport(result.trips); setMessage(`Added ${result.trips.length} trip${result.trips.length === 1 ? "" : "s"}.`); }
    if (file.current) file.current.value = "";
  };

  return <main className="wp-trips">
    <header className="wp-head">
      <div><span className="wp-eyebrow">Road trips</span><h1>Saved trips</h1></div>
      <div className="wp-head-actions">
        <button className="wp-btn" onClick={exportAll} disabled={!trips.length}>Export backup</button>
        <button className="wp-btn" onClick={() => file.current?.click()}>Import backup</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => void importFile(e.target.files?.[0])} />
      </div>
    </header>
    {message && <p className="wp-note" role="status">{message}</p>}
    {trips.length === 0 ? <p className="wp-empty big">No saved trips yet. Plan one in the Planner and press Save trip.</p>
      : <ul className="wp-trip-list">{trips.map(t => <li key={t.id} className={t.id === currentId ? "cur" : ""}>
        <div className="wp-trip-main"><h3>{t.name}</h3>
          <p>{t.stops[0]?.name ?? "—"} → {t.stops[t.stops.length - 1]?.name ?? "—"}</p>
          <small>{t.stops.length} stops{t.miles ? ` · ${fmtMiles(t.miles)}` : ""} · saved {when(t.savedAt)}</small></div>
        <div className="wp-trip-actions">
          <button className="wp-btn solid" onClick={() => onOpen(t)}>Open</button>
          {sure === t.id ? <><button className="wp-btn danger" onClick={() => { onDelete(t.id); setSure(null); }}>Delete it</button><button className="wp-btn" onClick={() => setSure(null)}>Keep</button></>
            : <button className="wp-btn danger" onClick={() => setSure(t.id)} aria-label={`Delete ${t.name}`}>Delete</button>}
        </div>
      </li>)}</ul>}
  </main>;
}
