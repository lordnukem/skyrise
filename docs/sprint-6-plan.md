# Sprint 6 plan: Proof and polish (G-44, visual pass, verification)

Written 2026-11-26 against `c086eb2` (57/57 node tests). Scope is set by Fadzly: the Sprint 6 proposal, plus visual enhancements including button text, and the "unlocks at" text moved off the button.

Sound (G-35) is not in this sprint. The gap doc deferred it until an audio decision is made, and none has been made.

## Items

**G-44 Locked tools without the "unlocks at" text.** Locked toolbar buttons no longer print "unlocks at N stars" on the button. The button keeps its price. A small "★N" pill in the top-left corner shows the star need, and the padlock stays top-right. The full sentence moves to the button's accessible label, and tapping the locked tool still says "X: unlocks at N stars." in the status line.

**Visual pass (buttons and text).**
- Toolbar labels and prices no longer spill. A long name ends in an ellipsis instead of being clipped mid-letter (for example "Housekeeping" at 360 px).
- Prices use tabular numerals so they line up across buttons.
- Keyboard focus shows a visible ring on toolbar buttons.
- Star-need pill: 10 px bold, `--warn` on `--panel-2`, 1 px border.

**Verification (carried from Sprints 1 to 5).** Commit a Playwright suite under `tests/e2e/` that checks the exit items at 360x740: no horizontal scroll, draft-then-confirm placement, the tower sheet, the first-run guide, export and import, no console errors, and the new locked-pill and label-fit checks. Run with `--trace off`.

**Balance harness.** `tests/balance.js` plays seeded towers for 10 game years and reports stars, cash, loan and game-over timing, plus whether 5 stars and the Sky Garden are reachable. It reports only and changes no tuning.

## Exit checks

Node (`node tests/run.js`): all existing tests still pass. Save format is unchanged, so no new save version.

Playwright 360x740 (`tests/e2e/`):
1. Locked buttons show no "unlocks" text, and show a "★N" pill matching `UNLOCK_AT`.
2. Each toolbar label's `scrollWidth` is at most its box width, or it ends in an ellipsis.
3. `document.documentElement.scrollWidth` stays at or below 360.
4. No console errors.

## Status

The visual and locked-tool checks were run at 360x740 and pass (7/7 at that point; the sound checks below brought it to 9/9). The balance harness is not written yet.

## Sound and music (G-35, added 2026-11-27)

Requested by Fadzly: audio is in this sprint. It is rendered with `tools/audio/`
(ffmpeg) rather than agy, because agy is an image generator and is not installed
here.

- **Score:** `tools/audio/score.mjs` holds 8 music loops (day, night, New Year,
  Chinese New Year, Hari Raya, Deepavali, Christmas, Merdeka) and 12 sound effects.
- **Render:** `SKYRISE_AUDIO_TMP=<scratch> node tools/audio/render.mjs` writes
  `assets/audio/*.mp3` (80 kbps mono, about 1.8 MB in total). Noise is seeded, so
  the output is repeatable.
- **Player:** `src/audio.js`. The first tap unlocks audio. Music follows the
  festival first, then night (19:00 to 06:00) or day. The choice is per device
  (`skyrise.sound` in localStorage), and the menu has a Sound on/off button.
- **Wired to:** build, lift and car placement, demolish, repair, tap and refused
  placement, fire alarm, VIP review, quarter report, loan, game over and the win.
- **Checks:** 60/60 node tests, including the track choice, bar totals and that
  every cue the game plays has its file. 9/9 Playwright checks, including the
  toggle and no failed audio requests.
- **Not checked:** how the mix sounds. The renders have not been listened to.
