// Wires the pure simulation to the renderer, input and UI, and runs the clock.

import {
  TICK_MS, AUTOSAVE_TICKS, TYPES, DEMAND, WAIT_BUSY, SPEEDS, UNLOCK_AT, LIFT_CAR_COST, RENT_LEVELS, WALK_STEPS, FOOD_RANGE, ESCALATOR_WALK,
  DIG_COST, BASEMENT_LEVELS, HOTEL_CHECKIN, HOTEL_CHECKOUT, TRANSIT_VISITORS, CONFIRM_ARM_MS, SLOT_COUNT, GUIDE_OFFICES,
  FESTIVAL_REFRESH_MS,
} from './constants.js';
import {
  newGame, place, demolish, structureAt, reachable, happyBand, addCar, cycleRent, takeOf, priceOf, shaftsOf, isUnlocked,
  stepHour, stepWalkers, walkerStepsDone, toggleStop, dig, floorName, nightlyOf, LOWEST_FLOOR,
  previewDemolish, renameUnit, starNeeds, guideGoals,
} from './sim.js';
import { nameOf, tenantOf } from './tenants.js';
import { draftTap } from './draft.js';
import { festivalsOn, fireworksNight, weatherAt, parseOverrides, GREETINGS } from './seasons.js';
import { createRenderer } from './render.js';
import { attachInput } from './input.js';
import { createUI, toolbarCollapsed } from './ui.js';
import {
  saveGame, loadGame, clearGame, loadTheme, saveTheme, activeSlot, setActiveSlot, slotInfo, exportTower, importTower,
  guideDismissed, dismissGuide, loadToolbar, saveToolbar, greetedOn, markGreeted,
} from './storage.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

const THEME_BG = { light: '#eef1f5', dark: '#0f141c' };
let theme = loadTheme() || '';           // '' = follow the OS
applyTheme(theme);

let state = loadGame();
const resumed = !!state;
if (!state) state = newGame();

const view = { tool: 'office', selected: null, hover: null, draft: null, // draft: UI only, never in state (G-43)
  festivals: [], fireworks: false, weather: 'clear' };                 // visual only (G-40, G-41), never saved

// Dev overrides (?date=, ?festival=, ?weather=), parsed once; harmless in production.
const overrides = parseOverrides(location.search);
// Festivals follow the device date, re-read every FESTIVAL_REFRESH_MS. Returns a greeting
// the first time a festival day is seen on this device, otherwise ''.
function refreshSeason() {
  const date = overrides.date || new Date();
  view.festivals = overrides.festivals || festivalsOn(date);
  view.fireworks = overrides.festivals ? view.festivals.some(f => f === 'newyear' || f === 'cny' || f === 'merdeka')
    : fireworksNight(date, view.festivals);
  if (!view.festivals.length) return '';
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (greetedOn(day)) return '';
  markGreeted(day);
  return view.festivals.map(f => (f === 'merdeka' && date.getMonth() === 8 && date.getDate() === 16 ? 'Selamat Hari Malaysia!' : GREETINGS[f])).join(' ');
}
const firstGreeting = refreshSeason();
setInterval(() => { const g = refreshSeason(); if (g) ui.status(g); }, FESTIVAL_REFRESH_MS);
const weatherNow = () => overrides.weather || weatherAt(state.tick, view.festivals);
view.weather = weatherNow();
let cardMode = null;                     // 'inspect' while an inspect card is open (it refreshes each hour), 'confirm' for demolish
let speed = 1, runSpeed = 1;             // index into SPEEDS; runSpeed is the last non-zero one
const paused = () => SPEEDS[speed] === 0;
const tickMs = () => TICK_MS / SPEEDS[speed];
const opts = () => ({ paused: paused(), theme, speed, weather: weatherNow() });
let lastTickAt = performance.now();
let rafId = 0;

function setSpeed(i) {
  speed = i;
  if (SPEEDS[i]) runSpeed = i;
  lastTickAt = performance.now();
  ui.update(state, opts());
}

