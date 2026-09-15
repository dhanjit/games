/* handslam — renderer. Reads the world, never writes to it except via step().
 *
 * The view is **flat top-down**, with no perspective anywhere: a rectangular
 * school desk seen from directly above, sitting on a classroom floor. M1/M2
 * drew the desk as an ellipse (ry = 0.82·rx), which reads as a round table in
 * perspective while every other element was flat — the two views disagreed and
 * a player noticed within seconds (#69). Top-down now means top-down.
 *
 * Portrait phone first: the desk is taller than it is wide, two kids down each
 * long side, one at each short end, and seat 0 (the human) always at the
 * bottom edge. Every pixel number lives here; rules.js knows only seconds.
 */

import { createWorld, step, zoneOf, T, makeRng } from './rules.js';

const HARNESS = new URLSearchParams(location.search).has('harness');
const canvas = document.getElementById('desk');
const ctx = canvas.getContext('2d');

let w = createWorld({ humans: 1, nBots: 5, seed: (Date.now() & 0xffff) || 1 });
let view = { w: 0, h: 0, cx: 0, cy: 0, dw: 0, dh: 0, dpr: 1 };
let deskLayer = null;

// ── palette ──────────────────────────────────────────────────────────────────
// Two rules hold this together: the desk is the brightest surface in the room,
// and the *defender's* arm is the brightest thing on the desk. Everything else
// is pushed down in value so the eye lands on the flat hand first.
const C = {
  floor: '#3f463d', grout: '#2b322b',
  wood: '#835629', woodDark: '#6a4420', woodEdge: '#4f3316', gold: '#f5c97a',

  // the one hand that is actually ON the desk
  handSkin: '#f2c79b',     // back of the hand — the 'hand' contact zone
  handFinger: '#c08a5e',   // splayed fingers  — the 'wrist' contact zone
  handArm: '#e0a273',
  handEdge: '#5e3a1e',
  sleeveDown: '#f4f1e7',

  // the five that are up — muted, so they read as background threat
  upSkin: '#9c7050', upArm: '#875e42', upEdge: '#2e2117', sleeveUp: '#85837b',
  spent: '#6e6960',
};

// ── layout ───────────────────────────────────────────────────────────────────
// A seat is a point on the desk's rectangular perimeter — where that kid's arm
// comes in over the edge. `t` runs along the side: 0→1 left-to-right on
// top/bottom, top-to-bottom on left/right.
//
// There is exactly ONE strike spot, at the centre of the desk, shared by every
// seat: whoever is down puts their hand there and everyone else's fist hovers
// over it. That is the rule the game is played by ("the one who gets hit places
// his hand at the centre of the table"), and it is what the sim has always
// modelled — one `zoneOf(w.players[w.down].hand.p)` for every landing, one hand,
// one retreat scalar. An earlier renderer gave each seat its own spot near its
// own edge, which the sim never said and no player would recognise.
//
// Portrait desk (taller than wide): the long sides are left and right, so they
// take two kids each and the short ends one each. Landscape flips it. Seat 0 is
// on the bottom edge either way — the human is always nearest the player.
const SEAT6_TALL = [
  { side: 'bottom', t: 0.50 },   // 0 — the human
  { side: 'left', t: 0.70 },     // …and clockwise on screen from there
  { side: 'left', t: 0.30 },
  { side: 'top', t: 0.50 },
  { side: 'right', t: 0.30 },
  { side: 'right', t: 0.70 },
];
const SEAT6_WIDE = [
  { side: 'bottom', t: 0.35 },   // 0 — the human, still on the bottom edge
  { side: 'left', t: 0.50 },
  { side: 'top', t: 0.30 },
  { side: 'top', t: 0.70 },
  { side: 'right', t: 0.50 },
  { side: 'bottom', t: 0.72 },
];

/** Which side of the desk a seat sits on, and where along it. */
function seatSlot(i, n) {
  if (n === 6) return (view.dh >= view.dw ? SEAT6_TALL : SEAT6_WIDE)[i];
  // Any other seat count (the M1 duel, a posed world): fall back to even
  // angular spacing, cast as a ray from the centre onto the desk rectangle.
  const a = Math.PI / 2 + (i / n) * Math.PI * 2;
  const cos = Math.cos(a), sin = Math.sin(a);
  const tx = Math.abs(cos) > 1e-6 ? view.dw / Math.abs(cos) : Infinity;
  const ty = Math.abs(sin) > 1e-6 ? view.dh / Math.abs(sin) : Infinity;
  if (tx < ty) return { side: cos > 0 ? 'right' : 'left', t: (sin * tx + view.dh) / (2 * view.dh) };
  return { side: sin > 0 ? 'bottom' : 'top', t: (cos * ty + view.dw) / (2 * view.dw) };
}

/** Where a seat's arm crosses the desk edge, and the axis it reaches in along.
 * `spotX, spotY` is the one shared strike spot — the desk centre — for every
 * seat. `ux, uy` is the unit vector from that spot out toward this seat's own
 * edge, and `a` is its angle, which every limb rotates into; it is no longer
 * axis-aligned, because a kid sitting part-way down a long side reaches in to
 * the middle diagonally. `axisLen` is the spot-to-edge distance — now the real
 * length of the reach across the desk. Contract unchanged from M2: drawHand,
 * drawFist and drawHud all read these. */
