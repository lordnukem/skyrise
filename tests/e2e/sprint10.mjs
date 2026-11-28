// Sprint 10 checks at 360x740: life around the tower (src/life.js). By day the sun, clouds and
// street are drawn and the street moves; at night the sun is gone; in rain a lightning strike
// sends a thunder cue to the sound; under reduced motion nothing moves and nothing flashes;
// every weather draws without a script error.
//   SKYRISE_URL=http://127.0.0.1:8765/index.html node tests/e2e/sprint10.mjs
import { createRequire } from 'node:module';
import { newGame, place, stepTick, serialize } from '../../src/sim.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.SKYRISE_URL || 'http://127.0.0.1:8765/index.html';

function towerAt(hour) {
  const s = newGame();
  s.cash = 1e6;
  for (let f = 1; f <= 6; f++) place(s, 'elevator', 24, f);
  for (let f = 2; f <= 6; f++) place(s, 'office', 21, f);
  for (let h = 0; h < 30; h++) stepTick(s, () => 0.01);
  s.tick = s.tick - (s.tick % 24) + hour;
  return JSON.stringify(serialize(s));
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function open(hour, weather, { reduced = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([save]) => {
    try { localStorage.setItem('skyrise.save.1', save); localStorage.setItem('skyrise.slot', '1'); localStorage.setItem('skyrise.sound', 'off'); } catch { /* no storage */ }
  }, [towerAt(hour)]);
  await page.goto(`${URL}?weather=${weather}`);
  await page.waitForSelector('#toolbar button[data-tool]', { state: 'attached' });
  await page.evaluate(() => document.querySelector('#speed button').click());   // pause: the clock stays at this hour
  await page.waitForTimeout(1500);
  return { page, errors };
}
const life = (page) => page.evaluate(() => ({ ...window.skyrise.renderer.debug.life }));

// 1. Day: sun, clouds, birds or street, and the street moves.
{
  const { page, errors } = await open(10, 'clear');
  const d = await life(page);
  check('by day the sun and clouds are drawn', d.sun && d.clouds >= 3, JSON.stringify(d));
  check('by day the street has cars and walkers', d.cars >= 1 && d.peds >= 1, JSON.stringify(d));
  const shot = () => page.evaluate(() => document.querySelector('#view').toDataURL('image/png').length);
  const a = await shot(); await page.waitForTimeout(700); const b = await shot();
  check('the scene moves while the game is paused (ambient life)', a !== b);
  check('no script errors by day', errors.length === 0, errors.join(' | '));
  await page.close();
}
// 2. Night: no sun.
{
  const { page, errors } = await open(23, 'clear');
  const d = await life(page);
  check('at night the sun is gone', d.sun === false, JSON.stringify(d));
  check('no script errors at night', errors.length === 0, errors.join(' | '));
  await page.close();
}
// 3. Rain: a lightning strike sends thunder to the sound.
{
  const { page, errors } = await open(14, 'rain');
  await page.evaluate(() => {
    const a = window.skyrise.audio, real = a.play;
    window.__cues = [];
    a.play = (name, o) => { window.__cues.push(name); return real(name, o); };
    window.skyrise.renderer.life.strikeSoon();
  });
  await page.waitForTimeout(1500);
  const d = await life(page);
  const cues = await page.evaluate(() => window.__cues);
  check('lightning strikes in the rain', d.flashes >= 1, JSON.stringify(d));
  check('a strike is followed by thunder', cues.includes('thunder'), cues.join(', '));
  check('rain brings heavier cloud', d.clouds >= 6, JSON.stringify(d));
  check('no script errors in the rain', errors.length === 0, errors.join(' | '));
  await page.close();
}
// 4. Reduced motion: nothing moves and nothing flashes, even in a storm.
{
  const { page, errors } = await open(14, 'rain', { reduced: true });
  await page.evaluate(() => window.skyrise.renderer.life.strikeSoon());
  const shot = () => page.evaluate(() => document.querySelector('#view').toDataURL('image/png'));
  const a = await shot(); await page.waitForTimeout(900); const b = await shot();
  const d = await life(page);
  check('reduced motion: the scene holds still', a === b);
  check('reduced motion: no lightning flash', d.flashes === 0, JSON.stringify(d));
  check('no script errors with reduced motion', errors.length === 0, errors.join(' | '));
  await page.close();
}
// 5. Every weather draws cleanly.
for (const w of ['wind', 'fog', 'snow']) {
  const { page, errors } = await open(12, w);
  check(`${w}: no script errors`, errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
let failed = 0;
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n       ${r.detail}`}`); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
