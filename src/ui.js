// Toolbar, HUD and menu. Knows the DOM; knows nothing about the simulation
// beyond the plain numbers it is handed.

import { TYPES, TOOL_ORDER, HOURS_PER_DAY, LONG_PRESS_MS, STAR_POP, ELEVATOR_CAPACITY, STAIR_ONLY_CAPACITY } from './constants.js';

// Tiny inline SVG glyphs so the toolbar reads at a glance without images.
const ICONS = {
  lobby: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6"/></svg>',
  stairs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h5v-5h5v-5h5V6h3"/></svg>',
  elevator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M12 3v18M9 9l-1.5 2M15 13l1.5 2"/></svg>',
  office: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/><path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9l1-4h14l1 4M4 9v11h16V9M4 9h16M10 20v-6h4v6"/></svg>',
  flat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14"/><rect x="8" y="8" width="4" height="4"/><path d="M8 16h8"/></svg>',
  inspect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
};

export function createUI({ onTool, onMenu }) {
  const $ = (id) => document.getElementById(id);
  const toolbar = $('toolbar');
  const statusEl = $('status');
  const menu = $('menu');
  const menuBtn = $('btn-menu');
  let statusTimer = null;

  for (const id of [...TOOL_ORDER, 'inspect']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tool = id;
    const t = TYPES[id];
    b.innerHTML = `${ICONS[id]}<span>${t ? t.label : 'Inspect'}</span><small>${t ? '$' + t.cost : 'tap'}</small>`;
    b.setAttribute('aria-label', t ? `${t.label}, costs $${t.cost}` : 'Inspect');
    b.addEventListener('click', () => onTool(id));
    toolbar.appendChild(b);
  }

  menuBtn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    onMenu(action);
    if (action !== 'theme' && action !== 'pause') { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  });

  $('help').textContent =
    `Tap to build, drag to pan, pinch to zoom, hold ${LONG_PRESS_MS} ms to demolish. ` +
    `Units earn only with a path to the lobby. Stars at ${STAR_POP.join(', ')} people; ` +
    `stairs alone carry ${STAIR_ONLY_CAPACITY}, each lift shaft ${ELEVATOR_CAPACITY}.`;

  function setTool(id) {
    for (const b of toolbar.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tool === id);
  }

  function status(msg, sticky = false) {
    statusEl.textContent = msg;
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 4000);
  }

  function update(state, { paused, theme }) {
    const cash = $('stat-cash');
    cash.textContent = '$' + Math.round(state.cash).toLocaleString();
    cash.classList.toggle('negative', state.cash < 0);
    $('stat-pop').textContent = `${state.population} ppl`;
    $('stat-stars').textContent = '★'.repeat(state.rating) + '☆'.repeat(5 - state.rating);
    const day = Math.floor(state.tick / HOURS_PER_DAY) + 1;
    const hour = state.tick % HOURS_PER_DAY;
    $('stat-clock').textContent = `Day ${day} ${String(hour).padStart(2, '0')}:00${paused ? ' ⏸' : ''}`;
    menu.querySelector('[data-action="pause"]').textContent = paused ? 'Resume' : 'Pause';
    menu.querySelector('[data-action="theme"]').textContent = `Theme: ${theme || 'auto'}`;
  }

  return { setTool, status, update };
}
