/* Maaran Pithu — pure simulation. No DOM, no canvas, no timers.
 *
 * Twenty kids, one tennis ball, a grassy field. Whoever holds the ball throws it
 * at anyone; a hit puts the target out; a catch keeps you in and gives you the
 * ball; the referee enforces the "air gap" (the ball must fly 3 yd before it
 * hits) and a holding limit. Last one standing.
 *
 * Units: yards and seconds. +x right, +y down (screen-like). Everything that
 * affects balance lives here so `sim/run.mjs` can play thousands of rounds in
 * Node with no renderer. `game.js` only reads the world and feeds the human's
 * inputs.
 *
 * API:  createWorld(opts) → world;  step(world, dt, inputsById) → world.events
 * inputs: { mx, my (−1..1), aimX, aimY (yards), throwEdge, slideEdge }
 * throwEdge throws when holding and attempts a catch when a ball is in flight.
 */

export const T = {
  fieldW: 60, fieldH: 40,
  boundsMinW: 20, boundsMinH: 14,
  shrinkRate: 2.5,     // yd/s the boundary edges move when shrinking
  playerR: 0.5,
  moveSpeed: 6,        // yd/s sprint
  holdSpeed: 1.5,      // yd/s shuffle while holding the ball
  slideDist: 4, slideTime: 0.35, slideCooldown: 1.2,
  catchWindow: 0.15,   // s before impact in which a throw-press catches
  airGap: 3,           // yd the ball must fly before a hit counts
  airGapStun: 0.5,     // s the thrower is frozen after a voided throw
  holdLimit: 3,        // s holding before the referee takes the ball
  ballR: 0.15,
  ballSpeed: 24,       // yd/s thrown (sim-tuned: 20 left 15 yd throws at 16% hits)
  ballRange: 25,       // yd of flight before it drops and rolls
  ballDropKeep: 0.35,  // fraction of speed kept when it drops
  ballFriction: 9,     // yd/s² deceleration while rolling
  pickupR: 0.9,        // yd from centre to grab a loose ball
  outWalk: 4,          // yd/s walk to the sideline when out
  botThinkDt: 0.1,     // s between bot decisions
  scorePlacement: 5, scoreHit: 2, scoreCatch: 3,
};

// Bot personalities. range = preferred throw distance; reaction = delay before
// responding to a throw; catch = chance to try a catch instead of dodging;
// throwDelay = s to settle before releasing; aimNoise = radians of scatter.
export const PERSONAS = {
  rusher: { range: [4.5, 8],  reaction: 0.22, catch: 0.30, throwDelay: 0.40, aimNoise: 0.06, keep: 6 },
  sniper: { range: [12, 18],  reaction: 0.45, catch: 0.20, throwDelay: 0.60, aimNoise: 0.02, keep: 12 },
  coward: { range: [15, 22],  reaction: 0.50, catch: 0.30, throwDelay: 0.40, aimNoise: 0.15, keep: 16 },
  kid:    { range: [5, 20],   reaction: 0.60, catch: 0.10, throwDelay: 0.70, aimNoise: 0.25, keep: 8 },
};
const PERSONA_MIX = ['rusher', 'sniper', 'coward', 'kid', 'rusher', 'sniper', 'kid'];

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
  const humanBias = opts.humanBias ?? 1;       // >1 = bots prefer the human as a target
  const w = { t: 0, seed, rng, humanBias, field: { w: T.fieldW, h: T.fieldH }, players: [], ball: null,
    events: [], alive: 0, winner: null, over: false, nextThink: 0, n: humans + nBots,
    stats: { throws: 0, hits: 0, catches: 0, airgaps: 0, holdings: 0, looseTime: 0 } };
  w.bounds = { x0: 0, y0: 0, x1: T.fieldW, y1: T.fieldH };
  w.boundsTarget = { ...w.bounds };
  w.ref = { x: T.fieldW / 2, y: -1.6, say: null, sayUntil: 0 };
  const n = w.n;
  for (let i = 0; i < n; i++) {
    const persona = i < humans ? null : (opts.persona || PERSONA_MIX[(i - humans) % PERSONA_MIX.length]);
    w.players.push({
      id: i, name: i < humans ? 'You' : NAMES[(i - humans) % NAMES.length],
      color: i < humans ? '#ffffff' : SHIRTS[(i - humans) % SHIRTS.length],
      isHuman: i < humans, x: 0, y: 0, vx: 0, vy: 0, r: T.playerR,
      out: false, outTarget: null, hits: 0, catches: 0, placement: 0, score: 0,
      facing: { x: 1, y: 0 }, aim: null, wantThrow: false, wantSlide: false,
      slideT: 0, slideCd: 0, slideDir: { x: 1, y: 0 }, stunT: 0, catchAt: -1,
      persona, bot: persona ? { mode: 'idle', target: null, plan: null, planAt: 0, seenThrow: -1, wander: { x: 0, y: 0 }, wanderAt: 0 } : null,
    });
  }
  // spawn in a loose ring so nobody starts inside anyone's air gap
  const cx = T.fieldW / 2, cy = T.fieldH / 2;
  w.players.forEach((p, i) => {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3;
    const rad = rng.range(9, 15);
    p.x = cx + Math.cos(a) * rad * 1.3; p.y = cy + Math.sin(a) * rad * 0.8;
  });
  w.alive = n;
  w.ball = { state: 'loose', x: cx, y: cy, vx: 0, vy: 0, holder: null, thrower: null,
    flown: 0, heldFor: 0, thrownAt: -1, dir: { x: 1, y: 0 } };
  return w;
}

