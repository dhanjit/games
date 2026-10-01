/* Runoff — pure rules. No DOM, no canvas, no timers (DECISIONS #8).
 *
 * The world is a vertical alley between two buildings, `T.W` units wide and
 * endless downward (+y is down). Ledges — chajjas, balcony slabs, rooftops —
 * stick out of both walls. Each is a capsule (a thick line segment) rooted at
 * its wall and rising gently toward its free tip, so with gravity straight down
 * water pools in the corner against the wall. Tilting gravity toward the free
 * tip by more than the slope drains it; tilting the other way pins it.
 *
 * The water is `T.drops` particles run through Clavet et al.'s double-density
 * relaxation ("Particle-based Viscoelastic Fluid Simulation", SCA 2005) —
 * the usual 2-D game liquid: position-based, unconditionally stable at a fixed
 * step, and cheap with a uniform grid. Velocity is recovered from positions
 * after relaxation and collision, so pushing a particle out of a ledge is all
 * the collision response there is.
 *
 * The sun is a horizontal line `sunY` descending from above; any drop above it
 * evaporates. Two modes differ only in who moves it:
 *   chase  — it descends on its own after `T.sunDelay`, speeding up with time.
 *   scroll — the host passes `viewTop` (the player's scroll position); the sun
 *            sits at max(its own slow creep, viewTop), and `floorY` (the bottom
 *            of the view — the city isn't built below it yet) holds water up.
 *
 * API:
 *   makeWorld({seed, mode, drops, sun}) → world. `sun: false` never moves
 *     the sun (the title screen's attract loop).
 *   step(world, {tilt, viewTop?, floorY?}) — advance T.dt. `tilt` is the
 *     gravity angle in radians from straight down, positive toward +x (right).
 *     Evaporations this step are appended to world.steam as x,y pairs; the
 *     host drains it.
 *   depthM(y) → metres, for display. Score is world.depth (deepest y any drop
 *     has reached), shown via depthM.
 */

export const T = {
  W: 100,            // alley width in world units (u); maps to the screen width
  dt: 1 / 120,       // fixed step, seconds
  g: 420,            // gravity, u/s²
  maxTilt: 0.96,     // clamp on the gravity angle, rad (~55°)
  vmax: 240,         // terminal speed, u/s — keeps a step (2 u) under ledge thickness
  drops: 180,

  // fluid (Clavet double-density relaxation; stiffness has dt² folded in)
  h: 5,              // interaction radius
  rho0: 1.6,         // rest density — settles drops ~2.1 u apart
  k: 0.5,            // pressure stiffness; higher splashes water over ledge tips
  kNear: 1,          // near-pressure stiffness (anti-clumping, gives surface tension)
  sigma: 0.06,       // linear viscosity, per step
  beta: 0.004,       // quadratic viscosity, s/u
  pr: 1.2,           // drop radius against walls and ledges

  // ledges
  ledgeR: 2.5,       // capsule radius (half the slab thickness)
  lenMin: 0.50,      // ledge length as a fraction of W
  lenMax: 0.70,
  shortChance: 0.12, // chance of a short ledge that leaves a clear drop beside it
  sameSide: 0.2,     // chance the next ledge is on the same wall
  clearMin: 30,      // vertical clearance, this ledge's root → next ledge's tip
  clearMax: 52,
  slopeMin: 6,       // degrees, rising toward the tip
  slopeMax: 16,
  slopeGrow: 1.2,    // extra degrees per 100 m of depth, capped at slopeCap
  slopeCap: 30,

  // sun
  sunStart: -40,     // y where the sun starts (screen top is y = 0)
  sunDelay: 4,       // s before it starts to move (chase)
  sunV0: 16,         // u/s when it starts moving
  sunAccel: 1.2,     // u/s² — linear in time, not depth (depth-keyed is exponential: a wall)
  creep: 6,          // scroll mode: u/s the sun descends on its own, however you scroll
  creepAccel: 0.3,   // …and its u/s², so standing still is never safe for long
  mPerU: 1 / 20,     // metres per world unit, display only
};

export const depthM = (y) => Math.max(0, Math.floor(y * T.mPerU));

