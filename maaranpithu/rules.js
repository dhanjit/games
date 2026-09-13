/* Maaran Pithu — pure simulation. No DOM, no canvas, no timers.
 *
 * Twenty kids, one tennis ball, a grassy field. Whoever holds the ball throws it
 * at anyone; a hit puts the target out; a catch keeps you in and gives you the
 * ball; the referee enforces the "air gap" and a holding limit. Last one standing.
 *
 * Units: yards and seconds. +x right, +y down (screen-like). Everything that
 * affects balance lives here so `sim/run.mjs` can play thousands of rounds of it
 * in Node with no renderer. `game.js` only reads the world and feeds one
 * player's inputs.
 *
 * API:  createWorld(opts) → world;  step(world, dt, inputsById) → world.events
 */

export const T = {
  fieldW: 60, fieldH: 40,
  playerR: 0.5,
  moveSpeed: 6,        // yd/s sprint
  holdSpeed: 1.5,      // yd/s shuffle while holding the ball
  ballR: 0.15,
  ballSpeed: 20,       // yd/s thrown
  ballRange: 25,       // yd of flight before it drops and rolls
  ballDropKeep: 0.35,  // fraction of speed kept when it drops
  ballFriction: 9,     // yd/s² deceleration while rolling
  pickupR: 0.9,        // yd from centre to grab a loose ball
  outWalk: 4,          // yd/s walk to the sideline when out
  botThinkDt: 0.12,    // s between bot decisions
};

// ── deterministic RNG (mulberry32) ────────────────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

const SHIRTS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8d5bd9', '#ff7ab6',
  '#3bb273', '#e9c46a', '#1d8fe1', '#c1666b', '#5e548e', '#f28482',
  '#00b4d8', '#9b5de5', '#ff9f1c', '#2ec4b6', '#b5838d', '#6a994e', '#ffb703'];
const NAMES = ['Bhaskar', 'Riju', 'Momi', 'Pranab', 'Jonali', 'Dipu', 'Nayan', 'Bulbul',
  'Ranjit', 'Mitali', 'Hemen', 'Rupa', 'Bikash', 'Jina', 'Tapan', 'Sewali',
  'Anjan', 'Dolly', 'Kamal', 'Pinky'];

export function createWorld(opts = {}) {
  const seed = opts.seed ?? (Date.now() & 0xffffffff);
  const rng = makeRng(seed);
  const nBots = opts.nBots ?? 19;
  const humans = opts.humans ?? 1;
  const w = { t: 0, seed, rng, field: { w: T.fieldW, h: T.fieldH }, players: [], ball: null,
    events: [], alive: 0, winner: null, over: false, nextThink: 0 };
  w.bounds = { x0: 0, y0: 0, x1: T.fieldW, y1: T.fieldH };
  const n = humans + nBots;
  for (let i = 0; i < n; i++) {
    const p = {
      id: i, name: i < humans ? 'You' : NAMES[(i - humans) % NAMES.length],
      color: i < humans ? '#ffffff' : SHIRTS[(i - humans) % SHIRTS.length],
      isHuman: i < humans, x: 0, y: 0, vx: 0, vy: 0, r: T.playerR,
      out: false, outTarget: null, hits: 0, catches: 0, placement: 0,
      facing: { x: 1, y: 0 }, bot: i < humans ? null : { target: null, wantThrow: false },
    };
    w.players.push(p);
  }
  // spawn in a loose ring so nobody starts inside the air-gap of anyone
  const cx = T.fieldW / 2, cy = T.fieldH / 2;
  w.players.forEach((p, i) => {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3;
    const rad = rng.range(9, 15);
    p.x = cx + Math.cos(a) * rad * 1.3; p.y = cy + Math.sin(a) * rad * 0.8;
  });
  w.alive = n;
  w.ball = { state: 'loose', x: cx, y: cy, vx: 0, vy: 0, holder: null, thrower: null,
    flown: 0, heldFor: 0 };
  return w;
}

