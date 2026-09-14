import { test } from 'node:test';
import assert from 'node:assert';
import { createWorld, step, zoneOf, T } from '../rules.js';

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
