/* Runoff — host: canvas render, tilt input, camera, HUD, overlays.
 * All physics and scoring live in rules.js; this file only feeds it a tilt
 * angle and draws what comes back. */
import { makeWorld, step, T, depthM } from './rules.js';

const HARNESS = new URLSearchParams(location.search).has('harness');
const $ = (id) => document.getElementById(id);
const cv = $('view'), ctx = cv.getContext('2d');

// ── layout ────────────────────────────────────────────────────────────────
// The alley is a portrait column T.W units wide, centred; on a wide screen the
// rest is building mass.
let dpr = 1, vw = 0, vh = 0, colX = 0, colW = 0, scale = 1, VH = 200;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  vw = innerWidth; vh = innerHeight;
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  colW = Math.min(vw, vh * 0.6);
  colX = (vw - colW) / 2;
  scale = colW / T.W;
  VH = vh / scale;
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
let camY = 0;                       // world y at the top of the screen
const steam = [];                   // {x, y, age}

function start(seed) {
  world = makeWorld({ seed });
  best = loadBest();
  camY = 0;
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

// Title: an attract loop — the water sloshes down the alley behind the menu,
// tilted by a slow sine, with no sun.
function showTitle() {
  state = 'title';
  world = makeWorld({ seed: 1, sun: false });
  camY = 0;
  $('title').classList.add('show'); $('hud').classList.add('hide');
}
function attract(dtReal) {
  acc += dtReal;
  for (let n = 0; acc >= T.dt && n < 8; n++, acc -= T.dt) step(world, { tilt: Math.sin(world.t * 0.9) * 0.75 });
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
  $('drops').textContent = world.n;
  if (world.dead) gameOver();
}

// Camera: follow the body of the water, slightly ahead of its middle;
// keep a sliver of the sun in view when it's close.
function followWater(dtReal) {
  const ys = Array.from(world.y.subarray(0, world.n)).sort((a, b) => a - b);
  const focus = ys.length ? ys[Math.floor(ys.length * 0.55)] : world.sunY;
  const target = Math.max(focus - VH * 0.42, world.sunY - VH * 0.12);
  camY += (target - camY) * (1 - Math.exp(-dtReal * 4));
}

// ── render ────────────────────────────────────────────────────────────────
const C = {
  mass: '#131a22', back: '#1c2530', win: '#243040', winGlint: '#2f3f53',
  facade: '#3a4552', slab: '#7d8791', slabTop: '#b3bdc6', slabUnder: '#4a535d',
  water: '#5ec8f0', waterHi: '#d8f4ff', mark: '#8fa0b1',
};
const sx = (x) => colX + x * scale;
const sy = (y) => (y - camY) * scale;

function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function drawBackWall() {
  ctx.fillStyle = C.mass; ctx.fillRect(0, 0, vw, vh);
  ctx.fillStyle = C.back; ctx.fillRect(colX, 0, colW, vh);
  // far building's windows, parallax 0.6
  const par = 0.6, rowH = 26, top = camY * par;
  const r0 = Math.floor(top / rowH) - 1, r1 = Math.ceil((top + VH) / rowH) + 1;
  for (let r = r0; r <= r1; r++) {
    const y = (r * rowH - top) * scale;
    for (let c = 0; c < 4; c++) {
      // daylight: dark glass, a few panes catching the sky
      const x = sx(12 + c * 22), glint = hash2(r, c) < 0.15;
      ctx.fillStyle = glint ? C.winGlint : C.win;
      ctx.fillRect(x, y, 10 * scale, 14 * scale);
    }
  }
}

function drawFacades() {
  const w = 2.4 * scale;
  ctx.fillStyle = C.facade;
  ctx.fillRect(colX - w * 0.2, 0, w, vh);
  ctx.fillRect(colX + colW - w * 0.8, 0, w, vh);
  // depth marks every 10 m on the left wall
  ctx.fillStyle = C.mark; ctx.font = `${Math.max(10, 3.2 * scale)}px Trebuchet MS, sans-serif`;
  ctx.textBaseline = 'middle';
  const step10 = 10 / T.mPerU;
  for (let y = Math.ceil(camY / step10) * step10; y < camY + VH; y += step10) {
    if (y <= 0) continue;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(sx(0), sy(y), 3 * scale, 1);
    ctx.fillText(depthM(y) + ' m', sx(3.6), sy(y));
  }
  ctx.globalAlpha = 1;
}

function drawLedges() {
  const R = T.ledgeR * scale;
  ctx.lineCap = 'round';
  for (const s of world.ledges) {
    if (s.ay < camY - 10 || s.by > camY + VH + 10) continue;
    const ax = sx(s.ax), ay = sy(s.ay), bx = sx(s.bx), by = sy(s.by);
    ctx.strokeStyle = C.slabUnder; ctx.lineWidth = R * 2;
    ctx.beginPath(); ctx.moveTo(ax, ay + R * 0.35); ctx.lineTo(bx, by + R * 0.35); ctx.stroke();
    ctx.strokeStyle = C.slab; ctx.lineWidth = R * 1.8;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = C.slabTop; ctx.lineWidth = Math.max(1, R * 0.35);
    ctx.beginPath(); ctx.moveTo(ax, ay - R * 0.7); ctx.lineTo(bx, by - R * 0.7); ctx.stroke();
  }
}

// Water is drawn as metaballs: every drop stamps a soft sprite onto a
// half-resolution buffer, then one pass thresholds the summed alpha into a
// hard-edged body with a lit top surface. Beads read as marbles; this reads
// as one liquid that splits and merges.
const WDS = 2;                      // buffer downsample
const wcv = document.createElement('canvas');
const wctx = wcv.getContext('2d', { willReadFrequently: true });
let sprite = null, spriteR = 0;
const WATER_RGB = [79, 184, 230], RIM_RGB = [150, 222, 250], TOP_RGB = [222, 247, 255];
function sizeWaterBuffer() {
  wcv.width = Math.max(1, Math.ceil(colW / WDS)); wcv.height = Math.max(1, Math.ceil(vh / WDS));
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
  const W = wcv.width, H = wcv.height, k = scale / WDS, off = spriteR;
  wctx.clearRect(0, 0, W, H);
  for (let i = 0; i < world.n; i++) {
    const x = world.x[i] * k, y = (world.y[i] - camY) * k;
    if (y < -off * 2 || y > H + off * 2) continue;
    wctx.drawImage(sprite, x - off, y - off);
    const vx = world.vx[i], vy = world.vy[i];
    if (vx * vx + vy * vy > 110 * 110) wctx.drawImage(sprite, x - vx * 0.014 * k - off, y - vy * 0.014 * k - off); // trail
  }
  // threshold with a short ramp either side of TH so the upscaled edge is
  // anti-aliased rather than stair-stepped
  const img = wctx.getImageData(0, 0, W, H), px = img.data, row = W * 4, TH = 120, RAMP = 14, RIM = 158;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < TH - RAMP) { px[i + 3] = 0; continue; }
    const top = i < row || px[i - row + 3] < TH - RAMP;
    const c = top ? TOP_RGB : a < RIM ? RIM_RGB : WATER_RGB;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    px[i + 3] = a >= TH + RAMP ? 235 : 235 * (a - TH + RAMP) / (2 * RAMP);
  }
  wctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(wcv, colX, 0, W * WDS, H * WDS);
}

