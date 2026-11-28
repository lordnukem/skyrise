// Builds the game's sound from the free packs that tools/sound/fetch.sh downloaded, and writes
// assets/audio/manifest.json: every file the game plays, where each came from, and its licence.
//
//   bash tools/sound/fetch.sh && node tools/sound/build.mjs      (repo root; needs ffmpeg with libmp3lame)
//
// Every pick is a line in PICKS below, so changing a sound is a one-line edit and a re-run.
// What the build does to each file:
//   sfx       trimmed, mono, levelled to a common loudness, then the per-cue gain; 64 kbps.
//   jingles   the same, stereo; 96 kbps.
//   ambience  a seamless loop: the tail is crossfaded into the head, so it can repeat forever.
//   music     levelled to one loudness so day and night tracks match; 80 kbps stereo.
// The festival loops for CNY, Raya, Deepavali, Merdeka and New Year are still the synthesised ones
// from tools/audio (Sprint 6); this build keeps them and lists them in the manifest.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const CACHE = join(here, 'cache');
const OUT = join(ROOT, 'assets', 'audio');
const SR = 44100;
const SOURCES = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8')).packs;

// kind, output name, [pack, file inside the pack, options], ...
//   start/len: seconds to keep; gain: dB after levelling; loop: crossfade seconds for a seamless loop.
const K = (pack, file, o = {}) => ({ pack, file, ...o });
const PICKS = [
  // Interface
  ['sfx', 'tap', [K('kenney-interface', 'click_001.ogg', { gain: -6 })]],
  ['sfx', 'select', [K('kenney-interface', 'select_001.ogg', { gain: -8 })]],
  ['sfx', 'open', [K('kenney-interface', 'open_001.ogg', { gain: -8 })]],
  ['sfx', 'close', [K('kenney-interface', 'close_001.ogg', { gain: -8 })]],
  ['sfx', 'error', [K('kenney-interface', 'error_006.ogg', { gain: -5 })]],
  // Building
  ['sfx', 'build', [K('kenney-interface', 'drop_001.ogg'), K('kenney-interface', 'drop_002.ogg'), K('kenney-interface', 'drop_003.ogg')]],
  ['sfx', 'lift', [K('kenney-rpg', 'metalLatch.ogg', { gain: -2 })]],
  ['sfx', 'demolish', [K('rubberduck-100', 'sfx100v2_stones_01.ogg'), K('rubberduck-100', 'sfx100v2_stones_02.ogg'), K('rubberduck-100', 'sfx100v2_stones_03.ogg')]],
  ['sfx', 'repair', [K('kenney-interface', 'confirmation_002.ogg', { gain: -4 })]],
  // The tower at work (played from their place in the tower, panned left and right)
  ['sfx', 'coin', [K('kenney-rpg', 'handleCoins.ogg', { gain: -8 }), K('kenney-rpg', 'handleCoins2.ogg', { gain: -8 })]],
  ['sfx', 'ding', [K('sfx-elevator-ding', 'sfx-elevator-ding.ogg', { gain: -10 })]],
  ['sfx', 'movein', [K('kenney-rpg', 'doorOpen_1.ogg', { gain: -6 }), K('kenney-rpg', 'doorClose_2.ogg', { gain: -6 })]],
  ['sfx', 'alarm', [K('rubberduck-loops', 'alarm_01.ogg', { gain: -3 })]],
  ['sfx', 'thunder', [K('rubberduck-100', 'sfx100v2_thunder_01.ogg', { gain: -4 })]],
  ['sfx', 'cash', [K('kenney-casino', 'chips-stack-3.ogg', { gain: -4 })]],
  // Jingles: Kenney's sax set, to sit with the bossa nova
  ['jingle', 'star', [K('kenney-jingles', 'jingles_SAX16.ogg')]],
  ['jingle', 'quarter', [K('kenney-jingles', 'jingles_SAX15.ogg')]],
  ['jingle', 'loan', [K('kenney-jingles', 'jingles_SAX14.ogg')]],
  ['jingle', 'vip', [K('kenney-jingles', 'jingles_SAX10.ogg')]],
  ['jingle', 'vip-poor', [K('kenney-jingles', 'jingles_SAX05.ogg')]],
  ['jingle', 'win', [K('kenney-jingles', 'jingles_SAX02.ogg')]],
  ['jingle', 'gameover', [K('kenney-jingles', 'jingles_SAX07.ogg')]],
  // Ambience loops
  ['amb', 'traffic', [K('rubberduck-100', 'sfx100v2_loop_highway.ogg', { loop: 2 })]],
  ['amb', 'birds', [K('amb-park', 'amb-park.wav', { start: 20, len: 40, loop: 4 })]],
  ['amb', 'crickets', [K('amb-crickets', 'amb-crickets.mp3', { loop: 1.5 })]],
  ['amb', 'rain', [K('amb-rain', '1.ogg', { loop: 3 })]],
  // Music: playlists, one track after another (no seams to hide)
  ['music', 'day-1', [K('music-mustard', 'music-mustard.ogg')]],
  ['music', 'day-2', [K('music-socks', 'music-socks.ogg')]],
  ['music', 'night-1', [K('music-lofi', 'music-lofi.ogg')]],
  ['music', 'night-2', [K('music-vaporware', 'music-vaporware.mp3')]],
  ['music', 'christmas', [K('music-christmas', 'music-christmas.mp3')]],
];
// The synthesised festival loops kept from Sprint 6 (tools/audio/render.mjs).
const KEPT_MUSIC = ['cny', 'raya', 'deepavali', 'merdeka', 'newyear'];

