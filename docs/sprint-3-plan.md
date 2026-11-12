# Sprint 3 plan: People you can see (G-12, G-13, G-17, G-21, G-22, G-32, G-33)

Spec: `docs/FEATURE_GAP.md` Section C, Sprint 3. Goal: real commuters ride real
lift cars, and the Sprint 1 aggregate model (`liftService`, `s.service`) is the
oracle the agent model is tested against. Every tuning number lives in
`src/constants.js`.

## Agent model (G-12, G-13)

**Clock.** One tick is one game hour. The agent model runs `WALK_STEPS` (12)
sub-steps per tick through a new export `stepWalkers(s, rng)`; `stepTick` is
unchanged in what it does. `main.js` spreads the sub-steps over the tick's wall
time (so cars move during the hour) and always finishes the hour's remaining
sub-steps before calling `stepTick`. Tests use `stepHour(s, rng)` = 12 x
`stepWalkers` + `stepTick`.

**Transit state.** `s.transit` (derived, never saved) holds one record per
shaft: `{ col, lo, hi, type, perStep, credit, queue: [], cars: [{ at, to, n }] }`
plus `riding` (walkers in a car this sub-step), `clock` (sub-step counter),
`active` (unit id -> walkers in transit) and `stats` (`trips`, `wait`,
`gaveUp`). Shaft geometry, routes and feeders are rebuilt in `refreshDerived`
only when the shaft signature (shafts, cars, closed stops, lobby floors)
changes; a change drops every walker (they respawn next hour). Walkers whose
unit is gone, vacant or unreachable are dropped on every refresh.

**Walker record.** `{ unit, legs: [[shaft, from, to], ...], leg, joined, wait,
stress }`. A walker is either queued at a shaft (its door is `legs[leg][1]`) or
riding (in `riding`, one sub-step). It never exists outside those two states:
walking to and from the door is not modelled.

**Trips.** At the first sub-step of each hour every occupied, reachable unit
above the ground floor with a serving shaft spawns `people x demandAt(hour)`
walkers, rounded stochastically with `rng` (expected count equals the G-02
rider count), capped at `people - active[unit]`. Direction follows the curve:
offices go in (lobby -> unit) before noon and out after; flats the reverse.

**Choosing a lift.** The same routes as `liftService`: the shafts that serve the
unit's floor, each with its feeders when it starts above the ground. A walker
takes the option with the lowest `(queue + 1) / capacity`, plus the lowest such
feeder term when there is a transfer. In-trips ride the feeder first; out-trips
ride the upper shaft first.

**Riding.** Each sub-step a shaft earns `perStep = capacity x cars / WALK_STEPS`
boarding credit and boards that many walkers from the front of its queue
(FIFO, any door). Boarded walkers are dealt round-robin to the shaft's cars; a
car that took riders gets `at` = first rider's door, `to` = its destination,
`n` = riders. A ride takes exactly one sub-step, so shaft throughput per hour is
exactly the capacity G-02 divides by. On arrival a walker queues for its next
leg or finishes (trip counted in `stats`).

**Wait and stress.** A leg's wait is `(boardStep - joinStep + 0.5) / WALK_STEPS`
hours (the 0.5 is the continuity correction for boarding mid-step). Stress is
`min(1, total wait so far / GIVE_UP_HOURS)`; `stressBand` maps it to calm,
tense (>= `STRESS_TENSE`) or stressed (>= `STRESS_HIGH`). A walker still queued
`GIVE_UP_HOURS` after joining gives up (takes the stairs: removed, wait counted
as `GIVE_UP_HOURS`). The renderer draws queued walkers in a line beside the
lift door, torso coloured by band (shirt, `--warn`, `--danger`).

**Relation to the aggregate model.** G-02's `wait` is a load ratio: hours a
shaft needs to clear this hour's riders. When riders arrive together at the
top of the hour, the mean rider waits half the clearing time, so the agent
model's comparable figure is `WAIT_PER_HOUR (2) x mean queue hours`. With no
backlog that is exact; under overload the agent model diverges (backlog carries
over, walkers give up), which is the behaviour the oracle test bounds at ±25%.
Happiness, leaving and rating stay on the tuned aggregate `s.service`; agents
are the visible, measured model beside it.

## Other gaps

- **G-17 Food court.** Type `food` (3x1, unit, no people). Each hour of
  `MEALS` (12, 13, 18, 19) it serves `MEALS[h]` of the people on occupied units
  within `FOOD_RANGE` floors, split evenly between courts in range, and earns
  `perDiner` each. Derived `s.diners` (id -> diners) feeds `takeOf`.
