# Decisions

Durable, dated decisions about **how this catalogue is built and shipped** — the
reasoning that should survive after the conversation that produced it is gone.

`CLAUDE.md` says *how to work in this repo*. This file says *why the repo works
that way*, and what we deliberately chose **not** to do. When a decision here and
a habit in a session disagree, this file wins until it's superseded.

Append-only in spirit: don't rewrite history. To change a decision, add a new
entry that supersedes the old one and mark the old one `Superseded by #N`.

Add entries by appending a new numbered section in the same shape.

---

## 1 — Building is the solved part. Distribution is the whole problem.

**Date:** 2026-07-26 · **Status:** Accepted

AI collapsed the cost of *making* a small game to near zero. It did nothing for
the cost of being *found*, and by flooding the stores it made discovery harder.

Evidence gathered 2026-07-26:

- ~20,003 games shipped to Steam in 2025 (~55/day); **roughly half got fewer
  than 10 reviews** — functionally invisible.
- **Median gross revenue per 2025 Steam release: $249.** ~40% didn't recoup the
  $100 listing fee.
- AI-disclosed Steam releases jumped ~700% year over year; by early 2026 ~35% of
  new releases carried an AI disclaimer.
- The famous counter-example (`fly.pieter.com`, $1M ARR in 17 days) was a
  **10-year, 600k-follower audience** with a 3-hour build attached — not a
  build-tool win.
- Every genuinely viral solo case — Bopl Battle (500k copies, $0 ads),
  Magic Research ($400k from *two* Reddit posts), Balatro (a streamer
  tournament) — had **exactly one channel** do the heavy lifting, always organic
  or a pre-existing audience. Never paid acquisition.

**Decision:** treat shipping a build as the cheap half of the work. A game isn't
"done" when it runs — it's done when it has been put somewhere people can find
it. Budget effort accordingly.

**Implication:** this repo's own scoreboard is uncomfortable and instructive —
three finished games (`saptaloka`, `saptaloka-ascent`, `runner`), and as of this
date **no distribution at all**: no itch.io, no CrazyGames or Poki, no Reddit
post, no Steam. Saptaloka got as far as Play Store artifacts and a runbook —
further toward a *store* than any game here got toward a *player*. Closing that
gap outranks building game #4.

---

## 2 — Stay vanilla. No build step, no engine, no bundler.

**Date:** 2026-07-26 · **Status:** Accepted

The 2026-07-26 research recommended Phaser + TypeScript as the general
"optimal" web-game stack for AI-assisted development. **Rejected for this repo.**

**Why:** it directly contradicts the hub's working convention (`CLAUDE.md`:
*no build step, no bundler, no `package.json`*), and that convention is
demonstrably working — three shipped games, PWA + service workers, Play-Store-
ready artifacts, all in plain modern ES. Introducing a toolchain would buy
capability this catalogue hasn't needed and cost the "open the file and play"
property that makes these games cheap to start and trivial to host.

The generic advice was right about the *principle* — pick something the model
writes correctly and can read end to end — and vanilla ES satisfies that better
than any framework, because it is the most represented code on earth.

**Decision:** vanilla ES stays the default for every game here.

**Revisit when:** a specific game genuinely needs real physics, tilemaps, or a
scene graph. Then Phaser is the sanctioned exception — scoped to *that one game's
folder*, never hoisted to the root, and never allowed to add a build step to the
hub. If that ever happens, supersede this entry rather than quietly drifting.

---

## 3 — Ship order: web first, Steam second, mobile last.

**Date:** 2026-07-26 · **Status:** Accepted

Each destination has a different cost, audience, and effort-to-reward:

| Lane | Cost to enter | Reality |
|---|---|---|
| **Web** (itch.io, CrazyGames, Poki, Reddit) | $0 | Judged on the artifact in ten seconds, no reputation needed. Iterate in minutes. Browser games see ~37% play-through vs ~6% for downloads. |
| **Steam** | $100/app, recouped at $1k revenue | The revenue ceiling, but wishlist-driven and slow — the store page wants to exist 6+ months before launch. |
| **Mobile** | $99/yr Apple (+ Mac/Xcode), $25 Google | Most cost, worst discovery. 2.39M apps on Play; organic reach is close to a lottery without paid acquisition. |

**Decision:** every new game goes to the web lane first and free. Steam only for
a concept that has already shown it retains players. Mobile last, and only for a
proven retainer.

