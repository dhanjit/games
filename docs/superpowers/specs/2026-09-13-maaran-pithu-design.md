# Maaran Pithu — design (v1)

**Date:** 2026-09-13 · **Tracker:** #40 · **Milestones:** #41 M1, #42 M2, #43 M3, #44 M4, #45 M5

A school-field dodgeball in the browser. Twenty kids, one tennis ball, a grassy
field you can slide on, and a referee. Whoever holds the ball throws it at
anyone. A hit puts the target out. A catch keeps you in and gives you the ball.
Last one standing wins.

The source game's feel, which the design protects: **distance is the whole
skill.** From five yards there is no time to dodge; from fifteen it is a duel;
from twenty-five the ball drops before it arrives.

## Decisions (2026-09-13)

| Question | Choice | Rejected |
|---|---|---|
| Format | Free-for-all elimination, last standing | Teams; hit-player-becomes-hunter |
| Players | You vs 19 bots, offline, static page | Online multiplayer (Durable Objects, later if ever); local 2P |
| View | Top-down 2D canvas, field in yards | Side-on |
| Referee | A mechanic: enforces air gap and holding, calls outs | Flavor only; line-of-sight ref |
| Hit model | Real ball, real geometry: hit = collision, dodge = move out of the path | Distance-keyed dice roll |
| Endgame | Boundary shrinks per elimination | Round timer |
| Stack | Vanilla ES, canvas, no build (DECISIONS #2) | Phaser |

Assumed, not from the outline: the holder cannot run with the ball (shuffle
only, 3 s limit). The shrinking boundary is not a school rule; it exists so the
last two players are not standing 40 yards apart.

## Rules

Units are yards and seconds. All numbers are the starting values for M3 to tune.

- **Field** 60 × 40. Players are circles of radius 0.5, clamped inside the
  current boundary. Movement 6 yd/s. Holder moves at 1.5 yd/s.
- **Ball** states: `loose` (rolls, friction decelerates it, stops), `held`,
  `flight`. Thrown at 20 yd/s in the aim direction; drops to `loose` after 25 yd.
  Any player touching a loose ball picks it up.
- **Hit** a ball in `flight` intersecting a player other than the thrower puts
  that player out (they walk to the nearest edge and stay drawn there). The ball
  goes `loose` at the point of impact.
- **Catch** a player facing an incoming ball who presses throw within the last
  0.15 s of flight before impact catches it (`held`). A press outside the window
  does nothing; the hit then lands normally.
- **Slide** 4 yd burst along the move direction over 0.35 s, 1.2 s cooldown.
  No invulnerability: it only moves you. Leaves a grass streak.
- **Referee**
  - *No air gap:* a throw released within 3 yd of its first intersecting player
    is void. The ball drops `loose` at the thrower's feet and the thrower is
    stunned 0.5 s.
  - *Holding:* 3 s in `held` and the ref takes the ball; it goes `loose` 3 yd
    from the holder in a random direction.
  - Calls appear as a speech bubble from the ref and a short whistle.
- **Boundary** starts at the full field. Each elimination scales it toward a
  minimum of 20 × 14, keeping area roughly proportional to players remaining.
  Players outside the new boundary are pushed in.
- **Round** ends when one player remains. Score = placement points + hits ×2 +
  catches ×3. Best score and best placement in localStorage under
  `maaranpithu.meta`.

## Bots

Each bot has a personality that sets four numbers: preferred throw distance,
reaction delay, catch skill, and human-targeting bias.

| Personality | Throw range | Reaction | Catch | Notes |
|---|---|---|---|---|
| Rusher | < 8 yd | 0.35 s | low | Closes distance before throwing |
| Sniper | 12–18 yd | 0.25 s | high | Waits for a slide, then throws |
| Coward | keeps > 15 yd | 0.3 s | mid | Throws quickly at nearest when forced to hold |
| Kid | any | 0.5 s | low | Noisy aim, random decisions |

Behaviour is a small state machine: `seek ball` (nearest non-holder runs for a
loose ball), `hold` (approach or retreat to preferred range, then throw at the
chosen target), `evade` (when a ball is in flight toward you, after the reaction
delay, slide or step perpendicular to its path; snipers attempt a catch instead
when skill allows). A difficulty knob scales the human-targeting bias.

## Controls

- Keyboard/mouse: WASD or arrows to move, mouse to aim, click to throw (or catch
  when a ball is incoming), space to slide, R to restart.
- Touch (M4): left-thumb virtual joystick, tap to throw or catch toward the tap,
  swipe to slide.

## Architecture

```
maaranpithu/
  index.html        canvas + overlay HUD
  style.css
  rules.js          pure sim, no DOM: createWorld(seed, opts) → step(world, dt, inputs)
                    holds field, players, ball, referee, bots. Exports for browser and Node.
  game.js           canvas render, fixed-timestep loop (accumulator, 1/120 s), input, HUD
  sim/run.mjs       Node harness: N bot-only rounds → stats table (M3)
  manifest.webmanifest, sw.js, icons/   (M4)
  CLAUDE.md         game notes (M4)
```

`rules.js` is the only file the sim imports, so everything that affects balance
lives there and nothing that touches the DOM does. Rendering reads the world; it
never mutates it. The human is a player whose inputs come from `game.js` instead
of the bot brain.

## Feel

Flat procedural art: striped mown grass, shirt-coloured circles with a drop
shadow, the holder marked with a ring, the ball a small yellow dot with a
trailing shadow, the ref in a black-and-white shirt on the sideline. Callouts as
comic speech bubbles. Playground identity, nothing shared with the other games.

The clippable moments to design for: the last-second catch and the slide under a
throw. Both get a brief hit-stop and a sound.

## Testing

- **Sim harness** (#43): median round length, hit rate by distance bucket, time
  the ball is loose, win share per personality, referee call counts. Targets:
  ~50% hits at 15 yd, >85% at 5 yd, <20% at 25 yd; no personality above ~40%
  win share. Round length target was 90–150 s; the first balance pass
  (2026-09-13) found bot-only rounds settle at 60–70 s median and that no
  lever tried (shrink rate, minimum box, throw delays, hold speed, ball
  friction) moves it more than a few seconds — pace is set by player count
  and hit rate. Revised target: 60–90 s bot-only; a human in the field is
  slower to the ball and lengthens it.
- **Browser smoke:** `?harness` query skips focus/visibility auto-pause so the
  in-app browser can drive a round headlessly, as `runner/` does.
- No unit-test framework; `rules.js` is exercised by the harness.

## Milestones

Each leaves a running game (issues #41–#45):

1. **M1 slice** — field, you, 3 dumb bots, throw, hit, loose ball, out, restart.
2. **M2 rules** — slide, catch, referee, boundary shrink, 19 bots with personalities, score.
3. **M3 sim** — harness and balance pass; before/after table in the PR.
4. **M4 polish** — HUD, sound, touch, PWA, hub card, CLAUDE.md.
5. **M5 ship** — itch.io page and one subreddit post (DECISIONS #1, #3).

## Out of scope for v1

Online multiplayer, teams, more than one ball, power-ups, character
progression, a story. Any of these gets its own issue when a player asks.