export function alivePlayers(w) { return w.players.filter(p => !p.out); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function emit(w, type, data) { w.events.push({ type, t: w.t, ...data }); }
function refSay(w, text, secs = 1.6) { w.ref.say = text; w.ref.sayUntil = w.t + secs; }

// ── step ─────────────────────────────────────────────────────────────────────
export function step(w, dt, inputsById = {}) {
  w.events.length = 0;
  if (w.over) return w.events;
  w.t += dt;
  const b = w.ball;
  if (b.state === 'loose') w.stats.looseTime += dt;

  if (w.t >= w.nextThink) { thinkBots(w); w.nextThink = w.t + T.botThinkDt; }

  // ── players ──
  for (const p of w.players) {
    if (p.out) { walkOut(p, dt); continue; }
    const inp = p.isHuman ? (inputsById[p.id] || {}) : botInput(w, p);
    if (inp.aimX !== undefined) p.aim = { x: inp.aimX, y: inp.aimY };
    if (inp.throwEdge) p.wantThrow = true;
    if (inp.slideEdge) p.wantSlide = true;
    p.slideCd = Math.max(0, p.slideCd - dt);
    p.stunT = Math.max(0, p.stunT - dt);

    let mx = inp.mx || 0, my = inp.my || 0;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    if (m > 0.01) p.facing = { x: mx / m, y: my / m };

    // slide: a burst along the move direction (or facing), no steering mid-slide
    if (p.wantSlide && p.slideCd <= 0 && p.slideT <= 0 && p.stunT <= 0 && b.holder !== p.id) {
      p.slideT = T.slideTime; p.slideCd = T.slideCooldown;
      p.slideDir = m > 0.01 ? { x: mx / m, y: my / m } : { ...p.facing };
      emit(w, 'slide', { id: p.id, x: p.x, y: p.y });
    }
    p.wantSlide = false;

    if (p.stunT > 0) { p.vx = p.vy = 0; }
    else if (p.slideT > 0) {
      const sp = T.slideDist / T.slideTime;
      p.vx = p.slideDir.x * sp; p.vy = p.slideDir.y * sp; p.slideT -= dt;
    } else {
      const spd = (b.holder === p.id) ? T.holdSpeed : T.moveSpeed;
      p.vx = mx * spd; p.vy = my * spd;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;

    // catch attempt: a throw-press while a ball is in flight
    if (p.wantThrow && b.state === 'flight' && b.thrower !== p.id) p.catchAt = w.t;
  }
  separate(w);
  shrinkBounds(w, dt);
  clampAll(w);

  // ── ball ──
  if (b.state === 'held') {
    const h = w.players[b.holder];
    b.x = h.x + h.facing.x * 0.7; b.y = h.y + h.facing.y * 0.7;
    b.heldFor += dt;
    if (h.wantThrow && h.aim && h.stunT <= 0) throwBall(w, h);
    else if (b.heldFor >= T.holdLimit) refTakes(w, h);
  } else if (b.state === 'flight') {
    const stepLen = T.ballSpeed * dt;
    const n = Math.max(1, Math.ceil(stepLen / 0.25));   // no tunnelling through a 0.5 yd kid
    for (let i = 0; i < n && b.state === 'flight'; i++) {
      b.x += b.vx * dt / n; b.y += b.vy * dt / n; b.flown += stepLen / n;
      for (const p of w.players) {
        if (p.out || p.id === b.thrower) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + T.ballR) { contact(w, p); break; }
      }
      if (b.state === 'flight' && (b.flown >= T.ballRange || outOfBounds(w, b))) {
        b.state = 'loose'; b.vx *= T.ballDropKeep; b.vy *= T.ballDropKeep; b.thrower = null; emit(w, 'drop', {});
      }
    }
  }
  if (b.state === 'loose') {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) { const ns = Math.max(0, sp - T.ballFriction * dt); b.vx *= ns / sp; b.vy *= ns / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    // the ball stays inside the live boundary so it can always be fetched
    const B = w.bounds;
    if (b.x < B.x0) { b.x = B.x0; b.vx = Math.abs(b.vx) * 0.5; } if (b.x > B.x1) { b.x = B.x1; b.vx = -Math.abs(b.vx) * 0.5; }
    if (b.y < B.y0) { b.y = B.y0; b.vy = Math.abs(b.vy) * 0.5; } if (b.y > B.y1) { b.y = B.y1; b.vy = -Math.abs(b.vy) * 0.5; }
    let best = null, bd = T.pickupR;
    for (const p of w.players) { if (p.out || p.stunT > 0) continue; const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = p; } }
    if (best) hold(w, best, 'pickup');
  }
  for (const p of w.players) p.wantThrow = false;

  // referee jogs along the top sideline following the ball
  w.ref.x += (Math.min(w.field.w - 2, Math.max(2, b.x)) - w.ref.x) * Math.min(1, dt * 3);
  if (w.ref.say && w.t > w.ref.sayUntil) w.ref.say = null;

  // ── round end ──
  const alive = alivePlayers(w);
  w.alive = alive.length;
  if (alive.length <= 1 && !w.over) {
    w.over = true; w.winner = alive[0] ? alive[0].id : null;
    if (alive[0]) { alive[0].placement = 1; alive[0].score = scoreOf(w, alive[0]); }
    emit(w, 'win', { id: w.winner });
  }
  return w.events;
}

