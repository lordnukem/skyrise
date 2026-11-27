// Sprint 7 Playwright checks: the traps found by playtesting at phone size, and toolbar labels.
// Run from the repo root with a static server already serving it:
//   python3 -m http.server 8765 &
//   SKYRISE_URL=http://localhost:8765/index.html node tests/e2e/sprint7.js
// Uses the pre-installed Chromium. Exit code is 1 on any failure.
const { chromium } = require('playwright');

const URL = process.env.SKYRISE_URL || 'http://localhost:8765/index.html';
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForSelector('#toolbar button[data-tool]');
  await page.waitForTimeout(400);

  const status = () => page.$eval('#status', (p) => p.textContent);
  // Cell centre on screen, from the renderer's camera (window.skyrise is the game's debug handle).
  const tapCell = async (col, floor) => {
    const p = await page.evaluate(([c, f]) => {
      const { renderer, state } = window.skyrise; const cam = renderer.cam;
      const r = document.getElementById('view').getBoundingClientRect();
      return { x: r.left + ((c + 0.5) * 24 - cam.x) * cam.zoom, y: r.top + ((state.maxFloors - f + 0.5) * 32 - cam.y) * cam.zoom };
    }, [col, floor]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(120);
  };
  const lobbyLeft = await page.evaluate(() => Math.min(...window.skyrise.state.structures.filter((x) => x.type === 'lobby').map((x) => x.col)));
  const cash = () => page.evaluate(() => window.skyrise.state.cash);

  // 1. The lift tool tapped onto the lobby says where lifts go.
  await page.tap('#toolbar button[data-tool="elevator"]');
  await tapCell(lobbyLeft, 1);
  const onLobby = await status();
  check('lift on the lobby says to build it beside the lobby', /beside the lobby, not on it/.test(onLobby), onLobby);

  // 2. A shaft started on top of the lobby warns in the draft, before any money is spent.
  const before = await cash();
  await tapCell(lobbyLeft, 2);
  const draft = await status();
  check('a lift drafted on the lobby warns it has no path', /No path to the lobby from here\. Tap again to build anyway\./.test(draft), draft);
  check('the warning comes before paying', (await cash()) === before);

  // 3. A real lift beside the lobby, then an office one cell away: warned in the draft and after building.
  await page.tap('#speed button:nth-child(1)');   // pause, so nothing moves in or out meanwhile
  await page.tap('#toolbar button[data-tool="elevator"]');   // re-picking the tool drops the draft unbuilt
  await tapCell(lobbyLeft - 1, 1); await tapCell(lobbyLeft - 1, 1);
  await tapCell(lobbyLeft - 1, 2);                // extends the shaft on one tap
  const lift = await status();
  check('a lift beside the lobby builds with no warning', /^Built Lift/.test(lift) && !/no path/.test(lift), lift);
  await page.tap('#toolbar button[data-tool="office"]');
  await tapCell(lobbyLeft + 1, 2);
  const gap = await status();
  check('an office a cell away from the lift warns in the draft', /No path to the lobby from here\. Tap again to build anyway\./.test(gap), gap);
  const cut = await page.$eval('#status', (p) => p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1);
  check('the warning fits the status line', !cut);
  await tapCell(lobbyLeft + 1, 2);
  const built = await status();
  check('building it anyway says it has no path yet', /^Built Office.*It has no path to the lobby yet\./.test(built), built);
  // A shop on floor 1 right beside the lobby has a path: the plain draft message.
  await page.tap('#toolbar button[data-tool="shop"]');
  await tapCell(lobbyLeft + 8, 1);
  const beside = await status();
  check('a shop beside the lobby drafts with no warning', /^Shop on floor 1: tap again to build for/.test(beside), beside);

  // 4. Toolbar labels fit at 320, 360 and 390 px: nothing clipped, nothing outside its button.
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForTimeout(250);
    const bad = await page.$$eval('#toolbar button[data-tool]', (bs) => bs.filter((b) => {
      const l = b.querySelector('.label'), sm = b.querySelector('small'), r = b.getBoundingClientRect();
      const lr = l.getBoundingClientRect(), sr = sm.getBoundingClientRect();
      return l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 1 || sm.scrollWidth > sm.clientWidth + 1
        || lr.left < r.left - 0.5 || lr.right > r.right + 0.5 || sr.bottom > r.bottom + 0.5;
    }).map((b) => b.dataset.tool));
    check(`every toolbar label and price fits at ${width}px`, bad.length === 0, bad.join(', '));
  }

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.ok || !r.detail ? '' : `\n       ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
