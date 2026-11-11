// Minimal test runner: `node tests/run.js`. Exit code 1 on any failure.
import assert from 'node:assert/strict';
import {
  newGame, place, demolish, reachable, stepTick, serialize, deserialize, computeRating, structureAt,
} from '../src/sim.js';
import { saveGame, loadGame } from '../src/storage.js';
import { TYPES, START_CASH, START_LOBBY_WIDTH, GRID_WIDTH, SHOP_WALKINS, SHOP_VISITOR_RATIO, STAR_POP } from '../src/constants.js';

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
  const income = TYPES.office.rent + TYPES.flat.rent + TYPES.shop.perVisitor * visitors;
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
  assert.equal(computeRating(0, 0, 0), 1);
  assert.equal(computeRating(STAR_POP[0], 0, 0), 2);
  assert.equal(computeRating(STAR_POP[3], 0, 0), 5);
  assert.equal(computeRating(STAR_POP[3], 1.5, 0), 4, 'strain costs a star');
  assert.equal(computeRating(STAR_POP[3], 1.5, 0.5), 3, 'vacancy costs another');
  assert.equal(computeRating(0, 2, 1), 1, 'never below one');
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

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok   - ${name}`); }
  catch (e) { failed++; console.log(`FAIL - ${name}\n       ${e.message.split('\n')[0]}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
