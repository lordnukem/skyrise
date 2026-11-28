# Skyrise

An original, touch-first tower-building sim for the phone browser. Grow a
tower floor by floor, keep every door reachable from the lobby, and chase
five stars. Plain HTML, CSS and ES modules; no build step, no dependencies,
no backend. The tower is drawn on a canvas in code. The interface art and the
sound come from free CC0 packs (Kenney, OpenGameArt), built by scripts; the credits
are in [assets/ui/LICENSE.md](assets/ui/LICENSE.md) and
[assets/audio/LICENSE.md](assets/audio/LICENSE.md).

Where the project is going: [ROADMAP.md](ROADMAP.md). Design notes:
[docs/PLAN.md](docs/PLAN.md). Feature gap analysis and sprint plans:
[docs/FEATURE_GAP.md](docs/FEATURE_GAP.md) and `docs/sprint-*-plan.md`.

## Run locally

ES modules need an HTTP origin, so serve the folder rather than opening the
file directly:

```sh
cd skyrise
python3 -m http.server 8123
# then open http://localhost:8123/
```

Any static server works (`php -S localhost:8123`, `ruby -run -e httpd . -p 8123`).

## Run the checks

Node 18 or newer. No install needed.

```sh
node tests/run.js                 # 77 node tests: the simulation, saves, mood, trade, goals, sound, art, life
```

Browser checks at a 360x740 phone size. They need Playwright and a Chromium;
the scripts use the Chromium at `/opt/pw-browsers/chromium`, so change
`executablePath` in each script if yours is elsewhere. Start a server first:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 &
node tests/e2e/sprint6.js         # toolbar, locked tools, sound toggle (9 checks)
node tests/e2e/mood.mjs           # tenant mood in the tower sheet (3 checks)
node tests/e2e/sprint7.mjs        # cut-off warning, Tower goals sheet (6 checks)
node tests/e2e/sprint7b-playtest.js # lift-on-lobby and no-path traps, toolbar labels (12 checks)
node tests/e2e/sprint8.mjs        # the sound engine: unlock, decode, playlists, ambience, duck, tower cues (15 checks)
node tests/e2e/sprint10.mjs       # life: sun, clouds, street, lightning and thunder, reduced motion (16 checks)
```

Each prints `ok` or `FAIL` per check and exits 1 on any failure. The
`SKYRISE_URL` variable points them at another server.

## Tools

These are measurement scripts. They report numbers and never change tuning.

```sh
node tools/balance.mjs                       # fixed reference towers, 60 game days each
node tools/bot.mjs                           # one full tower to the Sky Garden (reference policy)
node tools/bot.mjs --seed 3 --quarters 60 --verbose
node tools/bot.mjs --policy weak             # a player who makes mistakes on purpose
node tools/bot.mjs --layout naive            # a player with no planned layout
bash tools/sound/fetch.sh && node tools/sound/build.mjs   # rebuild assets/audio from the free packs (needs ffmpeg)
bash tools/art/fetch.sh && python3 tools/art/build.py     # rebuild assets/ui from the free packs (needs Pillow, fonttools)
SKYRISE_AUDIO_TMP=<scratch dir> node tools/audio/render.mjs   # the synthesised festival loops (needs ffmpeg)
```

`tools/bot.mjs` is the full-tower bot; its header lists every option.

**Sound.** `tools/sound/sources.json` lists every pack the sound comes from: its page, author,
licence and checksum. `fetch.sh` downloads them (OpenGameArt) into `tools/sound/cache/`, which
is not committed, and `build.mjs` picks each sound (one line per cue in `PICKS`), levels it,
makes seamless loops for the ambience, and writes `assets/audio/` with `manifest.json` and the
credits. The unit tests fail if a file is unlisted, has a licence other than CC0 or our own,
or the cues and ambience grow past 1 MB.

## How to play

- Pick a tool from the bottom bar and tap a cell. Above ground, every column
  must sit on something built below it. Locked tools show the star they need.
- Stairs join two floors; vertically adjacent lift cells form a shaft. A
  unit earns only when it is reachable from the lobby. Hatched means no path;
  a unit with no path empties, and the status line says so once.
- Each let unit shows a tenant's face: a smile when happy, a flat mouth when
  fair, and a frown with a sweat drop when poor. Poor tenants pay less rent,
  and a whole day below the leave line empties the unit. Lift waits drive
  mood, so add cars or lifts when the status line warns about them.
- Shops and food courts earn less when most of the people within five
  floors are poor.
- Drag to pan, pinch (or wheel) to zoom, hold a finger on a room to demolish
  it for a half refund. Inspect shows a room's status.
- The menu (≡) has save, pause, theme, sound on/off, the Tower sheet, Tower
  goals, the save slots and new tower. Tower goals are four milestones, and
  the clean-quarter goal is remembered on this device.
- Sound: 13 day tracks (bossa nova, lo-fi, city themes), 5 calm night tracks, festival tunes in season. Traffic, birds,
  crickets and rain follow the hour and the weather, and a bigger tower is a busier
  street. Tenants moving in, rent coming in and lift dings play from their place in the
  tower, left or right. Music is muffled while a sheet is open. The first tap starts the
  audio, because browsers block sound before that.
- The game autosaves to localStorage (three slots); the first-run guide walks
  through three goals.

Tuning numbers all live in `src/constants.js`.

## Publish to GitHub Pages from `main`

1. Push the repository to GitHub with this folder as the repo root.
2. Repository **Settings → Pages → Build and deployment**: Source
   "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
3. The site appears at `https://<user>.github.io/<repo>/` within a minute or
   two. All paths in `index.html` are relative, so a project sub-path works.

No workflow file is needed; there is nothing to build.
