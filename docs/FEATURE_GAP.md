# Skyrise feature-gap analysis (vs. the classic tower-sim genre)

Written 2026-11-12 against the working tree (last commit `8127150`). Skyrise is an
original game. SimTower (Maxis/OPeNBooK, 1994) is used only as a reference for
genre mechanics. No assets, code, names of its special buildings or exact
numbers should be carried over. Where a gap below names a SimTower facility,
the Skyrise version should get its own name, look and tuning.

Legend: **Yes** = present, **Partial** = some of it, **No** = absent.
Evidence is `file:line` as observed on 2026-11-12. SimTower behaviour comes
from memory. Lines marked `(~)` are recalled with less confidence; see the
list at the end.

## Snapshot: what Skyrise is today

A 40 x 30 grid (`src/constants.js:13-14`). Everything is placed floor by floor
and must have support below it (`src/sim.js:59-64`). Lobby, stairs and lift
connect units through a BFS from the lobby (`src/sim.js:103-133`). There are
three unit types: office, shop and flat (`src/constants.js:46-48`). Units fill
by coin flip when reachable (`src/sim.js:171-174`), pay a flat rent per hour,
and lifts cost upkeep (`src/sim.js:165-187`). Stars come from population, minus
one for global transport strain and minus one for unreachable units
(`src/sim.js:157-162`). Walkers and lift cars are cosmetic only
(`src/render.js:644`, `src/render.js:684`). The day-night sky
(`src/render.js:125-128`), autosave in one slot (`src/storage.js:11-30`) and
touch input all work. No individual people are simulated, there is no wait
time and no tenant happiness. Outside of being unreachable, nothing makes a
tenant leave.

## Section A: Comparison table

