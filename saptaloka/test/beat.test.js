const { test } = require('node:test');
const assert = require('node:assert');
const beat = require('../beat.js');

const card = { id: 'village_widow', speaker: 'A village widow' };
const Z = { prana: 0, tejas: 0, karma: 0, bhakti: 0 };

test('authored outcome is returned verbatim', () => {
  const choice = { label: 'x', outcome: 'A hand-written line.' };
  assert.strictEqual(beat.outcomeText(choice, { karma: 5 }, card), 'A hand-written line.');
});

test('all-zero deltas give the neutral line', () => {
  assert.strictEqual(
    beat.outcomeText({ label: 'Walk past' }, Z, card),
    'You let the moment pass — nothing in you shifts.'
  );
});

test('missing/undefined deltas treated as zero -> neutral, never throws', () => {
  assert.strictEqual(
    beat.outcomeText({ label: 'x' }, {}, card),
    'You let the moment pass — nothing in you shifts.'
  );
});

test('dominant clause reflects the dominant axis + direction', () => {
  // karma is the only mover -> a karma-up clause must appear, no other stat clause
  const s = beat.outcomeText({ label: 'Sit and chant' }, { karma: 6 }, card);
  assert.match(s, /ledger of your deeds tips toward the light|dharma settles more firmly on your side/);
});

test('tie-break prefers karma over a larger prana drain', () => {
  // prana -8 is bigger in magnitude, but the moral axis leads
  const s = beat.outcomeText({ label: 'x' }, { prana: -8, karma: 4 }, card);
  assert.match(s, /ledger of your deeds|dharma settles/);
});

test('opposite-sign secondary >=3 adds one counter-clause; <3 does not', () => {
  const withCounter = beat.outcomeText({ label: 'x' }, { karma: 6, tejas: -4 }, card);
  assert.match(withCounter, /, but /);
  const noCounter = beat.outcomeText({ label: 'x' }, { karma: 6, tejas: -2 }, card);
  assert.doesNotMatch(noCounter, /, but /);
});

test('big magnitude gets the intensifier', () => {
  const s = beat.outcomeText({ label: 'x' }, { prana: -19 }, card);
  assert.match(s, /^Sharply — /);
});

test('deterministic: same inputs -> same output', () => {
  const a = beat.outcomeText({ label: 'Sit and chant' }, { karma: 4, tejas: -4 }, card);
  const b = beat.outcomeText({ label: 'Sit and chant' }, { karma: 4, tejas: -4 }, card);
  assert.strictEqual(a, b);
});

test('uses passed deltas, not choice.fx (function fx is never invoked)', () => {
  let called = false;
  const choice = { label: 'Let him play', fx: () => { called = true; return { tejas: 50 }; } };
  const s = beat.outcomeText(choice, { bhakti: 12, prana: -10 }, card);
  assert.strictEqual(called, false);
  assert.match(s, /heart bends closer to the divine|devotion swells/);
});