function drawSun(t) {
  const edge = sy(world.sunY);
  if (edge > -40) {
    const e = Math.min(vh, edge);
    if (e > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, e);
      g.addColorStop(0, '#fff6d8'); g.addColorStop(1, '#ffc25e');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(colX, 0);
      for (let x = 0; x <= T.W; x += 4) ctx.lineTo(sx(x), e + Math.sin(x * 0.18 + t * 5) * 1.2 * scale);
      ctx.lineTo(colX + colW, 0); ctx.closePath(); ctx.fill();
    }
    // heat glow bleeding below the line
    // additive, so it brightens the alley instead of browning it
    const gl = ctx.createLinearGradient(0, e, 0, e + 34 * scale);
    gl.addColorStop(0, 'rgba(255,170,60,0.4)'); gl.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gl; ctx.fillRect(colX, Math.max(0, e), colW, 34 * scale);
    ctx.globalCompositeOperation = 'source-over';
  } else if (state === 'play') {
    // sun off-screen above: say how far
    const m = Math.max(1, Math.round((camY - world.sunY) * T.mPerU));
    ctx.fillStyle = 'rgba(255,177,59,0.9)'; ctx.font = `${Math.max(12, 3.6 * scale)}px Trebuchet MS, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`☀ ${m} m above`, colX + colW / 2, 58);
    ctx.textAlign = 'left';
  }
}

function drawSteam() {
  ctx.fillStyle = '#f4efe6';
  for (const p of steam) {
    const k = p.age / 1.2;
    ctx.globalAlpha = 0.35 * (1 - k);
    ctx.beginPath();
    ctx.arc(sx(p.x + Math.sin(p.age * 6 + p.x) * 2), sy(p.y - p.age * 30), (1.5 + k * 5) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawLevel() {
  // a spirit level at the foot of the screen: where gravity points now
  const cx = colX + colW / 2, cy = vh - Math.max(26, 7 * scale), len = Math.min(120, colW * 0.34);
  ctx.strokeStyle = 'rgba(230,238,245,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - len / 2, cy); ctx.lineTo(cx + len / 2, cy); ctx.stroke();
  const bx = cx + (tilt / T.maxTilt) * len / 2;
  ctx.fillStyle = C.water;
  ctx.beginPath(); ctx.arc(bx, cy, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(94,200,240,0.7)';
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx + Math.sin(tilt) * 26, cy - 14 + Math.cos(tilt) * 10); ctx.stroke();
}

function render(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackWall();
  if (!world) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(colX, 0, colW, vh); ctx.clip();
  drawLedges();
  drawWater();
  drawSteam();
  drawSun(t);
  ctx.restore();
  drawFacades();
  if (state === 'play') drawLevel();
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
    start, get world() { return world; }, get cam() { return camY; }, get state() { return state; },
    setTilt: (a) => { pointerTilt = a; }, T,
  };
} else if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
