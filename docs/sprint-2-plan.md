# Sprint 2 plan: Going up (G-06, G-07, G-08, G-09, G-11, G-14, G-19, G-20)

Spec: `docs/FEATURE_GAP.md` Section C, Sprint 2. Builds on the Sprint 1 model
(`s.service`, `shaftsOf`, `liftService`, happiness easing, quarter report) and
does not duplicate it. Every tuning number lives in `src/constants.js`.

## Design

**G-06 Span and cars.** A standard shaft may climb at most `LIFT_MAX_SPAN`
floors (`hi - lo <= LIFT_MAX_SPAN`). `canPlace('elevator')` computes the run
the new cell would join (cells above and below in the column) and refuses
with "Lift shaft spans at most N floors". Cars: every lift cell carries
`cars` (extra cars, default 0). A shaft's car count is `1 + sum(cars)` over
its cells, capped at `LIFT_MAX_CARS`. A new toolbar tool `car` (not a type;
cost `LIFT_CAR_COST`) is tapped on any lift cell: `addCar(s, col, floor)`
increments that cell's `cars`. Capacity scales with cars in both loops:
`liftService` divides a shaft's load by `cap x cars` and `refreshDerived`
sizes the rating's strain capacity as `sum(cars) x ELEVATOR_CAPACITY`. With
one car per shaft both are identical to Sprint 1.

**G-08 Sky lobby.** `isLobbyFloor(f)`: floor 1 or `(f - 1) % SKY_LOBBY_EVERY
=== 0` (1, 16, 31 ...). `canPlace('lobby')` accepts those floors; the support
rule still applies. BFS sources are ground-floor lobby cells only, so a sky
lobby is a transfer hub, never a second entrance. `canDemolish` protects the
last ground lobby cell.

**G-07 Express lift.** New type `express` (`kind: 'transport'`, dearer, higher
upkeep, own `EXPRESS_MAX_SPAN` and `EXPRESS_RUSH_CAPACITY`). `shaftsOf` groups
contiguous cells of the same lift type and returns `{ col, lo, hi, type,
cars }`. In the BFS an express cell on a non-lobby floor is sealed: it links
only to express cells above and below, never sideways. A shaft *serves* floor
F when `lo <= F <= hi` and (standard, or express and `isLobbyFloor(F)`).
Transfers: a shaft with `lo > 1` has feeders, the other shafts that span
`[1, lo]` and serve `lo`. A unit's riders split evenly over the shafts
serving its floor, and the share landing on a shaft with feeders splits
evenly again over those feeders. Its `wait` is the lowest `load/cap` over
serving shafts, plus the lowest feeder `load/cap` when the shaft has feeders;
`walk` is `feeder.lo - 1` with a feeder, else `lo - 1` as in Sprint 1. One
transfer deep; a feeder that itself starts above ground is reached by stairs.

**G-14 Security office.** Type `security` (`kind: 'service'`, 2x1, upkeep,
`range: SECURITY_RANGE`). Not a unit: never fills, no happiness, no rent.
Reachability as any room. `s.facilities` (derived Set of reachable service
types) feeds the rating. The inspect toast names the floors it covers.

**G-09 Star gates and unlocks.** `STAR_REQUIRES = { 3: 'security' }`:
`computeRating(pop, strain, unreachRatio, facilities)` caps stars below each
level whose facility is missing. `UNLOCK_AT = { security: 2, express: 3 }`;
`canPlace` refuses a locked type with "Unlocks at N stars" (checked before
space and cash so the toolbar reason is the one the player sees). The lock
follows the current `s.rating`. Toolbar buttons of locked tools get
`.locked`, `aria-disabled`, the price replaced by "unlocks at N stars", and a
14 px `icon-lock.png` overlay when the file exists.

**G-11 Speed.** `SPEEDS = [0, 1, 2, 4]`. `main.js` keeps `speed` (index into
`SPEEDS`); paused is `SPEEDS[speed] === 0`. The tick length is `TICK_MS /
SPEEDS[speed]`, used by the advance loop and the lift-car phase. A vertical
`.speed` button stack (pause, 1x, 2x, 4x) sits in the stage's top-right
corner; the menu's Pause entry toggles between 0 and the last running speed.

**G-19 Flat sale.** `TYPES.flat` gets `price: FLAT_PRICE` and `rent: 0`.
Each unit carries `sold` (default false). When a flat fills and `sold` is
false, the tick credits `price x rent factor` once and sets `sold`. A later
owner who moves in after a departure pays the previous owner, not you, so
`sold` never resets. The report row is "Flat sales".

