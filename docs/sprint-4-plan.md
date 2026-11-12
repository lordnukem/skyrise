# Sprint 4 plan: Mixed use and underground (G-10, G-15, G-16, G-18, G-23, G-24, G-25, G-30)

Spec: `docs/FEATURE_GAP.md` Section C, Sprint 4. Goal: night and weekend have
their own economy, and the basement opens. Builds on the Sprint 1-3 model
(`s.service`, `shaftsOf`, `liftService`, walkers, star gates). Every tuning
number lives in `src/constants.js`.

## Design

**G-10 Basement and a taller plot.** Floor 1 stays the ground floor. Floor 0 is
B1, floor -1 is B2, down to `1 - BASEMENT_LEVELS` (B5). The state carries `dug`
(levels excavated, 0 at start, saved). A new tool `dig` (not a type, like `car`;
cost `DIG_COST`) is tapped on a basement level: `dig(s, floor)` digs it only when
it is the next level down (`floor === -s.dug`); a deeper tap is refused with "Dig
the level above first", a shallower one with "Already dug". This is the support
rule inverted: above ground a cell needs something below it, below ground a
level needs the level above it. `canPlace` on a floor below 1 needs every row of
the structure dug (no per-cell support underground: the dug level is the
support). Types carry `under`: `'yes'` (may go underground: stairs, lifts,
escalator, service lift, shop, food, plant room) or `'only'` (car park, transit
station; refused above ground). Anything else is refused underground. A
basement structure has nothing resting on it from floor 1 (that floor sits on
the ground), so `canDemolish` checks "built on top" only above floor 1. Lifts
and stairs run down from floor 1 as before; the BFS needs no change.
The plot also grows taller: `MAX_FLOORS` becomes 100 (the world frame), and
`FLOORS_AT_STARS` caps building height by the current rating (30, 30, 45, 60,
100). The camera clamps to the cap.

**Lifts below ground.** A shaft *grounded* when it spans floor 1. Its riders
board at floor 1 (`entryOf(sh)`: `lo` for a shaft above ground, `hi` for one
wholly below, else 1). Feeders are needed only by shafts with `lo > 1`, and a
feeder is any grounded shaft that serves that `lo`. Walking cost is a function
`climb(f)` that also counts floors walked *down* to the basement (escalator
discount applies both ways). Floor 1 joins the bottom stop as a stop that
cannot be closed. Towers above ground compute exactly as before.

**G-15 Hotel rooms.** Type `hotel` (2x1, unit, `people: 0`, `guests: 2`,
`nightly: HOTEL_NIGHT`). A room is clean-vacant, `occupied` (guests in) or
`dirty` (new saved field). Each tick (one hour), after housekeeping has cleaned:
an occupied room in `HOTEL_CHECKOUT` hours (07-10) checks out with
`HOTEL_CHECKOUT_CHANCE`, forced at 10; it pays `nightly x rent take` and becomes
dirty. A clean, vacant, reachable room in `HOTEL_CHECKIN` hours (18-22) checks
in with `HOTEL_CHECKIN_CHANCE x rent fill x happy / neutral`, times
`HOTEL_WEEKEND_FILL` on weekend nights. Hotels skip the generic fill. Unhappy
guests leave early (counted as moved out), unpaid, and leave the room dirty.
Rooms join the noise rule (G-21 named hotel rooms). Income bucket `hotel`.

**G-16 Housekeeping.** Type `housekeeping` (2x1, service, upkeep,
`range: HOUSEKEEPING_RANGE`). Derived `s.cleaners` (room id -> `{ office,
guestLift }`): each reachable room is assigned the reachable office within range
that reaches it without a guest lift, else the nearest. Each office cleans up to
`CLEAN_PER_HOUR` dirty rooms per hour, any hour. With no office in range a
dirty room stays dirty and is never let. Cleaning runs before checkout, so a
room that checks out is dirty for at least one full tick. Pests are deferred to
the Sprint 5 events (G-26).

**G-25 Service lift.** Type `servicelift` (1x1 lift, `staff: true`). Guests
never use it: `guestShafts` drops it from `liftService`, the walkers and the
strain capacity, and the BFS does not link its cells vertically (it is a
corridor cell on each floor). Staff route: an office reaches a room on its own
floor directly, on another floor by a service-lift shaft spanning both floors,
or else by the guest lifts. A room cleaned over the guest lifts loses
`STAFF_LIFT_PENALTY` happiness ("Staff use the guest lift").

**G-18 Event hall.** Type `hall` (4x1, unit, `perGuest: HALL_PER_GUEST`), fills
like a shop. In `HALL_EVENTS` hours (19 on weekdays; 14 and 19 on weekends) a
let, reachable hall runs an event. Derived `s.crowds` (hall id -> guests):
`min(HALL_SEATS x halls, visitors + population x HALL_POP_SHARE)` split evenly
over halls. `takeOf` adds `perGuest x crowd`. Income bucket `hall`.

**G-23 Parking.** Type `parking` (4x1, service, underground only, `spaces:
PARKING_SPACES`). Derived `s.perks` (unit id -> list of perk names): reachable
car parks give their spaces, one per let office or flat, in structure order;
a unit with a space gets `PERK_BONUS.parking` on its happiness target.

