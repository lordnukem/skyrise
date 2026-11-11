# Sprint 1 plan: Tenants who care (G-01 to G-05)

Spec: `docs/FEATURE_GAP.md` Section C, Sprint 1. Rule: every tuning number
lives in `src/constants.js` (`docs/PLAN.md:109-120`). Sim stays DOM-free.

## Design

**G-01 Clock.** `tick` is still one hour. New pure helpers in `sim.js`:
`hourOf(tick)`, `dayOf(tick)`, `isWeekend(tick)` (day % 7 in `WEEKEND_DAYS`),
`quarterOf(tick)` (`DAYS_PER_QUARTER` days). `DEMAND[type]` holds a weekday
and a weekend 24-entry curve (share of a unit's people riding the lift in that
hour) plus `peak`, the hour the card names. Offices peak 08/12/17, flats 07/19,
weekends are flat and low. Shops have no people, so no curve.

**G-02 Shaft load.** `shaftsOf(s, grid)` groups contiguous lift cells per column
into `{col, lo, hi}` (same rule the renderer already uses). `liftService(s,
reach, hour, weekend)` returns `{ [unitId]: { wait, walk } }`:
- a unit on floor 1 needs no lift: wait 0, walk 0;
- a unit whose floor is spanned by k shafts adds `people x curve / k` to each;
  `wait` = the lowest `load / SHAFT_RUSH_CAPACITY` among them, `walk` = `lo - 1`
  of that shaft (a shaft that starts above ground is reached by stairs);
- a floor no shaft spans is stairs only: wait 0, walk = `floor - 1`.
Vacant units add no demand but still get a `wait` (what a tenant would face).
Results go on `s.service` (a plain object, derived, never saved) with a third
field `peak`: the load at the type's `DEMAND.peak` hour on a weekday, so the
card can say "Lift busy at 08:00" at 03:00 too.

**G-03 Happiness.** Each unit carries `happy` (0-100, starts `HAPPY_NEUTRAL`)
and `unhappy` (ticks spent below `LEAVE_AT`). Each tick, every reachable unit
eases toward `target = clamp(100 - WAIT_PENALTY x wait - WALK_PENALTY_PER_FLOOR
x walk)`. Easing is asymmetric: `HAPPY_FALL` when the target is below, `HAPPY_RISE`
when above, so one bad rush hour sours a tenant for most of a day; that is what
makes a single overloaded shaft lose offices while two shafts keep them. An
occupied unit below `LEAVE_AT` for `LEAVE_TICKS` ticks is vacated (`unhappy`
resets, `happy` is kept as the unit's reputation). Fill chance becomes
`FILL_CHANCE x happy / HAPPY_NEUTRAL`. `happyBand(h)` maps to good/fair/poor via
`HAPPY_GOOD` and `HAPPY_POOR`. `stepTick` returns `left` (units vacated this
tick). The renderer draws a 2 px-radius dot (good/warn/danger token) in the top
right corner of each occupied reachable unit; `warn` joins `PALETTE_KEYS`.

**G-04 Inspect card.** A DOM card (`#card` inside `.stage`) replaces the toast
for units: title, Happiness (band + number), Why, Rent, People. Why is: walking
floors if `walk > 0`, else "Lift busy at HH:00" if `peak >= WAIT_BUSY`, else
"Lift keeps up". Non-units keep the toast. The card re-renders each tick while
open, hides on tool change, on a tap elsewhere and on its close button.

**G-05 Quarter report.** `s.quarter` accumulates `{ income: {office, shop,
flat}, upkeep, left, starsAt }` across the quarter. When `tick` crosses a
multiple of `DAYS_PER_QUARTER x HOURS_PER_DAY`, `stepTick` sets `s.lastReport =
{ quarter, income, upkeep, net, starsBefore, starsAfter, left }`, resets the
accumulator and returns `report`. `main.js` passes it to `ui.showReport`, a
bottom sheet (`#report`) with a Continue button and Escape to close. The HUD
clock gains the weekday name.

## Constants added (src/constants.js)

`DAYS_PER_WEEK 7`, `WEEKEND_DAYS [5, 6]`, `DAY_NAMES`, `DAYS_PER_QUARTER 7`,
`DEMAND` (office and flat curves + peak), `SHAFT_RUSH_CAPACITY 24` (people a
shaft moves per hour before waits bite; distinct from `ELEVATOR_CAPACITY`, the
daily-average number the star rating uses), `WAIT_PENALTY 60`,
`WALK_PENALTY_PER_FLOOR 6`, `WAIT_BUSY 1`, `HAPPY_NEUTRAL 55`, `HAPPY_GOOD 70`,
`HAPPY_POOR 40`, `HAPPY_FALL 0.5`, `HAPPY_RISE 0.04`, `LEAVE_AT 30`,
`LEAVE_TICKS 6`. `SAVE_VERSION` becomes 2.

Sanity of the numbers: 10 offices (40 people) on one shaft at 08:00 give
load 40/24 = 1.67, target 0; on two shafts 0.83, target 50 (fair). Off-peak
loads are tiny, so the slow rise is what keeps a one-shaft tower unhappy.

## Save version

Shape changes (per-unit `happy`/`unhappy`, `quarter`, `lastReport`), so
`SAVE_VERSION = 2`. `deserialize` accepts versions 1 and 2: missing `happy`
becomes `HAPPY_NEUTRAL`, missing `quarter` becomes a fresh accumulator at the
loaded rating, missing `lastReport` becomes null. Nothing else in v1 changes.

## File-by-file

1. `src/constants.js`: constants above; `SAVE_VERSION = 2`.
2. `src/sim.js`: clock helpers, `shaftsOf`, `liftService`, `happyBand`,
   happiness/leave step, quarter accumulator and report, `left`/`report` in the
   `stepTick` result, `s.service`, serialize/deserialize fields and v1 path.
3. `src/render.js`: happiness dot in `drawStructure` (unit case); `warn` token.
4. `index.html`: `#card` and `#report` markup inside `.stage`.
5. `styles.css`: `.card` and `.sheet` rules (fit `calc(100% - 16px)`).
6. `src/ui.js`: `showCard`, `hideCard`, `showReport`, weekday in the clock.
7. `src/main.js`: card on inspect, report on quarter end, move-out toast.
8. `tests/run.js`: the four Sprint 1 cases.

Order: 1, 2, 8 (run node tests until green), then 3-7, then the browser check.

## Decisions

- Rating (`computeRating`, `strain`) is untouched; happiness is a second loop
  beside it, not a replacement. Replacing the global strain penalty is a later
  sprint's call.
- The report sheet does not pause the clock; it is informational and the
  player may be mid-build.
- `wait` is a load ratio (demand / hourly capacity), not minutes; "poor" wait
  in exit test 1 means `>= WAIT_BUSY`.
- Vacant units keep a `happy` so fill chance has something to scale with;
  unreachable units are vacated by the old rule and skip the easing.
