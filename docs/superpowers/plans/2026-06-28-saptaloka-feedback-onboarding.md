# Saptaloka Feedback & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add animated consequence beats after each swipe, a first-run coachmark tutorial, and a hybrid (recorded-sample + synth) audio engine to the Saptaloka game.

**Architecture:** Pure static, no build. New globals follow the existing `cards.js → game.js` "module via `window.*`" idiom: `beat.js` (pure consequence-text logic, unit-tested with `node --test`) and `audio.js` (`window.SaptalokaAudio`). `game.js` (one IIFE) owns all DOM/animation/timer/tutorial code and calls the new globals defensively (`window.X?.fn?.()`). Script load order becomes `cards.js → beat.js → audio.js → game.js`.

**Tech Stack:** Vanilla ES (browser), WebAudio API, `node:test`/`node:assert` for logic tests (Node ≥18; this repo has v26). No npm deps, no bundler, no `package.json`.

**Spec:** `docs/superpowers/specs/2026-06-28-saptaloka-feedback-onboarding-design.md`

**Working dir for all paths:** repo root `/Users/dhanjit/Code/games/.claude/worktrees/interesting-carson-14a0e5`. Game files live in `saptaloka/`.

**How to run the game locally (for every manual-verify step):**
```bash
cd /Users/dhanjit/Code/games/.claude/worktrees/interesting-carson-14a0e5
python3 -m http.server 8080
# open http://localhost:8080/saptaloka/
```
To force a fresh first-run state in the browser console: `localStorage.removeItem('saptaloka.meta.v1')` then reload.

**Testing philosophy for this repo:** Pure logic (the consequence-text template) gets real TDD via `node --test`. DOM / animation / audio / localStorage behavior has no headless harness here, so those tasks use explicit, scripted **manual verification** (exact steps + expected observation) — this matches the repo's documented "/tmp-style sim" practice. Never claim a manual step passed without actually observing it.

---

## File structure (what each file owns)

| File | New/Mod | Responsibility |
|------|---------|----------------|
| `saptaloka/beat.js` | **New** | Pure: produce the consequence sentence from a choice + effective deltas + card. No DOM. `window.SaptalokaBeat`. |
| `saptaloka/test/beat.test.js` | **New** | `node --test` unit tests for `beat.js`. |
| `saptaloka/audio.js` | **New** | `window.SaptalokaAudio`: lazy AudioContext, synth primitives, sample loader, cue table + per-cue synth fallback, enable/volume + persistence. |
| `saptaloka/audio/` | **New** | CC0 sample files + `CREDITS.md`. |
| `saptaloka/game.js` | Mod | meta fields, state flags, `showConsequenceBeat`/`hideBeat`, audio `play()` hooks, two audio toggles, tutorial controller, wiring. |
| `saptaloka/cards.js` | Mod | optional `outcome:` lines on boss + karma-payoff choices. |
| `saptaloka/index.html` | Mod | `#beat` + `#tutorial` DOM, audio toggle buttons, script tags (order). |
| `saptaloka/style.css` | Mod | `.beat` family (+ dominant-stat wash, staged anim, reduced-motion), `.tutorial` spotlight + caption. |
| `saptaloka/sw.js` | Mod | `CACHE` v2→v3; append `beat.js`, `audio.js`, `audio/*` to `ASSETS`. |

---

## Phase 0 — Shared scaffolding

One commit at the end. Unblocks all three features. No behavior change yet.

### Task 0.1: Add meta fields + veteran-suppression migration

**Files:**
- Modify: `saptaloka/game.js` (`defaultMeta` ~L11-17, `loadMeta` ~L19-25)

- [ ] **Step 1: Add the two new fields to `defaultMeta`.** Replace the current `defaultMeta`:

```js
  const defaultMeta = () => ({
    punya: 0,                 // currency
    levels: {},               // upgradeId -> level
    bestRealm: 0,
    runs: 0,
    moksha: 0,
    tutorialSeen: false,      // first-run coachmark tutorial shown?
    audio: { enabled: true, volume: 0.6 },  // global sound pref (NOT per-run)
  });
```

- [ ] **Step 2: Add the veteran-suppression line to `loadMeta`.** Replace `loadMeta`:

```js
  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return defaultMeta();
      const m = Object.assign(defaultMeta(), JSON.parse(raw));
      // Existing players (have run history) are treated as already onboarded.
      // Only applies to saves predating tutorialSeen (where JSON had no such key).
      if (!('tutorialSeen' in JSON.parse(raw))) m.tutorialSeen = (m.runs || 0) > 0;
      // `audio` may be a partial/old object; ensure both keys exist.
      m.audio = Object.assign({ enabled: true, volume: 0.6 }, m.audio || {});
      return m;
    } catch (e) { return defaultMeta(); }
  }
```

- [ ] **Step 3: Manual verify (no behavior change, no crash).** Run the server, open the game, open devtools console:
  - `localStorage.removeItem('saptaloka.meta.v1')`, reload → console: no errors; the title screen renders.
  - In console after load is not directly possible (meta is IIFE-private) — instead verify indirectly in Task 3.2. For now confirm the page still loads and plays one swipe without error.

  Expected: game loads and is playable; no console errors.

### Task 0.2: Add state flags

**Files:**
- Modify: `saptaloka/game.js` (`state` object ~L114-132)

- [ ] **Step 1: Add three fields** to the `state` object literal, after `cutscenePaused: false,`:

```js
    cutscenePaused: false,
    beatPaused: false,      // consequence beat is showing (gates new swipes; distinct from cutscenePaused)
    beatTimer: null,        // auto-advance setTimeout id for the beat
    forceTutorial: false,   // transient: replay the tutorial for one run without clearing meta.tutorialSeen
```

- [ ] **Step 2: Manual verify.** Reload the game; play one swipe. Expected: no change in behavior, no errors.

### Task 0.3: Add `#beat` + `#tutorial` DOM, cache them, and exempt from zoom guard

**Files:**
- Modify: `saptaloka/index.html` (after the `#cutscene` `</section>`, ~L126; and inside `<main id="stage">`)
- Modify: `saptaloka/game.js` (`$()` cache block ~L66-109; `touchend` exempt list ~L979)

- [ ] **Step 1: Add the `#beat` overlay inside `#stage`** (so it layers over the card). Insert just before the closing `</main>` (after the `#hint` div, ~L70):

```html
      <!-- Consequence beat: animated "what happened" after a swipe. Decorative (aria-hidden);
           #statAnnounce remains the single screen-reader source. Auto-advances; tap to skip. -->
      <div id="beat" class="beat hidden" aria-hidden="true">
        <div class="beat-inner">
          <p class="beat-text" id="beatText"></p>
          <div class="beat-deltas" id="beatDeltas"></div>
        </div>
      </div>
```

- [ ] **Step 2: Add the `#tutorial` overlay** as a sibling after the `#cutscene` `</section>` (~L126):

```html
    <!-- First-run coachmark tutorial. Spotlights the real board; its own dialog/live captions. -->
    <section id="tutorial" class="tutorial hidden" role="dialog" aria-modal="true"
             aria-labelledby="tutCaption" tabindex="-1">
      <div class="tut-scrim" id="tutScrim"></div>
      <div class="tut-hole" id="tutHole" aria-hidden="true"></div>
      <div class="tut-caption" id="tutCaption" tabindex="-1"></div>
      <button class="tut-skip" id="tutSkip">Skip</button>
      <div class="tut-hint" id="tutHint" aria-hidden="true"></div>
    </section>
```

- [ ] **Step 3: Cache the new elements** in the `$()` block in `game.js` (add after the `csNarration` line ~L109):

```js
  const beatEl       = $('beat');
  const beatText     = $('beatText');
  const beatDeltas   = $('beatDeltas');
  const tutorial     = $('tutorial');
  const tutScrim     = $('tutScrim');
  const tutHole      = $('tutHole');
  const tutCaption   = $('tutCaption');
  const tutSkip      = $('tutSkip');
  const tutHint      = $('tutHint');
```