**G-24 Transit station.** Type `transit` (6x1, service, underground only,
unlocks at 4 stars). When reachable it adds `TRANSIT_VISITORS` to `s.visitors`
(shops and hall crowds). `STAR_REQUIRES[5] = ['transit']`.

**G-30 Clinic and plant room.** Types `clinic` (2x1) and `plant` (3x1, may go
underground), service, with `range`. A unit within range of a reachable one gets
`PERK_BONUS.clinic` / `.plant`. `STAR_REQUIRES[4] = ['clinic', 'plant']`.
`STAR_REQUIRES` values become arrays; `computeRating` caps below a level when
any of its types is missing.

**Gates.** `UNLOCK_AT`: hotel, housekeeping, service lift 2; hall, clinic, plant
3; transit 4. Dig and car park are open from the start.

## Constants added (src/constants.js)

`BASEMENT_LEVELS 5`, `DIG_COST 3000`, `FLOORS_AT_STARS`, `MAX_FLOORS 100`,
`HOTEL_CHECKIN [18, 22]`, `HOTEL_CHECKOUT [7, 10]`, `HOTEL_CHECKIN_CHANCE 0.5`,
`HOTEL_CHECKOUT_CHANCE 0.5`, `HOTEL_WEEKEND_FILL 1.4`, `HOTEL_NIGHT 160`,
`HOUSEKEEPING_RANGE 10`, `CLEAN_PER_HOUR 2`, `STAFF_LIFT_PENALTY 10`,
`HALL_EVENTS`, `HALL_SEATS 60`, `HALL_POP_SHARE 0.15`, `HALL_PER_GUEST 6`,
`PARKING_SPACES 6`, `PARKING_USERS`, `PERK_BONUS`, `CLINIC_RANGE 10`,
`PLANT_RANGE 15`, `TRANSIT_VISITORS 30`; eight types; `STAR_REQUIRES` arrays;
`UNLOCK_AT` entries; `TOOL_ORDER` gains `dig` and the eight tools. `SAVE_VERSION 5`.

## Save version

The shape changes (state `dug`, structure `dirty`, income `hotel`/`hall`, new
types), so `SAVE_VERSION = 5`. `deserialize` accepts 1-5: missing `dug` is 0,
`dirty` false, missing income 0. A structure below `1 - dug` makes the save
invalid (null). `maxFloors` is always `MAX_FLOORS` on load, so old saves grow too.

## File-by-file

1. `src/constants.js`: the constants, types and gates above; `SAVE_VERSION = 5`.
2. `src/sim.js`: `dug`, `dig`, `floorCap`, basement and height rules in
   `canPlace`, `canDemolish` floor-1 rule, `isLobbyFloor` guard, service-lift
   BFS seal, `guestShafts`, `entryOf`, grounded feeders, `climb(f)`, floor-1 stop
   lock, hotel hour, `s.cleaners`, `s.perks`, `s.crowds`, transit visitors,
   array star gates, hotel/hall income, serialize/deserialize.
3. `tests/run.js`: the five Sprint 4 exit tests plus small cases (hall crowd,
   parking perk, service-lift staff route, basement lift). Two existing lines
   change: the rating test flattens `STAR_REQUIRES`, the v4 stop test reads
   `SAVE_VERSION`.
4. `src/render.js`: basement band (code-drawn soil, dug levels, B labels, next
   level outline with the dig tool), camera clamp, height-cap line, eight
   structure cases, palette keys.
5. `styles.css`: tokens for the eight types and `--soil`, `--soil-dark`, `--dug`.
6. `src/ui.js`: tools with icons only where the file exists, else a text glyph
   (no `<img>` 404); report rows for hotel and hall.
7. `src/main.js`: `dig` tap, basement floor names (B1), tool descriptions, hotel
   card (Room clean/dirty/guests in), perks row, staff reason, service text.

Order: 1, 2, 3 (node tests green), then 4-7, then the browser check.

## Decisions

- Floor 0 is B1 (no gap in the numbering), so adjacency stays `floor +/- 1`;
  "negative floors" in the save test means B2 and below.
- Digging is per level, the full plot width, not per cell: one tap, one cost,
  and the inverted support rule is one comparison. Levels cannot be filled in.
- Hotel guests are not walkers and do not count as population: rooms fill only
  at night, and counting them would make the star rating (and the locked tools)
  flicker every day. Their happiness still reads the lift service of their floor.
- Hall crowds are a derived count (like diners), not walkers, and add no lift
  load.
- The staff route ignores which column the service lift is in: any service-lift
  shaft spanning both floors counts (an abstraction like security's range).
- Pests (G-16) are deferred to the Sprint 5 events; dirty rooms only stop letting.
- `maxFloors` is a constant world frame, ignored in saves, so that old towers
  grow with stars; the camera and placement follow `floorCap`.
- Icons: none of the eight files existed when Sprint 4 started; a tool shows its
  icon only if the file is listed in `ICON_FILES`, otherwise a text glyph. This
  avoids a 404 in the console.