| # | Feature | SimTower behaviour (one line) | Skyrise | Evidence | Gap note |
|---|---|---|---|---|---|
| 1 | Ground lobby | Floor-1 lobby is the entry point for all traffic. | Yes | constants.js:43, sim.js:55, sim.js:107-110 | none |
| 2 | Sky lobby | Lobbies may also go every 15 floors (15, 30, ...) as transfer hubs. | No | sim.js:55 (ground only) | G-08 |
| 3 | Empty floor slab | You build bare floors first, then put tenants on them. | No | sim.js:60-64 (support needs a structure) | G-33 |
| 4 | Basement floors | Up to about 10 levels below ground for parking, metro and food (~). | No | sim.js:54 (floor < 1 rejected) | G-10 |
| 5 | Tower height | About 100 floors above ground. | Partial | constants.js:14 (30 floors) | G-10 |
| 6 | Office | Rented unit, workers come in on weekdays, rent paid each quarter (~). | Partial | constants.js:46, sim.js:181 | Has rent and 4 people; no schedule, happiness or quarterly rent |
| 7 | Condo | Sold once for a lump sum; residents live there day and night. | Partial | constants.js:48 | Flat pays rent per hour; G-19 |
| 8 | Hotel rooms (single/twin/suite) | Let per night; guests check in in the evening and out in the morning. | No | - | G-15 |
| 9 | Housekeeping | Cleans hotel rooms; rooms left dirty cannot be let. | No | - | G-16 |
| 10 | Fast food / restaurant | Customer traffic at meal times; income depends on visits. | No | - | G-17 |
| 11 | Retail shop | Income from visitors passing by. | Partial | constants.js:47, sim.js:135-137 | Visitors are a population formula; no foot traffic |
| 12 | Party hall / cinema | Draws evening and weekend crowds; pays per event. | No | - | G-18 |
| 13 | Parking | Basement ramp and bays; some tenants need a space (~). | No | - | G-23 |
| 14 | Metro station | Basement station; brings visitors; needed for top stars. | No | - | G-24 |
| 15 | Security office | Puts out fires and deals with threats; needed for 3 stars. | No | - | G-14 |
| 16 | Medical / recycling | Service rooms required at 4 stars (~). | No | - | G-30 |
| 17 | Landmark on top | A special top-floor building is the final goal (Tower rank). | No | - | G-28 (original landmark) |
| 18 | Stairs | Short hops between floors; people only walk a few floors. | Yes | constants.js:44, sim.js:123-124 | No walking-distance limit; G-12 |
| 19 | Escalator | Two-floor link with high throughput for shops and food. | No | - | G-22 |
| 20 | Standard elevator | Shaft spans up to 30 floors, 1-8 cars, real car trips. | Partial | sim.js:125-130, sim.js:139-152, constants.js:37,45 | Unlimited span, 1 cosmetic car (anim.js:35); G-06 |
| 21 | Express elevator | Stops only at the lobby and sky lobbies; fast and high capacity. | No | - | G-07 |
| 22 | Service elevator | Lift for staff (housekeeping) that guests do not use. | No | - | G-25 |
| 23 | Lift stop / car config | Set which floors a shaft serves and how many cars it has. | No | - | G-32, G-06 |
| 24 | Individual people | Every worker, resident and guest is a person with a daily trip schedule. | No | render.js:684 (cosmetic walkers) | G-12 |
| 25 | Waiting and stress | Long waits raise a person's stress (shown by colour) and lower ratings. | No | sim.js:150-152 (global strain only) | G-02, G-13 |
| 26 | Tenant evaluation | Each unit is rated good/fair/poor; poor tenants leave. | No | - | G-03 |
| 27 | Tenant departure | Unhappy tenants move out, and the unit stands empty. | Partial | sim.js:172 | Only when unreachable; G-03 |
| 28 | Noise / adjacency | Homes and hotel rooms dislike noisy neighbours (~). | No | - | G-21 |
| 29 | Rent level per unit | Player sets the rent; higher rent lowers happiness and fill rate. | No | - | G-20 |
| 30 | Star rating thresholds | 1-5 stars at population steps (300/1k/5k/10k/15k, ~). | Yes | constants.js:36, sim.js:157-162 | Thresholds are small (20-320); fine for the phone scale |
| 31 | Star requirements | Each star also needs a facility or event (security, medical, VIP, metro). | No | sim.js:158 | G-09 |
| 32 | Star-gated unlocks | New facility types unlock at each star. | No | ui.js:37-47 (all tools shown) | G-09 |
| 33 | Final "Tower" rank | Sixth rank above 5 stars for reaching the landmark goal. | No | - | G-28 |
| 34 | Cash | Funds go up and down from income and costs. | Yes | sim.js:183-184 | none |
| 35 | Build cost and demolition | Cost to build; bulldoze removes it (refund rules ~). | Yes | sim.js:72, sim.js:90-100 | none |
| 36 | Maintenance costs | Lifts and services cost money each period. | Partial | constants.js:45, sim.js:175 | Lifts only |
| 37 | Periodic finance report | Quarterly income and expense breakdown. | No | ui.js:99-101 (net/hour only) | G-05 |
| 38 | Calendar | Days, weekday/weekend, quarters (3 days each, ~), years. | Partial | ui.js:109-111, render.js:125-128 | Day/hour and day-night only; G-01 |
| 39 | Events | Fire, bomb threat, VIP visit, pests in hotels, seasonal fly-by. | No | PLAN.md:146 (out of scope) | G-26, G-27, G-16 |
| 40 | Bankruptcy / loans | Cannot build when out of money (~). | No | PLAN.md:66-67 | G-29 |
| 41 | Save / load | Several named save files. | Partial | storage.js:11-30, sim.js:189-220 | One autosave slot; G-34 |
| 42 | Build menu | Palette of facility tools with prices. | Yes | ui.js:37-47 | No locked state; G-09 |
| 43 | Placement preview | Ghost outline shows if a spot is valid. | Yes | render.js:341-345 | none |
| 44 | Inspect a unit | Window with tenant name, rating, rent and status. | Partial | main.js:65-73 | One-line toast; G-04 |
| 45 | Population / tower info windows | Totals by type, star requirements, overview map. | No | - | G-31 |
| 46 | Game speed | Pause plus several speeds. | Partial | main.js:30 (pause only) | G-11 |
| 47 | Day-night visuals | Sky and lit windows change through the day. | Yes | render.js:125-167 | none |
| 48 | Unreachable warning | Not in SimTower in this form; this is Skyrise's own feature. | Yes | render.js:583, render.js:622 | Keep: it is a Skyrise strength |
| 49 | Sound | Ambient sound and alerts. | No | PLAN.md:146 | G-35 (deferred) |
| 50 | Tutorial / goals | Star requirements act as the goals; no tutorial. | No | - | G-36 |

## Section B: Gap list

Size: S = under half a day, M = 1-2 days, L = 3+ days. "Art" means new
bitmap files. All rooms are drawn in code (`src/render.js:470-620`), so most
new rooms need only a toolbar icon.

