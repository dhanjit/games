import { test } from 'node:test';
import assert from 'node:assert';
import { createWorld, step, zoneOf, T, PERSONAS } from '../rules.js';

test('createWorld builds two kids, one of them down', () => {
  const w = createWorld({ humans: 1, nBots: 1, seed: 1 });
  assert.strictEqual(w.players.length, 2);
  assert.strictEqual(w.down, 0);
  assert.strictEqual(w.players[0].isHuman, true);
  assert.strictEqual(w.players[1].isHuman, false);
  for (const p of w.players) {
    assert.strictEqual(p.fist.state, 'ready');
    assert.strictEqual(p.hand.state, 'flat');
    assert.strictEqual(p.hand.p, 0);
    assert.strictEqual(p.hand.nerve, T.nerveMax);
    assert.ok(p.hp > 0);
  }
});

test('step advances the clock and returns an events array', () => {
  const w = createWorld({ humans: 1, nBots: 1, seed: 1 });
  const ev = step(w, 1 / 120, {});
  assert.ok(Array.isArray(ev));
  assert.ok(Math.abs(w.t - 1 / 120) < 1e-9);
});

test('zoneOf maps the retreat scalar onto the three contact zones', () => {
  assert.strictEqual(zoneOf(0), 'hand');
  assert.strictEqual(zoneOf(T.handGrace), 'hand');
  assert.strictEqual(zoneOf(T.handGrace + 0.01), 'wrist');
  assert.strictEqual(zoneOf(0.99), 'wrist');
  assert.strictEqual(zoneOf(1), 'desk');
});

test('the same seed replays identically', () => {
  const a = createWorld({ seed: 7 }), b = createWorld({ seed: 7 });
  assert.strictEqual(a.rng(), b.rng());
});

// Drive the world in 1/120 s ticks, collecting every event, with one held
// boolean per player id. Returns the events seen during those seconds.
function advance(w, seconds, inputsById = {}) {
  const out = [];
  const DT = 1 / 120;
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...step(w, DT, inputsById).map(e => ({ ...e })));
  return out;
}
const typesOf = (evs) => evs.map(e => e.type);

test('holding winds the fist, then loads it', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  const evs = advance(w, T.windTime + 0.02, { 1: { hold: true } });
  assert.ok(typesOf(evs).includes('wind'));
  assert.ok(typesOf(evs).includes('load'));
  assert.strictEqual(w.players[1].fist.state, 'loaded');
});

test('a loaded fist may not drop before loadMin has passed', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  advance(w, T.windTime + 0.01, { 1: { hold: true } });
  const early = advance(w, T.loadMin / 2, { 1: { hold: false } });
  assert.ok(!typesOf(early).includes('drop'));
  assert.strictEqual(w.players[1].fist.state, 'loaded');
  const late = advance(w, T.loadMin, { 1: { hold: false } });
  assert.ok(typesOf(late).includes('drop'));
});

test('a drop onto a hand that never moved is a thump, and costs HP', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  const hp0 = w.players[0].hp;
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  const evs = advance(w, T.dropTime + 0.02, { 1: { hold: false } });
  const thump = evs.find(e => e.type === 'thump');
  assert.ok(thump, 'expected a thump event');
  assert.strictEqual(thump.id, 1);
  assert.strictEqual(thump.target, 0);
  assert.strictEqual(w.players[0].hp, hp0 - T.thumpDamage);
  assert.strictEqual(w.players[1].fist.state, 'recover');
});

test('a spent fist recovers back to ready and cannot strike meanwhile', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0, hp: 99 });
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  advance(w, T.dropTime + 0.02, { 1: { hold: false } });
  const during = advance(w, T.recoverTime / 2, { 1: { hold: true } });
  assert.ok(!typesOf(during).includes('wind'), 'a recovering fist must not wind');
  advance(w, T.recoverTime, { 1: { hold: false } });
  assert.strictEqual(w.players[1].fist.state, 'ready');
});

