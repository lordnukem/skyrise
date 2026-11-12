// Canvas renderer. Owns the camera and every cosmetic animation (corridor
// strollers, placement dust, income floats) and draws the sim's people: lift
// cars and the queues at their doors come from `state.transit`. All art is drawn in code.
//
// Hot-path rules: nothing allocates per frame except the odd template string
// on a palette bucket change; rects go through one scratch object, the grid
// and BFS are cached until the tower changes, and the sky/skyline/ground is
// cached on an offscreen canvas that is only repainted when the light, size
// or camera changes.

import { CELL_W, CELL_H, ZOOM_MIN, ZOOM_MAX, HOURS_PER_DAY, TYPES, WALK_STEPS } from './constants.js';
import { buildGrid, reachable, canPlace, happyBand, shaftsOf, takeOf, stressOf, stressBand, walkerStepsDone } from './sim.js';
import {
  clamp01, lerp, easeOutCubic, easeOutBack, smoothstep, hash01, prefersReducedMotion,
} from './anim.js';

const PALETTE_KEYS = ['sky-top', 'sky-bottom', 'night-top', 'night-bottom', 'horizon', 'skyline', 'ground', 'ground-dark',
  'kerb', 'grid-line', 'wall-dark', 'glass', 'window-lit', 'lobby', 'office', 'shop', 'flat', 'stairs', 'shaft', 'express', 'security', 'car',
  'food', 'escalator', 'slab',
  'person', 'unreach', 'ghost-ok', 'ghost-bad', 'fg', 'muted', 'good', 'warn', 'danger', 'float-bg'];

const PLACE_MS = 180, DUST_MS = 420, FLOAT_MS = 1000, FLOAT_RISE = 22;
const SHIRTS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#cdb4db', '#f4a261'];
const MAX_FLOATS_PER_TICK = 8;
const QUEUE_DRAWN = 10, QUEUE_GAP = 6;  // figures drawn per lift door, and their spacing in world px

