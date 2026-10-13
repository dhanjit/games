/* Runoff — host: canvas render, tilt input, camera, HUD, overlays.
 * All physics and scoring live in rules.js; this file only feeds it a tilt
 * angle and draws what comes back. */
import { makeWorld, step, T, depthM, bulk, houseAt, rowOf, colOf, childrenOf, TANK } from './rules.js';

const HARNESS = new URLSearchParams(location.search).has('harness');
const $ = (id) => document.getElementById(id);
const cv = $('view'), ctx = cv.getContext('2d');

// ── layout ────────────────────────────────────────────────────────────────
// The town is unbounded sideways; the view is VIEW_W world units across on a
// phone — the roof the water is on and both roofs below it — and on a wide
// screen as wide as keeps VIEW_H units in view. colW is the portrait column
// the HUD and the drag gesture are sized to.
const VIEW_W = 120, VIEW_H = 240;
let dpr = 1, vw = 0, vh = 0, colW = 0, scale = 1, VW = 140, VH = 200;
function resize() {
  vw = innerWidth; vh = innerHeight;
  // a pixel budget: a phone gets its full 2×, a big monitor a little less,
  // since the whole screen is painted every frame
  dpr = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(2.6e6 / (vw * vh)));
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  colW = Math.min(vw, vh * 0.6);
  scale = Math.min(vw / VIEW_W, vh / VIEW_H);
  VW = vw / scale; VH = vh / scale;
}
addEventListener('resize', resize);
resize();

// ── persistence ───────────────────────────────────────────────────────────
// Key kept from when there were two modes, so existing bests survive.
const BEST_KEY = 'runoff.best.chase';
const loadBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const saveBest = (m) => { try { localStorage.setItem(BEST_KEY, String(m)); } catch { /* storage off: play on */ } };

// ── input: tilt ───────────────────────────────────────────────────────────
// Sources, highest priority first: a held key, a pressed pointer (only when
// there is no gyro), the gyro. All produce a target angle; the applied tilt
// eases toward it.
const TILT_GAIN = 1.3;              // sensor degrees → gravity degrees
let gyro = null;                    // latest gyro angle, rad, or null if none
let keyDir = 0;                     // -1 / 0 / 1
let pointerTilt = null;             // rad while a tilt-drag is held
let tilt = 0;                       // applied, rad

function onOrient(e) {
  if (e.gamma == null) return;
  const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let deg = e.gamma;
  if (a === 90) deg = e.beta;
  else if (a === -90 || a === 270) deg = -e.beta;
  else if (a === 180) deg = -e.gamma;
  gyro = Math.max(-T.maxTilt, Math.min(T.maxTilt, deg * TILT_GAIN * Math.PI / 180));
  $('noTilt').style.display = 'none';
}
let orientBound = false;
async function enableGyro() {
  if (orientBound) return;
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const r = await DOE.requestPermission();
      if (r !== 'granted') return;
    }
    addEventListener('deviceorientation', onOrient);
    orientBound = true;
  } catch { /* denied or unsupported: keys and drag still work */ }
}

const keys = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'a', 'arrowright', 'd', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (state === 'over' && (k === 'enter' || k === ' ')) start();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ── input: pointer ────────────────────────────────────────────────────────
// Without a gyro, press-and-drag steers: tilt follows the pointer's sideways
// offset from where it went down. With one, touches never steer — a thumb
// resting on the glass would otherwise pin gravity straight down.
let drag = null;                    // {id, x0}
cv.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  cv.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x0: e.clientX };
});
cv.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (gyro === null) pointerTilt = Math.max(-1, Math.min(1, (e.clientX - drag.x0) / (colW * 0.3))) * T.maxTilt;
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null; pointerTilt = null;
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

function targetTilt() {
  const kd = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
  if (kd) return kd * T.maxTilt;
  if (pointerTilt !== null) return pointerTilt;
  if (gyro !== null) return gyro;
  return 0;
}

// ── run state ─────────────────────────────────────────────────────────────
let state = 'title', world = null, best = 0;
let camX = 0, camY = 0;             // world x at the screen's centre, world y at its top
let focusX = 0, focusY = 0;         // where the camera is heading: the leading water
const steam = [];                   // {x, y, age}

function aim() {
  focusX = camX = world.spoutX;
  focusY = T.Y0;
  camY = focusY - VH * 0.3;
  lead = null; clear.clear();
}

function start(seed) {
  world = makeWorld({ seed });
  best = loadBest();
  aim();
  steam.length = 0; tilt = 0;
  state = 'play';
  $('title').classList.remove('show'); $('over').classList.remove('show');
  $('hud').classList.remove('hide');
  $('best').textContent = best + ' m';
}

