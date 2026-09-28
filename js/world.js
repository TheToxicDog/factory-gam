// Cogworks Frontier — procedural world: terrain, resources, obstacles.
(function () {
  'use strict';

  // Terrain types
  const T = { GRASS: 0, DRYGRASS: 1, SAND: 2, DIRT: 3, WATER: 4, DEEP: 5 };
  // Resource types stored per tile
  const RES = { NONE: 0, IRON: 1, COPPER: 2, COAL: 3, STONE: 4, OIL: 5, TREE: 6, ROCK: 7 };
  const RES_ITEM = [null, 'iron_ore', 'copper_ore', 'coal', 'stone', null, 'wood', 'stone'];
  const RES_NAME = [null, 'Iron ore', 'Copper ore', 'Coal', 'Stone', 'Crude oil well', 'Tree', 'Boulder'];
  FG.T = T;
  FG.RES = RES;
  FG.RES_ITEM = RES_ITEM;
  FG.RES_NAME = RES_NAME;

  class World {
    constructor(seed, size, opts) {
      opts = opts || {};
      this.seed = seed >>> 0;
      this.W = size;
      this.H = size;
      const n = size * size;
      this.terrain = new Uint8Array(n);
      this.res = new Uint8Array(n);
      this.amt = new Int32Array(n);
      this.ent = new Int32Array(n); // entity id occupying a tile
      this.variant = new Uint8Array(n);
      this.CW = Math.ceil(size / FG.CHUNK);
      this.CH = Math.ceil(size / FG.CHUNK);
      this.charted = new Uint8Array(this.CW * this.CH);
      this.pollution = new Float32Array(this.CW * this.CH);
      this.chunkVersion = new Uint32Array(this.CW * this.CH); // bumps when chunk visuals change
      this.richness = opts.richness || 1;
      this.spawnX = size >> 1;
      this.spawnY = size >> 1;
      this.nestSpots = [];
      this.generate(opts);
      this.modified = new Set(); // tiles whose resource changed since generation (for saves)
    }

    idx(x, y) { return y * this.W + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
    isWater(x, y) {
      if (!this.inBounds(x, y)) return true;
      const t = this.terrain[y * this.W + x];
      return t === T.WATER || t === T.DEEP;
    }
    // Trees and boulders block building and walking.
    hasObstacle(x, y) {
      const i = y * this.W + x;
      const r = this.res[i];
      return (r === RES.TREE || r === RES.ROCK) && this.amt[i] > 0;
    }
    mark(x, y) { this.modified.add(y * this.W + x); }
    touchChunk(x, y) {
      const c = ((y / FG.CHUNK) | 0) * this.CW + ((x / FG.CHUNK) | 0);
      this.chunkVersion[c]++;
    }
    chunkIndexAt(x, y) {
      return FG.clamp((y / FG.CHUNK) | 0, 0, this.CH - 1) * this.CW + FG.clamp((x / FG.CHUNK) | 0, 0, this.CW - 1);
    }
    chart(cx, cy, r) {
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++)
          if (x >= 0 && y >= 0 && x < this.CW && y < this.CH) this.charted[y * this.CW + x] = 1;
    }

    generate(opts) {
      const W = this.W, H = this.H, seed = this.seed;
      const rnd = FG.rng(seed ^ 0x9e3779b9);
      const elev = FG.makeNoise(seed + 11);
      const moist = FG.makeNoise(seed + 23);
      const forest = FG.makeNoise(seed + 37);
      const detail = FG.makeNoise(seed + 41);
      const sx = this.spawnX, sy = this.spawnY;

      // Low-frequency fields are sampled on a coarse grid and interpolated (much faster).
      const E = this.field(4, (x, y) => elev(x / 70, y / 70, 5, 0.5));
      const M = this.field(4, (x, y) => moist(x / 110 + 40, y / 110 - 20, 4, 0.5));
      const F = this.field(3, (x, y) => forest(x / 45 + 300, y / 45 + 300, 4, 0.55) + detail(x / 8, y / 8, 2) * 0.12);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          let e = E[i];
          const d = Math.sqrt(FG.dist2(x, y, sx, sy));
          // Keep the landing site dry.
          if (d < 14) e = Math.max(e, 0.5 + (14 - d) * 0.01);
          // Map border becomes ocean.
          const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
          if (edge < 10) e -= (10 - edge) * 0.03;
          const m = M[i];
          let t;
          if (e < 0.3) t = T.DEEP;
          else if (e < 0.34) t = T.WATER;
          else if (e < 0.355) t = T.SAND;
          else if (m < 0.3) t = T.SAND;
          else if (m < 0.37) t = T.DIRT;
          else if (m < 0.45) t = T.DRYGRASS;
          else t = T.GRASS;
          this.terrain[i] = t;
          this.variant[i] = (FG.hash2(x, y, seed) * 256) | 0;

          if (t !== T.WATER && t !== T.DEEP && d > 5) {
            const f = F[i];
            const dens = t === T.GRASS ? 1 : t === T.DRYGRASS ? 0.6 : t === T.DIRT ? 0.25 : 0.05;
            const r = FG.hash2(x, y, seed + 5);
            if ((f > 0.6 && r < 0.55 * dens) || r < 0.012 * dens) {
              this.res[i] = RES.TREE;
              this.amt[i] = 4;
            } else if (FG.hash2(x, y, seed + 9) < 0.0016) {
              this.res[i] = RES.ROCK;
              this.amt[i] = 24;
            }
          }
        }
      }

      this.ensureStartingWater(rnd);

      // Starting resource patches arranged around the spawn point.
      const base = rnd() * Math.PI * 2;
      const start = [
        [RES.IRON, 24, 9, 1600],
        [RES.COPPER, 26, 8, 1400],
        [RES.COAL, 22, 7, 1200],
        [RES.STONE, 27, 6, 1000],
      ];
      start.forEach((p, k) => {
        const a = base + k * (Math.PI / 2) + (rnd() - 0.5) * 0.6;
        const cx = Math.round(sx + Math.cos(a) * p[1]);
        const cy = Math.round(sy + Math.sin(a) * p[1]);
        this.placePatch(p[0], cx, cy, p[2], p[3] * this.richness, rnd);
      });
      // Starting oil field a little further out.
      {
        const a = base + Math.PI / 4 + rnd() * 0.5;
        const d = 62 + rnd() * 14;
        this.placeOil(Math.round(sx + Math.cos(a) * d), Math.round(sy + Math.sin(a) * d), 7, rnd);
      }

      // Scatter patches over the rest of the map, larger and richer with distance.
      const count = Math.round((W * H) / 2600);
      const types = [RES.IRON, RES.IRON, RES.IRON, RES.COPPER, RES.COPPER, RES.COAL, RES.COAL, RES.STONE, RES.OIL, RES.OIL];
      for (let k = 0; k < count; k++) {
        const x = 16 + Math.floor(rnd() * (W - 32));
        const y = 16 + Math.floor(rnd() * (H - 32));
        const d = Math.sqrt(FG.dist2(x, y, sx, sy));
        if (d < 55) continue;
        const type = types[Math.floor(rnd() * types.length)];
        const scale = 1 + d / 180;
        if (type === RES.OIL) this.placeOil(x, y, 4 + Math.floor(rnd() * 6), rnd);
        else this.placePatch(type, x, y, Math.round((5 + rnd() * 7) * Math.min(scale, 1.8)), 900 * scale * this.richness, rnd);
      }

      // Enemy nest clusters beyond the safe radius.
      const clusters = Math.round((W * H) / 5200);
      for (let k = 0; k < clusters * 3 && this.nestSpots.length < clusters * 4; k++) {
        const x = 12 + Math.floor(rnd() * (W - 24));
        const y = 12 + Math.floor(rnd() * (H - 24));
        const d = Math.sqrt(FG.dist2(x, y, sx, sy));
        if (d < 115) continue;
        if (rnd() > Math.min(1, (d - 100) / 120)) continue;
        const n = 2 + Math.floor(rnd() * (2 + d / 90));
        for (let j = 0; j < n; j++) {
          const nx = Math.round(x + (rnd() - 0.5) * 12);
          const ny = Math.round(y + (rnd() - 0.5) * 12);
          if (!this.inBounds(nx, ny) || this.isWater(nx, ny) || this.isWater(nx + 1, ny + 1)) continue;
          this.nestSpots.push([nx, ny]);
        }
      }

      this.chart((sx / FG.CHUNK) | 0, (sy / FG.CHUNK) | 0, 3);
    }

    // Evaluate fn on a grid with the given step and bilinearly interpolate to every tile.
    field(step, fn) {
      const W = this.W, H = this.H;
      const gw = Math.ceil(W / step) + 2, gh = Math.ceil(H / step) + 2;
      const g = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) g[gy * gw + gx] = fn(gx * step, gy * step);
      const out = new Float32Array(W * H);
      for (let y = 0; y < H; y++) {
        const gy = (y / step) | 0, fy = (y - gy * step) / step;
        for (let x = 0; x < W; x++) {
          const gx = (x / step) | 0, fx = (x - gx * step) / step;
          const a = g[gy * gw + gx], b = g[gy * gw + gx + 1], c = g[(gy + 1) * gw + gx], d = g[(gy + 1) * gw + gx + 1];
          out[y * W + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
        }
      }
      return out;
    }

    ensureStartingWater(rnd) {
      const sx = this.spawnX, sy = this.spawnY;
      for (let y = sy - 34; y <= sy + 34; y++)
        for (let x = sx - 34; x <= sx + 34; x++)
          if (this.inBounds(x, y) && this.isWater(x, y) && FG.dist2(x, y, sx, sy) < 34 * 34) return;
      const a = rnd() * Math.PI * 2;
      const cx = Math.round(sx + Math.cos(a) * 24), cy = Math.round(sy + Math.sin(a) * 24);
      const noise = FG.makeNoise(this.seed + 77);
      for (let y = cy - 9; y <= cy + 9; y++)
        for (let x = cx - 9; x <= cx + 9; x++) {
          if (!this.inBounds(x, y)) continue;
          const d = Math.sqrt(FG.dist2(x, y, cx, cy)) + (noise(x / 4, y / 4, 2) - 0.5) * 4;
          const i = y * this.W + x;
          if (d < 5) { this.terrain[i] = T.DEEP; this.res[i] = 0; this.amt[i] = 0; }
          else if (d < 7) { this.terrain[i] = T.WATER; this.res[i] = 0; this.amt[i] = 0; }
          else if (d < 8 && this.terrain[i] !== T.WATER && this.terrain[i] !== T.DEEP) this.terrain[i] = T.SAND;
        }
    }

    placePatch(type, cx, cy, radius, richness, rnd) {
      const noise = FG.makeNoise((this.seed + type * 131 + cx * 7 + cy * 13) | 0);
      const r2 = (radius + 3) * (radius + 3);
      for (let y = cy - radius - 3; y <= cy + radius + 3; y++) {
        for (let x = cx - radius - 3; x <= cx + radius + 3; x++) {
          if (!this.inBounds(x, y) || FG.dist2(x, y, cx, cy) > r2) continue;
          const i = y * this.W + x;
          if (this.terrain[i] === T.WATER || this.terrain[i] === T.DEEP) continue;
          const d = Math.sqrt(FG.dist2(x, y, cx, cy)) / radius;
          const edge = d + (noise(x / 5, y / 5, 3) - 0.5) * 0.7;
          if (edge > 1) continue;
          const cur = this.res[i];
          if (cur >= RES.IRON && cur <= RES.OIL) continue; // don't overwrite other ores
          this.res[i] = type;
          this.amt[i] = Math.max(20, Math.round(richness * (1.4 - edge) * (0.7 + rnd() * 0.6)));
        }
      }
    }

    placeOil(cx, cy, n, rnd) {
      for (let k = 0; k < n; k++) {
        const x = Math.round(cx + (rnd() - 0.5) * 16);
        const y = Math.round(cy + (rnd() - 0.5) * 16);
        if (!this.inBounds(x, y) || this.isWater(x, y)) continue;
        // Keep wells apart so pumpjacks (3x3) fit.
        let ok = true;
        for (let yy = y - 2; yy <= y + 2 && ok; yy++)
          for (let xx = x - 2; xx <= x + 2; xx++)
            if (this.inBounds(xx, yy) && this.res[yy * this.W + xx] === RES.OIL) { ok = false; break; }
        if (!ok) continue;
        for (let yy = y - 1; yy <= y + 1; yy++)
          for (let xx = x - 1; xx <= x + 1; xx++)
            if (this.inBounds(xx, yy) && this.hasObstacle(xx, yy)) { this.res[yy * this.W + xx] = 0; this.amt[yy * this.W + xx] = 0; }
        const i = y * this.W + x;
        this.res[i] = RES.OIL;
        this.amt[i] = Math.round((60 + rnd() * 140) * this.richness); // yield percent
      }
    }
  }

  FG.World = World;
})();
