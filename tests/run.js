// Minimal test runner: `node tests/run.js`. Exit code 1 on any failure.
import assert from 'node:assert/strict';
import {
  newGame, place, demolish, reachable, stepTick, serialize, deserialize, computeRating, structureAt,
  liftService, happyBand, QUARTER_TICKS, shaftsOf, addCar, cycleRent, isLobbyFloor,
} from '../src/sim.js';
import { saveGame, loadGame } from '../src/storage.js';
import {
  TYPES, START_CASH, START_LOBBY_WIDTH, GRID_WIDTH, SHOP_WALKINS, SHOP_VISITOR_RATIO, STAR_POP,
  WAIT_BUSY, HAPPY_NEUTRAL, LEAVE_TICKS, HOURS_PER_DAY, SAVE_VERSION,
  LIFT_MAX_SPAN, LIFT_MAX_CARS, LIFT_CAR_COST, SKY_LOBBY_EVERY, UNLOCK_AT, STAR_REQUIRES, RENT_LEVELS,
} from '../src/constants.js';
import { easeOutCubic, easeInOutCubic, easeOutBack, smoothstep, hash01, approach, newLiftCar, updateLift, LIFT_DWELL_MS } from '../src/anim.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const always = () => 0;  // rng that always fills a vacant unit
const never = () => 1;   // rng that never fills

const LOBBY_LEFT = Math.floor((GRID_WIDTH - START_LOBBY_WIDTH) / 2); // 16 with defaults
const must = (res) => { assert.equal(res.ok, true, res.reason); return res; };

test('new game has a reachable lobby and starting cash', () => {
  const s = newGame();
  assert.equal(s.cash, START_CASH);
  assert.equal(s.structures.filter(x => x.type === 'lobby').length, START_LOBBY_WIDTH);
  assert.equal(reachable(s).size, START_LOBBY_WIDTH);
});

test('support rule: nothing floats, lobby only on ground', () => {
  const s = newGame();
  assert.equal(place(s, 'office', LOBBY_LEFT, 3).ok, false);
  assert.equal(place(s, 'lobby', 0, 2).ok, false);
  must(place(s, 'office', LOBBY_LEFT, 2));              // sits on the lobby
  assert.equal(place(s, 'office', LOBBY_LEFT, 2).ok, false, 'overlap refused');
  assert.equal(place(s, 'office', GRID_WIDTH - 1, 1).ok, false, 'outside plot refused');
});

test('connectivity: stairs connect floor 2, a bare unit does not', () => {
  const s = newGame();
  const office = must(place(s, 'office', LOBBY_LEFT, 2)).structure;
  assert.equal(reachable(s).has(office.id), false, 'no path yet');
  must(place(s, 'stairs', LOBBY_LEFT - 1, 1));          // cells (15,1) and (15,2), beside the lobby
  assert.equal(reachable(s).has(office.id), true, 'stairs make a path');
});

test('connectivity: a lift shaft connects only its contiguous cells', () => {
  const s = newGame();
  const c = LOBBY_LEFT + START_LOBBY_WIDTH; // first column right of the lobby
  must(place(s, 'elevator', c, 1));
  must(place(s, 'elevator', c, 2));
  must(place(s, 'elevator', c, 3));
  const flat2 = must(place(s, 'flat', c - 2, 2)).structure; // next to the shaft on floor 2
  must(place(s, 'flat', c - 2, 3));
  const flat3 = s.structures.at(-1);
  const r = reachable(s);
  assert.equal(r.has(flat2.id), true);
  assert.equal(r.has(flat3.id), true);
  // Break the shaft in the middle: floor 3 is cut off.
  const mid = structureAt(s, c, 2);
  // Demolish needs nothing on top, so remove floor 3 shaft first, then re-add it over a gap.
  must(demolish(s, structureAt(s, c, 3).id));
  must(demolish(s, mid.id));
  assert.equal(reachable(s).has(flat3.id), false, 'gap in the shaft breaks the path');
});

test('an unreachable unit earns nothing and never fills', () => {
  const s = newGame();
  const office = must(place(s, 'office', LOBBY_LEFT, 2)).structure;
  const before = s.cash;
  const r = stepTick(s, always);
  assert.equal(office.occupied, false);
  assert.equal(r.income, 0);
  assert.equal(s.cash, before);
  assert.equal(s.population, 0);
});