function gameOver() {
  state = 'over';
  const d = depthM(world.depth);
  if (d > best) { best = d; saveBest(d); }
  $('finalDepth').textContent = d;
  $('finalBest').textContent = best;
  $('over').classList.add('show');
}

// Android and desktop need no permission: listen now so the no-sensor hint
// disappears before the first run. iOS waits for the tap (requestPermission).
if (!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function')) enableGyro();

$('btnPlay').addEventListener('click', async () => {
  await enableGyro();
  start();
});
$('btnAgain').addEventListener('click', () => start());

// Title: an attract loop — water winds down the hillside behind the menu,
// tilted by a slow sine, with no sun; it starts over every 30 s.
function showTitle() {
  state = 'title';
  world = makeWorld({ seed: 1, sun: false });
  aim();
  $('title').classList.add('show'); $('hud').classList.add('hide');
}
function attract(dtReal) {
  if (world.t > 30) { world = makeWorld({ seed: 1 + Math.floor(Math.random() * 1e6), sun: false }); aim(); }
  acc += dtReal;
  for (let n = 0; acc >= T.dt && n < 8; n++, acc -= T.dt) step(world, { tilt: (tilt = Math.sin(world.t * 0.7) * 0.6) });
  acc = Math.min(acc, T.dt);
  world.steam.length = 0;
  followWater(dtReal);
}

// ── simulation clock ──────────────────────────────────────────────────────
let last = performance.now(), acc = 0, paused = false;
document.addEventListener('visibilitychange', () => { paused = document.hidden; last = performance.now(); });

function update(dtReal) {
  // ease the applied tilt toward the target at a hand's pace (matches the sim)
  const want = targetTilt(), maxD = (T.maxTilt / 0.25) * dtReal;
  const smooth = gyro !== null && pointerTilt === null && !keys.size ? 1 - Math.exp(-dtReal * 14) : 1;
  tilt += Math.max(-maxD, Math.min(maxD, (want - tilt) * smooth));

  acc += dtReal;
  let n = 0;
  while (acc >= T.dt && n < 8) {
    step(world, { tilt });
    acc -= T.dt; n++;
  }
  if (n === 8) acc = 0; // too slow to keep up: drop time rather than spiral

  for (let i = 0; i < world.steam.length; i += 2) {
    if (steam.length < 240) steam.push({ x: world.steam[i], y: world.steam[i + 1], age: 0 });
  }
  world.steam.length = 0;
  for (let i = steam.length - 1; i >= 0; i--) { steam[i].age += dtReal; if (steam[i].age > 1.2) steam.splice(i, 1); }

  followWater(dtReal);

  $('depth').textContent = depthM(world.depth) + ' m';
  $('drops').textContent = world.n + world.pending;
  if (world.dead) gameOver();
}

// Camera: follow the leading clump of water (rules.js `bulk`), leaning
// toward the roof it's headed for, with most of the screen below it to read
// the way down; keep a sliver of the sun in view when it's close.
function followWater(dtReal) {
  const b = bulk(world);
  if (b) {
    focusX = b.x; focusY = b.y;
    const r = Math.max(0, Math.floor((b.y - T.Y0 + 20) / T.DY));
    lead = houseAt(world, r, colOf(r, b.x));
  }
  tracePath();
  updateClear(dtReal);
  const next = path.length ? path[0].to.x : focusX;
  const ty = Math.max(focusY - VH * 0.3, world.sunY - VH * 0.12);
  camY += (ty - camY) * (1 - Math.exp(-dtReal * 4));
  camX += (focusX * 0.65 + next * 0.35 - camX) * (1 - Math.exp(-dtReal * 3));
}

// ── the water's neighbourhood ─────────────────────────────────────────────
// The view shows the way down, not the whole hill. Kept clear: the roofs
// holding water, the roof the lead water is on and the fork below it (both
// roofs it can drop to), and every roof the current tilt sends it across for
// PATH_ROWS rows. The rest of the town fades into mist. Tilting
// swings the path from branch to branch, so a fork can be read before
// committing to it.
const PATH_ROWS = 4;
let lead = null;                    // the house the leading water is on
const path = [];                    // [{from, to, side}] under the current tilt
let pathEnd = null;                 // the house where it stops, if it does
const clear = new Map();            // house → 0..1, eased

/* Which way water leaves h under tilt t: −1 left, +1 right, 0 it stays. The
 * tank's threshold is a hard tilt; a share stays behind even then. */
function exitSide(h, t) {
  if (h.type === TANK) return Math.abs(t) > 0.75 ? Math.sign(t) : 0;
  if (-h.dir * t > h.pitch) return -h.dir;
  return h.wall ? 0 : h.dir;
}

function tracePath() {
  path.length = 0; pathEnd = null;
  let h = lead;
  for (let k = 0; h && k < PATH_ROWS; k++) {
    const side = exitSide(h, tilt);
    if (!side) { pathEnd = h; break; }
    const [L, R] = childrenOf(h.r, h.c), to = houseAt(world, h.r + 1, side < 0 ? L : R);
    path.push({ from: h, to, side });
    h = to;
  }
}

function updateClear(dtReal) {
  const want = new Set(), held = new Map();
  for (let i = 0; i < world.n; i++) {
    const r = rowOf(world.y[i] + 8);
    if (r < 0) continue;
    const h = houseAt(world, r, colOf(r, world.x[i])), n = (held.get(h) || 0) + 1;
    held.set(h, n);
    if (n === 4) want.add(h);       // a few stray drops don't clear the mist
  }
  if (lead) {
    let lo = lead.c, hi = lead.c;
    for (let k = 0; k <= 1; k++) {
      for (let c = lo; c <= hi; c++) want.add(houseAt(world, lead.r + k, c));
      lo = childrenOf(lead.r + k, lo)[0]; hi = childrenOf(lead.r + k, hi)[1];
    }
  }
  for (const p of path) want.add(p.to);
  for (const h of want) clear.set(h, Math.min(1, (clear.get(h) || 0) + dtReal * 4));
  for (const [h, v] of clear) {
    if (want.has(h)) continue;
    if (v <= dtReal * 2.5) clear.delete(h); else clear.set(h, v - dtReal * 2.5);
  }
}

// ── render ────────────────────────────────────────────────────────────────
// A hill station just after the monsoon: pastel houses stepped down a pine
// slope under tin roofs, snow peaks far behind, mist in the valleys.
const C = {
  skyTop: '#86b9df', skyLow: '#e4eff0',
  peak: '#a9bccd', snow: '#f4f8fb', ridge: '#7d9a92', ridgePine: '#5f7f74',
  hill: '#557562', mist: '#eef4f2',
  tin: ['#b8432f', '#3f7d5a', '#365f94', '#8c5b3c', '#a33a52'],
  walls: ['#f2d58a', '#a8d8c4', '#f2b8b0', '#a9c9e8', '#d7c2e8', '#efe9dc', '#f6c48f'],
  frame: '#f8f4ea', glass: '#2c3e4f', concrete: '#d3ccbc', concreteDark: '#8e8778', tankIn: '#2e3a3f',
  pipe: '#7b8288', mark: '#3c4a44',
  flags: ['#2f6fd0', '#f4f4f0', '#d63a32', '#2f9a55', '#f2c53a'],
};
const sx = (x) => vw / 2 + (x - camX) * scale;
const sy = (y) => (y - camY) * scale;

function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
// a smooth 1-D ridge profile, in world units
const ridge = (u, a, b) => Math.sin(u * 0.011 + a) * 1 + Math.sin(u * 0.027 + b) * 0.5 + Math.sin(u * 0.063 + a * 2) * 0.22;

// ── backdrop ──────────────────────────────────────────────────────────────
// Each layer scrolls at a fraction of the camera. The peaks and the near
// ridge slide up out of view as the water descends; below them the hill face
// (a pre-drawn tile of far houses and pines) fills the screen.
const tileCv = document.createElement('canvas');
let tileW = 0, tileH = 0;
function buildTile() {
  tileW = Math.round(110 * scale); tileH = Math.round(90 * scale);
  tileCv.width = Math.round(tileW * dpr); tileCv.height = Math.round(tileH * dpr);
  const g = tileCv.getContext('2d'), u = scale * 0.55;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = C.hill; g.fillRect(0, 0, tileW, tileH);
  // far houses: small pale blocks with a dark roof line, in loose terraces
  for (let i = 0; i < 18; i++) {
    const x = hash2(i, 7) * tileW, y = ((i % 6) + hash2(i, 9) * 0.6) * tileH / 6, w = (9 + hash2(i, 3) * 8) * u, hh = (6 + hash2(i, 4) * 5) * u;
    g.globalAlpha = 0.5;
    g.fillStyle = C.walls[i % C.walls.length]; g.fillRect(x, y, w, hh);
    g.fillStyle = C.tin[i % C.tin.length]; g.fillRect(x - u, y - 1.6 * u, w + 2 * u, 1.8 * u);
    g.fillStyle = C.glass; g.fillRect(x + w * 0.3, y + hh * 0.35, 2 * u, 2.4 * u);
  }
  // pines
  g.globalAlpha = 0.85;
  for (let i = 0; i < 26; i++) {
    const x = hash2(i, 21) * tileW, y = hash2(i, 22) * tileH, s = (4 + hash2(i, 23) * 4) * u;
    g.fillStyle = i & 1 ? '#3e5f4c' : '#46695a';
    for (let k = 0; k < 3; k++) {
      g.beginPath(); g.moveTo(x, y - s * (1.6 - k * 0.45)); g.lineTo(x - s * (0.5 + k * 0.18), y - s * (0.6 - k * 0.45)); g.lineTo(x + s * (0.5 + k * 0.18), y - s * (0.6 - k * 0.45)); g.fill();
    }
  }
  g.globalAlpha = 1;
}
addEventListener('resize', buildTile);
buildTile();

function drawBackdrop(t) {
  // (only where the hill face, drawn below, won't cover it)
  const hillTop = Math.max(0, vh * 0.8 - camY * 0.35 * scale - 60 * 0.35 * scale);
  if (hillTop > 0) {
    const sky = ctx.createLinearGradient(0, 0, 0, vh);
    sky.addColorStop(0, C.skyTop); sky.addColorStop(1, C.skyLow);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, vw, Math.min(vh, hillTop + 6 * scale));
  }

  // far snow range, parallax 0.04
  const peakBase = vh * 0.42 - camY * 0.04 * scale - 60 * 0.04 * scale;
  if (peakBase > -10) {
    ctx.fillStyle = C.peak;
    ctx.beginPath(); ctx.moveTo(0, vh);
    for (let x = 0; x <= vw + 8; x += 8) {
      const u = (x - vw / 2) / scale + camX * 0.04;
      ctx.lineTo(x, peakBase - (34 + ridge(u, 1.3, 0.4) * 22) * scale * 0.9);
    }
    ctx.lineTo(vw, vh); ctx.closePath(); ctx.fill();
    // snow above a line just under the tallest peaks
    ctx.save(); ctx.clip();
    ctx.fillStyle = C.snow; ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 0, vw, peakBase - 42 * scale * 0.9);
    ctx.restore();
  }
  // near ridge with pines, parallax 0.12
  const ridgeBase = vh * 0.62 - camY * 0.12 * scale - 60 * 0.12 * scale;
  if (ridgeBase > -40) {
    ctx.fillStyle = C.ridge;
    ctx.beginPath(); ctx.moveTo(0, vh);
    for (let x = 0; x <= vw + 6; x += 6) {
      const u = (x - vw / 2) / scale + camX * 0.12;
      ctx.lineTo(x, ridgeBase - (16 + ridge(u, 4.1, 2.2) * 9) * scale);
    }
    ctx.lineTo(vw, vh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.ridgePine;
    for (let k = Math.floor((camX * 0.12 - VW / 2) / 7) - 1; k * 7 < camX * 0.12 + VW / 2 + 7; k++) {
      const u = k * 7 + hash2(k, 5) * 4, x = sx(u + camX - camX * 0.12), h = (4 + hash2(k, 6) * 5) * scale;
      const y = ridgeBase - (16 + ridge(u, 4.1, 2.2) * 9) * scale + 2 * scale;
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x - h * 0.32, y); ctx.lineTo(x + h * 0.32, y); ctx.fill();
    }
  }
  // the hill face behind the town, parallax 0.35
  if (hillTop < vh) {
    const ox = -(((camX * 0.35 * scale) % tileW) + tileW) % tileW, oy = -(((camY * 0.35 * scale) % tileH) + tileH) % tileH;
    ctx.save(); ctx.beginPath(); ctx.rect(0, hillTop, vw, vh - hillTop); ctx.clip();
    for (let y = oy; y < vh; y += tileH) for (let x = ox; x < vw; x += tileW) ctx.drawImage(tileCv, x, y, tileW, tileH);
    ctx.restore();
    if (hillTop > 0) { // soften the hill's top edge into the ridge
      const e = ctx.createLinearGradient(0, hillTop - 6 * scale, 0, hillTop + 4 * scale);
      e.addColorStop(0, 'rgba(85,117,98,0)'); e.addColorStop(1, 'rgba(85,117,98,1)');
      ctx.fillStyle = e; ctx.fillRect(0, hillTop - 6 * scale, vw, 10 * scale);
    }
  }
  // mist bands drifting across the valley, parallax 0.6
  ctx.fillStyle = C.mist;
  for (let k = Math.floor(camY * 0.6 / 70) - 1; k * 70 < camY * 0.6 + VH + 70; k++) {
    const y = (k * 70 + hash2(k, 11) * 30 - camY * 0.6) * scale;
    const wx = (((hash2(k, 13) * 600 + t * (3 + hash2(k, 12) * 4) - camX * 0.6) % 600) + 600) % 600 - 300;
    const x = vw / 2 + wx * scale;
    ctx.globalAlpha = 0.14 + hash2(k, 14) * 0.1;
    ctx.beginPath(); ctx.ellipse(x, y, (90 + hash2(k, 15) * 60) * scale, 7 * scale, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── the town ──────────────────────────────────────────────────────────────
const BODY = 18;                    // house body half-width (the roof overhangs it)
const roofYAt = (h, x) => h.ry + h.dir * (x - h.x) / T.eave * h.rise / 2;

function drawBody(h) {
  const x = h.x, bot = h.ry + T.DY - 2, pick = hash2(h.r * 3 + 1, h.c);
  const yl = h.type === TANK ? h.ry + T.tankFloor + T.roofR : roofYAt(h, x - BODY);
  const yr = h.type === TANK ? yl : roofYAt(h, x + BODY);
  ctx.fillStyle = C.walls[Math.floor(pick * C.walls.length)];
  ctx.beginPath();
  ctx.moveTo(sx(x - BODY), sy(yl)); ctx.lineTo(sx(x + BODY), sy(yr));
  ctx.lineTo(sx(x + BODY), sy(bot)); ctx.lineTo(sx(x - BODY), sy(bot)); ctx.closePath(); ctx.fill();
  // shade under the eave and down one side
  const top = Math.max(yl, yr);
  const g = ctx.createLinearGradient(0, sy(top - 2), 0, sy(top + 6));
  g.addColorStop(0, 'rgba(30,25,20,0.28)'); g.addColorStop(1, 'rgba(30,25,20,0)');
  ctx.fillStyle = g; ctx.fillRect(sx(x - BODY), sy(Math.min(yl, yr)), 2 * BODY * scale, (top - Math.min(yl, yr) + 8) * scale);
  ctx.fillStyle = 'rgba(30,25,20,0.08)'; ctx.fillRect(sx(x + BODY - 4), sy(yr), 4 * scale, (bot - yr) * scale);
  // windows: one or two, wooden-framed, some with curtains
  const nWin = pick < 0.5 ? 2 : 1, wy = top + 8;
  for (let k = 0; k < nWin; k++) {
    const wx = nWin === 2 ? x + (k ? 7 : -7) : x + (hash2(h.r, h.c * 5) - 0.5) * 12;
    ctx.fillStyle = C.frame; ctx.fillRect(sx(wx - 3.6), sy(wy - 0.8), 7.2 * scale, 9.6 * scale);
    ctx.fillStyle = C.glass; ctx.fillRect(sx(wx - 2.8), sy(wy), 5.6 * scale, 8 * scale);
    if (hash2(h.c, h.r + k) < 0.4) { ctx.fillStyle = C.tin[(h.r + h.c + k) % C.tin.length]; ctx.globalAlpha = 0.7; ctx.fillRect(sx(wx - 2.8), sy(wy), 2 * scale, 8 * scale); ctx.globalAlpha = 1; }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(sx(wx + 0.5), sy(wy)); ctx.lineTo(sx(wx + 2.8), sy(wy)); ctx.lineTo(sx(wx + 2.8), sy(wy + 2.5)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.frame; ctx.fillRect(sx(wx - 2.8), sy(wy + 3.6), 5.6 * scale, 0.7 * scale);
  }
}

function drawSlab(ax, ay, bx, by, r, fill, edge) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = fill; ctx.lineWidth = r * 2 * scale;
  ctx.beginPath(); ctx.moveTo(sx(ax), sy(ay)); ctx.lineTo(sx(bx), sy(by)); ctx.stroke();
  ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, r * 0.5 * scale);
  ctx.beginPath(); ctx.moveTo(sx(ax), sy(ay - r * 0.62)); ctx.lineTo(sx(bx), sy(by - r * 0.62)); ctx.stroke();
}

function drawWall(x, yBot, yTop) {
  const w = T.wallR + 0.4;
  ctx.fillStyle = C.concreteDark; ctx.fillRect(sx(x - w - 0.4), sy(yTop - 0.4), (2 * w + 0.8) * scale, (yBot - yTop + 0.8) * scale);
  ctx.fillStyle = C.concrete; ctx.fillRect(sx(x - w), sy(yTop), 2 * w * scale, (yBot - yTop) * scale);
}

function drawRoof(h) {
  if (h.type === TANK) {
    // an open concrete cistern: dark, still water-stained inside
    const x = h.x, hw = T.tankHalf, fy = h.ry + T.tankFloor, ty = fy - T.tankWall;
    const g = ctx.createLinearGradient(0, sy(ty), 0, sy(fy));
    g.addColorStop(0, 'rgba(38,58,62,0.88)'); g.addColorStop(1, 'rgba(22,34,38,0.95)');
    ctx.fillStyle = g; ctx.fillRect(sx(x - hw), sy(ty), 2 * hw * scale, (fy - ty) * scale);
    ctx.fillStyle = 'rgba(120,150,140,0.18)'; ctx.fillRect(sx(x - hw), sy(fy - 7), 2 * hw * scale, 2 * scale);
    drawSlab(x - hw, fy, x + hw, fy, T.roofR, C.concreteDark, C.concrete);
    drawSlab(x - hw, fy, x - hw, ty, T.roofR, C.concrete, '#ece6d8');
    drawSlab(x + hw, fy, x + hw, ty, T.roofR, C.concrete, '#ece6d8');
    return;
  }
  const s = h.segs[0], tin = C.tin[Math.floor(hash2(h.r * 7 + 3, h.c) * C.tin.length)];
  // the roof plane receding above its front edge, ribbed
  const back = 5;
  ctx.fillStyle = tin; ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(sx(s[0]), sy(s[1])); ctx.lineTo(sx(s[2]), sy(s[3]));
  ctx.lineTo(sx(s[2]), sy(s[3] - back)); ctx.lineTo(sx(s[0]), sy(s[1] - back)); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = Math.max(1, 0.4 * scale);
  ctx.beginPath();
  for (let u = 0.04; u < 1; u += 0.07) {
    const px = s[0] + (s[2] - s[0]) * u, py = s[1] + (s[3] - s[1]) * u;
    ctx.moveTo(sx(px), sy(py - 1)); ctx.lineTo(sx(px), sy(py - back + 0.5));
  }
  ctx.stroke();
  drawSlab(s[0], s[1], s[2], s[3], T.roofR, tin, 'rgba(255,255,255,0.45)');
  // a gutter lip at the low eave
  ctx.fillStyle = C.pipe;
  ctx.beginPath(); ctx.arc(sx(s[2]), sy(s[3] + 0.6), 1.5 * scale, 0, Math.PI); ctx.fill();
  if (h.wall) drawWall(s[2], s[3] + T.roofR * 0.5, s[3] - T.parapet);
  if (h.r === 0 && h.c === 0) drawWall(s[0], s[1] + T.roofR * 0.5, s[1] - T.parapet);
}

// prayer flags strung across some drain slots, between neighbouring roofs
function drawFlags(r, c) {
  if (hash2(r * 13 + 5, c) > 0.16) return;
  const a = houseAt(world, r, c), b = houseAt(world, r, c + 1);
  if (a.type === TANK || b.type === TANK) return;
  const x0 = a.x + 9, x1 = b.x - 9, y0 = roofYAt(a, x0) - 10, y1 = roofYAt(b, x1) - 10;
  ctx.strokeStyle = 'rgba(60,50,40,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath();
  const N = 9;
  for (let k = 0; k <= N; k++) {
    const u = k / N, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 5;
    k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y));
  }
  ctx.stroke();
  for (let k = 1; k < N; k++) {
    const u = k / N, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 5;
    ctx.fillStyle = C.flags[(k + r + c) % 5];
    ctx.fillRect(sx(x - 1.1), sy(y), 2.2 * scale, 2.8 * scale);
  }
}

