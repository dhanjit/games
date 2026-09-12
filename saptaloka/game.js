// Saptaloka — game engine.
// Reigns-style card swipe rogue-like, mythology-themed, mobile-first.

(() => {
  const { REALMS, CARDS, CUTSCENES, ENDINGS } = window.SAPTALOKA;
  const Rules = window.SaptalokaRules;   // rules.js — one mechanical rule per realm
  const STATS = ['prana', 'tejas', 'karma', 'bhakti'];

  // ---------- Persistent meta-progression ----------

  const META_KEY = 'saptaloka.meta.v1';
  const defaultMeta = () => ({
    punya: 0,                 // currency
    levels: {},               // upgradeId -> level
    bestRealm: 0,
    runs: 0,
    moksha: 0,
    tutorialSeen: false,      // first-run coachmark tutorial shown?
    dangerTaught: [],         // '<stat>:<low|high>' lessons already shown once (#26)
    audio: { enabled: true, volume: 0.6 },  // global sound pref (NOT per-run)
  });

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
  function saveMeta() {
    try {
      // audio.js owns meta.audio — it read-modify-writes the live sound pref on toggle.
      // game.js's save is a FULL overwrite, so re-read the stored audio first; otherwise a
      // saveMeta (end of run, upgrade, etc.) would clobber a mute the player just set.
      const stored = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      if (stored && stored.audio) meta.audio = stored.audio;
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {}
  }

  const UPGRADES = [
    { id: 'lotus_cushion', glyph: '❤', name: 'Lotus Cushion',
      desc: 'Begin each ascent with +6 Prāṇa per level.',
      costs: [10, 15, 25, 40, 60],
      apply: (s, lvl) => { s.prana += 6 * lvl; } },
    { id: 'temperance', glyph: '☯', name: 'Equanimity',
      desc: 'The world resists your extremes: Tejas, Karma and Bhakti rise more gently near their fatal peaks. Stronger each level — the key to surviving the climb to Satyaloka.',
      costs: [30, 45, 70],
      apply: (s, lvl) => { s.temperanceFactor = [1, 0.7, 0.55, 0.45][lvl]; } },
    { id: 'pilgrim_stamina', glyph: '🥾', name: "Pilgrim's Stamina",
      desc: 'Prāṇa drains bite softer — −15% per level.',
      costs: [25, 40],
      apply: (s, lvl) => { s.pranaDrainFactor = [1, 0.85, 0.7][lvl]; } },
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
  const mirrorScreen = $('mirrorScreen');
  const startBtn     = $('startBtn');
  const mirrorBtn    = $('mirrorBtn');
  const closeMirror  = $('closeMirror');
  const menuBtn      = $('menuBtn');
  const upgradesEl   = $('upgrades');
  const punyaCount   = $('punyaCount');
  const metaSummary  = $('metaSummary');
  const goalTrack    = $('goalTrack');
  const endScreen    = $('endScreen');
  const endArt       = $('endArt');
  const endDeva      = $('endDeva');
  const endTitle     = $('endTitle');
  const endReason    = $('endReason');
  const endCause     = $('endCause');
  const endStats     = $('endStats');
  const endPrimary   = $('endPrimary');
  const endMirror    = $('endMirror');
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
  const csRule       = $('csRule');
  const beatEl       = $('beat');
  const beatText     = $('beatText');
  const beatDeltas   = $('beatDeltas');
  const tutorial     = $('tutorial');
  const tutScrim     = $('tutScrim');
  const tutHole      = $('tutHole');
  const tutCaption   = $('tutCaption');
  const tutSkip      = $('tutSkip');
  const tutHint      = $('tutHint');
  const soundBtn      = $('soundBtn');
  const soundBtnTitle = $('soundBtnTitle');

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
    flags: new Set(),      // within-run karmic memory: deeds done, NPCs met
    karmaQueue: [],         // scheduled payoffs: { card, atRealm } — deeds that ripen later
    restDone: false,        // this realm's waystation already drawn (reset on realm entry)
    offerQueue: [],         // stats ('karma'/'bhakti') whose offer is the next draw (#32)
    offered: new Set(),     // stats already offered this run — the offer comes once
    lastChoiceLabel: '',    // the label just committed — named on the end screen (#27)
    cutscenePaused: false,
    beatPaused: false,      // consequence beat is showing (gates new swipes; distinct from cutscenePaused)
    beatTimer: null,        // auto-advance setTimeout id for the beat
    forceTutorial: false,   // transient: replay the tutorial for one run without clearing meta.tutorialSeen
    temperanceFactor: 1,   // <1 softens approach to the tejas/karma/bhakti caps (Equanimity upgrade)
    pranaDrainFactor: 1,   // <1 reduces prāṇa drains (Pilgrim's Stamina upgrade)
  };

  // ---------- Card selection ----------

  function applyStartingUpgrades() {
    state.preview = false;
    state.secondBreath = false;
    state.graceBonus = 0;
    state.temperanceFactor = 1;
    state.pranaDrainFactor = 1;
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
      if (card.tag === 'karma') return false; // payoff-only: drawn from the karma queue, never at random
      if (card.tag === 'rest')  return false; // waystation: drawn once per realm at its midpoint, never at random
      if (card.tag === 'offer') return false; // the false-summit offer: served from offerQueue, never at random
      if (card.realmMin && realmNum < card.realmMin) return false;
      if (card.realmMax && realmNum > card.realmMax) return false;
      // Karmic gating: a card may require past deeds, or be barred once a deed is done.
      if (card.requires && !card.requires.every(f => state.flags.has(f))) return false;
      if (card.forbids && card.forbids.some(f => state.flags.has(f))) return false;
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
      return CARDS.find(c => c.tag !== 'boss' && c.tag !== 'karma') || CARDS[0];
    }
    const totalWeight = pool.reduce((s, c) => s + (c.weight || 1), 0);
    let r = Math.random() * totalWeight;
    for (const card of pool) {
      r -= (card.weight || 1);
      if (r <= 0) return card;
    }
    return pool[pool.length - 1];
  }

  // Bosses read the seeds (#34): each realm has one unconditional base boss and
  // variants gated on flags planted earlier in the run (`requires` / `forbids`).
  // The first eligible variant wins; the base is the fallback. Order in CARDS only
  // breaks ties between variants — specificity, not position, decides.
  function pickBossForRealm(realmNum) {
    const ok = c => (!c.requires || c.requires.every(f => state.flags.has(f)))
                 && (!c.forbids || !c.forbids.some(f => state.flags.has(f)));
    const cands = CARDS.filter(c => c.tag === 'boss' && c.realm === realmNum && ok(c));
    return cands.find(c => c.requires) || cands.find(c => !c.requires) || null;
  }

  // The boss notices how you met the realm's waystation (#34): every waystation
  // plants `rested` or `pressed` (clearing the other), and a boss card with a
  // `stance` block gets the matching line appended to its text. TEXT ONLY, by
  // design: the sim found the waystation decision is already the game's largest
  // skill lever (+17 points for playing it well) and that giving the stance fx
  // mostly punished players who hadn't learned it yet. Naming it teaches it.
  function withStance(card) {
    if (!card || !card.stance) return card;
    const line = state.flags.has('rested') ? card.stance.rested
               : state.flags.has('pressed') ? card.stance.pressed : null;
    return line ? Object.assign({}, card, { text: card.text + ' ' + line }) : card;
  }

  // The realm's waystation (#33): its one reliable prāṇa source, drawn at the
  // realm's midpoint step (5→2, 6→2, 7→3, 8→3) — far enough in to need it, before
  // the boss so it can be spent on him. Exactly one `tag: 'rest'` card per realm.
  function restStep(realm) { return Math.floor((realm.length - 1) / 2); }
  function pickRestForRealm(realmNum) {
    return CARDS.find(c => c.tag === 'rest' && c.realm === realmNum);
  }

  // The offer (#32): a false summit made a choice. Crossing OFFER_AT queues it;
  // it's built at draw time from the live value so both sides carry concrete
  // deltas Sage's Eye can preview. Refuse drops the virtue to OFFER_FLOOR — the
  // merit that opened the gates is spent on the turning — and costs OFFER_TOLL
  // prāṇa: "the climb is long". Without the toll the sim showed refusal acting as
  // a summit safety valve (careful play 45% → 73%); −6 breath lands it back at
  // neutral (42%) with the accidental summit itself gone (20% → 4%). Accept fills
  // the virtue to 100 and ends the run at that heaven (commitChoice → endRun, staged).
  const OFFER_AT = 85, OFFER_FLOOR = 75, OFFER_TOLL = 6;
  function buildOffer(stat) {
    const t = CARDS.find(c => c.tag === 'offer' && c.stat === stat);
    if (!t) return null;
    return Object.assign({}, t, {
      left:  Object.assign({}, t.left,  { fx: { [stat]: OFFER_FLOOR - state[stat], prana: -OFFER_TOLL } }),
      right: Object.assign({}, t.right, { fx: { [stat]: Math.max(0, 100 - state[stat]) } }),
    });
  }

  function rememberCard(id) {
    state.recentIds.push(id);
    while (state.recentIds.length > 7) state.recentIds.shift();
  }

  // ---------- Karma: deeds that ripen later ----------
  // A choice with `ripens: { card, in }` schedules a guaranteed payoff card to be
  // drawn `in` realms ahead (default the next realm). This is the law of karma made
  // playable — what you do in one world catches up with you in another.

  function scheduleKarma(r) {
    if (!r || !r.card) return;
    const delay = (r.in == null) ? 1 : r.in;
    state.karmaQueue.push({ card: r.card, atRealm: state.realmIdx + delay });
  }

  // Pop the first scheduled deed that has come due for the current realm, if any.
  function dueKarmaCard() {
    const i = state.karmaQueue.findIndex(k => state.realmIdx >= k.atRealm);
    if (i === -1) return null;
    const [entry] = state.karmaQueue.splice(i, 1);
    return CARDS.find(c => c.id === entry.card) || null;
  }

  // ---------- UI rendering ----------

  // Tracks each stat's prior danger state so the 'danger' cue fires once on the
  // TRANSITION into ≤15/≥85, not on every subsequent render while still in range.
  const prevDanger = { prana: false, tejas: false, karma: false, bhakti: false };

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
      // Drives the meter (prāṇa fill width / needle position). Values sit outside
      // 0..100 only transiently pre-endRun; clamp for display.
      statEls[s].style.setProperty('--pct', Math.max(0, Math.min(100, state[s])));
      statEls[s].classList.remove('preview-up', 'preview-dn');
      statEls[s].removeAttribute('data-delta');
      // Red pulse = a deadly end is near. Prāṇa caps safely at 100, so only its
      // floor warns; tejas warns at both ends (burnout). Karma/bhakti ≥85 pulse
      // gold instead — the false summit ends the run but is a heaven, not a death.
      const low = state[s] <= 15, high = state[s] >= 85;
      const deadly = low || (s === 'tejas' && high);
      const summit = (s === 'karma' || s === 'bhakti') && high;
      statEls[s].classList.toggle('danger', deadly);
      statEls[s].classList.toggle('danger-summit', summit);
      const isDanger = deadly || summit;
      if (isDanger && !prevDanger[s]) {
        window.SaptalokaAudio?.play?.('danger');
        // Teach the virtue the first time it ever matters (#26) — once per edge, ever.
        const key = s + ':' + (low ? 'low' : 'high');
        const lesson = DANGER_LESSON[s] && DANGER_LESSON[s][low ? 'low' : 'high'];
        if (lesson && !meta.dangerTaught.includes(key)) {
          meta.dangerTaught.push(key); saveMeta();
          showToast(STAT_INFO[s].glyph + ' ' + lesson, 4200);
        }
      }
      prevDanger[s] = isDanger;
    }
  }

  function renderCard(c) {
    state.currentCard = c;
    cardArt.textContent     = c.art || '◌';
    cardSpeaker.textContent = c.speaker || '';
    cardText.textContent    = c.text || '';
    choiceLeft.textContent  = c.left?.label || '←';
    choiceRight.textContent = c.right?.label || '→';
    card.classList.remove('boss', 'god', 'karma', 'rest', 'offer', 'show-left', 'show-right');
    if (c.tag === 'boss')  { card.classList.add('boss'); window.SaptalokaAudio?.play?.('boss'); }
    if (c.tag === 'god')   card.classList.add('god');
    if (c.tag === 'karma') card.classList.add('karma');
    if (c.tag === 'rest')  card.classList.add('rest');
    if (c.tag === 'offer') card.classList.add('offer');
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
  // Copy MUST stay accurate to checkEnd(): tejas dies at 0 AND 100; karma 100 →
  // Svarga and bhakti 100 → Deva are NON-win "false summits" (a heaven, not mokṣa);
  // prāṇa dies only at 0 and caps at 100. The only win is reaching Satyaloka.

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
      oneLiner: '0 damns you · 100 strands you in Svarga.',
      detail: 'The ledger of your deeds. At 0 sin overtakes you and Yama drags you to Naraka. At 100 your merit ripens and the gates of Svarga open — but that heaven still turns inside saṃsāra, and when the puṇya is spent you fall again. A false summit, not mokṣa, and not the win.',
    },
    bhakti: {
      glyph: '✿',
      title: 'Bhakti — devotion',
      oneLiner: '0 erases you · 100 enthrones you as a Deva.',
      detail: "The world's love for you. At 0 the world forgets you and no one chants your name. At 100 devotion crowns you a worshipped Deva — but the idol cannot leave; saṃsāra still turns behind your halo. A false summit, not mokṣa, and not the win.",
    },
  };

  // One line per fatal edge, shown as a toast the first time a virtue enters that
  // zone (renderHud). This replaced four back-to-back definitions in the tutorial:
  // a lesson lands when the meter is actually red, not twenty cards earlier.
  const DANGER_LESSON = {
    prana:  { low:  'Prāṇa is nearly spent — at 0 the wheel takes you.' },
    tejas:  { low:  'Tejas gutters — at 0 you vanish into shadow.',
              high: 'Tejas overflows — at 100 you burn away. It is fatal at both ends.' },
    karma:  { low:  'Karma nears 0 — sin damns you to Naraka.',
              high: 'Karma nears 100 — a heaven waits there. It is not mokṣa.' },
    bhakti: { low:  'Bhakti nears 0 — the world forgets you.',
              high: 'Bhakti nears 100 — they will crown you a god. That is not mokṣa either.' },
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
      karma:  ['<span class="pill death">0 → death</span>', '<span class="pill false">100 → Svarga (not mokṣa)</span>'],
      bhakti: ['<span class="pill death">0 → death</span>', '<span class="pill false">100 → Deva (not mokṣa)</span>'],
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
        `<p>Both answers are written on the card. Drag it toward one to <b>weigh</b> it (the label lights up), let go to change your mind, or commit — past a third of the card's width, or with a flick. On a keyboard, hold <b>←</b> / <b>→</b> (or <b>A</b> / <b>D</b>) to weigh and release to choose; <b>Esc</b> cancels. Unlock the <b>Sage's Eye</b> to preview the stat changes a choice will make — though some fated encounters stay veiled until you commit.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>The Road</h3>` +
        `<p>Halfway through every realm is a <b>waystation</b> — the one place breath can be bought, at the cost of another virtue. Rest there and the boss at the end finds you slow and full of breath; press on and he finds you burning. He will say which. Some bosses remember other things too — a coin given, a blade taken, a river drunk from.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>The Four Virtues</h3>` +
        `<p class="rule-legend"><span class="pill death">death</span><span class="pill safe">safe</span><span class="pill false">false summit</span></p>` +
        virtues +
        `<p class="rule-note">Each virtue's meter shades its run-ending zones: <b>red</b> for a deadly end, <b>gold</b> for a false summit. Prāṇa is a plain life bar — only empty kills. The other three are needle gauges: keep the needle out of the shaded ends, near the centre tick.</p>` +
        `<p class="rule-note">Maxing Karma or Bhakti does <i>not</i> win — it strands you in a false heaven (Svarga / Deva), still inside saṃsāra. Tejas burns out at the top; Prāṇa alone is safe when full. The one true victory is reaching <b>Satyaloka</b>.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>Realms &amp; Bosses</h3>` +
        `<p>Climb Bhūloka up through Satyaloka. Each realm ends in a <b>boss</b> encounter. Survive all seven to ascend to Mokṣa.</p>` +
      `</section>` +
      `<section class="rule-sec">` +
        `<h3>Between Lives</h3>` +
        `<p>Death keeps the <b>Puṇya</b> you earned. Spend it in the <b>Mirror of Maya</b> on upgrades that carry into every future ascent.</p>` +
      `</section>` +
      `<p class="rule-hint">Tip: ${STAT_HOVER ? 'hover' : 'tap'} any virtue in the top bar to recall what it does.</p>` +
      `<p class="rule-replay"><button type="button" id="replayTut" class="linklike">Replay the tutorial</button></p>`;
    const rt = document.getElementById('replayTut');
    if (rt) rt.addEventListener('click', () => {
      state.forceTutorial = true;
      hideRules();
      if (!state.inRun) startRun();
      else showToast('Tutorial will replay on your next ascent.');
    });
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
    const amb = Rules.ambient(state.realmIdx);
    for (const s of STATS) {
      // Mirror every applyFx transform, in its order, so the badge equals the
      // post-commit (floating) delta: realm rule → Pilgrim's Stamina drain-softening
      // → realm ambient → prāṇa cap → Equanimity damping.
      let d = fx[s] ? Rules.delta(state.realmIdx, s, fx[s], state.currentCard) : 0;
      if (s === 'prana' && d < 0) d = Math.round(d * state.pranaDrainFactor);
      d += (amb && amb[s]) || 0;
      if (!d) continue;
      if (s === 'prana') {
        if (d > 0) d = Math.min(d, 100 - state.prana);
      } else if ((s === 'karma' || s === 'bhakti') && state.temperanceFactor < 1) {
        let nv = state[s] + d;
        if (nv > 82) nv = Math.round(82 + (nv - 82) * state.temperanceFactor);
        d = nv - state[s];
      }
      if (!d) continue; // fully absorbed → no badge
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
    // Realm rule first (rules.js): the loka bends the card's raw delta, then the
    // Mirror upgrades soften what's left. showPreview mirrors this exact order.
    const card = state.currentCard;
    for (const s of STATS) {
      if (!fx[s]) continue;
      let d = Rules.delta(state.realmIdx, s, fx[s], card);
      // Pilgrim's Stamina softens prāṇa drains only.
      if (s === 'prana' && d < 0) d = Math.round(d * state.pranaDrainFactor);
      state[s] += d;
    }
    // The realm's ambient toll lands on every card, whichever way it was swiped.
    const amb = Rules.ambient(state.realmIdx);
    if (amb) for (const s of STATS) if (amb[s]) state[s] += amb[s];
    // Allow prana > 100 to be clamped (excess life is fine, just capped).
    state.prana = Math.min(100, state.prana);
    // Equanimity softens the approach to the karma/bhakti "false-summit" exits, so
    // the over-virtue off-ramp stops ending the climb early. Tejas is deliberately
    // NOT damped — burnout (tejas >= 100) stays a real, player-managed death, so the
    // run-end condition is preserved (no auto-clamp on the death stats).
    if (state.temperanceFactor < 1) {
      for (const s of ['karma', 'bhakti']) {
        if (state[s] > 82) state[s] = Math.round(82 + (state[s] - 82) * state.temperanceFactor);
      }
    }
  }

  // Returns an ENDINGS key, or null if the run continues. karma/bhakti >= 100 are
  // NON-win "false summits" (a heaven, not liberation); only the full climb wins.
  function checkEnd() {
    if (state.prana <= 0) {
      if (state.secondBreath) {
        state.secondBreath = false;
        state.prana = 1;
        showToast('Second Breath — death postponed.');
        return null;
      }
      return 'death_prana';
    }
    if (state.tejas <= 0)   return 'death_tejas_low';
    if (state.tejas >= 100) return 'death_tejas_burn';
    if (state.karma <= 0)   return 'death_karma';
    // A summit can't take you while its offer is pending — the gates open at the
    // next draw, and what you do there decides (#32).
    if (state.karma >= 100  && !state.offerQueue.includes('karma'))  return 'false_karma';
    if (state.bhakti <= 0)  return 'death_bhakti';
    if (state.bhakti >= 100 && !state.offerQueue.includes('bhakti')) return 'false_bhakti';
    return null;
  }

  // ---------- Run flow ----------

  function startRun() {
    window.SaptalokaAudio?.unlock?.();
    state.prana = 50; state.tejas = 50; state.karma = 50; state.bhakti = 50;
    for (const s of STATS) prevDanger[s] = false;  // explicit: no stale danger-cue state across runs
    state.realmIdx = 0; state.realmStep = 0;
    state.recentIds = [];
    state.runEncounters = 0;
    state.runPunya = 0;
    state.nextCardOverride = null;
    state.flags = new Set();
    state.karmaQueue = [];
    state.restDone = false;
    state.offerQueue = [];
    state.offered = new Set();
    clearTimeout(revealTimer); revealTimer = null;   // a staged reveal from the last run must not land on this one
    applyStartingUpgrades();
    state.inRun = true;
    hideBeat();
    titleScreen.classList.add('hidden');
    endScreen.classList.add('hidden');
    mirrorScreen.classList.add('hidden');
    rulesScreen.classList.add('hidden');
    renderHud();
    // Opening cutscene; the first card is drawn when the player taps through.
    // First-run (or forced replay): draw the live first card, THEN overlay the tutorial
    // so its gesture step has a real, swipeable card. forceTutorial is one-shot.
    const runTutorial = !meta.tutorialSeen || state.forceTutorial;
    state.forceTutorial = false;
    playCutscene(0, () => {
      drawNextCard();
      if (runTutorial) startTutorial(() => {});   // tutorial overlays the live first card
    });
  }

  function drawNextCard() {
    const realm = REALMS[state.realmIdx];
    const isBoss = state.realmStep >= realm.length - 1;
    let next;
    if (isBoss) {
      next = withStance(pickBossForRealm(state.realmIdx + 1));
    } else if (state.nextCardOverride) {
      next = pickRandomCard();            // immediate `then` chain consumes the override
    } else if (state.offerQueue.length) {
      // Heaven's reach: the offer jumps everything but a boss or a `then` chain.
      next = buildOffer(state.offerQueue.shift()) || dueKarmaCard() || pickRandomCard();
    } else if (!state.restDone && state.realmStep >= restStep(realm)) {
      // Waystation: once per realm, at the midpoint — or the first free step after
      // it if a `then` chain held that slot. A ripened deed waits one more card.
      state.restDone = true;
      next = pickRestForRealm(state.realmIdx + 1) || dueKarmaCard() || pickRandomCard();
    } else {
      next = dueKarmaCard() || pickRandomCard();  // a ripened deed jumps the queue
    }
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
    // The realm's one rule, stated once here so the player meets it before it bites.
    const rule = Rules.rule(realmIdx);
    csRule.textContent = rule ? rule.text : '';
    csRule.hidden = !rule;
    if (statAnnounce) {
      // Fold the boss-kill deltas into the same write so the live region doesn't
      // announce them and then immediately overwrite (they'd never be voiced).
      const lead = announcePrefix ? announcePrefix + '. ' : '';
      const ruleLine = rule ? ' ' + rule.text : '';
      statAnnounce.textContent =
        `${lead}Entering ${realm.name}, ${realm.subtitle}. ${cs.narration || ''}${ruleLine} Tap to continue.`;
    }
    cutscene.classList.remove('hidden', 'play');
    window.SaptalokaAudio?.play?.('ascend', { realm: realmIdx });
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

  // ---------- Consequence beat ----------
  // A short animated "what happened" shown after a swipe whose choice carries a
  // hand-written `outcome` (karma payoffs today). Ordinary cards skip it and go
  // straight to the next card. Auto-advances; an early tap/click/key skips it. Decorative (aria-hidden) —
  // the #statAnnounce live region remains the single screen-reader source, written once
  // in onDone. Under reduced motion the visual is skipped and onDone fires immediately.
  // Auto-advance is a *fallback* for when the player doesn't tap — so it must be long
  // enough to actually READ the line (the point of the beat), scaled to its length.
  // Tapping always skips immediately, so fast/veteran players never wait this out.
  function beatDuration(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    let ms = 700 + words * 200;                 // register the panel + read the words
    ms = Math.max(1500, Math.min(5500, ms));    // readable floor / sane cap
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
    // The beat is reserved for choices with a hand-written `outcome` (karma payoffs
    // today; bosses once theirs are written). Ordinary cards go straight to the next
    // card — the HUD's floating deltas already say what happened, and a templated
    // sentence 47 times a climb was a pause, not a reward. (#30)
    const authored = !!(choice && typeof choice.outcome === 'string' && choice.outcome);
    // Skip the visual beat under reduced motion OR while the tutorial overlay is up
    // (the tutorial's own spotlights explain the first swipe; a beat would sit behind it).
    if (!authored || REDUCED_MOTION || (tutorial && !tutorial.classList.contains('hidden'))) {
      Promise.resolve().then(onDone); return;
    }
    const text = (window.SaptalokaBeat && window.SaptalokaBeat.outcomeText)
      ? window.SaptalokaBeat.outcomeText(choice, d, state.currentCard)
      : choice.outcome;

    let done = false;
    const finish = () => {
      if (done) return; done = true;
      beatEl.removeEventListener('pointerdown', finish);
      beatEl.removeEventListener('click', finish);
      window.removeEventListener('keydown', onKey);
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
    // #beat is aria-hidden (decorative), so it can't take focus — listen on window
    // so a keyboard user can still early-skip without focusing a hidden element.
    window.addEventListener('keydown', onKey);
    state.beatTimer = setTimeout(finish, beatDuration(text));
  }

  // ---------- First-run coachmark tutorial ----------
  // Teaches the swipe + the 4 virtues against the REAL board. Step 2 is gesture-gated:
  // the player's real swipe is also their first choice. Copy for the stat steps is pulled
  // verbatim from STAT_INFO (one source of truth). Its own dialog captions voice for SR;
  // #statAnnounce is left for deltas.
  let tutOnComplete = null, tutIdx = 0, tutSteps = [], tutGestureTimer = null;

  // Four steps — three taps and the real first swipe (#26). The virtues are NOT
  // defined here: four definitions in a row landed before any of them mattered and
  // were gone by the time one did. Each is taught instead the first time it enters
  // its danger zone (renderHud → the meta.dangerTaught toast), which is when it counts.
  function buildTutSteps() {
    const keys = lastInput === 'key';
    return [
      { anchor: null, text: 'You are a soul at the foot of the worlds. Climb the seven realms — Bhūloka to Satyaloka — and break the wheel of saṃsāra to win mokṣa.' },
      { anchor: () => card, gesture: true,
        text: keys
          ? 'Each encounter is a choice, and both answers are written on the card. Hold ← or → to weigh one, press Esc to change your mind, or release to commit. Try it now.'
          : 'Each encounter is a choice, and both answers are written on the card. Drag toward one to weigh it, let go to change your mind, or swipe to commit. Try it now.' },
      { anchor: () => statsEl, text: 'These four virtues are your life. Each has an edge that ends the run — the meters shade the deadly zones red and the false-heaven zones gold. Tap any virtue, any time, to learn it.' },
      { anchor: () => realmProg, text: 'Each realm ends in a boss, and a rest waits halfway — how you meet the rest is how you meet the boss. Climb all seven to reach Satyaloka.' },
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
    clearTimeout(tutGestureTimer);
    const step = tutSteps[tutIdx];
    spotlight(step.anchor ? step.anchor() : null);
    tutCaption.textContent = step.text;
    tutorial.classList.toggle('gesture', !!step.gesture);
    if (step.gesture) {
      // Gesture step: advance by swiping the real card (Skip hidden so it doesn't read as
      // "skip the swipe"). But never strand a confused first-time touch player — if they
      // don't discover the drag within a few seconds, reveal Skip as an escape.
      tutHint.textContent = lastInput === 'key' ? 'hold → or ←, then release' : 'swipe the card';
      tutSkip.style.display = 'none';
      tutGestureTimer = setTimeout(() => {
        tutSkip.style.display = 'block';
        tutHint.textContent = (lastInput === 'key' ? 'hold → or ←, then release' : 'swipe the card') + ' — or tap Skip';
      }, 6000);
    } else {
      tutHint.textContent = 'tap to continue';
      tutSkip.style.display = 'block';
    }
    if (step.cue) step.cue(); else window.SaptalokaAudio?.play?.('tutorialStep');
    tutCaption.focus();
  }

  function tutAdvance() {
    if (tutIdx >= tutSteps.length - 1) return endTutorial();
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

  // Visual teardown only (no persistence) — safe to call from any exit path, incl. abandon.
  function hideTutorial() {
    clearTimeout(tutGestureTimer);
    tutorial.classList.add('hidden');
    tutorial.classList.remove('gesture');
  }

  function endTutorial() {
    hideTutorial();
    meta.tutorialSeen = true; saveMeta();   // completing OR skipping marks it seen
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
    if (e.key === 'Escape') { e.preventDefault(); endTutorial(); return; }
    const step = tutSteps[tutIdx];
    if ((e.key === 'Enter' || e.key === ' ') && !(step && step.gesture)) { e.preventDefault(); tutAdvance(); }
  });
  tutSkip.addEventListener('click', (e) => { e.stopPropagation(); endTutorial(); });

  function commitChoice(side) {
    // Drop a stale fly-off commit queued during another commit's 260ms defer:
    // once the cutscene veil is up (or the run has ended) the card is gone.
    if (state.cutscenePaused || !state.inRun) return;
    const choice = side === 'left' ? state.currentCard.left : state.currentCard.right;
    state.lastChoiceLabel = (choice && choice.label) || '';
    const fx = fxFor(choice);
    const before = { prana: state.prana, tejas: state.tejas, karma: state.karma, bhakti: state.bhakti };
    applyFx(fx);
    // First real swipe is also the tutorial's gesture step: commit AND advance off it.
    // No-op on non-gesture steps (the scrim blocks input, so a swipe can't reach here).
    if (!tutorial.classList.contains('hidden')) tutNotifySwipe();
    state.runEncounters++;

    // Karma: record the deed, schedule its ripening, and queue any immediate chain.
    if (choice) {
      if (choice.set)    for (const f of choice.set)   state.flags.add(f);
      if (choice.clear)  for (const f of choice.clear) state.flags.delete(f);
      if (choice.ripens) scheduleKarma(choice.ripens);
      if (choice.then)   state.nextCardOverride = choice.then;
    }

    // Punya gain
    state.runPunya += 1 + state.graceBonus;

    // Cheap visual + audio feedback for effective (post-applyFx) changes.
    const dlt = deltasFrom(before);
    for (const s of STATS) {
      if (!dlt[s]) continue;
      if (Math.abs(dlt[s]) >= 10) { flashStat(s, dlt[s] > 0 ? 'up' : 'dn'); window.SaptalokaAudio?.play?.('bigHit'); }
      window.SaptalokaAudio?.play?.(dlt[s] > 0 ? 'statGain' : 'statLoss', { stat: s });
    }

    const realm = REALMS[state.realmIdx];
    const isFinalStep = state.realmIdx === REALMS.length - 1 && state.realmStep >= realm.length - 1;
    // Accepting a false heaven ends the run there, staged as a win first. It must
    // pre-empt checkEnd, which would see 100 and fire the same ending un-staged.
    if (choice && choice.accept) return endRun(choice.accept, { staged: true });
    // Crossing into heaven's reach queues that stat's offer as the next draw. Once
    // per stat per run: refuse it, and the second time the summit simply takes you.
    for (const s of ['karma', 'bhakti']) {
      if (before[s] < OFFER_AT && state[s] >= OFFER_AT && !state.offered.has(s)) {
        state.offered.add(s); state.offerQueue.push(s);
      }
    }

    let endKey = checkEnd();
    // On the last step of the last realm, completing the climb wins — don't let a
    // virtue overshooting to 100 demote it to a false summit. Deaths still fire.
    if (isFinalStep && (endKey === 'false_karma' || endKey === 'false_bhakti')) endKey = null;
    if (endKey) return endRun(endKey);

    state.realmStep++;
    if (state.realmStep >= realm.length) {
      // Realm complete (boss already committed above when drawn).
      state.runPunya += 5;
      if (state.realmIdx + 1 >= REALMS.length) {
        return endRun('win_moksha');
      }
      state.realmIdx++;
      state.realmStep = 0;
      state.restDone = false;
      renderHud();
      floatDeltas(before);
      // Ascension cutscene; deltas ride along in its single announcement; the
      // next realm's first card is drawn on tap.
      playCutscene(state.realmIdx, () => { drawNextCard(); }, deltaText(before));
      return;
    }
    renderHud();
    floatDeltas(before);
    showConsequenceBeat(choice, before, () => { announceDeltas(before); drawNextCard(); });
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

  function announceDeltas(before) {
    if (!statAnnounce) return;
    statAnnounce.textContent = deltaText(before);
  }

  let lastEndKind = 'death';
  let revealTimer = null;   // the staged false summit's pending reveal (#32)

  // opts.staged (#32): an accepted false heaven arrives dressed as the true win —
  // gold, the OM resolve, the ending's `lie` line, "Begin Anew" — and REVEAL_MS
  // later the treatment cools, the hollow chord sounds and the full narration lands.
  // Sighted-only: reduced motion skips it, and the live region announces the whole
  // truth at once. Meta accounting is identical either way (no mokṣa, no bonus).
  // The plain cause of an ending (#27): which virtue, which edge, and the encounter
  // that did it. The narration stays poetry; this line is the lesson.
  const CAUSE = {
    death_prana:      ['prana',  'Prāṇa reached 0'],
    death_tejas_low:  ['tejas',  'Tejas reached 0'],
    death_tejas_burn: ['tejas',  'Tejas reached 100'],
    death_karma:      ['karma',  'Karma reached 0'],
    death_bhakti:     ['bhakti', 'Bhakti reached 0'],
    false_karma:      ['karma',  'Karma reached 100'],
    false_bhakti:     ['bhakti', 'Bhakti reached 100'],
  };
  function causeLine(endKey, chosenHeaven) {
    const c = CAUSE[endKey];
    if (!c) return null;
    const [stat, what] = c;
    if (chosenHeaven) return { stat, text: `${what} — you chose to stay.` };
    const who = state.currentCard && state.currentCard.speaker;
    const label = state.lastChoiceLabel;
    return { stat, text: who ? `${what} — ${who}${label ? `, “${label}”` : ''}.` : `${what}.` };
  }

  const REVEAL_MS = 2600;
  function endRun(endKey, opts = {}) {
    const e = ENDINGS[endKey] || ENDINGS.death_prana;
    const staged = !!(opts.staged && e.kind === 'falsesummit' && e.lie && !REDUCED_MOTION);
    // Distinct cue per ending kind: the OM resolve for a true win, a hollow unresolved
    // chord for a false summit (Svarga/Deva — a false heaven, not a death), else the death drone.
    window.SaptalokaAudio?.play?.((e.kind === 'win' || staged) ? 'win' : (e.kind === 'falsesummit' ? 'falsesummit' : 'death'));
    lastEndKind = e.kind;
    closeStatInfo();
    state.inRun = false;
    // Only the true Satyaloka win counts as mokṣa; false summits and deaths do not.
    if (e.kind === 'win') {
      meta.moksha = (meta.moksha || 0) + 1;
      state.runPunya += 25;
    }
    meta.punya = (meta.punya || 0) + state.runPunya;
    meta.runs = (meta.runs || 0) + 1;
    meta.bestRealm = Math.max(meta.bestRealm || 0, state.realmIdx + 1);
    saveMeta();

    endScreen.className = 'overlay end-' + (staged ? 'win' : e.kind);
    endArt.innerHTML = e.svg || '';
    endDeva.textContent = e.deva || '';
    endTitle.textContent = e.title || '';
    endReason.textContent = staged ? e.lie : (e.narration || '');
    // The cause line waits for the reveal on a staged ending — it would give the game away.
    const cause = causeLine(endKey, !!opts.staged);
    endCause.textContent = cause ? cause.text : '';
    endCause.className = 'end-cause' + (cause ? ' stat-' + cause.stat : '') + ((!cause || staged) ? ' hidden' : '');
    endStats.innerHTML = runStatsHtml();
    endPrimary.textContent = (e.kind === 'win' || staged) ? 'Begin Anew' : 'Reincarnate';
    if (statAnnounce) statAnnounce.textContent = `${e.title}. ${e.narration || ''}${cause ? ' ' + cause.text : ''}`;
    void endScreen.offsetWidth;
    if (!REDUCED_MOTION) endScreen.classList.add('play');
    endScreen.focus();
    if (staged) {
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        revealTimer = null;
        endScreen.classList.remove('end-win');
        endScreen.classList.add('end-falsesummit', 'reveal');
        endReason.textContent = e.narration || '';
        endCause.classList.remove('hidden');
        endPrimary.textContent = 'Reincarnate';
        window.SaptalokaAudio?.play?.('falsesummit');
      }, REVEAL_MS);
    }
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
    window.SaptalokaAudio?.play?.('upgrade');
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

  // The goal: an ascent track of the seven worlds, filled to your best, with
  // Satyaloka marked as the destination — and a call to reach it.
  function renderGoal() {
    const best = meta.bestRealm || 0;
    const total = REALMS.length;
    let track = '';
    for (let i = 0; i < total; i++) {
      const n = i + 1;
      const reached = n <= best;
      const isGoal = n === total;
      track += `<span class="goal-pip${isGoal ? ' goal' : ''}${reached ? ' reached' : ''}" title="${REALMS[i].name}"></span>`;
      if (i < total - 1) track += `<span class="goal-rail${n < best ? ' reached' : ''}"></span>`;
    }
    const cta = (meta.moksha || 0) > 0
      ? `Liberated <b>${meta.moksha}×</b>. Break the wheel again.`
      : best >= total
        ? `Satyaloka stands open — claim <b>mokṣa</b>.`
        : `Climb all seven worlds to <b>Satyaloka</b> — break the wheel, win <b>mokṣa</b>.`;
    goalTrack.innerHTML =
      `<div class="goal-ends"><span>Bhūloka</span><span>Satyaloka</span></div>` +
      `<div class="goal-rail-row">${track}</div>` +
      `<p class="goal-cta">${cta}</p>`;
  }

  // ---------- Swipe gesture ----------

  let pointer = null;
  let draggedCue = false;   // debounce: one 'drag' pluck per drag, not per pointermove

  function onPointerDown(ev) {
    if (!state.inRun || state.cutscenePaused || state.beatPaused) return;
    const p = pointFrom(ev);
    pointer = { x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now() };
    draggedCue = false;
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
    if (Math.abs(t) > 0.15 && !draggedCue) { draggedCue = true; window.SaptalokaAudio?.play?.('drag'); }
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
    window.SaptalokaAudio?.play?.('commit');
    const dir = side === 'left' ? -1 : 1;
    const vw = window.innerWidth;
    card.style.transition = 'transform 0.32s ease-out, opacity 0.32s ease-out';
    card.style.transform = `translate(${dir * (vw + 80)}px, 60px) rotate(${dir * 22}deg)`;
    card.style.opacity = '0';
    clearPreview();
    setTimeout(() => commitChoice(side), 260);
  }

  // ---------- Keyboard (#28) ----------
  // ← / → (or A / D): hold to weigh — the card tilts, the label and any Sage's Eye
  // preview show — release to commit; Esc while held snaps it back. Drives the
  // pointer path with a synthetic drag so both inputs share one set of thresholds.
  let keyHeld = null;
  const KEY_SIDE = { ArrowLeft: 'left', ArrowRight: 'right', a: 'left', d: 'right', A: 'left', D: 'right' };
  function keyPeek(side) {
    const dx = (side === 'left' ? -1 : 1) * card.offsetWidth * 0.34;   // past the 15% reveal and the 30% commit thresholds
    onPointerDown({ clientX: 0, clientY: 0 });
    if (!pointer) return false;
    onPointerMove({ clientX: dx, clientY: 0 });
    return true;
  }
  function keyRelease(cancel) {
    if (pointer) {
      if (cancel) onPointerMove({ clientX: pointer.x0, clientY: pointer.y0 });
      onPointerUp({});
    }
    keyHeld = null;
  }
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const side = KEY_SIDE[e.key];
    if (side) {
      if (keyHeld || !state.inRun || state.cutscenePaused || state.beatPaused) return;
      if (!tutorial.classList.contains('hidden') && !(tutSteps[tutIdx] && tutSteps[tutIdx].gesture)) return;
      setLastInput('key');
      if (keyPeek(side)) { keyHeld = side; e.preventDefault(); }
    } else if (e.key === 'Escape' && keyHeld) {
      keyRelease(true); e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (keyHeld && KEY_SIDE[e.key] === keyHeld) { keyRelease(false); e.preventDefault(); }
  });
  window.addEventListener('blur', () => { if (keyHeld) keyRelease(true); });   // alt-tab mid-hold: never strand a tilted card

  // The bottom hint follows the last input used, so a keyboard player is never told to swipe.
  let lastInput = 'touch';
  function setLastInput(kind) {
    if (lastInput === kind) return;
    lastInput = kind; renderHint();
    // Mid-gesture-step switch (a keyboard player's first key press): re-word the tutorial hint too.
    if (!tutorial.classList.contains('hidden') && tutSteps[tutIdx] && tutSteps[tutIdx].gesture) renderTutStep();
  }
  function renderHint() { hint.textContent = lastInput === 'key' ? '← / →' : 'swipe'; }
  document.addEventListener('pointerdown', () => setLastInput('touch'), true);

  // ---------- Bind events ----------

  card.addEventListener('touchstart', onPointerDown, { passive: false });
  card.addEventListener('touchmove',  onPointerMove,  { passive: false });
  card.addEventListener('touchend',   onPointerUp);
  card.addEventListener('touchcancel', onPointerUp);
  card.addEventListener('mousedown',  onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup',   onPointerUp);

  startBtn.addEventListener('click', startRun);
  endPrimary.addEventListener('click', () => {
    if (lastEndKind === 'win') { endScreen.classList.add('hidden'); showTitle(); }
    else startRun();   // startRun hides the end screen itself
  });
  let mirrorOpener = null;
  function openMirror() {
    mirrorOpener = document.activeElement;
    renderMirror();
    mirrorScreen.classList.remove('hidden');
    closeMirror.focus();
  }
  endMirror.addEventListener('click', openMirror);
  mirrorBtn.addEventListener('click', openMirror);
  closeMirror.addEventListener('click', () => {
    mirrorScreen.classList.add('hidden');
    renderMetaSummary();
    if (mirrorOpener && mirrorOpener.focus) mirrorOpener.focus();
    mirrorOpener = null;
  });

  menuBtn.addEventListener('click', () => {
    if (state.inRun) {
      if (confirm('Abandon this ascent? Your earned Puṇya is kept.')) {
        meta.punya = (meta.punya || 0) + state.runPunya;
        saveMeta();
        hideBeat();
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
    if (e.target.closest('.stat') || e.target.closest('#statInfo') || e.target.closest('#cutscene')
        || e.target.closest('#beat') || e.target.closest('#tutorial')) { lastTap = now; return; }
    if (now - lastTap < 350) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // ---------- Sound toggle ----------
  // A HUD glyph and a title-screen label, both driving the same SaptalokaAudio
  // mute pref; renderSound keeps both in sync. All calls are optional-chained so a
  // missing/failed audio.js can't break the game.
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

  // ---------- Boot ----------

  function showTitle() {
    closeStatInfo();
    hideTutorial();   // abandoning mid-tutorial returns here — tear the overlay down (no persist)
    endScreen.classList.add('hidden');
    mirrorScreen.classList.add('hidden');
    rulesScreen.classList.add('hidden');
    titleScreen.classList.remove('hidden');
    renderMetaSummary();
    renderGoal();
    renderSound();
    // First visit (#26): four zeros and a shop you can't afford anything in say
    // nothing to someone who hasn't played yet. Both appear after the first run.
    const played = (meta.runs || 0) > 0;
    metaSummary.classList.toggle('hidden', !played);
    mirrorBtn.classList.toggle('hidden', !played);
  }

  showTitle();
})();
