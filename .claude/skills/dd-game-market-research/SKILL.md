---
name: dd-game-market-research
description: Monthly market research on what games are actually selling — Steam (PC) and iOS mobile. Use when asked "what's selling", "market report", "what should I build", "game market research", "what games are trending", or for a recurring look at recent breakout releases. Produces a dated report with a clone-gap teardown — why copying a hit loses, and what is genuinely transferable.
---

# Game market research

Monthly report on **recent breakout releases** — Steam and iOS — aimed at one
question: *what can I actually learn from and build?*

**This is not a top-sellers list.** Evergreen chart-toppers (CS2, Roblox, Candy
Crush) teach nothing actionable. The target is **games released or broken out in
the last ~30–60 days** at a scope a solo developer could plausibly reach.

## The point of the exercise

The user's framing, which drives the whole report:

> "Me building a Vampire Survivors clone will not be as good as Vampire
> Survivors. Why? The process of answering that question will make my game
> design better."

So every candidate gets a **clone-gap teardown**. Naming *why the clone loses*
forces you to separate the **skin** (copyable, worthless) from the
**mechanism** (transferable, valuable) — and that separation is the actual
design lesson. A report that just lists what sold has failed.

## Constraints the recommendations must respect

Read `DECISIONS.md` and `CLAUDE.md` in the target repo first (usually
`~/Code/games`) and filter every "buildable" claim through what you find there.
As of this writing that means: **solo scope · vanilla ES, no build step, no
bundler · web-first PWA · mobile-web friendly · must be clippable.** If those
decisions have changed, the repo wins over this file.

A candidate that fails those constraints can still appear — but label it
clearly as *learn-from, not build*.

## Process

### 1. Gather (parallel subagents, one per lane)

Spawn these concurrently. Ground everything in fetched sources; never assert
sales figures from memory.

**Steam lane**
- SteamDB new releases + top sellers; Steam's own *New & Trending* and
  *Top Sellers* for the window
- Gamalytic / VG Insights / SteamSpy for revenue and owner estimates
- GameDiscoverCo (Simon Carless) and howtomarketagame (Chris Zukowski) for the
  month's analysis — these two do the interpretive work already
- Steam250, r/gamedev and r/IndieGaming release threads for what devs noticed

**iOS lane**
- App Store top charts: Free, Paid, and **Top Grossing** (grossing is the honest
  one — free-chart position without revenue is vanity)
- AppMagic / Sensor Tower / Appfigures published posts for the month
- Deconstructor of Fun, PocketGamer.biz, Udonis for teardown-quality analysis
- Note the hybrid-casual vs hypercasual split — pure-ads titles and IAP-meta
  titles are different businesses, don't blend them

**Cross-cutting lane**
- itch.io trending, Poki / CrazyGames trending (nearest analogue to this repo's
  own distribution lane)
- Short-form video: which games are producing clips that travel

### 2. Be honest about data quality

Real revenue is mostly paywalled. State the method, don't fake precision.

- **Boxleiter estimate** for Steam: owners ≈ review count × multiplier.
  Range 30–100; **default 50**. Action/FPS skews 50–80, narrative/indie 20–40.
  Multiply owners × price × 0.7 (Valve's cut) for a gross ballpark.
- **Known correction (found Aug 2026):** cheap, short-session **party games get
  reviewed far less per owner** — Meccha Chameleon's reported result sat 3.5–4×
  above what its review count predicted. Do not apply the standard multiplier to
  sub-$10 party/co-op titles; it understates them badly. Prefer a reported figure
  or say "review-based estimate unreliable for this genre".
- Mark every number **Reported / Estimated / Inferred**. Never present an
  inferred figure as reported.
- If a claim can't be sourced, drop it. A shorter honest report beats a padded one.

### 3. Teardown — the core of the report

For each of **3–5 breakouts**, answer all seven. Keep each to a line or two:

| Field | What it asks |
|---|---|
| **Hook** | Why does someone *try* it? The one-sentence pitch that made them click. |
| **Loop** | Why do they keep playing past minute five? |
| **Friction removed** | What annoying thing did it *delete* from its genre? Often the real innovation and the most-missed one — Vampire Survivors deleted aiming; Balatro deleted deckbuilder setup time. |
| **The clip** | What does a 15-second video of this look like? If there isn't one, it can't travel on the channels available. |
| **Why a clone loses** | Which of the gaps below apply, specifically. |
| **Transferable mechanism** | What survives being stripped of the theme and art? |
| **Unoccupied application** | Where has this mechanism *not* been applied? Different audience, theme, platform, session length. |

### 4. The clone-gap checklist

For "why a clone loses", name the specific gaps rather than hand-waving:

1. **Category ownership** — the original *is* the search term; "X-like" names the
   genre after it. A clone competes for the original's leftover attention.
2. **Invisible tuning depth** — the loop's *shape* is a weekend; the *numbers*
   (XP curve, spawn cadence, evolution timing, damage windows) are hundreds of
   hours of playtesting. Clones copy the shape and ship something that feels dead.
   This is the feel-scorecard problem: mechanically correct, unfun.
3. **Content volume** — breakouts are usually absurdly generous for the price.
   Matching that is a content-months problem, not a code problem.
4. **Spent novelty** — the original consumed the novelty budget. Audiences pay
   for new; a clone arrives after the audience is saturated.
5. **Price anchor** — the original set the value expectation, often at $3–5.
6. **Review flywheel** — thousands of reviews feed the algorithm; a clone starts
   at zero and is algorithmically invisible regardless of quality.
7. **"Which is the real one"** — word of mouth always resolves to the original.

Then state the constructive inverse: **clone the mechanism, not the game.** Take
the proven loop and point it at an axis nobody has occupied.

### 5. Output

Write to the target repo (default `~/Code/games/research/`), filename
`YYYY-MM-market.md`. Create the folder if absent. Never overwrite a prior
month — these accumulate into a trend line, which becomes the real asset after
three or four reports.

```markdown
# Market report — <Month YYYY>

*Window: <dates> · Compiled <date> · Method: see Confidence notes*

## Signal of the month
<The one thing worth changing behaviour over. Two sentences.>

## Steam
### What broke out
| Game | Released | Price | Reviews | Est. owners | Est. gross | Confidence |
### Teardowns
<3-5, per the seven fields>

## iOS
### What broke out / climbed
| Game | Model | Chart | Publisher | Note | Confidence |
### Teardowns

## Patterns across both
<What repeated. Only claim a pattern with 2+ instances.>

## Clone-gap lessons
<The design lessons that fell out of the teardowns. This section is the point.>

## Buildable shortlist
| Concept | Mechanism borrowed | Unoccupied axis | Fits constraints? | Effort |
<Scoped to the repo's DECISIONS.md. Mark learn-from-only candidates clearly.>

## Confidence notes
<Method, multipliers used, what couldn't be sourced.>
```

### 6. Close the loop

- Compare against the previous report if one exists. **A trend beats a snapshot** —
  call out what rose, fell, or proved to be noise.
- If a finding is durable enough to change how games get built here, say so
  and offer to promote it into `DECISIONS.md`.
- Report where the data was thin — that gap is next month's research target.

## Rules

- **Recent, solo-scale, actionable.** Skip anything a solo dev could never
  approach; skip evergreen chart furniture.
- **Cite everything.** Every number gets a source link and a confidence label.
- **Never invent figures.** "Couldn't source" is a valid and useful answer.
- **Copy mechanisms, not games.** If a recommendation amounts to "make X but
  with different art", it has failed the teardown — go back to step 3.
- **Don't build anything.** This skill researches and recommends. Building is a
  separate, deliberate decision.
