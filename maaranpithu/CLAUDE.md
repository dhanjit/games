# Maaran Pithu — Claude notes

A school-field dodgeball: twenty kids, one tennis ball, a referee. Whoever holds
the ball throws it at anyone; a hit puts the target out; a catch keeps you in and
gives you the ball; the ref enforces the air gap (the ball must fly 3 yd before
it hits) and a 3 s holding limit. Last one standing. Top-down canvas, you vs 19
bots, offline. Design spec: `docs/superpowers/specs/2026-09-13-maaran-pithu-design.md`.
Tracker: issue #40.

## Files

| File | Role |
|---|---|
| `rules.js` | **Pure sim, no DOM.** Field, players, ball, referee, bots. `createWorld(opts)` → `step(world, dt, inputsById)` → events. Every balance number is here (`T`, `PERSONAS`). |
| `game.js` | Canvas render, fixed-timestep loop (1/120 s), keyboard/mouse/touch input, HUD, overlays, sounds, SW registration. Reads the world; never mutates it except through `step()`. |
| `audio.js` | Procedural WebAudio sounds, mute pref in `localStorage['maaranpithu.audio']`. |
| `sim/run.mjs` | Balance harness: `node sim/run.mjs --rounds 300 [--set ballSpeed=24] [--persona sniper=reaction:0.5]`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA. Bump `CACHE` in `sw.js` when any cached asset changes. |

## Rules of the repo that bite here

- **Balance is a hypothesis until the harness has run it** (DECISIONS #7). Any
  change to `T` or `PERSONAS` ships with a before/after from `sim/run.mjs` in the
  PR. The first pass (2026-09-13) is in PR #48: ball speed 20 → 24 was the lever
  that moved 15 yd hits from 16% to 51%; nothing tried moves round length.
- Keep `rules.js` importable from Node: no `window`, `document`, `performance`.
- Units are yards and seconds. Screen scaling lives only in `game.js`.
- Query flags: `?bots=N` (default 19), `?bias=1.6` (bots prefer the human),
  `?harness` (no SW, for headless driving).

## Inputs

Keyboard: WASD/arrows run, mouse aims, click throws (or catches when a ball is
incoming), space slides, R restarts, M mutes. Touch: left half is a floating
joystick, right half tap = throw/catch toward the tap, swipe = slide that way.

## Theme

Playground: striped grass, shirt-coloured kids with a drop shadow, a chalk field
line, a black-and-white ref who speaks in comic bubbles, a yellow tennis ball.
Nothing shared with the other games in this catalogue.
