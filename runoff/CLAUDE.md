# Runoff — Claude notes

A portrait tilt game. A few hundred drops of rainwater fall down an alley
between two buildings; ledges on both walls catch and pool them. **Tilting the
phone rotates gravity**, so water can be tipped off a ledge's free end — or
pinned against its wall. The sun descends from above and evaporates whatever it
catches. Score is how deep the water gets. Tracker: issue #87.

**Status: M1 — the thinnest playable slice, live.** One mode (the sun chases),
tilt input with fallbacks, the harness. No hazards, pickups, sound, or ledge
variety yet.

## Files

| File | Role |
|---|---|
| `rules.js` | **Pure engine, no DOM.** `makeWorld` / `step` / `ledgeUnder` / `depthM`. Every tunable in `T`. |
| `game.js` | Canvas render (metaball water), tilt input, camera, HUD, overlays, title attract loop, SW registration. |
| `sim/run.mjs` | Harness: `node sim/run.mjs [--runs N] [--bot none,flip,greedy] [--set key=val]`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA, portrait. Bump `CACHE` in `sw.js` when a cached asset changes. Icons: `node icons/make-icons.mjs` (no deps). |

## The one rule everything hangs off

**Every ledge rises from its wall toward its free tip** (`slopeMin`–`slopeMax`
degrees, steepening with depth). So with gravity straight down, water pools in
the corner against the wall and stays there. Draining a ledge takes tilting
gravity toward its tip by more than its slope; tilting the other way pins it
harder. Left ledges want a right tilt and vice versa, and the harness's `none`
bot — never tilts — dies at ~16 m in every run. That number is the check that
the rule still holds after any geometry change.

Ledges are **capsules** (a segment plus radius `ledgeR`), because
particle-vs-capsule is one closest-point test and a slab 5 u thick can't be
tunnelled at `vmax` 240 u/s × `dt` 1/120 s = 2 u per step. Keep
`vmax · dt < ledgeR + pr` if either changes.

## Water: Clavet double-density relaxation

Clavet, Beaudoin & Poulin, *Particle-based Viscoelastic Fluid Simulation*
(SCA 2005) — position-based, stable at a fixed step, the usual 2-D game liquid.
Per step: viscosity impulses → gravity → predict → relax density on a uniform
grid (counting sort, cell = `h`) → project out of walls/ledges/floor → recover
velocity from positions. Collision response is just the projection.

Stiffness has `dt²` folded in, so **`k`/`kNear` are only valid at `dt` = 1/120**.
Tuned in Node by settling 180 drops and reading nearest-neighbour spacing and
residual speed:

| rho0 / k / kNear | spacing p50 | behaviour |
|---|---|---|
| 3 / 0.35 / 0.7 | 1.55 u | over-compressed — reads as a solid |
| **1.6 / 0.5 / 1** | **2.1 u** | **settles to < 10 u/s in 5 s** |
| 1.6 / 0.8 / 1.5 | 1.95 u | bouncy; splashes over ledge tips at neutral tilt |
| 1.6 / 1.2 / 2 | 2.05 u | still ringing at 5 s; empties ledges on its own |

Cost is ~0.15 ms per step in Node (two steps per 60 Hz frame).

## The sun

`sunY` descends at `sunV0 + sunAccel · (t − sunDelay)`. Linear in *time*: an
earlier depth-keyed version was exponential, a wall rather than a chase. The
camera follows the water's 55th-percentile drop and keeps a sliver of sun in
view when it's close; off-screen, a "☀ N m above" readout.

## Scroll mode was cut (2026-10-08)

M1 shipped a second mode alongside Chase: the player thumb-scrolled the alley
down Instagram-style; the top edge of the view was the sun and the bottom edge
held the water until scrolled. Played on a phone, **Chase felt better and
scrolling while tilting felt weird** — two simultaneous inputs on the one device
you're holding fight each other, and the thumb drag also jolts the tilt. Tilt
is the game, so the competing input went. Its harness numbers did show one
thing worth keeping: stragglers burning off one by one (scroll greedy: 156 →
46 drops between 20 s and 60 s) reads better than Chase's all-at-once wipe. If
attrition is wanted, get it from the sun's shape (a heat band rather than a
hard line), not from a second input. Code is in git history at `3d6adb8`.

