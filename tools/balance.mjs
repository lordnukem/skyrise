// Balance harness: plays fixed reference towers and reports the numbers that
// tenant mood depends on. Reports only; it never changes tuning.
//   node tools/balance.mjs            (60 game days per tower, seeded)
//   node tools/balance.mjs --days 120

import { newGame, place, addCar, stepHour, happyBand, liftService, reachable, hourOf, isWeekend } from '../src/sim.js';
import { STAR_POP, LEAVE_AT } from '../src/constants.js';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 60;
const SHAFT_COL = 24;     // the lift sits just right of the starting lobby (cols 16-23)

// Deterministic random numbers, so every run prints the same table.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A lift tower: one shaft from floor 1 to `top`, offices on both sides of it from floor 2 up,
// and `cars` cars in the shaft.
function liftTower({ top, cars, flats = false }) {
  const s = newGame();
  s.cash = 1e9;
  // Floor slabs under the right-hand units (the lobby only covers the left side).
  for (let c = SHAFT_COL + 1; c <= SHAFT_COL + 3; c++) place(s, 'floor', c, 1);
  for (let f = 1; f <= top; f++) place(s, 'elevator', SHAFT_COL, f);
  for (let c = 1; c < cars; c++) addCar(s, SHAFT_COL, 1);
  // A security office beside the lobby, so random fires go out and do not confuse the mood numbers.
  s.rating = 2;                       // the harness skips the star unlock; the office needs 2 stars
  place(s, 'security', 14, 1);
  let built = 0;
  for (let f = 2; f <= top; f++) {
    if (flats) {
      if (place(s, 'flat', 21, f).ok) built++;
      if (place(s, 'flat', 25, f).ok) built++;
    } else {
      if (place(s, 'office', 21, f).ok) built++;
      if (place(s, 'office', 25, f).ok) built++;
    }
  }
  return { s, built };
}

// Run `days` days and collect the numbers.
function play(s, hours) {
  const r = rng(7);
  const acc = { left: 0, net: 0, hours: 0, peakWait: 0, peakHourWait: 0, peakHourN: 0 };
  const occupied = [];
  for (let h = 0; h < hours; h++) {
    const res = stepHour(s, r);
    acc.left += res.left;
    acc.net += res.net;
    acc.hours++;
    const svc = s.service;
    for (const st of s.structures) {
      if (!svc[st.id] || st.floor === 1) continue;
      acc.peakWait = Math.max(acc.peakWait, svc[st.id].wait);
    }
    if (hourOf(s.tick) === 8 && !isWeekend(s.tick)) {
      let w = 0, n = 0;
      for (const st of s.structures) if (svc[st.id] && st.floor > 1) { w += svc[st.id].wait; n++; }
      if (n) { acc.peakHourWait += w / n; acc.peakHourN++; }
    }
  }
  const units = s.structures.filter(st => st.type === 'office' || st.type === 'flat');
  const let_ = units.filter(st => st.occupied);
  const bands = { good: 0, fair: 0, poor: 0 };
  for (const st of let_) bands[happyBand(st.happy)]++;
  occupied.push(...let_);
  return {
    units: units.length,
    occ: units.length ? let_.length / units.length : 0,
    happy: let_.length ? let_.reduce((n, st) => n + st.happy, 0) / let_.length : 0,
    bands,
    left: acc.left,
    leftPerQuarter: acc.left / (hours / (24 * 7)),
    peakWait: acc.peakWait,
    meanPeakHourWait: acc.peakHourN ? acc.peakHourWait / acc.peakHourN : 0,
    burnt: units.filter(st => st.burnt).length,
    rating: s.rating,
    pop: s.population,
    netPerHour: acc.net / acc.hours,
  };
}

// Sweep. Each tower fits one shaft (LIFT_MAX_SPAN floors); taller towers need a sky lobby,
// which this harness does not build yet.
const scenarios = [
  { name: 'starter: 1 car, 5 floors', top: 6, cars: 1 },
  { name: '8 offices: 2 cars, 5 floors', top: 6, cars: 2 },
  { name: '16 floors: 1 car', top: 16, cars: 1 },
  { name: '16 floors: 2 cars', top: 16, cars: 2 },
  { name: '16 floors: 3 cars', top: 16, cars: 3 },
  { name: '16 floors: 4 cars (max)', top: 16, cars: 4 },
  { name: 'flats: 2 cars, 16 floors', top: 16, cars: 2, flats: true },
];

const rows = [];
for (const sc of scenarios) {
  const { s, built } = liftTower(sc);
  const r = play(s, days * 24);
  rows.push({ scenario: sc.name, built, ...r });
}

const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
console.log(`Balance report: ${days} game days per tower, seed 7. Happiness leave line ${LEAVE_AT}; star pop bands ${STAR_POP.join(', ')}.`);
console.log('');
console.log('scenario                      units  occ%  happy  good fair poor  left/qtr  peakWait  8am wait  stars  pop  $/h');
for (const r of rows) {
  console.log([
    r.scenario.padEnd(29), String(r.units).padStart(5), f(r.occ * 100).padStart(5), f(r.happy).padStart(6),
    String(r.bands.good).padStart(5), String(r.bands.fair).padStart(4), String(r.bands.poor).padStart(4),
    f(r.leftPerQuarter, 1).padStart(9), f(r.peakWait, 2).padStart(9), f(r.meanPeakHourWait, 2).padStart(9),
    String(r.burnt).padStart(5), String(r.rating).padStart(6), String(r.pop).padStart(4), f(r.netPerHour).padStart(4),
  ].join(' '));
}
