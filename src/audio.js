// Sound and music (Sprint 8). Plays the files built by tools/sound/build.mjs, listed in
// assets/audio/manifest.json, through the Web Audio API:
//
//   master  -> compressor -> speakers
//   music   playlists (day, night, festivals), one track after another, crossfaded when the
//           playlist changes; streamed from <audio> so a long track never sits in memory.
//           A low-pass filter muffles it while a sheet is open (duck).
//   amb     looping traffic, birds, crickets and rain, faded by the hour, the weather and
//           how busy the tower is (ambienceMix below).
//   sfx     short cues, decoded once. Cues from a place in the tower are panned left or right
//           (panFor); repeats get a slightly different pitch, and noisy cues are rate-limited.
//
// The sound choice is per device (localStorage, never in the tower save). Browsers only allow
// audio after a tap, so nothing starts until unlock() runs from a gesture. Every play is
// best-effort: no Web Audio, a missing file or a failed decode is silent.

export const FESTIVAL_TRACK = ['newyear', 'cny', 'raya', 'deepavali', 'christmas', 'merdeka'];
const KEY = 'skyrise.sound';
const LEVEL = { music: 0.42, amb: 0.5, sfx: 0.8 };
const FADE_S = 2.5;                      // music crossfade
const DUCK_HZ = 700;                     // music low-pass while a sheet is open
const GAP_S = 2;                         // silence between two tracks of a playlist
// Noisy cues: at most one per this many ms, so a busy tower stays pleasant.
const MIN_GAP_MS = { coin: 1800, ding: 1600, movein: 600, tap: 40, build: 60 };
const NO_DETUNE = new Set(['star', 'quarter', 'loan', 'vip', 'vip-poor', 'win', 'gameover', 'alarm']);

// Which playlist plays: the first festival on the calendar, otherwise night (19:00 to 06:00) or day.
export function trackFor(festivals = [], hour = 12) {
  const festival = FESTIVAL_TRACK.find((f) => festivals.includes(f));
  if (festival) return festival;
  return hour >= 19 || hour < 6 ? 'night' : 'day';
}

// Ambience levels (0..1) for an hour, the weather and the tower's population.
// Traffic swells at the rush hours and sleeps at night; birds sing in the morning; crickets at
// night; rain when it rains (and it hushes the birds and crickets). A bigger tower is a busier street.
export function ambienceMix(hour, weather = 'clear', population = 0) {
  const night = hour >= 20 || hour < 5;
  const rush = [7, 8, 9, 12, 13, 17, 18].includes(hour);
  const wet = weather === 'rain' || weather === 'snow';
  const busy = Math.min(1, population / 600);
  return {
    traffic: night ? 0.12 : (rush ? 0.55 : 0.3) + 0.25 * busy,
    birds: wet || night ? 0 : hour >= 5 && hour < 10 ? 0.7 : hour < 17 ? 0.25 : 0.1,
    crickets: night && !wet ? 0.6 : hour === 19 && !wet ? 0.25 : 0,
    rain: weather === 'rain' ? 0.8 : 0,
  };
}

// Stereo position (-0.8 left .. 0.8 right) of a point at screen x on a stage `width` wide.
export function panFor(x, width) {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  return Math.max(-1, Math.min(1, (x / width) * 2 - 1)) * 0.8;
}

