// Saptaloka — hybrid audio (WebAudio synth now; recorded samples layered in Task 2.3).
// window.SaptalokaAudio. Never throws into the game loop: all play() paths are guarded.
(function () {
  'use strict';

  const KEY = 'saptaloka.meta.v1';
  function readPref() {
    try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); return Object.assign({ enabled: true, volume: 0.6 }, m.audio || {}); }
    catch (e) { return { enabled: true, volume: 0.6 }; }
  }
  function writePref(p) {
    try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); m.audio = p; localStorage.setItem(KEY, JSON.stringify(m)); }
    catch (e) {}
  }

  let pref = readPref();
  let ctx = null, master = null;

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = pref.enabled ? pref.volume : 0;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function resumeIfNeeded() { if (ctx && ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} } }

  // ---- synth primitives ----
  function tone(freq, dur, type, peak, when) {
    const t0 = (when || ctx.currentTime);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noiseBurst(dur, filterFreq, peak) {
    const t0 = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain(); g.gain.value = peak || 0.2;
    src.connect(f); f.connect(g); g.connect(master); src.start(t0);
  }
  function chord(freqs, dur, type, peak) { freqs.forEach((f) => tone(f, dur, type, peak)); }

  // ---- cue table (synth implementations; Task 2.3 may override with samples) ----
  const STAT_PITCH = { prana: 196, tejas: 330, karma: 262, bhakti: 392 };
  const CUES = {
    drag()        { tone(180, 0.10, 'sine', 0.06); },
    commit()      { tone(140, 0.08, 'triangle', 0.18); noiseBurst(0.05, 900, 0.08); },
    statGain(o)   { tone(STAT_PITCH[o && o.stat] || 262, 0.18, 'sine', 0.16); },
    statLoss(o)   { const f = STAT_PITCH[o && o.stat] || 262; tone(f, 0.20, 'sine', 0.16); tone(f * 0.84, 0.22, 'sine', 0.10); },
    bigHit()      { chord([523, 659, 784], 0.6, 'sine', 0.12); },
    danger()      { tone(110, 0.5, 'sawtooth', 0.08); tone(116, 0.5, 'sawtooth', 0.06); },
    beat()        { tone(330, 0.4, 'sine', 0.05); },
    tutorialStep(){ tone(523, 0.18, 'sine', 0.14); },
    tutorialStat(o){ tone(STAT_PITCH[o && o.stat] || 262, 0.35, 'sine', 0.18); },
    ascend(o)     { const base = 262 + 16 * ((o && o.realm) || 0); chord([base, base * 1.5], 0.9, 'sine', 0.12); noiseBurst(0.5, 2200, 0.06); },
    boss()        { chord([110, 117, 156], 0.7, 'sawtooth', 0.10); },
    death()       { tone(196, 1.2, 'sine', 0.16); tone(146, 1.4, 'sine', 0.12); },
    win()         { chord([262, 330, 392, 523], 2.2, 'sine', 0.14); },
    button()      { tone(440, 0.06, 'triangle', 0.10); },
    upgrade()     { tone(523, 0.10, 'triangle', 0.14); tone(784, 0.14, 'triangle', 0.10); },
  };

  function play(name, opts) {
    if (!pref.enabled) return;
    if (!ensureCtx()) return;
    resumeIfNeeded();
    const fn = CUES[name];
    if (!fn) return;
    try { fn(opts || {}); } catch (e) {}
  }

  // ---- unlock on first gesture (autoplay policy) ----
  function unlock() { if (ensureCtx()) resumeIfNeeded(); }
  const onceUnlock = () => { unlock(); window.removeEventListener('pointerdown', onceUnlock, true);
    window.removeEventListener('touchend', onceUnlock, true); window.removeEventListener('keydown', onceUnlock, true); };
  window.addEventListener('pointerdown', onceUnlock, true);
  window.addEventListener('touchend', onceUnlock, true);
  window.addEventListener('keydown', onceUnlock, true);

  window.SaptalokaAudio = {
    unlock,
    play,
    isEnabled() { return !!pref.enabled; },
    setEnabled(v) { pref.enabled = !!v; writePref(pref); if (master) master.gain.value = pref.enabled ? pref.volume : 0; },
    toggle() { this.setEnabled(!pref.enabled); return pref.enabled; },
    setVolume(v) { pref.volume = Math.max(0, Math.min(1, v)); writePref(pref); if (master && pref.enabled) master.gain.value = pref.volume; },
  };
})();
