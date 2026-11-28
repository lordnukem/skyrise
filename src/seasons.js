// Weather and festivals (Sprint 5b, G-40 and G-41). DOM-free and pure: weather
// is derived from the game tick, festivals from a device date, and neither is
// saved or read by the simulation. Visual only.

import {
  HOURS_PER_DAY, WEATHER_BLOCK_HOURS, WEATHER_BLOCK_START, WEATHER_WEIGHTS, WEATHER_FRONT_SHARE, FOG_HOURS,
} from './constants.js';
import { hash01 } from './anim.js';

export const WEATHERS = ['clear', 'rain', 'wind', 'fog', 'snow'];
export const FESTIVALS = ['newyear', 'christmas', 'cny', 'raya', 'deepavali', 'merdeka'];

// Lunar festival dates, [month, day] per year. CNY dates are fixed by the lunar
// calendar. Aidilfitri and Deepavali depend on moon sighting and the gazette:
// these rows are PROJECTED estimates, not gazetted dates, until the research
// pass checks them against Malaysia's public-holiday list (docs/sprint-5-plan.md).
// After 2030 the lunar festivals switch off; the fixed-date ones keep working.
export const LUNAR = {
  2026: { cny: [2, 17], raya: [3, 21], deepavali: [11, 8] },
  2027: { cny: [2, 6], raya: [3, 10], deepavali: [10, 28] },
  2028: { cny: [1, 26], raya: [2, 27], deepavali: [10, 17] },
  2029: { cny: [2, 13], raya: [2, 15], deepavali: [11, 5] },
  2030: { cny: [2, 3], raya: [2, 4], deepavali: [10, 26] },
};
export const PROJECTED = ['raya', 'deepavali'];
// Days around the table date each lunar festival is drawn: [from, to], inclusive.
const LUNAR_WINDOW = { cny: [-1, 4], raya: [0, 2], deepavali: [-1, 1] };

export const GREETINGS = {
  newyear: 'Happy New Year!', christmas: 'Merry Christmas!', cny: 'Gong Xi Fa Cai!',
  raya: 'Selamat Hari Raya!', deepavali: 'Happy Deepavali!', merdeka: 'Selamat Hari Merdeka!',
};

// anim.js's hash01 can come out negative (its last xor yields a signed int), so fold it into 0..1.
const h01 = (a, b) => { const u = hash01(a, b); return u < 0 ? u + 1 : u; };

const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);

// The festival ids active on a date, in FESTIVALS order. Reads the local year, month and day.
export function festivalsOn(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const today = dayNum(y, m, d);
  const out = [];
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) out.push('newyear');
  if (m === 12 && d >= 20 && d <= 26) out.push('christmas');
  for (const id of ['cny', 'raya', 'deepavali']) {
    // A window can cross a year end (CNY eve on 31 Jan never does, but stay general).
    for (const yy of [y - 1, y, y + 1]) {
      const at = LUNAR[yy]?.[id];
      if (!at) continue;
      const off = today - dayNum(yy, at[0], at[1]);
      if (off >= LUNAR_WINDOW[id][0] && off <= LUNAR_WINDOW[id][1]) { out.push(id); break; }
    }
  }
  if ((m === 8 && (d === 30 || d === 31)) || (m === 9 && (d === 1 || d === 16))) out.push('merdeka');
  return out;
}

// Does a festival's first fireworks night fall on this date? (CNY: its eve; Merdeka: 30 Aug.)
export function fireworksNight(date, festivals) {
  if (festivals.includes('newyear')) return true;
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  if (festivals.includes('merdeka') && m === 8 && d === 30) return true;
  const at = LUNAR[y]?.cny;
  return festivals.includes('cny') && !!at && dayNum(y, m, d) === dayNum(y, at[0], at[1]) + LUNAR_WINDOW.cny[0];
}

// Each game day's weather front, picked by WEATHER_WEIGHTS.
const FRONTS = Object.keys(WEATHER_WEIGHTS);
const WEIGHT_SUM = FRONTS.reduce((a, k) => a + WEATHER_WEIGHTS[k], 0);
export function frontOf(day) {
  let u = h01(day, 0x5eed) * WEIGHT_SUM;
  for (const k of FRONTS) { u -= WEATHER_WEIGHTS[k]; if (u < 0) return k; }
  return FRONTS[FRONTS.length - 1];
}

// The weather at a tick: constant within each WEATHER_BLOCK_HOURS block. Fog only
// in the FOG_HOURS block; snow only while `christmas` is on, in place of rain.
export function weatherAt(tick, festivals = []) {
  const b = Math.floor((tick - WEATHER_BLOCK_START) / WEATHER_BLOCK_HOURS);
  const start = b * WEATHER_BLOCK_HOURS + WEATHER_BLOCK_START;          // the block's first tick
  const day = Math.floor(start / HOURS_PER_DAY);
  const hour = ((start % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  const front = frontOf(day);
  if (front === 'clear' || h01(b, 0xb10c) >= WEATHER_FRONT_SHARE) return 'clear';
  if (front === 'fog') return hour >= FOG_HOURS[0] && hour + WEATHER_BLOCK_HOURS <= FOG_HOURS[1] ? 'fog' : 'clear';
  if (front === 'rain' && festivals.includes('christmas')) return 'snow';
  return front;
}

// Dev overrides from a query string, parsed once at load:
// ?date=YYYY-MM-DD, ?festival=cny,raya|none and ?weather=rain|snow|fog|wind|clear.
// Anything unrecognised is ignored, so they are harmless in production.
export function parseOverrides(search) {
  const q = new URLSearchParams(search || '');
  const out = { date: null, festivals: null, weather: null };
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.get('date') || '');
  if (dm) {
    const dt = new Date(+dm[1], +dm[2] - 1, +dm[3], 12);
    if (dt.getMonth() === +dm[2] - 1) out.date = dt;
  }
  const f = q.get('festival');
  if (f != null) out.festivals = f === 'none' ? [] : FESTIVALS.filter(id => f.split(',').includes(id));
  const w = q.get('weather');
  if (WEATHERS.includes(w)) out.weather = w;
  return out;
}
