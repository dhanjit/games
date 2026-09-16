# Sweep (infinite minesweeper) — Claude notes

Classic minesweeper on a board with no edges. Score = cells revealed; one mine
ends the run; high score in `localStorage`. Single player, offline, PWA.

## Files

| File | Role |
|---|---|
| `rules.js` | **Pure engine, no DOM.** `makeWorld` / `isMine` / `neighbourCount` / `reveal` / `toggleFlag` / `chord`. Every tunable in `T`. |
| `game.js` | Canvas render, camera (pan/zoom), input (mouse + touch), HUD, overlays, run save/restore, SW registration. |
| `sim/run.mjs` | Balance harness: `node sim/run.mjs [--runs N] [--density d | --sweep a,b,c] [--cap N] [--seed n]`. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA. Bump `CACHE` in `sw.js` when a cached asset changes. Icons: `pwsh icons/make-icons.ps1`. |

## The board is a hash, not an array

`isMine(x, y) = cellHash(seed, x, y) < density·2³²`. `cellHash` is two rounds
of a splitmix32-style finalizer (constants from bryc's public-domain PRNG
survey), one absorb per coordinate so neighbouring cells share no low-bit
structure. Nothing about the untouched board is ever stored; the only state is
`world.cells`, a `Map` keyed `"x,y"` holding revealed counts (0–8), `FLAG`, or
`BOOM`. That Map *is* the memo — a neighbour count is computed at reveal time
and never again. Persistence is free: save the seed + the Map, and the rest of
infinity regenerates.

The surveyed alternative (Zikoat/infinite-minesweeper) rolls each cell lazily
with a sequential PRNG and stores every decision — state then depends on visit
order and the whole field must be persisted. Deliberately avoided.

## Density 0.22 — where it came from (DECISIONS #7)

Not taste, and not classic expert's 20.6%: the harness
(`sim/run.mjs`, reveal-safe-then-guess-lowest-risk bot, 200 runs/density,
area cap 30 000) found a **percolation cliff**:

| density | p50 area | censored (never died) |
|---|---|---|
| 0.19 | 30 333 (cap) | 90% |
| 0.20 | 30 125 (cap) | 77% |
| 0.21 | 7 941 | 28% |
| **0.22** | **1 299** | **0%** |
| 0.23 | 692 | 0% |
| 0.25 | ~156 | 0% |

Below ~0.21 the zero-regions connect and one flood at the cap opens thousands
of cells — a run effectively never ends, which is not a game. 0.22 is the
lowest density where runs reliably terminate: a 500-run confirm (seed 99) gave
median 1 385, p90 8 391, forced-guess deaths 1%, 2/500 still alive at 30 000
cells. Classic minesweeper can afford 0.206 because its *edges* stop the
flood; an infinite board has to do it with density alone. Change `T.density`
only with a fresh before/after sweep in the PR.

## First click is safe by override

You can't move a mine that's a pure function of coordinate. Instead the first
reveal fixes `world.origin` and `isMine` returns false inside a disc of
`T.safeRadius` (=2) around it — so the first click is always a zero and opens
at least the 5×5 disc plus whatever honest flood hangs off it. (Concept from
Zikoat's safe circle, carved into the mine function instead of the stored
board.) The disc means the cells *just outside* it have slightly fewer mines
than base density; invisible in play, and the harness plays with the same rule
so the numbers include it.

## Flood fill is a bounded BFS

Explicit queue, never recursion (a zero-region at low density would blow the
stack), capped at `T.floodCap = 4096` cells per reveal. 4096 ≈ a 64×64 patch —
more than any screenful at readable zoom — and a fully capped flood measures
~7 ms in Node (one-time, on click, not per frame). At the shipped 0.22
the cap never fired in 1 900 simulated runs (it exists for safety, not
balance; it *does* fire at ≤0.12). Behaviour at the cap: unprocessed frontier
cells simply stay covered and clickable — clicking a covered cell beside an
open zero resumes the flood. No error state, no async continuation.

