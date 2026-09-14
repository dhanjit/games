/* handslam — renderer. Reads the world, never writes to it except via step().
 * Portrait phone first: the human always sits at 6 o'clock and the desk fills
 * the width. Every pixel number lives here; rules.js knows only seconds. */

import { createWorld, step, zoneOf, T } from './rules.js';

const HARNESS = new URLSearchParams(location.search).has('harness');
const canvas = document.getElementById('desk');
const ctx = canvas.getContext('2d');

let w = createWorld({ humans: 1, nBots: 1, seed: (Date.now() & 0xffff) || 1 });
let view = { w: 0, h: 0, cx: 0, cy: 0, rx: 0, ry: 0, dpr: 1 };
let deskLayer = null;

// ── layout ───────────────────────────────────────────────────────────────────
// Seat 0 (the human) is at 6 o'clock; the rest run clockwise from there.
function seatAngle(i, n) { return Math.PI / 2 + (i / n) * Math.PI * 2; }

/** Where a seat's arm enters the desk, and where its fist strikes. */
function seatGeom(i) {
  const a = seatAngle(i, w.n);
  return {
    edgeX: view.cx + Math.cos(a) * view.rx,
    edgeY: view.cy + Math.sin(a) * view.ry,
    spotX: view.cx + Math.cos(a) * view.rx * 0.42,
    spotY: view.cy + Math.sin(a) * view.ry * 0.42,
    a,
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;
  view = {
    w: cssW, h: cssH, dpr,
    cx: cssW / 2, cy: cssH / 2,
    rx: Math.min(cssW * 0.44, cssH * 0.34),
    ry: Math.min(cssW * 0.44, cssH * 0.34) * 0.82,
  };
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  deskLayer = null;                      // the static layer must be re-baked
}

// ── the static desk, baked once ──────────────────────────────────────────────
function bakeDesk() {
  const c = document.createElement('canvas');
  c.width = Math.round(view.w * view.dpr);
  c.height = Math.round(view.h * view.dpr);
  const g = c.getContext('2d');
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  g.fillStyle = '#17171b';
  g.fillRect(0, 0, view.w, view.h);

  g.save();
  g.translate(view.cx, view.cy);
  g.scale(1, view.ry / view.rx);
  g.beginPath(); g.arc(0, 0, view.rx, 0, Math.PI * 2);
  g.fillStyle = '#8a5a2b'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#6d4520'; g.stroke();
  g.restore();

  // grain
  g.save();
  g.globalAlpha = 0.10; g.strokeStyle = '#3a2410'; g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = view.cy - view.ry + (i / 26) * view.ry * 2;
    g.beginPath(); g.moveTo(view.cx - view.rx, y);
    g.bezierCurveTo(view.cx - view.rx / 3, y + 3, view.cx + view.rx / 3, y - 3, view.cx + view.rx, y);
    g.stroke();
  }
  g.restore();

  // each seat's strike spot — a chalk ring the player learns to read
  for (let i = 0; i < w.n; i++) {
    const s = seatGeom(i);
    g.beginPath(); g.arc(s.spotX, s.spotY, 15, 0, Math.PI * 2);
    g.setLineDash([4, 4]); g.lineWidth = 2;
    g.strokeStyle = 'rgba(243,239,230,0.6)'; g.stroke();
    g.setLineDash([]);
  }
  return c;
}

// ── the moving parts ─────────────────────────────────────────────────────────
// The hand ellipse's half-axes along/across the retreat axis. retreatPx is
// derived from the rule (not guessed): it's exactly how far the hand's near
// edge must travel to clear T.handGrace, so the picture stays in lockstep
// with zoneOf(p.hand.p) at every p, not just at the endpoints. Retuning
// handGrace in rules.js moves this geometry with it.
const HAND_RX = 17, HAND_RY = 13;
const retreatPx = HAND_RX / T.handGrace;   // ≈ 37.8px
const wristLen = retreatPx - HAND_RX;      // ≈ 20.8px

