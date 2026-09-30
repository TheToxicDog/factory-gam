// Cogworks Frontier — core helpers shared by every module.
// Scripts are classic (non-module) so the game runs from file:// and any static host.
var FG = (globalThis.FG = globalThis.FG || {});

(function () {
  'use strict';

  FG.VERSION = 1;
  FG.TICKS = 60; // simulation ticks per second
  FG.CHUNK = 32; // tiles per chunk side

  // Directions: 0 = north (up), 1 = east, 2 = south, 3 = west.
  FG.DX = [0, 1, 0, -1];
  FG.DY = [-1, 0, 1, 0];
  FG.DIR_NAMES = ['north', 'east', 'south', 'west'];
  FG.opposite = (d) => (d + 2) & 3;
  FG.leftOf = (d) => (d + 3) & 3;
  FG.rightOf = (d) => (d + 1) & 3;

  // Rotate a local point inside a w x h footprint (north orientation) by `dir`
  // quarter turns clockwise. Points may lie outside the footprint (e.g. output tiles).
  FG.rotLocal = function (lx, ly, w, h, dir) {
    let x = lx, y = ly, cw = w, ch = h;
    for (let i = 0; i < dir; i++) {
      const nx = ch - 1 - y;
      const ny = x;
      x = nx; y = ny;
      const t = cw; cw = ch; ch = t;
    }
    return [x, y];
  };

  // Footprint size for a prototype in a given direction.
  FG.footprint = function (proto, dir) {
    if (dir & 1) return [proto.h, proto.w];
    return [proto.w, proto.h];
  };

  // Seeded PRNG (mulberry32).
  FG.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Seeded PRNG whose state can be saved: every random choice the simulation makes comes from
  // the game's own generator, so every player's copy of a multiplayer world rolls the same.
  FG.Rand = class {
    constructor(seed) { this.s = seed >>> 0; }
    next() {
      const t0 = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      let t = Math.imul(t0 ^ (t0 >>> 15), t0 | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };

  FG.hash2 = function (x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 144269504) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };

  // Smooth value noise with fractal octaves.
  FG.makeNoise = function (seed) {
    function smooth(t) { return t * t * (3 - 2 * t); }
    function value(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const a = FG.hash2(xi, yi, seed), b = FG.hash2(xi + 1, yi, seed);
      const c = FG.hash2(xi, yi + 1, seed), d = FG.hash2(xi + 1, yi + 1, seed);
      const u = smooth(xf), v = smooth(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return function (x, y, octaves, persistence) {
      octaves = octaves || 4;
      persistence = persistence || 0.5;
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += value(x * freq, y * freq) * amp;
        norm += amp;
        amp *= persistence;
        freq *= 2;
      }
      return sum / norm;
    };
  };

  FG.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  FG.lerp = (a, b, t) => a + (b - a) * t;
  FG.dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  // Compact number formatting for the UI.
  FG.fmt = function (n) {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1) + 'G';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    if (a >= 100 || Number.isInteger(n)) return String(Math.round(n));
    if (a >= 10) return n.toFixed(1);
    return n.toFixed(2);
  };

  FG.fmtPower = function (kw) {
    if (kw >= 1e6) return (kw / 1e6).toFixed(2) + ' GW';
    if (kw >= 1e3) return (kw / 1e3).toFixed(kw >= 1e4 ? 1 : 2) + ' MW';
    return kw.toFixed(kw >= 100 ? 0 : 1) + ' kW';
  };

  FG.fmtTime = function (ticks) {
    const s = Math.floor(ticks / 60);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (x) => (x < 10 ? '0' : '') + x;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
  };

  // Binary heap used by A* path finding.
  FG.Heap = class {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p];
        i = p;
      }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v;
      const top = v[0];
      const lk = k.pop(), lv = v.pop();
      const n = k.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c];
          i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
  };

  // Tiny event bus so UI can listen to simulation happenings.
  const listeners = {};
  FG.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  FG.emit = function (ev, a, b, c) {
    const l = listeners[ev];
    if (l) for (let i = 0; i < l.length; i++) l[i](a, b, c);
  };
})();
