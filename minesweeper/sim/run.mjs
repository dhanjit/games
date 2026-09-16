#!/usr/bin/env node
/* Infinite Minesweeper balance harness — plays scripted runs of rules.js and
 * prints the numbers a density change has to move. DECISIONS #7/#8: no balance
 * number ships on reading well.
 *
 *   node sim/run.mjs                 # density sweep 0.12 → 0.25
 *   node sim/run.mjs --density 0.16 --runs 400 --seed 1
 *   node sim/run.mjs --sweep 0.14,0.16,0.18 --runs 200
 *
 * The bot plays "reveal-safe-then-guess-lowest-risk":
 *   1. single-point logic to a fixpoint — a number with all its mines flagged
 *      opens its other neighbours; a number whose covered neighbours all must
 *      be mines flags them;
 *   2. stuck → guess the covered frontier cell with the lowest naive risk
 *      (max over adjacent constraints of minesLeft/coveredLeft); if even the
 *      best frontier cell is riskier than virgin ground, island-hop to an
 *      unconstrained cell instead (risk ≈ density).
 *
 * At the moment of a fatal guess an exact oracle (backtracking over the
 * frontier's connected constraint components, concept per DavidNHill/
 * JSMinesweeper's probability engine, MIT) decides whether a provably safe
 * cell existed: yes → the death was solvable-but-misplayed; no → a forced
 * guess; component too big to enumerate → unknown.
 *
 * Reports per density: median / p90 area revealed before death, death mix
 * (forced / misplayed / unknown), guesses per run, area per guess, flood-cap
 * hits, censored runs (hit the area cap alive).
 */
import { makeWorld, reveal, toggleFlag, T, FLAG, key } from '../rules.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const RUNS = Number(opt('runs', 200));
const SEED0 = Number(opt('seed', 1));
const AREA_CAP = Number(opt('cap', 20000));     // stop a run still alive here (censored)
const ORACLE_CELLS = 20;                        // max covered cells per component to enumerate
const ORACLE_NODES = 400000;                    // backtracking node budget per component
for (let i = 0; i < args.length; i++)
  if (args[i] === '--set') { const [k, v] = args[i + 1].split('='); if (!(k in T)) throw new Error('unknown T.' + k); T[k] = Number(v); }
const DENSITIES = opt('density', null) ? [Number(opt('density'))]
  : (opt('sweep', null) ? opt('sweep').split(',').map(Number)
    : [0.12, 0.14, 0.16, 0.18, 0.20, 0.22, 0.25]);

// ── frontier bookkeeping ─────────────────────────────────────────────────────
const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function coveredAround(w, x, y) {
  const out = [];
  for (const [dx, dy] of NB) {
    const st = w.cells.get(key(x + dx, y + dy));
    if (st === undefined) out.push([x + dx, y + dy]);
  }
  return out;
}
function flagsAround(w, x, y) {
  let n = 0;
  for (const [dx, dy] of NB) if (w.cells.get(key(x + dx, y + dy)) === FLAG) n++;
  return n;
}

/* Constraints for the oracle and the risk estimate: every revealed number that
 * still touches a covered cell. */
function constraints(w, active) {
  const out = [];
  for (const k of active) {
    const [x, y] = k.split(',').map(Number);
    const n = w.cells.get(k);
    const covered = coveredAround(w, x, y);
    if (!covered.length) { active.delete(k); continue; }
    out.push({ need: n - flagsAround(w, x, y), covered });
  }
  return out;
}

/* Exact oracle: group constraints into connected components by shared covered
 * cells, enumerate mine placements per component by backtracking, and report
 * whether any covered cell is safe in every satisfying assignment. */
function provablySafeExists(cons) {
  // map covered cell key → cell index; build cell↔constraint adjacency
  const cellIdx = new Map(), cells = [];
  for (const c of cons)
    for (const [x, y] of c.covered) {
      const k = key(x, y);
      if (!cellIdx.has(k)) { cellIdx.set(k, cells.length); cells.push({ cons: [] }); }
    }
  cons.forEach((c, ci) => {
    c.idx = c.covered.map(([x, y]) => cellIdx.get(key(x, y)));
    for (const i of c.idx) cells[i].cons.push(ci);
  });
  // connected components over cells (via shared constraints)
  const comp = new Array(cells.length).fill(-1);
  let nComp = 0;
  for (let s = 0; s < cells.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s]; comp[s] = nComp;
    while (stack.length) {
      const i = stack.pop();
      for (const ci of cells[i].cons)
        for (const j of cons[ci].idx)
          if (comp[j] < 0) { comp[j] = nComp; stack.push(j); }
    }
    nComp++;
  }
  let unknown = false;
  for (let g = 0; g < nComp; g++) {
    const idxs = [];
    for (let i = 0; i < cells.length; i++) if (comp[i] === g) idxs.push(i);
    if (idxs.length > ORACLE_CELLS) { unknown = true; continue; }
    const gcons = [...new Set(idxs.flatMap((i) => cells[i].cons))].map((ci) => cons[ci]);
    // local indices
    const local = new Map(idxs.map((gi, li) => [gi, li]));
    const lc = gcons.map((c) => ({ need: c.need, idx: c.idx.filter((i) => local.has(i)).map((i) => local.get(i)) }));
    const n = idxs.length;
    const assign = new Array(n).fill(-1);
    const everMine = new Array(n).fill(false), everSafe = new Array(n).fill(false);
    const mines = lc.map(() => 0), left = lc.map((c) => c.idx.length);
    const cellCons = Array.from({ length: n }, () => []);
    lc.forEach((c, ci) => c.idx.forEach((i) => cellCons[i].push(ci)));
    let nodes = 0, aborted = false;
    (function dfs(i) {
      if (aborted || ++nodes > ORACLE_NODES) { aborted = true; return; }
      if (i === n) {
        for (let j = 0; j < lc.length; j++) if (mines[j] !== lc[j].need) return;
        for (let j = 0; j < n; j++) (assign[j] ? everMine : everSafe)[j] = true;
        return;
      }
      for (const v of [0, 1]) {
        assign[i] = v;
        let ok = true;
        for (const ci of cellCons[i]) {
          mines[ci] += v; left[ci]--;
          if (mines[ci] > lc[ci].need || mines[ci] + left[ci] < lc[ci].need) ok = false;
        }
        if (ok) dfs(i + 1);
        for (const ci of cellCons[i]) { mines[ci] -= v; left[ci]++; }
      }
      assign[i] = -1;
    })(0);
    if (aborted) { unknown = true; continue; }
    for (let j = 0; j < n; j++) if (everSafe[j] && !everMine[j]) return 'safe';
  }
  return unknown ? 'unknown' : 'none';
}

