// Saptaloka — pure consequence-text logic (no DOM). Used by game.js; unit-tested by node --test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SaptalokaBeat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATS = ['prana', 'tejas', 'karma', 'bhakti'];
  // Tie-break for the dominant axis: the moral spine first, so a body-cost
  // prana drain never buries the meaningful karma/bhakti move.
  const DOMINANCE = ['karma', 'bhakti', 'tejas', 'prana'];

  const LEX = {
    prana:  { up: ['life floods back into your limbs', 'your breath steadies and deepens'],
              dn: ['the climb takes its toll on your body', 'your breath thins and your limbs grow heavy'] },
    tejas:  { up: ['an inner fire flares brighter', 'your radiance sharpens to an edge'],
              dn: ['the glow within you dims', 'your inner fire gutters low'] },
    karma:  { up: ['the ledger of your deeds tips toward the light', 'dharma settles more firmly on your side'],
              dn: ['a shadow falls across your deeds', 'the weight of the deed darkens your ledger'] },
    bhakti: { up: ['your heart bends closer to the divine', 'devotion swells warm in your chest'],
              dn: ['the thread of devotion frays', 'your heart turns cold to the gods'] },
  };

  // FNV-1a — deterministic, so a given card always reads the same line.
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pick(arr, seed) { return arr[seed % arr.length]; }
  function clause(stat, dir, seed) { return pick(LEX[stat][dir], seed); }

  function dominantAxis(d) {
    let best = null, bestAbs = 0;
    for (const s of DOMINANCE) { const a = Math.abs(d[s] || 0); if (a > bestAbs) { bestAbs = a; best = s; } }
    return best; // null if all zero
  }
  // Largest opposite-sign secondary with |delta| >= 3.
  function secondaryOpposite(d, dom) {
    const domSign = Math.sign(d[dom]);
    let best = null, bestAbs = 2;
    for (const s of STATS) {
      if (s === dom) continue;
      const v = d[s] || 0;
      if (v !== 0 && Math.sign(v) === -domSign && Math.abs(v) > bestAbs) { bestAbs = Math.abs(v); best = s; }
    }
    return best;
  }
  function speakerLead(card, seed) {
    const sp = (card && card.speaker) ? card.speaker : '';
    if (!sp) return '';
    // Lowercase a leading article so the speaker reads naturally mid-sentence
    // ("with a village widow…"); proper nouns ("Indra", "Garuḍa") have no article.
    const mid = sp.replace(/^(A|An|The)\b/, (m) => m.toLowerCase());
    return pick([mid + ' watches as ', 'Before ' + mid + ', ', 'With ' + mid + ' looking on, '], seed);
  }

  function outcomeText(choice, deltas, card) {
    if (choice && typeof choice.outcome === 'string' && choice.outcome) return choice.outcome;
    const d = deltas || {};
    const dom = dominantAxis(d);
    if (!dom) return 'You let the moment pass — nothing in you shifts.';

    const seed = (hashStr((card && card.id) || 'x') ^ hashStr((choice && choice.label) || 'y')) >>> 0;
    const main = clause(dom, d[dom] > 0 ? 'up' : 'dn', seed);
    const sec = secondaryOpposite(d, dom);
    const counter = sec ? (', but ' + clause(sec, d[sec] > 0 ? 'up' : 'dn', seed >>> 3)) : '';
    const lead = speakerLead(card, seed);
    const mag = Math.abs(d[dom]);
    let prefix = '';
    if (mag >= 12) prefix = 'Sharply — ';
    else if (mag <= 2) prefix = 'Faintly, ';

    let body = prefix + lead + main + counter + '.';
    // Capitalize only the first character; the rest (incl. mid-sentence speakers) keeps its case.
    // A prefix ("Sharply — "/"Faintly, ") already starts capital, so this is a no-op there.
    return body.charAt(0).toUpperCase() + body.slice(1);
  }

  return { outcomeText };
});
