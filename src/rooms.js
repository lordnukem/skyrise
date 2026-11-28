// Detailed room painters (Sprint 12): the service rooms, hotel rooms, event halls, escalators,
// the basement car park and transit platform, lift shafts and lift cars. Everything is drawn in
// screen space from the structure's rect `r` (r.x, r.y, r.w, r.h) at zoom `z`, where one cell is
// 24x32 world px. The renderer calls frame() once a frame with the shared tones; each painter is
// cheap enough to run for every visible structure, and the fine detail only appears from
// DETAIL_ZOOM up. Under reduced motion nothing moves (fans, steps, trains, screens hold still).

import { hash01 as rawHash, clamp01 } from './anim.js';
import { drawPerson, lookFor } from './life.js';

export const DETAIL_ZOOM = 0.9;
const h01 = (a, b) => { const v = rawHash(a, b); return v < 0 ? v + 1 : v; };

let ctx = null, T = null, WIN = null, now = 0, reduced = false, mix = (a) => a;
export function frame(env) { ctx = env.ctx; T = env.tones; WIN = env.winTone; now = env.now; reduced = env.reduced; mix = env.mix; }

const win = (lit) => WIN[Math.round(clamp01(lit) * (WIN.length - 1))];
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
const night = () => T.night || 0;
// Room light: warm at night, a plain bright interior by day.
const roomLit = () => 0.55 + 0.45 * (T.warm || 0);
function backWall(r, colour, z) {
  ctx.fillStyle = colour; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(r.x, r.y + r.h - 6 * z, r.w, 4 * z);       // skirting / floor
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(r.x, r.y + 2 * z, r.w, 1.5 * z);     // ceiling line
}
function ceilingLight(x, y, w, z) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x, y, w, 1.4 * z);
  ctx.save(); ctx.globalAlpha = 0.12 + 0.12 * night(); ctx.fillStyle = '#fff6d8';
  ctx.beginPath(); ctx.moveTo(x, y + 1.4 * z); ctx.lineTo(x + w, y + 1.4 * z); ctx.lineTo(x + w + 4 * z, y + 12 * z); ctx.lineTo(x - 4 * z, y + 12 * z); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---- Service rooms ------------------------------------------------------------------------------
export function security(r, z, st, ok) {
  backWall(r, mix(T.security, '#1b2433', 0.25), z);
  const floor = r.y + r.h - 6 * z;
  // A wall of CCTV screens, flickering between views.
  const cols = 4, rows = 2, sw = 7 * z, shh = 5 * z, gx = r.x + 4 * z, gy = r.y + 5 * z;
  ctx.fillStyle = '#1c2230'; ctx.fillRect(gx - z, gy - z, cols * (sw + z) + z, rows * (shh + z) + z);
  for (let i = 0; i < cols * rows; i++) {
    const cx = gx + (i % cols) * (sw + z), cy = gy + Math.floor(i / cols) * (shh + z);
    const flick = reduced ? 0 : Math.floor(now / 1700 + h01(st.id, i) * 5) % 3;
    ctx.fillStyle = ok ? ['#5fd3a8', '#7fb8e8', '#a6e3c9'][(i + flick) % 3] : '#2a3140';
    ctx.fillRect(cx, cy, sw, shh);
    if (ok) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx + sw * 0.2, cy + shh * 0.55, sw * 0.5, shh * 0.3); }
  }
  // The desk and the guard in a navy uniform with a cap.
  ctx.fillStyle = '#4a3b2c'; ctx.fillRect(r.x + 4 * z, floor - 7 * z, r.w * 0.55, 2 * z); ctx.fillRect(r.x + 6 * z, floor - 5 * z, 2 * z, 5 * z);
  if (ok) {
    const gxp = r.x + r.w * 0.42;
    drawPerson(ctx, gxp, floor, z, lookFor(st.id * 3 + 1), 0, -1, { still: true, shirt: '#1f3a68' });
    ctx.fillStyle = '#16294a'; ctx.fillRect(gxp - 2.2 * z, floor - 13.6 * z, 4.4 * z, 1.4 * z);   // cap
  }
  // A shield badge on the wall.
  const bx = r.x + r.w * 0.82, by = r.y + r.h * 0.42, bw = 6 * z;
  ctx.fillStyle = '#f1c24b';
  ctx.beginPath(); ctx.moveTo(bx - bw / 2, by - bw * 0.6); ctx.lineTo(bx + bw / 2, by - bw * 0.6);
  ctx.lineTo(bx + bw / 2, by + bw * 0.2); ctx.lineTo(bx, by + bw * 0.8); ctx.lineTo(bx - bw / 2, by + bw * 0.2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1f3a68'; ctx.fillRect(bx - 0.7 * z, by - 2 * z, 1.4 * z, 3.5 * z);
}