export function scoreOf(w, p) {
  return (w.n - p.placement) * T.scorePlacement + p.hits * T.scoreHit + p.catches * T.scoreCatch;
}

function hold(w, p, how) {
  const b = w.ball;
  b.state = 'held'; b.holder = p.id; b.thrower = null; b.heldFor = 0; b.vx = b.vy = 0;
  p.catchAt = -1;
  emit(w, how, { id: p.id });
}

function throwBall(w, h) {
  const b = w.ball;
  let dx = h.aim.x - h.x, dy = h.aim.y - h.y;
  const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  b.state = 'flight'; b.holder = null; b.thrower = h.id; b.flown = 0; b.thrownAt = w.t; b.dir = { x: dx, y: dy };
  b.x = h.x + dx * (h.r + T.ballR + 0.05); b.y = h.y + dy * (h.r + T.ballR + 0.05);
  b.vx = dx * T.ballSpeed; b.vy = dy * T.ballSpeed;
  h.facing = { x: dx, y: dy };
  // who is this aimed at? nearest alive player inside a narrow cone — for the balance sim
  let td = null, best = Infinity;
  for (const q of w.players) {
    if (q.out || q === h) continue;
    const qx = q.x - h.x, qy = q.y - h.y, d = Math.hypot(qx, qy);
    const cos = (qx * dx + qy * dy) / (d || 1);
    if (cos > 0.94 && d < best) { best = d; td = d; }
  }
  b.targetDist = td;
  w.stats.throws++;
  emit(w, 'throw', { id: h.id, x: b.x, y: b.y, targetDist: td });
}

