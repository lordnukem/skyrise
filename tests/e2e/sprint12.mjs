// Sprint 12 checks at 360x740: the detailed rooms (src/rooms.js). A tower with every structure
// type (services, hotel, hall, escalators, car parks, transit, all three lift kinds) is drawn at
// the detail zoom by day and by night without a script error; the transit train and the plant
// fan move; under reduced motion the frame holds still; and the frame rate holds.
//   SKYRISE_URL=http://127.0.0.1:8765/index.html node tests/e2e/sprint12.mjs
import { createRequire } from 'node:module';
import { newGame, place, dig, stepTick, serialize } from '../../src/sim.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.SKYRISE_URL || 'http://127.0.0.1:8765/index.html';

function tower(hour) {
  const s = newGame(); s.cash = 1e8;
  const P = (t, c, f) => { s.rating = 5; return place(s, t, c, f); };
  for (let i = 0; i < 2; i++) { s.rating = 5; dig(s); }
  for (let f = -1; f <= 8; f++) P('elevator', 24, f);
  for (let f = 1; f <= 8; f++) P('express', 32, f);
  for (let f = 1; f <= 6; f++) P('servicelift', 14, f);
  P('parking', 16, 0); P('parking', 20, 0); P('parking', 25, 0); P('transit', 18, -1);
  P('stairs', 15, 1); P('escalator', 25, 1); P('escalator', 27, 1);
  for (let f = 2; f <= 8; f++) for (let c = 15; c <= 31; c++) if (c !== 24) P('floor', c, f);
  P('hotel', 16, 2); P('hotel', 18, 2); P('housekeeping', 21, 2); P('hall', 25, 3); P('hotel', 29, 2);
  P('security', 16, 3); P('clinic', 18, 3); P('plant', 21, 3); P('office', 29, 3);
  P('office', 16, 4); P('flat', 19, 4); P('shop', 21, 4); P('food', 25, 4); P('flat', 28, 4);
  for (let h = 0; h < 60; h++) { s.rating = Math.max(s.rating, 3); stepTick(s, () => 0.01); }
  s.tick = s.tick - (s.tick % 24) + hour;
  return s;
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function open(hour, { reduced = false } = {}) {
  const s = tower(hour);
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([save]) => { try { localStorage.setItem('skyrise.save.1', save); localStorage.setItem('skyrise.slot', '1'); localStorage.setItem('skyrise.sound', 'off'); } catch { /* no storage */ } }, [JSON.stringify(serialize(s))]);
  await page.goto(URL);
  await page.waitForSelector('#toolbar button[data-tool]', { state: 'attached' });
  await page.evaluate(() => document.querySelector('#speed button').click());
  return { page, errors, s };
}
// Frame a cell at the given zoom.
const frame = (page, zoom, col, floor) => page.evaluate(([zm, c, f]) => {
  const cam = window.skyrise.renderer.cam, st = window.skyrise.state, cv = document.querySelector('#view');
  cam.zoom = zm; cam.x = (c + 0.5) * 24 - cv.clientWidth / zm / 2; cam.y = (st.maxFloors - f + 0.5) * 32 - cv.clientHeight / zm / 2;
}, [zoom, col, floor]);
const shot = (page) => page.evaluate(() => document.querySelector('#view').toDataURL('image/png'));

{
  const { page, errors, s } = await open(11);
  const types = new Set(s.structures.map(x => x.type));
  const want = ['security', 'clinic', 'housekeeping', 'plant', 'hotel', 'hall', 'escalator', 'parking', 'transit', 'elevator', 'express', 'servicelift'];
  check('the test tower has every detailed type', want.every(t => types.has(t)), want.filter(t => !types.has(t)).join(', '));
  for (const [label, col, floor] of [['basement', 21, -0.5], ['services', 20, 2.5], ['lifts and escalators', 27, 3]]) {
    await frame(page, 2.2, col, floor);
    await page.waitForTimeout(500);
  }
  check('every detailed room draws by day without a script error', errors.length === 0, errors.join(' | '));
  // The transit train and the plant fan move.
  await frame(page, 2.2, 21, -0.5); await page.waitForTimeout(300);
  const a = await shot(page); await page.waitForTimeout(1200); const b = await shot(page);
  check('the basement is animated (train, lights)', a !== b);
  // Frame rate with the detail on.
  await frame(page, 1.6, 23, 3); await page.waitForTimeout(300);
  const r = await page.evaluate(() => new Promise(res => { let k = 0, t0 = performance.now(); function f(t) { if (++k < 120) requestAnimationFrame(f); else res((t - t0) / k); } requestAnimationFrame(f); }));
  check('60 fps with every detailed room on screen', r < 18, `${r.toFixed(1)} ms a frame`);
  await page.close();
}
{
  const { page, errors } = await open(22);
  for (const [col, floor] of [[21, -0.5], [20, 2.5], [27, 3]]) { await frame(page, 2.2, col, floor); await page.waitForTimeout(400); }
  check('every detailed room draws at night without a script error', errors.length === 0, errors.join(' | '));
  await page.close();
}
{
  const { page, errors } = await open(11, { reduced: true });
  await frame(page, 2.2, 21, 1); await page.waitForTimeout(600);
  const a = await shot(page); await page.waitForTimeout(1200); const b = await shot(page);
  check('reduced motion: the detailed rooms hold still', a === b);
  check('no script errors with reduced motion', errors.length === 0, errors.join(' | '));
  await page.close();
}
{
  // Below the detail zoom the simple drawings are used, still without errors.
  const { page, errors } = await open(11);
  await frame(page, 0.6, 23, 3); await page.waitForTimeout(600);
  check('the zoomed-out view draws without errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
let failed = 0;
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n       ${r.detail}`}`); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
