# Waypoint

A personal road trip planner. Drop pins anywhere on a US map, and Waypoint draws the drive, adds the gas stops and overnights it works out you'll need, and keeps the miles, drive time, fuel used and fuel cost up to date as you change anything. Trips can be saved and reopened later.

## What it does

- **Pin-point stops.** Click the map (or search a town or address) to place a start, an end and any number of stops: leisure, overnight, fuel, food or other. Drag any pin to move it. Reorder, rename or remove stops in the list.
- **Detailed maps.** Dark, Streets and Topo base maps, plus a Trails overlay. The Streets and Topo maps draw every road down to farm tracks and marked footpaths.
- **Live totals.** Distance, drive time, fuel used and fuel cost, number of fuel stops and overnights. Everything recalculates when you move a pin, switch route, or change the vehicle.
- **Automatic gas stops.** From your mpg, tank size, how full the tank is at the start and the reserve you want to keep, Waypoint finds real stations along the route and stops you at the farthest one you can reach without touching the reserve. A fuel stop you place yourself counts as a fill-up.
- **Automatic overnights.** Set the longest driving day you want; a hotel or motel near that mile is suggested where each day should end. An overnight you place yourself replaces the suggestion. Press **Pin** on any suggestion to make it one of your stops.
- **Day by day.** The whole trip laid out by day with miles and drive time.
- **Route choices.** When the road network offers an alternative, pick it from the list or by clicking the grey line on the map.
- **Save and recall.** Save trips, reopen them, export a backup file and import it on another device.
- **Open in Google Maps** for turn-by-turn on your phone.

## Data sources

All free and keyless, all OpenStreetMap based:

| Need | Service |
| --- | --- |
| Map tiles | OpenStreetMap (the Dark style is the same map darkened in the browser), OpenTopoMap, Waymarked Trails |
| Driving routes | OSRM public server |
| Gas stations and hotels | Overpass API |
| Place search and pin names | Nominatim |

These are shared public servers meant for light personal use. If you ever outgrow them, each is a single function in `src/lib/services.ts` that can be pointed at a paid or self-hosted equivalent.

Trips are stored in this browser (local storage). Use Export backup on the Saved trips page to keep a copy or move them between devices.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # planner checks (fuel stops, overnights, totals, day split)
npm run build      # type check and production build into dist/
```

## Deploy

Import the repository into Vercel. It is detected as a Vite project; the defaults (build `npm run build`, output `dist`) are already set in `vercel.json`. No environment variables are needed.