function drawTown() {
  const r0 = Math.max(0, rowOf(camY) - 1), r1 = rowOf(camY + VH) + 1;
  for (let r = r0; r <= r1; r++) {
    const c0 = colOf(r, camX - VW / 2) - 1, c1 = colOf(r, camX + VW / 2) + 1;
    for (let c = c0; c <= c1; c++) drawBody(houseAt(world, r, c));
    for (let c = c0; c <= c1; c++) drawRoof(houseAt(world, r, c));
    for (let c = c0; c < c1; c++) drawFlags(r, c);
  }
  // the downpipe the rain arrives through
  const px = world.spoutX - world.spoutDir * 2, py = world.spoutY - 2;
  ctx.lineCap = 'butt'; ctx.strokeStyle = C.pipe; ctx.lineWidth = 3.4 * scale;
  ctx.beginPath(); ctx.moveTo(sx(px), sy(py - 160)); ctx.lineTo(sx(px), sy(py));
  ctx.lineTo(sx(px + world.spoutDir * 2.5), sy(py + 1.5)); ctx.stroke();
}

function drawRuler() {
  // depth marks every 10 m down the left edge
  ctx.fillStyle = C.mark; ctx.font = `${Math.max(10, 3.2 * scale)}px Trebuchet MS, sans-serif`;
  ctx.textBaseline = 'middle';
  const step10 = 10 / T.mPerU;
  for (let y = Math.ceil(camY / step10) * step10; y < camY + VH; y += step10) {
    if (y <= 0) continue;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, sy(y), 3 * scale, 1.5);
    ctx.fillText(depthM(y) + ' m', 3.6 * scale, sy(y));
  }
  ctx.globalAlpha = 1;
}