// ball meets a player: void (no air gap), catch, or hit
function contact(w, p) {
  const b = w.ball;
  const thrower = w.players[b.thrower];
  if (b.flown < T.airGap) {
    // referee: no air gap. The fouled player gets the ball; the thrower is frozen.
    if (thrower) thrower.stunT = T.airGapStun;
    w.stats.airgaps++; refSay(w, 'No air gap!');
    emit(w, 'airgap', { id: thrower ? thrower.id : null, to: p.id, x: b.x, y: b.y });
    hold(w, p, 'pickup');
    return;
  }
  if (p.catchAt >= 0 && w.t - p.catchAt <= T.catchWindow) {
    p.catches++; w.stats.catches++;
    hold(w, p, 'catch');
    emit(w, 'caught', { id: p.id, by: thrower ? thrower.id : null, x: b.x, y: b.y });
    refSay(w, 'Caught!', 1.2);
    return;
  }
  if (thrower) thrower.hits++;
  w.stats.hits++;
  p.out = true; p.placement = w.alive; p.score = scoreOf(w, p);
  const cand = [{ x: -1.5, y: p.y }, { x: w.field.w + 1.5, y: p.y }, { x: p.x, y: -1.5 }, { x: p.x, y: w.field.h + 1.5 }];
  p.outTarget = cand.reduce((a, c) => dist(c, p) < dist(a, p) ? c : a);
  b.state = 'loose'; b.vx *= 0.15; b.vy *= 0.15; b.thrower = null;
  refSay(w, `${p.name}, out!`);
  emit(w, 'hit', { id: p.id, by: thrower ? thrower.id : null, x: b.x, y: b.y, dist: b.flown });
  retargetBounds(w);
}

function refTakes(w, h) {
  const b = w.ball, a = w.rng() * Math.PI * 2;
  b.state = 'loose'; b.holder = null; b.thrower = null; b.heldFor = 0;
  b.x = h.x + Math.cos(a) * 3; b.y = h.y + Math.sin(a) * 3; b.vx = b.vy = 0;
  h.stunT = 0.3;
  w.stats.holdings++; refSay(w, 'Holding!');
  emit(w, 'holding', { id: h.id });
}

function walkOut(p, dt) {
  if (!p.outTarget) return;
  const dx = p.outTarget.x - p.x, dy = p.outTarget.y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.05) { p.vx = p.vy = 0; return; }
  const s = Math.min(T.outWalk * dt, d);
  p.x += dx / d * s; p.y += dy / d * s; p.vx = dx / d * T.outWalk; p.vy = dy / d * T.outWalk;
}

function outOfBounds(w, b) { const B = w.bounds; return b.x < B.x0 || b.y < B.y0 || b.x > B.x1 || b.y > B.y1; }

// Boundary: area roughly ∝ players remaining, never below the minimum box.
function retargetBounds(w) {
  const s = Math.sqrt(Math.max(1, w.alive - 1) / w.n);
  const bw = Math.max(T.boundsMinW, w.field.w * s), bh = Math.max(T.boundsMinH, w.field.h * s);
  const cx = w.field.w / 2, cy = w.field.h / 2;
  w.boundsTarget = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
}
function shrinkBounds(w, dt) {
  const B = w.bounds, Tg = w.boundsTarget, m = T.shrinkRate * dt;
  for (const k of ['x0', 'y0', 'x1', 'y1']) { const d = Tg[k] - B[k]; B[k] += Math.sign(d) * Math.min(Math.abs(d), m); }
}

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

