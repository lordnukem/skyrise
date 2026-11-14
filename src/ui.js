// Toolbar, HUD and menu. Knows the DOM; knows nothing about the simulation
// beyond the plain numbers it is handed. HUD numbers ease toward their
// targets in frame(); with prefers-reduced-motion they snap.

import {
  TYPES, TOOL_ORDER, HOURS_PER_DAY, DAYS_PER_WEEK, DAY_NAMES, LONG_PRESS_MS, STAR_POP, ELEVATOR_CAPACITY, STAIR_ONLY_CAPACITY,
  LIFT_CAR_COST, UNLOCK_AT, SPEEDS, DIG_COST, NAME_MAX, TOOLBAR_PER_ROW, TOOLBAR_CELL_PX, TOOLBAR_MAX_ROWS, TOOLBAR_COLLAPSE_BELOW,
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
  hotel: 'icon-hotel.png',
  housekeeping: 'icon-housekeeping.png',
  hall: 'icon-hall.png',
  parking: 'icon-parking.png',
  transit: 'icon-transit.png',
  servicelift: 'icon-service-lift.png',
  clinic: 'icon-clinic.png',
  plant: 'icon-plant.png',
  demolish: 'icon-demolish.png',
  landmark: 'icon-landmark.png',
};
// Stand-in text for a glyph whose file is missing (decorative too: aria-hidden).
const GLYPH_TEXT = {
  food: 'FC', escalator: 'ESC', floor: 'FL', dig: 'DIG', hotel: 'HTL', housekeeping: 'HK', hall: 'HAL',
  parking: 'P', transit: 'T', servicelift: 'SVC', clinic: '+', plant: 'PLT', demolish: 'DEM', landmark: 'SKY',
};
const textGlyph = (id, label) => `<span class="glyph glyph-text" aria-hidden="true">${GLYPH_TEXT[id] || label.slice(0, 2)}</span>`;
// A tool with no icon file gets its text glyph straight away, so nothing 404s.
const iconHtml = (id, label) => (ICON_FILES[id]
  ? `<img class="glyph" src="assets/art/${ICON_FILES[id]}" alt="" width="256" height="256" decoding="async">`
  : textGlyph(id, label));
// Padlock overlay for locked tools; hidden until the file exists and the tool is locked.
const lockHtml = () => `<img class="lock" src="assets/art/icon-lock.png" alt="" width="128" height="128" decoding="async">`;
// The clock's weather word (G-40).
const WEATHER_WORD = { clear: 'Clear', rain: 'Rain', wind: 'Windy', fog: 'Fog', snow: 'Snow' };
// Tools that are not structure types.
const TOOL_META = {
  car: { label: 'Add car', cost: LIFT_CAR_COST }, dig: { label: 'Dig', cost: DIG_COST }, inspect: { label: 'Inspect' },
  demolish: { label: 'Demolish', hint: 'half back', aria: 'Demolish: tap a structure, then confirm' },
};

// Whether the toolbar starts collapsed (G-42): the stored choice wins; otherwise a
// returning player on a narrow screen starts collapsed, and a first run starts open.
export function toolbarCollapsed(pref, firstRun, width) {
  if (pref === true || pref === false) return pref;
  return !firstRun && width < TOOLBAR_COLLAPSE_BELOW;
}

// Tools per toolbar row: TOOLBAR_PER_ROW at phone width, more on wider screens.
export const toolsPerRow = (width) => Math.max(TOOLBAR_PER_ROW, Math.floor(width / TOOLBAR_CELL_PX));