/* mulberry32 — small seeded PRNG so a seed reproduces an alley. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeWorld(opts = {}) {
  const drops = opts.drops ?? T.drops;
  const seed = (opts.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const w = {
    seed,
    rand: rng(seed),
    mode: opts.mode === 'scroll' ? 'scroll' : 'chase',
    t: 0,
    n: drops,
    x: new Float32Array(drops), y: new Float32Array(drops),
    vx: new Float32Array(drops), vy: new Float32Array(drops),
    px: new Float32Array(drops), py: new Float32Array(drops),
    ledges: [],        // {ax, ay, bx, by, side: -1 left | 1 right, slope}
    genY: 0,           // root y of the last generated ledge
    side: opts.firstSide ?? -1,
    sunY: T.sunStart,
    sunOff: opts.sun === false,
    depth: 0,
    tilt: 0,
    dead: false,
    steam: [],
    // grid scratch, grown on demand
    _cell: new Int32Array(drops), _order: new Int32Array(drops),
    _start: new Int32Array(0), _count: new Int32Array(0),
  };
  // A rain burst: a loose disc of drops just below the top edge.
  for (let i = 0; i < drops; i++) {
    const a = w.rand() * Math.PI * 2, r = Math.sqrt(w.rand()) * 16;
    w.x[i] = T.W / 2 + Math.cos(a) * r * 1.4;
    w.y[i] = 26 + Math.sin(a) * r;
    w.vy[i] = 20;
  }
  // First ledge well clear of the burst.
  w.genY = 40;
  generate(w, 400);
  return w;
}

/* Append ledges until the last root is below `untilY`. */
function generate(w, untilY) {
  const R = w.rand;
  while (w.genY < untilY) {
    if (R() >= T.sameSide || w.ledges.length === 0) w.side = -w.side;
    const short = R() < T.shortChance;
    const len = T.W * (short ? 0.28 + R() * 0.1 : T.lenMin + R() * (T.lenMax - T.lenMin));
    const grow = Math.min(T.slopeCap - T.slopeMax, T.slopeGrow * (w.genY * T.mPerU) / 100);
    const slope = (T.slopeMin + R() * (T.slopeMax - T.slopeMin) + grow) * Math.PI / 180;
    const rise = len * Math.tan(slope);
    const clear = T.clearMin + R() * (T.clearMax - T.clearMin);
    const y = w.genY + clear + rise;          // root y; the tip is `rise` higher
    const ax = w.side < 0 ? 0 : T.W;
    const bx = w.side < 0 ? len : T.W - len;
    w.ledges.push({ ax, ay: y, bx, by: y - rise, side: w.side, slope });
    w.genY = y;
  }
}

