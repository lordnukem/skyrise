// Skyrise score: the music loops and sound effects, as plain note data.
// tools/audio/render.mjs turns this into assets/audio/*.mp3 with ffmpeg.
// Nothing here runs in the game. Original compositions, written for Skyrise.
//
// Notes are names like "C4" (middle C is C4). `null` is a rest. Durations are in beats.
// Music parts play one after another; every part of a track should add up to `bars * 4` beats.
// Voices: bell, pluck, bass, brass, gong, pad, perc, beep.

const rep = (pattern, times) => Array.from({ length: times }, () => pattern).flat();
// Arpeggio over a chord: `pattern` gives indexes into the chord, repeated per bar.
const arp = (chord, pattern, step, bars) => {
  const out = [];
  for (let b = 0; b < bars; b++) for (let i = 0; i < 4 / step; i++) out.push([chord[pattern[i % pattern.length]], step]);
  return out;
};

// ---- Music loops ------------------------------------------------------------

export const MUSIC = {
  // Day: C major, a bright walking tune over I - vi - IV - V.
  day: { bpm: 96, bars: 8, parts: [
    { voice: 'pluck', vol: 0.5, notes: [
      ['E5', 1], ['G5', 1], ['C5', 2],   ['D5', 1], ['C5', 1], ['A4', 2],
      ['F4', 1], ['A4', 1], ['C5', 2],   ['G4', 2], ['E4', 2],
      ['E4', 1], ['G4', 1], ['A4', 2],   ['C5', 1], ['B4', 1], ['G4', 2],
      ['A4', 1], ['F4', 1], ['E4', 2],   ['D4', 2], ['C4', 2],
    ] },
    { voice: 'bass', vol: 0.45, notes: [['C2', 4], ['A2', 4], ['F2', 4], ['G2', 4], ['C2', 4], ['A2', 4], ['F2', 4], ['G2', 4]] },
  ] },

  // Night: A minor, slower, with a sustained pad under the tune.
  night: { bpm: 72, bars: 8, parts: [
    { voice: 'bell', vol: 0.35, notes: [
      ['A4', 2], ['C5', 2],   ['B4', 1], ['A4', 1], ['G4', 2],
      ['F4', 2], ['E4', 2],   ['E4', 1], ['D4', 1], ['E4', 2],
      ['A4', 1], ['C5', 1], ['E5', 2],   ['D5', 2], ['C5', 2],
      ['B4', 1], ['A4', 1], ['G4', 2],   ['E4', 4],
    ] },
    { voice: 'pad', vol: 0.22, notes: [['A3', 4], ['F3', 4], ['C4', 4], ['E3', 4], ['A3', 4], ['F3', 4], ['C4', 4], ['E3', 4]] },
    { voice: 'bass', vol: 0.4, notes: [['A2', 4], ['F2', 4], ['C3', 4], ['E2', 4], ['A2', 4], ['F2', 4], ['C3', 4], ['E2', 4]] },
  ] },

  // New Year: G major, a bright bell arpeggio over G - D - Em - C.
  newyear: { bpm: 120, bars: 8, parts: [
    { voice: 'bell', vol: 0.45, notes: [
      ...arp(['G4', 'B4', 'D5', 'G5'], [0, 1, 2, 3, 2, 1, 0, 1], 0.5, 2),
      ...arp(['D4', 'F#4', 'A4', 'D5'], [0, 1, 2, 3, 2, 1, 0, 1], 0.5, 2),
      ...arp(['E4', 'G4', 'B4', 'E5'], [0, 1, 2, 3, 2, 1, 0, 1], 0.5, 2),
      ...arp(['C4', 'E4', 'G4', 'C5'], [0, 1, 2, 3, 2, 1, 0, 1], 0.5, 2),
    ] },
    { voice: 'bass', vol: 0.4, notes: [['G2', 4], ['D2', 4], ['E2', 4], ['C2', 4], ['G2', 4], ['D2', 4], ['E2', 4], ['C2', 4]] },
  ] },

  // Chinese New Year: C pentatonic, pluck melody, a gong on the first beat of each bar pair.
  cny: { bpm: 100, bars: 8, parts: [
    { voice: 'pluck', vol: 0.55, notes: [
      ['E5', 1], ['D5', 1], ['C5', 2],   ['G4', 1], ['A4', 1], ['C5', 2],
      ['D5', 1], ['E5', 1], ['G5', 2],   ['E5', 2], ['D5', 2],
      ['A4', 1], ['C5', 1], ['D5', 2],   ['E5', 1], ['G5', 1], ['E5', 2],
      ['D5', 1], ['C5', 1], ['A4', 2],   ['G4', 2], ['C5', 2],
    ] },
    { voice: 'bass', vol: 0.4, notes: rep([['C3', 2], ['G2', 2]], 8) },
    { voice: 'gong', vol: 0.5, notes: [['C2', 8], ['G2', 8], ['C2', 8], ['G2', 8]] },
  ] },

  // Hari Raya: D minor, two interlocking bell parts in the style of a gamelan.
  raya: { bpm: 110, bars: 8, parts: [
    { voice: 'bell', vol: 0.4, notes: rep([['D5', 0.5], ['A4', 0.5]], 32) },
    { voice: 'bell', vol: 0.3, notes: rep([['F5', 0.5], ['C5', 0.5]], 32) },
    { voice: 'bass', vol: 0.4, notes: [['D2', 4], ['C2', 4], ['Bb1', 4], ['A1', 4], ['D2', 4], ['C2', 4], ['Bb1', 4], ['A1', 4]] },
  ] },

  // Deepavali: D major, a plucked phrase with a diya-bell top line.
  deepavali: { bpm: 90, bars: 8, parts: [
    { voice: 'pluck', vol: 0.5, notes: rep([['A4', 1], ['D5', 1], ['F#5', 1], ['E5', 1]], 8) },
    { voice: 'bell', vol: 0.3, notes: [['D6', 4], ['A5', 4], ['F#5', 4], ['E5', 4], ['D6', 4], ['A5', 4], ['F#5', 4], ['E5', 4]] },
    { voice: 'bass', vol: 0.4, notes: rep([['D2', 2], ['A2', 2]], 8) },
  ] },

  // Christmas: E major, the old tune "Jingle Bells" played on bells, with sleigh-bell shakes.
  christmas: { bpm: 120, bars: 8, parts: [
    { voice: 'bell', vol: 0.45, notes: rep([
      ['E5', 1], ['E5', 1], ['E5', 2], ['E5', 1], ['E5', 1], ['E5', 2],
      ['E5', 1], ['G5', 1], ['C5', 1.5], ['D5', 0.5], ['E5', 4],
    ], 2) },
    { voice: 'bass', vol: 0.4, notes: rep([['C3', 2], ['G2', 2]], 8) },
    { voice: 'perc', vol: 0.18, notes: rep([[null, 0.5]], 64) },
  ] },

  // Merdeka: C major march, brass tune over a steady bass and a snare on the beat.
  merdeka: { bpm: 120, bars: 16, parts: [
    { voice: 'brass', vol: 0.3, notes: [
      ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C5', 2], ['G4', 2],
      ['C5', 1], ['D5', 1], ['E5', 1], ['G5', 1], ['E5', 2], ['D5', 2],
      ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C5', 2], ['G4', 2],
      ['A4', 1], ['C5', 1], ['G4', 1], ['E4', 1], ['G4', 2], ['C4', 2],
      ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C5', 2], ['G4', 2],
      ['C5', 1], ['D5', 1], ['E5', 1], ['G5', 1], ['E5', 2], ['D5', 2],
      ['G4', 1], ['C5', 1], ['E5', 1], ['G5', 1], ['C6', 4],
      ['C5', 1], ['G4', 1], ['E4', 1], ['C4', 1], ['C4', 4],
    ] },
    { voice: 'bass', vol: 0.4, notes: rep([['C3', 1], ['G2', 1], ['C3', 1], ['G2', 1]], 16) },
    { voice: 'perc', vol: 0.2, notes: rep([[null, 1]], 64) },
  ] },
};

