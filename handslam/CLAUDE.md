# handslam — Claude notes

A classroom bench game. Kids round a desk, seen from directly above. One is
**down** — hand flat on the desk, palm down. The rest are **up**, fists
permanently cocked over their own fixed strike spots, hammering down with the
bottom of the fist. Knuckles only, no rings. Last hand standing wins.
Design spec: `docs/superpowers/specs/2026-09-14-handslam-design.md`.
Tracker: issue #63. M1: #64.

**Status: M2 — a six-seat match: elimination you can see, a winner named
properly, and the six-seat numbers measured.** `sim/run.mjs` and the first
balance pass are M3; the character roster and signature moves are M4; audio,
PWA and the hub card are M5.

## The one rule everything hangs off

**The hand may never be lifted, only slid.** Sliding back along the desk drags
your own wrist through the strike zone behind it, which is why a fist that lands
a beat late hits wrist rather than bare wood. `hand.p` is a single scalar, 0 (on
the strike spot) → 1 (fully clear), and `zoneOf(p)` turns it into the three
contact zones:

| `p` | zone | outcome |
|---|---|---|
| `<= T.handGrace` (0.45) | `hand` | **thump** — the defender loses HP |
| `< 1` | `wrist` | **foul** — no damage, an entry in the bait |
| `>= 1` | `desk` | **foul** — an entry in the bait |

`game.js` must draw those zones where the rules put them. It does that by
deriving the hand's travel from the rule rather than guessing it:
`retreatPx = HAND_RX / T.handGrace`, with a wrist band of `retreatPx - HAND_RX`
immediately behind the hand. Change `handGrace` and the picture follows. An
earlier version slid the hand all the way to the player's edge, which left the
strike spot bare while the sim still said `wrist` — the drawing contradicted the
rules, and a player cannot learn a rule the picture denies.

Since #69 those bands are drawn as real anatomy, in a frame where +x runs from
the strike spot out toward that seat's own desk edge and the hand retreats along
+x: the **back of the hand** spans `[d-HAND_RX, d+HAND_RX]` and owns the `hand`
zone; the **splayed fingers** trail on inboard and own the `wrist` zone; at p=1
even the fingertips have cleared and the spot is bare wood. The fingers are a
distinctly darker skin tone than the back of the hand for exactly this reason —
the three zones must be three different colours where the spot is sampled. The
retreat direction is not free: the hand must slide *toward* the player, or at
p=1 the forearm itself lies across the spot and `desk` can never be bare.

Three pads keep antialiasing off the sample point, each gated on the zone the
rule is currently in so none can bleed into a zone it does not own —
`WRIST_OVERSHOOT` (fingertips past the spot inside `wrist`), `ZONE_PAD` (knuckle
line either way), `TIP_CLEAR` (fingertips pulled back outside `wrist`). **Verify
by sweeping p, not by sampling a handful of values**: a 34%-alpha knuckle crease
drifting over the spot between p=0.38 and p=0.45 passed the seven-value check and
failed a 201-step sweep. Every piece of hand detail now breaks around the centre
line the spot tracks down.

## The bait — the rule the game is named for

The hand clearing the spot **arms** a bait, but only if at least one fist is in
`wind`, `loaded` or `drop` at that instant. You cannot bait an empty desk.

Every fist then gets one timestamped entry: a foul stamps at its landing, an
abort at the release, a fist still loaded at close stamps at close, and a fist
that never wound stamps just after close so it ranks below everyone. **The last
entry goes down.** Being fooled fast is forgiven; being slow is what costs you,
and never winding is the worst play of all — which is what stops turtling
without needing a round timer.

Two guards keep it honest, and both exist because they were bugs first:

- `anyFistCommitted()` — a bait will not resolve while a fist is still mid-drop.
  You wait to see where the punch lands. Hard-capped at `closeAt + T.dropTime`
  so it cannot extend indefinitely.
- `lastBaitEntryIds` — a fist already entered in the bait that just resolved
  cannot be sent down a second time when its drop finally lands.

## Rules of the repo that bite here