test('the kid who is down has no fist in play', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  const evs = advance(w, T.windTime + 0.05, { 0: { hold: true } });
  assert.ok(!typesOf(evs).includes('wind'));
  assert.strictEqual(w.players[0].fist.state, 'ready');
});

test('holding slides the hand back, and it returns when released', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  advance(w, T.slideTime + 0.02, { 0: { hold: true } });
  assert.strictEqual(w.players[0].hand.state, 'clear');
  assert.ok(Math.abs(w.players[0].hand.p - 1) < 1e-6);
  advance(w, T.returnTime + 0.02, { 0: { hold: false } });
  assert.strictEqual(w.players[0].hand.state, 'flat');
  assert.ok(Math.abs(w.players[0].hand.p) < 1e-6);
});

test('a drop landing mid-slide hits the wrist — a foul, and no damage', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0, hp: 99 });
  // Load the fist first, then start the slide so the hand is in the wrist band
  // at the moment the drop lands.
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  const hp0 = w.players[0].hp;
  // Release the fist and start sliding on the same tick. The release tick is
  // spent entering `drop`, so landing needs dropTime *after* it — hence the
  // extra slack here. It lands with the hand at p ≈ 0.97, past handGrace.
  const evs = advance(w, T.dropTime + 0.02, { 0: { hold: true }, 1: { hold: false } });
  assert.ok(typesOf(evs).includes('wrist'), `expected a wrist foul, got ${typesOf(evs)}`);
  assert.ok(!typesOf(evs).includes('thump'));
  assert.strictEqual(w.players[0].hp, hp0);
});

test('a drop landing on a fully cleared spot hits bare desk', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0, hp: 99 });
  advance(w, T.slideTime + 0.02, { 0: { hold: true } });          // hand fully clear
  advance(w, T.windTime + T.loadMin + 0.01, { 0: { hold: true }, 1: { hold: true } });
  // handIsThere() is false, so releasing would abort. Freeze the fist into a
  // drop by clearing the bait path: drive the drop directly.
  w.players[1].fist.state = 'drop'; w.players[1].fist.t = 0;
  const evs = advance(w, T.dropTime + 0.01, { 0: { hold: true }, 1: { hold: true } });
  assert.ok(typesOf(evs).includes('desk'));
});

test('starting a slide costs nerve up front, and clear time drains it', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  const h = w.players[0].hand;
  advance(w, 1 / 60, { 0: { hold: true } });
  assert.ok(Math.abs(h.nerve - (T.nerveMax - T.slideCost)) < 0.02, `nerve ${h.nerve}`);
  const before = h.nerve;
  advance(w, T.slideTime + 0.5, { 0: { hold: true } });
  assert.ok(h.nerve < before - 0.1, 'holding clear must drain nerve');
});

test('nerve refills only while the hand is flat', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  const h = w.players[0].hand;
  advance(w, T.slideTime + 0.6, { 0: { hold: true } });
  const drained = h.nerve;
  advance(w, T.returnTime + 0.02, { 0: { hold: false } });        // returning: no regen
  assert.ok(h.nerve <= drained + 1e-6, 'a returning hand must not regenerate');
  advance(w, 1.0, { 0: { hold: false } });                        // flat: regen
  assert.ok(h.nerve > drained + 0.1, 'a flat hand must regenerate');
});

test('an exhausted hand is pinned and cannot slide at all', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  advance(w, 8, { 0: { hold: true } });                           // burn the bar down
  assert.strictEqual(w.players[0].hand.pinned, true);
  advance(w, T.returnTime + 0.05, { 0: { hold: false } });
  assert.strictEqual(w.players[0].hand.state, 'flat');
  advance(w, T.slideTime, { 0: { hold: true } });
  assert.strictEqual(w.players[0].hand.p, 0, 'a pinned hand must not move');
});