export function createUI({ onTool, onMenu, onSpeed, onStars, onGuideClose, onDraftCancel, onToolbar, onOver, collapsed = false }) {
  const $ = (id) => document.getElementById(id);
  const toolbar = $('toolbar');
  const statusEl = $('status');
  const menu = $('menu');
  const menuBtn = $('btn-menu');
  const cashEl = $('stat-cash'), popEl = $('stat-pop'), netEl = $('stat-net'), clockEl = $('stat-clock');
  const starsOn = $('stars-on'), starsOff = $('stars-off'), starsEl = $('stat-stars'), crownEl = $('stat-crown');
  let statusTimer = null, statusClear = null;

  // Displayed (eased) values versus targets.
  const shown = { cash: 0, pop: 0 };
  const target = { cash: 0, pop: 0 };
  let lastRating = -1, lastFrame = 0, lastCash = null;

  for (const id of [...TOOL_ORDER, 'inspect', 'demolish']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tool = id;
    const t = TYPES[id] || TOOL_META[id];
    const price = t.cost ? '$' + t.cost.toLocaleString() : t.hint || 'tap a room';
    b.dataset.price = price;
    b.innerHTML = `${iconHtml(id, t.label)}${UNLOCK_AT[id] ? lockHtml() : ''}<span class="label">${t.label}</span><small>${price}</small>`;
    b.setAttribute('aria-label', t.w ? `${t.label}, ${t.w} by ${t.h}, costs $${t.cost}` : t.cost ? `${t.label}, costs $${t.cost}` : t.aria || 'Inspect a room');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onTool(id));
    b.querySelector('.lock')?.addEventListener('error', (e) => { e.target.hidden = true; });
    b.querySelector('img.glyph')?.addEventListener('error', (e) => {
      const alt = document.createElement('span');
      alt.className = 'glyph glyph-text';
      alt.setAttribute('aria-hidden', 'true');
      alt.textContent = GLYPH_TEXT[id] || t.label.slice(0, 2);
      e.target.replaceWith(alt);
    }, { once: true });
    toolbar.appendChild(b);
  }
  // Draft label (G-43): "Tap again to build $X" with a Cancel chip; hidden with no draft.
  const draftBar = document.createElement('div');
  draftBar.className = 'draft-bar'; draftBar.id = 'draft-bar'; draftBar.hidden = true;
  draftBar.setAttribute('role', 'status');
  const draftText = document.createElement('span');
  const draftCancel = document.createElement('button');
  draftCancel.type = 'button'; draftCancel.className = 'chip'; draftCancel.textContent = 'Cancel';
  draftCancel.addEventListener('click', () => onDraftCancel?.());
  draftBar.append(draftText, draftCancel);
  toolbar.prepend(draftBar);
  // Chevron (G-42): collapses the toolbar to the selected tool, and expands it again.
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'tb-toggle'; toggle.id = 'tb-toggle';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  draftBar.after(toggle);
  function setCollapsed(on) {
    collapsed = on;
    toolbar.classList.toggle('collapsed', on);
    toggle.setAttribute('aria-expanded', String(!on));
    toggle.setAttribute('aria-label', on ? 'Show all tools' : 'Show only the selected tool');
  }
  toggle.addEventListener('click', () => { setCollapsed(!collapsed); onToolbar?.(collapsed); });
  function layoutToolbar() {
    toolbar.style.setProperty('--per-row', String(toolsPerRow(toolbar.clientWidth)));
    toolbar.style.setProperty('--max-rows', String(TOOLBAR_MAX_ROWS));
  }
  setCollapsed(collapsed);
  layoutToolbar();
  window.addEventListener('resize', layoutToolbar);
  function draft(text) {
    draftBar.hidden = text == null;
    if (text != null && draftText.textContent !== text) draftText.textContent = text;
  }
  // Locked tools stay tappable (the status line explains); they just cannot place.
  let lastLockRating = -1;
  function setLocks(rating) {
    if (rating === lastLockRating) return;
    lastLockRating = rating;
    for (const b of toolbar.querySelectorAll('button[data-tool]')) {
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

  // The stars open the tower sheet.
  starsEl.addEventListener('click', () => onStars?.());
  starsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStars?.(); } });

  $('help').textContent =
    `Tap to build, drag to pan, pinch to zoom, hold ${(LONG_PRESS_MS / 1000).toFixed(1)} s (or use Demolish) to remove. ` +
    `Units earn only with a path to the lobby. Stars at ${STAR_POP.join(', ')} people; ` +
    `stairs alone carry ${STAIR_ONLY_CAPACITY}, each lift shaft ${ELEVATOR_CAPACITY}.`;

  function setTool(id) {
    for (const b of toolbar.querySelectorAll('button[data-tool]')) {
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

  function update(state, { paused, theme, speed = 1, weather = 'clear' }) {
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
    const crowned = state.wonAt != null;                     // G-28: the landmark crown
    if (crownEl.hidden === crowned) {
      crownEl.hidden = !crowned;
      starsEl.setAttribute('aria-label', `${state.rating} of 5 stars${crowned ? ', crowned' : ''}`);
    }
    const day = Math.floor(state.tick / HOURS_PER_DAY) + 1;
    const hour = state.tick % HOURS_PER_DAY;
    const name = DAY_NAMES[(day - 1) % DAYS_PER_WEEK];
    clockEl.textContent = `Day ${day} ${name} ${String(hour).padStart(2, '0')}:00 · ${WEATHER_WORD[weather] || 'Clear'}${paused ? ' · paused' : ''}`;
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
  // Actions: [{ label, onClick, danger, armMs }]. An armed action ignores taps for
  // armMs after the card opens, so a double tap cannot land on it.
  let editing = false;
  function showCard(title, rows, actions = []) {
    editing = false;
    cardTitle.replaceChildren(title);
    fillRows(cardRows, rows);
    cardActions.replaceChildren();
    const opened = performance.now();
    for (const { label, onClick, danger, armMs = 0 } of actions) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      if (danger) b.className = 'danger';
      if (armMs) {
        b.setAttribute('aria-disabled', 'true');
        setTimeout(() => b.removeAttribute('aria-disabled'), armMs);
      }
      b.addEventListener('click', (e) => { if (performance.now() - opened >= armMs) onClick(e); });
      cardActions.appendChild(b);
    }
    cardActions.hidden = !actions.length;
    card.hidden = false;
    statusEl.classList.remove('show');
  }
  // Swap the card title for a name field with Save and Cancel. Enter saves,
  // Escape cancels; the typed text reaches the page only as an input value.
  function editTitle(current, onSave, onCancel) {
    editing = true;
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = NAME_MAX; input.value = current || '';
    input.className = 'name-input'; input.setAttribute('aria-label', 'Name'); input.autocomplete = 'off';
    cardTitle.replaceChildren(input);
    const done = (save) => { if (!editing) return; editing = false; save ? onSave(input.value) : onCancel(); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    });
    cardActions.replaceChildren();
    for (const [label, save] of [['Save', true], ['Cancel', false]]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => done(save));
      cardActions.appendChild(b);
    }
    cardActions.hidden = false;
    input.focus({ preventScroll: true });
    input.select();
  }
  function hideCard() { card.hidden = true; editing = false; }
  $('card-close').addEventListener('click', hideCard);

  // Tower sheet: population rows, the next star's needs (met or missing) and the mini map.
  const towerSheet = $('tower');
  function showTower(title, rows, needsTitle, needs) {
    $('tower-title').textContent = title;
    fillRows($('tower-rows'), rows);
    $('needs-title').textContent = needsTitle;
    const ul = $('tower-needs');
    ul.replaceChildren();
    for (const n of needs) {
      const li = document.createElement('li');
      li.className = n.met ? 'met' : 'missing';
      li.textContent = `${n.met ? '✓' : '✗'} ${n.label}`;
      li.setAttribute('aria-label', `${n.met ? 'Met' : 'Missing'}: ${n.label}`);
      ul.appendChild(li);
    }
    if (towerSheet.hidden) towerSheet.scrollTop = 0;   // a fresh open starts at the top; hourly refreshes keep the scroll
    towerSheet.hidden = false;
  }
  const towerOpen = () => !towerSheet.hidden;
  $('tower-close').addEventListener('click', () => { towerSheet.hidden = true; });

  // Towers sheet: one row per slot, each [{ label, onClick, danger, disabled }].
  const towersSheet = $('towers');
  function showTowers(slots) {
    const list = $('slot-list');
    list.replaceChildren();
    for (const { title, detail, actions } of slots) {
      const row = document.createElement('div'); row.className = 'slot';
      const head = document.createElement('div'); head.className = 'slot-head';
      const strong = document.createElement('strong'); strong.textContent = title;
      const small = document.createElement('small'); small.textContent = detail;
      head.append(strong, small);
      const btns = document.createElement('div'); btns.className = 'slot-actions';
      for (const a of actions) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label;
        if (a.danger) b.className = 'danger';
        b.disabled = !!a.disabled;
        b.addEventListener('click', a.onClick);
        btns.appendChild(b);
      }
      row.append(head, btns);
      list.appendChild(row);
    }
    towersSheet.hidden = false;
  }
  const hideTowers = () => { towersSheet.hidden = true; };
  $('towers-close').addEventListener('click', hideTowers);

  // First-run guide banner: shows `text`, or hides on null.
  const guideEl = $('guide'), guideText = $('guide-text');
  $('guide-close').addEventListener('click', () => { guideEl.hidden = true; onGuideClose?.(); });
  function guide(text) {
    if (text == null) { guideEl.hidden = true; return; }
    if (guideText.textContent !== text) guideText.textContent = text;
    guideEl.hidden = false;
  }

  function showReport(r) {
    reportTitle.textContent = `Quarter ${r.quarter} report`;
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    fillRows(reportRows, [
      ['Office rent', money(r.income.office)],
      ['Shop takings', money(r.income.shop)],
      ['Flat sales', money(r.income.flat)],
      ['Food court takings', money(r.income.food || 0)],
      ['Hotel rooms', money(r.income.hotel || 0)],
      ['Event hall', money(r.income.hall || 0)],
      ['Upkeep', '-' + money(r.upkeep)],
      ['Net', (r.net >= 0 ? '+' : '') + money(r.net), 'total'],
      ['Moved out', String(r.left)],
      ['Stars', `${stars(r.starsBefore)} → ${stars(r.starsAfter)}`],
    ]);
    // G-29: the loan rows show only while one is open or was taken.
    const rows = [];
    if (r.loan) rows.push(['Loan repaid', '-' + money(r.loan)]);
    if (r.borrowed) rows.push(['Loan taken', money(r.borrowed), 'poor']);
    if (r.owed) rows.push(['Still owed', money(r.owed), 'fair']);
    if (r.over) rows.push(['Below $0 with a loan open', 'game over', 'poor']);
    for (const [label, value, cls] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value; if (cls) dd.className = cls;
      reportRows.append(dt, dd);
    }
    report.hidden = false;
    $('report-close').focus({ preventScroll: true });
  }
  $('report-close').addEventListener('click', () => { report.hidden = true; });

  // Win sheet (G-28): shown once when the landmark crowns the tower.
  const winSheet = $('win');
  function showWin(text) {
    $('win-text').textContent = text;
    winSheet.hidden = false;
    $('win-close').focus({ preventScroll: true });
  }
  $('win-close').addEventListener('click', () => { winSheet.hidden = true; });
  // Game-over sheet (G-29): no close; the player loads another tower or starts afresh.
  const overSheet = $('over');
  function showOver(text) {
    $('over-text').textContent = text;
    overSheet.hidden = false;
    $('over-load').focus({ preventScroll: true });
  }
  const hideOver = () => { overSheet.hidden = true; };
  $('over-load').addEventListener('click', () => { hideOver(); onOver?.('towers'); });
  $('over-new').addEventListener('click', () => { hideOver(); onOver?.('new'); });
  const sheetOpen = () => [report, towerSheet, towersSheet, winSheet, overSheet].some(el => !el.hidden);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!report.hidden) report.hidden = true;
    else if (!winSheet.hidden) winSheet.hidden = true;
    else if (!towersSheet.hidden) hideTowers();
    else if (!towerSheet.hidden) towerSheet.hidden = true;
  });

  return {
    setTool, draft, status, update, frame, showCard, hideCard, showReport, editTitle, isEditing: () => editing,
    showTower, towerOpen, showTowers, hideTowers, guide, showWin, showOver, hideOver, sheetOpen,
  };
}
