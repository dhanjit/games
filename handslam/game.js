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
    g.setLineDash([4, 4]); g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(243,239,230,0.28)'; g.stroke();
    g.setLineDash([]);
  }
  return c;
}

// ── the moving parts ─────────────────────────────────────────────────────────
function drawHand(p) {
  const s = seatGeom(p.seat);
  // p.hand.p slides the hand from its strike spot back toward its own edge.
  const hx = s.spotX + (s.edgeX - s.spotX) * p.hand.p;
  const hy = s.spotY + (s.edgeY - s.spotY) * p.hand.p;

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d8a06a';               // the forearm and wrist
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.moveTo(s.edgeX, s.edgeY); ctx.lineTo(hx, hy); ctx.stroke();

  ctx.fillStyle = p.hand.pinned ? '#c2603f' : '#eab98a';   // the back of the hand
  ctx.beginPath(); ctx.ellipse(hx, hy, 17, 13, s.a, 0, Math.PI * 2); ctx.fill();

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
  let lift = 0, tense = 0;
  if (f.state === 'wind') { tense = f.t / T.windTime; lift = 22 * tense; }
  else if (f.state === 'loaded') { tense = 1; lift = 22; }
  else if (f.state === 'drop') { tense = 1; lift = 22 * (1 - f.t / T.dropTime); }
  else if (f.state === 'abort') { lift = 22 * (1 - f.t / T.abortTime); }
  else if (f.state === 'recover') { lift = 4; }

  const fx = s.spotX + Math.cos(s.a) * lift * 0.6;
  const fy = s.spotY + Math.sin(s.a) * lift * 0.6 - lift;

  ctx.strokeStyle = '#cf9a63'; ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(s.edgeX, s.edgeY); ctx.lineTo(fx, fy); ctx.stroke();

  ctx.fillStyle = tense > 0 ? `rgb(${230 + 25 * tense}, ${150 - 40 * tense}, ${110 - 40 * tense})` : '#e6a870';
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
  if (!deskLayer) deskLayer = bakeDesk();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(deskLayer, 0, 0);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  drawHand(w.players[w.down]);
  for (const p of w.players) { if (p.id !== w.down && !p.out) drawFist(p); }
  drawHud();
}

window.addEventListener('resize', () => { resize(); render(); });
resize();
render();

if (HARNESS) window.__hs = { world: () => w, render, seatGeom, view: () => view };
