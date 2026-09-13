/* Maaran Pithu — canvas shell. Reads the world from rules.js and never mutates
 * it except through step(). Fixed-timestep sim (1/120 s), render on rAF.
 * Field is drawn in yards → screen with a uniform scale that fits the viewport. */
import { createWorld, step, scoreOf, T } from './rules.js';
import { sfx } from './audio.js';

const HARNESS = location.search.includes('harness');
const Q = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const META_KEY = 'maaranpithu.meta';

const view = { w: 0, h: 0, scale: 1, ox: 0, oy: 0 };
function resize() {
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
window.addEventListener('resize', resize);
resize();

// ── meta (best score) ────────────────────────────────────────────────────────
function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } }
function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ } }
let meta = loadMeta();

// ── input ────────────────────────────────────────────────────────────────────
const keys = new Set();
const mouse = { x: T.fieldW / 2, y: T.fieldH / 2, throwEdge: false, slideEdge: false };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  const k = e.key.toLowerCase();
  if (k === ' ' && !e.repeat) mouse.slideEdge = true;
  keys.add(k);
  if (k === 'r' && state !== 'title') startRound();
  if (e.key === 'Enter' && state === 'title') startRound();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
window.addEventListener('keydown', () => sfx.unlock(), { once: true });

// Touch: left half of the screen is a floating joystick (touch down = centre),
// right half is tap to throw/catch toward the tap, swipe to slide that way.
const touch = { stick: null, stickVec: { x: 0, y: 0 }, action: null, used: false };
const STICK_R = 48, SWIPE_PX = 28, TAP_MS = 260;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') { mouse.x = wx(e.clientX); mouse.y = wy(e.clientY); mouse.throwEdge = true; return; }
  touch.used = true;
  if (e.clientX < view.w / 2 && !touch.stick) { touch.stick = { id: e.pointerId, x: e.clientX, y: e.clientY }; touch.stickVec = { x: 0, y: 0 }; }
  else if (!touch.action) touch.action = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), swiped: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') { mouse.x = wx(e.clientX); mouse.y = wy(e.clientY); return; }
  if (touch.stick && e.pointerId === touch.stick.id) {
    let dx = e.clientX - touch.stick.x, dy = e.clientY - touch.stick.y; const d = Math.hypot(dx, dy);
    if (d > STICK_R) { touch.stick.x = e.clientX - dx / d * STICK_R; touch.stick.y = e.clientY - dy / d * STICK_R; dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
    const dead = 6; touch.stickVec = d < dead ? { x: 0, y: 0 } : { x: dx / STICK_R, y: dy / STICK_R };
  } else if (touch.action && e.pointerId === touch.action.id && !touch.action.swiped) {
    const dx = e.clientX - touch.action.x, dy = e.clientY - touch.action.y;
    if (Math.hypot(dx, dy) > SWIPE_PX) { touch.action.swiped = true; const d = Math.hypot(dx, dy); mouse.slideDir = { x: dx / d, y: dy / d }; mouse.slideEdge = true; }
  }
});
function endTouch(e) {
  if (e.pointerType === 'mouse') return;
  if (touch.stick && e.pointerId === touch.stick.id) { touch.stick = null; touch.stickVec = { x: 0, y: 0 }; }
  else if (touch.action && e.pointerId === touch.action.id) {
    const a = touch.action; touch.action = null;
    if (!a.swiped && performance.now() - a.t < TAP_MS) { mouse.x = wx(a.x); mouse.y = wy(a.y); mouse.throwEdge = true; }
  }
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
window.addEventListener('blur', () => { touch.stick = null; touch.action = null; touch.stickVec = { x: 0, y: 0 }; });

function humanInput() {
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (touch.stick) { mx = touch.stickVec.x; my = touch.stickVec.y; }
  // a swipe slides in the swipe direction even when the stick is idle
  if (mouse.slideEdge && mouse.slideDir && Math.hypot(mx, my) < 0.05) { mx = mouse.slideDir.x * 0.05; my = mouse.slideDir.y * 0.05; }
  const inp = { mx, my, aimX: mouse.x, aimY: mouse.y, throwEdge: mouse.throwEdge, slideEdge: mouse.slideEdge };
  mouse.throwEdge = false; mouse.slideEdge = false; mouse.slideDir = null;
  return inp;
}

// ── state ────────────────────────────────────────────────────────────────────
let world = null, state = 'title';
if (HARNESS) window.__mp = { world: () => world, state: () => state, touch: () => touch, view };
let fx = [];          // transient visuals {type, x, y, t, ttl, ...}
let hitStop = 0;      // seconds the sim is frozen for a catch/hit punch
let msgUntil = 0;
const NBOTS = Number(Q.get('bots')) || 19;
const HUMAN_BIAS = Number(Q.get('bias')) || 1;

function startRound() {
  world = createWorld({ nBots: NBOTS, humanBias: HUMAN_BIAS, seed: (Math.random() * 2 ** 32) >>> 0 });
  fx = []; hitStop = 0; state = 'play';
  $('titleScreen').classList.add('hidden'); $('overScreen').classList.add('hidden');
  setMsg('Get the ball!', 2);
}
function setMsg(s, secs) { $('msg').textContent = s; msgUntil = performance.now() + secs * 1000; }
$('playBtn').addEventListener('click', startRound);
$('againBtn').addEventListener('click', startRound);

function onEvents(evts) {
  for (const e of evts) {
    const p = e.id !== null && e.id !== undefined ? world.players[e.id] : null;
    const by = e.by !== null && e.by !== undefined ? world.players[e.by] : null;
    switch (e.type) {
      case 'hit':
        fx.push({ type: 'pop', x: e.x, y: e.y, t: 0, ttl: 0.45 });
        sfx.hit(); if (p.isHuman) sfx.out();
        hitStop = Math.max(hitStop, p.isHuman || by?.isHuman ? 0.09 : 0.03);
        setMsg(`${p.name} out${by ? ' — ' + by.name : ''}!`, 2.2);
        if (p.isHuman) endRound(false);
        break;
      case 'caught':
        fx.push({ type: 'flash', x: e.x, y: e.y, t: 0, ttl: 0.4 });
        sfx.catch();
        hitStop = Math.max(hitStop, p.isHuman ? 0.12 : 0.04);
        if (p.isHuman) setMsg('Caught!', 1.5); else if (by?.isHuman) setMsg(`${p.name} caught it!`, 1.5);
        break;
      case 'airgap':
        fx.push({ type: 'whistle', x: e.x, y: e.y, t: 0, ttl: 0.6 });
        sfx.whistle();
        if (p?.isHuman) setMsg('No air gap! Ball goes to them.', 2);
        break;
      case 'holding':
        sfx.whistle();
        if (p?.isHuman) setMsg('Holding! Ref takes the ball.', 2);
        break;
      case 'throw':
        fx.push({ type: 'puff', x: e.x, y: e.y, t: 0, ttl: 0.3 });
        if (p.isHuman || dist2(p, world.players[0]) < 400) sfx.throw();
        break;
      case 'slide':
        fx.push({ type: 'streak', x: e.x, y: e.y, dx: p.slideDir.x, dy: p.slideDir.y, t: 0, ttl: 1.4 });
        if (p.isHuman) sfx.slide();
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
  render();
  if (performance.now() > msgUntil) $('msg').textContent = '';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = 0; acc = 0; } });
requestAnimationFrame(frame);

// ── render ───────────────────────────────────────────────────────────────────
function render() {
  const W = view.w, H = view.h, s = view.scale;
  ctx.fillStyle = '#2f7d32'; ctx.fillRect(0, 0, W, H);
  const stripe = 4 * s;
  for (let x = view.ox % (stripe * 2) - stripe * 2, i = 0; x < W; x += stripe, i++) {
    ctx.fillStyle = i % 2 ? '#358a38' : '#2f7d32'; ctx.fillRect(x, 0, stripe + 1, H);
  }
  if (!world) return;
  // slide streaks go under everything
  for (const f of fx) if (f.type === 'streak') {
    const k = f.t / f.ttl;
    ctx.strokeStyle = `rgba(90,140,60,${0.55 * (1 - k)})`; ctx.lineWidth = 0.7 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.y)); ctx.lineTo(sx(f.x + f.dx * T.slideDist), sy(f.y + f.dy * T.slideDist)); ctx.stroke();
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
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx(b.x), sy(b.y) + 0.25 * s, 0.22 * s, 0.12 * s, 0, 0, Math.PI * 2); ctx.fill();
    const lift = b.state === 'flight' ? 0.5 * s : 0;
    if (b.state === 'flight') { // motion trail
      ctx.strokeStyle = 'rgba(232,255,58,0.45)'; ctx.lineWidth = 0.18 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(b.x - b.dir.x * 1.2), sy(b.y - b.dir.y * 1.2) - lift); ctx.lineTo(sx(b.x), sy(b.y) - lift); ctx.stroke();
    }
    ctx.fillStyle = '#e8ff3a'; ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y) - lift, Math.max(3, 0.2 * s), 0, Math.PI * 2); ctx.fill();
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
  // aim line when you hold the ball; catch hint when a ball is coming at you
  const me = world.players[0];
  if (state === 'play' && b.state === 'held' && b.holder === 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(me.x), sy(me.y)); ctx.lineTo(sx(mouse.x), sy(mouse.y)); ctx.stroke(); ctx.setLineDash([]);
    // holding-limit ring drains
    const k = b.heldFor / T.holdLimit;
    ctx.strokeStyle = k > 0.66 ? '#ff5050' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(me.x), sy(me.y), 1.9 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k)); ctx.stroke();
  }
  if (touch.stick) {
    const st = touch.stick;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(st.x, st.y, STICK_R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(st.x + touch.stickVec.x * STICK_R, st.y + touch.stickVec.y * STICK_R, 18, 0, Math.PI * 2); ctx.fill();
  }
  $('alive').textContent = `${world.alive} in`;
}

