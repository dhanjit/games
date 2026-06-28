# Saptaloka — Consequence beats, first-run tutorial, and audio cues

**Status:** Approved design — ready for implementation plan
**Date:** 2026-06-28 (revised same day: offline relaxed → audio is hybrid recorded-samples + synth)
**Scope:** `saptaloka/` only (the games-hub root and other games are untouched)

## Problem

Today, swiping a card just makes the four HUD numbers jump. The player has no
narrative read on *why* a stat moved, the four virtues are never explained, and
the game is silent. Three additions close that gap:

1. **Consequence beats** — after every swipe, a short *animated* "what happened"
   moment that explains the choice's effect.
2. **First-run tutorial** — coachmarks that teach the swipe and the four virtues
   against the real board, the first time a player plays.
3. **Audio cues** — a tiny offline synth that gives the game a voice, including
   tutorial punctuation.

## Hard constraints (inherited — non-negotiable)

- Pure static. **No build, no bundler, no `package.json`, no npm deps.**
- **Offline is no longer required** (relaxed 2026-06-28). The game should still
  degrade gracefully and, where cheap, keep working offline — `sw.js` continues to
  precache `ASSETS` (now including `audio.js` and the audio samples), and its
  `CACHE` name must still bump when any cached file changes. But a first-ever
  offline launch missing a sound file is acceptable: audio falls back to
  synth/silence, never an error. Game logic still makes no blocking network calls.
- Mobile-first, iOS safe-area aware.
- **Preserve, do not regress** the existing accessibility: `prefers-reduced-motion`
  handling and the `#statAnnounce` `role="status"` polite live region, plus ARIA
  on the `.stat` chips.
- A full run is **47 encounters** (realm lengths 5·6·6·7·7·8·8). Anything
  mandatory per-swipe must respect pacing — no per-swipe tap-gate.
- `cards.js` is data (`window.SAPTALOKA`), `game.js` is the IIFE engine, load
  order matters. `localStorage` key `saptaloka.meta.v1` — additive fields only,
  no incompatible reshape (no key bump).

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Beat surface | **Over-the-middle** translucent panel, animated |
| 2 | Beat pacing | **Every** non-boss swipe; **auto-quickens after run 1** |
| 3 | Beat content | **Hybrid** — authored lines for bosses + karma payoffs, templated fallback elsewhere |
| 4 | Audio default | **On** at ~60% master volume; mute toggle in HUD + title |
| 5 | Tutorial style | **Coachmark / spotlight** on the real board, first-run only |
| 6 | Tutorial replay | Link inside the existing **How-to-Play** modal |
| 7 | Veterans | Players with `runs > 0` are treated as **already onboarded** (tutorial suppressed, replayable) |
| 8 | Offline | **Not required** — graceful degradation only; audio assets may be fetched + precached |
| 9 | Audio engine | **Hybrid** — CC0/public-domain recorded samples for signature moments + light drone, code-synth for fast per-swipe cues, synth fallback per cue |

### The "animated cutscene" north star

The player asked that, ideally, the consequence read like a real animated
cutscene. We honor this in tiers rather than authoring 138 bespoke cutscenes:

- **Realm boundaries / boss kills** already play the `CUTSCENES` interstitial —
  these are the genuine animated "conclusions" and stay the cinematic peak.
- **Run endings** already play hand-built animated SVG vignettes (`ENDINGS`).
- **Per-swipe** gets an *animated micro-beat* (staged motion + dominant-stat
  color wash + sequenced chips), not a static caption.
- The `#beat` architecture is content-agnostic, so any individual beat (a boss,
  a karma reckoning) can later be upgraded to a richer bespoke animation or an
  inline SVG vignette without engine changes. Tracked as future work, not v1.

---

## Feature 1 — Consequence beats

### Where it hooks (verified against `game.js`)

Current flow:

```
onPointerUp → flyOff(side)   [0.32s fly-off, setTimeout 260ms]
            → commitChoice(side)
                applyFx → checkEnd
                ├─ run ends?      → endRun(...)            (untouched)
                ├─ realm complete? → playCutscene(...)      (untouched — already the boundary beat)
                └─ normal tail    → renderHud; floatDeltas; announceDeltas; drawNextCard   ← INSERT HERE
```

The beat is inserted **only** in the normal non-end tail. The realm-complete
branch is left alone, so a beat and a realm cutscene can never stack — at most
one moment per swipe.

Replace the normal tail:

```js
renderHud();
floatDeltas(before);
showConsequenceBeat(choice, before, () => { announceDeltas(before); drawNextCard(); });
```

