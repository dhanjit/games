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
    { // Bhuvarloka — the atmospheres. Shipped at ×1.25 in #31 because the steeper
      // version stacked onto a prāṇa clock nobody could refill. Back to ×1.5 with
      // #33: the realm now has a waystation (the yaksha's cave), so the storm is a
      // cost you can answer — the sim reads the same win rate at ×1.25 and ×1.5.
      text: 'Here the storm-air steals breath: every loss of prāṇa cuts half again as deep.',
      delta: (stat, d) => (stat === 'prana' && d < 0) ? Math.round(d * 1.5) : d,
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
    { // Satyaloka — truth. Restored with #33: now that every realm below has a
      // waystation, "no breath returns" is a test of what you banked, not a tax.
      text: 'At the last threshold no breath returns — what prāṇa you carry is all you have.',
      delta: (stat, d) => (stat === 'prana' && d > 0) ? 0 : d,
    },
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