export function step(w, input = {}) {
  if (w.dead) return;
  const dt = T.dt;
  w.t += dt;
  const tilt = Math.max(-T.maxTilt, Math.min(T.maxTilt, input.tilt || 0));
  w.tilt = tilt;
  const gx = T.g * Math.sin(tilt), gy = T.g * Math.cos(tilt);

  // ── sun ────────────────────────────────────────────────────────────────
  if (w.t > T.sunDelay && !w.sunOff) {
    if (w.mode === 'chase') {
      w.sunY += (T.sunV0 + T.sunAccel * (w.t - T.sunDelay)) * dt;
    } else {
      w.sunY += (T.creep + T.creepAccel * (w.t - T.sunDelay)) * dt;
    }
  }
  if (w.mode === 'scroll' && input.viewTop != null) w.sunY = Math.max(w.sunY, input.viewTop);
  const floorY = w.mode === 'scroll' && input.floorY != null ? input.floorY : Infinity;

  // ── ledges: build ahead, drop what the sun has passed ─────────────────
  let deepest = -Infinity, highest = Infinity;
  for (let i = 0; i < w.n; i++) { if (w.y[i] > deepest) deepest = w.y[i]; if (w.y[i] < highest) highest = w.y[i]; }
  generate(w, Math.max(deepest, floorY === Infinity ? 0 : floorY) + 500);
  const cut = w.sunOff ? highest - 300 : w.sunY - 60;
  while (w.ledges.length && w.ledges[0].ay < cut) w.ledges.shift();

  const n = w.n, x = w.x, y = w.y, vx = w.vx, vy = w.vy, px = w.px, py = w.py;

  // ── grid (counting sort into cells of size h) ───────────────────────────
  const h = T.h, cols = Math.ceil(T.W / h) + 2;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) { if (y[i] < yMin) yMin = y[i]; if (y[i] > yMax) yMax = y[i]; }
  const rows = n ? Math.floor((yMax - yMin) / h) + 3 : 0;
  const cells = rows * cols;
  if (w._start.length < cells + 1) { w._start = new Int32Array(cells * 2 + 1); w._count = new Int32Array(cells * 2 + 1); }
  const start = w._start, count = w._count, cellOf = w._cell, order = w._order;
  const cellIndex = (xi, yi) => (Math.floor((yi - yMin) / h) + 1) * cols + Math.min(cols - 2, Math.max(0, Math.floor(xi / h))) + 1;
  const buildGrid = () => {
    count.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) { const c = cellIndex(x[i], y[i]); cellOf[i] = c; count[c]++; }
    let s = 0;
    for (let c = 0; c <= cells; c++) { start[c] = s; s += count[c]; count[c] = 0; }
    for (let i = 0; i < n; i++) { const c = cellOf[i]; order[start[c] + count[c]++] = i; }
  };
  buildGrid();

  // ── viscosity impulses (pairwise, approaching pairs only) ───────────────
  for (let i = 0; i < n; i++) {
    const ci = cellOf[i];
    for (let dr = -cols; dr <= cols; dr += cols) for (let dc = -1; dc <= 1; dc++) {
      const c = ci + dr + dc; if (c < 0 || c >= cells) continue;
      for (let k = start[c], e = start[c] + count[c]; k < e; k++) {
        const j = order[k]; if (j <= i) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy;
        if (d2 >= h * h || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), q = d / h, nx = dx / d, ny = dy / d;
        const u = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        if (u <= 0) continue;
        const I = (1 - q) * (T.sigma * u + T.beta * u * u) * 0.5;
        vx[i] -= I * nx; vy[i] -= I * ny; vx[j] += I * nx; vy[j] += I * ny;
      }
    }
  }

  // ── gravity, terminal speed, predict ───────────────────────────────────
  const vmax2 = T.vmax * T.vmax;
  for (let i = 0; i < n; i++) {
    vx[i] += gx * dt; vy[i] += gy * dt;
    const s2 = vx[i] * vx[i] + vy[i] * vy[i];
    if (s2 > vmax2) { const s = T.vmax / Math.sqrt(s2); vx[i] *= s; vy[i] *= s; }
    px[i] = x[i]; py[i] = y[i];
    x[i] += vx[i] * dt; y[i] += vy[i] * dt;
  }

  // ── double-density relaxation ───────────────────────────────────────────
  buildGrid();
  const nb = new Int32Array(64), nq = new Float32Array(64);
  for (let i = 0; i < n; i++) {
    const ci = cellOf[i];
    let rho = 0, rhoN = 0, m = 0;
    for (let dr = -cols; dr <= cols; dr += cols) for (let dc = -1; dc <= 1; dc++) {
      const c = ci + dr + dc; if (c < 0 || c >= cells) continue;
      for (let k = start[c], e = start[c] + count[c]; k < e; k++) {
        const j = order[k]; if (j === i) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy;
        if (d2 >= h * h) continue;
        const q = 1 - Math.sqrt(d2) / h;
        rho += q * q; rhoN += q * q * q;
        if (m < 64) { nb[m] = j; nq[m] = q; m++; }
      }
    }
    const P = T.k * (rho - T.rho0), PN = T.kNear * rhoN;
    let ddx = 0, ddy = 0;
    for (let a = 0; a < m; a++) {
      const j = nb[a], q = nq[a];
      let dx = x[j] - x[i], dy = y[j] - y[i];
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-6) { dx = (((i * 7 + j * 13) % 11) / 11 - 0.5) * 0.02; dy = 0.01; d = Math.sqrt(dx * dx + dy * dy); }
      const D = (P * q + PN * q * q) * 0.5 / d;
      x[j] += D * dx; y[j] += D * dy; ddx -= D * dx; ddy -= D * dy;
    }
    x[i] += ddx; y[i] += ddy;
  }

  // ── collisions: walls, ledges, scroll floor ─────────────────────────────
  const lo = T.pr, hi = T.W - T.pr, reach = T.ledgeR + T.pr;
  const L = w.ledges;
  for (let i = 0; i < n; i++) {
    if (x[i] < lo) x[i] = lo; else if (x[i] > hi) x[i] = hi;
    for (let l = 0; l < L.length; l++) {
      const s = L[l];
      if (y[i] < s.by - reach || y[i] > s.ay + reach) continue;
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      let t = ((x[i] - s.ax) * ex + (y[i] - s.ay) * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = s.ax + ex * t, cy = s.ay + ey * t;
      const dx = x[i] - cx, dy = y[i] - cy, d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), push = (reach - d) / d;
        x[i] += dx * push; y[i] += dy * push;
      } else {
        // dead centre: push along the slab's upward normal
        const el = Math.hypot(ex, ey), nx = ey / el * -s.side, ny = -Math.abs(ex / el);
        x[i] = cx + nx * reach; y[i] = cy + ny * reach;
      }
    }
    if (y[i] > floorY - T.pr) y[i] = floorY - T.pr;
    if (x[i] < lo) x[i] = lo; else if (x[i] > hi) x[i] = hi;
  }

  // ── recover velocity; evaporate; score ─────────────────────────────────
  const inv = 1 / dt;
  for (let i = 0; i < w.n; i++) {
    vx[i] = (x[i] - px[i]) * inv; vy[i] = (y[i] - py[i]) * inv;
  }
  for (let i = w.n - 1; i >= 0; i--) {
    if (y[i] >= w.sunY) continue;
    w.steam.push(x[i], y[i]);
    const last = --w.n;
    x[i] = x[last]; y[i] = y[last]; vx[i] = vx[last]; vy[i] = vy[last];
  }
  for (let i = 0; i < w.n; i++) if (y[i] > w.depth) w.depth = y[i];
  if (w.n === 0) w.dead = true;
}

/* Which ledge (index into world.ledges) a point is resting on, or -1: the
 * nearest ledge whose span covers x and whose top surface lies within `band`
 * below y. Used by the harness bot and the HUD hint — not by the physics. */
export function ledgeUnder(w, xi, yi, band = 14) {
  let best = -1, bestGap = Infinity;
  for (let l = 0; l < w.ledges.length; l++) {
    const s = w.ledges[l];
    const x0 = Math.min(s.ax, s.bx), x1 = Math.max(s.ax, s.bx);
    if (xi < x0 || xi > x1) continue;
    const t = (xi - s.ax) / (s.bx - s.ax);
    const top = s.ay + (s.by - s.ay) * t - T.ledgeR;
    const gap = top - yi;
    if (gap >= -T.pr && gap < band && gap < bestGap) { best = l; bestGap = gap; }
  }
  return best;
}
