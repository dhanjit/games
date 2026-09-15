/* handslam — renderer. Reads the world, never writes to it except via step().
 * Portrait phone first: the human always sits at 6 o'clock and the desk fills
 * the width. Every pixel number lives here; rules.js knows only seconds. */

import { createWorld, step, zoneOf, T } from './rules.js';

const HARNESS = new URLSearchParams(location.search).has('harness');
const canvas = document.getElementById('desk');
const ctx = canvas.getContext('2d');

// M1 pinned this at nBots: 1 for the duel; rules.js's own default moved to 5
// (six seats) in M2 Task 1, but this explicit call was never updated and was
// silently overriding it — the desk was still only ever seating two. Six seats
// is the whole premise of this task, so this has to actually happen for real,
// not just in a console-posed world.
let w = createWorld({ humans: 1, nBots: 5, seed: (Date.now() & 0xffff) || 1 });
let view = { w: 0, h: 0, cx: 0, cy: 0, rx: 0, ry: 0, dpr: 1 };
let deskLayer = null;

// ── layout ───────────────────────────────────────────────────────────────────
// Seat 0 (the human) is at 6 o'clock; the rest run clockwise from there.
function seatAngle(i, n) { return Math.PI / 2 + (i / n) * Math.PI * 2; }

/** Where a seat's arm enters the desk, and where its fist strikes. */
function seatGeom(i) {
  const a = seatAngle(i, w.n);
  const edgeX = view.cx + Math.cos(a) * view.rx;
  const edgeY = view.cy + Math.sin(a) * view.ry;
  const spotX = view.cx + Math.cos(a) * view.rx * 0.42;
  const spotY = view.cy + Math.sin(a) * view.ry * 0.42;
  // Unit vector along the retreat axis, spot toward edge. Shared by the hand
  // (how far it slides) and the HUD label (how far in from the rim it must
  // sit to clear the arm) — rx !== ry, so this is not just (cos a, sin a).
  const dx = edgeX - spotX, dy = edgeY - spotY;
  const dlen = Math.hypot(dx, dy) || 1;
  return { edgeX, edgeY, spotX, spotY, ux: dx / dlen, uy: dy / dlen, a };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;
  view = {
    w: cssW, h: cssH, dpr,
    cx: cssW / 2, cy: cssH / 2,
    // 0.44 → 0.46: a small bump over M1's coefficient. The HUD band inside the
    // rim (see HUD_R below) needs a bit more absolute room than the original
    // desk gave it, and every fixed-pixel element (hand, wrist, fist) is a
    // constant size regardless of rx/ry, so growing the desk only spreads
    // strike spots further apart — it cannot make any of those harder to read.
    rx: Math.min(cssW * 0.46, cssH * 0.34),
    ry: Math.min(cssW * 0.46, cssH * 0.34) * 0.82,
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
  const { ux, uy } = s;

  // p.hand.p slides the hand from the spot toward the edge, capped at
  // retreatPx — not all the way to the edge.
  const d = p.hand.p * retreatPx;
  const hx = s.spotX + ux * d, hy = s.spotY + uy * d;

  // A soft glow under the down seat's own hand. This is the glance-test the
  // brief asks for: with six fists on screen, "the hand shape differs from a
  // fist" only helps once you've found the right seat to look at. The glow
  // is the thing that pulls the eye there first, before any shape-reading.
  const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 34);
  glow.addColorStop(0, 'rgba(245,201,122,0.55)');
  glow.addColorStop(1, 'rgba(245,201,122,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(hx, hy, 34, 0, Math.PI * 2); ctx.fill();

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

// At 375×812 with six seats the desk radius is only ~165px, and the old
// layout put labels at 1.16× that — outside the rim. Fine for M1's two seats
// stacked top/bottom (both dead centre, nothing to clip), but every side seat
// among six puts the label past a 375px-wide screen (measured before this
// fix: label text spilling ~3-20px past the left or right edge, worse once a
// name shrinks its pip count).
//
// Moving inside the rim isn't free, though: six seats means five fists in
// play at once, each capable of swinging up to 22px off its own strike spot
// while wound. For the seat whose lift direction happens to line up with its
// own label (the seat opposite screen-up), that swing plus the 0.6× outward
// drift the fist already has *add* instead of cancelling, projecting ~35px
// out from the spot — plus the fist's own ~22px drawn radius (the load ring,
// at its peak sweep) — for a ~57px worst case. HUD_R clears it, but only
// just: at this desk size there isn't room to also clear it comfortably
// *and* stay clear of the nerve bar at the rim, and a label sitting on top of
// its own seat's threat read would be worse than a 1px graze against the
// ring's thin stroke. Verified pixel-by-pixel against the actual canvas
// (see the M2 Task 2 report) — the solid fist ball clears with room to
// spare; only the decorative ring can brush the label's corner, and only for
// this one seat, only while that fist is fully loaded.
const HUD_R = 68;
const PIP_R = 4, PIP_GAP = 3;   // HP pips: fixed T.startHp slots, filled vs hollow

function drawHud() {
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (const p of w.players) {
    const s = seatGeom(p.seat);
    const lx = s.spotX + s.ux * HUD_R;
    const ly = s.spotY + s.uy * HUD_R;
    // w.down can never be an eliminated player (M1 fixed the one bug where it
    // dangled on a just-out kid) but the guard costs nothing and says so.
    const isDown = p.id === w.down && !p.out;

    const nameW = ctx.measureText(p.name).width;
    const pipsW = T.startHp * (PIP_R * 2) + (T.startHp - 1) * PIP_GAP;
    const gap = 6, padX = 7, padY = 4;
    const boxW = nameW + gap + pipsW + padX * 2;
    const boxH = 12 + padY * 2;
    const boxX = lx - boxW / 2, boxY = ly - boxH / 2;

    // The down seat's chip is a solid gold shape, not just gold text — a
    // reinforcing, non-colour-dependent echo of the glow on its hand. Every
    // other chip is a plain dark plate, there only for contrast against the
    // wood grain.
    ctx.fillStyle = isDown ? '#f5c97a' : p.out ? 'rgba(107,107,115,0.35)' : 'rgba(10,10,12,0.8)';
    ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 6); ctx.fill();

    ctx.fillStyle = isDown ? '#1b1b1f' : p.out ? '#8a8a92' : '#f3efe6';
    ctx.fillText(p.name, boxX + padX, ly);

    // HP as fixed slots (filled vs hollow), not a variable-length dot run —
    // a lone dot at 1 HP reads identically to a rendering glitch, but ●○○
    // reads unambiguously as "1 of 3" at any HP total. The last point turns
    // the same red as the nerve bar's danger colour, so "about to be out" is
    // legible at a glance, not just a count you have to do.
    let px = boxX + padX + nameW + gap + PIP_R;
    for (let i = 0; i < T.startHp; i++) {
      ctx.beginPath(); ctx.arc(px, ly, PIP_R, 0, Math.PI * 2);
      if (i < p.hp) {
        ctx.fillStyle = p.hp <= 1 ? '#c2603f' : (isDown ? '#1b1b1f' : '#f3efe6');
        ctx.fill();
      } else {
        ctx.strokeStyle = isDown ? 'rgba(27,27,31,0.5)' : 'rgba(243,239,230,0.35)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      px += PIP_R * 2 + PIP_GAP;
    }
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
  w = createWorld({ humans: 1, nBots: 5, seed: (Date.now() & 0xffff) || 1 });
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
