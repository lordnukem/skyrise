# Sprint 5 plan: A living tower (G-26-29, G-31, G-34, G-36, G-37-41)

Spec: `docs/FEATURE_GAP.md` Section C, Sprint 5, plus Fadzly's additions (facades, names, demolish, weather, festivals). Written 2026-11-13 against `c485b14` (41/41 node tests).

Tuning numbers go in `src/constants.js`. Name lists and festival dates are data, so they go in two new DOM-free modules, `src/tenants.js` and `src/seasons.js`. G-35 (sound) stays deferred: there is still no audio decision, and every item here reads fine silently.

## Split

| Sub-sprint | Items | Save | Why this order |
|---|---|---|---|
| 5a Your tower | G-37 facades, G-38 names, G-39 demolish, G-34 slots, G-31 tower sheet, G-36 guide | v6 | Mostly UI. Slots and the confirm step protect players before events can destroy things. |
| 5b Sky and seasons | G-40 weather, G-41 festivals | none | Visual only. Must be live before 20 Dec 2026 for Christmas and New Year. |
| 5c Events and endgame | G-26 fires, G-27 VIP, G-28 landmark, G-29 loan | v7 | Moves economy and rating numbers, so it gets one advisor review before editing. |

## 5a design

**G-37 Facades.** Each let unit shows the business of its current tenant. Every facade is code-drawn from four parameters: a tint (the type token mixed with up to 15% of an accent), an awning (`stripe`, `flat`, `noren` or `none`), a sign glyph (at most 6 shapes, 8-10 world px) and a window pattern.

There are 23 variants:
- **Shop (8):** sushi bar (noren), Italian, Indian banana-leaf, noodle house, kopitiam café, gym & pilates, florist and bookshop. Shops are the most visible units, so they get the most variants.
- **Office (4):** tech studio, law firm, bank branch and design agency.
- **Flat (4):** they differ by curtain colour and by a balcony plant or bicycle.
- **Others:** food court 3, hotel 2 and hall 2.

Every variant has the same economy. Service and transport types keep one look.

The pick is `h = hashInt(st.id, st.tenant)`, built on `hash01` from `anim.js` (which is DOM-free), and the business is `BUSINESSES[type][h % n]`. Because the pick is deterministic, it never flickers and it survives a reload. `st.tenant` is saved and goes up by 1 each time the unit fills, so a new tenant can bring a new business. A vacant unit keeps today's dim "to let" shell, with no sign.

**G-38 Names.** `src/tenants.js` lists about 8 hand-written names per business, for example "Kumar's Curry House", "Yen's Kitchen" and "Strong Viking Gym & Pilates". The mix is Malay, Chinese, Indian and playful, with no real brands: about 64 shop names and 32 office names. Other types use patterns:
- Flats are "The {surname} family", from 24 surnames.
- Food courts are "Medan Selera {floor}".
- Hotel rooms are "Room {floor}{nn}".
- Halls draw from a list of 4 names.

`nameOf(st)` returns `st.name` when it is set, otherwise `names[(h >>> 8) % len]`. Two units may share a name.
- **Rename:** the card action "Rename" swaps the title for an inline `<input maxlength=24>` with Save and Cancel (not `prompt()`). Enter saves, Escape cancels, and saving an empty name brings back the generated one. Input is trimmed, its whitespace collapsed and control characters stripped. Names are drawn only through `textContent` and `fillText`, never `innerHTML`.
- **Shown:** the card title is the name and the first row is "Shop, floor 4". The facade's sign strip shows the name only at `cam.zoom >= NAME_ZOOM` (1.6), only for units that are on screen, and truncated to fit. Text widths are cached in a Map of up to 256 entries, keyed by name and zoom bucket.
- **Saved:** `st.name` is a string of up to 24 characters, or null. It belongs to the tenant and is cleared when they move out.

**G-39 Demolish.** Long-press demolish exists today (`src/main.js:210-221`), with no confirm and a half refund. 5a adds a `demolish` tool and sends both paths through one confirm card.
- **Confirm card:** a tap or long-press selects the structure and opens "Demolish Kumar's Curry House?". Its rows show the refund, the tenants who would leave and the units that would lose their path. The actions are **Demolish** (danger style) and Keep.
- **Tap guard:** Demolish ignores taps for `CONFIRM_ARM_MS` (400 ms) after the card opens, so a double tap cannot land on it. No canvas gesture can demolish on its own.
- **Repeat use:** the tool stays selected, so removing several things takes two taps each.

A new pure `previewDemolish(s, id)` returns `{ ok, reason, refund, evicted, cut }`. It finds `cut` by running `reachable` without the structure.

