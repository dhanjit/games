/* Runoff — pure rules. No DOM, no canvas, no timers (DECISIONS #8).
 *
 * The world is a hillside town seen side-on, endless downward (+y is down) and
 * sideways: terraces of houses, each row's roofs eave to eave with a narrow
 * drain slot between them. Row r has its roof centres at y = T.Y0 + r·DY,
 * house c of that row at x = (c + (r&1)/2)·DX. So every house has two
 * children in the row below, half a house to the left and half to the right,
 * and each eave sits over one of them, 5 u from its middle — dropping down
 * is walking a tree (`childrenOf`). Each slot is decided by a seeded hash of
 * (r, c):
 *
 *   ROOF — a lean-to tin roof sloping one way (`dir`). Water leaves by its low
 *          eave onto that side's child. Tilting gravity against the slope by
 *          more than its pitch sends it off the high end instead: that is the
 *          lane change. Some roofs have a parapet (`wall`) at the low end that
 *          pools water until it is tipped back uphill.
 *   TANK — an open rooftop cistern as wide as a roof. Water that lands in it
 *          stays, unless a hard tilt sloshes it over the rim; a share always
 *          stays behind.
 *
 * Roofs are single-pitch on purpose: a gable's ridge is a knife-edge, and a
 * stream landing near one splits in two however it is aimed. Rows have no gaps
 * on purpose too: with gaps, a hard tilt flings water over a whole row, which
 * makes blind full-tilt waggling the fastest way down. Here every row costs a
 * roof; a hard tilt only drifts the fall sideways (H·tanθ), landing it a house
 * or two over in the next row. No two tanks stand side by side, so every roof
 * has at least one child that is not a tank.
 *
 * The water is `T.drops` particles run through Clavet et al.'s double-density
 * relaxation ("Particle-based Viscoelastic Fluid Simulation", SCA 2005),
 * position-based and stable at a fixed step. The neighbour grid is a spatial
 * hash, so drops can spread across an unbounded world. Collision response is
 * projection out of capsules (roofs, parapets, tank walls); velocity
 * is recovered from positions afterwards.
 *
 * The sun is a horizontal line `sunY` descending from above, speeding up with
 * time; any drop above it evaporates.
 *
 * API:
 *   makeWorld({seed, drops, sun}) → world. `sun: false` never moves the sun
 *     (the title screen's attract loop). Drops 0…n−1 are in play; `pending`
 *     more are still to come out of the spout over the first ~2.5 s.
 *   step(world, {tilt}) — advance T.dt. `tilt` is the gravity angle in
 *     radians from straight down, positive toward +x (right). Evaporations
 *     this step are appended to world.steam as x,y pairs; the host drains it.
 *   houseAt(world, r, c) → {type, r, c, x, ry, dir, wall, pitch, rise, segs}
 *     (memoised). A roof runs from its high end (x − dir·eave, ry − rise/2) to
 *     its low end (x + dir·eave, ry + rise/2).
 *   rowOf(y), xOf(r, c), colOf(r, x), childrenOf(r, c) — lattice helpers.
 *   bulk(world) → {x, y, n} of the leading clump of water, or null.
 *   depthM(y) → metres, for display. Score is world.depth (deepest y any drop
 *     has reached).
 */

