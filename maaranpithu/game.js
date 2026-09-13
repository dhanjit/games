/* Maaran Pithu — canvas shell. Reads the world from rules.js, never mutates it
 * except through step(). Fixed-timestep sim (1/120 s), render on rAF.
 * Field is drawn in yards → screen with a uniform scale that fits the viewport. */
import { createWorld, step, T } from './rules.js';

const HARNESS = location.search.includes('harness');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

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

// ── input ────────────────────────────────────────────────────────────────────
const keys = new Set();
const mouse = { x: T.fieldW / 2, y: T.fieldH / 2, throwEdge: false };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'r' && state !== 'title') startRound();
  if (e.key === 'Enter' && state === 'title') startRound();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointermove', (e) => { mouse.x = wx(e.clientX); mouse.y = wy(e.clientY); });
canvas.addEventListener('pointerdown', (e) => { mouse.x = wx(e.clientX); mouse.y = wy(e.clientY); mouse.throwEdge = true; });

function humanInput() {
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  const inp = { mx, my, aimX: mouse.x, aimY: mouse.y, throwEdge: mouse.throwEdge };
  mouse.throwEdge = false;
  return inp;
}

// ── state ────────────────────────────────────────────────────────────────────
let world = null, state = 'title';
let fx = [];         // transient visual effects {type, x, y, t, ttl, ...}
let msgUntil = 0;
const NBOTS = Number(new URLSearchParams(location.search).get('bots')) || 3;

function startRound() {
  world = createWorld({ nBots: NBOTS, seed: (Math.random() * 2 ** 32) >>> 0 });
  fx = []; state = 'play';
  $('titleScreen').classList.add('hidden'); $('overScreen').classList.add('hidden');
  setMsg('Get the ball!', 2);
}
function setMsg(s, secs) { $('msg').textContent = s; msgUntil = performance.now() + secs * 1000; }
$('playBtn').addEventListener('click', startRound);
$('againBtn').addEventListener('click', startRound);

function onEvents(evts) {
  for (const e of evts) {
    if (e.type === 'hit') {
      const p = world.players[e.id], by = world.players[e.by];
      fx.push({ type: 'pop', x: e.x, y: e.y, t: 0, ttl: 0.45 });
      setMsg(`${p.name} out${by ? ' — ' + by.name : ''}!`, 2.2);
      if (p.isHuman) endRound(false);
    }
    if (e.type === 'throw') { const p = world.players[e.id]; fx.push({ type: 'puff', x: p.x, y: p.y, t: 0, ttl: 0.3 }); }
    if (e.type === 'win') endRound(world.players[e.id]?.isHuman);
  }
}
function endRound(won) {
  if (state !== 'play') return;
  state = 'over';
  const me = world.players[0];
  $('overTitle').textContent = won ? 'Last one standing!' : 'Out!';
  $('overSub').textContent = won ? `${me.hits} hits.` : `Placed ${me.placement} of ${world.players.length}. ${me.hits} hits.`;
  setTimeout(() => { if (state === 'over') $('overScreen').classList.remove('hidden'); }, won ? 600 : 900);
}

// ── loop ─────────────────────────────────────────────────────────────────────
const DT = 1 / 120;
let last = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  let ft = Math.min((now - last) / 1000, 0.1); last = now;
  if (world && (state === 'play' || state === 'over')) {
    acc += ft;
    const inp = humanInput();
    while (acc >= DT) {
      const evts = step(world, DT, { 0: inp });
      inp.throwEdge = false;
      if (evts.length) onEvents(evts);
      acc -= DT;
    }
    for (const f of fx) f.t += ft; fx = fx.filter(f => f.t < f.ttl);
  }
  render(ft);
  if (performance.now() > msgUntil) $('msg').textContent = '';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = 0; acc = 0; } });
requestAnimationFrame(frame);

