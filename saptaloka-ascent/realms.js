/*
 * Saptaloka Ascent — realm data (data only; no logic here).
 *
 * Exposes window.SAPTALOKA_ASCENT = { REALMS }. game.js reads it at boot.
 * Mirrors Saptaloka's cards.js → game.js handoff (data file loaded first).
 *
 * The climb is the seven lokas, bottom (Bhū) to top (Satya). Each realm is a
 * vertical band of `tiers` ledges with its own parallax palette and a rising
 * difficulty (`hazard` 0..1 scales moving/crumbling ledges + asura density).
 * Reaching the top tier of the LAST realm (Satyaloka) is the only true win
 * (mokṣa) — see checkEnd/ENDINGS in game.js for the asymmetric end conditions.
 *
 * Colours follow the Saptaloka dark-mythology palette (deep indigo + gold).
 * Each realm: sky = [top, mid, bottom] gradient; slab = ledge top/front faces;
 * accent = realm glow; mist = depth-haze tint; tide = the samsara flood colour.
 */
(function () {
  'use strict';

  const REALMS = [
    {
      key: 'bhu', name: 'Bhūloka', gloss: 'the earth', tiers: 12, hazard: 0.05,
      sky: ['#1a1330', '#241a3d', '#0f0a1e'],
      slabTop: '#5b4a2e', slabSide: '#2c2417', accent: '#8fd6a0',
      mist: 'rgba(120,150,110,0.10)', tide: '#3a2d1a', silhouette: 'forest',
    },
    {
      key: 'bhuvar', name: 'Bhuvarloka', gloss: 'the mid-air', tiers: 13, hazard: 0.18,
      sky: ['#16204a', '#1d2a55', '#0c1230'],
      slabTop: '#48618f', slabSide: '#22304d', accent: '#7fc2ff',
      mist: 'rgba(110,150,200,0.12)', tide: '#1a2640', silhouette: 'clouds',
    },
    {
      // Svarloka = Svarga, the heaven of merit — the KARMA false-summit realm.
      key: 'svar', name: 'Svarloka', gloss: 'the radiant heaven', tiers: 14, hazard: 0.30,
      sky: ['#3a2550', '#5a3168', '#1c1230'],
      slabTop: '#caa24a', slabSide: '#6e5320', accent: '#f5c97a',
      mist: 'rgba(245,201,122,0.10)', tide: '#3a2540', silhouette: 'palaces',
    },
    {
      key: 'mahar', name: 'Maharloka', gloss: 'the great sphere', tiers: 15, hazard: 0.42,
      sky: ['#102a33', '#163b44', '#08171c'],
      slabTop: '#3f8a86', slabSide: '#1d4543', accent: '#67e8d6',
      mist: 'rgba(90,200,190,0.12)', tide: '#0e2a2c', silhouette: 'spires',
    },
    {
      key: 'jana', name: 'Janaloka', gloss: 'the sphere of the wise', tiers: 16, hazard: 0.55,
      sky: ['#2a153f', '#3e1f56', '#140a22'],
      slabTop: '#8a5bc0', slabSide: '#432a63', accent: '#c79bff',
      mist: 'rgba(180,140,240,0.12)', tide: '#241038', silhouette: 'lotuses',
    },
    {
      key: 'tapa', name: 'Tapoloka', gloss: 'the sphere of austerity', tiers: 17, hazard: 0.7,
      sky: ['#3a1424', '#561d30', '#1c0a13'],
      slabTop: '#c0623f', slabSide: '#632a1d', accent: '#ff9d6b',
      mist: 'rgba(240,150,110,0.12)', tide: '#360f1a', silhouette: 'flames',
    },
    {
      // Satyaloka = the abode of truth. Top tier here → endRun('win_moksha').
      key: 'satya', name: 'Satyaloka', gloss: 'the abode of truth', tiers: 18, hazard: 0.85,
      sky: ['#2c2740', '#4a4470', '#15121f'],
      slabTop: '#e9e2f5', slabSide: '#8b84a8', accent: '#ffffff',
      mist: 'rgba(255,255,255,0.14)', tide: '#241f33', silhouette: 'radiance',
    },
  ];

  window.SAPTALOKA_ASCENT = { REALMS };
})();
