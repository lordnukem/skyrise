# Sprint 9: interface (2026-11-28)

Goal: make the interface look like a finished game, using free CC0 art, and retire the
AI-generated toolbar icons. Before and after: `docs/screenshots/s9-before-after.png`.

## What changed

- **Sources.** Kenney's CC0 packs from OpenGameArt: UI Pack (2024), Game Icons and its
  expansion, Board Game Icons, Generic Items, and the Kenney Future Narrow font.
  `tools/art/sources.json` records page, author, licence and checksum; `tools/art/fetch.sh`
  downloads them into `tools/art/cache/` (not committed).
- **Build.** `tools/art/build.py` writes `assets/ui/` (109 KB): toolbar icons, one-colour glyphs,
  stars, the font as WOFF, `manifest.json` and `LICENSE.md` (credits). One line per pick.
- **Toolbar icons.** 14 from Kenney's Generic Items (briefcase for offices, handbag for shops,
  keys for flats, desk bell for hotel rooms, door hanger for housekeeping, and so on). The 10
  structural tools Kenney has no item for (lobby, floor, stairs, the four lifts, escalator,
  Sky Garden, inspect) are drawn as SVG in the same flat two-tone style. Locked tools are greyed.
  The 23 Gemini-generated icons in `assets/art/` are gone.
- **Buttons and panels.** Kenney's depth style in CSS: no borders, a darker bottom edge that
  the button sinks into when pressed; the selected tool and primary buttons in the accent blue.
  Panels (menu, cards, sheets, guide) get the same soft edge. Works in both themes.
- **Type.** Kenney Future Narrow for the cash and population figures, sheet titles, speed
  buttons and the big sheet buttons. It is all capitals and wide, so tool labels, menu items and
  body text stay in the system font.
- **HUD.** Kenney stars for the rating, a coin glyph before the cash, a person glyph before the
  population (now just the number), a crown glyph for the Sky Garden.
- **Menu.** A Kenney glyph before each item.
- **Motion.** Sheets rise from the bottom; buttons press down. Reduced motion still turns
  every animation off.

## Checks

- `node tests/run.js`: 74 tests, including every toolbar tool has an icon, every file in
  `assets/ui` listed with an allowed licence, a 200 KB budget, and every `url()` in
  `styles.css` pointing at a file that exists.
- All browser suites pass at 360x740, including the Sprint 7 check that every toolbar label and
  price fits at 320, 360 and 390 px (it caught clipped two-line labels with 28 px icons; the
  icons are 24 px).

## Still AI-generated

`assets/art/`: the app icon, the logo, the Sky Garden rooftop, the skyline and the Christmas
sled. The tower itself is drawn in code. Replacing these is part of the next visual sprints.

## Next

- Sprint 10, life: side-view people with walk cycles, traffic, birds, weather and fire effects.
- Sprint 11, rooms: every room front redrawn in one style, lights at night, business variety.