// ── one run ──────────────────────────────────────────────────────────────────
function playRun(density, seed) {
  const w = makeWorld({ density, seed });
  const active = new Set(); // revealed numbers that may still constrain
  let guesses = 0, floodsCapped = 0;
  const track = (res) => {
    if (!res || res.type !== 'reveal') return;
    if (res.capped) floodsCapped++;
    for (const [x, y, c] of res.cells) if (c > 0) active.add(key(x, y));
  };
  track(reveal(w, 0, 0));

  while (!w.dead && w.revealed < AREA_CAP) {
    // 1. single-point fixpoint
    let moved = true;
    while (moved && !w.dead && w.revealed < AREA_CAP) {
      moved = false;
      for (const k of [...active]) {
        const [x, y] = k.split(',').map(Number);
        const covered = coveredAround(w, x, y);
        if (!covered.length) { active.delete(k); continue; }
        const need = w.cells.get(k) - flagsAround(w, x, y);
        if (need === 0) { for (const [cx, cy] of covered) track(reveal(w, cx, cy)); moved = true; }
        else if (need === covered.length) { for (const [cx, cy] of covered) toggleFlag(w, cx, cy); moved = true; }
      }
    }
    if (w.dead || w.revealed >= AREA_CAP) break;

    // 2. stuck → guess lowest naive risk
    const cons = constraints(w, active);
    const risk = new Map(); // key → max constraint risk
    for (const c of cons) {
      const r = c.need / c.covered.length;
      for (const [x, y] of c.covered) {
        const k = key(x, y);
        risk.set(k, Math.max(risk.get(k) ?? 0, r));
      }
    }
    let bestK = null, bestR = Infinity;
    for (const [k, r] of risk) if (r < bestR) { bestR = r; bestK = k; }

    let gx, gy;
    if (bestK !== null && bestR <= density) {
      [gx, gy] = bestK.split(',').map(Number);
    } else {
      // island-hop: virgin ground at base density beats the frontier
      const from = bestK ?? key(0, 0);
      let [hx, hy] = from.split(',').map(Number);
      hx += 4;
      while (w.cells.has(key(hx, hy))) hx += 4;
      gx = hx; gy = hy;
    }
    guesses++;
    const res = reveal(w, gx, gy);
    if (res && res.type === 'boom') {
      const verdict = provablySafeExists(cons); // 'safe' | 'none' | 'unknown'
      return { area: w.revealed, dead: true, verdict, guesses, floodsCapped };
    }
    track(res);
  }
  return { area: w.revealed, dead: w.dead, verdict: null, guesses, floodsCapped };
}

// ── sweep ────────────────────────────────────────────────────────────────────
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
console.log(`\n${RUNS} runs per density · seed ${SEED0} · area cap ${AREA_CAP} · floodCap ${T.floodCap}`);
console.log('density   p50 area  p90 area   forced  misplayed  unknown   guesses/run  area/guess  capped floods  censored');
for (const d of DENSITIES) {
  const areas = [];
  let forced = 0, misplayed = 0, unknownV = 0, deaths = 0, guesses = 0, floods = 0, censored = 0;
  for (let r = 0; r < RUNS; r++) {
    const res = playRun(d, SEED0 + r * 7919);
    areas.push(res.area);
    guesses += res.guesses; floods += res.floodsCapped;
    if (!res.dead) censored++;
    else if (res.verdict) {
      deaths++;
      if (res.verdict === 'safe') misplayed++;
      else if (res.verdict === 'none') forced++;
      else unknownV++;
    }
  }
  areas.sort((a, b) => a - b);
  const pct = (n) => deaths ? (100 * n / deaths).toFixed(0).padStart(4) + '%' : '   –';
  console.log(
    `${d.toFixed(2)}    ${String(q(areas, 0.5)).padStart(8)}  ${String(q(areas, 0.9)).padStart(8)}   ` +
    `${pct(forced)}     ${pct(misplayed)}    ${pct(unknownV)}   ${(guesses / RUNS).toFixed(1).padStart(11)}  ` +
    `${(areas.reduce((a, b) => a + b, 0) / Math.max(1, guesses)).toFixed(1).padStart(10)}  ` +
    `${String(floods).padStart(13)}  ${String(censored).padStart(8)}`);
}
console.log('');