// Water is drawn as metaballs: every drop stamps a soft sprite onto a
// half-resolution buffer, then one pass thresholds the summed alpha into a
// hard-edged body with a lit top surface. Beads read as marbles; this reads
// as one liquid that splits and merges.
const WDS = 2;                      // buffer downsample
const wcv = document.createElement('canvas');
const wctx = wcv.getContext('2d', { willReadFrequently: true });
let sprite = null, spriteR = 0;
const WATER_RGB = [34, 128, 212], RIM_RGB = [92, 178, 238], TOP_RGB = [214, 240, 255];
function sizeWaterBuffer() {
  wcv.width = Math.max(1, Math.ceil(vw / WDS)); wcv.height = Math.max(1, Math.ceil(vh / WDS));
  spriteR = Math.max(2, 3.2 * scale / WDS);
  const d = Math.ceil(spriteR * 2);
  sprite = document.createElement('canvas'); sprite.width = sprite.height = d;
  const g = sprite.getContext('2d'), rg = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, spriteR);
  // alpha ≈ (1 − r²)²: an isolated drop crosses the threshold at ~0.54 R
  [[0, 1], [0.25, 0.88], [0.5, 0.56], [0.75, 0.19], [1, 0]].forEach(([t, a]) => rg.addColorStop(t, `rgba(255,255,255,${a})`));
  g.fillStyle = rg; g.fillRect(0, 0, d, d);
}
addEventListener('resize', sizeWaterBuffer);
sizeWaterBuffer();

