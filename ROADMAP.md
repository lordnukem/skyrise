# Skyrise roadmap

Status as of 2026-11-27.

Where the code is:
- `main` is at `7a68370`: Sprints 1 to 6 and the Sprint 7 bot work.
- `claude/peaceful-hamilton-tmdisr` is at `a35de16`: adds the Sprint 7 game changes (trade penalty, Tower goals, cut-off warnings, starter test). It is not on `main` yet.

## Shipped

| Sprint | What it added |
|---|---|
| 1 and 2 | Tenant happiness, quarter report, going up (sky lobbies, express and escalators, rent levels) |
| 3 | People you can see: real walkers and lift queues, stress colours, food courts |
| 4 | Mixed use and underground: hotels, housekeeping, event halls, car parks, transit, basement digging |
| 5 | A living tower: facades and tenant names, demolish with a confirm card, three save slots, the first-run guide, weather and festivals, fires and repair, the VIP review, the Sky Garden, the loan and game over |
| 6 | Toolbar fixes (no clipped labels), sound and music (eight loops, eleven cues, Sound on/off), tenant faces, tuned lift waits and recovery, mood-scaled rent |
| 7 (bot and tuning) | A full-tower bot that reaches five stars in quarter 4 and the Sky Garden in quarter 9 (seed 7); a band planner for the bot's layout; weak and naive player policies; S7-2 targets checked against them |
| 7 (game, on the branch) | Shops and food courts lose trade near poor tenants; Tower goals sheet; cut-off warnings and a Cut off row; a test that the starter guide is affordable |

Every feature in `docs/FEATURE_GAP.md` is in the code. The sound gap (G-35)
was the last one, added in Sprint 6.

## Decisions waiting on you

1. **Tighten or keep the early-game targets (S7-2).** The reference player and
   the weak player both meet every target. The naive layout player fails the
   five-star target and ends in game over in quarter 20. Keep the targets as
   they are, or tighten them?
2. **Should the naive player survive?** Its failure comes from adding lifts
   that feed no tenants. Fixing that means changing how lifts or upkeep work,
   which is a design choice rather than tuning.
3. **Late-game cash has no sink.** The reference tower earns about $100 million
   by quarter 60 with nothing to spend it on. Options: a late building, a
   rising upkeep, or a cost per star.
4. **Upper floors.** The bot's band plan stops offices at floor 45 and serves
   the Sky Garden with an unserved spine lane. Should lifts serve floors 46 and
   up properly?
5. **Put the Sprint 7 game changes on `main`?** They are on the branch only.

## Known gaps

- Nobody has listened to the sound mix, and autoplay on iOS has not been
  tested on a device.
- The balance bot does not build shops or food courts, so their trade rules
  are only covered by a unit test.
- The S7-2 targets are loose for the reference player. The numbers come from
  bots, not people. No playtest has been run.
- The browser checks are run by hand. They are not in CI.
- The timing test in `tests/run.js` can fail when the machine is busy; it
  passed on every rerun.
- The 360 px toolbar truncates 15 of its labels (for example "Escala…").

## Proposed next steps

These are suggestions, not agreed work.

- **Playtest on a phone** for an afternoon, and note what feels too easy, too
  slow or unclear. The bot numbers can't answer those questions.
- **Late-game sink** (decision 3), then rerun the reference bot.
- **Run the browser checks and the node tests in CI**, so a change that breaks
  the toolbar or the sound menu is caught before it reaches `main`.
- **Tidy the toolbar labels** at 360 px, either shorter names or two-line
  labels.
- **Keep the bot honest:** add shops and food courts to the bot, so the trade
  rule shows up in its numbers.
