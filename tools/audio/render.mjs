// Renders tools/audio/score.mjs to assets/audio/*.mp3. Run from the repo root:
//   SKYRISE_AUDIO_TMP=<a scratch dir> node tools/audio/render.mjs
// Needs ffmpeg with libmp3lame on the PATH. Output is deterministic: the noise
// is seeded, so re-running gives the same files. Not loaded by the game.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC, SFX } from './score.mjs';

const SR = 32000;
const TAU = Math.PI * 2;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', 'assets', 'audio');
const TMP = process.env.SKYRISE_AUDIO_TMP;
if (!TMP) throw new Error('set SKYRISE_AUDIO_TMP to a scratch directory');

const NAMES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const freq = (name) => {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const midi = NAMES[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * 2 ** ((midi - 69) / 12);
};

// Seeded noise, so the percussion is the same on every render.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

// Adds one note into `buf` at sample `i0`. `wrap` makes music loop seamlessly.
function voice(buf, i0, kind, f, dur, vol) {
  const n = Math.floor(dur * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s, env;
    switch (kind) {
      case 'bell':
        env = Math.exp(-t * 3.2);
        s = Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 5) + 0.2 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t * 8);
        break;
      case 'pluck':
        env = Math.exp(-t * 6);
        s = Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2 * t) + 0.1 * Math.sin(TAU * f * 3 * t);
        break;
      case 'bass':
        env = Math.exp(-t * 2.2);
        s = Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2 * t);
        break;
      case 'pad':
        env = Math.min(1, t / 0.6);
        s = Math.sin(TAU * f * t) + Math.sin(TAU * f * 1.003 * t) + Math.sin(TAU * f * 0.997 * t);
        s /= 3;
        break;
      case 'brass': {
        env = Math.min(1, t / 0.025) * Math.exp(-t * 1.1);
        const p = TAU * f * t;
        s = Math.sin(p) + Math.sin(3 * p) / 3 + Math.sin(5 * p) / 5 + Math.sin(7 * p) / 7;
        break;
      }
      case 'gong':
        env = Math.exp(-t * 0.9);
        s = Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * f * 1.51 * t) + 0.4 * Math.sin(TAU * f * 2.07 * t);
        break;
      case 'beep':
        env = Math.min(1, t / 0.005) * Math.min(1, (dur - t) / 0.01);
        s = Math.sign(Math.sin(TAU * f * t)) * 0.4;
        break;
      case 'perc':
        env = Math.exp(-t * 45);
        s = rnd();
        break;
      default: throw new Error(`voice ${kind}`);
    }
    const rel = kind === 'pad' || kind === 'gong' ? 1 : Math.min(1, (dur - t) / 0.012);
    const idx = (i0 + i) % buf.length;
    buf[idx] += vol * env * rel * s;
  }
}

function renderMusic(track) {
  const beat = 60 / track.bpm;
  const len = Math.round(track.bars * 4 * beat * SR);
  const buf = new Float32Array(len);
  for (const part of track.parts) {
    let at = 0; // in beats
    for (const [name, beats] of part.notes) {
      if (name) voice(buf, Math.round(at * beat * SR), part.voice, freq(name), beats * beat * 0.92, part.vol);
      at += beats;
    }
    if (Math.abs(at - track.bars * 4) > 1e-6) throw new Error(`part ${part.voice} adds to ${at} beats, expected ${track.bars * 4}`);
  }
  return buf;
}

function renderSfx(cue) {
  const end = Math.max(...cue.map(([t, , , d]) => t + d)) + 0.05;
  const buf = new Float32Array(Math.round(end * SR));
  for (const [t, kind, name, dur, vol] of cue) {
    voice(buf, Math.round(t * SR), kind, name ? freq(name) : 0, dur, vol);
  }
  // Short fade at the end so a cue never clicks.
  const fade = Math.round(0.01 * SR);
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
  return buf;
}

function normalise(buf, peak) {
  let max = 0;
  for (const x of buf) max = Math.max(max, Math.abs(x));
  const g = max > 0 ? peak / max : 1;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

// 16-bit mono PCM WAV.
function wav(buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const jobs = [
  ...Object.entries(MUSIC).map(([name, t]) => [`music-${name}`, normalise(renderMusic(t), 0.7)]),
  ...Object.entries(SFX).map(([name, c]) => [`sfx-${name}`, normalise(renderSfx(c), 0.85)]),
];
for (const [name, buf] of jobs) {
  const wavPath = join(TMP, `${name}.wav`);
  writeFileSync(wavPath, wav(buf));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '80k', '-ac', '1', join(OUT, `${name}.mp3`)], { stdio: 'inherit' });
  rmSync(wavPath, { force: true });
  console.log(`${name}.mp3  ${(buf.length / SR).toFixed(2)} s`);
}
