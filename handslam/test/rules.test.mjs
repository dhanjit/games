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
