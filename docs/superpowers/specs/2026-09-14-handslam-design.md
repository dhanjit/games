# handslam — design (v1)

**Date:** 2026-09-14 · **Tracker:** #63 · **Milestones:** #64 M1, then M2–M5

A classroom bench game in the browser. Six kids round a desk in an Indian
English-medium school, free period, no teacher. One puts a palm flat on the
desk. The other five hold a fist over it and hammer down with the bottom of the
fist — knuckles, no rings, house rule. The palm can be yanked away to bait a
fist into the bare wood. Every hand has HP. Last hand standing wins.

The source game's feel, which the design protects: **you cannot react to the
blow, only to the arm.** By the time the fist is moving it is already too late.
So the palm is always guessing, and the fist's real weapon is patience — hover
long enough and the hand under you will lose its nerve first.

## Decisions (2026-09-14)

| Question | Choice | Rejected |
|---|---|---|
| Match shape | Last hand standing, hand HP, elimination | Score till the bell; solo gauntlet run |
| Skill axis | Pure timing, fixed seats | Aim + sliding palm; creep-the-fist distance game |
| Information | Hover is readable, drop is not | Reactable drop; defender-side tells |
| Flinch cost | Nerve meter, refills only while flat | Class calls cheating; no cost at all |
| Bait resolution | Group ranked by resolve time, **last one takes the palm** | Only fouls ranked; damage every fouler |
| Characters | Six archetypes: 4 stats + 1 signature each | Stat spreads only; player-allocated points |
| Controls | One context-dependent button, hold/release | Two separate keys; tap-to-commit |
| Primary target | **Portrait phone browser** | Desktop-first with a mobile pass later |
| Authority figure | None — free period, no teacher | A teacher who turns from the board |
| Seats | Six (you + five bots) | Four; eight or more |
| Stack | Vanilla ES, canvas, no build (DECISIONS #2) | Phaser |

Assumed, not from the outline: the palm is still hittable during the first part
of its lift and the last part of its return — a late yank gets clipped. A bait
that catches nobody costs nerve and changes nothing (see *Arming*, below), which
is what stops the defender from flinching on a loop.

## Rules

### Roles

Exactly one kid is the **palm** (defender). Everyone else is a **fist**
(attacker). The palm only changes hands through a bait resolution; a landed
thump does not move it. The palm is therefore pinned under fire until it
successfully baits someone, which is the pressure the whole game runs on.

### The fist

```
rest ──hold──▶ cock ──▶ hover ──release──▶ drop ──▶ thump | foul ──▶ recover ──▶ rest
                          └────────── abort (release early, or reflex) ─────────┘
```

| State | Duration | Visible to others |
|---|---|---|
| `cock` | `T.cockTime` 0.18 s | yes — the arm comes up |
| `hover` | player's choice, min `T.hoverMin` 0.10 s | yes — this is the tell |
| `drop` | `T.dropTime` 0.11 s, uninterruptible | technically, but too fast to act on |
| `abort` | `T.abortTime` 0.15 s back to rest | yes |
| `recover` | `T.recoverTime` 0.30 s after any landing | yes — a spent fist is no threat |

A `drop` that lands while the palm is hittable is a **thump**: the palm loses
1 HP (2 for a Ghoosa). A `drop` that lands on bare desk is a **foul**, and the
fist becomes an entry in the open bait (below).

### The palm

```
flat ──hold──▶ lift ──▶ up ──release──▶ return ──▶ flat
                              nerve empty ──▶ stuck
```

Hittable in `flat`, during the first 40% of `lift`, and the last 40% of
`return`. `T.liftTime` 0.12 s (scaled by the kid's Pull stat), `T.returnTime`
0.15 s.

**Nerve** is a 0–1 bar. Lifting costs a flat `T.liftCost` 0.12 immediately, then
drains at `T.nerveDrain` 0.34/s while up — so one unbroken lift from full lasts
about 2.6 s, and four twitchy short flinches cost half the bar before any drain. It
refills at `T.nerveRegen` 0.15/s and *only while the palm is flat* — a hand
returning to the desk starts earning again. At 0 the palm is `stuck` and cannot
lift until nerve reaches `T.nerveUnstick` 0.25. A stuck hand is free thumps, and
everyone can see the bar.

### Arming — a bait needs something to bait

When the palm leaves the hittable window, a bait **arms only if at least one
fist was in `cock`, `hover` or `drop` at that instant.** You cannot bait an
empty desk: a lift with nobody threatening burns nerve and resolves nothing.

This is the rule that makes hovering a real decision rather than free pressure.
A fist that hovers is applying pressure *and* exposing itself.

### Bait resolution — last to resolve takes the palm

An armed bait opens a window of `T.baitWindow` 0.45 s. Every fist gets one entry
in it, timestamped:

| What the fist did | Entry timestamped at | Notes |
|---|---|---|
| Dropped into bare desk | the moment it landed | a **foul** |
| Aborted out of hover | the moment the abort began | the reaction test |
| Still hovering when the window closed | window close | froze |
| Was in `rest` — never lifted at all | window close + ε | ranks below everyone |
| Was in `recover` | *excluded* | already spent its turn honestly |

A fist still in `cock` when the bait arms counts as hovering — it is committed
and visible, which is all the rule cares about.

Entries sort by timestamp; **the latest one takes the palm.** Ties break by seat
order from the current palm, clockwise.

Three consequences worth stating plainly, because they are the design:

1. **Being fooled is forgiven; being slow is not.** A kid who hammers the desk
   at 0.12 s walks free while a kid who aborted cleanly at 0.30 s takes the palm.
2. **Never swinging is the worst play.** A fist at rest always ranks last, so
   turtling hands you the palm the first time anyone else applies pressure. No
   round timer is needed.
3. **The attacker's counter-skill is the abort.** The palm's lift is the
   starting gun; abort speed is a genuine reaction test on the attacking side,
   which is what stops the game being one-sided.

### HP and elimination

Each kid starts with their stat's HP (3–5). Only the palm can take damage. At 0
HP that kid is out: they pull the hand back, sit out, and the palm passes to the
kid who landed the finishing thump. Last kid with HP wins.

## Characters

Six archetypes. Stats are 0–5 and scale the timings in `T`; the numbers here are
starting hypotheses for `sim/run.mjs` to move (DECISIONS #7).

| Kid | Archetype | HP | Fist | Pull | Nerve | Signature |
|---|---|---|---|---|---|---|
| **Arjun** | front-bench topper | 3 | 3 | 5 | 5 | **Exam Nerve** — nerve refills at double rate while the palm is flat |
| **Bunty** | back-bencher | 4 | 4 | 3 | 3 | **Double Mukka** — the drop lands twice; on a foul both land and he is timestamped on the second |
| **Meera** | class monitor | 3 | 3 | 4 | 5 | **I am Telling Sir** — once a match, when she would take the palm it goes to the second-last instead |
| **Vikram** | the bully | 5 | 5 | 2 | 2 | **Ghoosa** — thump costs 2 HP, but his hover is a longer, louder tell |
| **Nitin** | new admission | 4 | 4 | 4 | 4 | **Unreadable** — his hover tell is randomised until he fouls once |
| **Sana** | never misses | 4 | 2 | 5 | 4 | **Feint** — a fake lift costing no nerve that reads to attackers as real |

Sana's Feint is worth spelling out, because it is a trap as much as a tool: the
hand never actually leaves the desk. No bait arms, so nobody can be made to take
the palm — and any fist that panics and drops **lands on her palm and hurts
her**. What it buys is tempo: it resets the attackers' hovers for free while her
nerve bar is untouched.

*Fist* scales `cockTime` and `dropTime`. *Pull* scales `liftTime`. *Nerve* scales
`nerveDrain` and the bar's size. *HP* is flat.

## Bots

One persona per bot, tuned in the harness, never in the renderer.

| Field | Meaning |
|---|---|
| `spookAt` | how long an enemy hover must last before this bot's palm lifts |
| `abortReaction` | s of delay before reacting to the palm leaving — the thing being tested |
| `hoverStyle` | `[min, max]` s this bot likes to hover before dropping |
| `nerveFloor` | nerve level below which it stops flinching and starts eating hits |
| `noise` | jitter applied to every timing above |

A bot never reads a state the player cannot see — no peeking at whether a human
is about to release. Hover length, nerve bars and the palm's state are the only
inputs, because those are exactly what is drawn on screen.

## Controls

One button, context-dependent, identical in both roles.

| | hold | release |
|---|---|---|
| **as a fist** | cock, then hover | drop |
| **as the palm** | lift | put the hand back |

Desktop: space, or mouse down anywhere. Touch: `pointerdown` anywhere on the
canvas. There is no aiming, so there is nothing to drag and no second control.

Also: `Esc`/`P` pause, `R` restart, `M` mute.

## Mobile

Portrait phone is the primary target, not a port.

- **Layout.** Round desk, seats on an ellipse, **you always at 6 o'clock**. The
  desk fills the width in portrait; in landscape the ellipse flattens and the
  same seat order holds. Nothing repositions between roles.
- **Everything readable at arm's length.** The five things that must be legible
  on a 375 px screen are: whose palm is down, which fists are hovering, how long
  each has been hovering, the palm's nerve bar, and every kid's HP. Hover time is
  drawn as a ring filling round the fist, not a number.
- **Render budget.** Canvas backing store at `min(devicePixelRatio, 2)`. The desk
  — wood, grain, chalk, ink graffiti, seat rings — is pre-rendered once to an
  offscreen canvas and blitted; only six hands and the HUD are redrawn. No
  allocation inside `step()` or `render()`.
- **Page behaviour.** `touch-action: none`, `overscroll-behavior: none`,
  `user-select: none`, transparent tap highlight, `viewport-fit=cover` with
  safe-area insets. The page never scrolls or zooms.
- **Haptics.** `navigator.vibrate` on a thump you take, feature-guarded.
- **Verified at** 375×812 and 390×844, measured as frame time — not judged by eye.

## Architecture

House pattern, and the `rules.js` boundary exists from the first commit
(DECISIONS #8).

```
handslam/
  index.html            portrait-first shell, canvas, overlays
  style.css
  rules.js              pure sim — no DOM, no timers. T, ROSTER, PERSONAS,
                        createWorld(opts), step(w, dt, inputsById) → events
  game.js               canvas render, fixed-timestep loop (1/120 s), input,
                        HUD, character select. Reads the world; mutates only via step()
  audio.js              procedural WebAudio: murmur bed, desk thump, knuckle,
                        the class "oooooh" on a foul. Mute pref in localStorage
  sim/run.mjs           balance harness — bot-only matches, no renderer
  sw.js manifest.webmanifest icons/
  CLAUDE.md
```

**Units: seconds.** Seats are angles on a unit ellipse; all screen scaling lives
in `game.js`. Because the skill axis is purely temporal, the sim carries almost
no geometry — which is exactly why the harness is cheap here.

```js
createWorld({ nBots: 5, humans: 1, seed: 1, roster: [...] }) // → world
step(world, dt, inputsById)                                  // → world.events
// inputs: { hold }   ← one boolean, both roles
// events: cock, hover, drop, thump, foul, abort, baitArm, baitResolve, palmPass, out, over
```

## Feel

An empty classroom in the middle of the day: ceiling fan, distant corridor
noise, someone's chair scraping two rows away. Wooden desk, ballpoint graffiti,
a chalk smudge. Six shirt-sleeved arms from off-screen — the kids are their
hands, seen from above, which is also why six fit on a phone.

Sound carries most of the tension: the murmur drops when a fist cocks, the desk
thump is dull and wooden, a foul gets the whole class going. Nothing is shared
with the other games in this catalogue.

## Testing

`sim/run.mjs` plays bot-only matches and prints the numbers any balance change
must move. Per DECISIONS #7 and #8, no change to `T`, `ROSTER` or `PERSONAS`
ships without a before/after in the PR.

Reported per run:

- match length — median, p10, p90
- baits: armed share, and the outcome mix (foul / abort / froze / passive)
- **abort-reaction spread** — the single number that decides whether the design
  works. If every bait resolves against the same kind of entry, hover length was
  never a decision and the mind-game is decoration.
- thumps per palm-turn, and how often a palm dies without ever baiting anyone
- nerve exhaustion rate — how often a palm goes `stuck`
- win share per persona against its share of the field

M1 additionally asserts `rules.js` imports clean in Node — no `window`,
`document` or `performance` — and that a phone-sized viewport holds 60fps.

## Milestones

| | Slice | Leaves you with |
|---|---|---|
| **M1** (#64) | both state machines, one bot, a desk, portrait shell | a real 1v1 duel, playable on a phone |
| **M2** | six seats, arming, bait resolution, HP, elimination | a full match, last hand standing |
| **M3** | `sim/run.mjs` + first balance pass | proof that reading the hover is a skill |
| **M4** | roster, stats, signatures, character select | six kids who genuinely play differently |
| **M5** | classroom atmosphere, sound, PWA, how-to, hub card | something you can put in front of players |

## Out of scope for v1

Online or local multiplayer. A teacher, or any authority figure. Aiming or a
sliding palm. Rings, rulers, or any prop. More or fewer than six kids. A
campaign, progression, or unlocks. Per DECISIONS #1 the web-lane push is real
work and gets its own issue — it is not part of "the game is finished".