function seatGeom(i) {
  const { side, t } = seatSlot(i, w.n);
  const { cx, cy, dw, dh } = view;
  let edgeX, edgeY;
  if (side === 'bottom') { edgeX = cx - dw + t * 2 * dw; edgeY = cy + dh; }
  else if (side === 'top') { edgeX = cx - dw + t * 2 * dw; edgeY = cy - dh; }
  else if (side === 'left') { edgeX = cx - dw; edgeY = cy - dh + t * 2 * dh; }
  else { edgeX = cx + dw; edgeY = cy - dh + t * 2 * dh; }
  const vx = edgeX - cx, vy = edgeY - cy;
  const axisLen = Math.hypot(vx, vy) || 1;
  return {
    edgeX, edgeY, ux: vx / axisLen, uy: vy / axisLen, side,
    spotX: cx, spotY: cy,
    a: Math.atan2(vy, vx), axisLen,
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;
  // Half-extents of the desk rectangle. The long axis follows the screen, so a
  // portrait phone gets a portrait desk and landscape gets a landscape one;
  // the side/end seat counts follow from that in seatSlot.
  const dw = Math.min(cssW * 0.43, cssH * 0.40, 230);
  const dh = Math.min(cssH * 0.345, dw * 1.52, 270);
  view = { w: cssW, h: cssH, dpr, cx: cssW / 2, cy: cssH / 2, dw, dh };
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  deskLayer = null;                      // the static layer must be re-baked
}

// ── the static room + desk, baked once ───────────────────────────────────────
// Everything here is blitted as one image every frame. Nothing in this section
// may move: if it needs to change per frame it belongs below, not here.

/** Is (x, y) far enough from the strike spot to be safe to draw on?
 * The contact-zone pixel test samples that one spot, so no dressing may land
 * under it — a graffiti stroke through the spot would change the 'desk' colour
 * the test reads. One spot now, not six, so this is one distance check. */
function clearOfSpots(x, y, r) {
  return Math.hypot(x - view.cx, y - view.cy) >= r;
}

function bakeFloor(g, W, H, rnd) {
  g.fillStyle = C.floor;
  g.fillRect(0, 0, W, H);

  // Terrazzo: the grey-green chipped mosaic of every Indian school corridor.
  // Plain fillRects, not paths — 1800 of them still bake in a couple of ms.
  for (let i = 0; i < 1800; i++) {
    const x = rnd() * W, y = rnd() * H, s = 1 + rnd() * 2.6;
    const k = rnd();
    g.fillStyle = k < 0.34 ? 'rgba(214,214,200,0.30)'
      : k < 0.60 ? 'rgba(150,164,142,0.30)'
      : k < 0.82 ? 'rgba(40,46,40,0.34)'
      : 'rgba(176,152,120,0.22)';
    g.fillRect(x, y, s, s * (0.6 + rnd() * 0.9));
  }

  // The tile grid it was all poured into.
  const TS = 62;
  g.strokeStyle = C.grout; g.lineWidth = 2;
  g.beginPath();
  for (let x = (W / 2) % TS; x < W; x += TS) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = (H / 2) % TS; y < H; y += TS) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();

  // Scuff arcs where chairs have been dragged for twenty years.
  g.strokeStyle = 'rgba(232,232,220,0.07)';
  for (let i = 0; i < 16; i++) {
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, 18 + rnd() * 50, rnd() * 6, rnd() * 6);
    g.stroke();
  }
}

/** A neighbouring desk, cropped by the screen edge — the room continues. */
function neighbourDesk(g, x, y, bw, bh, rot) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.beginPath(); g.roundRect(-bw / 2 + 3, -bh / 2 + 5, bw, bh, 5); g.fill();
  g.fillStyle = '#55381a';
  g.beginPath(); g.roundRect(-bw / 2, -bh / 2, bw, bh, 5); g.fill();
  g.fillStyle = '#3f2913';
  g.fillRect(-bw / 2, -bh / 2, bw, 5);
  g.strokeStyle = 'rgba(30,20,10,0.75)'; g.lineWidth = 2;
  g.beginPath(); g.roundRect(-bw / 2, -bh / 2, bw, bh, 5); g.stroke();
  // the bench that goes with it
  g.fillStyle = '#4a3016';
  g.beginPath(); g.roundRect(-bw / 2 + 6, bh / 2 + 9, bw - 12, 17, 4); g.fill();
  g.restore();
}

function bakeLitter(g, W, H, rnd) {
  // a crumpled sheet of homework
  const paper = (px, py, r) => {
    g.save(); g.translate(px, py); g.rotate(r);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(2, 3, 9, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ddd9cc';
    g.beginPath();
    g.moveTo(-9, -2); g.lineTo(-3, -9); g.lineTo(6, -7); g.lineTo(9, 1);
    g.lineTo(3, 8); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(120,116,104,0.8)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-4, -6); g.lineTo(1, 2); g.lineTo(-2, 6); g.stroke();
    g.restore();
  };
  // a stub of chalk
  const chalk = (px, py, r) => {
    g.save(); g.translate(px, py); g.rotate(r);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-6, -2, 14, 6);
    g.fillStyle = '#efece2'; g.fillRect(-7, -3, 14, 5);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-7, -3, 14, 1.4);
    g.restore();
  };
  paper(W * 0.14, H * 0.055 + rnd() * 10, rnd() * 3);
  paper(W * 0.84, H * 0.955 - rnd() * 10, rnd() * 3);
  chalk(W * 0.30, H * 0.965, 0.5 + rnd());
  chalk(W * 0.72, H * 0.042, 2.1 + rnd());
  // chalk dust
  g.fillStyle = 'rgba(243,239,230,0.10)';
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 26;
    g.fillRect(W * 0.30 + Math.cos(a) * d, H * 0.965 + Math.sin(a) * d, 1.6, 1.6);
  }
}