// ── bots ─────────────────────────────────────────────────────────────────────
// Is a ball in flight going to pass near p? Returns perpendicular distance and
// whether p is ahead of the ball; null if not threatened.
function threat(w, p) {
  const b = w.ball;
  if (b.state !== 'flight' || b.thrower === p.id) return null;
  const rx = p.x - b.x, ry = p.y - b.y;
  const along = rx * b.dir.x + ry * b.dir.y;
  if (along < 0 || along > T.ballRange - b.flown + 1) return null;
  const perp = Math.abs(rx * b.dir.y - ry * b.dir.x);
  if (perp > 2.2) return null;
  return { along, perp, eta: along / T.ballSpeed };
}

function thinkBots(w) {
  const b = w.ball;
  const alive = alivePlayers(w);
  // nearest *bot* to a loose ball goes for it; the human competes on their own, so
  // a human who stands still never leaves the ball lying there
  let nearest = null, nd = Infinity;
  if (b.state === 'loose') for (const p of alive) { if (!p.bot) continue; const d = dist(p, b); if (d < nd) { nd = d; nearest = p; } }
  for (const p of alive) {
    if (!p.bot) continue;
    const bot = p.bot, P = PERSONAS[p.persona];
    // a new throw resets the evade plan
    if (b.state === 'flight' && b.thrownAt !== bot.seenThrow) {
      bot.seenThrow = b.thrownAt; bot.plan = null;
      bot.planAt = b.thrownAt + P.reaction * w.rng.range(0.7, 1.9);   // kids get distracted
    }
    const th = threat(w, p);
    if (th && w.t >= bot.planAt) {
      if (!bot.plan) bot.plan = (w.rng() < P.catch) ? 'catch' : 'dodge';
      bot.mode = 'evade'; continue;
    }
    if (b.state === 'held' && b.holder === p.id) {
      // choose a target: nearest, with the human made to look closer by the bias
      const [lo, hi] = P.range;
      let t = null, td = Infinity;
      for (const q of alive) {
        if (q === p) continue;
        const raw = dist(p, q);
        // distance as the bot feels it: in-range targets look closer, the human looks closer by the bias
        const d = (raw >= lo && raw <= hi ? raw * 0.5 : raw) / (q.isHuman ? w.humanBias : 1);
        if (d < td) { td = d; t = q; }
      }
      bot.target = t; bot.mode = 'hold'; continue;
    }
    if (b.state === 'loose' && (p === nearest || dist(p, b) < (p.persona === 'rusher' ? 12 : 5))) { bot.mode = 'fetch'; continue; }
    bot.mode = 'idle';
    if (w.t > bot.wanderAt) { const a = w.rng() * Math.PI * 2; bot.wander = { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 }; bot.wanderAt = w.t + w.rng.range(0.6, 1.8); }
  }
}

// anyone (not just the target) standing inside the air gap along the throw line?
function someoneInGap(w, p, t) {
  const dx = t.x - p.x, dy = t.y - p.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  for (const q of w.players) {
    if (q.out || q === p) continue;
    const qx = q.x - p.x, qy = q.y - p.y, along = qx * ux + qy * uy;
    if (along > 0 && along < T.airGap + 0.6 && Math.abs(qx * uy - qy * ux) < q.r + T.ballR + 0.3) return true;
  }
  return false;
}
function toward(p, x, y, sign = 1) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy) || 1;
  return { mx: sign * dx / d, my: sign * dy / d };
}

