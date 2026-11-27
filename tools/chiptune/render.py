"""Skyrise chiptune renderer: the score as 8-bit stems, plus ambience and sound effects.

Reads tools/chiptune/score.json (exported from tools/audio/score.mjs, so the tunes stay the
JS build's own) and writes Ogg Vorbis files to godot/assets/chip/:

  music-<track>-<stem>.ogg   lead, bass, arp and drums for each loop. Every stem of a track
                             is exactly the loop's length, so Godot plays them in sync and
                             fades layers in as the tower grows.
  amb-<name>.ogg             day, night and rain ambience, seamless loops.
  sfx-<name>.ogg             the game's cues, re-voiced for the chip, plus coin and move-in.

The synth is a small sound chip: two pulse channels (12.5, 25 and 50% duty), a stepped
triangle, and an LFSR noise channel, with volume in 16 steps. Seeded, so a re-render gives
the same files. Run from the repo root:

  node -e "import('./tools/audio/score.mjs').then(m => process.stdout.write(JSON.stringify({music: m.MUSIC, sfx: m.SFX})))" > tools/chiptune/score.json
  python3 tools/chiptune/render.py
"""
import json
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 32000
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'godot', 'assets', 'chip')
NAMES = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7,
         'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
RNG = np.random.default_rng(20261127)


def midi(name):
    pitch, octave = (name[:2], name[2:]) if len(name) > 2 and name[1] in '#b' else (name[:1], name[1:])
    return NAMES[pitch] + (int(octave) + 1) * 12


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---- Oscillators ----------------------------------------------------------------

def pulse(f, n, duty=0.25, vib=0.0, slide=0.0):
    t = np.arange(n) / SR
    freq = f * (1 + vib * np.sin(2 * np.pi * 5.5 * t)) * (2 ** (slide * t))
    phase = np.cumsum(freq) / SR % 1.0
    return np.where(phase < duty, 1.0, -1.0)


def triangle(f, n, slide=0.0):
    t = np.arange(n) / SR
    freq = f * (2 ** (slide * t))
    phase = np.cumsum(freq) / SR % 1.0
    tri = 1 - 4 * np.abs(phase - 0.5)
    return np.round(tri * 7.5) / 7.5              # 4-bit steps, like the chip's triangle


_lfsr_cache = {}


def noise(n, rate=8000.0, short=False):
    """LFSR noise held at `rate` steps per second; `short` gives the metallic 93-step loop."""
    key = (rate, short)
    if key not in _lfsr_cache:
        reg, seq = 1, []
        tap = 6 if short else 1
        for _ in range(32767):
            bit = (reg ^ (reg >> tap)) & 1
            reg = (reg >> 1) | (bit << 14)
            seq.append(1.0 if reg & 1 else -1.0)
        _lfsr_cache[key] = np.array(seq)
    seq = _lfsr_cache[key]
    idx = (np.arange(n) * rate / SR).astype(int) % len(seq)
    return seq[idx]


def env(n, attack=0.004, decay=0.15, sustain=0.5, release=0.05, hold=None):
    """ADSR in 16 volume steps. `hold` is the note length in samples before release."""
    hold = n if hold is None else hold
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = sustain + (1 - sustain) * np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-4))
    e = np.where(t < attack, a, d)
    rel_t = (np.arange(n) - hold) / SR
    e = np.where(np.arange(n) >= hold, e * np.clip(1 - rel_t / max(release, 1e-4), 0, 1), e)
    return np.round(e * 15) / 15


# ---- Voices: the score's voices mapped onto the chip ------------------------------

def voice(kind, f, dur):
    """One note: `f` in Hz (None for unpitched), `dur` in seconds. Returns samples incl. release."""
    hold = int(dur * SR)
    if kind == 'pluck':
        n = hold + int(0.06 * SR)
        return pulse(f, n, 0.25) * env(n, 0.002, 0.18, 0.25, 0.05, hold)
    if kind == 'bell':
        n = hold + int(0.25 * SR)
        return 0.8 * pulse(f, n, 0.125, vib=0.004) * env(n, 0.002, 0.35, 0.0, 0.2, hold)
    if kind == 'brass':
        n = hold + int(0.08 * SR)
        return 0.7 * pulse(f, n, 0.5, vib=0.006) * env(n, 0.03, 0.2, 0.7, 0.08, hold)
    if kind == 'beep':
        n = hold + int(0.02 * SR)
        return 0.6 * pulse(f, n, 0.5) * env(n, 0.001, 1.0, 1.0, 0.02, hold)
    if kind == 'bass':
        n = hold + int(0.04 * SR)
        return triangle(f, n) * env(n, 0.003, 0.4, 0.75, 0.04, hold)
    if kind == 'pad':
        n = hold + int(0.3 * SR)
        a = pulse(f, n, 0.5) * 0.5 + pulse(f * 1.004, n, 0.25) * 0.5
        return 0.45 * a * env(n, 0.25, 0.6, 0.6, 0.3, hold)
    if kind == 'gong':
        n = hold + int(0.8 * SR)
        e = env(n, 0.002, 0.9, 0.0, 0.5, hold)
        return (0.5 * triangle(f or 98.0, n, slide=-0.2) + 0.35 * noise(n, 3000, True)) * e
    if kind == 'perc':
        n = int(0.12 * SR)
        return 0.6 * noise(n, 12000) * env(n, 0.001, 0.04, 0.0, 0.02)
    raise ValueError(kind)


