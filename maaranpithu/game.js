/* Maaran Pithu — canvas shell. Reads the world from rules.js and never mutates
 * it except through step(). Fixed-timestep sim (1/120 s), render on rAF.
 * Field is drawn in yards → screen with a uniform scale that fits the viewport. */
import { createWorld, step, scoreOf, threat, T } from './rules.js';
import { sfx } from './audio.js';

const HARNESS = location.search.includes('harness');
const Q = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const mainCtx = canvas.getContext('2d');
// The draw helpers read these; drawScene() swaps them so the how-to demos render with the same code.
let ctx = mainCtx, hero = 0;
const $ = (id) => document.getElementById(id);
const META_KEY = 'maaranpithu.meta';

const mainView = { w: 0, h: 0, scale: 1, ox: 0, oy: 0 };
let view = mainView;
function resize() {
  const view = mainView, ctx = mainCtx;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.w = window.innerWidth; view.h = window.innerHeight;
  canvas.width = Math.round(view.w * dpr); canvas.height = Math.round(view.h * dpr);
  canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const margin = 3; // yards of grass around the field
  view.scale = Math.min(view.w / (T.fieldW + margin * 2), view.h / (T.fieldH + margin * 2));
  view.ox = (view.w - T.fieldW * view.scale) / 2;
  view.oy = (view.h - T.fieldH * view.scale) / 2;
}
const sx = (x) => view.ox + x * view.scale;
const sy = (y) => view.oy + y * view.scale;
const wx = (px) => (px - view.ox) / view.scale;
const wy = (py) => (py - view.oy) / view.scale;
window.addEventListener('resize', () => { resize(); if (state === 'howto') layoutDemos(); });
resize();

// ── meta (best score) ────────────────────────────────────────────────────────
function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } }
function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ } }
let meta = loadMeta();