export function clinic(r, z, st, ok) {
  backWall(r, mix('#eef4f7', T.clinic, 0.4), z);
  const floor = r.y + r.h - 6 * z;
  ceilingLight(r.x + r.w * 0.3, r.y + 3 * z, r.w * 0.4, z);
  // A red cross sign.
  const cx = r.x + 8 * z, cy = r.y + 11 * z, u = 2.6 * z;
  ctx.fillStyle = '#fff'; rr(cx - u * 1.7, cy - u * 1.7, u * 3.4, u * 3.4, z); ctx.fill();
  ctx.fillStyle = '#d64545'; ctx.fillRect(cx - u, cy - u / 3, 2 * u, u * 0.7); ctx.fillRect(cx - u / 3, cy - u, u * 0.7, 2 * u);
  // A bed with a green blanket, a drip stand, a half-drawn curtain.
  const bx = r.x + r.w * 0.38, bw = r.w * 0.38;
  ctx.fillStyle = '#9aa7b4'; ctx.fillRect(bx, floor - 5 * z, bw, 1.4 * z); ctx.fillRect(bx, floor - 5 * z, 1.2 * z, 5 * z); ctx.fillRect(bx + bw - 1.2 * z, floor - 5 * z, 1.2 * z, 5 * z);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, floor - 7.4 * z, bw, 2.4 * z);
  ctx.fillStyle = '#5cb88a'; ctx.fillRect(bx + bw * 0.3, floor - 8 * z, bw * 0.7, 3 * z);
  ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(bx + bw * 0.16, floor - 8.6 * z, 1.8 * z, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9aa7b4'; ctx.fillRect(bx + bw + 3 * z, floor - 16 * z, 0.8 * z, 16 * z);
  ctx.fillStyle = 'rgba(160,210,240,0.9)'; rr(bx + bw + 1.6 * z, floor - 17 * z, 3.6 * z, 4.4 * z, z); ctx.fill();
  ctx.fillStyle = 'rgba(140,190,230,0.55)'; ctx.fillRect(r.x + r.w * 0.86, r.y + 4 * z, r.w * 0.1, floor - r.y - 4 * z);
  for (let k = 0; k < 4; k++) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(r.x + r.w * 0.86 + k * 1.3 * z, r.y + 4 * z, 0.5 * z, floor - r.y - 4 * z); }
  if (ok) drawPerson(ctx, r.x + r.w * 0.27, floor, z, lookFor(st.id * 5 + 2), 0, 1, { still: true, shirt: '#ffffff' });
}

