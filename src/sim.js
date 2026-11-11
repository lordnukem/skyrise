// Pure simulation: no DOM, no canvas, no timers. Everything here takes a
// state object and returns plain data so it can run under Node for tests.

import {
  SAVE_VERSION, GRID_WIDTH, MAX_FLOORS, START_LOBBY_WIDTH, START_CASH,
  FILL_CHANCE, REFUND_RATIO, SHOP_WALKINS, SHOP_VISITOR_RATIO, SHOP_VISITOR_CAP,
  STAR_POP, ELEVATOR_CAPACITY, STAIR_ONLY_CAPACITY, VACANCY_PENALTY_RATIO, TYPES,
  HOURS_PER_DAY, DAYS_PER_WEEK, WEEKEND_DAYS, DAYS_PER_QUARTER, DEMAND,
  WAIT_PENALTY, WALK_PENALTY_PER_FLOOR,
  HAPPY_NEUTRAL, HAPPY_GOOD, HAPPY_POOR, HAPPY_FALL, HAPPY_RISE, LEAVE_AT, LEAVE_TICKS,
  STAR_REQUIRES, UNLOCK_AT, LIFT_MAX_CARS, LIFT_CAR_COST, SKY_LOBBY_EVERY, RENT_LEVELS, RENT_ORDER,
} from './constants.js';

export function newGame() {
  const s = {
    width: GRID_WIDTH, maxFloors: MAX_FLOORS, cash: START_CASH, tick: 0,
    nextId: 1, structures: [],
    // Derived each tick; kept on the state so the UI can read them cheaply.
    population: 0, visitors: 0, rating: 1, strain: 0, lastNet: 0,
    service: {},                      // unit id -> { wait, walk, peak }, derived, never saved
    facilities: new Set(),            // reachable service types, derived, never saved
    quarter: newQuarter(1),           // running totals for the next report
    lastReport: null,                 // the most recent quarter report, saved
  };
  const start = Math.floor((s.width - START_LOBBY_WIDTH) / 2);
  for (let i = 0; i < START_LOBBY_WIDTH; i++) addStructure(s, 'lobby', start + i, 1);
  refreshDerived(s, reachable(s));
  return s;
}

function newQuarter(starsAt) {
  return { income: { office: 0, shop: 0, flat: 0 }, upkeep: 0, left: 0, starsAt };
}

function addStructure(s, type, col, floor) {
  // `cars` counts extra lift cars on a lift cell; `sold` marks a flat's one sale;
  // `rentLevel` is the unit's rent setting. Carried on every structure to keep saves uniform.
  const st = { id: s.nextId++, type, col, floor, occupied: false, happy: HAPPY_NEUTRAL, unhappy: 0, cars: 0, sold: false, rentLevel: 'normal' };
  s.structures.push(st);
  return st;
}

export const isLift = (type) => !!TYPES[type].span;
export const isLobbyFloor = (f) => f === 1 || (f - 1) % SKY_LOBBY_EVERY === 0;
export const isUnlocked = (s, type) => !(UNLOCK_AT[type] > s.rating);

// ---- Clock ---------------------------------------------------------------
export const hourOf = (tick) => tick % HOURS_PER_DAY;
export const dayOf = (tick) => Math.floor(tick / HOURS_PER_DAY);
export const weekdayOf = (tick) => dayOf(tick) % DAYS_PER_WEEK;      // 0 = Mon
export const isWeekend = (tick) => WEEKEND_DAYS.includes(weekdayOf(tick));
export const QUARTER_TICKS = DAYS_PER_QUARTER * HOURS_PER_DAY;
export const quarterOf = (tick) => Math.floor(tick / QUARTER_TICKS) + 1;

// Share of a unit's people riding the lift in this hour.
export function demandAt(type, hour, weekend) {
  const d = DEMAND[type];
  return d ? (weekend ? d.weekend : d.weekday)[hour] : 0;
}

export function happyBand(h) {
  return h >= HAPPY_GOOD ? 'good' : h < HAPPY_POOR ? 'poor' : 'fair';
}

export function cellsOf(st) {
  const t = TYPES[st.type];
  const out = [];
  for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) out.push([st.col + dx, st.floor + dy]);
  return out;
}

const key = (c, f) => c + ',' + f;

// Map "col,floor" -> structure. Rebuilt on demand; the grid is small.
export function buildGrid(s) {
  const g = new Map();
  for (const st of s.structures) for (const [c, f] of cellsOf(st)) g.set(key(c, f), st);
  return g;
}

export function structureAt(s, col, floor, grid = buildGrid(s)) {
  return grid.get(key(col, floor)) || null;
}