// ── input ────────────────────────────────────────────────────────────────────
const keys = new Set();
const mouse = { x: T.fieldW / 2, y: T.fieldH / 2, throwEdge: false, lob: false, slideEdge: false, held: false };
// Throwing is press-and-release while you hold the ball: a flick is a line, a
// hold past LOB_MS is a lob (Shift lobs straight away). When you don't hold the
// ball the same held button braces instead, so the two never collide.
const LOB_MS = 200;
const charge = { active: false, t: 0 };
const iHoldBall = () => !!world && world.ball.state === 'held' && world.ball.holder === 0;
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  const k = e.key.toLowerCase();
  if (k === ' ' && !e.repeat) mouse.slideEdge = true;
  keys.add(k);
  if (k === 'r' && (state === 'play' || state === 'paused' || state === 'over')) startRound();
  if (e.key === 'Enter' && state === 'title') startRound();
  if (k === 'escape' || k === 'p') {
    if (state === 'play') pauseGame(); else if (state === 'paused') resumeGame(); else if (state === 'howto') closeHowto();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); if (state === 'play' && !HARNESS) pauseGame(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
window.addEventListener('keydown', () => sfx.unlock(), { once: true });

// Touch: left half of the screen is a floating joystick (touch down = centre),
// right half is tap to throw/catch toward the tap, swipe to slide that way.
const touch = { stick: null, stickVec: { x: 0, y: 0 }, action: null, used: false };
const STICK_R = 48, SWIPE_PX = 28, TAP_MS = 260;
function startCharge(t) { if (iHoldBall()) { charge.active = true; charge.t = t; } }
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') { mouse.x = wx(e.clientX); mouse.y = wy(e.clientY); mouse.held = true; startCharge(performance.now()); return; }
  touch.used = true;
  if (e.clientX < view.w / 2 && !touch.stick) { touch.stick = { id: e.pointerId, x: e.clientX, y: e.clientY }; touch.stickVec = { x: 0, y: 0 }; }
  else if (!touch.action) { touch.action = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), swiped: false }; startCharge(touch.action.t); }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') { mouse.x = wx(e.clientX); mouse.y = wy(e.clientY); return; }
  if (touch.stick && e.pointerId === touch.stick.id) {
    let dx = e.clientX - touch.stick.x, dy = e.clientY - touch.stick.y; const d = Math.hypot(dx, dy);
    if (d > STICK_R) { touch.stick.x = e.clientX - dx / d * STICK_R; touch.stick.y = e.clientY - dy / d * STICK_R; dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
    const dead = 6; touch.stickVec = d < dead ? { x: 0, y: 0 } : { x: dx / STICK_R, y: dy / STICK_R };
  } else if (touch.action && e.pointerId === touch.action.id && !touch.action.swiped && !charge.active) {
    const dx = e.clientX - touch.action.x, dy = e.clientY - touch.action.y;
    if (Math.hypot(dx, dy) > SWIPE_PX) { touch.action.swiped = true; const d = Math.hypot(dx, dy); mouse.slideDir = { x: dx / d, y: dy / d }; mouse.slideEdge = true; }
  }
});
// release a charged throw: short press = line, long press (or Shift) = lob
function release(x, y, since, shift) {
  mouse.x = wx(x); mouse.y = wy(y);
  mouse.throwEdge = true; mouse.lob = !!shift || performance.now() - since >= LOB_MS;
  charge.active = false;
}
function endTouch(e) {
  if (e.pointerType === 'mouse') {
    mouse.held = false;
    if (charge.active) release(e.clientX, e.clientY, charge.t, e.shiftKey);
    return;
  }
  if (touch.stick && e.pointerId === touch.stick.id) { touch.stick = null; touch.stickVec = { x: 0, y: 0 }; }
  else if (touch.action && e.pointerId === touch.action.id) {
    const a = touch.action; touch.action = null;
    if (charge.active) release(a.x, a.y, a.t, false);
    else if (!a.swiped && performance.now() - a.t < TAP_MS) { mouse.x = wx(a.x); mouse.y = wy(a.y); mouse.throwEdge = true; }
  }
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
window.addEventListener('blur', () => { touch.stick = null; touch.action = null; touch.stickVec = { x: 0, y: 0 }; mouse.held = false; charge.active = false; });

function humanInput() {
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (touch.stick) { mx = touch.stickVec.x; my = touch.stickVec.y; }
  // a swipe slides in the swipe direction even when the stick is idle
  if (mouse.slideEdge && mouse.slideDir && Math.hypot(mx, my) < 0.05) { mx = mouse.slideDir.x * 0.05; my = mouse.slideDir.y * 0.05; }
  // brace: mouse button or C held; on touch, a right-half finger held past a tap
  // (aim follows it). A held button is a throw charge instead when you hold the ball.
  let catchHold = (mouse.held && !charge.active) || keys.has('c');
  if (touch.action && !touch.action.swiped && !charge.active && performance.now() - touch.action.t >= TAP_MS) { catchHold = true; mouse.x = wx(touch.action.x); mouse.y = wy(touch.action.y); }
  const inp = { mx, my, aimX: mouse.x, aimY: mouse.y, throwEdge: mouse.throwEdge, lob: mouse.lob, slideEdge: mouse.slideEdge, catchHold };
  mouse.throwEdge = false; mouse.lob = false; mouse.slideEdge = false; mouse.slideDir = null;
  return inp;
}

// ── state ────────────────────────────────────────────────────────────────────
let world = null, state = 'title';
if (HARNESS) window.__mp = { world: () => world, state: () => state, touch: () => touch, mouse, charge, view };
let fx = [];          // transient visuals {type, x, y, t, ttl, ...}
let hitStop = 0;      // seconds the sim is frozen for a catch/hit punch
let msgUntil = 0;
const NBOTS = Number(Q.get('bots')) || 19;
const HUMAN_BIAS = Number(Q.get('bias')) || 1;

const OVERLAYS = ['titleScreen', 'overScreen', 'pauseScreen', 'howtoScreen'];
function showOverlay(id) { for (const o of OVERLAYS) $(o).classList.toggle('hidden', o !== id); $('pauseBtn').hidden = state !== 'play'; }
let howtoReturn = 'title';

function startRound() {
  world = createWorld({ nBots: NBOTS, humanBias: HUMAN_BIAS, seed: (Math.random() * 2 ** 32) >>> 0 });
  fx = []; hitStop = 0; state = 'play'; last = 0; acc = 0;
  showOverlay(null);
  setMsg('Get the ball!', 2);
}
function pauseGame() {
  if (state !== 'play') return;
  state = 'paused'; keys.clear(); mouse.held = false; charge.active = false; touch.stick = null; touch.action = null; touch.stickVec = { x: 0, y: 0 };
  showOverlay('pauseScreen');
}
function resumeGame() { if (state !== 'paused') return; state = 'play'; last = 0; acc = 0; showOverlay(null); }
function quitToMenu() { state = 'title'; world = null; fx = []; $('alive').textContent = ''; $('msg').textContent = ''; $('best').textContent = meta.bestScore ? `Best ${meta.bestScore}` : ''; showOverlay('titleScreen'); }
function openHowto() {
  if (state === 'play') { pauseGame(); }
  howtoReturn = state === 'paused' ? 'paused' : 'title';
  state = 'howto'; showOverlay('howtoScreen'); layoutDemos(); for (const d of demos) resetDemo(d);
}
function closeHowto() {
  if (state !== 'howto') return;
  state = howtoReturn; showOverlay(state === 'paused' ? 'pauseScreen' : 'titleScreen');
}
function setMsg(s, secs) { $('msg').textContent = s; msgUntil = performance.now() + secs * 1000; }
$('playBtn').addEventListener('click', startRound);
$('againBtn').addEventListener('click', startRound);
$('howtoBtn').addEventListener('click', openHowto);
$('howtoBackBtn').addEventListener('click', closeHowto);
$('pauseBtn').addEventListener('click', pauseGame);
$('resumeBtn').addEventListener('click', resumeGame);
$('pauseHowtoBtn').addEventListener('click', openHowto);
$('restartBtn').addEventListener('click', startRound);
$('quitBtn').addEventListener('click', quitToMenu);
$('overMenuBtn').addEventListener('click', quitToMenu);

// visual effect for an event, or null. Shared by the round and the how-to demos.
function fxFor(e, w) {
  const p = e.id !== null && e.id !== undefined ? w.players[e.id] : null;
  switch (e.type) {
    case 'hit': return { type: 'pop', x: e.x, y: e.y, t: 0, ttl: 0.45 };
    case 'caught': return { type: 'flash', x: e.x, y: e.y, t: 0, ttl: 0.4 };
    case 'airgap': return { type: 'whistle', x: e.x, y: e.y, t: 0, ttl: 0.6 };
    case 'throw': return { type: 'puff', x: e.x, y: e.y, t: 0, ttl: 0.3 };
    // grass dust where it lands; the first bounce is the one that kills the ball
    case 'bounce': return e.first || e.speed > 2.5 ? { type: 'puff', x: e.x, y: e.y, t: 0, ttl: e.first ? 0.4 : 0.25 } : null;
    case 'slide': return { type: 'streak', x: e.x, y: e.y, dx: p.slideDir.x, dy: p.slideDir.y, t: 0, ttl: 1.4 };
  }
  return null;
}
function onEvents(evts) {
  for (const e of evts) {
    const p = e.id !== null && e.id !== undefined ? world.players[e.id] : null;
    const by = e.by !== null && e.by !== undefined ? world.players[e.by] : null;
    const f = fxFor(e, world); if (f) fx.push(f);
    switch (e.type) {
      case 'hit':
        sfx.hit(); if (p.isHuman) sfx.out();
        hitStop = Math.max(hitStop, p.isHuman || by?.isHuman ? 0.09 : 0.03);
        setMsg(`${p.name} out${by ? ' — ' + by.name : ''}!`, 2.2);
        if (p.isHuman) endRound(false);
        break;
      case 'caught':
        sfx.catch();
        hitStop = Math.max(hitStop, p.isHuman ? 0.12 : 0.04);
        if (p.isHuman) setMsg('Caught!', 1.5); else if (by?.isHuman) setMsg(`${p.name} caught it!`, 1.5);
        break;
      case 'airgap':
        sfx.whistle();
        if (p?.isHuman) setMsg('No air gap! Ball goes to them.', 2);
        break;
      case 'holding':
        sfx.whistle();
        if (p?.isHuman) setMsg('Holding! Ref takes the ball.', 2);
        break;
      case 'throw':
        if (p.isHuman || dist2(p, world.players[0]) < 400) sfx.throw();
        break;
      case 'slide':
        if (p.isHuman) sfx.slide();
        break;
      case 'bounce':
        if (e.speed > 1.5) sfx.bounce(Math.min(1, e.speed / 6));
        // it only needs saying when it lands right by you — that is the one you feared
        if (e.first && dist2(e, world.players[0]) < 9) setMsg('Bounced — dead ball.', 1.2);
        break;
      case 'win':
        if (p?.isHuman) sfx.win();
        endRound(p?.isHuman);
        break;
    }
  }
}
function dist2(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
function endRound(won) {
  if (state !== 'play') return;
  state = 'over';
  const me = world.players[0];
  const score = scoreOf(world, me);
  const best = meta.bestScore || 0;
  const newBest = score > best;
  meta = { bestScore: Math.max(best, score), bestPlacement: Math.min(meta.bestPlacement || 99, me.placement), rounds: (meta.rounds || 0) + 1 };
  saveMeta(meta);
  $('overTitle').textContent = won ? 'Last one standing!' : 'Out!';
  $('overSub').innerHTML = `${won ? '' : `Placed <b>${me.placement}</b> of ${world.n}. `}${me.hits} hit${me.hits === 1 ? '' : 's'}, ${me.catches} catch${me.catches === 1 ? '' : 'es'}.<br>` +
    `Score <b>${score}</b>${newBest ? ' — new best!' : ` · best ${meta.bestScore}`}`;
  setTimeout(() => { if (state === 'over') $('overScreen').classList.remove('hidden'); }, won ? 600 : 900);
}
$('best').textContent = meta.bestScore ? `Best ${meta.bestScore}` : '';
const muteBtn = $('muteBtn');
function reflectMute() { muteBtn.textContent = sfx.enabled ? '♪' : '♪̸'; muteBtn.setAttribute('aria-pressed', String(!sfx.enabled)); muteBtn.style.opacity = sfx.enabled ? '1' : '0.5'; }
muteBtn.addEventListener('click', () => { sfx.setEnabled(!sfx.enabled); reflectMute(); });
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'm') { sfx.setEnabled(!sfx.enabled); reflectMute(); } });
reflectMute();
if ('serviceWorker' in navigator && !HARNESS && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline is a bonus, not a requirement */ }));
}