const KIND = {
  sfx: { ch: 1, kbps: 64, rms: -20 },
  jingle: { ch: 2, kbps: 96, rms: -20 },
  amb: { ch: 1, kbps: 48, rms: -24 },
  music: { ch: 2, kbps: 80, rms: -20 },
};

function find(pack, file) {
  const stack = [join(CACHE, pack)];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (e === file) return p;
    }
  }
  throw new Error(`${file} not found in cache/${pack}: run tools/sound/fetch.sh`);
}

function decode(path, ch, start, len) {
  const args = ['-v', 'error'];
  if (start) args.push('-ss', String(start));
  args.push('-i', path);
  if (len) args.push('-t', String(len));
  args.push('-ac', String(ch), '-ar', String(SR), '-f', 'f32le', '-');
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

// Crossfade the last `x` seconds into the first, equal power, so the result loops without a seam.
function seamless(pcm, ch, x) {
  const frames = pcm.length / ch, n = Math.floor(x * SR), keep = frames - n;
  const out = new Float32Array(keep * ch);
  for (let i = 0; i < keep; i++) {
    for (let c = 0; c < ch; c++) {
      let v = pcm[i * ch + c];
      if (i < n) {
        const w = i / n;
        v = v * Math.sin(w * Math.PI / 2) + pcm[(keep + i) * ch + c] * Math.cos(w * Math.PI / 2);
      }
      out[i * ch + c] = v;
    }
  }
  return out;
}

// Trim leading and trailing near-silence from one-shots, with a short fade at the end.
function trim(pcm, ch) {
  const frames = pcm.length / ch, th = 10 ** (-50 / 20);
  let a = 0, b = frames - 1;
  const loud = (i) => { for (let c = 0; c < ch; c++) if (Math.abs(pcm[i * ch + c]) > th) return true; return false; };
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  const out = pcm.slice(a * ch, (b + 1) * ch);
  const f = Math.min(Math.floor(0.01 * SR), (b - a) >> 1);
  for (let i = 0; i < f; i++) for (let c = 0; c < ch; c++) out[(b - a - i) * ch + c] *= i / f;
  return out;
}

const dB = (x) => 20 * Math.log10(Math.max(x, 1e-9));
function level(pcm, target, gain) {
  let sum = 0, peak = 0;
  for (const v of pcm) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = dB(Math.sqrt(sum / pcm.length));
  // Level to the target, then the per-cue gain, but never past -1 dBFS.
  const g = Math.min(target - rms + (gain || 0), -1 - dB(peak));
  const k = 10 ** (g / 20);
  for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
  return { rms: +(rms + g).toFixed(1), peak: +(dB(peak) + g).toFixed(1) };
}

function encode(pcm, ch, kbps, out) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(ch), '-i', '-',
    '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-ar', String(SR), out], { input: Buffer.from(pcm.buffer) });
}

