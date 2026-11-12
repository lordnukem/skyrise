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
  WALK_STEPS, GIVE_UP_HOURS, STRESS_TENSE, STRESS_HIGH, FOOD_RANGE, MEALS, NOISE_PENALTY, NOISY_TYPES, ESCALATOR_WALK,
  FLOORS_AT_STARS, BASEMENT_LEVELS, DIG_COST, HOTEL_CHECKIN, HOTEL_CHECKOUT, HOTEL_CHECKIN_CHANCE, HOTEL_CHECKOUT_CHANCE,
  HOTEL_WEEKEND_FILL, HOUSEKEEPING_RANGE, CLEAN_PER_HOUR, STAFF_LIFT_PENALTY, HALL_EVENTS, HALL_SEATS, HALL_POP_SHARE,
  PARKING_USERS, PERK_BONUS, CLINIC_RANGE, PLANT_RANGE, TRANSIT_VISITORS, GUIDE_OFFICES, NAME_MAX,
} from './constants.js';
import { cleanName } from './tenants.js';

export function newGame() {
  const s = {
    width: GRID_WIDTH, maxFloors: MAX_FLOORS, cash: START_CASH, tick: 0,
    nextId: 1, structures: [],
    dug: 0,                           // basement levels excavated (floor 0 is B1), saved
    // Derived each tick; kept on the state so the UI can read them cheaply.
    population: 0, visitors: 0, rating: 1, strain: 0, lastNet: 0,
    service: {},                      // unit id -> { wait, walk, peak }, derived, never saved
    facilities: new Set(),            // reachable service types, derived, never saved
    noisy: new Set(),                 // flat ids beside a noisy neighbour, derived, never saved
    diners: {},                       // food court id -> diners this hour, derived, never saved
    crowds: {},                       // event hall id -> guests this hour, derived, never saved
    perks: new Map(),                 // unit id -> ['parking', 'clinic', 'plant'], derived, never saved
    cleaners: new Map(),              // hotel room id -> { office, guestLift }, derived, never saved
    transit: newTransit(),            // walkers, queues and cars, derived, never saved
    quarter: newQuarter(1),           // running totals for the next report
    lastReport: null,                 // the most recent quarter report, saved
  };
  const start = Math.floor((s.width - START_LOBBY_WIDTH) / 2);
  for (let i = 0; i < START_LOBBY_WIDTH; i++) addStructure(s, 'lobby', start + i, 1);
  refreshDerived(s, reachable(s));
  return s;
}

function newQuarter(starsAt) {
  return { income: { office: 0, shop: 0, flat: 0, food: 0, hotel: 0, hall: 0 }, upkeep: 0, left: 0, starsAt };
}

function addStructure(s, type, col, floor) {
  // `cars` counts extra lift cars on a lift cell; `sold` marks a flat's one sale;
  // `rentLevel` is the unit's rent setting; `closed` marks a lift cell the cars pass without stopping;
  // `dirty` marks a hotel room that needs housekeeping; `tenant` counts the tenants who have moved in
  // (it picks the facade and name) and `name` is a custom name, or null. Carried on every structure to keep saves uniform.
  const st = { id: s.nextId++, type, col, floor, occupied: false, happy: HAPPY_NEUTRAL, unhappy: 0, cars: 0, sold: false, rentLevel: 'normal', closed: false, dirty: false, tenant: 0, name: null };
  s.structures.push(st);
  return st;
}

export const isLift = (type) => !!TYPES[type].span;
export const isLobbyFloor = (f) => f === 1 || (f > 1 && (f - 1) % SKY_LOBBY_EVERY === 0);
export const isUnlocked = (s, type) => !(UNLOCK_AT[type] > s.rating);
// Highest floor the plot allows at the current rating.
export const floorCap = (s) => Math.min(s.maxFloors, FLOORS_AT_STARS[s.rating - 1]);
// Lowest floor of the plot (the deepest basement level), dug or not.
export const LOWEST_FLOOR = 1 - BASEMENT_LEVELS;
// "floor 3" above ground, "B2" below it (floor 0 is B1).
export const floorName = (f) => (f >= 1 ? `floor ${f}` : `B${1 - f}`);

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
  const top = floor + t.h - 1;
  if (floor < LOWEST_FLOOR || top > s.maxFloors) return { ok: false, reason: 'Outside the plot' };
  if (top > floorCap(s)) {
    const at = FLOORS_AT_STARS.findIndex(n => n >= top) + 1;
    return { ok: false, reason: `Floors above ${floorCap(s)} open at ${at} stars` };
  }
  // Underground: the level must be dug (the support rule inverted), and only some types go there.
  if (floor < 1 && !t.under) return { ok: false, reason: `${t.label} cannot go underground` };
  if (t.under === 'only' && top >= 1) return { ok: false, reason: `${t.label} goes in the basement` };
  if (floor < 1 - s.dug) return { ok: false, reason: 'Dig this level first' };
  if (type === 'lobby' && !isLobbyFloor(floor)) return { ok: false, reason: `Lobby goes on floor 1 or every ${SKY_LOBBY_EVERY}th floor` };
  // A bare floor slab is built over: any other type may take its cell.
  const slabAt = (c, f) => type !== 'floor' && grid.get(key(c, f))?.type === 'floor';
  for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) {
    if (grid.has(key(col + dx, floor + dy)) && !slabAt(col + dx, floor + dy)) return { ok: false, reason: 'Space is taken' };
  }
  if (t.span) {
    // The run this cell would join: same lift type directly above and below.
    let lo = floor, hi = floor, o;
    while ((o = grid.get(key(col, lo - 1))) && o.type === type) lo--;
    while ((o = grid.get(key(col, hi + 1))) && o.type === type) hi++;
    if (hi - lo > t.span) return { ok: false, reason: `${t.label} shaft spans at most ${t.span} floors` };
  }
  // Support rule: above ground, every column needs something directly below (or a
  // slab it replaces). A slab may instead hang beside a structure on its floor.
  if (floor > 1) {
    const beside = type === 'floor' && (grid.has(key(col - 1, floor)) || grid.has(key(col + 1, floor)));
    for (let dx = 0; dx < t.w; dx++) {
      if (!grid.has(key(col + dx, floor - 1)) && !slabAt(col + dx, floor) && !beside) return { ok: false, reason: 'Needs a floor beneath it' };
    }
  }
  if (s.cash < t.cost) return { ok: false, reason: `Need $${t.cost}` };
  return { ok: true };
}

