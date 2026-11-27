// Full-tower bot (Sprint 7, S7-1): plays one tower from the first hour, through the Sky Garden
// crowning, using only the public sim calls. Reports the numbers the balance questions need.
//   node tools/bot.mjs                      seed 7, up to 40 quarters, the reference policy
//   node tools/bot.mjs --seed 3 --quarters 60 --verbose
//   node tools/bot.mjs --policy weak        the deliberately weaker player (see POLICIES)
//   node tools/bot.mjs --layout naive       the layout-free player: greedy placement, no bands
// Reports only. It never changes tuning. The build order below is the policy; change it
// here, not in the sim, and say so in the sprint notes.

import {
  newGame, place, demolish, addCar, dig, reachable, stepHour, starNeeds, moodCounts, buildGrid,
  canPlace, shaftsOf, cellsOf, floorCap, isLift, LOWEST_FLOOR, guestShafts, lobbyFloorsOf, demandAt, cycleRent, repair, repairCost,
} from '../src/sim.js';
import {
  TYPES, GRID_WIDTH, LIFT_MAX_CARS, LIFT_CAR_COST, TICK_MS, LOAN_AMOUNT, DIG_COST, START_LOBBY_WIDTH, LANDMARK_MIN_FLOOR,
} from '../src/constants.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SEED = Number(arg('--seed', 7));
const QUARTERS = Number(arg('--quarters', 40));
const VERBOSE = args.includes('--verbose');
const POLICY_NAME = arg('--policy', 'reference');
const LAYOUT = arg('--layout', 'planned');   // planned: the band plan; naive: greedy, no bands (see decideNaive)

const DECIDE_EVERY = 6;   // game hours between build decisions
const RESERVE = 2000;     // cash kept back for upkeep and repairs
const SHAFT_COL = 24;     // the first lift sits just right of the starting lobby (cols 16-23)
const TRY = 8;            // placements tried per decision before waiting for the next one
const RICH = 60000;       // above this much cash, growth may place several things per decision
const PER_DECISION_RICH = 6;

// Policies. `reference` is the good player; `weak` is worse on purpose, in four fixed ways, so the
// S7-2 targets can be checked against a player who makes mistakes. Every change is deterministic:
// it depends on the game clock and build counts only, never on a random draw.
const POLICIES = {
  reference: { overload: 1.0, reactHours: 0, carAt: 1.0, highRentEvery: 0, skipNeedsEvery: 0, lowRentHotel: true },
  weak: {
    overload: 1.0,
    reactHours: 24,      // 1. a lift must stay overloaded for a whole game day before the bot reacts
    carAt: 1.5,          // 2. it buys a car only once the average peak wait passes 1.5 (the reference: 1.0)
    highRentEvery: 3,    // 3. every third office it builds goes to high rent (income +30%, happiness -15)
    skipNeedsEvery: 3,   // 4. every third quarter (3, 6, 9, ...) it ignores the star needs
    lowRentHotel: true,  // the rest of the plan is the reference's, hotel rent included
  },
};
const POLICY = POLICIES[POLICY_NAME];
if (!POLICY) { console.error(`Unknown policy "${POLICY_NAME}" (use ${Object.keys(POLICIES).join(' or ')})`); process.exit(1); }

// Deterministic random numbers, so each seed plays the same game.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const key = (c, f) => c + ',' + f;
const range = (lo, hi, step = 1) => { const out = []; for (let i = lo; i <= hi; i += step) out.push(i); return out; };
const floorRange = (lo, hi) => range(lo, hi);

