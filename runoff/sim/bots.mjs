/* Tilt policies for the harness (run.mjs). Each is (world, mem) → target
 * tilt in radians; mem is a per-run scratch object. See run.mjs for what each
 * bot stands for. */
import { T, houseAt, childrenOf, colOf, rowOf, TANK, BARREL, SHADE, PIPE } from '../rules.js';

/* How good is it for the water to arrive at (r, c), looking d rows ahead?
 * Tanks are worst; a parapet's low end is a dead end until tipped back.
 * Pickups are worth a detour; a downpipe skips rows past its tank. */
const BONUS = { [BARREL]: 20, [SHADE]: 15 };
function value(w, r, c, d) {
  if (d === 0) return 0;
  const h = houseAt(w, r, c);
  if (h.type === TANK) return -100;
  const [L, R] = childrenOf(r, c), low = h.dir < 0 ? L : R, high = h.dir < 0 ? R : L;
  const viaLow = h.wall ? -30 : h.loot === PIPE ? value(w, h.pipe.r, h.pipe.c, d - 1) + 5 : value(w, r + 1, low, d - 1);
  return (h.taken ? 0 : BONUS[h.loot] ?? 0) + Math.max(viaLow, value(w, r + 1, high, d - 1) - 1);
}

/* Where water on h goes under tilt t, and how good that is. */
function outcome(w, h, t) {
  const [L, R] = childrenOf(h.r, h.c);
  if (h.type === TANK) {
    if (Math.abs(t) < 0.75) return -100;                     // stays in the tank
    return value(w, h.r + 1, t < 0 ? L : R, 4) - 20;         // sloshes out, leaving some behind
  }
  const over = -h.dir * t > h.pitch + 0.15;                  // tipped over the high end
  if (!over && h.wall) return -30;
  if (!over && h.loot === PIPE) return value(w, h.pipe.r, h.pipe.c, 4) + 5;
  const side = over ? -h.dir : h.dir;
  return value(w, h.r + 1, side < 0 ? L : R, 4) - (over ? 1 : 0);
}

const CANDIDATES = [];
for (let k = -10; k <= 10; k++) CANDIDATES.push(k / 10 * T.maxTilt);

export const bots = {
  none: () => 0,
  flip: (w) => (Math.floor(w.t / 1.2) % 2 ? 1 : -1) * T.maxTilt,
  planner: (w, mem) => {
    if (w.t - (mem.at ?? -1) < 0.1) return mem.tilt;
    mem.at = w.t;
    // count the water resting on each roof or tank (falling water is past choosing)
    const on = new Map();
    for (let i = 0; i < w.n; i++) {
      const r = rowOf(w.y[i] + 8), h = houseAt(w, r, colOf(r, w.x[i]));
      if (Math.abs(w.x[i] - h.x) > T.eave + 2 || w.y[i] > h.ry + h.rise / 2 + 3 || w.y[i] < h.ry - h.rise / 2 - 24) continue;
      on.set(h, (on.get(h) ?? 0) + 1);
    }
    // the tilt that sends the most water somewhere good; the gentlest on ties
    let best = -Infinity, pick = 0;
    for (const t of CANDIDATES) {
      let s = -Math.abs(t) * 0.01;
      for (const [h, n] of on) s += n * outcome(w, h, t);
      if (s > best) { best = s; pick = t; }
    }
    return (mem.tilt = pick);
  },
};
