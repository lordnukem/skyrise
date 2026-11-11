// Canvas renderer. Owns the camera; everything drawn here is code, no images.
// Walkers and lift cars are cosmetic and derived from state every frame.

import { CELL_W, CELL_H, ZOOM_MIN, ZOOM_MAX, HOURS_PER_DAY, TYPES } from './constants.js';
import { buildGrid, reachable, cellsOf, canPlace } from './sim.js';

const PALETTE_KEYS = ['sky-top', 'sky-bottom', 'ground', 'ground-line', 'grid-line', 'wall', 'wall-dark', 'glass',
  'lobby', 'office', 'shop', 'flat', 'stairs', 'shaft', 'car', 'person', 'unreach', 'ghost-ok', 'ghost-bad', 'fg'];

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, zoom: 1 };
  let dpr = 1, width = 0, height = 0;
  let palette = {};
  const walkers = new Map(); // unit id -> [{ t, dir, speed }]

  function refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    palette = {};
    for (const k of PALETTE_KEYS) palette[k] = cs.getPropertyValue('--' + k).trim();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
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
    cam.zoom = width < 500 ? 1 : 1.4;
    cam.x = worldW(state) / 2 - width / cam.zoom / 2;
    cam.y = worldH(state) + CELL_H * 1.5 - height / cam.zoom;
    clamp(state);
  }

  function pan(state, dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; clamp(state); }

  function zoomAt(state, sx, sy, factor) {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
    // Keep the world point under the finger fixed while the scale changes.
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
  const cellRect = (state, col, floor, w = 1, h = 1) => ({
    x: sx(col * CELL_W), y: sy((state.maxFloors - floor - h + 1) * CELL_H),
    w: w * CELL_W * cam.zoom, h: h * CELL_H * cam.zoom,
  });

  // Daylight 0..1 peaking early afternoon; drives sky and lit windows.
  function daylight(state, phase) {
    const hour = (state.tick % HOURS_PER_DAY) + phase;
    return 0.5 + 0.5 * Math.cos(((hour - 13) / HOURS_PER_DAY) * Math.PI * 2);
  }

  function mix(hexA, hexB, t) {
    const a = parseHex(hexA), b = parseHex(hexB);
    if (!a || !b) return hexA;
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function parseHex(h) {
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function draw(state, view, timeMs, phase) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const light = daylight(state, phase);
    const night = 1 - light;

    // Sky and ground.
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, mix(palette['sky-top'], '#0b1026', night * 0.85));
    sky.addColorStop(1, mix(palette['sky-bottom'], '#1c2240', night * 0.8));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    drawStars(timeMs, night);
    const groundY = sy(worldH(state));
    ctx.fillStyle = mix(palette.ground, '#141a10', night * 0.6);
    ctx.fillRect(0, groundY, width, Math.max(0, height - groundY));
    ctx.fillStyle = palette['ground-line'];
    ctx.fillRect(0, groundY - 1, width, 2);

    // Plot boundary and faint floor lines so the player can read the grid.
    const left = sx(0), right = sx(worldW(state));
    ctx.strokeStyle = palette['grid-line'];
    ctx.lineWidth = 1;
    for (let f = 1; f <= state.maxFloors; f++) {
      const y = sy((state.maxFloors - f) * CELL_H);
      if (y < -2 || y > height + 2) continue;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }
    ctx.strokeStyle = palette['wall-dark'];
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(left, 0); ctx.lineTo(left, groundY); ctx.moveTo(right, 0); ctx.lineTo(right, groundY); ctx.stroke();
    ctx.setLineDash([]);

    const grid = buildGrid(state);
    const reach = reachable(state, grid);

    for (const st of state.structures) drawStructure(state, st, reach.has(st.id), night, timeMs, grid);
    drawLiftCars(state, grid, timeMs);
    drawWalkers(state, grid, timeMs, night);

    if (view.selected) {
      const st = state.structures.find(x => x.id === view.selected);
      if (st) outline(cellRect(state, st.col, st.floor, TYPES[st.type].w, TYPES[st.type].h), palette.fg, 3);
    }
    if (view.hover && view.tool && TYPES[view.tool]) {
      const t = TYPES[view.tool];
      const ok = canPlace(state, view.tool, view.hover.col, view.hover.floor, grid).ok;
      const r = cellRect(state, view.hover.col, view.hover.floor, t.w, t.h);
      ctx.fillStyle = ok ? palette['ghost-ok'] : palette['ghost-bad'];
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  function outline(r, color, lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);
  }

  function drawStars(timeMs, night) {
    if (night < 0.35) return;
    ctx.fillStyle = `rgba(255,255,255,${(night - 0.35) * 1.2})`;
    // Deterministic pseudo-random star field that twinkles with time.
    for (let i = 0; i < 60; i++) {
      const x = ((i * 7919) % 1000) / 1000 * width;
      const y = ((i * 104729) % 1000) / 1000 * height * 0.6;
      const tw = 0.6 + 0.4 * Math.sin(timeMs / 700 + i);
      ctx.fillRect(x, y, 1.5 * tw, 1.5 * tw);
    }
  }

  function drawStructure(state, st, isReachable, night, timeMs, grid) {
    const t = TYPES[st.type];
    const r = cellRect(state, st.col, st.floor, t.w, t.h);
    if (r.x > width || r.x + r.w < 0 || r.y > height || r.y + r.h < 0) return;
    const z = cam.zoom;
    ctx.save();
    switch (st.type) {
      case 'lobby': {
        ctx.fillStyle = palette.lobby;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // Tall glass door panel with a warm light at night.
        ctx.fillStyle = night > 0.5 ? mix('#ffe9b0', palette.glass, 1 - night) : palette.glass;
        ctx.fillRect(r.x + 4 * z, r.y + 6 * z, r.w - 8 * z, r.h - 6 * z);
        ctx.fillStyle = palette['wall-dark'];
        ctx.fillRect(r.x, r.y, r.w, 3 * z);
        break;
      }
      case 'stairs': {
        ctx.fillStyle = palette.stairs;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = palette.fg; ctx.lineWidth = Math.max(1, 1.5 * z);
        ctx.beginPath();
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
          const yy = r.y + r.h - (i / steps) * r.h;
          const xx = r.x + 3 * z + ((i % 2) ? r.w - 6 * z : 0);
          i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.stroke();
        break;
      }
      case 'elevator': {
        ctx.fillStyle = palette.shaft;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = palette['wall-dark']; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x + r.w * 0.35, r.y); ctx.lineTo(r.x + r.w * 0.35, r.y + r.h);
        ctx.moveTo(r.x + r.w * 0.65, r.y); ctx.lineTo(r.x + r.w * 0.65, r.y + r.h);
        ctx.stroke();
        break;
      }
      case 'office': case 'shop': case 'flat': {
        const faded = !st.occupied;
        ctx.globalAlpha = faded ? 0.55 : 1;
        ctx.fillStyle = palette[st.type];
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const lit = st.occupied && night > 0.45;
        const glass = lit ? mix('#ffe8a3', palette.glass, 1 - night) : palette.glass;
        if (st.type === 'office') {
          // Three windows per cell in a row.
          ctx.fillStyle = glass;
          for (let i = 0; i < t.w * 3; i++) {
            const wx = r.x + (i + 0.2) * (r.w / (t.w * 3));
            ctx.fillRect(wx, r.y + 6 * z, (r.w / (t.w * 3)) * 0.6, r.h - 12 * z);
          }
        } else if (st.type === 'shop') {
          // Striped awning over a wide display window.
          ctx.fillStyle = glass;
          ctx.fillRect(r.x + 3 * z, r.y + 10 * z, r.w - 6 * z, r.h - 12 * z);
          for (let i = 0; i < 6; i++) {
            ctx.fillStyle = i % 2 ? '#ffffff' : palette.shop;
            ctx.fillRect(r.x + (i * r.w) / 6, r.y + 2 * z, r.w / 6, 7 * z);
          }
          ctx.fillStyle = palette['wall-dark'];
          ctx.fillRect(r.x, r.y + 9 * z, r.w, 1.5 * z);
        } else {
          // Flat: window with a curtain and a balcony rail.
          ctx.fillStyle = glass;
          ctx.fillRect(r.x + 5 * z, r.y + 6 * z, r.w * 0.35, r.h * 0.45);
          ctx.fillStyle = palette.flat;
          ctx.fillRect(r.x + 5 * z, r.y + 6 * z, r.w * 0.12, r.h * 0.45);
          ctx.fillStyle = palette['wall-dark'];
          ctx.fillRect(r.x + r.w * 0.55, r.y + r.h * 0.55, r.w * 0.4, 1.5 * z);
          for (let i = 0; i < 4; i++) ctx.fillRect(r.x + r.w * (0.55 + i * 0.12), r.y + r.h * 0.55, 1 * z, r.h * 0.3);
        }
        ctx.globalAlpha = 1;
        if (!isReachable) hatch(r);
        break;
      }
    }
    // Wall edges on every structure so cells read as rooms.
    ctx.strokeStyle = palette['wall-dark'];
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.restore();
  }

  // Diagonal hatching marks a unit with no path from the lobby.
  function hatch(r) {
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.strokeStyle = palette.unreach; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = r.x - r.h; x < r.x + r.w; x += 8) { ctx.moveTo(x, r.y + r.h); ctx.lineTo(x + r.h, r.y); }
    ctx.stroke();
    ctx.restore();
  }

  // One car per contiguous shaft, gliding between its ends.
  function drawLiftCars(state, grid, timeMs) {
    const seen = new Set();
    for (const st of state.structures) {
      if (st.type !== 'elevator' || seen.has(st.id)) continue;
      let lo = st.floor, hi = st.floor;
      let s;
      while ((s = grid.get(`${st.col},${lo - 1}`)) && s.type === 'elevator') lo--;
      while ((s = grid.get(`${st.col},${hi + 1}`)) && s.type === 'elevator') hi++;
      for (let f = lo; f <= hi; f++) seen.add(grid.get(`${st.col},${f}`).id);
      const span = hi - lo;
      const f = lo + span * (0.5 + 0.5 * Math.sin(timeMs / (900 + span * 350) + st.col));
      const r = cellRect(state, st.col, f);
      ctx.fillStyle = palette.car;
      ctx.fillRect(r.x + 3 * cam.zoom, r.y + 4 * cam.zoom, r.w - 6 * cam.zoom, r.h - 8 * cam.zoom);
    }
  }

  // Small figures pace the floor of each let unit, bouncing off the ends of
  // the contiguous built stretch so they look like they walk the corridor.
  function drawWalkers(state, grid, timeMs, night) {
    const live = new Set();
    ctx.fillStyle = palette.person;
    for (const st of state.structures) {
      const t = TYPES[st.type];
      if (t.kind !== 'unit' || !st.occupied) continue;
      live.add(st.id);
      let list = walkers.get(st.id);
      if (!list) {
        const n = Math.max(1, Math.round((t.people || 2) / 2));
        list = Array.from({ length: n }, (_, i) => ({ seed: (st.id * 31 + i * 17) % 1000, speed: 0.6 + (i % 3) * 0.25 }));
        walkers.set(st.id, list);
      }
      let l = st.col, r = st.col + t.w - 1;
      while (grid.has(`${l - 1},${st.floor}`)) l--;
      while (grid.has(`${r + 1},${st.floor}`)) r++;
      const spanPx = (r - l + 1) * CELL_W;
      for (const w of list) {
        const u = ((timeMs / 1000) * w.speed * 12 + w.seed) % (2 * spanPx);
        const off = u < spanPx ? u : 2 * spanPx - u;
        const x = sx(l * CELL_W + off);
        const y = sy((state.maxFloors - st.floor + 1) * CELL_H);
        const h = 9 * cam.zoom;
        ctx.fillRect(x - 1.5 * cam.zoom, y - h, 3 * cam.zoom, h);
        ctx.beginPath(); ctx.arc(x, y - h - 1.5 * cam.zoom, 2 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const id of walkers.keys()) if (!live.has(id)) walkers.delete(id);
  }

  refreshTheme();
  return { cam, resize, refreshTheme, recenter, pan, zoomAt, screenToCell, draw };
}