// Returns { ok, reason } so the UI can explain refusals in one line.
export function canPlace(s, type, col, floor, grid = buildGrid(s)) {
  const t = TYPES[type];
  if (!t) return { ok: false, reason: 'Unknown type' };
  if (!isUnlocked(s, type)) return { ok: false, reason: `Unlocks at ${UNLOCK_AT[type]} stars` };
  if (col < 0 || col + t.w > s.width) return { ok: false, reason: 'Outside the plot' };
  if (floor < 1 || floor + t.h - 1 > s.maxFloors) return { ok: false, reason: 'Outside the plot' };
  if (type === 'lobby' && !isLobbyFloor(floor)) return { ok: false, reason: `Lobby goes on floor 1 or every ${SKY_LOBBY_EVERY}th floor` };
  for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) {
    if (grid.has(key(col + dx, floor + dy))) return { ok: false, reason: 'Space is taken' };
  }
  if (t.span) {
    // The run this cell would join: same lift type directly above and below.
    let lo = floor, hi = floor, o;
    while ((o = grid.get(key(col, lo - 1))) && o.type === type) lo--;
    while ((o = grid.get(key(col, hi + 1))) && o.type === type) hi++;
    if (hi - lo > t.span) return { ok: false, reason: `${t.label} shaft spans at most ${t.span} floors` };
  }
  // Support rule: above ground, every column needs something directly below.
  if (floor > 1) {
    for (let dx = 0; dx < t.w; dx++) {
      if (!grid.has(key(col + dx, floor - 1))) return { ok: false, reason: 'Needs a floor beneath it' };
    }
  }
  if (s.cash < t.cost) return { ok: false, reason: `Need $${t.cost}` };
  return { ok: true };
}

export function place(s, type, col, floor) {
  const res = canPlace(s, type, col, floor);
  if (!res.ok) return res;
  s.cash -= TYPES[type].cost;
  const st = addStructure(s, type, col, floor);
  refreshDerived(s, reachable(s));
  return { ok: true, structure: st };
}

export function canDemolish(s, st, grid = buildGrid(s)) {
  const t = TYPES[st.type];
  const top = st.floor + t.h;
  for (let dx = 0; dx < t.w; dx++) {
    if (grid.has(key(st.col + dx, top))) return { ok: false, reason: 'Something is built on top' };
  }
  if (st.type === 'lobby' && st.floor === 1 && s.structures.filter(x => x.type === 'lobby' && x.floor === 1).length === 1) {
    return { ok: false, reason: 'A tower needs a lobby' };
  }
  return { ok: true };
}

// Add a car to the shaft under (col, floor): any lift cell of it will do.
export function addCar(s, col, floor) {
  const st = structureAt(s, col, floor);
  if (!st || !isLift(st.type)) return { ok: false, reason: 'Tap a lift shaft' };
  const sh = shaftsOf(s).find(x => x.col === st.col && x.lo <= st.floor && st.floor <= x.hi);
  if (sh.cars >= LIFT_MAX_CARS) return { ok: false, reason: `A shaft holds at most ${LIFT_MAX_CARS} cars` };
  if (s.cash < LIFT_CAR_COST) return { ok: false, reason: `Need $${LIFT_CAR_COST}` };
  s.cash -= LIFT_CAR_COST;
  st.cars += 1;
  refreshDerived(s, reachable(s));
  return { ok: true, cars: sh.cars + 1 };
}

// Step a unit's rent level low -> normal -> high -> low.
export function cycleRent(s, id) {
  const st = s.structures.find(x => x.id === id);
  if (!st || TYPES[st.type].kind !== 'unit') return { ok: false, reason: 'Not a unit' };
  st.rentLevel = RENT_ORDER[(RENT_ORDER.indexOf(st.rentLevel) + 1) % RENT_ORDER.length];
  return { ok: true, level: st.rentLevel };
}

export function demolish(s, id) {
  const st = s.structures.find(x => x.id === id);
  if (!st) return { ok: false, reason: 'Nothing there' };
  const res = canDemolish(s, st);
  if (!res.ok) return res;
  s.structures = s.structures.filter(x => x !== st);
  const refund = Math.round(TYPES[st.type].cost * REFUND_RATIO);
  s.cash += refund;
  refreshDerived(s, reachable(s));
  return { ok: true, refund };
}

// Floors with a built lobby: where express lifts open their doors.
export const lobbyFloorsOf = (s) => new Set(s.structures.filter(x => x.type === 'lobby').map(x => x.floor));
// An express cell opens only on a lobby floor; elsewhere it is sealed.
const sealed = (st, f, lobbies) => st.type === 'express' && !lobbies.has(f);

