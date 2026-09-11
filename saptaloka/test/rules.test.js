const { test } = require('node:test');
const assert = require('node:assert');
const Rules = require('../rules.js');

const STATS = ['prana', 'tejas', 'karma', 'bhakti'];
const god = { id: 'indra_test', tag: 'god' };
const mortal = { id: 'village_widow' };

// Realm indices are 0-based, matching state.realmIdx / REALMS order.
const BHULOKA = 0, BHUVARLOKA = 1, SVARLOKA = 2, MAHARLOKA = 3, JANALOKA = 4, TAPOLOKA = 5, SATYALOKA = 6;

test('Bhūloka has no rule: every delta is identity, no ambient, no text', () => {
  for (const s of STATS) {
    assert.strictEqual(Rules.delta(BHULOKA, s, -7, god), -7);
    assert.strictEqual(Rules.delta(BHULOKA, s, +9, mortal), +9);
  }
  assert.strictEqual(Rules.ambient(BHULOKA), null);
  assert.strictEqual(Rules.rule(BHULOKA), null);
});

test('Bhuvarloka: prāṇa drains ×1.5 (rounded); gains and other stats untouched', () => {
  assert.strictEqual(Rules.delta(BHUVARLOKA, 'prana', -8, mortal), -12);
  assert.strictEqual(Rules.delta(BHUVARLOKA, 'prana', -12, mortal), -18);
  assert.strictEqual(Rules.delta(BHUVARLOKA, 'prana', -7, mortal), Math.round(-10.5));
  assert.strictEqual(Rules.delta(BHUVARLOKA, 'prana', +4, mortal), +4);
  assert.strictEqual(Rules.delta(BHUVARLOKA, 'tejas', -8, mortal), -8);
  assert.strictEqual(Rules.delta(BHUVARLOKA, 'karma', -8, mortal), -8);
  assert.strictEqual(Rules.ambient(BHUVARLOKA), null);
});

test("Svarloka: tejas gains from god cards doubled; mortals' gifts and any loss unchanged", () => {
  assert.strictEqual(Rules.delta(SVARLOKA, 'tejas', +6, god), +12);
  assert.strictEqual(Rules.delta(SVARLOKA, 'tejas', +6, mortal), +6);
  assert.strictEqual(Rules.delta(SVARLOKA, 'tejas', -4, god), -4);
  assert.strictEqual(Rules.delta(SVARLOKA, 'bhakti', +6, god), +6);
  assert.strictEqual(Rules.delta(SVARLOKA, 'tejas', +6, null), +6, 'no card → no doubling');
  assert.strictEqual(Rules.ambient(SVARLOKA), null);
});

test('Maharloka and Janaloka are neutral in this pass', () => {
  for (const r of [MAHARLOKA, JANALOKA]) {
    for (const s of STATS) assert.strictEqual(Rules.delta(r, s, -5, god), -5);
    assert.strictEqual(Rules.ambient(r), null);
    assert.strictEqual(Rules.rule(r), null);
  }
});

test('Tapoloka: +3 tejas ambient on every card; deltas themselves identity', () => {
  assert.deepStrictEqual(Rules.ambient(TAPOLOKA), { tejas: 3 });
  for (const s of STATS) assert.strictEqual(Rules.delta(TAPOLOKA, s, +5, god), +5);
});

test('Satyaloka: prāṇa gains become 0; drains and other stats untouched', () => {
  assert.strictEqual(Rules.delta(SATYALOKA, 'prana', +4, mortal), 0);
  assert.strictEqual(Rules.delta(SATYALOKA, 'prana', -5, mortal), -5);
  assert.strictEqual(Rules.delta(SATYALOKA, 'bhakti', +11, god), +11);
  assert.strictEqual(Rules.ambient(SATYALOKA), null);
});

test('every realm with a rule carries one line of cutscene text', () => {
  for (const r of [BHUVARLOKA, SVARLOKA, TAPOLOKA, SATYALOKA]) {
    const rule = Rules.rule(r);
    assert.ok(rule && typeof rule.text === 'string' && rule.text.length > 20, `realm ${r}`);
  }
});

test('out-of-range or bad realm index is identity, never throws', () => {
  for (const r of [-1, 7, 99, undefined, null, NaN]) {
    assert.strictEqual(Rules.delta(r, 'prana', -6, god), -6);
    assert.strictEqual(Rules.ambient(r), null);
    assert.strictEqual(Rules.rule(r), null);
  }
});

test('a zero delta stays zero under every rule', () => {
  for (let r = 0; r < 7; r++) for (const s of STATS) assert.strictEqual(Rules.delta(r, s, 0, god), 0);
});