function alivePlayers(w) { return w.players.filter(p => !p.out); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function emit(w, type, data) { w.events.push({ type, t: w.t, ...data }); }

// ── step ─────────────────────────────────────────────────────────────────────
// inputsById: { [playerId]: { mx, my (−1..1), aimX, aimY (world coords), throwEdge } }
export function step(w, dt, inputsById = {}) {
  w.events.length = 0;
  if (w.over) return w.events;
  w.t += dt;

  if (w.t >= w.nextThink) { thinkBots(w); w.nextThink = w.t + T.botThinkDt; }

  // movement
  for (const p of w.players) {
    if (p.out) { walkOut(p, dt); continue; }
    const inp = p.isHuman ? (inputsById[p.id] || {}) : botInput(w, p);
    let mx = inp.mx || 0, my = inp.my || 0;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const spd = (w.ball.holder === p.id) ? T.holdSpeed : T.moveSpeed;
    p.vx = mx * spd; p.vy = my * spd;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (m > 0.01) p.facing = { x: mx / Math.max(m, 1e-6), y: my / Math.max(m, 1e-6) };
    if (inp.aimX !== undefined) p.aim = { x: inp.aimX, y: inp.aimY };
    if (inp.throwEdge) p.wantThrow = true;
  }
  separate(w);
  clampAll(w);

  // ball
  const b = w.ball;
  if (b.state === 'held') {
    const h = w.players[b.holder];
    b.x = h.x + h.facing.x * 0.7; b.y = h.y + h.facing.y * 0.7;
    b.heldFor += dt;
    if (h.wantThrow && h.aim) throwBall(w, h);
  } else if (b.state === 'flight') {
    const stepLen = T.ballSpeed * dt;
    // sub-step so a fast ball can't tunnel through a 0.5 yd kid
    const n = Math.max(1, Math.ceil(stepLen / 0.25));
    for (let i = 0; i < n && b.state === 'flight'; i++) {
      b.x += b.vx * dt / n; b.y += b.vy * dt / n; b.flown += stepLen / n;
      for (const p of w.players) {
        if (p.out || p.id === b.thrower) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + T.ballR) { hit(w, p); break; }
      }
      if (b.state === 'flight' && (b.flown >= T.ballRange || outOfField(w, b))) {
        b.state = 'loose'; b.vx *= T.ballDropKeep; b.vy *= T.ballDropKeep; emit(w, 'drop', {});
      }
    }
  }
  if (b.state === 'loose') {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) { const ns = Math.max(0, sp - T.ballFriction * dt); b.vx *= ns / sp; b.vy *= ns / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    // bounce off the field edge (the ball can leave the shrunk boundary, not the field)
    if (b.x < 0) { b.x = 0; b.vx = -b.vx * 0.5; } if (b.x > w.field.w) { b.x = w.field.w; b.vx = -b.vx * 0.5; }
    if (b.y < 0) { b.y = 0; b.vy = -b.vy * 0.5; } if (b.y > w.field.h) { b.y = w.field.h; b.vy = -b.vy * 0.5; }
    // pickup: nearest alive player within reach
    let best = null, bd = T.pickupR;
    for (const p of w.players) { if (p.out) continue; const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = p; } }
    if (best) { b.state = 'held'; b.holder = best.id; b.thrower = null; b.heldFor = 0; b.vx = b.vy = 0; emit(w, 'pickup', { id: best.id }); }
  }
  for (const p of w.players) p.wantThrow = false;

  // round end
  const alive = alivePlayers(w);
  w.alive = alive.length;
  if (alive.length <= 1 && !w.over) {
    w.over = true; w.winner = alive[0] ? alive[0].id : null;
    if (alive[0]) alive[0].placement = 1;
    emit(w, 'win', { id: w.winner });
  }
  return w.events;
}

function throwBall(w, h) {
  const b = w.ball;
  let dx = h.aim.x - h.x, dy = h.aim.y - h.y;
  const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  b.state = 'flight'; b.holder = null; b.thrower = h.id; b.flown = 0;
  b.x = h.x + dx * (h.r + T.ballR + 0.05); b.y = h.y + dy * (h.r + T.ballR + 0.05);
  b.vx = dx * T.ballSpeed; b.vy = dy * T.ballSpeed;
  h.facing = { x: dx, y: dy };
  emit(w, 'throw', { id: h.id });
}

