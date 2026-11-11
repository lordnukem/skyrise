// Wires the pure simulation to the renderer, input and UI, and runs the clock.

import { TICK_MS, AUTOSAVE_TICKS, TYPES, DEMAND, WAIT_BUSY, SPEEDS, UNLOCK_AT, LIFT_CAR_COST, RENT_LEVELS } from './constants.js';
import { newGame, place, demolish, structureAt, reachable, stepTick, happyBand, addCar, cycleRent, takeOf, priceOf, shaftsOf, isUnlocked } from './sim.js';
import { createRenderer } from './render.js';
import { attachInput } from './input.js';
import { createUI } from './ui.js';
import { saveGame, loadGame, clearGame, loadTheme, saveTheme } from './storage.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

const THEME_BG = { light: '#eef1f5', dark: '#0f141c' };
let theme = loadTheme() || '';           // '' = follow the OS
applyTheme(theme);

let state = loadGame();
const resumed = !!state;
if (!state) state = newGame();

const view = { tool: 'office', selected: null, hover: null };
let speed = 1, runSpeed = 1;             // index into SPEEDS; runSpeed is the last non-zero one
const paused = () => SPEEDS[speed] === 0;
const tickMs = () => TICK_MS / SPEEDS[speed];
const opts = () => ({ paused: paused(), theme, speed });
let lastTickAt = performance.now();
let rafId = 0;

function setSpeed(i) {
  speed = i;
  if (SPEEDS[i]) runSpeed = i;
  lastTickAt = performance.now();
  ui.update(state, opts());
}

const ui = createUI({
  onTool(id) { view.tool = id; ui.setTool(id); view.selected = null; ui.hideCard(); describeTool(id); },
  onSpeed: setSpeed,
  onMenu(action) {
    if (action === 'save') ui.status(saveGame(state) ? 'Saved.' : 'Could not save: storage unavailable.');
    if (action === 'pause') setSpeed(paused() ? runSpeed : 0);
    if (action === 'theme') { theme = theme === '' ? 'light' : theme === 'light' ? 'dark' : ''; applyTheme(theme); saveTheme(theme); ui.update(state, opts()); }
    if (action === 'recenter') renderer.recenter(state);
    if (action === 'new') {
      if (!confirm('Start a new tower? The current one is erased.')) return;
      clearGame();
      state = newGame();
      view.selected = null;
      ui.hideCard();
      renderer.reset();
      renderer.recenter(state);
      ui.update(state, opts());
      ui.status('New plot. Build stairs or a lift beside the lobby, then lease units above it.', true);
    }
  },
});
ui.setTool(view.tool);

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  // Keep the browser chrome colour in step with a pinned theme.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const own = m.media.includes('dark') ? 'dark' : 'light';
    m.content = THEME_BG[t || own];
  }
  renderer.refreshTheme();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderer.refreshTheme());

function describeTool(id) {
  const t = TYPES[id];
  if (id === 'car') return ui.status(`Add car: tap a lift shaft, $${LIFT_CAR_COST.toLocaleString()}. Each car raises the shaft's capacity.`);
  if (!t) return ui.status('Inspect: tap any room to see how it is doing.');
  if (!isUnlocked(state, id)) return ui.status(`${t.label}: unlocks at ${UNLOCK_AT[id]} stars.`);
  const extra = t.kind === 'unit' ? (t.price ? `, sells for $${t.price.toLocaleString()}` : t.rent ? `, $${t.rent}/hour when let` : ', earns per visitor')
    : t.upkeep ? `, $${t.upkeep}/hour upkeep` : '';
  const note = id === 'express' ? ' Stops only at lobbies.' : id === 'security' ? ' Needed for 3 stars.' : t.span ? ` Climbs up to ${t.span} floors.` : '';
  ui.status(`${t.label}: ${t.w}x${t.h}, $${t.cost.toLocaleString()}${extra}.${note}`);
}

function describe(st) {
  const t = TYPES[st.type];
  const reach = reachable(state).has(st.id);
  const path = reach ? '' : ' (no path to lobby)';
  if (t.span) {
    const sh = shaftsOf(state).find(x => x.col === st.col && x.lo <= st.floor && st.floor <= x.hi);
    return `${t.label} shaft, floors ${sh.lo}-${sh.hi}, ${sh.cars} car${sh.cars > 1 ? 's' : ''}${path}.`;
  }
  if (t.range) return `${t.label} office on floor ${st.floor}: covers floors ${Math.max(1, st.floor - t.range)}-${Math.min(state.maxFloors, st.floor + t.range)}${path}.`;
  if (t.kind !== 'unit') return `${t.label} on floor ${st.floor}${path}.`;
  if (!reach) return `${t.label}, floor ${st.floor}: no path to the lobby, so nobody comes.`;
  if (!st.occupied) return `${t.label}, floor ${st.floor}: vacant, waiting for a tenant.`;
  return `${t.label}, floor ${st.floor}: let, ${t.people} people, $${takeOf(state, st)}/hour.`;
}

