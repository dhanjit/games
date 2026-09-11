// Saptaloka — realm rules: one mechanical twist per loka (no DOM).
// Used by game.js (applyFx and the Sage's Eye preview, which must stay in sync) and
// by balance sims, which load this exact file so the numbers they report are the
// game's own. Unit-tested by node --test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SaptalokaRules = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Indexed by 0-based realm (state.realmIdx / REALMS order). A null entry means
  // the realm plays plain. Each rule is:
  //   text    — the one line the entry cutscene states it in
  //   delta   — (stat, d, card) → d′; bends a single card delta BEFORE the Mirror
  //             upgrades (Stamina, Equanimity) and the prāṇa cap are applied
  //   ambient — { stat: n } landed on every card of the realm, whichever way it went
  const RULES = [
    null, // Bhūloka — the tutorial realm stays plain
    { // Bhuvarloka — the atmospheres. ×1.25, not ×1.5: the sim showed the steeper
      // version stacked onto prāṇa (already ~57% of careful deaths) and halved the
      // no-upgrade win rate without adding anything to learn. Revisit with #33.
      text: 'Here the storm-air steals breath: every loss of prāṇa cuts a quarter deeper.',
      delta: (stat, d) => (stat === 'prana' && d < 0) ? Math.round(d * 1.25) : d,
    },
    { // Svarloka — Indra's heaven
      text: "In Indra's heaven the gods give freely — their gifts of tejas land twice as hard.",
      delta: (stat, d, card) => (stat === 'tejas' && d > 0 && card && card.tag === 'god') ? d * 2 : d,
    },
    null, // Maharloka — neutral in this pass
    null, // Janaloka — neutral in this pass
    { // Tapoloka — austerity
      text: 'Austerity burns: your tejas climbs with every step, whether you will it or not.',
      ambient: { tejas: 3 },
    },
    // Satyaloka — truth. Its rule ("no breath returns — what prāṇa you carry is all
    // you have") is held until prāṇa can be earned (#33): with no source in the deck
    // it only tightens a countdown the player can't influence. Re-introduce there.
    null,
  ];

  function rule(realmIdx) {
    if (!Number.isInteger(realmIdx) || realmIdx < 0 || realmIdx >= RULES.length) return null;
    return RULES[realmIdx] || null;
  }
  function delta(realmIdx, stat, d, card) {
    const r = rule(realmIdx);
    return (r && r.delta) ? r.delta(stat, d, card) : d;
  }
  function ambient(realmIdx) {
    const r = rule(realmIdx);
    return (r && r.ambient) ? Object.assign({}, r.ambient) : null;
  }

  return { rule, delta, ambient };
});
