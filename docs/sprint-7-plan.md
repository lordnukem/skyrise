# Sprint 7 plan: Playable to five stars (2026-11-27)

Written against `df7e372` (61/61 node tests). Based on the challenge analysis from the same date. Nothing in the game has been playtested, so this sprint starts by measuring a full tower, then tunes what the measurements show.

Theme: a player who builds sensibly should reach five stars, and should feel the mood and cash pressure while doing it. Each item below answers one finding in the analysis.

## Items

**S7-1 Full-tower bot (`tools/bot.mjs`).** A scripted player that plays a tower from the first tick to five stars, using only the public `place`, `addCar`, `dig`, `cycleRent` and `stepHour` calls. Its build order is a fixed priority list (lobby and lift, offices, cars when a shaft is overloaded, sky lobby at floor 16 when the tower grows past one shaft, security at 2 stars, clinic and plant at 3, transit at 4, Sky Garden at 5). It replaces the fixed towers in `tools/balance.mjs`, which cannot build sky lobbies.
- Reports per quarter: cash, stars, population, mood counts, loans, game over, and the quarter the five-star crown lands.
- Answers the analysis question directly: can the reference policy reach five stars, and how fast?

**S7-1 status (2026-11-27): built, partly done.** `tools/bot.mjs` plays one tower with the public sim calls. Its policy: a lift from the lobby; the missing star needs in order; cars on the busiest shaft when the average peak wait is above 1.0, and new lanes when the cars are full; offices on floors 2 and up; slabs and lanes for growth; sky lobbies at floor 16 when stuck; the Sky Garden at five stars. Lifts sit in lanes on every fourth column, with offices between them. Results, seeds 7, 3, 11 and 42, 40 quarters each:
- Two stars in quarter 1 (about 68 real seconds), three stars in quarter 2, four stars in quarters 2 to 4, five stars in quarter 6 (about 940 real seconds).
- No loans, no game over, no poor or cut-off units in any run.
- Population stops at 640 in quarter 12. The tower cannot climb past floor 16, so the Sky Garden (floor 60 or higher) is never reached. The sky lobby step places nothing, because the floor-16 spots next to reachable space are all taken.

**Floor-16 attempt (2026-11-27, not committed).** Four layout rules were tried: aligned-only lanes and offices, slabs at band tops, offices kept off band-top floors, and lane extensions on any column. Each one exposed the next blocker. The best variant reached 5 stars and then stalled at 468 people with 34 shafts and 36 cars, which is worse than the committed policy. The experiment is kept in `git stash` ("band-top layout experiment"). The cause is that lanes, offices and band tops all compete for the same columns, and a greedy search cannot plan the bands. The fix is a band planner: decide the band columns and the transfer floor up front, then build to that plan. That is a larger change, so it is left for a follow-up.

**What the bot changes in the plan.** The bot never reaches a decision problem. For this policy the game is easy: five stars in about 16 real minutes with no loans and no poor units. That matters for S7-2 and S7-7: the early game may be too forgiving, not too hard, and the pace question depends on whether a human plays less efficiently than the bot. The three decisions already approved still stand, but the tuning targets in S7-2 need to be checked against this result before any constant changes.

**S7-2 check against the bot (2026-11-27).** Every target below is met by the committed bot with room to spare, so no constant was changed:
- No loan in quarters 1 and 2: met (no loans in any seed).
- Three stars by quarter 8: met (quarter 2 in all seeds).
- Five stars within 30 quarters with no game over: met (quarter 6 in all seeds).
- No poor-unit spell longer than a day: met, because the bot never has a poor unit.

The targets are too loose to tell tuning apart. A policy this good passes them all, so the check cannot show whether a better or worse player would be in trouble. Before tuning further, the targets need a harder player: either a weaker build order, or a human-like policy with mistakes, and the bot should be run on both.