**G-20 Rent level.** Each unit carries `rentLevel` ('low' | 'normal' |
'high', default normal). `RENT_LEVELS[level] = { take, happy, fill }`:
income (rent, takings and a flat's sale price) x `take`; happiness target
+ `happy`; fill chance x `fill`. `cycleRent(s, id)` steps the level. The
inspect card gets a "Rent: Normal" action button that cycles it.

## Constants added (src/constants.js)

`LIFT_MAX_SPAN 15`, `LIFT_MAX_CARS 4`, `LIFT_CAR_COST 900`, `EXPRESS_MAX_SPAN
30`, `EXPRESS_RUSH_CAPACITY 48`, `SKY_LOBBY_EVERY 15`, `SECURITY_RANGE 15`,
`STAR_REQUIRES`, `UNLOCK_AT`, `SPEEDS`, `FLAT_PRICE 2600`, `RENT_LEVELS`,
`TYPES.express` (1x1, cost 1400, upkeep 7), `TYPES.security` (2x1, cost 2200,
upkeep 6), `TYPES.flat.price`, `TOOL_ORDER` with `car`, `express`, `security`.
`SAVE_VERSION = 3`.

## Save version

Shape changes (per-structure `cars`, `sold`, `rentLevel`; new types), so
`SAVE_VERSION = 3`. `deserialize` accepts 1, 2 and 3: missing `cars` is 0,
`sold` false, `rentLevel` 'normal'. Nothing else in v1/v2 changes.

## File-by-file

1. `src/constants.js`: constants above, two types, `SAVE_VERSION = 3`.
2. `src/sim.js`: `isLobbyFloor`, span check and unlock check in `canPlace`,
   ground-only BFS sources and sealed express cells in `reachable`, typed
   `shaftsOf` with cars, feeders in `liftService`, `addCar`, `cycleRent`,
   facilities + gated `computeRating`, flat sale and rent levels in
   `stepTick`, serialize/deserialize fields.
3. `tests/run.js`: the six Sprint 2 cases; existing economy and rating cases
   updated for the flat sale and the facilities argument.
4. `src/render.js`: `layout` uses `shaftsOf`; `express` and `security` cases
   in `drawStructure`; upkeep float per shaft type; `--express`/`--security`
   palette keys.
5. `styles.css`: toolbar scrolls horizontally; `.locked` button and lock
   overlay; `.speed` stack; `.card-actions`; the two palette tokens.
6. `index.html`: `.speed` group in the stage; `#card-actions` in the card.
7. `src/ui.js`: icons for `car`/`express`/`security`, lock state in `update`,
   speed buttons, card action button, report row label.
8. `src/main.js`: `car` tool tap, speed state, rent action, express and
   security descriptions.

Order: 1, 2, 3 (node tests green), then 4-8, then the browser check.

## Decisions

- Toolbar layout changes from wrapping to a single horizontally scrolling
  row: the Sprint 2 exit test requires it and 10 tools in three wrapped rows
  would eat the stage on a 360 px phone.
- Sprint 1 `liftService` is extended, not changed: a shaft starting above
  ground now rides a feeder when one exists; with none it falls back to the
  Sprint 1 stairs walk. Towers with ground-based shafts behave exactly as
  before. Shaft capacity gains a `cars` factor that is 1 on every Sprint 1
  tower.
- Report row "Lift upkeep" becomes "Upkeep" (security also costs upkeep) and
  "Flat rent" becomes "Flat sales" (flats no longer pay hourly rent).
- `computeRating` takes a fourth argument, the Set of reachable service
  types; the existing rating test passes `new Set(['security'])`.
- Locks follow the current rating, not the best rating reached, so no new
  saved field is needed; a tower that loses a star loses the tool until it
  recovers. Placed structures are never removed.
- The economy test's expected income gains the flat sale on the fill tick.
- Lift cars are a count on cells, not a shaft entity: a shaft's bottom cell
  cannot be demolished while cells sit on it, so the count is stable, and
  two shafts that merge keep every car.
- `icon-lock.png` is not in `assets/art/` at planning time; the lock overlay
  is an `<img>` that is hidden on error, so the text label carries the state
  until the file lands. (The file has since landed and the overlay shows.)
- An express lift opens on floors where a lobby is actually built
  (`lobbyFloorsOf`), not on every `isLobbyFloor` floor: the spec says it
  "stops only at lobbies", and a sky-lobby floor with no lobby has nowhere to
  step out. `isLobbyFloor` still decides where a lobby may be placed.
- Locked tool buttons carry `aria-disabled="true"` but stay tappable, so the
  status line can say when they unlock. Browser automation must tap them
  with `force`.