test('a reachable unit that is cut off empties out', () => {
  const s = newGame();
  const stairs = must(place(s, 'stairs', LOBBY_LEFT - 1, 1)).structure;
  const office = must(place(s, 'office', LOBBY_LEFT, 2)).structure;
  stepTick(s, always);
  assert.equal(office.occupied, true);
  must(demolish(s, stairs.id));
  stepTick(s, always);
  assert.equal(office.occupied, false, 'tenants leave when the path is gone');
});

test('economy tick arithmetic: rent + shop takings - lift upkeep', () => {
  const s = newGame();
  must(place(s, 'stairs', LOBBY_LEFT - 1, 1));
  must(place(s, 'office', LOBBY_LEFT, 2));
  must(place(s, 'flat', LOBBY_LEFT + 3, 2));
  must(place(s, 'shop', LOBBY_LEFT + 5, 2));
  must(place(s, 'elevator', LOBBY_LEFT + START_LOBBY_WIDTH, 1)); // one lift cell: upkeep only
  const before = s.cash;
  const r = stepTick(s, always);
  const pop = TYPES.office.people + TYPES.flat.people;
  const visitors = SHOP_WALKINS + Math.floor(pop * SHOP_VISITOR_RATIO);
  const income = TYPES.office.rent + TYPES.flat.rent + TYPES.flat.price + TYPES.shop.perVisitor * visitors; // the flat sells on its fill tick
  assert.equal(s.population, pop);
  assert.equal(s.visitors, visitors);
  assert.equal(r.income, income);
  assert.equal(r.upkeep, TYPES.elevator.upkeep);
  assert.equal(s.cash, before + income - TYPES.elevator.upkeep);
  assert.equal(s.tick, 1);
  // With an rng that never fills, nothing changes except upkeep.
  const s2 = newGame();
  must(place(s2, 'elevator', LOBBY_LEFT - 1, 1));
  const b2 = s2.cash;
  stepTick(s2, never);
  assert.equal(s2.cash, b2 - TYPES.elevator.upkeep);
});

test('placing spends cash and demolishing refunds half', () => {
  const s = newGame();
  const st = must(place(s, 'flat', LOBBY_LEFT, 2)).structure;
  assert.equal(s.cash, START_CASH - TYPES.flat.cost);
  must(demolish(s, st.id));
  assert.equal(s.cash, START_CASH - TYPES.flat.cost + TYPES.flat.cost / 2);
  s.cash = 10;
  assert.equal(place(s, 'flat', LOBBY_LEFT, 2).ok, false, 'cannot afford');
});

test('demolish refuses while something sits on top, and the last lobby cell', () => {
  const s = newGame();
  const base = structureAt(s, LOBBY_LEFT, 1);
  must(place(s, 'flat', LOBBY_LEFT, 2));
  assert.equal(demolish(s, base.id).ok, false);
  const s2 = newGame();
  for (const st of [...s2.structures].slice(1)) must(demolish(s2, st.id));
  assert.equal(demolish(s2, s2.structures[0].id).ok, false, 'last lobby stays');
});

test('rating formula', () => {
  const all = new Set(Object.values(STAR_REQUIRES)); // every gating facility present
  assert.equal(computeRating(0, 0, 0, all), 1);
  assert.equal(computeRating(STAR_POP[0], 0, 0, all), 2);
  assert.equal(computeRating(STAR_POP[3], 0, 0, all), 5);
  assert.equal(computeRating(STAR_POP[3], 1.5, 0, all), 4, 'strain costs a star');
  assert.equal(computeRating(STAR_POP[3], 1.5, 0.5, all), 3, 'vacancy costs another');
  assert.equal(computeRating(0, 2, 1, all), 1, 'never below one');
});

test('save round trip through JSON keeps the tower', () => {
  const s = newGame();
  must(place(s, 'stairs', LOBBY_LEFT - 1, 1));
  must(place(s, 'office', LOBBY_LEFT, 2));
  stepTick(s, always);
  const blob = JSON.parse(JSON.stringify(serialize(s)));
  const back = deserialize(blob);
  assert.ok(back);
  assert.equal(back.cash, s.cash);
  assert.equal(back.tick, s.tick);
  assert.deepEqual(back.structures, s.structures);
  assert.equal(back.population, s.population, 'derived values recomputed');
  // Round-tripped state keeps simulating identically.
  stepTick(s, always); stepTick(back, always);
  assert.equal(back.cash, s.cash);
});

