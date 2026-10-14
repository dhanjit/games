# Runoff — Claude notes

A portrait tilt game. The last of the monsoon rain pours out of a gutter onto
a hill town and runs down terraces of lean-to tin roofs. **Tilting the phone
rotates gravity**, which decides which way each roof sheds its water. Every
roof drops onto one of two roofs below, so the way down is a tree of paths.
The sun descends from above and evaporates whatever it catches. Score is how
deep the water gets. Tracker: issue #87; the branching town is #90, the
power-ups #92.

**Status: M3 — power-ups.** One mode (the sun chases), tilt input with
fallbacks, three pickups (rain barrel, cloud shade, downpipe), the harness
with a lattice-reading bot. No sound, and no meta progression (cosmetics)
yet.

## Files

| File | Role |
|---|---|
| `rules.js` | **Pure engine, no DOM.** `makeWorld` / `step` / `houseAt` / `bulk` / lattice helpers / `depthM`. Every tunable in `T`. |
| `game.js` | Canvas render (backdrop, town, metaball water), tilt input, 2-D camera, HUD, overlays, title attract loop, SW registration. |
| `sim/run.mjs` | Harness: `node sim/run.mjs [--runs N] [--bot none,flip,planner] [--set key=val]`. |
| `sim/bots.mjs` | The harness's tilt policies. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA, portrait. Bump `CACHE` in `sw.js` when a cached asset changes. Icons: `node icons/make-icons.mjs` (no deps). |

## The town: a lattice of lean-to roofs

Row r has its roof centres at `y = Y0 + r·DY`; house c of that row stands at
`x = (c + (r&1)/2)·DX`. Rows are staggered by half a house, so each house has
two children (`childrenOf`), and each eave sits over one of them, 5 u from its middle.
Each slot is decided by a seeded hash of (r, c), memoised in `houseAt`:

- **ROOF** — single-pitch, sloping one way (`dir`). Water leaves by the low
  eave. Tilt gravity against the slope by more than its pitch (14° at the top,
  climbing toward 26° over 40 rows) and it leaves by the high end instead:
  that's the lane change. 18% carry a **parapet** at the low end, which pools
  water until it's tipped back uphill.
- **TANK** (12%) — an open cistern as wide as a roof. Holds everything at
  neutral tilt; a full 55° tilt sloshes most of it out but always leaves a
  share behind. Never two side by side, so every roof has a child that isn't a tank.

The first three rows are plain roofs. The spout's roof, (0, 0), also gets a
parapet at its *high* end: the spout pours faster than a roof drains, and
without one the pool spills both ways before the player has touched anything.

Three geometry rules, each learned the hard way (2026-10-13):

1. **No gables.** A ridge is a knife-edge: a stream landing near one splits,
   however it was aimed. Any landing on a lean-to drains one way.
2. **No gaps in a row** — only a 10 u drain slot between neighbours (a slot
   under 2·(roofR + pr) = 6.8 u closes). With gaps, a hard tilt flung water
   past whole rows. That made blind full-tilt waggling the fastest way down,
   and `flip` beat the planner (157 m to 115 m, 12 seeds).
3. **Streams fall straight.** Off an eave, water keeps ≤ 50 u/s along a roof
   (`slideMax`), and falling water (vy > `fallV`) loses sideways speed to
   `airDrag`. Without both, a stream sails ~20 u past its child, lands near
   the child's high end, and its momentum carries part of it over that end
   the wrong way. Proportional friction was tried first: it stalls the
   one-drop film a pour leaves on a gentle roof.

## Power-ups

