import assert from "node:assert/strict";
import { makeRoute, pointAtMile, project } from "../src/lib/geo";
import { buildItinerary, insertIndex, planDays, planFuel, planOvernights, rangeMiles, totals } from "../src/lib/planner";
import { DEFAULT_SETTINGS, type Stop } from "../src/lib/types";

// A straight 700-mile road heading east at 35N, one point per mile-ish. 60 mph all the way.
const line: [number, number][] = [];
for (let i = 0; i <= 700; i++) line.push([35, -105 + i * (1 / 56.6)]);
const base = makeRoute(line, 0, [], []);
const miles = base.miles;
const route = makeRoute(line, miles / 60 * 3600, [miles / 2, miles / 2], [miles / 120 * 3600, miles / 120 * 3600]);
const s = { ...DEFAULT_SETTINGS, mpg: 20, tankGallons: 15, startFuelPct: 100, reservePct: 15, maxDriveHours: 8 }; // 300 mi range, 45 mi reserve

// A fuel station every 25 miles, some 1 mile off the road.
const stations = Array.from({ length: 40 }, (_, i) => { const p = pointAtMile(route, i * 25 + 10); return { lat: p.lat + 0.01, lng: p.lng, name: `Gas ${i}` }; });
const find = async (corridor: [number, number][]) => stations.filter(st => corridor.some(([lat, lng]) => Math.abs(lat - st.lat) < 0.2 && Math.abs(lng - st.lng) < 0.06));

const fuel = await planFuel(route, s, find);
assert.ok(fuel.length >= 2 && fuel.length <= 3, `700 mi on a 300 mi tank with a reserve needs 2-3 fills, got ${fuel.length}`);
let pos = 0;
for (const stop of fuel) { assert.ok(stop.atMile - pos <= rangeMiles(s) - 45 + 0.5, `gap ${stop.atMile - pos} is within the usable range`); assert.ok(!stop.approx, "a real station was found"); pos = stop.atMile; }
assert.ok(route.miles - pos <= rangeMiles(s) - 45 + 0.5, "the last stretch reaches the end");

// No stations at all: still plans the stops, marked approximate.
const none = await planFuel(route, s, async () => []);
assert.equal(none.length, fuel.length); assert.ok(none.every(x => x.approx));

// Half a tank to start: the first stop comes sooner.
const half = await planFuel(route, { ...s, startFuelPct: 50 }, find);
assert.ok(half[0].atMile < fuel[0].atMile, "starting low brings the first fill-up forward");

// A fuel stop you placed counts as a fill-up: filling at mile 200 pushes the next suggestion later.
const filled = await planFuel(route, s, find, [200]);
assert.ok(filled[0].atMile > 200 && filled[0].atMile > fuel[0].atMile, "the next stop comes after your own fill-up");

// A short trip needs no gas stop.
const shortRoute = makeRoute(line.slice(0, 100), 3600, [100], [3600]);
assert.equal((await planFuel(shortRoute, s, find)).length, 0);

// Days: 700 mi at 60 mph is 11.7 hours, so an 8-hour limit means one overnight, about mile 480.
const stops: Stop[] = [{ id: "a", kind: "start", name: "A", lat: 35, lng: -105 }, { id: "b", kind: "end", name: "B", lat: 35, lng: -92.6 }];
const days = planDays(route, stops, 8);
assert.equal(days.length, 1); assert.ok(Math.abs(days[0].mile - 480) < 5, `overnight near mile 480, got ${days[0].mile}`);
const lodging = [{ lat: 35.005, lng: pointAtMile(route, 470).lng, name: "Motel 6" }, { lat: 35.005, lng: pointAtMile(route, 520).lng, name: "Far Hotel" }];
const nights = await planOvernights(route, days, async () => lodging);
assert.equal(nights[0].name, "Motel 6", "prefers the motel just before the limit");
assert.equal((await planOvernights(route, days, async () => [])).at(0)?.approx, true);

// An overnight you placed replaces the suggestion for that day.
const mid = pointAtMile(route, route.miles / 2);
const withNight: Stop[] = [stops[0], { id: "n", kind: "overnight", name: "Mine", lat: mid.lat, lng: mid.lng }, stops[1]];
assert.equal(planDays(route, withNight, 8).filter(d => !d.stopId).length, 0, "350 mi each side is under 8 hours");
assert.equal(planDays(route, withNight, 8).find(d => d.stopId)?.stopId, "n");

// Itinerary and totals.
const itinerary = buildItinerary(route, withNight, fuel);
assert.equal(itinerary.length, 2); assert.equal(itinerary[0].items[0].kind, "start"); assert.equal(itinerary[1].items[0].name, "Leave Mine");
const t = totals(route, s, [...fuel, ...nights], stops);
assert.ok(Math.abs(t.gallons - route.miles / 20) < 1e-6); assert.equal(t.fuelStops, fuel.length); assert.equal(t.nights, 1);
assert.ok(Math.abs(t.cost - t.gallons * s.gasPrice) < 1e-6);

// A new stop goes in the right place in the list.
const p300 = pointAtMile(route, 300);
assert.equal(insertIndex(route, withNight, p300), 1); assert.equal(insertIndex(route, withNight, pointAtMile(route, 600)), 2);
assert.ok(project(route, { lat: 35.01, lng: p300.lng }).off < 1);
console.log("planner: all checks passed");
