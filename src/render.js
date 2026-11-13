// Canvas renderer. Owns the camera and every cosmetic animation (corridor
// strollers, placement dust, income floats) and draws the sim's people: lift
// cars and the queues at their doors come from `state.transit`. All art is drawn in code.
//
// Hot-path rules: nothing allocates per frame except the odd template string
// on a palette bucket change; rects go through one scratch object, the grid
// and BFS are cached until the tower changes, and the sky/skyline/ground is
// cached on an offscreen canvas that is only repainted when the light, size
// or camera changes.

import {
  CELL_W, CELL_H, ZOOM_MIN, ZOOM_MAX, HOURS_PER_DAY, TYPES, WALK_STEPS, BASEMENT_LEVELS, NAME_ZOOM, NAME_CACHE_MAX, MINIMAP_CELL,
  RAIN_STREAKS, SNOW_FLAKES, WEATHER_DIM, FOG_ALPHA, WIND_SLANT, WIND_SWAY_PX, FIREWORK_PARTICLES, FIREWORK_MAX_BURSTS,
  FIREWORK_HOURS, FIREWORK_LIFE_MS, SLED_HOURS, LANTERN_EVERY, FLAG_DETAIL_ZOOM,
} from './constants.js';
import { tenantOf, nameOf } from './tenants.js';
import {
  buildGrid, reachable, canPlace, happyBand, shaftsOf, takeOf, stressOf, stressBand, walkerStepsDone, floorCap, LOWEST_FLOOR,
} from './sim.js';
import {
  clamp01, lerp, easeOutCubic, easeOutBack, smoothstep, hash01, prefersReducedMotion,
} from './anim.js';

const PALETTE_KEYS = ['sky-top', 'sky-bottom', 'night-top', 'night-bottom', 'horizon', 'skyline', 'ground', 'ground-dark',
  'kerb', 'grid-line', 'wall-dark', 'glass', 'window-lit', 'lobby', 'office', 'shop', 'flat', 'stairs', 'shaft', 'express', 'security', 'car',
  'food', 'escalator', 'slab',
  'hotel', 'hall', 'housekeeping', 'servicelift', 'parking', 'transit', 'clinic', 'plant', 'soil', 'soil-dark', 'dug',
  'person', 'unreach', 'ghost-ok', 'ghost-bad', 'fg', 'muted', 'good', 'warn', 'danger', 'float-bg'];

const PLACE_MS = 180, DUST_MS = 420, FLOAT_MS = 1000, FLOAT_RISE = 22;
const SHIRTS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#cdb4db', '#f4a261'];
const MAX_FLOATS_PER_TICK = 8;
const QUEUE_DRAWN = 10, QUEUE_GAP = 6;  // figures drawn per lift door, and their spacing in world px
// Office window patterns: windows per cell, share of the bay glazed, top inset and total inset (world px).
const OFFICE_WINDOWS = { grid: [3, 0.6, 6, 12], tall: [2, 0.5, 4, 8], band: [6, 0.92, 9, 18], wide: [2, 0.8, 8, 16] };
// Mini-map colour token per type, where the token is not the type's own name.
const MAP_TOKEN = { elevator: 'shaft', floor: 'slab' };

// Sprint 5b art sizes (world px unless noted) and colours. The sled is the agy image
// (assets/art/santa-sled.png); a code-drawn placeholder is used if it fails to load.
const SLED_FILE = 'assets/art/santa-sled.png';
const SLED_W = 96, SLED_H = 32;           // CSS px on screen; the canvas behind it is 2x
const FLAG_W = 22, FLAG_H = 11, FLAG_POLE = 18;
const FW_COLOURS = ['#ffd166', '#ef476f', '#06d6a0', '#8ecae6', '#ffffff', '#f4a261'];
const XMAS_BULBS = ['#ef4444', '#22c55e', '#facc15', '#60a5fa'];
const FW_PER_BURST = 32, SPARK_PER_BURST = 12;

// A queued walker's torso: their own shirt when calm, warn when tense, danger when stressed.
export const stressColour = (band, palette, shirt) => (band === 'stressed' ? palette.danger : band === 'tense' ? palette.warn : shirt);