const manifest = { note: 'Generated by tools/sound/build.mjs. Every file the game plays, with its source and licence.', sfx: {}, music: {}, amb: {}, files: {} };
const wrote = new Set();
let total = 0;
for (const [kind, name, variants] of PICKS) {
  const { ch, kbps, rms } = KIND[kind];
  const files = [];
  variants.forEach((v, i) => {
    let pcm = decode(find(v.pack, v.file), ch, v.start, v.len);
    pcm = v.loop ? seamless(pcm, ch, v.loop) : kind === 'music' ? pcm : trim(pcm, ch);
    const lv = level(pcm, rms, v.gain);
    const prefix = kind === 'jingle' ? 'sfx' : kind;
    const file = `${prefix}-${name}${variants.length > 1 ? `-${i + 1}` : ''}.mp3`;
    encode(pcm, ch, kbps, join(OUT, file));
    const src = SOURCES[v.pack];
    const bytes = statSync(join(OUT, file)).size;
    total += bytes;
    manifest.files[file] = { from: v.file, title: src.title || null, author: src.author, licence: src.licence, page: src.page, seconds: +(pcm.length / ch / SR).toFixed(2), bytes, ...lv };
    wrote.add(file);
    files.push(file);
  });
  const table = kind === 'jingle' ? 'sfx' : kind;
  if (kind === 'music') {
    const [list, n] = name.includes('-') ? name.split('-') : [name, 1];
    (manifest.music[list] ||= []).push(files[0]);
  } else manifest[table][name] = files;
}
for (const name of KEPT_MUSIC) {
  const file = `music-${name}.mp3`;
  if (!existsSync(join(OUT, file))) throw new Error(`missing ${file}: run tools/audio/render.mjs`);
  manifest.music[name] = [file];
  manifest.files[file] = { from: 'tools/audio/score.mjs', title: `Skyrise ${name} loop`, author: 'Skyrise (synthesised in tools/audio/render.mjs)', licence: 'original', bytes: statSync(join(OUT, file)).size };
  total += manifest.files[file].bytes;
  wrote.add(file);
}
// Drop MP3s from earlier builds that nothing plays any more.
for (const f of readdirSync(OUT)) if (f.endsWith('.mp3') && !wrote.has(f)) { unlinkSync(join(OUT, f)); console.log('removed', f); }
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// LICENSE.md: the credits, built from the manifest.
const by = {};
for (const [file, m] of Object.entries(manifest.files)) (by[`${m.author}|${m.page || ''}|${m.licence}|${m.title || ''}`] ||= []).push(file);
const lines = ['# Skyrise audio (assets/audio/)', '',
  'Generated by `tools/sound/build.mjs` from free packs (sources and checksums in `tools/sound/sources.json`).',
  'CC0 files need no credit; they are listed anyway, with thanks. The festival loops are original,',
  'synthesised by `tools/audio/render.mjs`.', '',
  '| Files | Source | Author | Licence |', '|---|---|---|---|'];
for (const [k, files] of Object.entries(by).sort()) {
  const [author, page, licence, title] = k.split('|');
  lines.push(`| ${files.sort().join(', ')} | ${page ? `[${title || page}](${page})` : title} | ${author} | ${licence} |`);
}
writeFileSync(join(OUT, 'LICENSE.md'), lines.join('\n') + '\n');
console.log(`wrote ${wrote.size} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