test('corrupted or foreign saves fall back to null', () => {
  assert.equal(deserialize(null), null);
  assert.equal(deserialize('garbage'), null);
  assert.equal(deserialize({ version: 99, state: {} }), null);
  assert.equal(deserialize({ version: 1, state: { cash: 1, tick: 0, nextId: 1, structures: 'nope' } }), null);
  assert.equal(deserialize({ version: 1, state: { cash: 'rich', tick: 0, nextId: 1, structures: [] } }), null);
  assert.equal(deserialize({ version: 1, state: { cash: 1, tick: 0, nextId: 2, structures: [{ id: 1, type: 'casino', col: 0, floor: 1 }] } }), null);
  assert.equal(deserialize({ version: 1, state: { cash: 1, tick: 0, nextId: 1, structures: [] } }), null, 'no lobby');
});

test('storage module survives missing, corrupt and throwing localStorage', () => {
  const g = globalThis;
  const orig = Object.getOwnPropertyDescriptor(g, 'localStorage');
  const setLS = (v) => Object.defineProperty(g, 'localStorage', { value: v, configurable: true, writable: true });
  try {
    setLS(undefined);
    assert.equal(saveGame(newGame()), false);
    assert.equal(loadGame(), null);
    const mem = new Map();
    setLS({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) });
    const s = newGame(); must(place(s, 'flat', LOBBY_LEFT, 2));
    assert.equal(saveGame(s), true);
    assert.deepEqual(loadGame().structures, s.structures);
    mem.set('skyrise.save', '{not json');
    assert.equal(loadGame(), null);
    setLS({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    assert.equal(saveGame(s), false);
    assert.equal(loadGame(), null);
  } finally {
    if (orig) Object.defineProperty(g, 'localStorage', orig); else delete g.localStorage;
  }
});

test('easing curves start at 0, end at 1 and stay monotonic', () => {
  for (const f of [easeOutCubic, easeInOutCubic]) {
    assert.equal(f(0), 0); assert.equal(f(1), 1); assert.equal(f(-1), 0); assert.equal(f(2), 1);
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) { assert.ok(f(t) >= prev - 1e-12); prev = f(t); }
  }
  assert.ok(Math.abs(easeOutBack(0)) < 1e-12); assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-12);
  assert.ok(easeOutBack(0.7) > 1, 'back easing overshoots');
  assert.equal(smoothstep(0, 1, -1), 0); assert.equal(smoothstep(0, 1, 2), 1); assert.equal(smoothstep(0, 1, 0.5), 0.5);
  const h = hash01(5, 7);
  assert.ok(h >= 0 && h < 1); assert.equal(h, hash01(5, 7), 'hash is stable');
});

test('approach converges and snaps to the target', () => {
  let v = 0;
  for (let i = 0; i < 200; i++) v = approach(v, 1000, 16, 110, 0.5);
  assert.equal(v, 1000);
  const half = approach(0, 100, 110, 110, 0.0001);
  assert.ok(Math.abs(half - 50) < 1e-9, 'one half-life covers half the gap');
  assert.equal(approach(7, 7, 16), 7);
});

test('lift planner eases between floors and jumps under reduced motion', () => {
  const rand = () => 0.99; // always aims at the top floor
  const car = newLiftCar(1);
  let now = LIFT_DWELL_MS + 1;
  updateLift(car, 1, 5, now, false, rand);
  assert.equal(car.to, 5); assert.equal(car.pos, 1);
  const mid = updateLift(car, 1, 5, now + car.dur / 2, false, rand);
  assert.ok(mid > 1 && mid < 5, 'mid-travel position is between the floors');
  updateLift(car, 1, 5, now + car.dur + 1, false, rand);
  assert.equal(car.pos, 5); assert.ok(car.dwellUntil > now, 'dwells after arriving');
  // Reduced motion: the position is always an integer floor.
  const car2 = newLiftCar(1);
  now = LIFT_DWELL_MS + 1;
  updateLift(car2, 1, 5, now, true, rand);
  for (let t = 0; t < 5000; t += 37) {
    const p = updateLift(car2, 1, 5, now + t, true, rand);
    assert.ok(Number.isInteger(p) && p >= 1 && p <= 5, 'reduced motion jumps floor to floor');
  }
  // The shaft shrinking under the car settles it onto a valid floor.
  updateLift(car, 1, 2, now + 10000, false, rand);
  assert.ok(car.pos >= 1 && car.pos <= 2);
});

