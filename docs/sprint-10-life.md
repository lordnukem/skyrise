# Sprint 10: life around the tower (2026-11-28)

Goal: make the world around the tower feel alive, all code-drawn so it scales and follows the
theme. Before and after: `docs/screenshots/s10-before-after.png`; the street up close:
`docs/screenshots/s10-street.png`.

## What changed (`src/life.js`)

- **The sun** crosses the sky on an arc from 06:00 (left) to 19:00 (right), redder and larger
  near the horizon, dimmed by rain and hidden by fog. It replaces the old dawn-and-dusk-only sun.
- **Clouds** drift with a slow parallax: a few in clear weather, a heavy grey cover in rain and
  snow, tinted at dusk, dim at night, faster in wind.
- **Birds**: a loose V of four to eight birds crosses the sky by day every 12 to 37 seconds,
  never in rain, snow or fog.
- **The street behind the tower**: cars, vans and buses in two lanes (headlight beams and tail
  lights at night), pedestrians (with umbrellas in the rain), and trees that sway in the wind.
  How busy it is follows `trafficLevel()`, which has the same shape as the traffic sound:
  busiest at rush hours, quiet at night, busier as the tower grows. The tower stands in front,
  so the street shows in the gaps and beside it.
- **People**: every figure (walkers on their floors, lift queues, the street) now has a skin
  tone, hair (some long), a shirt, trousers and arms that swing with the stride. Queue shirts
  still show stress.
- **Storms**: in the rain, a lightning bolt and a soft sky flash every 14 to 36 seconds, then the
  thunder sound (Sprint 8's `thunder` cue, now wired) about 0.7 s later. The flash is capped at
  22% brightness for photosensitivity. Rain splashes along the ground.
- **Reduced motion**: nothing moves and lightning never flashes.

The life scene keeps moving while the game is paused, like the ambience sound.

## Found on the way

`hash01` in `src/anim.js` returns -1..1, not 0..1 as its name says (a signed XOR). Older
visuals and the Godot port's parity copy depend on it, so it is left alone; `life.js` folds it
into 0..1. A negative radius from it threw on the first frame in the rain.

## Checks

- `node tests/run.js`: 77 tests, including the sun's arc, traffic levels (and that the picture
  and the sound agree on busy and quiet hours), and stable people looks from the palettes.
- `tests/e2e/sprint10.mjs`: 16 checks at 360x740: sun, clouds and street by day, the street
  moving, no sun at night, a lightning strike followed by thunder, heavier cloud in rain,
  reduced motion holding still with no flash, and no script errors in any weather.
- Frame time in headless Chromium with a software GPU: 16.6 ms (60 fps) in clear weather and in
  rain. All earlier browser suites pass.

## Next

Sprint 11, rooms: redraw every room front in one style with more business variety, and replace
the remaining Gemini pictures (skyline, Sky Garden rooftop, sled, logo, app icon).
