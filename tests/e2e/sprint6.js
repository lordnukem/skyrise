// Sprint 6 Playwright checks at 360x740. Run from the repo root with a static
// server already serving it (for example `python3 -m http.server 8765`):
//   SKYRISE_URL=http://localhost:8765/index.html node tests/e2e/sprint6.js
// Uses the pre-installed Chromium. Not yet run: see docs/sprint-6-plan.md.
const { chromium } = require('playwright');

const URL = process.env.SKYRISE_URL || 'http://localhost:8765/index.html';
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL);
  await page.waitForSelector('#toolbar button[data-tool]');
  await page.waitForTimeout(400);

  // 1. Locked buttons carry no "unlocks" text and show a star pill.
  const locked = await page.$$eval('#toolbar button.locked', (bs) => bs.map((b) => ({
    small: b.querySelector('small')?.textContent || '',
    pill: b.querySelector('.need')?.textContent || '',
    label: b.getAttribute('aria-label') || '',
  })));
  check('locked buttons have no "unlocks" text', locked.length > 0 && locked.every((x) => !/unlock/i.test(x.small)));
  check('locked buttons show a star pill', locked.length > 0 && locked.every((x) => /^★\d$/.test(x.pill)), JSON.stringify(locked.slice(0, 2)));
  check('locked aria-label names the need', locked.length > 0 && locked.every((x) => /needs \d stars/.test(x.label)));

  // 2. Labels fit their box or end in an ellipsis: nothing spills out of the button.
  const overflow = await page.$$eval('#toolbar button[data-tool] .label', (ls) => ls
    .filter((l) => l.scrollWidth > l.clientWidth + 1)
    .map((l) => l.textContent));
  check('toolbar labels do not overflow', overflow.length === 0, overflow.join(', '));

  // 3. No sideways page scroll at 360 px.
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check('no horizontal page scroll', scrollW <= 360, `scrollWidth ${scrollW}`);

  // 4. Tapping a locked tool explains it in the status line.
  const lockedTool = await page.$('#toolbar button.locked');
  if (lockedTool) {
    await lockedTool.click();
    const status = await page.textContent('#status');
    check('tapping a locked tool says when it unlocks', /unlocks at \d+ stars/.test(status), status);
  } else {
    check('tapping a locked tool says when it unlocks', false, 'no locked tool found on a new tower');
  }

  // 5. No console or page errors.
  check('no console errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.detail && !r.ok ? ` (${r.detail})` : ''}`);
    if (!r.ok) failed++;
  }
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
