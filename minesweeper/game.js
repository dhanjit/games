/* Infinite Minesweeper — canvas render, camera, input, HUD.
 * All rules live in rules.js; this file reads the world and calls
 * reveal()/toggleFlag(). Theme: a surveyor's chart — dark fog of the
 * uncharted, cream paper where you've swept, ink digits, pennant flags. */
import { makeWorld, reveal, toggleFlag, chord, isMine, FLAG, BOOM, key } from './rules.js';

const HARNESS = new URLSearchParams(location.search).has('harness');

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  fogA: '#232a33', fogB: '#28303a',      // covered, two tones so the fog has grain
  fogLine: '#1c222a',
  paper: '#efe6d0', paperEdge: '#d9cdb0', // revealed
  gridInk: 'rgba(90, 78, 54, 0.18)',
  boom: '#c9402e', boomBg: '#2e1512',
  flagPole: '#4a3f2d', flag: '#c9402e',
  digits: ['', '#33568f', '#3b7a48', '#b03a2e', '#6b4a9e', '#8a5a28', '#2a7f7f', '#41403c', '#8c8676'],
};

// ── camera ───────────────────────────────────────────────────────────────────
const ZOOM_MIN = 3, ZOOM_MAX = 64, DIGIT_MIN = 9, GRID_MIN = 12, ZOOM_START = 34;
const cam = { x: 0.5, y: 0.5, scale: ZOOM_START, glide: null }; // x,y = world coords at canvas centre

// ── state ────────────────────────────────────────────────────────────────────
const RUN_KEY = 'minesweeper.run', BEST_KEY = 'minesweeper.best';
let world = null;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let saveTimer = 0;

function newRun(seed) {
  world = makeWorld(seed !== undefined ? { seed } : {});
  cam.x = 0.5; cam.y = 0.5; cam.scale = ZOOM_START; cam.glide = null;
  hideOverlays();
  updateHud();
  scheduleSave();
}

function saveRun() {
  saveTimer = 0;
  if (!world || world.dead) { localStorage.removeItem(RUN_KEY); return; }
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify({
      seed: world.seed, density: world.density, origin: world.origin,
      revealed: world.revealed, flags: world.flags,
      cells: [...world.cells],
    }));
  } catch { /* quota — drop the save, the game goes on */ }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveRun, 800);
}
function loadRun() {
  try {
    const s = JSON.parse(localStorage.getItem(RUN_KEY));
    if (!s || !Array.isArray(s.cells)) return false;
    world = makeWorld({ seed: s.seed, density: s.density });
    world.origin = s.origin;
    world.revealed = s.revealed; world.flags = s.flags;
    world.cells = new Map(s.cells);
    if (world.origin) { cam.x = world.origin.x + 0.5; cam.y = world.origin.y + 0.5; }
    return true;
  } catch { return false; }
}

// ── canvas ───────────────────────────────────────────────────────────────────
const cv = document.getElementById('board');
const cx2d = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
new ResizeObserver(resize).observe(cv);
resize();

const cellAt = (px, py) => [
  Math.floor(cam.x + (px - W / 2) / cam.scale),
  Math.floor(cam.y + (py - H / 2) / cam.scale),
];