// ── loop ─────────────────────────────────────────────────────────────────────
const DT = 1 / 120;
let last = 0, acc = 0;
function frame(now) { requestAnimationFrame(frame); tick(now); }
// headless driving: rAF stops when the tab is hidden, so the harness ticks on a timer instead
if (HARNESS) setInterval(() => { if (document.hidden) tick(performance.now()); }, 16);
function tick(now) {
  if (!last) last = now;
  let ft = Math.min((now - last) / 1000, 0.1); last = now;
  rdt = ft;                       // wall clock for the render-only easings below
  if (world && (state === 'play' || state === 'over')) {
    const inp = humanInput();
    if (hitStop > 0) hitStop -= ft;
    else {
      acc += ft;
      while (acc >= DT) {
        const evts = step(world, DT, { 0: inp });
        inp.throwEdge = false; inp.slideEdge = false;
        if (evts.length) onEvents(evts);
        acc -= DT;
        if (hitStop > 0) break;
      }
    }
    for (const f of fx) f.t += ft; fx = fx.filter(f => f.t < f.ttl);
  }
  if (state === 'howto') { for (const d of demos) stepDemo(d, ft); }
  render();
  if (performance.now() > msgUntil) $('msg').textContent = '';
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (state === 'play' && !HARNESS) pauseGame(); }
  else { last = 0; acc = 0; }
});
requestAnimationFrame(frame);

// ── render ───────────────────────────────────────────────────────────────────
function render() {
  drawScene({ ctx: mainCtx, view: mainView, world, fx, hero: 0 });
  if (state === 'howto') for (const d of demos) drawScene(d);
  if (!world) return;
  const b = world.ball, s = view.scale;
  // aim line and holding-limit ring when you hold the ball
  const me = world.players[0];
  if (state === 'play' && b.state === 'held' && b.holder === 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(me.x), sy(me.y)); ctx.lineTo(sx(mouse.x), sy(mouse.y)); ctx.stroke(); ctx.setLineDash([]);
    const k = b.heldFor / T.holdLimit;
    ctx.strokeStyle = k > 0.66 ? '#ff5050' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(me.x), sy(me.y), 1.9 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k)); ctx.stroke();
    if (charge.active) {   // charge indicator: fills to LOB, then says so
      const c = Math.min(1, (performance.now() - charge.t) / LOB_MS), full = c >= 1;
      const bw = 2.4 * s, bh = 0.42 * s, bx = sx(me.x) - bw / 2, by = sy(me.y) - 2.6 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(bx, by, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = full ? '#ffd23f' : '#fffdf5'; roundRect(bx, by, bw * c, bh, bh / 2); ctx.fill();
      if (full) {
        ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'center';
        ctx.font = `bold ${Math.max(9, 0.5 * s)}px Trebuchet MS, sans-serif`;
        ctx.fillText('LOB', sx(me.x), by - 0.25 * s);
      }
    }
  }
  if (touch.stick) {
    const st = touch.stick;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(st.x, st.y, STICK_R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(st.x + touch.stickVec.x * STICK_R, st.y + touch.stickVec.y * STICK_R, 18, 0, Math.PI * 2); ctx.fill();
  }
  $('alive').textContent = `${world.alive} in`;
}