// Sprint 1: a lift column right of the lobby, offices on floors 1..11 beside
// it (ten above ground), and optionally a second column on their far side.
function officeTower(shafts = 1) {
  const s = newGame();
  s.cash = 1e6;
  const c = LOBBY_LEFT + START_LOBBY_WIDTH;
  for (let f = 1; f <= 11; f++) {
    must(place(s, 'elevator', c, f));
    if (shafts > 1) must(place(s, 'elevator', c + 1 + TYPES.office.w, f));
    must(place(s, 'office', c + 1, f));
  }
  return s;
}
const upperOffices = (s) => s.structures.filter(x => x.type === 'office' && x.floor > 1);

test('lift wait follows the time of day: busy at 08:00, idle at 03:00', () => {
  const s = officeTower(1);
  stepTick(s, always); // everyone moves in
  const top = upperOffices(s).at(-1);
  const rush = liftService(s, reachable(s), 8, false)[top.id];
  const night = liftService(s, reachable(s), 3, false)[top.id];
  assert.ok(rush.wait >= WAIT_BUSY, `rush wait ${rush.wait}`);
  assert.ok(night.wait < WAIT_BUSY, `night wait ${night.wait}`);
  assert.equal(rush.walk, 0, 'the shaft reaches the ground');
  assert.ok(s.service[top.id].peak >= WAIT_BUSY, 'peak load is kept for the card');
  // Weekend: the same tower at 08:00 is quiet.
  assert.ok(liftService(s, reachable(s), 8, true)[top.id].wait < WAIT_BUSY);
  // Stairs only: walking cost, no wait.
  const s2 = newGame();
  must(place(s2, 'stairs', LOBBY_LEFT - 1, 1));
  const o = must(place(s2, 'office', LOBBY_LEFT, 2)).structure;
  assert.deepEqual(liftService(s2, reachable(s2), 8, false)[o.id], { wait: 0, walk: 1 });
});

test('one overloaded shaft loses an office; two shafts keep them all', () => {
  const s = officeTower(1);
  let left = 0;
  for (let i = 0; i < LEAVE_TICKS + HOURS_PER_DAY && !left; i++) left += stepTick(s, always).left;
  assert.ok(left > 0, 'an office moved out');
  assert.ok(upperOffices(s).some(o => happyBand(o.happy) === 'poor'), 'poor units exist');
  const s2 = officeTower(2);
  for (let i = 0; i < HOURS_PER_DAY; i++) assert.equal(stepTick(s2, always).left, 0, `nobody leaves at tick ${i}`);
  assert.ok(upperOffices(s2).every(o => o.occupied));
  assert.ok(upperOffices(s2).every(o => happyBand(o.happy) !== 'poor'));
});

test('happiness and the quarter report survive the save round trip', () => {
  const s = officeTower(1);
  for (let i = 0; i < 12; i++) stepTick(s, always);
  s.tick = QUARTER_TICKS - 1;
  const r = stepTick(s, always);
  assert.ok(r.report && s.lastReport === r.report, 'the quarter closed');
  assert.equal(r.report.quarter, 1);
  assert.ok(r.report.income.office > 0 && r.report.upkeep > 0);
  assert.equal(r.report.net, r.report.income.office + r.report.income.shop + r.report.income.flat - r.report.upkeep);
  assert.equal(s.quarter.upkeep, 0, 'accumulator reset');
  stepTick(s, always); // a little into the next quarter
  const blob = JSON.parse(JSON.stringify(serialize(s)));
  assert.equal(blob.version, SAVE_VERSION);
  const back = deserialize(blob);
  assert.ok(back);
  assert.deepEqual(back.structures.map(x => x.happy), s.structures.map(x => x.happy));
  assert.ok(back.structures.some(x => x.happy !== HAPPY_NEUTRAL), 'happiness actually moved');
  assert.deepEqual(back.lastReport, s.lastReport);
  assert.deepEqual(back.quarter, s.quarter);
  assert.deepEqual(back.service, s.service, 'derived service recomputed');
});

test('a v1 save still loads, with every unit at neutral happiness', () => {
  const v1 = {
    version: 1, savedAt: 0,
    state: {
      width: GRID_WIDTH, maxFloors: 30, cash: 500, tick: 40, nextId: 11,
      structures: [
        ...Array.from({ length: START_LOBBY_WIDTH }, (_, i) => ({ id: i + 1, type: 'lobby', col: LOBBY_LEFT + i, floor: 1, occupied: false })),
        { id: 9, type: 'stairs', col: LOBBY_LEFT - 1, floor: 1, occupied: false },
        { id: 10, type: 'office', col: LOBBY_LEFT, floor: 2, occupied: true },
      ],
    },
  };
  const s = deserialize(JSON.parse(JSON.stringify(v1)));
  assert.ok(s, 'v1 loads');
  assert.equal(s.cash, 500); assert.equal(s.tick, 40);
  assert.ok(s.structures.every(x => x.happy === HAPPY_NEUTRAL && x.unhappy === 0));
  assert.equal(s.lastReport, null);
  assert.equal(s.quarter.upkeep, 0);
  assert.equal(s.quarter.starsAt, s.rating);
  assert.equal(s.population, TYPES.office.people);
  stepTick(s, always); // and keeps running
});