const ui = createUI({
  onTool(id) {
    // Tapping the selected tool again cancels its draft; another tool clears it too.
    if (id === view.tool && view.draft) { setDraft(null); return ui.status('Draft cancelled.'); }
    view.tool = id; ui.setTool(id); setDraft(null); closeCard(); describeTool(id);
  },
  onDraftCancel() { setDraft(null); ui.status('Draft cancelled.'); },
  onToolbar(collapsed) { saveToolbar(collapsed); requestAnimationFrame(onResize); },
  collapsed: toolbarCollapsed(loadToolbar(), !resumed, window.innerWidth),
  onSpeed: setSpeed,
  onStars() { openTowerSheet(); },
  onGuideClose() { dismissGuide(); },
  onMenu(action) {
    if (action === 'save') ui.status(saveGame(state) ? `Saved to slot ${activeSlot()}.` : 'Could not save: storage unavailable.');
    if (action === 'tower') openTowerSheet();
    if (action === 'towers') openTowersSheet();
    if (action === 'pause') setSpeed(paused() ? runSpeed : 0);
    if (action === 'theme') { theme = theme === '' ? 'light' : theme === 'light' ? 'dark' : ''; applyTheme(theme); saveTheme(theme); ui.update(state, opts()); }
    if (action === 'recenter') renderer.recenter(state);
    if (action === 'new') {
      if (!confirm('Start a new tower? The current one is erased.')) return;
      clearGame();
      switchTo(newGame());
      ui.status('New plot. Build stairs or a lift beside the lobby, then lease units above it.', true);
    }
  },
});

function closeCard() { view.selected = null; cardMode = null; ui.hideCard(); }

// The placement draft (G-43): shown on the canvas and as a label in the toolbar.
function setDraft(d) {
  view.draft = d;
  ui.draft(d ? `Tap again to build $${d.cost.toLocaleString()}` : null);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view.draft) setDraft(null); });

// Swap in another tower (a slot, an import or a new plot).
function switchTo(next) {
  state = next;
  setDraft(null);
  closeCard();
  renderer.reset();
  renderer.recenter(state);
  ui.update(state, opts());
  updateGuide();
}
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
  if (id === 'dig') return ui.status(state.dug >= BASEMENT_LEVELS ? `Dig: all ${BASEMENT_LEVELS} basement levels are dug.`
    : `Dig: tap ${floorName(-state.dug)} below the ground, $${DIG_COST.toLocaleString()} a level. Each level needs the one above it.`);
  if (id === 'demolish') return ui.status('Demolish: tap a structure to see its refund, then confirm. Half the cost back; a sold flat gives none.');
  if (!t) return ui.status('Inspect: tap any room to see how it is doing.');
  if (!isUnlocked(state, id)) return ui.status(`${t.label}: unlocks at ${UNLOCK_AT[id]} stars.`);
  const extra = t.kind === 'unit' ? (t.price ? `, sells for $${t.price.toLocaleString()}` : t.rent ? `, $${t.rent}/hour when let`
    : t.nightly ? `, $${t.nightly} a night` : t.perGuest ? ', earns per guest' : t.perDiner ? ', earns per diner' : ', earns per visitor')
    : t.upkeep ? `, $${t.upkeep}/hour upkeep` : '';
  const note = id === 'express' ? ' Stops only at lobbies.' : id === 'security' ? ' Needed for 3 stars.'
    : id === 'food' ? ` Feeds lunch and dinner crowds from ${FOOD_RANGE} floors around it.`
    : id === 'escalator' ? ` Joins two floors; climbing it costs ${ESCALATOR_WALK * 100}% of a flight of stairs.`
    : id === 'floor' ? ' A bare slab: build on it later. It may hang beside a building to span a gap.'
    : id === 'hotel' ? ` Guests check in ${HOTEL_CHECKIN[0]}-${HOTEL_CHECKIN[1]}h, pay at checkout ${String(HOTEL_CHECKOUT[0]).padStart(2, '0')}-${HOTEL_CHECKOUT[1]}h and leave it dirty.`
    : id === 'housekeeping' ? ` Cleans hotel rooms within ${t.range} floors; give it a service lift.`
    : id === 'servicelift' ? ' Staff only: keeps housekeeping out of the guest lifts.'
    : id === 'hall' ? ' Events on weekday evenings and weekend afternoons.'
    : id === 'parking' ? ` Basement only. ${t.spaces} spaces: offices and flats with one are happier.`
    : id === 'transit' ? ` Basement only. Brings ${TRANSIT_VISITORS} visitors; needed for 5 stars.`
    : id === 'clinic' || id === 'plant' ? ` Lifts happiness within ${t.range} floors; needed for 4 stars.`
    : t.span ? ` Climbs up to ${t.span} floors. Inspect a stop to close it.` : '';
  ui.status(`${t.label}: ${t.w}x${t.h}, $${t.cost.toLocaleString()}${extra}.${note}`);
}