**Band planner (2026-11-27).** `tools/bot.mjs` now builds to an explicit band plan instead of a greedy search, so the tower climbs past floor 16. The layout was checked rule by rule with `canPlace` and `reachable` before it went into the bot:
- Band 1 (floors 1-16): lanes on columns 0, 4, ..., 36 (16 and 20 start on floor 2, above the lobby), offices at columns 1, 5, ..., 33 on floors 2-15.
- Floor 16 is a transfer floor with no offices. A band-2 lane starts in the left column of each band-1 office slot (1, 5, ..., 33): the office on floor 15 holds it up, and it joins the network beside the band-1 lane top. Slabs fill columns 4k+2 and 4k+3 to hold up the band-2 offices, and a sky lobby sits at column 2.
- Band 2 (floors 16-31): lanes at 4k+1, offices at 4k+2 on floors 17-30. Floor 31 repeats the pattern one column right. Band 3 (floors 31-46): lanes at 4k+2, offices at 4k+3 on floors 32-45.
- Express lifts in columns 37-39 run from floor 1 to floor 31 and stop at the lobbies on 1, 16 and 31. In `liftService` a shaft that starts above the ground can only be fed by a shaft that spans floor 1, and no plain lift from the ground reaches floor 31. So the express is the only feeder for band 3; without it band-3 tenants would climb 30 floors on foot. The sky lobbies are therefore needed by the plan, not optional.
- For the same reason no unit above floor 46 can be served from the ground, so offices stop at floor 45. The Sky Garden is reached by a spine: a lane at column 35 from floor 46 to 61 beside the band-3 lane top, a row of slabs hung from it on floor 59 (columns 23-34), and the garden on them at floors 60-65.
- Service slots are fixed (security on floors 3, 23 and 38, the hotel room and housekeeping together on floor 6, the clinic and plant room on floor 9), so offices cannot take them first. The hotel room is let at low rent: it sits beside a lane (noise), and without the +10 it fell to 67 at the VIP call once band 2 loaded the band-1 lanes. That cost the fourth star in an earlier run.
- Other policy changes: lift relief now follows the sim's own load arithmetic (a car on the worse leg of the worst-served unit's route, or a new planned shaft when that leg has four cars); growth places up to six things per decision once cash is above $60,000; burnt units are repaired.

Results, reference policy, `node tools/bot.mjs --quarters 60 --verbose --seed N`:

| Seed | 2/3/4/5 stars (quarter) | Stars after Q4 | Sky Garden crowned | Final population | Shafts | Cars | Top unit floor |
|---|---|---|---|---|---|---|---|
| 7  | 1/2/3/4 | 5 through Q60 | quarter 9 | 1484 | 33 | 47 | 45 |
| 3  | 1/2/3/4 | 5 through Q60 | quarter 9 | 1484 | 33 | 45 | 45 |
| 11 | 1/2/3/4 | 5 through Q60 | quarter 9 | 1484 | 33 | 47 | 45 |
| 42 | 1/2/3/4 | 5 through Q60 | quarter 9 | 1484 | 33 | 48 | 45 |

Before the plan: 5 stars in quarter 6, population stuck at 640, 8 shafts, 14 cars, no Sky Garden. The tower is full by quarter 9 and does not grow after that. The average peak wait at the end is 1.49, because band-2 and band-3 tenants ride two legs. All let units are Good at each quarter's end, and poor units appear in at most 3 quarters per run, for at most 3 hours.

**Weak policy (2026-11-27).** `--policy weak` plays the same plan with four fixed mistakes, all deterministic (they depend on the clock and build counts, not on random draws): (1) a lift must stay overloaded for 24 game hours before it reacts; (2) it buys a car only once the average peak wait passes 1.5 (the reference: 1.0); (3) every third office it builds goes to high rent; (4) in every third quarter it ignores the star needs. Both policies, 40 quarters (`--quarters 40`, plus `--policy weak`):

