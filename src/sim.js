// Pure simulation: no DOM, no canvas, no timers. Everything here takes a
// state object and returns plain data so it can run under Node for tests.

import {
  SAVE_VERSION, GRID_WIDTH, MAX_FLOORS, START_LOBBY_WIDTH, START_CASH,
  FILL_CHANCE, REFUND_RATIO, SHOP_WALKINS, SHOP_VISITOR_RATIO, SHOP_VISITOR_CAP,
  STAR_POP, ELEVATOR_CAPACITY, STAIR_ONLY_CAPACITY, VACANCY_PENALTY_RATIO, TYPES,
} from './constants.js';

export function newGame() {
  const s = {
    width: GRID_WIDTH, maxFloors: MAX_FLOORS, cash: START_CASH, tick: 0,
    nextId: 1, structures: [],
    // Derived each tick; kept on the state so the UI can read them cheaply.
    population: 0, visitors: 0, rating: 1, strain: 0, lastNet: 0,
  };
  const start = Math.floor((s.width - START_LOBBY_WIDTH) / 2);
  for (let i = 0; i < START_LOBBY_WIDTH; i++) addStructure(s, 'lobby', start + i, 1);
  refreshDerived(s, reachable(s));
  return s;
}

function addStructure(s, type, col, floor) {
  const st = { id: s.nextId++, type, col, floor, occupied: false };
  s.structures.push(st);
  return st;
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
  if (col < 0 || col + t.w > s.width) return { ok: false, reason: 'Outside the plot' };
  if (floor < 1 || floor + t.h - 1 > s.maxFloors) return { ok: false, reason: 'Outside the plot' };
  if (type === 'lobby' && floor !== 1) return { ok: false, reason: 'Lobby goes on the ground floor' };
  for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) {
    if (grid.has(key(col + dx, floor + dy))) return { ok: false, reason: 'Space is taken' };
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
  if (st.type === 'lobby' && s.structures.filter(x => x.type === 'lobby').length === 1) {
    return { ok: false, reason: 'A tower needs a lobby' };
  }
  return { ok: true };
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

// BFS over cells from every lobby cell. Returns the Set of reachable ids.
export function reachable(s, grid = buildGrid(s)) {
  const seenCells = new Set();
  const ids = new Set();
  const queue = [];
  for (const st of s.structures) {
    if (st.type !== 'lobby') continue;
    for (const [c, f] of cellsOf(st)) { queue.push([c, f]); seenCells.add(key(c, f)); }
  }
  const visit = (c, f) => {
    const k = key(c, f);
    if (seenCells.has(k) || !grid.has(k)) return;
    seenCells.add(k);
    queue.push([c, f]);
  };
  while (queue.length) {
    const [c, f] = queue.shift();
    const st = grid.get(key(c, f));
    ids.add(st.id);
    visit(c - 1, f);
    visit(c + 1, f);
    // All cells of one structure are one room; this is how stairs span floors.
    for (const [cc, ff] of cellsOf(st)) visit(cc, ff);
    if (st.type === 'elevator') {
      for (const ff of [f - 1, f + 1]) {
        const other = grid.get(key(c, ff));
        if (other && other.type === 'elevator') visit(c, ff);
      }
    }
  }
  return ids;
}

export function shopVisitors(population) {
  return Math.min(SHOP_VISITOR_CAP, SHOP_WALKINS + Math.floor(population * SHOP_VISITOR_RATIO));
}

function countShafts(s) {
  return new Set(s.structures.filter(x => x.type === 'elevator').map(x => x.col)).size;
}

// Fill in the derived numbers without advancing time.
function refreshDerived(s, reach) {
  let pop = 0;
  const units = s.structures.filter(x => TYPES[x.type].kind === 'unit');
  for (const u of units) if (u.occupied) pop += TYPES[u.type].people;
  s.population = pop;
  s.visitors = shopVisitors(pop);
  const shafts = countShafts(s);
  const capacity = shafts > 0 ? shafts * ELEVATOR_CAPACITY : STAIR_ONLY_CAPACITY;
  s.strain = pop / capacity;
  const unreachable = units.filter(u => !reach.has(u.id)).length;
  s.rating = computeRating(pop, s.strain, units.length ? unreachable / units.length : 0);
}

export function computeRating(population, strain, unreachableRatio) {
  let stars = 1 + STAR_POP.filter(p => population >= p).length;
  if (strain > 1) stars -= 1;
  if (unreachableRatio > VACANCY_PENALTY_RATIO) stars -= 1;
  return Math.max(1, Math.min(5, stars));
}

// One game hour. `rng` is injectable so tests can force outcomes.
export function stepTick(s, rng = Math.random) {
  const reach = reachable(s);
  let income = 0;
  let upkeep = 0;
  for (const st of s.structures) {
    const t = TYPES[st.type];
    if (t.kind === 'unit') {
      if (!reach.has(st.id)) st.occupied = false;          // tenants walk out
      else if (!st.occupied && rng() < FILL_CHANCE) st.occupied = true;
    }
    if (t.upkeep) upkeep += t.upkeep;
  }
  refreshDerived(s, reach);
  for (const st of s.structures) {
    const t = TYPES[st.type];
    if (t.kind !== 'unit' || !st.occupied) continue;
    income += t.rent + (t.perVisitor ? t.perVisitor * s.visitors : 0);
  }
  s.lastNet = income - upkeep;
  s.cash += s.lastNet;
  s.tick += 1;
  return { income, upkeep, net: s.lastNet };
}

export function serialize(s) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state: {
      width: s.width, maxFloors: s.maxFloors, cash: s.cash, tick: s.tick, nextId: s.nextId,
      structures: s.structures.map(({ id, type, col, floor, occupied }) => ({ id, type, col, floor, occupied: !!occupied })),
    },
  };
}

// Returns a fresh state, or null when the blob is not something we wrote.
export function deserialize(blob) {
  if (!blob || typeof blob !== 'object' || blob.version !== SAVE_VERSION) return null;
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
    s.structures.push({ id: r.id, type: r.type, col: r.col, floor: r.floor, occupied: !!r.occupied });
  }
  if (!s.structures.some(x => x.type === 'lobby')) return null;
  refreshDerived(s, reachable(s));
  return s;
}
