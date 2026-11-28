// Life around the tower (Sprint 10): the sun's arc, drifting clouds, bird flocks, the street
// behind the tower (cars, vans, buses, pedestrians, trees), lightning in storms, rain splashes,
// and the people figures the renderer draws everywhere. All code-drawn, so it scales with the
// zoom and follows the theme's tones.
//
// The renderer calls these once a frame with an `env`:
//   { ctx, width, height, groundY, zoom, camX, sx(worldX), worldW, tones, mix, now, dt, reduced,
//     weather, hour (fractional), traffic (0..1) }
// Street and sky are drawn before the structures, so the tower stands in front of them and they
// show in the gaps. Nothing moves under reduced motion, and lightning never flashes then.
// Pure helpers (sunAt, trafficLevel, LOOKS) are exported for the tests.

import { hash01 as rawHash, smoothstep, clamp01 } from './anim.js';

// anim.js's hash01 returns -1..1 (a signed XOR; older visuals depend on it), so fold it into 0..1.
const hash01 = (a, b) => { const v = rawHash(a, b); return v < 0 ? v + 1 : v; };

export const SKINS = ['#f2c9a0', '#e0ac7e', '#b97c4e', '#7c4f30'];
export const HAIRS = ['#2a1e1a', '#5a3a22', '#c9a24a', '#8a8f98', '#a8432c'];
export const SHIRTS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#cdb4db', '#f4a261', '#577590', '#90be6d'];
const TROUSERS = ['#2b2d42', '#3d405b', '#5c4a3a', '#264653'];
const CAR_COLOURS = ['#e63946', '#f1faee', '#457b9d', '#2a9d8f', '#f4a261', '#8d99ae', '#1d3557', '#e9c46a'];
const UMBRELLAS = ['#e63946', '#2a9d8f', '#ffb703', '#5e60ce', '#1d3557'];

// A person's look from a seed: skin, hair, shirt, trousers. Stable for a given seed.
export function lookFor(seed) {
  return {
    skin: SKINS[Math.floor(hash01(seed, 41) * SKINS.length)],
    hair: HAIRS[Math.floor(hash01(seed, 42) * HAIRS.length)],
    shirt: SHIRTS[Math.floor(hash01(seed, 43) * SHIRTS.length)],
    legs: TROUSERS[Math.floor(hash01(seed, 44) * TROUSERS.length)],
    long: hash01(seed, 45) > 0.6,          // long hair
  };
}

// The sun's place for an hour: x and height as fractions of the sky, or null at night.
// It rises at 06:00 on the left, peaks at 12:30, and sets at 19:00 on the right.
export function sunAt(hour) {
  const t = (hour - 6) / 13;
  if (t < -0.02 || t > 1.02) return null;
  return { x: 0.06 + 0.88 * t, y: 1 - Math.sin(clamp01(t) * Math.PI) };   // y: 0 = high, 1 = horizon
}

// How busy the street is (0..1): rush hours, a quiet night, more with a bigger tower.
// Matches the traffic ambience in audio.js, so what you see is what you hear.
export function trafficLevel(hour, population = 0) {
  const h = Math.floor(hour) % 24;
  const night = h >= 22 || h < 5;
  const rush = [7, 8, 9, 12, 13, 17, 18].includes(h);
  const busy = Math.min(1, population / 600);
  return clamp01(night ? 0.08 : (rush ? 0.6 : 0.3) + 0.3 * busy);
}