function describe(st) {
  const t = TYPES[st.type];
  const reach = reachable(state).has(st.id);
  const path = reach ? '' : ' (no path to lobby)';
  if (t.span) {
    const sh = shaftsOf(state).find(x => x.col === st.col && x.lo <= st.floor && st.floor <= x.hi);
    return `${t.label} shaft, ${sh.lo < 1 ? `${floorName(sh.lo)} to ${sh.hi}` : `floors ${sh.lo}-${sh.hi}`}, ${sh.cars} car${sh.cars > 1 ? 's' : ''}${path}.`;
  }
  if (t.range) return `${t.label} on ${floorName(st.floor)}: covers ${floorName(Math.max(LOWEST_FLOOR, st.floor - t.range))} to ${floorName(Math.min(state.maxFloors, st.floor + t.range))}${path}.`;
  if (t.spaces) {
    let used = 0;
    for (const v of state.perks.values()) if (v[0] === 'parking') used++;
    const parks = state.structures.filter(x => x.type === 'parking' && reachable(state).has(x.id)).length;
    return `${t.label} on ${floorName(st.floor)}: ${t.spaces} spaces; ${used} of ${parks * t.spaces} taken across the tower${path}.`;
  }
  if (t.kind !== 'unit') return `${t.label} on ${floorName(st.floor)}${path}.`;
  if (!reach) return `${t.label}, ${floorName(st.floor)}: no path to the lobby, so nobody comes.`;
  if (!st.occupied) return `${t.label}, ${floorName(st.floor)}: vacant, waiting for a tenant.`;
  return `${t.label}, ${floorName(st.floor)}: let, ${t.people} people, $${takeOf(state, st)}/hour.`;
}

// The inspect card for a reachable unit: happiness, why, rent and people.
function showCard(st) {
  const t = TYPES[st.type];
  const sv = state.service[st.id];
  const band = happyBand(st.happy);
  const peak = DEMAND[st.type] ? DEMAND[st.type].peak : DEMAND.office.peak;
  const walk = Math.round(sv.walk * 10) / 10;   // escalator floors count a fraction
  const cleaner = state.cleaners.get(st.id);
  const why = sv.walk > 0 ? `${walk} floor${walk === 1 ? '' : 's'} by stairs`
    : sv.peak >= WAIT_BUSY ? `Lift busy at ${String(peak).padStart(2, '0')}:00`
    : state.noisy.has(st.id) ? 'Noisy neighbours'
    : cleaner?.guestLift ? 'Staff use the guest lift'
    : 'Lift keeps up';
  const money = t.price ? ['Sale', st.sold ? `sold $${priceOf(st).toLocaleString()}` : `asking $${priceOf(st).toLocaleString()}`]
    : t.nightly ? ['Per night', `$${nightlyOf(st)}`]
    : [t.perVisitor || t.perDiner || t.perGuest ? 'Takings' : 'Rent', st.occupied ? `$${takeOf(state, st)}/h` : 'vacant'];
  const rows = [
    ['Happiness', `${band[0].toUpperCase()}${band.slice(1)} · ${Math.round(st.happy)}`, band],
    ['Why', why, 'wide'],
    money,
  ];
  if (t.nightly) {
    // A hotel room: guests in, dirty (waiting for housekeeping) or clean and free.
    rows.push(['Room', st.occupied ? 'guests in' : st.dirty ? 'dirty' : 'clean', st.dirty ? 'poor' : '']);
    if (st.dirty && !cleaner) rows.push(['Cleaner', `none within ${TYPES.housekeeping.range} floors`, 'poor']);
    rows.push(['Guests', st.occupied ? String(t.guests) : '0']);
  } else {
    rows.push(['People', st.occupied ? String(t.people) : '0']);
  }
  const perks = state.perks.get(st.id);
  if (perks) rows.push(['Extras', perks.map(p => (p === 'parking' ? 'parking space' : p === 'plant' ? 'plant room' : p)).join(', '), 'wide']);
  // The title is the tenant's name; a vacant unit has none (hotel rooms keep theirs).
  const named = st.occupied || t.nightly;
  const biz = tenantOf(st);
  rows.unshift([`${t.label}, ${floorName(st.floor)}`, named && biz && !t.nightly && st.type !== 'flat' ? biz.label : '']);
  const actions = [{ label: `Rent: ${RENT_LEVELS[st.rentLevel].label}`, onClick() { cycleRent(state, st.id); showCard(st); } }];
  if (named) actions.push({ label: 'Rename', onClick() { renameCard(st); } });
  cardMode = 'inspect';
  ui.showCard(named ? nameOf(st) : `${t.label} to let`, rows, actions);
}

