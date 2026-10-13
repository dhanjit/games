#!/usr/bin/env node
/* Runoff balance harness — plays runs of rules.js with scripted tilt
 * policies and prints how deep the water gets. DECISIONS #7/#8: no tuning
 * number ships on reading well.
 *
 *   node sim/run.mjs                        # all bots, 40 seeds each
 *   node sim/run.mjs --runs 100 --bot greedy
 *   node sim/run.mjs --set sunAccel=0.6 --set drops=120
 *
 * Bots:
 *   none   — never tilts. The floor: with every ledge sloping toward its wall,
 *            only overflow moves water, so this should die near the top.
 *   flip   — alternates full left / full right every 1.2 s, blind.
 *   greedy — finds the highest drop resting on a ledge (the one the sun gets
 *            first) and tilts fully toward that ledge's free tip. A player who
 *            reads the screen and always rescues the top.
 *
 * Tilt reaches a bot's target at a finite rate (T.maxTilt in ~0.25 s), since
 * a hand doesn't snap a phone from one side to the other.
 *
 * Reports per bot: depth reached (m) median / p10 / p90, seconds survived,
 * drops alive at 20 s and 60 s, and runs still alive at the time cap.
 */
import { makeWorld, step, T, ledgeUnder, depthM } from '../rules.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
for (let i = 0; i < args.length; i++)
  if (args[i] === '--set') { const [k, v] = args[i + 1].split('='); if (!(k in T)) throw new Error('unknown T.' + k); T[k] = Number(v); }
const RUNS = Number(opt('runs', 40));
const SEED0 = Number(opt('seed', 1));
const CAP = Number(opt('cap', 240));          // seconds; a run still alive here is censored
const BOTS = opt('bot', 'none,flip,greedy').split(',');
const TILT_RATE = T.maxTilt / 0.25;           // rad/s a hand can swing the phone

const bots = {
  none: () => 0,
  flip: (w) => (Math.floor(w.t / 1.2) % 2 ? 1 : -1) * T.maxTilt,
  greedy: (w, mem) => {
    let top = Infinity, side = 0;
    for (let i = 0; i < w.n; i++) {
      if (w.y[i] >= top) continue;
      const l = ledgeUnder(w, w.x[i], w.y[i]);
      if (l < 0) continue;
      top = w.y[i]; side = w.ledges[l].side;
    }
    if (side) mem.target = -side * T.maxTilt; // left ledge (-1) → tilt right (+)
    return mem.target ?? 0;
  },
};

function play(bot, seed) {
  const w = makeWorld({ seed });
  const mem = {};
  let tilt = 0, at20 = null, at60 = null;
  const maxStep = TILT_RATE * T.dt;
  while (!w.dead && w.t < CAP) {
    const want = bots[bot](w, mem);
    tilt += Math.max(-maxStep, Math.min(maxStep, want - tilt));
    step(w, { tilt });
    w.steam.length = 0;
    if (at20 === null && w.t >= 20) at20 = w.n;
    if (at60 === null && w.t >= 60) at60 = w.n;
  }
  return { depth: depthM(w.depth), t: w.t, at20: at20 ?? 0, at60: at60 ?? 0, alive: !w.dead };
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (v, d = 0) => v.toFixed(d).padStart(6);

console.log(`runs ${RUNS} · seeds ${SEED0}..${SEED0 + RUNS - 1} · cap ${CAP}s · drops ${T.drops} · sun v0 ${T.sunV0} accel ${T.sunAccel}`);
console.log('bot     depth m: p10    p50    p90 │ secs p50 │ drops@20s p50 │ @60s p50 │ alive@cap');
for (const bot of BOTS) {
  const rs = [];
  for (let r = 0; r < RUNS; r++) rs.push(play(bot, SEED0 + r));
  const d = rs.map((r) => r.depth), s = rs.map((r) => r.t);
  console.log(`${bot.padEnd(7)}        ${f(pct(d, 0.1))} ${f(pct(d, 0.5))} ${f(pct(d, 0.9))} │ ${f(pct(s, 0.5), 1)}   │ ${f(pct(rs.map((r) => r.at20), 0.5))}        │ ${f(pct(rs.map((r) => r.at60), 0.5))}   │ ${rs.filter((r) => r.alive).length}/${RUNS}`);
}