// The inspect card for a reachable unit: happiness, why, rent and people.
function showCard(st) {
  const t = TYPES[st.type];
  const sv = state.service[st.id];
  const band = happyBand(st.happy);
  const peak = DEMAND[st.type] ? DEMAND[st.type].peak : DEMAND.office.peak;
  const why = sv.walk > 0 ? `${sv.walk} floor${sv.walk > 1 ? 's' : ''} by stairs`
    : sv.peak >= WAIT_BUSY ? `Lift busy at ${String(peak).padStart(2, '0')}:00`
    : 'Lift keeps up';
  const money = t.price ? ['Sale', st.sold ? `sold $${priceOf(st).toLocaleString()}` : `asking $${priceOf(st).toLocaleString()}`]
    : [t.perVisitor ? 'Takings' : 'Rent', st.occupied ? `$${takeOf(state, st)}/h` : 'vacant'];
  ui.showCard(`${t.label}, floor ${st.floor}`, [
    ['Happiness', `${band[0].toUpperCase()}${band.slice(1)} · ${Math.round(st.happy)}`, band],
    ['Why', why, 'wide'],
    money,
    ['People', st.occupied ? String(t.people) : '0'],
  ], [
    { label: `Rent: ${RENT_LEVELS[st.rentLevel].label}`, onClick() { cycleRent(state, st.id); showCard(st); } },
  ]);
}

attachInput(canvas, {
  onTap(x, y) {
    const { col, floor } = renderer.screenToCell(state, x, y);
    if (view.tool === 'inspect') {
      const st = structureAt(state, col, floor);
      view.selected = st ? st.id : null;
      if (st && TYPES[st.type].kind === 'unit' && state.service[st.id]) return showCard(st);
      ui.hideCard();
      ui.status(st ? describe(st) : `Empty cell on floor ${floor}.`, !!st);
      return;
    }
    if (view.tool === 'car') {
      const res = addCar(state, col, floor);
      ui.status(res.ok ? `Added a car: this shaft now runs ${res.cars}.` : res.reason + '.');
      ui.update(state, opts());
      return;
    }
    const res = place(state, view.tool, col, floor);
    if (res.ok) {
      const t = TYPES[view.tool];
      renderer.onPlaced(state, res.structure);
      ui.status(`Built ${t.label} on floor ${floor} for $${t.cost.toLocaleString()}.`);
    } else {
      ui.status(res.reason + '.');
    }
    ui.update(state, opts());
  },
  onLongPress(x, y) {
    const { col, floor } = renderer.screenToCell(state, x, y);
    const st = structureAt(state, col, floor);
    if (!st) return ui.status('Nothing to demolish here.');
    const res = demolish(state, st.id);
    if (res.ok) renderer.onDemolished(state, st);
    ui.status(res.ok ? `Demolished ${TYPES[st.type].label}, refunded $${res.refund}.` : res.reason + '.');
    if (navigator.vibrate) navigator.vibrate(res.ok ? 20 : [10, 40, 10]);
    view.selected = null;
    ui.hideCard();
    ui.update(state, opts());
  },
  onPan(dx, dy) { renderer.pan(state, dx, dy); },
  onPinch(cx, cy, f) { renderer.zoomAt(state, cx, cy, f); },
  onHover(x, y) { view.hover = x == null ? null : renderer.screenToCell(state, x, y); },
});

// Game clock. Ticks are counted off wall time so a slow frame never skips
// income, but never more than a few at once after a long sleep.
function advance(now) {
  if (paused()) { lastTickAt = now; return; }
  const ms = tickMs();
  let n = 0, left = 0, report = null;
  while (now - lastTickAt >= ms && n < 5) {
    lastTickAt += ms;
    const r = stepTick(state);
    left += r.left;
    if (r.report) report = r.report;
    renderer.onTick(state);
    n++;
    if (state.tick % AUTOSAVE_TICKS === 0) saveGame(state);
  }
  if (now - lastTickAt >= ms) lastTickAt = now; // drop the backlog
  if (n) ui.update(state, opts());
  if (left) ui.status(`${left} tenant${left > 1 ? 's' : ''} moved out: unhappy with the lifts.`);
  if (report) { saveGame(state); ui.showReport(report); }
  // Keep an open card current as the hours pass.
  if (n && view.selected && view.tool === 'inspect') {
    const st = state.structures.find(x => x.id === view.selected);
    if (st && TYPES[st.type].kind === 'unit' && state.service[st.id]) showCard(st);
  }
}

function frame(now) {
  advance(now);
  const phase = paused() ? 0 : Math.min(1, (now - lastTickAt) / tickMs());
  renderer.draw(state, view, now, phase);
  ui.frame(now);
  rafId = requestAnimationFrame(frame);
}

function onResize() {
  renderer.resize();
  renderer.pan(state, 0, 0); // re-clamp the camera to the new viewport
}
window.addEventListener('resize', onResize);

// The loop stops while the tab is hidden; the clock resumes from "now".
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    saveGame(state);
    cancelAnimationFrame(rafId); rafId = 0;
  } else if (!rafId) {
    lastTickAt = performance.now();
    rafId = requestAnimationFrame(frame);
  }
});
window.addEventListener('pagehide', () => saveGame(state));

renderer.resize();
renderer.recenter(state);
ui.update(state, opts());
ui.status(resumed ? 'Welcome back. Your tower was restored.' : 'Build stairs or a lift beside the lobby, then lease units above it.', true);
rafId = requestAnimationFrame(frame);

// Exposed for debugging and browser checks; the game never reads it.
window.skyrise = { get state() { return state; }, view, renderer };
