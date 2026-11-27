// Sound and music (Sprint 6). Plays the MP3s rendered by tools/audio/render.mjs.
// The sound choice is per device (localStorage, never in the tower save). Browsers
// only allow audio after a tap, so nothing plays until unlock() runs from a gesture.
// Every play is best-effort: a failed play or missing storage is silent.

export const FESTIVAL_TRACK = ['newyear', 'cny', 'raya', 'deepavali', 'christmas', 'merdeka'];
const KEY = 'skyrise.sound';
const SFX_VOLUME = 0.7;
const MUSIC_VOLUME = 0.35;
const POOL = 3; // overlapping copies of one cue, so rapid taps do not cut each other off

// Which loop plays: the first festival on the calendar, otherwise night (19:00 to 06:00) or day.
export function trackFor(festivals = [], hour = 12) {
  const festival = FESTIVAL_TRACK.find((f) => festivals.includes(f));
  if (festival) return festival;
  return hour >= 19 || hour < 6 ? 'night' : 'day';
}

export function createAudio({ base = 'assets/audio/', storage = globalThis.localStorage } = {}) {
  const read = () => { try { return storage.getItem(KEY) !== 'off'; } catch { return true; } };
  const save = (on) => { try { storage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: keep the choice for this visit only */ } };

  let on = read();
  let unlocked = false;
  let current = null;                 // the loop the player should hear
  const music = new Audio();
  music.loop = true;
  music.preload = 'none';
  music.volume = MUSIC_VOLUME;
  const pools = new Map();            // cue name -> Audio copies

  function startMusic() {
    if (!current || !on || !unlocked) return;
    const src = `${base}music-${current}.mp3`;
    if (!music.src.endsWith(src)) music.src = src;
    music.play().catch(() => {});
  }

  return {
    // Call from a pointer or key handler. Starts the loop the first time the player taps.
    unlock() {
      if (unlocked) return;
      unlocked = true;
      startMusic();
    },
    // Switch loops only when the track really changes.
    setMusic(name) {
      if (name === current) return;
      current = name;
      if (!on || !unlocked) return;
      startMusic();
    },
    play(name) {
      if (!on || !unlocked) return;
      let pool = pools.get(name);
      if (!pool) { pool = []; pools.set(name, pool); }
      let el = pool.find((a) => a.paused || a.ended);
      if (!el && pool.length < POOL) { el = new Audio(`${base}sfx-${name}.mp3`); pool.push(el); }
      if (!el) el = pool[0];
      try { el.currentTime = 0; } catch { /* not seekable yet: play from the start anyway */ }
      el.volume = SFX_VOLUME;
      el.play().catch(() => {});
    },
    toggle() {
      on = !on;
      save(on);
      if (on) startMusic(); else music.pause();
      return on;
    },
    isOn: () => on,
  };
}