- [ ] **Step 4: Exempt `#beat` and `#tutorial` from the iOS double-tap-zoom guard.** In the `touchend` listener (~L979), extend the `closest()` exempt check:

```js
    if (e.target.closest('.stat') || e.target.closest('#statInfo') || e.target.closest('#cutscene')
        || e.target.closest('#beat') || e.target.closest('#tutorial')) { lastTap = now; return; }
```

- [ ] **Step 5: Manual verify.** Reload. Expected: page loads, no errors; `#beat` and `#tutorial` are present but hidden (`display:none` via `.hidden`); game plays normally.

### Task 0.4: Create `beat.js` + `audio.js` stubs, wire script order, bump SW

**Files:**
- Create: `saptaloka/beat.js`, `saptaloka/audio.js`
- Modify: `saptaloka/index.html` (script tags ~L132-133)
- Modify: `saptaloka/sw.js` (`CACHE` L11, `ASSETS` L12+)

- [ ] **Step 1: Create `saptaloka/beat.js` stub** (UMD so it loads in the browser as `window.SaptalokaBeat` and in Node as `module.exports`):

```js
// Saptaloka — pure consequence-text logic (no DOM). Used by game.js; unit-tested by node --test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SaptalokaBeat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function outcomeText(/* choice, deltas, card */) { return ''; }
  return { outcomeText };
});
```

- [ ] **Step 2: Create `saptaloka/audio.js` stub** (no-op API so `game.js` hooks are safe before the real engine lands):

```js
// Saptaloka — hybrid audio (recorded samples + WebAudio synth). window.SaptalokaAudio.
(function () {
  'use strict';
  window.SaptalokaAudio = {
    unlock() {},
    play() {},
    isEnabled() { return false; },
    setEnabled() {},
    toggle() { return false; },
    setVolume() {},
  };
})();
```

- [ ] **Step 3: Update script order in `index.html`.** Replace the two existing game `<script>` tags (~L132-133):

```html
  <script src="cards.js"></script>
  <script src="beat.js"></script>
  <script src="audio.js"></script>
  <script src="game.js"></script>
```

- [ ] **Step 4: Bump SW cache and append assets.** In `saptaloka/sw.js`, change L11:

```js
const CACHE = 'saptaloka-v3';
```

  and add to the `ASSETS` array (after `'./game.js',`):

```js
  './game.js',
  './beat.js',
  './audio.js',
```

  (Audio sample files are appended in Task 2.3.)

- [ ] **Step 5: Manual verify.** Reload with devtools Network tab. Expected: `beat.js` and `audio.js` load (200), no console errors, game plays. In console: `typeof window.SaptalokaBeat` → `"object"`, `typeof window.SaptalokaAudio.play` → `"function"`.

- [ ] **Step 6: Commit Phase 0.**

```bash
git add saptaloka/game.js saptaloka/index.html saptaloka/beat.js saptaloka/audio.js saptaloka/sw.js
git commit -m "feat(saptaloka): scaffolding for beats, tutorial, audio (meta, state, DOM, SW v3)"
```

---

## Phase 1 — Consequence beat

### Task 1.1: `beat.js` pure consequence-text logic (TDD)

**Files:**
- Modify: `saptaloka/beat.js`
- Create: `saptaloka/test/beat.test.js`

- [ ] **Step 1: Write the failing test file** `saptaloka/test/beat.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const beat = require('../beat.js');

const card = { id: 'village_widow', speaker: 'A village widow' };
const Z = { prana: 0, tejas: 0, karma: 0, bhakti: 0 };

test('authored outcome is returned verbatim', () => {
  const choice = { label: 'x', outcome: 'A hand-written line.' };
  assert.strictEqual(beat.outcomeText(choice, { karma: 5 }, card), 'A hand-written line.');
});

test('all-zero deltas give the neutral line', () => {
  assert.strictEqual(
    beat.outcomeText({ label: 'Walk past' }, Z, card),
    'You let the moment pass — nothing in you shifts.'
  );
});

test('missing/undefined deltas treated as zero -> neutral, never throws', () => {
  assert.strictEqual(
    beat.outcomeText({ label: 'x' }, {}, card),
    'You let the moment pass — nothing in you shifts.'
  );
});

test('dominant clause reflects the dominant axis + direction', () => {
  // karma is the only mover -> a karma-up clause must appear, no other stat clause
  const s = beat.outcomeText({ label: 'Sit and chant' }, { karma: 6 }, card);
  assert.match(s, /ledger of your deeds tips toward the light|dharma settles more firmly on your side/);
});

test('tie-break prefers karma over a larger prana drain', () => {
  // prana -8 is bigger in magnitude, but the moral axis leads
  const s = beat.outcomeText({ label: 'x' }, { prana: -8, karma: 4 }, card);
  assert.match(s, /ledger of your deeds|dharma settles/);
});

test('opposite-sign secondary >=3 adds one counter-clause; <3 does not', () => {
  const withCounter = beat.outcomeText({ label: 'x' }, { karma: 6, tejas: -4 }, card);
  assert.match(withCounter, /, but /);
  const noCounter = beat.outcomeText({ label: 'x' }, { karma: 6, tejas: -2 }, card);
  assert.doesNotMatch(noCounter, /, but /);
});

test('big magnitude gets the intensifier', () => {
  const s = beat.outcomeText({ label: 'x' }, { prana: -19 }, card);
  assert.match(s, /^Sharply — /);
});

test('deterministic: same inputs -> same output', () => {
  const a = beat.outcomeText({ label: 'Sit and chant' }, { karma: 4, tejas: -4 }, card);
  const b = beat.outcomeText({ label: 'Sit and chant' }, { karma: 4, tejas: -4 }, card);
  assert.strictEqual(a, b);
});

test('uses passed deltas, not choice.fx (function fx is never invoked)', () => {
  let called = false;
  const choice = { label: 'Let him play', fx: () => { called = true; return { tejas: 50 }; } };
  const s = beat.outcomeText(choice, { bhakti: 12, prana: -10 }, card);
  assert.strictEqual(called, false);
  assert.match(s, /heart bends closer to the divine|devotion swells/);
});
```

- [ ] **Step 2: Run the tests, verify they fail.**

Run: `cd saptaloka && node --test`
Expected: FAIL (stub returns `''`).

- [ ] **Step 3: Implement `beat.js`.** Replace the factory body:

```js
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATS = ['prana', 'tejas', 'karma', 'bhakti'];
  // Tie-break for the dominant axis: the moral spine first, so a body-cost
  // prana drain never buries the meaningful karma/bhakti move.
  const DOMINANCE = ['karma', 'bhakti', 'tejas', 'prana'];

  const LEX = {
    prana:  { up: ['life floods back into your limbs', 'your breath steadies and deepens'],
              dn: ['the climb takes its toll on your body', 'your breath thins and your limbs grow heavy'] },
    tejas:  { up: ['an inner fire flares brighter', 'your radiance sharpens to an edge'],
              dn: ['the glow within you dims', 'your inner fire gutters low'] },
    karma:  { up: ['the ledger of your deeds tips toward the light', 'dharma settles more firmly on your side'],
              dn: ['a shadow falls across your deeds', 'the weight of the deed darkens your ledger'] },
    bhakti: { up: ['your heart bends closer to the divine', 'devotion swells warm in your chest'],
              dn: ['the thread of devotion frays', 'your heart turns cold to the gods'] },
  };

  // FNV-1a — deterministic, so a given card always reads the same line.
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pick(arr, seed) { return arr[seed % arr.length]; }
  function clause(stat, dir, seed) { return pick(LEX[stat][dir], seed); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  function dominantAxis(d) {
    let best = null, bestAbs = 0;
    for (const s of DOMINANCE) { const a = Math.abs(d[s] || 0); if (a > bestAbs) { bestAbs = a; best = s; } }
    return best; // null if all zero
  }
  // Largest opposite-sign secondary with |delta| >= 3.
  function secondaryOpposite(d, dom) {
    const domSign = Math.sign(d[dom]);
    let best = null, bestAbs = 2;
    for (const s of STATS) {
      if (s === dom) continue;
      const v = d[s] || 0;
      if (v !== 0 && Math.sign(v) === -domSign && Math.abs(v) > bestAbs) { bestAbs = Math.abs(v); best = s; }
    }
    return best;
  }
  function speakerLead(card, seed) {
    const sp = (card && card.speaker) ? card.speaker : '';
    if (!sp) return '';
    return pick([sp + ' watches as ', 'Before ' + sp + ', ', 'With ' + sp + ' looking on, '], seed);
  }

  function outcomeText(choice, deltas, card) {
    if (choice && typeof choice.outcome === 'string' && choice.outcome) return choice.outcome;
    const d = deltas || {};
    const dom = dominantAxis(d);
    if (!dom) return 'You let the moment pass — nothing in you shifts.';

    const seed = (hashStr((card && card.id) || 'x') ^ hashStr((choice && choice.label) || 'y')) >>> 0;
    const main = clause(dom, d[dom] > 0 ? 'up' : 'dn', seed);
    const sec = secondaryOpposite(d, dom);
    const counter = sec ? (', but ' + clause(sec, d[sec] > 0 ? 'up' : 'dn', seed >>> 3)) : '';
    const lead = speakerLead(card, seed);

    let core = lead + main + counter + '.';
    if (!lead) core = cap(core);

    const mag = Math.abs(d[dom]);
    if (mag >= 12) return 'Sharply — ' + (lead ? core : lower(core));
    if (mag <= 2)  return 'Faintly, ' + (lead ? core : lower(core));
    return core;
  }

  return { outcomeText };
});
```

- [ ] **Step 4: Run the tests, verify they pass.**

Run: `cd saptaloka && node --test`
Expected: PASS (all tests, 0 failures).

- [ ] **Step 5: Commit.**

```bash
git add saptaloka/beat.js saptaloka/test/beat.test.js
git commit -m "feat(saptaloka): consequence-text engine (beat.js) + node:test suite"
```

### Task 1.2: Wire the beat into `game.js`

**Files:**
- Modify: `saptaloka/game.js` (`commitChoice` normal tail ~L626-629; `onPointerDown` ~L807; `startRun` ~L497; menu abandon ~L900; new functions near `playCutscene` ~L574)

- [ ] **Step 1: Add a `deltasFrom` helper and refactor `deltaText` to use it.** Find `deltaText` (~L670) and replace it with:

```js
  // Effective post-applyFx deltas as an object (used by the beat and by deltaText).
  function deltasFrom(before) {
    const d = {};
    for (const s of STATS) d[s] = state[s] - (before ? before[s] : state[s]);
    return d;
  }

  function deltaText(before) {
    if (!before) return '';
    const names = { prana: 'Prāṇa', tejas: 'Tejas', karma: 'Karma', bhakti: 'Bhakti' };
    const d = deltasFrom(before);
    const parts = [];
    for (const s of STATS) { if (d[s]) parts.push(`${names[s]} ${d[s] > 0 ? '+' : ''}${d[s]}`); }
    return parts.join(', ');
  }
```

- [ ] **Step 2: Add `BEAT_MS`, `showConsequenceBeat`, `hideBeat`** right after `playCutscene` (~L574). `STAT_INFO` (with `.glyph`) is defined above this point, so it is in scope.

```js
  // ---------- Consequence beat ----------
  // A short animated "what happened" shown after a normal (non-end, non-realm-complete)
  // swipe. Auto-advances; an early tap/click/key skips it. Decorative (aria-hidden) —
  // the #statAnnounce live region remains the single screen-reader source, written once
  // in onDone. Under reduced motion the visual is skipped and onDone fires immediately.
  // Auto-advance is a fallback for when the player doesn't tap, so it must be long
  // enough to READ the line (scaled to its length). Tapping always skips immediately.
  function beatDuration(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    let ms = 700 + words * 200;
    ms = Math.max(1500, Math.min(5500, ms));
    if (meta.runs > 0) ms = Math.max(1100, Math.round(ms * 0.7)); // veterans: a touch quicker
    return ms;
  }

  function hideBeat() {
    if (state.beatTimer) { clearTimeout(state.beatTimer); state.beatTimer = null; }
    state.beatPaused = false;
    beatEl.classList.add('hidden');
    beatEl.classList.remove('play');
  }

  function washColor(d, dom) {
    if (!dom) return 'var(--bg-2)';
    if (dom === 'prana' && d.prana < 0) return 'var(--crimson)';
    return `var(--stat-${dom})`;
  }

  function showConsequenceBeat(choice, before, onDone) {
    const d = deltasFrom(before);
    let dom = null, domAbs = 0;
    for (const s of ['karma', 'bhakti', 'tejas', 'prana']) {
      const a = Math.abs(d[s]); if (a > domAbs) { domAbs = a; dom = s; }
    }
    const text = (window.SaptalokaBeat && window.SaptalokaBeat.outcomeText)
      ? window.SaptalokaBeat.outcomeText(choice, d, state.currentCard)
      : '';

    // Skip the visual beat under reduced motion OR while the tutorial overlay is up
    // (the tutorial's own spotlights explain the first swipe; a beat would sit behind it).
    if (REDUCED_MOTION || (tutorial && !tutorial.classList.contains('hidden'))) {
      Promise.resolve().then(onDone); return;
    }

    let done = false;
    const finish = () => {
      if (done) return; done = true;
      beatEl.removeEventListener('pointerdown', finish);
      beatEl.removeEventListener('click', finish);
      beatEl.removeEventListener('keydown', onKey);
      hideBeat();
      onDone();
    };
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); finish(); }
    };

    state.beatPaused = true;
    closeStatInfo();
    beatText.textContent = text;
    beatDeltas.innerHTML = '';
    for (const s of STATS) {
      if (!d[s]) continue;
      const chip = document.createElement('span');
      chip.className = 'beat-delta ' + (d[s] > 0 ? 'up' : 'dn');
      chip.textContent = `${STAT_INFO[s].glyph} ${d[s] > 0 ? '+' : ''}${d[s]}`;
      beatDeltas.appendChild(chip);
    }
    beatEl.style.setProperty('--wash', washColor(d, dom));
    beatEl.classList.remove('hidden', 'play');
    void beatEl.offsetWidth;
    beatEl.classList.add('play');
    window.SaptalokaAudio?.play?.('beat');

    beatEl.addEventListener('pointerdown', finish);
    beatEl.addEventListener('click', finish);
    beatEl.addEventListener('keydown', onKey);
    state.beatTimer = setTimeout(finish, beatDuration(text));
  }
```

- [ ] **Step 3: Replace the `commitChoice` normal tail** (~L626-629). Find:

```js
    renderHud();
    floatDeltas(before);
    announceDeltas(before);
    drawNextCard();
  }
```

  Replace with:

```js
    renderHud();
    floatDeltas(before);
    showConsequenceBeat(choice, before, () => { announceDeltas(before); drawNextCard(); });
  }
```

- [ ] **Step 4: Block swipes while the beat shows.** In `onPointerDown` (~L808), extend the guard:

```js
    if (!state.inRun || state.cutscenePaused || state.beatPaused) return;
```

- [ ] **Step 5: Teardown on run reset / abandon.** In `startRun` (~L497), add `hideBeat();` right after `state.inRun = true;`. In the `menuBtn` abandon branch (~L900, inside the `if (confirm(...))`), add `hideBeat();` before `state.inRun = false;`.