| ID | Player-facing description | Size | Depends on | Art |
|---|---|---|---|---|
| G-01 | The clock runs weekdays and weekends, and offices fill and empty at morning, lunch and evening rush hours. | S | - | no |
| G-02 | Each lift shaft shows how busy it is, and an overloaded shaft makes people wait longer at rush hour. | M | G-01 | no |
| G-03 | Every unit has a happiness score (good/fair/poor) built from wait time and walking distance, and poor units move out. | M | G-02 | no (code-drawn badge) |
| G-04 | Tapping a unit with Inspect opens a small card with its happiness, the reason for it, rent and occupancy. | S | G-03 | no |
| G-05 | At the end of each quarter a report shows income by type, upkeep and the change in stars. | S | G-01 | no |
| G-06 | Lift shafts have a maximum span and one or more cars, and adding a car raises capacity. | M | G-02 | no |
| G-07 | An express lift skips floors and stops only at lobbies, so tall towers stay quick. | M | G-06, G-08 | yes: `icon-express.png` |
| G-08 | You can build a sky lobby on every 15th floor (or a tuned interval) as a transfer hub. | S | - | no (reuses the lobby icon) |
| G-09 | Higher stars need a key facility as well as people, and new tools unlock as stars rise. | M | G-03, G-14 | yes: `icon-lock.png` |
| G-10 | The plot grows taller and gains basement levels you dig into. | M | - | no (code-drawn soil) |
| G-11 | Speed buttons: pause, 1x, 2x and 4x. | S | - | no |
| G-12 | Workers, residents and visitors are real people who make trips and ride real lift cars. | L | G-01, G-06 | no |
| G-13 | People queue at lift doors and change colour as they get stressed. | M | G-12 | no |
| G-14 | A security office covers a range of floors and is needed for 3 stars. | S | - | yes: `icon-security.png` |
| G-15 | Hotel rooms take guests overnight and pay at checkout. | M | G-01 | yes: `icon-hotel.png` |
| G-16 | Housekeeping cleans hotel rooms; rooms left dirty cannot be let and attract pests. | M | G-15 | yes: `icon-housekeeping.png` |
| G-17 | A food court earns from lunch and dinner crowds coming from nearby floors. | M | G-01 | yes: `icon-food.png` |
| G-18 | An event hall draws evening and weekend crowds and pays per event. | M | G-01, G-02 | yes: `icon-hall.png` |
| G-19 | Flats are sold once for a lump sum, and if the owner leaves unhappy you lose the resale. | S | G-03 | no |
| G-20 | You set each unit's rent (low/normal/high), which trades income against happiness and fill rate. | S | G-03, G-04 | no |
| G-21 | Flats and hotel rooms next to shops, food or lifts lose happiness from noise. | S | G-03 | no |
| G-22 | An escalator joins two floors with high capacity, made for shop and food floors. | S | - | yes: `icon-escalator.png` |
| G-23 | Basement parking gives offices and flats a happiness bonus when it has spaces. | M | G-10, G-03 | yes: `icon-parking.png` |
| G-24 | A basement transit station brings in visitors and is needed for 5 stars. | M | G-10, G-09 | yes: `icon-transit.png` |
| G-25 | A service lift carries only staff, which keeps housekeeping out of the guest lifts. | S | G-16, G-12 | yes: `icon-service-lift.png` |
| G-26 | Fires break out at random; a security office in range puts them out, otherwise units burn. | M | G-14 | no (code-drawn flame) |
| G-27 | A VIP visits; their review of the best hotel room can win or block a star. | S | G-15, G-09 | no |
| G-28 | An original rooftop landmark (for example a sky garden) is the final goal above 5 stars. | M | G-09, G-10 | yes: `icon-landmark.png` |
| G-29 | Cash below zero for a whole quarter means a forced loan or a game over. | S | G-05 | no |
| G-30 | Clinic and plant-room service units are needed for 4 stars and lift happiness nearby. | S | G-09 | yes: `icon-clinic.png`, `icon-plant.png` |
| G-31 | A tower sheet shows population by type, star requirements met or missing, and a mini map. | M | G-09 | no |
| G-32 | Choose which floors a shaft stops at. | S | G-06 | no |
| G-33 | Bare floor slabs let you span gaps and plan floors before letting them. | S | - | yes: `icon-floor.png` |
| G-34 | Three save slots, plus export and import of a tower as a file. | S | - | no |
| G-35 | Sound: lift chime, cash tick and alerts. | M | - | audio, not art (deferred) |
| G-36 | A first-run guide gives three goals that teach lobby, lifts and happiness. | M | G-03 | no |

## Section C: Sprints

