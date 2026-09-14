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

function land(w, p) {
  const d = w.players[w.down];
  const zone = zoneOf(d.hand.p);
  p.fist.state = 'recover'; p.fist.t = 0;
  if (zone === 'hand') {
    d.hp -= T.thumpDamage;
    emit(w, 'thump', { id: p.id, target: d.id, hp: d.hp });
  } else {
    emit(w, zone, { id: p.id, target: d.id });   // 'wrist' | 'desk' — both fouls
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
      if (handIsThere(w)) { f.state = 'drop'; f.t = 0; emit(w, 'drop', { id: p.id }); }
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
}

export function step(w, dt, inputsById = {}) {
  w.events.length = 0;
  if (w.over) return w.events;
  w.t += dt;

  const d = w.players[w.down];
  stepHand(w, d, inputsById[d.id] || {}, dt);

  for (const p of w.players) {
    if (p.out || p.id === w.down) continue;
    stepFist(w, p, inputsById[p.id] || {}, dt);
  }
  return w.events;
}