// ── render ───────────────────────────────────────────────────────────────────
function render() {
  const W = view.w, H = view.h;
  ctx.fillStyle = '#2f7d32'; ctx.fillRect(0, 0, W, H);
  // mown stripes over the whole viewport
  const stripe = 4 * view.scale;
  for (let x = view.ox % (stripe * 2) - stripe * 2, i = 0; x < W; x += stripe, i++) {
    ctx.fillStyle = i % 2 ? '#358a38' : '#2f7d32'; ctx.fillRect(x, 0, stripe + 1, H);
  }
  if (!world) return;
  // chalk field line
  ctx.strokeStyle = 'rgba(255,248,220,0.85)'; ctx.lineWidth = Math.max(2, 0.12 * view.scale);
  ctx.strokeRect(sx(0), sy(0), T.fieldW * view.scale, T.fieldH * view.scale);
  const B = world.bounds;
  if (B.x0 > 0 || B.y0 > 0 || B.x1 < T.fieldW || B.y1 < T.fieldH) {
    ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(255,210,63,0.9)';
    ctx.strokeRect(sx(B.x0), sy(B.y0), (B.x1 - B.x0) * view.scale, (B.y1 - B.y0) * view.scale);
    ctx.setLineDash([]);
  }
  const s = view.scale;
  // players (out ones dimmer), sorted by y so lower ones overlap
  const ps = [...world.players].sort((a, b) => a.y - b.y);
  for (const p of ps) drawKid(p, s);
  // ball
  const b = world.ball;
  if (b.state !== 'held') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx(b.x), sy(b.y) + 0.25 * s, 0.22 * s, 0.12 * s, 0, 0, Math.PI * 2); ctx.fill();
    const lift = b.state === 'flight' ? 0.5 * s : 0;
    ctx.fillStyle = '#e8ff3a'; ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y) - lift, Math.max(3, 0.2 * s), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c9dd1c'; ctx.lineWidth = 1; ctx.stroke();
  }
  // effects
  for (const f of fx) {
    const k = f.t / f.ttl;
    if (f.type === 'pop') {
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), (0.5 + k * 2.5) * s, 0, Math.PI * 2); ctx.stroke();
    } else if (f.type === 'puff') {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), (0.6 + k) * s, 0, Math.PI * 2); ctx.fill();
    }
  }
  // aim line when holding
  if (state === 'play' && b.state === 'held' && b.holder === 0) {
    const me = world.players[0];
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(me.x), sy(me.y)); ctx.lineTo(sx(mouse.x), sy(mouse.y)); ctx.stroke(); ctx.setLineDash([]);
  }
  $('alive').textContent = `${world.alive} in`;
}

function drawKid(p, s) {
  const x = sx(p.x), y = sy(p.y), r = p.r * s;
  const held = world.ball.state === 'held' && world.ball.holder === p.id;
  ctx.globalAlpha = p.out ? 0.45 : 1;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.35, r * 1.05, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // body (shirt) + head
  ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8b892'; ctx.beginPath(); ctx.arc(x, y - r * 0.55, r * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b1a10'; ctx.beginPath(); ctx.arc(x, y - r * 0.68, r * 0.45, Math.PI, Math.PI * 2); ctx.fill();
  // facing tick
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.facing.x * r * 1.2, y + p.facing.y * r * 1.2); ctx.stroke();
  if (held) {
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.stroke();
    const bx = x + p.facing.x * r * 1.4, by = y + p.facing.y * r * 1.4;
    ctx.fillStyle = '#e8ff3a'; ctx.beginPath(); ctx.arc(bx, by, Math.max(3, 0.2 * s), 0, Math.PI * 2); ctx.fill();
  }
  if (p.isHuman && !p.out) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, Math.PI * 2); ctx.stroke(); }
  // name
  ctx.globalAlpha = p.out ? 0.45 : 0.9;
  ctx.fillStyle = '#fffdf5'; ctx.font = `${Math.max(9, 0.55 * s)}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(p.name, x, y + r * 2.1);
  ctx.globalAlpha = 1;
}