function drawWater() {
  const W = wcv.width, H = wcv.height, k = scale / WDS, off = spriteR, ox = W / 2 - camX * k;
  wctx.clearRect(0, 0, W, H);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < world.n; i++) {
    const x = ox + world.x[i] * k, y = (world.y[i] - camY) * k;
    if (y < -off * 2 || y > H + off * 2 || x < -off * 2 || x > W + off * 2) continue;
    wctx.drawImage(sprite, x - off, y - off);
    const vx = world.vx[i], vy = world.vy[i];
    let tx = x, ty = y;
    if (vx * vx + vy * vy > 110 * 110) { tx = x - vx * 0.014 * k; ty = y - vy * 0.014 * k; wctx.drawImage(sprite, tx - off, ty - off); } // trail
    x0 = Math.min(x0, x, tx); x1 = Math.max(x1, x, tx); y0 = Math.min(y0, y, ty); y1 = Math.max(y1, y, ty);
  }
  // threshold only the box the drops cover — reading pixels back is the
  // expensive part — with a short ramp either side of TH so the upscaled edge
  // is anti-aliased rather than stair-stepped
  x0 = Math.max(0, Math.floor(x0 - off)); y0 = Math.max(0, Math.floor(y0 - off));
  x1 = Math.min(W, Math.ceil(x1 + off)); y1 = Math.min(H, Math.ceil(y1 + off));
  if (x1 <= x0 || y1 <= y0) return;
  const bw = x1 - x0, bh = y1 - y0;
  const img = wctx.getImageData(x0, y0, bw, bh), px = img.data, row = bw * 4, TH = 120, RAMP = 14, RIM = 158;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < TH - RAMP) { px[i + 3] = 0; continue; }
    const top = i < row || px[i - row + 3] < TH - RAMP;
    const c = top ? TOP_RGB : a < RIM ? RIM_RGB : WATER_RGB;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    px[i + 3] = a >= TH + RAMP ? 240 : 240 * (a - TH + RAMP) / (2 * RAMP);
  }
  wctx.putImageData(img, x0, y0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(wcv, x0, y0, bw, bh, x0 * WDS, y0 * WDS, bw * WDS, bh * WDS);
}