**Implication:** Saptaloka's existing Play Store work is *not* wasted — but it
was done out of order. Its next step is a free web-lane push (itch.io + a niche
subreddit + a portal submission), not more store prep.

**Note:** these games are already PWAs served from one domain, so the web lane
costs essentially nothing to enter. That's an advantage worth actually spending.

---

## 4 — Distribution notes worth not re-deriving

**Date:** 2026-07-26 · **Status:** Reference (not a decision — kept here so it
travels with the repo)

- **Steam:** wishlists barely affect ranking *directly* — they matter because
  they fuel the launch-day sales spike that the discovery algorithm does react
  to. Store page up 6–12 months early (Valve's own data: ~300% more sales vs a
  30-day-out page). **One Steam Next Fest slot per title, ever** — it amplifies
  existing momentum rather than creating it, so spend it late, with a demo that
  already works.
- **Web portals:** itch.io is the free validation lane (set your own revenue
  cut; audience skews maker/dev). CrazyGames and Poki have real built-in traffic
  (tens of millions of monthly players) and cost nothing to submit to. No
  exclusivity is forced except Poki's *optional* web-exclusive deal, which still
  leaves Steam and mobile untouched.
- **Reddit:** the demo-first subs (r/WebGames, r/playmygame,
  r/incremental_games) judge the artifact, not your posting history — the right
  fit for this catalogue. Broader indie subs expect to have followed your
  journey first. Age an account before posting; several large gaming subs ban
  self-promotion outright.
- **Short-form video:** ranked on completion rate rather than follower count, so
  a zero-follower account can still get seeded. This rewards games with one
  clippable, absurd, or satisfying moment — worth designing for deliberately.
- **Discord Activities:** 85/15 split in the developer's favour up to $1M, and
  it runs HTML5 in an iframe — i.e. these games already qualify technically.
  Discovery inside Discord is still immature, so treat it as a bonus leg, not a
  first move.

---

## 5 — Decisions live in the repo, not in assistant memory.

**Date:** 2026-07-26 · **Status:** Accepted

Claude Code's automatic memory is **project-scoped and keyed by absolute path**
(the checkout path is slugified into the folder name). The same repo checked out
on another machine resolves to a different key, so synced memory files would
never be found. Memory is also machine-local, unversioned, and mixes durable
decisions with half-formed scratch notes.

**Decision:** anything durable about *this project* is promoted into this repo —
`DECISIONS.md` for reasoning, `CLAUDE.md` for working conventions, `docs/` for
specs and plans. It then travels by `git clone`, survives across machines, is
reviewable in a diff, and stays readable by a human or any tool.

The split, in general:

- **About this project** → this repo. Self-sufficient, no sync layer.
- **About how I work** (preferences, standing infra choices) → my dotfiles,
  which sync separately.
- **Automatic memory** → staging buffer only. Let it capture, then promote what
  proves durable. Never the source of truth.

**Caveat:** check repository visibility before promoting, and match the voice to
it. For this repo that question is settled in **#6** — it's public on purpose.

---

## 6 — This repo is public on purpose. Write these entries outward.

**Date:** 2026-07-26 · **Status:** Accepted

`DECISIONS.md` was first drafted in a private voice — candid internal assessment,
local machine paths, references to tooling nobody else can run. That forced the
question of whether the repo should go private to protect it.

**Decision:** the repo stays **public**, and entries here are written knowing a
stranger will read them.

**Why:** nothing about how this catalogue is built needs hiding, and the honest
parts are the useful parts. "Three finished games, zero distribution" is the
sentence that makes the rest of this document make sense — sanding it off would
leave a decisions log written by someone with nothing at stake. Building in
public is also, per **#1**, one of the few free distribution channels that
exists, and a repo nobody can open forfeits it entirely.

**Implication — what this actually constrains:**

- **Candour stays.** Uncomfortable findings about this project belong here. That
  is the point of the file.
- **Machine-specific detail goes.** No local paths, usernames, or hostnames —
  they leak the author's setup and teach the reader nothing.
- **No secrets, ever** — keys, tokens, account/zone/project identifiers. These
  belong in the secret vault and nowhere near a decisions log, public or not.
- **No instructions only the author can follow.** Personal tooling and private
  repos may be *referenced* as context, never presented as the way to do a thing
  here.

**Revisit when:** this catalogue starts carrying something genuinely
competitive — unreleased commercial plans, a publisher agreement, revenue
detail. Then supersede this entry rather than quietly self-censoring entries
one at a time, which is how a decisions log rots into a press release.
