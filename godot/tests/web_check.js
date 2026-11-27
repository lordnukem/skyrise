// Playwright checks of the Godot web build at phone size (360x740), through real taps.
// The build publishes a JSON summary on window.__skyrise when the URL has ?debug, so the
// checks read the game's state instead of scraping pixels. From the repo root, after
// exporting to godot/build/web (see godot/run_checks.sh):
//   python3 -m http.server 8770 --directory godot/build/web &
//   SKYRISE_GODOT_URL=http://localhost:8770/index.html node godot/tests/web_check.js
// Writes screenshots to godot/build/shots/. Exit code 1 on any failure.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = (process.env.SKYRISE_GODOT_URL || 'http://localhost:8770/index.html') + '?debug';
const SHOTS = path.join(__dirname, '..', 'build', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// The toolbar grid: rows of five 64 px cells with 6 px gaps, starting 8 px in from the left.
const TOOLS = ['toggle', 'lobby', 'floor', 'dig', 'stairs', 'escalator', 'elevator', 'car', 'express', 'servicelift',
  'office', 'shop', 'food', 'flat', 'hotel', 'hall', 'security', 'housekeeping', 'parking', 'clinic', 'plant', 'transit',
  'landmark', 'inspect', 'demolish'];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (/SCRIPT ERROR|^ERROR|USER ERROR/.test(m.text())) errors.push(m.text()); });

  const open = async () => {
    await page.goto(URL);
    await page.waitForFunction(() => window.__skyrise, null, { timeout: 90000 });
    await page.waitForTimeout(800);
  };
  const g = () => page.evaluate(() => window.__skyrise);
  const settle = () => page.waitForTimeout(350);      // the summary refreshes every 250 ms
  const tapCell = async (col, floor) => {
    const s = await g();
    const x = s.stage[0] + ((col + 0.5) * s.cell[0] - Math.round(s.cam.x)) * s.cam.zoom;
    const y = s.stage[1] + ((s.maxFloors - floor + 0.5) * s.cell[1] - Math.round(s.cam.y)) * s.cam.zoom;
    await page.touchscreen.tap(x, y);
    await settle();
  };
  const toolbarTop = async () => (await g()).toolbar;
  const tool = async (id) => {
    const i = TOOLS.indexOf(id), row = Math.floor(i / 5), col = i % 5;
    const tb = await toolbarTop();
    // One wheel event scrolls the toolbar 40 px, so send several to reach the end either way.
    await page.mouse.move(180, tb[1] + 40);
    for (let k = 0; k < 6; k++) await page.mouse.wheel(0, row > 2 ? 100 : -100);
    await page.waitForTimeout(250);
    const scrolledRow = row > 2 ? row - (Math.ceil(TOOLS.length / 5) - 3) : row;
    await page.touchscreen.tap(tb[0] + col * 70 + 32, tb[1] + scrolledRow * 72 + 33);
    await settle();
    return (await g()).tool;
  };
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

  await open();
  let s = await g();
  check('the game boots with a tower and a guide', s.structures === 8 && /Goal 1 of 3/.test(s.guide), JSON.stringify({ n: s.structures, guide: s.guide }));
  const L = s.lobbyLeft;

  // The Sprint 7 traps, in the Godot build.
  check('the Lift tool is chosen from the toolbar', (await tool('elevator')) === 'elevator');
  await tapCell(L, 1);
  s = await g();
  check('a lift on the lobby says where lifts go', /beside the lobby, not on it/.test(s.status), s.status);
  const cash0 = s.cash;
  await tapCell(L, 2);
  s = await g();
  check('a lift drafted on the lobby warns before paying', /No path to the lobby from here/.test(s.status) && s.cash === cash0, s.status);
  await shot('01-draft-warning');

  // The intended path: a lift beside the lobby, then three offices beside it.
  await tool('elevator');
  await tapCell(L - 1, 1); await tapCell(L - 1, 1);
  for (const f of [2, 3, 4]) await tapCell(L - 1, f);
  s = await g();
  check('a lift beside the lobby builds and completes goal 1', /^Built Lift/.test(s.status) && /Goal 2 of 3/.test(s.guide), s.status + ' | ' + s.guide);
  check('the Office tool is chosen', (await tool('office')) === 'office');
  await tapCell(L + 1, 2);
  s = await g();
  check('an office a cell from the lift warns', /No path to the lobby/.test(s.status), s.status);
  await tool('office');                                  // re-picking the tool drops the draft
  for (const f of [2, 3, 4]) { await tapCell(L, f); await tapCell(L, f); }
  s = await g();
  check('three offices are built', s.structures === 8 + 4 + 3, String(s.structures));

  // Inspect and demolish cards.
  await page.waitForTimeout(2500);
  check('the Inspect tool is chosen', (await tool('inspect')) === 'inspect');
  await tapCell(L + 1, 2);
  s = await g();
  check('inspecting a let office opens its card', s.card.length > 0, s.card);
  await shot('02-inspect-card');
  check('the Demolish tool is chosen', (await tool('demolish')) === 'demolish');
  await tapCell(L + 1, 4);                               // the top office: nothing on it
  s = await g();
  check('demolish asks first', /^Demolish /.test(s.card), s.card);
  await shot('03-demolish-confirm');
  await tool('office');

  // Sheets: the tower sheet from the stars, closed with Escape.
  await page.touchscreen.tap(175, 20); await settle();
  s = await g();
  check('the stars open the tower sheet', s.sheet === 'tower', s.sheet);
  await shot('04-tower-sheet');
  await page.keyboard.press('Escape'); await settle();
  check('Escape closes the sheet', (await g()).sheet === '');

  // 4x: the offices let and the guide finishes.
  await page.touchscreen.tap(330, (await g()).stage[1] + 8 + 3 * 40 + 18); await settle();
  await page.waitForFunction(() => window.__skyrise.occupied >= 3, null, { timeout: 30000 }).catch(() => {});
  s = await g();
  check('the three offices let at 4x', s.occupied >= 3, String(s.occupied));
  await page.waitForFunction(() => window.__skyrise.guide === '', null, { timeout: 30000 }).catch(() => {});
  check('the guide finishes once a unit is happy', (await g()).guide === '');
  await shot('05-let');

  // Save, reload, restored.
  const before = await g();
  await page.touchscreen.tap(330, 28); await settle();
  await page.touchscreen.tap(250, 60 + 12 + 60 + 22); await settle();
  check('Save now saves to slot 1', /Saved to slot 1/.test((await g()).status), (await g()).status);
  // Saves go to localStorage on the web, which is synchronous: reload straight away.
  await open();
  s = await g();
  check('a reload straight after saving restores the tower (localStorage)', s.structures === before.structures && /Welcome back/.test(s.status), `${s.structures} vs ${before.structures}: ${s.status}`);

  // The first quarter report at 4x.
  await page.touchscreen.tap(330, s.stage[1] + 8 + 3 * 40 + 18); await settle();
  await page.waitForFunction(() => window.__skyrise.sheet === 'report', null, { timeout: 120000 }).catch(() => {});
  s = await g();
  check('the quarter report opens at the end of day 7', s.sheet === 'report', `tick ${s.tick}, sheet ${s.sheet}`);
  await shot('06-report');
  await page.keyboard.press('Escape'); await settle();

  // Dark theme from the menu (auto -> light -> dark).
  for (let i = 0; i < 2; i++) { await page.touchscreen.tap(330, 28); await settle(); await page.touchscreen.tap(250, 60 + 12 + 60 + 4 * 44 + 22); await settle(); }
  s = await g();
  await shot('07-dark');
  check('the menu switches the theme to dark', s.theme === 'dark' && s.dark === true, `${s.theme} ${s.dark}`);

  check('no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.ok || !r.detail ? '' : `\n       ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