export const T = {
  dt: 1 / 120,       // fixed step, seconds
  g: 420,            // gravity, u/s²
  maxTilt: 0.96,     // clamp on the gravity angle, rad (~55°)
  vmax: 240,         // terminal speed, u/s — keeps a step (2 u) under slab thickness
  drops: 180,

  // fluid (Clavet double-density relaxation; stiffness has dt² folded in)
  h: 5,              // interaction radius
  rho0: 1.6,         // rest density — settles drops ~2.1 u apart
  k: 0.5,            // pressure stiffness
  kNear: 1,          // near-pressure stiffness (anti-clumping, gives surface tension)
  sigma: 0.06,       // linear viscosity, per step
  beta: 0.004,       // quadratic viscosity, s/u
  pr: 1.2,           // drop radius against geometry
  slideMax: 50,      // u/s — fastest a drop slides along a surface it touches
  airDrag: 6,        // 1/s, on the sideways speed of water falling faster than fallV …
  fallV: 60,         // … u/s: streams drop off an eave instead of sailing past the roof below

  // the town lattice
  Y0: 80,            // roof-centre y of row 0
  DX: 56,            // house spacing within a row
  DY: 45,            // row spacing
  eave: 23,          // roof half-span: leaves a 10 u drain slot between neighbours (one under 2·(roofR + pr) closes)
  pitchMin: 14,      // roof pitch, degrees, at the top of the hill …
  pitchMax: 26,      // … and the most it ever reaches
  pitchRamp: 40,     // rows over which the range climbs from pitchMin toward pitchMax
  roofR: 2.2,        // roof slab capsule radius
  wallR: 1.5,
  parapet: 9,        // parapet height above the low eave
  tankHalf: 21,      // tank inner half-width
  tankFloor: 6,      // tank floor, below the row's centre line
  tankWall: 24,      // tank wall height above its floor
  pTank: 0.12,
  pWall: 0.18,       // share of roofs with a parapet
  safeRows: 3,       // the first rows are all plain roofs

  // sun
  sunStart: -60,     // y where the sun starts (the town begins at y ≈ 80)
  sunDelay: 4,       // s before it starts to move
  sunV0: 16,         // u/s when it starts moving
  sunAccel: 0.6,     // u/s² — linear in time, not depth (depth-keyed is exponential: a wall)
  mPerU: 1 / 20,     // metres per world unit, display only
};

export const ROOF = 0, TANK = 1;

export const depthM = (y) => Math.max(0, Math.floor(y * T.mPerU));

// ── hashing ───────────────────────────────────────────────────────────────
// Two rounds of a splitmix32-style finalizer per coordinate (constants from
// bryc's public-domain PRNG survey), so neighbouring slots share no structure.
function mix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}
export function cellHash(seed, a, b) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = mix(h ^ (a >>> 0));
  h = mix(h ^ (b >>> 0));
  return h;
}
const unit = (seed, a, b) => cellHash(seed, a, b) / 4294967296;

// ── the lattice ───────────────────────────────────────────────────────────
export const xOf = (r, c) => (c + (r & 1) / 2) * T.DX;
export const rowOf = (y) => Math.round((y - T.Y0) / T.DY);
export const colOf = (r, x) => Math.round(x / T.DX - (r & 1) / 2);
/* The two houses below (r, c), left then right. */
export const childrenOf = (r, c) => (r & 1) ? [c, c + 1] : [c - 1, c];

function baseType(seed, r, c) {
  return r >= T.safeRows && unit(seed, r, c) < T.pTank ? TANK : ROOF;
}

const key = (r, c) => r * 4194304 + c + 2097152;

export function houseAt(w, r, c) {
  const k = key(r, c);
  let h = w.houses.get(k);
  if (h) return h;
  let type = baseType(w.seed, r, c);
  if (type === TANK && baseType(w.seed, r, c - 1) === TANK) type = ROOF; // never two tanks side by side
  const x = xOf(r, c), ry = T.Y0 + r * T.DY;
  const u2 = unit(w.seed ^ 0x51ed, r, c), u3 = unit(w.seed ^ 0x7a11, r, c);
  const dir = u2 < 0.5 ? -1 : 1;
  const wall = type === ROOF && r >= T.safeRows && u3 < T.pWall;
  const top = T.pitchMin + (T.pitchMax - T.pitchMin) * Math.min(1, Math.max(0, r) / T.pitchRamp);
  const pitch = (T.pitchMin + (top - T.pitchMin) * ((u2 * 2) % 1)) * Math.PI / 180;
  const rise = 2 * T.eave * Math.tan(pitch);
  const segs = [];                      // [ax, ay, bx, by, radius] per capsule
  if (type === ROOF) {
    const lx = x + dir * T.eave, ly = ry + rise / 2;
    segs.push([x - dir * T.eave, ry - rise / 2, lx, ly, T.roofR]);
    if (wall) segs.push([lx, ly, lx, ly - T.parapet, T.wallR]);
    // the spout pours faster than a roof drains, so the first roof gets a
    // parapet at its high end: the pool can only spill the way it slopes
    if (r === 0 && c === 0) segs.push([x - dir * T.eave, ry - rise / 2, x - dir * T.eave, ry - rise / 2 - T.parapet, T.wallR]);
  } else {
    const fy = ry + T.tankFloor, ty = fy - T.tankWall, hw = T.tankHalf;
    segs.push([x - hw, fy, x + hw, fy, T.roofR], [x - hw, fy, x - hw, ty, T.roofR], [x + hw, fy, x + hw, ty, T.roofR]);
  }
  h = { type, r, c, x, ry, dir, wall, pitch, rise, segs };
  w.houses.set(k, h);
  return h;
}