// ---- The band plan -----------------------------------------------------------------------
// A lift shaft spans at most 16 floors, so the tower is built in bands that meet on a transfer
// floor (16, 31). Each band's lanes sit one column right of the band below: a band-2 lane starts
// on floor 16 in the left column of a band-1 office slot (the office on floor 15 holds it up), and
// it joins the network beside the band-1 lane top. Offices sit in the three columns between lanes.
// The transfer floor has no offices: slabs hold up the next band's offices, and a sky lobby there
// lets the express lifts stop. Checked rule by rule with canPlace and reachable.
//
//   band 1, floors 1-16:  lanes 0,4,...,36 (16 and 20 start on floor 2, above the lobby)
//                         offices at 1,5,...,33 on floors 2-15
//   floor 16 (transfer):  band-1 lane tops at 4k, band-2 lane bottoms at 4k+1, slabs at 4k+2 and 4k+3,
//                         a sky lobby at column 2
//   band 2, floors 16-31: lanes 1,5,...,33; offices at 2,6,...,34 on floors 17-30
//   floor 31 (transfer):  band-2 lane tops at 4k+1, band-3 lane bottoms at 4k+2, slabs at 4k+3 and 4k+4,
//                         a sky lobby at column 3
//   band 3, floors 31-46: lanes 2,6,...,34; offices at 3,7,...,35 on floors 32-45
//   express 37, 38, 39:   floors 1-31, stopping at the lobbies on 1, 16 and 31. A band-3 lane starts
//                         above the reach of any lift from the ground, so the express is its only
//                         feeder; without it band-3 tenants would climb 30 floors on foot.
//   spine and garden:     a lane at column 35, floors 46-61, beside the band-3 lane top at 34 (the
//                         office or a slab on floor 45 holds it up); slabs hang from it on floor 59
//                         (columns 23-34) and the Sky Garden sits on them, floors 60-65.
// The sim gives a unit no transfer beyond one feeder, so floors above 46 cannot be served from the
// ground; the plan stops offices at band 3.
const LOBBY_LEFT = Math.floor((GRID_WIDTH - START_LOBBY_WIDTH) / 2);
const isLobbyCol = (c) => c >= LOBBY_LEFT && c < LOBBY_LEFT + START_LOBBY_WIDTH;
const BANDS = [
  { lo: 1, hi: 16, lanes: range(0, 36, 4), offices: range(1, 33, 4), floors: range(2, 15), lobbyCol: null },
  { lo: 16, hi: 31, lanes: range(1, 33, 4), offices: range(2, 34, 4), floors: range(17, 30), lobbyCol: 2 },
  { lo: 31, hi: 46, lanes: range(2, 34, 4), offices: range(3, 35, 4), floors: range(32, 45), lobbyCol: 3 },
];
const EXPRESS_COLS = [37, 38, 39];
const EXPRESS_TOP = 31;
const TRANSIT_LIFT_COL = LOBBY_LEFT - 1;   // a short lift from floor 1 to B1 for the transit station
const SPINE = { col: 35, lo: 46, hi: 61 };
// Service slots, fixed in the plan so offices cannot take them first: `o` is the slot's origin, `c`
// the service's column (a two-wide service sits against the lane it touches), `f` its floor. The
// hotel room and its housekeeping share a floor, so the cleaners never ride the guest lifts. One
// security office covers 15 floors each way, so bands 2 and 3 get their own.
const SERVICE_SLOTS = [
  { type: 'security', o: 25, c: 25, f: 3 },
  { type: 'hotel', o: 25, c: 25, f: 6 },
  { type: 'housekeeping', o: 21, c: 22, f: 6 },
  { type: 'clinic', o: 21, c: 22, f: 9 },
  { type: 'plant', o: 25, c: 25, f: 9 },
  { type: 'security', o: 22, c: 22, f: 23 },
  { type: 'security', o: 23, c: 23, f: 38 },
];
const GARDEN = { col: 23, floor: 60 };
const laneBase = (band, c) => (band.lo === 1 && isLobbyCol(c) ? 2 : band.lo);
const bandOfFloor = (f) => { for (let b = BANDS.length - 1; b >= 0; b--) if (f > BANDS[b].lo || b === 0) return b; return 0; };

// Cells held by reachable structures that open sideways, and by reachable lifts (lifts link
// vertically). An express cell opens only on a lobby floor, and a closed stop never does.
function reachSets(s, reach) {
  const cells = new Set(), liftCells = new Set();
  const lobbies = lobbyFloorsOf(s);
  for (const st of s.structures) {
    if (!reach.has(st.id)) continue;
    for (const [c, f] of cellsOf(st)) {
      if (isLift(st.type)) liftCells.add(key(c, f));
      if (!st.closed && (st.type !== 'express' || lobbies.has(f))) cells.add(key(c, f));
    }
  }
  return { cells, liftCells };
}
function ctxOf(s) {
  const grid = buildGrid(s);
  const reach = reachable(s, grid);
  return { grid, reach, ...reachSets(s, reach) };
}

// Whether `type` at (c, f) touches the reachable network: sideways on its own floors, or, for a
// lift, vertically onto a reachable lift.
function touches(type, c, f, ctx) {
  const t = TYPES[type];
  for (let dy = 0; dy < t.h; dy++) if (ctx.cells.has(key(c - 1, f + dy)) || ctx.cells.has(key(c + t.w, f + dy))) return true;
  return !!t.span && (ctx.liftCells.has(key(c, f - 1)) || ctx.liftCells.has(key(c, f + t.h)));
}

