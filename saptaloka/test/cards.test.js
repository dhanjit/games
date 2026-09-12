// Structural invariants over the deck — the checks saptaloka/CLAUDE.md asks for
// after every balance/arc edit, made permanent. Loads cards.js the way the game
// does (a window shim), so it needs no DOM.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const sandbox = { window: {}, Math };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'cards.js'), 'utf8'), sandbox);
const { REALMS, CARDS, CUTSCENES, ENDINGS } = sandbox.window.SAPTALOKA;
const STATS = ['prana', 'tejas', 'karma', 'bhakti'];
const byId = Object.fromEntries(CARDS.map(c => [c.id, c]));
const isPlainFx = fx => fx && typeof fx === 'object';

test('seven realms, each with cutscene copy', () => {
  assert.strictEqual(REALMS.length, 7);
  assert.strictEqual(CUTSCENES.length, 7);
  for (const cs of CUTSCENES) assert.ok(cs.deva && cs.narration);
});

test('every card has an id, speaker, text and two labelled choices', () => {
  const ids = new Set();
  for (const c of CARDS) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`); ids.add(c.id);
    assert.ok(c.speaker && c.text, c.id);
    for (const side of ['left', 'right']) {
      assert.ok(c[side] && typeof c[side].label === 'string' && c[side].label.length, `${c.id}.${side}.label`);
      assert.ok('fx' in c[side], `${c.id}.${side}.fx`);
    }
  }
});

const flagsPlanted = new Set();
for (const c of CARDS) for (const side of ['left', 'right']) for (const f of (c[side].set || [])) flagsPlanted.add(f);

test('every realm has exactly one unconditional base boss; variants are gated on planted flags', () => {
  for (let n = 1; n <= REALMS.length; n++) {
    const bosses = CARDS.filter(c => c.tag === 'boss' && c.realm === n);
    assert.ok(bosses.length >= 1, `realm ${n} has a boss`);
    assert.strictEqual(bosses.filter(b => !b.requires).length, 1, `realm ${n}: exactly one unconditional base boss`);
    for (const v of bosses.filter(b => b.requires)) {
      assert.ok(Array.isArray(v.requires) && v.requires.length >= 1, `${v.id}: requires must name a flag`);
      for (const f of v.requires) assert.ok(flagsPlanted.has(f), `${v.id} requires '${f}' but no choice plants it`);
      assert.strictEqual(v.speaker, bosses.find(b => !b.requires).speaker, `${v.id}: a variant is the same boss on a different footing`);
    }
  }
});

test('exactly one waystation per realm; bosses and waystations sit outside the random pool', () => {
  for (let n = 1; n <= REALMS.length; n++) {
    assert.strictEqual(CARDS.filter(c => c.tag === 'rest' && c.realm === n).length, 1, `realm ${n} waystations`);
  }
  for (const c of CARDS.filter(c => c.tag === 'boss' || c.tag === 'rest')) {
    assert.ok(Number.isInteger(c.realm), `${c.id} needs realm:<n>`);
    assert.ok(!c.realmMin && !c.realmMax, `${c.id} is gated by realm:, not realmMin/Max`);
  }
});

test('every base boss carries text-only stance lines; every waystation plants one stance and clears the other', () => {
  for (const b of CARDS.filter(c => c.tag === 'boss' && !c.requires)) {
    assert.ok(b.stance && typeof b.stance.rested === 'string' && b.stance.rested.length > 20, `${b.id}.stance.rested`);
    assert.ok(typeof b.stance.pressed === 'string' && b.stance.pressed.length > 20, `${b.id}.stance.pressed`);
  }
  for (const r of CARDS.filter(c => c.tag === 'rest')) {
    const stanceOf = side => (r[side].set || []).find(f => f === 'rested' || f === 'pressed');
    const l = stanceOf('left'), rr = stanceOf('right');
    assert.ok(l && rr && l !== rr, `${r.id}: one side rested, the other pressed`);
    for (const side of ['left', 'right']) {
      const other = stanceOf(side) === 'rested' ? 'pressed' : 'rested';
      assert.ok((r[side].clear || []).includes(other), `${r.id}.${side} must clear '${other}'`);
    }
    if (r.realm !== 7) {
      const breath = ['left', 'right'].find(side => (r[side].fx.prana || 0) > 0);
      assert.strictEqual(stanceOf(breath), 'rested', `${r.id}: the breath side is the rested stance`);
    }
  }
});

test('every requires/forbids flag anywhere in the deck is planted by some choice', () => {
  for (const c of CARDS) {
    for (const f of (c.requires || [])) assert.ok(flagsPlanted.has(f), `${c.id} requires '${f}' — nothing sets it`);
    for (const f of (c.forbids || []))  assert.ok(flagsPlanted.has(f), `${c.id} forbids '${f}' — nothing sets it`);
  }
});

test('waystations 1–6 offer prāṇa on exactly one side at a virtue cost; Satyaloka offers none', () => {
  for (const c of CARDS.filter(c => c.tag === 'rest')) {
    const sides = [c.left.fx, c.right.fx];
    const givesPrana = sides.filter(fx => (fx.prana || 0) > 0);
    if (c.realm === 7) {
      assert.strictEqual(givesPrana.length, 0, `${c.id}: Satyaloka's waystation must be dry (its realm rule zeroes prāṇa gains)`);
      continue;
    }
    assert.strictEqual(givesPrana.length, 1, `${c.id}: one side gives prāṇa`);
    const cost = STATS.filter(s => s !== 'prana' && (givesPrana[0][s] || 0) < 0);
    assert.ok(cost.length >= 1, `${c.id}: the prāṇa side must cost another virtue`);
  }
});