// Draw one scene (the round, or a how-to demo) into its canvas. Swaps the module
// draw targets for the duration so every helper below works unchanged.
function drawScene(scene) {
  const saved = { ctx, view, world, fx, hero };
  ({ ctx, view, world, fx, hero } = scene);
  try { drawField(); } finally { ({ ctx, view, world, fx, hero } = saved); }
}
function drawField() {
  const W = view.w, H = view.h, s = view.scale;
  ctx.fillStyle = '#2f7d32'; ctx.fillRect(0, 0, W, H);
  const stripe = 4 * s;
  for (let x = view.ox % (stripe * 2) - stripe * 2, i = 0; x < W; x += stripe, i++) {
    ctx.fillStyle = i % 2 ? '#358a38' : '#2f7d32'; ctx.fillRect(x, 0, stripe + 1, H);
  }
  if (!world) return;
  if (ctx === mainCtx) drawWear(s);      // worn paths sit above the stripes, under the chalk
  // slide streaks and their dust go under everything
  for (const f of fx) if (f.type === 'streak') {
    const k = f.t / f.ttl;
    ctx.strokeStyle = `rgba(90,140,60,${0.55 * (1 - k)})`; ctx.lineWidth = 0.7 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.y)); ctx.lineTo(sx(f.x + f.dx * T.slideDist), sy(f.y + f.dy * T.slideDist)); ctx.stroke();
    drawSlideDust(f, s);
  }
  // chalk field line + live boundary
  ctx.strokeStyle = 'rgba(255,248,220,0.8)'; ctx.lineWidth = Math.max(2, 0.12 * s);
  ctx.strokeRect(sx(0), sy(0), T.fieldW * s, T.fieldH * s);
  const B = world.bounds;
  if (B.x0 > 0.01 || B.y0 > 0.01 || B.x1 < T.fieldW - 0.01 || B.y1 < T.fieldH - 0.01) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(sx(0), sy(0), T.fieldW * s, (B.y0) * s); ctx.fillRect(sx(0), sy(B.y1), T.fieldW * s, (T.fieldH - B.y1) * s);
    ctx.fillRect(sx(0), sy(B.y0), B.x0 * s, (B.y1 - B.y0) * s); ctx.fillRect(sx(B.x1), sy(B.y0), (T.fieldW - B.x1) * s, (B.y1 - B.y0) * s);
    ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(255,210,63,0.9)';
    ctx.strokeRect(sx(B.x0), sy(B.y0), (B.x1 - B.x0) * s, (B.y1 - B.y0) * s);
    ctx.setLineDash([]);
  }
  drawRef(s);
  const ps = [...world.players].sort((a, b) => a.y - b.y);
  for (const p of ps) drawKid(p, s);
  const b = world.ball;
  if (b.state !== 'held') {
    // height reads as lift: the ball climbs off its shadow, which stays on the
    // grass and shrinks and fades as it gets further away underneath.
    const z = Math.max(0, b.z || 0), lift = z * s, k = Math.min(1, z / 2.6);
    ctx.fillStyle = `rgba(0,0,0,${0.26 - 0.1 * k})`;
    ctx.beginPath(); ctx.ellipse(sx(b.x), sy(b.y) + 0.25 * s, (0.22 - 0.06 * k) * s, (0.12 - 0.035 * k) * s, 0, 0, Math.PI * 2); ctx.fill();
    if (z > 0.4) {   // the tether says which shadow the ball belongs to
      ctx.strokeStyle = `rgba(0,0,0,${0.1 + 0.1 * k})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx(b.x), sy(b.y) + 0.25 * s); ctx.lineTo(sx(b.x), sy(b.y) - lift); ctx.stroke();
    }
    if (b.state === 'flight') { // motion trail, along the lifted path
      const tz = Math.max(0, z - b.vz * (1.2 / (Math.hypot(b.vx, b.vy) || 1)));
      ctx.strokeStyle = 'rgba(232,255,58,0.45)'; ctx.lineWidth = 0.18 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(b.x - b.dir.x * 1.2), sy(b.y - b.dir.y * 1.2) - tz * s); ctx.lineTo(sx(b.x), sy(b.y) - lift); ctx.stroke();
    }
    if (b.state === 'flight' && incomingTo(world.players[hero])) {   // the catch tell
      const p = 0.5 + 0.5 * Math.sin(performance.now() / 60);
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.25 * p})`; ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y) - lift, (0.6 + 0.2 * p) * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = b.state === 'flight' ? '#e8ff3a' : '#cbd88f';   // a dead ball is a duller yellow
    ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y) - lift, Math.max(3, (0.2 + 0.03 * k) * s), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c9dd1c'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const f of fx) {
    const k = f.t / f.ttl;
    if (f.type === 'pop') {
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), (0.5 + k * 2.5) * s, 0, Math.PI * 2); ctx.stroke();
    } else if (f.type === 'flash') {
      ctx.fillStyle = `rgba(255,210,63,${0.7 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), (0.8 + k * 1.6) * s, 0, Math.PI * 2); ctx.fill();
    } else if (f.type === 'puff') {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), (0.6 + k) * s, 0, Math.PI * 2); ctx.fill();
    } else if (f.type === 'whistle') {
      ctx.fillStyle = `rgba(255,80,80,${1 - k})`; ctx.font = `bold ${0.9 * s}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('✕', sx(f.x), sy(f.y) - (0.5 + k * 1.5) * s);
    }
  }
}

