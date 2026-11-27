// Both builds share their towers when they are served from one site: same localStorage keys,
// same save JSON. This plants a tower made by the JS sim in slot 1, opens the Godot build and
// checks it loads; then builds in Godot, saves, and checks the JS build loads that.
// Serve the repo root (so / is the JS build and /godot/build/web/ the Godot one):
//   python3 -m http.server 8765 &
//   SKYRISE_ROOT=http://localhost:8765 node godot/tests/interop_check.js
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = process.env.SKYRISE_ROOT || 'http://localhost:8765';
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// A five-star tower from the JS sim (the same one as the Godot ?demo=big).
const towerJs = execFileSync('node', ['--input-type=module', '-e', `
import * as S from '${path.resolve(__dirname, '../../src/sim.js')}';
const s = S.newGame(); s.cash = 1e8;
const put = (t, c, f) => { s.rating = 5; S.place(s, t, c, f); };
S.dig(s, 0); put('stairs', 24, 0); put('transit', 25, 0); put('floor', 1, 1);
for (let f = 1; f <= 59; f += 2) put('stairs', 2, f);
for (let f = 2; f <= 58; f += 2) put('stairs', 1, f);
for (const c of [15, 25, 26]) { for (let f = 1; f <= 16; f++) put('elevator', c, f); for (let k = 0; k < 3; k++) S.addCar(s, c, 1); }
for (let f = 1; f <= 16; f++) for (const c of [3, 6, 9, 12, 27, 30, 33]) put('office', c, f);
put('security', 36, 1); put('clinic', 38, 1); put('plant', 36, 2);
s.vip = { review: 'good', quarter: 1 };
for (let i = 0; i < 30; i++) S.stepHour(s);
process.stdout.write(JSON.stringify(S.serialize(s)));`]).toString();
const jsTower = JSON.parse(towerJs).state;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('planted')) { localStorage.setItem('skyrise.save.1', t); sessionStorage.setItem('planted', '1'); } }, towerJs);
  const page = await ctx.newPage();
  await page.goto(ROOT + '/godot/build/web/index.html?debug');
  await page.waitForFunction(() => window.__skyrise, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  let s = await page.evaluate(() => window.__skyrise);
  // The clock keeps running after the load, so compare the layout and that time moved on from the save.
  check('the Godot build loads a tower the JS build saved', s.structures === jsTower.structures.length && s.tick >= jsTower.tick,
    `${s.structures} structures at tick ${s.tick} (JS: ${jsTower.structures.length} at tick ${jsTower.tick})`);
  check('and greets it as a restored tower', /Welcome back/.test(s.status), s.status);
  check('with the same rating', s.rating === 5, String(s.rating));

  // Godot changes the tower and saves; the JS build must load the change.
  await page.touchscreen.tap(330, 28); await page.waitForTimeout(400);
  await page.touchscreen.tap(250, 60 + 12 + 60 + 22); await page.waitForTimeout(400);
  const savedByGodot = JSON.parse(await page.evaluate(() => localStorage.getItem('skyrise.save.1')));
  check('the Godot save is the shared format', savedByGodot.version === 7 && savedByGodot.state.structures.length === jsTower.structures.length);
  await page.goto(ROOT + '/index.html');
  await page.waitForTimeout(2500);
  const js = await page.evaluate(() => ({ n: window.skyrise.state.structures.length, tick: window.skyrise.state.tick, rating: window.skyrise.state.rating }));
  check('the JS build loads the tower the Godot build saved', js.n === savedByGodot.state.structures.length && js.tick >= savedByGodot.state.tick,
    JSON.stringify(js));
  await browser.close();
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.ok || !r.detail ? '' : `\n       ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
