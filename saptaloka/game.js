// Saptaloka — game engine.
// Reigns-style card swipe rogue-like, mythology-themed, mobile-first.

(() => {
  const { REALMS, CARDS, CUTSCENES } = window.SAPTALOKA;
  const STATS = ['prana', 'tejas', 'karma', 'bhakti'];

  // ---------- Persistent meta-progression ----------

  const META_KEY = 'saptaloka.meta.v1';
  const defaultMeta = () => ({
    punya: 0,                 // currency
    levels: {},               // upgradeId -> level
    bestRealm: 0,
    runs: 0,
    moksha: 0,
  });

  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return defaultMeta();
      return Object.assign(defaultMeta(), JSON.parse(raw));
    } catch (e) { return defaultMeta(); }
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
  }

  const UPGRADES = [
    { id: 'lotus_cushion', glyph: '❤', name: 'Lotus Cushion',
      desc: 'Begin each ascent with +6 Prāṇa per level.',
      costs: [10, 15, 25, 40, 60],
      apply: (s, lvl) => { s.prana += 6 * lvl; } },
    { id: 'inner_flame', glyph: '✸', name: 'Inner Flame',
      desc: 'Begin each ascent with +6 Tejas per level.',
      costs: [10, 15, 25, 40, 60],
      apply: (s, lvl) => { s.tejas += 6 * lvl; } },
    { id: 'true_compass', glyph: '☸', name: 'True Compass',
      desc: 'Begin each ascent with +6 Karma per level.',
      costs: [10, 15, 25, 40, 60],
      apply: (s, lvl) => { s.karma += 6 * lvl; } },
    { id: 'open_heart', glyph: '✿', name: 'Open Heart',
      desc: 'Begin each ascent with +6 Bhakti per level.',
      costs: [10, 15, 25, 40, 60],
      apply: (s, lvl) => { s.bhakti += 6 * lvl; } },
    { id: 'sages_eye', glyph: '👁', name: "Sage's Eye",
      desc: 'See exact stat changes as you swipe.',
      costs: [25],
      apply: (s, lvl) => { s.preview = true; } },
    { id: 'second_breath', glyph: '🌬', name: 'Second Breath',
      desc: 'Once per run, survive a fatal blow with 1 Prāṇa.',
      costs: [50],
      apply: (s, lvl) => { s.secondBreath = true; } },
    { id: 'devotees_grace', glyph: '🪷', name: "Devotee's Grace",
      desc: '+1 Puṇya per encounter survived, per level.',
      costs: [20, 35, 60],
      apply: (s, lvl) => { s.graceBonus = lvl; } },
  ];

  function upgradeLevel(id)   { return meta.levels[id] || 0; }
  function upgradeMaxed(u)    { return upgradeLevel(u.id) >= u.costs.length; }
  function nextUpgradeCost(u) {
    const lvl = upgradeLevel(u.id);
    return upgradeMaxed(u) ? null : u.costs[lvl];
  }

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const card        = $('card');
  const cardArt     = $('cardArt');
  const cardSpeaker = $('cardSpeaker');
  const cardText    = $('cardText');
  const choiceLeft  = $('choiceLeft');
  const choiceRight = $('choiceRight');
  const realmName   = $('realmName');
  const realmProg   = $('realmProgress');
  const hint        = $('hint');
  const titleScreen = $('titleScreen');
  const deathScreen = $('deathScreen');
  const mirrorScreen = $('mirrorScreen');
  const victoryScreen = $('victoryScreen');
  const startBtn     = $('startBtn');
  const mirrorBtn    = $('mirrorBtn');
  const closeMirror  = $('closeMirror');
  const reincarnateBtn = $('reincarnateBtn');
  const visitMirrorBtn = $('visitMirrorBtn');
  const victoryBtn   = $('victoryBtn');
  const menuBtn      = $('menuBtn');
  const upgradesEl   = $('upgrades');
  const punyaCount   = $('punyaCount');
  const metaSummary  = $('metaSummary');
  const deathTitle   = $('deathTitle');
  const deathReason  = $('deathReason');
  const deathGlyph   = $('deathGlyph');
  const runStatsEl   = $('runStats');
  const victoryStatsEl = $('victoryStats');
  const victoryReason  = $('victoryReason');
  const toast        = $('toast');
  const statEls      = Object.fromEntries(STATS.map(s => [s, document.querySelector(`.stat[data-stat="${s}"]`)]));
  const statVals     = Object.fromEntries(STATS.map(s => [s, statEls[s].querySelector('.val')]));
  const hud          = $('hud');
  const statsEl      = document.querySelector('.stats');
  const statInfo     = $('statInfo');
  const rulesScreen  = $('rulesScreen');
  const rulesBody    = $('rulesBody');
  const rulesBtn     = $('rulesBtn');
  const closeRules   = $('closeRules');
  const statAnnounce = $('statAnnounce');
  const cutscene     = $('cutscene');
  const csDevanagari = $('csDevanagari');
  const csRoman      = $('csRoman');
  const csMeaning    = $('csMeaning');
  const csNarration  = $('csNarration');

  // ---------- Game state ----------

  let meta = loadMeta();
  const state = {
    inRun: false,
    prana: 50, tejas: 50, karma: 50, bhakti: 50,
    realmIdx: 0,
    realmStep: 0,
    currentCard: null,
    recentIds: [],
    runEncounters: 0,
    runPunya: 0,
    secondBreath: false,
    preview: false,
    graceBonus: 0,
    nextCardOverride: null,
    cutscenePaused: false,
  };

  // ---------- Card selection ----------

  function applyStartingUpgrades() {
    state.preview = false;
    state.secondBreath = false;
    state.graceBonus = 0;
    for (const u of UPGRADES) {
      const lvl = upgradeLevel(u.id);
      if (lvl > 0) u.apply(state, lvl);
    }
  }

  function clamp(v) { return Math.max(0, Math.min(100, v)); }

  function eligibleCards() {
    const realmNum = state.realmIdx + 1;
    return CARDS.filter(card => {
      if (card.tag === 'boss') return false;
      if (card.realmMin && realmNum < card.realmMin) return false;
      if (card.realmMax && realmNum > card.realmMax) return false;
      if (state.recentIds.includes(card.id)) return false;
      return true;
    });
  }

  function pickRandomCard() {
    if (state.nextCardOverride) {
      const id = state.nextCardOverride;
      state.nextCardOverride = null;
      const found = CARDS.find(c => c.id === id);
      if (found) return found;
    }
    const pool = eligibleCards();
    if (pool.length === 0) {
      // Fallback: forget recent
      state.recentIds = [];
      return CARDS.find(c => c.tag !== 'boss') || CARDS[0];
    }
    const totalWeight = pool.reduce((s, c) => s + (c.weight || 1), 0);
    let r = Math.random() * totalWeight;
    for (const card of pool) {
      r -= (card.weight || 1);
      if (r <= 0) return card;
    }
    return pool[pool.length - 1];
  }

  function pickBossForRealm(realmNum) {
    return CARDS.find(c => c.tag === 'boss' && c.realm === realmNum);
  }

  function rememberCard(id) {
    state.recentIds.push(id);
    while (state.recentIds.length > 7) state.recentIds.shift();
  }

  // ---------- UI rendering ----------

  function renderHud() {
    closeStatInfo();
    const r = REALMS[state.realmIdx];
    realmName.textContent = r.name;
    realmProg.innerHTML = '';
    const total = r.length;
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip';
      if (i < state.realmStep) pip.classList.add('done');
      else if (i === state.realmStep) pip.classList.add('now');
      if (i === total - 1) pip.classList.add('boss');
      realmProg.appendChild(pip);
    }
    for (const s of STATS) {
      statVals[s].textContent = state[s];
      statEls[s].classList.remove('preview-up', 'preview-dn');
      statEls[s].removeAttribute('data-delta');
      statEls[s].classList.toggle('danger', state[s] <= 15 || state[s] >= 85);
    }
  }

  function renderCard(c) {
    state.currentCard = c;
    cardArt.textContent     = c.art || '◌';
    cardSpeaker.textContent = c.speaker || '';
    cardText.textContent    = c.text || '';
    choiceLeft.textContent  = c.left?.label || '←';
    choiceRight.textContent = c.right?.label || '→';
    card.classList.remove('boss', 'god', 'show-left', 'show-right');
    if (c.tag === 'boss') card.classList.add('boss');
    if (c.tag === 'god')  card.classList.add('god');
    card.style.transition = 'none';
    card.style.transform = 'translate(0, 80px) scale(0.96) rotate(0deg)';
    card.style.opacity = '0';
    void card.offsetWidth;
    card.style.transition = 'transform 0.35s cubic-bezier(.2,.9,.3,1.2), opacity 0.3s';
    card.style.transform = 'translate(0, 0) scale(1) rotate(0deg)';
    card.style.opacity = '1';
  }

  function showToast(msg, ms = 2200) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), ms);
  }

  // ---------- Stat info (hover on desktop, tap to toggle on touch) ----------
  // Copy MUST stay accurate to checkEnd(): tejas dies at 0 AND 100; karma/bhakti
  // hit 100 as an early-mokṣa WIN; prāṇa dies only at 0 and caps at 100.

  const STAT_INFO = {
    prana: {
      glyph: '❤︎',
      title: 'Prāṇa — life force',
      oneLiner: 'The only "more is better" virtue.',
      detail: 'Your vital breath. At 0 your prāṇa fails and the wheel claims you — Second Breath can postpone that once per run. It caps at 100 and any excess is simply held, never fatal. The one virtue where a big gain is purely good.',
    },
    tejas: {
      glyph: '✸',
      title: 'Tejas — divine radiance',
      oneLiner: 'Both extremes are fatal.',
      detail: 'Sacred fire — the radiant splendor of gods and sages, kindled by austerity. At 0 your light dims and you vanish into shadow. At 100 it overflows and you burn yourself away. Fatal at both ends — keep it near the middle, never starved, never over-stoked.',
    },
    karma: {
      glyph: '☸',
      title: 'Karma — moral weight',
      oneLiner: '0 damns you · 100 wins.',
      detail: 'The ledger of your deeds. At 0 sin overtakes you and Yama drags you to Naraka. At 100 you are pure to the marrow and ascend to early mokṣa — an instant win that ends the run before the climb is done.',
    },
    bhakti: {
      glyph: '✿',
      title: 'Bhakti — devotion',
      oneLiner: '0 erases you · 100 deifies you.',
      detail: "The world's love for you. At 0 the world forgets you and no one chants your name. At 100 devotion consumes you and you become a deity — an early mokṣa, your story complete.",
    },
  };

  // Use hover only on a true pointer with NO touch. Phones and hybrid touch+mouse
  // laptops both report (any-pointer: coarse), so they take the tap-to-toggle path
  // — otherwise a finger tap can open but never toggle shut on a hybrid.
  const STAT_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches
                  && !window.matchMedia('(any-pointer: coarse)').matches;
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let openStat = null;

  function positionStatInfo(el) {
    const hudRect = hud.getBoundingClientRect();
    const sRect = el.getBoundingClientRect();
    const pw = statInfo.offsetWidth;
    const center = sRect.left + sRect.width / 2 - hudRect.left;
    let left = center - pw / 2;
    left = Math.max(8, Math.min(left, hudRect.width - pw - 8));
    statInfo.style.left = left + 'px';
    statInfo.style.top = (sRect.bottom - hudRect.top + 8) + 'px';
    // Keep the caret out of the rounded corners when the box clamps to an edge.
    const caret = Math.max(14, Math.min(center - left, pw - 14));
    statInfo.style.setProperty('--caret-x', caret + 'px');
  }

  function openStatInfo(stat, el) {
    const info = STAT_INFO[stat];
    if (!info) return;
    statInfo.className = 'stat-info info-' + stat;
    statInfo.innerHTML =
      `<b>${info.glyph} ${info.title}</b>` +
      `<span class="si-one">${info.oneLiner}</span>` +
      `<p>${info.detail}</p>`;
    statInfo.classList.add('open');
    positionStatInfo(el);
    statInfo.setAttribute('aria-hidden', 'false');
    for (const s of STATS) {
      const on = s === stat;
      statEls[s].setAttribute('aria-expanded', String(on));
      // Tie the live popover text to the stat so a screen reader voices the detail.
      if (on) statEls[s].setAttribute('aria-describedby', 'statInfo');
      else statEls[s].removeAttribute('aria-describedby');
    }
    openStat = stat;
  }

  function closeStatInfo() {
    if (!openStat) return;
    statInfo.classList.remove('open');
    statInfo.setAttribute('aria-hidden', 'true');
    for (const s of STATS) {
      statEls[s].setAttribute('aria-expanded', 'false');
      statEls[s].removeAttribute('aria-describedby');
    }
    openStat = null;
  }

  function toggleStatInfo(stat, el) {
    if (openStat === stat) closeStatInfo();
    else openStatInfo(stat, el);
  }

  // ---------- How to Play ----------

  function fatePills(stat) {
    const pills = {
      prana:  ['<span class="pill death">0 → death</span>', '<span class="pill safe">100 → safe (caps)</span>'],
      tejas:  ['<span class="pill death">0 → death</span>', '<span class="pill death">100 → burnout</span>'],
      karma:  ['<span class="pill death">0 → death</span>', '<span class="pill win">100 → mokṣa</span>'],
      bhakti: ['<span class="pill death">0 → death</span>', '<span class="pill win">100 → mokṣa</span>'],
    };
    return pills[stat].join('');
  }

  function renderRules() {
    const virtues = STATS.map((s) => {
      const info = STAT_INFO[s];
      return (
        `<div class="rule-virtue info-${s}">` +
          `<span class="rv-glyph">${info.glyph}</span>` +
          `<div class="rv-body">` +
            `<div class="rv-title">${info.title}</div>` +
            `<div class="rv-one">${info.oneLiner}</div>` +
            `<div class="rv-pills">${fatePills(s)}</div>` +
          `</div>` +
        `</div>`
      );
    }).join('');
    rulesBody.innerHTML =
      `<section class="rule-sec">` +
        `<h3>The Goal</h3>` +
        `<p>Each encounter, swipe to choose. Every choice shifts your four virtues. Keep all four alive across the seven realms — Bhūloka to Satyaloka — to reach <b>Mokṣa</b>.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>Controls</h3>` +
        `<p>Swipe or click-drag the card <b>left</b> or <b>right</b> — the labels show each choice. Commit past a third of the card's width, or flick it. Unlock the <b>Sage's Eye</b> to preview the stat changes a choice will make — though some fated encounters stay veiled until you commit.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>The Four Virtues</h3>` +
        `<p class="rule-legend"><span class="pill death">death</span><span class="pill safe">safe</span><span class="pill win">win</span></p>` +
        virtues +
        `<p class="rule-note">Two virtues you <i>win</i> by maxing — Karma and Bhakti. One kills you at the top — Tejas burns out. Prāṇa alone is safe when full.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>Realms &amp; Bosses</h3>` +
        `<p>Climb Bhūloka up through Satyaloka. Each realm ends in a <b>boss</b> encounter. Survive all seven to ascend to Mokṣa.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>Between Lives</h3>` +
        `<p>Death keeps the <b>Puṇya</b> you earned. Spend it in the <b>Mirror of Maya</b> on upgrades that carry into every future ascent.</p>` +
      `</section>` +
      `<p class="rule-hint">Tip: ${STAT_HOVER ? 'hover' : 'tap'} any virtue in the top bar to recall what it does.</p>`;
  }

  // ---------- Stat preview & application ----------

  function fxFor(choice) {
    if (!choice) return {};
    const fx = choice.fx;
    return (typeof fx === 'function') ? fx() : (fx || {});
  }

  function showPreview(side) {
    const choice = side === 'left' ? state.currentCard.left : state.currentCard.right;
    const fx = (typeof choice?.fx === 'function') ? null : (choice?.fx || {});

    for (const s of STATS) {
      statEls[s].classList.remove('preview-up', 'preview-dn');
      statEls[s].removeAttribute('data-delta');
    }
    if (!fx || !state.preview) return;
    for (const s of STATS) {
      let d = fx[s];
      if (!d) continue;
      // Prāṇa caps at 100 in applyFx; preview only the deliverable gain so the
      // badge matches the floating delta after commit.
      if (s === 'prana' && d > 0) d = Math.min(d, 100 - state.prana);
      if (!d) continue; // gain fully absorbed by the cap → no badge
      statEls[s].classList.add(d > 0 ? 'preview-up' : 'preview-dn');
      statEls[s].setAttribute('data-delta', (d > 0 ? '+' : '') + d);
    }
  }

  function clearPreview() {
    for (const s of STATS) {
      statEls[s].classList.remove('preview-up', 'preview-dn');
      statEls[s].removeAttribute('data-delta');
    }
  }

  function applyFx(fx) {
    if (!fx) return;
    for (const s of STATS) {
      if (fx[s]) state[s] = state[s] + fx[s];
    }
    // Allow prana > 100 to be clamped (excess life is fine, just capped).
    state.prana = Math.min(100, state.prana);
  }

  function checkEnd() {
    // Prana 0 always dies; Second Breath can save.
    if (state.prana <= 0) {
      if (state.secondBreath) {
        state.secondBreath = false;
        state.prana = 1;
        showToast('Second Breath — death postponed.');
        return null;
      }
      return { kind: 'death', stat: 'prana', reason: 'Your prāṇa fails. The wheel claims you.' };
    }
    if (state.tejas <= 0)  return { kind: 'death', stat: 'tejas',  reason: 'Your inner light dims. You vanish into shadow.' };
    if (state.tejas >= 100) return { kind: 'death', stat: 'tejas',  reason: 'Tejas overflows — you burn yourself away.' };
    if (state.karma <= 0)  return { kind: 'death', stat: 'karma',  reason: 'Sin overtakes you. Yama drags you to Naraka.' };
    if (state.karma >= 100) return { kind: 'moksha-early', stat: 'karma', reason: 'Pure to the marrow — you ascend before the climb is done.' };
    if (state.bhakti <= 0) return { kind: 'death', stat: 'bhakti', reason: 'The world forgets you. No one chants your name.' };
    if (state.bhakti >= 100) return { kind: 'moksha-early', stat: 'bhakti', reason: 'Devotion consumes you — you become a deity, story ended.' };
    return null;
  }

  // ---------- Run flow ----------

  function startRun() {
    state.prana = 50; state.tejas = 50; state.karma = 50; state.bhakti = 50;
    state.realmIdx = 0; state.realmStep = 0;
    state.recentIds = [];
    state.runEncounters = 0;
    state.runPunya = 0;
    state.nextCardOverride = null;
    applyStartingUpgrades();
    state.inRun = true;
    titleScreen.classList.add('hidden');
    deathScreen.classList.add('hidden');
    mirrorScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    rulesScreen.classList.add('hidden');
    renderHud();
    // Opening cutscene; the first card is drawn when the player taps through.
    playCutscene(0, () => { drawNextCard(); });
  }

  function drawNextCard() {
    const realm = REALMS[state.realmIdx];
    const isBoss = state.realmStep >= realm.length - 1;
    const next = isBoss ? pickBossForRealm(state.realmIdx + 1) : pickRandomCard();
    if (!next) {
      // Fallback safety
      console.warn('No card found, using first');
      renderCard(CARDS[0]);
      return;
    }
    rememberCard(next.id);
    renderCard(next);
  }

  // Cinematic realm-entry interstitial. Pauses the swipe, shows the realm's
  // Devanagari name / meaning / narration, and runs onDone (draw next card) only
  // when the player taps. cutscenePaused is set synchronously so a fast finger
  // mid-flyOff can't start a swipe before the veil is up.
  function playCutscene(realmIdx, onDone, announcePrefix) {
    const realm = REALMS[realmIdx];
    const cs = (CUTSCENES && CUTSCENES[realmIdx]) || {};
    state.cutscenePaused = true;
    closeStatInfo();
    csDevanagari.textContent = cs.deva || realm.name;
    csRoman.textContent      = realm.name;
    csMeaning.textContent    = realm.subtitle;
    csNarration.textContent  = cs.narration || '';
    if (statAnnounce) {
      // Fold the boss-kill deltas into the same write so the live region doesn't
      // announce them and then immediately overwrite (they'd never be voiced).
      const lead = announcePrefix ? announcePrefix + '. ' : '';
      statAnnounce.textContent =
        `${lead}Entering ${realm.name}, ${realm.subtitle}. ${cs.narration || ''} Tap to continue.`;
    }
    cutscene.classList.remove('hidden', 'play');
    if (!REDUCED_MOTION) { void cutscene.offsetWidth; cutscene.classList.add('play'); }
    cutscene.focus();
    const dismiss = () => {
      cutscene.removeEventListener('click', dismiss);
      cutscene.removeEventListener('keydown', onKey);
      cutscene.classList.add('hidden');
      cutscene.classList.remove('play');
      state.cutscenePaused = false;
      if (onDone) onDone();
    };
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); dismiss(); }
    };
    cutscene.addEventListener('click', dismiss);
    cutscene.addEventListener('keydown', onKey);
  }

  function commitChoice(side) {
    // Drop a stale fly-off commit queued during another commit's 260ms defer:
    // once the cutscene veil is up (or the run has ended) the card is gone.
    if (state.cutscenePaused || !state.inRun) return;
    const choice = side === 'left' ? state.currentCard.left : state.currentCard.right;
    const fx = fxFor(choice);
    const before = { prana: state.prana, tejas: state.tejas, karma: state.karma, bhakti: state.bhakti };
    applyFx(fx);
    state.runEncounters++;

    // Punya gain
    state.runPunya += 1 + state.graceBonus;

    // Cheap visual feedback for big effects
    for (const s of STATS) {
      if (Math.abs(fx[s] || 0) >= 10) flashStat(s, (fx[s] > 0 ? 'up' : 'dn'));
    }

    const end = checkEnd();
    if (end) {
      if (end.kind === 'death') return endRun(end);
      if (end.kind === 'moksha-early') return endRun({ kind: 'moksha-early', reason: end.reason });
    }

    state.realmStep++;
    const realm = REALMS[state.realmIdx];
    if (state.realmStep >= realm.length) {
      // Realm complete (boss already committed above when drawn).
      state.runPunya += 5;
      if (state.realmIdx + 1 >= REALMS.length) {
        return endRun({ kind: 'moksha', reason: 'You ascend Satyaloka. Liberation is yours.' });
      }
      state.realmIdx++;
      state.realmStep = 0;
      renderHud();
      floatDeltas(before);
      // Ascension cutscene; deltas ride along in its single announcement; the
      // next realm's first card is drawn on tap.
      playCutscene(state.realmIdx, () => { drawNextCard(); }, deltaText(before));
      return;
    }
    renderHud();
    floatDeltas(before);
    announceDeltas(before);
    drawNextCard();
  }

  // Pop the glyph (not the chip) on big hits — scaling the chip would also scale
  // its floating-delta child mid-rise and snap it back when the transform clears.
  function flashStat(s, dir) {
    const g = statEls[s].querySelector('.glyph');
    if (!g) return;
    g.style.transform = 'scale(1.3)';
    setTimeout(() => { g.style.transform = ''; }, 220);
  }

  // Floating combat text: each changed virtue spits its delta out of the number —
  // green and rising for a gain, red and dropping for a loss.
  function floatDelta(s, d) {
    const el = statEls[s];
    const span = document.createElement('span');
    span.className = 'stat-float ' + (d > 0 ? 'up' : 'dn');
    span.textContent = (d > 0 ? '+' : '') + d;
    el.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
    setTimeout(() => { if (span.isConnected) span.remove(); }, 1200); // safety net
    const val = statVals[s];
    val.classList.remove('bump');
    void val.offsetWidth; // restart the pop if it fired last commit
    val.classList.add('bump');
  }

  // `before` is a snapshot of the stats prior to applyFx; we float the EFFECTIVE
  // change (post-clamp) so the rising number always equals the number's real move.
  function floatDeltas(before) {
    if (REDUCED_MOTION || !before) return;
    for (const s of STATS) {
      const d = state[s] - before[s];
      if (d) floatDelta(s, d);
    }
  }

  // Non-visual delta cue for screen-reader and reduced-motion players (the float
  // is motion-only). deltaText builds the string so the cutscene can fold it into
  // its own live-region message instead of clobbering it.
  function deltaText(before) {
    if (!before) return '';
    const names = { prana: 'Prāṇa', tejas: 'Tejas', karma: 'Karma', bhakti: 'Bhakti' };
    const parts = [];
    for (const s of STATS) {
      const d = state[s] - before[s];
      if (d) parts.push(`${names[s]} ${d > 0 ? '+' : ''}${d}`);
    }
    return parts.join(', ');
  }

  function announceDeltas(before) {
    if (!statAnnounce) return;
    statAnnounce.textContent = deltaText(before);
  }

  function endRun(end) {
    closeStatInfo();
    state.inRun = false;
    if (end.kind === 'moksha') {
      meta.moksha = (meta.moksha || 0) + 1;
      state.runPunya += 25;
    }
    meta.punya = (meta.punya || 0) + state.runPunya;
    meta.runs = (meta.runs || 0) + 1;
    meta.bestRealm = Math.max(meta.bestRealm || 0, state.realmIdx + 1);
    saveMeta();

    if (end.kind === 'moksha' || end.kind === 'moksha-early') {
      victoryReason.textContent = end.reason;
      victoryStatsEl.innerHTML = runStatsHtml();
      victoryScreen.classList.remove('hidden');
      return;
    }
    deathGlyph.textContent = '☠';
    deathTitle.textContent = 'The wheel turns again';
    deathReason.textContent = end.reason;
    runStatsEl.innerHTML = runStatsHtml();
    deathScreen.classList.remove('hidden');
  }

  function runStatsHtml() {
    const realmName = REALMS[Math.min(state.realmIdx, REALMS.length - 1)].name;
    return `
      <div>Realm reached</div><div><b>${realmName}</b></div>
      <div>Encounters</div><div><b>${state.runEncounters}</b></div>
      <div>Puṇya earned</div><div><b>${state.runPunya}</b></div>
      <div>Total Puṇya</div><div><b>${meta.punya}</b></div>
    `;
  }

  // ---------- Mirror of Maya ----------

  function renderMirror() {
    punyaCount.textContent = meta.punya;
    upgradesEl.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = upgradeLevel(u.id);
      const cost = nextUpgradeCost(u);
      const maxed = upgradeMaxed(u);
      const div = document.createElement('div');
      div.className = 'upgrade' + (maxed ? ' maxed' : '');
      div.innerHTML = `
        <div class="glyph">${u.glyph}</div>
        <div>
          <div class="name">${u.name}</div>
          <div class="desc">${u.desc}</div>
          <div class="level">Level ${lvl}/${u.costs.length}${maxed ? ' — maxed' : ''}</div>
        </div>
      `;
      const btn = document.createElement('button');
      if (maxed) {
        btn.textContent = '✓';
        btn.disabled = true;
      } else {
        btn.textContent = `${cost} ☸`;
        btn.disabled = meta.punya < cost;
        btn.addEventListener('click', () => buyUpgrade(u));
      }
      div.appendChild(btn);
      upgradesEl.appendChild(div);
    }
  }

  function buyUpgrade(u) {
    const cost = nextUpgradeCost(u);
    if (cost == null || meta.punya < cost) return;
    meta.punya -= cost;
    meta.levels[u.id] = upgradeLevel(u.id) + 1;
    saveMeta();
    renderMirror();
    showToast(`${u.name} → Lv ${meta.levels[u.id]}`);
  }

  function renderMetaSummary() {
    const bestRealm = REALMS[Math.max(0, (meta.bestRealm || 1) - 1)].name;
    metaSummary.innerHTML = `
      <span>Puṇya <b>${meta.punya}</b></span>
      <span>Runs <b>${meta.runs || 0}</b></span>
      <span>Best <b>${meta.bestRealm ? bestRealm : '—'}</b></span>
      <span>Mokṣa <b>${meta.moksha || 0}</b></span>
    `;
  }

  // ---------- Swipe gesture ----------

  let pointer = null;

  function onPointerDown(ev) {
    if (!state.inRun || state.cutscenePaused) return;
    const p = pointFrom(ev);
    pointer = { x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now() };
    card.style.transition = '';
    ev.preventDefault?.();
  }

  function onPointerMove(ev) {
    if (!pointer) return;
    const p = pointFrom(ev);
    pointer.x = p.x; pointer.y = p.y;
    const dx = p.x - pointer.x0;
    const dy = (p.y - pointer.y0) * 0.3;
    const rot = dx / 18;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    const cw = card.offsetWidth;
    const t = Math.max(-1, Math.min(1, dx / (cw * 0.4)));
    card.classList.toggle('show-left',  t < -0.15);
    card.classList.toggle('show-right', t > 0.15);
    if (t < -0.15) showPreview('left');
    else if (t > 0.15) showPreview('right');
    else clearPreview();
    ev.preventDefault?.();
  }

  function onPointerUp(ev) {
    if (!pointer) return;
    const dx = pointer.x - pointer.x0;
    const dt = performance.now() - pointer.t0;
    const vx = dx / Math.max(1, dt);
    const cw = card.offsetWidth;
    const commit = Math.abs(dx) > cw * 0.3 || Math.abs(vx) > 0.6;
    if (commit) {
      const side = dx < 0 ? 'left' : 'right';
      flyOff(side);
    } else {
      card.style.transition = 'transform 0.25s cubic-bezier(.2,.8,.3,1.2)';
      card.style.transform = 'translate(0, 0) rotate(0deg)';
      card.classList.remove('show-left', 'show-right');
      clearPreview();
    }
    pointer = null;
  }

  function pointFrom(ev) {
    if (ev.touches && ev.touches[0]) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    if (ev.changedTouches && ev.changedTouches[0]) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
    return { x: ev.clientX, y: ev.clientY };
  }

  function flyOff(side) {
    const dir = side === 'left' ? -1 : 1;
    const vw = window.innerWidth;
    card.style.transition = 'transform 0.32s ease-out, opacity 0.32s ease-out';
    card.style.transform = `translate(${dir * (vw + 80)}px, 60px) rotate(${dir * 22}deg)`;
    card.style.opacity = '0';
    clearPreview();
    setTimeout(() => commitChoice(side), 260);
  }

  // ---------- Bind events ----------

  card.addEventListener('touchstart', onPointerDown, { passive: false });
  card.addEventListener('touchmove',  onPointerMove,  { passive: false });
  card.addEventListener('touchend',   onPointerUp);
  card.addEventListener('touchcancel', onPointerUp);
  card.addEventListener('mousedown',  onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup',   onPointerUp);

  startBtn.addEventListener('click', startRun);
  reincarnateBtn.addEventListener('click', startRun);
  victoryBtn.addEventListener('click', () => {
    victoryScreen.classList.add('hidden');
    showTitle();
  });

  mirrorBtn.addEventListener('click', () => {
    renderMirror();
    mirrorScreen.classList.remove('hidden');
  });
  visitMirrorBtn.addEventListener('click', () => {
    renderMirror();
    mirrorScreen.classList.remove('hidden');
  });
  closeMirror.addEventListener('click', () => {
    mirrorScreen.classList.add('hidden');
    renderMetaSummary();
  });

  menuBtn.addEventListener('click', () => {
    if (state.inRun) {
      if (confirm('Abandon this ascent? Your earned Puṇya is kept.')) {
        meta.punya = (meta.punya || 0) + state.runPunya;
        saveMeta();
        state.inRun = false;
        showTitle();
      }
    } else {
      showTitle();
    }
  });

  // Stat info: hover on desktop, tap-to-toggle on touch. Stats live in #hud, away
  // from the #card swipe area, so this never interferes with the gesture handlers.
  if (STAT_HOVER) {
    statsEl.addEventListener('mouseover', (e) => {
      const s = e.target.closest('.stat');
      if (s) openStatInfo(s.dataset.stat, s);
    });
    statsEl.addEventListener('mouseout', (e) => {
      const s = e.target.closest('.stat');
      if (s && document.activeElement === s) return; // keyboard focus holds it open
      if (s && !s.contains(e.relatedTarget)) closeStatInfo();
    });
    statsEl.addEventListener('focusin', (e) => {
      const s = e.target.closest('.stat');
      if (s) openStatInfo(s.dataset.stat, s);
    });
    statsEl.addEventListener('focusout', closeStatInfo);
  } else {
    statsEl.addEventListener('click', (e) => {
      const s = e.target.closest('.stat');
      if (!s) return;
      e.stopPropagation();
      toggleStatInfo(s.dataset.stat, s);
    });
  }
  statsEl.addEventListener('keydown', (e) => {
    const s = e.target.closest('.stat');
    if (!s) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleStatInfo(s.dataset.stat, s);
    }
  });
  // Tap/click anywhere outside an open popover dismisses it (touch flow).
  document.addEventListener('pointerdown', (e) => {
    if (!openStat) return;
    if (e.target.closest('.stat') || e.target.closest('#statInfo')) return;
    closeStatInfo();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeStatInfo(); hideRules(); }
  });

  // How to Play. Move focus into the overlay on open and back to the trigger on
  // close so keyboard users aren't left on a control hidden behind the panel.
  let rulesOpener = null;
  rulesBtn.addEventListener('click', () => {
    rulesOpener = document.activeElement;
    renderRules();
    rulesScreen.classList.remove('hidden');
    closeRules.focus();
  });
  function hideRules() {
    if (rulesScreen.classList.contains('hidden')) return;
    rulesScreen.classList.add('hidden');
    if (rulesOpener && rulesOpener.focus) rulesOpener.focus();
    rulesOpener = null;
  }
  closeRules.addEventListener('click', hideRules);

  // Disable double-tap zoom on iOS. Stat / popover taps are exempt: preventing
  // their touchend would suppress the synthesized click that opens/toggles the
  // popover, leaving rapid open→close taps dead. (Zoom on the tiny HUD chips is
  // a non-issue.) We still record lastTap so later taps keep correct timing.
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (e.target.closest('.stat') || e.target.closest('#statInfo') || e.target.closest('#cutscene')) { lastTap = now; return; }
    if (now - lastTap < 350) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // ---------- Boot ----------

  function showTitle() {
    closeStatInfo();
    deathScreen.classList.add('hidden');
    mirrorScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    rulesScreen.classList.add('hidden');
    titleScreen.classList.remove('hidden');
    renderMetaSummary();
  }

  showTitle();
})();