test('sliding with nobody threatening arms nothing and just burns nerve', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  const evs = advance(w, T.slideTime + 0.1, { 0: { hold: true } });
  assert.ok(!typesOf(evs).includes('baitArm'));
  assert.strictEqual(w.bait, null);
  assert.strictEqual(w.down, 0, 'nobody may go down without an armed bait');
  assert.ok(w.players[0].hand.nerve < T.nerveMax);
});

test('sliding while a fist is loaded arms a bait', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  const evs = advance(w, T.slideTime + 0.02, { 0: { hold: true }, 1: { hold: true } });
  assert.ok(typesOf(evs).includes('baitArm'));
  assert.ok(w.bait);
});

test('releasing once the hand has gone aborts instead of dropping', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  advance(w, T.slideTime + 0.02, { 0: { hold: true }, 1: { hold: true } });
  const evs = advance(w, 1 / 60, { 0: { hold: true }, 1: { hold: false } });
  assert.ok(typesOf(evs).includes('abort'));
  assert.ok(!typesOf(evs).includes('drop'));
  assert.strictEqual(w.players[1].fist.state, 'abort');
});

test('in a duel, the lone caught fist goes down when the window closes', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0 });
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  advance(w, T.slideTime + 0.02, { 0: { hold: true }, 1: { hold: true } });
  const evs = advance(w, T.baitWindow + 0.05, { 0: { hold: true }, 1: { hold: false } });
  const resolved = evs.find(e => e.type === 'baitResolve');
  assert.ok(resolved, 'the window must resolve');
  assert.strictEqual(resolved.loser, 1);
  assert.strictEqual(w.down, 1);
  assert.ok(typesOf(evs).includes('goesDown'));
});

test('the last to resolve goes down — a fast fouler walks, a slow aborter pays', () => {
  const w = createWorld({ humans: 3, nBots: 0, seed: 1, down: 0 });
  // Both 1 and 2 load. 1 is already dropping when the hand goes (fouls early);
  // 2 dithers and aborts late.
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true }, 2: { hold: true } });
  w.players[1].fist.state = 'drop'; w.players[1].fist.t = 0;      // committed
  advance(w, T.slideTime + 0.02, { 0: { hold: true }, 2: { hold: true } });
  advance(w, 0.25, { 0: { hold: true }, 2: { hold: true } });      // 2 dithers
  const evs = advance(w, T.baitWindow, { 0: { hold: true }, 2: { hold: false } });
  const resolved = evs.find(e => e.type === 'baitResolve');
  assert.ok(resolved);
  assert.strictEqual(resolved.loser, 2, 'the later resolver goes down');
  assert.strictEqual(w.down, 2);
});

test('a fist that never wound ranks below everyone and goes down', () => {
  const w = createWorld({ humans: 3, nBots: 0, seed: 1, down: 0 });
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });   // only 1 threatens
  advance(w, T.slideTime + 0.02, { 0: { hold: true }, 1: { hold: true } });
  const evs = advance(w, T.baitWindow + 0.05, { 0: { hold: true }, 1: { hold: false } });
  const resolved = evs.find(e => e.type === 'baitResolve');
  assert.strictEqual(resolved.loser, 2, 'the passive kid outranks an aborter for last place');
  assert.strictEqual(resolved.kind, 'passive');
});

test('a foul with no bait open puts that fist straight down', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0, hp: 99 });
  advance(w, T.slideTime + 0.02, { 0: { hold: true } });   // clear, no threat, no bait
  assert.strictEqual(w.bait, null);
  w.players[1].fist.state = 'drop'; w.players[1].fist.t = 0;
  advance(w, T.dropTime + 0.02, { 0: { hold: true } });
  assert.strictEqual(w.down, 1);
});

test('losing the last HP ends the duel', () => {
  const w = createWorld({ humans: 2, nBots: 0, seed: 1, down: 0, hp: 1 });
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  const evs = advance(w, T.dropTime + 0.02, { 1: { hold: false } });
  assert.ok(typesOf(evs).includes('out'));
  assert.ok(typesOf(evs).includes('over'));
  assert.strictEqual(w.over, true);
  assert.strictEqual(w.winner, 1);
});