## Guessing stance (v1): honest random, deaths measured

The field is a fixed random field; a long run eventually meets a genuine 50/50
and dies to it. **Accepted for v1**, for a defensible reason: the harness
shows forced-guess deaths are ~1–2% of deaths at 0.22 — the other ~80% are
solvable positions the bot (or player) misplayed, plus ~17% too tangled for
the oracle to classify. Deaths are overwhelmingly skill, not coin flips, so
score comparisons stay meaningful without fairness machinery.

Rejected for v1, in cost order (survey 2026-09-16, see PR): a local 50/50
hint (JSMinesweeper concept, MIT — hours, the natural v2 feature); the Kaboom
rule "guess punished unless forced" (pwmarcz, MIT — needs a per-click frontier
solver and mutable mines, days); minefair's numbers-first fair-infinite core
(LyricLy, MIT — replaces the hash board entirely, a different game).

The sim's death classification uses an exact oracle — backtracking over
connected frontier components (concept per DavidNHill/JSMinesweeper, MIT),
components >20 cells reported as `unknown` rather than guessed at.

## Camera & rendering

- World→screen is `(w − cam) · scale + centre`; `cam` is the world point at
  canvas centre, `scale` px/cell, clamped 3–64.
- Digits stop drawing below 9 px/cell and the grid below 12 px/cell; zoomed
  out the map reads as cream-on-slate coverage — that heat view *is* the score
  made visible.
- Per frame the renderer iterates **whichever is smaller**: the visible rect
  (Map lookup per cell) or the revealed Map (bounds check per entry). Zoomed
  in the rect wins; zoomed far out over a long run the Map wins. Both sides
  are O(min), so a 100k-cell run stays flat.
- Fog is flat fill + checker grain + grid, no per-cell state. After death the
  renderer hashes the visible rect to chart nearby mines (gated ≤40k cells).
- **Return to origin**: `◎` / `O` glides `cam` back to `world.origin`; when
  the origin is off-screen an arrow at the screen edge points home.

## Input

- Tap/click reveal · right-click or long-press (420 ms) flag · drag pan (5 px
  slop mouse, 9 px touch — inside slop it's a tap) · wheel / pinch / `+`/`−`
  zoom about the cursor · WASD/arrows pan · `O` origin · `R` new field ·
  `H` help.
- **Chord**: a tap on a revealed number whose neighbouring flags equal it
  opens its remaining covered neighbours (`chord()` in `rules.js` — pure, so
  the harness can use it). One gesture, not two-button: `doReveal` tries
  `reveal()` first (covered cell) and falls through to `chord()` (revealed
  number), so no new input state was added. Flags are trusted, classic rule:
  a wrong flag makes the chord fatal exactly as clicking the mine would be.
- One pointer state machine: `tap → pan | spent(long-press flag) | pinch`;
  a second pointer always promotes to pinch and cancels the long-press.

## Persistence

- `minesweeper.best` — high score. `minesweeper.run` — live run
  (seed, density, origin, cells) saved debounced (800 ms), on hide, and on
  `beforeunload`; restored on load so a reload mid-run costs nothing. A dead
  run clears the save. Save failure (quota) is swallowed — play continues,
  persistence degrades.

## Theme

“Surveyor's chart”: slate-blue fog of the uncharted (`#232a33`), cream paper
where you've swept (`#efe6d0`), ink digits, red pennant flags, Georgia serif.
Deliberately not Windows-95 grey, and shares nothing with the other games in
this catalogue.

## Query flags

`?harness` — no SW; exposes `window.__ms = { world(), cam, reveal, flag,
cellAt, newRun }` for scripted driving.

## Rules of the repo that bite here

- `rules.js` stays importable from Node: no `window`, `document`,
  `performance`, canvas. `node sim/run.mjs` is the check.
- Any change to `T` ships with a before/after harness table in the PR
  (DECISIONS #7/#8).