// is the live ball going to arrive at this player low enough to hit? Same arc
// reading the bots use, so the tell never lies about a lob going overhead.
function incomingTo(me) { return !!threat(world, me); }

// ── kid animation (render-only) ──────────────────────────────────────────────
// Nothing here is written back to the world: rules.js stays the only thing that
// moves a kid. State is keyed by world identity first (the how-to demos are their
// own two-kid worlds and reuse ids 0/1) and then by player id, so a new round —
// a new world from startRound() — starts clean and the old state is collected.
const animStore = new WeakMap();
const TWO_PI = Math.PI * 2;
const STRIDE_YD = 1.15;       // ground covered per full stride cycle
const THROW_POSE = 0.25;      // s of whip-forward after a release
const CLUTCH = 0.22;          // s of hugging the ball in after taking it
const DUST_LIFE = 0.55;
const SKIN = '#e8b892', LIMB = '#d79c74', HAIR = '#2b1a10', SHOE = '#3b2b1c';
let rdt = 0;
const reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let MOTION = reduceMQ && reduceMQ.matches ? 0.3 : 1;   // damps the bob and the dust, never the poses
reduceMQ?.addEventListener?.('change', (e) => { MOTION = e.matches ? 0.3 : 1; });

function animOf(w, key) {
  let m = animStore.get(w);
  if (!m) { m = new Map(); animStore.set(w, m); }
  let a = m.get(key);
  if (!a) {
    a = { px: null, py: null, phase: (typeof key === 'number' ? key * 2.4 : 0) % TWO_PI, spd: 0,
      lx: 1, ly: 0, throwT: 0, tx: 1, ty: 0, seenThrow: -1, sit: 0, dAcc: 0, tAcc: 0 };
    m.set(key, a);
  }
  return a;
}
function blob(X, Y, rr, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, rr, 0, TWO_PI); ctx.fill(); }
function limb(X0, Y0, X1, Y1, wd, col) {
  ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
}

// ── grass wear ───────────────────────────────────────────────────────────────
// A 2 px-per-yard mask stamped where feet fall, drawn back scaled up (and so
// blurred) under the chalk line. Alpha saturates, and the draw caps it at
// WEAR_MAX, so a busy patch goes worn, never black. Main scene only — the demos
// are 3 s loops in tiny worlds with nothing to wear.
const WEAR_PPY = 2, WEAR_MAX = 0.17;
let wearCv = null, wearCtx = null, wearWorld = null;
function drawWear(s) {
  if (!wearCv) {
    wearCv = document.createElement('canvas');
    wearCv.width = Math.round(T.fieldW * WEAR_PPY); wearCv.height = Math.round(T.fieldH * WEAR_PPY);
    wearCtx = wearCv.getContext('2d');
    wearCtx.fillStyle = 'rgba(58,44,18,0.014)';
  }
  if (wearWorld !== world) { wearCtx.clearRect(0, 0, wearCv.width, wearCv.height); wearWorld = world; }
  if (state === 'play') for (const p of world.players) {
    if (p.out && parked(p)) continue;                       // nobody wears grass sitting down
    // both feet live inside a yard of the centre, which is two pixels here
    wearCtx.fillRect(p.x * WEAR_PPY - 1.1, p.y * WEAR_PPY - 0.8, 2.2, 1.6);
  }
  ctx.globalAlpha = WEAR_MAX;
  ctx.drawImage(wearCv, sx(0), sy(0), T.fieldW * s, T.fieldH * s);
  ctx.globalAlpha = 1;
}
const parked = (p) => !!p.outTarget && Math.abs(p.outTarget.x - p.x) + Math.abs(p.outTarget.y - p.y) < 0.3;

// dust and grass flecks kicked up by a slide, derived from the streak's own age
// so nothing is spawned per frame. Jitter comes off a fixed table, not rng.
const DUST_J = [0.31, -0.42, 0.18, -0.25, 0.47, -0.12, 0.05, 0.36];
function drawSlideDust(f, s) {
  const n = MOTION < 1 ? 3 : 6;
  for (let i = 0; i < n; i++) {
    const age = f.t - (i + 0.5) / n * T.slideTime;
    if (age < 0 || age > DUST_LIFE) continue;
    const q = age / DUST_LIFE, along = T.slideDist * ((i + 0.5) / n);
    const jx = DUST_J[i & 7] * 0.7, jy = DUST_J[(i * 3 + 1) & 7] * 0.7;
    const X = sx(f.x + f.dx * along + jx), Y = sy(f.y + f.dy * along + jy) - q * 0.4 * s * MOTION;
    ctx.fillStyle = i % 2 ? `rgba(216,204,164,${0.5 * (1 - q)})` : `rgba(118,158,72,${0.5 * (1 - q)})`;
    ctx.beginPath(); ctx.arc(X, Y, (0.28 + 0.7 * q) * s, 0, TWO_PI); ctx.fill();
  }
}