| Seed | Policy | Stars by quarter | Loans | Game over | Quarters with a poor unit | Longest poor spell (any / over 25% of units) | First decision problem | Lowest cash |
|---|---|---|---|---|---|---|---|---|
| 7  | reference | 2, 3, 4, then 5 from Q4 | 0 | no | 2 | 2 h / 0 h | Q6, 921 s | $1,206 |
| 7  | weak      | 2, 3, 4, then 5 from Q4 | 0 | no | 35 | 15 h / 3 h | Q6, 882 s | $1,561 |
| 3  | reference | 2, 3, 4, then 5 from Q4 | 0 | no | 2 | 1 h / 0 h | Q24, 3883 s | $1,630 |
| 3  | weak      | 2, 3, 4, then 5 from Q4 | 0 | no | 35 | 16 h / 2 h | Q6, 877 s | $1,597 |
| 11 | reference | 2, 3, 4, then 5 from Q4 | 0 | no | 1 | 1 h / 0 h | Q6, 921 s | $1,510 |
| 11 | weak      | 2, 3, 4, then 5 from Q4 | 0 | no | 35 | 16 h / 2 h | Q6, 882 s | $1,914 |
| 42 | reference | 2, 3, 4, then 5 from Q4 | 0 | no | 2 | 3 h / 0 h | Q6, 930 s | $1,306 |
| 42 | weak      | 2, 3, 4, then 5 from Q4 | 0 | no | 35 | 15 h / 2 h | Q6, 882 s | $1,714 |

The weak policy's poor hours come mostly from the high-rent offices dipping below 40 at rush hours (about 44 hours a quarter from quarter 9). Mistake 4 had no effect in these runs: every star need it could skip was already met before quarter 3, and none was open in quarter 6 or later. Mistakes 1 and 2 leave 0 to 3 fewer cars by quarter 40 (45-46 against 45-48) and raise the quarter-2 average peak wait from 0.96 to 1.28 on every seed. High rent also means the weak policy ends with more cash than the reference.

**S7-2 targets against the weak policy.** All four are still met on every seed: no loan in quarters 1-2 (no loan at all), 3 stars by quarter 8 (quarter 2), 5 stars within 30 quarters with no game over (quarter 4), and no spell where more than a quarter of let units are poor for longer than a day (3 hours at most). The stricter reading, "no poor unit for longer than a day", is also met (16 hours at most). These mistakes do not make the game hard. The early game forgives a slow lift response, high rents and skipped needs, and cash has no use late on (about $2M net a quarter once the tower is full, about $100M by quarter 60). This says the targets are loose, not that a human would find the game easy: both bots follow the same efficient layout, and the weak one still builds as fast as cash allows. A fairer test needs a player who also lays out badly (lifts off the lanes, offices that block the next band) or builds less often. Whether to tighten the S7-2 targets or change constants is a decision for you.

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

## The naive layout test (2026-11-27)

Asked for after the band-plan result: a weaker player that ignores the planned bands. `node tools/bot.mjs --layout naive` places every structure at the first greedy spot that touches the network. It keeps the star needs, the overload rule and the ground lift, and has no bands, lanes, transfer floors, sky lobbies or garden spine.

Results, 40 quarters, all four seeds (7, 3, 11, 42), which agree:
- Two stars in quarter 1, three stars in quarter 2, then no more growth. Population stops at about 104 from quarter 3.
- Every overload adds a lift that feeds no new tenants, so by quarter 16 there are 30 shafts and 33 cars. Upkeep passes income from about quarter 11.
- First loan in quarter 18, game over in quarter 20 (lowest cash about -$165,000).

Against the S7-2 targets: no loan in quarters 1-2 is met; three stars by quarter 8 is met; five stars within 30 quarters with no game over is NOT met; no poor spell longer than a day is met (23 hours, borderline). This is the first result where the targets discriminate between players.

What it shows: the planned layout matters a great deal, and the game punishes a player who keeps adding lifts that do not add capacity. The naive player's failure is a policy failure, not a tuning one; no constant was changed.