`renderHud` + `floatDeltas` fire **before** the beat (HUD bumps/floats as today).
`announceDeltas` **moves into `onDone`** so the live region is written exactly
once, at the instant the run proceeds.

### `showConsequenceBeat(choice, before, onDone)`

- Computes **effective deltas** `d[s] = state[s] - before[s]` (post-clamp /
  post-damp), never `choice.fx`. This auto-reflects the prāṇa cap, Pilgrim's
  Stamina, Equanimity damping, and the one function-fx card
  (`snake_charmer.right` → `randomNagaEffect`). Reading `choice.fx` would re-roll
  a different result.
- Outcome text = `choice.outcome` if authored, else the **templated fallback**
  (below). All-zero deltas (empty-fx, or a swing fully absorbed) hit a **neutral
  branch** ("nothing in you shifts"), never a garbled sentence.
- **Reduced motion:** skip the visual overlay entirely, call `onDone()` after a
  microtask. Reduced-motion users still get the full `announceDeltas` read, so
  the "why" is never motion-only.
- Otherwise: set `state.beatPaused = true`; `closeStatInfo()`; populate
  `#beatText` + `#beatDeltas`; un-hide `#beat`, force reflow, add `.play`; start
  `state.beatTimer = setTimeout(dismiss, BEAT_MS)`.
- **Auto-advance** on the timer; an early `pointerdown`/`click`/`keydown`
  (Enter/Space/Escape) on `#beat` skips immediately.