def kick(n=None):
    n = n or int(0.16 * SR)
    return triangle(120.0, n, slide=-6.0) * env(n, 0.001, 0.08, 0.0, 0.03)


def snare():
    n = int(0.14 * SR)
    return (0.55 * noise(n, 14000) + 0.25 * pulse(220.0, n, 0.5)) * env(n, 0.001, 0.05, 0.0, 0.03)


def hat(open_=False):
    n = int((0.09 if open_ else 0.03) * SR)
    return 0.35 * noise(n, 22000, True) * env(n, 0.001, 0.03 if not open_ else 0.08, 0.0, 0.01)


# ---- Mixing ------------------------------------------------------------------

def add(buf, at, s, vol, loop=True):
    """Mix `s` into `buf` from sample `at`; with `loop`, the tail wraps to the start."""
    at = int(at)
    end = at + len(s)
    if end <= len(buf):
        buf[at:end] += s * vol
    else:
        k = len(buf) - at
        buf[at:] += s[:k] * vol
        if loop:
            rest = s[k:]
            while len(rest):
                m = min(len(rest), len(buf))
                buf[:m] += rest[:m] * vol
                rest = rest[m:]


def render_track(name, tr):
    beat = 60.0 / tr['bpm']
    n = int(round(tr['bars'] * 4 * beat * SR))
    stems = {k: np.zeros(n) for k in ('lead', 'bass', 'arp', 'drums')}
    melodic = 0
    bass_notes = []
    for part in tr['parts']:
        v = part['voice']
        stem = 'bass' if v in ('bass', 'pad', 'gong') else 'drums' if v == 'perc' else ('lead' if melodic == 0 else 'arp')
        if stem in ('lead', 'arp'):
            melodic += 1
        t = 0.0
        for note, beats in part['notes']:
            if note is not None or v == 'perc':
                f = hz(midi(note)) if note else None
                add(stems[stem], t * SR, voice(v, f, beats * beat * 0.95), part['vol'])
                if v == 'bass' and note:
                    bass_notes.append((t, beats, midi(note)))
            t += beats * beat
    # The arp layer: root, fifth and octave of each bass note, two octaves up, in 16ths.
    step = beat / 4
    for t0, beats, m in bass_notes:
        k = 0
        t = t0
        while t < t0 + beats * beat - 1e-6:
            interval = (0, 7, 12, 7)[k % 4]
            add(stems['arp'], t * SR, voice('pluck', hz(m + 24 + interval), step * 0.8), 0.16)
            t += step
            k += 1
    # Drums, unless the score has its own percussion: kick, snare and hats; night is half-time.
    if not np.any(stems['drums']):
        bars = tr['bars']
        night = name == 'night'
        for b in range(bars):
            for q in range(4):
                t = (b * 4 + q) * beat
                if q == 0 or (q == 2 and not night):
                    add(stems['drums'], t * SR, kick(), 0.9)
                if (q in (1, 3) and not night) or (night and q == 2):
                    add(stems['drums'], t * SR, snare(), 0.45 if night else 0.6)
                for h in (0, 0.5):
                    add(stems['drums'], (t + h * beat) * SR, hat(open_=(h == 0.5 and q == 3)), 0.25 if night else 0.35)
    else:
        for b in range(tr['bars']):
            add(stems['drums'], (b * 4) * beat * SR, kick(), 0.8)
    return stems


# ---- Sound effects -------------------------------------------------------------------

def render_sfx(spec):
    length = max(at + dur + 0.6 for at, _v, _n, dur, _vol in spec)
    buf = np.zeros(int(length * SR))
    for at, v, note, dur, vol in spec:
        f = hz(midi(note)) if note else None
        add(buf, at * SR, voice(v, f, dur), vol * 1.6, loop=False)
    return trim(buf)


def trim(buf):
    nz = np.nonzero(np.abs(buf) > 1e-4)[0]
    return buf[: (nz[-1] + 1 if len(nz) else 1) + int(0.01 * SR)]


