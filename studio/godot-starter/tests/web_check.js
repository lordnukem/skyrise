// Playwright check of the web export at phone size (360x740). From
// studio/godot-starter, after exporting to build/web and serving it:
//   python3 -m http.server 8766 --directory build/web &
//   STARTER_URL=http://localhost:8766/index.html node tests/web_check.js
// Writes build/shot-*.png. Exit code is 1 on any failure.
const { chromium } = require('playwright');

const URL = process.env.STARTER_URL || 'http://localhost:8766/index.html';
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL);
  const canvas = page.locator('#canvas');
  await canvas.waitFor();
  // The engine has booted once the loading overlay is gone.
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    return !s || getComputedStyle(s).display === 'none' || s.style.visibility === 'hidden';
  }, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const box = await canvas.boundingBox();
  check('canvas fills the phone viewport', box && Math.round(box.width) === 360 && Math.round(box.height) === 740, JSON.stringify(box));

  // The corner where we tap: empty at the start; only the orb can change it.
  const corner = { x: 0, y: 640, width: 100, height: 100 };
  const cornerBefore = await page.screenshot({ clip: corner });
  await page.screenshot({ path: 'build/shot-start.png' });
  // Steer the orb toward the bottom-left corner and let it travel.
  await page.touchscreen.tap(40, 700);
  await page.waitForTimeout(1500);
  const cornerAfter = await page.screenshot({ clip: corner });
  await page.screenshot({ path: 'build/shot-moved.png' });
  check('tapping moves the orb to the tapped corner', !cornerBefore.equals(cornerAfter));
  check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
