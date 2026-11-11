// Toolbar, HUD and menu. Knows the DOM; knows nothing about the simulation
// beyond the plain numbers it is handed. HUD numbers ease toward their
// targets in frame(); with prefers-reduced-motion they snap.

import { TYPES, TOOL_ORDER, HOURS_PER_DAY, LONG_PRESS_MS, STAR_POP, ELEVATOR_CAPACITY, STAIR_ONLY_CAPACITY } from './constants.js';
import { approach, prefersReducedMotion } from './anim.js';

// Toolbar glyphs: flat PNGs generated for Skyrise (assets/art/, see LICENSE.md).
// Each is decorative, so the button's text label carries the meaning.
const ICON_FILES = {
  lobby: 'icon-lobby.png',
  stairs: 'icon-stairs.png',
  elevator: 'icon-lift.png',
  office: 'icon-office.png',
  shop: 'icon-shop.png',
  flat: 'icon-flat.png',
  inspect: 'icon-inspect.png',
};
const iconHtml = (id) =>
  `<img class="glyph" src="assets/art/${ICON_FILES[id]}" alt="" width="256" height="256" decoding="async">`;

export function createUI({ onTool, onMenu }) {
  const $ = (id) => document.getElementById(id);
  const toolbar = $('toolbar');
  const statusEl = $('status');
  const menu = $('menu');
  const menuBtn = $('btn-menu');
  const cashEl = $('stat-cash'), popEl = $('stat-pop'), netEl = $('stat-net'), clockEl = $('stat-clock');
  const starsOn = $('stars-on'), starsOff = $('stars-off'), starsEl = $('stat-stars');
  let statusTimer = null, statusClear = null;

  // Displayed (eased) values versus targets.
  const shown = { cash: 0, pop: 0 };
  const target = { cash: 0, pop: 0 };
  let lastRating = -1, lastFrame = 0, lastCash = null;

  for (const id of [...TOOL_ORDER, 'inspect']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tool = id;
    const t = TYPES[id];
    b.innerHTML = `${iconHtml(id)}<span class="label">${t ? t.label : 'Inspect'}</span><small>${t ? '$' + t.cost.toLocaleString() : 'tap a room'}</small>`;
    b.setAttribute('aria-label', t ? `${t.label}, ${t.w} by ${t.h}, costs $${t.cost}` : 'Inspect a room');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onTool(id));
    toolbar.appendChild(b);
  }

  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button')?.focus({ preventScroll: true });
  }
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    onMenu(action);
    if (action !== 'theme' && action !== 'pause') setMenu(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); }
  });

  $('help').textContent =
    `Tap to build, drag to pan, pinch to zoom, hold ${(LONG_PRESS_MS / 1000).toFixed(1)} s to demolish. ` +
    `Units earn only with a path to the lobby. Stars at ${STAR_POP.join(', ')} people; ` +
    `stairs alone carry ${STAIR_ONLY_CAPACITY}, each lift shaft ${ELEVATOR_CAPACITY}.`;

  function setTool(id) {
    for (const b of toolbar.querySelectorAll('button')) {
      const on = b.dataset.tool === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // Toast-style status: fades in, holds, fades out. Sticky messages stay.
  function status(msg, sticky = false) {
    clearTimeout(statusTimer); clearTimeout(statusClear);
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    if (!sticky) statusTimer = setTimeout(() => {
      statusEl.classList.remove('show');
      statusClear = setTimeout(() => { if (!statusEl.classList.contains('show')) statusEl.textContent = ''; }, 260);
    }, 4000);
  }

  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();

  function update(state, { paused, theme }) {
    target.cash = state.cash;
    target.pop = state.population;
    if (lastCash !== null && state.cash !== lastCash) flash(cashEl, state.cash > lastCash ? 'up' : 'down');
    lastCash = state.cash;
    const net = state.lastNet || 0;
    netEl.textContent = (net >= 0 ? '+' : '') + money(net) + '/h';
    netEl.classList.toggle('negative', net < 0);
    if (state.rating !== lastRating) {
      starsOn.textContent = '★'.repeat(state.rating);
      starsOff.textContent = '☆'.repeat(5 - state.rating);
      starsEl.setAttribute('aria-label', `${state.rating} of 5 stars`);
      if (lastRating !== -1) bump(starsEl, state.rating > lastRating ? 'up' : 'down');
      lastRating = state.rating;
    }
    const day = Math.floor(state.tick / HOURS_PER_DAY) + 1;
    const hour = state.tick % HOURS_PER_DAY;
    clockEl.textContent = `Day ${day} ${String(hour).padStart(2, '0')}:00${paused ? ' · paused' : ''}`;
    menu.querySelector('[data-action="pause"]').textContent = paused ? 'Resume' : 'Pause';
    menu.querySelector('[data-action="theme"]').textContent = `Theme: ${theme || 'auto'}`;
    if (prefersReducedMotion()) { shown.cash = target.cash; shown.pop = target.pop; paint(); }
  }

  // Called every animation frame by main; eases the counters.
  function frame(now) {
    const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
    lastFrame = now;
    if (shown.cash === target.cash && shown.pop === target.pop) return;
    if (prefersReducedMotion()) { shown.cash = target.cash; shown.pop = target.pop; }
    else {
      shown.cash = approach(shown.cash, target.cash, dt, 120, 0.5);
      shown.pop = approach(shown.pop, target.pop, dt, 90, 0.5);
    }
    paint();
  }
  function paint() {
    cashEl.textContent = money(shown.cash);
    cashEl.classList.toggle('negative', shown.cash < 0);
    popEl.textContent = `${Math.round(shown.pop)} ppl`;
  }

  function flash(el, dir) { restartClass(el, 'flash-' + dir); }
  function bump(el, dir) { restartClass(el, 'bump-' + dir); }
  function restartClass(el, cls) {
    el.classList.remove('flash-up', 'flash-down', 'bump-up', 'bump-down');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }
  for (const el of [cashEl, starsEl]) el.addEventListener('animationend', () => el.classList.remove('flash-up', 'flash-down', 'bump-up', 'bump-down'));

  return { setTool, status, update, frame };
}
