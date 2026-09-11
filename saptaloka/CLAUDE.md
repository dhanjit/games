# Saptaloka — Claude notes

A Reigns-style mythology rogue-like, mobile-web. Pure static — no build, no
deps. Player-facing docs are in the repo [README.md](../README.md); this file
captures non-obvious things for editing the code. Everything Saptaloka lives in
this `saptaloka/` folder (the repo root is a game-agnostic hub — see the root
`CLAUDE.md`).

## Architecture in 30 seconds

```
saptaloka/index.html  → loads cards.js, beat.js, rules.js, audio.js, then game.js (order matters)
cards.js    → exposes window.SAPTALOKA = { REALMS, CARDS, CUTSCENES, ENDINGS } (data only)
beat.js     → window.SaptalokaBeat; consequence-beat text (pure, node-tested)
rules.js    → window.SaptalokaRules; one mechanical rule per realm (pure, node-tested,
              and the file balance sims should load — see "Realm rules" below)
game.js     → IIFE; reads window.SAPTALOKA / SaptalokaRules at boot
style.css   → CSS vars in :root drive the theme; mobile-first, safe-area aware
manifest.webmanifest → PWA install metadata; icons in icons/ (PNG)
sw.js       → offline service worker (precache + stale-while-revalidate)
```

No bundler. No transpiler. Modern-browser ES (template literals, optional
chaining, `Object.fromEntries`) is fine. Don't introduce a build step unless
explicitly asked — it would defeat the "open `index.html` and play" promise.

## Running locally

`manifest.webmanifest` and the relative paths require an HTTP origin — opening
`index.html` directly via `file://` is unreliable. Always serve from the repo
root:

```
cd ~/Code/games        # or wherever you cloned it
python -m http.server 8080
```

Then open `http://localhost:8080/saptaloka/` for the game (or
`http://localhost:8080` for the hub). For phone testing on the same wifi, use
the machine's LAN IP. iOS PWA install: Share → Add to Home Screen.

## Card data — invariants and gotchas

- Normal card gating uses **`realmMin` / `realmMax`** (1..7, inclusive).
- Boss card gating uses **`realm: <n>` + `tag: 'boss'`**, exactly one per
  realm. `pickBossForRealm` does `find`, not filter — duplicates silently lose.
- Bosses are auto-drawn at the last step of each realm; do not put them in the
  normal pool.
- **Waystations** use **`realm: <n>` + `tag: 'rest'`**, exactly one per realm, and
  are likewise never in the pool. `drawNextCard` draws the realm's waystation once,
  at `restStep(realm)` = `floor((length − 1) / 2)` — or the first free step after
  it if a `then` chain held that slot (`state.restDone` tracks it, reset on realm
  entry). Realms 1–6 give prāṇa on one side at the cost of another virtue;
  Satyaloka's is dry by design (its realm rule zeroes prāṇa gains).
  `test/cards.test.js` enforces all of this.
- `weight` defaults to 1 if omitted.
- `recentIds` keeps the last 7 drawn cards out of the pool. If a too-narrow
  realm filter empties the pool, the engine wipes `recentIds` and falls back to
  the first non-boss card — adding very few cards for a realm produces
  noticeable repeats.
- `fx` can be a **plain object** *or* a **zero-arg function** returning one
  (see `randomNagaEffect`). The Sage's Eye preview only renders for object
  effects — function fx silently shows no preview. If you want a preview for a
  randomized choice, decide the fx at draw time, not on commit.
