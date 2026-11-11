# Skyrise — design plan (vertical slice)

Skyrise is an original, touch-first tower-building sim for the phone browser.
You grow a tower floor by floor: lay lobby, lifts and stairs, then lease out
offices, shops and flats. A unit only earns when people can actually walk or
ride from the lobby to its door. Population, cash and a star rating drive
progress. Everything is drawn in code; nothing is borrowed from other games.

## Core loop

1. Pick a tool from the bottom toolbar, tap a cell to place it (cash is spent).
2. Each tick (one game hour, `TICK_MS` real ms) the simulation:
   - recomputes which structures are **reachable** from the lobby (BFS),
   - lets vacant *reachable* units fill up and empties unreachable ones,
   - pays rent and shop takings, charges lift upkeep,
   - recounts population and recalculates the star rating.
3. More population unlocks higher stars; higher floors need more transport,
   which costs upkeep, which needs more tenants. Repeat upward.

## Grid model

- A grid of `GRID_WIDTH` columns x `MAX_FLOORS` floors. Floor 1 is ground.
- Every structure occupies a rectangle of `w` x `h` cells anchored at its
  bottom-left `(col, floor)`. Cells never overlap.
- Types (defined once in `src/constants.js`, `TYPES`):

  | type     | kind      | w x h | role |
  |----------|-----------|-------|------|
  | lobby    | core      | 1 x 1 | ground floor only; BFS source; extends sideways |
  | stairs   | transport | 1 x 2 | joins floor f and f+1 (its two cells) |
  | elevator | transport | 1 x 1 | vertically adjacent lift cells in one column form a shaft; all cells of a shaft are mutually reachable; costs upkeep each tick |
  | office   | unit      | 3 x 1 | rent per tick when let; 4 workers |
  | shop     | unit      | 2 x 1 | takings scale with visitors (population-driven) |
  | flat     | unit      | 2 x 1 | rent per tick when let; 2 residents |

- **Support rule ("floor by floor"):** on floor > 1, every column of a new
  structure must have an occupied cell directly beneath it. On floor 1
  anything may be placed. A structure cannot be demolished while something
  sits on top of it.
- Lobby cells may be placed only on floor 1. The game starts with a lobby of
  `START_LOBBY_WIDTH` cells in the middle of the grid.

## Connectivity rules

`reachable(state)` runs a BFS over cells starting from every lobby cell:

- From a cell you may step to the left/right neighbour on the same floor if
  it is occupied by any structure (corridors are implied).
- From a cell you may step to every other cell of the same structure. This is
  what makes stairs (1 x 2) join two floors.
- From a lift cell you may step to the lift cell directly above or below
  (same column). Transitively the whole shaft is one node.
- A **unit earns only if at least one of its cells is reached.** Unreachable
  units are emptied on the next tick and attract nobody until reconnected.

## Economy (all numbers in `src/constants.js`)

Per tick, after connectivity:

- Vacant reachable unit fills with probability `FILL_CHANCE` (the RNG is an
  injectable parameter, so tests are deterministic).
- `population = sum(TYPES[t].people)` over let units.
- `visitors = min(SHOP_VISITOR_CAP, SHOP_WALKINS + floor(population * SHOP_VISITOR_RATIO))`.
- `income = sum(rent)` over let units `+ perVisitor * visitors` per let shop.
- `upkeep = ELEVATOR upkeep * lift cells`.
- `cash += income - upkeep`. Cash may go negative; the HUD warns. No game
  over in this slice.
- Placing costs `cost`; demolishing refunds `REFUND_RATIO * cost`.

## Rating

`stars = 1 + number of STAR_POP thresholds that population meets` (max 5),
then `-1` if **transport strain** `> 1` and `-1` if more than
`VACANCY_PENALTY_RATIO` of units are unreachable; clamped to 1..5.

Transport strain = `population / capacity`, where capacity is
`shafts * ELEVATOR_CAPACITY` when at least one lift shaft exists, otherwise
`STAIR_ONLY_CAPACITY`. This is what pushes the player from stairs to lifts.