function bakeDeskSurface(g, rnd) {
  const { cx, cy, dw, dh } = view;
  const L = cx - dw, Tp = cy - dh, Wd = dw * 2, Hd = dh * 2;

  // The desk sits above the floor, so it throws a soft ring of shadow all
  // round itself. Flat top-down: no side faces, no foreshortening — the
  // shadow is what says "this is a solid object", not a drawn 3D edge.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 22; g.shadowOffsetY = 6;
  g.fillStyle = C.woodEdge;
  g.beginPath(); g.roundRect(L, Tp, Wd, Hd, 7); g.fill();
  g.restore();

  // worn edge banding, then the surface itself
  g.fillStyle = C.woodDark;
  g.beginPath(); g.roundRect(L, Tp, Wd, Hd, 7); g.fill();
  g.fillStyle = C.wood;
  g.beginPath(); g.roundRect(L + 7, Tp + 7, Wd - 14, Hd - 14, 4); g.fill();

  g.save();
  g.beginPath(); g.roundRect(L + 7, Tp + 7, Wd - 14, Hd - 14, 4); g.clip();

  // grain, running the long way down the desk
  const along = dh >= dw;
  g.lineWidth = 1;
  for (let i = 0; i < 54; i++) {
    const k = i / 54;
    g.strokeStyle = `rgba(${i % 5 ? '58,36,14' : '150,104,58'},${0.05 + rnd() * 0.10})`;
    g.beginPath();
    if (along) {
      const x = L + k * Wd + rnd() * 4;
      g.moveTo(x, Tp);
      g.bezierCurveTo(x + 5, Tp + Hd / 3, x - 6, Tp + Hd * 0.7, x + 2, Tp + Hd);
    } else {
      const y = Tp + k * Hd + rnd() * 4;
      g.moveTo(L, y);
      g.bezierCurveTo(L + Wd / 3, y + 5, L + Wd * 0.7, y - 6, L + Wd, y + 2);
    }
    g.stroke();
  }
  // two knots
  for (let i = 0; i < 2; i++) {
    const kx = L + Wd * (0.22 + i * 0.55), ky = Tp + Hd * (0.18 + i * 0.6);
    if (!clearOfSpots(kx, ky, 46)) continue;
    for (let r = 2; r < 11; r += 2.2) {
      g.strokeStyle = `rgba(52,32,12,${0.20 - r * 0.012})`;
      g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(kx, ky, r * 1.5, r, 0.5, 0, Math.PI * 2); g.stroke();
    }
  }

  // Ballpoint graffiti — the spec's Feel section, finally drawn. Nothing lands
  // within 40px of a strike spot (clearOfSpots), so the contact-zone sample
  // still reads clean desk wood.
  const scrawl = (text, gx, gy, rot, size, col) => {
    if (!clearOfSpots(gx, gy, 42)) return;
    g.save(); g.translate(gx, gy); g.rotate(rot);
    g.font = `600 ${size}px "Comic Sans MS", "Segoe Print", cursive, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = col; g.fillText(text, 0, 0);
    g.restore();
  };
  const inkA = 'rgba(61,85,173,0.55)', inkB = 'rgba(22,26,40,0.42)';
  scrawl('IX-B', cx - dw * 0.52, cy - dh * 0.76, -0.24, 15, inkA);
  scrawl('R + S', cx + dw * 0.46, cy - dh * 0.42, 0.32, 14, inkA);
  scrawl('BUNTY', cx - dw * 0.38, cy + dh * 0.58, 0.18, 13, inkB);
  scrawl('4 EVER', cx + dw * 0.40, cy + dh * 0.70, -0.30, 12, inkA);
  scrawl('OYE', cx + dw * 0.05, cy - dh * 0.05, 0.9, 16, inkB);

  // a ballpoint heart, and a tally of periods survived
  if (clearOfSpots(cx + dw * 0.46, cy - dh * 0.28, 40)) {
    g.save(); g.translate(cx + dw * 0.46, cy - dh * 0.28); g.rotate(0.3);
    g.strokeStyle = inkA; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, 5); g.bezierCurveTo(-9, -2, -5, -9, 0, -4);
    g.bezierCurveTo(5, -9, 9, -2, 0, 5);
    g.stroke(); g.restore();
  }
  if (clearOfSpots(cx - dw * 0.46, cy + dh * 0.16, 40)) {
    g.save(); g.translate(cx - dw * 0.46, cy + dh * 0.16); g.rotate(-0.12);
    g.strokeStyle = inkB; g.lineWidth = 1.7;
    g.beginPath();
    for (let i = 0; i < 4; i++) { g.moveTo(i * 5, -7); g.lineTo(i * 5 + 1.5, 7); }
    g.moveTo(-3, 6); g.lineTo(19, -6);
    g.stroke(); g.restore();
  }
  // compass-point scratches gouged into the varnish
  g.strokeStyle = 'rgba(214,180,132,0.30)';
  for (let i = 0; i < 22; i++) {
    const sx = L + rnd() * Wd, sy = Tp + rnd() * Hd;
    if (!clearOfSpots(sx, sy, 34)) continue;
    const a = rnd() * Math.PI, len = 8 + rnd() * 26;
    g.lineWidth = 0.7 + rnd() * 0.7;
    g.beginPath(); g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    g.stroke();
  }

  // chalk smudge — someone rested a dusty sleeve here
  for (let i = 0; i < 3; i++) {
    const sx = cx + (rnd() - 0.5) * Wd * 0.7, sy = cy + (rnd() - 0.5) * Hd * 0.7;
    if (!clearOfSpots(sx, sy, 56)) continue;
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, 34 + rnd() * 18);
    gr.addColorStop(0, 'rgba(243,239,230,0.20)');
    gr.addColorStop(1, 'rgba(243,239,230,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(sx, sy, 52, 0, Math.PI * 2); g.fill();
  }

  // a notebook shoved to one corner, and a pencil beside it
  const nbx = L + Wd * 0.90, nby = Tp + Hd * 0.055;
  if (clearOfSpots(nbx, nby, 44)) {
    g.save(); g.translate(nbx, nby); g.rotate(0.22);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.roundRect(-44, -30, 92, 62, 3); g.fill();
    g.fillStyle = '#e7e3d6';
    g.beginPath(); g.roundRect(-46, -32, 92, 62, 3); g.fill();
    g.strokeStyle = 'rgba(96,128,170,0.45)'; g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 7; i++) { g.moveTo(-42, -32 + i * 8.6); g.lineTo(42, -32 + i * 8.6); }
    g.stroke();
    g.strokeStyle = 'rgba(190,72,60,0.55)';
    g.beginPath(); g.moveTo(-32, -32); g.lineTo(-32, 30); g.stroke();
    g.restore();
  }
  const pcx = L + Wd * 0.10, pcy = Tp + Hd * 0.95;
  if (clearOfSpots(pcx, pcy, 40)) {
    g.save(); g.translate(pcx, pcy); g.rotate(-0.55);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath(); g.roundRect(-30, -1.5, 62, 7, 3); g.fill();
    g.fillStyle = '#d8a520';
    g.beginPath(); g.roundRect(-32, -3.5, 58, 7, 2); g.fill();
    g.fillStyle = '#e8cf9a';
    g.beginPath(); g.moveTo(26, -3.5); g.lineTo(34, 0); g.lineTo(26, 3.5); g.closePath(); g.fill();
    g.fillStyle = '#2a2a2e';
    g.beginPath(); g.moveTo(31.5, -1.5); g.lineTo(34, 0); g.lineTo(31.5, 1.5); g.closePath(); g.fill();
    g.fillStyle = '#c05a5a';
    g.beginPath(); g.roundRect(-34, -3.5, 5, 7, 2); g.fill();
    g.restore();
  }
  g.restore();  // un-clip

  // The strike spot — one chalk ring, in the middle of the desk, because there
  // is one hand and it goes in the middle. Every kid's fist comes down here.
  g.beginPath(); g.arc(cx, cy, 23, 0, Math.PI * 2);
  g.setLineDash([5, 5]); g.lineWidth = 2;
  g.strokeStyle = 'rgba(243,239,230,0.42)'; g.stroke();
  g.setLineDash([]);
}

function bakeDesk() {
  const c = document.createElement('canvas');
  c.width = Math.round(view.w * view.dpr);
  c.height = Math.round(view.h * view.dpr);
  const g = c.getContext('2d');
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const W = view.w, H = view.h, rnd = makeRng(20260915);

  bakeFloor(g, W, H, rnd);
  // neighbouring desks, cropped by the screen — this desk is one of a row
  neighbourDesk(g, W * 0.16, -34, 150, 96, -0.09);
  neighbourDesk(g, W * 0.92, H * 0.055, 150, 96, 0.13);
  neighbourDesk(g, W * 0.06, H * 1.01, 150, 96, 0.07);
  neighbourDesk(g, W * 0.86, H * 1.04, 150, 96, -0.11);
  bakeLitter(g, W, H, rnd);
  bakeDeskSurface(g, rnd);

  // The room falls away at the edges so the desk stays the brightest thing on
  // screen. Starts outside the desk rectangle, so the wood the contact-zone
  // test samples is never touched by it.
  const vg = g.createRadialGradient(
    view.cx, view.cy, Math.max(view.dw, view.dh) * 1.02,
    view.cx, view.cy, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(6,8,10,0)');
  vg.addColorStop(1, 'rgba(6,8,10,0.66)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return c;
}

// ── the moving parts ─────────────────────────────────────────────────────────
// HAND_RX is the half-length of the back of the hand along the retreat axis,
// and retreatPx is derived from the rule (not guessed): exactly how far the
// hand's near edge must travel to clear T.handGrace, so the picture stays in
// lockstep with zoneOf(p.hand.p) at every p. Retuning handGrace in rules.js
// moves this geometry with it.
//
// The anatomy maps onto the three zones like this, in a frame where +x runs
// from the strike spot out toward the seat's own desk edge and the hand
// retreats along +x:
//
//   fingertips      knuckles        wrist        cuff
//        |             |              |            |
//        +-- fingers --+---- back ----+-- forearm -+--→ +x (toward the player)
//        ^             ^              ^
//    d-retreatPx   d-HAND_RX      d+HAND_RX
//        \_____________/\_____________/
//         'wrist' band    'hand' band
//
// The spot sits at x = 0. The back of the hand covers it while d <= HAND_RX,
// i.e. p <= handGrace; the splayed fingers trail across it for the rest of the
// slide; at p = 1 even the fingertips have cleared and the spot is bare wood.
// That is why the fingers are drawn a distinctly darker skin tone than the back
// of the hand — the three contact zones must be three different colours at the
// spot, and this is the one reading of the anatomy where the drawn picture and
// the rule agree everywhere, not just at the endpoints.
const HAND_RX = 17;
const retreatPx = HAND_RX / T.handGrace;   // ≈ 37.8px
const NERVE_RING_R = 41, NERVE_RING_W = 4;

// Butt-capped strokes and round caps soften their own last ~1px, so a band
// whose mathematical end lands exactly on the sample point reads as a blend of
// itself and the wood underneath. Both pads push the drawn edge clear of the
// spot in whichever direction is safe for the zone the rule is currently in —
// the zone test still gates *which* band is there, so neither can bleed a
// colour into a zone that does not own it. Found by pixel-sampling, twice
// (M2 Task 2 for the wrist band, #69 for the fingers and the knuckle line).
const WRIST_OVERSHOOT = 1.5;   // fingertips reach past the spot inside 'wrist'
const ZONE_PAD = 2;            // knuckle line clears the spot either way
const TIP_CLEAR = 4;           // fingertips pull back off the spot outside it

// ── limbs ────────────────────────────────────────────────────────────────────
/** A tapered forearm running from x = 0 (the wrist) out to x = len (the desk
 * edge) and on off-screen, with a rolled-up school-shirt sleeve at the edge.
 * Drawn in a frame already translated and rotated onto the arm's own axis. */
function limb(x0, len, wWrist, wElbow, arm, edge, sleeve) {
  const far = len + 26;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x0, -wWrist);
    ctx.bezierCurveTo(x0 + (len - x0) * 0.4, -wWrist - 1.2, len * 0.8, -wElbow + 1, far, -wElbow);
    ctx.lineTo(far, wElbow);
    ctx.bezierCurveTo(len * 0.8, wElbow - 1, x0 + (len - x0) * 0.4, wWrist + 1.2, x0, wWrist);
    ctx.quadraticCurveTo(x0 - 3.5, 0, x0, -wWrist);
    ctx.closePath();
  };
  ctx.strokeStyle = edge; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  path(); ctx.stroke();
  ctx.fillStyle = arm; path(); ctx.fill();

  // The rolled-up school-shirt sleeve, at the desk edge — and then the arm
  // keeps going, out of the room and off the screen. A limb that simply stops
  // in mid-floor reads as an amputated prop; the spec's line is "shirt-sleeved
  // arms reaching in from off-screen", so the sleeve runs 230px past the edge
  // and darkens into the room as it goes, with no visible end to it.
  const s0 = len - 4, s1 = len + 96;
  const sg = ctx.createLinearGradient(s0, 0, s1, 0);
  sg.addColorStop(0, sleeve);
  sg.addColorStop(0.26, sleeve);
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = edge;
  ctx.beginPath(); ctx.roundRect(s0 - 1.5, -wElbow - 5.5, 46, (wElbow + 5.5) * 2, 7); ctx.fill();
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.roundRect(s0, -wElbow - 4, s1 - s0, (wElbow + 4) * 2, 6); ctx.fill();
  // the roll itself: a fatter band at the inboard end, with two creases
  ctx.fillStyle = sleeve;
  ctx.beginPath(); ctx.roundRect(s0 - 2, -wElbow - 6, 13, (wElbow + 6) * 2, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(s0 + 11, -wElbow - 5); ctx.lineTo(s0 + 11, wElbow + 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s0 - 2, -wElbow - 6); ctx.lineTo(s0 - 2, wElbow + 6); ctx.stroke();
  // one fold running out along the sleeve, so it is cloth and not a grey slab
  const fg = ctx.createLinearGradient(s0, 0, s1, 0);
  fg.addColorStop(0, 'rgba(0,0,0,0.20)');
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = fg; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(s0 + 14, -wElbow * 0.35); ctx.lineTo(s1 - 10, -wElbow * 0.35); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s0 + 14, wElbow * 0.5); ctx.lineTo(s1 - 10, wElbow * 0.5); ctx.stroke();
}

/** The defender's hand: palm down, four splayed fingers and a thumb. The
 * silhouette — a fan — is the whole point; it has to be unmistakable against a
 * fist's knuckled lump without reading a single label. */
function flatHand(d, zone) {
  const inner = -HAND_RX - (zone === 'hand' ? ZONE_PAD : -ZONE_PAD);   // knuckle line
  const fTip = -retreatPx - (zone === 'wrist' ? WRIST_OVERSHOOT : -TIP_CLEAR);

  ctx.save();
  ctx.translate(d, 0);                     // into the hand's own frame

  // fingers first, palm over the top of their bases — the join becomes the
  // knuckle crease and no seam of wood can show through between the two.
  const fingers = [
    [-7.0, -12.5, fTip + 3.5, 6.0],        // index
    [-0.6, -1.0, fTip, 6.4],               // middle — dead on the axis, so the
    [5.8, 7.6, fTip + 4.5, 6.1],           // spot is always solidly covered
    [11.6, 15.4, fTip + 11, 5.2],          // little
  ];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? C.handFinger : C.handEdge;
    for (const [y0, y1, tx, fw] of fingers) {
      ctx.lineWidth = fw + (pass ? 0 : 2.6);
      ctx.beginPath();
      ctx.moveTo(inner + 11, y0);
      ctx.quadraticCurveTo(tx * 0.45, y0 * 0.7 + y1 * 0.3, tx + fw / 2, y1);
      ctx.stroke();
    }
  }

  // the thumb, tucked out to the index side
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? C.handSkin : C.handEdge;
    ctx.lineWidth = 9.2 + (pass ? 0 : 2.6);
    ctx.beginPath();
    ctx.moveTo(10, -8);
    ctx.quadraticCurveTo(2, -16, -5.5, -17.5);
    ctx.stroke();
  }

  // the back of the hand
  const palm = () => {
    ctx.beginPath();
    ctx.moveTo(inner, -13.2);
    ctx.bezierCurveTo(inner - 0.5, -14.4, -6, -14.6, 2, -12.2);
    ctx.bezierCurveTo(8, -10.6, 14, -9.6, HAND_RX, -9.0);
    ctx.quadraticCurveTo(HAND_RX + 2.4, 0, HAND_RX, 9.0);
    ctx.bezierCurveTo(14, 9.8, 8, 11.2, 2, 12.8);
    ctx.bezierCurveTo(-6, 14.8, inner - 0.5, 14.2, inner, 13.2);
    ctx.closePath();
  };
  ctx.strokeStyle = C.handEdge; ctx.lineWidth = 2.8;
  palm(); ctx.stroke();
  ctx.fillStyle = C.handSkin; palm(); ctx.fill();

  // Knuckle crease and two tendon lines: reads as the back of a hand rather
  // than a blob. Every one of them keeps off the hand's own centre line — the
  // strike spot tracks straight down it, and a 34%-alpha crease drifting over
  // the sample point turned 'hand' into fourteen different shades of hand
  // between p = 0.38 and p = 0.45 (caught by sweeping p, not by sampling the
  // seven values in the brief). Anatomically free: a knuckle crease breaks at
  // the middle finger anyway.
  ctx.strokeStyle = 'rgba(120,72,40,0.34)'; ctx.lineWidth = 1.4;
  for (const [ya, yb] of [[-11.5, -4.6], [4.6, 11.5]]) {
    ctx.beginPath();
    ctx.moveTo(inner + 2.5, ya); ctx.quadraticCurveTo(inner + 5.2, (ya + yb) / 2, inner + 2.5, yb);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120,72,40,0.22)'; ctx.lineWidth = 1.2;
  for (const y of [-6.4, 3.6]) {
    ctx.beginPath(); ctx.moveTo(inner + 7, y); ctx.lineTo(12, y + 1.4); ctx.stroke();
  }
  // the grooves between the fingers, which is what the crease breaks around
  ctx.strokeStyle = 'rgba(94,58,30,0.30)'; ctx.lineWidth = 1.3;
  for (const y of [-3.6, 3.4, 9.2]) {
    ctx.beginPath(); ctx.moveTo(inner + 1, y); ctx.lineTo(inner - 5, y); ctx.stroke();
  }
  ctx.restore();
}

/** An attacker's fist: a compact rounded mass with four knuckle bumps. Half
 * the hand's length, no splay — that contrast is what carries the read. */
function fist(tense, col, edge, armed) {
  const sq = 1 - 0.06 * tense;                 // a clenched fist pulls in
  const kr = 4.2 + 1.3 * tense;                // …and its knuckles stand out
  const mass = () => {
    ctx.beginPath();
    ctx.roundRect(-11 * sq, -12.6 * sq, 21.5 * sq, 25.2 * sq, 8 * sq);
  };
  const knuckleY = [-8.6, -2.9, 2.9, 8.6];

  ctx.lineJoin = 'round';
  ctx.strokeStyle = edge; ctx.lineWidth = 3;
  mass(); ctx.stroke();
  for (const y of knuckleY) {
    ctx.beginPath(); ctx.arc(-9.5 * sq, y * sq, kr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = col;
  mass(); ctx.fill();
  for (const y of knuckleY) {
    ctx.beginPath(); ctx.arc(-9.5 * sq, y * sq, kr, 0, Math.PI * 2); ctx.fill();
  }
  // the thumb folded across the front, and the shadow between the knuckles
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.roundRect(-4 * sq, 7.5 * sq, 13 * sq, 8.4 * sq, 4); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.roundRect(-4 * sq, 7.5 * sq, 13 * sq, 8.4 * sq, 4); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 1.5;
  for (const y of [-5.7, 0, 5.7]) {
    ctx.beginPath();
    ctx.moveTo(-12.5 * sq, y * sq); ctx.lineTo(-5.5 * sq, y * sq);
    ctx.stroke();
  }
  // Loaded — cocked, tension held, legal to drop. A wound fist and a loaded
  // one were otherwise both just "a red fist" and could not be told apart in a
  // still frame; only this one gets a gold rim, matching its own load ring.
  if (armed) {
    ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 2.2;
    mass(); ctx.stroke();
    for (const y of knuckleY) {
      ctx.beginPath(); ctx.arc(-9.5 * sq, y * sq, kr, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// ── the ring the waiting fists rest on ───────────────────────────────────────
// Every kid holds their fist over the one hand, so all five hover around the one
// spot rather than each sitting over a patch of their own. They rest on a small
// ring centred on the spot, each on the bearing of its own seat.
//
// The radius is measured, not picked: it is the smallest that satisfies all
// three things a fist must stay clear of, so it follows the seat count and the
// drawn sizes instead of being a number tuned for six.
//
//   1. each other  — chord 2·R·sin(Δθ/2) ≥ 2·FIST_R at the narrowest gap
//                    between neighbouring bearings (the seats sit at fixed
//                    points on a rectangle, so the gaps are not exactly even)
//   2. the hand    — the fist opposite the defender reaches inboard toward the
//                    fingertips, which at p = 0 trail retreatPx - TIP_CLEAR
//                    back across the spot
//   3. the nerve ring — the defender's meter, drawn round the same spot
//
// Half-extents of the drawn fist in its own frame (+x outboard), stroke
// included: the knuckle bumps bulge to -16.5 inboard, the folded thumb to 16.7
// across, and a loaded fist is scaled up by a further 10%.
const FIST_IN = 16.5, FIST_SIDE = 16.7, FIST_SCALE = 1.10;
const FIST_R = Math.hypot(FIST_IN, FIST_SIDE) * FIST_SCALE;   // circumscribed
const FIST_REACH_IN = FIST_IN * FIST_SCALE;    // how far it reaches back inboard
const RING_AIR = 3;                            // daylight, so nothing just kisses
const WIND_BACK = 12;                          // a winding fist draws off the ring

let ringCache = { key: '', r: 0 };
function ringRadius() {
  const key = `${view.w}x${view.h}x${w.n}`;
  if (ringCache.key !== key) ringCache = { key, r: computeRingRadius() };
  return ringCache.r;
}

function computeRingRadius() {
  const bearings = [];
  let minAxis = Infinity;
  for (let i = 0; i < w.n; i++) {
    const s = seatGeom(i);
    bearings.push((s.a + Math.PI * 2) % (Math.PI * 2));
    minAxis = Math.min(minAxis, s.axisLen);
  }
  bearings.sort((a, b) => a - b);
  let gap = Math.PI * 2;
  for (let i = 0; i < bearings.length && bearings.length > 1; i++) {
    const nxt = bearings[(i + 1) % bearings.length];
    gap = Math.min(gap, (nxt - bearings[i] + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
  }
  const sep = bearings.length > 1 ? FIST_R / Math.sin(gap / 2) : 0;
  const clearHand = (retreatPx - TIP_CLEAR) + FIST_REACH_IN + RING_AIR;
  const clearNerve = (NERVE_RING_R + 7) + FIST_REACH_IN + RING_AIR;
  // …and never so far out that a fist leaves its own desk.
  return Math.min(Math.max(sep, clearHand, clearNerve), minAxis - FIST_R - 6);
}

// ── the defender ─────────────────────────────────────────────────────────────
/** Everything that says "a hand is down on this spot", drawn on the desk before
 * the arm: a pool of light over the middle of the desk, a solid chalk ring over
 * the baked dashed one, and gold reticle brackets. Which *kid* is down is then
 * carried by the arm itself — the one forearm reaching all the way in from its
 * own edge and lying flat on the wood, while the other five float above it with
 * shadows under them — plus the gold HUD chip at that kid's cuff. Four
 * reinforcing cues, because one was demonstrably not enough (#69). */
function markDefender(s) {
  const gl = ctx.createRadialGradient(s.spotX, s.spotY, 0, s.spotX, s.spotY, 96);
  gl.addColorStop(0, 'rgba(255,230,185,0.05)');
  gl.addColorStop(0.42, 'rgba(255,226,176,0.14)');
  gl.addColorStop(1, 'rgba(255,226,176,0)');
  ctx.fillStyle = gl;
  ctx.beginPath(); ctx.arc(s.spotX, s.spotY, 96, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = 'rgba(246,242,232,0.92)'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(s.spotX, s.spotY, 23, 0, Math.PI * 2); ctx.stroke();

  ctx.lineCap = 'round';
  for (const [col, lw] of [['rgba(24,16,6,0.55)', 6.4], [C.gold, 3.4]]) {
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    for (let k = 0; k < 4; k++) {
      const a0 = Math.PI / 4 + k * Math.PI / 2;
      ctx.beginPath(); ctx.arc(s.spotX, s.spotY, 30, a0 - 0.34, a0 + 0.34); ctx.stroke();
    }
  }
}

function drawHand(p) {
  const s = seatGeom(p.seat);
  const zone = zoneOf(p.hand.p);
  const d = p.hand.p * retreatPx;

  markDefender(s);

  ctx.save();
  ctx.translate(s.spotX, s.spotY);
  ctx.rotate(s.a);                            // +x now points at this seat's edge

  // The forearm now spans the whole desk — from this kid's edge in to the
  // middle, which is the long reach it is in the real game.
  limb(d + HAND_RX - 5, s.axisLen, 10.2, 13.5, C.handArm, C.handEdge, C.sleeveDown);
  flatHand(d, zone);

  ctx.restore();
  nerveRing(s, p);
}

/** Nerve, as a ring round the defender's strike spot. It started life as a bar
 * on the cuff, which at 375px the clamped HUD chip sat straight on top of —
 * and out here it earns its keep twice, because a meter only the kid who is
 * down ever has is one more thing saying which kid that is. */
function nerveRing(s, p) {
  const frac = Math.max(0, Math.min(1, p.hand.nerve / T.nerveMax));
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(12,10,8,0.55)'; ctx.lineWidth = NERVE_RING_W + 2;
  ctx.beginPath(); ctx.arc(s.spotX, s.spotY, NERVE_RING_R, 0, Math.PI * 2); ctx.stroke();
  if (frac > 0.001) {
    ctx.strokeStyle = p.hand.pinned ? '#e2593c'
      : p.hand.nerve < T.nerveUnpin ? '#e2593c' : '#7fd1a0';
    ctx.lineWidth = NERVE_RING_W;
    ctx.beginPath();
    ctx.arc(s.spotX, s.spotY, NERVE_RING_R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
  }
  if (p.hand.pinned) {                        // the hand has nothing left to spend
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(226,89,60,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.spotX, s.spotY, NERVE_RING_R + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawFist(p) {
  const s = seatGeom(p.seat);
  const f = p.fist;
  // Two scalars carry the whole animation: `lift` is height off the desk, `rad`
  // is distance out from the one strike spot. A winding fist rises and draws
  // back off the ring toward its owner; a dropping one falls *and travels all
  // the way in*, landing on the spot — you see the fist come down onto the hand
  // instead of dropping in place where it was hovering. A recovering fist is
  // spent and out of play: it slides back out to the ring and must read as
  // level with (never above) a resting `ready` fist, or a just-landed fist
  // looks more threatening than an armed one, inverting the one cue this game
  // is about.
  // REST is the height floor: an up kid holds their fist *off* the desk the
  // whole time, which is the cue that the one hand lying flat on the wood is
  // the defender. Only a fist that has just landed (recover) touches it.
  const ring = ringRadius();
  const REST = 0.42;
  let lift = REST, tense = 0, rad = ring;
  if (f.state === 'wind') {
    tense = Math.min(1, f.t / T.windTime);
    lift = REST + (1 - REST) * tense;
    rad = ring + WIND_BACK * tense;
  } else if (f.state === 'loaded') {
    tense = 1; lift = 1; rad = ring + WIND_BACK;
  } else if (f.state === 'drop') {
    const k = Math.min(1, f.t / T.dropTime);
    tense = 1; lift = 1 - k; rad = (ring + WIND_BACK) * (1 - k);
  } else if (f.state === 'abort') {
    const k = Math.max(0, 1 - f.t / T.abortTime);
    lift = REST + (1 - REST) * k; rad = ring + WIND_BACK * k;
  } else if (f.state === 'recover') {
    const k = Math.min(1, f.t / T.recoverTime);
    lift = REST * k; rad = ring * k;
  }
  const spent = f.state === 'recover';

  const fx = s.spotX + s.ux * rad;
  const fy = s.spotY + s.uy * rad;

  // Height, in a view with no perspective, is carried by the shadow pulling
  // away underneath and the fist growing very slightly. The flat hand never
  // gets either, which is the cue that it alone is touching the wood.
  if (lift > 0.02) {
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.34 * lift;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(fx + 12 * lift, fy + 15 * lift, 13.5 - 2 * lift, 12.5 - 2 * lift, s.a, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The fist rides its seat's own ray, so the arm behind it is that ray too:
  // it runs from the fist out to that kid's place at the desk edge and on
  // off-screen. `len` shrinks as the fist comes in, which is the reach.
  const ang = s.a;
  const len = Math.max(1, s.axisLen - rad);
  const col = spent ? C.spent
    : tense > 0 ? `rgb(${Math.round(156 + 64 * tense)},${Math.round(112 - 14 * tense)},${Math.round(80 - 12 * tense)})`
      : C.upSkin;

  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(ang);
  ctx.scale(1 + 0.10 * lift, 1 + 0.10 * lift);
  limb(9, len / (1 + 0.10 * lift), 9.2, 12.6, spent ? '#6a655d' : C.upArm, C.upEdge,
    spent ? '#8f8d86' : C.sleeveUp);
  fist(tense, col, C.upEdge, f.state === 'loaded');
  ctx.restore();

  // The load ring: how long this fist has been holding its tension. It grows
  // both ways from the inboard point, not clockwise from twelve o'clock —
  // sweeping outward put the whole of the first half-turn underneath this
  // seat's own HUD chip, where nobody could read it.
  if (f.state === 'loaded') {
    const frac = Math.min(1, f.t / 0.8);
    const mid = s.a + Math.PI;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(24,16,6,0.5)'; ctx.lineWidth = 5.6;
    ctx.beginPath(); ctx.arc(fx, fy, 25, mid - frac * Math.PI, mid + frac * Math.PI); ctx.stroke();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(fx, fy, 25, mid - frac * Math.PI, mid + frac * Math.PI); ctx.stroke();
  }
}

/** An eliminated kid: no arm drawn at all — render() simply never calls
 * drawFist for them, which already reads as "withdrawn." A gap in the ring of
 * fists is easy to miss, though, so their place on it gets struck out: a dark
 * disc and a cross exactly where their fist used to hover over the hand. The
 * difference between "gone" and "about to hit me" at a glance. */
function drawOutSeat(p) {
  const s = seatGeom(p.seat);
  const r = ringRadius();
  const x = s.spotX + s.ux * r, y = s.spotY + s.uy * r;
  ctx.beginPath(); ctx.arc(x, y, 21, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14,14,17,0.62)'; ctx.fill();
  ctx.strokeStyle = 'rgba(160,156,148,0.40)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7);
  ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7);
  ctx.stroke();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
// A chip sits on each seat's cuff — a fixed band inboard of that kid's own
// place at the desk edge, which is the one part of the desk that is still
// theirs alone now that the strike spot is shared. Measuring it out from the
// spot instead would stack all six chips in a ring round the middle, on top of
// the hand and the fists. On a 320px screen the side seats' chips would still
// run off the edge, so every box is finally clamped into the viewport.
// hudRadius returns the band, clamped against the same axisLen seatGeom
// returns rather than a second, independently-drifting guess at the same
// number, so a degenerate desk can never push a chip past the middle.
const HUD_LABEL_H = 11, HUD_PAD_Y = 4;
const HUD_BOX_H = HUD_LABEL_H + HUD_PAD_Y * 2;
const HUD_EDGE_BAND = 15;
function hudRadius() {
  let minAxis = Infinity;
  for (let i = 0; i < w.n; i++) minAxis = Math.min(minAxis, seatGeom(i).axisLen);
  return Math.min(HUD_EDGE_BAND, minAxis - HUD_BOX_H / 2 - 4);
}
const PIP_R = 3.4, PIP_GAP = 2.6;   // HP pips: fixed T.startHp slots, filled vs hollow

function drawHud() {
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const hudR = hudRadius();
  for (const p of w.players) {
    const s = seatGeom(p.seat);
    const isDown = p.id === w.down && !p.out;

    const nameW = ctx.measureText(p.name).width;
    const pipsW = T.startHp * (PIP_R * 2) + (T.startHp - 1) * PIP_GAP;
    const gap = 5, padX = 6;
    const boxW = nameW + gap + pipsW + padX * 2;
    const boxH = HUD_BOX_H;
    // clamped so no chip can leave the screen at any size — measured at 320px,
    // where the side seats' chips used to overrun the left and right edges
    const boxX = Math.max(4, Math.min(view.w - boxW - 4, s.edgeX - s.ux * hudR - boxW / 2));
    const boxY = Math.max(4, Math.min(view.h - boxH - 4, s.edgeY - s.uy * hudR - boxH / 2));
    const ly = boxY + boxH / 2;

    ctx.fillStyle = isDown ? C.gold : p.out ? 'rgba(96,96,104,0.35)' : 'rgba(10,10,12,0.82)';
    ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 6); ctx.fill();
    if (isDown) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 6); ctx.stroke();
    }

    ctx.fillStyle = isDown ? '#1b1b1f' : p.out ? '#85858d' : '#e8e4da';
    ctx.fillText(p.name, boxX + padX, ly);

    // HP as fixed slots (filled vs hollow), not a variable-length dot run — a
    // lone dot at 1 HP reads identically to a rendering glitch, but ●○○ reads
    // unambiguously as "1 of 3" at any HP total. The last point turns the same
    // red as the nerve band's danger colour.
    let px = boxX + padX + nameW + gap + PIP_R;
    for (let i = 0; i < T.startHp; i++) {
      ctx.beginPath(); ctx.arc(px, ly, PIP_R, 0, Math.PI * 2);
      if (i < p.hp) {
        ctx.fillStyle = p.hp <= 1 ? '#e2593c' : (isDown ? '#1b1b1f' : '#e8e4da');
        ctx.fill();
      } else {
        ctx.strokeStyle = isDown ? 'rgba(27,27,31,0.5)' : 'rgba(232,228,218,0.35)';
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

  // Draw order is itself a cue: the five up first, then the defender's arm over
  // the top of them. The flat hand is the last thing laid down on the desk.
  for (const p of w.players) {
    if (p.id === w.down) continue;
    if (p.out) drawOutSeat(p); else drawFist(p);
  }
  drawHand(w.players[w.down]);
  drawHud();
}

window.addEventListener('resize', () => { resize(); render(); });

// ── input: one button, both roles ────────────────────────────────────────────
let held = false;
// Browsers block navigator.vibrate until the page has seen a real user
// gesture — a tap, a key, a click — and log a console error on every call
// before that. You start the match already `down`, so a bot can land a
// thump on you before you've touched anything at all; onEvent's vibrate
// call is gated on this flag, set only by a genuine input, never by a
// harness pose. `press`'s `real` param defaults true for the DOM listeners
// below; the harness block further down passes false so a harness-driven
// press can still drive `held` without re-enabling vibrate underneath it.
let gestured = false;
// The match itself, gated behind the title screen (#69) — step() never runs
// until this is true, so nothing on the title screen can wind a fist or
// slide a hand no matter what the player holds down. press() is the single
// choke point every input path routes through (canvas pointerdown, spacebar,
// the harness' press(false)), so gating it here is enough on its own.
let started = false;
const press = (real = true) => {
  if (!started) return;
  held = true;
  if (real) gestured = true;
};
const release = () => { held = false; };

canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  gestured = true;
  if (e.code === 'Space') { e.preventDefault(); press(); }
  if ((e.key === 'r' || e.key === 'R') && started) restart();
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
let acc = 0, last = 0, frameMs = 0, rafHandle = 0, frozen = false;
const overEl = document.getElementById('over');
const overText = document.getElementById('over-text');
const titleEl = document.getElementById('title');

function frame(now) {
  const t0 = now;
  if (!last) last = now;
  acc += Math.min((now - last) / 1000, MAX_CATCHUP);
  last = now;

  if (started) {
    const inputs = { 0: { hold: held } };
    while (acc >= DT) {
      for (const e of step(w, DT, inputs)) onEvent(e);
      acc -= DT;
    }
  } else {
    acc = 0;               // the title screen is up — nothing to catch up on
  }
  render();
  frameMs = performance.now() - t0;
  // The harness pumps this manually (see below), and each call still ends
  // here and schedules a real rAF callback so the loop still works if driven
  // live. Cancel whatever is still pending first, so manual pumping can
  // never accumulate more than one real rAF in flight at a time.
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = frozen ? 0 : requestAnimationFrame(frame);
}

function onEvent(e) {
  if (e.type === 'thump' && e.target === 0 && gestured && navigator.vibrate) navigator.vibrate(30);
  if (e.type === 'over') {
    // Six players, one winner who is not necessarily you and not necessarily
    // the kid who was down last — name them by name either way.
    overText.textContent = e.winner === 0
      ? 'Your hand survived. You won.'
      : `${w.players[e.winner].name}'s hand survived. You were knocked out.`;
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
document.getElementById('again').addEventListener('click', () => { gestured = true; restart(); });

// Title screen (#69): Play arms `started` so frame() starts calling step();
// the world it starts is whatever is already sitting in `w` (fresh on first
// load, or whatever showTitle() last prepared) — Play itself never touches
// the world, matching the "mutate only via step()" rule.
function startMatch() {
  started = true;
  titleEl.hidden = true;
  gestured = true;                // clicking Play is a genuine user gesture
}

// Rules button, from the result overlay: park a fresh world and go back to
// the title so a player can re-read the rules before their next match.
function showTitle() {
  started = false;
  held = false; acc = 0;
  w = createWorld({ humans: 1, nBots: 5, seed: (Date.now() & 0xffff) || 1 });
  deskLayer = null;
  overEl.hidden = true;
  titleEl.hidden = false;
  render();
}
document.getElementById('play').addEventListener('click', startMatch);
document.getElementById('toTitle').addEventListener('click', showTitle);

resize();
render();
rafHandle = requestAnimationFrame(frame);

if (HARNESS) {
  // `frame` is exposed so a test harness can pump the real loop. Headless and
  // offscreen browsers park requestAnimationFrame at 0 Hz, so without this the
  // loop is the one part of the game that cannot be driven under test.
  // `press` here calls the real press(real=false): it still drives `held`
  // exactly like a genuine tap, but a harness pose is not a user gesture, so
  // it must not flip `gestured` and re-enable navigator.vibrate underneath a
  // headless run. hudRadius is exposed alongside seatGeom so verification can
  // read the actual clamped HUD radius rather than re-guessing the formula.
  window.__hs = {
    world: () => w, render, seatGeom, view: () => view, restart,
    press: () => press(false), release, frameMs: () => frameMs, frame,
    hudRadius, ringRadius, FIST_R, retreatPx, HAND_RX,
    // Freeze the live loop so a posed world can be photographed. The pane this
    // is verified in does *not* park rAF at 0 Hz, so a pose drifts by several
    // sim steps before a screenshot lands on it.
    freeze: () => { if (rafHandle) cancelAnimationFrame(rafHandle); rafHandle = 0; frozen = true; },
    // Title screen (#69): drive it directly under test without coordinate
    // clicks, and check whether it's currently up.
    startMatch, showTitle, titleShowing: () => !titleEl.hidden,
  };
}