export function place(s, type, col, floor) {
  const res = canPlace(s, type, col, floor);
  if (!res.ok) return res;
  s.cash -= TYPES[type].cost;
  if (type !== 'floor') {
    // Slabs under the new structure are built over and go.
    const covered = new Set(cellsOf({ type, col, floor }).map(([c, f]) => key(c, f)));
    s.structures = s.structures.filter(x => x.type !== 'floor' || !covered.has(key(x.col, x.floor)));
  }
  const st = addStructure(s, type, col, floor);
  refreshDerived(s, reachable(s));
  return { ok: true, structure: st };
}

export function canDemolish(s, st, grid = buildGrid(s)) {
  const t = TYPES[st.type];
  const top = st.floor + t.h;
  // Floor 1 rests on the ground, so a basement room has nothing resting on it.
  if (top > 1) for (let dx = 0; dx < t.w; dx++) {
    if (grid.has(key(st.col + dx, top))) return { ok: false, reason: 'Something is built on top' };
  }
  if (st.type === 'lobby' && st.floor === 1 && s.structures.filter(x => x.type === 'lobby' && x.floor === 1).length === 1) {
    return { ok: false, reason: 'A tower needs a lobby' };
  }
  // A shaft comes down from an end, never from the middle (that would split it in two).
  if (isLift(st.type) && grid.get(key(st.col, st.floor + 1))?.type === st.type && grid.get(key(st.col, st.floor - 1))?.type === st.type) {
    return { ok: false, reason: 'Take a shaft down from its top or bottom' };
  }
  return { ok: true };
}

// Half the cost back, extra lift cars included; a sold flat was paid for by its owner, so $0.
export const refundOf = (st) => (st.type === 'flat' && st.sold ? 0
  : Math.round((TYPES[st.type].cost + (st.cars || 0) * LIFT_CAR_COST) * REFUND_RATIO));

// What demolishing `id` would do, without doing it: the refund, the people who
// leave with it (`evicted`) and the ids of the units and services that would lose
// their path to the lobby (`cut`).
export function previewDemolish(s, id) {
  const st = s.structures.find(x => x.id === id);
  if (!st) return { ok: false, reason: 'Nothing there' };
  const res = canDemolish(s, st);
  if (!res.ok) return res;
  const t = TYPES[st.type];
  const before = reachable(s);
  const after = reachable({ ...s, structures: s.structures.filter(x => x !== st) });
  const cut = s.structures.filter(x => x !== st && (TYPES[x.type].kind === 'unit' || TYPES[x.type].kind === 'service') &&
    before.has(x.id) && !after.has(x.id)).map(x => x.id);
  return { ok: true, refund: refundOf(st), evicted: st.occupied ? (t.people || t.guests || 0) : 0, occupied: !!st.occupied, cut };
}

