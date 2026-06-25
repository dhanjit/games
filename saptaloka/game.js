// Saptaloka — game engine.
// Reigns-style card swipe rogue-like, mythology-themed, mobile-first.

(() => {
  const { REALMS, CARDS } = window.SAPTALOKA;
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
      const d = fx[s];
      if (!d) continue;
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
    drawNextCard();
    renderHud();
    showToast(`Bhūloka — ${REALMS[0].subtitle}`);
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

  function commitChoice(side) {
    const choice = side === 'left' ? state.currentCard.left : state.currentCard.right;
    const fx = fxFor(choice);
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
      // Realm complete (boss already commited above when drawn)
      state.runPunya += 5;
      if (state.realmIdx + 1 >= REALMS.length) {
        return endRun({ kind: 'moksha', reason: 'You ascend Satyaloka. Liberation is yours.' });
      }
      state.realmIdx++;
      state.realmStep = 0;
      const next = REALMS[state.realmIdx];
      showToast(`${next.name} — ${next.subtitle}`);
    }
    renderHud();
    drawNextCard();
  }

  function flashStat(s, dir) {
    const el = statEls[s];
    el.style.transform = 'scale(1.15)';
    setTimeout(() => { el.style.transform = ''; }, 220);
  }

  function endRun(end) {
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
    if (!state.inRun) return;
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

  // Disable double-tap zoom on iOS
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 350) e.preventDefault();
    lastTap = now;
  }, { passive: false });

  // ---------- Boot ----------

  function showTitle() {
    deathScreen.classList.add('hidden');
    mirrorScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    titleScreen.classList.remove('hidden');
    renderMetaSummary();
  }

  showTitle();
})();