function botInput(w, p) {
  const b = w.ball, bot = p.bot, P = PERSONAS[p.persona];
  const B = w.bounds, cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
  if (bot.mode === 'evade') {
    const th = threat(w, p);
    if (!th) { bot.mode = 'idle'; return { mx: 0, my: 0 }; }
    if (bot.plan === 'catch') {
      // face the ball, stand, press in the window
      p.facing = { x: -b.dir.x, y: -b.dir.y };
      return { mx: 0, my: 0, throwEdge: th.eta <= T.catchWindow * 0.8 && p.catchAt < 0 };
    }
    // dodge: slide perpendicular to the ball's path, away from its line
    const rx = p.x - b.x, ry = p.y - b.y;
    const side = Math.sign(rx * b.dir.y - ry * b.dir.x) || 1;
    const px = b.dir.y * side, py = -b.dir.x * side;
    // don't slide into the boundary: flip if that side is blocked
    const nx = p.x + px * T.slideDist, ny = p.y + py * T.slideDist;
    const blocked = nx < B.x0 + 1 || nx > B.x1 - 1 || ny < B.y0 + 1 || ny > B.y1 - 1;
    if (bot.dodgeSide === undefined || bot.dodgeFor !== b.thrownAt) { bot.dodgeFor = b.thrownAt; bot.dodgeSide = w.rng() < 0.15 ? -1 : 1; }
    const sx = (blocked ? -px : px) * bot.dodgeSide, sy = (blocked ? -py : py) * bot.dodgeSide;
    return { mx: sx, my: sy, slideEdge: p.slideCd <= 0 && th.eta < 0.4 };
  }
  if (bot.mode === 'fetch') return toward(p, b.x, b.y);
  if (bot.mode === 'hold' && bot.target) {
    const t = bot.target, d = dist(p, t);
    const [lo, hi] = P.range;
    // rushers and kids step toward the target if too far; cowards and snipers back off if too close
    let mv = { mx: 0, my: 0 };
    if (d < lo) mv = toward(p, t.x, t.y, -1); else if (d > hi) mv = toward(p, t.x, t.y, 1);
    const inRange = d >= lo * 0.8 && d <= hi * 1.15;
    const mustThrow = b.heldFor > T.holdLimit - 0.5;
    const settled = b.heldFor > P.throwDelay;
    let inp = { ...mv };
    const ux = (t.x - p.x) / (d || 1), uy = (t.y - p.y) / (d || 1);
    const closing = -((t.vx - p.vx) * ux + (t.vy - p.vy) * uy);          // yd/s, positive = approaching
    if (d - Math.max(0, closing) * 0.25 < T.airGap + 1 || someoneInGap(w, p, t)) return toward(p, t.x, t.y, -1);
    if (settled && (inRange || mustThrow || (p.persona === 'coward' && d < 10))) {
      const lead = d / T.ballSpeed;
      let ax = t.x + t.vx * lead - p.x, ay = t.y + t.vy * lead - p.y;
      const na = Math.atan2(ay, ax) + (w.rng() - 0.5) * 2 * P.aimNoise;
      const L = Math.hypot(ax, ay);
      inp.aimX = p.x + Math.cos(na) * L; inp.aimY = p.y + Math.sin(na) * L; inp.throwEdge = true;
    }
    return inp;
  }
  // idle: keep a personal distance from the holder, drift toward the middle, wander
  let mx = bot.wander.x, my = bot.wander.y;
  if (b.state === 'held' && b.holder !== null) {
    const h = w.players[b.holder], d = dist(p, h);
    if (d < P.keep) { const a = toward(p, h.x, h.y, -1); mx += a.mx * 1.5; my += a.my * 1.5; }
    else if (p.persona === 'rusher' && d > P.keep + 4) { const a = toward(p, h.x, h.y, 1); mx += a.mx * 0.6; my += a.my * 0.6; }
  }
  const c = toward(p, cx, cy, 1); const dc = Math.hypot(p.x - cx, p.y - cy);
  if (dc > Math.min(B.x1 - B.x0, B.y1 - B.y0) * 0.4) { mx += c.mx * 0.8; my += c.my * 0.8; }
  return { mx, my };
}
