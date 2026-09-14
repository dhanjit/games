/* handslam — pure simulation. No DOM, no canvas, no timers.
 *
 * Six kids round a desk. One is `down` — hand flat, palm down. The rest are up,
 * fists permanently cocked. A fist winds (the tell), holds loaded, then drops.
 * The hand may not be lifted, only slid back along the desk — which drags the
 * wrist through the strike zone behind it, so a late fist hits wrist, not wood.
 *
 * Units: seconds. The hand's retreat is a scalar p, 0 (on the spot) → 1 (clear).
 * Everything that affects balance lives in T so sim/run.mjs can play thousands
 * of matches in Node with no renderer.
 *
 * API:  createWorld(opts) → world;  step(world, dt, inputsById) → world.events
 * inputs: { hold }  ← one boolean, meaning depends on your role.
 */

export const T = {
  // the fist
  windTime: 0.12,     // s of visible tension before the fist is loaded — the tell
  loadMin: 0.10,      // s a fist must stay loaded before it may drop
  dropTime: 0.11,     // s of fall, uninterruptible
  abortTime: 0.15,    // s to pull a loaded fist back to ready
  recoverTime: 0.30,  // s a spent fist is out of play after landing

  // the hand
  slideTime: 0.12,    // s to pull the hand fully back
  returnTime: 0.15,   // s to slide it back out
  handGrace: 0.45,    // retreat fraction still counted as the back of the hand

  // nerve
  nerveMax: 1,
  slideCost: 0.12,    // flat cost the moment a slide starts
  nerveDrain: 0.34,   // per s while the hand is clear
  nerveRegen: 0.15,   // per s, and only while the hand is flat
  nerveUnpin: 0.25,   // nerve needed to unpin an exhausted hand

  // the bait
  baitWindow: 0.45,   // s a bait stays open collecting entries

  thumpDamage: 1,
  startHp: 3,
  botThinkDt: 0,      // bots decide every step in M1; raised if profiling asks
};

// Bot personalities. Every field is a timing the harness can move; none of them
// reads a state a human cannot see on screen.
//
// spookAt must exceed T.windTime + T.loadMin (the earliest legal drop, 0.22s)
// or the defender always starts sliding before any drop is even legal, always
// escapes, and the attacker always aborts — a duel that never ends. 0.30
// leaves headroom above that 0.22 floor for the `noise` jitter.
export const PERSONAS = {
  kid: { spookAt: 0.30, abortReaction: 0.22, loadStyle: [0.15, 0.55], nerveFloor: 0.18, noise: 0.05 },
};
const P = (p) => PERSONAS[p.persona] || PERSONAS.kid;

const BOT_NAMES = ['Bunty', 'Arjun', 'Meera', 'Vikram', 'Nitin', 'Sana'];

// ── deterministic RNG (mulberry32) ───────────────────────────────────────────
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
  return r;
}

/** Which of the three contact zones sits under a strike spot at retreat p. */
export function zoneOf(p) {
  if (p <= T.handGrace) return 'hand';
  if (p < 1) return 'wrist';
  return 'desk';
}

function emit(w, type, data) { w.events.push({ type, t: w.t, ...data }); }

const THREAT = new Set(['wind', 'loaded', 'drop']);

/** The hand is "there" when the strike spot still holds the back of it. */
function handIsThere(w) { return zoneOf(w.players[w.down].hand.p) === 'hand'; }

function tryArm(w) {
  if (w.bait) return;
  const threat = w.players.some(p => p.id !== w.down && !p.out && THREAT.has(p.fist.state));
  if (!threat) return;
  w.bait = { openedAt: w.t, closeAt: w.t + T.baitWindow, entries: [] };
  emit(w, 'baitArm', { at: w.t });
}

function addEntry(w, p, kind) {
  if (!w.bait) { goDown(w, p, kind); return; }          // a lone foul, no window
  if (w.bait.entries.some(e => e.id === p.id)) return;  // one entry per fist
  w.bait.entries.push({ id: p.id, t: w.t, kind });
}

/** Seats further clockwise from the current defender rank later on a tie. */
function seatDist(w, id) { return (id - w.down + w.n) % w.n; }

/** True while a live fist is still committed to a drop — the bait must wait
 * to see where it lands before anyone is sent down for it. */
function anyFistCommitted(w) {
  return w.players.some(p => p.id !== w.down && !p.out && p.fist.state === 'drop');
}