export function createAudio({ base = 'assets/audio/', storage = globalThis.localStorage, now = () => performance.now() } = {}) {
  const read = () => { try { return storage.getItem(KEY) !== 'off'; } catch { return true; } };
  const save = (on) => { try { storage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: this visit only */ } };

  let on = read();
  let ctx = null, manifest = null;
  let bus = null;                                   // { master, music, amb, sfx, lowpass }
  const buffers = new Map();                        // file -> AudioBuffer | Promise
  const lastAt = new Map();                         // cue -> ms of the last play
  const amb = new Map();                            // name -> { gain, src }
  let ambTarget = { traffic: 0, birds: 0, crickets: 0, rain: 0 };
  let playlist = null;                              // the playlist the player should hear
  let deck = null;                                  // { el, gain, list, index }
  let ducked = false;
  const played = {};                                // cue -> times actually played (for the checks)

  function graph() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    const master = ctx.createGain();
    master.gain.value = on ? 1 : 0;
    master.connect(comp).connect(ctx.destination);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass'; lowpass.frequency.value = 20000; lowpass.Q.value = 0.5;
    const music = ctx.createGain(); music.gain.value = LEVEL.music;
    lowpass.connect(music).connect(master);
    const ambBus = ctx.createGain(); ambBus.gain.value = LEVEL.amb; ambBus.connect(master);
    const sfx = ctx.createGain(); sfx.gain.value = LEVEL.sfx; sfx.connect(master);
    bus = { master, music: lowpass, amb: ambBus, sfx, lowpass };
    return true;
  }

  async function load(file) {
    if (buffers.has(file)) return buffers.get(file);
    const p = fetch(base + file).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
      .then(buf => { buffers.set(file, buf); return buf; })
      .catch(() => { buffers.set(file, null); return null; });
    buffers.set(file, p);
    return p;
  }

  // ---- Music ----------------------------------------------------------------
  function startPlaylist(name) {
    if (!ctx || !manifest || !on) return;
    const list = manifest.music[name] || manifest.music.day || [];
    if (!list.length) return;
    if (deck && deck.list === list) return;
    const old = deck;
    const index = Math.floor(Math.random() * list.length);
    deck = playTrack(list, index, old ? FADE_S : 0.6);
    if (old) fadeOut(old, FADE_S);
  }
  function playTrack(list, index, fadeIn) {
    const el = new Audio(base + list[index]);
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);
    src.connect(gain).connect(bus.music);
    const d = { el, gain, list, index };
    el.addEventListener('ended', () => {
      if (deck !== d) return;
      setTimeout(() => { if (deck === d && on) { deck = playTrack(list, (index + 1) % list.length, 0.3); disconnect(d); } }, GAP_S * 1000);
    });
    el.play().catch(() => {});
    return d;
  }
  function fadeOut(d, s) {
    const t = ctx.currentTime;
    d.gain.gain.cancelScheduledValues(t);
    d.gain.gain.setValueAtTime(d.gain.gain.value, t);
    d.gain.gain.linearRampToValueAtTime(0, t + s);
    setTimeout(() => { d.el.pause(); disconnect(d); }, s * 1000 + 100);
  }
  function disconnect(d) { try { d.gain.disconnect(); } catch { /* already gone */ } }

  // ---- Ambience ---------------------------------------------------------------
  async function startAmbience() {
    if (!ctx || !manifest) return;
    for (const [name, files] of Object.entries(manifest.amb)) {
      if (amb.has(name)) continue;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(bus.amb);
      amb.set(name, { gain, src: null });
      load(files[0]).then(buf => {
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        src.connect(gain);
        // Start each loop at a random point, so two loops never line up the same way twice.
        src.start(0, Math.random() * buf.duration);
        amb.get(name).src = src;
        applyAmbience(1.5);
      });
    }
  }
  function applyAmbience(seconds) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [name, a] of amb) {
      a.gain.gain.cancelScheduledValues(t);
      a.gain.gain.setValueAtTime(a.gain.gain.value, t);
      a.gain.gain.linearRampToValueAtTime(ambTarget[name] || 0, t + seconds);
    }
  }

  // ---- Cues -----------------------------------------------------------------------
  function play(name, { x = null, width = 0, gain = 1 } = {}) {
    if (!on || !ctx || !manifest) return;
    const files = manifest.sfx[name];
    if (!files || !files.length) return;
    const t = now();
    const gap = MIN_GAP_MS[name] || 0;
    if (gap && t - (lastAt.get(name) || -1e9) < gap) return;
    lastAt.set(name, t);
    const file = files[Math.floor(Math.random() * files.length)];
    const fire = (buf) => {
      if (!buf || !on) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (!NO_DETUNE.has(name)) src.playbackRate.value = 0.95 + Math.random() * 0.1;
      const g = ctx.createGain();
      g.gain.value = gain;
      let node = src.connect(g);
      if (x != null && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = panFor(x, width);
        node = node.connect(p);
      }
      node.connect(bus.sfx);
      src.start();
      played[name] = (played[name] || 0) + 1;
    };
    const b = buffers.get(file);
    if (b && !(b instanceof Promise)) fire(b); else load(file).then(fire);
  }

  function preload() {
    if (!manifest) return;
    for (const files of Object.values(manifest.sfx)) for (const f of files) load(f);
  }

  return {
    // Call from a pointer or key handler. Builds the audio graph and starts music the first time.
    unlock() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
      if (!graph()) return;
      ctx.resume().catch(() => {});
      fetch(base + 'manifest.json').then(r => r.json()).then(m => {
        manifest = m;
        preload();
        startAmbience();
        if (playlist) startPlaylist(playlist);
      }).catch(() => {});
    },
    // Switch playlists only when the playlist really changes.
    setMusic(name) {
      if (name === playlist) return;
      playlist = name;
      startPlaylist(name);
    },
    // The world around the tower: hour, weather and population set the ambience.
    setScene(hour, weather, population) {
      const next = ambienceMix(hour, weather, population);
      if (Object.keys(next).every(k => Math.abs(next[k] - ambTarget[k]) < 0.01)) return;
      ambTarget = next;
      applyAmbience(3);
    },
    // Muffle the music while a sheet covers the tower.
    duck(down) {
      if (down === ducked || !ctx) return;
      ducked = down;
      const f = bus.lowpass.frequency, t = ctx.currentTime;
      f.cancelScheduledValues(t);
      f.setValueAtTime(f.value, t);
      f.exponentialRampToValueAtTime(down ? DUCK_HZ : 20000, t + 0.4);
    },
    play,
    // Pause everything while the page is hidden, and pick up again when it is back.
    suspend(hidden) {
      if (!ctx) return;
      if (hidden) ctx.suspend().catch(() => {}); else ctx.resume().catch(() => {});
    },
    toggle() {
      on = !on;
      save(on);
      if (ctx) {
        const g = bus.master.gain, t = ctx.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(on ? 1 : 0, t + 0.2);
        if (on) { if (!deck && playlist) startPlaylist(playlist); else if (deck) deck.el.play().catch(() => {}); }
        else if (deck) setTimeout(() => { if (!on && deck) deck.el.pause(); }, 250);
      }
      return on;
    },
    isOn: () => on,
    // For the browser checks: what is loaded and playing.
    debug: () => ({
      ready: !!manifest, state: ctx ? ctx.state : 'none', playlist,
      track: deck ? deck.list[deck.index] : null, ducked,
      amb: Object.fromEntries([...amb].map(([k, a]) => [k, +a.gain.gain.value.toFixed(2)])),
      target: { ...ambTarget },
      decoded: [...buffers.values()].filter(b => b && !(b instanceof Promise)).length,
      failed: [...buffers.entries()].filter(([, b]) => b === null).map(([f]) => f),
      played: { ...played },
    }),
  };
}