// ── world ────────────────────────────────────────────────────────────────
export function makeWorld(opts = {}) {
  const drops = opts.drops ?? T.drops;
  const seed = (opts.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const w = {
    seed,
    t: 0,
    n: 0,              // drops in play; the rest are still in the spout
    pending: drops,
    x: new Float32Array(drops), y: new Float32Array(drops),
    vx: new Float32Array(drops), vy: new Float32Array(drops),
    px: new Float32Array(drops), py: new Float32Array(drops),
    houses: new Map(),
    sunY: T.sunStart,
    sunOff: opts.sun === false,
    depth: 0,
    tilt: 0,
    dead: false,
    steam: [],
    spoutX: 0, spoutY: 0, spoutDir: 1,
    _cx: new Int32Array(drops), _cy: new Int32Array(drops), _cell: new Int32Array(drops),
    _order: new Int32Array(drops), _start: new Int32Array(HBUCKETS + 1), _count: new Int32Array(HBUCKETS + 1),
  };
  // The water arrives from a gutter spout over the high end of the first roof
  // (see `pour`), not all at once: a block of it dropped or set on the roof
  // dam-breaks over both ends before the player has touched anything.
  const roof = houseAt(w, 0, 0);
  w.spoutX = -roof.dir * (T.eave - 12);
  w.spoutY = roof.ry - roof.rise / 2 + roof.rise * 12 / (2 * T.eave) - 5;
  w.spoutDir = roof.dir;
  return w;
}

/* The spout lets a row of 3 drops out every 5 steps at ~50 u/s, angled down
 * the roof: rows leave ~2 u apart, about rest spacing, so the stream neither
 * tears nor detonates, and lands soft enough not to splash over the high end. */
function pour(w) {
  if (!w.pending || Math.round(w.t / T.dt) % 5) return;
  for (let k = -1; k <= 1 && w.pending; k++) {
    const i = w.n++;
    w.pending--;
    w.x[i] = w.spoutX + k * 2.2 + ((w.pending * 7) % 5 - 2) * 0.05;
    w.y[i] = w.spoutY;
    w.vx[i] = w.spoutDir * 30; w.vy[i] = 40;
  }
}

// ── spatial hash for the fluid ───────────────────────────────────────────
const HBUCKETS = 4096, HMASK = HBUCKETS - 1;
const bucket = (cx, cy) => ((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & HMASK);
const nbBuckets = new Int32Array(9);
/* The distinct buckets of the 3×3 cells around (cx, cy) — deduplicated, since
 * two cells can hash to one bucket and visiting it twice would double-count
 * density. Returns how many were written to nbBuckets. */
function neighbourBuckets(cx, cy) {
  let m = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const b = bucket(cx + dx, cy + dy);
    let dup = false;
    for (let k = 0; k < m; k++) if (nbBuckets[k] === b) { dup = true; break; }
    if (!dup) nbBuckets[m++] = b;
  }
  return m;
}

export function step(w, input = {}) {
  if (w.dead) return;
  const dt = T.dt;
  w.t += dt;
  const tilt = Math.max(-T.maxTilt, Math.min(T.maxTilt, input.tilt || 0));
  w.tilt = tilt;
  const gx = T.g * Math.sin(tilt), gy = T.g * Math.cos(tilt);

  // ── sun ────────────────────────────────────────────────────────────────
  if (w.t > T.sunDelay && !w.sunOff) w.sunY += (T.sunV0 + T.sunAccel * (w.t - T.sunDelay)) * dt;

  // forget houses well above the sun (or the water, with no sun) now and then
  if ((Math.round(w.t / dt) & 255) === 0) {
    let top = w.sunY;
    if (w.sunOff) { top = Infinity; for (let i = 0; i < w.n; i++) if (w.y[i] < top) top = w.y[i]; }
    for (const [k, h] of w.houses) if (h.ry < top - 300) w.houses.delete(k);
  }

  pour(w);
  const n = w.n, x = w.x, y = w.y, vx = w.vx, vy = w.vy, px = w.px, py = w.py;
  const h = T.h, cxA = w._cx, cyA = w._cy, cellOf = w._cell, order = w._order, start = w._start, count = w._count;
  const buildGrid = () => {
    count.fill(0);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / h), cy = Math.floor(y[i] / h), b = bucket(cx, cy);
      cxA[i] = cx; cyA[i] = cy; cellOf[i] = b; count[b]++;
    }
    let s = 0;
    for (let b = 0; b < HBUCKETS; b++) { start[b] = s; s += count[b]; count[b] = 0; }
    for (let i = 0; i < n; i++) { const b = cellOf[i]; order[start[b] + count[b]++] = i; }
  };
  buildGrid();

  // ── viscosity impulses (pairwise, approaching pairs only) ───────────────
  for (let i = 0; i < n; i++) {
    const m = neighbourBuckets(cxA[i], cyA[i]);
    for (let q0 = 0; q0 < m; q0++) {
      const b = nbBuckets[q0];
      for (let k = start[b], e = start[b] + count[b]; k < e; k++) {
        const j = order[k]; if (j <= i) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy;
        if (d2 >= h * h || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), q = d / h, nx = dx / d, ny = dy / d;
        const u = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        if (u <= 0) continue;
        // capped so a pair never more than stops approaching: past that a high
        // viscosity overshoots and flings the pair apart
        const I = Math.min(u, (1 - q) * (T.sigma * u + T.beta * u * u)) * 0.5;
        vx[i] -= I * nx; vy[i] -= I * ny; vx[j] += I * nx; vy[j] += I * ny;
      }
    }
  }

  // ── gravity, terminal speed, predict ───────────────────────────────────
  const vmax2 = T.vmax * T.vmax, drag = Math.exp(-T.airDrag * dt);
  for (let i = 0; i < n; i++) {
    vx[i] += gx * dt; vy[i] += gy * dt;
    if (vy[i] > T.fallV) vx[i] *= drag;
    const s2 = vx[i] * vx[i] + vy[i] * vy[i];
    if (s2 > vmax2) { const s = T.vmax / Math.sqrt(s2); vx[i] *= s; vy[i] *= s; }
    px[i] = x[i]; py[i] = y[i];
    x[i] += vx[i] * dt; y[i] += vy[i] * dt;
  }

  // ── double-density relaxation ───────────────────────────────────────────
  buildGrid();
  const nb = new Int32Array(64), nq = new Float32Array(64);
  for (let i = 0; i < n; i++) {
    let rho = 0, rhoN = 0, m = 0;
    const mb = neighbourBuckets(cxA[i], cyA[i]);
    for (let q0 = 0; q0 < mb; q0++) {
      const b = nbBuckets[q0];
      for (let k = start[b], e = start[b] + count[b]; k < e; k++) {
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

  // ── collisions: the (at most two) houses whose geometry can reach a drop ─
  // A house spans ry − (tank wall or high end + parapet) … ry + (tank floor or
  // low end) vertically and ±(eave + roofR) horizontally — less than DX/2, so
  // one column per row.
  const upReach = Math.max(T.tankWall - T.tankFloor, T.eave * Math.tan(T.pitchMax * Math.PI / 180) + T.parapet) + T.roofR + T.pr;
  const downReach = Math.max(T.tankFloor, T.eave * Math.tan(T.pitchMax * Math.PI / 180)) + T.roofR + T.pr;
  for (let i = 0; i < n; i++) {
    const r0 = Math.ceil((y[i] - downReach - T.Y0) / T.DY), r1 = Math.floor((y[i] + upReach - T.Y0) / T.DY);
    for (let r = Math.max(0, r0); r <= r1; r++) {
      const hs = houseAt(w, r, colOf(r, x[i]));
      for (const s of hs.segs) collide(x, y, px, py, i, s);
    }
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
  if (w.n === 0 && !w.pending) w.dead = true;
}

/* Push drop i out of capsule s = [ax, ay, bx, by, radius], and cap its speed
 * along the surface at T.slideMax. Uncapped, water leaves a steep roof fast
 * enough to sail past the child roof below; proportional friction instead
 * stalls the one-drop film a light rain leaves on a gentle one. */
function collide(x, y, px, py, i, s) {
  const reach = s[4] + T.pr;
  const ax = s[0], ay = s[1], ex = s[2] - ax, ey = s[3] - ay;
  let t = ((x[i] - ax) * ex + (y[i] - ay) * ey) / (ex * ex + ey * ey);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + ex * t, cy = ay + ey * t;
  const dx = x[i] - cx, dy = y[i] - cy, d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2), push = (reach - d) / d, nx = dx / d, ny = dy / d;
    x[i] += dx * push; y[i] += dy * push;
    const mx = x[i] - px[i], my = y[i] - py[i], mn = mx * nx + my * ny;
    const tx = mx - mn * nx, ty = my - mn * ny, tl = Math.sqrt(tx * tx + ty * ty), cap = T.slideMax * T.dt;
    if (tl > cap) { const k = 1 - cap / tl; x[i] -= tx * k; y[i] -= ty * k; }
  } else {
    y[i] = cy - reach; // dead centre: out the top
  }
}

/* Where the water is: drops binned on a (DX/2 × DY) grid, each 3×3 block of
 * bins a candidate clump. The lowest clump holding at least a fifth of the
 * live drops wins — the front of the water, so the camera and the bot leave
 * a remnant stranded in a tank behind instead of waiting on it — falling
 * back to the biggest. Returns its mean x, its 55th-percentile y and its
 * count. */
export function bulk(w) {
  if (w.n === 0) return null;
  const bx = T.DX / 2, by = T.DY, bins = new Map();
  const K = (ix, iy) => ix * 1048576 + iy; // iy stays well inside ±2^19 for any reachable depth
  for (let i = 0; i < w.n; i++) {
    const ix = Math.floor(w.x[i] / bx), iy = Math.floor(w.y[i] / by), k = K(ix, iy);
    const b = bins.get(k);
    if (b) b[2]++; else bins.set(k, [ix, iy, 1]);
  }
  const need = Math.max(1, Math.ceil(w.n / 5));
  let big = -1, bigX = 0, bigY = 0, deep = -Infinity, kx = 0, ky = 0;
  for (const [ix, iy] of bins.values()) {
    let s = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const e = bins.get(K(ix + a, iy + b)); if (e) s += e[2]; }
    if (s > big) { big = s; bigX = ix; bigY = iy; }
    if (s >= need && iy > deep) { deep = iy; kx = ix; ky = iy; }
  }
  if (deep === -Infinity) { kx = bigX; ky = bigY; }
  let sx = 0, cnt = 0;
  const ys = [];
  for (let i = 0; i < w.n; i++) {
    if (Math.abs(Math.floor(w.x[i] / bx) - kx) > 1 || Math.abs(Math.floor(w.y[i] / by) - ky) > 1) continue;
    sx += w.x[i]; ys.push(w.y[i]); cnt++;
  }
  ys.sort((a, b) => a - b);
  return { x: sx / cnt, y: ys[Math.floor(cnt * 0.55)], n: cnt };
}
