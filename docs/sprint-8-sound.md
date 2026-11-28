# Sprint 8: sound (2026-11-28)

Goal: replace the synthesised sine-wave sound with free, real recordings, and make the sound
follow the tower. Licence rule: CC0 only (no credit needed; credited anyway).

## What changed

- **Sources.** Kenney's CC0 packs (Interface Sounds, UI SFX, Casino, Music Jingles, RPG) and
  CC0 music and ambience from OpenGameArt, all downloaded from OpenGameArt. kenney.nl refuses
  scripted downloads, so the Kenney packs come from Kenney's own OpenGameArt uploads.
  `tools/sound/sources.json` records page, author, licence and checksum.
- **Build.** `tools/sound/build.mjs`: one line per cue; levels every file to a common loudness,
  trims one-shots, crossfades ambience into seamless loops, writes MP3s, `manifest.json` and
  `LICENSE.md` (credits). Cues and ambience: 0.7 MB, loaded after the first tap. Music: 6.8 MB
  across 5 tracks, streamed one track at a time.
- **Engine.** `src/audio.js` on Web Audio: music, ambience and effects buses into a
  compressor; playlists (two day tracks, two night tracks, Christmas) with crossfades;
  ambience mixed by hour, weather and population; music muffled under sheets; cues panned from
  their place on screen, slightly re-pitched on repeat, noisy ones rate-limited; silent while
  the page is hidden.
- **New cues.** Tenant moves in (door), rent (coins), lift arriving (ding), a new star, the
  quarter's cash, a poor VIP review, tool select. Built but not wired yet: thunder, and
  open and close sounds for sheets.
- **Kept.** The synthesised festival loops for CNY, Raya, Deepavali, Merdeka and New Year.

## Picks (by measurement, not by ear)

Nobody has listened to these picks yet. They were chosen by licence, length, loudness and the
composers' descriptions; the jingles by length, key (major or minor) and pitch direction.
The sound test page on the test site plays every pick and the alternatives, so they can be
chosen by ear and changed with a one-line edit in `PICKS`.

| Use | Pick | Why |
|---|---|---|
| Day | congusbongus, "Which Brand of Mustard Shall I Buy" and "Two Left Socks" | described as bossa-nova elevator music |
| Night | qubodup, "Chill lofi inspired" (loop edit); cynicmusic, "Vaporware" | calm; a seamless loop; relaxing pads and piano |
| Christmas | Tarush Singhal, "Cheerful Christmas Time" | loops well |
| Jingles | Kenney sax set | sits with the bossa nova; major and rising for good news, minor and falling for bad |

## Checks

- `node tests/run.js`: 71 tests, including every played cue in the manifest, every file
  listed with an allowed licence, the 1 MB budget, the ambience mix and the panning.
- `tests/e2e/sprint8.mjs`: 15 checks in Chromium at 360x740: nothing loads before a tap; every
  cue and loop decodes; the playlist follows the clock; ambience settles on the mix; sheets
  duck the music; move-ins, coins and dings play panned; under 3 cues a second; the toggle.

## Next

- Choose by ear on the sound test page; swap picks in `PICKS`.
- Festival tunes from real recordings (CNY, Raya, Deepavali, Merdeka), if CC0 ones can be found.
- Thunder during storms, construction noise while building, crowd murmur on busy floors.