function drawRef(s) {
  const r = world.ref, a = animOf(world, 'ref'), x = sx(r.x), y = sy(r.y), R = 0.55 * s;
  if (a.px === null) { a.px = r.x; a.py = r.y; }
  const dx = r.x - a.px, dy = r.y - a.py; a.px = r.x; a.py = r.y;
  const moved = Math.hypot(dx, dy);
  a.phase = (a.phase + moved * (TWO_PI / 1.1)) % TWO_PI;    // jogs the sideline with the ball
  a.dAcc += moved; a.tAcc += rdt;                            // ground per second, over a window:
  if (a.tAcc >= 0.1) { a.spd = a.dAcc / a.tAcc; a.dAcc = 0; a.tAcc = 0; }   // a single frame may have no sim step in it
  const pace = Math.min(1, a.spd / 4), gait = Math.sin(a.phase);
  const bob = (0.5 - 0.5 * Math.cos(a.phase * 2)) * R * 0.18 * pace * MOTION;
  const by = y - bob;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + R * 0.35, R * 1.05 - bob * 0.3, R * 0.5, 0, 0, TWO_PI); ctx.fill();
  for (let k = -1; k <= 1; k += 2) {
    const fx2 = x + gait * k * R * (0.15 + 0.5 * pace) + k * R * 0.3;
    blob(fx2, y + R * 0.5 - Math.max(0, gait * k) * R * 0.14 * pace * MOTION, R * 0.2, '#1a1a1a');
  }
  // black-and-white stripes
  ctx.save(); ctx.beginPath(); ctx.arc(x, by, R, 0, TWO_PI); ctx.clip();
  for (let i = -3; i <= 3; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2f2f2'; ctx.fillRect(x + i * R * 0.34 - R * 0.17, by - R, R * 0.34, R * 2); }
  ctx.restore();
  blob(x, by - R * 0.55, R * 0.5, SKIN);
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, by - R * 0.68, R * 0.45, Math.PI, TWO_PI); ctx.fill();
  if (r.say) {   // a call: one arm up, the whistle at the mouth, for as long as the bubble is up
    const ux = x + R * 1.15, uy = by - R * 1.35;
    limb(x + R * 0.5, by - R * 0.15, ux, uy, R * 0.26, LIMB); blob(ux, uy, R * 0.2, LIMB);
    const wx2 = x - R * 0.38, wy2 = by - R * 0.42;
    limb(x - R * 0.55, by, wx2, wy2, R * 0.26, LIMB); blob(wx2, wy2, R * 0.18, LIMB);
    blob(wx2 + R * 0.16, wy2 - R * 0.04, R * 0.12, '#dcdcdc');
    ctx.font = `bold ${Math.max(11, 0.7 * s)}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
    const tw = ctx.measureText(r.say).width + 0.8 * s, th = 1.1 * s;
    const bx = Math.min(view.w - tw / 2 - 4, Math.max(tw / 2 + 4, x + 1.6 * s)), byy = y - 2.4 * s;
    ctx.fillStyle = '#fffdf5'; roundRect(bx - tw / 2, byy - th / 2, tw, th, 0.35 * s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx - 0.4 * s, byy + th / 2); ctx.lineTo(x + 0.3 * s, y - R); ctx.lineTo(bx + 0.2 * s, byy + th / 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.textBaseline = 'middle'; ctx.fillText(r.say, bx, byy + 1); ctx.textBaseline = 'alphabetic';
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawKid(p, s) {
  const b = world.ball, a = animOf(world, p.id), r = p.r * s;
  const x = sx(p.x), y = sy(p.y);
  const held = b.state === 'held' && b.holder === p.id;
  if (a.px === null) { a.px = p.x; a.py = p.y; a.lx = p.facing.x; a.ly = p.facing.y; }

  // Stride phase advances with ground covered rather than with time, so a sprint
  // and a ball-holder's 1.5 yd/s shuffle read as different gaits for free.
  const dx = p.x - a.px, dy = p.y - a.py; a.px = p.x; a.py = p.y;
  const moved = Math.hypot(dx, dy);
  a.phase = (a.phase + moved * (TWO_PI / STRIDE_YD)) % TWO_PI;
  a.spd += (Math.hypot(p.vx, p.vy) - a.spd) * Math.min(1, rdt * 16);
  const pace = Math.min(1, a.spd / T.moveSpeed), gait = Math.sin(a.phase);
  const hx = p.facing.x, hy = p.facing.y, qx = -hy, qy = hx;      // facing, and the kid's right side
  let mx = hx, my = hy;
  if (moved > 1e-4) { mx = dx / moved; my = dy / moved; }         // feet travel where the body does
  const nx = -my, ny = mx;

  // a release latches the whip-forward pose: the ball can hit someone before it plays out
  if (b.thrownAt !== a.seenThrow && b.thrower === p.id) { a.seenThrow = b.thrownAt; a.throwT = THROW_POSE; a.tx = b.dir.x; a.ty = b.dir.y; }
  a.throwT = Math.max(0, a.throwT - rdt);
  const thr = a.throwT / THROW_POSE;
  const clutch = held && b.heldFor < CLUTCH ? 1 - b.heldFor / CLUTCH : 0;
  const brace = p.bracing ? 1 : 0, slid = p.slideT > 0 ? 1 : 0;

  // the head turns toward a ball in flight, lerped so it never snaps. Render only:
  // p.facing belongs to the sim and decides catches.
  let lx = hx, ly = hy;
  if (b.state === 'flight') { const ex = b.x - p.x, ey = b.y - p.y, d = Math.hypot(ex, ey) || 1; lx = ex / d; ly = ey / d; }
  const kl = 1 - Math.exp(-rdt * 9);
  a.lx += (lx - a.lx) * kl; a.ly += (ly - a.ly) * kl;
  const ll = Math.hypot(a.lx, a.ly) || 1, gx = a.lx / ll, gy = a.ly / ll;

  // out kids walk off, then sit down on the sideline facing the game
  a.sit += ((p.out && parked(p) ? 1 : 0) - a.sit) * Math.min(1, rdt * 5);
  const sit = a.sit;
  let tx = mx, ty = my;
  if (sit > 0.01) { const ex = world.field.w / 2 - p.x, ey = world.field.h / 2 - p.y, d = Math.hypot(ex, ey) || 1; tx = ex / d; ty = ey / d; }

  const squash = slid ? 0.7 : 1;
  const bob = (0.5 - 0.5 * Math.cos(a.phase * 2)) * r * 0.22 * pace * MOTION * (1 - sit) * (1 - slid);
  const by = y - bob + r * 0.5 * sit;                              // body centre, bobbing over the ground

  ctx.globalAlpha = p.out ? 0.45 - 0.1 * sit : 1;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.35, r * 1.05 - bob * 0.3, r * 0.5 - bob * 0.15, 0, 0, TWO_PI); ctx.fill();

  // legs: alternating along the travel axis, planted wide to brace, stretched out to sit
  const stride = r * (0.3 + 1.25 * pace) * (1 - brace) * (1 - sit) * (1 - slid);
  const spread = r * (0.4 + 0.45 * brace + 0.25 * slid);
  for (let i = 0; i < 2; i++) {
    const sg = i ? -1 : 1, ph = gait * sg, reach = r * (0.55 + 1.2 * sit);
    const hipx = x + nx * spread * 0.5 * sg, hipy = by + ny * spread * 0.5 * sg + r * 0.15;
    const footx = x + nx * spread * sg + mx * stride * ph + tx * reach * sit - hx * r * 0.25 * brace;
    const footy = y + ny * spread * sg + my * stride * ph + ty * reach * sit - hy * r * 0.25 * brace
      + r * 0.34 * (1 - sit) - Math.max(0, ph) * r * 0.16 * pace * MOTION;
    limb(hipx, hipy, footx, footy, r * 0.3, LIMB);
    blob(footx, footy, r * 0.22, SHOE);
  }

  // arms, drawn under the shirt so only what reaches past it shows: swinging,
  // both out to brace, hugged in on a catch, cocked back while holding the ball,
  // whipping through toward b.dir on a throw
  const shx = x + qx * r * 0.7, shy = by + qy * r * 0.7, s2x = x - qx * r * 0.7, s2y = by - qy * r * 0.7;
  const swing = r * (0.35 + 0.9 * pace) * (1 - sit * 0.6);
  let h1x, h1y, h2x, h2y, ballx = 0, bally = 0;
  if (thr > 0) {
    const reach = r * (1.2 + 0.8 * thr);
    h1x = x + a.tx * reach + qx * r * 0.25; h1y = by + a.ty * reach + qy * r * 0.25;
    h2x = x - a.tx * r * 0.4 - qx * r * 0.9; h2y = by - a.ty * r * 0.4 - qy * r * 0.9;
  } else if (clutch > 0) {                          // pulled in around the ball
    const pull = r * (1.3 - 0.35 * clutch);
    h1x = x + hx * pull + qx * r * 0.4; h1y = by + hy * pull + qy * r * 0.4;
    h2x = x + hx * pull - qx * r * 0.4; h2y = by + hy * pull - qy * r * 0.4;
    ballx = x + hx * r * (0.9 - 0.5 * clutch); bally = by + hy * r * (0.9 - 0.5 * clutch);
  } else if (held) {
    const cock = Math.min(1, b.heldFor / 0.8);      // a wind-up while the thrower settles
    h1x = x + hx * r * (0.3 - 0.9 * cock) + qx * r * (1 + 0.35 * cock);
    h1y = by + hy * r * (0.3 - 0.9 * cock) + qy * r * (1 + 0.35 * cock);
    h2x = x + hx * r * 0.9 - qx * r * 0.7; h2y = by + hy * r * 0.9 - qy * r * 0.7;
    ballx = h1x; bally = h1y;
  } else if (brace) {
    h1x = x + hx * r * 1.35 + qx * r * 0.6; h1y = by + hy * r * 1.35 + qy * r * 0.6;
    h2x = x + hx * r * 1.35 - qx * r * 0.6; h2y = by + hy * r * 1.35 - qy * r * 0.6;
  } else {
    h1x = shx - mx * swing * gait + qx * r * 0.3; h1y = shy - my * swing * gait + qy * r * 0.3;
    h2x = s2x + mx * swing * gait - qx * r * 0.3; h2y = s2y + my * swing * gait - qy * r * 0.3;
  }
  limb(shx, shy, h1x, h1y, r * 0.26, LIMB); blob(h1x, h1y, r * 0.2, LIMB);
  limb(s2x, s2y, h2x, h2y, r * 0.26, LIMB); blob(h2x, h2y, r * 0.2, LIMB);

  // body: sliding kids go low and stretch along the slide, seated kids slump wide
  ctx.fillStyle = p.color; ctx.beginPath();
  ctx.ellipse(x, by, r * (2 - squash) * (1 + 0.2 * sit), r * squash * (1 - 0.2 * sit),
    slid ? Math.atan2(p.slideDir.y, p.slideDir.x) : 0, 0, TWO_PI); ctx.fill();
  limb(x + hx * r * 0.5, by + hy * r * 0.5, x + hx * r * 1.15, by + hy * r * 1.15, 2, 'rgba(0,0,0,0.35)');   // facing tick

  // head, turned toward whatever the kid is watching; the hair sits at the back of it
  blob(x + gx * r * 0.22, by - r * 0.55 * squash + gy * r * 0.22, r * 0.5, SKIN);
  ctx.fillStyle = HAIR; ctx.beginPath();
  ctx.arc(x + gx * r * 0.14, by - r * 0.68 * squash + gy * r * 0.14, r * 0.45, Math.PI, TWO_PI); ctx.fill();

  if (held) {
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TWO_PI); ctx.stroke();
    ctx.fillStyle = '#e8ff3a'; ctx.beginPath(); ctx.arc(ballx, bally, Math.max(3, 0.2 * s), 0, TWO_PI); ctx.fill();
  }
  if (p.stunT > 0 && !p.out) { // dazed stars
    ctx.fillStyle = '#ffd23f'; ctx.font = `${0.6 * s}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('✦ ✦', x, by - r * 1.9);
  }
  if (p.bracing) {   // catch cone, drawn for anyone bracing
    const a0 = Math.atan2(p.facing.y, p.facing.x), c = T.catchCone * Math.PI / 180;
    ctx.fillStyle = p.id === hero ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r * 3.2, a0 - c, a0 + c); ctx.closePath(); ctx.fill();
  }
  if (p.id === hero && !p.out) {   // the ring marks you
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, TWO_PI); ctx.stroke();
    if (p.slideCd > 0) { // slide cooldown arc
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TWO_PI * (1 - p.slideCd / T.slideCooldown)); ctx.stroke();
    }
  }
  ctx.globalAlpha = p.out ? 0.45 - 0.1 * sit : 0.9;
  ctx.fillStyle = '#fffdf5'; ctx.font = `${Math.max(9, 0.55 * s)}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(p.name, x, y + r * 2.1);
  ctx.globalAlpha = 1;
}

// ── how-to-play demos ────────────────────────────────────────────────────────
// Each demo is a real two-kid world from rules.js driven by a script, drawn with
// the same code as the round, looping every few seconds at half speed. A demo
// can't show a rule the sim doesn't have.
const DEMO_SPEED = 0.55, DEMO_WIN = { w: 12, h: 8, cx: 26, cy: 20 };
const crossed = (t, tp, at) => tp < at && t >= at;
const DEMO_DEFS = [
  { id: 'throw', loop: 2.6, hero: 0, ay: 20, by: 20,
    script: (w, t, tp, d) => ({ 0: { aimX: w.players[1].x, aimY: w.players[1].y, throwEdge: crossed(t, tp, 0.8) } }) },
  { id: 'catch', loop: 2.8, hero: 1, ay: 20, by: 20,
    script: (w, t, tp, d) => ({ 0: { aimX: w.players[1].x, aimY: w.players[1].y, throwEdge: crossed(t, tp, 0.8) },
                                 1: { catchHold: t > 0.35, aimX: w.players[0].x, aimY: w.players[0].y } }) },
  { id: 'slide', loop: 3.0, hero: 1, ay: 21, by: 21,
    script: (w, t, tp, d) => {
      const b = w.ball, me = w.players[1];
      const go = b.state === 'flight' && !d.slid && Math.hypot(b.x - me.x, b.y - me.y) < 4.5;
      if (go) d.slid = true;
      return { 0: { aimX: 30, aimY: 21, throwEdge: crossed(t, tp, 0.8) }, 1: go ? { my: -1, slideEdge: true } : {} };
    } },
  { id: 'airgap', loop: 2.6, hero: 0, ax: 24, bx: 26.6, ay: 20.5, by: 20.5, refY: 18.6,
    script: (w, t, tp, d) => ({ 0: { aimX: w.players[1].x, aimY: w.players[1].y, throwEdge: crossed(t, tp, 0.8) } }) },
  // the lob needs a long window: it clears the kid in front and lands 23 yd out
  { id: 'lob', loop: 2.5, hero: 1, ax: 12, bx: 18, ay: 20, by: 20, win: { w: 32, h: 12, cx: 26, cy: 20 },
    script: (w, t, tp, d) => ({ 0: { aimX: w.players[1].x, aimY: w.players[1].y, throwEdge: crossed(t, tp, 0.5), lob: true } }) },
];
const demos = DEMO_DEFS.map((def) => {
  const canvas = document.getElementById('demo-' + def.id);
  return { def, canvas, ctx: canvas.getContext('2d'), view: { w: 0, h: 0, scale: 1, ox: 0, oy: 0 }, world: null, fx: [], hero: def.hero, t: 0, acc: 0, slid: false };
});
function resetDemo(d) {
  const def = d.def, w = createWorld({ humans: 2, nBots: 0, seed: 1 });
  const [a, b] = w.players;
  a.name = 'Riju'; a.color = '#f4a261'; b.name = 'Momi'; b.color = '#2a9d8f';
  a.x = def.ax ?? 22; a.y = def.ay; b.x = def.bx ?? 30; b.y = def.by;
  a.facing = { x: 1, y: 0 }; b.facing = { x: -1, y: 0 };
  w.ball.x = a.x; w.ball.y = a.y;               // picked up on the first step
  if (def.refY !== undefined) w.ref.y = def.refY;
  d.world = w; d.fx = []; d.t = 0; d.acc = 0; d.slid = false;
}
function stepDemo(d, ft) {
  if (!d.world) resetDemo(d);
  d.acc += ft * DEMO_SPEED;
  while (d.acc >= DT) {
    const tp = d.t; d.t += DT;
    if (d.t >= d.def.loop) { resetDemo(d); break; }
    const evts = step(d.world, DT, d.def.script(d.world, d.t, tp, d));
    for (const e of evts) { const f = fxFor(e, d.world); if (f) d.fx.push(f); }
    d.acc -= DT;
  }
  for (const f of d.fx) f.t += ft * DEMO_SPEED; d.fx = d.fx.filter(f => f.t < f.ttl);
}
function layoutDemos() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  for (const d of demos) {
    const win = d.def.win || DEMO_WIN;
    const cssW = d.canvas.clientWidth || 280, cssH = Math.round(cssW * win.h / win.w);
    d.canvas.width = Math.round(cssW * dpr); d.canvas.height = Math.round(cssH * dpr);
    d.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = d.view; v.w = cssW; v.h = cssH; v.scale = cssW / win.w;
    v.ox = -(win.cx - win.w / 2) * v.scale; v.oy = -(win.cy - win.h / 2) * v.scale;
  }
}
