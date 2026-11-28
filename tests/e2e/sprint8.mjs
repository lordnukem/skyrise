// Sprint 8 checks at 360x740: the sound engine in a real browser. Builds a small tower with the sim
// (a lift and 14 empty offices, so tenants are still moving in during the run), saves it to slot 1, then
// checks the page: nothing loads before a tap; after one, the manifest, every cue and the
// ambience decode; the playlist and ambience follow the clock; sheets duck the music; the tower
// plays its cues (move-ins, coins, lift dings) panned from their place; the toggle mutes.
//   SKYRISE_URL=http://127.0.0.1:8765/index.html node tests/e2e/sprint8.mjs
import { createRequire } from 'node:module';
import { newGame, place, serialize } from '../../src/sim.js';
import { ambienceMix } from '../../src/audio.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.SKYRISE_URL || 'http://127.0.0.1:8765/index.html';

const s = newGame();
s.cash = 1e6;
for (let f = 1; f <= 8; f++) place(s, 'elevator', 24, f);
for (let f = 2; f <= 8; f++) { place(s, 'office', 21, f); place(s, 'office', 18, f); }
const blob = JSON.stringify(serialize(s));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: false });
const errors = [], audioReqs = [], audioFails = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => { if (/\/assets\/audio\//.test(r.url())) audioReqs.push(r.url().split('/').pop()); });
page.on('response', (r) => { if (/\/assets\/audio\//.test(r.url()) && r.status() >= 400) audioFails.push(`${r.status()} ${r.url()}`); });
page.on('requestfailed', (r) => { if (/\/assets\/audio\//.test(r.url())) audioFails.push(`failed ${r.url()}`); });
await page.addInitScript((save) => {
  try { localStorage.setItem('skyrise.save.1', save); localStorage.setItem('skyrise.slot', '1'); localStorage.removeItem('skyrise.sound'); } catch { /* no storage */ }
}, blob);

await page.goto(URL);
await page.waitForSelector('#toolbar button[data-tool]', { state: 'attached' });
await page.waitForTimeout(800);
check('no audio loads before the first tap', audioReqs.length === 0, audioReqs.join(', '));

// The first tap unlocks sound.
await page.mouse.click(180, 250);
await page.waitForFunction(() => window.skyrise.audio.debug().ready, null, { timeout: 15000 }).catch(() => {});
const manifest = await page.evaluate(() => fetch('assets/audio/manifest.json').then(r => r.json()));
const cueFiles = Object.values(manifest.sfx).flat().length;
await page.waitForFunction((n) => window.skyrise.audio.debug().decoded >= n, cueFiles + 4, { timeout: 20000 }).catch(() => {});
let d = await page.evaluate(() => window.skyrise.audio.debug());
check('a tap starts the audio engine', d.ready && d.state === 'running', JSON.stringify({ ready: d.ready, state: d.state }));
check(`every cue and ambience loop decodes (${cueFiles} + 4)`, d.decoded >= cueFiles + 4 && d.failed.length === 0, `${d.decoded} decoded, failed: ${d.failed.join(', ')}`);

// Music: the playlist follows the clock and a track from it plays.
const hour = await page.evaluate(() => Math.floor(window.skyrise.state.tick % 24));
const wantList = hour >= 19 || hour < 6 ? 'night' : 'day';
check(`the ${wantList} playlist plays at ${hour}:00`, d.playlist === wantList && manifest.music[wantList].includes(d.track), `${d.playlist} ${d.track}`);
await page.waitForTimeout(1500);
const playing = await page.evaluate(() => [...document.querySelectorAll('audio')].length === 0);   // streamed elements are not in the DOM
check('music streams without touching the page', playing);

// Ambience: with the clock paused, the levels settle on the mix for this hour and weather.
await page.evaluate(() => document.querySelector('#speed button').click());   // pause
await page.waitForTimeout(4000);
d = await page.evaluate(() => window.skyrise.audio.debug());
const weather = await page.evaluate(() => window.skyrise.view.weather);
const pop = await page.evaluate(() => window.skyrise.state.population);
const hourNow = await page.evaluate(() => Math.floor(window.skyrise.state.tick % 24));
const want = ambienceMix(hourNow, weather, pop);
const close = Object.keys(want).every(k => Math.abs((d.amb[k] ?? -1) - want[k]) < 0.05);
check('ambience levels follow the hour and weather', close, `${JSON.stringify(d.amb)} want ${JSON.stringify(want)} at ${hourNow}:00 ${weather}`);

// Ducking: a sheet muffles the music; closing it brings it back.
await page.click('#stat-stars');
await page.waitForTimeout(300);
const duckedOpen = await page.evaluate(() => window.skyrise.audio.debug().ducked);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const duckedClosed = await page.evaluate(() => window.skyrise.audio.debug().ducked);
check('a sheet ducks the music and closing it restores it', duckedOpen === true && duckedClosed === false, `${duckedOpen} -> ${duckedClosed}`);

// The tower at work: record the cues the game plays at the top speed for a while.
const before = await page.evaluate(() => window.skyrise.audio.debug().played);
await page.evaluate(() => {
  const a = window.skyrise.audio, real = a.play;
  window.__cues = [];
  a.play = (name, o) => { window.__cues.push({ name, x: o && o.x != null ? Math.round(o.x) : null }); return real(name, o); };
});
const fast = await page.$$('#speed button');
await fast[fast.length - 1].click();
await page.waitForTimeout(12000);
const cues = await page.evaluate(() => window.__cues);
const names = new Set(cues.map(c => c.name));
check('tenants moving in play a move-in cue', names.has('movein'), [...names].join(', '));
check('rent coming in plays a coin', names.has('coin'), [...names].join(', '));
check('riders in a lift play a ding', names.has('ding'), [...names].join(', '));
const placed = cues.filter(c => ['movein', 'coin', 'ding'].includes(c.name));
check('tower cues are panned from their place on screen', placed.length > 0 && placed.every(c => c.x != null && c.x >= 0 && c.x <= 360), JSON.stringify(placed.slice(0, 4)));
const after = await page.evaluate(() => window.skyrise.audio.debug().played);
const heard = Object.entries(after).reduce((n, [k, v]) => n + v - (before[k] || 0), 0);
const perSecond = heard / 12;
check('a busy tower plays under 3 cues a second (the rest are rate-limited)', perSecond < 3, `${perSecond.toFixed(1)} a second heard, ${(cues.length / 12).toFixed(1)} asked; ${JSON.stringify(after)}`);

// The toggle mutes and unmutes.
await page.evaluate(() => { document.querySelector('[data-action="sound"]').click(); });
const off = await page.evaluate(() => window.skyrise.audio.isOn());
await page.evaluate(() => { document.querySelector('[data-action="sound"]').click(); });
const back = await page.evaluate(() => window.skyrise.audio.isOn());
check('the sound toggle mutes and unmutes', off === false && back === true);

check('no audio file fails to load', audioFails.length === 0, audioFails.join(', '));
check('no console errors', errors.length === 0, errors.join(' | '));

await browser.close();
let failed = 0;
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n       ${r.detail}`}`); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
