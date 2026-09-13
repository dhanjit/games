/* Maaran Pithu — procedural sound. No assets: a few oscillator/noise bursts.
 * Unlocks on the first user gesture (browsers require it). Mute preference in
 * localStorage under maaranpithu.audio. */
const PREF_KEY = 'maaranpithu.audio';
let ctx = null, master = null;
let enabled = true;
try { const p = JSON.parse(localStorage.getItem(PREF_KEY)); if (p && typeof p.enabled === 'boolean') enabled = p.enabled; } catch { /* default on */ }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = enabled ? 0.5 : 0; master.connect(ctx.destination);
  return ctx;
}
function tone(freq, dur, { type = 'sine', peak = 0.3, slide = 0, delay = 0 } = {}) {
  if (!ensure()) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, { peak = 0.25, hp = 800, delay = 0 } = {}) {
  if (!ensure()) return;
  const t0 = ctx.currentTime + delay;
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = peak;
  s.connect(f); f.connect(g); g.connect(master); s.start(t0);
}

export const sfx = {
  unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
  throw() { noise(0.12, { peak: 0.18, hp: 1500 }); },
  hit() { tone(180, 0.12, { type: 'square', peak: 0.25, slide: -120 }); noise(0.08, { peak: 0.3, hp: 400 }); },
  catch() { tone(520, 0.08, { type: 'triangle', peak: 0.3 }); tone(780, 0.12, { type: 'triangle', peak: 0.3, delay: 0.07 }); },
  slide() { noise(0.25, { peak: 0.12, hp: 300 }); },
  // grass bounce: a soft thud that gets quieter as the hops die away
  bounce(v = 1) { tone(150, 0.07, { type: 'sine', peak: 0.1 * v, slide: -60 }); noise(0.05, { peak: 0.08 * v, hp: 600 }); },
  whistle() { tone(2400, 0.18, { type: 'square', peak: 0.12, slide: 300 }); tone(2400, 0.22, { type: 'square', peak: 0.12, slide: -200, delay: 0.2 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', peak: 0.25, delay: i * 0.12 })); },
  out() { tone(300, 0.25, { type: 'sawtooth', peak: 0.15, slide: -150 }); },
  get enabled() { return enabled; },
  setEnabled(v) { enabled = !!v; if (master) master.gain.value = enabled ? 0.5 : 0; try { localStorage.setItem(PREF_KEY, JSON.stringify({ enabled })); } catch { /* ignore */ } },
};