test('every ripens.card points at a tag:karma card, and every karma card is reachable', () => {
  const referenced = new Set();
  for (const c of CARDS) for (const side of ['left', 'right']) {
    const r = c[side].ripens;
    if (!r) continue;
    const target = byId[r.card];
    assert.ok(target, `${c.id}.${side} ripens unknown card ${r.card}`);
    assert.strictEqual(target.tag, 'karma', `${r.card} must be tag:karma`);
    assert.ok(r.in == null || r.in >= 1, `${c.id}.${side}.ripens.in must be ≥ 1`);
    referenced.add(r.card);
  }
  for (const k of CARDS.filter(c => c.tag === 'karma')) {
    assert.ok(referenced.has(k.id), `orphan karma card ${k.id} — nothing ripens it`);
    assert.ok(!k.realmMin && !k.realmMax, `${k.id}: karma cards are gated by the schedule, not realmMin/Max`);
  }
});

test('karma payoffs carry authored outcome text on both sides (the beat depends on it)', () => {
  for (const k of CARDS.filter(c => c.tag === 'karma')) {
    for (const side of ['left', 'right']) {
      assert.ok(typeof k[side].outcome === 'string' && k[side].outcome.length > 20, `${k.id}.${side}.outcome`);
    }
  }
});

test('boss, waystation and karma fx are plain objects (Sage\'s Eye can preview them)', () => {
  for (const c of CARDS.filter(c => ['boss', 'rest', 'karma'].includes(c.tag))) {
    assert.ok(isPlainFx(c.left.fx) && isPlainFx(c.right.fx), `${c.id}: function fx has no preview`);
  }
});

test('the random pool covers every realm with at least eight cards', () => {
  for (let n = 1; n <= REALMS.length; n++) {
    const pool = CARDS.filter(c => !c.tag || c.tag === 'god').filter(c => !(c.realmMin && n < c.realmMin) && !(c.realmMax && n > c.realmMax));
    assert.ok(pool.length >= 8, `realm ${n} random pool is ${pool.length} — recentIds (7) would empty it`);
  }
});

test('every ending has a title, Devanagari, narration and an inline SVG', () => {
  for (const [k, e] of Object.entries(ENDINGS)) {
    assert.ok(e.title && e.deva && e.narration && e.svg && e.svg.startsWith('<svg'), k);
    assert.ok(['death', 'falsesummit', 'win'].includes(e.kind), k);
  }
});

test("the offer: one per stat, accept on one side naming that stat's false summit, authored outcome on the other", () => {
  for (const stat of ['karma', 'bhakti']) {
    const offers = CARDS.filter(c => c.tag === 'offer' && c.stat === stat);
    assert.strictEqual(offers.length, 1, `${stat} offers`);
    const o = offers[0];
    const acceptSides = ['left', 'right'].filter(s => o[s].accept);
    assert.strictEqual(acceptSides.length, 1, `${o.id}: exactly one accept side`);
    assert.strictEqual(o[acceptSides[0]].accept, 'false_' + stat, `${o.id}: accept names the ${stat} summit`);
    assert.ok(ENDINGS[o[acceptSides[0]].accept], `${o.id}: accept must name a real ending`);
    const refuse = acceptSides[0] === 'left' ? 'right' : 'left';
    assert.ok(typeof o[refuse].outcome === 'string' && o[refuse].outcome.length > 20, `${o.id}: refuse carries an authored outcome`);
    assert.ok(!o.realm && !o.realmMin && !o.realmMax, `${o.id}: served from the offer queue, not gated by realm`);
  }
});

test('false-summit endings carry a `lie` that opens their narration (the staged reveal depends on it)', () => {
  for (const k of ['false_karma', 'false_bhakti']) {
    const e = ENDINGS[k];
    assert.ok(typeof e.lie === 'string' && e.lie.length > 20, k);
    assert.ok(e.narration.startsWith(e.lie), `${k}: lie must be the narration's opening`);
    assert.ok(e.narration.length > e.lie.length + 20, `${k}: there must be a truth left to reveal`);
  }
});