// Sprint 2: shafts, express lifts, sky lobbies, star gates, sales and rent.
const SKY = 1 + SKY_LOBBY_EVERY; // first sky-lobby floor (16 with defaults)
// Rating is derived and recomputed on every place, so `put` opens locked tools per call.
const put = (s, type, col, floor) => { s.rating = 5; return must(place(s, type, col, floor)); };
const column = (s, type, col, lo, hi) => { for (let f = lo; f <= hi; f++) put(s, type, col, f); };

test('a standard shaft taller than LIFT_MAX_SPAN is refused', () => {
  const s = newGame(); s.cash = 1e6;
  const c = LOBBY_LEFT + START_LOBBY_WIDTH;
  column(s, 'elevator', c, 1, 1 + LIFT_MAX_SPAN);
  const r = place(s, 'elevator', c, 2 + LIFT_MAX_SPAN);
  assert.equal(r.ok, false); assert.match(r.reason, /spans at most/);
  assert.equal(shaftsOf(s).length, 1);
  assert.equal(shaftsOf(s)[0].hi - shaftsOf(s)[0].lo, LIFT_MAX_SPAN);
  // Cars: each purchase raises the shaft's count up to the cap and costs cash.
  const before = s.cash;
  must(addCar(s, c, 3));
  assert.equal(s.cash, before - LIFT_CAR_COST);
  assert.equal(shaftsOf(s)[0].cars, 2);
  for (let i = 2; i < LIFT_MAX_CARS; i++) must(addCar(s, c, 1));
  assert.equal(addCar(s, c, 1).ok, false, 'car cap');
  assert.equal(addCar(s, LOBBY_LEFT, 1).ok, false, 'not a lift');
});

test('an express shaft serves only lobby floors', () => {
  const s = newGame(); s.cash = 1e6;
  const c = LOBBY_LEFT + START_LOBBY_WIDTH;
  column(s, 'express', c, 1, SKY);
  for (let f = 1; f < SKY; f++) must(place(s, 'office', c + 1, f)); // offices up the express shaft
  must(place(s, 'lobby', c + 1, SKY));                               // sky lobby on the top stop
  const flat = must(place(s, 'flat', c + 2, SKY)).structure;         // a unit beside it
  assert.ok(isLobbyFloor(SKY) && !isLobbyFloor(SKY - 1));
  const r = reachable(s);
  const upper = s.structures.filter(x => x.type === 'office' && x.floor > 1);
  assert.ok(r.has(flat.id), 'the unit on the sky-lobby floor is reached');
  assert.ok(upper.every(o => !r.has(o.id)), 'the express never opens on other floors');
  stepTick(s, always);
  const sv = liftService(s, r, 7, false);
  assert.ok(sv[flat.id].wait > 0 && sv[flat.id].walk === 0, 'the lobby-floor unit rides the express');
  assert.equal(sv[upper[0].id], undefined, 'unreached floors get no service entry');
  // Without the sky lobby the express is sealed at the top too.
  must(demolish(s, s.structures.find(x => x.type === 'lobby' && x.floor === SKY).id));
  assert.equal(reachable(s).has(flat.id), false);
});