function hit(w, p) {
  const b = w.ball;
  const thrower = w.players[b.thrower];
  if (thrower) thrower.hits++;
  p.out = true; p.placement = w.alive; // 20th out = placement 20
  // walk to nearest field edge and sit
  const cand = [{ x: -1.5, y: p.y }, { x: w.field.w + 1.5, y: p.y }, { x: p.x, y: -1.5 }, { x: p.x, y: w.field.h + 1.5 }];
  p.outTarget = cand.reduce((a, c) => dist(c, p) < dist(a, p) ? c : a);
  b.state = 'loose'; b.vx *= 0.15; b.vy *= 0.15; b.thrower = null;
  emit(w, 'hit', { id: p.id, by: thrower ? thrower.id : null, x: b.x, y: b.y });
}

function walkOut(p, dt) {
  if (!p.outTarget) return;
  const dx = p.outTarget.x - p.x, dy = p.outTarget.y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.05) { p.vx = p.vy = 0; return; }
  const s = Math.min(T.outWalk * dt, d);
  p.x += dx / d * s; p.y += dy / d * s; p.vx = dx / d * T.outWalk; p.vy = dy / d * T.outWalk;
}

function outOfField(w, b) { return b.x < 0 || b.y < 0 || b.x > w.field.w || b.y > w.field.h; }

// soft circle separation so kids jostle instead of overlapping
function separate(w) {
  const ps = alivePlayers(w);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], c = ps[j];
    let dx = c.x - a.x, dy = c.y - a.y; let d = Math.hypot(dx, dy);
    const min = a.r + c.r;
    if (d < min && d > 1e-6) { const push = (min - d) / 2; dx /= d; dy /= d; a.x -= dx * push; a.y -= dy * push; c.x += dx * push; c.y += dy * push; }
    else if (d <= 1e-6) { a.x -= 0.1; c.x += 0.1; }
  }
}

function clampAll(w) {
  const B = w.bounds;
  for (const p of w.players) {
    if (p.out) continue;
    p.x = Math.min(B.x1 - p.r, Math.max(B.x0 + p.r, p.x));
    p.y = Math.min(B.y1 - p.r, Math.max(B.y0 + p.r, p.y));
  }
}

// ── bots (M1: dumb) ───────────────────────────────────────────────────────────
// Every botThinkDt: if the ball is loose and I'm the nearest alive player, go get
// it. If I hold it, throw at the nearest other player. Otherwise drift away from
// whoever holds the ball.
function thinkBots(w) {
  const b = w.ball;
  const alive = alivePlayers(w);
  let nearest = null, nd = Infinity;
  if (b.state === 'loose') for (const p of alive) { const d = dist(p, b); if (d < nd) { nd = d; nearest = p; } }
  for (const p of alive) {
    if (!p.bot) continue;
    const bot = p.bot;
    bot.mode = 'idle'; bot.target = null;
    if (b.state === 'loose' && (p === nearest || dist(p, b) < 6)) bot.mode = 'fetch';
    else if (b.state === 'held' && b.holder === p.id) {
      let t = null, td = Infinity;
      for (const q of alive) { if (q === p) continue; const d = dist(p, q); if (d < td) { td = d; t = q; } }
      bot.target = t; bot.mode = 'throw';
    } else if (b.state === 'held') bot.mode = 'evade';
  }
}

function botInput(w, p) {
  const b = w.ball, bot = p.bot;
  if (bot.mode === 'fetch') { const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1; return { mx: dx / d, my: dy / d }; }
  if (bot.mode === 'throw' && bot.target) {
    const t = bot.target;
    // lead the target a little by its velocity
    const d = dist(p, t), lead = d / T.ballSpeed;
    return { mx: 0, my: 0, aimX: t.x + t.vx * lead, aimY: t.y + t.vy * lead, throwEdge: b.heldFor > 0.35 };
  }
  if (bot.mode === 'evade' && b.holder !== null) {
    const h = w.players[b.holder]; const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d < 14) return { mx: dx / d, my: dy / d };
  }
  return { mx: 0, my: 0 };
}