function resolveBait(w) {
  const b = w.bait;
  w.bait = null;
  for (const p of w.players) {
    if (p.id === w.down || p.out) continue;
    if (b.entries.some(e => e.id === p.id)) continue;
    if (p.fist.state === 'recover') continue;            // spent its turn honestly
    b.entries.push(p.fist.state === 'ready'
      ? { id: p.id, t: b.closeAt + 1e-6, kind: 'passive' }
      : { id: p.id, t: b.closeAt, kind: 'froze' });
  }
  if (!b.entries.length) { emit(w, 'baitResolve', { entries: [], loser: null, kind: null }); return; }
  b.entries.sort((x, y) => (y.t - x.t) || (seatDist(w, y.id) - seatDist(w, x.id)));
  const loser = b.entries[0];
  emit(w, 'baitResolve', { entries: b.entries.slice(), loser: loser.id, kind: loser.kind });
  goDown(w, w.players[loser.id], loser.kind);
}

function goDown(w, p, kind) {
  if (p.id === w.down || p.out) return;
  const from = w.down;
  const prev = w.players[from];
  prev.hand.state = 'flat'; prev.hand.p = 0;
  w.down = p.id;
  p.fist.state = 'recover'; p.fist.t = 0;      // you do not strike on arrival
  p.hand.state = 'flat'; p.hand.p = 0;
  p.hand.pinned = false;
  p.hand.nerve = T.nerveMax;                   // M1: a fresh turn starts calm
  w.bait = null;
  emit(w, 'goesDown', { id: p.id, from, kind });
}

function knockOut(w, d, by) {
  d.out = true;
  emit(w, 'out', { id: d.id });
  const alive = w.players.filter(x => !x.out);
  if (alive.length <= 1) {
    w.over = true;
    w.winner = alive.length ? alive[0].id : null;
    emit(w, 'over', { winner: w.winner });
  } else {
    goDown(w, by, 'knockout');
  }
}

function land(w, p) {
  const d = w.players[w.down];
  const zone = zoneOf(d.hand.p);
  p.fist.state = 'recover'; p.fist.t = 0;
  if (zone === 'hand') {
    d.hp -= T.thumpDamage;
    emit(w, 'thump', { id: p.id, target: d.id, hp: d.hp });
    if (d.hp <= 0) knockOut(w, d, p);
  } else {
    emit(w, zone, { id: p.id, target: d.id });
    addEntry(w, p, zone);
  }
}

function stepFist(w, p, inp, dt) {
  const f = p.fist;
  f.t += dt;
  switch (f.state) {
    case 'ready':
      if (inp.hold) { f.state = 'wind'; f.t = 0; emit(w, 'wind', { id: p.id }); }
      break;
    case 'wind':
      if (f.t >= T.windTime) { f.state = 'loaded'; f.t = 0; emit(w, 'load', { id: p.id }); }
      break;
    case 'loaded':
      if (f.t < T.loadMin || inp.hold) break;
      if (handIsThere(w)) {
        f.state = 'drop'; f.t = 0;
        emit(w, 'drop', { id: p.id });
      } else {
        f.state = 'abort'; f.t = 0;
        emit(w, 'abort', { id: p.id });
        addEntry(w, p, 'abort');
      }
      break;
    case 'drop':
      if (f.t >= T.dropTime) land(w, p);
      break;
    case 'abort':
      if (f.t >= T.abortTime) { f.state = 'ready'; f.t = 0; }
      break;
    case 'recover':
      if (f.t >= T.recoverTime) { f.state = 'ready'; f.t = 0; }
      break;
  }
}

export function createWorld(opts = {}) {
  const seed = opts.seed ?? 1;
  const humans = opts.humans ?? 1;
  const nBots = opts.nBots ?? 1;
  const n = humans + nBots;
  const w = {
    t: 0, seed, rng: makeRng(seed), n,
    players: [], events: [], down: opts.down ?? 0,
    bait: null, over: false, winner: null,
  };
  for (let i = 0; i < n; i++) {
    w.players.push({
      id: i, seat: i,
      name: i < humans ? 'You' : BOT_NAMES[(i - humans) % BOT_NAMES.length],
      isHuman: i < humans,
      hp: opts.hp ?? T.startHp,
      out: false,
      fist: { state: 'ready', t: 0 },
      hand: { p: 0, state: 'flat', nerve: T.nerveMax, pinned: false },
      persona: i < humans ? null : (opts.persona ?? 'kid'),
      bot: i < humans ? null : { strikeAt: -1, release: -1, reacted: false },
    });
  }
  return w;
}

