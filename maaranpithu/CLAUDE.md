# Maaran Pithu — Claude notes

A school-field dodgeball: twenty kids, one tennis ball, a referee. Whoever holds
the ball throws it at anyone; a hit puts the target out; a catch keeps you in and
gives you the ball; the ref enforces the air gap (the ball must fly 3 yd before
it hits) and a 3 s holding limit. Last one standing. Top-down canvas, you vs 19
bots, offline. Design spec: `docs/superpowers/specs/2026-09-13-maaran-pithu-design.md`.
Tracker: issue #40.

## The ball has height

`z` is yards above the grass and gravity (`T.gravity`) brings it down. Two throws:

| | speed | up | lands | flight | over heads |
|---|---|---|---|---|---|
| **line** | 26 yd/s | 3.2 yd/s | 22.3 yd | 0.86 s | never — apex 1.68 yd, under the 1.85 yd strike top |
| **lob** | 19 yd/s | 5.5 yd/s | 23.1 yd | 1.21 s | 2.6 → 16.9 yd, apex 2.6 yd |

A throw only hits when the ball's **underside is at or below `T.kidHeight`**
(`b.z - T.ballR <= T.kidHeight`), so a lob sails over anyone standing in between
and only bites in the band where it comes back down.

**A ball that has bounced is dead.** The first ground contact turns the ball
`loose`, and only a ball in `flight` ever reaches `contact()` — so the rule needs
no flag: a dead ball cannot put anyone out and cannot be caught, only picked up
(and `pickup` needs `b.z <= T.pickupZ`). The loose ball keeps its height physics,
hopping with `bounceRestitution` / `bounceKeep` until a hop is slower than
`bounceStopVz`, then rolls off `ballFriction`. `throwArc(kind)` derives a throw's
range and its over-the-heads band from `T`, so bots and the sim never hard-code
a distance; `threat(w, p)` reads the arc and is shared with the renderer's tell.

## Animation

Kids, the ref and the grass are animated entirely in `game.js`. The sim is
untouched: rendering reads the world and never writes to it.

**Render-only state** lives in `animStore`, a `WeakMap` keyed by *world* and then
by player id (plus `'ref'`) — `animOf(w, key)` → `{phase, spd, lx/ly, throwT, sit, …}`.
Keying by world means a new round (a new `createWorld`) starts from a clean slate
and the how-to demos, which are their own two-kid worlds reusing ids 0/1, never
collide with the round.

- **Stride** phase advances with *ground covered* (`STRIDE_YD` per cycle), so a
  6 yd/s sprint and a 1.5 yd/s ball-holder shuffle read as different gaits with
  nothing passed in. Amplitude comes off `p.vx/p.vy`: deriving speed from the
  distance between two renders does **not** work, because `render()` runs every
  rAF while the world only moves on a 1/120 s step, so the frames in between
  measure zero and the pace decays to nothing.
- **Poses** are read off the world — `p.bracing` (arms out, feet planted),
  `p.slideT` + `p.slideDir` (squash, stretched along the slide, dust off the
  streak fx), `b.holder`/`b.heldFor` (clutch, then a hand cocked back that the
  held ball rides), `b.thrownAt`/`b.thrower` (a latched 0.25 s whip-forward),
  `p.out` + arrival at `p.outTarget` (sit down on the sideline). No new events.
- **The head turn** toward a ball in flight is a lerped render-only vector;
  `p.facing` belongs to the sim and decides catches, so it is never touched.
- **Grass wear** is an offscreen 2 px-per-yard canvas stamped where feet fall
  each frame and drawn back scaled up under the chalk. It clears when the world
  identity changes, and only the main scene gets it.
- `prefers-reduced-motion` scales `MOTION`, which damps the bob, the foot lift
  and the dust — never the poses.

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
  The height pass (#52) cost 24 → 26: a 22 yd throw at 24 yd/s has to arc 1.84 yd
  up, which would sail over every kid in the 4–13 yd band. Speed and the strike
  ceiling trade off directly — (speed, kidHeight) pairs that land a flat 22 yd
  line are 24/1.84, 25/1.74, **26/1.70**, 27/1.60.
- Keep `rules.js` importable from Node: no `window`, `document`, `performance`.
- Units are yards and seconds. Screen scaling lives only in `game.js`.
- Query flags: `?bots=N` (default 19), `?bias=1.6` (bots prefer the human),
  `?harness` (no SW, for headless driving). `?harness` exposes
  `window.__mp = { world(), state(), touch(), mouse, charge, view }` — `mouse`
  and `charge` are there so a scripted `PointerEvent` can drive a real throw and
  you can assert which arc came out.

## Inputs

Keyboard: WASD/arrows run, mouse aims, space slides, Esc or P pauses, R restarts, M mutes.

**Throwing is press-and-release, and only while you hold the ball**: a flick
(< `LOB_MS`, 200 ms) throws a line, a longer hold lobs, and Shift+click lobs
straight away. A charge bar over your head fills to a gold **LOB**. When you
*don't* hold the ball the same held button (or C) braces to catch instead —
stand still, face the ball, ±75° cone — so the two never collide.

Touch: left half is a floating joystick; on the right half a tap throws a line
toward the tap, and a hold is a lob when you hold the ball and a brace when you
don't; swipe = slide that way.

## How-to demos

The five demos on the how-to screen are real two-kid worlds from `rules.js`
driven by a script (`DEMO_DEFS` in `game.js`), drawn with the same code as the
round via `drawScene()`, which swaps the module draw targets. A demo therefore
can't show a rule the sim doesn't have; when a rule changes, the demo follows.
A demo may set its own `win` (the lob one needs a 32 × 12 yd window and spans
both grid columns via `.demo.wide`).

## Theme

Playground: striped grass, shirt-coloured kids with a drop shadow, a chalk field
line, a black-and-white ref who speaks in comic bubbles, a yellow tennis ball.
Nothing shared with the other games in this catalogue.