export function housekeeping(r, z, st, ok) {
  backWall(r, mix('#e5efe9', T.housekeeping, 0.5), z);
  const floor = r.y + r.h - 6 * z;
  // Shelves of folded towels.
  const sx = r.x + 4 * z, sw = r.w * 0.36;
  for (let k = 0; k < 3; k++) {
    const y = r.y + 9 * z + k * 6 * z;
    ctx.fillStyle = '#8b6b4a'; ctx.fillRect(sx, y, sw, 1 * z);
    for (let t = 0; t < 4; t++) { ctx.fillStyle = ['#ffffff', '#cfe8ff', '#ffe0ec', '#fff4c2'][(t + k) % 4]; ctx.fillRect(sx + 1 * z + t * sw / 4, y - 3 * z, sw / 4 - 1.2 * z, 3 * z); }
  }
  // A washing machine with a round door, its drum turning.
  const mx = r.x + r.w * 0.52, mw = 9 * z;
  ctx.fillStyle = '#f4f6f8'; rr(mx, floor - 10 * z, mw, 10 * z, 1.2 * z); ctx.fill();
  ctx.fillStyle = '#9aa7b4'; ctx.fillRect(mx, floor - 10 * z, mw, 2 * z);
  ctx.fillStyle = '#5b6b7d'; ctx.beginPath(); ctx.arc(mx + mw / 2, floor - 4.6 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9fd0f2'; ctx.beginPath(); ctx.arc(mx + mw / 2, floor - 4.6 * z, 2.2 * z, 0, Math.PI * 2); ctx.fill();
  if (ok && !reduced) { const a = now / 300; ctx.fillStyle = '#ffffff'; ctx.fillRect(mx + mw / 2 + Math.cos(a) * 1.2 * z - 0.6 * z, floor - 4.6 * z + Math.sin(a) * 1.2 * z - 0.6 * z, 1.2 * z, 1.2 * z); }
  // A laundry cart.
  const cx = r.x + r.w * 0.76;
  ctx.fillStyle = '#5b6b7d'; ctx.fillRect(cx, floor - 7 * z, 8 * z, 5 * z);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx + 2.5 * z, floor - 7 * z, 2 * z, Math.PI, 0); ctx.arc(cx + 5.5 * z, floor - 7.4 * z, 2 * z, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#2a2f3a'; ctx.beginPath(); ctx.arc(cx + 1.5 * z, floor - 1 * z, 1 * z, 0, Math.PI * 2); ctx.arc(cx + 6.5 * z, floor - 1 * z, 1 * z, 0, Math.PI * 2); ctx.fill();
  if (ok) drawPerson(ctx, r.x + r.w * 0.45, floor, z, lookFor(st.id * 7 + 3), 0, 1, { still: true, shirt: '#3f8a6a' });
}

export function plant(r, z, st, ok) {
  backWall(r, mix('#8c8f80', T.plant, 0.5), z);
  const floor = r.y + r.h - 6 * z;
  // Pipes along the ceiling with red valve wheels.
  ctx.fillStyle = '#c9ced4'; ctx.fillRect(r.x, r.y + 5 * z, r.w, 2.2 * z);
  ctx.fillStyle = '#7d8a9b'; ctx.fillRect(r.x, r.y + 9 * z, r.w, 1.6 * z);
  for (let k = 1; k < 4; k++) { const vx = r.x + r.w * k / 4; ctx.strokeStyle = '#d64545'; ctx.lineWidth = Math.max(1, 0.8 * z); ctx.beginPath(); ctx.arc(vx, r.y + 6 * z, 1.8 * z, 0, Math.PI * 2); ctx.stroke(); }
  // Two tanks with gauges.
  for (let k = 0; k < 2; k++) {
    const tx = r.x + 4 * z + k * 14 * z, tw = 11 * z, th = 15 * z;
    ctx.fillStyle = '#b8c0cc'; rr(tx, floor - th, tw, th, 4 * z); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(tx + tw * 0.65, floor - th + 2 * z, tw * 0.3, th - 4 * z);
    ctx.fillStyle = '#7d8a9b'; ctx.fillRect(tx + tw / 2 - 0.8 * z, r.y + 10 * z, 1.6 * z, floor - th - r.y - 10 * z);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tx + tw / 2, floor - th * 0.6, 2.2 * z, 0, Math.PI * 2); ctx.fill();
    const a = (reduced || !ok ? 0.6 : 0.6 + Math.sin(now / 900 + k) * 0.25) * Math.PI;
    ctx.strokeStyle = '#d64545'; ctx.lineWidth = Math.max(1, 0.6 * z);
    ctx.beginPath(); ctx.moveTo(tx + tw / 2, floor - th * 0.6); ctx.lineTo(tx + tw / 2 - Math.cos(a) * 1.8 * z, floor - th * 0.6 - Math.sin(a) * 1.8 * z); ctx.stroke();
  }
  // A ventilation fan, spinning while the plant runs.
  const fx = r.x + r.w * 0.8, fy = r.y + r.h * 0.5, fr = 6 * z;
  ctx.fillStyle = '#3d4452'; ctx.beginPath(); ctx.arc(fx, fy, fr + 1.2 * z, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9aa7b4';
  const spin = reduced || !ok ? 0.3 : now / 120;
  for (let b = 0; b < 4; b++) { const a = spin + b * Math.PI / 2; ctx.beginPath(); ctx.ellipse(fx + Math.cos(a) * fr * 0.5, fy + Math.sin(a) * fr * 0.5, fr * 0.5, fr * 0.22, a, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#3d4452'; ctx.beginPath(); ctx.arc(fx, fy, 1.4 * z, 0, Math.PI * 2); ctx.fill();
  // Hazard stripes along the floor.
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, floor - 1.5 * z, r.w, 1.5 * z); ctx.clip();
  ctx.fillStyle = '#f6b73c'; ctx.fillRect(r.x, floor - 1.5 * z, r.w, 1.5 * z);
  ctx.fillStyle = '#2a2f3a'; for (let x = r.x - 4 * z; x < r.x + r.w; x += 4 * z) { ctx.beginPath(); ctx.moveTo(x, floor); ctx.lineTo(x + 2 * z, floor - 1.5 * z); ctx.lineTo(x + 4 * z, floor - 1.5 * z); ctx.lineTo(x + 2 * z, floor); ctx.fill(); }
  ctx.restore();
}

// ---- Hotel room and event hall ------------------------------------------------------------------
export function hotel(r, z, st, biz, occupied, dirty) {
  const lit = occupied ? clamp01(0.25 + T.warm) : 0;
  backWall(r, mix(T.hotel, '#000000', 0.06), z);
  const floor = r.y + r.h - 6 * z;
  // Window with curtains.
  ctx.fillStyle = win(lit * 0.9); ctx.fillRect(r.x + r.w * 0.06, r.y + 6 * z, r.w * 0.26, r.h * 0.42);
  ctx.fillStyle = biz ? biz.spread : '#d8c2e6';
  ctx.fillRect(r.x + r.w * 0.04, r.y + 5 * z, r.w * 0.05, r.h * 0.48); ctx.fillRect(r.x + r.w * 0.29, r.y + 5 * z, r.w * 0.05, r.h * 0.48);
  // A framed picture over the bed.
  ctx.fillStyle = '#8b6b4a'; ctx.fillRect(r.x + r.w * 0.58, r.y + 7 * z, r.w * 0.22, 6 * z);
  ctx.fillStyle = '#9fd0f2'; ctx.fillRect(r.x + r.w * 0.58 + z, r.y + 8 * z, r.w * 0.22 - 2 * z, 4 * z);
  ctx.fillStyle = '#6bbf59'; ctx.beginPath(); ctx.moveTo(r.x + r.w * 0.58 + z, r.y + 12 * z); ctx.lineTo(r.x + r.w * 0.69, r.y + 9 * z); ctx.lineTo(r.x + r.w * 0.8 - z, r.y + 12 * z); ctx.fill();
  // The bed: headboard, mattress, pillow, spread; a sleeping guest at night.
  const bx = r.x + r.w * 0.46, bw = r.w * 0.48;
  ctx.fillStyle = '#6b4a2b'; rr(bx, floor - 11 * z, 2.4 * z, 11 * z, z); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + 2 * z, floor - 6 * z, bw - 2 * z, 4 * z);
  ctx.fillStyle = '#f4f6f8'; rr(bx + 2.6 * z, floor - 8 * z, 6 * z, 2.6 * z, z); ctx.fill();
  ctx.fillStyle = biz ? biz.spread : '#c9a0dc'; ctx.fillRect(bx + 8 * z, floor - 6.6 * z, bw - 8 * z, 3.4 * z);
  if (occupied && night() > 0.5 && !dirty) { ctx.fillStyle = lookFor(st.id * 9).skin; ctx.beginPath(); ctx.arc(bx + 6 * z, floor - 8 * z, 1.7 * z, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#4a3b2c'; ctx.fillRect(bx + 2 * z, floor - 2 * z, bw - 2 * z, 2 * z);
  // A nightstand with a lamp that glows while guests are in at night.
  const nx = r.x + r.w * 0.36;
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(nx, floor - 5 * z, 5 * z, 5 * z);
  ctx.fillStyle = '#3d4452'; ctx.fillRect(nx + 2 * z, floor - 8 * z, 0.8 * z, 3 * z);
  const glow = occupied ? T.warm : 0;
  ctx.fillStyle = glow > 0.2 ? '#ffe7a3' : '#e8dcc0'; ctx.beginPath(); ctx.moveTo(nx + 0.6 * z, floor - 8 * z); ctx.lineTo(nx + 4.4 * z, floor - 8 * z); ctx.lineTo(nx + 3.6 * z, floor - 11 * z); ctx.lineTo(nx + 1.4 * z, floor - 11 * z); ctx.fill();
  if (glow > 0.2) { ctx.save(); ctx.globalAlpha = glow * 0.25; ctx.fillStyle = '#ffe7a3'; ctx.beginPath(); ctx.arc(nx + 2.5 * z, floor - 9 * z, 8 * z, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  if (dirty) {
    ctx.fillStyle = 'rgba(120,78,32,0.55)';
    ctx.fillRect(bx + bw * 0.4, floor - 7.4 * z, bw * 0.3, 2 * z);
    ctx.beginPath(); ctx.arc(r.x + r.w * 0.2, floor - 1 * z, 2.2 * z, 0, Math.PI * 2); ctx.fill();
  }
}

export function hall(r, z, st, biz, vacant, crowd) {
  const on = crowd > 0;
  backWall(r, mix(T.hall, '#1a1020', on ? 0.45 : 0.15), z);
  const floor = r.y + r.h - 6 * z;
  // Stage with curtains, lit and spotlit during an event.
  const sx = r.x + r.w * 0.22, sw = r.w * 0.56;
  ctx.fillStyle = win(on ? 1 : vacant ? 0 : 0.3 * T.warm); ctx.fillRect(sx, r.y + 6 * z, sw, r.h * 0.42);
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(sx - 2 * z, r.y + 6 * z + r.h * 0.42, sw + 4 * z, 2 * z);
  ctx.fillStyle = biz ? biz.curtain : 'rgba(150,30,40,0.9)';
  for (const cx of [sx - 3 * z, sx + sw - 3 * z]) { ctx.fillRect(cx, r.y + 4 * z, 6 * z, r.h * 0.48); ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(cx + 2 * z, r.y + 4 * z, z, r.h * 0.48); ctx.fillStyle = biz ? biz.curtain : 'rgba(150,30,40,0.9)'; }
  ctx.fillRect(sx - 3 * z, r.y + 3 * z, sw + 6 * z, 2.5 * z);                     // valance
  // A chandelier.
  const chx = r.x + r.w * 0.5;
  ctx.fillStyle = '#f1c24b'; ctx.fillRect(chx - 0.4 * z, r.y + 2 * z, 0.8 * z, 2 * z);
  for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(chx + k * 1.8 * z, r.y + 4.6 * z, 0.8 * z, 0, Math.PI * 2); ctx.fill(); }
  if (on) {
    // Spotlights sweeping and a performer centre stage.
    ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff3c4';
    for (const k of [0, 1]) {
      const swing = reduced ? 0 : Math.sin(now / 900 + k * 2) * sw * 0.18;
      const top = k ? sx + sw - 2 * z : sx + 2 * z, bot = sx + sw / 2 + swing;
      ctx.beginPath(); ctx.moveTo(top, r.y + 5 * z); ctx.lineTo(bot - 5 * z, r.y + 6 * z + r.h * 0.42); ctx.lineTo(bot + 5 * z, r.y + 6 * z + r.h * 0.42); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    drawPerson(ctx, sx + sw / 2, r.y + 6 * z + r.h * 0.42, z * 0.9, lookFor(st.id * 11), reduced ? 0 : now / 400, 1, { still: reduced, shirt: '#e63946' });
  }
  // Seats, with an audience while an event runs.
  const n = Math.max(6, Math.round(r.w / (4.2 * z)));
  for (let i = 0; i < n; i++) {
    const x = r.x + (i + 0.5) * r.w / n;
    if (on && h01(st.id + i, 61) < Math.min(0.95, 0.35 + crowd / 40)) {
      const look = lookFor(st.id * 13 + i);
      ctx.fillStyle = look.shirt; ctx.fillRect(x - 1.6 * z, floor - 5.4 * z, 3.2 * z, 3 * z);
      ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(x, floor - 6.8 * z, 1.5 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.hair; ctx.beginPath(); ctx.arc(x, floor - 7.3 * z, 1.5 * z, Math.PI, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#7a2e3a'; ctx.fillRect(x - 1.8 * z, floor - 3 * z, 3.6 * z, 3 * z);
  }
}

// ---- Escalator ------------------------------------------------------------------------------------
// A 2x2 escalator in side view, built from the two floor lines so every part lines up:
//   - a landing on each floor (bottom right on the lower floor, top left on the upper one),
//   - the steps: a staircase profile between them, creeping upward,
//   - the truss directly under the steps,
//   - a glass balustrade and a black handrail at a fixed height above the step noses, with
//     rounded newels at both landings,
//   - riders standing on the steps, the same scale as everyone else in the tower.
const ESC = { slab: 2, landing: 8, rail: 8.5, truss: 5, stepRun: 2.6 };   // world px
export function escalator(r, z, st, busy) {
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();      // nothing spills into the next room
  backWall(r, mix(T.escalator, '#ffffff', 0.18), z);
  const lowY = r.y + r.h - ESC.slab * z;                  // the lower floor's walking surface
  const upY = r.y + r.h / 2 - ESC.slab * z;               // the upper floor's walking surface
  const xb = r.x + r.w - ESC.landing * z;                 // where the incline leaves the lower landing
  const xt = r.x + ESC.landing * z;                       // where it meets the upper landing
  const run = xb - xt, rise = lowY - upY;
  const surfY = (x) => (x >= xb ? lowY : x <= xt ? upY : lowY - ((xb - x) / run) * rise);   // walking surface at x
  // The upper floor's slab under its landing.
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(r.x, upY, xt - r.x + 2 * z, ESC.slab * z);
  // Truss: a band of constant depth directly under the incline, with a darker lower edge.
  const td = ESC.truss * z;
  ctx.fillStyle = '#7d8a9b';
  ctx.beginPath(); ctx.moveTo(xb + 3 * z, lowY); ctx.lineTo(xt - 3 * z, upY); ctx.lineTo(xt - 3 * z, upY + td); ctx.lineTo(xb + 3 * z, lowY + td * 0.2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5b6779';
  ctx.beginPath(); ctx.moveTo(xt - 3 * z, upY + td); ctx.lineTo(xb + 3 * z, lowY + td * 0.2); ctx.lineTo(xb + 3 * z, lowY + td * 0.2 + 1.4 * z); ctx.lineTo(xt - 3 * z, upY + td + 1.4 * z); ctx.closePath(); ctx.fill();
  // Steps: a staircase profile, each step a run of ESC.stepRun and the matching rise, sliding up.
  const sr = ESC.stepRun * z, sh = sr * rise / run;
  const off = reduced ? 0 : ((now / 1000) * 5 * z) % sr;
  ctx.save(); ctx.beginPath(); ctx.rect(xt, upY - rise, run, rise * 2); ctx.clip();
  ctx.fillStyle = '#c9ced4';
  for (let x = xb + off; x > xt - sr; x -= sr) {
    const y = surfY(x);
    ctx.fillRect(x - sr, y - sh, sr, sh + 0.6 * z);                            // tread and riser
    ctx.fillStyle = '#9aa7b4'; ctx.fillRect(x - sr, y - sh, sr, 0.5 * z); ctx.fillStyle = '#c9ced4';   // the nose line
  }
  ctx.restore();
  // Comb plates at both landings.
  ctx.fillStyle = '#9aa7b4'; ctx.fillRect(xb, lowY - 0.8 * z, r.x + r.w - xb, 0.8 * z); ctx.fillRect(r.x, upY - 0.8 * z, xt - r.x, 0.8 * z);
  // Riders, feet on the step surface.
  if (busy) {
    for (let k = 0; k < 2; k++) {
      const t = reduced ? 0.35 + k * 0.35 : ((now / 7000 + k * 0.5 + h01(st.id, k)) % 1);
      const x = xb - run * t;
      drawPerson(ctx, x, surfY(x), z, lookFor(st.id * 3 + k), 0, -1, { still: true });
    }
  }
  // Balustrade glass and handrail, a fixed height above the walking surface.
  const hr = ESC.rail * z;
  const ends = [[xb + 4 * z, lowY], [xb, lowY], [xt, upY], [xt - 4 * z, upY]];
  ctx.fillStyle = 'rgba(190,225,250,0.32)';
  ctx.beginPath(); ends.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = ends.length - 1; i >= 0; i--) ctx.lineTo(ends[i][0], ends[i][1] - hr);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#1b1d24'; ctx.lineWidth = Math.max(1, 1.4 * z); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ends.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - hr) : ctx.moveTo(x, y - hr))); ctx.stroke();
  // Rounded newels where the handrail turns down at each landing.
  ctx.beginPath(); ctx.arc(ends[0][0], lowY - hr * 0.5, hr * 0.5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(ends[3][0], upY - hr * 0.5, hr * 0.5, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  ctx.restore();
}

// ---- A bought floor with no room yet ---------------------------------------------------------------
// An unfinished interior rather than a hole: a concrete back wall with panel joints, a column at
// each cell edge, a ceiling beam, the slab, and a dashed outline of the room to come. Dim at night.
export function bareFloor(r, z, cellW) {
  const n = night();
  ctx.fillStyle = mix('#c4c8cd', '#2b2f36', n * 0.75); ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = r.y + 10 * z; y < r.y + r.h - 4 * z; y += 10 * z) ctx.fillRect(r.x, y, r.w, Math.max(1, 0.5 * z));   // panel joints
  ctx.fillStyle = mix('#a9aeb5', '#22262c', n * 0.75); ctx.fillRect(r.x, r.y, r.w, 3 * z);                          // ceiling beam
  const cw = cellW * z;
  for (let x = r.x; x <= r.x + r.w + 0.5; x += cw) {                                                                 // columns
    ctx.fillStyle = mix('#b3b8bf', '#272b31', n * 0.75); ctx.fillRect(x - 1.6 * z, r.y + 3 * z, 3.2 * z, r.h - 3 * z);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x - 1.6 * z, r.y + 3 * z, 0.8 * z, r.h - 3 * z);
  }
  if (z >= DETAIL_ZOOM) {                                                                                            // a work light
    ctx.fillStyle = n > 0.5 ? 'rgba(255,224,150,0.5)' : 'rgba(255,255,255,0.4)';
    ctx.fillRect(r.x + r.w / 2 - 2 * z, r.y + 3 * z, 4 * z, 1 * z);
  }
  ctx.fillStyle = T.slab; ctx.fillRect(r.x, r.y + r.h - 4 * z, r.w, 4 * z);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.strokeRect(r.x + 2.5 * z, r.y + 5 * z, r.w - 5 * z, r.h - 11 * z);
  ctx.setLineDash([]);
}

// ---- Basement: car park and transit -------------------------------------------------------------
function compactCar(x, y, len, z, colour) {
  const h = len * 0.32;
  ctx.fillStyle = colour;
  rr(x, y - h, len, h * 0.62, h * 0.2); ctx.fill();
  rr(x + len * 0.2, y - h * 1.32, len * 0.55, h * 0.75, h * 0.25); ctx.fill();
  ctx.fillStyle = 'rgba(190,225,250,0.9)';
  ctx.fillRect(x + len * 0.26, y - h * 1.2, len * 0.2, h * 0.42); ctx.fillRect(x + len * 0.5, y - h * 1.2, len * 0.2, h * 0.42);
  ctx.fillStyle = '#1b1d24';
  ctx.beginPath(); ctx.arc(x + len * 0.24, y - h * 0.38, h * 0.3, 0, Math.PI * 2); ctx.arc(x + len * 0.78, y - h * 0.38, h * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9aa7b4';
  ctx.beginPath(); ctx.arc(x + len * 0.24, y - h * 0.38, h * 0.12, 0, Math.PI * 2); ctx.arc(x + len * 0.78, y - h * 0.38, h * 0.12, 0, Math.PI * 2); ctx.fill();
}
const PARK_COLOURS = ['#e63946', '#f1faee', '#457b9d', '#2a9d8f', '#f4a261', '#8d99ae', '#1d3557', '#e9c46a'];

export function carpark(r, z, st, spaces, cars, ok) {
  // Concrete: a darker ceiling band, columns at every cell, a grey floor.
  ctx.fillStyle = '#6f757e'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#5b6068'; ctx.fillRect(r.x, r.y, r.w, 5 * z);
  ctx.fillStyle = '#4c5158'; ctx.fillRect(r.x, r.y + r.h - 6 * z, r.w, 4 * z);
  const cw = r.w / 4;
  for (let c = 0; c <= 4; c++) { ctx.fillStyle = '#868c95'; ctx.fillRect(r.x + c * cw - 1.5 * z, r.y + 5 * z, 3 * z, r.h - 11 * z); ctx.fillStyle = '#f6b73c'; ctx.fillRect(r.x + c * cw - 1.5 * z, r.y + r.h - 11 * z, 3 * z, 1.2 * z); }
  // Strip lights.
  for (let c = 0; c < 4; c++) ceilingLight(r.x + c * cw + cw * 0.25, r.y + 5 * z, cw * 0.5, z);
  // A blue P sign.
  const px = r.x + cw * 0.5, py = r.y + 11 * z;
  ctx.fillStyle = '#1d4fa8'; rr(px - 3.6 * z, py - 3.6 * z, 7.2 * z, 7.2 * z, 1.2 * z); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = `700 ${(6 * z).toFixed(1)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', px, py + 0.3 * z);
  // Bay lines and parked cars.
  const bw = r.w / spaces, y = r.y + r.h - 6 * z;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 1; i < spaces; i++) ctx.fillRect(r.x + i * bw - 0.4 * z, y - 1.2 * z, 0.8 * z, 1.2 * z);
  for (let i = 0; i < spaces && i < cars; i++) compactCar(r.x + i * bw + bw * 0.08, y, bw * 0.84, z, PARK_COLOURS[Math.floor(h01(st.id, i + 70) * PARK_COLOURS.length)]);
  // A green exit sign, glowing.
  ctx.fillStyle = ok ? '#2bb673' : '#3a5a48'; ctx.fillRect(r.x + r.w - cw * 0.6, r.y + 7 * z, 7 * z, 3 * z);
}

// The transit platform: tiled wall, a yellow platform edge, a train that pulls in, waits and leaves
// on a 24 s cycle (parked at the platform under reduced motion), and passengers waiting.
export function transit(r, z, st, ok) {
  ctx.fillStyle = '#e8e2d4'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = r.x; x < r.x + r.w; x += 4 * z) ctx.fillRect(x, r.y, 0.4 * z, r.h * 0.62);
  for (let y = r.y; y < r.y + r.h * 0.62; y += 3 * z) ctx.fillRect(r.x, y, r.w, 0.4 * z);
  ctx.fillStyle = '#2f6f8f'; ctx.fillRect(r.x, r.y + r.h * 0.22, r.w, 2.4 * z);                   // a coloured band
  ctx.fillStyle = '#ffffff'; ctx.font = `700 ${(3.6 * z).toFixed(1)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('SKYRISE', r.x + 4 * z, r.y + r.h * 0.22 + 1.2 * z);
  const track = r.y + r.h - 6 * z;
  ctx.fillStyle = '#3d4452'; ctx.fillRect(r.x, track, r.w, 4 * z);
  ctx.fillStyle = '#f6b73c'; ctx.fillRect(r.x, track - 1 * z, r.w, 1 * z);
  // The train.
  let pos = 0;                                                   // 0 = at the platform
  if (!reduced) {
    const t = ((now / 1000) + h01(st.id, 80) * 24) % 24;
    pos = t < 4 ? 1 - t / 4 : t < 14 ? 0 : t < 18 ? -(t - 14) / 4 : 1;   // in, wait, out, away
  }
  if (ok && Math.abs(pos) < 1) {
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const tw = r.w * 0.92, tx = r.x + r.w * 0.04 + pos * r.w * 1.1, th = r.h * 0.5, ty = track - th;
    ctx.fillStyle = '#f4f6f8'; rr(tx, ty, tw, th, 3 * z); ctx.fill();
    ctx.fillStyle = '#2f6f8f'; ctx.fillRect(tx, ty + th * 0.68, tw, th * 0.14);
    const cars = 3, carW = tw / cars;
    for (let c = 0; c < cars; c++) {
      for (let w = 0; w < 4; w++) { ctx.fillStyle = win(0.6 + 0.4 * T.warm); ctx.fillRect(tx + c * carW + carW * (0.08 + w * 0.22), ty + th * 0.18, carW * 0.14, th * 0.36); }
      ctx.fillStyle = '#c9ced4'; ctx.fillRect(tx + (c + 1) * carW - 0.5 * z, ty, z, th);
    }
    ctx.fillStyle = '#1b1d24'; for (let w = 0; w < 6; w++) { ctx.beginPath(); ctx.arc(tx + tw * (0.08 + w * 0.17), track + 0.6 * z, 1.4 * z, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  // Passengers waiting when the train is away.
  if (ok && Math.abs(pos) > 0.3) {
    for (let k = 0; k < 4; k++) drawPerson(ctx, r.x + r.w * (0.15 + k * 0.2), track - 1 * z, z, lookFor(st.id * 5 + k), 0, k % 2 ? 1 : -1, { still: true });
  }
}

// ---- Lifts ----------------------------------------------------------------------------------------
// One shaft cell: the back wall, guide rails, and the landing doors at this stop.
export function shaftCell(r, z, type, closed) {
  const base = type === 'express' ? T.express : type === 'servicelift' ? T.servicelift : T.shaft;
  ctx.fillStyle = base; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = r.y + 4 * z; y < r.y + r.h; y += 8 * z) ctx.fillRect(r.x, y, r.w, 0.5 * z);  // concrete courses
  const rail = type === 'express' ? 'rgba(246,183,60,0.55)' : 'rgba(255,255,255,0.16)';
  ctx.fillStyle = rail; ctx.fillRect(r.x + 2 * z, r.y, Math.max(1, z), r.h); ctx.fillRect(r.x + r.w - 3 * z, r.y, Math.max(1, z), r.h);
  // Landing doors: a frame and two panels, darkened and barred when the stop is closed.
  const dx = r.x + 5 * z, dw = r.w - 10 * z, dy = r.y + r.h - 22 * z, dh = 18 * z;
  ctx.fillStyle = type === 'express' ? '#c99a2e' : 'rgba(255,255,255,0.22)';
  ctx.fillRect(dx - 1 * z, dy - 1 * z, dw + 2 * z, dh + 1 * z);
  ctx.fillStyle = closed ? 'rgba(0,0,0,0.55)' : type === 'servicelift' ? '#8a8f98' : '#a9b4c2';
  ctx.fillRect(dx, dy, dw / 2 - 0.3 * z, dh); ctx.fillRect(dx + dw / 2 + 0.3 * z, dy, dw / 2 - 0.3 * z, dh);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(dx, dy, dw, 0.8 * z);
  if (type === 'servicelift' && !closed) {
    ctx.fillStyle = 'rgba(246,183,60,0.85)';
    for (let i = 0; i < 3; i++) ctx.fillRect(dx, dy + dh * (0.25 + i * 0.25), dw, 1.4 * z);
  }
  if (closed) { ctx.strokeStyle = 'rgba(214,69,69,0.85)'; ctx.lineWidth = Math.max(1, 1.2 * z); ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx + dw, dy + dh); ctx.moveTo(dx + dw, dy); ctx.lineTo(dx, dy + dh); ctx.stroke(); }
  // The call button panel beside the doors.
  ctx.fillStyle = closed ? 'rgba(0,0,0,0.4)' : '#f6b73c'; ctx.fillRect(r.x + r.w - 4.6 * z, dy + dh * 0.45, 1.2 * z, 2 * z);
}

// A lift car: a lit cabin with a frame, riders inside, and doors that part while it loads.
export function liftCar(cx, cy, cw, ch, z, type, riders, open, seed) {
  const frame = type === 'express' ? '#1d2a48' : type === 'servicelift' ? '#5c5546' : '#3d4452';
  const trim = type === 'express' ? '#f1c24b' : T.car;
  ctx.fillStyle = frame; rr(cx - 0.6 * z, cy - 0.6 * z, cw + 1.2 * z, ch + 1.2 * z, 1.4 * z); ctx.fill();
  ctx.fillStyle = trim; ctx.fillRect(cx, cy, cw, 2 * z);                       // the roof strip / indicator
  // Cabin interior, lit.
  ctx.fillStyle = win(0.75 + 0.25 * T.warm); ctx.fillRect(cx + 1 * z, cy + 2.6 * z, cw - 2 * z, ch - 3.6 * z);
  // Riders: up to three, from the shoulders up.
  for (let i = 0; i < Math.min(3, riders); i++) {
    const look = lookFor(seed * 7 + i), px = cx + cw * (0.28 + i * 0.22), fy = cy + ch - 1 * z;
    ctx.fillStyle = look.shirt; ctx.fillRect(px - 1.8 * z, fy - 6 * z, 3.6 * z, 5 * z);
    ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(px, fy - 7.6 * z, 1.6 * z, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.hair; ctx.beginPath(); ctx.arc(px, fy - 8.1 * z, 1.6 * z, Math.PI, Math.PI * 2); ctx.fill();
  }
  // Doors slide apart from the middle.
  const half = (cw - 2 * z) / 2, gap = half * open;
  ctx.fillStyle = type === 'servicelift' ? '#9aa1aa' : '#b8c0cc';
  ctx.fillRect(cx + 1 * z, cy + 2.6 * z, Math.max(0, half - gap), ch - 3.6 * z);
  ctx.fillRect(cx + 1 * z + half + gap, cy + 2.6 * z, Math.max(0, half - gap), ch - 3.6 * z);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  if (half - gap > z) { ctx.fillRect(cx + 1 * z, cy + 2.6 * z, Math.max(0, half - gap), 0.8 * z); ctx.fillRect(cx + 1 * z + half + gap, cy + 2.6 * z, Math.max(0, half - gap), 0.8 * z); }
}