function renameCard(st) {
  ui.editTitle(st.name || nameOf(st), (text) => {
    const res = renameUnit(state, st.id, text);
    if (res.ok) { saveGame(state); ui.status(res.name ? `Renamed to ${res.name}.` : 'Name reset.'); }
    showCard(st);
  }, () => showCard(st));
}

// What the confirm card and the toast call a structure.
function nameFor(st) {
  const t = TYPES[st.type];
  if (t.kind === 'unit' && (st.occupied || t.nightly)) return nameOf(st);
  return `${t.label} on ${floorName(st.floor)}`;
}

// Demolish goes through one confirm card, from the tool or a long-press. Nothing
// is removed until Demolish is tapped, and it ignores taps for CONFIRM_ARM_MS.
function openConfirm(st) {
  const pre = previewDemolish(state, st.id);
  if (!pre.ok) {
    ui.status(pre.reason + '.');
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
    return;
  }
  const t = TYPES[st.type];
  const who = pre.evicted ? `${pre.evicted} ${t.guests ? 'guest' : 'people'}${t.guests && pre.evicted > 1 ? 's' : ''}` : pre.occupied ? 'the tenant' : 'nobody';
  const rows = [
    ['Refund', `$${pre.refund.toLocaleString()}`, pre.refund ? '' : 'poor'],
    ['Moving out', who, pre.occupied ? 'fair' : ''],
  ];
  if (st.type === 'flat' && st.sold) rows.push(['Sold flat', 'the owner paid for it: no refund', 'wide']);
  if (pre.cut.length) rows.push(['Cut off', `${pre.cut.length} unit${pre.cut.length > 1 ? 's' : ''} lose${pre.cut.length > 1 ? '' : 's'} their path to the lobby`, 'poor']);
  view.selected = st.id;
  cardMode = 'confirm';
  ui.showCard(`Demolish ${nameFor(st)}?`, rows, [
    { label: 'Demolish', danger: true, armMs: CONFIRM_ARM_MS, onClick() { doDemolish(st); } },
    { label: 'Keep', onClick() { closeCard(); } },
  ]);
}

function doDemolish(st) {
  const label = nameFor(st);
  const res = demolish(state, st.id);
  if (res.ok) renderer.onDemolished(state, st);
  ui.status(res.ok ? `Demolished ${label}, refunded $${res.refund.toLocaleString()}.${res.evicted ? ` ${res.evicted} ${res.evicted > 1 ? 'people' : 'person'} moved out.` : ''}` : res.reason + '.');
  if (navigator.vibrate) navigator.vibrate(res.ok ? 20 : [10, 40, 10]);
  closeCard();
  ui.update(state, opts());
}

// Tower sheet: population by type, the next star's needs, and the mini map.
function openTowerSheet() {
  const reach = reachable(state);
  const rows = [['Population', `${state.population} people`, 'total']];
  for (const type of Object.keys(TYPES)) {
    const t = TYPES[type];
    if (t.kind !== 'unit') continue;
    const all = state.structures.filter(x => x.type === type);
    if (!all.length) continue;
    const let_ = all.filter(x => x.occupied).length;
    const people = let_ * (t.people || 0);
    rows.push([t.label, `${let_} of ${all.length} ${t.nightly ? 'full' : 'let'}${people ? ` · ${people} ppl` : ''}${all.some(x => !reach.has(x.id)) ? ' · some cut off' : ''}`]);
  }
  rows.push(['Visitors', String(state.visitors)]);
  const { next, needs } = starNeeds(state);
  ui.showTower(`Your tower ${'★'.repeat(state.rating)}${'☆'.repeat(5 - state.rating)}`, rows,
    next ? `For ${next} stars` : 'Five stars: every need is met', needs);
  renderer.paintMiniMap(document.getElementById('minimap'), state);
}

