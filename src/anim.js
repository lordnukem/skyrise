// Pure animation helpers: easing curves, a count-up approach and the lift
// car planner. No DOM, no canvas, no timers, so tests can drive them with a
// fake clock. The only DOM touch is prefersReducedMotion(), which is guarded.

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutBack = (t) => { t = clamp01(t); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export function smoothstep(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

// Deterministic 0..1 hash so windows, stars and skylines never flicker
// between frames and never need storage.
export function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 2654435761) ^ Math.imul((b | 0) + 0x9e37, 40503)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h % 100000) / 100000;
}

// Exponential approach for HUD counters: moves `current` toward `target`
// with the given half-life (ms) and snaps when within `snap`.
export function approach(current, target, dtMs, halfLifeMs = 110, snap = 0.5) {
  if (current === target) return target;
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  const next = current + (target - current) * k;
  return Math.abs(target - next) <= snap ? target : next;
}

// Lift car planner. `car` is a plain mutable record the renderer keeps per
// shaft; `lo..hi` are the shaft's floors right now (they can grow or shrink
// between calls). Each call sets car.pos (float floor) and car.doors (0..1).
// With `reduced` the car jumps to its destination and the doors snap.
export const LIFT_DWELL_MS = 1100;
export const LIFT_FLOOR_MS = 320;
export function newLiftCar(floor, seed = 0) {
  return { pos: floor, from: floor, to: floor, start: 0, dur: 1, dwellUntil: 0, doors: 0, seed };
}
export function updateLift(car, lo, hi, now, reduced = false, rand = Math.random) {
  if (hi < lo) hi = lo;
  if (car.to < lo || car.to > hi || car.from < lo || car.from > hi) {
    // The shaft changed under the car: settle on the nearest valid floor.
    const f = Math.max(lo, Math.min(hi, Math.round(car.pos)));
    car.from = car.to = f; car.pos = f; car.dwellUntil = now + LIFT_DWELL_MS; car.doors = 1;
    return car.pos;
  }
  if (now < car.dwellUntil) {
    car.pos = car.to;
    const left = car.dwellUntil - now, spent = LIFT_DWELL_MS - left;
    car.doors = reduced ? 1 : Math.min(1, spent / 180, left / 180);
    return car.pos;
  }
  if (car.from === car.to) {
    if (hi === lo) { car.doors = 0; car.dwellUntil = now + LIFT_DWELL_MS; return car.pos; }
    // Pick a different floor, favouring the ends so the car visibly travels.
    let target = lo + Math.floor(rand() * (hi - lo + 1));
    if (target === car.to) target = target === hi ? lo : target + 1;
    car.to = target; car.start = now; car.dur = LIFT_FLOOR_MS * (0.6 + Math.abs(target - car.from)); car.doors = 0;
  }
  const t = clamp01((now - car.start) / car.dur);
  car.pos = reduced ? car.to : lerp(car.from, car.to, easeInOutCubic(t));
  car.doors = 0;
  if (t >= 1) { car.from = car.to; car.pos = car.to; car.dwellUntil = now + LIFT_DWELL_MS; }
  return car.pos;
}

// prefers-reduced-motion, live. Returns false where matchMedia is missing.
let rmQuery = null;
export function prefersReducedMotion() {
  if (rmQuery === null) {
    const mm = globalThis.matchMedia;
    rmQuery = typeof mm === 'function' ? mm.call(globalThis, '(prefers-reduced-motion: reduce)') : { matches: false };
  }
  return !!rmQuery.matches;
}