// Excavate the basement level `floor` (0 is B1). A level needs the one above it dug first.
export function dig(s, floor) {
  const next = -s.dug;
  if (floor >= 1) return { ok: false, reason: 'Dig below the ground floor' };
  if (floor < LOWEST_FLOOR) return { ok: false, reason: `The basement goes ${BASEMENT_LEVELS} levels deep` };
  if (floor > next) return { ok: false, reason: 'Already dug' };
  if (floor < next) return { ok: false, reason: 'Dig the level above first' };
  if (s.cash < DIG_COST) return { ok: false, reason: `Need $${DIG_COST}` };
  s.cash -= DIG_COST;
  s.dug += 1;
  return { ok: true, level: s.dug };
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

// Open or close the stop of the lift cell at (col, floor); the shaft's bottom stop stays open.
export function toggleStop(s, col, floor) {
  const st = structureAt(s, col, floor);
  if (!st || !isLift(st.type)) return { ok: false, reason: 'Tap a lift shaft' };
  const sh = shaftsOf(s).find(x => x.col === st.col && x.lo <= st.floor && st.floor <= x.hi);
  if (st.floor === sh.lo && !st.closed) return { ok: false, reason: 'The bottom stop always stays open' };
  if (st.floor === 1 && !st.closed) return { ok: false, reason: 'The ground floor stop always stays open' };
  st.closed = !st.closed;
  refreshDerived(s, reachable(s));
  return { ok: true, closed: st.closed };
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
  const t = TYPES[st.type];
  // Tenants and guests leave at once (guests without paying); this is not "Moved out", which counts unhappiness.
  const evicted = st.occupied ? (t.people || t.guests || 0) : 0;
  s.structures = s.structures.filter(x => x !== st);
  const refund = refundOf(st);
  s.cash += refund;
  refreshDerived(s, reachable(s));
  return { ok: true, refund, evicted };
}

// Set or clear (empty) a unit's custom name; returns the stored name or null.
export function renameUnit(s, id, raw) {
  const st = s.structures.find(x => x.id === id);
  if (!st || TYPES[st.type].kind !== 'unit') return { ok: false, reason: 'Not a unit' };
  st.name = cleanName(raw);
  return { ok: true, name: st.name };
}

// Floors with a built lobby: where express lifts open their doors.
export const lobbyFloorsOf = (s) => new Set(s.structures.filter(x => x.type === 'lobby').map(x => x.floor));
// An express cell opens only on a lobby floor, and a closed stop never opens; both are sealed.
const sealed = (st, f, lobbies) => (st.type === 'express' && !lobbies.has(f)) || !!st.closed;

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
  for (let qi = 0; qi < queue.length; qi++) {   // index walk: shift() is O(n) on a big tower
    const [c, f] = queue[qi];
    const st = grid.get(key(c, f));
    ids.add(st.id);
    if (!sealed(st, f, lobbies)) { visitSide(c - 1, f); visitSide(c + 1, f); }
    // All cells of one structure are one room; this is how stairs span floors.
    for (const [cc, ff] of cellsOf(st)) visit(cc, ff);
    if (isLift(st.type) && !TYPES[st.type].staff) {   // a service lift carries no guests
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

// Contiguous runs of one lift type in one column: [{ col, lo, hi, type, cars, closed }].
// A shaft has one car plus every extra car bought on its cells, capped; `closed`
// lists the floors whose stop is closed.
export function shaftsOf(s, grid = buildGrid(s)) {
  const seen = new Set();
  const out = [];
  for (const st of s.structures) {
    if (!isLift(st.type) || seen.has(st.id)) continue;
    let lo = st.floor, hi = st.floor, o;
    while ((o = grid.get(key(st.col, lo - 1))) && o.type === st.type) lo--;
    while ((o = grid.get(key(st.col, hi + 1))) && o.type === st.type) hi++;
    let cars = 1;
    const closed = [];
    for (let f = lo; f <= hi; f++) { const c = grid.get(key(st.col, f)); seen.add(c.id); cars += c.cars || 0; if (c.closed) closed.push(f); }
    out.push({ col: st.col, lo, hi, type: st.type, cars: Math.min(LIFT_MAX_CARS, cars), closed });
  }
  return out;
}

// The shafts guests ride: every lift except the staff-only service lift.
export const guestShafts = (s, grid) => shaftsOf(s, grid).filter(sh => !TYPES[sh.type].staff);

// A shaft serves a floor it spans and stops at; an express shaft only where a lobby is built.
const serves = (sh, f, lobbies) => sh.lo <= f && f <= sh.hi && (sh.type !== 'express' || lobbies.has(f)) && !sh.closed.includes(f);
// Where riders from the ground board: floor 1 for a shaft that spans it, else the end nearest the ground.
const entryOf = (sh) => (sh.lo > 1 ? sh.lo : sh.hi < 1 ? sh.hi : 1);

// Feeders: for each shaft starting above ground, the shafts that span the ground
// floor and carry riders up to its bottom stop.
const feedersOf = (shafts, lobbies) => shafts.map((sh, i) => (sh.lo <= 1 ? [] :
  shafts.map((f, j) => (j !== i && f.lo <= 1 && f.hi >= 1 && serves(f, sh.lo, lobbies) ? j : -1)).filter(j => j >= 0)));

// Walking cost from floor 1 to floor f, up or down: 1 per floor by stairs,
// ESCALATOR_WALK for a floor step that a reachable escalator joins. Returns f -> cost.
function climbCosts(s, reach) {
  const lo = LOWEST_FLOOR, n = s.maxFloors - lo + 2;
  const step = new Array(n).fill(1);          // step[f - lo]: cost between floors f - 1 and f
  for (const st of s.structures) if (st.type === 'escalator' && reach.has(st.id)) step[st.floor + 1 - lo] = ESCALATOR_WALK;
  const out = new Array(n).fill(0);
  for (let f = 2; f - lo < n; f++) out[f - lo] = out[f - 1 - lo] + step[f - lo];
  for (let f = 0; f >= lo; f--) out[f - lo] = out[f + 1 - lo] + step[f + 1 - lo];
  return (f) => out[f - lo];
}

// What each reachable unit faces at this hour: `wait` is the load ratio of the
// least busy shaft serving its floor (plus the feeder it transfers from when
// the shaft starts above ground), `walk` the floors climbed by stairs.
export function liftService(s, reach, hour, weekend, shafts = guestShafts(s)) {
  const loads = new Array(shafts.length).fill(0);
  const cap = shafts.map(sh => TYPES[sh.type].capacity * sh.cars);
  const lobbies = lobbyFloorsOf(s);
  const feeders = feedersOf(shafts, lobbies);
  const climb = climbCosts(s, reach);
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
    if (!fs.length) return { wait: loads[i] / cap[i], walk: climb(entryOf(shafts[i])) };
    let best = fs[0];
    for (const j of fs) if (loads[j] / cap[j] < loads[best] / cap[best]) best = j;
    return { wait: loads[i] / cap[i] + loads[best] / cap[best], walk: climb(entryOf(shafts[best])) };
  };
  const out = {};
  for (const u of units) {
    if (u.floor === 1) { out[u.id] = { wait: 0, walk: 0 }; continue; }
    const idx = serving.get(u.floor);
    if (!idx.length) { out[u.id] = { wait: 0, walk: climb(u.floor) }; continue; }
    let best = leg(idx[0]);
    for (const i of idx) { const l = leg(i); if (l.wait < best.wait) best = l; }
    out[u.id] = best;
  }
  return out;
}

// Fill in the derived numbers without advancing time.
function refreshDerived(s, reach, grid = buildGrid(s)) {
  const all = shaftsOf(s, grid);
  const shafts = all.filter(sh => !TYPES[sh.type].staff);
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
  s.facilities = new Set(s.structures.filter(x => TYPES[x.type].kind === 'service' && reach.has(x.id)).map(x => x.type));
  s.visitors = shopVisitors(pop) + (s.facilities.has('transit') ? TRANSIT_VISITORS : 0);
  const cars = shafts.reduce((n, sh) => n + sh.cars, 0);
  const capacity = cars > 0 ? cars * ELEVATOR_CAPACITY : STAIR_ONLY_CAPACITY;
  s.strain = pop / capacity;
  const unreachable = units.filter(u => !reach.has(u.id)).length;
  s.rating = computeRating(pop, s.strain, units.length ? unreachable / units.length : 0, s.facilities);
  s.noisy = noisyFlats(s, grid);
  s.diners = dinersOf(s, reach, hourOf(s.tick));
  s.crowds = crowdsOf(s, reach, hourOf(s.tick), isWeekend(s.tick));
  s.perks = perksOf(s, reach);
  s.cleaners = cleanersOf(s, reach, all);
  syncTransit(s, reach, shafts);
}

// Flats and hotel rooms with a shop, food court or lift cell directly beside them on their floor.
function noisyFlats(s, grid) {
  const out = new Set();
  const noisy = (c, f) => { const o = grid.get(key(c, f)); return !!o && NOISY_TYPES.includes(o.type); };
  for (const st of s.structures) {
    if ((st.type === 'flat' || st.type === 'hotel') && (noisy(st.col - 1, st.floor) || noisy(st.col + TYPES[st.type].w, st.floor))) out.add(st.id);
  }
  return out;
}

// Guests per let event hall in an event hour: visitors plus a share of the
// tower's people, up to the seats, split evenly over the halls.
function crowdsOf(s, reach, hour, weekend) {
  const out = {};
  if (!HALL_EVENTS[weekend ? 'weekend' : 'weekday'].includes(hour)) return out;
  const halls = s.structures.filter(x => x.type === 'hall' && x.occupied && reach.has(x.id));
  if (!halls.length) return out;
  const crowd = Math.min(HALL_SEATS * halls.length, s.visitors + Math.floor(s.population * HALL_POP_SHARE));
  for (const h of halls) out[h.id] = Math.floor(crowd / halls.length);
  return out;
}

// Happiness perks per reachable unit: a car-park space (one per let office or
// flat, in structure order, while spaces last), a clinic or plant room in range.
function perksOf(s, reach) {
  const out = new Map();
  const live = (type) => s.structures.filter(x => x.type === type && reach.has(x.id));
  let spaces = live('parking').length * TYPES.parking.spaces;
  const clinics = live('clinic'), plants = live('plant');
  const near = (list, u, range) => list.some(x => Math.abs(x.floor - u.floor) <= range);
  for (const u of s.structures) {
    if (TYPES[u.type].kind !== 'unit' || !reach.has(u.id)) continue;
    const got = [];
    if (spaces > 0 && u.occupied && PARKING_USERS.includes(u.type)) { spaces--; got.push('parking'); }
    if (near(clinics, u, CLINIC_RANGE)) got.push('clinic');
    if (near(plants, u, PLANT_RANGE)) got.push('plant');
    if (got.length) out.set(u.id, got);
  }
  return out;
}
export const perkBonus = (s, id) => (s.perks.get(id) || []).reduce((n, p) => n + PERK_BONUS[p], 0);

// Which housekeeping office cleans each reachable hotel room: one in range that
// reaches it on its own floor or by a service lift spanning both floors, else the
// nearest in range, whose staff then ride the guest lifts (`guestLift`).
function cleanersOf(s, reach, shafts) {
  const out = new Map();
  const offices = s.structures.filter(x => x.type === 'housekeeping' && reach.has(x.id));
  if (!offices.length) return out;
  const service = shafts.filter(sh => TYPES[sh.type].staff);
  const byService = (a, b) => service.some(sh => sh.lo <= Math.min(a, b) && Math.max(a, b) <= sh.hi);
  for (const r of s.structures) {
    if (!TYPES[r.type].nightly || !reach.has(r.id)) continue;
    let best = null;
    for (const o of offices) {
      const d = Math.abs(o.floor - r.floor);
      if (d > HOUSEKEEPING_RANGE) continue;
      const guestLift = d > 0 && !byService(o.floor, r.floor);
      if (!best || (best.guestLift && !guestLift) || (best.guestLift === guestLift && d < best.d)) best = { office: o.id, guestLift, d };
    }
    if (best) out.set(r.id, { office: best.office, guestLift: best.guestLift });
  }
  return out;
}

// One hour of the hotel cycle. Housekeeping cleans first (so a room that checks
// out this hour stays dirty for at least a tick), then guests check out in the
// morning window and pay, then clean vacant rooms check in in the evening window.
function hotelHour(s, reach, rng) {
  const hour = hourOf(s.tick), weekend = isWeekend(s.tick);
  const rooms = s.structures.filter(x => TYPES[x.type].nightly && reach.has(x.id));
  let paid = 0;
  const cleaned = new Map();                  // office id -> rooms cleaned this hour
  for (const r of rooms) {
    const c = r.dirty && s.cleaners.get(r.id);
    if (!c || (cleaned.get(c.office) || 0) >= CLEAN_PER_HOUR) continue;
    cleaned.set(c.office, (cleaned.get(c.office) || 0) + 1);
    r.dirty = false;
  }
  const inWindow = ([a, b]) => hour >= a && hour <= b;
  for (const r of rooms) {
    if (r.occupied) {
      if (inWindow(HOTEL_CHECKOUT) && (hour === HOTEL_CHECKOUT[1] || rng() < HOTEL_CHECKOUT_CHANCE)) {
        r.occupied = false; r.dirty = true;
        const p = nightlyOf(r);
        paid += p; s.quarter.income.hotel += p;
      }
    } else if (!r.dirty && inWindow(HOTEL_CHECKIN) &&
      rng() < HOTEL_CHECKIN_CHANCE * (weekend ? HOTEL_WEEKEND_FILL : 1) * RENT_LEVELS[r.rentLevel].fill * r.happy / HAPPY_NEUTRAL) {
      r.occupied = true;
    }
  }
  return paid;
}

// Diners per let food court at this hour: MEALS[hour] of the people within
// FOOD_RANGE floors, each person split evenly over the courts in range.
function dinersOf(s, reach, hour) {
  const share = MEALS[hour];
  const out = {};
  if (!share) return out;
  const courts = s.structures.filter(x => x.type === 'food' && x.occupied && reach.has(x.id));
  if (!courts.length) return out;
  for (const c of courts) out[c.id] = 0;
  for (const u of s.structures) {
    const people = TYPES[u.type].people;
    if (!people || !u.occupied || !reach.has(u.id)) continue;
    const near = courts.filter(c => Math.abs(c.floor - u.floor) <= FOOD_RANGE);
    for (const c of near) out[c.id] += people * share / near.length;
  }
  for (const id in out) out[id] = Math.round(out[id]);
  return out;
}

// `facilities` is the Set of reachable service types; a missing one caps the stars.
export function computeRating(population, strain, unreachableRatio, facilities = new Set()) {
  let stars = 1 + STAR_POP.filter(p => population >= p).length;
  if (strain > 1) stars -= 1;
  if (unreachableRatio > VACANCY_PENALTY_RATIO) stars -= 1;
  for (const level in STAR_REQUIRES) if (STAR_REQUIRES[level].some(x => !facilities.has(x))) stars = Math.min(stars, level - 1);
  return Math.max(1, Math.min(5, stars));
}

// What the next star needs, each item met or missing: [{ id, label, met }]. Mirrors
// computeRating: the population bar, every service gate up to that star, lifts that
// keep up and few units cut off. `next` is null at 5 stars.
export function starNeeds(s) {
  const next = s.rating < 5 ? s.rating + 1 : null;
  if (!next) return { next, needs: [] };
  const reach = reachable(s);
  const units = s.structures.filter(x => TYPES[x.type].kind === 'unit');
  const cut = units.length ? units.filter(u => !reach.has(u.id)).length / units.length : 0;
  const pop = STAR_POP[next - 2];
  const needs = [{ id: 'pop', label: `${pop} people (now ${s.population})`, met: s.population >= pop }];
  for (const level in STAR_REQUIRES) {
    if (+level > next) continue;
    for (const type of STAR_REQUIRES[level]) needs.push({ id: type, label: `${TYPES[type].label} with a path to the lobby`, met: s.facilities.has(type) });
  }
  needs.push({ id: 'strain', label: `Lifts keep up (load ${Math.round(s.strain * 100)}% of 100%)`, met: s.strain <= 1 });
  needs.push({ id: 'reach', label: `At most ${VACANCY_PENALTY_RATIO * 100}% of units cut off (now ${Math.round(cut * 100)}%)`, met: cut <= VACANCY_PENALTY_RATIO });
  return { next, needs };
}

// The first-run guide's three goals: a lift from the lobby floor up to floor 2 or
// higher, GUIDE_OFFICES offices let, and one let unit at Good happiness.
export function guideGoals(s) {
  const reach = reachable(s);
  const grid = buildGrid(s);
  const lift = guestShafts(s, grid).some(sh => sh.lo <= 1 && sh.hi >= 2 && reach.has(grid.get(key(sh.col, 1)).id));
  const offices = s.structures.filter(x => x.type === 'office' && x.occupied).length >= GUIDE_OFFICES;
  const happy = s.structures.some(x => TYPES[x.type].kind === 'unit' && x.occupied && x.happy >= HAPPY_GOOD);
  return [lift, offices, happy];
}

// Hourly take of a let unit at its rent level (a flat's take is its one-off sale).
export function takeOf(s, st) {
  const t = TYPES[st.type];
  const diners = t.perDiner ? t.perDiner * (s.diners[st.id] || 0) : 0;
  const guests = t.perGuest ? t.perGuest * (s.crowds[st.id] || 0) : 0;
  return Math.round((t.rent + (t.perVisitor ? t.perVisitor * s.visitors : 0) + diners + guests) * RENT_LEVELS[st.rentLevel].take);
}
export const priceOf = (st) => Math.round(TYPES[st.type].price * RENT_LEVELS[st.rentLevel].take);
// What a hotel room's guests pay at checkout.
export const nightlyOf = (st) => Math.round(TYPES[st.type].nightly * RENT_LEVELS[st.rentLevel].take);

// One game hour. `rng` is injectable so tests can force outcomes.
export function stepTick(s, rng = Math.random) {
  const grid = buildGrid(s);   // structures do not change within a tick
  const reach = reachable(s, grid);
  let income = 0;
  let upkeep = 0;
  let left = 0;
  let sales = 0;
  for (const st of s.structures) {
    const t = TYPES[st.type];
    if (t.kind === 'unit') {
      if (!reach.has(st.id)) {                                            // tenants walk out, and their name goes with them
        if (st.occupied && !t.nightly) st.name = null;
        st.occupied = false; st.unhappy = 0;
      }
      else if (t.nightly) { /* hotel rooms let by the night: hotelHour below */ }
      else if (!st.occupied && rng() < FILL_CHANCE * RENT_LEVELS[st.rentLevel].fill * st.happy / HAPPY_NEUTRAL) {
        st.occupied = true;
        st.tenant += 1;                                                    // a new tenant may bring a new business
        // A flat sells once; after the owner leaves, the next buyer pays them, not you.
        if (t.price && !st.sold) { st.sold = true; const p = priceOf(st); sales += p; s.quarter.income[st.type] += p; }
      }
    }
    if (t.upkeep) upkeep += t.upkeep;
  }
  sales += hotelHour(s, reach, rng);
  // Happiness eases toward what the lifts offer this hour; sours fast, forgives slowly.
  const service = liftService(s, reach, hourOf(s.tick), isWeekend(s.tick));
  for (const st of s.structures) {
    const sv = service[st.id];
    if (!sv) continue;
    const noise = s.noisy.has(st.id) ? NOISE_PENALTY : 0;
    const staff = s.cleaners.get(st.id)?.guestLift ? STAFF_LIFT_PENALTY : 0;
    const target = Math.max(0, Math.min(100, 100 - WAIT_PENALTY * sv.wait - WALK_PENALTY_PER_FLOOR * sv.walk + RENT_LEVELS[st.rentLevel].happy
      - noise - staff + perkBonus(s, st.id)));
    st.happy += (target - st.happy) * (target < st.happy ? HAPPY_FALL : HAPPY_RISE);
    if (!st.occupied) { st.unhappy = 0; continue; }
    st.unhappy = st.happy < LEAVE_AT ? st.unhappy + 1 : 0;
    if (st.unhappy >= LEAVE_TICKS) {
      st.occupied = false; st.unhappy = 0; left++;
      if (TYPES[st.type].nightly) st.dirty = true; else st.name = null;
    }
  }
  refreshDerived(s, reach, grid);
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
    const total = Object.values(q.income).reduce((a, b) => a + b, 0);
    report = {
      quarter: quarterOf(s.tick - 1), income: { ...q.income }, upkeep: q.upkeep, net: total - q.upkeep,
      starsBefore: q.starsAt, starsAfter: s.rating, left: q.left,
    };
    s.lastReport = report;
    s.quarter = newQuarter(s.rating);
  }
  return { income, upkeep, net: s.lastNet, left, report };
}

// ---- People (agent model) ------------------------------------------------
// Lift riders as individual walkers. Each tick runs WALK_STEPS sub-steps: at
// the first, every let unit spawns its trips for the hour; each sub-step every
// shaft boards up to capacity x cars / WALK_STEPS walkers from its queue (FIFO)
// into its cars, and a ride lasts one sub-step. All of it is derived state:
// it is rebuilt when the shafts change and never saved.

function newTransit() {
  return {
    sig: '', shafts: [], feeders: [], lobbies: new Set(), serving: new Map(), reach: new Set(),
    riding: [], clock: 0, spawned: -1, done: 0, active: new Map(),
    stats: { trips: 0, wait: 0, gaveUp: 0 },   // finished trips and their summed queue hours
  };
}

// Rebuild the shaft records when the lift layout changes (dropping everyone in
// transit), and drop the walkers whose unit is gone, vacant or cut off.
function syncTransit(s, reach, shafts) {
  const t = s.transit;
  const lobbies = lobbyFloorsOf(s);
  const sig = shafts.map(sh => `${sh.col}:${sh.lo}:${sh.hi}:${sh.type}:${sh.cars}:${sh.closed.join('.')}`).join('|') +
    '/' + [...lobbies].sort((a, b) => a - b).join(',');
  t.reach = reach;
  if (sig !== t.sig) {
    t.sig = sig;
    t.lobbies = lobbies;
    t.feeders = feedersOf(shafts, lobbies);
    t.serving = new Map();
    t.shafts = shafts.map(sh => {
      const cap = TYPES[sh.type].capacity * sh.cars;
      return {
        col: sh.col, lo: sh.lo, hi: sh.hi, type: sh.type, closed: sh.closed, cap, perStep: cap / WALK_STEPS,
        credit: 0, next: 0, queue: [],
        cars: Array.from({ length: sh.cars }, () => ({ prev: sh.lo, at: sh.lo, to: sh.lo, n: 0 })),
      };
    });
    t.riding = [];
    t.active.clear();
    return;
  }
  let stale = false;
  const byId = t.active.size ? new Map(s.structures.map(x => [x.id, x])) : null;
  for (const id of t.active.keys()) {
    const u = byId.get(id);
    if (!u || !u.occupied || !reach.has(id)) { stale = true; break; }
  }
  if (!stale) return;
  const live = new Set(s.structures.filter(x => x.occupied && reach.has(x.id)).map(x => x.id));
  const keep = (w) => { if (live.has(w.unit)) return true; release(t, w); return false; };
  for (const sh of t.shafts) sh.queue = sh.queue.filter(keep);
  t.riding = t.riding.filter(keep);
}

function release(t, w) {
  const n = (t.active.get(w.unit) || 1) - 1;
  if (n > 0) t.active.set(w.unit, n); else t.active.delete(w.unit);
}

function finish(t, w) {
  t.stats.trips++;
  t.stats.wait += w.wait;
  release(t, w);
}

// Indices of the shafts that serve floor f, cached until the layout changes.
function servingOf(t, f) {
  let idx = t.serving.get(f);
  if (!idx) { idx = t.shafts.map((sh, i) => (serves(sh, f, t.lobbies) ? i : -1)).filter(i => i >= 0); t.serving.set(f, idx); }
  return idx;
}

// The legs [[shaft, from, to], ...] of one trip between the ground and floor f:
// the serving shaft (plus its feeder) with the shortest queue for its capacity.
function routeFor(t, idx, f, inbound) {
  const load = (i) => (t.shafts[i].queue.length + 1) / t.shafts[i].cap;
  let best = idx[0], feeder = -1, cost = Infinity;
  for (const i of idx) {
    const fs = t.feeders[i];
    let c = load(i), fi = -1;
    for (const j of fs) if (fi < 0 || load(j) < load(fi)) fi = j;
    if (fi >= 0) c += load(fi);
    if (c < cost) { cost = c; best = i; feeder = fi; }
  }
  const lo = entryOf(t.shafts[best]);
  if (feeder < 0) return inbound ? [[best, lo, f]] : [[best, f, lo]];
  return inbound ? [[feeder, 1, lo], [best, lo, f]] : [[best, f, lo], [feeder, lo, 1]];
}

// Trips for this hour: people x demand per let unit above the ground floor,
// rounded with `rng`, never more than the unit's people not already travelling.
// Offices travel in before noon and out after; flats the other way round.
function spawnTrips(s, t, rng) {
  const hour = hourOf(s.tick), weekend = isWeekend(s.tick);
  for (const u of s.structures) {
    const people = TYPES[u.type].people;
    if (!people || !u.occupied || u.floor === 1 || !t.reach.has(u.id)) continue;
    const x = people * demandAt(u.type, hour, weekend);
    let n = Math.floor(x);
    if (rng() < x - n) n++;
    n = Math.min(n, people - (t.active.get(u.id) || 0));
    if (n <= 0) continue;
    const idx = servingOf(t, u.floor);
    if (!idx.length) continue;
    const inbound = (u.type === 'office') === (hour < 12);
    for (let k = 0; k < n; k++) {
      const legs = routeFor(t, idx, u.floor, inbound);
      t.shafts[legs[0][0]].queue.push({ unit: u.id, legs, leg: 0, joined: t.clock, wait: 0, stress: 0, ride: false });
    }
    t.active.set(u.id, (t.active.get(u.id) || 0) + n);
  }
}

// One agent sub-step. Call WALK_STEPS times per tick, before stepTick.
export function stepWalkers(s, rng = Math.random) {
  const t = s.transit;
  if (t.spawned !== s.tick) { t.spawned = s.tick; t.done = 0; spawnTrips(s, t, rng); }
  // Last sub-step's riders step out: on to the next leg, or the trip is done.
  const arrived = t.riding;
  t.riding = [];
  for (const w of arrived) {
    w.ride = false;
    w.leg++;
    if (w.leg < w.legs.length) { w.joined = t.clock; t.shafts[w.legs[w.leg][0]].queue.push(w); }
    else finish(t, w);
  }
  const limit = GIVE_UP_HOURS * WALK_STEPS;
  for (const sh of t.shafts) {
    for (const c of sh.cars) { c.prev = c.to; c.at = c.to; c.n = 0; }
    sh.credit += sh.perStep;
    const n = Math.min(Math.floor(sh.credit), sh.queue.length);
    sh.credit -= n;
    if (n) {
      let j = 0;
      for (const w of sh.queue.splice(0, n)) {
        // Seats fill one by one through the sub-step: the j-th boarder waits (j + 0.5) / perStep of it.
        w.wait += (t.clock - w.joined + (j++ + 0.5) / sh.perStep) / WALK_STEPS;
        w.stress = Math.min(1, w.wait / GIVE_UP_HOURS);
        w.ride = true;
        const car = sh.cars[sh.next];
        sh.next = (sh.next + 1) % sh.cars.length;
        if (!car.n) { car.at = w.legs[w.leg][1]; car.to = w.legs[w.leg][2]; }
        car.n++;
        t.riding.push(w);
      }
    }
    if (!sh.queue.length) sh.credit -= Math.floor(sh.credit);   // unused seats do not bank
    // Whoever has queued GIVE_UP_HOURS without a car gives up and takes the stairs.
    let k = 0;
    while (k < sh.queue.length && t.clock - sh.queue[k].joined + 1 >= limit) k++;
    if (k) for (const w of sh.queue.splice(0, k)) { w.wait += limit / WALK_STEPS; t.stats.gaveUp++; finish(t, w); }
  }
  t.clock++;
  t.done++;
}

// Sub-steps already run for the current tick.
export const walkerStepsDone = (s) => (s.transit.spawned === s.tick ? s.transit.done : 0);

// The rest of this hour's sub-steps, then the hourly tick.
export function stepHour(s, rng = Math.random) {
  while (walkerStepsDone(s) < WALK_STEPS) stepWalkers(s, rng);
  return stepTick(s, rng);
}

// People in transit: queued at a door or riding a car.
export function inTransit(s) {
  const t = s.transit;
  let n = t.riding.length;
  for (const sh of t.shafts) n += sh.queue.length;
  return n;
}

// A walker's stress, 0..1: queue hours so far over GIVE_UP_HOURS.
export function stressOf(s, w) {
  if (w.ride) return w.stress;
  return Math.min(1, (w.wait + (s.transit.clock - w.joined) / WALK_STEPS) / GIVE_UP_HOURS);
}
export const stressBand = (x) => (x >= STRESS_HIGH ? 'stressed' : x >= STRESS_TENSE ? 'tense' : 'calm');

export function serialize(s) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state: {
      width: s.width, maxFloors: s.maxFloors, cash: s.cash, tick: s.tick, nextId: s.nextId, dug: s.dug,
      structures: s.structures.map(({ id, type, col, floor, occupied, happy, unhappy, cars, sold, rentLevel, closed, dirty, tenant, name }) =>
        ({ id, type, col, floor, occupied: !!occupied, happy, unhappy, cars, sold, rentLevel, closed: !!closed, dirty: !!dirty, tenant, name })),
      quarter: s.quarter,
      lastReport: s.lastReport,
    },
  };
}

