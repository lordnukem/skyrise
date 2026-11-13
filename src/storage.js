// localStorage wrapper. Every access is guarded: private mode, blocked
// storage or a quota error must never take the game down.
//
// Towers live in SLOT_COUNT slots (`skyrise.save.1` to `.3`); `skyrise.slot`
// names the active one, which autosave writes. The pre-slot `skyrise.save`
// moves into slot 1 once, the first time storage is read.

import { STORAGE_KEY, SLOT_COUNT, SLOT_KEY, GUIDE_KEY, TOOLBAR_KEY, GREETED_KEY } from './constants.js';
import { serialize, deserialize, dayOf } from './sim.js';

function store() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

const slotKey = (n) => `${STORAGE_KEY}.${n}`;
const validSlot = (n) => Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT;

// Move the old single autosave into an empty slot 1; remove it only once copied.
function migrate(ls) {
  try {
    const old = ls.getItem(STORAGE_KEY);
    if (old == null || ls.getItem(slotKey(1)) != null) return;
    ls.setItem(slotKey(1), old);
    ls.removeItem(STORAGE_KEY);
  } catch { /* leave the old key where it is */ }
}

export function activeSlot() {
  const ls = store();
  try {
    const n = ls ? parseInt(ls.getItem(SLOT_KEY), 10) : 1;
    return validSlot(n) ? n : 1;
  } catch { return 1; }
}

export function setActiveSlot(n) {
  const ls = store();
  if (!ls || !validSlot(n)) return;
  try { ls.setItem(SLOT_KEY, String(n)); } catch { /* ignore */ }
}

export function saveGame(state, slot = activeSlot()) {
  const ls = store();
  if (!ls || !validSlot(slot)) return false;
  try {
    migrate(ls);
    ls.setItem(slotKey(slot), JSON.stringify(serialize(state)));
    return true;
  } catch { return false; }
}

// Returns a state or null; a corrupt blob is treated the same as none.
export function loadGame(slot = activeSlot()) {
  const ls = store();
  if (!ls || !validSlot(slot)) return null;
  try {
    migrate(ls);
    const raw = ls.getItem(slotKey(slot));
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch { return null; }
}

export function clearGame(slot = activeSlot()) {
  const ls = store();
  if (!ls || !validSlot(slot)) return;
  try { migrate(ls); ls.removeItem(slotKey(slot)); } catch { /* nothing to do */ }
}

// What the Towers sheet lists for a slot: { rating, day, cash, savedAt }, or null when empty or unreadable.
export function slotInfo(slot) {
  const ls = store();
  if (!ls || !validSlot(slot)) return null;
  try {
    migrate(ls);
    const raw = ls.getItem(slotKey(slot));
    if (!raw) return null;
    const blob = JSON.parse(raw);
    const s = deserialize(blob);
    if (!s) return null;
    return { rating: s.rating, day: dayOf(s.tick) + 1, cash: s.cash, savedAt: Number.isFinite(blob.savedAt) ? blob.savedAt : 0 };
  } catch { return null; }
}

// A tower as a file's text, and back. The file is untrusted: anything that is not
// JSON or that `deserialize` refuses gives null.
export const exportTower = (state) => JSON.stringify(serialize(state));
export function importTower(text) {
  try { return deserialize(JSON.parse(text)); } catch { return null; }
}

// Theme preference shares the guard but is a separate, tiny key.
export function loadTheme() {
  const ls = store();
  try { return ls ? ls.getItem('skyrise.theme') : null; } catch { return null; }
}

export function saveTheme(value) {
  const ls = store();
  try { if (ls) value ? ls.setItem('skyrise.theme', value) : ls.removeItem('skyrise.theme'); } catch { /* ignore */ }
}

// First-run guide: only its dismissal is stored, per device.
export function guideDismissed() {
  const ls = store();
  try { return ls ? ls.getItem(GUIDE_KEY) === 'done' : false; } catch { return false; }
}

export function dismissGuide() {
  const ls = store();
  try { if (ls) ls.setItem(GUIDE_KEY, 'done'); } catch { /* ignore */ }
}

// Toolbar collapse (G-42): per device, never in a tower file. true, false, or null when never set.
export function loadToolbar() {
  const ls = store();
  try {
    const v = ls ? ls.getItem(TOOLBAR_KEY) : null;
    return v === 'collapsed' ? true : v === 'expanded' ? false : null;
  } catch { return null; }
}

export function saveToolbar(collapsed) {
  const ls = store();
  try { if (ls) ls.setItem(TOOLBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
}

// Festival greeting (G-41): the device date (YYYY-MM-DD) it last showed, so it shows once a day.
export function greetedOn(day) {
  const ls = store();
  try { return ls ? ls.getItem(GREETED_KEY) === day : false; } catch { return false; }
}

export function markGreeted(day) {
  const ls = store();
  try { if (ls) ls.setItem(GREETED_KEY, day); } catch { /* ignore */ }
}
