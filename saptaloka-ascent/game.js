/* Saptaloka Ascent — a 2.5D vertical climb of the seven lokas.
 *
 * Sibling to the swipe-based Saptaloka (shares theme + the four stats), but a
 * REAL playable game: discrete one-thumb hops up a procedurally generated shaft,
 * a rising saṃsāra flood for pressure, and the same asymmetric end conditions
 * (see checkEnd / ENDINGS). The only win is reaching the top of Satyaloka.
 *
 * Pure static, single file, HTML5 canvas, fixed-timestep sim, all art procedural.
 * 2.5D = a flat gameplay plane drawn with parallax layers + slab ledges with
 * front faces + a billboard player + depth haze. No real 3D maths.
 *
 * CONTROLS (the deliberate redesign — DISCRETE, never analog charge-aim):
 *   tap LEFT half  → hop up-and-left to the next ledge
 *   tap RIGHT half → hop up-and-right
 * One tap = one fixed-arc leap; landings auto-snap within a forgiving zone.
 *
 * Units: vertical = fractions of viewport H, horizontal/speed = fractions of W
 * (same convention as the sibling runner game's engine).
 */
(() => {
  'use strict';

  const REALMS = (window.SAPTALOKA_ASCENT && window.SAPTALOKA_ASCENT.REALMS) || [];
  const TOTAL_TIERS = REALMS.reduce((n, r) => n + r.tiers, 0);
  // realm tier ranges: realmStart[i] .. realmStart[i]+tiers-1
  const REALM_START = [];
  { let acc = 0; for (const r of REALMS) { REALM_START.push(acc); acc += r.tiers; } }
  const TOP_TIER = TOTAL_TIERS - 1;
  function realmIndexOfTier(t) {
    for (let i = REALMS.length - 1; i >= 0; i--) if (t >= REALM_START[i]) return i;
    return 0;
  }

  // ───────────────────────────── Tuning ─────────────────────────────────────
  const T = {
    nCols: 4,
    colSpacing: 0.2,     // column centre spacing (×W)
    ledgeW: 0.17,        // ledge width (×W)
    tierH: 0.15,         // vertical gap between tiers (×H)
    anchor: 0.56,        // player rest height from bottom (×H)
    bodyH: 0.085,        // player figure height (×H)
    // leap arc (tuned so one tap clears ~1 tier up and ~1 column across)
    leapVY: 1.18,        // initial up speed (×H/s)
    leapVX: 0.30,        // horizontal speed toward tap side (×W/s)
    grav: 2.7,           // gravity (×H/s²)
    landTolBase: 0.04,   // landing x-tolerance beyond the ledge (×W); +Steady Foot
    coyote: 0.10,        // grace window to still hop just after leaving a ledge
    buffer: 0.14,        // tap buffer to fire a hop just before landing
    // saṃsāra flood (the pressure)
    tideV0: 0.022,       // base rise (×H/s)
    tideRamp: 0.00045,   // rise gain per second
    tideRealm: 0.004,    // extra rise per realm climbed
    tideDrain: 34,       // prāṇa/s lost while in the flood
    // camera
    camLerp: 7,          // follow stiffness
    tideMargin: 0.12,    // keep the flood within this much of the bottom (×H)
    // tejas economy — brisk climbing is sustainable; over-spam slowly drains,
    // over-collecting agni motes burns out (≥100). Resting refills fastest.
    leapCost: 5,         // tejas per hop (×Pilgrim's Stamina factor)
    tejasRegen: 9,       // grounded tejas/s (resting is the main refill)
    tejasRegenAir: 3.5,  // in-flight tejas/s (so brisk climbing recovers a little)
    tejasRegenCap: 90,   // passive regen won't push past this (motes can → burnout)
    // stat starts
    startTejas: 62, startKarma: 50, startBhakti: 50,
  };

  // ──────────────────────────── Canvas (hi-DPI) ─────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = { w: 0, h: 0 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.w = window.innerWidth; view.h = window.innerHeight;
    canvas.width = Math.round(view.w * dpr); canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  const W = () => view.w, H = () => view.h;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  function withAlpha(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

  function colCenterX(c) { return W() * (0.5 + (c - (T.nCols - 1) / 2) * T.colSpacing); }
  // world→screen Y. run.camY is the world-y mapped to the screen BOTTOM.
  const S = (wy) => view.h - (wy - run.camY);

  // ──────────────────────────────── State ───────────────────────────────────
  const STATE = { TITLE: 'title', PLAY: 'play', PAUSE: 'pause', OVER: 'over' };
  let gameState = STATE.TITLE;

  // world content
  let ledges = [];      // {x,y,w,tier,type,move?,crumble?,creature?,gateway?,summit?}
  let motes = [];       // {x,y,type,r,taken}
  const particles = [];
  const floaters = [];
  const embers = [];    // parallax foreground specks

  const player = { x: 0, y: 0, vx: 0, vy: 0, grounded: true, ledge: null, face: 1, coyote: 0, buffer: 0, sx: 1, sy: 1, leapT: 0 };
  const stats = { prana: 100, tejas: 0, karma: 0, bhakti: 0 };

  const run = {
    t: 0, camY: 0, tideY: 0, tier: 0, maxTier: 0, realmIdx: 0,
    genTier: 0, genLastCol: 1, pendingConverge: null, baseY: 0,
  };
  // upgrade-derived (reset every run in applyStartingUpgrades)
  const up = { secondBreath: false, breathUsed: false, leapCostFactor: 1, landTol: T.landTolBase, tideFactor: 1, startPrana: 80 };
  let shake = 0, flash = 0, slowmo = 0, overLockUntil = 0, tideDanger = 0;

  // ───────────────────────── Persistence + audio ────────────────────────────
  const LS_META = 'saptaloka.ascent.meta.v1', LS_MUTE = 'saptaloka.ascent.mute.v1';
  function defaultMeta() { return { moksha: 0, punya: 0, bestTier: 0, bestRealm: 0, runs: 0, upg: {} }; }
  const meta = defaultMeta();
  let muted = false;
  function loadMeta() {
    try { const r = localStorage.getItem(LS_META); if (r) Object.assign(meta, JSON.parse(r)); } catch {}
    if (!meta.upg || typeof meta.upg !== 'object') meta.upg = {};
    try { muted = localStorage.getItem(LS_MUTE) === '1'; } catch {}
  }
  function saveMeta() { try { localStorage.setItem(LS_META, JSON.stringify(meta)); } catch {} }

  let audioCtx = null;
  function ensureAudio() { if (audioCtx) return; try { const A = window.AudioContext || window.webkitAudioContext; if (A) audioCtx = new A(); } catch { audioCtx = null; } }
  function blip(f, dur, type = 'sine', g = 0.05, to = null) {
    if (muted || !audioCtx) return;
    try {
      const n = audioCtx.currentTime, o = audioCtx.createOscillator(), gn = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, n); if (to) o.frequency.exponentialRampToValueAtTime(to, n + dur);
      gn.gain.setValueAtTime(g, n); gn.gain.exponentialRampToValueAtTime(0.0001, n + dur);
      o.connect(gn).connect(audioCtx.destination); o.start(n); o.stop(n + dur + 0.02);
    } catch {}
  }
  const sfx = {
    leap: () => blip(420, 0.12, 'sine', 0.04, 680),
    land: () => blip(240, 0.07, 'triangle', 0.035),
    mote: () => blip(720, 0.12, 'triangle', 0.045, 1180),
    bad:  () => blip(200, 0.18, 'sawtooth', 0.05, 90),
    realm: () => blip(523, 0.4, 'triangle', 0.05, 784),
    die:  () => blip(220, 0.6, 'sawtooth', 0.06, 60),
    win:  () => blip(659, 0.8, 'triangle', 0.06, 1318),
  };

  // ──────────────────────────────── Input ───────────────────────────────────
  // Discrete: a tap on the left/right half = a hop in that direction. No drag.
  function now() { return performance.now(); }
  function canRestart() { return now() >= overLockUntil; }
  function hop(dir) {
    if (gameState !== STATE.PLAY) return;
    ensureAudio();
    if (player.grounded || player.coyote > 0) { doLeap(dir); player.buffer = 0; }
    else player.buffer = T.buffer * 1000;   // remember the intent (ms) to fire on landing
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gameState === STATE.TITLE) return;        // title uses DOM Play button
    if (gameState === STATE.OVER) { if (canRestart()) startRun(); return; }
    if (gameState === STATE.PAUSE) return;
    hop(e.clientX < view.w / 2 ? -1 : 1);
  }, { passive: false });
  // kill iOS double-tap zoom on the play surface
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { e.preventDefault(); hop(-1); }
    else if (k === 'arrowright' || k === 'd') { e.preventDefault(); hop(1); }
    else if (k === ' ') { e.preventDefault(); if (gameState === STATE.OVER && canRestart()) startRun(); else if (gameState === STATE.TITLE) startRun(); }
    else if (k === 'p' || k === 'escape') { if (gameState === STATE.PLAY) pauseGame(); else if (gameState === STATE.PAUSE) resumeGame(); }
    else if (k === 'm') toggleMute();
  });

  // ─────────────────────────── World generation ─────────────────────────────
  function addLedge(col, tier, extra) {
    const w = T.ledgeW * W();
    const l = Object.assign({ x: colCenterX(col) - w / 2, baseX: colCenterX(col), col, y: run.baseY + tier * T.tierH * H(), w, tier, type: 'stone' }, extra || {});
    if (tier === TOP_TIER) { l.summit = true; l.w = W() * 0.5; l.x = W() * 0.25; }
    else if (REALM_START.indexOf(tier) > 0) l.gateway = true;
    ledges.push(l);
    return l;
  }
  function moteType(realmIdx) {
    // survival motes common; virtue motes (false-summit fuel) rarer, more in upper realms
    const r = Math.random();
    const virtue = 0.12 + realmIdx * 0.03;
    if (r < 0.42) return 'soma';                 // +prāṇa
    if (r < 0.78) return 'agni';                 // +tejas
    if (r < 0.78 + virtue) return 'sattva';      // +karma (toward Svarga)
    return 'darshan';                             // +bhakti (toward Deva-loka)
  }
  function addMoteAbove(l, type) {
    motes.push({ x: l.x + l.w / 2, y: l.y + H() * (0.06 + Math.random() * 0.03), type: type || moteType(realmIndexOfTier(l.tier)), r: H() * 0.018, taken: false });
  }
  function genTier() {
    const tier = run.genTier;
    const rIdx = realmIndexOfTier(tier);
    const hz = REALMS[rIdx] ? REALMS[rIdx].hazard : 0.2;
    const canBranch = run.genLastCol >= 1 && run.genLastCol <= T.nCols - 2 && run.pendingConverge === null && tier !== TOP_TIER && !REALM_START.includes(tier);

    if (run.pendingConverge !== null) {
      const col = run.pendingConverge; run.pendingConverge = null; run.genLastCol = col;
      const l = addLedge(col, tier); decorateSingle(l, hz, rIdx);
    } else if (canBranch && Math.random() < 0.22 + hz * 0.22) {
      // branch: greed vs purity. One ledge tempts (mote) but is guarded (asura → −karma).
      const a = addLedge(run.genLastCol - 1, tier);
      const b = addLedge(run.genLastCol + 1, tier);
      const greed = Math.random() < 0.5 ? a : b;
      greed.creature = { alive: true, ph: Math.random() * 6.28 };
      addMoteAbove(greed, Math.random() < 0.5 ? 'soma' : 'agni');
      run.pendingConverge = run.genLastCol;     // next tier converges so both sides continue
    } else {
      let delta = Math.random() < 0.5 ? -1 : 1;
      let col = run.genLastCol + delta;
      if (col < 0 || col > T.nCols - 1) col = run.genLastCol - delta;
      run.genLastCol = col;
      const l = addLedge(col, tier); decorateSingle(l, hz, rIdx);
    }
    run.genTier++;
  }
  function decorateSingle(l, hz, rIdx) {
    if (l.summit || l.gateway) return;
    if (Math.random() < hz * 0.32) { l.move = { amp: W() * (0.05 + Math.random() * 0.05), w: 0.5 + Math.random() * 0.6, ph: Math.random() * 6.28 }; }
    else if (Math.random() < hz * 0.28) { l.crumble = true; l.fuse = 0; }
    if (Math.random() < 0.4) addMoteAbove(l);
  }
  function ensureGenerated() {
    const top = run.camY + view.h * 1.5;
    let guard = 0;
    while (run.baseY + run.genTier * T.tierH * H() < top && run.genTier <= TOP_TIER && guard++ < 60) genTier();
  }

  // ──────────────────────────── Stats / endings ─────────────────────────────
  function applyDelta(stat, amt) {
    stats[stat] += amt;
    if (stat === 'prana' && stats.prana > 100) stats.prana = 100;   // prāṇa caps; others overflow (end conds)
  }
  function checkEnd() {
    if (gameState !== STATE.PLAY) return;
    if (stats.prana <= 0) {
      if (up.secondBreath && !up.breathUsed) {
        up.breathUsed = true; stats.prana = 38; run.tideY = player.y - 0.42 * H();
        addFloater(W() * 0.5, view.h * 0.4, 'Second Breath', '#8fd6a0', 1.6, 1.0); sfx.realm();
        return;
      }
      return endRun('death_prana');
    }
    if (stats.tejas <= 0) return endRun('death_tejas');
    if (stats.tejas >= 100) return endRun('burnout');
    if (stats.karma <= 0) return endRun('death_karma');
    if (stats.karma >= 100) return endRun('false_karma');
    if (stats.bhakti <= 0) return endRun('death_bhakti');
    if (stats.bhakti >= 100) return endRun('false_bhakti');
  }
  const ENDINGS = {
    win_moksha:  { kind: 'win',   title: 'Mokṣa',      sub: 'You crossed beyond the seven worlds. Liberation.' },
    death_prana: { kind: 'death', title: 'The Flood',  sub: 'Prāṇa spent — saṃsāra closed over you.' },
    death_tejas: { kind: 'death', title: 'Ashes',      sub: 'Your inner fire guttered out.' },
    burnout:     { kind: 'death', title: 'Burnout',    sub: 'Too much tejas — you blazed and broke.' },
    death_karma: { kind: 'death', title: 'Fallen',     sub: 'Your deeds turned the wheel against you.' },
    false_karma: { kind: 'false', title: 'Svarga',     sub: 'A heaven of merit — pleasant, and not liberation.' },
    death_bhakti:{ kind: 'death', title: 'Faithless',  sub: 'Devotion withered to nothing.' },
    false_bhakti:{ kind: 'false', title: 'Deva-loka',  sub: 'You became a god — still bound to return.' },
  };

  // ──────────────────────────── Simulation ──────────────────────────────────
  function doLeap(dir) {
    if (player.ledge && player.ledge.crumble) player.ledge.fuse = 999;   // leaving a crumbler triggers its fall
    player.vx = dir * T.leapVX * W();
    player.vy = T.leapVY * H();
    player.grounded = false; player.ledge = null; player.coyote = 0; player.face = dir;
    player.sx = 0.8; player.sy = 1.25; player.leapT = 0.18;             // stretch
    applyDelta('tejas', -T.leapCost * up.leapCostFactor);
    spawnPuff(player.x, player.y, 6, withAlpha(curRealm().accent, 0.6));
    sfx.leap();
  }
  function onLand(l) {
    const wasAir = !player.grounded;
    player.grounded = true; player.ledge = l; player.vx = 0; player.vy = 0; player.y = ledgeTopY(l);
    player.sx = 1.25; player.sy = 0.75; player.leapT = 0.16;            // squash
    // creature on this ledge → stomp (himsa): kill it, lose karma
    if (l.creature && l.creature.alive) {
      l.creature.alive = false; applyDelta('karma', -6);
      addFloater(player.x, S(player.y) - H() * 0.05, '−karma', '#ff7a7a', 0.9, 0.8);
      spawnPuff(player.x, player.y, 12, '#ff6b6b'); sfx.bad();
    }
    if (wasAir) { sfx.land(); spawnPuff(player.x, player.y, 5, 'rgba(220,210,240,0.5)'); }
    // climbed to a new tier?
    if (l.tier > run.tier) { run.tier = l.tier; if (l.tier > run.maxTier) run.maxTier = l.tier; }
    // realm crossing
    const ri = realmIndexOfTier(run.tier);
    if (ri > run.realmIdx) enterRealm(ri);
    if (l.summit) return endRun('win_moksha');
  }
  function enterRealm(ri) {
    run.realmIdx = ri;
    stats.tejas = Math.max(stats.tejas, 82); applyDelta('prana', 8);
    const r = REALMS[ri];
    addFloater(W() * 0.5, view.h * 0.32, r.name, r.accent, 2.0, 1.15);
    addFloater(W() * 0.5, view.h * 0.32 + H() * 0.05, r.gloss, '#cdbfe6', 2.0, 0.7);
    flash = Math.min(0.3, flash + 0.16); sfx.realm();
  }
  function ledgeTopY(l) { return l.y; }

  function simulate(dt) {
    run.t += dt;
    // flood rises; faster over time and with realm; Calm Mind slows it
    const rate = (T.tideV0 + run.t * T.tideRamp + run.realmIdx * T.tideRealm) * H() * up.tideFactor;
    run.tideY += rate * dt;

    // moving ledges
    for (const l of ledges) if (l.move) l.x = l.baseX - l.w / 2 + Math.sin(run.t * l.move.w + l.move.ph) * l.move.amp;
    // crumbling ledges: once stood on, fuse burns, then they drop away
    for (const l of ledges) if (l.crumble && l.fuse) { l.fuse += dt; if (l.fuse > 0.9 && l.solid !== false) l.solid = false; }

    // ---- player physics ----
    if (player.grounded) {
      const l = player.ledge;
      if (l) {
        player.x = l.x + l.w / 2;                  // ride moving ledges
        player.y = ledgeTopY(l);
        if (l.crumble && !l.fuse) l.fuse = 0.0001; // start the fuse on contact
        if (l.solid === false) { player.grounded = false; player.ledge = null; player.vy = -0.05 * H(); } // ledge gone
      }
      player.coyote = T.coyote;
      if (stats.tejas < T.tejasRegenCap) applyDelta('tejas', T.tejasRegen * dt);
    } else {
      player.coyote = Math.max(0, player.coyote - dt);
      if (stats.tejas < T.tejasRegenCap) applyDelta('tejas', T.tejasRegenAir * dt);
      const prevY = player.y;
      player.vy -= T.grav * H() * dt;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      // walls: bounce softly off the play edges
      const halfW = T.ledgeW * W() * 0.25;
      if (player.x < halfW) { player.x = halfW; player.vx = Math.abs(player.vx) * 0.4; }
      if (player.x > W() - halfW) { player.x = W() - halfW; player.vx = -Math.abs(player.vx) * 0.4; }
      // landing: only while descending, crossing a ledge top from above
      if (player.vy < 0) {
        const tol = (up.landTol) * W();
        for (const l of ledges) {
          if (l.solid === false) continue;
          const top = ledgeTopY(l);
          if (prevY >= top - 1 && player.y <= top && player.x >= l.x - tol && player.x <= l.x + l.w + tol) {
            onLand(l); break;
          }
        }
      }
      // buffered hop fires the instant we touch down
      if (player.grounded && player.buffer > 0) { const d = player.face; player.buffer = 0; doLeap(d || 1); }
      if (player.buffer > 0) player.buffer -= dt * 1000;
    }
    player.leapT = Math.max(0, player.leapT - dt);
    if (player.leapT <= 0) { player.sx = lerp(player.sx, 1, Math.min(1, dt * 12)); player.sy = lerp(player.sy, 1, Math.min(1, dt * 12)); }

    // ---- flood interaction ----
    if (player.y <= run.tideY) { applyDelta('prana', -T.tideDrain * dt); if (Math.random() < dt * 8) spawnPuff(player.x, run.tideY, 2, withAlpha(curRealm().tide, 0.8)); }
    tideDanger = clamp(1 - (player.y - run.tideY) / (0.55 * H()), 0, 1);

    // ---- motes ----
    const pcx = player.x, pcy = player.y - T.bodyH * H() * 0.5;
    for (const m of motes) {
      if (m.taken) continue;
      const dx = m.x - pcx, dy = m.y - pcy, rr = (m.r + 0.06 * W());
      if (dx * dx + dy * dy < rr * rr) collectMote(m);
    }

    // ---- camera: follow up, keep flood near the bottom, never drop below progress ----
    const targetFromPlayer = player.y - T.anchor * H();
    const targetFromTide = run.tideY - T.tideMargin * H();
    const target = Math.max(targetFromPlayer, targetFromTide);
    run.camY = Math.max(run.camY, lerp(run.camY, target, Math.min(1, dt * T.camLerp)));

    ensureGenerated();
    cull();

    // juice decay
    shake = Math.max(0, shake - dt * H() * 0.1);
    flash = Math.max(0, flash - dt * 1.8);
    updateParticles(dt); updateFloaters(dt); updateEmbers(dt);

    checkEnd();
  }

  function collectMote(m) {
    m.taken = true;
    if (m.type === 'soma') { applyDelta('prana', 12); float('+prāṇa', '#8fd6a0'); }
    else if (m.type === 'agni') { applyDelta('tejas', 15); float('+tejas', '#ff9d6b'); }
    else if (m.type === 'sattva') { applyDelta('karma', 8); float('+karma', '#7fc2ff'); }
    else if (m.type === 'darshan') { applyDelta('bhakti', 8); float('+bhakti', '#c79bff'); }
    spawnPuff(m.x, m.y, 8, moteColor(m.type)); sfx.mote();
    function float(txt, col) { addFloater(m.x, S(m.y), txt, col, 0.9, 0.72); }
  }
  function moteColor(type) {
    return type === 'soma' ? '#8fd6a0' : type === 'agni' ? '#ff9d6b' : type === 'sattva' ? '#7fc2ff' : '#c79bff';
  }
  function curRealm() { return REALMS[run.realmIdx] || REALMS[0]; }

  function cull() {
    const floor = run.tideY - 0.6 * H();
    for (let i = ledges.length - 1; i >= 0; i--) if (ledges[i].y < floor && ledges[i] !== player.ledge) ledges.splice(i, 1);
    for (let i = motes.length - 1; i >= 0; i--) if (motes[i].taken || motes[i].y < floor) motes.splice(i, 1);
  }

  // ──────────────────────────── Particles / text ────────────────────────────
  function spawnPuff(x, yWorld, n, color) {
    const sy = S(yWorld);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = H() * (0.05 + Math.random() * 0.18); particles.push({ x, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.4, max: 0.8, r: H() * (0.003 + Math.random() * 0.004), color }); }
  }
  function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.vy += H() * 0.4 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); } }
  function addFloater(x, y, text, color, life, size) { floaters.push({ x, y, text, color, life, max: life, size }); }
  function updateFloaters(dt) { for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.y -= H() * 0.09 * dt; f.life -= dt; if (f.life <= 0) floaters.splice(i, 1); } }
  function initEmbers() { embers.length = 0; for (let i = 0; i < 36; i++) embers.push({ x: Math.random(), y: Math.random(), r: Math.random() < 0.7 ? 1.2 : 2.2, sp: 0.2 + Math.random() * 0.5, ph: Math.random() * 6.28 }); }
  function updateEmbers(dt) { for (const e of embers) { e.y -= dt * e.sp * 0.05; if (e.y < -0.05) { e.y = 1.05; e.x = Math.random(); } e.ph += dt; } }

  // ───────────────────────────── Rendering ──────────────────────────────────
  let _sky = { key: '', g: null };
  function skyGrad(r) {
    const key = r.key + Math.round(view.h);
    if (_sky.key !== key) {
      const g = ctx.createLinearGradient(0, 0, 0, view.h);
      g.addColorStop(0, r.sky[0]); g.addColorStop(0.55, r.sky[1]); g.addColorStop(1, r.sky[2]);
      _sky = { key, g };
    }
    return _sky.g;
  }
  // a parallax silhouette band that scrolls slowly with the climb (cheap infinite tile)
  function silhouette(realm, factor, baseFrac, ampFrac, fill, rim) {
    const w = view.w, span = w * 0.16, off = ((run.camY * factor) % span + span) % span;
    const baseY = view.h * baseFrac, amp = view.h * ampFrac, seed = realm.key.length + factor * 10;
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(-span, view.h);
    for (let i = -1; i * span - off < w + span; i++) {
      const sx = i * span - off, hgt = amp * (0.4 + 0.6 * hash(i * 1.3 + seed));
      ctx.lineTo(sx, baseY - hgt); ctx.lineTo(sx + span * 0.5, baseY - hgt * 0.7); ctx.lineTo(sx + span, baseY - hgt);
    }
    ctx.lineTo(w + span, view.h); ctx.closePath(); ctx.fill();
    if (rim) {
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, view.h * 0.0016);
      ctx.beginPath();
      for (let i = -1; i * span - off < w + span; i++) { const sx = i * span - off, hgt = amp * (0.4 + 0.6 * hash(i * 1.3 + seed)); ctx.moveTo(sx, baseY - hgt); ctx.lineTo(sx + span * 0.5, baseY - hgt * 0.7); ctx.lineTo(sx + span, baseY - hgt); }
      ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    }
  }
  function drawBackground() {
    const r = curRealm(), w = view.w, h = view.h;
    ctx.fillStyle = skyGrad(r); ctx.fillRect(0, 0, w, h);
    // far embers / stars (slow parallax)
    ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) { const ex = ((e.x + run.camY * 0.00002 * e.sp) % 1 + 1) % 1 * w; ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(e.ph)); ctx.fillStyle = withAlpha(r.accent, 0.8); ctx.beginPath(); ctx.arc(ex, e.y * h, e.r, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // two parallax silhouette bands → depth
    silhouette(r, 0.12, 0.62, 0.2, withAlpha(r.sky[1], 0.7), withAlpha(r.accent, 0.25));
    silhouette(r, 0.28, 0.72, 0.16, withAlpha(r.sky[2], 0.92), withAlpha(r.accent, 0.4));
    // depth haze toward the horizon
    const hz = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.85); hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, r.mist);
    ctx.fillStyle = hz; ctx.fillRect(0, h * 0.5, w, h * 0.4);
  }

  // 2.5D slab: a top face (lighter parallelogram, offset up-right for depth) + a front face.
  function drawLedge(l) {
    const r = curRealm(), sx = l.x, syTop = S(l.y), w = l.w, dx = W() * 0.012, dy = H() * 0.018, frontH = H() * 0.03;
    if (l.solid === false) return;
    let topCol = r.slabTop, sideCol = r.slabSide;
    if (l.summit) { topCol = '#ffffff'; sideCol = '#bdb6d8'; }
    else if (l.gateway) { topCol = r.accent; sideCol = r.slabSide; }
    else if (l.crumble) { topCol = withAlpha(r.slabTop, 0.85); }
    // front face
    ctx.fillStyle = sideCol; ctx.beginPath(); roundRectPath(sx, syTop, w, frontH + dy, Math.min(6, w * 0.06)); ctx.fill();
    // top face (depth parallelogram)
    ctx.beginPath(); ctx.moveTo(sx, syTop); ctx.lineTo(sx + dx, syTop - dy); ctx.lineTo(sx + w + dx, syTop - dy); ctx.lineTo(sx + w, syTop); ctx.closePath();
    ctx.fillStyle = topCol; ctx.fill();
    // accent rim on the leading edge
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = withAlpha(r.accent, l.gateway || l.summit ? 0.9 : 0.4); ctx.lineWidth = Math.max(1.4, H() * 0.0022);
    ctx.beginPath(); ctx.moveTo(sx + dx, syTop - dy); ctx.lineTo(sx + w + dx, syTop - dy); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    if (l.crumble && l.fuse) { ctx.fillStyle = withAlpha('#ff6b6b', 0.5 + 0.4 * Math.sin(run.t * 22)); ctx.fillRect(sx, syTop - dy - 3, w, 2); }
    if (l.creature && l.creature.alive) drawAsura(sx + w / 2, syTop - dy);
    if (l.summit) { ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(sx + w / 2, syTop - dy, 2, sx + w / 2, syTop - dy, w * 0.7); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(sx - w * 0.2, syTop - dy - H() * 0.2, w * 1.4, H() * 0.25); ctx.globalCompositeOperation = 'source-over'; }
  }
  function roundRectPath(x, y, w, h, rad) { ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); }

  function drawAsura(cx, baseY) {
    const s = H() * 0.05, bob = Math.sin(run.t * 4) * s * 0.08;
    ctx.save(); ctx.translate(cx, baseY - s * 0.5 + bob);
    ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(0, 0, 1, 0, 0, s); g.addColorStop(0, 'rgba(255,80,90,0.5)'); g.addColorStop(1, 'rgba(255,80,90,0)'); ctx.fillStyle = g; ctx.fillRect(-s, -s, s * 2, s * 2); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#2a0f14'; ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, 6.28); ctx.fill();
    ctx.strokeStyle = '#ff5a64'; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.35); ctx.lineTo(-s * 0.5, -s * 0.7); ctx.moveTo(s * 0.3, -s * 0.35); ctx.lineTo(s * 0.5, -s * 0.7); ctx.stroke();   // horns
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(-s * 0.18, -s * 0.05, s * 0.08, 0, 6.28); ctx.arc(s * 0.18, -s * 0.05, s * 0.08, 0, 6.28); ctx.fill();   // eyes
    ctx.restore();
  }

  function drawMote(m) {
    if (m.taken) return; const sy = S(m.y); if (sy < -30 || sy > view.h + 30) return;
    const col = moteColor(m.type), pulse = 0.7 + 0.3 * Math.sin(run.t * 4 + m.x);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(m.x, sy, 1, m.x, sy, m.r * 2.4); g.addColorStop(0, withAlpha(col, 0.9 * pulse)); g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g; ctx.fillRect(m.x - m.r * 2.4, sy - m.r * 2.4, m.r * 4.8, m.r * 4.8);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(m.x, sy, m.r * 0.5, 0, 6.28); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // the climber — a luminous soul-flame billboard with squash/stretch + lean
  function drawPlayer() {
    const bh = T.bodyH * H(), sx = player.x, syFeet = S(player.y);
    const w = bh * 0.62 * player.sx, h = bh * player.sy, cx = sx + player.face * bh * 0.06, cy = syFeet - h * 0.5;
    const r = curRealm();
    // shadow on the ledge
    if (player.grounded) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx, syFeet + 2, w * 0.5, bh * 0.08, 0, 0, 6.28); ctx.fill(); }
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, bh * 0.9); halo.addColorStop(0, withAlpha(r.accent, 0.5)); halo.addColorStop(1, withAlpha(r.accent, 0));
    ctx.fillStyle = halo; ctx.fillRect(cx - bh, cy - bh, bh * 2, bh * 2);
    // teardrop flame body
    ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.6); ctx.quadraticCurveTo(cx + w * 0.6, cy - h * 0.1, cx, cy + h * 0.5); ctx.quadraticCurveTo(cx - w * 0.6, cy - h * 0.1, cx, cy - h * 0.6); ctx.closePath();
    const body = ctx.createLinearGradient(0, cy - h * 0.6, 0, cy + h * 0.5); body.addColorStop(0, '#fff8e6'); body.addColorStop(0.5, r.accent); body.addColorStop(1, withAlpha(r.accent, 0.5));
    ctx.fillStyle = body; ctx.fill();
    // bright core
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.22, 0, 6.28); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTide() {
    const r = curRealm(), w = view.w, h = view.h, sy = S(run.tideY);
    if (sy > h + 4) return;
    const top = Math.max(0, sy);
    ctx.fillStyle = r.tide; ctx.fillRect(0, top, w, h - top);
    // turbulent glowing surface
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = withAlpha(r.accent, 0.5); ctx.lineWidth = Math.max(2, h * 0.004); ctx.beginPath();
    for (let x = 0; x <= w; x += w * 0.04) { const yy = sy + Math.sin(x * 0.03 + run.t * 3) * h * 0.012 + Math.sin(x * 0.07 - run.t * 4) * h * 0.006; if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
    const gg = ctx.createLinearGradient(0, sy - h * 0.06, 0, sy + h * 0.06); gg.addColorStop(0, withAlpha(r.accent, 0)); gg.addColorStop(0.5, withAlpha(r.accent, 0.18)); gg.addColorStop(1, withAlpha(r.accent, 0));
    ctx.fillStyle = gg; ctx.fillRect(0, sy - h * 0.06, w, h * 0.12);
    ctx.globalCompositeOperation = 'source-over';
  }

  // HUD: realm + four stat bars + flood danger
  const STAT_DEF = [
    { k: 'prana', label: 'PRĀ', col: '#8fd6a0' },
    { k: 'tejas', label: 'TEJ', col: '#ff9d6b' },
    { k: 'karma', label: 'KAR', col: '#7fc2ff' },
    { k: 'bhakti', label: 'BHA', col: '#c79bff' },
  ];
  function drawHUD() {
    const w = view.w, h = view.h, pad = Math.max(12, h * 0.018);
    // realm name + progress, top centre
    const r = curRealm();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `700 ${h * 0.026}px "Hoefler Text", Georgia, serif`; ctx.fillStyle = '#ece6f5';
    ctx.fillText(r.name, w * 0.5, pad);
    ctx.font = `${h * 0.015}px "Hoefler Text", Georgia, serif`; ctx.fillStyle = '#9b8fb5';
    ctx.fillText(`${run.realmIdx + 1} / ${REALMS.length} · tier ${run.tier - REALM_START[run.realmIdx] + 1}/${r.tiers}`, w * 0.5, pad + h * 0.03);
    // stat bars, top-left
    const bw = Math.min(w * 0.30, 150), bh = Math.max(7, h * 0.012), gap = h * 0.008;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    STAT_DEF.forEach((s, i) => {
      const y = pad + i * (bh + gap), v = clamp(stats[s.k], 0, 100) / 100;
      ctx.font = `700 ${bh}px "Helvetica Neue", Arial, sans-serif`; ctx.fillStyle = s.col; ctx.fillText(s.label, pad, y + bh * 0.5);
      const x0 = pad + bh * 2.4;
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; roundFill(x0, y, bw, bh, bh * 0.5);
      ctx.fillStyle = s.col; roundFill(x0, y, bw * v, bh, bh * 0.5);
      // danger pips when a stat nears a fatal edge (0, or 100 for tejas/karma/bhakti)
      if (stats[s.k] >= 92 && s.k !== 'prana') { ctx.fillStyle = '#fff'; ctx.fillRect(x0 + bw - 2, y - 1, 2, bh + 2); }
    });
    // flood danger vignette
    if (tideDanger > 0.3) { ctx.fillStyle = withAlpha(r.tide, (tideDanger - 0.3) * 0.6); ctx.fillRect(0, 0, w, h); }
  }
  function roundFill(x, y, w, h, rad) { if (w <= 0) return; ctx.beginPath(); roundRectPath(x, y, w, h, Math.min(rad, w * 0.5)); ctx.fill(); }

  function drawParticles() { for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); } ctx.globalAlpha = 1; }
  function drawFloaters() { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (const f of floaters) { ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max * 1.5)); ctx.fillStyle = f.color; ctx.font = `800 ${H() * 0.03 * (f.size || 0.7)}px "Hoefler Text", Georgia, serif`; ctx.fillText(f.text, f.x, f.y); } ctx.globalAlpha = 1; }

  function render() {
    ctx.save();
    if (shake > 0.5 && !reduceMotion) { const a = Math.random() * 6.28; ctx.translate(Math.cos(a) * shake, Math.sin(a) * shake); }
    drawBackground();
    // ledges (far→near by screen y is fine for this flat plane)
    for (const l of ledges) { const sy = S(l.y); if (sy > -40 && sy < view.h + 60) drawLedge(l); }
    for (const m of motes) drawMote(m);
    drawTide();
    if (gameState !== STATE.TITLE) drawPlayer();
    drawParticles();
    if (gameState === STATE.PLAY || gameState === STATE.PAUSE) drawHUD();
    drawFloaters();
    ctx.restore();
    if (flash > 0.01 && !reduceMotion) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, view.w, view.h); }
  }

  // ──────────────────────────────── Loop ────────────────────────────────────
  const STEP = 1 / 120; let last = 0, acc = 0;
  function frame(t) {
    if (!view.w || !view.h) resize();
    if (!last) last = t; let dt = (t - last) / 1000; last = t; if (dt > 0.25) dt = 0.25;
    if (slowmo > 0 && gameState === STATE.OVER) { dt *= 0.35; slowmo -= dt; }
    if (gameState === STATE.PLAY) { acc += dt; let s = 0; while (acc >= STEP && s < 300) { simulate(STEP); acc -= STEP; s++; } }
    else if (gameState === STATE.TITLE) { run.t += dt; updateEmbers(dt); }
    else if (gameState === STATE.OVER) { updateParticles(dt); updateFloaters(dt); }
    render();
    requestAnimationFrame(frame);
  }

  // ────────────────────────── Upgrades (meta) ───────────────────────────────
  const UPGRADES = [
    { id: 'breath',  name: 'Second Breath',     desc: 'Survive one drowning per climb.',  costs: [40],          apply: (s) => { s.secondBreath = true; } },
    { id: 'stamina', name: "Pilgrim's Stamina",  desc: 'Hops cost less tejas.',             costs: [30, 60, 100], apply: (s, l) => { s.leapCostFactor = 1 - 0.16 * l; } },
    { id: 'foot',    name: 'Steady Foot',        desc: 'Wider, more forgiving landings.',   costs: [35, 70],      apply: (s, l) => { s.landTol = T.landTolBase + 0.022 * l; } },
    { id: 'calm',    name: 'Calm Mind',          desc: 'The flood rises more slowly.',      costs: [35, 70],      apply: (s, l) => { s.tideFactor = 1 - 0.18 * l; } },
    { id: 'grace',   name: 'Grace',              desc: 'Begin with fuller prāṇa.',          costs: [30, 60],      apply: (s, l) => { s.startPrana = 80 + 12 * l; } },
  ];
  function upgLevel(id) { return meta.upg[id] | 0; }
  function upgCost(u) { const l = upgLevel(u.id); return l < u.costs.length ? u.costs[l] : null; }
  function applyStartingUpgrades() {
    up.secondBreath = false; up.breathUsed = false; up.leapCostFactor = 1; up.landTol = T.landTolBase; up.tideFactor = 1; up.startPrana = 80;
    for (const u of UPGRADES) { const l = upgLevel(u.id); if (l > 0) u.apply(up, l); }
  }

  // ────────────────────────────── UI / screens ──────────────────────────────
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  const titleScreen = document.getElementById('titleScreen'), overScreen = document.getElementById('overScreen'), pauseScreen = document.getElementById('pauseScreen');
  const playBtn = document.getElementById('playBtn'), againBtn = document.getElementById('againBtn'), menuBtn = document.getElementById('menuBtn'), resumeBtn = document.getElementById('resumeBtn'), quitBtn = document.getElementById('quitBtn');
  const pauseBtn = document.getElementById('pauseBtn'), muteBtn = document.getElementById('muteBtn');
  const bestLineEl = document.getElementById('bestLine'), punyaCountEl = document.getElementById('punyaCount'), upgradesEl = document.getElementById('upgrades');
  const overTitleEl = document.getElementById('overTitle'), overSubEl = document.getElementById('overSub'), overStatEl = document.getElementById('overStat'), overRewardEl = document.getElementById('overReward');

  function realmName(idx) { return REALMS[idx] ? REALMS[idx].name : '—'; }
  function reflectMeta() {
    bestLineEl.innerHTML = `Highest <strong>${realmName(meta.bestRealm)}</strong> · Mokṣa <strong>${meta.moksha}</strong>`;
    punyaCountEl.textContent = meta.punya | 0;
    buildUpgrades();
  }
  function buildUpgrades() {
    upgradesEl.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = upgLevel(u.id), cost = upgCost(u), maxed = cost === null, afford = !maxed && meta.punya >= cost;
      const row = document.createElement('button');
      row.className = 'upg' + (maxed ? ' maxed' : afford ? ' afford' : ' locked');
      row.disabled = maxed || !afford;
      row.innerHTML = `<span class="upg-main"><span class="upg-name">${u.name}</span><span class="upg-desc">${u.desc}</span></span>`
        + `<span class="upg-meta">${pips(lvl, u.costs.length)}<span class="upg-cost">${maxed ? 'MAX' : '◈ ' + cost}</span></span>`;
      row.addEventListener('click', () => buyUpgrade(u));
      upgradesEl.appendChild(row);
    }
  }
  function pips(lvl, max) { let s = '<span class="pips">'; for (let i = 0; i < max; i++) s += `<i class="${i < lvl ? 'on' : ''}"></i>`; return s + '</span>'; }
  function buyUpgrade(u) {
    const cost = upgCost(u); if (cost === null || meta.punya < cost) return;
    meta.punya -= cost; meta.upg[u.id] = upgLevel(u.id) + 1; saveMeta(); reflectMeta();
    blip(880, 0.12, 'triangle', 0.05, 1320);
  }

  function startRun() {
    ensureAudio(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    applyStartingUpgrades();
    ledges = []; motes = []; particles.length = 0; floaters.length = 0;
    run.t = 0; run.tier = 0; run.maxTier = 0; run.realmIdx = 0; run.genTier = 0; run.genLastCol = 1; run.pendingConverge = null; run.baseY = 0;
    run.camY = run.baseY - (1 - T.anchor) * H();
    run.tideY = run.camY - 0.32 * H();
    stats.prana = Math.min(100, up.startPrana);
    stats.tejas = T.startTejas; stats.karma = T.startKarma; stats.bhakti = T.startBhakti;
    // starting ledge under the player at tier 0
    const start = addLedge(run.genLastCol, 0); run.genTier = 1;
    player.ledge = start; player.x = start.x + start.w / 2; player.y = start.y; player.vx = 0; player.vy = 0; player.grounded = true; player.face = 1; player.sx = 1; player.sy = 1; player.leapT = 0; player.buffer = 0;
    ensureGenerated();
    shake = 0; flash = 0; slowmo = 0; tideDanger = 0;
    hide(titleScreen); hide(overScreen); hide(pauseScreen); pauseBtn.hidden = false;
    gameState = STATE.PLAY; last = 0; acc = 0;
  }

  function endRun(key) {
    if (gameState === STATE.OVER) return;
    const e = ENDINGS[key] || ENDINGS.death_prana;
    gameState = STATE.OVER; overLockUntil = now() + 700;
    flash = e.kind === 'win' ? 0.6 : 0.45; shake = reduceMotion ? 0 : H() * 0.018; slowmo = 0.7;
    if (e.kind === 'win') sfx.win(); else sfx.die();
    spawnPuff(player.x, player.y, 22, e.kind === 'win' ? '#fff' : withAlpha(curRealm().tide, 0.9));

    // rewards: puṇya from height climbed; mokṣa + bonus on the true win
    const reachedRealm = realmIndexOfTier(run.maxTier);
    const earned = Math.round(run.maxTier * 1.5) + (e.kind === 'win' ? 60 : 0);
    meta.punya = (meta.punya | 0) + earned;
    meta.runs = (meta.runs | 0) + 1;
    if (run.maxTier > (meta.bestTier | 0)) meta.bestTier = run.maxTier;
    if (reachedRealm > (meta.bestRealm | 0)) meta.bestRealm = reachedRealm;
    if (e.kind === 'win') meta.moksha = (meta.moksha | 0) + 1;
    saveMeta();

    overTitleEl.textContent = e.title;
    overTitleEl.className = 'over-title ' + e.kind;
    overSubEl.textContent = e.sub;
    overStatEl.innerHTML = e.kind === 'win'
      ? `Reached <strong>Satyaloka</strong> — the summit`
      : `Reached <strong>${realmName(reachedRealm)}</strong> · tier ${run.maxTier - REALM_START[reachedRealm] + 1}`;
    overRewardEl.innerHTML = `+<strong>${earned}</strong> puṇya` + (e.kind === 'win' ? ' · +1 mokṣa' : '');
    setTimeout(() => { if (gameState === STATE.OVER) { reflectMeta(); show(overScreen); overScreen.focus(); } }, 700);
  }

  function pauseGame() { if (gameState !== STATE.PLAY) return; gameState = STATE.PAUSE; show(pauseScreen); }
  function resumeGame() { if (gameState !== STATE.PAUSE) return; hide(pauseScreen); gameState = STATE.PLAY; last = 0; acc = 0; }
  function quitToMenu() { gameState = STATE.TITLE; hide(pauseScreen); hide(overScreen); pauseBtn.hidden = true; reflectMeta(); show(titleScreen); }
  function toggleMute() { muted = !muted; try { localStorage.setItem(LS_MUTE, muted ? '1' : '0'); } catch {} reflectMute(); }
  function reflectMute() { muteBtn.textContent = muted ? '♪̸' : '♪'; muteBtn.setAttribute('aria-pressed', String(muted)); muteBtn.style.opacity = muted ? '0.5' : '1'; }

  playBtn.addEventListener('click', startRun);
  againBtn.addEventListener('click', () => { if (canRestart()) startRun(); });
  menuBtn.addEventListener('click', quitToMenu);
  resumeBtn.addEventListener('click', resumeGame);
  quitBtn.addEventListener('click', quitToMenu);
  pauseBtn.addEventListener('click', pauseGame);
  muteBtn.addEventListener('click', toggleMute);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (gameState === STATE.PLAY) pauseGame(); } else { last = 0; acc = 0; } });

  // ──────────────────────────────── Boot ────────────────────────────────────
  // Debug/sim hook (opt-in via ?debug) — read live state, drive hops headlessly.
  if (location.search.includes('debug')) {
    window.__ascent = {
      run, stats, player, T, REALM_START, TOP_TIER,
      get ledges() { return ledges; }, get motes() { return motes; },
      state: () => gameState, start: startRun, hop,
      // tap toward the nearest higher ledge (correct-direction auto-hop, for tests)
      hopBest() {
        let best = null, bd = Infinity;
        for (const l of ledges) { if (l.tier <= run.tier || l.solid === false) continue; const d = Math.abs(l.tier - (run.tier + 1)) * 1000 + Math.abs((l.x + l.w / 2) - player.x); if (d < bd) { bd = d; best = l; } }
        if (best) hop((best.x + best.w / 2) >= player.x ? 1 : -1);
        return best ? (best.tier + '@' + Math.round(best.x + best.w / 2)) : 'none';
      },
    };
  }
  resize(); loadMeta(); initEmbers(); reflectMeta(); reflectMute();
  if (!REALMS.length) { console.error('Saptaloka Ascent: realms.js failed to load.'); }
  requestAnimationFrame(frame);
})();