// Draw one person standing on (x, y) (feet), facing dir, mid-stride at `phase`.
// z is the zoom. Under ~0.6 zoom the figure is a simple two-tone stick, which reads better small.
export function drawPerson(ctx, x, y, z, look, phase, dir = 1, opts = {}) {
  const swing = opts.still ? 0 : Math.sin(phase) * 2 * z;
  const bob = opts.still ? 0 : Math.abs(Math.sin(phase)) * 0.7 * z;
  const shirt = opts.shirt || look.shirt;
  // Legs
  ctx.fillStyle = look.legs;
  ctx.fillRect(x - 1.5 * z + swing * 0.45, y - 4 * z, 1.4 * z, 4 * z);
  ctx.fillRect(x + 0.1 * z - swing * 0.45, y - 4 * z, 1.4 * z, 4 * z);
  // Back arm (behind the body), body, front arm
  const top = y - 9.2 * z - bob;
  ctx.fillStyle = shirt;
  if (z >= 0.6) {
    ctx.save(); ctx.globalAlpha *= 0.75;
    ctx.fillRect(x - 0.6 * z - swing * 0.4, top + 1 * z, 1.2 * z, 3.6 * z);
    ctx.restore();
  }
  roundRectFill(ctx, x - 2 * z, top, 4 * z, 5.4 * z, 1.2 * z);
  ctx.fillStyle = look.skin;
  if (z >= 0.6) ctx.fillRect(x - 0.6 * z + swing * 0.4, top + 1 * z, 1.2 * z, 3.6 * z);
  // Head and hair
  const hy = top - 2.3 * z;
  ctx.beginPath(); ctx.arc(x, hy, 2.1 * z, 0, Math.PI * 2); ctx.fill();
  if (z >= 0.6) {
    ctx.fillStyle = look.hair;
    ctx.beginPath(); ctx.arc(x - dir * 0.3 * z, hy - 0.5 * z, 2.15 * z, Math.PI, Math.PI * 2); ctx.fill();
    if (look.long) ctx.fillRect(x - dir * 2 * z - (dir > 0 ? 0 : -0.6 * z), hy - 0.6 * z, 1.2 * z, 3 * z);
  }
  // Umbrella in the rain
  if (opts.umbrella) {
    ctx.fillStyle = opts.umbrella;
    ctx.beginPath(); ctx.arc(x, hy - 2.6 * z, 5 * z, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.fillRect(x - 0.3 * z, hy - 2.6 * z, 0.6 * z, 4.2 * z);
  }
}

function roundRectFill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
}