// ---- Sound effects ----------------------------------------------------------
// Each cue is a list of [start seconds, voice, note or null, duration seconds, volume].

export const SFX = {
  tap:      [[0, 'pluck', 'A5', 0.05, 0.25]],
  build:    [[0, 'bass', 'G2', 0.14, 0.6], [0, 'perc', null, 0.05, 0.35]],
  demolish: [[0, 'perc', null, 0.35, 0.6], [0, 'bass', 'E2', 0.4, 0.5], [0.12, 'bass', 'C2', 0.3, 0.4]],
  repair:   [[0, 'pluck', 'C5', 0.12, 0.45], [0.1, 'pluck', 'E5', 0.14, 0.45]],
  lift:     [[0, 'bell', 'E5', 0.8, 0.5], [0.35, 'bell', 'A5', 0.9, 0.5]],
  alarm:    [[0, 'beep', 'A5', 0.15, 0.35], [0.3, 'beep', 'A5', 0.15, 0.35], [0.6, 'beep', 'A5', 0.15, 0.35]],
  vip:      [[0, 'bell', 'C5', 0.5, 0.4], [0.1, 'bell', 'E5', 0.5, 0.4], [0.2, 'bell', 'G5', 0.5, 0.4], [0.3, 'bell', 'C6', 0.8, 0.4]],
  quarter:  [[0, 'pluck', 'C4', 0.4, 0.4], [0.12, 'pluck', 'E4', 0.4, 0.4], [0.24, 'pluck', 'G4', 0.4, 0.4], [0.36, 'pluck', 'C5', 0.8, 0.45]],
  loan:     [[0, 'pluck', 'G4', 0.4, 0.4], [0.25, 'pluck', 'E4', 0.4, 0.4], [0.5, 'pluck', 'C4', 0.9, 0.4]],
  gameover: [[0, 'brass', 'C4', 0.45, 0.3], [0.4, 'brass', 'G3', 0.45, 0.3], [0.8, 'brass', 'Eb3', 0.45, 0.3], [1.2, 'brass', 'C3', 1.2, 0.3]],
  win:      [[0, 'brass', 'C5', 0.25, 0.3], [0.25, 'brass', 'E5', 0.25, 0.3], [0.5, 'brass', 'G5', 0.25, 0.3], [0.75, 'brass', 'C6', 1.0, 0.3], [0.75, 'bell', 'C7', 1.0, 0.25]],
  error:    [[0, 'bass', 'F2', 0.16, 0.4], [0.18, 'bass', 'E2', 0.22, 0.4]],
};

// Which festival plays which loop (the first listed festival that is on wins).
export const FESTIVAL_TRACK = ['newyear', 'cny', 'raya', 'deepavali', 'christmas', 'merdeka'];