// Code-drawn stand-in for assets/art/santa-sled.png (192x64): two reindeer, a red
// sled with a gold runner and Santa, as silhouettes that read on a night sky.
function paintSledPlaceholder(g) {
  g.clearRect(0, 0, 192, 64);
  g.fillStyle = '#5b3a1e';
  for (const x0 of [8, 46]) {
    g.fillRect(x0, 26, 26, 9);                       // body
    g.fillRect(x0 + 22, 16, 6, 12);                  // neck
    g.fillRect(x0 + 24, 12, 10, 6);                  // head
    g.fillRect(x0 + 2, 34, 3, 10); g.fillRect(x0 + 19, 34, 3, 10);  // legs
    g.fillRect(x0 + 26, 4, 2, 9); g.fillRect(x0 + 30, 2, 2, 11);    // antlers
  }
  g.fillStyle = '#ef4444'; g.fillRect(77, 13, 3, 3);   // the red nose
  g.strokeStyle = '#ffd784'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(34, 30); g.lineTo(46, 30); g.moveTo(72, 30); g.lineTo(104, 34); g.stroke();  // reins
  g.fillStyle = '#c2410c';
  g.beginPath(); g.moveTo(104, 26); g.lineTo(172, 26); g.lineTo(166, 48); g.lineTo(110, 48); g.closePath(); g.fill();
  g.fillStyle = '#f6b73c';
  g.fillRect(100, 52, 74, 3); g.fillRect(104, 46, 3, 7); g.fillRect(162, 46, 3, 7);  // runner
  g.fillStyle = '#c2410c'; g.fillRect(136, 12, 18, 16);                // Santa's coat
  g.fillStyle = '#ffd784'; g.fillRect(139, 4, 12, 9);                  // face
  g.fillStyle = '#ffffff'; g.fillRect(138, 10, 14, 5);                 // beard
  g.fillStyle = '#c2410c'; g.fillRect(138, 0, 12, 5);                  // hat
  g.fillStyle = '#3a4250'; g.fillRect(116, 18, 16, 10);                // the sack
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const cam = { x: 0, y: 0, zoom: 1 };
  let dpr = 1, width = 0, height = 0;
  let palette = {};
  let themeRev = 0;

  // Background cache (sky gradient, stars, skyline, ground).
  const bg = document.createElement('canvas');
  const bgx = bg.getContext('2d', { alpha: false });
  let bgKey = '';
  // Far skyline art (assets/art/skyline-far.png). Until it loads, the code-drawn
  // far layer is used, so a slow or failed image never leaves a gap.
  const skylineImg = new Image();
  skylineImg.src = 'assets/art/skyline-far.png';
  skylineImg.onload = () => { bgKey = ''; };
  const skylineReady = () => skylineImg.complete && skylineImg.naturalWidth > 0;

  // Per-frame colour tones derived from the palette and the light level.
  const tones = {};
  let toneKey = '';
  // Per business, its night-dimmed tint and accent; cleared whenever the tones change.
  const bizTones = new Map();
  // Fitted sign text per name, at most NAME_CACHE_MAX: name -> { bucket, maxW, text }.
  const nameFits = new Map();
  let nameBucket = -1, nameFont = '';
  const winTone = new Array(9).fill('#000');

  // Layout cache: grid, reachability and derived geometry per structure.
  const lay = { ref: null, n: -1, nid: -1, grid: null, reach: null, info: new Map(), shafts: [],
    roofCol: -1, roofFloor: 0, minCol: 0, maxCol: 0 };   // the highest roof cell (the Merdeka flag) and the tower's span
  const walkers = new Map();    // unit id -> walker list
  let walkerList = [];          // flat list, rebuilt when the live set changes
  let walkerSig = '';
  const placing = new Map();    // structure id -> start time
  const dust = Array.from({ length: 96 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, t0: 0, dur: DUST_MS, warm: false }));
  const floats = Array.from({ length: 48 }, () => ({ on: false, x: 0, y: 0, text: '', t0: 0, neg: false }));
  let floatCursor = 0;
  let lastFrame = 0;
  const R = { x: 0, y: 0, w: 0, h: 0 }; // scratch rect
  // Where the front of each drawn queue stood last frame (screen px), for checks and debugging.
  const queueSpots = Array.from({ length: 64 }, () => ({ x: 0, y: 0, band: '', col: 0, floor: 0 }));
  let queueSpotCount = 0;
  const doorCount = new Map();  // door floor -> figures drawn so far, reused per shaft

  // Weather and festivals (Sprint 5b): fixed pools, nothing allocated per frame.
  const debug = { particles: 0, weather: 'clear', fireworks: 0, sled: false };
  const rain = { x: new Float32Array(RAIN_STREAKS), y: new Float32Array(RAIN_STREAKS), v: new Float32Array(RAIN_STREAKS) };
  const snow = { x: new Float32Array(SNOW_FLAKES), y: new Float32Array(SNOW_FLAKES), v: new Float32Array(SNOW_FLAKES) };
  let poolW = 0, poolH = 0;                 // viewport the pools were scattered over
  const fw = {
    x: new Float32Array(FIREWORK_PARTICLES), y: new Float32Array(FIREWORK_PARTICLES),
    vx: new Float32Array(FIREWORK_PARTICLES), vy: new Float32Array(FIREWORK_PARTICLES),
    t0: new Float64Array(FIREWORK_PARTICLES), life: new Float32Array(FIREWORK_PARTICLES),
    c: new Uint8Array(FIREWORK_PARTICLES), on: new Uint8Array(FIREWORK_PARTICLES),
  };
  const burstEnd = new Float64Array(FIREWORK_MAX_BURSTS);
  let nextBurstAt = 0;
  const fest = { newyear: false, christmas: false, cny: false, raya: false, deepavali: false, merdeka: false };
  let decorOn = false, sway = 0, frameNow = 0, frameReduced = false;
  let fogGrad = null, fogGY = -1, fogTone = '';
  // The sled: one image, painted once (placeholder) or loaded (SLED_FILE).
  const sled = document.createElement('canvas');
  sled.width = SLED_W * 2; sled.height = SLED_H * 2;
  paintSledPlaceholder(sled.getContext('2d'));
  let sledImg = sled;
  if (SLED_FILE) {
    const img = new Image();
    img.onload = () => { if (img.naturalWidth > 0) sledImg = img; };
    img.src = SLED_FILE;
  }

  function refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    palette = {};
    for (const k of PALETTE_KEYS) palette[k] = cs.getPropertyValue('--' + k).trim();
    themeRev++;
    toneKey = ''; bgKey = '';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    bg.width = canvas.width; bg.height = canvas.height;
    bgKey = '';
  }

  // World: x grows right, y grows DOWN; floor f sits between
  // (maxFloors - f) * CELL_H and (maxFloors - f + 1) * CELL_H.
  const worldH = (state) => state.maxFloors * CELL_H;
  const worldW = (state) => state.width * CELL_W;

  function clamp(state) {
    const margin = 4 * CELL_W;
    const viewW = width / cam.zoom, viewH = height / cam.zoom;
    const minX = -margin, maxX = worldW(state) + margin - viewW;
    cam.x = maxX < minX ? (minX + maxX) / 2 : Math.max(minX, Math.min(maxX, cam.x));
    // Up to the current height cap (or the tallest structure), down past the deepest basement level.
    let top = floorCap(state);
    for (const st of state.structures) top = Math.max(top, st.floor + TYPES[st.type].h - 1);
    const minY = (state.maxFloors - top - 2) * CELL_H, maxY = worldH(state) + (BASEMENT_LEVELS + 2) * CELL_H - viewH;
    cam.y = maxY < minY ? maxY : Math.max(minY, Math.min(maxY, cam.y));
  }

  function recenter(state) {
    cam.zoom = width < 500 ? 1.2 : 1.5;
    cam.x = worldW(state) / 2 - width / cam.zoom / 2;
    cam.y = worldH(state) + CELL_H * 1.6 - height / cam.zoom;
    clamp(state);
  }

  function pan(state, dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; clamp(state); }

  function zoomAt(state, sx, sy, factor) {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
    const wx = sx / cam.zoom + cam.x, wy = sy / cam.zoom + cam.y;
    cam.zoom = next;
    cam.x = wx - sx / cam.zoom;
    cam.y = wy - sy / cam.zoom;
    clamp(state);
  }

  function screenToCell(state, sx, sy) {
    const wx = sx / cam.zoom + cam.x, wy = sy / cam.zoom + cam.y;
    return { col: Math.floor(wx / CELL_W), floor: state.maxFloors - Math.floor(wy / CELL_H) };
  }

  const sx = (wx) => (wx - cam.x) * cam.zoom;
  const sy = (wy) => (wy - cam.y) * cam.zoom;
  function rectOf(state, col, floor, w, h) {
    R.x = sx(col * CELL_W); R.y = sy((state.maxFloors - floor - h + 1) * CELL_H);
    R.w = w * CELL_W * cam.zoom; R.h = h * CELL_H * cam.zoom;
    return R;
  }

  // Daylight 0..1 peaking early afternoon; drives sky and lit windows.
  function daylight(state, phase) {
    const hour = (state.tick % HOURS_PER_DAY) + phase;
    return 0.5 + 0.5 * Math.cos(((hour - 13) / HOURS_PER_DAY) * Math.PI * 2);
  }

  function parseColor(c) {
    let m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function mix(a, b, t) {
    const A = parseColor(a), B = parseColor(b);
    if (!A || !B) return a;
    t = clamp01(t);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }

  // Recompute the night-tinted colours only when the light bucket changes.
  function updateTones(night, weather = 'clear') {
    const q = Math.round(night * 48);
    const key = q + '|' + themeRev + '|' + weather;   // weather joins the key: the cached sky repaints only when it changes
    if (key === toneKey) return;
    toneKey = key;
    const n = q / 48, dim = '#0b1026';
    bizTones.clear();
    tones.skyTop = mix(palette['sky-top'], palette['night-top'], n);
    tones.skyBottom = mix(palette['sky-bottom'], palette['night-bottom'], n);
    // Rain and fog grey the sky and dim the tower a little (G-40).
    const wd = WEATHER_DIM[weather] || 0;
    if (wd) {
      const grey = mix('#9aa3ad', '#1d2430', n);
      tones.skyTop = mix(tones.skyTop, grey, wd * 1.6);
      tones.skyBottom = mix(tones.skyBottom, grey, wd * 1.4);
    }
    tones.horizon = palette.horizon;
    tones.dusk = 1 - Math.abs(n - 0.5) * 2;           // peaks at the transition
    tones.ground = mix(palette.ground, '#10140d', n * 0.55);
    tones.groundDark = mix(palette['ground-dark'], '#0a0c08', n * 0.55);
    tones.kerb = mix(palette.kerb, '#2a2f26', n * 0.5);
    tones.skyline = mix(palette.skyline, '#05081a', n * 0.7);
    tones.wall = mix(palette['wall-dark'], dim, n * 0.4);
    tones.glass = mix(palette.glass, '#243357', n * 0.75);
    for (const k of ['lobby', 'office', 'shop', 'flat', 'stairs', 'shaft', 'express', 'security', 'food', 'escalator', 'slab',
      'hotel', 'hall', 'housekeeping', 'servicelift', 'clinic', 'plant']) tones[k] = mix(palette[k], dim, n * 0.42 + wd * 0.35);
    tones.awning = mix('#ffffff', dim, n * 0.5);
    tones.car = palette.car;
    tones.person = palette.person;
    tones.warm = smoothstep(0.28, 0.7, n);           // how much of the tower is lit
    for (let i = 0; i < winTone.length; i++) winTone[i] = mix(tones.glass, palette['window-lit'], i / (winTone.length - 1));
    tones.lamp = palette['window-lit'];
    tones.night = n;
  }

  // A business's facade colours at the current light: { tint, accent }.
  function bizTone(type, biz) {
    let c = bizTones.get(biz.key);
    if (!c) {
      const dim = mix(biz.accent, '#0b1026', tones.night * 0.42);
      c = { tint: mix(tones[type], biz.accent, biz.tint), accent: dim };
      bizTones.set(biz.key, c);
    }
    return c;
  }

  // A sign glyph on a light plaque, about 10 world px across; at most six shapes each.
  function drawGlyph(kind, cx, cy, z, color) {
    const u = z;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.arc(cx, cy, 5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 1.1 * u);
    ctx.beginPath();
    switch (kind) {
      case 'fish':
        ctx.ellipse(cx - 0.6 * u, cy, 2.6 * u, 1.5 * u, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx + 1.6 * u, cy); ctx.lineTo(cx + 3.4 * u, cy - 1.6 * u); ctx.lineTo(cx + 3.4 * u, cy + 1.6 * u); ctx.closePath(); ctx.fill();
        break;
      case 'slice':
        ctx.moveTo(cx - 3 * u, cy - 2.2 * u); ctx.lineTo(cx + 3 * u, cy - 2.2 * u); ctx.lineTo(cx, cy + 3.2 * u); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath(); ctx.arc(cx - 0.9 * u, cy - 0.9 * u, 0.7 * u, 0, Math.PI * 2); ctx.arc(cx + 0.9 * u, cy - 0.3 * u, 0.7 * u, 0, Math.PI * 2); ctx.fill();
        break;
      case 'leaf':
        ctx.ellipse(cx, cy, 3.6 * u, 1.8 * u, -0.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath(); ctx.moveTo(cx - 2.6 * u, cy + 1.8 * u); ctx.lineTo(cx + 2.4 * u, cy - 1.6 * u); ctx.stroke();
        break;
      case 'bowl':
        ctx.arc(cx, cy, 3.2 * u, 0, Math.PI); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx - 0.5 * u, cy - 0.3 * u); ctx.lineTo(cx + 2.4 * u, cy - 3.6 * u);
        ctx.moveTo(cx + 0.8 * u, cy - 0.3 * u); ctx.lineTo(cx + 3.4 * u, cy - 3 * u); ctx.stroke();
        break;
      case 'cup':
        ctx.fillRect(cx - 2.6 * u, cy - 2 * u, 4 * u, 4 * u);
        ctx.beginPath(); ctx.arc(cx + 1.6 * u, cy, 1.4 * u, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.fillRect(cx - 3.4 * u, cy + 2.4 * u, 5.6 * u, Math.max(1, 0.8 * u));
        break;
      case 'dumbbell':
        ctx.fillRect(cx - 2.6 * u, cy - 0.5 * u, 5.2 * u, u);
        ctx.fillRect(cx - 3.6 * u, cy - 2.2 * u, 1.6 * u, 4.4 * u); ctx.fillRect(cx + 2 * u, cy - 2.2 * u, 1.6 * u, 4.4 * u);
        break;
      case 'flower':
        for (let i = 0; i < 5; i++) { const a = i * 1.2566; ctx.moveTo(cx + Math.cos(a) * 2 * u + 1.3 * u, cy + Math.sin(a) * 2 * u); ctx.arc(cx + Math.cos(a) * 2 * u, cy + Math.sin(a) * 2 * u, 1.3 * u, 0, Math.PI * 2); }
        ctx.fill();
        ctx.fillStyle = '#f6b73c'; ctx.beginPath(); ctx.arc(cx, cy, 1.1 * u, 0, Math.PI * 2); ctx.fill();
        break;
      case 'book':
        ctx.fillRect(cx - 3.4 * u, cy - 2.2 * u, 3 * u, 4.4 * u); ctx.fillRect(cx + 0.4 * u, cy - 2.2 * u, 3 * u, 4.4 * u);
        break;
      case 'chip':
        ctx.fillRect(cx - 2 * u, cy - 2 * u, 4 * u, 4 * u);
        for (const d of [-1.2, 0, 1.2]) { ctx.moveTo(cx - 3.4 * u, cy + d * u); ctx.lineTo(cx + 3.4 * u, cy + d * u); ctx.moveTo(cx + d * u, cy - 3.4 * u); ctx.lineTo(cx + d * u, cy + 3.4 * u); }
        ctx.stroke();
        break;
      case 'scales':
        ctx.fillRect(cx - 0.5 * u, cy - 3 * u, u, 6 * u); ctx.fillRect(cx - 3.4 * u, cy - 2.4 * u, 6.8 * u, 0.9 * u);
        ctx.beginPath(); ctx.arc(cx - 2.6 * u, cy, 1.3 * u, 0, Math.PI); ctx.arc(cx + 2.6 * u, cy, 1.3 * u, 0, Math.PI); ctx.fill();
        break;
      case 'coin':
        ctx.arc(cx, cy, 3.2 * u, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(cx - 0.5 * u, cy - 2 * u, u, 4 * u);
        break;
      case 'pen':
        ctx.lineWidth = Math.max(1, 1.8 * u);
        ctx.moveTo(cx + 2.6 * u, cy - 2.6 * u); ctx.lineTo(cx - 1.4 * u, cy + 1.4 * u); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 1.9 * u, cy + 0.6 * u); ctx.lineTo(cx - 0.6 * u, cy + 1.9 * u); ctx.lineTo(cx - 3 * u, cy + 3 * u); ctx.closePath(); ctx.fill();
        break;
    }
  }

  // The unit's name on its sign, from NAME_ZOOM up, cut to fit `maxW` screen px.
  function drawName(st, x, y, maxW, z) {
    if (z < NAME_ZOOM || maxW < 12) return;
    const name = nameOf(st);
    if (!name) return;
    const bucket = Math.round(z * 10);
    if (bucket !== nameBucket) { nameBucket = bucket; nameFont = `600 ${(4.2 * z).toFixed(1)}px system-ui, sans-serif`; }
    ctx.font = nameFont;
    const w = Math.round(maxW);
    let e = nameFits.get(name);
    if (!e || e.bucket !== bucket || e.maxW !== w) {
      if (!e) {
        if (nameFits.size >= NAME_CACHE_MAX) nameFits.delete(nameFits.keys().next().value);
        e = { bucket: 0, maxW: 0, text: '' };
        nameFits.set(name, e);
      }
      let text = name;
      if (ctx.measureText(text).width > w) {
        while (text.length > 1 && ctx.measureText(text + '…').width > w) text = text.slice(0, -1);
        text = text.trimEnd() + '…';
      }
      e.bucket = bucket; e.maxW = w; e.text = text;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(e.text, x, y);
  }

  // The tower sheet's mini map: MINIMAP_CELL px per cell, in the type tokens.
  // Painted on demand (the sheet repaints it each hour while it is open).
  function paintMiniMap(cv, state) {
    const g = cv.getContext('2d');
    const k = MINIMAP_CELL, top = state.maxFloors;
    const groundY = top * k;                       // the line under floor 1
    g.fillStyle = palette['sky-bottom']; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = palette.soil; g.fillRect(0, groundY, cv.width, cv.height - groundY);
    g.fillStyle = palette.dug; g.fillRect(0, groundY, cv.width, state.dug * k);
    const capY = (top - floorCap(state)) * k;
    g.fillStyle = palette['grid-line']; g.fillRect(0, capY, cv.width, 1);
    for (const st of state.structures) {
      const t = TYPES[st.type];
      g.fillStyle = palette[MAP_TOKEN[st.type] || st.type] || palette.fg;
      g.fillRect(st.col * k, (top - st.floor - t.h + 1) * k, t.w * k, t.h * k);
    }
  }

  // ---- Layout cache ------------------------------------------------------
  function layout(state) {
    const s = state.structures;
    if (lay.ref === s && lay.n === s.length && lay.nid === state.nextId) return lay;
    lay.ref = s; lay.n = s.length; lay.nid = state.nextId;
    lay.grid = buildGrid(state);
    lay.reach = reachable(state, lay.grid);
    lay.info.clear();
    const g = lay.grid;
    const has = (c, f) => g.has(c + ',' + f);
    lay.roofCol = -1; lay.roofFloor = 0; lay.minCol = Infinity; lay.maxCol = -Infinity;
    for (const st of s) {
      const t = TYPES[st.type];
      let topMask = 0;
      for (let dx = 0; dx < t.w; dx++) if (!has(st.col + dx, st.floor + t.h)) topMask |= 1 << dx;
      lay.minCol = Math.min(lay.minCol, st.col); lay.maxCol = Math.max(lay.maxCol, st.col + t.w - 1);
      if (topMask && st.floor + t.h - 1 > lay.roofFloor) {
        lay.roofFloor = st.floor + t.h - 1;
        let dx = 0; while (!(topMask & (1 << dx))) dx++;
        lay.roofCol = st.col + dx;
      }
      let l = st.col, r = st.col + t.w - 1;
      while (has(l - 1, st.floor)) l--;
      while (has(r + 1, st.floor)) r++;
      lay.info.set(st.id, {
        topMask,
        leftOpen: !has(st.col - 1, st.floor), rightOpen: !has(st.col + t.w, st.floor),
        corrL: l, corrR: r,
      });
    }
    // Contiguous lift shafts (standard or express), for the upkeep floats. Their cars live in state.transit.
    lay.shafts.length = 0;
    for (const sh of shaftsOf(state, g)) lay.shafts.push({ col: sh.col, lo: sh.lo, hi: sh.hi, type: sh.type });
    return lay;
  }

  // ---- Events from the game ----------------------------------------------
  function onPlaced(state, st) {
    const t = TYPES[st.type];
    placing.set(st.id, performance.now());
    const x0 = st.col * CELL_W, x1 = (st.col + t.w) * CELL_W, y = (state.maxFloors - st.floor + 1) * CELL_H;
    spawnDust(x0, x1, y, 10, false);
  }
  function onDemolished(state, st) {
    const t = TYPES[st.type];
    const x0 = st.col * CELL_W, x1 = (st.col + t.w) * CELL_W, y = (state.maxFloors - st.floor + 1) * CELL_H;
    spawnDust(x0, x1, y, 14, true);
    placing.delete(st.id);
  }
  function spawnDust(x0, x1, y, n, heavy) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const d = dust.find(p => !p.on); if (!d) return;
      const u = (i + 0.5) / n;
      d.on = true; d.x = lerp(x0, x1, u); d.y = y - 1; d.t0 = now; d.dur = DUST_MS + hash01(i, n) * 160;
      d.vx = (u - 0.5) * (heavy ? 40 : 22); d.vy = -(10 + hash01(i, 7) * (heavy ? 26 : 14));
      d.r = heavy ? 3 + hash01(i, 3) * 3 : 2 + hash01(i, 3) * 2; d.warm = !heavy;
    }
  }
  // After each sim tick: income floats near the units that earned, upkeep at shafts.
  function onTick(state) {
    const now = performance.now();
    const L = layout(state);
    let emitted = 0, idx = 0;
    const n = state.structures.length;
    for (let k = 0; k < n && emitted < MAX_FLOATS_PER_TICK; k++) {
      const st = state.structures[(k + floatCursor) % n];
      const t = TYPES[st.type];
      if (t.kind !== 'unit' || !st.occupied || !L.reach.has(st.id)) continue;
      const take = takeOf(state, st);
      if (take <= 0) continue;
      pushFloat((st.col + t.w / 2) * CELL_W, (state.maxFloors - st.floor) * CELL_H + 4, '+$' + take, false, now, idx++);
      emitted++;
    }
    floatCursor = (floatCursor + MAX_FLOATS_PER_TICK) % Math.max(1, n);
    for (const sh of L.shafts) {
      const up = TYPES[sh.type].upkeep * (sh.hi - sh.lo + 1);
      pushFloat((sh.col + 0.5) * CELL_W, (state.maxFloors - sh.hi) * CELL_H + 4, '-$' + up, true, now, idx++);
    }
  }
  function pushFloat(x, y, text, neg, now, stagger) {
    const f = floats.find(p => !p.on); if (!f) return;
    f.on = true; f.x = x; f.y = y; f.text = text; f.neg = neg; f.t0 = now + stagger * 40;
  }
  function reset() {
    placing.clear(); walkers.clear(); walkerList.length = 0; walkerSig = '';
    for (const d of dust) d.on = false;
    for (const f of floats) f.on = false;
    lay.ref = null;
    nameFits.clear();
  }

  // ---- Frame --------------------------------------------------------------
  function draw(state, view, now, phase) {
    const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
    lastFrame = now;
    const reduced = prefersReducedMotion();
    const night = 1 - daylight(state, phase);
    const weather = view.weather || 'clear';
    updateTones(night, weather);
    setFestivals(view.festivals);
    sway = reduced ? 0 : weather === 'wind' ? WIND_SWAY_PX : weather === 'rain' || weather === 'snow' ? WIND_SWAY_PX * 0.35 : 0;
    frameNow = now; frameReduced = reduced;
    debug.weather = weather; debug.particles = 0; debug.sled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const L = layout(state);
    const groundY = sy(worldH(state));
    drawBackground(state, groundY, now, reduced);
    drawBasement(state, view);

    // Faint floor lines and plot edges inside the plot only.
    const left = sx(0), right = sx(worldW(state));
    const cap = floorCap(state);
    const capY = Math.round(sy((state.maxFloors - cap) * CELL_H)) + 0.5;
    ctx.strokeStyle = palette['grid-line'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let f = 1; f <= state.maxFloors; f++) {
      const y = Math.round(sy((state.maxFloors - f) * CELL_H)) + 0.5;
      if (y < -2 || y > groundY) continue;
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    ctx.stroke();
    ctx.setLineDash([2, 6]);
    const plotTop = Math.max(0, capY);
    ctx.beginPath(); ctx.moveTo(left + 0.5, plotTop); ctx.lineTo(left + 0.5, groundY); ctx.moveTo(right - 0.5, plotTop); ctx.lineTo(right - 0.5, groundY); ctx.stroke();
    // The height cap: more floors open as the stars rise.
    if (cap < state.maxFloors && capY > 0 && capY < height) {
      ctx.strokeStyle = palette.muted; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(left, capY); ctx.lineTo(right, capY); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Floor numbers every five floors, outside the left edge.
    if (cam.zoom >= 0.8 && left > 18) {
      ctx.fillStyle = palette.muted; ctx.font = `${Math.round(10 * Math.min(1.4, cam.zoom))}px system-ui, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let f = 5; f <= state.maxFloors; f += 5) {
        const y = sy((state.maxFloors - f + 0.5) * CELL_H);
        if (y < 0 || y > groundY) continue;
        ctx.fillText(String(f), left - 6, y);
      }
      for (let f = 0; f >= LOWEST_FLOOR; f--) {                    // B1..B5
        const y = sy((state.maxFloors - f + 0.5) * CELL_H);
        if (y > 0 && y < height) ctx.fillText('B' + (1 - f), left - 6, y);
      }
    }
    // Car-park bays fill in structure order, as the sim hands out spaces.
    parkLeft = 0;
    for (const v of state.perks.values()) if (v[0] === 'parking') parkLeft++;

    // Structures, culled to the viewport.
    for (const st of state.structures) {
      const t = TYPES[st.type];
      const r = rectOf(state, st.col, st.floor, t.w, t.h);
      if (r.x > width || r.x + r.w < 0 || r.y > height || r.y + r.h < 0) { placing.delete(st.id); continue; }
      const p0 = placing.get(st.id);
      if (p0 !== undefined) {
        const p = (now - p0) / PLACE_MS;
        if (p >= 1 || reduced) { placing.delete(st.id); }
        else {
          const k = easeOutBack(p);
          const s = 0.6 + 0.4 * k;
          ctx.save();
          ctx.translate(r.x + r.w / 2, r.y + r.h);
          ctx.scale(s, s);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h));
          ctx.globalAlpha = 0.5 + 0.5 * easeOutCubic(p);
          drawStructure(state, st, L, r, now);
          ctx.restore();
          continue;
        }
      }
      drawStructure(state, st, L, r, now);
    }

    // Fraction of the current agent sub-step that has elapsed: cars glide through it.
    const stepFrac = reduced ? 1 : clamp01(phase * WALK_STEPS - (walkerStepsDone(state) - 1));
    drawLiftCars(state, stepFrac);
    drawWalkers(state, L, dt, reduced);
    drawQueues(state);
    drawDust(now, reduced);
    if (fest.merdeka) drawFlag(state, L);
    if (weather === 'fog') drawFog(groundY);
    drawSeasonSky(state, L, groundY, now, dt, phase, reduced, view.fireworks);
    if (!reduced && (weather === 'rain' || weather === 'snow')) drawPrecip(weather, groundY, dt, now);
    drawFloats(now, reduced);

    if (view.selected) {
      const st = state.structures.find(x => x.id === view.selected);
      if (st) selectionBox(rectOf(state, st.col, st.floor, TYPES[st.type].w, TYPES[st.type].h), now, reduced);
    }
    if (view.hover && view.tool && TYPES[view.tool]) {
      const t = TYPES[view.tool];
      const ok = canPlace(state, view.tool, view.hover.col, view.hover.floor, L.grid).ok;
      const r = rectOf(state, view.hover.col, view.hover.floor, t.w, t.h);
      ctx.fillStyle = ok ? palette['ghost-ok'] : palette['ghost-bad'];
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = ok ? palette.good : palette.danger; ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    if (view.draft) drawDraft(state, view.draft);
  }

  // The placement draft (G-43): a translucent outline with its cost on the cell.
  let draftRef = null, draftLabel = '';
  function drawDraft(state, d) {
    const t = TYPES[d.tool];
    if (!t) return;
    const r = rectOf(state, d.col, d.floor, t.w, t.h);
    if (r.x > width || r.x + r.w < 0 || r.y > height || r.y + r.h < 0) return;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = palette[d.tool] || palette['ghost-ok'];
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.fg; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.setLineDash([]);
    if (draftRef !== d) { draftRef = d; draftLabel = '$' + d.cost.toLocaleString(); }
    ctx.font = `600 ${Math.round(Math.max(9, Math.min(14, 10 * cam.zoom)))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cx = r.x + r.w / 2, cy = r.y + Math.min(r.h, CELL_H * cam.zoom) / 2;
    const tw = ctx.measureText(draftLabel).width + 8;
    ctx.fillStyle = palette['float-bg'] || 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx - tw / 2, cy - 8, tw, 16);
    ctx.fillStyle = palette.fg;
    ctx.fillText(draftLabel, cx, cy);
  }

  // ---- Basement: code-drawn soil, dug levels, the next level to dig ------
  let parkLeft = 0;   // car-park spaces still to draw this frame
  function drawBasement(state, view) {
    const z = cam.zoom, left = sx(0), w = worldW(state) * z, cw = CELL_W * z, ch = CELL_H * z;
    for (let f = 0; f >= LOWEST_FLOOR; f--) {
      const y = sy((state.maxFloors - f) * CELL_H);
      if (y > height || y + ch < 0) continue;
      const dug = f >= 1 - state.dug;
      ctx.fillStyle = dug ? palette.dug : palette.soil;
      ctx.fillRect(left, y, w, ch);
      ctx.fillStyle = dug ? 'rgba(0,0,0,0.16)' : palette['soil-dark'];
      if (dug) {
        // Excavated: a footing strip and a pillar every four cells.
        ctx.fillRect(left, y + ch - 3 * z, w, 3 * z);
        for (let c = 0; c <= state.width; c += 4) ctx.fillRect(left + c * cw - z, y, 2 * z, ch);
      } else if (z >= 0.7) {
        // Soil: two pebbles per cell at fixed, hashed spots.
        for (let c = 0; c < state.width; c++) {
          for (let k = 0; k < 2; k++) {
            ctx.fillRect(left + (c + hash01(c, f * 7 + k)) * cw, y + (0.15 + 0.7 * hash01(c, f * 7 + k + 3)) * ch, 2.5 * z, 2 * z);
          }
        }
      }
    }
    // While the dig tool is chosen, outline the one level that can be dug next.
    if (view.tool === 'dig' && state.dug < BASEMENT_LEVELS) {
      const y = sy((state.maxFloors + state.dug) * CELL_H);
      ctx.strokeStyle = palette.good; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(left + 1, y + 1, w - 2, ch - 2);
      ctx.setLineDash([]);
    }
  }

  // ---- Background: cached sky, stars, distant skyline and ground ---------
  function drawBackground(state, groundY, now, reduced) {
    const par = Math.round(cam.x * 0.25 * cam.zoom);
    const key = `${toneKey}|${Math.round(groundY)}|${par}|${width}x${height}|${cam.zoom.toFixed(2)}`;
    if (key !== bgKey) { bgKey = key; paintBackground(state, groundY, par); }
    ctx.drawImage(bg, 0, 0, width, height);
    // A few live twinkling stars over the cached field.
    const n = tones.night;
    if (n > 0.4 && !reduced) {
      ctx.fillStyle = `rgba(255,255,255,${((n - 0.4) * 1.4).toFixed(2)})`;
      for (let i = 0; i < 14; i++) {
        const x = hash01(i, 11) * width, y = hash01(i, 12) * Math.min(height * 0.55, groundY);
        const tw = 0.5 + 0.5 * Math.sin(now / 600 + i * 1.7);
        ctx.fillRect(x, y, 1.5 + tw, 1.5 + tw);
      }
    }
    // Street lamps along the plot glow at night (live so they fade smoothly).
    if (n > 0.3) {
      const glow = smoothstep(0.3, 0.6, n);
      for (let c = 2; c < state.width; c += 6) {
        const x = sx(c * CELL_W), top = groundY - 14 * cam.zoom;
        if (x < -20 || x > width + 20) continue;
        ctx.fillStyle = tones.kerb;
        ctx.fillRect(x - 0.5 * cam.zoom, top, Math.max(1, cam.zoom), 14 * cam.zoom);
        ctx.globalAlpha = glow * 0.9;
        ctx.fillStyle = tones.lamp;
        ctx.beginPath(); ctx.arc(x, top, 1.8 * cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = glow * 0.12;
        const gx = sway ? x + sway * cam.zoom * Math.sin(now / 420 + c) : x;   // the glow sways in wind
        ctx.beginPath(); ctx.arc(gx, top, 9 * cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function paintBackground(state, groundY, par) {
    const g = bgx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = tones.night;
    const sky = g.createLinearGradient(0, 0, 0, Math.max(1, groundY));
    sky.addColorStop(0, tones.skyTop);
    sky.addColorStop(0.65, tones.skyBottom);
    sky.addColorStop(1, mix(tones.skyBottom, tones.horizon, tones.dusk * 0.75));
    g.fillStyle = sky;
    g.fillRect(0, 0, width, height);
    // Star field (static; the live pass adds a few twinklers).
    if (n > 0.3) {
      g.fillStyle = `rgba(255,255,255,${((n - 0.3) * 1.1).toFixed(2)})`;
      for (let i = 0; i < 90; i++) {
        const x = hash01(i, 1) * width, y = hash01(i, 2) * Math.min(height * 0.6, groundY);
        const s = 0.8 + hash01(i, 3) * 1.4;
        g.fillRect(x, y, s, s);
      }
      // Moon.
      const mx = width * 0.82, my = Math.min(groundY * 0.22, 70);
      g.globalAlpha = smoothstep(0.35, 0.7, n);
      g.fillStyle = '#fff4d6';
      g.beginPath(); g.arc(mx, my, 11, 0, Math.PI * 2); g.fill();
      // The crescent cut takes the sky colour at that height so it vanishes.
      g.fillStyle = mix(tones.skyTop, tones.skyBottom, Math.min(1, my / (Math.max(1, groundY) * 0.65)));
      g.beginPath(); g.arc(mx - 6, my - 4, 9.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,244,214,0.07)';
      g.beginPath(); g.arc(mx, my, 24, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    } else if (tones.dusk > 0.15 && n < 0.5) {
      // Low sun at dawn/dusk.
      g.globalAlpha = tones.dusk * 0.9;
      g.fillStyle = 'rgba(255,196,120,0.18)';
      g.beginPath(); g.arc(width * 0.2, groundY - 30, 44, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd9a0';
      g.beginPath(); g.arc(width * 0.2, groundY - 30, 13, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    // Distant skyline. Far layer: the generated art, tiled twice for a seamless
    // parallax scroll. Near layer: code-drawn, with lit windows at night.
    const artFar = skylineReady();
    if (artFar) {
      const sh = width * skylineImg.naturalHeight / skylineImg.naturalWidth;
      const p = (par * 0.3) % width;
      const ox = -(p < 0 ? p + width : p);
      g.globalAlpha = 0.9;
      g.drawImage(skylineImg, ox, groundY - sh, width, sh);
      g.drawImage(skylineImg, ox + width, groundY - sh, width, sh);
      g.globalAlpha = 1;
    }
    for (let depth = artFar ? 1 : 0; depth < 2; depth++) {
      const scale = depth ? 1 : 0.6;
      const px = par * (depth ? 1 : 0.5);
      g.fillStyle = depth ? tones.skyline : mix(tones.skyline, tones.skyBottom, 0.45);
      let x = -((px % 140) + 140) % 140 - 60;
      let i = 0;
      while (x < width + 60) {
        const idx = Math.floor((x + px) / 140) * 7 + depth * 101;
        const bw = 26 + hash01(idx, 4) * 40, bh = (30 + hash01(idx, 5) * 110) * scale * Math.min(1.3, cam.zoom);
        const top = groundY - bh;
        g.fillRect(x, top, bw, bh + 2);
        if (hash01(idx, 6) > 0.6) g.fillRect(x + bw * 0.3, top - 6 * scale, bw * 0.4, 6 * scale); // roof box
        if (n > 0.35 && depth) {
          g.fillStyle = `rgba(255,214,140,${(0.55 * smoothstep(0.35, 0.7, n)).toFixed(2)})`;
          const cols = Math.floor(bw / 7), rows = Math.floor(bh / 9);
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (hash01(idx * 131 + r * 17 + c, 9) > 0.55) g.fillRect(x + 3 + c * 7, top + 4 + r * 9, 2.5, 3.5);
          g.fillStyle = tones.skyline;
        }
        x += bw + 6 + hash01(idx, 8) * 20;
        if (++i > 80) break;
      }
    }
    // Ground: pavement, kerb, soil.
    const gh = Math.max(0, height - groundY);
    g.fillStyle = tones.ground;
    g.fillRect(0, groundY, width, gh);
    g.fillStyle = tones.groundDark;
    g.fillRect(0, groundY + 8 * cam.zoom, width, gh);
    g.fillStyle = tones.kerb;
    g.fillRect(0, groundY - 1, width, 2);
    g.fillRect(0, groundY + 8 * cam.zoom - 1, width, 1);
  }

  // ---- Structures ---------------------------------------------------------
  function drawStructure(state, st, L, r, now) {
    const t = TYPES[st.type];
    const z = cam.zoom;
    const info = L.info.get(st.id);
    const isReachable = L.reach.has(st.id);
    const warm = tones.warm;
    switch (st.type) {
      case 'lobby': {
        ctx.fillStyle = tones.lobby;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // Tall glass front with a door frame, lit warmly at night.
        const lit = warm * 0.95;
        ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
        ctx.fillRect(r.x + 3 * z, r.y + 7 * z, r.w - 6 * z, r.h - 7 * z);
        ctx.fillStyle = tones.wall;
        ctx.fillRect(r.x + r.w / 2 - 0.5 * z, r.y + 7 * z, Math.max(1, z), r.h - 7 * z); // door split
        // Canopy.
        ctx.fillStyle = tones.wall;
        ctx.fillRect(r.x, r.y + 4 * z, r.w, 2.5 * z);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(r.x, r.y + 4 * z, r.w, 1 * z);
        if (decorOn && st.col % 2 === 0) drawLobbyDecor(r.x + r.w / 2, r.y + 6.5 * z, z, st.col);
        break;
      }
      case 'stairs': {
        ctx.fillStyle = tones.stairs;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // Two flights of five treads with a half landing, drawn as stepped
        // profiles so they read as stairs at phone zoom.
        const x0 = r.x + 2 * z, x1 = r.x + r.w - 2 * z, steps = 5;
        const sw = (x1 - x0) / steps, sh = (r.h / 2 - 3 * z) / steps;
        const flight = (fromX, baseY, dir, fill) => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.moveTo(fromX, baseY);
          for (let i = 0; i < steps; i++) {
            ctx.lineTo(fromX + dir * i * sw, baseY - (i + 1) * sh);
            ctx.lineTo(fromX + dir * (i + 1) * sw, baseY - (i + 1) * sh);
          }
          ctx.lineTo(fromX + dir * steps * sw, baseY);
          ctx.closePath(); ctx.fill();
        };
        flight(x0, r.y + r.h - 2 * z, 1, 'rgba(255,255,255,0.42)');
        flight(x1, r.y + r.h / 2 - 1 * z, -1, 'rgba(255,255,255,0.3)');
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(r.x, r.y + r.h / 2 - 1.5 * z, r.w, 2 * z); // landing slab
        ctx.fillRect(x0, r.y + 3 * z, Math.max(1, z), r.h / 2 - 4 * z); // newel post
        break;
      }
      case 'elevator': case 'express': case 'servicelift': {
        ctx.fillStyle = st.type === 'express' ? tones.express : st.type === 'servicelift' ? tones.servicelift : tones.shaft;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // Guide rails and a floor marker.
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(r.x + r.w * 0.22, r.y, Math.max(1, z), r.h);
        ctx.fillRect(r.x + r.w * 0.78 - z, r.y, Math.max(1, z), r.h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(r.x + 2 * z, r.y + r.h - 2 * z, r.w - 4 * z, 1.5 * z);
        if (st.type === 'express') {
          // Double chevron: this shaft skips floors.
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = Math.max(1, 1.5 * z);
          for (const dy of [0, 5 * z]) {
            ctx.beginPath();
            ctx.moveTo(r.x + r.w * 0.3, r.y + r.h * 0.5 + dy); ctx.lineTo(r.x + r.w * 0.5, r.y + r.h * 0.5 + dy - 4 * z); ctx.lineTo(r.x + r.w * 0.7, r.y + r.h * 0.5 + dy);
            ctx.stroke();
          }
        }
        if (st.type === 'servicelift') {
          // Hazard stripes across the door: staff only.
          ctx.fillStyle = 'rgba(246,183,60,0.75)';
          for (let i = 0; i < 3; i++) ctx.fillRect(r.x + 2 * z, r.y + r.h * (0.3 + i * 0.16), r.w - 4 * z, 2 * z);
        }
        break;
      }
      case 'housekeeping': case 'clinic': case 'plant': {
        ctx.fillStyle = tones[st.type];
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = winTone[Math.round(warm * 0.8 * (winTone.length - 1))];
        ctx.fillRect(r.x + 3 * z, r.y + 7 * z, r.w * 0.45 - 4 * z, r.h - 14 * z);
        const bx = r.x + r.w * 0.74, by = r.y + r.h * 0.45, u = 3 * z;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        if (st.type === 'clinic') {
          ctx.fillStyle = '#d64545';                                   // red cross
          ctx.fillRect(bx - u, by - u / 3, 2 * u, u * 0.7); ctx.fillRect(bx - u / 3, by - u, u * 0.7, 2 * u);
        } else if (st.type === 'plant') {
          ctx.beginPath(); ctx.arc(bx, by, u * 1.2, 0, Math.PI * 2); ctx.fill();   // a pump with pipes
          ctx.fillRect(r.x + r.w * 0.5, by - z / 2, r.w * 0.45, Math.max(1, z));
          ctx.fillStyle = tones.plant; ctx.beginPath(); ctx.arc(bx, by, u * 0.5, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath();                                             // a bucket
          ctx.moveTo(bx - u, by - u / 2); ctx.lineTo(bx + u, by - u / 2); ctx.lineTo(bx + u * 0.7, by + u); ctx.lineTo(bx - u * 0.7, by + u);
          ctx.closePath(); ctx.fill();
        }
        if (!isReachable) hatch(r);
        break;
      }
      case 'parking': {
        ctx.fillStyle = palette.parking;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const n = t.spaces, bw = r.w / n;
        let cars = isReachable ? Math.min(n, parkLeft) : 0;
        parkLeft -= cars;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 1; i < n; i++) ctx.fillRect(r.x + i * bw - 0.5 * z, r.y + r.h * 0.45, Math.max(1, z), r.h * 0.5);  // bay lines
        for (let i = 0; i < n && cars > 0; i++, cars--) {
          ctx.fillStyle = SHIRTS[(st.id + i) % SHIRTS.length];
          ctx.fillRect(r.x + i * bw + bw * 0.15, r.y + r.h * 0.55, bw * 0.7, r.h * 0.28);
          ctx.fillRect(r.x + i * bw + bw * 0.28, r.y + r.h * 0.42, bw * 0.44, r.h * 0.16);
        }
        if (!isReachable) hatch(r);
        break;
      }
      case 'transit': {
        ctx.fillStyle = palette.transit;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(r.x, r.y + r.h - 6 * z, r.w, 4 * z);                // track bed
        ctx.fillStyle = 'rgba(255,255,255,0.8)';                          // train with lit windows
        roundRect(r.x + r.w * 0.12, r.y + r.h * 0.3, r.w * 0.7, r.h * 0.48, 3 * z); ctx.fill();
        ctx.fillStyle = winTone[winTone.length - 1];
        for (let i = 0; i < 6; i++) ctx.fillRect(r.x + r.w * (0.16 + i * 0.11), r.y + r.h * 0.38, r.w * 0.07, r.h * 0.16);
        if (!isReachable) hatch(r);
        break;
      }
      case 'security': {
        ctx.fillStyle = tones.security;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // One wide window with a shield badge beside the door.
        ctx.fillStyle = winTone[Math.round(warm * 0.8 * (winTone.length - 1))];
        ctx.fillRect(r.x + 3 * z, r.y + 7 * z, r.w * 0.5 - 4 * z, r.h - 14 * z);
        const bx = r.x + r.w * 0.72, by = r.y + r.h * 0.42, bw = 6 * z;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(bx - bw / 2, by - bw * 0.6); ctx.lineTo(bx + bw / 2, by - bw * 0.6);
        ctx.lineTo(bx + bw / 2, by + bw * 0.2); ctx.lineTo(bx, by + bw * 0.8); ctx.lineTo(bx - bw / 2, by + bw * 0.2);
        ctx.closePath(); ctx.fill();
        if (!isReachable) hatch(r);
        break;
      }
      case 'escalator': {
        ctx.fillStyle = tones.escalator;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // One diagonal step band from the lower floor up to the upper one, with treads.
        const x0 = r.x + 3 * z, x1 = r.x + r.w - 3 * z, y0 = r.y + r.h - 3 * z, y1 = r.y + r.h / 2 - 3 * z;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(2, 4 * z);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(1, z);
        ctx.beginPath();
        for (let i = 1; i < 8; i++) { const u = i / 8, x = lerp(x0, x1, u), y = lerp(y0, y1, u); ctx.moveTo(x - 1.5 * z, y - 1.5 * z); ctx.lineTo(x + 1.5 * z, y + 1.5 * z); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(r.x, r.y + r.h / 2 - 1.5 * z, r.w * 0.3, 2 * z);                 // upper landing
        break;
      }
      case 'floor': {
        // A bare slab: a concrete band and a dashed outline of the room to come.
        ctx.fillStyle = tones.slab;
        ctx.fillRect(r.x, r.y + r.h - 4 * z, r.w, 4 * z);
        ctx.strokeStyle = tones.slab; ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 4 * z - 2);
        ctx.setLineDash([]);
        return;
      }
      case 'office': case 'shop': case 'flat': case 'food': case 'hotel': case 'hall': {
        const vacant = !st.occupied;
        // A let unit wears its tenant's business (G-37); a vacant one stays the plain "to let" shell.
        const biz = vacant ? null : tenantOf(st);
        const bt = biz ? bizTone(st.type, biz) : null;
        ctx.fillStyle = bt ? bt.tint : tones[st.type];
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (st.type === 'office') {
          // Tall windows behind a thin mullion grid, in the business's pattern.
          const [per, glaze, top, inset] = OFFICE_WINDOWS[biz ? biz.windows : 'grid'];
          const n = t.w * per, ww = r.w / n, gx = (1 - glaze) / 2;
          for (let i = 0; i < n; i++) {
            const lit = vacant ? 0 : smoothstep(hash01(st.id, i) * 0.6, hash01(st.id, i) * 0.6 + 0.25, warm);
            ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
            ctx.fillRect(r.x + i * ww + ww * gx, r.y + top * z, ww * glaze, r.h - inset * z);
          }
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          for (let i = 0; i < n; i++) ctx.fillRect(r.x + i * ww + ww * gx, r.y + top * z, ww * glaze, Math.max(1, z)); // sill highlight
          if (biz) {
            drawGlyph(biz.glyph, r.x + 8 * z, r.y + r.h - 10 * z, z, bt.accent);
            drawName(st, r.x + 3 * z, r.y + 3 * z, r.w - 12 * z, z);
          }
        } else if (st.type === 'shop') {
          // Awning, wide display window, door and a sign strip; the awning style is the business's.
          const lit = vacant ? 0 : smoothstep(0.1, 0.5, warm);
          ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
          ctx.fillRect(r.x + 3 * z, r.y + 11 * z, r.w * 0.6, r.h - 13 * z);
          ctx.fillRect(r.x + r.w * 0.7, r.y + 11 * z, r.w * 0.22, r.h - 11 * z); // door
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(r.x + 3 * z, r.y + 7 * z, r.w - 6 * z, 3 * z); // sign strip
          const awning = biz ? biz.awning : 'stripe';
          if (awning === 'stripe') {
            const scallops = t.w * 4, sw = r.w / scallops;
            for (let i = 0; i < scallops; i++) {
              ctx.fillStyle = i % 2 ? tones.awning : bt ? bt.accent : tones.shop;
              ctx.fillRect(r.x + i * sw, r.y + 2 * z, sw, 6 * z);
              ctx.beginPath(); ctx.arc(r.x + (i + 0.5) * sw, r.y + 8 * z, sw / 2, 0, Math.PI); ctx.fill();
            }
          } else if (awning === 'flat') {
            ctx.fillStyle = bt.accent;
            ctx.fillRect(r.x, r.y + 2 * z, r.w, 6 * z);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(r.x, r.y + 7 * z, r.w, Math.max(1, z));
          } else if (awning === 'noren') {
            // A rod with split cloth panels hanging over the door and window.
            ctx.fillStyle = tones.wall;
            ctx.fillRect(r.x + 2 * z, r.y + 2 * z, r.w - 4 * z, 1.5 * z);
            ctx.fillStyle = bt.accent;
            const pw = (r.w - 6 * z) / 4;
            for (let i = 0; i < 4; i++) ctx.fillRect(r.x + 3 * z + i * pw + 0.5 * z, r.y + 3.5 * z, pw - z, 9 * z);
          }
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(r.x, r.y + 2 * z, r.w, 1 * z);
          if (biz) {
            drawGlyph(biz.glyph, r.x + 3 * z + r.w * 0.3, r.y + 22 * z, z, bt.accent);
            if (z >= NAME_ZOOM) {
              ctx.fillStyle = 'rgba(0,0,0,0.55)';
              ctx.fillRect(r.x + 2 * z, r.y + 12 * z, r.w - 4 * z, 5.5 * z);
              drawName(st, r.x + 3.5 * z, r.y + 14.8 * z, r.w - 7 * z, z);
            }
          }
        } else if (st.type === 'food') {
          // Food court: a lit serving counter along the back and three round tables.
          const lit = vacant ? 0 : smoothstep(0.05, 0.45, warm);
          ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
          ctx.fillRect(r.x + 3 * z, r.y + 6 * z, r.w - 6 * z, r.h * 0.32);
          ctx.fillStyle = bt ? bt.accent : 'rgba(0,0,0,0.22)';
          ctx.fillRect(r.x + 3 * z, r.y + 6 * z + r.h * 0.32, r.w - 6 * z, 2 * z);   // counter edge
          ctx.fillStyle = tones.wall;
          for (let i = 0; i < 3; i++) {
            const tx = r.x + r.w * (0.2 + i * 0.3), ty = r.y + r.h * 0.72;
            ctx.fillRect(tx - 4 * z, ty, 8 * z, 1.5 * z);
            ctx.fillRect(tx - 0.5 * z, ty, Math.max(1, z), r.h * 0.2);
          }
          if (biz) {
            drawGlyph(biz.glyph, r.x + r.w - 9 * z, r.y + 6 * z + r.h * 0.16, z, bt.accent);
            drawName(st, r.x + 3 * z, r.y + 3 * z, r.w - 10 * z, z);
          }
        } else if (st.type === 'hotel') {
          // Hotel room: a window and a bed, lit while guests are in.
          const lit = vacant ? 0 : smoothstep(0.1, 0.5, warm);
          ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
          ctx.fillRect(r.x + r.w * 0.08, r.y + 6 * z, r.w * 0.3, r.h * 0.45);
          ctx.fillStyle = biz ? biz.spread : 'rgba(255,255,255,0.7)';
          ctx.fillRect(r.x + r.w * 0.48, r.y + r.h * 0.6, r.w * 0.44, r.h * 0.18);            // mattress
          ctx.fillStyle = tones.wall;
          ctx.fillRect(r.x + r.w * 0.46, r.y + r.h * 0.42, 2 * z, r.h * 0.4);                 // headboard
          if (st.dirty) {
            // Dirty: unmade sheets and a stain until housekeeping calls.
            ctx.fillStyle = 'rgba(120,78,32,0.55)';
            ctx.fillRect(r.x + r.w * 0.55, r.y + r.h * 0.56, r.w * 0.2, r.h * 0.1);
            ctx.beginPath(); ctx.arc(r.x + r.w * 0.22, r.y + r.h * 0.8, 2.2 * z, 0, Math.PI * 2); ctx.fill();
          }
        } else if (st.type === 'hall') {
          // Event hall: a curtained stage, lit while an event runs.
          const on = (state.crowds[st.id] || 0) > 0;
          ctx.fillStyle = winTone[Math.round((on ? 1 : vacant ? 0 : 0.3 * warm) * (winTone.length - 1))];
          ctx.fillRect(r.x + r.w * 0.25, r.y + 6 * z, r.w * 0.5, r.h * 0.5);
          ctx.fillStyle = biz ? biz.curtain : 'rgba(150,30,40,0.8)';
          ctx.fillRect(r.x + r.w * 0.2, r.y + 5 * z, r.w * 0.08, r.h * 0.55);
          ctx.fillRect(r.x + r.w * 0.72, r.y + 5 * z, r.w * 0.08, r.h * 0.55);
          ctx.fillStyle = tones.wall;
          for (let i = 0; i < 10; i++) ctx.fillRect(r.x + r.w * (0.06 + i * 0.09), r.y + r.h * 0.74, r.w * 0.05, r.h * 0.12); // seats
          if (biz) drawName(st, r.x + 3 * z, r.y + 2.6 * z, r.w - 10 * z, z);
        } else {
          // Flat: two windows with curtains and a balcony rail.
          const ww = r.w * 0.22;
          for (let i = 0; i < 2; i++) {
            const lit = vacant ? 0 : smoothstep(hash01(st.id, i + 9) * 0.5, hash01(st.id, i + 9) * 0.5 + 0.3, warm);
            const wx = r.x + r.w * (0.1 + i * 0.5);
            ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
            ctx.fillRect(wx, r.y + 6 * z, ww, r.h * 0.5);
            ctx.fillStyle = biz ? biz.curtain : 'rgba(255,255,255,0.45)';
            ctx.fillRect(wx, r.y + 6 * z, ww * 0.22, r.h * 0.5);          // curtain
            ctx.fillRect(wx + ww * 0.78, r.y + 6 * z, ww * 0.22, r.h * 0.5);
          }
          ctx.fillStyle = tones.wall;
          const by = r.y + r.h * 0.62;
          ctx.fillRect(r.x + 2 * z, by, r.w - 4 * z, 1.5 * z);
          for (let i = 0; i <= 8; i++) ctx.fillRect(r.x + 2 * z + (r.w - 4 * z) * (i / 8) - 0.5 * z, by, Math.max(1, z), r.h * 0.3);
          // The household's balcony item: a pot plant, a bicycle or the washing.
          const extra = biz ? biz.extra : 'none';
          if (extra === 'plant') {
            ctx.fillStyle = tones.wall; ctx.fillRect(r.x + r.w * 0.82, by - 2.5 * z, 3 * z, 2.5 * z);
            ctx.fillStyle = bt.accent; ctx.beginPath(); ctx.arc(r.x + r.w * 0.82 + 1.5 * z, by - 4.5 * z, 2.6 * z, 0, Math.PI * 2); ctx.fill();
          } else if (extra === 'bike') {
            ctx.strokeStyle = bt.accent; ctx.lineWidth = Math.max(1, z);
            ctx.beginPath();
            ctx.arc(r.x + r.w * 0.66, by - 2.6 * z, 2.2 * z, 0, Math.PI * 2);
            ctx.moveTo(r.x + r.w * 0.66 + 8.6 * z, by - 2.6 * z); ctx.arc(r.x + r.w * 0.66 + 6.4 * z, by - 2.6 * z, 2.2 * z, 0, Math.PI * 2);
            ctx.moveTo(r.x + r.w * 0.66, by - 2.6 * z); ctx.lineTo(r.x + r.w * 0.66 + 3.2 * z, by - 5 * z); ctx.lineTo(r.x + r.w * 0.66 + 6.4 * z, by - 2.6 * z);
            ctx.stroke();
          } else if (extra === 'laundry') {
            ctx.fillStyle = tones.wall; ctx.fillRect(r.x + r.w * 0.36, r.y + 7 * z, r.w * 0.24, Math.max(1, 0.6 * z));
            ctx.fillStyle = bt.accent;
            for (let i = 0; i < 3; i++) ctx.fillRect(r.x + r.w * (0.38 + i * 0.07), r.y + 7.5 * z, 2.2 * z, (3 + (i % 2) * 1.5) * z);
          }
        }
        if (vacant) {
          // A vacant unit reads as a dim, unlit shell with a small "to let" card.
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillRect(r.x + r.w / 2 - 3 * z, r.y + r.h - 9 * z, 6 * z, 4 * z);
        }
        if (!isReachable) hatch(r);
        else if (!vacant) {
          // Happiness badge: a small dot in the top-right corner, good/fair/poor.
          const band = happyBand(st.happy);
          ctx.fillStyle = band === 'good' ? palette.good : band === 'fair' ? palette.warn : palette.danger;
          ctx.beginPath(); ctx.arc(r.x + r.w - 4 * z, r.y + 4 * z, 2 * z, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
    }
    // Shared architecture: floor slab, top highlight, exposed sides and roofs.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(r.x, r.y + r.h - 2 * z, r.w, 2 * z);                 // floor slab
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(r.x, r.y, r.w, Math.max(1, z));                      // ceiling highlight
    if (info) {
      if (info.rightOpen) { ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.fillRect(r.x + r.w - 2.5 * z, r.y, 2.5 * z, r.h); }
      if (info.leftOpen) { ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(r.x, r.y, 1.5 * z, r.h); }
      if (info.topMask) {
        const cw = CELL_W * z;
        for (let dx = 0; dx < t.w; dx++) {
          if (!(info.topMask & (1 << dx))) continue;
          const x = r.x + dx * cw;
          ctx.fillStyle = tones.wall;
          ctx.fillRect(x, r.y - 2.5 * z, cw, 2.5 * z);                  // parapet
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillRect(x, r.y - 2.5 * z, cw, Math.max(1, z));
          const k = hash01(st.col + dx, st.floor + 77);
          if (k > 0.72) {                                              // rooftop box or tank
            ctx.fillStyle = tones.wall;
            ctx.fillRect(x + cw * 0.3, r.y - 8 * z, cw * 0.4, 5.5 * z);
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillRect(x + cw * 0.3, r.y - 8 * z, cw * 0.4, Math.max(1, z));
          } else if (k < 0.12) {                                       // aerial (sways in wind)
            ctx.fillStyle = tones.wall;
            if (sway) {
              const ax = x + cw * 0.5, tip = sway * z * Math.sin(now / 380 + st.col + dx);
              ctx.strokeStyle = tones.wall; ctx.lineWidth = Math.max(1, z);
              ctx.beginPath(); ctx.moveTo(ax, r.y - 2.5 * z); ctx.lineTo(ax + tip, r.y - 10 * z); ctx.stroke();
            } else ctx.fillRect(x + cw * 0.5, r.y - 10 * z, Math.max(1, z), 7.5 * z);
          }
          if (decorOn) drawParapetDecor(x, r.y - 2.5 * z, cw, z, st.col + dx);
        }
      }
    }
    ctx.strokeStyle = tones.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  // Diagonal hatching marks a unit with no path from the lobby.
  function hatch(r) {
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.strokeStyle = palette.unreach; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = r.x - r.h; x < r.x + r.w; x += 9) { ctx.moveTo(x, r.y + r.h); ctx.lineTo(x + r.h, r.y); }
    ctx.stroke();
    ctx.restore();
  }

  function selectionBox(r, now, reduced) {
    const pulse = reduced ? 0 : 0.5 + 0.5 * Math.sin(now / 260);
    ctx.strokeStyle = palette.fg; ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]); ctx.lineDashOffset = reduced ? 0 : -now / 40;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255,255,255,${(0.08 + 0.08 * pulse).toFixed(3)})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // ---- Weather and festivals (Sprint 5b, G-40 and G-41) -------------------
  function setFestivals(list) {
    fest.newyear = fest.christmas = fest.cny = fest.raya = fest.deepavali = fest.merdeka = false;
    if (list) for (let i = 0; i < list.length; i++) if (list[i] in fest) fest[list[i]] = true;
    decorOn = fest.christmas || fest.cny || fest.raya || fest.deepavali;
  }

  // Parapet decorations, drawn from the parapet pass (already culled). (x, y) is the parapet's top-left.
  function drawParapetDecor(x, y, cw, z, col) {
    const n = tones.night, live = !frameReduced;
    if (fest.christmas) {
      // String lights: a wire and three bulbs per cell, twinkling at night.
      ctx.fillStyle = tones.wall;
      ctx.fillRect(x, y - 1.2 * z, cw, Math.max(0.6, 0.5 * z));
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.55 + 0.45 * n * (live ? 0.6 + 0.4 * Math.sin(frameNow / 280 + col * 3 + i * 2) : 1);
        ctx.fillStyle = XMAS_BULBS[(col * 3 + i) % XMAS_BULBS.length];
        ctx.fillRect(x + (i + 0.3) * cw / 3, y - 1.8 * z, 1.6 * z, 1.8 * z);
      }
      ctx.globalAlpha = 1;
    }
    if (fest.cny && col % LANTERN_EVERY === 0) drawLantern(x + cw / 2, y - 8 * z, z, col);
    if (fest.raya && n > 0.3 && col % 2 === 0) {
      // Pelita: an oil lamp on a short stick, lit at night.
      const px = x + cw / 2;
      ctx.fillStyle = '#6b4f2a';
      ctx.fillRect(px - 0.5 * z, y - 5 * z, Math.max(1, z), 5 * z);
      ctx.fillRect(px - 1.5 * z, y - 6 * z, 3 * z, 1.4 * z);
      drawFlame(px, y - 6.8 * z, z, col, n);
    }
    if (fest.deepavali) {
      // Diya: a clay bowl with a flame, one per parapet cell.
      const dx = x + cw / 2;
      ctx.fillStyle = '#b5651d';
      ctx.beginPath(); ctx.ellipse(dx, y - 0.6 * z, 3 * z, 1.6 * z, 0, 0, Math.PI); ctx.fill();
      ctx.fillRect(dx - 3 * z, y - 1.2 * z, 6 * z, 0.8 * z);
      drawFlame(dx, y - 2.4 * z, z, col, Math.max(0.5, n));
    }
  }
  // A small flame with a soft glow (globalAlpha arcs, no shadowBlur).
  function drawFlame(x, y, z, seed, strength) {
    const f = frameReduced ? 1 : 0.8 + 0.2 * Math.sin(frameNow / 90 + seed * 1.7);
    ctx.globalAlpha = 0.18 * strength;
    ctx.fillStyle = '#ffd784';
    ctx.beginPath(); ctx.arc(x, y, 4 * z, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffb703';
    ctx.beginPath(); ctx.ellipse(x, y, 0.9 * z, 1.6 * z * f, 0, 0, Math.PI * 2); ctx.fill();
  }
  // A red lantern with a gold cap and tassel, swaying a little in wind.
  function drawLantern(x, y, z, seed) {
    const lx = x + (sway ? sway * 0.5 * z * Math.sin(frameNow / 500 + seed) : 0);
    ctx.fillStyle = '#6b4f2a';
    ctx.fillRect(x - 0.4 * z, y - 1 * z, Math.max(1, 0.8 * z), 6 * z);        // its pole
    ctx.globalAlpha = 0.15 + 0.25 * tones.night;
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.arc(lx, y + 2.5 * z, 5 * z, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d62828';
    ctx.beginPath(); ctx.ellipse(lx, y + 2.5 * z, 3 * z, 2.4 * z, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6b73c';
    ctx.fillRect(lx - 1.6 * z, y, 3.2 * z, 0.8 * z);
    ctx.fillRect(lx - 1.6 * z, y + 4.4 * z, 3.2 * z, 0.8 * z);
    ctx.fillRect(lx - 0.3 * z, y + 5.2 * z, Math.max(0.8, 0.6 * z), 2 * z);
  }
  // Lobby decorations, hung under the canopy: CNY lanterns and Raya ketupat.
  function drawLobbyDecor(x, y, z, col) {
    if (fest.cny) drawLantern(x, y, z * 0.9, col);
    if (fest.raya) {
      // Ketupat: a woven diamond in two greens with a yellow weave and a ribbon.
      const k = 3 * z, ky = y + 3 * z;
      ctx.fillStyle = '#e9c46a';
      ctx.fillRect(x - 0.3 * z, y - 1 * z, Math.max(0.8, 0.6 * z), 1.4 * z);
      ctx.fillStyle = '#2a9d48';
      ctx.beginPath(); ctx.moveTo(x, ky - k); ctx.lineTo(x + k, ky); ctx.lineTo(x, ky + k); ctx.lineTo(x - k, ky); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9acd32';
      ctx.beginPath(); ctx.moveTo(x, ky - k); ctx.lineTo(x + k * 0.5, ky - k * 0.5); ctx.lineTo(x, ky); ctx.lineTo(x - k * 0.5, ky - k * 0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, ky); ctx.lineTo(x + k * 0.5, ky + k * 0.5); ctx.lineTo(x, ky + k); ctx.lineTo(x - k * 0.5, ky + k * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e9c46a';
      ctx.fillRect(x - 0.3 * z, ky + k, Math.max(0.8, 0.6 * z), 2 * z);
    }
  }

  // Jalur Gemilang on the highest roof cell: 14 stripes, a canton with crescent and
  // 14-point star at FLAG_DETAIL_ZOOM and above; 7 stripes and a plain canton below.
  function drawFlag(state, L) {
    if (L.roofCol < 0) return;
    const z = cam.zoom;
    const px = sx((L.roofCol + 0.5) * CELL_W), base = sy((state.maxFloors - L.roofFloor) * CELL_H) - 2.5 * z;
    const top = base - FLAG_POLE * z, w = FLAG_W * z, h = FLAG_H * z;
    if (px < -w || px > width + w || base < 0 || top > height) return;
    ctx.fillStyle = tones.wall;
    ctx.fillRect(px - 0.5 * z, top, Math.max(1, z), FLAG_POLE * z);
    const fx = px + 0.5 * z, detail = z >= FLAG_DETAIL_ZOOM;
    const stripes = detail ? 14 : 7, sh = h / stripes;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(fx, top, w, h);
    ctx.fillStyle = '#cc0001';
    for (let i = 0; i < stripes; i += 2) ctx.fillRect(fx, top + i * sh, w, sh);
    // The canton covers half the width and the top eight of fourteen stripes.
    const cw = w / 2, ch = detail ? sh * 8 : sh * 4;
    ctx.fillStyle = '#010066'; ctx.fillRect(fx, top, cw, ch);
    ctx.fillStyle = '#ffcc00';
    const cx = fx + cw * 0.36, cy = top + ch / 2, rr = ch * 0.36;
    if (!detail) { ctx.beginPath(); ctx.arc(cx + rr * 0.6, cy, rr * 0.55, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#010066';
    ctx.beginPath(); ctx.arc(cx + rr * 0.28, cy, rr * 0.82, 0, Math.PI * 2); ctx.fill();
    // 14-point star beside the crescent.
    ctx.fillStyle = '#ffcc00';
    const scx = cx + rr * 1.35, ro = rr * 0.62, ri = ro * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 14, rad = i % 2 ? ri : ro;
      if (i) ctx.lineTo(scx + Math.cos(a) * rad, cy + Math.sin(a) * rad); else ctx.moveTo(scx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  }

  // Fog: one cached gradient over the structures, thin enough for lit windows to show.
  function drawFog(groundY) {
    const gy = Math.round(groundY);
    if (gy !== fogGY || toneKey !== fogTone) {
      fogGY = gy; fogTone = toneKey;
      const c = mix('#d6dbe0', '#2a3140', tones.night);
      const rgb = parseColor(c) || [200, 200, 200];
      fogGrad = ctx.createLinearGradient(0, 0, 0, Math.max(1, groundY));
      fogGrad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
      fogGrad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    }
    ctx.globalAlpha = FOG_ALPHA;
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, width, Math.min(height, groundY + 8 * cam.zoom));
    ctx.globalAlpha = 1;
  }

  // Rain streaks or snowflakes from fixed screen-space pools, moved by dt.
  function scatterPools() {
    poolW = width; poolH = height;
    for (let i = 0; i < RAIN_STREAKS; i++) { rain.x[i] = Math.random() * (width + 40); rain.y[i] = Math.random() * height; rain.v[i] = 0.5 + Math.random() * 0.3; }
    for (let i = 0; i < SNOW_FLAKES; i++) { snow.x[i] = Math.random() * width; snow.y[i] = Math.random() * height; snow.v[i] = 0.025 + Math.random() * 0.03; }
  }
  function drawPrecip(weather, groundY, dt, now) {
    if (poolW !== width || poolH !== height) scatterPools();
    const bottom = Math.min(height, groundY);
    if (weather === 'rain') {
      const slant = WIND_SLANT * 0.5, len = 11;   // a rain front brings some wind
      ctx.strokeStyle = tones.night > 0.5 ? 'rgba(170,190,220,0.45)' : 'rgba(90,110,140,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < RAIN_STREAKS; i++) {
        rain.y[i] += rain.v[i] * dt; rain.x[i] += rain.v[i] * dt * slant;
        if (rain.y[i] > height) { rain.y[i] -= height + len; rain.x[i] = Math.random() * (width + 40) - 20; }
        if (rain.x[i] > width + 20) rain.x[i] -= width + 40;
        if (rain.y[i] > bottom) continue;
        ctx.moveTo(rain.x[i], rain.y[i]); ctx.lineTo(rain.x[i] - slant * len, rain.y[i] - len);
        debug.particles++;
      }
      ctx.stroke();
      return;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < SNOW_FLAKES; i++) {
      snow.y[i] += snow.v[i] * dt; snow.x[i] += Math.sin(now / 900 + i) * 0.02 * dt;
      if (snow.y[i] > height) { snow.y[i] -= height + 4; snow.x[i] = Math.random() * width; }
      if (snow.x[i] < -4) snow.x[i] += width + 8; else if (snow.x[i] > width + 4) snow.x[i] -= width + 8;
      if (snow.y[i] > bottom) continue;
      const r = 1.2 + (i % 3) * 0.6;
      ctx.fillRect(snow.x[i], snow.y[i], r, r);
      debug.particles++;
    }
  }

  // Fireworks (and Deepavali sparklers) above the tower top at night, plus the
  // Christmas sled. None of it runs under reduced motion.
  function drawSeasonSky(state, L, groundY, now, dt, phase, reduced, fireworks) {
    if (reduced) { for (let i = 0; i < FIREWORK_PARTICLES; i++) fw.on[i] = 0; debug.fireworks = 0; return; }
    const hour = state.tick % HOURS_PER_DAY;
    const fwHour = hour >= FIREWORK_HOURS[0] || hour < FIREWORK_HOURS[1];
    const sparkle = fest.deepavali && fwHour;
    if ((fireworks && fwHour) || sparkle) {
      let live = 0;
      for (let b = 0; b < FIREWORK_MAX_BURSTS; b++) if (burstEnd[b] > now) live++;
      if (now >= nextBurstAt && live < FIREWORK_MAX_BURSTS && L.maxCol >= L.minCol) {
        const big = fireworks && fwHour;
        const lo = L.minCol, hi = L.maxCol + 1;
        const wx = (lo + Math.random() * (hi - lo)) * CELL_W;
        const wy = (state.maxFloors - Math.max(1, L.roofFloor)) * CELL_H - (big ? 70 + Math.random() * 90 : 20 + Math.random() * 30);
        spawnBurst(wx, wy, now, big ? FW_PER_BURST : SPARK_PER_BURST, big ? 0.075 : 0.035);
        nextBurstAt = now + (big ? 450 : 700) + Math.random() * 900;
      }
    }
    let n = 0;
    for (let i = 0; i < FIREWORK_PARTICLES; i++) {
      if (!fw.on[i]) continue;
      const age = (now - fw.t0[i]) / fw.life[i];
      if (age >= 1) { fw.on[i] = 0; continue; }
      fw.vy[i] += 0.00006 * dt;                    // gravity, world px per ms^2
      fw.x[i] += fw.vx[i] * dt; fw.y[i] += fw.vy[i] * dt;
      const x = sx(fw.x[i]), y = sy(fw.y[i]);
      if (x < -4 || x > width + 4 || y < -4 || y > height + 4) continue;
      ctx.globalAlpha = 1 - age * age;
      ctx.fillStyle = FW_COLOURS[fw.c[i]];
      const r = Math.max(2.2, 2 * cam.zoom);
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
      n++;
    }
    ctx.globalAlpha = 1;
    debug.fireworks = n; debug.particles += n;
    // The sled crosses once each Christmas game night.
    if (fest.christmas && hour >= SLED_HOURS[0] && hour < SLED_HOURS[1]) {
      const p = (hour - SLED_HOURS[0] + phase) / (SLED_HOURS[1] - SLED_HOURS[0]);
      const x = lerp(-SLED_W, width + SLED_W, p), y = Math.min(groundY * 0.3, height * 0.18) + Math.sin(p * Math.PI * 3) * 6;
      ctx.drawImage(sledImg, x - SLED_W / 2, y, SLED_W, SLED_H);
      debug.sled = true;
    }
  }
  function spawnBurst(wx, wy, now, count, speed) {
    let slot = 0;
    while (slot < FIREWORK_MAX_BURSTS && burstEnd[slot] > now) slot++;
    if (slot >= FIREWORK_MAX_BURSTS) return;
    burstEnd[slot] = now + FIREWORK_LIFE_MS;
    const colour = Math.floor(Math.random() * FW_COLOURS.length);
    let made = 0;
    for (let i = 0; i < FIREWORK_PARTICLES && made < count; i++) {
      if (fw.on[i]) continue;
      const a = (made / count) * Math.PI * 2 + Math.random() * 0.2, v = speed * (0.7 + Math.random() * 0.3);
      fw.on[i] = 1; fw.x[i] = wx; fw.y[i] = wy; fw.vx[i] = Math.cos(a) * v; fw.vy[i] = Math.sin(a) * v;
      fw.t0[i] = now; fw.life[i] = FIREWORK_LIFE_MS * (0.75 + Math.random() * 0.25);
      fw.c[i] = (colour + (made % 3 === 0 ? 1 : 0)) % FW_COLOURS.length;
      made++;
    }
  }

  // ---- Lift cars ----------------------------------------------------------
  // Each car of each shaft, from state.transit. During a sub-step a loaded car
  // runs from where it stopped (prev) to its riders' door (at), then to their
  // destination (to); an idle car waits with its doors shut.
  function drawLiftCars(state, frac) {
    const z = cam.zoom;
    for (const sh of state.transit.shafts) {
      const top = sy((state.maxFloors - sh.hi) * CELL_H);
      const head = rectOf(state, sh.col, sh.hi, 1, 1);
      if (head.x > width || head.x + head.w < 0) continue;
      let ind = sh.lo;
      sh.cars.forEach((car, ci) => {
        const pos = frac < 0.5 ? lerp(car.prev, car.at, frac * 2) : lerp(car.at, car.to, (frac - 0.5) * 2);
        if (ci === 0) ind = Math.round(pos);
        const r = rectOf(state, sh.col, pos, 1, 1);
        // Cable from the shaft head to the first car, and the counterweight opposite.
        if (ci === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(r.x + r.w / 2 - 0.5 * z, top, Math.max(1, z), Math.max(0, r.y + 3 * z - top));
          const span = Math.max(1, sh.hi - sh.lo);
          const cwY = top + ((pos - sh.lo) / span) * ((sh.hi - sh.lo) * CELL_H * z);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(r.x + r.w * 0.82, cwY + 6 * z, 2 * z, 10 * z);
        }
        // Car body; doors part while it loads at its riders' door.
        const cx = r.x + 3 * z, cy = r.y + 3 * z, cw = r.w - 6 * z, ch = r.h - 6 * z;
        ctx.fillStyle = tones.car;
        ctx.fillRect(cx, cy, cw, ch);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(cx, cy, cw, Math.max(1, 1.5 * z));
        const open = car.n ? clamp01(1 - Math.abs(frac - 0.5) * 6) : 0;
        ctx.fillStyle = winTone[winTone.length - 1];
        ctx.globalAlpha = 0.25 + 0.75 * open;
        ctx.fillRect(cx + cw * 0.2, cy + 3 * z, cw * 0.6, ch - 5 * z);
        ctx.globalAlpha = 1;
        // Riders: up to three heads in the window.
        ctx.fillStyle = tones.person;
        for (let i = 0; i < Math.min(3, car.n); i++) {
          ctx.beginPath(); ctx.arc(cx + cw * (0.3 + i * 0.2), cy + 6 * z, 1.4 * z, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        const gap = cw * 0.3 * open;
        ctx.fillRect(cx + cw * 0.2, cy + 3 * z, Math.max(0, cw * 0.3 - gap), ch - 5 * z);
        ctx.fillRect(cx + cw * 0.5 + gap, cy + 3 * z, Math.max(0, cw * 0.3 - gap), ch - 5 * z);
      });
      // Floor indicator beside the shaft, following the first car; closed stops stay dark.
      for (let f = sh.lo; f <= sh.hi; f++) {
        const y = sy((state.maxFloors - f + 0.5) * CELL_H);
        ctx.fillStyle = f === ind ? tones.car : sh.closed.includes(f) ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(head.x + 1 * z, y - 1 * z, 1.5 * z, 2 * z);
      }
    }
  }

  // ---- Queues at lift doors -------------------------------------------------
  // Queued walkers stand in line left of their shaft's door, front first, torso
  // coloured by stress. They stand still, so a check can sample their pixels.
  function drawQueues(state) {
    const z = cam.zoom;
    queueSpotCount = 0;
    for (const sh of state.transit.shafts) {
      if (!sh.queue.length) continue;
      doorCount.clear();
      for (const w of sh.queue) {
        const door = w.legs[w.leg][1];
        const i = doorCount.get(door) || 0;
        if (i >= QUEUE_DRAWN) continue;
        doorCount.set(door, i + 1);
        const x = sx(sh.col * CELL_W - 4 - i * QUEUE_GAP), y = sy((state.maxFloors - door + 1) * CELL_H) - 2 * z;
        if (x < -10 || x > width + 10 || y < -20 || y > height + 20) continue;
        const band = stressBand(stressOf(state, w));
        const h = 7 * z;
        ctx.fillStyle = tones.person;
        ctx.fillRect(x - 1.6 * z, y - 3 * z, 1.4 * z, 3 * z);
        ctx.fillRect(x + 0.2 * z, y - 3 * z, 1.4 * z, 3 * z);
        ctx.fillStyle = stressColour(band, palette, SHIRTS[w.unit % SHIRTS.length]);
        ctx.fillRect(x - 2 * z, y - 3 * z - h + 2 * z, 4 * z, h - 2 * z);
        ctx.fillStyle = tones.person;
        ctx.beginPath(); ctx.arc(x, y - h - 2.2 * z, 2 * z, 0, Math.PI * 2); ctx.fill();
        if (i === 0 && queueSpotCount < queueSpots.length) {
          const q = queueSpots[queueSpotCount++];
          q.x = x; q.y = y - 3 * z - (h - 2 * z) / 2; q.band = band; q.col = sh.col; q.floor = door;  // torso centre
        }
      }
    }
  }

  // ---- Walkers ------------------------------------------------------------
  function drawWalkers(state, L, dt, reduced) {
    const z = cam.zoom;
    // Keep one walker list per let unit; rebuild the flat list when it changes.
    let sig = L.n + ':' + L.nid + ':';
    for (const st of state.structures) if (st.occupied) sig += st.id + ',';
    if (sig !== walkerSig) {
      walkerSig = sig;
      const live = new Set();
      walkerList.length = 0;
      for (const st of state.structures) {
        const t = TYPES[st.type];
        if (t.kind !== 'unit' || !st.occupied) continue;
        live.add(st.id);
        let list = walkers.get(st.id);
        if (!list) {
          const n = Math.max(1, Math.round((t.people || 2) / 2));
          list = [];
          for (let i = 0; i < n; i++) {
            list.push({
              id: st.id, floor: st.floor, x: (st.col + (i + 0.5) * (t.w / n)) * CELL_W, dir: i % 2 ? -1 : 1,
              speed: 11 + hash01(st.id, i) * 9, phase: hash01(st.id, i + 3) * 6.28, shirt: SHIRTS[(st.id + i) % SHIRTS.length],
              l: 0, r: 0,
            });
          }
          walkers.set(st.id, list);
        }
        const info = L.info.get(st.id);
        for (const w of list) { w.l = info.corrL * CELL_W + 3; w.r = (info.corrR + 1) * CELL_W - 3; walkerList.push(w); }
      }
      for (const id of walkers.keys()) if (!live.has(id)) walkers.delete(id);
      walkerList.sort((a, b) => a.floor - b.floor || a.x - b.x);
    }
    if (!reduced) {
      const s = dt / 1000;
      for (const w of walkerList) {
        w.x += w.dir * w.speed * s;
        w.phase += w.speed * 0.55 * s;
        if (w.x > w.r) { w.x = w.r; w.dir = -1; } else if (w.x < w.l) { w.x = w.l; w.dir = 1; }
      }
      // Soft separation so two figures on one corridor never stack.
      walkerList.sort((a, b) => a.floor - b.floor || a.x - b.x);
      const minGap = 7;
      for (let i = 1; i < walkerList.length; i++) {
        const a = walkerList[i - 1], b = walkerList[i];
        if (a.floor !== b.floor) continue;
        const gap = b.x - a.x;
        if (gap < minGap) { const push = (minGap - gap) / 2; a.x = Math.max(a.l, a.x - push); b.x = Math.min(b.r, b.x + push); }
      }
    }
    // Draw: head, shirt torso, legs with a swing, slight bob.
    for (const w of walkerList) {
      const x = sx(w.x), y = sy((state.maxFloors - w.floor + 1) * CELL_H) - 2 * z;
      if (x < -10 || x > width + 10 || y < -20 || y > height + 20) continue;
      const bob = reduced ? 0 : Math.abs(Math.sin(w.phase)) * 0.8 * z;
      const swing = reduced ? 0 : Math.sin(w.phase) * 2.2 * z;
      const h = 7 * z;
      ctx.fillStyle = tones.person;
      ctx.fillRect(x - 0.8 * z + swing * 0.5, y - 3 * z, 1.6 * z, 3 * z);
      ctx.fillRect(x - 0.8 * z - swing * 0.5, y - 3 * z, 1.6 * z, 3 * z);
      ctx.fillStyle = w.shirt;
      ctx.fillRect(x - 1.8 * z, y - 3 * z - h + 2 * z - bob, 3.6 * z, h - 2 * z);
      ctx.fillStyle = tones.person;
      ctx.beginPath(); ctx.arc(x, y - h - 2.2 * z - bob, 2 * z, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- Dust and floats ----------------------------------------------------
  function drawDust(now, reduced) {
    const z = cam.zoom;
    for (const d of dust) {
      if (!d.on) continue;
      const p = (now - d.t0) / d.dur;
      if (p >= 1 || reduced) { d.on = false; continue; }
      const k = easeOutCubic(p);
      const x = sx(d.x + d.vx * k), y = sy(d.y + d.vy * k + 14 * k * k);
      ctx.globalAlpha = (1 - p) * 0.8;
      ctx.fillStyle = d.warm ? '#ffe8a3' : 'rgba(200,196,186,1)';
      ctx.beginPath(); ctx.arc(x, y, d.r * z * (0.6 + 0.6 * k), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats(now, reduced) {
    let any = false;
    for (const f of floats) if (f.on) { any = true; break; }
    if (!any) return;
    const z = Math.min(1.6, Math.max(0.9, cam.zoom));
    ctx.font = `600 ${Math.round(11 * z)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const f of floats) {
      if (!f.on) continue;
      const age = now - f.t0;
      if (age < 0) continue;
      const p = age / FLOAT_MS;
      if (p >= 1) { f.on = false; continue; }
      const rise = reduced ? 0 : FLOAT_RISE * easeOutCubic(p) * z;
      const alpha = reduced ? (p < 0.75 ? 1 : 0) : (p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4);
      if (alpha <= 0) continue;
      const x = sx(f.x), y = sy(f.y) - rise;
      if (x < -40 || x > width + 40 || y < -20 || y > height + 20) continue;
      ctx.globalAlpha = alpha;
      const tw = ctx.measureText(f.text).width + 8 * z;
      ctx.fillStyle = palette['float-bg'];
      roundRect(x - tw / 2, y - 14 * z, tw, 15 * z, 4 * z);
      ctx.fill();
      ctx.fillStyle = f.neg ? palette.danger : palette.good;
      ctx.fillText(f.text, x, y - 2 * z);
    }
    ctx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  refreshTheme();
  const drawnQueues = () => queueSpots.slice(0, queueSpotCount).map(q => ({ ...q }));
  return { cam, resize, refreshTheme, recenter, pan, zoomAt, screenToCell, draw, onPlaced, onDemolished, onTick, reset, layout, drawnQueues, paintMiniMap, debug };
}
