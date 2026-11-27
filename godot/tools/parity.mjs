// Parity check, JS side: runs tests/parity_scenarios.json against the JS sim (src/) with a
// seeded mulberry32 RNG and writes one JSON trace. tests/parity.gd writes the same trace from
// the Godot port; tools/compare.mjs diffs the two.
//   node godot/tools/parity.mjs > js.json
import { readFileSync } from 'node:fs';
import * as S from '../../src/sim.js';
import { nameOf, tenantOf, cleanName } from '../../src/tenants.js';
import { hash01 } from '../../src/anim.js';
import { draftTap } from '../../src/draft.js';

const here = new URL('.', import.meta.url);
const spec = JSON.parse(readFileSync(new URL('../tests/parity_scenarios.json', here), 'utf8'));

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const sorted = (set) => [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const mapObj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]));

// Deep-copied: the trace is written at the end, and live objects (quarter, stats, cars) keep changing.
function snap(s, label) {
  return JSON.parse(JSON.stringify(rawSnap(s, label)));
}
function rawSnap(s, label) {
  const ser = S.serialize(s);
  const t = s.transit;
  return {
    label,
    state: ser.state,
    derived: {
      population: s.population, visitors: s.visitors, rating: s.rating, strain: s.strain, lastNet: s.lastNet,
      service: s.service, facilities: sorted(s.facilities), noisy: sorted(s.noisy), diners: s.diners, crowds: s.crowds,
      perks: mapObj(s.perks), cleaners: mapObj(s.cleaners),
      inTransit: S.inTransit(s), stats: t.stats,
      shafts: t.shafts.map(sh => ({ col: sh.col, lo: sh.lo, hi: sh.hi, q: sh.queue.length, credit: sh.credit, next: sh.next, cars: sh.cars })),
      riding: t.riding.map(w => ({ unit: w.unit, leg: w.leg, wait: w.wait, stress: w.stress })),
      goals: S.guideGoals(s), needs: S.starNeeds(s), mood: S.moodCounts(s),
      names: s.structures.map(x => [x.id, nameOf(x), tenantOf(x)?.id ?? null]),
    },
  };
}

function run(sc) {
  const rng = mulberry32(sc.seed);
  const s = { cur: S.newGame() };
  const out = [];
  const at = (c, f) => S.structureAt(s.cur, c, f);
  const log = (op, res) => out.push(JSON.parse(JSON.stringify({ op, res })));
  for (const op of sc.ops) {
    const [k, ...a] = op;
    const st = s.cur;
    if (k === 'put' || k === 'place') {
      if (k === 'put') st.rating = 5;
      const r = S.place(st, a[0], a[1], a[2]);
      log(op, { ok: r.ok, reason: r.reason ?? null, id: r.structure?.id ?? null });
    } else if (k === 'column') {
      const res = [];
      for (let f = a[2]; f <= a[3]; f++) { st.rating = 5; const r = S.place(st, a[0], a[1], f); res.push(r.ok ? 'ok' : r.reason); }
      log(op, res);
    } else if (k === 'hours') {
      for (let h = 1; h <= a[0]; h++) {
        const r = S.stepHour(st, rng);
        if (r.report || r.fire || r.vip || r.left) log(['tick', st.tick], { report: r.report, fire: r.fire ? r.fire.id : null, vip: r.vip, left: r.left, income: r.income, upkeep: r.upkeep });
        if (h % a[1] === 0) out.push(snap(st, `${sc.name}@${st.tick}`));
      }
    } else if (k === 'car') log(op, S.addCar(st, a[0], a[1]));
    else if (k === 'stop') log(op, S.toggleStop(st, a[0], a[1]));
    else if (k === 'rent') { const x = at(a[0], a[1]); log(op, x ? S.cycleRent(st, x.id) : null); }
    else if (k === 'demolish') { const x = at(a[0], a[1]); log(op, x ? { preview: S.previewDemolish(st, x.id), done: S.demolish(st, x.id) } : null); }
    else if (k === 'dig') log(op, S.dig(st, a[0]));
    else if (k === 'fire') { const x = at(a[0], a[1]); log(op, x ? { ok: S.startFire(st, x.id).ok } : null); }
    else if (k === 'repair') { const x = at(a[0], a[1]); log(op, x ? S.repair(st, x.id) : null); }
    else if (k === 'rename') { const x = at(a[0], a[1]); log(op, x ? S.renameUnit(st, x.id, a[2]) : null); }
    else if (k === 'cash') st.cash = a[0];
    else if (k === 'roundtrip') { s.cur = S.deserialize(JSON.parse(JSON.stringify(S.serialize(st)))); out.push(snap(s.cur, `${sc.name}:roundtrip`)); }
    else if (k === 'probe') {
      const x = at(a[1], a[2]);
      const can = S.canPlace(st, a[0], a[1], a[2]);
      const d = draftTap(st, null, a[0], a[1], a[2]);
      log(op, { can: { ok: can.ok, reason: can.reason ?? null }, connects: S.connectsHere(st, a[0], a[1], a[2]),
        draft: { place: d.place, reason: d.reason ?? null, draft: d.draft }, preview: x ? S.previewDemolish(st, x.id) : null });
    } else throw new Error('unknown op ' + k);
  }
  out.push(snap(s.cur, `${sc.name}:end`));
  return out;
}

const r = mulberry32(42);
const extras = {
  rng: Array.from({ length: 8 }, () => r()),
  hash: [[0, 0], [1, 0], [7, 3], [123, 45], [99999, 7], [-5, 2], [2147483647, 1]].map(([a, b]) => hash01(a, b)),
  clean: ['  Kopi \u0007 Club  ', '', 'x'.repeat(40), 'a\tb\n  c', 42].map(cleanName),
};
process.stdout.write(JSON.stringify({ extras, scenarios: spec.scenarios.map(sc => ({ name: sc.name, trace: run(sc) })) }));