function drawHand(p) {
  const s = seatGeom(p.seat);

  // unit vector along the retreat axis, from the spot toward this seat's edge
  const ax = s.edgeX - s.spotX, ay = s.edgeY - s.spotY;
  const alen = Math.hypot(ax, ay) || 1;
  const ux = ax / alen, uy = ay / alen;

  // p.hand.p slides the hand from the spot toward the edge, capped at
  // retreatPx — not all the way to the edge.
  const d = p.hand.p * retreatPx;
  const hx = s.spotX + ux * d, hy = s.spotY + uy * d;

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d8a06a';               // the forearm
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.moveTo(s.edgeX, s.edgeY); ctx.lineTo(hx, hy); ctx.stroke();

  // the wrist band: a fixed wristLen segment trailing the hand's near edge.
  // Drawn only while zoneOf agrees it's there, so it covers the spot exactly
  // when handGrace < p < 1 and never bleeds into the 'hand' or 'desk' zones.
  if (zoneOf(p.hand.p) === 'wrist') {
    const nx = s.spotX + ux * (d - HAND_RX), ny = s.spotY + uy * (d - HAND_RX);
    const fx = s.spotX + ux * (d - retreatPx), fy = s.spotY + uy * (d - retreatPx);
    ctx.strokeStyle = '#8a6b52';             // visibly distinct from forearm and hand
    ctx.lineWidth = 18;
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.lineCap = 'round';
  }

  ctx.fillStyle = p.hand.pinned ? '#c2603f' : '#eab98a';   // the back of the hand — flat, no shadow
  ctx.beginPath(); ctx.ellipse(hx, hy, HAND_RX, HAND_RY, s.a, 0, Math.PI * 2); ctx.fill();

  // nerve bar, under the hand's own edge
  const bw = 54, bh = 6;
  const bx = s.edgeX - bw / 2, by = s.edgeY - bh / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = p.hand.nerve < T.nerveUnpin ? '#c2603f' : '#7fd1a0';
  ctx.fillRect(bx, by, bw * Math.max(0, p.hand.nerve / T.nerveMax), bh);
}

function drawFist(p) {
  const s = seatGeom(p.seat);
  const f = p.fist;
  // A winding fist draws back and rises; a dropping one falls onto the spot.
  // A recovering fist is spent and out of play — it must read as level with
  // (never above) a resting `ready` fist, or a just-landed fist looks more
  // threatening than an armed one, inverting the one cue this game is about.
  let lift = 0, tense = 0;
  if (f.state === 'wind') { tense = f.t / T.windTime; lift = 22 * tense; }
  else if (f.state === 'loaded') { tense = 1; lift = 22; }
  else if (f.state === 'drop') { tense = 1; lift = 22 * (1 - f.t / T.dropTime); }
  else if (f.state === 'abort') { lift = 22 * (1 - f.t / T.abortTime); }
  const spent = f.state === 'recover';

  const groundX = s.spotX + Math.cos(s.a) * lift * 0.6;
  const groundY = s.spotY + Math.sin(s.a) * lift * 0.6;
  const fx = groundX, fy = groundY - lift;

  // a soft cast shadow on the desk, only while the fist is actually off it —
  // this is what reads as "hovering" at a glance; the flat hand never gets one.
  if (lift > 0.5) {
    const shadowT = Math.min(1, lift / 22);
    ctx.save();
    ctx.globalAlpha = 0.32 * shadowT;
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.ellipse(groundX + 3, groundY + 4, 14, 10, s.a, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = '#cf9a63'; ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(s.edgeX, s.edgeY); ctx.lineTo(fx, fy); ctx.stroke();

  ctx.fillStyle = spent ? '#8c8478'                                              // spent — muted, reads as out of play
    : tense > 0 ? `rgb(${230 + 25 * tense}, ${150 - 40 * tense}, ${110 - 40 * tense})`
    : '#e6a870';
  ctx.beginPath(); ctx.arc(fx, fy, 16, 0, Math.PI * 2); ctx.fill();

  // the load ring: how long this fist has been holding its tension
  if (f.state === 'loaded') {
    const frac = Math.min(1, f.t / 0.8);
    ctx.beginPath(); ctx.arc(fx, fy, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = '#f5c97a'; ctx.lineWidth = 3; ctx.stroke();
  }
}

function drawHud() {
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const p of w.players) {
    const s = seatGeom(p.seat);
    const lx = view.cx + (s.edgeX - view.cx) * 1.16;
    const ly = view.cy + (s.edgeY - view.cy) * 1.16;
    ctx.fillStyle = p.out ? '#6b6b73' : (p.id === w.down ? '#f5c97a' : '#f3efe6');
    ctx.fillText(`${p.name}  ${'●'.repeat(Math.max(0, p.hp))}`, lx, ly);
  }
}

export function render() {
  if (!view.w || !view.h) {
    resize();                            // layout may have settled since load
    if (!view.w || !view.h) return;      // still nothing to draw on — bail clean
  }
  if (!deskLayer) deskLayer = bakeDesk();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(deskLayer, 0, 0);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  drawHand(w.players[w.down]);
  for (const p of w.players) { if (p.id !== w.down && !p.out) drawFist(p); }
  drawHud();
}

window.addEventListener('resize', () => { resize(); render(); });

// ── input: one button, both roles ────────────────────────────────────────────
let held = false;
const press = () => { held = true; };
const release = () => { held = false; };

canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); press(); }
  if (e.key === 'r' || e.key === 'R') restart();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Alt-tab or an app switch (the phone target) while the button is held never
