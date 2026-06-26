/* Runner 626 — a stick-figure survival race.
 *
 * Inspired by MayhemStudio's Runner 626 (2007): you (yellow) race rival
 * creatures across weaving lanes while Omicron's disintegration ray devours
 * whoever falls to the back. Hit boost pads, punch crystals, dodge energy rays,
 * grab items (turbo/shield/shockwave/mines), and keep your lead buffer alive.
 *
 * Pure static, single file, HTML5 canvas, fixed-timestep sim, all art procedural
 * (no image assets). Shared-screen race: the player is pinned at PLAYER_X and the
 * whole world (rivals, ray, track) is drawn at worldX - camera. The "lead buffer"
 * (distance between you and the ray) is your health — boosts/clean running grow
 * it, stumbles shrink it; the pace rises forever, so a mistake always looms.
 *
 * Units: vertical = fractions of viewport H, horizontal/speed = fractions of W.
 */
(() => {
  'use strict';

  // ───────────────────────────── Tuning ─────────────────────────────────────
  const T = {
    playerXFrac: 0.34,
    laneBase:    0.80,    // lane 0 (lowest) baseline, fraction of H
    laneGap:     0.135,   // vertical spacing between lanes (×H)
    nLanes:      3,
    bodyH:       0.150,   // runner height (×H)
    weaveAmp:    0.40,    // lane weave amplitude (× laneGap) — the criss-cross
    weaveLenW:   1.5,     // weave wavelength in screen-widths
    laneSwitch:  0.16,    // seconds to slide between lanes
    // speed / pace (×W per second)
    paceV0:      0.40,
    paceRamp:    0.0009,  // pace gain per second
    paceStage:   0.05,    // pace gain per stage
    paceMax:     1.25,
    leadStart:   0.52,    // initial lead over the ray (×W) — close enough to loom
    boostMult:   1.7,     // boost-pad / turbo speed multiplier
    boostTime:   0.9,
    turboTime:   2.2,
    stumbleMult: 0.5,     // speed during a stumble
    stumbleTime: 0.62,
    punchBonus:  0.35,    // brief speed bump for punching a crystal
    // jump (×H)
    jumpVel:     1.40,
    gravUp:      2.30,
    gravFall:    3.55,
    maxFall:     3.4,
    shortHopCut: 0.45,
    coyote:      0.10,
    buffer:      0.13,
    jumpPadVel:  1.9,
    // scoring / stage
    pxPerMeter:  0.05,    // meter = this fraction of W of worldX
    stageMeters: 600,
    // spawn
    gapBaseW:    0.42,    // base spacing between track features (×W)
    // collision
    punchRangeW: 0.06,    // crystal punch reach ahead (×W)
  };

  // Pick-your-runner roster (Runner 626-inspired). Stats are 1..5 and change how
  // the runner plays; `type` drives a small visual trait on the figure.
  //   speed → clean pace vs the ray   jump → jump height
  //   grit  → shrugs off stumbles      accel → boost/turbo potency
  const CHARACTERS = [
    { id: 'z626',   name: '626',    type: 'human',  body: '#ffd23f', core: '#fff1ad', glow: 'rgba(255,210,63,0.55)',  speed: 3, accel: 3, jump: 3, grit: 3 },
    { id: 'sigma',  name: 'Sigma',  type: 'insect', body: '#54e680', core: '#c6ffd9', glow: 'rgba(84,230,128,0.55)',  speed: 4, accel: 4, jump: 2, grit: 2 },
    { id: 'rocket', name: 'Rocket', type: 'mech',   body: '#5ab4ff', core: '#cdeaff', glow: 'rgba(90,180,255,0.55)',  speed: 3, accel: 5, jump: 4, grit: 1 },
    { id: 'balrog', name: 'Balrog', type: 'beast',  body: '#ff5470', core: '#ffc6d2', glow: 'rgba(255,84,112,0.55)',  speed: 2, accel: 2, jump: 3, grit: 5 },
    { id: 'tagma',  name: 'Tagma',  type: 'mech',   body: '#b98cff', core: '#e6d6ff', glow: 'rgba(170,120,255,0.55)', speed: 3, accel: 3, jump: 5, grit: 3 },
    { id: 'sidkas', name: 'Sidkas', type: 'beast',  body: '#ff9a3f', core: '#ffd6a8', glow: 'rgba(255,140,40,0.55)',  speed: 2, accel: 3, jump: 4, grit: 4 },
  ];
  function statMods(ch) {
    return {
      cleanMult: 1.0 + (ch.speed - 3) * 0.02,            // 0.96 .. 1.04 — pace vs the ray
      jumpMul:   0.85 + ch.jump * 0.05,                  // 0.90 .. 1.10
      stumbleTMul: 1.25 - ch.grit * 0.09,                // 1.16 .. 0.80 — grit = shorter stumbles
      boostMul:  T.boostMult + (ch.accel - 3) * 0.09,    // boost/turbo potency
    };
  }
  let chosenChar = 0;
  const C = {
    danger: '#ff5470', crystal: '#c79bff', beam: '#ff3da6', orb: '#ff7ad9',
    boost: '#54e6c8', item: '#ffd76b', ray: '#ff2e6e', text: '#ece6f5', muted: '#9b8fb5',
    lane: 'rgba(120,200,255,0.30)', laneHot: '#ffd23f',
  };

  // ──────────────────────────── Canvas (hi-DPI) ─────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HARNESS = location.search.includes('harness');   // headless test mode (no focus/visibility → skip auto-pause)
  const view = { w: 0, h: 0 };
  let PX = 0, BODY = 0, LGAP = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.w = window.innerWidth; view.h = window.innerHeight;
    canvas.width = Math.round(view.w * dpr); canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    PX = view.w * T.playerXFrac; BODY = view.h * T.bodyH; LGAP = view.h * T.laneGap;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  const H = () => view.h, W = () => view.w;

  // lane geometry — weaving rails (criss-cross). Collision is lane-index based.
  function laneY(lane, worldX) {
    const base = view.h * T.laneBase - lane * LGAP;
    const k = (Math.PI * 2) / (view.w * T.weaveLenW);
    return base + Math.sin(worldX * k + lane * 2.1) * LGAP * T.weaveAmp;
  }

  // ──────────────────────────────── State ───────────────────────────────────
  const STATE = { TITLE: 'title', PLAY: 'play', PAUSE: 'pause', DEAD: 'dead' };
  let gameState = STATE.TITLE;

  function newRacer(charIndex, isPlayer) {
    const col = CHARACTERS[charIndex];
    return {
      charIndex, isPlayer, col, mods: statMods(col),
      worldX: 0, lane: 1, laneF: 1,           // laneF = smooth interpolated lane
      jumpH: 0, vy: 0, onGround: true,
      speed: 0, mult: 1, boostT: 0, turboT: 0, stumbleT: 0, punchT: 0,
      shieldT: 0, mineT: 0,
      coyote: 0, buffer: 0, jumpHeld: false,
      runPhase: Math.random() * 6.28, alive: true,
      // ai
      skill: isPlayer ? 1 : 0.9 + Math.random() * 0.18,
      think: 0,
    };
  }

  let racers = [];
  let player = null;
  const features = [];   // track features: {worldX, lane, type, w, ...}
  const mines = [];      // dropped mines {worldX, lane}
  const particles = [];
  const floaters = [];
  const stars = [];

  const run = {
    pace: 0, t: 0, camera: 0, rayX: 0, stage: 1,
    meters: 0, best: 0, runs: 0,
    spawnX: 0, lastFeatureLane: 1, stageBanner: 0, passedBest: false,
  };
  let shake = 0, flash = 0, hitStop = 0, slowmo = 0, deadLockUntil = 0, rayDanger = 0;

  // ───────────────────────── Persistence + audio ────────────────────────────
  const LS_META = 'runner.meta.v2', LS_MUTE = 'runner.mute.v1';
  let muted = false;
  const meta = { best: 0, runs: 0 };
  function loadPrefs() {
    try { const r = localStorage.getItem(LS_META); if (r) Object.assign(meta, JSON.parse(r)); } catch {}
    try { muted = localStorage.getItem(LS_MUTE) === '1'; } catch {}
    try { const ci = parseInt(localStorage.getItem('runner.char.v1'), 10); if (ci >= 0 && ci < CHARACTERS.length) chosenChar = ci; } catch {}
    run.best = meta.best | 0; bestScoreEl.textContent = run.best; reflectMute();
  }
  function saveMeta() { meta.best = Math.max(meta.best | 0, run.best); try { localStorage.setItem(LS_META, JSON.stringify(meta)); } catch {} }
  function reflectMute() { muteBtn.textContent = muted ? '♪̸' : '♪'; muteBtn.setAttribute('aria-pressed', String(muted)); muteBtn.style.opacity = muted ? '0.5' : '1'; }

  let audioCtx = null;
  function ensureAudio() { if (audioCtx) return; try { const A = window.AudioContext || window.webkitAudioContext; if (A) audioCtx = new A(); } catch { audioCtx = null; } }
  function blip(f, dur, type = 'square', g = 0.05, to = null) {
    if (muted || !audioCtx) return;
    try { const n = audioCtx.currentTime, o = audioCtx.createOscillator(), gn = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, n); if (to) o.frequency.exponentialRampToValueAtTime(to, n + dur);
      gn.gain.setValueAtTime(g, n); gn.gain.exponentialRampToValueAtTime(0.0001, n + dur);
      o.connect(gn).connect(audioCtx.destination); o.start(n); o.stop(n + dur + 0.02); } catch {}
  }
  const sfx = {
    jump: () => blip(520, 0.12, 'square', 0.04, 760), land: () => blip(170, 0.08, 'sine', 0.035),
    lane: () => blip(440, 0.07, 'triangle', 0.03, 620), punch: () => blip(300, 0.1, 'square', 0.05, 120),
    boost: () => blip(600, 0.16, 'sawtooth', 0.045, 1100), item: () => blip(880, 0.12, 'triangle', 0.05, 1320),
    stumble: () => blip(200, 0.18, 'sawtooth', 0.05, 90), stage: () => blip(700, 0.2, 'triangle', 0.05, 1500),
    die: () => blip(240, 0.6, 'sawtooth', 0.06, 50), zap: () => blip(120, 0.3, 'sawtooth', 0.05, 60),
  };

  // ──────────────────────────────── Input ───────────────────────────────────
  const pointers = new Map();
  let jumpPointerId = null;
  const keyHeld = {};
  function now() { return performance.now(); }
  function canRestart() { return now() >= deadLockUntil; }
  function clearInput() { pointers.clear(); jumpPointerId = null; keyHeld.jump = false; }

  function pressJump() { ensureAudio(); if (gameState !== STATE.PLAY || !player.alive) return; player.buffer = T.buffer; resolveTap(player); }
  // a tap is context-sensitive: punch a crystal if one is in reach, else jump
  function resolveTap(r) {
    if (r.onGround) {
      const cr = crystalInPunchRange(r);
      if (cr) { punchCrystal(r, cr); return; }
    }
    tryJump(r);
  }
  function releaseJump() { player.jumpHeld = false; if (!player.onGround && player.vy < 0) player.vy *= T.shortHopCut; }
  function tryJump(r) {
    const can = r.onGround || r.coyote > 0;
    if (can && (r.buffer > 0 || !r.isPlayer)) {
      r.vy = -T.jumpVel * r.mods.jumpMul * H(); r.onGround = false; r.coyote = 0; r.buffer = 0; r.jumpHeld = true;
      if (r.isPlayer) { sfx.jump(); spawnDust(PX, feetScreenY(r), 5); }
    }
  }
  function changeLane(r, dir) {
    const t = Math.max(0, Math.min(T.nLanes - 1, r.lane + dir));
    if (t !== r.lane) { r.lane = t; if (r.isPlayer) { sfx.lane(); } }
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gameState === STATE.TITLE) { startRun(); return; }
    if (gameState === STATE.DEAD) { if (canRestart()) startRun(); return; }
    if (gameState === STATE.PAUSE) return;
    const p = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now(), acted: false };
    pointers.set(e.pointerId, p);
    if (jumpPointerId === null) jumpPointerId = e.pointerId;
    // commit jump on a quick tap at release; lane-change on a vertical swipe (below)
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.acted) {
      const dy = p.y - p.sy, dx = p.x - p.sx;
      if (Math.abs(dy) > view.h * 0.05 && Math.abs(dy) > Math.abs(dx)) {  // vertical swipe → lane
        p.acted = true;
        if (e.pointerId === jumpPointerId) jumpPointerId = null;
        changeLane(player, dy < 0 ? +1 : -1);   // swipe up = higher lane
      }
    }
  }, { passive: true });

  function endPointer(e) {
    const p = pointers.get(e.pointerId); if (!p) { return; }
    // a quick, non-swiped press = jump/punch
    if (!p.acted && (now() - p.t) < 280 && Math.abs(p.y - p.sy) < view.h * 0.05) pressJump();
    if (e.pointerId === jumpPointerId) { releaseJump(); jumpPointerId = null; }
    pointers.delete(e.pointerId);
  }
  canvas.addEventListener('pointerup', endPointer, { passive: true });
  canvas.addEventListener('pointercancel', endPointer, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return; const k = e.key.toLowerCase();
    if (k === ' ' || k === 'w') { e.preventDefault();
      if (gameState === STATE.TITLE) return startRun();
      if (gameState === STATE.DEAD) { if (canRestart()) startRun(); return; }
      keyHeld.jump = true; pressJump();
    } else if (k === 'arrowup') { e.preventDefault(); if (gameState === STATE.PLAY) changeLane(player, +1); }
    else if (k === 'arrowdown' || k === 's') { e.preventDefault(); if (gameState === STATE.PLAY) changeLane(player, -1); }
    else if (k === 'arrowleft' || k === 'a') { if (gameState === STATE.TITLE) { e.preventDefault(); selectChar(chosenChar - 1); } }
    else if (k === 'arrowright' || k === 'd') { if (gameState === STATE.TITLE) { e.preventDefault(); selectChar(chosenChar + 1); } }
    else if (k === 'p' || k === 'escape') { if (gameState === STATE.PLAY) pauseGame(); else if (gameState === STATE.PAUSE) resumeGame(); }
    else if (k === 'm') toggleMute();
  });
  window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (k === ' ' || k === 'w') { keyHeld.jump = false; releaseJump(); } });
  window.addEventListener('blur', () => { if (HARNESS) return; if (gameState === STATE.PLAY) pauseGame(); else clearInput(); });

  // ─────────────────────────── Track generation ─────────────────────────────
  const F = { GAP: 'gap', CRYSTAL: 'crystal', BEAM: 'beam', ORB: 'orb', BOOST: 'boost', JUMPPAD: 'jumppad', ITEM: 'item' };
  const HAZARDS = new Set([F.GAP, F.CRYSTAL, F.BEAM, F.ORB]);
  const ITEMS = ['turbo', 'shield', 'shockwave', 'mines'];

  function spawnFeature() {
    const lane = (Math.random() * T.nLanes) | 0;
    const x = run.spawnX;                 // advancing cursor — features march forward in worldX
    const stageF = Math.min(1, run.stage / 8);
    const roll = Math.random();
    let type;
    if (roll < 0.16) type = F.BOOST;
    else if (roll < 0.24) type = F.JUMPPAD;
    else if (roll < 0.34) type = F.ITEM;
    else { // hazard mix, more variety later
      const hr = Math.random();
      if (hr < 0.34) type = F.CRYSTAL;
      else if (hr < 0.6) type = F.GAP;
      else if (hr < 0.82) type = F.BEAM;
      else type = F.ORB;
    }
    const f = { worldX: x, lane, type, w: W() * 0.05, hit: false, broken: false, scored: false };
    if (type === F.GAP) f.w = W() * (0.05 + Math.random() * 0.05 + stageF * 0.03);
    else if (type === F.CRYSTAL) f.w = W() * 0.04;
    else if (type === F.BEAM) { f.w = W() * 0.02; f.beamH = BODY * (1.0 + Math.random() * 0.3); }
    else if (type === F.ORB) { f.w = W() * 0.04; f.orbY = BODY * (0.9 + Math.random() * 0.4); }
    else if (type === F.ITEM) f.item = ITEMS[(Math.random() * ITEMS.length) | 0];
    features.push(f);
    run.lastFeatureLane = lane;

    // spacing scales with pace and shrinks slightly with stage (rising pressure)
    const gap = W() * T.gapBaseW * (run.pace / (T.paceV0 * W())) * (1 - stageF * 0.18) + Math.random() * W() * 0.12;
    run.spawnX = x + Math.max(W() * 0.30, gap);
  }

  // ──────────────────────────── Simulation ──────────────────────────────────
  function simulate(dt) {
    run.t += dt;
    run.pace = Math.min(T.paceMax * W(), (T.paceV0 + run.t * T.paceRamp + (run.stage - 1) * T.paceStage) * W());

    // the ray: a touch slower than clean running early (you pull a small lead),
    // accelerating past it over time/stages so you must grab boosts to survive.
    const rayFactor = 0.96 + Math.min(0.2, run.t * 0.0022 + (run.stage - 1) * 0.022);
    run.rayX += run.pace * rayFactor * dt;

    // racers
    for (const r of racers) {
      if (!r.alive) continue;
      if (r.isPlayer) updatePlayerIntent(r, dt); else updateAI(r, dt);
      stepRacer(r, dt);
    }

    // camera follows the player
    run.camera = player.worldX - PX;

    // stage
    const st = Math.floor(player.worldX / (W() * T.pxPerMeter * T.stageMeters)) + 1;
    if (st > run.stage) { run.stage = st; run.stageBanner = 2.2; sfx.stage(); flash = Math.min(0.3, flash + 0.18); addFloater(W() * 0.5, H() * 0.3, 'STAGE ' + st, C.boost, 1.6, 1.1); }

    // meters / best
    run.meters = Math.floor(player.worldX / (W() * T.pxPerMeter));
    if (!run.passedBest && run.best > 0 && run.meters > run.best) { run.passedBest = true; addFloater(W() * 0.5, H() * 0.36, 'NEW BEST!', C.item, 1.4, 1.0); flash = Math.min(0.4, flash + 0.25); sfx.stage(); }

    // spawn track ahead of the camera (cursor advances each call → bounded)
    let guard = 0;
    while (run.spawnX < run.camera + view.w * 1.5 && guard++ < 40) spawnFeature();

    // ray eliminations
    for (const r of racers) {
      if (r.alive && r.worldX <= run.rayX) {
        r.alive = false;
        if (r.isPlayer) return die();
        spawnSpark(r.worldX - run.camera, feetScreenY(r) - BODY * 0.5, C.ray, 18); sfx.zap();
      }
    }

    // ray danger meter (how close the ray is to the player, 0..1)
    rayDanger = Math.max(0, Math.min(1, 1 - (player.worldX - run.rayX) / (W() * 0.6)));

    // cull features behind the ray
    for (let i = features.length - 1; i >= 0; i--) if (features[i].worldX + features[i].w < run.rayX - W() * 0.3) features.splice(i, 1);
    for (let i = mines.length - 1; i >= 0; i--) if (mines[i].worldX < run.rayX - W() * 0.3) mines.splice(i, 1);

    // juice decay
    shake = Math.max(0, shake - dt * H() * 0.09);
    flash = Math.max(0, flash - dt * 1.8);
    slowmo = Math.max(0, slowmo - dt);
    run.stageBanner = Math.max(0, run.stageBanner - dt);
    updateParticles(dt); updateFloaters(dt);
  }

  function stepRacer(r, dt) {
    // smooth lane interpolation
    r.laneF += (r.lane - r.laneF) * Math.min(1, dt / T.laneSwitch);

    // speed: pace × multipliers; clean pace and boost potency come from the
    // runner's stats (speed / accel).
    let mult = r.mods.cleanMult;
    if (r.stumbleT > 0) { mult = T.stumbleMult; r.stumbleT -= dt; }
    else if (r.turboT > 0) { mult = r.mods.boostMul; r.turboT -= dt; }
    else if (r.boostT > 0) { mult = r.mods.boostMul; r.boostT -= dt; }
    if (r.punchT > 0) { mult += T.punchBonus; r.punchT -= dt; }
    if (r.shieldT > 0) r.shieldT -= dt;
    if (r.mineT > 0) { r.mineT -= dt; if (Math.random() < dt * 6) mines.push({ worldX: r.worldX - BODY, lane: r.lane }); }
    if (!r.isPlayer) mult *= r.aiMult || 1;
    r.speed = run.pace * mult;
    r.worldX += r.speed * dt;

    // jump physics (vertical)
    if (!r.onGround || r.jumpH > 0 || r.vy !== 0) {
      const holding = r.isPlayer && r.jumpHeld && r.vy < 0;
      const g = (r.vy < 0 ? T.gravUp : T.gravFall) * (holding ? 1 : 1) * H();
      r.vy += g * dt;
      if (r.vy > T.maxFall * H()) r.vy = T.maxFall * H();
      r.jumpH -= r.vy * dt;       // jumpH is height above the lane (vy<0 rises)
      if (r.jumpH <= 0) { r.jumpH = 0; if (!r.onGround) { r.onGround = true; r.vy = 0; r.coyote = T.coyote; if (r.isPlayer) { sfx.land(); } } }
    }
    if (r.onGround) r.coyote = T.coyote; else r.coyote = Math.max(0, r.coyote - dt);
    if (r.isPlayer) r.buffer = Math.max(0, r.buffer - dt);

    r.runPhase += (1.6 + (r.speed / W()) * 1.8) * dt * Math.PI * 2;

    collideRacer(r, dt);
  }

  function collideRacer(r, dt) {
    const lane = Math.round(r.laneF);
    const airborne = r.jumpH > BODY * 0.35;
    // features in this racer's lane near its x
    for (const f of features) {
      if (f.lane !== lane) continue;
      const within = r.worldX + BODY * 0.18 > f.worldX && r.worldX - BODY * 0.18 < f.worldX + f.w;
      if (!within) continue;
      if (f.type === F.BOOST) { if (!f.scored && r.onGround) { f.scored = true; r.boostT = T.boostTime; if (r.isPlayer) { sfx.boost(); flash = Math.min(0.25, flash + 0.12); addFloater(PX, feetScreenY(r) - BODY, 'BOOST', C.boost, 0.7, 0.7); } } continue; }
      if (f.type === F.JUMPPAD) { if (!f.scored && r.onGround) { f.scored = true; r.vy = -T.jumpPadVel * H(); r.onGround = false; if (r.isPlayer) { sfx.boost(); spawnDust(PX, feetScreenY(r), 8); } } continue; }
      if (f.type === F.ITEM) { if (!f.scored) { f.scored = true; giveItem(r, f.item); } continue; }
      // hazards
      if (f.type === F.CRYSTAL) { if (f.broken) continue; if (airborne) continue; stumble(r, f); continue; }
      if (f.type === F.GAP) { if (airborne) continue; stumble(r, f); continue; }
      if (f.type === F.BEAM) { if (r.jumpH > f.beamH) continue; stumble(r, f); continue; }
      if (f.type === F.ORB) { const lo = f.orbY - BODY * 0.3, hi = f.orbY + BODY * 0.3; if (r.jumpH > lo && r.jumpH < hi) stumble(r, f); continue; }
    }
    // mines
    for (let i = mines.length - 1; i >= 0; i--) {
      const m = mines[i]; if (m.lane !== lane) continue;
      if (Math.abs(r.worldX - m.worldX) < BODY * 0.25 && r.jumpH < BODY * 0.4) {
        mines.splice(i, 1);
        if (!(r.mineT > 0)) stumble(r, m);   // your own active mines don't trip you
      }
    }
  }

  function stumble(r, f) {
    if (f) f.hit = true;
    if (r.shieldT > 0) { r.shieldT = 0; if (r.isPlayer) { flash = Math.min(0.3, flash + 0.16); addFloater(PX, feetScreenY(r) - BODY, 'SHIELD!', C.boost, 0.7, 0.8); } spawnSpark(PX, feetScreenY(r) - BODY * 0.5, C.boost, 10); return; }
    if (r.stumbleT > 0) return;
    r.stumbleT = T.stumbleTime * r.mods.stumbleTMul;
    if (r.isPlayer) { sfx.stumble(); shake = reduceMotion ? 0 : H() * 0.012; spawnSpark(PX, feetScreenY(r) - BODY * 0.5, C.danger, 12); addFloater(PX, feetScreenY(r) - BODY, 'STUMBLE', C.danger, 0.7, 0.75); }
  }

  function crystalInPunchRange(r) {
    const lane = Math.round(r.laneF);
    for (const f of features) if (f.type === F.CRYSTAL && !f.broken && f.lane === lane) {
      const d = f.worldX - r.worldX;
      if (d > -BODY * 0.2 && d < W() * T.punchRangeW) return f;
    }
    return null;
  }
  function punchCrystal(r, f) {
    f.broken = true; r.punchT = 0.5;
    if (r.isPlayer) { sfx.punch(); shake = reduceMotion ? 0 : H() * 0.008; spawnSpark(f.worldX - run.camera, laneY(f.lane, f.worldX) - BODY * 0.5, C.crystal, 14); addFloater(PX + BODY, feetScreenY(r) - BODY, 'PUNCH', C.crystal, 0.6, 0.7); }
  }

  function giveItem(r, item) {
    if (item === 'turbo') r.turboT = T.turboTime;
    else if (item === 'shield') r.shieldT = 8;
    else if (item === 'shockwave') { // slow nearby rivals
      for (const o of racers) if (o.alive && o !== r && Math.abs(o.worldX - r.worldX) < W() * 0.5) stumble(o, null);
      if (r.isPlayer) spawnSpark(PX, feetScreenY(r) - BODY * 0.5, C.beam, 22);
    } else if (item === 'mines') r.mineT = 2.0;
    if (r.isPlayer) { sfx.item(); flash = Math.min(0.3, flash + 0.14); addFloater(PX, feetScreenY(r) - BODY * 1.2, item.toUpperCase(), C.item, 0.9, 0.85); spawnSpark(PX, feetScreenY(r) - BODY * 0.5, C.item, 10); }
  }

  // ---- player intent: held-jump only (taps handled by input handlers) ----
  function updatePlayerIntent(r, dt) { /* jump/lane already applied via input; nothing per-frame */ }

  // ---- simple but competent rival AI ----
  function updateAI(r, dt) {
    // Strong rubber-band so the 1v1 rival stays a visible, neck-and-neck duel:
    // it backs off when ahead and surges when behind, keeping it near the player.
    const behind = (player.worldX - r.worldX) / W();   // >0 = rival is behind you
    let aim = r.skill + behind * 0.85;                  // converge hard toward your position
    if (r.worldX - run.rayX < W() * 0.35) aim += 0.3;  // panic-sprint when the ray is close
    r.aiMult = (r.aiMult || 1) + (Math.max(0.45, Math.min(1.7, aim)) - (r.aiMult || 1)) * Math.min(1, dt * 4);

    r.think -= dt;
    if (r.think > 0) return;
    r.think = 0.06;
    const lane = Math.round(r.laneF);
    // look ahead in current lane
    let threat = null, td = 1e9;
    for (const f of features) { if (f.lane !== lane) continue; const d = f.worldX - r.worldX; if (d > 0 && d < td && d < W() * 0.34) { td = d; threat = f; } }
    const react = r.speed * 0.42;
    if (threat) {
      if (threat.type === F.GAP || threat.type === F.CRYSTAL || threat.type === F.BEAM) {
        if (threat.type === F.CRYSTAL && td < W() * T.punchRangeW && r.onGround && Math.random() < 0.5) punchCrystal(r, threat);
        else if (r.onGround && td < react) tryJump(r);
      } else if (threat.type === F.ORB) {
        // avoid jumping into an orb; hop lanes if airborne-bound
        if (td < react && Math.random() < 0.5) changeLane(r, lane > 0 ? -1 : +1);
      }
    } else {
      // opportunistic: drift toward a boost/item in an adjacent lane
      if (Math.random() < 0.04) {
        for (const f of features) { const d = f.worldX - r.worldX; if (d > 0 && d < W() * 0.4 && Math.abs(f.lane - lane) === 1 && (f.type === F.BOOST || f.type === F.ITEM)) { changeLane(r, f.lane - lane); break; } }
      }
    }
  }

  function die() {
    if (gameState !== STATE.PLAY) return;
    gameState = STATE.DEAD; deadLockUntil = now() + 750;
    shake = reduceMotion ? 0 : H() * 0.022; flash = 0.6; hitStop = 0.08; slowmo = 0.6;
    sfx.die(); spawnSpark(PX, feetScreenY(player) - BODY * 0.5, C.ray, 26);
    run.runs++;
    const final = run.meters; const isBest = final > run.best;
    if (isBest) run.best = final; meta.runs = (meta.runs | 0) + 1; saveMeta();
    finalScoreEl.textContent = final;
    overTitleEl.textContent = 'Disintegrated';
    const place = 1 + racers.filter(x => x.alive && x.worldX > player.worldX).length;
    overSubEl.textContent = `Stage ${run.stage} · ${ordinal(place)} place · best ${run.best} m`;
    newBestEl.classList.toggle('hidden', !isBest);
    bestScoreEl.textContent = run.best;
    announce('Disintegrated at ' + final + ' meters.' + (isBest ? ' New best!' : ''));
    setTimeout(() => { if (gameState === STATE.DEAD) { overScreen.classList.remove('hidden'); overScreen.focus(); } }, 750);
  }
  function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n] || 'th'); }

  // helper: feet screen-y of a racer (lane y minus jump height)
  function feetScreenY(r) { return laneY(Math.round(r.laneF), r.worldX) - r.jumpH; }

  // ───────────────────────────── Rendering ──────────────────────────────────
  let _sky = { key: '', g: null }, _vig = { key: '', g: null };
  function skyGrad() {
    const key = Math.round(view.h) + ':' + run.stage;
    if (_sky.key !== key) {
      const hue = (220 + run.stage * 14) % 360;
      const g = ctx.createLinearGradient(0, 0, 0, view.h);
      g.addColorStop(0, `hsl(${hue},55%,6%)`); g.addColorStop(0.5, `hsl(${(hue + 18) % 360},48%,9%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},42%,5%)`);
      _sky = { key, g };
    }
    return _sky.g;
  }
  function initStars() { stars.length = 0; for (let i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random() * 0.62, r: Math.random() < 0.8 ? 1 : 2, b: 0.3 + Math.random() * 0.6, tw: Math.random() * 6.28, sp: 1 + Math.random() * 2 }); }

  function drawBackground(dt) {
    const w = view.w, h = view.h;
    ctx.fillStyle = skyGrad(); ctx.fillRect(0, 0, w, h);
    // planet
    const pcx = w * 0.78 - (run.camera * 0.01) % (w * 3), pcy = h * 0.26, pr = h * 0.13;
    const pg = ctx.createRadialGradient(pcx - pr * 0.3, pcy - pr * 0.3, pr * 0.2, pcx, pcy, pr);
    pg.addColorStop(0, '#5a2230'); pg.addColorStop(1, '#160812'); ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 6.2832); ctx.fill();
    // stars
    for (const s of stars) { s.tw += dt * s.sp; ctx.globalAlpha = Math.max(0, (0.5 + Math.sin(s.tw) * 0.5) * s.b); ctx.fillStyle = '#bfe0ff'; ctx.fillRect(s.x * w, s.y * h, s.r, s.r); }
    ctx.globalAlpha = 1;
    // parallax mountains (blue alien ridges)
    ridges(0.06, h * 0.62, h * 0.22, '#13203a', 1.7);
    ridges(0.14, h * 0.66, h * 0.16, '#1b2f50', 3.1);
  }
  function ridges(factor, baseY, amp, color, seed) {
    const w = view.w, off = run.camera * factor, steps = 24;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, view.h);
    for (let i = 0; i <= steps; i++) { const x = i / steps * w; const u = (x + off) / w * 1.6; ctx.lineTo(x, baseY - amp * (0.5 + 0.34 * Math.sin(u * 2.1 + seed) + 0.16 * Math.sin(u * 5.3 + seed))); }
    ctx.lineTo(w, view.h); ctx.closePath(); ctx.fill();
  }

  function drawTrack() {
    const w = view.w, playerLane = Math.round(player.laneF), hotCol = player.col ? player.col.body : C.laneHot;
    for (let lane = 0; lane < T.nLanes; lane++) {
      const hot = lane === playerLane && player.alive;
      ctx.strokeStyle = hot ? hotCol : C.lane;
      ctx.lineWidth = hot ? Math.max(2.5, H() * 0.004) : Math.max(1.5, H() * 0.0025);
      ctx.shadowColor = hot ? hotCol : 'transparent'; ctx.shadowBlur = hot ? H() * 0.012 : 0;
      ctx.beginPath();
      for (let sx = -20; sx <= w + 20; sx += 14) { const wx = run.camera + sx; const y = laneY(lane, wx); if (sx === -20) ctx.moveTo(sx, y); else ctx.lineTo(sx, y); }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  function drawFeatures() {
    for (const f of features) {
      const sx = f.worldX - run.camera; if (sx > view.w + W() * 0.1 || sx + f.w < -W() * 0.1) continue;
      const y = laneY(f.lane, f.worldX);
      ctx.save();
      if (f.type === F.GAP) {
        ctx.strokeStyle = C.danger; ctx.lineWidth = Math.max(2, H() * 0.003); ctx.setLineDash([H() * 0.01, H() * 0.01]);
        ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + f.w, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.danger; ctx.globalAlpha = 0.5; ctx.fillRect(sx, y - 1, 2, H() * 0.03); ctx.fillRect(sx + f.w - 2, y - 1, 2, H() * 0.03);
      } else if (f.type === F.CRYSTAL) {
        if (!f.broken) { ctx.fillStyle = C.crystal; ctx.shadowColor = C.crystal; ctx.shadowBlur = H() * 0.012;
          const hh = BODY * 0.8, hw = f.w * 0.6;
          ctx.beginPath(); ctx.moveTo(sx + f.w / 2, y - hh); ctx.lineTo(sx + f.w / 2 + hw, y - hh * 0.5); ctx.lineTo(sx + f.w / 2, y); ctx.lineTo(sx + f.w / 2 - hw, y - hh * 0.5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.5; ctx.fillRect(sx + f.w / 2 - 1, y - hh, 2, hh); }
      } else if (f.type === F.BEAM) {
        ctx.strokeStyle = C.beam; ctx.lineWidth = Math.max(2, H() * 0.004); ctx.shadowColor = C.beam; ctx.shadowBlur = H() * 0.02;
        const flick = 0.7 + 0.3 * Math.sin(now() / 40 + f.worldX);
        ctx.globalAlpha = flick; ctx.beginPath(); ctx.moveTo(sx + f.w / 2, y); ctx.lineTo(sx + f.w / 2, y - f.beamH); ctx.stroke();
      } else if (f.type === F.ORB) {
        const oy = y - f.orbY; const g = ctx.createRadialGradient(sx + f.w / 2, oy, 1, sx + f.w / 2, oy, f.w);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, C.orb); g.addColorStop(1, 'rgba(255,122,217,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx + f.w / 2, oy, f.w, 0, 6.2832); ctx.fill();
      } else if (f.type === F.BOOST) {
        ctx.fillStyle = C.boost; ctx.shadowColor = C.boost; ctx.shadowBlur = H() * 0.01; ctx.globalAlpha = 0.9;
        for (let i = 0; i < 3; i++) { const cx = sx + f.w * (0.2 + i * 0.3); ctx.beginPath(); ctx.moveTo(cx, y - BODY * 0.18); ctx.lineTo(cx + f.w * 0.18, y - BODY * 0.09); ctx.lineTo(cx, y); ctx.stroke ? null : null; ctx.lineWidth = Math.max(2, H() * 0.004); ctx.strokeStyle = C.boost; ctx.stroke(); }
      } else if (f.type === F.JUMPPAD) {
        ctx.fillStyle = C.boost; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + f.w / 2, y - BODY * 0.3); ctx.lineTo(sx + f.w, y); ctx.closePath(); ctx.fill();
      } else if (f.type === F.ITEM) {
        const oy = y - BODY * 0.9, R = BODY * 0.22, pulse = 0.8 + 0.2 * Math.sin(now() / 180 + f.worldX);
        const g = ctx.createRadialGradient(sx + f.w / 2, oy, 1, sx + f.w / 2, oy, R * 2.4 * pulse);
        g.addColorStop(0, 'rgba(255,226,150,0.85)'); g.addColorStop(0.5, 'rgba(255,196,86,0.2)'); g.addColorStop(1, 'rgba(255,196,86,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx + f.w / 2, oy, R * 2.4, 0, 6.2832); ctx.fill();
        ctx.fillStyle = C.item; ctx.beginPath(); ctx.arc(sx + f.w / 2, oy, R, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#5a3a00'; ctx.font = `700 ${R}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(({ turbo: '»', shield: '◈', shockwave: '✺', mines: '✸' })[f.item] || '?', sx + f.w / 2, oy + 1);
      }
      ctx.restore();
    }
    // mines
    for (const m of mines) { const sx = m.worldX - run.camera; if (sx < -20 || sx > view.w + 20) continue; const y = laneY(m.lane, m.worldX); ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(sx, y - BODY * 0.06, BODY * 0.08, 0, 6.2832); ctx.fill(); }
  }

  // Ninja-run stick figure — reusable for both the live racers and the
  // character-select icons. Draws at the current origin with feet at (0,0),
  // facing right. Pose: strong forward lean, arms swept straight back, a
  // fluttering headband, plus a small per-type trait.
  function strokeSeg(g, p) { g.beginPath(); g.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y); g.stroke(); }

  function drawFigure(g, fh, char, pose, bright, shielded) {
    const thigh = fh * 0.26, shin = fh * 0.26, torso = fh * 0.34, neck = fh * 0.06, headR = fh * 0.12, upper = fh * 0.2, fore = fh * 0.2;
    const phase = pose.phase, mode = pose.mode, vyUp = pose.vyUp;
    const air = mode === 'air', stum = mode === 'stum';
    let pelvisY, lean;
    if (stum) { pelvisY = -(thigh + shin) * 0.82; lean = -0.3 + Math.sin(now() / 50) * 0.18; }   // stagger back, arms fly forward
    else if (air) { pelvisY = -(thigh + shin) * 0.95; lean = vyUp ? 0.5 : 0.66; }                 // leaning leap
    else { pelvisY = -(thigh + shin) * 0.9 - Math.abs(Math.sin(phase)) * fh * 0.03; lean = 0.82 + Math.sin(phase) * 0.05; }  // hard forward ninja lean
    const pelvis = { x: 0, y: pelvisY };
    const neckP = { x: Math.sin(lean) * torso, y: pelvisY - Math.cos(lean) * torso };
    const headP = { x: neckP.x + Math.sin(lean) * (neck + headR), y: neckP.y - Math.cos(lean) * (neck + headR) };
    function leg(ph) { let ta, kb; if (stum) { ta = 0.3; kb = 0.6; } else if (air) { ta = 1.0; kb = 0.7; } else { ta = Math.sin(ph) * 1.05; kb = (0.6 - 0.6 * Math.cos(ph)) + 0.25; } const knee = { x: Math.sin(ta) * thigh, y: pelvisY + Math.cos(ta) * thigh }; const sa = ta - kb; return [pelvis, knee, { x: knee.x + Math.sin(sa) * shin, y: knee.y + Math.cos(sa) * shin }]; }
    // ninja arms: both swept STRAIGHT BACK (opposite the lean) and nearly rigid
    function arm(ph) { let sa, eb; if (stum) { sa = lean + 2.6; eb = 0.4; } else { sa = lean + Math.PI + Math.sin(ph) * 0.1; eb = 0.12; } const el = { x: neckP.x + Math.sin(sa) * upper, y: neckP.y + Math.cos(sa) * upper }; const ha = sa + eb; return [neckP, el, { x: el.x + Math.sin(ha) * fore, y: el.y + Math.cos(ha) * fore }]; }
    const lw = fh * 0.085;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = shielded ? C.boost : char.glow; g.shadowBlur = fh * (shielded ? 0.16 : 0.1);
    g.strokeStyle = char.body;
    const segs = [leg(phase + Math.PI), arm(phase), [pelvis, neckP], leg(phase), arm(phase + Math.PI)];
    for (let i = 0; i < segs.length; i++) { g.globalAlpha = i < 2 ? 0.55 : 1; g.lineWidth = i === 2 ? lw * 1.15 : lw; strokeSeg(g, segs[i]); }
    g.globalAlpha = 1; g.fillStyle = char.body; g.beginPath(); g.arc(headP.x, headP.y, headR, 0, 6.2832); g.fill();
    g.shadowBlur = 0;
    // fluttering headband ribbons trailing back (the ninja signature)
    g.strokeStyle = char.core; g.lineWidth = lw * 0.42; g.globalAlpha = 0.9;
    for (let rb = 0; rb < 2; rb++) {
      const a = lean + Math.PI - 0.12 + rb * 0.24, tw = now() / 110 + rb * 1.4;
      const bx = headP.x + Math.sin(a) * headR * 0.5, by = headP.y + Math.cos(a) * headR * 0.5;
      const ex = bx + Math.sin(a) * headR * 2.1 + Math.sin(tw) * headR * 0.5, ey = by + Math.cos(a) * headR * 2.1 + Math.cos(tw * 1.2) * headR * 0.5;
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + Math.sin(a) * headR, by + Math.cos(a) * headR + Math.sin(tw) * headR * 0.4, ex, ey); g.stroke();
    }
    g.globalAlpha = 1;
    drawTrait(g, char.type, headP, headR, pelvis, char, lw);
    // bright inner core (front limbs + head) — the player and select icons
    if (bright) { g.strokeStyle = char.core; for (let i = 3; i < segs.length; i++) { g.lineWidth = lw * 0.36; strokeSeg(g, segs[i]); } g.fillStyle = char.core; g.beginPath(); g.arc(headP.x - headR * 0.28, headP.y - headR * 0.28, headR * 0.42, 0, 6.2832); g.fill(); }
  }

  function drawTrait(g, type, headP, headR, pelvis, char, lw) {
    g.strokeStyle = char.core; g.lineCap = 'round'; g.globalAlpha = 1;
    const hx = headP.x, hy = headP.y;
    if (type === 'insect') {            // two antennae sweeping up-back
      g.lineWidth = lw * 0.45;
      g.beginPath(); g.moveTo(hx, hy - headR * 0.7); g.lineTo(hx - headR * 1.1, hy - headR * 2.0); g.stroke();
      g.beginPath(); g.moveTo(hx, hy - headR * 0.7); g.lineTo(hx - headR * 0.2, hy - headR * 2.2); g.stroke();
    } else if (type === 'mech') {       // a visor band across the head
      g.lineWidth = headR * 0.5; g.beginPath(); g.moveTo(hx - headR * 0.75, hy + headR * 0.05); g.lineTo(hx + headR * 0.7, hy - headR * 0.18); g.stroke();
    } else if (type === 'beast') {      // horns + a trailing tail
      g.lineWidth = lw * 0.6;
      g.beginPath(); g.moveTo(hx - headR * 0.5, hy - headR * 0.6); g.lineTo(hx - headR * 0.95, hy - headR * 1.5); g.stroke();
      g.beginPath(); g.moveTo(hx + headR * 0.5, hy - headR * 0.6); g.lineTo(hx + headR * 0.35, hy - headR * 1.6); g.stroke();
      g.lineWidth = lw * 0.8; g.beginPath(); g.moveTo(pelvis.x, pelvis.y); g.quadraticCurveTo(pelvis.x - headR * 1.6, pelvis.y + headR * 0.4, pelvis.x - headR * 2.3, pelvis.y - headR * 0.6 + Math.sin(now() / 150) * headR * 0.4); g.stroke();
    }
  }

  function drawRacer(r) {
    if (!r.alive && !r.isPlayer) return;
    const sx = r.worldX - run.camera; if (sx < -BODY * 2 || sx > view.w + BODY * 2) return;
    const mode = r.stumbleT > 0 ? 'stum' : (r.jumpH > BODY * 0.1 ? 'air' : 'run');
    ctx.save(); ctx.translate(sx, feetScreenY(r));
    drawFigure(ctx, BODY, r.col, { phase: r.runPhase, mode, vyUp: r.vy < 0 }, r.isPlayer, r.shieldT > 0);
    ctx.restore();
  }

  // static figure for a character-select chip
  function drawCharIcon(cv, char) {
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    g.save(); g.translate(cv.width * 0.52, cv.height * 0.94);
    drawFigure(g, cv.height * 0.6, char, { phase: 1.0, mode: 'run', vyUp: false }, true, false);
    g.restore();
  }

  function drawRay() {
    const sx = run.rayX - run.camera; if (sx < -W() * 0.2) return;
    const w = view.w, h = view.h;
    // devouring wall to the left of sx
    const g = ctx.createLinearGradient(0, 0, sx, 0);
    g.addColorStop(0, 'rgba(255,46,110,0.55)'); g.addColorStop(0.7, 'rgba(180,20,80,0.3)'); g.addColorStop(1, 'rgba(255,46,110,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, sx, h);
    // crackling leading edge
    ctx.strokeStyle = C.ray; ctx.lineWidth = Math.max(2, h * 0.005); ctx.shadowColor = C.ray; ctx.shadowBlur = h * 0.03;
    ctx.beginPath();
    for (let y = 0; y <= h; y += h * 0.05) { const jx = sx + Math.sin(y * 0.1 + now() / 50) * w * 0.012; if (y === 0) ctx.moveTo(jx, y); else ctx.lineTo(jx, y); }
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  // HUD: standings strip + stage + lead bar + item state
  function drawHUD() {
    const w = view.w, h = view.h, top = h * 0.03;
    // meters big, center
    ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `800 ${h * 0.05}px "Helvetica Neue", Arial, sans-serif`; ctx.fillText(run.meters + '', w * 0.5, top);
    ctx.font = `700 ${h * 0.016}px "Helvetica Neue", Arial, sans-serif`; ctx.fillStyle = C.muted; ctx.fillText('METRES · STAGE ' + run.stage, w * 0.5, top + h * 0.055);
    // standings pips: order racers by worldX
    const order = racers.slice().sort((a, b) => b.worldX - a.worldX);
    const bx = w * 0.06, bw = w * 0.5, by = top + h * 0.005;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx, by, 0, 0); // (no-op; pips below)
    const lead = order[0].worldX, last = run.rayX;
    const span = Math.max(W() * 0.4, lead - last);
    for (const r of racers) { const t = (r.worldX - last) / span; const x = bx + Math.max(0, Math.min(1, t)) * bw; ctx.fillStyle = r.alive ? r.col.body : 'rgba(120,120,140,0.4)'; ctx.beginPath(); ctx.arc(x, by, r.isPlayer ? h * 0.011 : h * 0.008, 0, 6.2832); ctx.fill(); }
    // ray marker at left of the strip
    ctx.fillStyle = C.ray; ctx.fillRect(bx - h * 0.006, by - h * 0.012, h * 0.004, h * 0.024);
    // item / shield state, top-right
    ctx.textAlign = 'right'; ctx.font = `700 ${h * 0.018}px "Helvetica Neue", Arial, sans-serif`;
    let tag = ''; if (player.turboT > 0) tag = 'TURBO'; else if (player.shieldT > 0) tag = 'SHIELD'; else if (player.mineT > 0) tag = 'MINES'; else if (player.boostT > 0) tag = 'BOOST';
    if (tag) { ctx.fillStyle = C.item; ctx.fillText(tag, w - w * 0.04, by + h * 0.03); }
    // danger vignette when the ray is close
    if (rayDanger > 0.25) { ctx.fillStyle = `rgba(255,46,110,${(rayDanger - 0.25) * 0.5})`; ctx.fillRect(0, 0, w, h); }
  }

  // ---- particles / floaters ----
  function spawnDust(x, y, n) { for (let i = 0; i < n; i++) particles.push({ x, y, vx: -(20 + Math.random() * 70) * (view.h / 720), vy: -Math.random() * H() * 0.16, life: 0.35 + Math.random() * 0.25, max: 0.6, r: H() * (0.003 + Math.random() * 0.003), color: 'rgba(160,180,210,0.6)', grav: H() * 0.8 }); }
  function spawnSpark(x, y, color, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = H() * (0.12 + Math.random() * 0.3); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.4, max: 0.8, r: H() * (0.0025 + Math.random() * 0.003), color, grav: H() * 0.3, add: true }); } }
  function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); } }
  function drawParticles() { for (const p of particles) { if (p.add) continue; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); } ctx.globalCompositeOperation = 'lighter'; for (const p of particles) { if (!p.add) continue; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); } ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  function addFloater(x, y, text, color, life, size) { floaters.push({ x, y, text, color, life, max: life, size }); }
  function updateFloaters(dt) { for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.y -= H() * 0.1 * dt; f.life -= dt; if (f.life <= 0) floaters.splice(i, 1); } }
  function drawFloaters() { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (const f of floaters) { ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max * 1.5)); ctx.fillStyle = f.color; ctx.font = `800 ${H() * 0.03 * (f.size || 0.7)}px "Helvetica Neue", Arial, sans-serif`; ctx.fillText(f.text, f.x, f.y); } ctx.globalAlpha = 1; }

  function drawVignette() { const w = view.w, h = view.h, key = w + 'x' + h; if (_vig.key !== key) { const g = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.34, w * 0.5, h * 0.5, Math.max(w, h) * 0.78); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)'); _vig = { key, g }; } ctx.fillStyle = _vig.g; ctx.fillRect(0, 0, w, h); }

  function render(dt) {
    ctx.save();
    if (shake > 0.5 && !reduceMotion) { const a = Math.random() * 6.28; ctx.translate(Math.cos(a) * shake, Math.sin(a) * shake); }
    drawBackground(dt);
    if (gameState !== STATE.TITLE) drawRay();
    drawTrack();
    drawFeatures();
    // racers back-to-front by worldX (far rivals behind)
    const sorted = racers.slice().sort((a, b) => a.worldX - b.worldX);
    for (const r of sorted) if (r !== player) drawRacer(r);
    drawRacer(player);
    drawParticles();
    drawVignette();
    drawFloaters();
    if (gameState === STATE.PLAY || gameState === STATE.PAUSE) drawHUD();
    ctx.restore();
    if (flash > 0.01 && !reduceMotion) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, view.w, view.h); }
  }

  // ──────────────────────────────── Loop ────────────────────────────────────
  const STEP = 1 / 120; let last = 0, acc = 0;
  function frame(t) {
    if (!view.w || !view.h) resize();
    if (!last) last = t; let dt = (t - last) / 1000; last = t; if (dt > 0.25) dt = 0.25;
    if (hitStop > 0) { hitStop -= dt; dt = 0; } else if (slowmo > 0 && gameState === STATE.DEAD) dt *= 0.3;
    if (gameState === STATE.PLAY) { acc += dt; let s = 0; while (acc >= STEP && s < 300) { simulate(STEP); acc -= STEP; s++; } }
    else if (gameState === STATE.DEAD) { player.jumpH = Math.max(0, player.jumpH - H() * 0.4 * dt); updateParticles(dt); updateFloaters(dt); shake = Math.max(0, shake - dt * H() * 0.09); flash = Math.max(0, flash - dt * 1.8); }
    else if (gameState === STATE.TITLE) { player.runPhase += dt * 8; run.camera = -PX; }   // idle jog on the menu backdrop
    render(dt);
    requestAnimationFrame(frame);
  }

  // ────────────────────────────── UI / screens ──────────────────────────────
  function show(el) { el.classList.remove('hidden'); } function hide(el) { el.classList.add('hidden'); }
  function startRun() {
    ensureAudio(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    // 1v1: you (your chosen runner) vs one bot rival (a different character).
    let oppIdx = (chosenChar + 1 + ((Math.random() * (CHARACTERS.length - 1)) | 0)) % CHARACTERS.length;
    racers = [newRacer(chosenChar, true), newRacer(oppIdx, false)];
    player = racers[0]; const opp = racers[1];
    player.worldX = 0; player.lane = 1; player.laneF = 1;
    opp.worldX = -W() * 0.04; opp.lane = (player.lane + 1) % T.nLanes; opp.laneF = opp.lane;
    features.length = 0; mines.length = 0; particles.length = 0; floaters.length = 0;
    run.t = 0; run.pace = T.paceV0 * W(); run.camera = player.worldX - PX; run.rayX = -T.leadStart * W(); run.stage = 1;
    run.meters = 0; run.spawnX = W() * 0.8; run.stageBanner = 0; run.passedBest = false; run.lastFeatureLane = 1;
    shake = 0; flash = 0; hitStop = 0; slowmo = 0; rayDanger = 0; clearInput();
    hide(titleScreen); hide(overScreen); hide(pauseScreen); pauseBtn.hidden = false;
    gameState = STATE.PLAY; last = 0; acc = 0;
    addFloater(W() * 0.5, H() * 0.34, player.col.name + '  vs  ' + opp.col.name, opp.col.body, 1.8, 1.0);
    announce('Race! ' + player.col.name + ' versus ' + opp.col.name);
  }
  function pauseGame() { if (gameState !== STATE.PLAY) return; gameState = STATE.PAUSE; clearInput(); show(pauseScreen); pauseScreen.focus(); }
  function resumeGame() { if (gameState !== STATE.PAUSE) return; hide(pauseScreen); gameState = STATE.PLAY; last = 0; acc = 0; }
  function quitToMenu() { gameState = STATE.TITLE; hide(pauseScreen); hide(overScreen); pauseBtn.hidden = true; features.length = 0; mines.length = 0; particles.length = 0; floaters.length = 0; clearInput(); bestScoreEl.textContent = run.best; show(titleScreen); }
  function toggleMute() { muted = !muted; try { localStorage.setItem(LS_MUTE, muted ? '1' : '0'); } catch {} reflectMute(); }
  function announce(m) { announceEl.textContent = m; }

  const titleScreen = document.getElementById('titleScreen'), overScreen = document.getElementById('overScreen'), pauseScreen = document.getElementById('pauseScreen');
  const playBtn = document.getElementById('playBtn'), againBtn = document.getElementById('againBtn'), menuBtn = document.getElementById('menuBtn'), resumeBtn = document.getElementById('resumeBtn'), quitBtn = document.getElementById('quitBtn');
  const pauseBtn = document.getElementById('pauseBtn'), muteBtn = document.getElementById('muteBtn'), charSelect = document.getElementById('charSelect');
  const bestScoreEl = document.getElementById('bestScore'), finalScoreEl = document.getElementById('finalScore'), overSubEl = document.getElementById('overSub'), overTitleEl = document.getElementById('overTitle'), newBestEl = document.getElementById('newBest'), announceEl = document.getElementById('announce');

  // ---- character select ----
  function statDots(label, v) { let d = ''; for (let k = 0; k < 5; k++) d += `<i class="dot${k < v ? ' on' : ''}"></i>`; return `<span class="srow"><b>${label}</b>${d}</span>`; }
  function buildCharSelect() {
    charSelect.innerHTML = '';
    CHARACTERS.forEach((ch, i) => {
      const chip = document.createElement('button');
      chip.className = 'char-chip' + (i === chosenChar ? ' selected' : '');
      chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(i === chosenChar)); chip.setAttribute('aria-label', ch.name);
      chip.style.setProperty('--c', ch.body);
      const cv = document.createElement('canvas'); cv.width = 88; cv.height = 96; cv.className = 'char-fig';
      const nm = document.createElement('div'); nm.className = 'char-name'; nm.textContent = ch.name;
      const st = document.createElement('div'); st.className = 'char-stats';
      st.innerHTML = statDots('SPD', ch.speed) + statDots('JMP', ch.jump) + statDots('GRT', ch.grit) + statDots('ACC', ch.accel);
      chip.append(cv, nm, st);
      chip.addEventListener('click', (e) => { e.stopPropagation(); selectChar(i); });
      charSelect.appendChild(chip);
      drawCharIcon(cv, ch);
    });
  }
  function selectChar(i) {
    chosenChar = ((i % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
    try { localStorage.setItem('runner.char.v1', String(chosenChar)); } catch {}
    [...charSelect.children].forEach((c, k) => { const on = k === chosenChar; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
    const sel = charSelect.children[chosenChar]; if (sel) sel.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    // recolour the idle title runner to the picked character
    if (gameState === STATE.TITLE && player) { player.col = CHARACTERS[chosenChar]; player.mods = statMods(player.col); }
  }

  playBtn.addEventListener('click', startRun);
  againBtn.addEventListener('click', () => { if (canRestart()) startRun(); });
  menuBtn.addEventListener('click', quitToMenu); resumeBtn.addEventListener('click', resumeGame); quitBtn.addEventListener('click', quitToMenu);
  pauseBtn.addEventListener('click', pauseGame); muteBtn.addEventListener('click', toggleMute);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (!HARNESS && gameState === STATE.PLAY) pauseGame(); } else { last = 0; acc = 0; } });
  // pause the race if a phone is turned to portrait (the rotate prompt covers it)
  try {
    const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
    const onOrient = () => { if (!HARNESS && portraitMQ.matches && gameState === STATE.PLAY) pauseGame(); else { last = 0; acc = 0; } };
    portraitMQ.addEventListener ? portraitMQ.addEventListener('change', onOrient) : portraitMQ.addListener(onOrient);
  } catch {}

  // ──────────────────────────────── Boot ────────────────────────────────────
  resize(); initStars(); loadPrefs(); buildCharSelect();
  // a calm idle racer on the title (the chosen runner)
  racers = [newRacer(chosenChar, true)]; player = racers[0]; player.worldX = 0; run.camera = -PX;
  requestAnimationFrame(frame);
})();