- [ ] **Step 6: Manual verify (the headline feature).** Reload, start a run, swipe a normal card.
  - Expected: card flies off, the HUD numbers float, then the `#beat` panel fades in over the stage with a one-line sentence + colored delta chips, tinted toward the dominant stat's color; after ~1.1s (first run) it disappears and the next card draws.
  - Tap the beat early → it skips immediately and the next card draws (exactly once — no skipped/double card).
  - Swipe a card that completes a realm (last pip) → you get the realm **cutscene**, NOT a beat (no double gate).
  - DevTools console: no errors. Set `prefers-reduced-motion` (DevTools → Rendering → Emulate CSS prefers-reduced-motion: reduce), reload, swipe → no beat panel, game advances immediately, still playable.

- [ ] **Step 7: Commit.**

```bash
git add saptaloka/game.js
git commit -m "feat(saptaloka): show animated consequence beat after each swipe"
```

### Task 1.3: `.beat` styles, dominant-stat wash, staged animation

**Files:**
- Modify: `saptaloka/style.css` (append a new block; reference existing vars `--bg-0/1/2`, `--ink`, `--emerald`, `--crimson`, `--stat-*`)

- [ ] **Step 1: Append the beat styles** to `style.css`:

```css
/* ---------- Consequence beat ---------- */
.beat {
  position: absolute;
  left: 0; right: 0; top: 0; bottom: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  z-index: 8;                 /* above .card (~7), below #statInfo (10) and #cutscene */
  pointer-events: auto;
}
.beat.hidden { display: none; }
.beat-inner {
  --wash: var(--bg-2);
  max-width: 84%;
  background: color-mix(in srgb, var(--wash) 24%, rgba(8, 4, 14, 0.92));
  border: 1px solid color-mix(in srgb, var(--wash) 55%, var(--bg-2));
  border-radius: 14px;
  padding: 16px 18px;
  text-align: center;
}
.beat-text {
  margin: 0;
  color: var(--ink);
  font-style: italic;
  line-height: 1.5;
  font-size: 16px;
}
.beat-deltas { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 12px; }
.beat-delta {
  font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 20px;
  border: 1px solid currentColor;
}
.beat-delta.up { color: var(--emerald); }
.beat-delta.dn { color: var(--crimson); }

/* Staged entrance, gated behind .play (matching the .cutscene pattern). */
.beat .beat-inner { opacity: 0; }
.beat.play .beat-inner   { animation: beatIn 0.42s cubic-bezier(.2,.8,.3,1) forwards; }
.beat.play .beat-text    { animation: beatRise 0.5s ease-out 0.06s forwards; opacity: 0; }
.beat.play .beat-deltas  { animation: beatRise 0.5s ease-out 0.22s forwards; opacity: 0; }
@keyframes beatIn   { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes beatRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .beat.play .beat-inner, .beat.play .beat-text, .beat.play .beat-deltas { animation: none; opacity: 1; }
}
```

  Note: `.beat-inner` uses the `--wash` custom property set inline by `showConsequenceBeat`. `color-mix` is supported in all current evergreen browsers (Saptaloka already targets modern ES). If you must support a very old engine, replace the two `color-mix(...)` with `rgba(8,4,14,0.92)` / `var(--bg-2)` and drop the tint.

- [ ] **Step 2: Manual verify.** Reload, swipe. Expected: the panel animates in (fade+rise), text then chips stagger in, the panel tint shifts with the dominant stat (swipe a prāṇa-draining choice → reddish; a bhakti gain → violet). Under emulated reduced-motion: panel appears instantly, no animation, content visible.

- [ ] **Step 3: Commit.**

```bash
git add saptaloka/style.css
git commit -m "style(saptaloka): consequence beat panel, dominant-stat wash, staged animation"
```

### Task 1.4: Author `choice.outcome` lines (karma payoffs)

**Files:**
- Modify: `saptaloka/cards.js` (add `outcome:` to the karma-payoff choices)

**CORRECTION to the spec's "bosses + karma" framing (verified against `commitChoice`):** a boss is always a realm's **last step**, so committing a boss takes the **realm-complete → `playCutscene`** branch and **never reaches the beat**. The realm cutscene already narrates the boss outcome (`CUTSCENES[]`, e.g. "The buffalo-demon falls behind you…"). So **do NOT author boss `outcome` lines — they would be dead content.** Author only the **10 karma-payoff cards** (`tag: 'karma'`, 20 choices): these are drawn mid-realm via the karma queue, fire through the normal tail, show the beat, and are literal callbacks to an earlier deed — exactly where a bespoke line beats the template. Everything else rides the template.

Authored lines are second-person, ~12–22 words, in the established `card.text` / `CUTSCENES` voice, naming the returning deed. Add `outcome: '...'` as a sibling of `fx`/`label`. The field is optional and ignored by everything except `beat.js`.

- [ ] **Step 1: Identify the target choices.** List the karma-payoff cards and read each one's `text`/`speaker`/`left`/`right` so the line fits what the choice actually does:

```bash
cd saptaloka && node -e "global.window={};require('./cards.js');const{CARDS}=window.SAPTALOKA;const t=CARDS.filter(c=>c.tag==='karma');console.log(t.map(c=>c.id).join('\n'));console.log('count:',t.length)"
```

Expected: 10 karma cards (20 choices). Author `outcome` on **both** `left` and `right` of each — each side reflects that choice's direction. Cross-reference each card with the deed that schedules it (search `ripens: { card: '<id>'` in `cards.js`) so the callback is specific.

- [ ] **Step 2: Write the lines.** Worked exemplars (use verbatim where ids match; write the rest in the same voice):

```js
// beggar_blessing (karma payoff of giving alms — the grateful return):
outcome: 'The beggar you once fed is no beggar — a deva in rags. His blessing settles on you like warm rain, long after you had forgotten the coin.',
// well_demon.left ('Face it now' — the abandoned child's grief, returned):
outcome: 'The thing you abandoned in the well has grown monstrous on a child\'s grief — but you stand and face it now, and a long-owed debt is paid.',
```

  For each remaining karma choice, write one line that names the returning deed and frames the dominant effect as story (not numbers). Do **not** reference exact stat numbers.

- [ ] **Step 3: Verify the data still loads and authored text wins over the template.** Run (pick any karma card you authored):

```bash
cd saptaloka && node --check cards.js && node -e "
global.window={}; require('./cards.js'); const beat=require('./beat.js');
const {CARDS}=window.SAPTALOKA;
const c=CARDS.find(x=>x.id==='beggar_blessing');
console.log('left :', beat.outcomeText(c.left,  {karma:1}, c));
console.log('right:', beat.outcomeText(c.right, {karma:1}, c));
"
```

Expected: prints the authored lines verbatim (proving authored text beats the template). Also confirm `node -e "...filter(c=>c.tag==='karma')...every choice has outcome..."` (every karma choice now has a string `outcome`).

- [ ] **Step 4: Manual verify in game (deferred to Unit 9 human playtest).** Karma payoff cards fire mid-realm, so their beat shows the authored line. Cannot be browser-verified by a headless agent — note it for the human playtest.

- [ ] **Step 5: Commit.**

```bash
git add saptaloka/cards.js
git commit -m "content(saptaloka): authored consequence lines for karma-payoff cards"
```

---

## Phase 2 — Audio (hybrid: synth first, samples layered)

Build the synth engine + controls first so audio ships even with zero samples; add CC0 samples last with a per-cue fallback.

### Task 2.1: `audio.js` synth engine + persistence

**Files:**
- Modify: `saptaloka/audio.js` (replace the stub)

- [ ] **Step 1: Implement the engine.** Replace `audio.js` entirely:

```js
// Saptaloka — hybrid audio (WebAudio synth now; recorded samples layered in Task 2.3).
// window.SaptalokaAudio. Never throws into the game loop: all play() paths are guarded.
(function () {
  'use strict';

  const KEY = 'saptaloka.meta.v1';
  function readPref() {
    try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); return Object.assign({ enabled: true, volume: 0.6 }, m.audio || {}); }
    catch (e) { return { enabled: true, volume: 0.6 }; }
  }
  function writePref(p) {
    try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); m.audio = p; localStorage.setItem(KEY, JSON.stringify(m)); }
    catch (e) {}
  }

  let pref = readPref();
  let ctx = null, master = null;

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = pref.enabled ? pref.volume : 0;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function resumeIfNeeded() { if (ctx && ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} } }

  // ---- synth primitives ----
  function tone(freq, dur, type, peak, when) {
    const t0 = (when || ctx.currentTime);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noiseBurst(dur, filterFreq, peak) {
    const t0 = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain(); g.gain.value = peak || 0.2;
    src.connect(f); f.connect(g); g.connect(master); src.start(t0);
  }
  function chord(freqs, dur, type, peak) { freqs.forEach((f) => tone(f, dur, type, peak)); }

  // ---- cue table (synth implementations; Task 2.3 may override with samples) ----
  const STAT_PITCH = { prana: 196, tejas: 330, karma: 262, bhakti: 392 };
  const CUES = {
    drag()        { tone(180, 0.10, 'sine', 0.06); },
    commit()      { tone(140, 0.08, 'triangle', 0.18); noiseBurst(0.05, 900, 0.08); },
    statGain(o)   { tone(STAT_PITCH[o && o.stat] || 262, 0.18, 'sine', 0.16); },
    statLoss(o)   { const f = STAT_PITCH[o && o.stat] || 262; tone(f, 0.20, 'sine', 0.16); tone(f * 0.84, 0.22, 'sine', 0.10); },
    bigHit()      { chord([523, 659, 784], 0.6, 'sine', 0.12); },
    danger()      { tone(110, 0.5, 'sawtooth', 0.08); tone(116, 0.5, 'sawtooth', 0.06); },
    beat()        { tone(330, 0.4, 'sine', 0.05); },
    tutorialStep(){ tone(523, 0.18, 'sine', 0.14); },
    tutorialStat(o){ tone(STAT_PITCH[o && o.stat] || 262, 0.35, 'sine', 0.18); },
    ascend(o)     { const base = 262 + 16 * ((o && o.realm) || 0); chord([base, base * 1.5], 0.9, 'sine', 0.12); noiseBurst(0.5, 2200, 0.06); },
    boss()        { chord([110, 117, 156], 0.7, 'sawtooth', 0.10); },
    death()       { tone(196, 1.2, 'sine', 0.16); tone(146, 1.4, 'sine', 0.12); },
    win()         { chord([262, 330, 392, 523], 2.2, 'sine', 0.14); },
    button()      { tone(440, 0.06, 'triangle', 0.10); },
    upgrade()     { tone(523, 0.10, 'triangle', 0.14); tone(784, 0.14, 'triangle', 0.10); },
  };

  function play(name, opts) {
    if (!pref.enabled) return;
    if (!ensureCtx()) return;
    resumeIfNeeded();
    const fn = CUES[name];
    if (!fn) return;
    try { fn(opts || {}); } catch (e) {}
  }

  // ---- unlock on first gesture (autoplay policy) ----
  function unlock() { if (ensureCtx()) resumeIfNeeded(); }
  const onceUnlock = () => { unlock(); window.removeEventListener('pointerdown', onceUnlock, true);
    window.removeEventListener('touchend', onceUnlock, true); window.removeEventListener('keydown', onceUnlock, true); };
  window.addEventListener('pointerdown', onceUnlock, true);
  window.addEventListener('touchend', onceUnlock, true);
  window.addEventListener('keydown', onceUnlock, true);

  window.SaptalokaAudio = {
    unlock,
    play,
    isEnabled() { return !!pref.enabled; },
    setEnabled(v) { pref.enabled = !!v; writePref(pref); if (master) master.gain.value = pref.enabled ? pref.volume : 0; },
    toggle() { this.setEnabled(!pref.enabled); return pref.enabled; },
    setVolume(v) { pref.volume = Math.max(0, Math.min(1, v)); writePref(pref); if (master && pref.enabled) master.gain.value = pref.volume; },
  };
})();
```

- [ ] **Step 2: Manual verify.** Reload. In console: `SaptalokaAudio.isEnabled()` → `true`. Click "Begin Ascent", then `SaptalokaAudio.play('win')` in console → you hear a chord. `SaptalokaAudio.toggle()` → `false`; `play('win')` → silent. `toggle()` → `true` again. Reload → still enabled (persisted). Expected: no console errors; sound only after a user gesture.

- [ ] **Step 3: Commit.**

```bash
git add saptaloka/audio.js
git commit -m "feat(saptaloka): WebAudio synth engine, cue table, mute/volume persistence"
```

### Task 2.2: Hook `play()` calls + two synced toggles into `game.js`

**Files:**
- Modify: `saptaloka/game.js` (multiple sites); `saptaloka/index.html` (HUD + title buttons); `saptaloka/style.css` (minor)

- [ ] **Step 1: Add the toggle buttons to `index.html`.** In the HUD, add beside `#menuBtn` (~L58):

```html
      <button id="soundBtn" class="icon-btn" aria-label="Sound on/off" aria-pressed="true">♪</button>
      <button id="menuBtn" class="icon-btn" aria-label="Menu">☰</button>
```

  On the title screen, add after the `rulesBtn` (~L82):

```html
      <button class="ghost" id="soundBtnTitle">Sound: On</button>
```

- [ ] **Step 2: Cache + wire the toggles** in `game.js` (`$()` block, then near the other button bindings ~L878). Add to the cache block:

```js
  const soundBtn      = $('soundBtn');
  const soundBtnTitle = $('soundBtnTitle');
```

  Add a render + binding (place near `showTitle`):

```js
  function renderSound() {
    const on = window.SaptalokaAudio?.isEnabled?.() ?? false;
    if (soundBtn) { soundBtn.textContent = on ? '♪' : '♪̸'; soundBtn.setAttribute('aria-pressed', String(on)); }
    if (soundBtnTitle) soundBtnTitle.textContent = on ? 'Sound: On' : 'Sound: Off';
  }
  function toggleSound() {
    const on = window.SaptalokaAudio?.toggle?.() ?? false;
    if (on) window.SaptalokaAudio?.play?.('button');
    renderSound();
  }
  soundBtn?.addEventListener('click', toggleSound);
  soundBtnTitle?.addEventListener('click', toggleSound);
```

  Call `renderSound();` once inside `showTitle()` (so the title button label is correct on load).

- [ ] **Step 3: Add `play()` hooks at game events** (all optional-chained; add at these existing sites):
  - In `flyOff` (~L858), at the top: `window.SaptalokaAudio?.play?.('commit');`
  - In `onPointerMove` (~L827), where `show-left`/`show-right` toggle first crosses threshold — gate a debounced drag pluck. Simplest: add a module-level `let draggedCue = false;` reset in `onPointerDown` (`draggedCue = false;`) and in `onPointerMove` when `Math.abs(t) > 0.15 && !draggedCue` → `draggedCue = true; window.SaptalokaAudio?.play?.('drag');`.
  - In `commitChoice`, in the `flashStat` loop (~L598-600), play per-stat gain/loss: replace that loop with:

```js
    const dlt = deltasFrom(before);
    for (const s of STATS) {
      if (!dlt[s]) continue;
      if (Math.abs(dlt[s]) >= 10) { flashStat(s, dlt[s] > 0 ? 'up' : 'dn'); window.SaptalokaAudio?.play?.('bigHit'); }
      window.SaptalokaAudio?.play?.(dlt[s] > 0 ? 'statGain' : 'statLoss', { stat: s });
    }
```

  - **Danger on transition only:** at the end of `renderHud` loop where `danger` class is toggled (~L235), track prior state. Add a module-level `const prevDanger = { prana:false, tejas:false, karma:false, bhakti:false };` and inside the loop:

