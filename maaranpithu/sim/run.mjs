#!/usr/bin/env node
/* Maaran Pithu balance harness — plays bot-only rounds of rules.js and prints
 * the numbers a balance change has to move. DECISIONS #7: no balance ships on
 * reading well.
 *
 *   node sim/run.mjs [--rounds 300] [--seed 1] [--bots 20] [--set ballSpeed=22] [--persona sniper=catch:0.3,reaction:0.3]
 *
 * Reports: round length (median, p10, p90), throw outcomes by target distance
 * bucket, ball-loose share of time, referee calls per round, win share per
 * personality (a personality's share of wins vs its share of the field).
 */
import { createWorld, step, throwArc, T, PERSONAS } from '../rules.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const ROUNDS = Number(opt('rounds', 300)), SEED0 = Number(opt('seed', 1)), BOTS = Number(opt('bots', 20));
const DT = 1 / 120, MAX_T = 900;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') { const [k, v] = args[i + 1].split('='); if (!(k in T)) throw new Error('unknown T.' + k); T[k] = Number(v); }
  if (args[i] === '--persona') {
    const [name, kv] = args[i + 1].split('='); const P = PERSONAS[name]; if (!P) throw new Error('unknown persona ' + name);
    for (const pair of kv.split(',')) { const [k, v] = pair.split(':'); if (k === 'range') P.range = v.split('-').map(Number); else P[k] = Number(v); }
  }
}

const BUCKETS = [5, 10, 15, 20, 25, 99];
const bucketOf = (d) => BUCKETS.find(b => d <= b);
const outcomes = {}; for (const b of BUCKETS) outcomes[b] = { hit: 0, caught: 0, miss: 0, airgap: 0 };
const byKind = { line: { hit: 0, caught: 0, miss: 0, airgap: 0 }, lob: { hit: 0, caught: 0, miss: 0, airgap: 0 } };
const lengths = [], wins = {}, field = {};
let looseShare = 0, airgaps = 0, holdings = 0, throwsPerRound = 0, stalls = 0, untargeted = 0, deadOnBounce = 0;

for (let r = 0; r < ROUNDS; r++) {
  const w = createWorld({ nBots: BOTS, humans: 0, seed: SEED0 + r });
  for (const p of w.players) field[p.persona] = (field[p.persona] || 0) + 1;
  let pending = null, pendingKind = 'line';
  while (!w.over && w.t < MAX_T) {
    for (const e of step(w, DT)) {
      if (e.type === 'throw') { pendingKind = e.kind; pending = e.targetDist === null ? null : bucketOf(e.targetDist); if (e.targetDist === null) untargeted++; }
      else if (pending !== null && (e.type === 'hit' || e.type === 'caught' || e.type === 'airgap' || e.type === 'drop' || (e.type === 'bounce' && e.first))) {
        const o = (e.type === 'drop' || e.type === 'bounce') ? 'miss' : e.type;
        outcomes[pending][o]++; byKind[pendingKind][o]++; pending = null;
      }
    }
  }
  if (!w.over) stalls++;
  lengths.push(w.t);
  looseShare += w.stats.looseTime / w.t; airgaps += w.stats.airgaps; holdings += w.stats.holdings; throwsPerRound += w.stats.throws;
  deadOnBounce += w.stats.deadOnBounce;
  const win = w.players[w.winner]; if (win) wins[win.persona] = (wins[win.persona] || 0) + 1;
}

lengths.sort((a, b) => a - b);
const q = (p) => lengths[Math.min(lengths.length - 1, Math.floor(p * lengths.length))].toFixed(0);
const pct = (n, d) => d ? (100 * n / d).toFixed(0).padStart(3) + '%' : '  –';
console.log(`\n${ROUNDS} rounds · ${BOTS} bots · seed ${SEED0}`);
console.log(`round length  median ${q(0.5)} s   p10 ${q(0.1)} s   p90 ${q(0.9)} s   stalls ${stalls}`);
console.log(`per round     throws ${(throwsPerRound / ROUNDS).toFixed(0)}   air-gap calls ${(airgaps / ROUNDS).toFixed(1)}   holding calls ${(holdings / ROUNDS).toFixed(1)}   ball loose ${(100 * looseShare / ROUNDS).toFixed(0)}% of time`);
console.log(`              dead on bounce ${(deadOnBounce / ROUNDS).toFixed(0)}/round`);
const arcs = ['line', 'lob'].map(k => { const a = throwArc(k); return `${k} lands ${a.range.toFixed(1)} yd in ${(a.range / a.speed).toFixed(2)} s${a.low ? `, over heads out to ${a.low.toFixed(1)} yd` : ', never above head height'}`; });
console.log(`arcs          ${arcs.join('\n              ')}`);
console.log(`\nthrows by target distance     n     hit   catch  miss  airgap`);
let prev = 0;
for (const b of BUCKETS) {
  const o = outcomes[b], n = o.hit + o.caught + o.miss + o.airgap;
  const label = b === 99 ? '   > 25 yd' : `${String(prev).padStart(2)}–${String(b).padStart(2)} yd`;
  console.log(`  ${label.padEnd(12)}          ${String(n).padStart(6)}  ${pct(o.hit, n)}  ${pct(o.caught, n)}  ${pct(o.miss, n)}  ${pct(o.airgap, n)}`);
  prev = b;
}
console.log(`  untargeted throws (nobody in the cone): ${untargeted}`);
console.log(`\nthrows by kind                n     hit   catch  miss  airgap`);
for (const k of ['line', 'lob']) {
  const o = byKind[k], n = o.hit + o.caught + o.miss + o.airgap;
  console.log(`  ${k.padEnd(12)}          ${String(n).padStart(6)}  ${pct(o.hit, n)}  ${pct(o.caught, n)}  ${pct(o.miss, n)}  ${pct(o.airgap, n)}`);
}
console.log(`\nwin share vs field share`);
for (const k of Object.keys(PERSONAS)) console.log(`  ${k.padEnd(8)} wins ${pct(wins[k] || 0, ROUNDS)}   field ${pct(field[k] || 0, ROUNDS * BOTS)}`);
console.log('');