// BFS over cells from every ground-floor lobby cell. Returns the Set of
// reachable ids. Sky lobbies are transfer hubs, not entrances.
export function reachable(s, grid = buildGrid(s)) {
  const seenCells = new Set();
  const ids = new Set();
  const queue = [];
  const lobbies = lobbyFloorsOf(s);
  for (const st of s.structures) {
    if (st.type !== 'lobby' || st.floor !== 1) continue;
    for (const [c, f] of cellsOf(st)) { queue.push([c, f]); seenCells.add(key(c, f)); }
  }
  const visit = (c, f) => {
    const k = key(c, f);
    if (seenCells.has(k) || !grid.has(k)) return;
    seenCells.add(k);
    queue.push([c, f]);
  };
  const visitSide = (c, f) => {
    const other = grid.get(key(c, f));
    if (other && !sealed(other, f, lobbies)) visit(c, f);
  };
  while (queue.length) {
    const [c, f] = queue.shift();
    const st = grid.get(key(c, f));
    ids.add(st.id);
    if (!sealed(st, f, lobbies)) { visitSide(c - 1, f); visitSide(c + 1, f); }
    // All cells of one structure are one room; this is how stairs span floors.
    for (const [cc, ff] of cellsOf(st)) visit(cc, ff);
    if (isLift(st.type)) {
      for (const ff of [f - 1, f + 1]) {
        const other = grid.get(key(c, ff));
        if (other && other.type === st.type) visit(c, ff);
      }
    }
  }
  return ids;
}

export function shopVisitors(population) {
  return Math.min(SHOP_VISITOR_CAP, SHOP_WALKINS + Math.floor(population * SHOP_VISITOR_RATIO));
}

// Contiguous runs of one lift type in one column: [{ col, lo, hi, type, cars }].
// A shaft has one car plus every extra car bought on its cells, capped.
export function shaftsOf(s, grid = buildGrid(s)) {
  const seen = new Set();
  const out = [];
  for (const st of s.structures) {
    if (!isLift(st.type) || seen.has(st.id)) continue;
    let lo = st.floor, hi = st.floor, o;
    while ((o = grid.get(key(st.col, lo - 1))) && o.type === st.type) lo--;
    while ((o = grid.get(key(st.col, hi + 1))) && o.type === st.type) hi++;
    let cars = 1;
    for (let f = lo; f <= hi; f++) { const c = grid.get(key(st.col, f)); seen.add(c.id); cars += c.cars || 0; }
    out.push({ col: st.col, lo, hi, type: st.type, cars: Math.min(LIFT_MAX_CARS, cars) });
  }
  return out;
}

// A shaft serves a floor it spans; an express shaft only where a lobby is built.
const serves = (sh, f, lobbies) => sh.lo <= f && f <= sh.hi && (sh.type !== 'express' || lobbies.has(f));

// What each reachable unit faces at this hour: `wait` is the load ratio of the
// least busy shaft serving its floor (plus the feeder it transfers from when
// the shaft starts above ground), `walk` the floors climbed by stairs.
export function liftService(s, reach, hour, weekend, shafts = shaftsOf(s)) {
  const loads = new Array(shafts.length).fill(0);
  const cap = shafts.map(sh => TYPES[sh.type].capacity * sh.cars);
  const lobbies = lobbyFloorsOf(s);
  // Feeders: shafts that carry riders from the ground up to this shaft's bottom stop.
  const feeders = shafts.map((sh, i) => (sh.lo === 1 ? [] :
    shafts.map((f, j) => (j !== i && f.lo === 1 && serves(f, sh.lo, lobbies) ? j : -1)).filter(j => j >= 0)));
  const serving = new Map();                  // floor -> indices of shafts serving it
  const units = s.structures.filter(u => TYPES[u.type].kind === 'unit' && reach.has(u.id));
  for (const u of units) {
    if (u.floor === 1 || serving.has(u.floor)) continue;
    serving.set(u.floor, shafts.map((sh, i) => (serves(sh, u.floor, lobbies) ? i : -1)).filter(i => i >= 0));
  }
  for (const u of units) {
    if (u.floor === 1 || !u.occupied) continue;
    const idx = serving.get(u.floor);
    if (!idx.length) continue;
    const riders = TYPES[u.type].people * demandAt(u.type, hour, weekend);
    for (const i of idx) {
      loads[i] += riders / idx.length;
      for (const j of feeders[i]) loads[j] += riders / idx.length / feeders[i].length;
    }
  }
  const leg = (i) => {                        // { wait, walk } of riding shaft i from the ground
    const fs = feeders[i];
    if (!fs.length) return { wait: loads[i] / cap[i], walk: shafts[i].lo - 1 };
    let best = fs[0];
    for (const j of fs) if (loads[j] / cap[j] < loads[best] / cap[best]) best = j;
    return { wait: loads[i] / cap[i] + loads[best] / cap[best], walk: shafts[best].lo - 1 };
  };
  const out = {};
  for (const u of units) {
    if (u.floor === 1) { out[u.id] = { wait: 0, walk: 0 }; continue; }
    const idx = serving.get(u.floor);
    if (!idx.length) { out[u.id] = { wait: 0, walk: u.floor - 1 }; continue; }
    let best = leg(idx[0]);
    for (const i of idx) { const l = leg(i); if (l.wait < best.wait) best = l; }
    out[u.id] = best;
  }
  return out;
}