function drawRef(s) {
  const r = world.ref, x = sx(r.x), y = sy(r.y), R = 0.55 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + R * 0.35, R * 1.05, R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // black-and-white stripes
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
  for (let i = -3; i <= 3; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2f2f2'; ctx.fillRect(x + i * R * 0.34 - R * 0.17, y - R, R * 0.34, R * 2); }
  ctx.restore();
  ctx.fillStyle = '#e8b892'; ctx.beginPath(); ctx.arc(x, y - R * 0.55, R * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y - R * 0.68, R * 0.45, Math.PI, Math.PI * 2); ctx.fill();
  if (r.say) {
    ctx.font = `bold ${Math.max(11, 0.7 * s)}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
    const tw = ctx.measureText(r.say).width + 0.8 * s, th = 1.1 * s;
    const bx = Math.min(view.w - tw / 2 - 4, Math.max(tw / 2 + 4, x + 1.6 * s)), by = y - 2.4 * s;
    ctx.fillStyle = '#fffdf5'; roundRect(bx - tw / 2, by - th / 2, tw, th, 0.35 * s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx - 0.4 * s, by + th / 2); ctx.lineTo(x + 0.3 * s, y - R); ctx.lineTo(bx + 0.2 * s, by + th / 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.textBaseline = 'middle'; ctx.fillText(r.say, bx, by + 1); ctx.textBaseline = 'alphabetic';
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawKid(p, s) {
  const x = sx(p.x), y = sy(p.y), r = p.r * s;
  const held = world.ball.state === 'held' && world.ball.holder === p.id;
  ctx.globalAlpha = p.out ? 0.45 : 1;
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.35, r * 1.05, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  const squash = p.slideT > 0 ? 0.7 : 1;                     // sliding kids go low
  ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(x, y, r * (2 - squash), r * squash, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8b892'; ctx.beginPath(); ctx.arc(x, y - r * 0.55 * squash, r * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b1a10'; ctx.beginPath(); ctx.arc(x, y - r * 0.68 * squash, r * 0.45, Math.PI, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.facing.x * r * 1.2, y + p.facing.y * r * 1.2); ctx.stroke();
  if (p.stunT > 0 && !p.out) { // dazed stars
    ctx.fillStyle = '#ffd23f'; ctx.font = `${0.6 * s}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('✦ ✦', x, y - r * 1.9);
  }
  if (held) {
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.stroke();
    const bx = x + p.facing.x * r * 1.4, by = y + p.facing.y * r * 1.4;
    ctx.fillStyle = '#e8ff3a'; ctx.beginPath(); ctx.arc(bx, by, Math.max(3, 0.2 * s), 0, Math.PI * 2); ctx.fill();
  }
  if (p.isHuman && !p.out) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, Math.PI * 2); ctx.stroke();
    if (p.slideCd > 0) { // slide cooldown arc
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.slideCd / T.slideCooldown)); ctx.stroke();
    }
  }
  ctx.globalAlpha = p.out ? 0.45 : 0.9;
  ctx.fillStyle = '#fffdf5'; ctx.font = `${Math.max(9, 0.55 * s)}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(p.name, x, y + r * 2.1);
  ctx.globalAlpha = 1;
}