- **`rules.js` is DOM-free and stays that way** (DECISIONS #8). No `window`,
  `document`, `performance`, `requestAnimationFrame`, `Math.random`. Randomness
  comes only from the seeded `world.rng`, and seeded bot duels replay identically
  — there is a test asserting it.
- **Balance is a hypothesis until the sim has run it** (DECISIONS #7), and M1
  sharpened that rule: a sweep is only worth what the model under it is worth.
  `spookAt` was "validated" at 0.30 against a bot with two bugs in it; duels were
  only ending because the bot drained its own nerve bar flinching at nothing.
  Fixed, re-swept, now 0.46. **When you fix a bot bug, re-measure every number
  you tuned against the old behaviour — do not carry it forward.**
- `spookAt` has a structural floor: it must exceed `T.windTime + T.loadMin`
  (0.22s, the earliest legal drop) or the defender can never be hit at all.
  Documented above `PERSONAS`; any new persona must clear it.
- No build step, no bundler, no `package.json` (DECISIONS #2).

## Files

| File | Role |
|---|---|
| `rules.js` | **Pure sim, no DOM.** `T`, `PERSONAS`, `createWorld(opts)` → `step(world, dt, inputsById)` → events. Every balance number is here. |
| `game.js` | Canvas render, fixed-timestep loop (1/120 s), the one-button input, HUD. Reads the world; mutates it only through `step()`. |
| `test/rules.test.mjs` | `node --test "handslam/test/*.test.mjs"` — 40 tests. |

`test/` and `sim/` are excluded from the deployed Worker via the root
`.assetsignore` — they are tooling, not pages.

## Testing

```
node --test "handslam/test/*.test.mjs"
```

**Use the quoted glob.** A bare directory argument (`node --test handslam/test/`)
fails on Windows Node 24 — it resolves the directory as a module and reports a
confusing `MODULE_NOT_FOUND` rather than running anything.

The canvas has no unit test; it is verified in a real browser at 375×812 and
320×568. Serve with `python -m http.server 8080` from the repo root and open
`/handslam/?harness`, which exposes
`window.__hs = { world, render, seatGeom, view, restart, press, release, frameMs,
frame, hudRadius, retreatPx, HAND_RX, freeze }`.

`freeze()` stops the loop rescheduling itself so a posed world can be
photographed. It exists because **some browser panes do not park rAF at 0 Hz** —
where the loop is live, a console pose drifts several sim steps before a
screenshot lands on it, and you photograph a state you did not set. After
freezing, keep the compositor fed with your own `(function p(){ __hs.render();
requestAnimationFrame(p); })()` or the screenshot can time out.

**Driving the loop under test:** offscreen and headless browsers park
`requestAnimationFrame` at 0 Hz, so the loop will not run on its own and
`frameMs()` reads 0. That is why `frame` is exposed — pump it yourself with a
MessageChannel and a monotonic clock:

```js
const mc = new MessageChannel(); let n = 0, t = performance.now();
mc.port1.onmessage = () => { if (n++ >= 600) return; t += 16.67; __hs.frame(t); mc.port2.postMessage(0); };
mc.port2.postMessage(0);
```

Keep one continuous pump with a single advancing clock. Restarting the clock per
frame breaks `frame()`'s accumulator and the sim barely advances.

## The six-seat match, measured (M2)

`node --test` proves elimination and bait correctness; match *shape* — how
long a match runs, how it tends to end — is only provable by playing matches,
not by asserting on one. 60 seeded bot-only six-seat matches
(`createWorld({ humans: 0, nBots: 6, seed: 500 + r })`, `1/120` steps, a 300s
guard; the script is a scratch throwaway per DECISIONS #7, not committed —
`sim/run.mjs` as a real harness is M3):

| | value |
|---|---|
| ending | 100% (60/60) |
| length | median 30.6s · p10 19.8s · p90 44.2s |
| `goesDown` kind | passive 331 · abort 276 · knockout 240 · froze 144 · wrist 103 · desk 96 |
| wins by seat (0–5) | 5 / 8 / 14 / 15 / 7 / 11 |

Identical to the pre-M2 baseline recorded on issue #66 (same seeds, same
counts), except p90 — 44.2s here vs 45.2s baseline, a percentile-formula
artefact rather than a behaviour change. M2 changed rendering and the
default seat count, not simulation behaviour, and re-measuring is what
confirms that actually held rather than just assuming it. `passive` is still
the dominant way a match resolves, and seat 0 — always the human, always
starting down — still wins least of the six. Both are already on #66 as open
balance questions for M3, not something this task changed.

### Open question: a punch already falling can catch a fresh defender cold

Six seats made something reachable that one attacker never could: a fist
already mid-`drop` lands on whichever defender `goDown`/`knockOut` just
installed in that same tick. `step()`'s attacker loop re-reads `w.down` on
every iteration, so a freshly-installed defender arrives at `hand.p = 0` and
can eat an in-flight punch with literally zero chance to slide — the rule is
exactly as written and approved, but a defender who has held the desk for
all of one tick has had no time to read anything, let alone react to it.

Measured over 200 seeded six-bot matches: 38 of 3235 thumps (1.2%) landed at
zero reaction time, and 299 (9.2%) landed within `T.recoverTime` of the
defender arriving. Not a bug to fix silently — the rule stands as written —
but a fairness question that only exists once more than one attacker fist
can be in flight at once, and it was unmeasured until now. Open for M3,
alongside the seat-0 and passive-dominance questions above.

## Inputs

One button, and its meaning depends on your role and on the world:

| | hold | release |
|---|---|---|
| **when up** | wind, then hold `loaded` | **drop** if the hand is still on the spot, **abort** if it has gone |
| **when down** | slide the hand back | let it slide out again |

Space or pointer-down anywhere; `R` restart. There is no aiming,
so there is nothing to drag and no second control. A human therefore never fouls
by choosing to — they foul because they committed a fraction too early, which is
exactly the mistake the real game punishes.

## The view

Flat top-down, no perspective anywhere (#69). The desk is a **rectangle**, drawn
with no vertical squash — M1/M2 drew an ellipse (`ry = 0.82·rx`), which read as a
round table in perspective while everything else was flat, and a player noticed
within seconds. `seatGeom(i)` places each seat as `{ side, t }` on that rectangle's
perimeter and returns `{ edgeX, edgeY, spotX, spotY, ux, uy, a, axisLen, side }`;
`ux, uy` points from the strike spot out toward that seat's own edge.

The desk's long axis follows the screen, so the seating follows the orientation:
portrait gets two kids down each long side and one at each short end, landscape
flips it. **Seat 0 — the human — is always on the bottom edge.** Any seat count
other than six falls back to even angular spacing cast as a ray onto the rectangle.

Everything static — floor, neighbouring desks, litter, desk, grain, graffiti,
chalk, strike rings, vignette — is baked once into the `bakeDesk()` offscreen
layer and blitted per frame. Only the six arms and the HUD redraw; measured
median 0.2 ms / max 3.6 ms per frame against an 8 ms budget. Anything new that
does not move belongs in the bake, and must go through `clearOfSpots()` so it
cannot land on a strike spot and change the wood colour the zone test samples.

## Theme

An empty classroom in the middle of the day — free period, no teacher. Wooden
desk, chalk strike rings, shirt-sleeved arms reaching in from off-screen. The
kids *are* their hands, which is also why six will fit on a phone. Nothing
shared with the other games in this catalogue.