```js
      const isDanger = state[s] <= 15 || state[s] >= 85;
      statEls[s].classList.toggle('danger', isDanger);
      if (isDanger && !prevDanger[s]) window.SaptalokaAudio?.play?.('danger');
      prevDanger[s] = isDanger;
```

  - In `playCutscene` (~L558, where it un-hides), add: `window.SaptalokaAudio?.play?.('ascend', { realm: realmIdx });`
  - In `renderCard` (~L247), when `c.tag === 'boss'`: `window.SaptalokaAudio?.play?.('boss');`
  - In `endRun` (~L711), after computing `e`: `window.SaptalokaAudio?.play?.(e.kind === 'win' ? 'win' : 'death');`
  - In `buyUpgrade` (~L766), after success: `window.SaptalokaAudio?.play?.('upgrade');`
  - In `startBtn` handler / `startRun`: `window.SaptalokaAudio?.unlock?.();` at the top of `startRun` (guarantees the context resumes on the first "Begin Ascent").

- [ ] **Step 4: Manual verify.** Reload, play. Expected: tap "Begin Ascent" (unlock); dragging a card gives a soft pluck; committing gives a "tak"; stat changes give pitched cues (karma vs bhakti audibly different); a ≥10 swing adds a bell swell; crossing into ≤15/≥85 plays a low drone once (not every subsequent swipe); realm cutscene plays an ascend cue; the sound button toggles all of it and persists across reload. The per-stat pitches are the audible "identity" the tutorial will reuse.

- [ ] **Step 5: Commit.**

```bash
git add saptaloka/game.js saptaloka/index.html saptaloka/style.css
git commit -m "feat(saptaloka): wire audio cues to game events + synced sound toggles"
```

### Task 2.3: Source CC0 samples + per-cue fallback

**Files:**
- Create: `saptaloka/audio/*.ogg` (+ `.m4a`), `saptaloka/audio/CREDITS.md`
- Modify: `saptaloka/audio.js` (sample loader + override cues), `saptaloka/sw.js` (append assets)

Target samples (CC0 / public-domain only): `ghanta.ogg` (temple bell), `conch.ogg` (śaṅkha), `drone.ogg` (tanpura, short loopable), `om.ogg` (OM chant), `boss.ogg` (low gong/cluster), `death.ogg` (somber), each ≤~100 KB, plus `.m4a` siblings for Safari.

- [ ] **Step 1: Source the files.** Find CC0/public-domain clips (e.g. Freesound filtered to CC0, Wikimedia Commons PD). For each, record source URL + license in `saptaloka/audio/CREDITS.md`:

```markdown
# Saptaloka audio credits

All files are CC0 / public domain (no attribution required; store-safe).

| file | source | license |
|------|--------|---------|
| ghanta.ogg | <url> | CC0 |
| conch.ogg  | <url> | CC0 |
| drone.ogg  | <url> | CC0 |
| om.ogg     | <url> | CC0 |
| boss.ogg   | <url> | CC0 |
| death.ogg  | <url> | CC0 |
```

  If a good CC0 file can't be found for a given cue, **skip it** — that cue keeps its synth implementation (Task 2.1). Document which were skipped.

- [ ] **Step 2: Add the sample loader to `audio.js`.** Inside the IIFE, after `chord(...)`, add:

```js
  // ---- recorded samples (best-effort; every sample-backed cue keeps a synth fallback) ----
  const SAMPLES = { ghanta: null, conch: null, drone: null, om: null, boss: null, death: null };
  const SAMPLE_SRC = {
    ghanta: 'audio/ghanta', conch: 'audio/conch', drone: 'audio/drone',
    om: 'audio/om', boss: 'audio/boss', death: 'audio/death',
  };
  function loadSample(name) {
    if (!ctx || SAMPLES[name] === 'loading') return;
    SAMPLES[name] = 'loading';
    const base = SAMPLE_SRC[name];
    const url = (ctx.createBuffer && new Audio().canPlayType('audio/ogg') ? base + '.ogg' : base + '.m4a');
    fetch(url).then((r) => r.ok ? r.arrayBuffer() : Promise.reject())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { SAMPLES[name] = buf; })
      .catch(() => { SAMPLES[name] = null; });  // stays on synth fallback
  }
  function playSample(name, peak) {
    const buf = SAMPLES[name];
    if (!buf || buf === 'loading') return false;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = peak || 1;
    src.connect(g); g.connect(master); src.start();
    return true;
  }
```

  In `unlock()`, after `resumeIfNeeded()`, kick off loads: `Object.keys(SAMPLE_SRC).forEach(loadSample);`

- [ ] **Step 3: Make sample-backed cues prefer the sample, fall back to synth.** Edit those `CUES` entries so each tries the sample first:

```js
    bigHit()  { if (!playSample('ghanta', 0.6)) chord([523, 659, 784], 0.6, 'sine', 0.12); },
    ascend(o) { if (!playSample('conch', 0.7)) { const base = 262 + 16 * ((o && o.realm) || 0); chord([base, base*1.5], 0.9, 'sine', 0.12); } },
    boss()    { if (!playSample('boss', 0.8)) chord([110, 117, 156], 0.7, 'sawtooth', 0.10); },
    death()   { if (!playSample('death', 0.8)) { tone(196, 1.2, 'sine', 0.16); tone(146, 1.4, 'sine', 0.12); } },
    win()     { if (!playSample('om', 0.9)) chord([262, 330, 392, 523], 2.2, 'sine', 0.14); },
```

  (`drone` can be layered under `danger` similarly if a clip is found; otherwise leave the synth drone.)

- [ ] **Step 4: Append sample files to `sw.js` `ASSETS`** (only the files you actually added):

```js
  './audio/ghanta.ogg', './audio/conch.ogg', './audio/drone.ogg',
  './audio/om.ogg', './audio/boss.ogg', './audio/death.ogg',
```

  The existing `sw.js` install (L26-29) is `cache.addAll(ASSETS)`, which rejects the **whole** install if any one URL 404s — fatal if an audio file is missing. Replace that handler exactly:

```js
self.addEventListener('install', (event) => {
  self.skipWaiting();
  const CORE = ASSETS.filter((u) => !u.startsWith('./audio/'));
  const OPTIONAL = ASSETS.filter((u) => u.startsWith('./audio/'));
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(CORE);                                  // required — fail install if these fail
      await Promise.allSettled(OPTIONAL.map((u) => cache.add(u))); // audio — best-effort, never fatal
    })
  );
});
```

- [ ] **Step 5: Manual verify.**
  - With samples present: reload, Begin Ascent, trigger a ≥10 swing → ghanta sample (not synth bell); reach a realm cutscene → conch; win → OM. Network tab shows the audio files fetched once.
  - Fallback: temporarily rename `audio/om.ogg`, reload, win → you still hear the synth chord, no console error, no broken SW.
  - Offline: load once (caches), go offline (DevTools → Network → Offline), reload → game loads, cached samples still play; uncached/missing → synth fallback, no error.

- [ ] **Step 6: Commit.**

```bash
git add saptaloka/audio.js saptaloka/audio/ saptaloka/sw.js
git commit -m "feat(saptaloka): CC0 audio samples with per-cue synth fallback; best-effort precache"
```

---

## Phase 3 — First-run tutorial

### Task 3.1: Tutorial controller + styles

**Files:**
- Modify: `saptaloka/game.js` (new tutorial section near `playCutscene`)
- Modify: `saptaloka/style.css` (`.tutorial` styles)

The controller lives in `game.js` because it needs IIFE-private access to `state`, `STAT_INFO`, `statEls`, `realmProg`, `card`, and `closeStatInfo`.

- [ ] **Step 1: Add the tutorial controller** to `game.js` (after `showConsequenceBeat`/`hideBeat`):