Rules:
- **Refund:** `round((cost + extraCars x LIFT_CAR_COST) x REFUND_RATIO)`. Today the cars on a demolished lift cell are lost without a refund.
- **Sold flat:** refunds $0, because the owner paid for it. This closes an exploit I reproduced: build, sell and demolish nets +$1,600 per flat each cycle (cost 2000, sale 2600, refund 1000).
- **Tenants:** they leave at once, and hotel guests leave without paying. They are not counted in "Moved out", which measures unhappiness. The toast says "4 people moved out".
- **Stairs and lifts that serve it:** untouched. If a transport piece is removed, the units it served become unreachable and vacate under the existing rule. The card warns first: "3 units lose their path to the lobby".
- **Cutting a shaft in half:** above ground this already cannot happen, because "Something is built on top" forces a shaft to come down from the top. Below ground it can happen today: I removed the middle cell of a B3-B1 shaft and got two shafts. New rule: a lift cell with cells of the same shaft both above and below it is refused with "Take a shaft down from its top or bottom".
- **Basement:** dug levels stay dug, with no filling in (Sprint 4). A basement room may still be removed under floor-1 rooms, because the ground carries floor 1. That is today's rule.
- **Other refusals:** the last ground lobby can still never be removed. 5c adds "while burning", so nobody can claim a refund on a unit that is about to burn.

**G-34 Slots.** There are three slots: `skyrise.save.1` to `.3`, with `skyrise.slot` holding the active one. The old `skyrise.save` moves into slot 1, once, and autosave writes the active slot.
- **Towers sheet:** a new menu sheet lists each slot (stars, day, cash, saved time) with Load, Save here and Delete (with a confirm).
- **Export:** downloads a `Blob` named `skyrise-YYYY-MM-DD.json`.
- **Import:** an `<input type=file accept=.json>` reads the file through `deserialize`. If that returns null, it says "Not a Skyrise tower file". Otherwise it asks to confirm, then loads the tower into the active slot.

**G-31 Tower sheet.** It opens from a tap on the stars or from "Tower" in the menu. It shows:
- population by type, and units let out of units built;
- the needs for the next star, each ticked or missing, from a new pure `starNeeds(s)` built on `STAR_POP`, `STAR_REQUIRES` and the strain and reach penalties;
- a 120x315 mini map (3 px per cell, in type tokens), repainted only while the sheet is open.

**G-36 Guide.** A new pure `guideGoals(s)` returns three booleans:
1. a shaft from floor 1 serves floor 2 or higher;
2. 3 offices are let;
3. one unit is at Good happiness.

A dismissable banner shows the first goal not yet met. Only the dismissal is stored, in `skyrise.guide`, which is per device and not in the tower save.

## 5b design (visual only; no sim or save change)

**G-40 Weather.** `weatherAt(tick, festivals)` is a pure function in `src/seasons.js`. Weather changes in blocks of `WEATHER_BLOCK_HOURS` (6).
- **Daily front:** each game day gets a front, picked from `hash01(day)` by `WEATHER_WEIGHTS` (clear 50, rain 25, wind 13, fog 12). Each block either takes the front or is clear.
- **Fog** happens only from 04:00 to 10:00.
- **Snow** happens only while `christmas` is active, and it replaces rain. In a tropical city it reads as festive, not as climate.
- **Rain and snow:** up to 90 screen-space streaks or 60 flakes, from fixed pools moved by `dt`.
- **Wind** slants the rain and sways the lamp glow and the aerials.
- **Fog** is one cached gradient over the structures, so lit windows still show through.
- **Tone and cache:** rain and fog darken the tones. Weather joins `toneKey`, so the cached background repaints only when the weather changes.
- **HUD:** the clock gets a weather word.
- **Reduced motion:** no particles, only the tint and the fog.

**Gameplay effect: none (decision).** Happiness, wait and fill are tuned and tested over four sprints. A random weather modifier would move happiness with nothing the player can do about it, would make the oracle and rating tests depend on weather, and is a number feeding several places (advisor review). `weatherAt` is pure, so a later sprint can add a small effect, such as rain sending visitors to shops, without renderer work.

**G-41 Festivals.** `festivalsOn(date)` is a pure function in `src/seasons.js`. It reads the device's local year, month and day. `main.js` reads `new Date()` at load and every 60 s, and passes the festival ids to the renderer and to `weatherAt`.

**Dev overrides** for testing, parsed once in `main.js` and harmless in production: `?date=YYYY-MM-DD`, `?festival=cny,raya|none` and `?weather=rain|snow|fog|wind|clear`.