// ── render ───────────────────────────────────────────────────────────────────
function render() {
  const s = cam.scale;
  cx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx2d.fillStyle = C.fogA;
  cx2d.fillRect(0, 0, W, H);

  const x0 = Math.floor(cam.x - W / 2 / s), x1 = Math.ceil(cam.x + W / 2 / s);
  const y0 = Math.floor(cam.y - H / 2 / s), y1 = Math.ceil(cam.y + H / 2 / s);
  const sx = (x) => (x - cam.x) * s + W / 2;
  const sy = (y) => (y - cam.y) * s + H / 2;
  const rectCells = (x1 - x0 + 1) * (y1 - y0 + 1);

  // fog grain + grid, only when cells are big enough to read
  if (s >= GRID_MIN) {
    cx2d.fillStyle = C.fogB;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if ((x + y) & 1) cx2d.fillRect(sx(x), sy(y), s, s);
    cx2d.strokeStyle = C.fogLine;
    cx2d.lineWidth = 1;
    cx2d.beginPath();
    for (let x = x0; x <= x1; x++) { cx2d.moveTo(sx(x), 0); cx2d.lineTo(sx(x), H); }
    for (let y = y0; y <= y1; y++) { cx2d.moveTo(0, sy(y)); cx2d.lineTo(W, sy(y)); }
    cx2d.stroke();
  }

  /* Iterate whichever is smaller: the visible rect (lookup per cell) or the
   * revealed Map (skip off-screen). Zoomed in, the rect wins; zoomed way out
   * over a long run, the Map wins and the fog needs no per-cell work. */
  const drawCell = (x, y, st) => {
    const px = sx(x), py = sy(y);
    if (st === FLAG) { drawFlag(px, py, s); return; }
    if (st === BOOM) { drawBoom(px, py, s); return; }
    // revealed number
    cx2d.fillStyle = C.paper;
    cx2d.fillRect(px, py, s, s);
    if (s >= GRID_MIN) {
      cx2d.strokeStyle = C.gridInk;
      cx2d.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    }
    if (st > 0 && s >= DIGIT_MIN) {
      cx2d.fillStyle = C.digits[st];
      cx2d.font = `600 ${Math.round(s * 0.55)}px "Georgia", serif`;
      cx2d.textAlign = 'center'; cx2d.textBaseline = 'middle';
      cx2d.fillText(st, px + s / 2, py + s / 2 + s * 0.04);
    }
  };

  if (world) {
    if (rectCells <= world.cells.size) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const st = world.cells.get(key(x, y));
          if (st !== undefined) drawCell(x, y, st);
        }
    } else {
      for (const [k, st] of world.cells) {
        const i = k.indexOf(',');
        const x = +k.slice(0, i), y = +k.slice(i + 1);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) drawCell(x, y, st);
      }
    }
    // after death, chart the mines in view (gated: hash per cell over the rect)
    if (world.dead && s >= 7 && rectCells <= 40000) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const k = key(x, y);
          const st = world.cells.get(k);
          if (st === undefined && isMine(world, x, y)) drawMineDot(sx(x), sy(y), s);
          else if (st === FLAG && !isMine(world, x, y)) drawWrongFlag(sx(x), sy(y), s);
        }
    }
  }

  // origin marker
  if (world && world.origin && !cam.glide) {
    const px = sx(world.origin.x + 0.5), py = sy(world.origin.y + 0.5);
    if (px < -20 || px > W + 20 || py < -20 || py > H + 20) drawOriginArrow(px, py);
  }
}

