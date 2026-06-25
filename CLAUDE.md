# Saptaloka — Claude notes

A Reigns-style mythology rogue-like, mobile-web. Pure static — no build, no
deps. Player-facing docs are in [README.md](README.md); this file captures
non-obvious things for editing the code.

## Repo layout

This repo serves multiple games under `games.dhanjit.me`. The **root
`index.html` is a hub** (plain landing page) linking to each game; **Saptaloka
itself lives in `saptaloka/`**. All paths below are inside `saptaloka/`.

## Architecture in 30 seconds

```
saptaloka/index.html  → loads cards.js, then game.js (order matters)
cards.js    → exposes window.SAPTALOKA = { REALMS, CARDS } (data only)
game.js     → IIFE; reads window.SAPTALOKA at boot
style.css   → CSS vars in :root drive the theme; mobile-first, safe-area aware
manifest.webmanifest → PWA install metadata; icons are inline data: SVGs
```

No bundler. No transpiler. Modern-browser ES (template literals, optional
chaining, `Object.fromEntries`) is fine. Don't introduce a build step unless
explicitly asked — it would defeat the "open `index.html` and play" promise.

## Running locally

`manifest.webmanifest` and the relative paths require an HTTP origin — opening
`index.html` directly via `file://` is unreliable. Always serve:

```
cd /Users/dhanjit/Code/games
python3 -m http.server 8080
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
- `weight` defaults to 1 if omitted.
- `recentIds` keeps the last 7 drawn cards out of the pool. If a too-narrow
  realm filter empties the pool, the engine wipes `recentIds` and falls back to
  the first non-boss card — adding very few cards for a realm produces
  noticeable repeats.
- `fx` can be a **plain object** *or* a **zero-arg function** returning one
  (see `randomNagaEffect`). The Sage's Eye preview only renders for object
  effects — function fx silently shows no preview. If you want a preview for a
  randomized choice, decide the fx at draw time, not on commit.
- `next: 'cardId'` is documented in the README as the chaining mechanism, but
  the current engine doesn't read it — `commitChoice` always calls
  `drawNextCard()`. If chaining is needed, route through `state.nextCardOverride`
  (already present) or extend `commitChoice`.

## Stats — end conditions are asymmetric

Range is 0..100 nominal but the engine deliberately leaves room above/below
during `applyFx` so `checkEnd` can detect overflow:

| stat   | dies at 0 | dies at 100        | clamped before check |
|--------|-----------|--------------------|----------------------|
| prana  | yes       | no (caps at 100)   | yes (capped to 100)  |
| tejas  | yes       | yes (burnout)      | no                   |
| karma  | yes (sin) | early mokṣa (win)  | no                   |
| bhakti | yes       | early mokṣa (win)  | no                   |

So a `+30` swing that pushes karma past 100 is a **win condition**, not an
overflow bug. Prāṇa is the only "more is better, capped" stat. When designing
boss fx, remember the `>=100` exits exist — overshooting karma/bhakti on a
boss is a viable narrative ending.

`Second Breath` only saves prāṇa-zero deaths. The other four end conditions
ignore it.

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
  (`secondBreath`, `preview`, `graceBonus`) must also be reset at run-start in
  `applyStartingUpgrades` (currently hand-listed at the top of that function).
- `meta.bestRealm` is 1-indexed; the realm-name lookup compensates.

## Swipe / input

- Touch and mouse share `onPointer*` handlers. iOS double-tap-to-zoom is
  defeated by the global `touchend` guard — don't remove it.
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

## What not to do

- Don't add a framework, bundler, or package.json.
- Don't break the `cards.js` → `game.js` script order, or the
  `window.SAPTALOKA` global handoff.
- Don't auto-clamp `tejas` / `karma` / `bhakti` to 100 — that disables two of
  the run-end conditions.
- Don't reuse the localStorage key for an incompatible meta shape.
- Don't reach for `fetch`/network calls — the game must work fully offline
  once cached.
