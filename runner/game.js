/* Runner — a stick-figure endless side-scroller.
 *
 * Pure static, single file. HTML5 canvas, fixed-timestep simulation, procedural
 * everything (no image assets). The stick figure is an articulated skeleton
 * driven by a phase clock; the world is screen-space obstacles scrolling left.
 *
 * Units: vertical things (figure, jump physics, obstacle sizes) are fractions of
 * viewport HEIGHT (H); horizontal scroll speed is a fraction of viewport WIDTH
 * (W) so "screens crossed per second" — and therefore the feel — is identical on
 * any screen. Everything is recomputed on resize.
 *
 * Sections: 1 tuning · 2 canvas · 3 state · 4 persistence+audio · 5 input ·
 * 6 world-gen · 7 simulate · 8 stick figure · 9 background · 10 juice ·
 * 11 render · 12 loop · 13 UI · 14 boot.
 */
(() => {
  'use strict';

  // ───────────────────────────── 1. Tuning ──────────────────────────────────
  // Speeds are ×W per second; gravity/velocity are ×H; sizes are ×H.
  const T = {
    // world position
    groundFrac:   0.82,
    playerXFrac:  0.30,
    bodyH:        0.165,   // figure height as fraction of H
    // speed curve: v(t) = V0 + (VMAX-V0)(1 - e^(-t/TAU)), ×W/s
    v0:           0.42,
    vmax:         1.18,
    tau:          55,
    easeIn:       0.9,     // first N seconds ramp 0→V0 so nothing kills you cold
    // jump (×H)
    jumpVel:      1.46,
    gravUp:       2.30,    // rising → floaty
    gravFall:     3.55,    // falling → snappy
    maxFall:      3.4,
    shortHopCut:  0.45,    // vy *= this on early release while rising
    fastFall:     1.6,     // one-shot downward impulse in air
    coyote:       0.10,
    buffer:       0.13,
    // slide
    slideTime:    0.55,
    slideH:       0.46,    // hitbox/figure height while sliding (×bodyH)
    slideJumpLock:0.18,    // can't cancel-jump for this long after sliding starts
    // collision forgiveness (fraction of drawn figure)
    hbW:          0.62,
    hbH:          0.86,
    // scoring
    metersPerScreen: 20,   // 20 m of score per screen-width travelled
    orbMeters:    5,
    nearBand:     0.045,   // clearance < this·H counts as a near miss
    nearBonus:    8,       // meters per near miss (× combo multiplier)
    // spawn fairness
    reactionFloor:0.50,    // seconds the player always gets to read an obstacle
    jumpLock:     1.10,    // jump airtime budget (s) reserved after a jump obstacle
    slideLock:    0.60,
  };

  const C = {
    runner:    '#54e6c8',
    runnerGlow:'rgba(84,230,200,0.55)',
    ghost:     'rgba(84,230,200,0.16)',
    danger:    '#ff5470',
    dangerDk:  '#2a1f4a',
    orb:       '#ffd76b',
    ground:    '#1b1330',
    edge:      '#54e6c8',
    text:      '#ece6f5',
    muted:     '#9b8fb5',
  };

  // ──────────────────────────── 2. Canvas (hi-DPI) ──────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const view = { w: 0, h: 0 };
  // cached derived sizes (recomputed on resize)
  let GY = 0, PX = 0, BODY = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    GY = view.h * T.groundFrac;
    PX = view.w * T.playerXFrac;
    BODY = view.h * T.bodyH;
    if (gameState === STATE.TITLE || gameState === undefined) { player.y = GY; player.supportY = GY; }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  const H = () => view.h, W = () => view.w;

  // ──────────────────────────────── 3. State ────────────────────────────────
  const STATE = { TITLE: 'title', PLAY: 'play', PAUSE: 'pause', DEAD: 'dead' };
  let gameState = STATE.TITLE;

  const player = {
    y: 0, vy: 0, prevFeet: 0,
    onGround: true, supportY: 0,
    sliding: false, slideT: 0, slideElapsed: 0,
    runPhase: 0, squashY: 1,
    coyote: 0, buffer: 0, jumpHeld: false, slideQueued: false,
    // death ragdoll
    deadT: 0, rot: 0, rotV: 0, limbFlail: 0, deathFloor: 0,
  };

  const obstacles = [];   // {kind,x,w,top,h,...,scored,passed}
  const orbs = [];        // {x,y,r,got}
  const particles = [];
  const floaters = [];    // floating score text
  const speedLines = [];
  const ghosts = [];      // motion-trail snapshots

  const run = {
    t: 0, speed: 0, speedNorm: 0,
    distPx: 0, meters: 0,
    distSinceSpawn: 0, nextGap: 0,
    combo: 0, comboTimer: 0,
    nextMilestone: 500,
    burst: 0,             // milestone speed-burst timer
    best: 0, runs: 0,
    passedBest: false,
  };

  let shake = 0, flash = 0, hitStop = 0, slowmo = 0, deadLockUntil = 0;

  // ─────────────────────────── 4. Persistence + audio ───────────────────────
  const LS_META = 'runner.meta.v1';
  const LS_MUTE = 'runner.mute.v1';
  let muted = false;
  const meta = { best: 0, runs: 0, totalDistance: 0 };  // in-memory fallback if LS dies

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_META);
      if (raw) Object.assign(meta, JSON.parse(raw));
    } catch {}
    try { muted = localStorage.getItem(LS_MUTE) === '1'; } catch {}
    run.best = meta.best | 0;
    bestScoreEl.textContent = run.best;
    reflectMute();
  }
  function saveMeta() {
    meta.best = Math.max(meta.best | 0, run.best);
    try { localStorage.setItem(LS_META, JSON.stringify(meta)); } catch {}
  }
  function reflectMute() {
    muteBtn.textContent = muted ? '♪̸' : '♪';
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.style.opacity = muted ? '0.5' : '1';
  }

  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); } catch { audioCtx = null; }
  }
  function blip(freq, dur, type = 'square', gain = 0.05, slideTo = null) {
    if (muted || !audioCtx) return;
    try {
      const n = audioCtx.currentTime;
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, n);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, n + dur);
      g.gain.setValueAtTime(gain, n);
      g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(n); osc.stop(n + dur + 0.02);
    } catch {}
  }
  const sfx = {
    jump:  () => blip(520, 0.13, 'square',   0.045, 780),
    land:  () => blip(170, 0.09, 'sine',     0.04),
    slide: () => blip(300, 0.18, 'sawtooth', 0.03, 150),
    orb:   () => blip(880, 0.12, 'triangle', 0.05, 1320),
    near:  () => blip(680, 0.08, 'triangle', 0.04, 1020),
    mile:  () => blip(740, 0.18, 'triangle', 0.05, 1480),
    die:   () => blip(260, 0.55, 'sawtooth', 0.06, 55),
  };

  // ──────────────────────────────── 5. Input ────────────────────────────────
  const pointers = new Map();
  let jumpPointerId = null;
  const keyHeld = {};

  function now() { return performance.now(); }
  function canRestart() { return now() >= deadLockUntil; }
  // Drop any transient held input — called on (re)start, pause and window blur,
  // since the matching pointerup/keyup is often never delivered in those cases.
  function clearInput() { pointers.clear(); jumpPointerId = null; keyHeld.jump = false; keyHeld.slide = false; }

  function pressJump() { ensureAudio(); player.buffer = T.buffer; tryJump(); }
  function releaseJump() {
    player.jumpHeld = false;
    if (!player.onGround && player.vy < 0) player.vy *= T.shortHopCut;
  }
  function tryJump() {
    if (gameState !== STATE.PLAY) return;
    if (player.sliding && player.slideElapsed < T.slideJumpLock) return; // slide commitment
    const canJump = player.onGround || player.coyote > 0;
    if (canJump && player.buffer > 0) {
      player.vy = -T.jumpVel * H();
      player.onGround = false; player.coyote = 0; player.buffer = 0;
      player.jumpHeld = true; player.sliding = false;
      player.squashY = 1.18;     // stretch tall on takeoff
      sfx.jump();
      spawnDust(PX, player.supportY, 6);
    }
  }
  function pressSlide() {
    ensureAudio();
    if (gameState !== STATE.PLAY) return;
    if (player.onGround) startSlide();
    else { player.slideQueued = true; player.vy = Math.max(player.vy, 0) + T.fastFall * H(); } // fast-fall
  }
  function startSlide() {
    player.sliding = true; player.slideT = T.slideTime; player.slideElapsed = 0;
    player.slideQueued = false;
    sfx.slide();
    spawnDust(PX, player.supportY, 7);
  }
  function slideHeld() {
    return !!keyHeld.slide || [...pointers.values()].some(p => p.kind === 'slide');
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (gameState === STATE.TITLE) { startRun(); return; }
    if (gameState === STATE.DEAD) { if (canRestart()) startRun(); return; }
    if (gameState === STATE.PAUSE) return;
    const lower = e.clientY > view.h * 0.6;
    const p = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now(), kind: lower ? 'slide' : 'jump' };
    pointers.set(e.pointerId, p);
    if (lower) pressSlide();
    else { if (jumpPointerId === null) jumpPointerId = e.pointerId; pressJump(); }  // keep held-jump bound to the first finger
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    // Convert to slide/fast-fall only on a QUICK downward flick, not slow held-jump
    // drift — otherwise a finger held for a high jump that rolls down triggers a
    // phantom fast-fall mid-arc.
    if (p.kind === 'jump' && (now() - p.t) < 220 && (p.y - p.sy) > view.h * 0.06) {
      p.kind = 'slide';
      if (jumpPointerId === e.pointerId) { releaseJump(); jumpPointerId = null; }
      pressSlide();
    }
  }, { passive: true });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerId === jumpPointerId) { releaseJump(); jumpPointerId = null; }
    pointers.delete(e.pointerId);
  }
  canvas.addEventListener('pointerup', endPointer, { passive: true });
  canvas.addEventListener('pointercancel', endPointer, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowup' || k === 'w') {
      e.preventDefault();
      if (gameState === STATE.TITLE) return startRun();
      if (gameState === STATE.DEAD) { if (canRestart()) startRun(); return; }
      keyHeld.jump = true; pressJump();
    } else if (k === 'arrowdown' || k === 's') {
      e.preventDefault(); keyHeld.slide = true; pressSlide();
    } else if (k === 'p' || k === 'escape') {
      if (gameState === STATE.PLAY) pauseGame(); else if (gameState === STATE.PAUSE) resumeGame();
    } else if (k === 'm') { toggleMute(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowup' || k === 'w') { keyHeld.jump = false; releaseJump(); }
    else if (k === 'arrowdown' || k === 's') { keyHeld.slide = false; }
  });

  // ───────────────────────────── 6. World generation ────────────────────────
  const KIND = { BLOCK: 'block', SPIKE: 'spike', WALL: 'wall', BAR: 'bar', PIT: 'pit' };
  const JUMP_KINDS = new Set([KIND.BLOCK, KIND.SPIKE, KIND.WALL, KIND.PIT]);

  function unlockedKinds() {
    const m = run.meters;
    const list = [KIND.BLOCK, KIND.SPIKE];
    if (m > 110) list.push(KIND.BAR);
    if (m > 240) list.push(KIND.PIT);
    if (m > 380) list.push(KIND.WALL);
    return list;
  }
  let lastKind = null;
  function pickKind() {
    const ks = unlockedKinds();
    let k, guard = 0;
    do { k = ks[(Math.random() * ks.length) | 0]; } while (k === lastKind && ks.length > 1 && guard++ < 5);
    lastKind = k;
    return k;
  }

  function jumpAirtime() {
    const apex = (T.jumpVel * T.jumpVel) / (2 * T.gravUp);      // ×H
    return T.jumpVel / T.gravUp + Math.sqrt(2 * apex / T.gravFall);
  }

  function spawnObstacle() {
    const kind = pickKind();
    const x = view.w + BODY;
    let o;
    if (kind === KIND.BLOCK) {
      const h = H() * (0.06 + Math.random() * 0.10);
      const w = H() * (0.05 + Math.random() * 0.06);
      o = { kind, x, w, top: GY - h, h, standable: true };
    } else if (kind === KIND.SPIKE) {
      const n = 1 + (Math.random() * 3 | 0);
      const w = H() * 0.035 * n;
      const h = H() * (0.045 + Math.random() * 0.03);
      o = { kind, x, w, top: GY - h, h, spikes: n, standable: false };
    } else if (kind === KIND.WALL) {
      const h = BODY * (1.9 + Math.random() * 0.35);            // needs near-full jump
      const w = H() * 0.045;
      o = { kind, x, w, top: GY - h, h, standable: true };
    } else if (kind === KIND.BAR) {
      const gap = BODY * T.slideH + H() * 0.02;                 // just enough to slide under
      const barBottom = GY - gap;
      const h = H() * (0.035 + Math.random() * 0.03);
      const w = H() * (0.07 + Math.random() * 0.12);            // long ones = ceiling runs
      o = { kind, x, w, top: barBottom - h, h, barBottom, standable: false };
    } else { // PIT — width clamped so it's always jumpable at current speed
      const maxW = run.speed * jumpAirtime() * 0.62;
      const w = Math.min(H() * (0.10 + Math.random() * 0.12), maxW);
      o = { kind, x, w, top: GY, h: view.h - GY, standable: false };
    }
    o.scored = false; o.passed = false;
    obstacles.push(o);

    // reward orb arc over jumpable obstacles, or a loose floating orb
    if (JUMP_KINDS.has(kind) && Math.random() < 0.5) {
      const arcY = (kind === KIND.PIT ? GY : o.top) - H() * (0.10 + Math.random() * 0.05);
      orbs.push({ x: o.x + o.w * 0.5, y: arcY, r: H() * 0.016, got: false });
    } else if (Math.random() < 0.22) {
      orbs.push({ x: o.x + Math.random() * H() * 0.16, y: GY - H() * (0.09 + Math.random() * 0.16), r: H() * 0.016, got: false });
    }

    // fairness gap: spacing scales with speed and the action this obstacle demands
    const actionLock = (kind === KIND.BAR) ? T.slideLock : T.jumpLock;
    run.nextGap = o.w + run.speed * (T.reactionFloor + actionLock) + Math.random() * run.speed * 0.35;
  }

  // ──────────────────────────── 7. Simulation ───────────────────────────────
  function simulate(dt) {
    run.t += dt;

    // speed: exponential ease to cap, plus the run-start ease-in and milestone burst
    let v = T.v0 + (T.vmax - T.v0) * (1 - Math.exp(-run.t / T.tau));
    if (run.t < T.easeIn) v *= run.t / T.easeIn;
    if (run.burst > 0) { v *= 1.045; run.burst -= dt; }
    run.speed = v * W();
    run.speedNorm = Math.max(0, Math.min(1, (run.speed / W() - T.v0) / (T.vmax - T.v0)));

    const dx = run.speed * dt;
    run.distPx += dx;
    run.meters = Math.floor(run.distPx / (W() / T.metersPerScreen));

    if (!run.passedBest && run.best > 0 && run.meters > run.best) {
      run.passedBest = true;
      addFloater(W() * 0.5, H() * 0.32, 'NEW BEST!', C.orb, 1.4, 1.0);
      flash = Math.min(0.45, flash + 0.3); sfx.mile();
    }

    // milestone
    if (run.meters >= run.nextMilestone) {
      addFloater(W() * 0.5, H() * 0.30, run.nextMilestone + ' m', C.runner, 1.2, 0.9);
      run.nextMilestone += 500; run.burst = 1.2;
      flash = Math.min(0.35, flash + 0.18); sfx.mile();
      if (!reduceMotion) shake = Math.max(shake, H() * 0.006);
    }

    // scroll + cull
    for (const o of obstacles) o.x -= dx;
    for (const o of orbs) o.x -= dx;
    for (const s of speedLines) s.x -= dx * (0.6 + s.depth);
    for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].x + obstacles[i].w < -BODY) obstacles.splice(i, 1);
    for (let i = orbs.length - 1; i >= 0; i--) if (orbs[i].x < -BODY) orbs.splice(i, 1);
    for (let i = speedLines.length - 1; i >= 0; i--) if (speedLines[i].x < -140) speedLines.splice(i, 1);

    // spawn
    run.distSinceSpawn += dx;
    if (run.distSinceSpawn >= run.nextGap) { run.distSinceSpawn = 0; spawnObstacle(); }
    if (Math.random() < dt * (1.4 + run.speedNorm * 3.0)) spawnSpeedLine();

    // ---- player physics ----
    player.prevFeet = player.y;

    // support surface (ground / block-top / nothing over a pit).
    // A pit removes support over the SAME horizontal extent the pit death test uses
    // (full hitbox half-width `phw`), so support and the lethal test clear on the
    // exact same frame — you can stand on the far lip without dying. Block-standing
    // still uses a narrow feet band so you only perch when actually above the top.
    const phw = (player.sliding ? 1.5 : 1) * BODY * 0.30 * T.hbW;   // = playerHitbox half-width
    let support = GY, overPit = false;
    for (const o of obstacles) {
      const ol = o.x + hbInsetX(o), or = o.x + o.w - hbInsetX(o);
      if (o.kind === KIND.PIT) {
        if (PX + phw > ol && PX - phw < or) overPit = true;
        continue;
      }
      if (!(PX + BODY * 0.12 > ol && PX - BODY * 0.12 < or)) continue;
      if (o.standable && o.top < support) support = o.top;
    }
    if (overPit && support === GY) support = view.h + H() * 0.3;
    player.supportY = support;

    const g = (player.vy < 0 ? T.gravUp : T.gravFall) * H();
    player.vy += g * dt;
    if (player.vy > T.maxFall * H()) player.vy = T.maxFall * H();
    player.y += player.vy * dt;

    if (player.y >= support) {
      if (!player.onGround) {
        const impact = player.vy;
        player.onGround = true; player.vy = 0; player.coyote = T.coyote;
        if (impact > H() * 0.4) {
          player.squashY = Math.max(0.72, 1 - impact / (H() * 3.4));   // squash flat on land
          sfx.land();
          spawnDust(PX, support, 4 + (impact / (H() * 0.35) | 0));
        }
        if (player.slideQueued) startSlide();
        else if (player.buffer > 0) tryJump();
      }
      player.y = support;
    } else {
      player.onGround = false;
    }

    if (player.onGround) player.coyote = T.coyote; else player.coyote = Math.max(0, player.coyote - dt);
    player.buffer = Math.max(0, player.buffer - dt);
    run.comboTimer = Math.max(0, run.comboTimer - dt);
    if (run.comboTimer === 0) run.combo = 0;

    if (player.sliding) {
      player.slideElapsed += dt; player.slideT -= dt;
      if (!player.onGround) player.sliding = false;
      else if (player.slideT <= 0 && !slideHeld()) player.sliding = false;
    }

    player.squashY += (1 - player.squashY) * Math.min(1, dt * 14);

    const cadence = 1.8 + run.speedNorm * 1.8;     // Hz
    player.runPhase += cadence * dt * Math.PI * 2;

    // ---- collisions ----
    const hb = playerHitbox();
    for (const o of obstacles) {
      if (o.kind === KIND.PIT) {
        if (player.y >= GY - H() * 0.004 && hb.right > o.x + hbInsetX(o) && hb.left < o.x + o.w - hbInsetX(o)) return die();
        continue;
      }
      const ol = o.x + hbInsetX(o), or = o.x + o.w - hbInsetX(o);
      const ot = o.top + H() * 0.006, ob = o.top + o.h;
      if (!(hb.right > ol && hb.left < or && hb.bottom > ot && hb.top < ob)) continue;
      if (o.standable) {
        const landed = player.prevFeet <= o.top + H() * 0.01 && player.vy >= 0;
        if (!landed) return die();
      } else return die();
    }

    // ---- orbs ----
    for (const orb of orbs) {
      if (orb.got) continue;
      const ddx = orb.x - PX, ddy = orb.y - (player.y - BODY * 0.5), rr = orb.r + BODY * 0.34;
      if (ddx * ddx + ddy * ddy < rr * rr) {
        orb.got = true;
        run.distPx += (W() / T.metersPerScreen) * T.orbMeters;
        flash = Math.min(0.4, flash + 0.22); sfx.orb();
        spawnSpark(orb.x, orb.y, C.orb, 9);
        addFloater(orb.x, orb.y, '+' + T.orbMeters, C.orb, 0.7, 0.6);
      }
    }
    for (let i = orbs.length - 1; i >= 0; i--) if (orbs[i].got) orbs.splice(i, 1);

    // ---- near-miss style scoring ----
    for (const o of obstacles) {
      if (o.passed || o.kind === KIND.PIT) continue;
      if (o.x + o.w * 0.5 < PX) {     // sample at closest approach (obstacle centre)
        o.passed = true;
        const clr = nearClearance(o);
        if (clr >= 0 && clr < T.nearBand * H()) {
          run.combo++; run.comboTimer = 2.2;
          const mult = Math.min(4, 1 + Math.floor(run.combo / 2));
          run.distPx += (W() / T.metersPerScreen) * T.nearBonus * mult;
          flash = Math.min(0.35, flash + 0.14); sfx.near();
          if (!reduceMotion) slowmo = Math.max(slowmo, 0.07);
          addFloater(PX + BODY, player.y - BODY * 0.7, 'CLOSE ×' + mult, C.orb, 0.8, 0.7);
        }
      }
    }

    shake = Math.max(0, shake - dt * H() * 0.09);
    flash = Math.max(0, flash - dt * 1.8);
    slowmo = Math.max(0, slowmo - dt);
    updateParticles(dt);
    updateFloaters(dt);

    // motion-trail snapshots when blazing
    if (run.speedNorm > 0.58 && !reduceMotion) {
      ghosts.push({ y: player.y, phase: player.runPhase, sliding: player.sliding, onGround: player.onGround, vy: player.vy, life: 0.16 });
      if (ghosts.length > 5) ghosts.shift();
    }
    for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1); }
  }

  function hbInsetX(o) { return (o.w * (1 - 0.92)) * 0.5 + H() * 0.004; }
  function playerHitbox() {
    const h = (player.sliding ? T.slideH : 1) * BODY * T.hbH;
    const w = (player.sliding ? 1.5 : 1) * BODY * 0.30 * T.hbW * 2;
    return { left: PX - w / 2, right: PX + w / 2, top: player.y - h, bottom: player.y };
  }
  function nearClearance(o) {
    if (o.kind === KIND.BAR) {
      const headY = player.y - (player.sliding ? T.slideH : 1) * BODY * T.hbH;
      return headY - o.barBottom;
    }
    return o.top - player.y;   // feet vs obstacle top
  }

  function die() {
    if (gameState !== STATE.PLAY) return;
    gameState = STATE.DEAD;
    deadLockUntil = now() + 750;          // restart only once the over-screen is shown
    player.deadT = 0;
    player.rot = 0;
    player.rotV = (3 + Math.random() * 2) * (run.speedNorm + 0.5);
    player.limbFlail = 1;
    player.squashY = 1;                   // don't freeze a mid-squash onto the corpse
    // ragdoll rests on the ground for a normal death, but keeps falling into a pit
    player.deathFloor = (player.supportY > view.h) ? Infinity : GY;
    ghosts.length = 0;                    // no frozen motion-trail during the ragdoll
    shake = reduceMotion ? 0 : H() * 0.02;
    flash = 0.55; hitStop = 0.08; slowmo = 0.6;
    sfx.die();
    spawnSpark(PX, player.y - BODY * 0.5, C.danger, 20);

    run.runs++;
    const final = run.meters;
    const isBest = final > run.best;
    if (isBest) run.best = final;
    meta.runs = (meta.runs | 0) + 1;
    meta.totalDistance = (meta.totalDistance | 0) + final;
    saveMeta();

    finalScoreEl.textContent = final;
    overSubEl.textContent = 'Best ' + run.best + ' m';
    newBestEl.classList.toggle('hidden', !isBest);
    bestScoreEl.textContent = run.best;
    announce('Run over. ' + final + ' meters.' + (isBest ? ' New best!' : ''));

    setTimeout(() => { if (gameState === STATE.DEAD) { overScreen.classList.remove('hidden'); overScreen.focus(); } }, 750);
  }

  // ───────────────────────────── 8. Stick figure ────────────────────────────
  function drawRunner(cx, feetY, opts) {
    opts = opts || {};
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    const fh = BODY;
    const sliding = opts.sliding != null ? opts.sliding : player.sliding;
    const onGround = opts.onGround != null ? opts.onGround : player.onGround;
    const vy = opts.vy != null ? opts.vy : player.vy;
    const phase = opts.phase != null ? opts.phase : player.runPhase;
    const dead = gameState === STATE.DEAD && !opts.ghost;
    const sq = opts.ghost ? 1 : player.squashY;
    const stretchW = 1 + (1 - sq) * 0.45;

    const thigh = fh * 0.26, shin = fh * 0.26, torso = fh * 0.34, neck = fh * 0.06, headR = fh * 0.12, upper = fh * 0.20, fore = fh * 0.20;

    ctx.save();
    ctx.translate(cx, feetY);
    if (dead) ctx.rotate(player.rot);
    ctx.scale(stretchW, sq);

    let pelvisY, lean;
    if (dead) {
      pelvisY = -(thigh + shin) * 0.6;
      lean = 0.4;
    } else if (sliding) {
      pelvisY = -(thigh + shin) * 0.5; lean = 1.15;
    } else if (!onGround) {
      pelvisY = -(thigh + shin) * 0.96; lean = vy < 0 ? 0.18 : 0.44;
    } else {
      const bob = Math.abs(Math.sin(phase)) * fh * 0.03;
      pelvisY = -(thigh + shin) * 0.92 - bob;
      lean = 0.18 + 0.12 * (opts.speedNorm != null ? opts.speedNorm : run.speedNorm) + Math.sin(phase) * 0.04;
    }
    const pelvis = { x: 0, y: pelvisY };
    const neckP = { x: pelvis.x + Math.sin(lean) * torso, y: pelvis.y - Math.cos(lean) * torso };
    const headP = { x: neckP.x + Math.sin(lean) * (neck + headR), y: neckP.y - Math.cos(lean) * (neck + headR) };

    const flail = dead ? player.limbFlail : 0;
    const legs = legPose(sliding, dead, phase, thigh, shin, pelvis, flail);
    const arms = armPose(sliding, dead, phase, upper, fore, neckP, lean, flail);

    const lw = fh * 0.088;
    const base = opts.color || C.runner;
    const core = '#e6fff9';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // segment list: [points, widthScale, isFront]
    const segs = [
      [legs.back, 1, 0], [arms.back, 0.85, 0],
      [[pelvis, neckP], 1.18, 1],
      [legs.front, 1, 1], [arms.front, 0.85, 1],
    ];

    // pass 1 — glowing body (back limbs dimmer for depth)
    if (!opts.ghost) { ctx.shadowColor = C.runnerGlow; ctx.shadowBlur = fh * 0.11; }
    ctx.strokeStyle = base;
    for (let i = 0; i < segs.length; i++) { ctx.globalAlpha = alpha * (segs[i][2] ? 1 : 0.5); stroke(segs[i][0], lw * segs[i][1]); }
    // head
    ctx.globalAlpha = alpha; ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(headP.x, headP.y, headR, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // pass 2 — bright inner core on the front limbs (the neon-tube highlight)
    if (!opts.ghost) {
      ctx.strokeStyle = core;
      for (let i = 0; i < segs.length; i++) { if (!segs[i][2]) continue; ctx.globalAlpha = alpha * 0.8; stroke(segs[i][0], lw * segs[i][1] * 0.36); }
      ctx.globalAlpha = alpha; ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(headP.x - headR * 0.28, headP.y - headR * 0.28, headR * 0.42, 0, Math.PI * 2); ctx.fill();
    }

    ctx.globalAlpha = 1; ctx.restore();

    function stroke(pts, width) { ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
  }

  function legPose(sliding, dead, phase, thigh, shin, hip, flail) {
    function leg(ph, side) {
      let thighA, kneeBend;
      if (sliding) { thighA = 1.4; kneeBend = 0.5; }
      else if (dead) { thighA = 0.3 + Math.sin(phase * 7 + side) * 0.5 * flail; kneeBend = 0.6 + 0.5 * flail; }
      else { thighA = Math.sin(ph) * 0.95; kneeBend = (0.6 - 0.6 * Math.cos(ph)) + 0.25; }
      const knee = { x: hip.x + Math.sin(thighA) * thigh, y: hip.y + Math.cos(thighA) * thigh };
      const shinA = thighA - kneeBend;
      const foot = { x: knee.x + Math.sin(shinA) * shin, y: knee.y + Math.cos(shinA) * shin };
      return [hip, knee, foot];
    }
    return { front: leg(phase, 0), back: leg(phase + Math.PI, 1.7) };
  }
  function armPose(sliding, dead, phase, upper, fore, sh, lean, flail) {
    function arm(ph, side) {
      let shoulderA, elbowBend;
      if (sliding) { shoulderA = lean - 2.2; elbowBend = 0.6; }
      else if (dead) { shoulderA = lean + 2.0 + Math.sin(phase * 6 + side) * 0.7 * flail; elbowBend = 0.5; }
      else { shoulderA = lean + Math.PI + Math.sin(ph) * 0.85; elbowBend = 1.1; }
      const elbow = { x: sh.x + Math.sin(shoulderA) * upper, y: sh.y + Math.cos(shoulderA) * upper };
      const handA = shoulderA + elbowBend;
      const hand = { x: elbow.x + Math.sin(handA) * fore, y: elbow.y + Math.cos(handA) * fore };
      return [sh, elbow, hand];
    }
    return { front: arm(phase + Math.PI, 0), back: arm(phase, 3.1) };
  }

  // ──────────────────────── 9. Background / parallax ─────────────────────────
  // Synthwave dusk: cached sky gradient, a retro sun, layered scrolling mountains
  // and a lit-window cityscape, a neon ground line, and a vignette. All procedural.
  let bgScroll = 0;
  const stars = [];
  function initStars() {
    stars.length = 0;
    for (let i = 0; i < 60; i++) stars.push({
      x: Math.random(), y: Math.random() * 0.55,
      r: Math.random() < 0.85 ? 1 : 2, base: 0.4 + Math.random() * 0.6,
      sp: 1.4 + Math.random() * 2.2, tw: Math.random() * Math.PI * 2,
      c: Math.random() < 0.3 ? '#ffe0c0' : '#cfe9ff',
    });
  }
  function frac(n) { return n - Math.floor(n); }

  // cached gradients (rebuilt only when the hue bucket or size changes)
  let _sky = { key: '', g: null }, _band = { key: '', g: null }, _vig = { key: '', g: null };
  function skyGrad(hue, gy) {
    const key = (hue * 0.5 | 0) + 'x' + Math.round(gy);
    if (_sky.key !== key) {
      const g = ctx.createLinearGradient(0, 0, 0, gy + 4);
      g.addColorStop(0.0, `hsl(${hue},58%,6%)`);
      g.addColorStop(0.42, `hsl(${(hue + 16) % 360},52%,10%)`);
      g.addColorStop(0.74, `hsl(${(hue + 38) % 360},60%,16%)`);
      g.addColorStop(1.0, `hsl(${(hue + 60) % 360},70%,27%)`);
      _sky = { key, g };
    }
    return _sky.g;
  }

  function drawBackground(dt) {
    const w = view.w, gy = GY;
    if (gameState === STATE.PLAY) bgScroll += run.speed * dt;
    const hue = (212 + run.meters * 0.10) % 360;

    ctx.fillStyle = skyGrad(hue, gy);
    ctx.fillRect(0, 0, w, gy + 4);

    drawSun(gy, hue);

    for (const s of stars) {
      s.tw += dt * s.sp;
      ctx.globalAlpha = Math.max(0, (0.5 + Math.sin(s.tw) * 0.5) * s.base);
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x * w, s.y * gy, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    mountains(0.07, gy, gy * 0.40, `hsl(${(hue + 30) % 360},36%,12%)`, 1.7, 2.0, 0.5);
    cityscape(0.24, gy, gy * 0.44, `hsl(${(hue + 18) % 360},32%,8%)`, 0.23);
    mountains(0.46, gy, gy * 0.17, `hsl(${(hue + 54) % 360},34%,17%)`, 3.1, 1.3, 0.0);
  }

  function drawSun(gy, hue) {
    const sx = view.w * 0.74, cy = gy * 0.58, R = gy * 0.20;
    // outer glow
    const g = ctx.createRadialGradient(sx, cy, R * 0.3, sx, cy, R * 2.6);
    g.addColorStop(0, `hsla(${(hue + 46) % 360},92%,72%,0.55)`);
    g.addColorStop(0.4, `hsla(${(hue + 30) % 360},88%,60%,0.18)`);
    g.addColorStop(1, `hsla(${(hue + 30) % 360},88%,60%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(sx - R * 2.6, cy - R * 2.6, R * 5.2, R * 5.2);
    // disc
    const gd = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    gd.addColorStop(0, `hsl(${(hue + 52) % 360},95%,78%)`);
    gd.addColorStop(1, `hsl(${(hue + 18) % 360},92%,56%)`);
    ctx.save();
    ctx.beginPath(); ctx.arc(sx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = gd; ctx.fillRect(sx - R, cy - R, R * 2, R * 2);
    // retro horizontal bands across the lower half
    ctx.fillStyle = skyGrad((212 + run.meters * 0.10) % 360, gy);
    for (let i = 0; i < 5; i++) {
      const yy = cy + R * (0.12 + i * 0.18);
      ctx.fillRect(sx - R, yy, R * 2, R * (0.05 + i * 0.018));
    }
    ctx.restore();
  }

  // smooth, non-repeating scrolling ridge from a sum of sines
  function mountains(factor, gy, amp, color, seed, freq, baseFrac) {
    const w = view.w, off = bgScroll * factor, steps = 26;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const u = (x + off) / w * freq;
      const n = 0.5 + 0.32 * Math.sin(u * 2.1 + seed) + 0.18 * Math.sin(u * 5.7 + seed * 1.7);
      ctx.lineTo(x, gy - amp * (baseFrac + (1 - baseFrac) * n));
    }
    ctx.lineTo(w, gy); ctx.closePath(); ctx.fill();
  }

  // city silhouette with deterministic lit windows; building hashes are global so
  // the skyline never visibly repeats
  function cityscape(factor, gy, maxH, color, tileFrac) {
    const w = view.w, tile = w * tileFrac, scroll = bgScroll * factor;
    const baseI = Math.floor(scroll / tile), off = scroll - baseI * tile;
    for (let i = -1; i * tile - off < w + tile; i++) {
      const gi = baseI + i, sx = i * tile - off;
      const s1 = frac(Math.sin(gi * 12.9898) * 43758.5453);
      const h = maxH * (0.42 + 0.55 * s1);
      const bw = tile * 0.66, left = sx + tile * 0.17, topY = gy - h;
      ctx.fillStyle = color;
      ctx.fillRect(left, topY, bw, h);
      if (s1 > 0.72) { ctx.fillStyle = 'rgba(255,90,112,0.85)'; ctx.fillRect(left + bw * 0.5 - 1, topY - tile * 0.06, 2, tile * 0.06); }
      // windows
      const cols = Math.max(2, Math.min(5, (bw / (tile * 0.16)) | 0));
      const rows = Math.max(3, Math.min(13, (h / (tile * 0.16)) | 0));
      const cw = bw / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
        const lit = frac(Math.sin(gi * 131.1 + r * 17.3 + cc * 7.7) * 9871.23);
        if (lit > 0.6) { ctx.fillStyle = `rgba(255,206,${(120 + lit * 70) | 0},${0.2 + lit * 0.5})`; ctx.fillRect(left + cc * cw + cw * 0.24, topY + r * ch + ch * 0.24, cw * 0.5, ch * 0.5); }
      }
    }
  }

  function bandGrad(gy, h) {
    const key = Math.round(gy) + 'x' + Math.round(h);
    if (_band.key !== key) {
      const g = ctx.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, '#241a3e');
      g.addColorStop(0.12, '#1b1330');
      g.addColorStop(1, '#0c0820');
      _band = { key, g };
    }
    return _band.g;
  }

  function drawGround() {
    const w = view.w, h = view.h, gy = GY;
    const lw = Math.max(2, h * 0.0035);
    // fill the band, leaving pit gaps; bright neon edge with glow; glowing pit lips
    ctx.fillStyle = bandGrad(gy, h);
    let cursor = 0;
    forEachPitSpan((l, r) => { if (l > cursor) ctx.fillRect(cursor, gy, l - cursor, h - gy); cursor = Math.max(cursor, r); });
    if (cursor < w) ctx.fillRect(cursor, gy, w - cursor, h - gy);

    // scrolling chevrons on the floor (speed read) — clipped to the band
    ctx.save();
    ctx.beginPath(); ctx.rect(0, gy, w, h - gy); ctx.clip();
    ctx.strokeStyle = 'rgba(84,230,200,0.14)'; ctx.lineWidth = Math.max(1.5, h * 0.0025);
    const tick = w * 0.075, off = bgScroll % tick;
    for (let x = -off; x < w + tick; x += tick) { ctx.beginPath(); ctx.moveTo(x, gy + h * 0.016); ctx.lineTo(x - h * 0.02, gy + h * 0.05); ctx.stroke(); }
    ctx.restore();

    // neon edge line, broken over pits
    ctx.save();
    ctx.strokeStyle = C.edge; ctx.lineWidth = lw;
    ctx.shadowColor = C.runner; ctx.shadowBlur = h * 0.016;
    cursor = 0;
    forEachPitSpan((l, r) => {
      if (l > cursor) { ctx.beginPath(); ctx.moveTo(cursor, gy); ctx.lineTo(l, gy); ctx.stroke(); }
      cursor = Math.max(cursor, r);
    });
    if (cursor < w) { ctx.beginPath(); ctx.moveTo(cursor, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    // glowing pit lips (danger)
    ctx.strokeStyle = C.danger; ctx.shadowColor = C.danger; ctx.shadowBlur = h * 0.014;
    for (const o of obstacles) {
      if (o.kind !== KIND.PIT) continue;
      const l = o.x, r = o.x + o.w;
      if (r < 0 || l > w) continue;
      ctx.beginPath(); ctx.moveTo(l, gy); ctx.lineTo(l, gy + h * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r, gy); ctx.lineTo(r, gy + h * 0.05); ctx.stroke();
    }
    ctx.restore();
  }

  // iterate merged, sorted pit spans on screen without allocating a filtered array
  function forEachPitSpan(fn) {
    const w = view.w;
    // collect pit x-ranges (few on screen) into a small reused buffer
    _pitBuf.length = 0;
    for (const o of obstacles) if (o.kind === KIND.PIT) { const l = Math.max(0, o.x), r = Math.min(w, o.x + o.w); if (r > 0 && l < w && r > l) _pitBuf.push(l, r); }
    // simple insertion sort by left edge (pairs)
    for (let i = 2; i < _pitBuf.length; i += 2) {
      const l = _pitBuf[i], r = _pitBuf[i + 1]; let j = i - 2;
      while (j >= 0 && _pitBuf[j] > l) { _pitBuf[j + 2] = _pitBuf[j]; _pitBuf[j + 3] = _pitBuf[j + 1]; j -= 2; }
      _pitBuf[j + 2] = l; _pitBuf[j + 3] = r;
    }
    for (let i = 0; i < _pitBuf.length; i += 2) fn(_pitBuf[i], _pitBuf[i + 1]);
  }
  const _pitBuf = [];

  function drawVignette() {
    const w = view.w, h = view.h, key = w + 'x' + h;
    if (_vig.key !== key) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.44, Math.min(w, h) * 0.32, w * 0.5, h * 0.52, Math.max(w, h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      _vig = { key, g };
    }
    ctx.fillStyle = _vig.g; ctx.fillRect(0, 0, w, h);
  }

  function drawGroundShadow(cx, feetY) {
    const airFrac = Math.min(1, Math.max(0, (GY - feetY) / (BODY * 2.4)));
    const a = 0.34 * (1 - airFrac * 0.8);
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, GY + BODY * 0.015, BODY * 0.32 * (1 - airFrac * 0.45), BODY * 0.07 * (1 - airFrac * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ──────────────────────── 10. Particles + juice ───────────────────────────
  function spawnDust(x, y, n) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: -(20 + Math.random() * 70) * (0.4 + Math.random()) * (view.h / 720), vy: -Math.random() * H() * 0.18, life: 0.35 + Math.random() * 0.3, max: 0.65, r: H() * (0.003 + Math.random() * 0.004), color: 'rgba(155,143,181,0.7)', grav: H() * 0.85 });
  }
  function spawnSpark(x, y, color, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = H() * (0.12 + Math.random() * 0.3); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.4, max: 0.8, r: H() * (0.0025 + Math.random() * 0.0035), color, grav: H() * 0.4, add: true }); }
  }
  function spawnSpeedLine() { speedLines.push({ x: view.w + 20, y: Math.random() * GY * 0.92, len: H() * (0.05 + Math.random() * 0.12), depth: Math.random() * 0.7 }); }
  function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); } }
  function drawParticles() {
    for (const p of particles) { if (p.add) continue; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) { if (!p.add) continue; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function drawSpeedLines() { ctx.strokeStyle = 'rgba(84,230,200,0.10)'; ctx.lineWidth = Math.max(1, H() * 0.002); for (const s of speedLines) { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.len, s.y); ctx.stroke(); } }

  function addFloater(x, y, text, color, life, size) { floaters.push({ x, y, text, color, life, max: life, size }); }
  function updateFloaters(dt) { for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.y -= H() * 0.12 * dt; f.life -= dt; if (f.life <= 0) floaters.splice(i, 1); } }
  function drawFloaters() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max * 1.4));
      ctx.fillStyle = f.color;
      ctx.font = `800 ${H() * 0.03 * (f.size || 0.7)}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────────────────────── 11. Render ─────────────────────────────────
  function drawObstacles() {
    const gy = GY, h = view.h, t6 = Math.max(2, H() * 0.005);
    // ground contact shadows first (under everything), skip pits
    ctx.save();
    ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
    for (const o of obstacles) {
      if (o.kind === KIND.PIT || o.x > view.w + BODY || o.x + o.w < -BODY) continue;
      ctx.beginPath(); ctx.ellipse(o.x + o.w * 0.5, gy + BODY * 0.012, o.w * 0.62, BODY * 0.055, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    for (const o of obstacles) {
      if (o.kind === KIND.PIT || o.x > view.w + BODY || o.x + o.w < -BODY) continue;
      ctx.save();
      ctx.shadowColor = C.danger; ctx.shadowBlur = h * 0.012;
      if (o.kind === KIND.BLOCK || o.kind === KIND.WALL) {
        const r = H() * 0.006;
        const g = ctx.createLinearGradient(0, o.top, 0, o.top + o.h);
        g.addColorStop(0, '#3a2150'); g.addColorStop(1, C.dangerDk);
        roundRect(o.x, o.top, o.w, o.h, r); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = C.danger; ctx.lineWidth = Math.max(2, H() * 0.0038); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ff89a6'; ctx.fillRect(o.x + o.w * 0.18, o.top + t6 * 0.4, o.w * 0.64, t6);   // bright cap
      } else if (o.kind === KIND.SPIKE) {
        const sw = o.w / o.spikes;
        ctx.fillStyle = C.danger; ctx.beginPath();
        for (let i = 0; i < o.spikes; i++) { const x0 = o.x + i * sw; ctx.moveTo(x0, gy); ctx.lineTo(x0 + sw / 2, o.top); ctx.lineTo(x0 + sw, gy); }
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#ffd0db';
        for (let i = 0; i < o.spikes; i++) { ctx.beginPath(); ctx.arc(o.x + i * sw + sw / 2, o.top + H() * 0.004, Math.max(1.2, H() * 0.0035), 0, Math.PI * 2); ctx.fill(); }
      } else { // BAR
        const t = Math.max(3, H() * 0.006), pw = Math.max(2, H() * 0.004);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,84,112,0.30)';                  // faint posts to the ground
        ctx.fillRect(o.x, o.barBottom, pw, gy - o.barBottom);
        ctx.fillRect(o.x + o.w - pw, o.barBottom, pw, gy - o.barBottom);
        ctx.shadowColor = C.danger; ctx.shadowBlur = h * 0.012;
        ctx.fillStyle = C.dangerDk; ctx.fillRect(o.x, o.top, o.w, o.h);
        ctx.fillStyle = C.danger;
        ctx.fillRect(o.x, o.top, o.w, t);                          // slab top edge
        ctx.fillRect(o.x, o.barBottom - t, o.w, t);                // glowing underside (duck under this)
      }
      ctx.restore();
    }
  }
  function drawOrbs() {
    const tnow = now();
    for (const orb of orbs) {
      if (orb.x > view.w + BODY || orb.x < -BODY) continue;
      const R = orb.r, pulse = 0.8 + 0.2 * Math.sin(tnow / 170 + orb.x * 0.05);
      const g = ctx.createRadialGradient(orb.x, orb.y, R * 0.2, orb.x, orb.y, R * 3.4 * pulse);
      g.addColorStop(0, 'rgba(255,226,150,0.8)');
      g.addColorStop(0.45, 'rgba(255,196,86,0.22)');
      g.addColorStop(1, 'rgba(255,196,86,0)');
      ctx.fillStyle = g; ctx.fillRect(orb.x - R * 3.4, orb.y - R * 3.4, R * 6.8, R * 6.8);
      ctx.fillStyle = C.orb; ctx.beginPath(); ctx.arc(orb.x, orb.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(orb.x - R * 0.3, orb.y - R * 0.3, R * 0.45, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawHUD() {
    const top = H() * 0.045;
    ctx.textBaseline = 'top';
    ctx.fillStyle = C.text;
    ctx.font = `800 ${H() * 0.052}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(run.meters + '', W() * 0.5, top);
    ctx.font = `700 ${H() * 0.018}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = C.muted;
    ctx.fillText('METRES', W() * 0.5, top + H() * 0.058);
    // best top-right (kept clear of the mute/pause buttons)
    ctx.textAlign = 'right';
    ctx.fillStyle = C.muted;
    ctx.font = `700 ${H() * 0.02}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('best ' + run.best, W() - W() * 0.04, H() * 0.092);
    // combo
    if (run.combo > 1) {
      ctx.textAlign = 'center'; ctx.fillStyle = C.orb;
      ctx.font = `800 ${H() * 0.024}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText('×' + Math.min(4, 1 + Math.floor(run.combo / 2)) + ' COMBO', W() * 0.5, top + H() * 0.085);
    }
  }
  function roundRect(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function render(dt) {
    ctx.save();
    if (shake > 0.5 && !reduceMotion) { const a = Math.random() * Math.PI * 2; ctx.translate(Math.cos(a) * shake, Math.sin(a) * shake); }

    drawBackground(dt);
    drawSpeedLines();
    drawGround();
    drawObstacles();
    drawOrbs();

    if (gameState === STATE.TITLE) {
      player.y = GY; player.runPhase += dt * 9;
      drawGroundShadow(PX, GY);
      drawRunner(PX, GY, { speedNorm: 0.5 });
    } else {
      drawGroundShadow(PX, player.y);
      for (const gst of ghosts) {   // motion-trail ghosts behind the runner
        drawRunner(PX - (0.16 - gst.life) * W() * 0.18, gst.y, { ghost: true, alpha: gst.life * 2.4, color: C.ghost, phase: gst.phase, sliding: gst.sliding, onGround: gst.onGround, vy: gst.vy, speedNorm: run.speedNorm });
      }
      drawRunner(PX, player.y);
    }

    drawParticles();      // dust/sparks read better over the runner
    drawVignette();
    drawFloaters();
    if (gameState === STATE.PLAY || gameState === STATE.PAUSE) drawHUD();

    ctx.restore();

    // reduced-motion: suppress the full-screen luminance flash
    if (flash > 0.01 && !reduceMotion) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, view.w, view.h); }
  }

  // ─────────────────────────────── 12. Loop ─────────────────────────────────
  const STEP = 1 / 120;
  let last = 0, acc = 0;

  function frame(t) {
    if (!view.w || !view.h) resize();   // self-heal a 0-size initial layout
    if (!last) last = t;
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.25) dt = 0.25;

    if (hitStop > 0) { hitStop -= dt; dt = 0; }
    else if (slowmo > 0 && gameState === STATE.DEAD) dt *= 0.3;   // death slow-mo

    if (gameState === STATE.PLAY) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 300) { simulate(STEP); acc -= STEP; steps++; }
    } else if (gameState === STATE.DEAD) {
      player.deadT += dt;
      player.rot += player.rotV * dt;
      player.rotV *= (1 - dt * 1.2);
      player.limbFlail = Math.max(0, player.limbFlail - dt * 1.3);
      player.vy += T.gravFall * H() * dt;
      player.y += player.vy * dt * 0.4;
      if (player.y > player.deathFloor) { player.y = player.deathFloor; player.vy = 0; }  // rest on ground (Infinity over a pit)
      bgScroll += run.speed * dt * 0.3;       // world coasts to a stop
      updateParticles(dt); updateFloaters(dt);
      shake = Math.max(0, shake - dt * H() * 0.09);
      flash = Math.max(0, flash - dt * 1.8);
      slowmo = Math.max(0, slowmo - dt / 0.3);
    }

    render(dt);
    requestAnimationFrame(frame);
  }

  // ─────────────────────────────── 13. UI ───────────────────────────────────
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function startRun() {
    ensureAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    obstacles.length = 0; orbs.length = 0; particles.length = 0; floaters.length = 0; speedLines.length = 0; ghosts.length = 0;
    lastKind = null;
    run.t = 0; run.speed = T.v0 * W(); run.speedNorm = 0; run.distPx = 0; run.meters = 0;
    run.distSinceSpawn = 0; run.nextGap = W() * 0.6; run.combo = 0; run.comboTimer = 0;
    run.nextMilestone = 500; run.burst = 0; run.passedBest = false;
    player.y = GY; player.vy = 0; player.onGround = true; player.supportY = GY; player.prevFeet = GY;
    player.sliding = false; player.slideT = 0; player.slideElapsed = 0; player.runPhase = 0; player.squashY = 1;
    player.coyote = 0; player.buffer = 0; player.jumpHeld = false; player.slideQueued = false;
    player.deadT = 0; player.rot = 0; player.rotV = 0; player.limbFlail = 0; player.deathFloor = 0;
    shake = 0; flash = 0; hitStop = 0; slowmo = 0;
    clearInput();   // drop any finger/key still held from the previous run

    hide(titleScreen); hide(overScreen); hide(pauseScreen);
    pauseBtn.hidden = false;
    gameState = STATE.PLAY;
    last = 0; acc = 0;
    announce('Go!');
  }
  function pauseGame() { if (gameState !== STATE.PLAY) return; gameState = STATE.PAUSE; clearInput(); show(pauseScreen); pauseScreen.focus(); }
  function resumeGame() { if (gameState !== STATE.PAUSE) return; hide(pauseScreen); gameState = STATE.PLAY; last = 0; acc = 0; }
  function quitToMenu() { gameState = STATE.TITLE; hide(pauseScreen); hide(overScreen); pauseBtn.hidden = true; obstacles.length = 0; orbs.length = 0; particles.length = 0; ghosts.length = 0; floaters.length = 0; speedLines.length = 0; clearInput(); bestScoreEl.textContent = run.best; show(titleScreen); }
  function toggleMute() { muted = !muted; try { localStorage.setItem(LS_MUTE, muted ? '1' : '0'); } catch {} reflectMute(); }
  function announce(msg) { announceEl.textContent = msg; }

  // DOM refs
  const titleScreen = document.getElementById('titleScreen');
  const overScreen = document.getElementById('overScreen');
  const pauseScreen = document.getElementById('pauseScreen');
  const againBtn = document.getElementById('againBtn');
  const menuBtn = document.getElementById('menuBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const quitBtn = document.getElementById('quitBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const muteBtn = document.getElementById('muteBtn');
  const bestScoreEl = document.getElementById('bestScore');
  const finalScoreEl = document.getElementById('finalScore');
  const overSubEl = document.getElementById('overSub');
  const newBestEl = document.getElementById('newBest');
  const announceEl = document.getElementById('announce');

  titleScreen.addEventListener('click', startRun);   // tap anywhere on the title to run
  againBtn.addEventListener('click', () => { if (canRestart()) startRun(); });
  menuBtn.addEventListener('click', quitToMenu);
  resumeBtn.addEventListener('click', resumeGame);
  quitBtn.addEventListener('click', quitToMenu);
  pauseBtn.addEventListener('click', pauseGame);
  muteBtn.addEventListener('click', toggleMute);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (gameState === STATE.PLAY) pauseGame(); }
    else { last = 0; acc = 0; }   // reset the frame clock so returning can't cause a dt-spike
  });
  // blur/backgrounding is exactly when a matching pointerup/keyup is most likely dropped
  window.addEventListener('blur', () => { if (gameState === STATE.PLAY) pauseGame(); else clearInput(); });

  // ─────────────────────────────── 14. Boot ─────────────────────────────────
  resize();
  initStars();
  loadPrefs();
  player.y = GY; player.supportY = GY;
  requestAnimationFrame(frame);
})();