// Greedy spots where `type` could go (used inside the plan only: floor-1 slabs, the basement).
function candidates(s, type, floors, ctx) {
  const t = TYPES[type];
  const out = [];
  for (const f of floors) {
    for (let c = 0; c + t.w <= GRID_WIDTH; c++) {
      const r = canPlace(s, type, c, f, ctx.grid);
      if (!r.ok && !String(r.reason).startsWith('Need $')) continue;
      if (!touches(type, c, f, ctx)) continue;
      out.push({ c, f, score: f - 1 + Math.abs(c - SHAFT_COL) * 0.05 });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

// One planned placement. Returns 'ok', 'cash' (cannot afford it now: stop for this decision) or
// 'no'. A unit or lift that turns out unreachable is taken back (half refund). `reserve` is the
// cash that must be left after paying.
function attempt(s, st, type, c, f, reserve = RESERVE) {
  const ctx = st.ctx;
  const r = canPlace(s, type, c, f, ctx.grid);
  if (!r.ok && !String(r.reason).startsWith('Need $')) return 'no';
  if (type !== 'floor' && !touches(type, c, f, ctx)) return 'no';
  if (s.cash < TYPES[type].cost + reserve) return 'cash';
  const res = place(s, type, c, f);
  if (!res.ok) return 'no';
  if (type !== 'floor' && !reachable(s).has(res.structure.id)) {
    demolish(s, res.structure.id);
    st.wasted++;
    st.ctx = ctxOf(s);
    return 'no';
  }
  if (type === 'office') {
    st.offices++;
    if (POLICY.highRentEvery && st.offices % POLICY.highRentEvery === 0) cycleRent(s, res.structure.id);   // normal -> high
  }
  st.ctx = ctxOf(s);
  return 'ok';
}

// Like attempt, but when the spot lacks support, first put slabs in the empty cells beneath it
// (a slab may hang beside whatever stands next to it).
function attemptSupported(s, st, type, c, f, reserve = RESERVE) {
  if (!touches(type, c, f, st.ctx)) return 'no';
  const r = canPlace(s, type, c, f, st.ctx.grid);
  if (!r.ok && r.reason === 'Needs a floor beneath it') {
    for (let dx = 0; dx < TYPES[type].w; dx++) {
      if (st.ctx.grid.has(key(c + dx, f - 1))) continue;
      const got = attempt(s, st, 'floor', c + dx, f - 1, reserve);
      if (got !== 'ok') return got;
    }
  }
  return attempt(s, st, type, c, f, reserve);
}

// The top floor of the lane in column c that starts at `base`, or null when it is not started.
function laneTop(ctx, c, base, type = 'elevator') {
  if (ctx.grid.get(key(c, base))?.type !== type) return null;
  let hi = base;
  while (ctx.grid.get(key(c, hi + 1))?.type === type) hi++;
  return hi;
}
// A planned office slot is free when all three cells are empty or bare slabs.
const slotFree = (ctx, o, f) => [0, 1, 2].every(dx => { const x = ctx.grid.get(key(o + dx, f)); return !x || x.type === 'floor'; });

// The planned placements of one band, in the order they are tried: for band 1, floor by floor
// (offices, then the lane cells that reach that floor), then new lanes; for the upper bands, their
// lanes start first, since every office there hangs off them.
function bandTargets(s, ctx, b) {
  const band = BANDS[b];
  const out = [];
  const reserved = new Map();   // "o,f" -> the service slot, while its band has no such service yet
  for (const sv of SERVICE_SLOTS) {
    if (bandOfFloor(sv.f) !== b || s.structures.some(x => x.type === sv.type && bandOfFloor(x.floor) === b)) continue;
    reserved.set(key(sv.o, sv.f), sv);
  }
  const starts = [];
  const lanes = band.lanes.map(c => ({ c, base: laneBase(band, c) }));
  for (const ln of lanes) {
    ln.top = laneTop(ctx, ln.c, ln.base);
    if (ln.top == null) starts.push({ type: 'elevator', c: ln.c, f: ln.base, start: true });
  }
  starts.sort((a, b) => Math.abs(a.c - SHAFT_COL) - Math.abs(b.c - SHAFT_COL));
  let highest = band.lo;
  for (const f of band.floors) if (band.offices.some(o => ctx.grid.get(key(o, f))?.type === 'office')) highest = f;
  if (b > 0) out.push(...starts);
  for (const f of band.floors) {
    for (const o of band.offices) {
      if (!slotFree(ctx, o, f)) continue;
      const sv = reserved.get(key(o, f));
      // Band 1's services wait for the star need that asks for them; the upper bands' security
      // goes in as the band grows past its floor.
      if (sv) { if (b > 0) out.push({ type: sv.type, c: sv.c, f, start: true }); continue; }
      out.push({ type: 'office', c: o, f });
    }
    // A lane climbs to a floor where a slot beside it is free, or where the band already has offices.
    for (const ln of lanes) {
      if (ln.top == null || ln.top !== f - 1) continue;
      const beside = band.offices.some(o => (o === ln.c + 1 || o + 3 === ln.c) && slotFree(ctx, o, f));
      if (beside || f <= highest) out.push({ type: 'elevator', c: ln.c, f });
    }
  }
  if (b === 0) out.push({ type: 'groundSlab' }, ...starts);
  return out;
}

// What must stand before band b (1 or 2) opens, in build order. `ready` says whether it is done.
function transferTargets(s, ctx, b) {
  const band = BANDS[b], below = BANDS[b - 1], T = band.lo;
  const out = [];
  // The lanes below reach the transfer floor.
  for (const c of below.lanes) {
    const base = laneBase(below, c), top = laneTop(ctx, c, base);
    if (top != null && top < T) out.push({ type: 'elevator', c, f: top + 1 });
  }
  // The express lifts climb to the top transfer floor (only needed once, for band 2 onward).
  for (const c of EXPRESS_COLS) {
    const top = laneTop(ctx, c, 1, 'express');
    if (top == null) out.push({ type: 'express', c, f: 1 });
    else if (top < EXPRESS_TOP) out.push({ type: 'express', c, f: top + 1 });
  }
  // Slabs across the transfer floor, and the sky lobby where the express stops.
  for (const o of below.offices) for (const dx of [1, 2]) {
    const c = o + dx;
    const x = ctx.grid.get(key(c, T));
    if (c === band.lobbyCol) { if (x?.type !== 'lobby') out.push({ type: 'lobby', c, f: T }); }
    else if (!x) out.push({ type: 'floor', c, f: T });
  }
  const lowerTop = below.lanes.some(c => laneTop(ctx, c, laneBase(below, c)) >= T);
  const lobby = ctx.grid.get(key(band.lobbyCol, T))?.type === 'lobby';
  const express = EXPRESS_COLS.some(c => (laneTop(ctx, c, 1, 'express') || 0) >= T);
  // Band 2 can open on the band-1 lanes alone; band 3 needs the express, its only feeder.
  const ready = lowerTop && lobby && (b < 2 || express);
  return { targets: out, ready };
}

// Try one list of targets in order. Returns 'ok', 'cash' or 'no'.
function tryTargets(s, st, targets) {
  for (const t of targets) {
    let r;
    if (t.type === 'groundSlab') {
      if (s.cash < TYPES.floor.cost + RESERVE) return 'cash';
      const cands = candidates(s, 'floor', [1], st.ctx);
      r = cands.length ? attempt(s, st, 'floor', cands[0].c, 1) : 'no';
    } else if (t.type === 'office' || t.start) {
      r = attemptSupported(s, st, t.type, t.c, t.f);
    } else {
      r = attempt(s, st, t.type, t.c, t.f);
    }
    if (r !== 'no') return r;
  }
  return 'no';
}

// One growth placement by the plan: band 1 first, then each upper band once the one below is
// stuck and its transfer floor is ready.
function growOnce(s, st) {
  for (let b = 0; b < BANDS.length; b++) {
    if (b > 0) {
      if (floorCap(s) < BANDS[b].floors[BANDS[b].floors.length - 1]) return 'no';
      const tr = transferTargets(s, st.ctx, b);
      const r = tryTargets(s, st, tr.targets);
      if (r !== 'no') return r;
      if (!tr.ready) return 'no';
    }
    const r = tryTargets(s, st, bandTargets(s, st.ctx, b));
    if (r !== 'no') return r;
  }
  return 'no';
}

// A band-1 service (security, clinic, plant, hotel, housekeeping): its planned slot first, else the
// lowest free office slot the network touches (on `floor` only, when given). A two-wide service
// leaves a cell that the office above fills with a slab.
function placeService(s, st, type, floor = null) {
  for (const sv of SERVICE_SLOTS) {
    if (sv.type !== type || bandOfFloor(sv.f) !== 0 || (floor != null && sv.f !== floor) || !slotFree(st.ctx, sv.o, sv.f)) continue;
    const r = attemptSupported(s, st, type, sv.c, sv.f, 0);
    if (r === 'ok') return s.structures.at(-1);
    if (r === 'cash') return null;
  }
  for (const f of floor != null ? [floor] : BANDS[0].floors) for (const o of BANDS[0].offices) {
    if (!slotFree(st.ctx, o, f) || SERVICE_SLOTS.some(sv => sv.o === o && sv.f === f)) continue;
    const r = attemptSupported(s, st, type, o, f, 0);
    if (r === 'ok') return s.structures.at(-1);
    if (r === 'cash') return null;
  }
  return null;
}

// ---- Lift loads, mirrored from the sim's liftService from public data ---------------------------
function loadModel(s, ctx, hour = 8, weekend = false) {
  const shafts = guestShafts(s, ctx.grid);
  const lobbies = lobbyFloorsOf(s);
  const serves = (sh, f) => sh.lo <= f && f <= sh.hi && (sh.type !== 'express' || lobbies.has(f)) && !sh.closed.includes(f);
  const feeders = shafts.map((sh, i) => (sh.lo <= 1 ? [] :
    shafts.map((x, j) => (j !== i && x.lo <= 1 && x.hi >= 1 && serves(x, sh.lo) ? j : -1)).filter(j => j >= 0)));
  const loads = shafts.map(() => 0);
  const cap = shafts.map(sh => TYPES[sh.type].capacity * sh.cars);
  const serving = new Map();
  const servingOf = (f) => { if (!serving.has(f)) serving.set(f, shafts.map((sh, i) => (serves(sh, f) ? i : -1)).filter(i => i >= 0)); return serving.get(f); };
  for (const u of s.structures) {
    if (TYPES[u.type].kind !== 'unit' || !u.occupied || u.floor === 1 || !ctx.reach.has(u.id)) continue;
    const idx = servingOf(u.floor);
    if (!idx.length) continue;
    const riders = (TYPES[u.type].people || 0) * demandAt(u.type, hour, weekend);
    for (const i of idx) {
      loads[i] += riders / idx.length;
      for (const j of feeders[i]) loads[j] += riders / idx.length / feeders[i].length;
    }
  }
  const ratio = (i) => loads[i] / cap[i];
  // The best route to floor f: [own shaft, its least busy feeder or -1].
  const route = (f) => {
    let best = null;
    for (const i of servingOf(f)) {
      let fi = -1;
      for (const j of feeders[i]) if (fi < 0 || ratio(j) < ratio(fi)) fi = j;
      const w = ratio(i) + (fi >= 0 ? ratio(fi) : 0);
      if (!best || w < best.w) best = { i, fi, w };
    }
    return best;
  };
  return { shafts, ratio, route };
}

// A new shaft beside the overloaded ones: a planned lane in the band of floor f, or, for a feeder,
// a new ground lane or express.
function addShaft(s, st, f, feeder) {
  if (s.cash < TYPES.elevator.cost + RESERVE) return false;
  const b = feeder ? 0 : bandOfFloor(f);
  const band = BANDS[b];
  const starts = band.lanes.map(c => ({ c, f: laneBase(band, c) }))
    .filter(x => laneTop(st.ctx, x.c, x.f) == null && (!feeder || x.f === 1))
    .sort((a, c) => Math.abs(a.c - SHAFT_COL) - Math.abs(c.c - SHAFT_COL));
  for (const x of starts) if (attemptSupported(s, st, 'elevator', x.c, x.f) === 'ok') return true;
  if (feeder) {
    for (const c of EXPRESS_COLS) {
      const top = laneTop(st.ctx, c, 1, 'express');
      if (top == null && attempt(s, st, 'express', c, 1) === 'ok') return true;
      if (top != null && top < EXPRESS_TOP && attempt(s, st, 'express', c, top + 1) === 'ok') return true;
    }
  }
  return false;
}

// Average peak wait of let units (the figure the lift step reacts to).
function avgPeakOf(s) {
  const let_ = s.structures.filter(x => TYPES[x.type].kind === 'unit' && x.occupied && s.service[x.id]);
  return let_.length ? let_.reduce((n, x) => n + s.service[x.id].peak, 0) / let_.length : 0;
}

// The naive layout (--layout naive): no bands, lanes, transfer floors or garden spine. Each
// structure goes to the first spot the greedy search finds that touches the network. It keeps the
// star needs, the overload rule and the ground lift, so it measures how much the planned layout matters.
function decideNaive(s, st) {
  st.ctx = ctxOf(s);
  const cap = floorCap(s);
  const floors = floorRange(2, cap);
  const first = (type, floorList, n = TRY, reserve = RESERVE) => {
    for (const cd of candidates(s, type, floorList, st.ctx).slice(0, n)) {
      const got = attemptSupported(s, st, type, cd.c, cd.f, reserve);
      if (got === 'ok') return true;
      if (got === 'cash') return false;
    }
    return false;
  };
  // 1. A lift from the ground floor.
  if (!shaftsOf(s).some(sh => sh.lo <= 1 && sh.hi >= 1 && !TYPES[sh.type].staff)) { first('elevator', [1], TRY, 0); return; }
  // 2. Star needs, in the order the game lists them.
  const quarter = Math.floor(s.tick / 168) + 1;
  const skipNeeds = POLICY.skipNeedsEvery && quarter % POLICY.skipNeedsEvery === 0;
  const { needs } = starNeeds(s);
  for (const n of skipNeeds ? [] : needs) {
    if (n.met) continue;
    if (n.id === 'security' || n.id === 'clinic' || n.id === 'plant') { if (first(n.id, floors)) return; }
    if (n.id === 'transit' && s.dug < 1 && s.cash >= DIG_COST + RESERVE) dig(s, 0);
    if (n.id === 'transit' && s.dug >= 1) {
      const b1 = floorRange(LOWEST_FLOOR, 0);
      if (first('elevator', b1, 1, 0) && first('transit', b1, TRY, 0)) return;
      if (first('transit', b1, TRY, 0)) return;
    }
    if (n.id === 'vip') {
      if (!s.structures.some(x => x.type === 'hotel') && first('hotel', floors)) return;
      if (!s.structures.some(x => x.type === 'housekeeping') && first('housekeeping', floors)) return;
    }
  }
  // 3. Lifts: the busiest shaft gets a car, or else a new lift near the unit that waits longest.
  const let_ = s.structures.filter(x => TYPES[x.type].kind === 'unit' && x.occupied && s.service[x.id]);
  if (avgPeakOf(s) > POLICY.overload) {
    const shafts = shaftsOf(s).filter(sh => !TYPES[sh.type].staff);
    const served = (sh) => let_.filter(x => Math.abs(x.col - sh.col) <= 4 && sh.lo <= x.floor && x.floor <= sh.hi).length;
    const busiest = shafts.map(sh => ({ sh, n: served(sh) })).sort((a, b) => b.n - a.n)[0];
    if (busiest && busiest.n > 0) {
      if (busiest.sh.cars < LIFT_MAX_CARS && s.cash >= LIFT_CAR_COST + RESERVE && addCar(s, busiest.sh.col, busiest.sh.lo).ok) return;
      if (first('elevator', floors, TRY)) return;
    }
  }
  // 4. The Sky Garden, if a greedy search finds a spot for it (usually none: the naive layout does not reach it).
  if (s.rating >= 5 && !s.structures.some(x => x.type === 'landmark') && cap >= LANDMARK_MIN_FLOOR + TYPES.landmark.h) {
    if (first('landmark', floorRange(LANDMARK_MIN_FLOOR, cap), TRY)) return;
  }
  // 5. Growth: an office if one fits, else a lift, else a slab on the ground floor to open a side.
  if (s.cash < TYPES.office.cost + RESERVE) return;
  if (first('office', floors)) return;
  if (first('elevator', floors)) return;          // up the existing lift first, so the floor above touches it
  if (first('floor', [1])) return;                // a slab on the ground floor opens a side
  first('elevator', [1]);                         // last resort: another lift at the bottom
}

// The policy. Acts on `s`; `st` holds the bot's own counters.
function decide(s, st) {
  if (LAYOUT === 'naive') return decideNaive(s, st);
  st.ctx = ctxOf(s);
  const upper = floorCap(s);

  // 1. Bootstrap: a lift from the lobby.
  if (!shaftsOf(s, st.ctx.grid).some(sh => sh.lo <= 1 && sh.hi >= 1 && !TYPES[sh.type].staff)) {
    attempt(s, st, 'elevator', SHAFT_COL, 1, 0);
    return;
  }

  // 1b. A burnt-out unit is repaired as soon as the cash allows.
  for (const x of s.structures) if (x.burnt && s.cash >= repairCost(x) + RESERVE) repair(s, x.id);

  // 2. Star needs, in the order the game lists them (the weak policy skips this in some quarters).
  const quarter = Math.floor(s.tick / 168) + 1;
  const skipNeeds = POLICY.skipNeedsEvery && quarter % POLICY.skipNeedsEvery === 0;
  const { needs } = starNeeds(s);
  for (const n of skipNeeds ? [] : needs) {
    if (n.met) continue;
    if (n.id === 'security' || n.id === 'clinic' || n.id === 'plant') {
      if (placeService(s, st, n.id)) return;
    }
    if (n.id === 'transit') {
      if (s.dug < 1 && s.cash >= DIG_COST + RESERVE) dig(s, 0);
      if (s.dug >= 1) {
        st.ctx = ctxOf(s);
        const g = st.ctx.grid;
        if (g.get(key(TRANSIT_LIFT_COL, 1))?.type !== 'elevator') attempt(s, st, 'elevator', TRANSIT_LIFT_COL, 1, 0);
        else if (g.get(key(TRANSIT_LIFT_COL, 0))?.type !== 'elevator') attempt(s, st, 'elevator', TRANSIT_LIFT_COL, 0, 0);
        const cands = candidates(s, 'transit', floorRange(LOWEST_FLOOR, 0), st.ctx);
        for (const cd of cands.slice(0, TRY)) if (attempt(s, st, 'transit', cd.c, cd.f, 0) === 'ok') return;
      }
    }
    if (n.id === 'vip') {
      // The VIP reviews a clean room at Good happiness. The room sits beside a lane (noise), so the
      // reference policy lets it at low rent (+10 happiness) and keeps housekeeping on its floor, so
      // the cleaners never ride the guest lifts.
      let hotel = s.structures.find(x => x.type === 'hotel');
      if (!hotel && s.cash >= TYPES.hotel.cost + TYPES.housekeeping.cost) {
        hotel = placeService(s, st, 'hotel');
        if (hotel && POLICY.lowRentHotel) { cycleRent(s, hotel.id); cycleRent(s, hotel.id); }   // normal -> high -> low
      }
      if (hotel && !s.structures.some(x => x.type === 'housekeeping' && x.floor === hotel.floor)) {
        if (!placeService(s, st, 'housekeeping', hotel.floor) && !s.structures.some(x => x.type === 'housekeeping')) placeService(s, st, 'housekeeping');
      }
    }
  }

  // 3. Lifts: when the let units wait too long on average, find the worst-served unit's route and
  //    relieve its busier leg: a car on that shaft, or once it has four, a new shaft beside it.
  //    The weak policy waits POLICY.reactHours of continuous overload first, and buys cars later.
  const avgPeak = avgPeakOf(s);
  if (avgPeak > POLICY.overload) st.overloadSince ??= s.tick; else st.overloadSince = null;
  if (avgPeak > POLICY.overload && s.tick - st.overloadSince >= POLICY.reactHours) {
    const worst = s.structures.filter(x => TYPES[x.type].kind === 'unit' && x.occupied && s.service[x.id] && x.floor !== 1)
      .sort((a, b) => s.service[b.id].peak - s.service[a.id].peak)[0];
    const m = worst && loadModel(s, st.ctx);
    const r = m && m.route(worst.floor);
    if (r) {
      const legs = [{ i: r.i, feeder: false }];
      if (r.fi >= 0) legs.push({ i: r.fi, feeder: true });
      legs.sort((a, b) => m.ratio(b.i) - m.ratio(a.i));
      for (const leg of legs) {
        const sh = m.shafts[leg.i];
        if (sh.cars < LIFT_MAX_CARS) {
          if (avgPeak > POLICY.carAt && s.cash >= LIFT_CAR_COST + RESERVE && addCar(s, sh.col, sh.lo).ok) return;
        } else if (addShaft(s, st, worst.floor, leg.feeder)) return;
      }
    }
  }

  // 4. The Sky Garden, once the tower has five stars and band 3 is open: the spine lane beside the
  //    band-3 lane at column 34, slabs on floor 59, then the garden on them.
  if (s.rating >= 5 && !s.structures.some(x => x.type === 'landmark') && upper >= LANDMARK_MIN_FLOOR + TYPES.landmark.h &&
    laneTop(st.ctx, BANDS[2].lanes.at(-1), BANDS[2].lo) != null) {
    const targets = [];
    const c34 = BANDS[2].lanes.at(-1), top34 = laneTop(st.ctx, c34, BANDS[2].lo);
    if (top34 < SPINE.lo) targets.push({ type: 'elevator', c: c34, f: top34 + 1 });
    const spineTop = laneTop(st.ctx, SPINE.col, SPINE.lo);
    if (spineTop == null) targets.push({ type: 'elevator', c: SPINE.col, f: SPINE.lo, start: true });
    else if (spineTop < SPINE.hi) targets.push({ type: 'elevator', c: SPINE.col, f: spineTop + 1 });
    else {
      for (let c = SPINE.col - 1; c >= GARDEN.col; c--) if (!st.ctx.grid.has(key(c, GARDEN.floor - 1))) targets.push({ type: 'floor', c, f: GARDEN.floor - 1 });
      targets.push({ type: 'landmark', c: GARDEN.col, f: GARDEN.floor });
    }
    if (targets.length && targets[0].type === 'landmark' && s.cash < TYPES.landmark.cost + RESERVE) {
      // Save for the garden: no growth spending until it is paid for.
      return;
    }
    tryTargets(s, st, targets);   // then carry on growing: the spine is one cell a decision
  }

  // 5. Growth by the band plan. Save for the next office rather than spend on lifts and slabs.
  if (s.cash < TYPES.office.cost + RESERVE) return;
  const limit = s.cash >= RICH ? PER_DECISION_RICH : 1;
  for (let n = 0; n < limit; n++) if (growOnce(s, st) !== 'ok') break;
}

// Run the tower. Returns the per-quarter rows and the summary.
function play() {
  const s = newGame();
  const r = rng(SEED);
  const st = { wasted: 0, offices: 0, overloadSince: null, ctx: null };
  const rows = [];
  const firstAt = {};       // stars k -> first hour
  let firstProblem = null, loans = 0, gameOver = null, minCash = Infinity;
  // Poor spells: the longest run of hours with any poor unit, and with more than a quarter of let units poor.
  let poorRun = 0, poorMax = 0, poorQRun = 0, poorQMax = 0, poorHoursQ = 0;
  let poorQuarters = 0, overQuarterQuarters = 0, quarterPoorQ = 0;
  const maxHours = QUARTERS * 168;

  for (let h = 0; h < maxHours && !s.over; h++) {
    if (s.tick % DECIDE_EVERY === 0 && s.cash >= RESERVE) decide(s, st);
    const res = stepHour(s, r);
    minCash = Math.min(minCash, s.cash);
    for (let k = 2; k <= s.rating; k++) if (firstAt[k] == null) firstAt[k] = s.tick;
    const mood = moodCounts(s);
    const lets = mood.good + mood.fair + mood.poor;
    poorRun = mood.poor > 0 ? poorRun + 1 : 0; poorMax = Math.max(poorMax, poorRun);
    poorQRun = lets && mood.poor / lets > 0.25 ? poorQRun + 1 : 0; poorQMax = Math.max(poorQMax, poorQRun);
    if (mood.poor > 0) poorHoursQ++;
    quarterPoorQ = Math.max(quarterPoorQ, poorQRun);
    const reach = reachable(s);
    const cut = s.structures.filter(x => TYPES[x.type].kind === 'unit' && !reach.has(x.id)).length;
    const burnt = s.structures.filter(x => x.burnt).length;
    if (firstProblem == null && (mood.poor > 0 || cut > 0 || s.loan || burnt > 0)) firstProblem = s.tick;
    if (res.report) {
      const rep = res.report;
      if (rep.borrowed) loans++;
      if (poorHoursQ > 0) poorQuarters++;
      if (quarterPoorQ > 24) overQuarterQuarters++;
      const shafts = shaftsOf(s).filter(sh => !TYPES[sh.type].staff);
      const ctx = ctxOf(s);
      const free = BANDS.map(band => band.floors.reduce((n, f) => n + band.offices.filter(o => slotFree(ctx, o, f)).length, 0));
      rows.push({
        quarter: rep.quarter, cash: Math.round(s.cash), stars: s.rating, pop: s.population,
        good: mood.good, fair: mood.fair, poor: mood.poor, net: rep.net, borrowed: rep.borrowed,
        cut, shafts: shafts.length, cars: shafts.reduce((n, sh) => n + sh.cars, 0), wasted: st.wasted,
        peak: avgPeakOf(s), top: Math.max(...s.structures.filter(x => TYPES[x.type].kind === 'unit').map(x => x.floor), 1),
        poorHours: poorHoursQ, free,
      });
      poorHoursQ = 0; quarterPoorQ = 0;
      if (VERBOSE) {
        const row = rows[rows.length - 1];
        console.log(`Q${String(row.quarter).padStart(2)} $${String(row.cash).padStart(9)} ${row.stars}* pop ${String(row.pop).padStart(4)} mood ${row.good}/${row.fair}/${row.poor} net ${String(Math.round(row.net)).padStart(7)} shafts ${row.shafts} cars ${row.cars} cut ${row.cut} peak ${row.peak.toFixed(2)} top unit floor ${row.top} free slots ${row.free.join('/')} poor h ${row.poorHours}${row.borrowed ? ' LOAN' : ''}`);
      }
    }
  }
  if (s.over) gameOver = s.tick;
  return { s, rows, firstAt, firstProblem, loans, gameOver, minCash, st, poorMax, poorQMax, poorQuarters, overQuarterQuarters };
}

const out = play();
const { s, rows, firstAt, firstProblem, loans, gameOver, minCash, st } = out;
const quarterOfHour = (h) => Math.floor(h / 168) + 1;
const secs = (h) => Math.round((h * TICK_MS) / 1000);
console.log(`Bot report: seed ${SEED}, policy ${POLICY_NAME}, layout ${LAYOUT}, ${QUARTERS} quarters. Structures ${s.structures.length}, wasted placements ${st.wasted}.`);
for (const k of [2, 3, 4, 5]) {
  const h = firstAt[k];
  console.log(`  ${k} stars: ${h == null ? 'not reached' : `quarter ${quarterOfHour(h)}, after ${secs(h)} real seconds`}`);
}
console.log(`  stars by quarter: ${rows.map(r => r.stars).join('')}`);
console.log(`  Sky Garden crowned: ${s.wonAt == null ? 'no' : `quarter ${quarterOfHour(s.wonAt)}`}`);
console.log(`  loans taken: ${loans} (each $${LOAN_AMOUNT.toLocaleString()}); game over: ${gameOver == null ? 'no' : `quarter ${quarterOfHour(gameOver)}`}`);
console.log(`  lowest cash: $${Math.round(minCash)}`);
console.log(`  first decision problem (poor unit, cut-off unit, loan or burnt unit): ${firstProblem == null ? 'none' : `quarter ${quarterOfHour(firstProblem)}, after ${secs(firstProblem)} real seconds`}`);
console.log(`  poor units: in ${out.poorQuarters} quarters; longest spell with any poor unit ${out.poorMax} h; longest with over a quarter of let units poor ${out.poorQMax} h (${out.overQuarterQuarters} quarters over a day)`);
if (rows.length) {
  const last = rows[rows.length - 1];
  console.log(`  last quarter: Q${last.quarter}, ${last.stars} stars, pop ${last.pop}, mood ${last.good}/${last.fair}/${last.poor}, ${last.shafts} shafts, ${last.cars} cars, top unit floor ${last.top}`);
}

if (args.includes('--debug')) {
  const ctx = ctxOf(s);
  const { next, needs } = starNeeds(s);
  console.log(`debug: rating ${s.rating}, next ${next}, floor cap ${floorCap(s)}, cash $${Math.round(s.cash)}, dug ${s.dug}`);
  for (const n of needs) console.log(`  ${n.met ? 'met ' : 'NOT '} ${n.id}: ${n.label}`);
  for (const f of [1, 15, 16, 17, 30, 31, 32, 45, 46]) {
    const here = s.structures.filter(x => x.floor <= f && x.floor + TYPES[x.type].h > f).sort((a, b) => a.col - b.col)
      .map(x => `${x.type}${ctx.reach.has(x.id) ? '' : '(unreached)'}@${x.col}`);
    console.log(`  floor ${f}: ${here.join(' ')}`);
  }
  for (let b = 1; b < BANDS.length; b++) {
    const tr = transferTargets(s, ctx, b);
    console.log(`  transfer to band ${b + 1}: ready ${tr.ready}, open targets ${tr.targets.map(t => `${t.type}@${t.c},${t.f}`).slice(0, 8).join(' ')}`);
  }
  const svc = s.structures.filter(x => TYPES[x.type].kind === 'service' || x.type === 'hotel');
  console.log(`  services: ${svc.map(x => `${x.type}@${x.col},${x.floor}${x.type === 'hotel' ? ` happy ${Math.round(x.happy)}${x.dirty ? ' dirty' : ''}` : ''}`).join(' ')}; vip ${JSON.stringify(s.vip)}`);
  console.log(`  shafts: ${shaftsOf(s).map(sh => `${sh.type[0]}${sh.col}:${sh.lo}-${sh.hi}x${sh.cars}`).join(' ')}`);
}
