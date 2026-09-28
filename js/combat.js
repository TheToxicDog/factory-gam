// Cogworks Frontier — pollution spread, native hives, attack waves, turrets and weapons.
(function () {
  'use strict';
  const D = FG.data;
  const CELL = 4; // path-finding grid resolution in tiles

  function resist(type, dmg) {
    const u = D.enemies[type];
    return Math.max(1, (dmg - u.flat) * (1 - u.pct));
  }

  // Visit entities whose top-left lies within r tiles of (x, y), using the chunk index.
  FG.entsNear = function (g, x, y, r, fn) {
    const C = FG.CHUNK, w = g.world;
    const c0 = Math.max(0, Math.floor((x - r - 10) / C)), c1 = Math.min(w.CW - 1, Math.floor((x + r) / C));
    const r0 = Math.max(0, Math.floor((y - r - 10) / C)), r1 = Math.min(w.CH - 1, Math.floor((y + r) / C));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const set = g.chunkEnts[cy * w.CW + cx];
      if (!set) continue;
      for (const id of set) { const e = g.ents.get(id); if (e) fn(e); }
    }
  };

  FG.damageEntity = function (g, e, dmg) {
    if (!e || e.dead) return;
    e.hp -= dmg;
    e.lastHit = g.tick;
    if (g.tick - (g.lastAttackAlert || -9999) > 600) {
      g.lastAttackAlert = g.tick;
      FG.emit('alert', { text: D.items[D.protos[e.p].item].name + ' is under attack', x: e.x, y: e.y, kind: 'attack' });
    }
    if (e.hp <= 0) {
      g.effects.push({ type: 'boom', x: e.x + e.w / 2, y: e.y + e.h / 2, r: Math.max(e.w, e.h), t: 0, life: 30 });
      FG.removeEntity(g, e);
      g.lostBuildings = (g.lostBuildings || 0) + 1;
    }
  };

  class Enemies {
    constructor(g) {
      this.g = g;
      this.nests = [];
      this.units = [];
      this.shots = []; // grenades in flight
      this.evo = 0;
      this.nextId = 1;
      this.nestTiles = new Map();
      this.lastPoll = 0;
      this.expandAt = 20 * 60 * 60;
      this.mode = g.opts.enemies;
      if (this.mode !== 'off') for (const [x, y] of g.world.nestSpots) this.addNest(x, y);
      this.buildAbsorb();
      this.buildPathGrid();
    }

    addNest(x, y) {
      const w = this.g.world;
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
        if (!w.inBounds(xx, yy) || w.isWater(xx, yy) || this.nestTiles.has(yy * w.W + xx)) return null;
      }
      const n = { id: this.nextId++, x, y, hp: D.NEST_HP, budget: 0, pending: [], pendingSince: 0, cd: 0, anim: Math.random() * 100 };
      this.nests.push(n);
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
        const i = yy * w.W + xx;
        this.nestTiles.set(i, n);
        if (w.res[i] === FG.RES.TREE || w.res[i] === FG.RES.ROCK) { w.res[i] = 0; w.amt[i] = 0; }
      }
      return n;
    }
    removeNest(n) {
      const w = this.g.world;
      const k = this.nests.indexOf(n);
      if (k >= 0) this.nests.splice(k, 1);
      n.dead = true;
      for (let yy = n.y; yy < n.y + 2; yy++) for (let xx = n.x; xx < n.x + 2; xx++) this.nestTiles.delete(yy * w.W + xx);
    }
    nestBlocks(x, y, w, h) {
      if (!this.nestTiles.size) return false;
      const W = this.g.world.W;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.nestTiles.has(yy * W + xx)) return true;
      return false;
    }

    // Pollution absorbed per chunk per 64 ticks, from terrain and trees.
    buildAbsorb() {
      const w = this.g.world;
      this.absorb = new Float32Array(w.CW * w.CH);
      const rate = [1, 0.9, 0.5, 0.7, 0.3, 0.3];
      for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
        const i = y * w.W + x;
        let a = rate[w.terrain[i]];
        if (w.res[i] === FG.RES.TREE) a += 3;
        this.absorb[w.chunkIndexAt(x, y)] += a * 7e-6 * 64;
      }
    }

    buildPathGrid() {
      const w = this.g.world;
      this.PW = Math.ceil(w.W / CELL);
      this.PH = Math.ceil(w.H / CELL);
      this.block = new Uint8Array(this.PW * this.PH);
      for (let cy = 0; cy < this.PH; cy++) for (let cx = 0; cx < this.PW; cx++) {
        let water = 0;
        for (let y = cy * CELL; y < cy * CELL + CELL; y++) for (let x = cx * CELL; x < cx * CELL + CELL; x++) if (w.isWater(x, y)) water++;
        this.block[cy * this.PW + cx] = water > CELL * CELL * 0.4 ? 1 : 0;
      }
    }

    findPath(x0, y0, x1, y1) {
      const PW = this.PW, PH = this.PH;
      const sx = FG.clamp((x0 / CELL) | 0, 0, PW - 1), sy = FG.clamp((y0 / CELL) | 0, 0, PH - 1);
      const tx = FG.clamp((x1 / CELL) | 0, 0, PW - 1), ty = FG.clamp((y1 / CELL) | 0, 0, PH - 1);
      const N = PW * PH;
      const gs = new Float32Array(N).fill(Infinity);
      const from = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = new FG.Heap();
      const s = sy * PW + sx, t = ty * PW + tx;
      gs[s] = 0;
      heap.push(0, s);
      let found = false, iter = 0;
      while (heap.size && iter++ < 20000) {
        const c = heap.pop();
        if (closed[c]) continue;
        closed[c] = 1;
        if (c === t) { found = true; break; }
        const cx = c % PW, cy = (c / PW) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= PW || ny >= PH) continue;
          const n = ny * PW + nx;
          if (closed[n] || (this.block[n] && n !== t)) continue;
          if (dx && dy && (this.block[cy * PW + nx] || this.block[ny * PW + cx])) continue;
          const ng = gs[c] + (dx && dy ? 1.414 : 1);
          if (ng < gs[n]) {
            gs[n] = ng; from[n] = c;
            heap.push(ng + Math.hypot(nx - tx, ny - ty), n);
          }
        }
      }
      if (!found) return [[x1, y1]];
      const path = [];
      for (let c = t; c !== s && c >= 0; c = from[c]) path.push([(c % PW) * CELL + CELL / 2, ((c / PW) | 0) * CELL + CELL / 2]);
      path.reverse();
      // Thin the path: keep every other waypoint to reduce zig-zags.
      const thin = path.filter((_, i) => i % 2 === 1 || i === path.length - 1);
      thin[thin.length - 1] = [x1, y1];
      return thin;
    }

    // ------------------------------------------------------------ pollution
    spreadPollution() {
      const w = this.g.world;
      const P = w.pollution;
      const next = new Float32Array(P);
      const CW = w.CW, CH = w.CH;
      for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
        const c = cy * CW + cx;
        const a = P[c];
        if (a < 0.05) continue;
        const s = a * 0.02;
        if (cx > 0) { next[c - 1] += s; next[c] -= s; }
        if (cx < CW - 1) { next[c + 1] += s; next[c] -= s; }
        if (cy > 0) { next[c - CW] += s; next[c] -= s; }
        if (cy < CH - 1) { next[c + CW] += s; next[c] -= s; }
      }
      for (let c = 0; c < next.length; c++) next[c] = Math.max(0, next[c] - this.absorb[c]);
      w.pollution.set(next);
    }

    // ---------------------------------------------------------------- update
    update() {
      const g = this.g;
      if (g.tick % 64 === 0) {
        this.spreadPollution();
        const dp = g.stats.pollution - this.lastPoll;
        this.lastPoll = g.stats.pollution;
        if (this.mode !== 'off') this.evo += (1 - this.evo) * (4.3e-6 + 9e-7 * dp);
        if (this.mode === 'normal') this.absorbAndSpawn();
      }
      if (this.mode === 'normal' && g.tick >= this.expandAt) this.expand();
      this.updateUnits();
      this.updateTurrets();
      this.updatePlayerCombat();
      this.updateShots();
      for (const n of this.nests) if (n.cd > 0) n.cd--;
    }

    pickUnitType() {
      const e = this.evo;
      const w = [
        ['crawler', Math.max(0.05, 1 - e * 1.3)],
        ['brute', e < 0.2 ? 0 : Math.min(1, (e - 0.2) * 2.5)],
        ['titan', e < 0.5 ? 0 : Math.min(1, (e - 0.5) * 2.5)],
        ['colossus', e < 0.85 ? 0 : (e - 0.85) * 5],
      ];
      const tot = w.reduce((s, x) => s + x[1], 0);
      let r = Math.random() * tot;
      for (const [id, v] of w) { if ((r -= v) <= 0) return id; }
      return 'crawler';
    }

    absorbAndSpawn() {
      const g = this.g, w = g.world;
      for (const n of this.nests) {
        const c = w.chunkIndexAt(n.x, n.y);
        const take = Math.min(w.pollution[c], 1.5);
        if (take <= 0.01 && !n.pending.length) continue;
        w.pollution[c] -= take;
        n.budget += take;
        if (this.units.length >= 260) continue;
        const type = this.pickUnitType();
        const cost = D.enemies[type].cost;
        if (n.budget >= cost) {
          n.budget -= cost;
          if (!n.pending.length) n.pendingSince = g.tick;
          n.pending.push(type);
        }
        const size = 5 + Math.floor(this.evo * 20);
        if (n.pending.length >= size || (n.pending.length && g.tick - n.pendingSince > 3600 * 2)) this.launchAttack(n);
      }
    }

    findAttackTarget(x, y) {
      let best = null, bd = 320 * 320;
      for (const e of this.g.ents.values()) {
        const pr = D.protos[e.p];
        if (!pr.pollution) continue;
        const d = FG.dist2(e.x, e.y, x, y);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) {
        for (const e of this.g.ents.values()) {
          const d = FG.dist2(e.x, e.y, x, y);
          if (d < bd) { bd = d; best = e; }
        }
      }
      return best;
    }

    launchAttack(n) {
      const target = this.findAttackTarget(n.x, n.y);
      const types = n.pending;
      n.pending = [];
      if (!target) return;
      const path = this.findPath(n.x + 1, n.y + 1, target.x + target.w / 2, target.y + target.h / 2);
      const group = { id: this.nextId++, path, target: target.id };
      types.forEach((t, i) => this.spawnUnit(t, n.x + 1 + Math.cos(i) * 1.5, n.y + 1 + Math.sin(i) * 1.5, group, target.id));
      FG.emit('alert', { text: 'An attack wave is heading for your ' + D.items[D.protos[target.p].item].name.toLowerCase(), x: target.x, y: target.y, kind: 'wave' });
    }

    spawnUnit(type, x, y, group, targetId) {
      const u = D.enemies[type];
      const unit = {
        id: this.nextId++, type, x, y, hp: u.hp, cd: 0, pi: 0, group,
        target: targetId || null, targetPlayer: false, angle: 0, anim: Math.random() * 10, idle: 0, home: [x, y],
        ox: (Math.random() - 0.5) * 2.5, oy: (Math.random() - 0.5) * 2.5,
      };
      this.units.push(unit);
      return unit;
    }

    expand() {
      this.expandAt = this.g.tick + (6 + Math.random() * 8) * 3600;
      if (this.evo < 0.05 || !this.nests.length || this.nests.length > 420) return;
      const src = this.nests[Math.floor(Math.random() * this.nests.length)];
      for (let k = 0; k < 12; k++) {
        const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 14;
        const x = Math.round(src.x + Math.cos(a) * d), y = Math.round(src.y + Math.sin(a) * d);
        if (!this.g.world.inBounds(x, y)) continue;
        let near = false;
        for (const e of this.g.ents.values()) if (FG.dist2(e.x, e.y, x, y) < 26 * 26) { near = true; break; }
        if (near || FG.dist2(x, y, this.g.player.x, this.g.player.y) < 30 * 30) continue;
        if (FG.canPlace(this.g, 'stone_wall', x, y, 0, { noReplace: true, ignorePlayer: true }).ok &&
            FG.canPlace(this.g, 'stone_wall', x + 1, y + 1, 0, { noReplace: true, ignorePlayer: true }).ok && this.addNest(x, y)) return;
      }
    }

    // ------------------------------------------------------------------ units
    solidEntAt(x, y) {
      const e = FG.entAt(this.g, Math.floor(x), Math.floor(y));
      return e && D.protos[e.p].solid ? e : null;
    }

    killUnit(u, i) {
      this.units.splice(i, 1);
      this.g.stats.kills++;
      this.g.effects.push({ type: 'splat', x: u.x, y: u.y, color: D.enemies[u.type].color, r: D.enemies[u.type].size, t: 0, life: 900 });
    }

    damageUnit(u, dmg, source) {
      u.hp -= resist(u.type, dmg);
      if (source && source.id && !u.targetPlayer) u.target = source.id;
      if (source === 'player') u.targetPlayer = true;
    }

    damageNest(n, dmg, source) {
      n.hp -= Math.max(1, dmg - 2);
      if (n.cd <= 0 && this.units.length < 300) {
        n.cd = 180;
        const k = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < k; i++) {
          const u = this.spawnUnit(this.pickUnitType(), n.x + 1 + (Math.random() - 0.5) * 2, n.y + 1 + (Math.random() - 0.5) * 2, null, source && source.id ? source.id : null);
          if (source === 'player') u.targetPlayer = true;
        }
      }
      if (n.hp <= 0) {
        this.removeNest(n);
        this.evo += (1 - this.evo) * 0.002;
        this.g.stats.nestsKilled = (this.g.stats.nestsKilled || 0) + 1;
        this.g.effects.push({ type: 'boom', x: n.x + 1, y: n.y + 1, r: 2, t: 0, life: 40 });
        this.g.effects.push({ type: 'splat', x: n.x + 1, y: n.y + 1, color: '#6a3a5a', r: 1.6, t: 0, life: 1800 });
      }
    }

    updateUnits() {
      const g = this.g, p = g.player;
      for (let i = this.units.length - 1; i >= 0; i--) {
        const u = this.units[i];
        const def = D.enemies[u.type];
        if (u.hp <= 0) { this.killUnit(u, i); continue; }
        if (u.cd > 0) u.cd--;
        u.anim += def.speed * 3;
        // Pick who to fight.
        let tx = null, ty = null, tEnt = null, tPlayer = false;
        const pd = FG.dist2(u.x, u.y, p.x, p.y);
        if (!p.dead && (pd < 64 || (u.targetPlayer && pd < 40 * 40))) { tPlayer = true; tx = p.x; ty = p.y; }
        else {
          u.targetPlayer = false;
          if (u.target) {
            tEnt = g.ents.get(u.target);
            if (!tEnt) u.target = null;
          }
          if (!tEnt && g.tick % 30 === u.id % 30) {
            // Look for something nearby to wreck.
            let best = null, bd = 18 * 18;
            FG.entsNear(g, u.x, u.y, 18, (e) => {
              const d = FG.dist2(e.x + e.w / 2, e.y + e.h / 2, u.x, u.y);
              if (d < bd) { bd = d; best = e; }
            });
            if (best) { u.target = best.id; tEnt = best; u.group = null; }
          }
          if (tEnt) { tx = tEnt.x + tEnt.w / 2; ty = tEnt.y + tEnt.h / 2; }
        }
        if (tx === null) {
          // Nothing to do: wander home and eventually settle back in.
          u.idle++;
          tx = u.home[0]; ty = u.home[1];
          if (u.idle > 3600 || FG.dist2(u.x, u.y, tx, ty) < 4) { this.units.splice(i, 1); continue; }
        } else u.idle = 0;
        // In range? attack.
        const reach = def.range + (tEnt ? Math.max(tEnt.w, tEnt.h) / 2 : 0.3);
        const dist = Math.sqrt(FG.dist2(u.x, u.y, tx, ty));
        if (dist <= reach) {
          u.angle = Math.atan2(ty - u.y, tx - u.x);
          if (u.cd <= 0) {
            u.cd = def.cooldown;
            if (tPlayer) { p.hp -= def.dmg; p.lastHit = g.tick; if (p.hp <= 0) this.playerDied(); }
            else FG.damageEntity(g, tEnt, def.dmg);
          }
          continue;
        }
        // Move: follow group path while far away, otherwise head straight in.
        let wx = tx, wy = ty;
        if (u.group && u.group.path && dist > 12) {
          const path = u.group.path;
          while (u.pi < path.length - 1 && FG.dist2(u.x, u.y, path[u.pi][0] + u.ox, path[u.pi][1] + u.oy) < 6) u.pi++;
          if (u.pi < path.length) { wx = path[u.pi][0] + u.ox; wy = path[u.pi][1] + u.oy; }
        }
        const a = Math.atan2(wy - u.y, wx - u.x);
        u.angle = a;
        const nx = u.x + Math.cos(a) * def.speed, ny = u.y + Math.sin(a) * def.speed;
        const blocker = this.solidEntAt(nx, ny);
        if (blocker && (!tEnt || blocker.id !== tEnt.id)) {
          // Chew through whatever is in the way.
          if (u.cd <= 0) { u.cd = def.cooldown; FG.damageEntity(g, blocker, def.dmg); }
          continue;
        }
        if (g.world.isWater(Math.floor(nx), Math.floor(ny))) {
          // Slide along the shore.
          const sx = u.x + Math.cos(a) * def.speed, sy = u.y + Math.sin(a) * def.speed;
          if (!g.world.isWater(Math.floor(sx), Math.floor(u.y))) u.x = sx;
          else if (!g.world.isWater(Math.floor(u.x), Math.floor(sy))) u.y = sy;
          continue;
        }
        u.x = nx; u.y = ny;
      }
    }

    playerDied() {
      const p = this.g.player;
      p.hp = 0;
      p.dead = 180;
      this.g.effects.push({ type: 'boom', x: p.x, y: p.y, r: 1, t: 0, life: 30 });
      this.g.msg('You were overwhelmed. Rebuilding at the landing site...', 'bad');
    }

    // Nearest hostile within range of (x, y). Returns {unit} or {nest}.
    nearestHostile(x, y, range, preferX, preferY) {
      let best = null, bd = range * range;
      const px = preferX === undefined ? x : preferX, py = preferY === undefined ? y : preferY;
      for (const u of this.units) {
        const d = FG.dist2(u.x, u.y, x, y);
        if (d > range * range) continue;
        const score = FG.dist2(u.x, u.y, px, py);
        if (!best || score < bd) { bd = score; best = { unit: u }; }
      }
      if (best) return best;
      bd = range * range;
      for (const n of this.nests) {
        const d = FG.dist2(n.x + 1, n.y + 1, x, y);
        if (d < bd) { bd = d; best = { nest: n }; }
      }
      return best;
    }

    // ---------------------------------------------------------------- turrets
    updateTurrets() {
      const g = this.g;
      const rot = (e, ta) => {
        let da = ta - e.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const s = 0.12;
        e.angle += FG.clamp(da, -s, s);
        return Math.abs(da) < 0.25;
      };
      for (const e of g.byKind.turret || []) {
        if (e.cd > 0) e.cd--;
        if (!this.units.length && !this.nests.length) { e.status = e.ammo ? 'idle' : 'no_ammo'; continue; }
        const pr = D.protos[e.p];
        const cx = e.x + 1, cy = e.y + 1;
        if (g.tick % 8 === e.id % 8 || !e.target) e.target = this.nearestHostile(cx, cy, pr.range);
        const t = e.target;
        if (t && ((t.unit && t.unit.hp <= 0) || (t.nest && t.nest.dead))) { e.target = null; continue; }
        if (!t) { e.status = e.ammo || e.rounds ? 'idle' : 'no_ammo'; continue; }
        const tx = t.unit ? t.unit.x : t.nest.x + 1, ty = t.unit ? t.unit.y : t.nest.y + 1;
        if (FG.dist2(tx, ty, cx, cy) > pr.range * pr.range) { e.target = null; continue; }
        const aligned = rot(e, Math.atan2(ty - cy, tx - cx));
        if (e.rounds <= 0) {
          if (!e.ammo) { e.status = 'no_ammo'; continue; }
          e.rounds = D.items[e.ammo.id].ammo.rounds;
          e.ammoDmg = D.items[e.ammo.id].ammo.dmg;
          g.stats.consume(e.ammo.id, 1);
          if (--e.ammo.n <= 0) e.ammo = null;
        }
        e.status = 'working';
        if (aligned && e.cd <= 0) {
          e.cd = Math.max(2, Math.round(pr.cooldown / (1 + g.bonus.fireRate)));
          e.rounds--;
          const dmg = (e.ammoDmg || 5) * (1 + g.bonus.bulletDmg);
          if (t.unit) this.damageUnit(t.unit, dmg, e); else this.damageNest(t.nest, dmg, e);
          g.effects.push({ type: 'tracer', x0: cx + Math.cos(e.angle) * 0.9, y0: cy + Math.sin(e.angle) * 0.9, x1: tx, y1: ty, t: 0, life: 4, color: '#ffd27a' });
        }
      }
      for (const e of g.byKind.laser || []) {
        const pr = D.protos[e.p];
        if (e.cd > 0) e.cd--;
        const max = pr.shot * 2;
        e.want = e.buf < max ? pr.power : pr.drain;
        e.buf = Math.min(max, e.buf + (FG.sat(e) * e.want) / FG.TICKS);
        if (!this.units.length && !this.nests.length) { e.status = 'idle'; continue; }
        const cx = e.x + 1, cy = e.y + 1;
        if (g.tick % 8 === e.id % 8 || !e.target) e.target = this.nearestHostile(cx, cy, pr.range);
        const t = e.target;
        if (t && ((t.unit && t.unit.hp <= 0) || (t.nest && t.nest.dead))) { e.target = null; continue; }
        if (!t) { e.status = e.net ? 'idle' : 'no_power'; continue; }
        const tx = t.unit ? t.unit.x : t.nest.x + 1, ty = t.unit ? t.unit.y : t.nest.y + 1;
        if (FG.dist2(tx, ty, cx, cy) > pr.range * pr.range) { e.target = null; continue; }
        const aligned = rot(e, Math.atan2(ty - cy, tx - cx));
        if (e.buf < pr.shot) { e.status = 'low_power'; continue; }
        e.status = 'working';
        if (aligned && e.cd <= 0) {
          e.cd = Math.max(8, Math.round(pr.cooldown / (1 + g.bonus.fireRate)));
          e.buf -= pr.shot;
          const dmg = pr.dmg * (1 + g.bonus.laserDmg);
          if (t.unit) this.damageUnit(t.unit, dmg, e); else this.damageNest(t.nest, dmg, e);
          g.effects.push({ type: 'tracer', x0: cx, y0: cy - 0.4, x1: tx, y1: ty, t: 0, life: 8, color: '#ff4a5a', width: 3 });
        }
      }
    }

    // --------------------------------------------------------- player weapons
    playerGun() {
      const inv = this.g.player.inv;
      if (inv.count('smg')) return 'smg';
      if (inv.count('pistol')) return 'pistol';
      return null;
    }
    updatePlayerCombat() {
      const g = this.g, p = g.player, inp = g.input;
      if (p.cd > 0) p.cd--;
      if (!inp.shoot || p.dead) return;
      const gunId = this.playerGun();
      if (!gunId) { if (g.tick % 120 === 0) g.msg('You need a gun to shoot', 'warn'); return; }
      const gun = D.items[gunId].gun;
      const t = this.nearestHostile(p.x, p.y, gun.range, inp.aimX, inp.aimY);
      if (!t) return;
      if (p.cd > 0) return;
      if (p.rounds <= 0) {
        const ammo = p.inv.count('ammo_pierce') ? 'ammo_pierce' : p.inv.count('ammo_basic') ? 'ammo_basic' : null;
        if (!ammo) { if (g.tick % 120 === 0) g.msg('Out of ammo', 'warn'); return; }
        p.inv.remove(ammo, 1);
        g.stats.consume(ammo, 1);
        p.rounds = D.items[ammo].ammo.rounds;
        p.ammoDmg = D.items[ammo].ammo.dmg;
        FG.emit('inventory');
      }
      p.rounds--;
      p.cd = Math.round(gun.rate / (1 + g.bonus.fireRate));
      const tx = t.unit ? t.unit.x : t.nest.x + 1, ty = t.unit ? t.unit.y : t.nest.y + 1;
      const dmg = (p.ammoDmg || 5) * (1 + g.bonus.bulletDmg);
      if (t.unit) this.damageUnit(t.unit, dmg, 'player'); else this.damageNest(t.nest, dmg, 'player');
      p.aim = Math.atan2(ty - p.y, tx - p.x);
      g.effects.push({ type: 'tracer', x0: p.x, y0: p.y - 0.3, x1: tx, y1: ty, t: 0, life: 4, color: '#fff2b0' });
    }

    throwGrenade(x, y) {
      const g = this.g, p = g.player;
      if (p.dead || p.cd > 0 || !p.inv.count('grenade')) return false;
      const d = Math.sqrt(FG.dist2(x, y, p.x, p.y));
      if (d > 16) { const k = 16 / d; x = p.x + (x - p.x) * k; y = p.y + (y - p.y) * k; }
      p.inv.remove('grenade', 1);
      g.stats.consume('grenade', 1);
      p.cd = 30;
      this.shots.push({ x0: p.x, y0: p.y, x1: x, y1: y, t: 0, life: 30 });
      FG.emit('inventory');
      return true;
    }
    updateShots() {
      for (let i = this.shots.length - 1; i >= 0; i--) {
        const s = this.shots[i];
        if (++s.t < s.life) continue;
        this.shots.splice(i, 1);
        const R = 3.5;
        for (const u of this.units) if (FG.dist2(u.x, u.y, s.x1, s.y1) < R * R) this.damageUnit(u, 35 * (1 + this.g.bonus.bulletDmg * 0.5), 'player');
        for (const n of this.nests.slice()) if (FG.dist2(n.x + 1, n.y + 1, s.x1, s.y1) < (R + 1) * (R + 1)) this.damageNest(n, 35, 'player');
        this.g.effects.push({ type: 'boom', x: s.x1, y: s.y1, r: R, t: 0, life: 24 });
      }
    }
  }
  FG.Enemies = Enemies;
})();
