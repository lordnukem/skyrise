// Full-tower bot (Sprint 7, S7-1): plays one tower from the first hour to the Sky Garden
// crowning, using only the public sim calls. Reports the numbers the balance questions need.
//   node tools/bot.mjs                      seed 7, up to 40 quarters
//   node tools/bot.mjs --seed 3 --quarters 60 --verbose
// Reports only. It never changes tuning. The build order below is the policy; change it
// here, not in the sim, and say so in the sprint notes.

import {
  newGame, place, demolish, addCar, dig, reachable, stepHour, starNeeds, moodCounts, buildGrid,
  canPlace, shaftsOf, cellsOf, floorCap, isLift, LOWEST_FLOOR,
} from '../src/sim.js';
import { TYPES, GRID_WIDTH, LIFT_MAX_CARS, LIFT_CAR_COST, TICK_MS, LOAN_AMOUNT, DIG_COST } from '../src/constants.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SEED = Number(arg('--seed', 7));
const QUARTERS = Number(arg('--quarters', 40));
const VERBOSE = args.includes('--verbose');

const DECIDE_EVERY = 6;   // game hours between build decisions
const RESERVE = 2000;     // cash kept back for upkeep and repairs
const SHAFT_COL = 24;     // the first lift sits just right of the starting lobby (cols 16-23)
const LANE = 4;           // lifts on columns 0 mod LANE, offices between them (see candidates())
const TRY = 8;            // placements tried per decision before waiting for the next one
const OVERLOAD = 1.0;     // a peak wait above this (load ratio) asks for another car or shaft

// Deterministic random numbers, so each seed plays the same game.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const key = (c, f) => c + ',' + f;

// Cells held by reachable structures, and by reachable lifts only (lifts link vertically).
function reachSets(s, reach) {
  const cells = new Set(), liftCells = new Set();
  for (const st of s.structures) {
    if (!reach.has(st.id)) continue;
    for (const [c, f] of cellsOf(st)) { cells.add(key(c, f)); if (isLift(st.type)) liftCells.add(key(c, f)); }
  }
  return { cells, liftCells };
}