| id | Window | Drawn (code unless noted) |
|---|---|---|
| `newyear` | 31 Dec-1 Jan | Fireworks above the tower top, 20:00-01:00 game time |
| `christmas` | 20-26 Dec | `santa-sled.png` crosses once each game night (21:00-23:00); parapet string lights; snow |
| `cny` | day -1 to +4 | Red lanterns at the lobby and every 4th parapet cell; fireworks on night 1 |
| `raya` (Aidilfitri) | day 0 to +2 | Ketupat at the lobby; pelita lamps on parapets at night |
| `deepavali` | day -1 to +1 | Diya lamps along the parapets; small sparkler bursts |
| `merdeka` | 30 Aug-1 Sep, 16 Sep | Jalur Gemilang on the highest roof cell (14 stripes, canton, crescent and star at zoom 1.5 or more, 7 stripes below that); fireworks on 30 Aug |

- **Lunar dates:** a table covers 2026-2030. CNY falls on 2026-02-17, 2027-02-06, 2028-01-26, 2029-02-13 and 2030-02-03. Aidilfitri and Deepavali depend on moon sighting and the gazette, so **an agy research pass must check them against Malaysia's public-holiday list before 5b ships**. After 2030 the lunar festivals switch off, and the fixed-date ones keep working.
- **Overlaps** draw together, for example CNY on 13 Feb and Raya around 14 Feb 2029.
- **Greeting:** a toast ("Selamat Hari Raya!", "Gong Xi Fa Cai!") shows once per day per device, recorded in `skyrise.greeted`.
- **Frame rate:**
  - Decorations are drawn only on parapet cells (already visited through `info.topMask`) and the lobby, both already culled.
  - Fireworks use a fixed pool of 96 particles, with at most 3 bursts at once.
  - The sled is one `drawImage` per frame.
  - There is no `shadowBlur`: glows are `globalAlpha` arcs.
  - Nothing allocates per frame.
  - Under reduced motion the decorations are static, with no fireworks and no sled.

## 5c design (advisor review before editing)

**G-26 Fires.**
- **Start:** each tick, a tower with at least `FIRE_MIN_UNITS` (8) let units has a `FIRE_CHANCE` (0.004) of a fire. It starts in one random let unit, picked with the injected `rng`.
- **Burning:** `st.fire` counts the hours (saved). The tenants are out and there is no income.
- **Put out:** a reachable security office in range puts it out after `FIRE_OUT_TICKS` (2). Tenants come back, minus `FIRE_SCARE` happiness.
- **Burnt:** with no security in range, the unit becomes `burnt` (saved) after `FIRE_BURN_TICKS` (6). It is a shell that cannot be let. The shell stays because it may hold up the floors above.
- **Repair:** the card offers Repair for `REPAIR_RATIO` (0.5) of the cost. Demolishing a burnt unit refunds $0.
- **Shown:** a code-drawn flame and smoke, and the toast "Fire on floor 12". Fires do not spread.

**G-27 VIP.** A VIP visits once a quarter (day 4, 20:00).
- **Review:** good if the happiest reachable clean hotel room is at `HAPPY_GOOD` or above. A tower with no such room gets a poor review: "No room to stay in". Saved as `s.vip = { review, quarter }`.
- **Star gate:** `STAR_REQUIRES[4]` gains `'vip'`, and `refreshDerived` adds `'vip'` to `s.facilities` while the review is good, so `computeRating` does not change. A poor review later loses the star.
- **Old saves:** a save already rated 4 or more loads with a good review.

**G-28 Landmark.** An original "Sky Garden": type `landmark`, 12x6 cells, sprite `landmark-rooftop.png`.
- **Placement:** one per tower, unlocks at 5 stars. Its bottom must be at floor `LANDMARK_MIN_FLOOR` (60) or higher, with support under all 12 columns. Nothing can be built on it.
- **Cost:** `LANDMARK_COST` is 60000, with upkeep 30, and it brings 40 visitors.
- **Crown:** a reachable landmark at 5 stars crowns the tower. The HUD shows a crown, and a win sheet shows once (`s.wonAt`, saved).

**G-29 Loan.**
- **First time:** a quarter that ends below $0 with no loan open takes out a loan of `LOAN_AMOUNT` (20000), with `s.loan.owed` at 1.2 times that.
- **Repaying:** `LOAN_REPAY_SHARE` (25%) of each positive hourly net goes to the loan, shown on a report row "Loan".
- **Game over:** a quarter that ends below $0 with a loan open sets `s.over` (saved) and stops `stepTick`. A sheet offers "Load a tower" or "New tower".

