# Sprint 12: interiors, escalators, basement, lifts (2026-11-28)

Goal: bring the rest of the building up to the Sprint 11 standard. Everything is code-drawn in
`src/rooms.js` and shows from zoom 0.9 up; below that the simple drawings stay, so a whole tower
at a glance stays clean. Before and after: `docs/screenshots/s12-before-after.png`.

## What changed

- **Security**: a wall of eight CCTV screens that cycle between views, a desk, a guard in a navy
  uniform and cap, a gold shield badge.
- **Clinic**: a red-cross sign, a patient in a bed with a green blanket, a drip stand, a
  half-drawn curtain, a nurse, a ceiling light.
- **Housekeeping**: shelves of folded towels, a washing machine whose drum turns, a laundry cart,
  a member of staff.
- **Plant room**: ceiling pipes with red valve wheels, two tanks with gauges whose needles move, a
  ventilation fan that spins, hazard stripes.
- **Hotel room**: curtains, a framed picture, a bed with headboard, pillow and spread, a nightstand
  lamp that glows while guests are in at night, a sleeping guest at night; the dirty state stays.
- **Event hall**: curtains and a valance, a chandelier, rows of seats; during an event the stage
  is lit, two spotlights sweep, a performer takes the stage and the seats fill with an audience
  (more as the crowd grows). The hall's name sign stays.
- **Escalators**: a steel truss with a darker edge, steps creeping up, a glass balustrade, a black
  handrail, two riders gliding up when the tower has people.
- **Car park**: concrete columns with yellow kerbs, strip lights, a blue P sign, bay lines, side-view
  parked cars in eight colours, a green exit sign.
- **Transit**: a tiled wall with a SKYRISE line band, a yellow platform edge, a three-car train that
  pulls in, waits ten seconds and leaves on a 24 s cycle, passengers waiting while it is away.
- **Lift shafts**: concrete courses, guide rails (gold for express), landing doors at every stop
  with a call button; closed stops are dark and crossed out; service lifts have hazard stripes.
- **Lift cars**: a framed cabin with a roof strip (gold for express), a lit interior, up to three
  riders with their own looks, doors that slide apart while loading.

Under reduced motion nothing moves: screens, drum, gauges, fan, steps, riders, spotlights and the
train hold still (the train waits at the platform).

## Checks

- `tests/e2e/sprint12.mjs`: 8 checks: a tower with every detailed type draws by day and by night
  at zoom 2.2 without a script error, the basement animates, it holds 60 fps with every detailed
  room on screen, reduced motion holds still, and the zoomed-out view still draws cleanly.
- `node tests/run.js`: 80 tests. All earlier browser suites pass.