export function createLife() {
  const clouds = Array.from({ length: 7 }, (_, i) => ({
    u: hash01(i, 501), v: 0.06 + hash01(i, 502) * 0.32, s: 0.7 + hash01(i, 503) * 0.8, speed: 4 + hash01(i, 504) * 5, puffs: 3 + Math.floor(hash01(i, 505) * 3),
  }));
  const cars = [];                 // { x (world px), dir, speed, kind, colour, seed }
  const peds = [];                 // { x, dir, speed, phase, look, seed }
  const flock = { on: false, x: 0, y: 0, dir: 1, t0: 0, n: 0, next: 0 };
  const storm = { next: 0, flashAt: -1e9, bolt: null };
  const events = [];               // 'thunder' for the sound, taken by main
  const splashes = Array.from({ length: 26 }, () => ({ x: 0, t: -1 }));
  let seed = 1;
  const debug = { clouds: 0, cars: 0, peds: 0, birds: 0, sun: false, flashes: 0 };

  // ---- Sky -----------------------------------------------------------------------------------
  function drawSun(env) {
    const { ctx, width, groundY, hour, tones, weather } = env;
    const p = sunAt(hour);
    debug.sun = !!p;
    if (!p || weather === 'fog') return;
    const sky = Math.max(60, groundY * 0.8);
    const x = p.x * width, y = 26 + p.y * (sky - 26);
    const low = smoothstep(0.55, 1, p.y);                 // redder and bigger near the horizon
    const cloudy = weather === 'rain' || weather === 'snow' ? 0.35 : 1;
    const r = 11 + low * 4;
    ctx.save();
    ctx.globalAlpha = cloudy * (0.18 + low * 0.12);
    ctx.fillStyle = low > 0.3 ? '#ffb070' : '#fff3c4';
    ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = cloudy * 0.35;
    ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = cloudy;
    ctx.fillStyle = env.mix('#fff6d5', '#ffb36b', low);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    void tones;
  }

  function drawClouds(env) {
    const { ctx, width, groundY, tones, weather, now, reduced, camX, zoom } = env;
    const wet = weather === 'rain' || weather === 'snow';
    const n = tones.night;
    const base = wet ? env.mix('#c4cad2', '#3a4150', n) : env.mix('#ffffff', '#566080', n);
    const tint = env.mix(base, '#ffb487', (tones.dusk || 0) * 0.45 * (1 - n));
    const alpha = (wet ? 0.92 : weather === 'fog' ? 0.5 : 0.85) * (1 - n * 0.55);
    const span = width + 240;
    const count = wet ? clouds.length : weather === 'clear' ? 4 : 6;
    ctx.save();
    ctx.fillStyle = tint;
    ctx.globalAlpha = alpha;
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      const c = clouds[i];
      const drift = reduced ? 0 : (now / 1000) * c.speed * (weather === 'wind' ? 3 : 1);
      let x = (c.u * span + drift - camX * 0.08 * zoom) % span;
      if (x < 0) x += span;
      x -= 120;
      const y = c.v * Math.max(80, groundY);
      const s = c.s * (wet ? 1.4 : 1) * Math.min(1.4, Math.max(0.8, zoom));
      ctx.beginPath();
      for (let k = 0; k < c.puffs; k++) {
        const px = x + (k - (c.puffs - 1) / 2) * 13 * s, r = (9 + hash01(i, 600 + k) * 7) * s;
        ctx.moveTo(px + r, y); ctx.arc(px, y - r * 0.35, r, 0, Math.PI * 2);
      }
      ctx.rect(x - c.puffs * 7 * s, y - 4 * s, c.puffs * 14 * s, 7 * s);   // a flat underside
      ctx.fill();
      drawn++;
    }
    ctx.restore();
    debug.clouds = drawn;
  }

  function drawBirds(env) {
    const { ctx, width, groundY, now, reduced, weather, tones, hour } = env;
    const day = hour > 6.5 && hour < 18.5 && tones.night < 0.4;
    if (reduced || !day || weather === 'rain' || weather === 'snow' || weather === 'fog') { flock.on = false; debug.birds = 0; return; }
    if (!flock.on && now > flock.next) {
      flock.on = true; flock.t0 = now; flock.dir = hash01(seed++, 7) > 0.5 ? 1 : -1;
      flock.x = flock.dir > 0 ? -60 : width + 60; flock.y = (0.12 + hash01(seed++, 8) * 0.25) * Math.max(80, groundY);
      flock.n = 4 + Math.floor(hash01(seed++, 9) * 5);
    }
    if (!flock.on) { debug.birds = 0; return; }
    const t = (now - flock.t0) / 1000;
    const head = flock.x + flock.dir * t * 38;
    if ((flock.dir > 0 && head > width + 120) || (flock.dir < 0 && head < -120)) {
      flock.on = false; flock.next = now + 12000 + hash01(seed++, 10) * 25000; debug.birds = 0; return;
    }
    ctx.save();
    ctx.strokeStyle = tones.night > 0.2 ? '#2a3040' : '#3d4452';
    ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < flock.n; i++) {
      // A loose V: each bird trails the leader back and up or down.
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      const bx = head - flock.dir * row * 11 + Math.sin(t * 1.3 + i) * 2;
      const by = flock.y + side * row * 6 + Math.sin(t * 0.9 + i * 2) * 2;
      const flap = Math.sin(t * 9 + i * 1.7) * 2.6;
      ctx.moveTo(bx - 4, by - flap); ctx.quadraticCurveTo(bx - 2, by - 1, bx, by); ctx.quadraticCurveTo(bx + 2, by - 1, bx + 4, by - flap);
    }
    ctx.stroke();
    ctx.restore();
    debug.birds = flock.n;
  }

  // ---- Storms ---------------------------------------------------------------------------------
  // A rare, soft flash (never brighter than 22%, never twice within 14 s) and a jagged bolt,
  // with the thunder sound sent ~0.7 s later. Off under reduced motion.
  function drawStorm(env) {
    const { ctx, width, height, groundY, now, reduced, weather } = env;
    if (reduced || weather !== 'rain') return;
    if (!storm.next) storm.next = now + 6000 + hash01(seed++, 20) * 10000;
    if (now > storm.next) {
      storm.flashAt = now; storm.next = now + 14000 + hash01(seed++, 21) * 22000;
      const x0 = (0.15 + hash01(seed++, 22) * 0.7) * width;
      const pts = [[x0, 0]];
      let x = x0, y = 0;
      const bottom = Math.max(60, groundY * (0.45 + hash01(seed++, 23) * 0.3));
      while (y < bottom) { y += 10 + hash01(seed++, 24) * 14; x += (hash01(seed++, 25) - 0.5) * 22; pts.push([x, y]); }
      storm.bolt = pts;
      debug.flashes++;
      setTimeout(() => events.push('thunder'), 700);
    }
    const age = now - storm.flashAt;
    if (age < 0 || age > 420) return;
    // Two quick pulses, fading.
    const pulse = age < 90 ? 1 : age < 160 ? 0.35 : age < 230 ? 0.8 : Math.max(0, 1 - (age - 230) / 190) * 0.6;
    ctx.save();
    ctx.globalAlpha = 0.22 * pulse;
    ctx.fillStyle = '#e8eeff';
    ctx.fillRect(0, 0, width, Math.min(height, groundY));
    if (storm.bolt && age < 200) {
      ctx.globalAlpha = 0.9 * pulse;
      ctx.strokeStyle = '#f5f7ff'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); storm.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.restore();
  }

  // Little rain splashes along the ground line.
  function drawSplashes(env) {
    const { ctx, width, groundY, now, reduced, weather, zoom } = env;
    if (reduced || weather !== 'rain' || groundY > env.height) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(190,205,230,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of splashes) {
      if (s.t < 0 || now - s.t > 260) { s.x = Math.random() * width; s.t = now + Math.random() * 400; continue; }
      const p = (now - s.t) / 260;
      if (p < 0) continue;
      const r = (1 + p * 3) * Math.max(0.8, zoom);
      ctx.moveTo(s.x - r, groundY - 0.5); ctx.quadraticCurveTo(s.x, groundY - r * 1.2 * (1 - p), s.x + r, groundY - 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- The street behind the tower ------------------------------------------------------------
  function drawStreet(env) {
    const { ctx, width, groundY, zoom: z, now, dt, reduced, weather, tones, worldW, traffic } = env;
    if (groundY < -20 || groundY > env.height + 40) { debug.cars = 0; debug.peds = 0; return; }
    const night = tones.night;
    const lo = -80 / z + env.camX, hi = env.camX + (width + 80) / z;          // visible world range, padded
    // Trees every ~9 cells, swaying in wind.
    const sway = weather === 'wind' ? 1 : weather === 'rain' ? 0.4 : 0.12;
    for (let i = -3; i * 96 < worldW + 300; i++) {
      const wx = i * 96 + hash01(i, 700) * 40;
      if (wx < lo || wx > hi) continue;
      const x = env.sx(wx), s = (0.85 + hash01(i, 701) * 0.4) * 1.5 * z;
      const lean = reduced ? 0 : Math.sin(now / 700 + i) * 1.6 * sway * s;
      ctx.fillStyle = env.mix('#6b4a2b', '#1c140c', night * 0.7);
      ctx.fillRect(x - 1.2 * s, groundY - 12 * s, 2.4 * s, 12 * s);
      ctx.fillStyle = env.mix(hash01(i, 702) > 0.5 ? '#4f9a4a' : '#3f8a5a', '#132418', night * 0.75);
      ctx.beginPath();
      ctx.arc(x + lean, groundY - 16 * s, 6.5 * s, 0, Math.PI * 2);
      ctx.arc(x - 4 * s + lean * 0.8, groundY - 12.5 * s, 4.8 * s, 0, Math.PI * 2);
      ctx.arc(x + 4 * s + lean * 0.8, groundY - 12.5 * s, 4.8 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Spawn: the busier the hour, the more cars and walkers, kept inside the visible stretch.
    const s = dt / 1000;
    const wantCars = Math.round(2 + traffic * 7), wantPeds = Math.round(1 + traffic * 6);
    if (!reduced) {
      if (cars.length < wantCars && hash01(seed++, 30) < s * (0.6 + traffic * 2)) {
        const dir = hash01(seed++, 31) > 0.5 ? 1 : -1;
        const r = hash01(seed++, 32);
        cars.push({ x: dir > 0 ? lo - 60 : hi + 60, dir, speed: 34 + hash01(seed++, 33) * 26, kind: r > 0.93 ? 'bus' : r > 0.78 ? 'van' : 'car',
          colour: CAR_COLOURS[Math.floor(hash01(seed++, 34) * CAR_COLOURS.length)], seed: seed++ });
      }
      if (peds.length < wantPeds && hash01(seed++, 35) < s * (0.5 + traffic * 1.5)) {
        const dir = hash01(seed++, 36) > 0.5 ? 1 : -1;
        const id = seed++;
        peds.push({ x: dir > 0 ? lo - 10 : hi + 10, dir, speed: 7 + hash01(id, 37) * 6, phase: 0, look: lookFor(id), seed: id,
          umbrella: UMBRELLAS[Math.floor(hash01(id, 38) * UMBRELLAS.length)] });
      }
    }
    // Move and cull.
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (!reduced) c.x += c.dir * c.speed * s;
      if (c.x < lo - 200 || c.x > hi + 200) cars.splice(i, 1);
    }
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      if (!reduced) { p.x += p.dir * p.speed * s; p.phase += p.speed * 0.6 * s; }
      if (p.x < lo - 100 || p.x > hi + 100) peds.splice(i, 1);
    }
    // Cars: the far lane (going left) slightly higher and smaller.
    for (const c of cars) {
      const far = c.dir < 0;
      const k = (far ? 0.85 : 1) * 1.8 * z;                 // a car is about a cell and a half long
      const len = (c.kind === 'bus' ? 30 : c.kind === 'van' ? 17 : 14) * k, h = (c.kind === 'bus' ? 9 : c.kind === 'van' ? 7 : 5) * k;
      const x = env.sx(c.x), y = groundY - (far ? 2.5 : 0.5) * z;
      if (x < -len - 30 || x > width + len + 30) continue;
      const body = env.mix(c.kind === 'bus' ? '#f2b134' : c.colour, '#0b1026', night * 0.55);
      ctx.fillStyle = body;
      roundRectFill(ctx, x - len / 2, y - h - 1.5 * k, len, h, 1.6 * k);
      if (c.kind === 'car') { ctx.fillRect(x - len * 0.22, y - h - 4.2 * k, len * 0.5, 3 * k); }
      // Windows
      ctx.fillStyle = night > 0.5 ? 'rgba(255,214,140,0.55)' : 'rgba(190,225,250,0.9)';
      if (c.kind === 'bus') for (let w = 0; w < 6; w++) ctx.fillRect(x - len / 2 + (2 + w * 4.6) * k, y - h + 0.3 * k, 3.2 * k, 3 * k);
      else if (c.kind === 'van') ctx.fillRect(x + c.dir * len * 0.25 - 2.5 * k, y - h + 0.4 * k, 5 * k, 2.8 * k);
      else ctx.fillRect(x - len * 0.18, y - h - 3.6 * k, len * 0.4, 2.4 * k);
      // Wheels
      ctx.fillStyle = '#1b1d24';
      ctx.beginPath(); ctx.arc(x - len * 0.32, y - 1.2 * k, 1.7 * k, 0, Math.PI * 2); ctx.arc(x + len * 0.32, y - 1.2 * k, 1.7 * k, 0, Math.PI * 2); ctx.fill();
      // Lights at night: a warm beam ahead, red behind.
      if (night > 0.35) {
        const front = x + c.dir * len / 2, back = x - c.dir * len / 2;
        ctx.fillStyle = 'rgba(255,240,190,0.95)'; ctx.fillRect(front - (c.dir > 0 ? 1 : 0) * k, y - h * 0.55, 1.2 * k, 1.4 * k);
        ctx.fillStyle = 'rgba(230,57,70,0.95)'; ctx.fillRect(back - (c.dir > 0 ? 0 : 1) * k, y - h * 0.55, 1.2 * k, 1.4 * k);
        ctx.save(); ctx.globalAlpha = 0.16 * smoothstep(0.35, 0.7, night);
        ctx.fillStyle = '#fff0be';
        ctx.beginPath(); ctx.moveTo(front, y - h * 0.5); ctx.lineTo(front + c.dir * 26 * k, y - h * 0.5 - 4 * k); ctx.lineTo(front + c.dir * 26 * k, y + 1 * k); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    for (const p of peds) {
      const x = env.sx(p.x);
      if (x < -20 || x > width + 20) continue;
      drawPerson(ctx, x, groundY - 0.5 * z, z * 0.95, p.look, p.phase, p.dir, { still: reduced, umbrella: weather === 'rain' ? p.umbrella : null });
    }
    debug.cars = cars.length; debug.peds = peds.length;
  }

  return {
    // Behind the tower: sun, clouds, birds, the street.
    drawBehind(env) { drawSun(env); drawClouds(env); drawBirds(env); drawStreet(env); },
    // In front of everything: lightning and splashes.
    drawFront(env) { drawStorm(env); drawSplashes(env); },
    takeEvents() { return events.splice(0); },
    // For the browser checks: bring the next lightning strike forward to now.
    strikeSoon() { storm.next = 1; },
    reset() { cars.length = 0; peds.length = 0; flock.on = false; },
    debug,
  };
}