## Art (agy; follow the "agy prompt spec" in `docs/FEATURE_GAP.md`)

4 new images. Everything else is code-drawn: 23 facades and their glyphs, names, weather, fireworks, lanterns, ketupat, pelita, diya, the flag, fire, the mini map and the guide.

| File | Size | Palette tokens (max 4) | Note |
|---|---|---|---|
| `assets/art/icon-demolish.png` | 256x256 | danger, body `#3a4250`, accent `#f6b73c` | wrecking ball on a chain (5a) |
| `assets/art/santa-sled.png` | 192x64, drawn at 96x32 CSS px | danger, accent, body, light `#ffd784` | sled and 2 reindeer silhouettes, keyed transparent, must read on a night sky (5b) |
| `assets/art/icon-landmark.png` | 256x256 | plant `#9a9c86`, glass `#b7dcf7`, accent, body | stepped rooftop garden (5c) |
| `assets/art/landmark-rooftop.png` | 288x192 (12x6 cells) | glass, plant, body, light | night glow in light; must not depend on the sky behind it (5c) |

The spec's danger value (`#c2410c`) differs from `styles.css:34` (`#b4350a`). Keep the spec value for art, as in earlier sprints. If the code-drawn sign glyphs fail the read check at zoom 1, the fallback is a fifth image: a 256x32 strip of 8 glyphs, 32x32 each.

## Save versions

- **v6 (5a):** structures gain `tenant` (an integer, 0 or more, default 0) and `name` (a string of up to 24 characters, otherwise null). Both are validated on load, since imported files are untrusted. `deserialize` accepts 1-6.
- **5b: no change.** Weather is derived from `tick` and festivals from the device date, so neither is saved. The guide dismissal, greetings and active slot are separate localStorage keys.
- **v7 (5c):** structures gain `fire` (0) and `burnt` (false). The state gains `vip`, `loan` and `wonAt` (null), `over` (false), and there is a new type, `landmark`. `deserialize` accepts 1-7, and older saves get the VIP grandfathering.

## Exit tests

Playwright runs at 360x740 against a server started after the edit. Every check also asserts `scrollWidth <= 360` and no console errors.

| Sub-sprint | Node (`node tests/run.js`) | Playwright 360x740 |
|---|---|---|
| 5a | (1) `tenantOf` is stable for the same id and tenant; 200 shops give at least 6 businesses; a refill raises `tenant`. (2) A rename survives a JSON round trip; a name over 24 characters, or not a string, loads as null; a v5 save loads with `tenant` 0 and `name` null. (3) The refund is half the cost plus half the cars; a sold flat refunds 0; the middle basement lift cell is refused; `previewDemolish` lists the units cut off when their only lift goes. (4) With a stub localStorage the three slots stay isolated, the old key moves to slot 1 once, and Delete clears only its slot. (5) A garbage import returns null. (6) `guideGoals(newGame())` is all false and each goal turns true once met. | (1) Inspecting a shop shows its generated name as the title, and a rename to "Yen's Kitchen" survives a reload. (2) A demolish-tool tap opens the card with the structure count unchanged; Keep changes nothing; Demolish removes it and adds the refund; a long-press opens the same card. (3) At zoom 2 the facade sign shows: `docs/screenshots/s5a-facades-360x740.png`. (4) The tower sheet lists missing needs, and the mini map has pixels. (5) A fresh localStorage shows guide goal 1. (6) An exported download imports back with the same tick and cash. |
| 5b | (1) `weatherAt` is stable, constant within a block, within 3 points of each weight over 10,000 days, and never snows without `christmas`. (2) `festivalsOn` finds 25 Dec, 31 Dec, 31 Aug and 2027-02-06 and returns [] on 3 Jul; the table covers 2026-2030. (3) `serialize` output has no weather or festival keys. | (1) `?weather=rain` gives `renderer.debug.particles > 0`. (2) `?date=2026-12-31` at 22:00 shows fireworks, and `?date=2027-02-06` lists `cny`; screenshot both. (3) The median frame is 20 ms or less over 3 s with rain and fireworks. (4) Emulated reduced motion gives 0 particles. |
| 5c | (1) A seeded fire goes out within `FIRE_OUT_TICKS` with security in range, and is otherwise `burnt` after `FIRE_BURN_TICKS`; Repair lets the unit again; a burning unit cannot be demolished. (2) The VIP review uses the best room's happiness; 4 stars is refused without a good review; a grandfathered v6 save keeps 4 stars. (3) The first quarter below $0 brings a loan, and the second sets `over`. (4) The landmark is refused below 5 stars, nothing builds on it, and a reachable one at 5 stars crowns the tower. (5) A v6 save loads. | (1) A forced fire draws a flame and the toast. (2) A forced `over` shows the game-over sheet. (3) The landmark sprite is drawn: `docs/screenshots/s5c-landmark-360x740.png`. |