// The mist: a pale veil over the whole view, wiped away where the water's
// neighbourhood is by one soft elliptical puff per house (destination-out,
// eased per house), so the clear patch reads as fog parting, not a cut-out.
const veil = document.createElement('canvas'), vctx = veil.getContext('2d');
const puff = document.createElement('canvas');
puff.width = puff.height = 128;
{
  const g = puff.getContext('2d'), rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, '#000'); rg.addColorStop(0.55, '#000'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
}
function sizeVeil() { veil.width = cv.width; veil.height = cv.height; }
addEventListener('resize', sizeVeil);
sizeVeil();
function drawMist() {
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vctx.globalCompositeOperation = 'source-over'; vctx.globalAlpha = 1;
  vctx.clearRect(0, 0, vw, vh);
  vctx.fillStyle = 'rgba(232,240,238,0.66)'; vctx.fillRect(0, 0, vw, vh);
  vctx.globalCompositeOperation = 'destination-out';
  const rx = T.eave + 18, ry = 38;
  for (const [h, v] of clear) {
    vctx.globalAlpha = v;
    vctx.drawImage(puff, sx(h.x - rx), sy(h.ry + 4 - ry), 2 * rx * scale, 2 * ry * scale);
  }
  ctx.drawImage(veil, 0, 0, vw, vh);
}

