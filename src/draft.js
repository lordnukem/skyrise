// Draft placement (G-43): the first tap on a valid cell sets a draft, a second
// tap on the same cell builds it. DOM-free and pure: it only asks `canPlace`,
// so nothing reaches the state until the caller acts on `place: true`.

import { TYPES } from './constants.js';
import { canPlace, buildGrid } from './sim.js';

// A lift cell that extends a run of the same lift type directly above or below.
function extendsShaft(grid, type, col, floor) {
  return grid.get(col + ',' + (floor - 1))?.type === type || grid.get(col + ',' + (floor + 1))?.type === type;
}

// draft: null or { tool, col, floor, cost }. Returns { draft, place, reason }:
// `place` true means build now; `draft` is the draft to show next (null clears it).
export function draftTap(s, draft, tool, col, floor) {
  const t = TYPES[tool];
  if (!t) return { draft: null, place: false, reason: 'Unknown type' };
  const grid = buildGrid(s);
  const res = canPlace(s, tool, col, floor, grid);
  if (!res.ok) return { draft: null, place: false, reason: res.reason };
  if (draft && draft.tool === tool && draft.col === col && draft.floor === floor) return { draft: null, place: true };
  if (t.span && extendsShaft(grid, tool, col, floor)) return { draft: null, place: true };
  return { draft: { tool, col, floor, cost: t.cost }, place: false };
}
