// Cogworks Frontier — synthesized sound effects (Web Audio, no sound files).
(function () {
  'use strict';
  const sfx = (FG.sfx = {});
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;
  try { enabled = localStorage.getItem('cogworks-sound') !== 'off'; } catch (e) { /* storage unavailable */ }
  const last = {};

  function init() {
    if (ctx || typeof AudioContext === 'undefined') return;
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }
  // Browsers only allow audio after a user gesture.
  if (typeof window !== 'undefined') {
    const unlock = () => { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  sfx.enabled = () => enabled;
  sfx.setEnabled = function (on) {
    enabled = on;
    try { localStorage.setItem('cogworks-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  };

  function tone(f0, f1, dur, type, vol, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, type, freq, delay, q) {
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.5 + Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq || 1000;
    f.Q.value = q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    place: (v) => { tone(160, 70, 0.1, 'square', 0.12 * v); noise(0.07, 0.2 * v, 'lowpass', 700); },
    pickup: (v) => { tone(260, 420, 0.08, 'triangle', 0.15 * v); },
    mine: (v) => { noise(0.07, 0.25 * v, 'bandpass', 900 + Math.random() * 600, 0, 2); tone(120, 80, 0.05, 'square', 0.05 * v); },
    chop: (v) => { noise(0.09, 0.3 * v, 'bandpass', 500, 0, 3); },
    craft: (v) => { tone(700, 700, 0.05, 'sine', 0.08 * v); tone(1050, 1050, 0.07, 'sine', 0.06 * v, 0.05); },
    click: (v) => { tone(1200, 900, 0.03, 'triangle', 0.06 * v); },
    research: (v) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, 'sine', 0.12 * v, i * 0.09)); },
    objective: (v) => { tone(440, 880, 0.25, 'triangle', 0.12 * v); tone(660, 1320, 0.3, 'sine', 0.06 * v, 0.1); },
    warn: (v) => { tone(220, 200, 0.07, 'square', 0.06 * v); },
    alert: (v) => { for (let k = 0; k < 3; k++) tone(k % 2 ? 660 : 880, k % 2 ? 660 : 880, 0.12, 'square', 0.07 * v, k * 0.16); },
    shot: (v) => { noise(0.05, 0.22 * v, 'highpass', 1400); tone(110, 60, 0.04, 'square', 0.05 * v); },
    laser: (v) => { tone(1400, 300, 0.14, 'sawtooth', 0.06 * v); },
    boom: (v) => { noise(0.5, 0.5 * v, 'lowpass', 380); tone(70, 35, 0.4, 'sine', 0.3 * v); },
    hit: (v) => { noise(0.05, 0.15 * v, 'lowpass', 1200); },
    launch: (v) => { noise(4.5, 0.4 * v, 'lowpass', 220); tone(60, 240, 4.5, 'sawtooth', 0.08 * v); },
  };
  const MIN_GAP = { shot: 45, laser: 60, mine: 90, hit: 60, place: 40, craft: 80, warn: 400, boom: 80 };

  // Play a sound; optional world position fades it with distance from the player.
  sfx.play = function (name, x, y) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    let v = 1;
    const app = FG.app;
    if (x !== undefined && app && app.game) {
      const p = app.game.player;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > 40) return;
      v = Math.max(0.08, 1 - d / 40);
    }
    const now = performance.now();
    if (now - (last[name] || 0) < (MIN_GAP[name] || 0)) return;
    last[name] = now;
    try { fn(v); } catch (e) { /* ignore audio errors */ }
  };
})();