Pickups are seeded per house like everything else (`houseAt`'s `loot`), never
on the first three rows. They're taken when five drops are over one at the
same time. Each one sits next to danger, so it pays to read the fork above it:

| Pickup | Where | Effect |
|---|---|---|
| **Rain barrel** (`BARREL`) | Roof beside a tank (`pLoot`, split with shade) | +`barrelDrops` (30) drops on the roof |
| **Cloud shade** (`SHADE`) | Roof beside a tank, like a barrel | Sun stands still `shadeTime` (3 s): `sunT`, the sun's own clock, stops |
| **Downpipe** (`PIPE`) | Roof with a tank below it (`pPipe` 0.15), whose outlet `pipeRows` (3) rows down isn't a tank | Water leaving the low eave comes out of the outlet; never used up |

- **Beside a tank** means the fork above a barrel or shade is
  pickup-or-tank. A reader takes the pickup; a waggler gets the tank half the
  time. The first placement put shades on parapet roofs, and pickups made
  `flip` win (240 m vs planner 217 m). Waggling escapes parapets anyway, so
  a parapet shade was free for it.
- **Barrels are the strongest skill reward**, because of that fork. Pipes
  help blind play about as much as reading, so they're the rarest. A 20-seed
  sweep, median flip / planner m:

  | Setting | flip / planner |
  |---|---|
  | Barrel 20, pipe 0.25 | 123 / 150 |
  | Barrel 30 | 116 / 199 |
  | Pipe 0.15 | 109 / 149 |
  | No pipes | 105 / 145 |
  | Shade 2 s | 123 / 165 |
- A barrel's drops are laid at rest spacing; pipe arrivals are fanned out.
  Drops set on top of each other detonate (see the spout). Worlds hold up
  to `cap` (360) drops.
- `world.events` gets `{kind: 'barrel' | 'shade' | 'pipe', x, y}` per pickup
  (a pipe at most once a second); the host turns them into call-outs and
  must drain them, as the harness does.

`bulk(world)` is the leading clump: the lowest 3×3 block of (DX/2 × DY) bins
holding at least a fifth of the live drops. The camera and the planner both
follow it. The biggest clump was used first, and both waited on a remnant
stranded in a tank.

## Water: Clavet double-density relaxation

Clavet, Beaudoin & Poulin, *Particle-based Viscoelastic Fluid Simulation*
(SCA 2005) — position-based, stable at a fixed step, the usual 2-D game liquid.
Per step: pour from the spout → viscosity impulses → gravity (+ air drag on
falling water) → predict → relax density → project out of capsules, capping
slide speed → recover velocity from positions.

- **Neighbour grid is a spatial hash** (4096 buckets, cell = `h`), since the
  world is unbounded sideways. The 3×3 neighbour buckets are deduplicated:
  two cells can hash to one bucket, and visiting it twice double-counts
  density.
- **The water arrives through a spout**: a row of 3 drops every 5 steps,
  ~2 u apart at rest spacing, over the first ~2.5 s (`world.pending` counts
  the rest). A block placed at random detonates: pairs that start almost on
  top of each other blow the near-pressure up. A block dropped from a height
  splashes across the town.
- Viscosity impulses are capped at stopping a pair's approach; past that a
  high viscosity overshoots and flings pairs apart.
- Stiffness has `dt²` folded in, so **`k`/`kNear` are only valid at
  `dt` = 1/120**. Rest density 1.6 / k 0.5 / kNear 1 settles drops ~2.1 u
  apart (tuned in M1).
- Collisions are capsules (roof slabs, parapets, tank walls), one house per
  row checked per drop. Keep `vmax · dt < roofR + pr` or drops tunnel.

Cost is ~0.4 ms per step in Node (two steps per 60 Hz frame).

## The sun

`sunY` descends at `sunV0 + sunAccel · sunT`, where `sunT` is the time since
`sunDelay` not spent in a cloud's shade. Linear in *time*: an
earlier depth-keyed version was exponential, a wall rather than a chase. Water
moves slower down terraces (a roof is crossed, not fallen past), so `sunAccel`
is 0.6, down from M1's 1.2.

## Harness numbers (40 seeds, 2026-10-14, with power-ups)

`none` never tilts. `flip` swings full left/right every 1.2 s, blind.
`planner` reads the lattice: it counts the water resting on each roof and
tank, and picks the tilt (21 candidates) that sends the most of it somewhere
good, looking 4 rows down the tree. It values barrels (+20) and shades (+15)
and follows downpipes. Tilt slews at `maxTilt` per 0.25 s for all bots.

| bot | depth p10 / p50 / p90 (m) | secs p50 | drops @20 s / @60 s |
|---|---|---|---|
| none | 19 / 33 / 60 | 35 | 180 / 0 |
| flip | 82 / 121 / 200 | 77 | 208 / 45 |
| planner | 105 / **172** / 280 | 106 | 210 / 179 |

Before power-ups (M2): none 31 m, flip 73 m, planner 98 m. **The
screen-reading lead grew from +25 m (34%) to +51 m (42%).**

Runs got longer: the planner went from 64 s to 106 s, and flip from 54 s to
77 s. If that drags in play, raise `sunAccel` to shorten runs. Re-check the
lead in the harness afterwards: in M2, a gentler sun (0.5 vs 0.6) narrowed
it. The planner isn't perfect: it still lands in tanks sometimes, so people
should die sooner.

## Input

Target tilt, highest priority first: held key (←/→, A/D) → held pointer →
gyro. Applied tilt slews toward it at `maxTilt`/0.25 s (same as the harness),
with light smoothing on the gyro only.

- **Gyro**: `deviceorientation` `gamma` (adjusted for screen angle) × 1.3,
  clamped to `maxTilt` (55°). iOS needs `DeviceOrientationEvent.requestPermission()`
  inside a tap — the Play button calls it; elsewhere the listener is bound at
  load so the no-sensor hint hides early.
- **Pointer, no gyro**: press and drag sideways; tilt = offset from press
  point over 30% of `colW` (min(100vw, 60vh)). With a gyro, touches never
  steer — a thumb resting on the glass would pin gravity straight down.

## Rendering

- **View**: 120 u across on a phone, so the roof the water is on and both
  roofs below it fit; on a wide screen, as wide as keeps 240 u in view. The
  camera follows `bulk()` with the water 30% down the screen, leans toward
  the roof it's headed for, and keeps a sliver of the sun in view when it's
  close; off-screen, a "☀ N m above" readout.
- **Only the way down is shown** (asked for 2026-10-13: "I don't need the user
  to see the entire hill — only the current path and local things; he may want
  to explore different paths on a divergence"):
  - A pale **mist veil** covers the town. It parts, with one soft puff per
    house eased in and out, over the roofs holding water (≥ 4 drops), the
    roof the lead water is on with its fork (both roofs it can drop to), and
    the predicted path.
  - The **path** is where the *current* tilt sends the water for 4 rows,
    using the same exit rule as the planner bot (over the high end when the
    tilt beats the pitch; a parapet or tank stops it). It's drawn as
    droplets drifting roof to roof, with a pulsing orange ring where the
    water would stop. Tilting swings it from branch to branch, so a fork can
    be read before committing to it.
- **Backdrop**, back to front, each at a fraction of the camera: sky, a snow
  range (0.04), a pine ridge (0.12), the hill face (0.35), which is a
  pre-drawn tile of far houses and pines, then mist bands (0.6). The range and
  ridge slide up out of view as the water descends.
- **Pickups** are drawn with their house, so off-path ones sit in the mist:
  - a wooden barrel with water at the top;
  - a small cloud bobbing over its shadow;
  - a grey downpipe with a hopper and wall brackets. Pipes are drawn after
    all rows, so the rows below don't cover them.

  A pickup on the path gets a pulsing gold ring, and the path follows a pipe
  to its outlet. Taking one shows a call-out ("+30 water", "☁ sun stopped
  3 s", "↓ downpipe"), clamped on-screen. While the sun is shaded, a cloud
  bank covers its edge and the readout counts down.
- **Town**: per row, pastel bodies with framed windows, then roofs. A roof is
  a slab matching its capsule, with a ribbed tin plane receding above it and a
  gutter lip at the low eave. Parapets are concrete blocks. Tanks are concrete
  cisterns, dark inside. Prayer flags hang across some drain slots, and a
  downpipe brings the rain in.
- **Water is metaballs**: each drop stamps a soft sprite (`alpha ≈ (1−r²)²`)
  into a half-resolution buffer. One pass thresholds alpha at 120 with a ±14
  ramp, a lighter rim band, and a lit top. The pass reads back only the box
  the drops cover: a full-screen readback halved desktop frame rates.
- **Pixel budget**: `dpr` is capped so the backing store stays ≤ 2.6 MP. A
  phone keeps 2×; a big monitor drops a little, since every frame repaints
  the whole screen. Headless Chromium (software raster, no GPU), 390×844:
  ~42 fps, of which the mist's full-screen blend costs ~13 fps (55 without
  it). Its buffer is quarter-resolution, but resolution wasn't the cost; a
  GPU canvas composites it as one quad. Real-device frame rates are still
  unmeasured.
- Sun glow below the line uses `lighter` compositing — source-over orange
  went brown.

## Persistence

`runoff.best.chase` — best depth in metres (key name kept from the two-mode
build so existing bests survive). Storage failures are swallowed.

## Query flags

`?harness` — no SW; `window.__ro = { start(seed), world, cam {x, y}, state,
setTilt(rad), T }` for scripted driving.

## Theme

A Himalayan hill station just after the monsoon: pastel walls (butter, mint,
blush, sky, lilac), painted tin roofs (red, green, blue, rust), snow peaks,
pine slopes, mist, prayer flags. Water is a saturated blue (`#2280d4`) so it
reads against pale walls; the sun is white-gold (`#fff6d8` → `#ffb13b`).
Shares nothing with the other games here.

## History

- M1 (PR #88): a single alley, ledges on both walls sloping toward the wall.
  Its known gap was that blind waggling (`flip`) beat reading the screen.
- Scroll mode was cut (PR #89, 2026-10-08): thumb-scrolling while tilting
  fought itself. Code at `3d6adb8`.
- M2 (#90): the branching town above.

## Rules of the repo that bite here

- `rules.js` stays importable from Node: no `window`, `document`,
  `performance`, canvas. `node sim/run.mjs` is the check.
- Any change to `T` ships with a before/after harness table in the PR
  (DECISIONS #7/#8).