function drawFlag(px, py, s) {
  cx2d.fillStyle = C.fogB;
  cx2d.fillRect(px, py, s, s);
  if (s < 6) { cx2d.fillStyle = C.flag; cx2d.fillRect(px + s * 0.25, py + s * 0.25, s * 0.5, s * 0.5); return; }
  cx2d.strokeStyle = C.flagPole; cx2d.lineWidth = Math.max(1, s * 0.07);
  cx2d.beginPath();
  cx2d.moveTo(px + s * 0.38, py + s * 0.8); cx2d.lineTo(px + s * 0.38, py + s * 0.18);
  cx2d.stroke();
  cx2d.fillStyle = C.flag;
  cx2d.beginPath();
  cx2d.moveTo(px + s * 0.38, py + s * 0.18);
  cx2d.lineTo(px + s * 0.78, py + s * 0.32);
  cx2d.lineTo(px + s * 0.38, py + s * 0.46);
  cx2d.fill();
}
function drawBoom(px, py, s) {
  cx2d.fillStyle = C.boomBg; cx2d.fillRect(px, py, s, s);
  cx2d.fillStyle = C.boom;
  const c = s / 2, r = s * 0.28;
  cx2d.beginPath(); cx2d.arc(px + c, py + c, r, 0, Math.PI * 2); cx2d.fill();
  cx2d.strokeStyle = C.boom; cx2d.lineWidth = Math.max(1, s * 0.06);
  cx2d.beginPath();
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2;
    cx2d.moveTo(px + c + Math.cos(t) * r, py + c + Math.sin(t) * r);
    cx2d.lineTo(px + c + Math.cos(t) * r * 1.6, py + c + Math.sin(t) * r * 1.6);
  }
  cx2d.stroke();
}
function drawMineDot(px, py, s) {
  cx2d.fillStyle = 'rgba(201, 64, 46, 0.75)';
  const c = s / 2;
  cx2d.beginPath(); cx2d.arc(px + c, py + c, Math.max(1.5, s * 0.18), 0, Math.PI * 2); cx2d.fill();
}
function drawWrongFlag(px, py, s) {
  cx2d.strokeStyle = '#e0d6be'; cx2d.lineWidth = Math.max(1, s * 0.08);
  cx2d.beginPath();
  cx2d.moveTo(px + s * 0.25, py + s * 0.25); cx2d.lineTo(px + s * 0.75, py + s * 0.75);
  cx2d.moveTo(px + s * 0.75, py + s * 0.25); cx2d.lineTo(px + s * 0.25, py + s * 0.75);
  cx2d.stroke();
}
function drawOriginArrow(px, py) {
  const mx = Math.max(28, Math.min(W - 28, px)), my = Math.max(28, Math.min(H - 28, py));
  const a = Math.atan2(py - my, px - mx);
  cx2d.save();
  cx2d.translate(mx, my); cx2d.rotate(a);
  cx2d.fillStyle = 'rgba(239, 230, 208, 0.8)';
  cx2d.beginPath();
  cx2d.moveTo(12, 0); cx2d.lineTo(-6, -7); cx2d.lineTo(-2, 0); cx2d.lineTo(-6, 7);
  cx2d.fill();
  cx2d.restore();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function updateHud() {
  $('score').textContent = world ? world.revealed : 0;
  $('best').textContent = best;
  $('flags').textContent = world ? world.flags : 0;
}
function hideOverlays() {
  $('over').classList.remove('show');
  $('help').classList.remove('show');
}

function onBoom() {
  if (world.revealed > best) {
    best = world.revealed;
    localStorage.setItem(BEST_KEY, best);
  }
  localStorage.removeItem(RUN_KEY);
  updateHud();
  if (navigator.vibrate) navigator.vibrate(120);
  $('finalScore').textContent = world.revealed;
  $('finalBest').textContent = best;
  setTimeout(() => $('over').classList.add('show'), 550);
}

function doReveal(x, y) {
  if (!world || world.dead) return;
  // a tap on a satisfied revealed number chords; on a covered cell it reveals
  const res = reveal(world, x, y) ?? chord(world, x, y);
  if (!res) return;
  if (res.type === 'boom') onBoom();
  else { updateHud(); scheduleSave(); }
}
function doFlag(x, y) {
  if (!world || world.dead) return;
  if (toggleFlag(world, x, y)) {
    if (navigator.vibrate) navigator.vibrate(15);
    updateHud(); scheduleSave();
  }
}

// ── input ────────────────────────────────────────────────────────────────────
const pointers = new Map(); // pointerId → {x, y}
let gesture = null;         // null | 'tap' | 'pan' | 'pinch' | 'spent'
let tapStart = null, longPress = 0, pinchDist = 0;
const keys = new Set();

cv.addEventListener('pointerdown', (e) => {
  try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  cam.glide = null;
  if (pointers.size === 2) {
    clearTimeout(longPress);
    gesture = 'pinch';
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  } else if (pointers.size === 1) {
    gesture = 'tap';
    tapStart = { x: e.offsetX, y: e.offsetY, button: e.button };
    if (e.pointerType === 'touch') {
      longPress = setTimeout(() => {
        if (gesture === 'tap') {
          gesture = 'spent';
          doFlag(...cellAt(tapStart.x, tapStart.y));
        }
      }, 420);
    }
  }
});
cv.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const nx = e.offsetX, ny = e.offsetY;
  if (gesture === 'pinch' && pointers.size === 2) {
    p.x = nx; p.y = ny;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
    pinchDist = d;
    return;
  }
  if (gesture === 'tap') {
    const slop = e.pointerType === 'touch' ? 9 : 5;
    if (Math.hypot(nx - tapStart.x, ny - tapStart.y) > slop) {
      gesture = 'pan';
      clearTimeout(longPress);
    }
  }
  if (gesture === 'pan') {
    cam.x -= (nx - p.x) / cam.scale;
    cam.y -= (ny - p.y) / cam.scale;
  }
  p.x = nx; p.y = ny;
});
const endPointer = (e) => {
  const wasTap = gesture === 'tap';
  pointers.delete(e.pointerId);
  clearTimeout(longPress);
  if (wasTap && tapStart) {
    if (tapStart.button === 2) doFlag(...cellAt(tapStart.x, tapStart.y));
    else doReveal(...cellAt(tapStart.x, tapStart.y));
  }
  if (pointers.size === 0) gesture = null;
  else if (pointers.size === 1) { gesture = 'pan'; }
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); clearTimeout(longPress); if (!pointers.size) gesture = null; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