// Returns a fresh state, or null when the blob is not something we wrote.
// Version 1 (no happiness, no report) loads with every unit at neutral; version 2
// (no cars, sales or rent levels) loads with one car per shaft and normal rent; version 3
// (no closed stops) loads with every stop open; version 4 (no basement) loads with nothing dug
// and every hotel room clean; version 5 (no tenants or names) loads with tenant 0 and no names.
// Walkers are never saved; `maxFloors` is always MAX_FLOORS. Imported files are untrusted: every field is checked.
export function deserialize(blob) {
  if (!blob || typeof blob !== 'object' || ![1, 2, 3, 4, 5, SAVE_VERSION].includes(blob.version)) return null;
  const d = blob.state;
  if (!d || typeof d !== 'object' || !Array.isArray(d.structures)) return null;
  if (!Number.isFinite(d.cash) || !Number.isInteger(d.tick) || !Number.isInteger(d.nextId)) return null;
  const s = newGame();
  s.structures = [];
  s.cash = d.cash;
  s.tick = d.tick;
  s.nextId = d.nextId;
  if (Number.isInteger(d.width)) s.width = d.width;
  s.dug = Number.isInteger(d.dug) ? Math.max(0, Math.min(BASEMENT_LEVELS, d.dug)) : 0;
  for (const r of d.structures) {
    if (!r || !TYPES[r.type] || !Number.isInteger(r.col) || !Number.isInteger(r.floor) || !Number.isInteger(r.id)) return null;
    if (r.floor < 1 - s.dug) return null;     // below the dug basement: not something we wrote
    s.structures.push({
      id: r.id, type: r.type, col: r.col, floor: r.floor, occupied: !!r.occupied,
      happy: Number.isFinite(r.happy) ? Math.max(0, Math.min(100, r.happy)) : HAPPY_NEUTRAL,
      unhappy: Number.isInteger(r.unhappy) ? r.unhappy : 0,
      cars: Number.isInteger(r.cars) && r.cars > 0 ? r.cars : 0,
      sold: !!r.sold,
      rentLevel: RENT_LEVELS[r.rentLevel] ? r.rentLevel : 'normal',
      closed: !!r.closed,
      dirty: !!r.dirty,
      tenant: Number.isInteger(r.tenant) && r.tenant >= 0 ? r.tenant : 0,
      name: typeof r.name === 'string' && r.name.length <= NAME_MAX ? cleanName(r.name) : null,
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