**Recommended order, and why.** A tower sim feels like one when *transport
quality decides whether tenants stay*. Today that link is a single global
star penalty (`src/sim.js:159`). Sprint 1 builds that loop as a cheap
aggregate model. It needs no agents and no art, so it is safe to ship in one
pass. Sprint 2 makes height a problem to solve (spans, express lifts, sky
lobbies, star gates). Sprint 3 swaps the aggregate model for visible people,
which is the genre's signature look, and does it on a model that is already
tuned. Mixed use and the underground come after that, and events and the
endgame come last. New facility types are held back until the happiness loop
exists, because without it they are only different rent numbers.

All new tuning numbers go in `src/constants.js` (the rule at PLAN.md:109-120).
G-02, G-03, G-06 and G-12 change numbers that feed rating, economy and render
together. Under CLAUDE.md § Model Routing they get one advisor review per
sprint before editing. Every save-format change raises `SAVE_VERSION`
(`src/constants.js:4`), and `deserialize` must still load v1 saves. Moving
to v2 is a migration, not a reset.

Playwright checks below run against a static server started after the edit
(`python3 -m http.server 8123`), viewport 360x740, and read
`window.skyrise.state` (`src/main.js:159`). Each one also asserts
`document.documentElement.scrollWidth <= 360` and that the console has no
errors.

### Sprint 1: Tenants who care (G-01, G-02, G-03, G-04, G-05)

Goal: the lift you build now decides who stays, and the player can see why.

- G-01: `tick` maps to hour, weekday and quarter (one quarter = N days, tuned).
  Each type gets a demand curve with peaks at 08, 12 and 17 for offices, 07
  and 19 for flats, and a weekend profile.
- G-02: for each shaft, demand = sum of the people on the floors it serves x
  the curve at this hour. `wait = f(demand / capacity)`. Floors reached only
  by stairs get a walking cost per floor climbed.
- G-03: `st.happy` (0-100) eases toward a target made from wait and walking
  cost. Below `LEAVE_AT` for `LEAVE_TICKS` ticks, the unit empties. Fill
  chance scales with happiness. The renderer draws a 4 px good/fair/poor dot.
- G-04: Inspect opens a card instead of the toast, showing happiness, its main
  cause ("lift busy at 08:00"), rent and people.
- G-05: at the quarter boundary, the HUD opens a report sheet (income by type,
  upkeep, net, stars before and after). It is kept on the state as `lastReport`.

Exit tests:
- Node (`node tests/run.js`, new cases):
  1. With `rng = () => 0`, 10 floors of offices on one shaft reach `wait`
     above the poor threshold at 08:00 and below it at 03:00.
  2. That tower loses at least one office within `LEAVE_TICKS + 24` ticks.
     Adding a second shaft keeps every office over a simulated weekday.
  3. Happiness and the quarter report survive the round trip
     `serialize -> JSON -> deserialize`.
  4. A v1 save still loads, and every unit starts at neutral happiness.
- Playwright 360x740:
  1. Load the page, select Inspect (`[data-tool=inspect]`) and tap an office.
     A card with the text "Happiness" appears and fits the viewport.
  2. Set `state.tick` to one tick before a quarter end and wait one tick.
     The report sheet is visible and dismissable.
  3. Screenshot to `docs/screenshots/s1-inspect-360x740.png`.

Art: none.

### Sprint 2: Going up (G-06, G-07, G-08, G-09, G-11, G-14, G-19, G-20)

Goal: height becomes a problem the player solves with lift design, and stars
unlock tools.

Exit tests:
- Node:
  1. A standard shaft taller than `LIFT_MAX_SPAN` is refused.
  2. An express shaft serves only lobby floors.
  3. A tower with a sky lobby and express lift has a lower peak wait on floor
     25 than one with only standard lifts.
  4. 3 stars are refused without a security office, even with enough people.
  5. A locked tool cannot be placed.
  6. A flat sale credits its price once.
- Playwright 360x740:
  1. Locked tools show the lock glyph and an "unlocks at 3 stars" label.
  2. The speed buttons change ticks per second (measured over 5 s).
  3. The toolbar still scrolls horizontally with 10 or more tools.

Art (agy):
- `assets/art/icon-express.png`: 256x256, lift shaft with a double up-arrow.
- `assets/art/icon-security.png`: 256x256, shield with a small badge star.
- `assets/art/icon-lock.png`: 128x128, padlock, overlaid at 14 px on the
  locked tool.

### Sprint 3: People you can see (G-12, G-13, G-17, G-21, G-22, G-32, G-33)

Goal: real commuters ride real cars. The Sprint 1 aggregate model becomes the
oracle the agent model is tested against.

