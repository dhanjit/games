/* Infinite Minesweeper — pure rules. No DOM, no canvas, no timers.
 *
 * The board has no edges and is never stored: whether a cell is a mine is a
 * pure function of coordinate — hash(seed, x, y) < density — so the untouched
 * infinity costs nothing and persistence is free. The only stored state is
 * player-touched cells (`world.cells`, keyed "x,y"): revealed cells hold their
 * neighbour count (0–8), flagged cells hold FLAG, the fatal cell holds BOOM.
 * The revealed Map doubles as the neighbour-count memo — a count is computed
 * once, at reveal time; anything else recomputes eight cheap hashes on demand.
 *
 * First click: the first reveal fixes `world.origin` at that coordinate, and
 * every cell within `T.safeRadius` of the origin is mine-free by override
 * (concept from Zikoat/infinite-minesweeper's safe circle, adapted to a hashed
 * board — with a pure hash you can't move a mine, so you carve the disc into
 * the mine function instead). Radius 2 guarantees the first click is a zero
 * and opens a pocket of at least the 5×5 disc.
 *
 * Flood fill is an explicit queue (never recursion — an unbounded zero-region
 * at low density would blow the stack) capped at `T.floodCap` cells per
 * reveal. When the cap trips, unprocessed frontier cells simply stay covered
 * and remain clickable: clicking any covered cell beside an open zero resumes
 * the flood. See CLAUDE.md for where the cap number comes from.
 *
 * Guessing stance (v1): the field is honest random — a player eventually meets
 * a genuine 50/50 and dies to it. Accepted and measured (see sim/run.mjs
 * forced-guess share), not mitigated. CLAUDE.md records the options rejected.
 *
 * API:
 *   makeWorld(opts) → world
 *   reveal(world, x, y) → {type:'boom',x,y} | {type:'reveal',cells,capped} | null
 *   toggleFlag(world, x, y) → 'flag' | 'unflag' | null
 *   isMine(world, x, y), neighbourCount(world, x, y), cellHash(seed, x, y)
 *
 * Score is `world.revealed` — the area opened before death.
 */

export const T = {
  density: 0.22,   // mine probability per cell — sim-tuned, see CLAUDE.md.
                   // Below ~0.21 the zero-regions percolate and a run never
                   // ends; above ~0.23 the median run collapses. 0.22 is the
                   // lowest density where every simulated run terminates.
  safeRadius: 2,   // cells around the first click that are mine-free
  floodCap: 4096,  // max cells one reveal may open — see CLAUDE.md
};

export const FLAG = -1;
export const BOOM = -2;

export const key = (x, y) => x + ',' + y;

/* Integer hash: two rounds of a splitmix32-style finalizer (constants from
 * bryc's public-domain PRNG survey). One round per coordinate so neighbouring
 * cells share no low-bit structure — a weak hash here shows up as visible
 * stripes of mines. Returns an unsigned 32-bit value. */
function mix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}
export function cellHash(seed, x, y) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = mix(h ^ (x >>> 0));
  h = mix(h ^ (y >>> 0));
  return h;
}

export function makeWorld(opts = {}) {
  const density = opts.density ?? T.density;
  return {
    seed: (opts.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0,
    density,
    mineT: Math.floor(density * 4294967296), // isMine threshold, precomputed
    safeRadius: opts.safeRadius ?? T.safeRadius,
    floodCap: opts.floodCap ?? T.floodCap,
    origin: null,      // {x,y} of the first click; centre of the safe disc
    cells: new Map(),  // key(x,y) → 0..8 | FLAG | BOOM
    revealed: 0,       // the score
    flags: 0,
    dead: false,
    boom: null,        // {x,y} of the fatal cell
    floodsCapped: 0,   // times a reveal hit the flood cap (telemetry)
  };
}

export function isMine(w, x, y) {
  if (w.origin) {
    const dx = x - w.origin.x, dy = y - w.origin.y;
    if (dx * dx + dy * dy <= w.safeRadius * w.safeRadius) return false;
  }
  return cellHash(w.seed, x, y) < w.mineT;
}

export function neighbourCount(w, x, y) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && isMine(w, x + dx, y + dy)) n++;
  return n;
}

/* Reveal a covered cell. First reveal fixes the origin. A mine ends the run.
 * A zero flood-fills outward, breadth-first, up to floodCap cells; a zero's
 * neighbours are by definition mine-free, so the flood never needs a mine
 * check past the clicked cell. Returns the revealed cells as [x, y, count]
 * triples so callers (renderer, sim bot) never rescan the Map. */
export function reveal(w, x, y) {
  if (w.dead) return null;
  const k0 = key(x, y);
  if (w.cells.has(k0)) return null; // flagged or already open
  if (!w.origin) w.origin = { x, y };
  if (isMine(w, x, y)) {
    w.cells.set(k0, BOOM);
    w.dead = true;
    w.boom = { x, y };
    return { type: 'boom', x, y };
  }
  const out = [];
  const queue = [[x, y]];
  const queued = new Set([k0]);
  let head = 0, capped = false;
  while (head < queue.length) {
    if (out.length >= w.floodCap) { capped = true; break; }
    const [cx, cy] = queue[head++];
    const k = key(cx, cy);
    if (w.cells.has(k)) continue; // flagged cells stay covered, classic rule
    const c = neighbourCount(w, cx, cy);
    w.cells.set(k, c);
    w.revealed++;
    out.push([cx, cy, c]);
    if (c === 0) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nk = key(cx + dx, cy + dy);
          if (!w.cells.has(nk) && !queued.has(nk)) {
            queued.add(nk);
            queue.push([cx + dx, cy + dy]);
          }
        }
    }
  }
  if (capped) w.floodsCapped++;
  return { type: 'reveal', cells: out, capped };
}

export function toggleFlag(w, x, y) {
  if (w.dead) return null;
  const k = key(x, y);
  const st = w.cells.get(k);
  if (st === undefined) { w.cells.set(k, FLAG); w.flags++; return 'flag'; }
  if (st === FLAG) { w.cells.delete(k); w.flags--; return 'unflag'; }
  return null; // revealed — nothing to flag
}