test('a sky lobby with an express lift lowers the peak wait on floor 25', () => {
  // Column c: standard shaft 1..16. Offices 1..15 beside it. Column c+1: a
  // second standard shaft 16..30 standing on the offices, flats above the
  // transfer floor. Tower B adds a sky lobby on 16 and an express shaft 1..16.
  const build = (express) => {
    const s = newGame(); s.cash = 1e6;
    const c = LOBBY_LEFT + START_LOBBY_WIDTH;
    column(s, 'elevator', c, 1, SKY);
    for (let f = 1; f < SKY; f++) must(place(s, 'office', c + 1, f));
    column(s, 'elevator', c + 1, SKY, s.maxFloors);
    if (express) { must(place(s, 'lobby', c + 2, SKY)); must(place(s, 'lobby', c + 3, SKY)); }
    else must(place(s, 'flat', c + 2, SKY));
    for (let f = SKY + 1; f <= s.maxFloors; f++) must(place(s, 'flat', c + 2, f));
    if (express) column(s, 'express', c + 4, 1, SKY);
    stepTick(s, always); stepTick(s, always);
    return s;
  };
  const a = build(false), b = build(true);
  const at25 = (s) => s.structures.find(x => x.type === 'flat' && x.floor === 25);
  assert.ok(reachable(a).has(at25(a).id) && reachable(b).has(at25(b).id), 'floor 25 is reached in both');
  const peak = (s) => s.service[at25(s).id].peak;
  assert.ok(peak(a) > 0 && peak(b) > 0);
  assert.ok(peak(b) < peak(a), `express ${peak(b)} vs standard ${peak(a)}`);
  assert.equal(a.service[at25(a).id].walk, 0, 'the transfer is by lift, not stairs');
  assert.equal(b.service[at25(b).id].walk, 0);
});

test('3 stars are refused without a security office', () => {
  const s = newGame();
  s.cash = 1e6;
  const c = LOBBY_LEFT + START_LOBBY_WIDTH;
  column(s, 'elevator', c, 1, 8); column(s, 'elevator', c + 1, 1, 8); column(s, 'elevator', c + 2, 1, 8);
  for (let f = 1; f <= 8; f++) { must(place(s, 'office', c + 3, f)); must(place(s, 'office', c + 6, f)); }
  stepTick(s, always);
  assert.ok(s.population >= STAR_POP[1], `population ${s.population}`);
  assert.equal(s.rating, 2, 'capped at 2 stars without security');
  must(place(s, 'security', c + 9, 1));
  stepTick(s, always);
  assert.ok(s.rating >= 3, `rating ${s.rating} with security`);
});

test('a locked tool cannot be placed', () => {
  const s = newGame(); s.cash = 1e6;
  const c = LOBBY_LEFT + START_LOBBY_WIDTH;
  assert.ok(UNLOCK_AT.express > s.rating);
  const r = place(s, 'express', c, 1);
  assert.equal(r.ok, false); assert.equal(r.reason, `Unlocks at ${UNLOCK_AT.express} stars`);
  assert.equal(place(s, 'security', c, 1).ok, false);
  s.rating = UNLOCK_AT.express;
  must(place(s, 'express', c, 1));
  assert.equal(place(s, 'lobby', LOBBY_LEFT, 2).ok, false, 'floor 2 is no lobby floor');
});

test('a flat sale credits its price once', () => {
  const s = newGame();
  must(place(s, 'stairs', LOBBY_LEFT - 1, 1));
  const flat = must(place(s, 'flat', LOBBY_LEFT, 2)).structure;
  const before = s.cash;
  let r = stepTick(s, always);
  assert.equal(r.income, TYPES.flat.price);
  assert.equal(s.cash, before + TYPES.flat.price);
  assert.equal(flat.sold, true);
  r = stepTick(s, always);
  assert.equal(r.income, 0, 'no hourly rent after the sale');
  flat.occupied = false;             // the owner leaves
  r = stepTick(s, always);
  assert.equal(flat.occupied, true); assert.equal(r.income, 0, 'the resale goes to the old owner');
  // Rent level scales the take and shifts the happiness target.
  const s2 = newGame();
  must(place(s2, 'stairs', LOBBY_LEFT - 1, 1));
  const office = must(place(s2, 'office', LOBBY_LEFT, 2)).structure;
  must(cycleRent(s2, office.id));
  assert.equal(office.rentLevel, 'high');
  assert.equal(stepTick(s2, always).income, Math.round(TYPES.office.rent * RENT_LEVELS.high.take));
  const blob = JSON.parse(JSON.stringify(serialize(s2)));
  assert.equal(deserialize(blob).structures.find(x => x.id === office.id).rentLevel, 'high');
  // A v2 save (no cars, sold or rentLevel) still loads with defaults.
  for (const st of blob.state.structures) { delete st.cars; delete st.sold; delete st.rentLevel; }
  blob.version = 2;
  const v2 = deserialize(blob);
  assert.ok(v2 && v2.structures.every(x => x.cars === 0 && x.sold === false && x.rentLevel === 'normal'));
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok   - ${name}`); }
  catch (e) { failed++; console.log(`FAIL - ${name}\n       ${e.message.split('\n')[0]}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