def extra_sfx():
    out = {}
    # Coin: the classic two-step blip, for income.
    a = pulse(hz(83), int(0.06 * SR), 0.5) * env(int(0.06 * SR), 0.001, 1, 1, 0.01)
    b = pulse(hz(88), int(0.22 * SR), 0.5) * env(int(0.22 * SR), 0.001, 0.12, 0.2, 0.08)
    out['coin'] = np.concatenate([a, b]) * 0.35
    # Move-in: a small rising third, for a tenant arriving.
    s = np.zeros(int(0.5 * SR))
    for i, m in enumerate((72, 76, 79)):
        add(s, i * 0.07 * SR, voice('pluck', hz(m), 0.08), 0.5, loop=False)
    out['movein'] = trim(s)
    # Ding: a lift arriving, two pulse tones.
    s = np.zeros(int(1.0 * SR))
    add(s, 0, voice('bell', hz(88), 0.25), 0.6, loop=False)
    add(s, 0.18 * SR, voice('bell', hz(84), 0.4), 0.6, loop=False)
    out['ding'] = trim(s)
    # Crumble: demolition rubble, falling-pitch noise.
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    rate = 9000 * np.exp(-t * 3)
    idx = (np.cumsum(rate) / SR).astype(int) % 32767
    noise(1)
    seq = _lfsr_cache[(8000.0, False)]
    out['crumble'] = 0.6 * seq[idx] * env(n, 0.002, 0.25, 0.1, 0.2, int(0.5 * SR))
    return out


# ---- Ambience ---------------------------------------------------------------------------

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    # One-pole filter; the loop is fine for a few seconds of audio.
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def seamless(x, fade=1.0):
    """Crossfade the tail into the head so the loop has no click."""
    f = int(fade * SR)
    head, tail = x[:f].copy(), x[-f:]
    w = np.linspace(0, 1, f)
    x = x[:-f].copy()
    x[:f] = head * w + tail * (1 - w)
    return x


def ambience():
    out = {}
    dur = 16.0
    n = int((dur + 1) * SR)
    t = np.arange(n) / SR
    # Day: a soft traffic rumble that swells, and chip birdsong now and then.
    rumble = lowpass(RNG.standard_normal(n), 180) * (0.6 + 0.4 * np.sin(2 * np.pi * t / 7.3) ** 2)
    day = rumble * 0.9
    for _ in range(14):
        at = RNG.uniform(0, dur)
        f0 = RNG.uniform(2200, 3400)
        for k in range(RNG.integers(2, 5)):
            m = int(0.05 * SR)
            chirp = pulse(f0, m, 0.25, slide=3.0) * env(m, 0.002, 0.03, 0.0, 0.01)
            add(day, (at + k * 0.09) * SR, chirp, 0.05)
    out['day'] = seamless(day)
    # Night: a low hum and crickets in pulses.
    hum = lowpass(RNG.standard_normal(n), 90) * 0.6
    night = hum.copy()
    for _ in range(40):
        at = RNG.uniform(0, dur)
        m = int(0.18 * SR)
        trill = pulse(4400, m, 0.5) * (np.sin(2 * np.pi * 30 * np.arange(m) / SR) > 0) * env(m, 0.01, 0.1, 0.3, 0.05)
        add(night, at * SR, trill, 0.015)
    out['night'] = seamless(night)
    # Rain: bright hiss with drips.
    hiss = lowpass(RNG.standard_normal(n), 2400) * 0.5
    rain = hiss.copy()
    for _ in range(60):
        at = RNG.uniform(0, dur)
        m = int(0.04 * SR)
        drip = pulse(RNG.uniform(900, 1600), m, 0.5, slide=-2.0) * env(m, 0.001, 0.015, 0.0, 0.01)
        add(rain, at * SR, drip, 0.06)
    out['rain'] = seamless(rain)
    return out


# ---- Output ---------------------------------------------------------------------------------

def write_ogg(path, x, peak=0.8, quality=3):
    m = np.max(np.abs(x)) or 1.0
    x = x / m * peak if m > peak else x
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wav = tmp.name
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', str(quality), path], check=True)
    os.unlink(wav)


def main():
    score = json.load(open(os.path.join(HERE, 'score.json')))
    os.makedirs(OUT, exist_ok=True)
    count = 0
    for name, tr in score['music'].items():
        stems = render_track(name, tr)
        # One gain for the whole track, so the stems keep their balance when layered.
        peak = max(np.max(np.abs(sum(stems.values()))), 1e-6)
        for stem, x in stems.items():
            write_ogg(os.path.join(OUT, f'music-{name}-{stem}.ogg'), x * (0.8 / peak), peak=1.0, quality=1)
            count += 1
    sfx = {k: render_sfx(v) for k, v in score['sfx'].items()}
    sfx['demolish'] = sfx['demolish'] * 0.6 + np.pad(extra_sfx()['crumble'], (0, max(0, len(sfx['demolish']) - int(0.7 * SR))))[: len(sfx['demolish'])] * 0.6
    sfx.update({k: v for k, v in extra_sfx().items() if k != 'crumble'})
    for name, x in sfx.items():
        write_ogg(os.path.join(OUT, f'sfx-{name}.ogg'), x)
        count += 1
    for name, x in ambience().items():
        write_ogg(os.path.join(OUT, f'amb-{name}.ogg'), x, peak=0.5, quality=0)
        count += 1
    print(f'wrote {count} files to {os.path.normpath(OUT)}')


if __name__ == '__main__':
    sys.exit(main())
