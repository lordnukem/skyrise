// Sprint 7 checks at 360x740: the Tower goals sheet, the cut-off count and warning, and no errors.
// Builds a tower with the sim, cuts off its top floor by removing the top lift cell, saves it into
// slot 1, then checks the page.
//   SKYRISE_URL=http://127.0.0.1:8765/index.html node tests/e2e/sprint7.mjs
import { createRequire } from 'node:module';
import { newGame, place, stepTick, demolish, serialize, cutOffCount } from '../../src/sim.js';

// Playwright is installed globally in this environment; require it the same way sprint6.js does.
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.SKYRISE_URL || 'http://127.0.0.1:8765/index.html';
const always = () => 0.01;

const s = newGame();
s.cash = 1e6;
s.rating = 2;
for (let f = 1; f <= 5; f++) place(s, 'elevator', 24, f);
for (let f = 2; f <= 5; f++) place(s, 'office', 21, f);
for (let h = 0; h < 48; h++) stepTick(s, always);
const top = s.structures.filter(x => x.type === 'elevator').sort((a, b) => b.floor - a.floor)[0];
demolish(s, top.id);
const cutOff = cutOffCount(s);
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

// 1. The cut-off warning appears in the status line once the clock runs.
let status = '';
for (let i = 0; i < 12 && !/cut off from the lobby/.test(status); i++) {
  await page.waitForTimeout(500);
  status = await page.textContent('#status');
}
check('cut-off warning appears in the status line', /cut off from the lobby/.test(status), status);

// 2. The tower sheet shows the cut-off count.
await page.click('#btn-menu');
await page.click('[data-action="tower"]', { force: true });
await page.waitForSelector('text=Cut off');
const cutRow = await page.evaluate(() => {
  const el = [...document.querySelectorAll('dt, th, td, span, div')].find((e) => e.textContent.trim() === 'Cut off');
  return el ? el.parentElement.textContent.replace(/\s+/g, ' ').trim() : '';
});
check('tower sheet shows the cut-off count', cutRow.includes(`${cutOff} units`), `want ${cutOff} units, got "${cutRow}"`);
await page.screenshot({ path: process.env.SKYRISE_SHOT || 'sprint7-tower.png' });
await page.keyboard.press('Escape');

// 3. The Tower goals sheet lists the four goals with progress.
await page.click('#btn-menu');
await page.click('[data-action="goals"]', { force: true });
await page.waitForSelector('text=Tower goals');
const goalsText = await page.evaluate(() => document.body.innerText);
const goalsOk = ['Population 500', 'A quarter with no poor units', 'Four cars on every shaft', 'A sky lobby with its own shaft']
  .every((g) => goalsText.includes(g));
check('goals sheet lists the four milestones', goalsOk);
check('goals sheet shows progress 0 of 4 done', goalsText.includes('0 of 4 done'));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
check('no horizontal scroll with the goals sheet open', overflow <= 360, `scrollWidth ${overflow}`);

// 4. No console or page errors.
check('no console errors', errors.length === 0, errors.join(' | '));

await browser.close();
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.detail && !r.ok ? ` (${r.detail})` : ''}`);
  if (!r.ok) failed++;
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
