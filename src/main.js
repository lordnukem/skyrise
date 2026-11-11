// Wires the pure simulation to the renderer, input and UI, and runs the clock.

import { TICK_MS, AUTOSAVE_TICKS, TYPES } from './constants.js';
import { newGame, place, demolish, structureAt, reachable, stepTick } from './sim.js';
import { createRenderer } from './render.js';
import { attachInput } from './input.js';
import { createUI } from './ui.js';
import { saveGame, loadGame, clearGame, loadTheme, saveTheme } from './storage.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

let theme = loadTheme() || '';           // '' = follow the OS
applyTheme(theme);

let state = loadGame();
const resumed = !!state;
if (!state) state = newGame();

const view = { tool: 'office', selected: null, hover: null };
let paused = false;
let lastTickAt = performance.now();

const ui = createUI({
  onTool(id) { view.tool = id; ui.setTool(id); view.selected = null; describeTool(id); },
  onMenu(action) {
    if (action === 'save') ui.status(saveGame(state) ? 'Saved.' : 'Could not save: storage unavailable.');
    if (action === 'pause') { paused = !paused; lastTickAt = performance.now(); ui.update(state, { paused, theme }); }
    if (action === 'theme') { theme = theme === '' ? 'light' : theme === 'light' ? 'dark' : ''; applyTheme(theme); saveTheme(theme); ui.update(state, { paused, theme }); }
    if (action === 'recenter') renderer.recenter(state);
    if (action === 'new') {
      if (!confirm('Start a new tower? The current one is erased.')) return;
      clearGame();
      state = newGame();
      view.selected = null;
      renderer.recenter(state);
      ui.status('New plot. Build stairs or a lift beside the lobby, then lease units above it.', true);
    }
  },
});
ui.setTool(view.tool);

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  renderer.refreshTheme();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderer.refreshTheme());

function describeTool(id) {
  const t = TYPES[id];
  if (!t) return ui.status('Inspect: tap any room to see how it is doing.');
  const extra = t.kind === 'unit' ? (t.rent ? `, $${t.rent}/hour when let` : ', earns per visitor') : t.upkeep ? `, $${t.upkeep}/hour upkeep` : '';
  ui.status(`${t.label}: ${t.w}x${t.h}, $${t.cost}${extra}.`);
}

function describe(st) {
  const t = TYPES[st.type];
  const reach = reachable(state).has(st.id);
  if (t.kind !== 'unit') return `${t.label} on floor ${st.floor}${reach ? '' : ' (no path to lobby)'}.`;
  if (!reach) return `${t.label}, floor ${st.floor}: no path to the lobby, so nobody comes.`;
  if (!st.occupied) return `${t.label}, floor ${st.floor}: vacant, waiting for a tenant.`;
  const take = t.rent + (t.perVisitor ? t.perVisitor * state.visitors : 0);
  return `${t.label}, floor ${st.floor}: let, ${t.people} people, $${take}/hour.`;
}

attachInput(canvas, {
  onTap(x, y) {
    const { col, floor } = renderer.screenToCell(state, x, y);
    if (view.tool === 'inspect') {
      const st = structureAt(state, col, floor);
      view.selected = st ? st.id : null;
      ui.status(st ? describe(st) : `Empty cell on floor ${floor}.`);
      return;
    }
    const res = place(state, view.tool, col, floor);
    if (res.ok) {
      const t = TYPES[view.tool];
      ui.status(`Built ${t.label} on floor ${floor} for $${t.cost}.`);
    } else {
      ui.status(res.reason + '.');
    }
    ui.update(state, { paused, theme });
  },
  onLongPress(x, y) {
    const { col, floor } = renderer.screenToCell(state, x, y);
    const st = structureAt(state, col, floor);
    if (!st) return ui.status('Nothing to demolish here.');
    const res = demolish(state, st.id);
    ui.status(res.ok ? `Demolished ${TYPES[st.type].label}, refunded $${res.refund}.` : res.reason + '.');
    if (navigator.vibrate) navigator.vibrate(res.ok ? 20 : [10, 40, 10]);
    view.selected = null;
    ui.update(state, { paused, theme });
  },
  onPan(dx, dy) { renderer.pan(state, dx, dy); },
  onPinch(cx, cy, f) { renderer.zoomAt(state, cx, cy, f); },
  onHover(x, y) { view.hover = x == null ? null : renderer.screenToCell(state, x, y); },
});

// Game clock. Ticks are counted off wall time so a slow frame never skips
// income, but never more than a few at once after a long sleep.
function advance(now) {
  if (paused || document.hidden) { lastTickAt = now; return; }
  let n = 0;
  while (now - lastTickAt >= TICK_MS && n < 5) {
    lastTickAt += TICK_MS;
    stepTick(state);
    n++;
    if (state.tick % AUTOSAVE_TICKS === 0) saveGame(state);
  }
  if (now - lastTickAt >= TICK_MS) lastTickAt = now; // drop the backlog
  if (n) ui.update(state, { paused, theme });
}

function frame(now) {
  advance(now);
  const phase = paused ? 0 : Math.min(1, (now - lastTickAt) / TICK_MS);
  renderer.draw(state, view, now, phase);
  requestAnimationFrame(frame);
}

function onResize() {
  renderer.resize();
  renderer.pan(state, 0, 0); // re-clamp the camera to the new viewport
}
window.addEventListener('resize', onResize);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(state); });
window.addEventListener('pagehide', () => saveGame(state));

renderer.resize();
renderer.recenter(state);
ui.update(state, { paused, theme });
ui.status(resumed ? 'Welcome back. Your tower was restored.' : 'Build stairs or a lift beside the lobby, then lease units above it.', true);
requestAnimationFrame(frame);

// Exposed for debugging and browser checks; the game never reads it.
window.skyrise = { get state() { return state; }, view, renderer };
