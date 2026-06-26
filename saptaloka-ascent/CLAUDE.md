# Saptaloka Ascent — Claude notes

A 2.5D vertical-climb game: a **sibling** of the swipe-based `saptaloka/` (shares
theme + the four stats + mokṣa arc) but a different, real-playable game. Pure
static, no build, mobile-first PWA. The repo root is a game-agnostic hub — see
the root `CLAUDE.md`; this game is fully self-contained in this folder.

> Relationship: this is the **Saptaloka universe in 2.5D**, NOT the same code as
> `saptaloka/`. Don't cross-import. The shared things are *conceptual* (lokas,
> prāṇa/tejas/karma/bhakti, false summits, mokṣa) and the *palette* (the dark
> indigo + gold CSS vars). The swipe game is shipped (Play TWA) and untouched.

## Architecture in 30 seconds

```
index.html  → loads realms.js, then game.js (order matters), then registers sw.js
realms.js   → exposes window.SAPTALOKA_ASCENT = { REALMS } (data only)
game.js     → IIFE; canvas + fixed-timestep loop; reads window.SAPTALOKA_ASCENT
style.css   → CSS vars in :root; only styles the canvas shell + DOM overlays
manifest.webmanifest → PWA (portrait); icons are inline data: SVG
sw.js       → offline precache (cache-first + stale-while-revalidate)
```

Net-new vs the swipe game: this one has a **real game loop** (`requestAnimation
Frame` + a 1/120 fixed-timestep accumulator in `frame`) and renders on
`<canvas>`, not the DOM. The DOM is only the title/over/pause overlays + the
Mirror shop.

## Running locally

Relative paths + the manifest need an HTTP origin (`file://` is unreliable).
Serve from the repo root, then open the game path:

```
cd /c/Users/dhanj/Code/games
python -m http.server 8080
# → http://localhost:8080/saptaloka-ascent/
```

## Core loop & controls

- **Discrete one-thumb input** (the deliberate redesign — never analog charge-aim):
  tap the **left half** → hop up-and-left; tap the **right half** → hop
  up-and-right. One tap = one fixed-arc leap (`doLeap`); landings auto-snap within
  a forgiving x-tolerance (`up.landTol`, widened by the Steady Foot upgrade).
  `coyote` + `buffer` windows make it feel responsive.
- **Generation is reachability-guaranteed** (`genTier`). Each tier's ledge sits
  exactly **one column** off the previous, and the leap reaches one column, so the
  main path is always climbable. A *branch* tier places two ledges at
  `lastCol±1` then sets `pendingConverge = lastCol` so the **next** tier is
  reachable from **both** branches — never strand the player. The leap arc
  constants (`T.leapVY/leapVX/grav`) and the column geometry (`T.colSpacing`,
  `T.tierH`) are coupled: change one, re-tune the others or hops stop landing.
- **The flood (`run.tideY`)** is the pressure: it rises (`T.tideV0` + ramp +
  per-realm), and submerging the player drains prāṇa fast (`T.tideDrain`). Climb
  steadily and the gap grows; stall and it closes. Camera (`run.camY`) follows up,
  never descends, and is floored to keep the flood near the bottom.

## Stats — end conditions are asymmetric (ported from Saptaloka)

`applyDelta` caps **prāṇa** at 100; **tejas/karma/bhakti are left unclamped** so
`checkEnd` can detect overflow. Mirrors the swipe game's model exactly:

| stat   | dies at ≤0          | at ≥100                         |
|--------|---------------------|---------------------------------|
| prāṇa  | yes (`death_prana`) | caps at 100 (no death)          |
| tejas  | yes (`death_tejas`) | yes — burnout (`burnout`)       |
| karma  | yes (`death_karma`) | false summit (`false_karma` → Svarga) |
| bhakti | yes (`death_bhakti`)| false summit (`false_bhakti` → Deva-loka) |

`checkEnd()` returns by calling `endRun(key)`; `ENDINGS[key].kind` is
`win | death | false`. The **only win** is landing the **summit ledge** (top tier
of the last realm) → `endRun('win_moksha')`. Reaching karma/bhakti ≥100 is a
non-win dead-end (false heaven) — **no mokṣa**. So greedily hoovering virtue motes
(sattva/darshan) is a *trap*, exactly the Saptaloka over-virtue lesson.

- **Second Breath** only saves a prāṇa-zero drowning, once (`up.breathUsed`).
- tejas economy: each hop costs `T.leapCost × up.leapCostFactor`; passive regen
  (`T.tejasRegen`) refills but is capped at `T.tejasRegenCap` (< 100) so **passive
  regen alone never burns out** — only agni motes can overshoot to 100. Keep that
  cap below 100 or burnout becomes unreachable-by-accident / reachable-by-idle.
- **Motes**: soma `+prāṇa`, agni `+tejas`, sattva `+karma`, darshan `+bhakti`.
  Virtue motes are rarer and weighted higher in upper realms.
- **Asuras** sit only on *branch* ledges: landing on one stomps it (himsa,
  `−karma`) but that ledge also carries the tempting mote — the other branch is
  clean but bare. The virtuous (ahimsa) path always exists; it just costs the
  reward. Don't put an asura on a single-path ledge (would force himsa).

After any balance/arc edit, re-run a `/tmp`-style headless sim of the engine
(seed many runs; assert every tier is reachable, the climb is winnable with skill,
and false-summits are reachable-but-avoidable) — same discipline as Saptaloka.

## Meta-progression / persistence

- localStorage key: **`saptaloka.ascent.meta.v1`** (separate from the swipe game's
  `saptaloka.meta.v1`). `meta = { moksha, punya, bestTier, bestRealm, runs, upg }`.
- Currency is **puṇya** (earned by height climbed; bonus + `moksha++` on the true
  win), spent in **The Mirror** shop on `UPGRADES`.
- Adding an upgrade: append to `UPGRADES` in [game.js](game.js). `apply(up, level)`
  mutates the run-scoped `up` object; **every flag it sets must also be reset at
  the top of `applyStartingUpgrades`** (hand-listed there, like Saptaloka).
- If you change the meta shape incompatibly, **bump the key** to `.v2` +
  migrate in `loadMeta` (`Object.assign` only patches missing keys).
- `meta.bestRealm` is a 0-indexed realm; `realmName()` maps it.

## 2.5D rendering

- Depth is **layers + scale + haze**, no real 3D. `drawBackground` draws the sky
  gradient → parallax embers → two `silhouette()` bands (scroll slowly with
  `run.camY × factor`) → depth haze. `drawLedge` fakes a slab with a front face +
  an offset top-face parallelogram + accent rim. The player is a billboard
  soul-flame (`drawPlayer`) with squash/stretch (`player.sx/sy`).
- Per-realm palette is all in `realms.js` (`sky`, `slabTop/Side`, `accent`, `mist`,
  `tide`). Don't hard-code realm colours in `game.js` — read `curRealm()`.

## What not to do

- Don't add a framework, bundler, or `package.json`; don't break the
  `realms.js → game.js` order or the `window.SAPTALOKA_ASCENT` handoff.
- Don't clamp tejas/karma/bhakti to 100 (disables burnout / false-summit ends).
- Don't reuse the swipe game's localStorage key, icons, or code.
- Don't reach for `fetch`/network in game code — must work fully offline (sw.js is
  the only place `fetch` belongs).
- Don't generate a single-path ledge that strands the player or forces himsa.