Exit tests:
- Node:
  1. On a fixed seed, agent-model average wait over a weekday is within ±25%
     of the G-02 estimate for three reference towers.
  2. Total people in transit is never above the population.
  3. 10,000 ticks of a 30-floor tower stay under 5 ms per tick on Node
     (measured with `performance.now`).
- Playwright 360x740:
  1. At 08:00 on a busy tower, at least one queue is drawn at a lift door.
  2. A stressed walker is drawn in the stress colour (sample the canvas pixel
     at a known agent position).
  3. Frame time stays at or below 20 ms median over 3 s.

Art (agy):
- `assets/art/icon-food.png`: 256x256, bowl with steam.
- `assets/art/icon-escalator.png`: 256x256, diagonal step band.
- `assets/art/icon-floor.png`: 256x256, bare slab with a dashed outline.

### Sprint 4: Mixed use and underground (G-10, G-15, G-16, G-18, G-23, G-24, G-25, G-30)

Goal: night and weekend have their own economy, and the basement opens.

Exit tests:
- Node:
  1. A hotel room checks in at 18-22, checks out at 07-10, and becomes dirty
     after checkout.
  2. With no housekeeping it stays unlettable for 24 ticks.
  3. A basement level needs the level above it dug first (the support rule
     inverted).
  4. 5 stars are refused without the transit station.
  5. A save with negative floors round-trips.
- Playwright 360x740:
  1. Pan below ground shows the basement band and a placed car park.
  2. A hotel room's Inspect card shows "dirty" after checkout.

Art (agy):
- `icon-hotel.png`, `icon-housekeeping.png`, `icon-hall.png`,
  `icon-parking.png`, `icon-transit.png`, `icon-service-lift.png`,
  `icon-clinic.png`, `icon-plant.png`: all 256x256.

### Sprint 5: A living tower (G-26, G-27, G-28, G-29, G-31, G-34, G-36)

Goal: events, a clear endgame and a first-run guide. G-35 (sound) stays
deferred until an audio decision is made.

Exit tests:
- Node:
  1. A forced fire (seeded) is put out within T ticks when a security office
     is in range, and otherwise destroys the unit.
  2. A VIP review uses the best hotel room's happiness.
  3. A negative-cash quarter triggers the loan path.
  4. Three save slots stay isolated.
- Playwright 360x740:
  1. The tower sheet lists missing star requirements.
  2. The first-run guide shows goal 1 on a fresh `localStorage`.
  3. Export produces a downloadable JSON file that imports back.

Art (agy):
- `assets/art/icon-landmark.png`: 256x256.
- `assets/art/landmark-rooftop.png`: 288x192, about 12x6 cells at
  `CELL_W 24` and `CELL_H 32`, drawn as a sprite on the top floor.

### agy prompt spec (all icons)

Match the existing set (`assets/art/icon-*.png`, shown at 26 px per
styles.css:340):

- Flat vector style: no outlines, no gradients, no text.
- One centred glyph filling about 85% of the canvas.
- Solid `#FF00FF` background, keyed out afterwards (as in
  `assets/art/LICENSE.md:5`).
- Palette taken only from the `styles.css:42-62` tokens:
  - body `#3a4250` (shaft)
  - glass `#b7dcf7`
  - light `#ffd784` (window-lit)
  - accent `#f6b73c` (car)
  - office `#a6bedf`, shop `#eeb09e`, flat `#eedcb4`, lobby `#e9d3a0`
  - danger `#c2410c`
  - link blue `#2563eb`
- Use at most 4 colours per icon.
- After keying, trim and resize so the long edge is 256 px.
- Check that the icon still reads at 26x26 before committing.

The rooftop sprite uses the same palette with `--window-lit` for its night
glow. It must read in both themes, so it should not depend on the light sky
behind it.

## SimTower facts recalled with low confidence (`~`)

- Underground depth (about 10 levels) and the 100-floor limit.
- Whether offices pay rent each quarter or on another cycle.
- A quarter as 3 days (2 weekdays + 1 weekend).
- The exact list of star requirements: 3 stars needs security; 4 stars needs
  medical, recycling and a good VIP review; 5 stars needs a metro.
- Exactly which facilities unlock at which star.
- Whether parking is required by any tenant.
- How noise adjacency works.
- Demolition refund rules.
- Whether running out of money ends the game or only blocks building.

None of these change the plan, because Skyrise sets its own numbers. They
matter only if someone claims "this is how SimTower did it". No web search was
run; everything here is from memory.
