# Sprint 11: rooms and the last generated art (2026-11-28)

Goal: show life inside the rooms, and remove every AI-generated picture, so all the game's art
is either drawn in code or comes from a CC0 pack. Before and after:
`docs/screenshots/s11-before-after.png`; the new logo: `docs/screenshots/s11-logo.png`.

## Interiors (`src/render.js`, `drawInterior`)

From zoom 0.9 up, windows show what is inside:
- **Offices**: a desk with a glowing blue monitor in every window, a worker at about two desks in
  three, a pot plant at some of the rest.
- **Flats**: a sofa, sometimes a picture on the wall, and a lamp that glows at night.
- **Shops**: three shelves of goods in the business's colours.
- **Food courts**: diners at the tables (the Sprint 10 figures).

By day the interiors are faint behind a diagonal glass reflection; at night they stand out against
the warm light. Vacant units stay empty. Drawing a 98-structure tower costs about 1 ms of CPU a
frame at the default zoom and 1.3 ms at 1.6x; it holds 60 fps in headless Chromium.

## No generated pictures left

`assets/art/` (five Gemini pictures) is deleted:
- **Skyline**: three code-drawn layers at their own parallax. The far layer adds tall towers with
  spires, masts, setbacks and red aircraft lights at night. It is plainer than the painted
  picture it replaces.
- **Sky Garden**: code-drawn at 2x (sharp when zoomed in): stepped glass terraces with reflections,
  trees, hedges and flowers on every step, a waterfall into a pool, and a timber pavilion with
  warm lanterns.
- **Christmas sled**: the code-drawn sled that was already the fallback.
- **Logo**: text in Kenney Future, the I in amber, beside the app icon.
- **App icon**: drawn as SVG in `tools/art/build.py` (a stepped tower with lit windows, a sun and a
  cloud) and rendered to 512 and 180 px PNGs by `tools/art/icon.mjs`.

## Found on the way

The old skyline loop used `hash01` (which returns -1..1) for building widths, so some widths were
negative. The new layers fold the hash into 0..1.

## Checks

- `node tests/run.js`: 79 tests, adding: `assets/art` is gone and every file under `assets/` is
  listed in a manifest as CC0 or our own; every local file `index.html` points at exists.
- All browser suites pass (Sprint 6, 7, 7b, 8, mood, 10).

## Next

- A richer far skyline, if it reads too plain on the phone.
- Hotel rooms, event halls and services could get interiors the same way.
- The festival tunes for CNY, Raya, Deepavali, Merdeka and New Year are still the synthesised ones.
