// Sprint 6 mood checks at 360x740. Builds a one-car, 16-floor tower with the sim, saves it
// into slot 1, and checks the tower sheet's Mood row and that the page draws without errors.
//   SKYRISE_URL=http://127.0.0.1:8765/index.html node tests/e2e/mood.mjs
// Writes a screenshot to SKYRISE_SHOT (default: ./mood-360.png in the current directory).
import { createRequire } from 'node:module';
import { newGame, place, stepTick, serialize, moodCounts } from '../../src/sim.js';

// Playwright is installed globally in this environment; require it the same way sprint6.js does.
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.SKYRISE_URL || 'http://127.0.0.1:8765/index.html';
const SHOT = process.env.SKYRISE_SHOT || 'mood-360.png';
const always = () => 0.01;

// Same shape as tools/balance.mjs: one shaft at col 24, offices beside it, floor slabs under the right side.
const s = newGame();
s.cash = 1e6;
s.rating = 2;
for (let c = 25; c <= 27; c++) place(s, 'floor', c, 1);
for (let f = 1; f <= 16; f++) place(s, 'elevator', 24, f);
place(s, 'security', 14, 1);
for (let f = 2; f <= 16; f++) { place(s, 'office', 21, f); place(s, 'office', 25, f); }
for (let h = 0; h < 72; h++) stepTick(s, always);
const expected = moodCounts(s);
const blob = JSON.stringify(serialize(s));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((save) => {
  try {
    if (!localStorage.getItem('skyrise.save.1')) {
      localStorage.setItem('skyrise.save.1', save);
      localStorage.setItem('skyrise.slot', '1');
    }
  } catch { /* storage blocked: the page starts a new tower */ }
}, blob);

await page.goto(URL);
await page.waitForSelector('#toolbar button[data-tool]', { state: 'attached' });
await page.waitForTimeout(600);
await page.screenshot({ path: SHOT });

await page.click('#btn-menu');
await page.click('[data-action="tower"]', { force: true });
await page.waitForSelector('text=Mood');
const moodText = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('dt, th, td, span, div')];
  const row = rows.find((el) => el.textContent.trim() === 'Mood');
  return row ? row.parentElement.textContent.replace(/\s+/g, ' ').trim() : '';
});
const want = `${expected.good} good, ${expected.fair} fair, ${expected.poor} poor`;
check('tower sheet shows the mood counts', moodText.includes(want), `want "${want}", got "${moodText}"`);
check('a one-car tower of 16 floors is poor, not good', expected.poor > 0 && expected.good === 0, JSON.stringify(expected));
check('no console errors', errors.length === 0, errors.join(' | '));

await browser.close();
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.detail && !r.ok ? ` (${r.detail})` : ''}`);
  if (!r.ok) failed++;
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