function stepHand(w, p, inp, dt) {
  const h = p.hand;
  const wasHand = zoneOf(h.p) === 'hand';
  switch (h.state) {
    case 'flat':
      h.nerve = Math.min(T.nerveMax, h.nerve + T.nerveRegen * dt);
      if (h.pinned && h.nerve >= T.nerveUnpin) h.pinned = false;
      if (inp.hold && !h.pinned) {
        h.nerve -= T.slideCost;
        if (h.nerve <= 0) { h.nerve = 0; h.pinned = true; emit(w, 'pinned', { id: p.id }); }
        else { h.state = 'sliding'; emit(w, 'slideStart', { id: p.id }); }
      }
      break;
    case 'sliding':
      h.p = Math.min(1, h.p + dt / T.slideTime);
      if (!inp.hold) h.state = 'returning';
      else if (h.p >= 1) h.state = 'clear';
      break;
    case 'clear':
      h.nerve = Math.max(0, h.nerve - T.nerveDrain * dt);
      if (h.nerve <= 0) { h.pinned = true; h.state = 'returning'; emit(w, 'pinned', { id: p.id }); }
      else if (!inp.hold) h.state = 'returning';
      break;
    case 'returning':
      h.p = Math.max(0, h.p - dt / T.returnTime);
      if (h.p <= 0) { h.p = 0; h.state = 'flat'; }
      else if (inp.hold && !h.pinned) h.state = 'sliding';
      break;
  }
  if (wasHand && zoneOf(h.p) !== 'hand') tryArm(w);
}

/** How long the most advanced enemy fist has been threatening, in seconds. */
function maxThreatAge(w, exceptId) {
  let best = 0;
  for (const p of w.players) {
    if (p.id === exceptId || p.out || p.id === w.down) continue;
    if (p.fist.state === 'wind') best = Math.max(best, p.fist.t);
    else if (p.fist.state === 'loaded' || p.fist.state === 'drop') best = Math.max(best, T.windTime + p.fist.t);
  }
  return best;
}

export function botInput(w, p) {
  const cfg = P(p);
  const jitter = () => 1 + (w.rng() - 0.5) * 2 * cfg.noise;

  if (p.id === w.down) {
    const h = p.hand;
    if (h.pinned || h.nerve <= cfg.nerveFloor) return { hold: false };
    return { hold: maxThreatAge(w, p.id) >= cfg.spookAt * jitter() };
  }

  const f = p.fist, b = p.bot;
  if (f.state === 'ready') {
    b.reacted = false;
    if (b.strikeAt < 0) b.strikeAt = w.t + w.rng.range(0.3, 1.4);
    if (w.t >= b.strikeAt) {
      b.strikeAt = -1;
      b.release = w.t + T.windTime + w.rng.range(cfg.loadStyle[0], cfg.loadStyle[1]);
      return { hold: true };
    }
    return { hold: false };
  }
  if (f.state === 'wind' || f.state === 'loaded') {
    // The hand starting to go is the starting gun. Reaction time is the test.
    if (!handIsThere(w) && !b.reacted) {
      b.reacted = true;
      b.release = Math.min(b.release, w.t + cfg.abortReaction * jitter());
    }
    return { hold: w.t < b.release };
  }
  b.reacted = false;
  return { hold: false };
}

export function step(w, dt, inputsById = {}) {
  w.events.length = 0;
  if (w.over) return w.events;
  w.t += dt;

  const inputOf = (p) => (p.isHuman ? (inputsById[p.id] || {}) : botInput(w, p));

  const d = w.players[w.down];
  stepHand(w, d, inputOf(d), dt);

  for (const p of w.players) {
    if (p.out || p.id === w.down) continue;
    stepFist(w, p, inputOf(p), dt);
  }

  // After the fists: an abort on the closing tick must still count. A fist
  // still mid-drop keeps the window open past closeAt — resolving early would
  // synthesize a 'froze' entry for it, and its real landing would then hit
  // addEntry's no-bait fallback and go down a second time for the same bait.
  if (w.bait && w.t >= w.bait.closeAt && !anyFistCommitted(w)) resolveBait(w);
  return w.events;
}
