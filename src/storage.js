// localStorage wrapper. Every access is guarded: private mode, blocked
// storage or a quota error must never take the game down.

import { STORAGE_KEY } from './constants.js';
import { serialize, deserialize } from './sim.js';

function store() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function saveGame(state) {
  const ls = store();
  if (!ls) return false;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch { return false; }
}

// Returns a state or null; a corrupt blob is treated the same as none.
export function loadGame() {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch { return null; }
}

export function clearGame() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(STORAGE_KEY); } catch { /* nothing to do */ }
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
