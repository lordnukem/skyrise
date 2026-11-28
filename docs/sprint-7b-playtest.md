# Sprint 7b: playtest pass at phone size (parallel to the Sprint 7 plan in sprint-7-plan.md)

Written 2026-11-27 against `5eaad24` (61/61 node tests, 9/9 and 3/3 Playwright).
Requested by Fadzly: "use the workflow to improve Skyrise", where the workflow is
the studio loop from `studio/README.md`. Play the real build in a phone-sized
browser, screenshot it, fix what a new player trips on, and re-check.

## How it was played

A Playwright script played the first session at 360x740 through the real UI:
it tapped tools and cells, ran the clock at 4x, and screenshotted each step. It
played twice. The first time it was a new player slightly off the guide's path.
The second time it followed the guide's path except for a one-cell gap. The
same build was then checked in the pure sim, where the intended path works:
three offices let within 6 hours and all three guide goals are met.

## What the playtest found, and the fixes

**1. A lift tapped onto the lobby becomes a dead shaft.** The Lift tool on a
lobby cell said "Space is taken" on floor 1. The same tap one floor up then
built a lift standing on the lobby, and that lift can never reach it. Offices
beside it never let. The player had spent $9,350 of the starting $12,000 by
then, and the only sign was the hatching.
- `canPlace` now says "Build the lift beside the lobby, not on it." for lifts,
  stairs and escalators tapped onto a lobby. Other types keep "Space is taken".

**2. Nothing warned before paying for a room with no path.** An office one
cell away from the lift drafted and built with no warning. After 8 game days
nothing had let and the game had taken out a loan.
- New `connectsHere(s, type, col, floor)` in `src/sim.js` asks whether a new
  unit, lift or stairs would reach the lobby. It runs on a throwaway structure
  list and leaves the state alone. Services, slabs and the staff lift are never
  warned about.
- The draft says "No path to the lobby from here. Tap again to build anyway."
  It is kept short because the status line shows two lines and the draft bar
  already shows the price; a longer first wording was cut off at 360 px.
- After building, the status adds "It has no path to the lobby yet."
  Building first and connecting later is still allowed.

**3. The VIP gave a 1-star tower a poor review.** On day 4 the status said
"The VIP left a poor review: no room to stay in." Hotel rooms unlock at 2
stars, so the player could do nothing about it.
- The VIP now calls only when the tower has a hotel room, or holds a good
  review it can lose. A tower that loses its rooms after a good review still
  gets the poor "no room to stay in" review, so the star cap works as before.

**4. Toolbar names cut off.** 15 of the 24 tool names ended in an ellipsis at
360 px ("Foo…", "Hot…", "Esc…").
- Tool buttons allow two lines for the name (11.5 px). The glyph is 18 px on
  every tool so the rows stay even. Horizontal padding is down to 2 px.
- Soft hyphens split the three one-word names too wide for a 320 px button:
  Esca-lator, House-keeping, Demo-lish. The aria-labels keep the plain names.
- Inspect's hint is "details" (was "tap a room", which was cut off).
  Six-figure prices read "$120k" (the Sky Garden's "$120,000" overflowed at
  320 px).

**Also fixed: a flaky test.** The 5b draft test compared `serialize(s)`
before and after a draft tap. `serialize` stamps `savedAt: Date.now()`, so the
test failed whenever the millisecond turned over between the two calls. It now
compares `.state`.

## Checks

- Node (`node tests/run.js`): 63/63. New: the lobby message, and
  `connectsHere` on the lift-on-lobby and one-cell-gap traps. Its answer
  matches what `place()` builds, and asking leaves the state alone. Updated:
  the VIP test now expects no visit to a tower without rooms.
- `tests/e2e/sprint7b-playtest.js` at 360x740: 12/12. It covers the lobby message, the
  draft warning before any money is spent, the after-build message, no warning
  beside the lobby, the warning fitting the status line, every toolbar label
  and price fitting at 320, 360 and 390 px, and no console errors. The
  status-line check was confirmed to catch the first, longer wording.
- `tests/e2e/sprint6.js` 9/9 and `tests/e2e/mood.mjs` 3/3, unchanged.
- Screenshots: `docs/screenshots/s7-no-path-draft-360x740.png`,
  `s7-lift-on-lobby-360x740.png`, `s7-toolbar-labels-360x740.png`.

Save format is unchanged; no new save version.

## Not done

- The longer game: whether 5 stars and the Sky Garden can be reached has
  still not been played or measured. The balance harness does not build sky
  lobbies.
- The sound mix has still not been listened to.
- The queue shiver is still unverified by eye.
