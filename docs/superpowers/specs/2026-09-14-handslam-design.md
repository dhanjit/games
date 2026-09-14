# handslam — design (v1)

**Date:** 2026-09-14 · **Tracker:** #63 · **Milestones:** #64 M1, then M2–M5

A classroom bench game in the browser. Six kids round a desk in an Indian
English-medium school, free period, no teacher. One kid is **down** — hand flat
on the desk, palm down. The other five are **up** — fists cocked in the air,
hammering down with the bottom of the fist. Knuckles only; no rings, house rule.

The hand may not be lifted out of danger. It may only be **slid** along the
desk — which drags your own wrist through the strike zone behind it. Every hand
has HP. Last hand standing wins.

The source game's feel, which the design protects: **you cannot react to the
blow, only to the wind before it.** By the time a fist is falling it is already
too late. So the kid who is down is always guessing, and the fists' real weapon
is patience — hold the tension long enough and the hand under you loses its
nerve first.

## Decisions (2026-09-14)

| Question | Choice | Rejected |
|---|---|---|
| Match shape | Last hand standing, hand HP, elimination | Score till the bell; solo gauntlet run |
| Skill axis | Pure timing. Fixed seats, fixed strike spots, no aiming | Attackers aiming at a moving target; creep-the-fist distance game |
| Information | The wind is readable, the drop is not | Reactable drop; tells on the defending side |
| Escape | Slide along the desk — the hand never leaves it | Lifting the hand clear (contradicts the house rule) |
| Flinch cost | Nerve meter, refills only while flat | Class calls cheating; no cost at all |
| Bait resolution | Group ranked by resolve time, **last one goes down** | Only fouls ranked; damage every fouler |
| Characters | Six archetypes: 4 stats + 1 signature each | Stat spreads only; player-allocated points |
| Controls | One context-dependent button, hold/release | Two separate keys; tap-to-commit |
| Primary target | **Portrait phone browser** | Desktop-first with a mobile pass later |
| Authority figure | None — free period, no teacher | A teacher who turns from the board |
| Seats | Six (you + five bots) | Four; eight or more |
| Stack | Vanilla ES, canvas, no build (DECISIONS #2) | Phaser |

The hand's slide is a **1-D retreat, not a target to chase** — that is what
keeps "pure timing" true even though the hand moves. Attackers never aim; each
seat's fist lands on its own fixed spot, and the only question is what is under
that spot at the moment it lands.

## Rules

### Roles

Exactly one kid is **down**; everyone else is **up**. Being down changes hands
only through a bait resolution — a landed thump does not move it. Whoever is
down stays under fire until they successfully bait somebody, which is the
pressure the whole game runs on.

### The fists

**Every fist is always cocked.** Nobody rests their arm; the loaded fist in the
air is the resting posture, so there is no arm-raise to watch for. What gives a
strike away is the *tension* before it: the wind.

```
ready ──hold──▶ wind ──▶ loaded ──release──▶ drop ──▶ thump | wrist | desk ──▶ recover ──▶ ready
                             └────────── abort (release once the hand is gone) ──────────┘
```

| State | Duration | Visible to others |
|---|---|---|
| `ready` | the default posture, indefinite | yes, but carries no information — everyone is like this |
| `wind` | `T.windTime` 0.12 s | yes — knuckles tighten, the fist draws back. **This is the tell.** |
| `loaded` | player's choice, min `T.loadMin` 0.10 s | yes — held tension |
| `drop` | `T.dropTime` 0.11 s, uninterruptible | technically, but too fast to act on |
| `abort` | `T.abortTime` 0.15 s back to ready | yes |
| `recover` | `T.recoverTime` 0.30 s after any landing | yes — a spent fist is no threat |

Because `ready` is free and universal, the cost of threatening is entering
`wind` — which is both how you apply pressure and how you expose yourself to a
bait. A fist that never winds is the passive one (see *Bait resolution*).

### The hand

**The hand never comes off the table.** House rule, and the rule the whole game
hangs off: you cannot lift out of danger, only slide out of it, dragging your
own wrist through the strike zone behind you.

```
flat ──hold──▶ sliding ──▶ clear ──release──▶ returning ──▶ flat
                                    nerve empty ──▶ pinned
```

`sliding` pulls the hand back toward its owner's edge of the desk over
`T.slideTime` 0.12 s (scaled by the kid's Pull stat); `T.returnTime` 0.15 s to
slide back out. `pinned` is an exhausted hand: it cannot slide at all and sits
flat in the open.

### The three contact zones

A landing fist resolves against whatever is under its strike spot at that
instant. The spot is fixed, so this is entirely a timing gradient — and it is
where the wrist rule lives.

| At the moment the drop lands, the spot holds | Verdict | Effect |
|---|---|---|
| the back of the hand — `flat`, or the first `T.handGrace` 45% of `sliding` | **thump** | the kid who is down loses 1 HP (2 for a Ghoosa) |
| the wrist following it out — the rest of `sliding`, and the first 45% of `returning` | **foul (wrist)** | no damage; an entry in the open bait |
| bare desk, or thin air | **foul (desk)** | an entry in the open bait |

Both misses are fouls and rank identically. They are distinguished because they
*read* completely differently: the wrist one is the near-miss, and it is the
feedback that teaches a player how close they were.

**Open question for M3:** whether a wrist hit should also chip the defender for
half a point. It certainly hurts in the real game. It is zero for now, because a
rule that simultaneously punishes the attacker and damages the defender is hard
to read on a phone — and the harness can settle it.

### Nerve

A 0–1 bar. Starting a slide costs a flat `T.slideCost` 0.12 immediately, then it
drains at `T.nerveDrain` 0.34/s while the hand is `clear` — so one unbroken
retreat from full lasts about 2.6 s, and four twitchy short flinches cost half
the bar before any drain at all. It refills at `T.nerveRegen` 0.15/s and *only
while the hand is flat*, so a hand coming back out starts earning again. At 0 it
is `pinned` and cannot slide until nerve reaches `T.nerveUnpin` 0.25. A pinned
hand is free thumps, and everyone can see the bar.

### Arming — a bait needs something to bait

The instant the hand's back clears the strike spot (i.e. it passes `handGrace`),
a bait **arms — but only if at least one fist is in `wind`, `loaded` or `drop`
at that moment.** You cannot bait an empty desk: sliding with nobody threatening
burns nerve and resolves nothing.

This is what makes winding a real decision rather than free pressure. A fist
that winds is applying pressure *and* exposing itself.

### Bait resolution — last to resolve goes down

An armed bait opens a window of `T.baitWindow` 0.45 s. Every fist gets one entry
in it, timestamped:

| What the fist did | Entry timestamped at | Notes |
|---|---|---|
| Landed on wrist or desk | the moment it landed | a **foul** |
| Aborted out of `wind` or `loaded` | the moment the abort began | **the reaction test** |
| Still `loaded` when the window closed | window close | froze |
| Was in `ready` — never wound at all | window close + ε | ranks below everyone |
| Was in `recover` | *excluded* | already spent its turn honestly |

Entries sort by timestamp; **the latest one goes down.** Ties break by seat
order from the current defender, clockwise.

Three consequences worth stating plainly, because they are the design:

1. **Being fooled is forgiven; being slow is not.** A kid who hammers the desk
   at 0.12 s walks free while a kid who aborted cleanly at 0.30 s goes down.
2. **Never winding is the worst play.** A fist in `ready` always ranks last, so
   turtling puts you down the first time anyone else applies pressure. No round
   timer is needed.
3. **The attacker's counter-skill is the abort.** The hand starting to slide is
   the starting gun; abort speed is a genuine reaction test on the attacking
   side, which is what stops the game being one-sided.

### HP and elimination

Each kid starts with their stat's HP (3–5). Only the kid who is down can take
damage. At 0 HP they are out: hand withdrawn, sitting it out. Whoever landed the
finishing thump goes down next. Last kid with HP wins.

## Characters

Six archetypes. Stats are 0–5 and scale the timings in `T`; the numbers here are
starting hypotheses for `sim/run.mjs` to move (DECISIONS #7).

| Kid | Archetype | HP | Fist | Pull | Nerve | Signature |
|---|---|---|---|---|---|---|
| **Arjun** | front-bench topper | 3 | 3 | 5 | 5 | **Exam Nerve** — nerve refills at double rate while the hand is flat |
| **Bunty** | back-bencher | 4 | 4 | 3 | 3 | **Double Mukka** — the drop lands twice; on a foul both land and he is timestamped on the second |
| **Meera** | class monitor | 3 | 3 | 4 | 5 | **I am Telling Sir** — once a match, when she would go down it falls to the second-last instead |
| **Vikram** | the bully | 5 | 5 | 2 | 2 | **Ghoosa** — his thump costs 2 HP, but his wind is longer and far louder |
| **Nitin** | new admission | 4 | 4 | 4 | 4 | **Unreadable** — his wind is randomised in length until he fouls once |
| **Sana** | never misses | 4 | 2 | 5 | 4 | **Feint** — a twitch of the hand that costs no nerve and reads as a real slide |

Sana's Feint is a trap as much as a tool: the hand never actually clears the
strike spot. No bait arms, so nobody can be made to go down — and any fist that
panics and drops **lands cleanly on her hand and hurts her**. What it buys is
tempo: it resets every attacker's wind for free while her nerve bar is untouched.

*Fist* scales `windTime` and `dropTime`. *Pull* scales `slideTime`. *Nerve*
scales `nerveDrain` and the size of the bar. *HP* is flat.

## Bots

One persona per bot, tuned in the harness, never in the renderer.

| Field | Meaning |
|---|---|
| `spookAt` | how long an enemy wind must last before this bot starts sliding |
| `abortReaction` | s of delay before reacting to the hand sliding — the thing being tested |
| `loadStyle` | `[min, max]` s this bot likes to hold `loaded` before dropping |
| `nerveFloor` | nerve level below which it stops flinching and starts eating hits |
| `noise` | jitter applied to every timing above |

A bot never reads a state the player cannot see — no peeking at whether a human
is about to release. Wind length, nerve bars and the hand's position are the
only inputs, because those are exactly what is drawn on screen.

## Controls

One button, context-dependent, identical in both roles.

| | hold | release |
|---|---|---|
| **when up** | wind, then hold `loaded` | **drop** if the hand is still there, **abort** if it is not |
| **when down** | slide the hand back | let it slide out again |

Desktop: space, or mouse down anywhere. Touch: `pointerdown` anywhere on the
canvas. There is no aiming, so there is nothing to drag and no second control.

**Why release means two things.** Dropping into a spot the hand has already left
is never a choice anyone would make on purpose — it is only ever a mistake of
timing. So the button does not ask the player to choose between dropping and
aborting; it reads the world and does the sane thing, and *when* they let go is
the whole measurement:

| Player did | Hand's state at that moment | Outcome |
|---|---|---|
| released | still on the spot | `drop` — a real commit |
| released | gone, bait open | `abort`, timestamped at the release — **this is the reaction test** |
| kept holding past the window | gone | `froze`, timestamped at window close |
| nothing — already in `drop` | left mid-drop | `foul`; the fist was committed and cannot be recalled |

A human therefore never fouls by choosing to. They foul because they committed a
fraction of a second too early — exactly the mistake the real game punishes.

Also: `Esc`/`P` pause, `R` restart, `M` mute.

## Mobile

Portrait phone is the primary target, not a port.

- **Layout.** Round desk, seats on an ellipse, **you always at 6 o'clock**. The
  desk fills the width in portrait; in landscape the ellipse flattens and the
  same seat order holds. Nothing repositions between roles.
- **Everything readable at arm's length.** The five things that must be legible
  on a 375 px screen: who is down, which fists are winding, how long each has
  been `loaded`, the defender's nerve bar, and every kid's HP. Load time is drawn
  as a ring filling round the fist, not a number.
- **The wrist must be visible.** The three contact zones only teach if the player
  can see them, so the hand, the wrist behind it, and each fist's strike spot are
  drawn as distinct shapes — not a single blob.
- **Render budget.** Canvas backing store at `min(devicePixelRatio, 2)`. The desk
  — wood, grain, chalk, ink graffiti, seat rings, strike spots — is pre-rendered
  once to an offscreen canvas and blitted; only six arms and the HUD are redrawn.
  No allocation inside `step()` or `render()`.
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
  test/rules.test.mjs   node:test unit tests over the pure sim
  sim/run.mjs           balance harness — bot-only matches, no renderer
  sw.js manifest.webmanifest icons/
  CLAUDE.md
```

**Units: seconds.** The hand's slide is a single scalar `0 → 1` along its own
retreat axis; seats are angles on a unit ellipse. All screen scaling lives in
`game.js`. Because the skill axis is temporal, the sim carries almost no
geometry — which is exactly why the harness is cheap here.

```js
createWorld({ nBots: 5, humans: 1, seed: 1, roster: [...] }) // → world
step(world, dt, inputsById)                                  // → world.events
// inputs: { hold }   ← one boolean, both roles
// events: wind, load, drop, thump, wrist, desk, abort,
//         baitArm, baitResolve, goesDown, out, over
```

Both `test/` and `sim/` are excluded from the deployed Worker via
`.assetsignore` — they are tooling, not pages.

## Feel

An empty classroom in the middle of the day: ceiling fan, distant corridor
noise, someone's chair scraping two rows away. Wooden desk, ballpoint graffiti,
a chalk smudge. Six shirt-sleeved arms reaching in from off-screen — the kids
*are* their hands, seen from above, which is also why six fit on a phone.

Sound carries most of the tension: the murmur drops when a fist winds, the desk
thump is dull and wooden, a wrist hit has a flatter and nastier crack, and a
foul gets the whole class going. Nothing is shared with the other games in this
catalogue.

## Testing

`test/rules.test.mjs` covers the sim's logic with `node --test`. `sim/run.mjs`
plays bot-only matches and prints the numbers any balance change must move. Per
DECISIONS #7 and #8, no change to `T`, `ROSTER` or `PERSONAS` ships without a
before/after in the PR.

Reported per harness run:

- match length — median, p10, p90
- baits: armed share, and the outcome mix (foul / abort / froze / passive)
- **abort-reaction spread** — the single number that decides whether the design
  works. If every bait resolves against the same kind of entry, load length was
  never a decision and the mind-game is decoration.
- contact mix: thump / wrist / desk — the wrist share says whether the near-miss
  band is wide enough to feel, or so wide that reading the slide stops mattering
- thumps per turn down, and how often a kid dies without ever baiting anyone
- nerve exhaustion rate — how often a hand goes `pinned`
- win share per persona against its share of the field

M1 additionally asserts `rules.js` imports clean in Node — no `window`,
`document` or `performance` — and that a phone-sized viewport holds 60fps.

## Milestones

| | Slice | Leaves you with |
|---|---|---|
| **M1** (#64) | both state machines, three contact zones, one bot, a desk, portrait shell | a real 1v1 duel, playable on a phone |
| **M2** | six seats, arming, bait resolution, HP, elimination | a full match, last hand standing |
| **M3** | `sim/run.mjs` + first balance pass | proof that reading the wind is a skill |
| **M4** | roster, stats, signatures, character select | six kids who genuinely play differently |
| **M5** | classroom atmosphere, sound, PWA, how-to, hub card | something you can put in front of players |

## Out of scope for v1

Online or local multiplayer. A teacher, or any authority figure. Attacker
aiming, or chasing the hand across the desk. Rings, rulers, or any prop. More or
fewer than six kids. A campaign, progression, or unlocks. Per DECISIONS #1 the
web-lane push is real work and gets its own issue — it is not part of "the game
is finished".