// Towers sheet: three slots, plus export and import of a file.
function openTowersSheet() {
  const active = activeSlot();
  saveGame(state);                         // the active row shows the tower as it is now
  const slots = [];
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const info = slotInfo(n);
    const detail = info ? `${'★'.repeat(info.rating)}${'☆'.repeat(5 - info.rating)} · Day ${info.day} · $${Math.round(info.cash).toLocaleString()}` +
      (info.savedAt ? ` · ${new Date(info.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : '') : 'Empty';
    const actions = [];
    if (n !== active) {
      actions.push({ label: 'Load', disabled: !info, onClick() {
        const next = loadGame(n);
        if (!next) return ui.status('That slot could not be read.');
        saveGame(state);                     // keep the current tower in its own slot
        setActiveSlot(n);
        switchTo(next);
        ui.hideTowers();
        ui.status(`Loaded the tower in slot ${n}.`);
      } });
      actions.push({ label: 'Save here', onClick() {
        if (info && !confirm(`Replace the tower in slot ${n} with this one?`)) return;
        if (!saveGame(state, n)) return ui.status('Could not save: storage unavailable.');
        setActiveSlot(n);
        ui.status(`Saved to slot ${n}; it is now the active slot.`);
        openTowersSheet();
      } });
      if (info) actions.push({ label: 'Delete', danger: true, onClick() {
        if (!confirm(`Delete the tower in slot ${n}? This cannot be undone.`)) return;
        clearGame(n);
        openTowersSheet();
      } });
    }
    slots.push({ title: `Slot ${n}${n === active ? ' · playing' : ''}`, detail, actions });
  }
  ui.showTowers(slots);
}

document.getElementById('btn-export').addEventListener('click', () => {
  const d = new Date();
  const name = `skyrise-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const url = URL.createObjectURL(new Blob([exportTower(state)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ui.status(`Exported ${name}.`);
});
const importInput = document.getElementById('import-file');
document.getElementById('btn-import').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = '';
  if (!file) return;
  let text = '';
  try { text = await file.text(); } catch { /* unreadable: treated as not ours */ }
  const next = importTower(text);
  if (!next) return ui.status('Not a Skyrise tower file.');
  if (!confirm(`Load this tower into slot ${activeSlot()}? The tower there now is replaced.`)) return;
  switchTo(next);
  saveGame(state);
  ui.hideTowers();
  ui.status(`Imported the tower into slot ${activeSlot()}.`);
});

// First-run guide: the first goal not yet met, until dismissed or all done.
const GUIDE_TEXT = [
  'Goal 1 of 3: build a Lift beside the lobby, from floor 1 up to floor 2 or higher.',
  `Goal 2 of 3: let ${GUIDE_OFFICES} offices beside the lift. Tenants need a path to the lobby.`,
  'Goal 3 of 3: get one unit to Good happiness (green dot): short lift waits, quiet neighbours.',
];
let guideOff = guideDismissed();
function updateGuide() {
  if (guideOff) return ui.guide(null);
  const i = guideGoals(state).indexOf(false);
  if (i < 0) { guideOff = true; dismissGuide(); ui.guide(null); return ui.status('Guide done: chase the stars. Tap them to see what the next one needs.'); }
  ui.guide(GUIDE_TEXT[i]);
}

// The inspect card for a lift cell: its shaft, the queue, and this floor's stop.
function showLiftCard(st) {
  const t = TYPES[st.type];
  const sh = shaftsOf(state).find(x => x.col === st.col && x.lo <= st.floor && st.floor <= x.hi);
  const live = state.transit.shafts.find(x => x.col === sh.col && x.lo === sh.lo);
  cardMode = 'inspect';
  ui.showCard(`${t.label} shaft, ${sh.lo < 1 ? `${floorName(sh.lo)} to ${sh.hi}` : `floors ${sh.lo}-${sh.hi}`}`, [
    ['Cars', String(sh.cars)],
    ['Waiting', String(live ? live.queue.length : 0)],
    [`Stop ${st.floor < 1 ? floorName(st.floor) : st.floor}`, st.closed ? 'closed' : 'open', st.closed ? 'poor' : ''],
  ], [
    { label: st.closed ? 'Open this stop' : 'Close this stop', onClick() {
      const res = toggleStop(state, st.col, st.floor);
      if (!res.ok) ui.status(res.reason + '.');
      showLiftCard(st);
    } },
  ]);
}

attachInput(canvas, {
  onTap(x, y) {
    const { col, floor } = renderer.screenToCell(state, x, y);
    if (view.tool === 'inspect') {
      const st = structureAt(state, col, floor);
      view.selected = st ? st.id : null;
      if (st && TYPES[st.type].kind === 'unit' && state.service[st.id]) return showCard(st);
      if (st && TYPES[st.type].span) return showLiftCard(st);
      cardMode = null;
      ui.hideCard();
      ui.status(st ? describe(st) : `Empty cell on ${floorName(floor)}.`, !!st);
      return;
    }
    if (view.tool === 'demolish') {
      const st = structureAt(state, col, floor);
      if (st) return openConfirm(st);
      closeCard();
      ui.status(floor < 1 && floor >= 1 - state.dug ? 'Dug levels stay dug.' : 'Nothing to demolish here.');
      return;
    }
    if (view.tool === 'dig') {
      const res = dig(state, floor);
      ui.status(res.ok ? `Dug ${floorName(floor)} for $${DIG_COST.toLocaleString()}.` : res.reason + '.');
      ui.update(state, opts());
      return;
    }
    if (view.tool === 'car') {
      const res = addCar(state, col, floor);
      ui.status(res.ok ? `Added a car: this shaft now runs ${res.cars}.` : res.reason + '.');
      ui.update(state, opts());
      return;
    }
    // First tap drafts, a second tap on the same cell builds; nothing is written until then.
    const d = draftTap(state, view.draft, view.tool, col, floor);
    setDraft(d.draft);
    if (!d.place) {
      if (d.reason) ui.status(d.reason + '.');
      else ui.status(`${TYPES[view.tool].label} on ${floorName(floor)}: tap again to build for $${d.draft.cost.toLocaleString()}.`);
      return;
    }
    const res = place(state, view.tool, col, floor);
    if (res.ok) {
      const t = TYPES[view.tool];
      renderer.onPlaced(state, res.structure);
      ui.status(`Built ${t.label} on ${floorName(floor)} for $${t.cost.toLocaleString()}.`);
    } else {
      ui.status(res.reason + '.');
    }
    ui.update(state, opts());
  },
  onLongPress(x, y) {
    const { col, floor } = renderer.screenToCell(state, x, y);
    const st = structureAt(state, col, floor);
    if (!st) return ui.status('Nothing to demolish here.');
    setDraft(null);
    openConfirm(st);                       // the same confirm card as the Demolish tool
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
    const r = stepHour(state);              // finishes the hour's walker sub-steps, then ticks
    left += r.left;
    if (r.report) report = r.report;
    renderer.onTick(state);
    n++;
    if (state.tick % AUTOSAVE_TICKS === 0) saveGame(state);
  }
  if (now - lastTickAt >= ms) lastTickAt = now; // drop the backlog
  // Spread the hour's walker sub-steps over its wall time; the first runs at once.
  const due = Math.min(WALK_STEPS, 1 + Math.floor(((now - lastTickAt) / ms) * WALK_STEPS));
  while (walkerStepsDone(state) < due) stepWalkers(state);
  if (n) { ui.update(state, opts()); updateGuide(); if (ui.towerOpen()) openTowerSheet(); }
  if (left) ui.status(`${left} tenant${left > 1 ? 's' : ''} moved out: unhappy with the lifts.`);
  if (report) { saveGame(state); ui.showReport(report); }
  // Keep an open inspect card current as the hours pass (not while renaming or confirming).
  if (n && view.selected && cardMode === 'inspect' && !ui.isEditing()) {
    const st = state.structures.find(x => x.id === view.selected);
    if (st && TYPES[st.type].kind === 'unit' && state.service[st.id]) showCard(st);
    else if (st && TYPES[st.type].span) showLiftCard(st);
    else closeCard();
  }
}

function frame(now) {
  advance(now);
  view.weather = weatherNow();
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
updateGuide();
ui.status(`${firstGreeting ? firstGreeting + ' ' : ''}${resumed ? 'Welcome back. Your tower was restored.' : 'Build stairs or a lift beside the lobby, then lease units above it.'}`, true);
rafId = requestAnimationFrame(frame);

// Exposed for debugging and browser checks; the game never reads it.
window.skyrise = { get state() { return state; }, view, renderer };
