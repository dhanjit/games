// Saptaloka — pure consequence-text logic (no DOM). Used by game.js; unit-tested by node --test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SaptalokaBeat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function outcomeText(/* choice, deltas, card */) { return ''; }
  return { outcomeText };
});