// A queued walker's torso: their own shirt when calm, warn when tense, danger when stressed.
export const stressColour = (band, palette, shirt) => (band === 'stressed' ? palette.danger : band === 'tense' ? palette.warn : shirt);

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
  const winTone = new Array(9).fill('#000');

  // Layout cache: grid, reachability and derived geometry per structure.
  const lay = { ref: null, n: -1, nid: -1, grid: null, reach: null, info: new Map(), shafts: [] };
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
    const minY = -CELL_H * 2, maxY = worldH(state) + CELL_H * 3 - viewH;
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
  function updateTones(night) {
    const q = Math.round(night * 48);
    const key = q + '|' + themeRev;
    if (key === toneKey) return;
    toneKey = key;
    const n = q / 48, dim = '#0b1026';
    tones.skyTop = mix(palette['sky-top'], palette['night-top'], n);
    tones.skyBottom = mix(palette['sky-bottom'], palette['night-bottom'], n);
    tones.horizon = palette.horizon;
    tones.dusk = 1 - Math.abs(n - 0.5) * 2;           // peaks at the transition
    tones.ground = mix(palette.ground, '#10140d', n * 0.55);
    tones.groundDark = mix(palette['ground-dark'], '#0a0c08', n * 0.55);
    tones.kerb = mix(palette.kerb, '#2a2f26', n * 0.5);
    tones.skyline = mix(palette.skyline, '#05081a', n * 0.7);
    tones.wall = mix(palette['wall-dark'], dim, n * 0.4);
    tones.glass = mix(palette.glass, '#243357', n * 0.75);
    for (const k of ['lobby', 'office', 'shop', 'flat', 'stairs', 'shaft', 'express', 'security', 'food', 'escalator', 'slab']) tones[k] = mix(palette[k], dim, n * 0.42);
    tones.awning = mix('#ffffff', dim, n * 0.5);
    tones.car = palette.car;
    tones.person = palette.person;
    tones.warm = smoothstep(0.28, 0.7, n);           // how much of the tower is lit
    for (let i = 0; i < winTone.length; i++) winTone[i] = mix(tones.glass, palette['window-lit'], i / (winTone.length - 1));
    tones.lamp = palette['window-lit'];
    tones.night = n;
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
    for (const st of s) {
      const t = TYPES[st.type];
      let topMask = 0;
      for (let dx = 0; dx < t.w; dx++) if (!has(st.col + dx, st.floor + t.h)) topMask |= 1 << dx;
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
  }

  // ---- Frame --------------------------------------------------------------
  function draw(state, view, now, phase) {
    const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
    lastFrame = now;
    const reduced = prefersReducedMotion();
    const night = 1 - daylight(state, phase);
    updateTones(night);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const L = layout(state);
    const groundY = sy(worldH(state));
    drawBackground(state, groundY, now, reduced);

    // Faint floor lines and plot edges inside the plot only.
    const left = sx(0), right = sx(worldW(state));
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
    ctx.beginPath(); ctx.moveTo(left + 0.5, 0); ctx.lineTo(left + 0.5, groundY); ctx.moveTo(right - 0.5, 0); ctx.lineTo(right - 0.5, groundY); ctx.stroke();
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
    }

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
        ctx.beginPath(); ctx.arc(x, top, 9 * cam.zoom, 0, Math.PI * 2); ctx.fill();
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
      case 'elevator': case 'express': {
        ctx.fillStyle = st.type === 'express' ? tones.express : tones.shaft;
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
      case 'office': case 'shop': case 'flat': case 'food': {
        const vacant = !st.occupied;
        ctx.fillStyle = tones[st.type];
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (st.type === 'office') {
          // Three tall windows per cell behind a thin mullion grid.
          const n = t.w * 3, ww = r.w / n;
          for (let i = 0; i < n; i++) {
            const lit = vacant ? 0 : smoothstep(hash01(st.id, i) * 0.6, hash01(st.id, i) * 0.6 + 0.25, warm);
            ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
            ctx.fillRect(r.x + i * ww + ww * 0.2, r.y + 6 * z, ww * 0.6, r.h - 12 * z);
          }
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          for (let i = 0; i < n; i++) ctx.fillRect(r.x + i * ww + ww * 0.2, r.y + 6 * z, ww * 0.6, Math.max(1, z)); // sill highlight
        } else if (st.type === 'shop') {
          // Scalloped awning, wide display window, door and a sign strip.
          const lit = vacant ? 0 : smoothstep(0.1, 0.5, warm);
          ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
          ctx.fillRect(r.x + 3 * z, r.y + 11 * z, r.w * 0.6, r.h - 13 * z);
          ctx.fillRect(r.x + r.w * 0.7, r.y + 11 * z, r.w * 0.22, r.h - 11 * z); // door
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(r.x + 3 * z, r.y + 7 * z, r.w - 6 * z, 3 * z); // sign strip
          const scallops = t.w * 4, sw = r.w / scallops;
          for (let i = 0; i < scallops; i++) {
            ctx.fillStyle = i % 2 ? tones.awning : tones.shop;
            ctx.fillRect(r.x + i * sw, r.y + 2 * z, sw, 6 * z);
            ctx.beginPath(); ctx.arc(r.x + (i + 0.5) * sw, r.y + 8 * z, sw / 2, 0, Math.PI); ctx.fill();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(r.x, r.y + 2 * z, r.w, 1 * z);
        } else if (st.type === 'food') {
          // Food court: a lit serving counter along the back and three round tables.
          const lit = vacant ? 0 : smoothstep(0.05, 0.45, warm);
          ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
          ctx.fillRect(r.x + 3 * z, r.y + 6 * z, r.w - 6 * z, r.h * 0.32);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(r.x + 3 * z, r.y + 6 * z + r.h * 0.32, r.w - 6 * z, 2 * z);   // counter edge
          ctx.fillStyle = tones.wall;
          for (let i = 0; i < 3; i++) {
            const tx = r.x + r.w * (0.2 + i * 0.3), ty = r.y + r.h * 0.72;
            ctx.fillRect(tx - 4 * z, ty, 8 * z, 1.5 * z);
            ctx.fillRect(tx - 0.5 * z, ty, Math.max(1, z), r.h * 0.2);
          }
        } else {
          // Flat: two windows with curtains and a balcony rail.
          const ww = r.w * 0.22;
          for (let i = 0; i < 2; i++) {
            const lit = vacant ? 0 : smoothstep(hash01(st.id, i + 9) * 0.5, hash01(st.id, i + 9) * 0.5 + 0.3, warm);
            const wx = r.x + r.w * (0.1 + i * 0.5);
            ctx.fillStyle = winTone[Math.round(lit * (winTone.length - 1))];
            ctx.fillRect(wx, r.y + 6 * z, ww, r.h * 0.5);
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillRect(wx, r.y + 6 * z, ww * 0.22, r.h * 0.5);          // curtain
            ctx.fillRect(wx + ww * 0.78, r.y + 6 * z, ww * 0.22, r.h * 0.5);
          }
          ctx.fillStyle = tones.wall;
          const by = r.y + r.h * 0.62;
          ctx.fillRect(r.x + 2 * z, by, r.w - 4 * z, 1.5 * z);
          for (let i = 0; i <= 8; i++) ctx.fillRect(r.x + 2 * z + (r.w - 4 * z) * (i / 8) - 0.5 * z, by, Math.max(1, z), r.h * 0.3);
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
          } else if (k < 0.12) {                                       // aerial
            ctx.fillStyle = tones.wall;
            ctx.fillRect(x + cw * 0.5, r.y - 10 * z, Math.max(1, z), 7.5 * z);
          }
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
  return { cam, resize, refreshTheme, recenter, pan, zoomAt, screenToCell, draw, onPlaced, onDemolished, onTick, reset, layout, drawnQueues };
}