// delivers keyup/pointerup — without this, `held` sticks true and the hand
// slides out and drains the whole nerve bar while nobody is looking.
window.addEventListener('blur', release);
document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

// ── the loop: fixed 1/120 s steps, whatever the display does ─────────────────
const DT = 1 / 120;
const MAX_CATCHUP = 0.25;          // never simulate more than this after a stall
let acc = 0, last = 0, frameMs = 0, rafHandle = 0;
const overEl = document.getElementById('over');
const overText = document.getElementById('over-text');

function frame(now) {
  const t0 = now;
  if (!last) last = now;
  acc += Math.min((now - last) / 1000, MAX_CATCHUP);
  last = now;

  const inputs = { 0: { hold: held } };
  while (acc >= DT) {
    for (const e of step(w, DT, inputs)) onEvent(e);
    acc -= DT;
  }
  render();
  frameMs = performance.now() - t0;
  // The harness pumps this manually (see below), and each call still ends
  // here and schedules a real rAF callback so the loop still works if driven
  // live. Cancel whatever is still pending first, so manual pumping can
  // never accumulate more than one real rAF in flight at a time.
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(frame);
}

function onEvent(e) {
  if (e.type === 'thump' && e.target === 0 && navigator.vibrate) navigator.vibrate(30);
  if (e.type === 'over') {
    overText.textContent = e.winner === 0 ? 'Your hand survived.' : 'Hand down. You lost.';
    overEl.hidden = false;
  }
}

function restart() {
  w = createWorld({ humans: 1, nBots: 1, seed: (Date.now() & 0xffff) || 1 });
  held = false; acc = 0; last = 0;
  overEl.hidden = true;
  deskLayer = null;
  render();
}
document.getElementById('again').addEventListener('click', restart);

resize();
render();
rafHandle = requestAnimationFrame(frame);

if (HARNESS) {
  // `frame` is exposed so a test harness can pump the real loop. Headless and
  // offscreen browsers park requestAnimationFrame at 0 Hz, so without this the
  // loop is the one part of the game that cannot be driven under test.
  window.__hs = {
    world: () => w, render, seatGeom, view: () => view, restart,
    press, release, frameMs: () => frameMs, frame,
  };
}