- `next: 'cardId'` (README's chaining field) is still **not** read by the engine.
  The supported immediate-chain field is **`choice.then: 'cardId'`** —
  `commitChoice` sets `state.nextCardOverride`, drawn on the next encounter (same
  realm or across the boundary). `next:` remains a no-op; prefer `then`.

## Karma — deeds that ripen (the callback system)

The "law of karma" turns choices into delayed consequences. Two per-run stores on
`state` (both reset in `startRun`, neither persisted to meta):

- `state.flags` (a `Set`) — within-run memory. A choice records deeds via
  **`choice.set: ['flagA', ...]`** (and `choice.clear` to remove). Cards gate on
  flags via **`card.requires: [...]`** (all must be present) and
  **`card.forbids: [...]`** (none may be present), checked in `eligibleCards`.
  Setup cards typically `forbids` their own "met" flag so they fire once per run.
- `state.karmaQueue` — scheduled payoffs. **`choice.ripens: { card, in }`**
  schedules a guaranteed future card `in` realms ahead (default 1), via
  `scheduleKarma`. `drawNextCard` calls `dueKarmaCard()` (a deed due for the
  current realm jumps ahead of the random draw). `in` ≥ 1; a deed scheduled past
  realm 7 simply never fires (fine).

Invariants:
- **Payoff cards carry `tag: 'karma'`** → excluded from the random pool in
  `eligibleCards` (like `boss`). They appear *only* when a `ripens` scheduled
  them. So they need **no** `realmMin/realmMax` — gating is the schedule. Don't
  put a normal card behind `tag:'karma'` or it'll never draw at random.
- Draw priority in `drawNextCard`: boss step → `nextCardOverride` (`then`) →
  a pending **offer** → the realm's waystation (once, at/after its midpoint) →
  due karma → random.
- **The offer (#32)** — `tag: 'offer'` + `stat`, one per stat, never in the pool.
  `commitChoice` queues a stat's offer the first time it crosses `OFFER_AT` (85) in
  a run (`state.offered` makes it once-only); while it's queued, `checkEnd` won't
  fire that stat's false summit. `buildOffer` copies the template at draw time with
  concrete fx (refuse → `OFFER_FLOOR` 75 and −`OFFER_TOLL` 6 prāṇa, accept → 100)
  so Sage's Eye previews both. The toll is what keeps the offer difficulty-neutral
  — re-sim before changing any of the three constants. The accept side carries `accept: '<ending key>'`; `commitChoice` routes it to
  `endRun(key, { staged: true })` *before* `checkEnd`, which would otherwise fire the
  same ending un-staged. Staging: the false summit arrives dressed as the win
  (`ENDINGS[key].lie`, gold, OM cue, "Begin Anew"), then `REVEAL_MS` later swaps to
  `end-falsesummit reveal` with the full narration. Reduced motion skips the
  staging; the live region always announces the full truth. Refuse it and a later
  overshoot ends the run the old way — the offer is made once.
- Payoff `fx` should be **plain objects** (not function fx) so Sage's Eye
  previews them.
- `renderCard` adds a `.card.karma` class (karma-blue cast in `style.css`) so a
  returning deed reads visually as "your past catching up."
- After balance/arc edits, re-run a `/tmp`-style sim: load `cards.js` with a
  `window` shim, then assert every `ripens.card` resolves to a `tag:'karma'`
  card, no orphan karma cards, and (over many seeded runs) no payoff appears
  unscheduled while every in-range scheduled deed appears.

## Stats — end conditions are asymmetric

Range is 0..100 nominal but the engine deliberately leaves room above/below
during `applyFx` so `checkEnd` can detect overflow:

| stat   | dies at 0 | hits 100                       | clamped before check |
|--------|-----------|--------------------------------|----------------------|
| prana  | yes       | no (caps at 100)               | yes (capped to 100)  |
| tejas  | yes       | yes (burnout death)            | no                   |
| karma  | yes (sin) | false summit (Svarga, non-win) | no                   |
| bhakti | yes       | false summit (Deva, non-win)   | no                   |

`checkEnd()` returns a key string (e.g. `'death_prana'`, `'false_karma'`) or
`null`; `endRun` looks it up in `ENDINGS`. Karma/bhakti `>=100` return
`false_karma` / `false_bhakti` (`kind: 'falsesummit'`) — these end the run as a
non-win dead-end: **no `meta.moksha++`, no +25 puṇya** (granted only by the true
win). So a `+30` swing that pushes karma past 100 is **not** a win — it ends the
run at a false summit (Svarga/Deva). The **only** win is completing realm 7,
which calls `endRun('win_moksha')` (`kind: 'win'`). Prāṇa is the only "more is
better, capped" stat. When designing boss fx, remember the `>=100` exits exist —
overshooting karma/bhakti on a boss is a viable false-summit ending, but it does
not grant mokṣa.

`Second Breath` only saves prāṇa-zero deaths. The other four end conditions
ignore it.

## Realm rules (rules.js)

Each realm may carry **one** mechanical rule, indexed by 0-based `realmIdx` in
[rules.js](rules.js): a `delta(stat, d, card)` transform on a card's raw delta,
and/or an `ambient` `{stat: n}` landed on every card of that realm. The entry
cutscene states the rule's `text` once (`#csRule`). Order inside `applyFx`:
**realm delta → Pilgrim's Stamina → realm ambient → prāṇa cap → Equanimity**, and
`showPreview` (Sage's Eye) mirrors that order exactly — change one, change both.
Keep rules.js DOM-free: it's `require`d by `test/rules.test.js` and by balance
sims, so the numbers a sim reports are the game's own, not a re-implementation.

## Consequence beat (beat.js)

The post-swipe beat (`showConsequenceBeat`) fires **only** for a choice with a
hand-written `outcome` string — the karma payoffs today. Ordinary cards go straight
to the next card; the HUD's floating deltas carry the "what happened". The
templated generator in beat.js still exists and is tested, but the game no longer
reaches it — remove it only if you're sure nobody wants it back.

Two Mirror upgrades add post-effect transforms in `applyFx` (default off — both
factors are 1 without the upgrade):
- **Pilgrim's Stamina** (`pranaDrainFactor` < 1) scales *negative* prāṇa deltas
  only (drains hit softer).
- **Equanimity** (`temperanceFactor` < 1) soft-compresses **karma and bhakti**
  above 82 toward the cap, to blunt the over-virtue "false-summit" exits. It does
  **not** touch tejas — burnout (`tejas >= 100`) must stay reachable, so don't add
  tejas to that loop. The `showPreview` (Sage's Eye) badge mirrors all three
  transforms (prāṇa cap, drain-softening, karma/bhakti damping) so the preview
  equals the floating delta — keep them in sync if you change `applyFx`.

Realms were trimmed to 5·6·6·7·7·8·8 (47 encounters) and card-gain magnitudes
softened so the full climb to Satyaloka is reachable with skill; the Mirror is
the difficulty ramp. Re-run `/tmp`-style engine simulations after balance edits.

## Meta-progression / persistence

- localStorage key: **`saptaloka.meta.v1`**.
- If you change the meta shape (new fields on `meta`, new `state` flags from
  upgrades) in a backwards-incompatible way, **bump the key** to `.v2` and
  drop a one-shot migration in `loadMeta`. Don't silently break saves —
  `Object.assign(defaultMeta(), JSON.parse(raw))` only patches missing keys, it
  doesn't reshape existing ones.
- Adding an upgrade: append to `UPGRADES` in [game.js](game.js). The `apply`
  function mutates `state` at run-start (called from `applyStartingUpgrades`).
  Costs are an array — length defines the max level. State flags set here
  (`secondBreath`, `preview`, `graceBonus`, `temperanceFactor`,
  `pranaDrainFactor`) must also be reset at run-start in `applyStartingUpgrades`
  (currently hand-listed at the top of that function).
- `meta.bestRealm` is 1-indexed; the realm-name lookup compensates.

## Swipe / input

- Touch and mouse share `onPointer*` handlers. iOS double-tap-to-zoom is
  defeated by the global `touchend` guard — don't remove it.
- **Keyboard (#28)** drives the *same* handlers with a synthetic drag: ← / → (or
  A / D) hold to weigh at 34% of the card's width — past both the 15% label-reveal
  and 30% commit thresholds — release commits, Esc while held snaps back, window
  blur cancels. Don't add a second code path; change the thresholds in one place.
  `lastInput` ('touch' | 'key') follows the last input used and swaps the `#hint`
  text and the tutorial's gesture-step copy.
- Choice labels are visible at rest (`.choice` opacity 0.55) and light to gold when
  weighed. A first-time player must never have to blind-drag to learn the options.
- **First run:** the title hides the meta row and the Mirror button until
  `meta.runs > 0`; the tutorial is four steps (three taps + the real first swipe);
  each virtue is taught by a toast the first time it enters its danger zone
  (`DANGER_LESSON`, persisted once-ever per edge in `meta.dangerTaught`).
- **End screen (#27):** `#endCause` names the virtue, the edge, and the encounter +
  label that ended the run (`CAUSE` / `causeLine`), coloured by the virtue. On a
  staged false summit it's withheld until the reveal.
- Commit threshold: **30% of card width** OR **0.6 px/ms** velocity. Tweak in
  `onPointerUp`.
- `card` element is reused across encounters — `renderCard` resets its
  transform/opacity in two phases with a forced reflow (`void card.offsetWidth`).
  Skipping the reflow makes the entry transition vanish.

## CSS theme

All colors live as CSS vars in `:root`. Per-stat colors are
`--stat-prana/tejas/karma/bhakti`. Layout sizing uses `--card-w` /
`--card-h` and `env(safe-area-inset-*)` for iOS notch/home-indicator. Editing
the dark mythology palette is one block in [style.css](style.css); avoid
hard-coding colors elsewhere.

## PWA / Android packaging

The game is wrapped as a Trusted Web Activity for the Play Store (see the
`saptaloka-android-play` memory and [store/RUNBOOK.md](store/RUNBOOK.md)).
Saptaloka-specific packaging files and their non-obvious rules:

- **`sw.js`** is a stale-while-revalidate service worker that precaches the static
  assets (offline + installability). **Bump `CACHE` (`saptaloka-v1` → `-v2` …)
  whenever you change any cached file** (`ASSETS` list), or returning players keep
  the old build. Add new asset files to the `ASSETS` array too.
- **`icons/*.png`** are real raster icons (Android/Play can't use the inline-SVG
  data-URI favicon). Regenerate from the ॐ glyph with `@resvg/resvg-js` + the
  Windows `Nirmala.ttc` Devanagari font if the look changes; `manifest.webmanifest`
  references them (192 `any`, 512 `any`, 512 `maskable` as **separate** entries).
  `apple-touch-icon.png` is iOS-only (iOS ignores manifest icons).
- **`store/`** holds Play-listing artifacts (feature graphic, store icon, listing
  copy, runbook) — kept inside this folder so Saptaloka stays self-contained.
- **`splash/`** holds iOS launch images (portrait, per current iPhone resolution),
  referenced by `apple-touch-startup-image` `<link>` tags in `index.html` so an
  installed iOS PWA shows the ॐ splash instead of a white flash. Regenerate with
  `@resvg/resvg-js` + Nirmala/Georgia. iOS is the only viable "app" target (no native
  build on Windows; Apple rejects webview wrappers under guideline 4.2) — the PWA
  Add-to-Home-Screen IS the iOS app.
- **Digital Asset Links** are the one exception that *can't* live in this folder:
  the TWA needs `/.well-known/assetlinks.json` at the **domain root**
  (`games.dhanjit.me`, NOT under `/saptaloka/`), carrying the Play **app-signing**
  key SHA-256 (not the upload key). It's a shared, domain-level file (one JSON
  array, one entry per game) at the repo root — see the root `CLAUDE.md`.

## What not to do

- Don't add a framework, bundler, or package.json.
- Don't break the `cards.js` → `game.js` script order, or the
  `window.SAPTALOKA` global handoff.
- Don't auto-clamp `tejas` / `karma` / `bhakti` to 100 — that disables the
  run-end conditions. (Equanimity *soft-compresses* karma/bhakti above 82 only
  when the upgrade is owned, and never touches tejas, so the burnout death stays
  reachable — keep it that way.)
- Don't reuse the localStorage key for an incompatible meta shape.
- Don't reach for `fetch`/network calls in **game code** — the game must work
  fully offline once cached. (`sw.js` uses `fetch` for caching; that's the only
  place it belongs.)