function zoomAt(px, py, factor) {
  const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.scale * factor));
  const f = ns / cam.scale;
  // keep the world point under (px,py) fixed
  cam.x += (px - W / 2) * (1 - 1 / f) / ns * f;
  cam.y += (py - H / 2) * (1 - 1 / f) / ns * f;
  cam.scale = ns;
}
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.glide = null;
  zoomAt(e.offsetX, e.offsetY, Math.pow(1.0015, -e.deltaY));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); cam.glide = null; }
  else if (k === '+' || k === '=') zoomAt(W / 2, H / 2, 1.25);
  else if (k === '-' || k === '_') zoomAt(W / 2, H / 2, 0.8);
  else if (k === 'o' || k === 'home') goOrigin();
  else if (k === 'r') newRun();
  else if (k === 'h' || k === '?') $('help').classList.toggle('show');
  else if (k === 'escape') hideOverlays();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function goOrigin() {
  const t = world && world.origin ? { x: world.origin.x + 0.5, y: world.origin.y + 0.5 } : { x: 0.5, y: 0.5 };
  cam.glide = t;
}

$('btnOrigin').addEventListener('click', goOrigin);
$('btnNew').addEventListener('click', () => newRun());
$('btnHelp').addEventListener('click', () => $('help').classList.toggle('show'));
$('btnAgain').addEventListener('click', () => newRun());
$('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').classList.remove('show'); });

// ── loop ─────────────────────────────────────────────────────────────────────
let last = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const step = dt * Math.max(6, 640 / cam.scale); // keyboard pan, ~a screen per second at any zoom
  if (keys.has('w') || keys.has('arrowup')) cam.y -= step;
  if (keys.has('s') || keys.has('arrowdown')) cam.y += step;
  if (keys.has('a') || keys.has('arrowleft')) cam.x -= step;
  if (keys.has('d') || keys.has('arrowright')) cam.x += step;
  if (cam.glide) {
    const dx = cam.glide.x - cam.x, dy = cam.glide.y - cam.y;
    if (Math.hypot(dx, dy) < 0.05) { cam.x = cam.glide.x; cam.y = cam.glide.y; cam.glide = null; }
    else { cam.x += dx * Math.min(1, dt * 8); cam.y += dy * Math.min(1, dt * 8); }
  }
  render();
  requestAnimationFrame(frame);
}

// ── boot ─────────────────────────────────────────────────────────────────────
if (!loadRun()) newRun();
updateHud();
window.addEventListener('beforeunload', saveRun);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveRun(); });
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && !HARNESS && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (HARNESS) {
  window.__ms = {
    world: () => world,
    cam,
    reveal: doReveal,
    flag: doFlag,
    cellAt,
    newRun,
  };
}