## Harness numbers (40 seeds, 2026-10-08)

`none` never tilts; `flip` swings full left/right every 1.2 s, blind; `greedy`
tilts toward the free tip of the highest ledge holding water. Tilt slews at
`maxTilt` per 0.25 s for all bots.

| bot | depth p10 / p50 / p90 (m) | secs p50 | drops @20 s / @60 s |
|---|---|---|---|
| none | 12 / 16 / 22 | 19 | 0 / 0 |
| flip | 190 / 225 / 247 | 79 | 180 / 178 |
| greedy | 178 / 210 / 237 | 76 | 180 / 159 |

`sunAccel` 1.2 was picked to put a *perfect-reflex* bot at ~75–80 s; people
will die sooner. The sun wipes the whole body in a few seconds once it's
faster than the water.

## Known gap: blind waggling wins

**`flip` beats `greedy`.** Rhythmically swinging the phone
left-right drains alternating ledges about as well as reading the screen, and
nothing punishes it — max tilt either way always drains *something* and never
costs water. That's the first thing M2 has to fix, and the harness is the check
(greedy must beat flip). Candidates, cheapest first:

1. **AC-unit exhaust** on the walls under ledge tips: a hot plume that
   evaporates drops passing through. Full tilt drifts falling water `H·tanθ`
   sideways — ~1.4× the drop height at 55° — straight into the far wall's
   plume; a gentle tilt just past the slope drains slower but lands clean. Tilt
   *angle* becomes the skill, not tilt *direction*.
2. **Rooftop water tanks** off the natural path that add drops when hit.
3. Ledge variety (parapets that need a precise angle, awnings that shed
   sideways).

## Input

Target tilt, highest priority first: held key (←/→, A/D) → held pointer →
gyro. Applied tilt slews toward it at `maxTilt`/0.25 s (same as the harness),
with light smoothing on the gyro only.

- **Gyro**: `deviceorientation` `gamma` (adjusted for screen angle) × 1.3,
  clamped to `maxTilt` (55°). iOS needs `DeviceOrientationEvent.requestPermission()`
  inside a tap — the Play button calls it; elsewhere the listener is bound at
  load so the no-sensor hint hides early.
- **Pointer, no gyro**: press and drag sideways; tilt = offset from press
  point over 30% of column width. With a gyro, touches never steer — a thumb
  resting on the glass would pin gravity straight down.

## Rendering

- The alley is a column `T.W` = 100 u wide, `min(100vw, 60vh)` px, centred.
- **Water is metaballs**: each drop stamps a soft sprite (`alpha ≈ (1−r²)²`)
  into a half-resolution buffer, then one pass thresholds alpha at 120 with a
  ±14 ramp (anti-aliased edge), lighter rim band, and a lit top surface where
  the pixel above is empty. Fast drops stamp a trail. Beads read as marbles;
  this reads as one liquid.
- Sun glow below the line uses `lighter` compositing — source-over orange on
  the dark alley went brown.

## Persistence

`runoff.best.chase` — best depth in metres (key name kept from the two-mode
build so existing bests survive). Storage failures are swallowed.

## Query flags

`?harness` — no SW; `window.__ro = { start(seed), world, cam, state,
setTilt(rad), T }` for scripted driving.

## Theme

Post-monsoon city alley at midday: wet slate facades (`#1c2530`), dark glass
windows, concrete chajjas (`#7d8791`), cyan water (`#5ec8f0`), a white-gold sun
(`#fff6d8` → `#ffb13b`). Shares nothing with the other games here.

## Rules of the repo that bite here

- `rules.js` stays importable from Node: no `window`, `document`,
  `performance`, canvas. `node sim/run.mjs` is the check.
- Any change to `T` ships with a before/after harness table in the PR
  (DECISIONS #7/#8).