- **One-shot guard:** a local `done` boolean + `clearTimeout` so the timer and an
  early tap can never both call `onDone` (the #1 risk — double draw).
- `BEAT_MS`: ~1100ms for run 1; **auto-quickens to ~650ms once `meta.runs > 0`**
  (decision 2). Tunable constants.

### Animation (the "mini-cutscene" feel)

- `#beat` is an over-the-middle translucent panel layered above the stage.
- **Dominant-stat color wash:** the panel tints toward the dominant axis's color
  (prāṇa loss → crimson, tejas → gold, karma → bronze, bhakti → violet) so the
  mood reads before the words.
- Staged entrance: backdrop fades → outcome line rises in → delta chips pop in
  sequence (small stagger). Reuses the `stat-float` palette for up/down chips.
- All motion is CSS keyframes gated behind `.play`; a belt-and-suspenders
  `@media (prefers-reduced-motion: reduce)` no-op matches the existing cutscene
  pattern.

### Content — hybrid authoring + template

**Authored** (`choice.outcome`, optional second-person one-liner): the **10
karma-payoff cards × 2 = 20** choices. These are literal callbacks to an earlier
deed — exactly where a bespoke line beats the template. Written in the established
`card.text` / `CUTSCENES` voice. **Bosses are intentionally NOT authored:** a boss
is a realm's last step, so its commit takes the realm-complete → cutscene branch
and never shows the beat — the realm `CUTSCENES` narration already serves as the
boss's consequence. Everything else (normal pool) rides the template.

**Templated fallback** (covers the long tail, ships working immediately):

1. Effective deltas `d[s]`.
2. **Dominant axis** = max `|d|`, tie-break **karma > bhakti > tejas > prana** (so
   a body-cost prāṇa drain never buries the moral point). All-zero → neutral line.
3. Per-stat gain/loss **story lexicon** (2–3 variants each, picked by a
   deterministic `hash(card.id)` so a card always reads the same):
   - prāṇa + "life floods back into your limbs" / − "the climb takes its toll on your body"
   - tejas + "an inner fire flares brighter" / − "the glow within you dims"
   - karma + "the ledger of your deeds tips toward the light" / − "a shadow falls across your deeds"
   - bhakti + "your heart bends closer to the divine" / − "the thread of devotion frays"
4. Assemble `{SpeakerLead} {dominantClause}{, but counterClause}.` SpeakerLead
   frames the card's `speaker` as cause. Add **one** opposite-sign counter-clause
   only when a secondary `|delta| ≥ 3`.
5. Magnitude colour: `|dominant| ≥ 12` → intensifier ("Sharply,"); `≤ 2` → "faintly".

`choice.outcome` is a new **optional** field — non-breaking; the engine ignores
it until the beat reads it, every existing card keeps working via the template.

### Accessibility

- `#beat` is `aria-hidden="true"` (decorative) so it never double-speaks.
- `#statAnnounce` stays the single SR source, written once in `onDone`. To give
  SR / reduced-motion users the narrative too, **prepend** the outcome sentence
  into that same single write: `` `${outcome}. ${deltaText}` `` — never a second
  live-region write (it clobbers before voicing).

### Risks / mitigations

- **Double advance** → one-shot `done` guard + `clearTimeout`.
- **`choice.then` chain** is set before the beat; deferring `drawNextCard` keeps
  `nextCardOverride` intact, chained card still draws on dismissal. Draw priority
  (boss → then → dueKarma → random) and `recentIds` are unchanged — only
  time-shifted.
- **Run teardown mid-beat** (menu abandon) → `hideBeat()` helper clears
  timer+flag+DOM, called from `startRun` and the abandon branch.
- **iOS double-tap-zoom** → add `#beat` to the `touchend` exempt `closest()` list.

---

## Feature 2 — First-run tutorial

### Style & entry

Coachmark / spotlight overlay (`#tutorial`) taught against the **real** `#card`
and `.stat` chips — the abstract-disconnect is exactly today's failure mode, so a
modal-sequence is the wrong tool, and inline-JIT can't teach the fatal extremes
*before* first fatal contact.

Runs **inside the opening `playCutscene(0)`'s `onDone`**, before the first
`drawNextCard`: opening cutscene → tutorial → first real card. Trigger in
`startRun`: `const runTutorial = !meta.tutorialSeen || state.forceTutorial;`.

### Steps (8 — all copy reused, no duplication)

1. **Welcome** (no spotlight) — goal statement; a "Skip" affordance appears from
   here on.
2. **Swipe the real card** — gesture-gated; an animated ghost arrow hints. The
   player's real swipe both advances the tutorial *and* is their first real
   choice (`commitChoice` runs normally). Falls back to "tap to continue" after
   ~6s of inactivity.
3. **Spotlight all 4 `.stat` chips** — "every choice shifts these; let any one
   fail and the run ends."
4–7. **Spotlight each stat**, copy pulled **verbatim** from `STAT_INFO[s]`
   (`${glyph} ${title} — ${oneLiner}`). One source of truth — the existing
   oneLiners already encode prāṇa "more is better", tejas "both extremes fatal",
   karma/bhakti "100 = false summit", exactly the comprehension gap.
8. **Spotlight realm pips** — boss/ascension goal + "tap any virtue anytime to
   recall." Finishing sets `meta.tutorialSeen = true; saveMeta();`, tears down,
   hands control to the live card.

### Controls, persistence, accessibility

- Skip (steps 1, 3–8) sets seen + save + teardown, leaves the card intact.
  Advance = tap/Enter/Space; Escape = Skip (matches the global Escape handler).
- **Replay**: a link inside the How-to-Play (`renderRules`) modal sets a transient
  `state.forceTutorial = true` and forces the tutorial for one run **without**
  clearing `meta.tutorialSeen`.
- `meta.tutorialSeen` added to `defaultMeta()`; backward-compatible via the
  existing `Object.assign(defaultMeta(), parsed)` — **no key bump**.
  **Veteran suppression:** in `loadMeta` after the assign,
  `if (m.tutorialSeen === undefined) m.tutorialSeen = (m.runs || 0) > 0;`.
  Write the flag once (on complete-or-skip) so a mid-tutorial refresh replays it.
- `#tutorial` is its own `role="dialog" aria-modal="true"`; focus each step's
  caption (`tabindex="-1"`, `.focus()`) so SR voices it — the per-stat steps are
  the accessible substitute for the visual spotlight. Full keyboard, never trap
  focus, restore focus to `#card`/title on teardown, leave `.stat`
  `aria-expanded="false"` with no dangling `aria-describedby`. Do **not** write
  tutorial text into `#statAnnounce` (reserved for deltas). Under reduced motion
  the swipe-ghost / pulses collapse to a static highlight + text.

---

## Feature 3 — Audio

### Engine

**Hybrid: recorded samples + WebAudio synth**, in a new `saptaloka/audio.js`
exposing `window.SaptalokaAudio`. (Offline is relaxed, so recorded audio is now
viable.) No npm deps — just static audio files plus code.

- **Recorded samples** carry the signature, texture-heavy moments where authentic
  timbre matters: ghanta bell, conch (śaṅkha), a low tanpura/drone ambient bed,
  the OM chant on the win, and the boss-entrance + death/false-summit stingers.
  Sourced **CC0 / public-domain only** (store-safe, no attribution burden; license
  for each file recorded in a short `saptaloka/audio/CREDITS.md`), stored in
  `saptaloka/audio/` as small compressed `.ogg` with an `.m4a`/`.mp3` fallback for
  Safari/iOS. Loaded via `AudioBufferSourceNode` — decode once, cache the
  `AudioBuffer`, replay cheaply.
- **Synth** handles the fast, latency-sensitive, frequently-fired per-swipe cues
  (drag pluck, commit "tak", the 4 per-stat gain/loss pitches, the ghanta-swell
  layer on big hits): sample-accurate, no decode latency, freely tuned. Primitives
  `tone(freq,dur,type,env)` / `noiseBurst(dur,filterFreq)` / `drone(freqs,dur)`,
  each a short scheduled `OscillatorNode`+`GainNode` with ADSR.
- **Fallback contract:** every recorded cue has a synth stand-in. If a sample is
  absent or fails to decode (or it's a first-ever offline launch before caching),
  that cue falls back to synth — never an error, never silence-by-bug.

One lazily-created `AudioContext` + master `GainNode`; samples decode lazily on
first unlock and are cached as `AudioBuffer`s.

### Cue set (~24)

- **Per-swipe** (kept <150ms, quiet): soft tanpura pluck on drag-threshold
  (debounced); wooden "tak" on commit; per-stat **gain vs loss** cues keyed to 4
  distinct pitches so the player learns each virtue's sonic identity
  (prāṇa ~196 warm, tejas ~330 bright, karma ~262 bronze, bhakti ~392 sweet).
- Layered **ghanta swell** on `|delta| ≥ 10` (syncs `flashStat`).
- **Danger drone-rise** only on *transition* into `≤15` / `≥85` (track prev,
  don't nag).
- **Consequence-beat settle** (~400ms, ducks under the stat cues).
- **Tutorial**: ghanta "ting" on coachmark appear; rising confirm on step-advance;
  play *that* stat's pitch as each of the 4 is introduced (pre-teaches identity).
- **Ascend** conch+drone (rising per realm); **boss** dissonant cluster; 7 distinct
  **death / false-summit** cues; the only fully-resolving **win_moksha** OM chord.
- UI tick on buttons; coin-settle on upgrade purchase.

Tutorial audio = synth **punctuation only**, not spoken narration (the coachmarks
already teach in text and the live region voices state). Optional `SpeechSynthesis`
TTS is a separate `meta.audio.voice` flag, default **off** — never the primary
channel.

### Unlock, controls, persistence

- **Autoplay/iOS:** do not create the context at load. Lazily create + `resume()`
  inside the `startBtn` click (guaranteed first gesture) *and* a one-time
  capturing `pointerdown`/`touchend`/`keydown` listener (covers Mirror /
  How-to-Play / toggle tapped first; re-resume after backgrounding). Every
  `play()` guards: `if (!enabled) return; if (ctx.state !== 'running') resume()`.
  Fire-and-forget, swallow errors — a missing/failed `AudioContext` must never
  throw into the game loop. `game.js` calls everything via
  `window.SaptalokaAudio?.play?.(...)`.
- **Controls:** two synced toggles — a title-screen ghost button near How-to-Play
  / Mirror, and an `.icon-btn` beside `#menuBtn` in the HUD — both read/write one
  meta key and re-render both glyphs.
- **Persistence:** additive `meta.audio = { enabled: true, volume: 1 }` on
  `defaultMeta()` — backward-compatible via `Object.assign`, **no key bump**.
  Audio is a global pref, kept **out** of `applyStartingUpgrades`/`startRun` reset.
  Mute = master gain 0 **and** early-return from `play()` (truly silent), persisted
  immediately. `prefers-reduced-motion` does **not** imply reduced sound — audio
  is governed solely by the audio flag.

---

## Cross-cutting

- **One `sw.js` `CACHE` bump** for all three features: `saptaloka-v2` →
  `saptaloka-v3`, once. New files **appended** to `ASSETS`: `audio.js` plus the
  `audio/` sample files (so repeat visits still play them offline);
  `index.html`/`style.css`/`game.js`/`cards.js` are already listed. Precaching the
  samples is best-effort — a failed audio fetch must not fail the SW install or the
  game (audio degrades to synth).
- **All new meta fields additive** to `defaultMeta()` (`tutorialSeen`, `audio`) —
  no `saptaloka.meta.v1` key bump.
- **Two new state flags**, distinct from `cutscenePaused` (so the L579 stale-drop
  guard and the cutscene dismiss are untouched): `state.beatPaused`,
  `state.beatTimer`, plus a transient non-persisted `state.forceTutorial`. Extend
  `onPointerDown`'s guard to also block on `beatPaused`.
- **One live-region discipline:** `#statAnnounce` stays the single source, written
  once per event. Beat folds outcome+deltas into that one write; tutorial uses its
  own labelled dialog captions; audio is non-speech.
- **One `touchend` zoom-exempt update:** add `#beat` and `#tutorial` to the
  `closest()` exempt list (currently `.stat`, `#statInfo`, `#cutscene`).
- **One reduced-motion contract:** beat visual + tutorial spotlight collapse to
  static/skipped, but the text/announce path always fires. Audio is orthogonal.
- **New DOM** (siblings under `#app` after the cutscene section): `#beat`
  (`#beatText` + `#beatDeltas`, aria-hidden) and `#tutorial` (role=dialog scrim +
  caption + Skip). Wire both into the `$()` DOM-cache block. **New CSS:** `.beat`
  family (reusing the stat-float palette + dominant-stat wash) and `.tutorial`
  spotlight scrim + caption.
- **`audio.js` loads before `game.js`** in `index.html` (mirrors the
  `cards.js → game.js` contract); `game.js` degrades via optional chaining.

## Build order

0. **Shared scaffolding** (one commit, unblocks all three): meta fields +
   `loadMeta` veteran-suppression; `state.beatPaused`/`beatTimer`/`forceTutorial`;
   `#beat` + `#tutorial` DOM + `$()` wiring; `touchend` exempt list; empty
   `audio.js` + `<script>` before `game.js`; `sw.js` `CACHE` v2→v3 + append
   `./audio.js`.
1. **Consequence beat** — `showConsequenceBeat`/`hideBeat` + template + neutral /
   effective-delta handling; authored `choice.outcome` (bosses first); replace the
   normal tail; `beatPaused` guard; teardown wiring; reduced-motion skip; `.beat`
   CSS + dominant-stat wash + staged animation.
2. **Audio engine** — source the CC0/public-domain samples into `saptaloka/audio/`
   (license-checked, logged in `CREDITS.md`); build `audio.js`
   (context+master+synth primitives+sample loader/decoder+cue table with a per-cue
   synth fallback), unlock listeners, two synced toggles + persistence,
   optional-chained `play()` calls at
   swipe/commit/stat/big-hit/danger/death/win/ascend/boss/button/upgrade; append
   the files to `sw.js` `ASSETS`. Beat + tutorial cues layered last.
3. **First-run tutorial** — `#tutorial` coachmark layer, 8 steps reusing
   `STAT_INFO`, gesture-gated step 2, spotlight scrim, Skip/Escape/keyboard + focus
   management, reduced-motion static path, replay wiring, write `tutorialSeen` on
   complete-or-skip, entry in the opening `playCutscene(0)` onDone.
4. **Integration pass + playtest** — one full 47-encounter run: at-most-one-gate
   per swipe, per-swipe audio not fatiguing, tutorial fires once for new players /
   suppressed for veterans, offline reload serves v3. Tune `BEAT_MS`, master
   volume, the auto-quicken threshold. Confirm SR single-write + reduced-motion
   across all three.

## Verification

- Engine sim (the existing `/tmp`-style harness): every `ripens.card` still
  resolves to a `tag:'karma'` card; no orphan/unscheduled payoffs; the beat does
  not perturb draw order.
- Beat: no double-advance; `then`-chain still draws; realm-complete branch never
  shows a beat; all-zero (empty-fx + fully-absorbed) hits the neutral line;
  function-fx (`snake_charmer.right`) text matches the rolled effect.
- Tutorial: fires once for a fresh `localStorage`; suppressed when `runs > 0`;
  replay works without clearing the flag; keyboard + SR path voices all 4 fatal
  facts.
- Audio: silent until first gesture; truly silent when muted; no orphan cue on a
  dropped stale fly-off; `game.js` runs unchanged if `audio.js` is absent; every
  recorded cue falls back to synth when its sample is missing/undecoded; all bundled
  samples are CC0/public-domain (logged in `CREDITS.md`).
- Offline (best-effort, no longer required): bump verified — a returning player
  gets the v3 build and the game still loads with no network; a first-ever offline
  visit may lack samples and falls back to synth without error.

## Out of scope (future)

- A full melodic **music bed** (the heavier "all recorded" option) — the hybrid
  ships only a light drone; a bed can be added later as another sample.
- Spoken **voice narration** (recorded VO) — left as an opt-in `meta.audio.voice`
  hook, default off (screen-reader collision risk).
- Bespoke per-choice animated cutscenes beyond the authored text lines.
- Per-stat or per-realm leitmotif music beds.
