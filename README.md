# Skyrise

An original, touch-first tower-building sim for the phone browser. Grow a
tower floor by floor, keep every door reachable from the lobby, and chase
five stars. Plain HTML, CSS and ES modules; no build step, no dependencies,
no backend. All art is drawn on a canvas in code.

Design notes and the vertical-slice scope are in `docs/PLAN.md`.

## Run locally

ES modules need an HTTP origin, so serve the folder rather than opening the
file directly:

```sh
cd skyrise
python3 -m http.server 8123
# then open http://localhost:8123/
```

Any static server works (`php -S localhost:8123`, `ruby -run -e httpd . -p 8123`).

## Run the tests

```sh
node tests/run.js
```

The tests cover the pure simulation only (`src/sim.js`, `src/storage.js`):
connectivity, the "no path, no income" rule, tick arithmetic, the rating
formula, the save round trip and corrupt-save fallback. Exit code is 1 on any
failure. Node 18 or newer.

## How to play

- Pick a tool from the bottom bar and tap a cell. Above ground, every column
  must sit on something built below it.
- Stairs join two floors; vertically adjacent lift cells form a shaft. A
  unit earns only when it is reachable from the lobby (hatched = no path).
- Drag to pan, pinch (or wheel) to zoom, hold a finger on a room to demolish
  it for a half refund. Inspect tool shows a room's status.
- The game autosaves to localStorage; the menu (≡) has save, pause, theme
  and new tower.

Tuning numbers all live in `src/constants.js`.

## Publish to GitHub Pages from `main`

1. Push the repository to GitHub with this folder as the repo root.
2. Repository **Settings → Pages → Build and deployment**: Source
   "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
3. The site appears at `https://<user>.github.io/<repo>/` within a minute or
   two. All paths in `index.html` are relative, so a project sub-path works.

No workflow file is needed; there is nothing to build.