## Save format

```json
{ "version": 1, "savedAt": 1700000000000,
  "state": { "width": 40, "maxFloors": 30, "cash": 12000, "tick": 0, "nextId": 9,
             "structures": [ { "id": 1, "type": "lobby", "col": 16, "floor": 1, "occupied": false } ] } }
```

`deserialize` rejects anything that is not an object with `version ===
SAVE_VERSION`, a finite `cash`, and a `structures` array whose entries all
have a known type and integer `col`/`floor`. Anything rejected (or a thrown
JSON parse error, or no storage at all) falls back to `newGame()`. Derived
fields (population, rating, visitors) are recomputed, never trusted.
Storage key: `skyrise.save`. Autosave every `AUTOSAVE_TICKS` ticks and on
`pagehide`/`visibilitychange`.

## Touch controls

- One-finger **tap** (< 8 px travel, < `LONG_PRESS_MS`): place the active
  tool at the tapped cell; with the Inspect tool, select and describe it.
- One-finger **drag**: pan the camera (clamped to the grid).
- Two-finger **pinch**: zoom about the midpoint, `ZOOM_MIN..ZOOM_MAX`.
- **Long-press** (`LONG_PRESS_MS`, finger still): demolish the structure under
  the finger with a refund. Blocked while something is built on top.
- Mouse: same gestures via pointer events; wheel zooms.
- Bottom toolbar: one button per tool, each at least 44 x 44 px, horizontally
  scrollable if the screen is narrow. Top HUD: cash, population, stars, a
  one-line status, and a menu (save, new game, theme, pause).

## Numbers that feed more than one place

All live in `src/constants.js` and are imported, never retyped:

- `TICK_MS` — sim clock (main loop), autosave cadence, tests.
- `CELL_W`, `CELL_H` — renderer geometry and input hit-testing.
- `GRID_WIDTH`, `MAX_FLOORS` — sim bounds, camera clamping, renderer.
- `TYPES[*].w/h/cost/rent/people` — placement rules, economy, renderer size,
  toolbar labels and the inspect text.
- `ELEVATOR_CAPACITY`, `STAIR_ONLY_CAPACITY`, `STAR_POP` — rating and the HUD
  hint text.
- `LONG_PRESS_MS`, `ZOOM_MIN/MAX` — input module and the help text.

## Module layout

- `src/constants.js` — the tuning sheet, plain data.
- `src/sim.js` — pure: `newGame`, `canPlace`, `place`, `demolish`,
  `reachable`, `stepTick`, `computeRating`, `serialize`, `deserialize`.
  No DOM, no canvas, runs under Node.
- `src/render.js` — canvas 2D; draws sky/day-night, floors, each type with its
  own look, unreachable hatching, lift cars and little walkers (cosmetic;
  derived from state each frame, never saved).
- `src/input.js` — pointer events → `tap`, `longpress`, `pan`, `zoom`.
- `src/ui.js` — toolbar, HUD, menu, status line.
- `src/storage.js` — localStorage wrapper, every call in try/catch.
- `src/main.js` — wires modules, runs the tick timer and render loop.
- `tests/run.js` — Node tests for the pure logic.

## Vertical-slice scope

In: 3 unit types (office, shop, flat), 2 transports (stairs, lift), lobby
extension, support rule, BFS connectivity, fill/vacate, income/upkeep,
population, star rating, day-night sky, cosmetic walkers and lift cars,
save/load/autosave with fallback, dark/light theme, tap/drag/pinch/long-press,
desktop mouse and wheel.

Out of scope (explicitly): agent-level pathfinding or wait times, lift
scheduling and capacity queues, events (fires, VIPs), multiple towers,
difficulty or speed settings, sound (no audio in this pass), tutorial,
undo, bankruptcy/game over, unit upgrades, hotels/restaurants/parking,
i18n, service workers/offline, leaderboards or any backend.