```js
  // ---------- First-run coachmark tutorial ----------
  // Teaches the swipe + the 4 virtues against the REAL board. Step 2 is gesture-gated:
  // the player's real swipe is also their first choice. Copy for the stat steps is pulled
  // verbatim from STAT_INFO (one source of truth). Its own dialog captions voice for SR;
  // #statAnnounce is left for deltas.
  let tutOnComplete = null, tutIdx = 0, tutSteps = [];

  function buildTutSteps() {
    const statStep = (s) => ({
      anchor: () => statEls[s],
      text: `${STAT_INFO[s].glyph} ${STAT_INFO[s].title} — ${STAT_INFO[s].oneLiner}`,
      cue: () => window.SaptalokaAudio?.play?.('tutorialStat', { stat: s }),
    });
    return [
      { anchor: null, text: 'You are a soul at the foot of the worlds. Climb the seven realms — Bhūloka to Satyaloka — and break the wheel of saṃsāra to win mokṣa.' },
      { anchor: () => card, text: 'Each encounter is a choice. Swipe or drag the card left or right — the labels show what each side does. Try it now.', gesture: true },
      { anchor: () => statsEl, text: 'These four virtues are your life. Every choice shifts them — let any one reach its fatal edge and the run ends. Here is what each means.' },
      statStep('prana'), statStep('tejas'), statStep('karma'), statStep('bhakti'),
      { anchor: () => realmProg, text: 'Each realm ends in a boss. Climb all seven to reach Satyaloka. Tip: tap any virtue any time to recall what it does.' },
    ];
  }

  function spotlight(el) {
    if (!el) { tutHole.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    const pad = 8;
    tutHole.style.display = 'block';
    tutHole.style.left = (r.left - pad) + 'px';
    tutHole.style.top = (r.top - pad) + 'px';
    tutHole.style.width = (r.width + pad * 2) + 'px';
    tutHole.style.height = (r.height + pad * 2) + 'px';
  }

  function renderTutStep() {
    const step = tutSteps[tutIdx];
    spotlight(step.anchor ? step.anchor() : null);
    tutCaption.textContent = step.text;
    tutHint.textContent = step.gesture ? 'swipe the card' : 'tap to continue';
    tutSkip.style.display = (tutIdx === 1) ? 'none' : 'block';  // don't cover the gesture step
    tutorial.classList.toggle('gesture', !!step.gesture);
    if (step.cue) step.cue(); else window.SaptalokaAudio?.play?.('tutorialStep');
    tutCaption.focus();
  }

  function tutAdvance() {
    if (tutIdx >= tutSteps.length - 1) return endTutorial(false);
    tutIdx++;
    renderTutStep();
  }

  function startTutorial(onComplete) {
    tutOnComplete = onComplete;
    tutSteps = buildTutSteps();
    tutIdx = 0;
    closeStatInfo();
    tutorial.classList.remove('hidden');
    renderTutStep();
  }

  // The gesture step's real swipe calls this (from commitChoice) instead of tap-advance.
  function tutNotifySwipe() {
    if (tutorial.classList.contains('hidden')) return false;
    if (!tutSteps[tutIdx] || !tutSteps[tutIdx].gesture) return false;
    tutAdvance();
    return true;
  }

  function endTutorial(skipped) {
    tutorial.classList.add('hidden');
    tutorial.classList.remove('gesture');
    meta.tutorialSeen = true; saveMeta();
    const cb = tutOnComplete; tutOnComplete = null;
    if (cb) cb();
  }

  // Tap / keyboard advance — but NOT on the gesture step (there the card swipe advances).
  tutorial.addEventListener('click', (e) => {
    if (e.target === tutSkip) return;             // handled below
    const step = tutSteps[tutIdx];
    if (step && step.gesture) return;             // let the swipe through to #card
    tutAdvance();
  });
  tutorial.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); endTutorial(true); return; }
    const step = tutSteps[tutIdx];
    if ((e.key === 'Enter' || e.key === ' ') && !(step && step.gesture)) { e.preventDefault(); tutAdvance(); }
  });
  tutSkip.addEventListener('click', (e) => { e.stopPropagation(); endTutorial(true); });
```

  Note: `statsEl` is already cached (`const statsEl = document.querySelector('.stats');` ~L98). `realmProg` and `card` are cached. Confirm these names match before use.

- [ ] **Step 2: Make the gesture step's pointer events reach the card.** The `#tutorial` section sits above `#card` (z-9 vs ~z-7), so on the gesture step the **entire** overlay must become non-blocking — setting `pointer-events:none` only on the scrim is not enough, the section itself still hit-tests. `renderTutStep` toggles the `gesture` class on `#tutorial`; the CSS (next step) sets `.tutorial.gesture { pointer-events: none; }` so the real swipe reaches the card. Skip is hidden on that step; advance happens via the swipe; Escape still skips (keydown is unaffected by `pointer-events`).