// Fill in the derived numbers without advancing time.
function refreshDerived(s, reach) {
  const shafts = shaftsOf(s);
  s.service = liftService(s, reach, hourOf(s.tick), isWeekend(s.tick), shafts);
  // The load at the type's weekday peak hour, so the card can warn off-peak.
  const peaks = new Map();
  const byId = new Map(s.structures.map(x => [x.id, x]));
  for (const id in s.service) {
    const u = byId.get(+id);
    const peak = DEMAND[u.type] ? DEMAND[u.type].peak : DEMAND.office.peak;
    if (!peaks.has(peak)) peaks.set(peak, liftService(s, reach, peak, false, shafts));
    s.service[id].peak = peaks.get(peak)[id].wait;
  }
  let pop = 0;
  const units = s.structures.filter(x => TYPES[x.type].kind === 'unit');
  for (const u of units) if (u.occupied) pop += TYPES[u.type].people;
  s.population = pop;
  s.visitors = shopVisitors(pop);
  const cars = shafts.reduce((n, sh) => n + sh.cars, 0);
  const capacity = cars > 0 ? cars * ELEVATOR_CAPACITY : STAIR_ONLY_CAPACITY;
  s.strain = pop / capacity;
  const unreachable = units.filter(u => !reach.has(u.id)).length;
  s.facilities = new Set(s.structures.filter(x => TYPES[x.type].kind === 'service' && reach.has(x.id)).map(x => x.type));
  s.rating = computeRating(pop, s.strain, units.length ? unreachable / units.length : 0, s.facilities);
}

// `facilities` is the Set of reachable service types; a missing one caps the stars.
export function computeRating(population, strain, unreachableRatio, facilities = new Set()) {
  let stars = 1 + STAR_POP.filter(p => population >= p).length;
  if (strain > 1) stars -= 1;
  if (unreachableRatio > VACANCY_PENALTY_RATIO) stars -= 1;
  for (const level in STAR_REQUIRES) if (!facilities.has(STAR_REQUIRES[level])) stars = Math.min(stars, level - 1);
  return Math.max(1, Math.min(5, stars));
}

// Hourly take of a let unit at its rent level (a flat's take is its one-off sale).
export function takeOf(s, st) {
  const t = TYPES[st.type];
  return Math.round((t.rent + (t.perVisitor ? t.perVisitor * s.visitors : 0)) * RENT_LEVELS[st.rentLevel].take);
}
export const priceOf = (st) => Math.round(TYPES[st.type].price * RENT_LEVELS[st.rentLevel].take);

