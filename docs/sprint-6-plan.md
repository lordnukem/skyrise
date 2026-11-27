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

## Tenant mood: tuning and indication (2026-11-27)

Lift waits drive tenant mood. Mood drives move-ins and move-outs. Before this change, mood did not touch income. Shops, food courts and halls do not ride the lifts, so their trade does not depend on mood.

**Measured with `node tools/balance.mjs`** (60 game days, seed 7, one shaft, offices beside it, security office by the lobby). Before was the Sprint 5 tuning; after is the current tuning.

Before (`WAIT_PENALTY 60`, `HAPPY_RISE 0.04`, `LEAVE_TICKS 6`, no mood on rent):

```
scenario                      units  occ%  happy  good fair poor  left/qtr  $/h
starter: 1 car, 5 floors         10    80     41     0    8    0      52.4  266
16 floors: 1 car                 30    60     30     0    0   18     194.0  638
16 floors: 2 cars                30    73     35     0    0   22     181.9  731
16 floors: 3 cars                30    87     42     0   26    0     153.5  822
16 floors: 4 cars (max)          30   100     45     0   30    0       0.0 1009
```

After (`WAIT_PENALTY 40`, `HAPPY_RISE 0.10`, `LEAVE_TICKS 24`, `MOOD_TAKE` on rent):

```
scenario                      units  occ%  happy  good fair poor  left/qtr  $/h
starter: 1 car, 5 floors         10   100     65     0   10    0       0.0  349
8 offices: 2 cars, 5 floors      10   100     83   10    0    0       0.0  369
16 floors: 1 car                 30   100     33     0    0   30       0.0  886
16 floors: 2 cars                30   100     48     0   30    0       0.0  933
16 floors: 3 cars                30   100     65     0   30    0       0.0 1066
16 floors: 4 cars (max)          30   100     74   30    0    0       0.0 1077
```

What changed and why:
- **Recovery was too slow.** A full lift at peak took days to let tenants recover, so one rush hour cycled the whole tower through move-outs. `HAPPY_RISE` 0.04 → 0.10 (about a day to recover).
- **A rush hour evicted everyone.** Six hours below 30 was one bad morning. `LEAVE_TICKS` 6 → 24, so only a whole day of misery moves tenants out.
- **Waits cost too much.** `WAIT_PENALTY` 60 → 40, so one car for 28 offices settles at poor (33) rather than collapsing.
- **Mood did not touch money.** `MOOD_TAKE` scales rent by happiness band: good 1.1, fair 1.0, poor 0.75. Now a poor tower earns less, and more lifts pay for themselves.

The gradient now matches lift count: 1 car poor, 2 cars fair, 4 cars good.

**Known limits.** The harness does not build a sky lobby, so towers taller than one shaft (`LIFT_MAX_SPAN` 15) are not measured. Each run is one seed. The harness does not model shops, food courts or halls, which do not ride the lifts.

**Indication.**
- Each let unit shows a tenant's face in its top-right corner: a smile that bobs when good, a flat mouth when fair, a frown with a falling sweat drop when poor. Reduced motion holds still.
- Queued riders shiver and shed a sweat drop when stressed, and sway a little when tense.
- The tower sheet has a Mood row (good, fair, poor counts).
- The status line says once when units first turn poor, and again only after they recover.
- The first-run guide now says "happy face" instead of "green dot".

**Checks.** Node 61/61 (new: mood counts; the overloaded-shaft test rewritten to the new numbers). `tests/e2e/mood.mjs` 3/3 at 360x740, which also writes a screenshot. The queue shiver is too subtle to judge at phone size; it is unverified by eye.