- **G-21 Noise.** A flat with a shop, food court or lift cell directly beside it
  on the same floor is noisy: its happiness target loses `NOISE_PENALTY`. Derived
  `s.noisy` (Set of flat ids); the card's "Why" names it.
- **G-22 Escalator.** Type `escalator` (2x2, transport). It connects its two
  floors like stairs; in the walking cost, a floor climbed where a reachable
  escalator joins it costs `ESCALATOR_WALK` instead of 1.
- **G-32 Stops.** Lift cells carry `closed` (saved). A closed cell is sealed like
  an express cell off a lobby floor; `serves` skips it. Inspect on a lift opens a
  card with a "Stops here" toggle (`toggleStop`); the bottom stop cannot close.
- **G-33 Floor slab.** Type `floor` (1x1, kind `slab`, cheap). It needs support
  below or a structure beside it on the same floor (so it spans gaps). Any other
  type may be placed over slab cells; the slabs it covers are removed, and a
  slab counts as the support for the cell it is replaced in.

## Constants added (src/constants.js)

`WALK_STEPS 12`, `WAIT_PER_HOUR 2`, `GIVE_UP_HOURS 1`, `STRESS_TENSE 0.4`,
`STRESS_HIGH 0.75`, `FOOD_RANGE 5`, `FOOD_PER_DINER 3`, `MEALS`,
`NOISE_PENALTY 12`, `NOISY_TYPES`, `ESCALATOR_WALK 0.25`; types `food`,
`escalator`, `floor`; `TOOL_ORDER` gains `floor`, `escalator`, `food`.
`SAVE_VERSION = 4`.

## Save version

Walkers, queues and cars are derived and not saved: a load starts with an empty
transit and the next hour respawns trips. The saved shape still changes (lift
cells carry `closed`; new types; quarter income gains `food`), so
`SAVE_VERSION = 4`. `deserialize` accepts 1-4; a missing `closed` is false and a
missing `food` income is 0.

## File-by-file

1. `src/constants.js`: the constants and types above, `SAVE_VERSION = 4`.
2. `src/sim.js`: `closed` on structures, slab rules in `canPlace`/`place`,
   closed cells sealed in `reachable`, `closed` in `shaftsOf`/`serves`,
   escalator climb in `liftService`, `toggleStop`, `s.noisy`, `s.diners`,
   food income, the transit model (`stepWalkers`, `stepHour`, `stressBand`,
   `inTransit`), serialize/deserialize.
3. `tests/run.js`: oracle (three towers), transit <= population, 10,000-tick
   timing, queues form, stress colour state, plus small cases for food, noise,
   escalator, stops and slabs. Existing 26 stay green.
4. `src/render.js`: cars from `s.transit` (replacing the cosmetic planner),
   queues at lift doors with stress colours, `food`/`escalator`/`floor` art,
   floats via `takeOf`.
5. `styles.css`: `--food`, `--escalator`, `--slab` tokens; text glyph fallback.
6. `src/ui.js`: icons for the three tools with a text fallback; food report row.
7. `src/main.js`: sub-stepped walkers in `advance`, lift card with the stop
   toggle, tool descriptions, noise in the card's "Why".

Order: 1, 2, 3 (node tests green), then 4-7, then the browser check.

## Decisions

- Happiness keeps reading the aggregate `s.service`, not agent waits: it is
  tuned, and the spec makes the aggregate model the oracle. Agents are drawn and
  measured; switching happiness to them is a later call.
- A ride takes one sub-step whatever its length, and a car boards from any door
  in FIFO order. This keeps throughput equal to G-02's capacity so the two
  models stay comparable; car motion is drawn from `at` to `to` in that step.
- The cosmetic planner in `anim.js` stays (it is tested) but the renderer no
  longer drives cars with it. The corridor strollers stay as decoration.
- Only lift riders are agents; stairs and escalator climbers are not modelled.
- Food diners are a derived count, not walkers, and food courts are unlocked
  from the start, like shops. Escalator, slab and food have no star gate.
- Noise counts only side neighbours on the same floor (no hotels exist yet).
- A slab spans any distance beside a structure (no cantilever limit), and a
  slab that only props up a neighbouring slab sideways may still be demolished.
- The escalator discount applies to every floor step it joins, wherever the
  climb happens on that floor (walking cost is already path-agnostic).
- For the 5 ms budget, `stepTick` builds the grid once and passes it to
  `reachable` and `refreshDerived`, and the BFS walks its queue by index instead
  of `shift()`. Results are unchanged.
- Oracle note: a transfer tower (sky-lobby test tower) runs about 20-25% below
  G-02, because transfer riders arrive in a stream, not a burst. It is not one
  of the three reference towers.