// One game hour. `rng` is injectable so tests can force outcomes.
export function stepTick(s, rng = Math.random) {
  const reach = reachable(s);
  let income = 0;
  let upkeep = 0;
  let left = 0;
  let sales = 0;
  for (const st of s.structures) {
    const t = TYPES[st.type];
    if (t.kind === 'unit') {
      if (!reach.has(st.id)) { st.occupied = false; st.unhappy = 0; }   // tenants walk out
      else if (!st.occupied && rng() < FILL_CHANCE * RENT_LEVELS[st.rentLevel].fill * st.happy / HAPPY_NEUTRAL) {
        st.occupied = true;
        // A flat sells once; after the owner leaves, the next buyer pays them, not you.
        if (t.price && !st.sold) { st.sold = true; const p = priceOf(st); sales += p; s.quarter.income[st.type] += p; }
      }
    }
    if (t.upkeep) upkeep += t.upkeep;
  }
  // Happiness eases toward what the lifts offer this hour; sours fast, forgives slowly.
  const service = liftService(s, reach, hourOf(s.tick), isWeekend(s.tick));
  for (const st of s.structures) {
    const sv = service[st.id];
    if (!sv) continue;
    const target = Math.max(0, Math.min(100, 100 - WAIT_PENALTY * sv.wait - WALK_PENALTY_PER_FLOOR * sv.walk + RENT_LEVELS[st.rentLevel].happy));
    st.happy += (target - st.happy) * (target < st.happy ? HAPPY_FALL : HAPPY_RISE);
    if (!st.occupied) { st.unhappy = 0; continue; }
    st.unhappy = st.happy < LEAVE_AT ? st.unhappy + 1 : 0;
    if (st.unhappy >= LEAVE_TICKS) { st.occupied = false; st.unhappy = 0; left++; }
  }
  refreshDerived(s, reach);
  income += sales;
  for (const st of s.structures) {
    const t = TYPES[st.type];
    if (t.kind !== 'unit' || !st.occupied) continue;
    const take = takeOf(s, st);
    income += take;
    s.quarter.income[st.type] += take;
  }
  s.quarter.upkeep += upkeep;
  s.quarter.left += left;
  s.lastNet = income - upkeep;
  s.cash += s.lastNet;
  s.tick += 1;
  let report = null;
  if (s.tick % QUARTER_TICKS === 0) {
    const q = s.quarter;
    const total = q.income.office + q.income.shop + q.income.flat;
    report = {
      quarter: quarterOf(s.tick - 1), income: { ...q.income }, upkeep: q.upkeep, net: total - q.upkeep,
      starsBefore: q.starsAt, starsAfter: s.rating, left: q.left,
    };
    s.lastReport = report;
    s.quarter = newQuarter(s.rating);
  }
  return { income, upkeep, net: s.lastNet, left, report };
}

export function serialize(s) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state: {
      width: s.width, maxFloors: s.maxFloors, cash: s.cash, tick: s.tick, nextId: s.nextId,
      structures: s.structures.map(({ id, type, col, floor, occupied, happy, unhappy, cars, sold, rentLevel }) =>
        ({ id, type, col, floor, occupied: !!occupied, happy, unhappy, cars, sold, rentLevel })),
      quarter: s.quarter,
      lastReport: s.lastReport,
    },
  };
}

// Returns a fresh state, or null when the blob is not something we wrote.
// Version 1 (no happiness, no report) loads with every unit at neutral; version 2
// (no cars, sales or rent levels) loads with one car per shaft and normal rent.
export function deserialize(blob) {
  if (!blob || typeof blob !== 'object' || ![1, 2, SAVE_VERSION].includes(blob.version)) return null;
  const d = blob.state;
  if (!d || typeof d !== 'object' || !Array.isArray(d.structures)) return null;
  if (!Number.isFinite(d.cash) || !Number.isInteger(d.tick) || !Number.isInteger(d.nextId)) return null;
  const s = newGame();
  s.structures = [];
  s.cash = d.cash;
  s.tick = d.tick;
  s.nextId = d.nextId;
  if (Number.isInteger(d.width)) s.width = d.width;
  if (Number.isInteger(d.maxFloors)) s.maxFloors = d.maxFloors;
  for (const r of d.structures) {
    if (!r || !TYPES[r.type] || !Number.isInteger(r.col) || !Number.isInteger(r.floor) || !Number.isInteger(r.id)) return null;
    s.structures.push({
      id: r.id, type: r.type, col: r.col, floor: r.floor, occupied: !!r.occupied,
      happy: Number.isFinite(r.happy) ? Math.max(0, Math.min(100, r.happy)) : HAPPY_NEUTRAL,
      unhappy: Number.isInteger(r.unhappy) ? r.unhappy : 0,
      cars: Number.isInteger(r.cars) && r.cars > 0 ? r.cars : 0,
      sold: !!r.sold,
      rentLevel: RENT_LEVELS[r.rentLevel] ? r.rentLevel : 'normal',
    });
  }
  if (!s.structures.some(x => x.type === 'lobby' && x.floor === 1)) return null;
  const q = d.quarter;
  if (q && typeof q === 'object' && q.income && typeof q.income === 'object') {
    s.quarter = newQuarter(Number.isInteger(q.starsAt) ? q.starsAt : 1);
    for (const k in s.quarter.income) if (Number.isFinite(q.income[k])) s.quarter.income[k] = q.income[k];
    if (Number.isFinite(q.upkeep)) s.quarter.upkeep = q.upkeep;
    if (Number.isInteger(q.left)) s.quarter.left = q.left;
  }
  if (d.lastReport && typeof d.lastReport === 'object') s.lastReport = d.lastReport;
  refreshDerived(s, reachable(s));
  if (!q) s.quarter.starsAt = s.rating;
  return s;
}
