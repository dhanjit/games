# handslam — Claude notes

A classroom bench game. Kids round a desk, seen from directly above. One is
**down** — hand flat on the desk, palm down. The rest are **up**, fists
permanently cocked over their own fixed strike spots, hammering down with the
bottom of the fist. Knuckles only, no rings. Last hand standing wins.
Design spec: `docs/superpowers/specs/2026-09-14-handslam-design.md`.
Tracker: issue #63. M1: #64.

**Status: M1 — a 1v1 duel against one bot.** Six seats, the character roster and
the balance harness are M2–M4; audio, PWA and the hub card are M5.

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
| `test/rules.test.mjs` | `node --test "handslam/test/*.test.mjs"` — 34 tests. |

`test/` and `sim/` are excluded from the deployed Worker via the root
`.assetsignore` — they are tooling, not pages.

## Testing

```
node --test "handslam/test/*.test.mjs"
```

**Use the quoted glob.** A bare directory argument (`node --test handslam/test/`)
fails on Windows Node 24 — it resolves the directory as a module and reports a
confusing `MODULE_NOT_FOUND` rather than running anything.

The canvas has no unit test; it is verified in a real browser at 375×812. Serve
with `python -m http.server 8080` from the repo root and open
`/handslam/?harness`, which exposes
`window.__hs = { world, render, seatGeom, view, restart, press, release, frameMs, frame }`.

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

## Theme

An empty classroom in the middle of the day — free period, no teacher. Wooden
desk, chalk strike rings, shirt-sleeved arms reaching in from off-screen. The
kids *are* their hands, which is also why six will fit on a phone. Nothing
shared with the other games in this catalogue.