## Decisions (recommendations)

- **Order: 5a, then 5b, then 5c.** 5b is cheap and needed by Christmas. 5c waits for the advisor review (rating, economy, migration).
- **Facades:** 23 code-drawn variants with the same economy. Numbers per business would be a tuning pass with no gameplay purpose yet.
- **Business and name** follow (id, tenant), not id alone, so turnover shows. A custom name is cleared when its tenant leaves; keeping it instead is one line.
- **Rename** uses an inline input, because `prompt()` looks foreign on phones. `confirm()` stays for New tower and Delete slot.
- **Demolish:** keep the 50% refund, refund lift cars, and refund $0 for a sold flat. Long-press goes through the confirm card too. No undo.
- **Basement:** levels cannot be filled in, and shafts come down only from an end.
- **Weather** is visual only, and snow falls only at Christmas.
- **Festivals** follow the device date, not game time: they are real-world greetings, and a game quarter is 7 days. Thaipusam, Wesak, Gawai and Kaamatan can be added later as table rows.
- **Fires** do not spread, and a burnt unit stays as a shell (support safety).
- **Pests** (deferred from G-16) are deferred again to Sprint 6: they need their own tuning, and dirty rooms already cost income.
- **VIP:** the gate goes through `s.facilities`, so `computeRating` stays unchanged.
- **Saves:** two bumps (v6, v7), because 5a and 5c ship to live players separately. The alternative is to reserve the 5c fields in v6: one bump, but fields that sit unused for weeks.
- **Sound** stays deferred.

## Risks

- **Festival dates:** the Raya or Deepavali dates could be wrong. Mitigations are the agy research pass, the table-coverage test and checks with `?date`. A wrong device clock only shows the wrong festival, which is harmless.
- **Canvas text:** drawing names at high zoom over many units costs frame time. Mitigations are `NAME_ZOOM`, the width cache and the frame-budget test.
- **Name tone:** no stereotypes and no real businesses. Fadzly reviews `src/tenants.js` before 5a ships.
- **Flag:** an inaccurate Jalur Gemilang would be noticed. Check it by eye at zoom 1 and 1.5.
- **localStorage:** 3 slots plus autosave share about 5 MB. Saves are far smaller today, but quota errors must stay inside the guarded `store()`.
- **Imports** are untrusted. `deserialize` validates them, names are checked, and names never reach HTML.
- **VIP gate:** without the grandfathering, live towers would drop a star when they load.
- **Fire pacing:** at 4x speed, fires may feel too frequent. `FIRE_CHANCE` gets tuned with the advisor.

## Fadzly's answers (2026-11-13)

- **Q1:** a tenant moving out clears that unit's custom name; the generated name rule stays.
- **Q2:** a sold flat refunds $0; every other structure refunds half, extra lift cars included.
- **Q3 (5b):** snow only in the Christmas window; weather has no gameplay effect.
- **Q4:** order is 5a, 5b, 5c.
- **Q5 (5c):** a quarter ending below $0 forces a loan first. Game over only if cash is still below $0 at the end of the next quarter too.

## 5a build decisions

- **Hotel guests are not tenants:** a room's `tenant` does not move with check-ins and its name ("Room {floor}{col}") is never cleared; any room can be renamed.
- **Rename** is offered on let units and hotel rooms. A vacant unit's card title is "Shop to let", with no name.
- **Sign names** are drawn on shops, offices, food courts and halls only; flats and hotel rooms are too many and too small.
- **Glyphs:** 12 code-drawn (8 shop, 4 office); food courts reuse three shop glyphs, flats use a balcony item.
- **Cut off** counts units and service rooms that lose their path. Evicted counts the structure's own people (or guests).
- **Slots:** "Save here" also makes that slot active. The active slot has no Delete (New tower clears it). Load saves the current tower to its own slot first. The old key moves only into an empty slot 1 and is removed only after the copy.
- **Save decision:** v6 adds `tenant` and `name`. A demolished structure is simply removed (no tombstone). The active slot (`skyrise.slot`) and the guide (`skyrise.guide`) are separate keys, never in a tower file.
- **Guide:** goal 1 needs the shaft's floor-1 cell reachable. Meeting all three goals stores the dismissal too.
- **Tests:** the Sprint 1 storage test now corrupts `skyrise.save.1`, because autosave moved there.