// Spots where `type` could go: canPlace passes (cash aside), and it touches the reachable network,
// sideways on its own floors, or, for a lift, vertically onto a reachable lift.
function candidates(s, type, floors, grid, reach) {
  const t = TYPES[type];
  const { cells, liftCells } = reachSets(s, reach);
  const out = [];
  for (const f of floors) {
    for (let c = 0; c + t.w <= GRID_WIDTH; c++) {
      const r = canPlace(s, type, c, f, grid);
      if (!r.ok && !String(r.reason).startsWith('Need $')) continue;
      let touch = false;
      for (let dy = 0; dy < t.h && !touch; dy++) {
        if (cells.has(key(c - 1, f + dy)) || cells.has(key(c + t.w, f + dy))) touch = true;
      }
      if (!touch && t.span && (liftCells.has(key(c, f - 1)) || liftCells.has(key(c, f + t.h)))) touch = true;
      if (!touch) continue;
      // Layout: lifts are lanes on columns 0 mod 4, offices sit between them at 1 mod 4. A lane
      // off the grid costs three floors, so the planned spots come first but are not required.
      const aligned = type === 'elevator' ? c % LANE === 0 : type === 'office' ? c % LANE === 1 : true;
      out.push({ c, f, score: f - 1 + (aligned ? 0 : 3) + Math.abs(c - SHAFT_COL) * 0.05 });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

// Try candidates in order. A placement that is not reachable after all is taken back (half refund).
function build(s, type, cands, stats) {
  let tries = 0;
  for (const cand of cands) {
    if (tries >= TRY) break;
    const res = place(s, type, cand.c, cand.f);
    if (!res.ok) continue;
    tries++;
    if (type === 'floor' || reachable(s).has(res.structure.id)) return true;
    demolish(s, res.structure.id);
    stats.wasted++;
  }
  return false;
}

const floorRange = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const hasReachableLift = (s, reach, floor) => s.structures.some(st => isLift(st.type) && reach.has(st.id) && st.floor === floor);

// The policy. Returns nothing; acts on `s` through `stats`.
function decide(s, stats) {
  const reach = reachable(s);
  const grid = buildGrid(s);
  const upper = floorCap(s);
  const groundUp = floorRange(1, upper);     // lifts may start on the ground floor
  const upFloors = floorRange(2, upper);     // everything else stays off the ground row, which lanes need

  // 1. Bootstrap: a lift from the lobby.
  if (!shaftsOf(s).some(sh => sh.lo <= 1 && sh.hi >= 1 && !TYPES[sh.type].staff)) {
    build(s, 'elevator', candidates(s, 'elevator', [1], grid, reach), stats);
    return;
  }

  // 2. Star needs, in the order the game lists them.
  const { needs } = starNeeds(s);
  for (const n of needs) {
    if (n.met) continue;
    if (n.id === 'security' || n.id === 'clinic' || n.id === 'plant') {
      if (build(s, n.id, candidates(s, n.id, upFloors, grid, reach), stats)) return;
    }
    if (n.id === 'transit') {
      if (s.dug < 1 && s.cash >= DIG_COST + RESERVE) dig(s, 0);
      if (s.dug >= 1) {
        const b1 = floorRange(LOWEST_FLOOR, 0);
        if (!hasReachableLift(s, reach, 0)) build(s, 'elevator', candidates(s, 'elevator', [0], grid, reach), stats);
        if (build(s, 'transit', candidates(s, 'transit', b1, grid, reach), stats)) return;
      }
    }
    if (n.id === 'vip') {
      if (!s.structures.some(x => x.type === 'hotel')) build(s, 'hotel', candidates(s, 'hotel', upFloors, grid, reach), stats);
      if (!s.structures.some(x => x.type === 'housekeeping')) build(s, 'housekeeping', candidates(s, 'housekeeping', upFloors, grid, reach), stats);
    }
  }

  // 3. Lifts: when the let units wait too long on average, the busiest shaft gets a car; once it
  //    has four, a new shaft beside it. One action per decision; otherwise carry on to growth.
  const let_ = s.structures.filter(x => TYPES[x.type].kind === 'unit' && x.occupied && s.service[x.id]);
  const avgPeak = let_.length ? let_.reduce((n, x) => n + s.service[x.id].peak, 0) / let_.length : 0;
  if (avgPeak > OVERLOAD) {
    const shafts = shaftsOf(s).filter(sh => !TYPES[sh.type].staff);
    const served = (sh) => let_.filter(x => Math.abs(x.col - sh.col) <= 4 && sh.lo <= x.floor && x.floor <= sh.hi).length;
    const busiest = shafts.map(sh => ({ sh, n: served(sh) })).sort((a, b) => b.n - a.n)[0];
    if (busiest && busiest.n > 0) {
      const sh = busiest.sh;
      if (sh.cars < LIFT_MAX_CARS && s.cash >= LIFT_CAR_COST + RESERVE) {
        if (addCar(s, sh.col, sh.lo).ok) return;
      } else if (s.cash >= TYPES.elevator.cost + RESERVE) {
        // A new lane from the ground first, beside the lobby, so no shaft has to carry the shafts above it.
        const ground = candidates(s, 'elevator', [1], grid, reach).filter(cd => cd.c % LANE === 0);
        if (build(s, 'elevator', ground, stats)) return;
      }
    }
  }

  // 4. The Sky Garden, once the tower has five stars.
  if (s.rating >= 5 && !s.structures.some(x => x.type === 'landmark') && upper >= 60) {
    if (build(s, 'landmark', candidates(s, 'landmark', floorRange(60, upper), grid, reach), stats)) return;
  }

  // 5. Growth: offices first; then a lift to reach higher; then a floor slab to open a side.
  // Save for the next office rather than spend on lifts and slabs while it is out of reach.
  if (s.cash < TYPES.office.cost + RESERVE) return;
  if (build(s, 'office', candidates(s, 'office', upFloors, grid, reach), stats)) return;
  if (s.cash < TYPES.elevator.cost + RESERVE) return;
  // No office spot: lift a lane one floor (so the floor above touches it), then a slab, then a new lane.
  const liftAt = (c, f) => s.structures.some(x => isLift(x.type) && reach.has(x.id) && x.col === c && x.floor === f);
  const extend = candidates(s, 'elevator', upFloors, grid, reach).filter(cd => cd.c % LANE === 0 && liftAt(cd.c, cd.f - 1));
  if (build(s, 'elevator', extend, stats)) return;
  if (s.cash >= TYPES.floor.cost + RESERVE && build(s, 'floor', candidates(s, 'floor', [1], grid, reach), stats)) return;
  // Stuck at a lane's top: a sky lobby (a cheap transfer floor) gives the next lanes something to start from.
  if (build(s, 'lobby', candidates(s, 'lobby', [16, 31, 46], grid, reach), stats)) return;
  // A new lane beside reachable floors, lowest free spot first (this is how the tower climbs past 16).
  build(s, 'elevator', candidates(s, 'elevator', groundUp, grid, reach).filter(cd => cd.c % LANE === 0), stats);
}

// Average peak wait of let units (the figure the lift step reacts to).
function avgPeakOf(s) {
  const let_ = s.structures.filter(x => TYPES[x.type].kind === 'unit' && x.occupied && s.service[x.id]);
  return let_.length ? let_.reduce((n, x) => n + s.service[x.id].peak, 0) / let_.length : 0;
}

// Run the tower. Returns the per-quarter rows and the summary.
function play() {
  const s = newGame();
  const r = rng(SEED);
  const stats = { wasted: 0 };
  const rows = [];
  const firstAt = {};       // stars k -> first hour
  let firstProblem = null, loans = 0, gameOver = null, minCash = Infinity;
  const maxHours = QUARTERS * 168;

  for (let h = 0; h < maxHours && !s.over && s.wonAt == null; h++) {
    if (s.tick % DECIDE_EVERY === 0 && s.cash >= RESERVE) decide(s, stats);
    const res = stepHour(s, r);
    minCash = Math.min(minCash, s.cash);
    for (let k = 2; k <= s.rating; k++) if (firstAt[k] == null) firstAt[k] = s.tick;
    const mood = moodCounts(s);
    const reach = reachable(s);
    const cut = s.structures.filter(x => TYPES[x.type].kind === 'unit' && !reach.has(x.id)).length;
    const burnt = s.structures.filter(x => x.burnt).length;
    if (firstProblem == null && (mood.poor > 0 || cut > 0 || s.loan || burnt > 0)) firstProblem = s.tick;
    if (res.report) {
      const rep = res.report;
      if (rep.borrowed) loans++;
      const shafts = shaftsOf(s).filter(sh => !TYPES[sh.type].staff);
      rows.push({
        quarter: rep.quarter, cash: Math.round(s.cash), stars: s.rating, pop: s.population,
        good: mood.good, fair: mood.fair, poor: mood.poor, net: rep.net, borrowed: rep.borrowed,
        cut, shafts: shafts.length, cars: shafts.reduce((n, sh) => n + sh.cars, 0), wasted: stats.wasted,
        peak: avgPeakOf(s), officeSpots: candidates(s, 'office', floorRange(1, floorCap(s)), buildGrid(s), reach).length,
      });
      if (VERBOSE) {
        const row = rows[rows.length - 1];
        console.log(`Q${String(row.quarter).padStart(2)} $${String(row.cash).padStart(9)} ${row.stars}* pop ${String(row.pop).padStart(4)} mood ${row.good}/${row.fair}/${row.poor} net ${String(Math.round(row.net)).padStart(7)} shafts ${row.shafts} cars ${row.cars} cut ${row.cut} peak ${row.peak.toFixed(2)} officeSpots ${row.officeSpots}${row.borrowed ? ' LOAN' : ''}`);
      }
    }
  }
  if (s.over) gameOver = s.tick;
  return { s, rows, firstAt, firstProblem, loans, gameOver, minCash, stats };
}

const out = play();
const { s, rows, firstAt, firstProblem, loans, gameOver, minCash, stats } = out;
const quarterOfHour = (h) => Math.floor(h / 168) + 1;
const secs = (h) => Math.round((h * TICK_MS) / 1000);
console.log(`Bot report: seed ${SEED}, up to ${QUARTERS} quarters. Structures ${s.structures.length}, wasted placements ${stats.wasted}.`);
for (const k of [2, 3, 4, 5]) {
  const h = firstAt[k];
  console.log(`  ${k} stars: ${h == null ? 'not reached' : `quarter ${quarterOfHour(h)}, after ${secs(h)} real seconds`}`);
}
console.log(`  Sky Garden crowned: ${s.wonAt == null ? 'no' : `quarter ${quarterOfHour(s.wonAt)}`}`);
console.log(`  loans taken: ${loans} (each $${LOAN_AMOUNT.toLocaleString()}); game over: ${gameOver == null ? 'no' : `quarter ${quarterOfHour(gameOver)}`}`);
console.log(`  lowest cash: $${Math.round(minCash)}`);
console.log(`  first decision problem (poor unit, cut-off unit, loan or burnt unit): ${firstProblem == null ? 'none' : `quarter ${quarterOfHour(firstProblem)}, after ${secs(firstProblem)} real seconds`}`);
if (rows.length) {
  const last = rows[rows.length - 1];
  console.log(`  last quarter: Q${last.quarter}, ${last.stars} stars, pop ${last.pop}, mood ${last.good}/${last.fair}/${last.poor}, ${last.shafts} shafts, ${last.cars} cars`);
}

if (args.includes('--debug')) {
  const reach = reachable(s);
  const grid = buildGrid(s);
  const { next, needs } = starNeeds(s);
  console.log(`debug: rating ${s.rating}, next ${next}, floor cap ${floorCap(s)}, cash $${Math.round(s.cash)}, dug ${s.dug}`);
  for (const n of needs) console.log(`  ${n.met ? 'met ' : 'NOT '} ${n.id}: ${n.label}`);
  const up = floorRange(1, floorCap(s));
  for (const type of ['office', 'elevator', 'floor', 'clinic', 'plant', 'landmark']) {
    console.log(`  candidates ${type}: ${candidates(s, type, type === 'landmark' ? floorRange(60, floorCap(s)) : up, grid, reach).length}`);
  }
  const ground = s.structures.filter(x => x.floor === 1 || (x.floor <= 1 && x.floor + TYPES[x.type].h > 1)).map(x => `${x.type}@${x.col}`);
  console.log(`  floor 1 holds: ${ground.join(' ')}`);
  const top = Math.max(...shaftsOf(s).map(sh => sh.hi));
  console.log(`  highest shaft floor ${top}; units ${s.structures.filter(x => TYPES[x.type].kind === 'unit').length}`);
}
