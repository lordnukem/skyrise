// Toolbar, HUD and menu. Knows the DOM; knows nothing about the simulation
// beyond the plain numbers it is handed. HUD numbers ease toward their
// targets in frame(); with prefers-reduced-motion they snap.

import {
  TYPES, TOOL_ORDER, HOURS_PER_DAY, DAYS_PER_WEEK, DAY_NAMES, LONG_PRESS_MS, STAR_POP, ELEVATOR_CAPACITY, STAIR_ONLY_CAPACITY,
  LIFT_CAR_COST, UNLOCK_AT, SPEEDS,
} from './constants.js';
import { approach, prefersReducedMotion } from './anim.js';

// Toolbar glyphs: flat PNGs generated for Skyrise (assets/art/, see LICENSE.md).
// Each is decorative, so the button's text label carries the meaning.
const ICON_FILES = {
  lobby: 'icon-lobby.png',
  stairs: 'icon-stairs.png',
  elevator: 'icon-lift.png',
  car: 'icon-lift.png',
  express: 'icon-express.png',
  office: 'icon-office.png',
  shop: 'icon-shop.png',
  flat: 'icon-flat.png',
  security: 'icon-security.png',
  food: 'icon-food.png',
  escalator: 'icon-escalator.png',
  floor: 'icon-floor.png',
  inspect: 'icon-inspect.png',
};
// Stand-in text for a glyph whose file is missing (decorative too: aria-hidden).
const GLYPH_TEXT = { food: 'FC', escalator: 'ESC', floor: 'FL' };
const iconHtml = (id) =>
  `<img class="glyph" src="assets/art/${ICON_FILES[id]}" alt="" width="256" height="256" decoding="async">`;
// Padlock overlay for locked tools; hidden until the file exists and the tool is locked.
const lockHtml = () => `<img class="lock" src="assets/art/icon-lock.png" alt="" width="128" height="128" decoding="async">`;
// Tools that are not structure types.
const TOOL_META = { car: { label: 'Add car', cost: LIFT_CAR_COST }, inspect: { label: 'Inspect' } };

export function createUI({ onTool, onMenu, onSpeed }) {
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
    const t = TYPES[id] || TOOL_META[id];
    const price = t.cost ? '$' + t.cost.toLocaleString() : 'tap a room';
    b.dataset.price = price;
    b.innerHTML = `${iconHtml(id)}${UNLOCK_AT[id] ? lockHtml() : ''}<span class="label">${t.label}</span><small>${price}</small>`;
    b.setAttribute('aria-label', t.w ? `${t.label}, ${t.w} by ${t.h}, costs $${t.cost}` : t.cost ? `${t.label}, costs $${t.cost}` : 'Inspect a room');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onTool(id));
    b.querySelector('.lock')?.addEventListener('error', (e) => { e.target.hidden = true; });
    b.querySelector('.glyph').addEventListener('error', (e) => {
      const alt = document.createElement('span');
      alt.className = 'glyph glyph-text';
      alt.setAttribute('aria-hidden', 'true');
      alt.textContent = GLYPH_TEXT[id] || t.label.slice(0, 2);
      e.target.replaceWith(alt);
    }, { once: true });
    toolbar.appendChild(b);
  }
  // Locked tools stay tappable (the status line explains); they just cannot place.
  let lastLockRating = -1;
  function setLocks(rating) {
    if (rating === lastLockRating) return;
    lastLockRating = rating;
    for (const b of toolbar.querySelectorAll('button')) {
      const need = UNLOCK_AT[b.dataset.tool];
      const locked = need > rating;
      b.classList.toggle('locked', locked);
      b.setAttribute('aria-disabled', String(locked));
      b.querySelector('small').textContent = locked ? `unlocks at ${need} stars` : b.dataset.price;
    }
  }

  // Speed stack: one button per SPEEDS entry; 0 is pause.
  const speedEl = $('speed');
  SPEEDS.forEach((n, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.speed = String(i);
    b.textContent = n ? `${n}×` : '⏸';
    b.setAttribute('aria-label', n ? `Speed ${n} times` : 'Pause');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onSpeed(i));
    speedEl.appendChild(b);
  });

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

  function update(state, { paused, theme, speed = 1 }) {
    setLocks(state.rating);
    for (const b of speedEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.speed === speed));
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
    const name = DAY_NAMES[(day - 1) % DAYS_PER_WEEK];
    clockEl.textContent = `Day ${day} ${name} ${String(hour).padStart(2, '0')}:00${paused ? ' · paused' : ''}`;
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

  // Inspect card and quarter report. Both take plain rows: [label, value, cls];
  // the card also takes actions: [{ label, onClick }].
  const card = $('card'), cardTitle = $('card-title'), cardRows = $('card-rows'), cardActions = $('card-actions');
  const report = $('report'), reportTitle = $('report-title'), reportRows = $('report-rows');
  function fillRows(dl, rows) {
    dl.replaceChildren();
    for (const [label, value, cls] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value; if (cls) dd.className = cls;
      if (cls === 'total') dt.className = 'total';
      dl.append(dt, dd);
    }
  }
  function showCard(title, rows, actions = []) {
    cardTitle.textContent = title;
    fillRows(cardRows, rows);
    cardActions.replaceChildren();
    for (const { label, onClick } of actions) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.addEventListener('click', onClick);
      cardActions.appendChild(b);
    }
    cardActions.hidden = !actions.length;
    card.hidden = false;
    statusEl.classList.remove('show');
  }
  function hideCard() { card.hidden = true; }
  $('card-close').addEventListener('click', hideCard);

  function showReport(r) {
    reportTitle.textContent = `Quarter ${r.quarter} report`;
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    fillRows(reportRows, [
      ['Office rent', money(r.income.office)],
      ['Shop takings', money(r.income.shop)],
      ['Flat sales', money(r.income.flat)],
      ['Food court takings', money(r.income.food || 0)],
      ['Upkeep', '-' + money(r.upkeep)],
      ['Net', (r.net >= 0 ? '+' : '') + money(r.net), 'total'],
      ['Moved out', String(r.left)],
      ['Stars', `${stars(r.starsBefore)} → ${stars(r.starsAfter)}`],
    ]);
    report.hidden = false;
    $('report-close').focus({ preventScroll: true });
  }
  $('report-close').addEventListener('click', () => { report.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !report.hidden) report.hidden = true;
  });

  return { setTool, status, update, frame, showCard, hideCard, showReport };
}