test('a bait waits for a fist mid-drop instead of freezing it, and resolves once', () => {
  const w = createWorld({ humans: 3, nBots: 0, seed: 1, down: 0, hp: 99 });
  // Fist 1 loads and holds — the threat that arms the bait when the hand
  // clears — and never releases, so at resolution it can only ever
  // contribute a synthesized 'froze' entry.
  advance(w, T.windTime + T.loadMin + 0.01, { 1: { hold: true } });
  advance(w, T.slideTime + 0.02, { 0: { hold: true }, 1: { hold: true } });
  assert.ok(w.bait, 'bait must be open');

  // Force fist 2 into a drop that is still mid-flight when the window's
  // nominal close time arrives — standing in for "released while the hand
  // was momentarily back in the hand zone" (ordinary held input reaches this
  // too, since dropTime is well under baitWindow; forcing the state directly
  // just pins the exact timing this regression needs).
  const untilClose = w.bait.closeAt - w.t;
  advance(w, untilClose - T.dropTime / 2, { 0: { hold: true }, 1: { hold: true } });
  w.players[2].fist.state = 'drop';
  w.players[2].fist.t = 0;
  assert.ok(w.t < w.bait.closeAt, 'the window must not have closed yet');

  const evs = advance(w, T.dropTime + 0.05, { 0: { hold: true }, 1: { hold: true } });

  const resolved = evs.find(e => e.type === 'baitResolve');
  assert.ok(resolved, 'the window must resolve once the committed drop lands');
  const entry2 = resolved.entries.find(e => e.id === 2);
  assert.ok(entry2, 'fist 2 must have an entry');
  assert.ok(entry2.kind === 'wrist' || entry2.kind === 'desk',
    `a fist that actually landed must not be synthesized as frozen, got ${entry2.kind}`);
  assert.strictEqual(typesOf(evs).filter(t => t === 'goesDown').length, 1,
    'the bait must send exactly one fist down');
});

test('a bot up against a passive human eventually lands a thump', () => {
  const w = createWorld({ humans: 1, nBots: 1, seed: 3, down: 0, hp: 99 });
  const evs = advance(w, 12, { 0: { hold: false } });   // human never slides
  assert.ok(typesOf(evs).includes('thump'), 'an unresisting hand must get hit');
});

test('a bot that is down slides when a fist winds at it', () => {
  const w = createWorld({ humans: 1, nBots: 1, seed: 3, down: 1, hp: 99 });
  const evs = advance(w, 3, { 0: { hold: true } });     // human holds a wind
  assert.ok(typesOf(evs).includes('slideStart'), 'a bot must react to a wind');
});

test('a bot-only duel runs to a finish with no human input at all', () => {
  const w = createWorld({ humans: 0, nBots: 2, seed: 5, down: 0 });
  let guard = 0;
  while (!w.over && guard++ < 120 * 600) step(w, 1 / 120, {});
  assert.strictEqual(w.over, true, 'a bot duel must terminate');
  assert.ok(w.winner === 0 || w.winner === 1);
});

test('bot duels are deterministic for a given seed', () => {
  const run = (seed) => {
    const w = createWorld({ humans: 0, nBots: 2, seed, down: 0 });
    let guard = 0;
    while (!w.over && guard++ < 120 * 600) step(w, 1 / 120, {});
    return `${w.winner}:${w.t.toFixed(4)}`;
  };
  assert.strictEqual(run(11), run(11));
});

test('every persona names the five fields the bot reads', () => {
  for (const [name, p] of Object.entries(PERSONAS)) {
    for (const k of ['spookAt', 'abortReaction', 'loadStyle', 'nerveFloor', 'noise']) {
      assert.ok(k in p, `persona ${name} is missing ${k}`);
    }
  }
});