- [ ] **Step 3: Hook the gesture step into `commitChoice`.** At the very top of `commitChoice` (after the stale-drop guard ~L579), the real first swipe should both commit AND advance the tutorial. Since `tutNotifySwipe` only advances (doesn't block the commit), add right after `state.runEncounters++` is NOT needed — instead call it where the swipe is known to have committed. Add at the end of the **normal tail**, before `showConsequenceBeat`, so the beat still shows for the first swipe:

  Actually simplest and race-free: call `tutNotifySwipe()` inside `onPointerUp`'s commit branch is wrong (commit is async). Instead, in `showConsequenceBeat`'s `onDone` is too late. **Chosen hook:** in `commitChoice`, immediately after `const choice = …; const before = …; applyFx(fx);` add:

```js
    if (!tutorial.classList.contains('hidden')) tutNotifySwipe();
```

  This advances the tutorial off the gesture step the moment the first real choice commits; the normal tail then shows the beat as usual. (On non-gesture steps `tutNotifySwipe` is a no-op because input is blocked by the scrim, so a swipe can't reach `commitChoice` anyway.)

- [ ] **Step 4: Add `.tutorial` styles** to `style.css`:

```css
/* ---------- First-run tutorial ---------- */
.tutorial { position: absolute; inset: 0; z-index: 9; }
.tutorial.hidden { display: none; }
.tut-scrim { position: absolute; inset: 0; background: rgba(8, 4, 14, 0.72); }
.tutorial.gesture { pointer-events: none; }            /* let the real swipe reach #card */
.tutorial.gesture .tut-scrim { background: rgba(8, 4, 14, 0.45); }
.tut-hole {
  position: absolute; border-radius: 12px; pointer-events: none;
  box-shadow: 0 0 0 9999px rgba(8, 4, 14, 0.72), 0 0 18px 4px var(--gold);
  border: 2px solid var(--gold); transition: all 0.25s ease;
}
.tutorial.gesture .tut-hole { box-shadow: 0 0 22px 6px var(--gold); }
.tut-caption {
  position: absolute; left: 50%; bottom: 18%; transform: translateX(-50%);
  max-width: 80%; background: var(--bg-1); border: 1px solid var(--gold-deep);
  border-radius: 12px; padding: 14px 16px; color: var(--ink); font-size: 16px;
  line-height: 1.5; text-align: center; outline: none;
}
.tut-hint { position: absolute; left: 50%; bottom: 11%; transform: translateX(-50%);
  color: var(--gold); font-size: 13px; opacity: 0.8; letter-spacing: 0.08em; }
.tut-skip { position: absolute; top: calc(env(safe-area-inset-top, 0) + 12px); right: 14px;
  background: transparent; border: 1px solid var(--ink-dim); color: var(--ink-dim);
  border-radius: 16px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .tut-hole { transition: none; box-shadow: 0 0 0 9999px rgba(8,4,14,0.72), 0 0 0 2px var(--gold); }
}
```

- [ ] **Step 5: Manual verify (deferred entry wiring is Task 3.2).** Temporarily call `startTutorial(()=>{})` from the console after starting a run is not possible (private). Instead verify after Task 3.2 wires entry. For now, confirm no syntax errors: reload, `node --check saptaloka/game.js` passes, game still plays.

```bash
node --check saptaloka/game.js && echo OK
```

- [ ] **Step 6: Commit.**

```bash
git add saptaloka/game.js saptaloka/style.css
git commit -m "feat(saptaloka): first-run coachmark tutorial controller + spotlight styles"
```

### Task 3.2: Tutorial entry, replay link, veteran suppression

**Files:**
- Modify: `saptaloka/game.js` (`startRun` opening cutscene onDone ~L514; `renderRules` ~L406)

- [ ] **Step 1: Gate entry in `startRun`.** Find the opening cutscene call (~L514):

```js
    playCutscene(0, () => { drawNextCard(); });
```

  Replace with:

```js
    const runTutorial = !meta.tutorialSeen || state.forceTutorial;
    state.forceTutorial = false;
    playCutscene(0, () => {
      if (runTutorial) startTutorial(() => { drawNextCard(); });
      else drawNextCard();
    });
```

  So: opening cutscene → (tutorial if first-run/forced) → first card. On the gesture step, the first card is already drawn? No — `drawNextCard` runs in the tutorial's `onComplete`. But the gesture step needs a real card to swipe. **Fix the order:** draw the first card BEFORE the tutorial so step 2 has a live card:

```js
    playCutscene(0, () => {
      drawNextCard();
      if (runTutorial) startTutorial(() => {});   // tutorial overlays the live first card
    });
```

  Now `commitChoice`'s `tutNotifySwipe()` advances off the gesture step when the player swipes that first real card. The tutorial's `onComplete` is a no-op because the card is already in play.

- [ ] **Step 2: Add the replay link** inside `renderRules` (~L406). Find the closing `rule-hint` line and add a replay control before it:

```js
      `<p class="rule-hint">Tip: ${STAT_HOVER ? 'hover' : 'tap'} any virtue in the top bar to recall what it does.</p>` +
      `<p class="rule-replay"><button type="button" id="replayTut" class="linklike">Replay the tutorial</button></p>`;
```

  After setting `rulesBody.innerHTML`, bind it (add at the end of `renderRules`):

```js
    const rt = document.getElementById('replayTut');
    if (rt) rt.addEventListener('click', () => {
      state.forceTutorial = true;
      hideRules();
      if (!state.inRun) startRun();
      else showToast('Tutorial will replay on your next ascent.');
    });
```

  Add a minimal `.linklike` style to `style.css`:

```css
.linklike { background: none; border: none; color: var(--gold); text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
```

- [ ] **Step 3: Manual verify — new player.** Console: `localStorage.removeItem('saptaloka.meta.v1')`, reload, Begin Ascent.
  - Expected: opening cutscene → tutorial welcome → swipe step (real card visible, ghost hint, swiping advances AND commits the first choice + shows its beat) → all-stats spotlight → 4 per-stat spotlights (each plays that stat's audio pitch; copy matches `STAT_INFO`) → realm-pips step → tap finishes; play continues normally.
  - Skip button (any non-gesture step) ends it and leaves the card playable.
  - Keyboard: Tab to the overlay, Enter advances, Escape skips. Screen reader (VoiceOver) reads each caption.

- [ ] **Step 4: Manual verify — veteran + replay + persistence.**
  - Reload (now `tutorialSeen` is true) → Begin Ascent → NO tutorial.
  - Open How-to-Play → "Replay the tutorial" → starts a run with the tutorial; finishing/skipping does NOT clear future suppression (reload → still no auto-tutorial).
  - Simulate a veteran with old save: console `localStorage.setItem('saptaloka.meta.v1', JSON.stringify({runs:5}))`, reload, Begin Ascent → NO tutorial (veteran suppression via `loadMeta`).

- [ ] **Step 5: Commit.**

```bash
git add saptaloka/game.js saptaloka/style.css
git commit -m "feat(saptaloka): tutorial entry, How-to-Play replay link, veteran suppression"
```

---

## Phase 4 — Integration pass + playtest

### Task 4.1: Full-run verification, karma sim, tuning

**Files:**
- Verify only; tune constants in `game.js`/`audio.js` if needed.

- [ ] **Step 1: Karma engine sim (no perturbation).** The beat only time-shifts `drawNextCard`; confirm draw invariants still hold with a sim:

```bash
cd saptaloka && node -e "
global.window={}; require('./cards.js'); const {CARDS}=window.SAPTALOKA;
const karma=CARDS.filter(c=>c.tag==='karma').map(c=>c.id);
let bad=[];
for(const c of CARDS) for(const side of ['left','right']){
  const ch=c[side]; if(ch&&ch.ripens&&!karma.includes(ch.ripens.card)) bad.push(c.id+'.'+side+' -> '+ch.ripens.card);
}
console.log(bad.length? 'ORPHAN ripens:\n'+bad.join('\n') : 'OK: every ripens.card resolves to a tag:karma card');
"
```

  Expected: `OK: every ripens.card resolves to a tag:karma card`.

- [ ] **Step 2: Run the beat unit tests once more.**

Run: `cd saptaloka && node --test`
Expected: PASS, 0 failures.

- [ ] **Step 3: Full play-through checklist.** Start a run and (using the Mirror to buy upgrades or temporarily shortening `REALMS` lengths, then reverting) reach at least one realm boundary and one death:
  - At most one gate per swipe — a realm-completing swipe shows the cutscene, never a beat+cutscene stack.
  - Per-swipe audio is pleasant, not fatiguing (tune `peak` values / `beatDuration()` if it grates).
  - Beat auto-quickens: do a full run to a death, then start run 2 → beats are noticeably shorter (`meta.runs > 0`).
  - `then`-chained cards still draw after their beat; karma payoff cards still appear and show authored lines.
  - Reduced-motion: beats and tutorial spotlight collapse to static; everything still advances and announces.

- [ ] **Step 4: Offline + cache verification.** Load the game, then DevTools → Application → Service Workers: confirm `saptaloka-v3` is active. Go Network → Offline, reload → game loads and plays; cached audio plays, anything uncached falls back to synth with no error.

- [ ] **Step 5: `node --check` all JS.**

```bash
cd saptaloka && for f in game.js cards.js beat.js audio.js sw.js; do node --check $f && echo "$f OK"; done
```

Expected: all OK.

- [ ] **Step 6: Final commit (tuning, if any).**

```bash
git add -A saptaloka
git commit -m "chore(saptaloka): integration tuning for beats, audio, tutorial"
```

---

## Self-review notes (author check against the spec)

- **Spec coverage:** consequence beat (Tasks 1.1–1.4 + audio 2.2 beat cue), tutorial (3.1–3.2), audio hybrid (2.1–2.3), offline-best-effort SW (0.4 + 2.3 split precache), meta additive + veteran suppression (0.1, 3.2), reduced-motion + single live-region write (1.2), no double-advance one-shot guard (1.2), `then`/karma non-perturbation (4.1) — all present.
- **Type/name consistency:** `window.SaptalokaBeat.outcomeText(choice, deltas, card)`, `window.SaptalokaAudio.play(name, opts)` / `isEnabled` / `toggle` / `setEnabled` / `setVolume` / `unlock`, `deltasFrom(before)`, `showConsequenceBeat`/`hideBeat`/`beatDuration`, `startTutorial`/`tutNotifySwipe`/`endTutorial` — used consistently across tasks. DOM ids match between `index.html` and the `$()` cache.
- **No placeholders:** every code step shows full code; content task (1.4) gives exemplars + an exact target list + a verification command rather than a vague "write lines".
- **Known adaptation:** `sw.js` install handler edit (2.3 Step 4) must be fitted to the file's actual current handler shape — read it first.
