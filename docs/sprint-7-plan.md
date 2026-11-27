# Sprint 7 plan: Playable to five stars (2026-11-27)

Written against `df7e372` (61/61 node tests). Based on the challenge analysis from the same date. Nothing in the game has been playtested, so this sprint starts by measuring a full tower, then tunes what the measurements show.

Theme: a player who builds sensibly should reach five stars, and should feel the mood and cash pressure while doing it. Each item below answers one finding in the analysis.

## Items

**S7-1 Full-tower bot (`tools/bot.mjs`).** A scripted player that plays a tower from the first tick to five stars, using only the public `place`, `addCar`, `dig`, `cycleRent` and `stepHour` calls. Its build order is a fixed priority list (lobby and lift, offices, cars when a shaft is overloaded, sky lobby at floor 16 when the tower grows past one shaft, security at 2 stars, clinic and plant at 3, transit at 4, Sky Garden at 5). It replaces the fixed towers in `tools/balance.mjs`, which cannot build sky lobbies.
- Reports per quarter: cash, stars, population, mood counts, loans, game over, and the quarter the five-star crown lands.
- Answers the analysis question directly: can the reference policy reach five stars, and how fast?

**S7-2 Early-game tuning from the bot.** Change constants only where the bot shows a problem. Targets for the reference policy, seed 7:
- No loan in the first two quarters.
- Three stars by quarter 8 at the latest.
- Five stars reached in 30 quarters or fewer, with no game over.
- No quarter where more than a quarter of let units are poor for longer than a day.
Each change is recorded in `docs/sprint-7-plan.md` with before and after numbers, as in Sprint 6.

**S7-3 Starter affordability.** A node test that the first-run guide's three goals can be met from `START_CASH` with the build order the guide suggests. If the guide asks for something unaffordable, the test names the step.

**S7-4 Mood beyond the lifts (decision needed).** Shops, food courts and halls earn from population and meal hours only, so the lifts are the sole mood lever. Proposed default: a shop's visitors and a food court's diners drop by 20% when more than half the let units around them are poor, so a neglected tower loses trade as well as tenants. Constants go in `src/constants.js`, and the bot reports the effect. This is a design change and needs your approval before the build.

**S7-5 Endgame goals (decision needed).** After the Sky Garden crowns the tower, nothing else is asked of the player. Proposed default: a "Tower goals" sheet with four milestones (population 500, no poor units for a full quarter, four cars on every shaft, a sky lobby with its own shaft). It is per device, shows progress, and has no effect on balance. The alternative is new mechanics, which would be a larger sprint.

**S7-6 Problem warnings.** The game warns about overloaded lifts and new poor units, but not about cut-off or burning units. Add one-time status lines for "units cut off from the lobby" and "fire on floor N" when they start, in the same pattern as the poor-mood warning. Add a count of cut-off units to the tower sheet.

**S7-7 Pace (decision needed).** A quarter is 168 real seconds at normal speed. The bot reports how many real seconds the reference policy spends before its first decision problem. Options after the data: keep the pace, shorten quarters to 5 days, or keep the length and change the default speed. No change is made without your choice.

## Exit checks

Node (`node tests/run.js`):
1. The bot reaches three stars and five stars on seed 7 without game over, and the report is deterministic.
2. Every starter goal is affordable from `START_CASH` with the guide's order.
3. Shop and food trade falls when most nearby units are poor, and not otherwise (if S7-4 is approved).
4. The cut-off and fire warnings fire once per episode and reset after recovery.
5. Each tuning change in S7-2 has a test that fails on the old value.

Playwright at 360x740 (`tests/e2e/sprint7.mjs`):
1. The tower sheet shows the cut-off count.
2. The milestones sheet opens after the crowning, if S7-5 is approved.
3. No console errors, and no horizontal scroll.

## Not in this sprint

- Sound changes (the Sprint 6 audio stays as it is).
- New buildings or tools, apart from the sky lobby the bot needs.
- Multiplayer, accounts or any server.
- Playtesting with people. The bot is the stand-in until someone plays it.

## Risks

- The bot's policy is a guess at a good player. A policy that is too clever hides problems, and one that is too naive exaggerates them. Its build order should be written down in `tools/bot.mjs` so it can be argued with.
- Tuning to one seed can overfit. Each tuning check runs at least three seeds.
- A 20% trade penalty (S7-4) could feel like a punishment for neighbours of a bad tower. The bot's report will show whether it does.

## Decisions (answered 2026-11-27)

1. **Mood reaches shops and food courts (S7-4): yes, 20% penalty.** Shops lose 20% of visitors and food courts 20% of diners when more than half the nearby let units are poor.
2. **Endgame (S7-5): a Tower goals sheet** with four milestones, per device, no effect on balance.
3. **Pace (S7-7): keep 168 seconds** until the bot's data is in. No change before then.