// The path under the current tilt: droplets drifting roof to roof, fading
// with distance, and a ring where the water would stop.
const roofAt = (h, x) => h.type === TANK ? h.ry + T.tankFloor - T.roofR : roofYAt(h, Math.max(h.x - T.eave, Math.min(h.x + T.eave, x))) - T.roofR;
function drawPath(t) {
  if (!lead) return;
  const pts = [[focusX, roofAt(lead, focusX)]];
  for (const { from, to, side } of path) {
    const ex = from.x + side * (from.type === TANK ? T.tankHalf : T.eave);
    pts.push([ex, from.type === TANK ? from.ry + T.tankFloor - T.tankWall - T.roofR : roofAt(from, ex)], [ex, roofAt(to, ex)]);
  }
  if (path.length) { const l = path[path.length - 1].to; pts.push([l.x, roofAt(l, l.x)]); }
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const GAP = 4.5;
  let d = (t * 14) % GAP;
  for (let i = 1, run = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay);
    for (; d < run + len; d += GAP) {
      const u = (d - run) / len, x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
      ctx.globalAlpha = 0.9 * (1 - d / (total + GAP));
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2280d4'; ctx.lineWidth = Math.max(1, 0.35 * scale);
      ctx.beginPath(); ctx.arc(sx(x), sy(y - 1.4), 0.95 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    run += len;
  }
  ctx.globalAlpha = 1;
  if (pathEnd) {
    // where the water would stop: in a tank, or against a parapet
    const x = pathEnd.type === TANK ? pathEnd.x : pathEnd.x + pathEnd.dir * (T.eave - 4);
    const y = pathEnd.type === TANK ? pathEnd.ry - 4 : roofYAt(pathEnd, x) - 5;
    ctx.strokeStyle = '#e8762c'; ctx.lineWidth = Math.max(2, 0.7 * scale);
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 6);
    ctx.beginPath(); ctx.arc(sx(x), sy(y), 5 * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawSun(t) {
  const edge = sy(world.sunY);
  if (edge > -40) {
    const e = Math.min(vh, edge);
    if (e > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, e);
      g.addColorStop(0, '#fff6d8'); g.addColorStop(1, '#ffc25e');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let x = 0; x <= vw + 8; x += 8) ctx.lineTo(x, e + Math.sin((x / scale + camX) * 0.18 + t * 5) * 1.2 * scale);
      ctx.lineTo(vw, 0); ctx.closePath(); ctx.fill();
    }
    // heat glow bleeding below the line
    // additive, so it brightens the town instead of browning it
    const gl = ctx.createLinearGradient(0, e, 0, e + 34 * scale);
    gl.addColorStop(0, 'rgba(255,170,60,0.4)'); gl.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gl; ctx.fillRect(0, Math.max(0, e), vw, 34 * scale);
    ctx.globalCompositeOperation = 'source-over';
  } else if (state === 'play') {
    // sun off-screen above: say how far
    const m = Math.max(1, Math.round((camY - world.sunY) * T.mPerU));
    ctx.fillStyle = '#c26a12'; ctx.font = `bold ${Math.max(12, 3.6 * scale)}px Trebuchet MS, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`☀ ${m} m above`, vw / 2, 58);
    ctx.textAlign = 'left';
  }
}

function drawSteam() {
  ctx.fillStyle = '#ffffff';
  for (const p of steam) {
    const k = p.age / 1.2;
    ctx.globalAlpha = 0.45 * (1 - k);
    ctx.beginPath();
    ctx.arc(sx(p.x + Math.sin(p.age * 6 + p.x) * 2), sy(p.y - p.age * 30), (1.5 + k * 5) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawLevel() {
  // a spirit level at the foot of the screen: where gravity points now
  const cx = vw / 2, cy = vh - Math.max(26, 7 * scale), len = Math.min(120, colW * 0.34);
  ctx.strokeStyle = 'rgba(20,30,28,0.45)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - len / 2, cy); ctx.lineTo(cx + len / 2, cy); ctx.stroke();
  const bx = cx + (tilt / T.maxTilt) * len / 2;
  ctx.fillStyle = '#2280d4';
  ctx.beginPath(); ctx.arc(bx, cy, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(34,128,212,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx + Math.sin(tilt) * 26, cy - 14 + Math.cos(tilt) * 10); ctx.stroke();
}

function render(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!world) return;
  drawBackdrop(t);
  drawTown();
  drawMist();
  drawPath(t);
  drawWater();
  drawSteam();
  drawSun(t);
  drawRuler();
  if (state === 'play') {
    // a scrim behind the HUD so it reads over pale walls and sky
    const g = ctx.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, 'rgba(16,24,22,0.5)'); g.addColorStop(1, 'rgba(16,24,22,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, 96);
    drawLevel();
  }
}

function frame(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'play' && !paused) update(dtReal);
  else if (state === 'title' && !paused) attract(dtReal);
  render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

showTitle();

if (HARNESS) {
  window.__ro = {
    start, get world() { return world; }, get cam() { return { x: camX, y: camY }; }, get state() { return state; },
    setTilt: (a) => { pointerTilt = a; }, T,
  };
} else if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
