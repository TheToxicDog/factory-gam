// Cogworks Frontier — game state and the fixed-rate simulation tick.
(function () {
  'use strict';
  const D = FG.data;

  // --------------------------------------------------------------- statistics
  class Stats {
    constructor() {
      this.cur = { p: {}, c: {} };
      this.sec = [];   // last 60 seconds
      this.ten = [];   // last 10 minutes in 10 s buckets
      this.min = [];   // last hour in 1 min buckets
      this.total = { p: {}, c: {} };
      this.pw = { prod: 0, use: 0, steam: 0, solar: 0, acc: 0, n: 0 };
      this.pwSec = [];
      this.kills = 0;
      this.pollution = 0;
    }
    produce(id, n) {
      this.cur.p[id] = (this.cur.p[id] || 0) + n;
      this.total.p[id] = (this.total.p[id] || 0) + n;
    }
    consume(id, n) {
      this.cur.c[id] = (this.cur.c[id] || 0) + n;
      this.total.c[id] = (this.total.c[id] || 0) + n;
    }
    power(prod, use, steam, solar, acc) {
      const p = this.pw;
      p.prod += prod; p.use += use; p.steam += steam; p.solar += solar; p.acc += acc; p.n++;
    }
    static merge(list) {
      const out = { p: {}, c: {} };
      for (const b of list) for (const k of ['p', 'c']) for (const id in b[k]) out[k][id] = (out[k][id] || 0) + b[k][id];
      return out;
    }
    tick(t) {
      if (t % 60 !== 0) return;
      this.sec.push(this.cur);
      if (this.sec.length > 60) this.sec.shift();
      this.cur = { p: {}, c: {} };
      const n = this.pw.n || 1;
      this.pwSec.push({ prod: this.pw.prod / n, use: this.pw.use / n, steam: this.pw.steam / n, solar: this.pw.solar / n, acc: this.pw.acc / n });
      if (this.pwSec.length > 120) this.pwSec.shift();
      this.pw = { prod: 0, use: 0, steam: 0, solar: 0, acc: 0, n: 0 };
      if (t % 600 === 0) {
        this.ten.push(Stats.merge(this.sec.slice(-10)));
        if (this.ten.length > 60) this.ten.shift();
      }
      if (t % 3600 === 0) {
        this.min.push(Stats.merge(this.ten.slice(-6)));
        if (this.min.length > 60) this.min.shift();
      }
    }
    // Per-minute rates over a window: '1m', '10m', '1h'.
    rates(win) {
      let list, minutes;
      if (win === '10m') { list = this.ten; minutes = Math.max(1 / 6, this.ten.length / 6); }
      else if (win === '1h') { list = this.min; minutes = Math.max(1, this.min.length); }
      else { list = this.sec; minutes = Math.max(1 / 60, this.sec.length / 60); }
      const m = Stats.merge(list);
      const out = {};
      for (const k of ['p', 'c']) for (const id in m[k]) {
        out[id] = out[id] || { p: 0, c: 0 };
        out[id][k] = m[k][id] / minutes;
      }
      return out;
    }
    series(id, win) {
      const list = win === '10m' ? this.ten : win === '1h' ? this.min : this.sec;
      return list.map((b) => [b.p[id] || 0, b.c[id] || 0]);
    }
  }
  FG.Stats = Stats;

  // Which caches each building kind can affect.
  const DIRTY_POWER = { pole: 1, drill: 1, pumpjack: 1, furnace: 1, crafter: 1, lab: 1, inserter: 1, beacon: 1, uplink: 1, laser: 1, engine: 1, solar: 1, accumulator: 1 };
  const DIRTY_FLUID = { pipe: 1, pipe_ug: 1, tank: 1, offshore: 1, boiler: 1, engine: 1, pumpjack: 1, crafter: 1 };
  const DIRTY_FX = { beacon: 1, drill: 1, pumpjack: 1, furnace: 1, crafter: 1, lab: 1 };

  // --------------------------------------------------------------------- game
  class Game {
    constructor(opts) {
      opts = opts || {};
      this.opts = {
        seed: opts.seed >>> 0 || ((Math.random() * 1e9) | 0),
        size: opts.size || 512,
        enemies: opts.enemies || 'normal', // normal | peaceful | off
        richness: opts.richness || 1,
      };
      this.world = new FG.World(this.opts.seed, this.opts.size, { richness: this.opts.richness });
      FG.trains.init(this);
      this.ents = new Map();
      this.nextId = 1;
      this.byKind = {};
      this.chunkEnts = [];
      this.dirty = { belts: true, power: true, fluid: true, fx: true };
      this.tick = 0;
      this.ghosts = new Map();
      this.ghostGrid = new Int32Array(this.world.W * this.world.H);
      this.nextGhost = 1;
      this.research = { done: {}, current: null, queue: [], progress: {} };
      this.unlocked = {};
      this.bonus = { miningProd: 0, hand: 0, labSpeed: 0, bulletDmg: 0, fireRate: 0, laserDmg: 0, drones: 0 };
      this.stats = new Stats();
      this.launches = 0;
      this.won = false;
      this.effects = []; // transient visual effects (render only)
      this.input = { mx: 0, my: 0, mine: null, shoot: false, aimX: 0, aimY: 0 };
      this.player = {
        x: this.world.spawnX + 0.5, y: this.world.spawnY + 0.5,
        inv: new FG.Inventory(60), hp: 250, maxHp: 250, lastHit: -9999,
        queue: [], craftProg: 0, mining: null, facing: 2, walk: 0, gun: 'pistol', cd: 0, rounds: 0, dead: 0,
      };
      const inv = this.player.inv;
      inv.add('iron_plate', 8);
      inv.add('wood', 4);
      inv.add('burner_drill', 1);
      inv.add('stone_furnace', 1);
      inv.add('pistol', 1);
      inv.add('ammo_basic', 10);
      this.enemies = new FG.Enemies(this);
      this.objectives = new FG.Objectives(this);
    }

    // Flag the topology caches affected by a change to an entity of this kind.
    markDirty(kind) {
      if (kind === 'fluid') { this.dirty.fluid = true; return; }
      if (kind === 'fx') { this.dirty.fx = true; return; }
      if (kind === 'belt' || kind === 'underground' || kind === 'splitter' || kind === 'loader') { this.dirty.belts = true; return; }
      if (kind === 'signal' || kind === 'trainstop') { this.rail.dirty = true; return; }
      if (DIRTY_POWER[kind]) this.dirty.power = true;
      if (DIRTY_FLUID[kind]) this.dirty.fluid = true;
      if (DIRTY_FX[kind]) this.dirty.fx = true;
    }

    recipeEnabled(rid) {
      const r = D.recipes[rid];
      return !!r && (r.start || !!this.unlocked[rid]);
    }

    // Day/night: 0 at midnight, 1 at noon (drives solar output and lighting).
    daylight() {
      const L = 25000;
      const f = ((this.tick + L * 0.1) % L) / L;
      if (f < 0.45) return 1;
      if (f < 0.55) return 1 - (f - 0.45) / 0.1;
      if (f < 0.8) return 0;
      if (f < 0.9) return (f - 0.8) / 0.1;
      return 1;
    }

    pollute(x, y, amt) {
      this.world.pollution[this.world.chunkIndexAt(x, y)] += amt;
      this.stats.pollution += amt;
    }

    msg(text, kind) { FG.emit('message', text, kind || 'info'); }

    // -------------------------------------------------------------- research
    techState(tid) {
      if (this.research.done[tid]) return 'done';
      const t = D.techs[tid];
      return t.prereq.every((p) => this.research.done[p]) ? 'available' : 'locked';
    }
    // Queue a technology, adding any missing prerequisites first.
    queueResearch(tid, front) {
      const chain = [];
      const visit = (id) => {
        if (this.research.done[id] || chain.indexOf(id) >= 0) return;
        for (const p of D.techs[id].prereq) visit(p);
        chain.push(id);
      };
      visit(tid);
      const q = this.research.queue.filter((x) => chain.indexOf(x) < 0);
      this.research.queue = front ? chain.concat(q) : q.concat(chain);
      if (!this.research.current || front) this.nextResearch();
      FG.emit('research');
    }
    cancelResearch(tid) {
      this.research.queue = this.research.queue.filter((x) => x !== tid);
      if (this.research.current === tid) { this.research.current = null; this.nextResearch(); }
      FG.emit('research');
    }
    nextResearch() {
      const q = this.research.queue;
      const idx = q.findIndex((id) => this.techState(id) === 'available');
      this.research.current = idx >= 0 ? q[idx] : null;
    }
    researchUnit(tid) {
      if (this.research.done[tid]) return;
      const r = this.research;
      r.progress[tid] = (r.progress[tid] || 0) + 1;
      if (r.progress[tid] >= D.techs[tid].units) this.completeResearch(tid);
    }
    completeResearch(tid, silent) {
      const t = D.techs[tid];
      const r = this.research;
      if (r.done[tid]) return;
      r.done[tid] = 1;
      r.progress[tid] = t.units;
      for (const u of t.unlocks) this.unlocked[u] = 1;
      for (const ef of t.effects) this.applyEffect(ef);
      r.queue = r.queue.filter((x) => x !== tid);
      if (r.current === tid) { r.current = null; this.nextResearch(); }
      if (!silent) {
        this.msg('Research complete: ' + t.name, 'good');
        FG.emit('research', tid);
      }
    }
    applyEffect(ef) {
      const b = this.bonus;
      switch (ef.type) {
        case 'inv': {
          const extra = this.player.inv.resize(this.player.inv.size + ef.v);
          for (const [id, n] of extra) this.player.inv.add(id, n);
          break;
        }
        case 'hand': b.hand += ef.v; break;
        case 'lab_speed': b.labSpeed += ef.v; break;
        case 'mining_prod': b.miningProd += ef.v; break;
        case 'bullet_dmg': b.bulletDmg += ef.v; break;
        case 'fire_rate': b.fireRate += ef.v; break;
        case 'laser_dmg': b.laserDmg += ef.v; break;
        case 'drones': b.drones = 1; break;
      }
    }

    // ---------------------------------------------------------- hand crafting
    canHandcraft(rid) {
      const r = D.recipes[rid];
      return r && D.HAND_CATS.indexOf(r.cat) >= 0 && !Object.keys(r.fin).length && this.recipeEnabled(rid);
    }
    // Virtual inventory after the queued crafts complete.
    virtualInv() {
      const inv = this.player.inv.totals();
      for (const q of this.player.queue) {
        const r = D.recipes[q.rid];
        const pending = q.n - (q.started ? 1 : 0);
        for (const i in r.ing) inv[i] = (inv[i] || 0) - r.ing[i] * pending;
        for (const o in r.out) inv[o] = (inv[o] || 0) + r.out[o] * q.n;
      }
      return inv;
    }
    planCraft(rid, times, inv, steps, depth) {
      if (depth > 8 || !this.canHandcraft(rid)) return false;
      const r = D.recipes[rid];
      for (const id in r.ing) {
        const need = r.ing[id] * times;
        const have = Math.max(0, inv[id] || 0);
        if (have >= need) { inv[id] = have - need; continue; }
        const missing = need - have;
        inv[id] = 0;
        const sub = D.recipeFor[id];
        if (!sub || !this.canHandcraft(sub.id)) return false;
        const subTimes = Math.ceil(missing / sub.out[id]);
        if (!this.planCraft(sub.id, subTimes, inv, steps, depth + 1)) return false;
        inv[id] = (inv[id] || 0) + subTimes * sub.out[id] - missing;
      }
      steps.push({ rid, n: times, sub: depth > 0 });
      return true;
    }
    // How many times could this recipe be hand-crafted right now?
    craftableCount(rid) {
      if (!this.canHandcraft(rid)) return 0;
      let lo = 0, hi = 1;
      const ok = (n) => this.planCraft(rid, n, this.virtualInv(), [], 0);
      if (!ok(1)) return 0;
      while (hi < 2048 && ok(hi * 2)) hi *= 2;
      lo = hi; hi = hi * 2;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ok(m)) lo = m; else hi = m; }
      return lo;
    }
    queueCraft(rid, times) {
      const steps = [];
      if (!this.planCraft(rid, times, this.virtualInv(), steps, 0)) return false;
      for (const s of steps) this.player.queue.push({ rid: s.rid, n: s.n, sub: s.sub, started: false });
      FG.emit('queue');
      return true;
    }
    cancelCraft(index) {
      const q = this.player.queue[index];
      if (!q) return;
      if (q.started) {
        const r = D.recipes[q.rid];
        for (const i in r.ing) this.player.inv.add(i, r.ing[i]);
      }
      this.player.queue.splice(index, 1);
      this.player.craftProg = index === 0 ? 0 : this.player.craftProg;
      FG.emit('queue');
    }
    updateCrafting() {
      const p = this.player;
      const q = p.queue[0];
      if (!q) return;
      const r = D.recipes[q.rid];
      if (!q.started) {
        for (const i in r.ing) if (p.inv.count(i) < r.ing[i]) {
          p.queue.shift();
          this.msg('Crafting cancelled: missing ' + D.items[i].name, 'warn');
          FG.emit('queue');
          return;
        }
        for (const i in r.ing) p.inv.remove(i, r.ing[i]);
        q.started = true;
        p.craftProg = 0;
      }
      p.craftProg += 1 / (r.time * FG.TICKS);
      if (p.craftProg >= 1) {
        for (const o in r.out) if (p.inv.space(o) < r.out[o]) {
          p.craftProg = 1;
          if (this.tick % 120 === 0) this.msg('Inventory full', 'warn');
          return;
        }
        for (const o in r.out) {
          p.inv.add(o, r.out[o]);
          this.stats.produce(o, r.out[o]);
        }
        for (const i in r.ing) this.stats.consume(i, r.ing[i]);
        p.craftProg = 0;
        FG.emit('sound', 'craft');
        q.n--;
        q.started = false;
        if (q.n <= 0) p.queue.shift();
        FG.emit('queue');
        FG.emit('inventory');
      }
    }

    // ------------------------------------------------------------------ player
    playerBlocked(x, y) {
      const w = this.world;
      const r = 0.28;
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        const tx = Math.floor(x + ox), ty = Math.floor(y + oy);
        if (!w.inBounds(tx, ty) || w.isWater(tx, ty)) return true;
        // Trees don't block walking (only building); boulders do.
        const ri = ty * w.W + tx;
        if (w.res[ri] === FG.RES.ROCK && w.amt[ri] > 0) return true;
        const e = FG.entAt(this, tx, ty);
        if (e && D.protos[e.p].solid) return true;
        if (this.enemies.nestBlocks(tx, ty, 1, 1)) return true;
      }
      return false;
    }
    updatePlayer() {
      const p = this.player;
      if (p.dead > 0) {
        p.dead--;
        if (p.dead === 0) {
          p.x = this.world.spawnX + 0.5; p.y = this.world.spawnY + 0.5; p.hp = p.maxHp;
          this.msg('You were rebuilt at the landing site.', 'warn');
        }
        return;
      }
      const inp = this.input;
      if (p.vehicle) {
        const tr = FG.trains.trainById(this, p.vehicle);
        if (tr) {
          const li = Math.max(0, tr.cars.findIndex((c) => c.type === 'loco'));
          const pose = FG.trains.carPose(tr, li);
          p.x = pose.x; p.y = pose.y;
          if (tr.mode === 'manual') tr.ctrl = { throttle: -inp.my, steer: inp.mx };
          if (this.tick % 30 === 0) this.world.chart((p.x / FG.CHUNK) | 0, (p.y / FG.CHUNK) | 0, 2);
          return;
        }
        p.vehicle = null;
      }
      let mx = inp.mx, my = inp.my;
      const len = Math.hypot(mx, my);
      const speed = 0.15;
      if (len > 0) {
        mx = (mx / len) * speed; my = (my / len) * speed;
        if (!this.playerBlocked(p.x + mx, p.y)) p.x += mx;
        if (!this.playerBlocked(p.x, p.y + my)) p.y += my;
        p.walk += 1;
        if (Math.abs(mx) > Math.abs(my)) p.facing = mx > 0 ? 1 : 3; else p.facing = my > 0 ? 2 : 0;
      }
      // Belts carry the player along.
      const node = FG.belts.nodeAt(this, Math.floor(p.x), Math.floor(p.y));
      if (node && len === 0) {
        const s = node.speed || D.protos[(node.owner || node).p].speed / FG.TICKS;
        const nx = p.x + FG.DX[node.dir] * s, ny = p.y + FG.DY[node.dir] * s;
        if (!this.playerBlocked(nx, ny)) { p.x = nx; p.y = ny; }
      }
      if (this.tick - p.lastHit > 600 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 0.1);
      if (this.tick % 30 === 0) this.world.chart((p.x / FG.CHUNK) | 0, (p.y / FG.CHUNK) | 0, 2);
      this.updateMining();
    }
    // Mining time in ticks for the current target.
    mineTime(t) {
      if (t.kind === 'car') return 30;
      if (t.kind === 'rail') return 12;
      if (t.kind === 'ent') {
        const pr = D.protos[this.ents.get(t.id).p];
        return pr.w * pr.h > 4 ? 30 : 15;
      }
      const r = this.world.res[t.y * this.world.W + t.x];
      if (r === FG.RES.TREE) return 45;
      if (r === FG.RES.ROCK) return 90;
      return 40;
    }
    updateMining() {
      const p = this.player;
      const t = this.input.mine;
      if (!t) { p.mining = null; return; }
      if (!p.mining || p.mining.key !== t.key) p.mining = { key: t.key, prog: 0 };
      if (t.kind === 'ent' && !this.ents.get(t.id)) { p.mining = null; return; }
      if (t.kind === 'car' && !FG.trains.findCar(this, t.id)) { p.mining = null; return; }
      if (t.kind === 'rail' && t.pc.dead) { p.mining = null; return; }
      p.mining.prog += 1 / this.mineTime(t);
      if (p.mining.prog < 1) return;
      p.mining.prog = 0;
      if (t.kind === 'car') this.pickUpCar(FG.trains.findCar(this, t.id));
      else if (t.kind === 'rail') this.pickUpRail(t.pc);
      else if (t.kind === 'ent') this.pickUpEntity(this.ents.get(t.id));
      else this.mineTile(t.x, t.y);
    }
    mineTile(x, y) {
      const w = this.world;
      const i = y * w.W + x;
      const r = w.res[i];
      if (!r || w.amt[i] <= 0 || r === FG.RES.OIL) return;
      const id = FG.RES_ITEM[r];
      let n = 1;
      if (r === FG.RES.TREE) n = w.amt[i];
      if (r === FG.RES.ROCK) n = w.amt[i];
      if (this.player.inv.space(id) < n) { this.msg('Inventory full', 'warn'); return; }
      this.player.inv.add(id, n);
      this.stats.produce(id, n);
      w.amt[i] -= n;
      w.modified.add(i);
      if (w.amt[i] <= 0) { w.res[i] = 0; w.amt[i] = 0; w.touchChunk(x, y); }
      FG.emit('picked', id, n, x + 0.5, y + 0.5);
      FG.emit('sound', r === FG.RES.TREE ? 'chop' : 'mine');
      FG.emit('inventory');
    }
    pickUpEntity(e) {
      if (!e) return false;
      const items = FG.entityContents(this, e, true);
      if (!this.player.inv.canFit(items)) { this.msg('Not enough inventory space to pick that up', 'warn'); return false; }
      FG.removeEntity(this, e);
      for (const [id, n] of items) this.player.inv.add(id, n);
      if (items.length) FG.emit('picked', items[0][0], items[0][1], e.x + e.w / 2, e.y + e.h / 2);
      FG.emit('sound', 'pickup');
      FG.emit('inventory');
      return true;
    }
    // Pick up a rail car (and its contents) into the inventory.
    pickUpCar(hit) {
      const { train, car, index } = hit;
      const items = [[FG.trains.itemFor(car), 1]];
      for (const s of car.inv.slots) if (s) items.push([s.id, s.n]);
      if (!this.player.inv.canFit(items)) { this.msg('Not enough inventory space to pick that up', 'warn'); return false; }
      const pose = FG.trains.carPose(train, index);
      FG.trains.removeCar(this, train, index);
      for (const [id, n] of items) this.player.inv.add(id, n);
      FG.emit('picked', items[0][0], 1, pose.x, pose.y);
      FG.emit('sound', 'pickup');
      FG.emit('inventory');
      return true;
    }
    // Pick up a piece of track.
    pickUpRail(pc) {
      if (!pc || pc.dead) return false;
      if (FG.trains.pieceUnderTrain(this, pc)) { this.msg('A train is standing on this track', 'warn'); return false; }
      const n = FG.rails.itemCost(pc.t);
      if (this.player.inv.space('rail') < n) { this.msg('Not enough inventory space to pick that up', 'warn'); return false; }
      FG.rails.remove(this, pc);
      this.player.inv.add('rail', n);
      FG.emit('picked', 'rail', n, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2);
      FG.emit('sound', 'pickup');
      FG.emit('inventory');
      return true;
    }
    // Lay a piece of track from the inventory. Returns the piece, or null.
    buildRail(ax, ay, ah, t) {
      const RL = FG.rails;
      const key = RL.pieceKeyOf(ax, ay, ah, t);
      if (this.rail.byKey.has(key)) return this.rail.byKey.get(key);
      const n = RL.itemCost(t);
      if (this.player.inv.count('rail') < n) return null;
      const pc = RL.build(this, ax, ay, ah, t);
      if (!pc) return null;
      this.player.inv.remove('rail', n);
      this.rail.ghosts.delete(key);
      FG.emit('inventory');
      return pc;
    }
    // Build planned track starting from one ghost piece and following connected ghosts,
    // while within reach of (x, y) and while rails last. Returns the number built.
    buildGhostRun(start, x, y, reach) {
      const RL = FG.rails, G = this.rail.ghosts;
      const todo = [start], seen = new Set([start.key]);
      let n = 0;
      while (todo.length) {
        const pc = todo.shift();
        if (!G.has(pc.key)) continue;
        if (Math.hypot((pc.ax + pc.bx) / 2 - x, (pc.ay + pc.by) / 2 - y) > reach) continue;
        if (this.player.inv.count('rail') < RL.itemCost(pc.t)) break;
        if (!this.buildRail(pc.ax, pc.ay, pc.ah, pc.t)) continue;
        n++;
        for (const o of G.values()) {
          if (seen.has(o.key)) continue;
          if ((o.ax === pc.ax && o.ay === pc.ay) || (o.ax === pc.bx && o.ay === pc.by) || (o.bx === pc.ax && o.by === pc.ay) || (o.bx === pc.bx && o.by === pc.by)) { seen.add(o.key); todo.push(o); }
        }
      }
      return n;
    }
    giveOrDrop(list) {
      let lost = false;
      for (const [id, n] of list) if (this.player.inv.add(id, n) > 0) lost = true;
      if (lost) this.msg('Inventory full: some items were lost', 'warn');
      FG.emit('inventory');
    }

    // Build from the player's inventory. Returns the entity or null.
    build(itemId, x, y, dir, settings) {
      const it = D.items[itemId];
      if (!it || !it.place) return null;
      if (this.player.inv.count(itemId) < 1) return null;
      const chk = FG.canPlace(this, it.place, x, y, dir);
      if (!chk.ok) return null;
      let ent;
      if (chk.replace) {
        if (chk.replace.p === it.place && chk.replace.dir === dir) return null;
        const res = FG.replaceEntity(this, chk.replace, it.place, dir);
        ent = res.ent;
        this.giveOrDrop(res.leftovers);
      } else ent = FG.placeEntity(this, it.place, x, y, dir);
      this.player.inv.remove(itemId, 1);
      if (settings) this.applySettings(ent, settings);
      FG.emit('inventory');
      return ent;
    }
    applySettings(ent, s) {
      const pr = D.protos[ent.p];
      const sr = s.recipe && D.recipes[s.recipe];
      if (sr && pr.kind === 'crafter' && pr.cats.indexOf(sr.cat) >= 0 && this.recipeEnabled(s.recipe) && (pr.fb || !Object.keys(sr.fin).length)) {
        this.giveOrDrop(FG.machines.setRecipe(this, ent, s.recipe));
      }
      if (s.filter !== undefined && (pr.filter || pr.kind === 'splitter' || pr.kind === 'loader')) ent.filter = s.filter;
      if ((s.lm === 'in' || s.lm === 'out') && pr.kind === 'loader' && s.lm !== ent.lm) { ent.lm = s.lm; FG.computeLoaderNode(ent); this.markDirty('loader'); }
      if (s.prio !== undefined && pr.kind === 'splitter') ent.prio = s.prio;
      if (FG.rails.isSideKind(pr.kind)) {
        if (s.rd !== undefined) { ent.rd = s.rd; this.rail.dirty = true; }
        if (s.name && pr.kind === 'trainstop') ent.name = s.name;
      }
    }

    // -------------------------------------------------------------- ghosts
    ghostAt(x, y) {
      if (!this.world.inBounds(x, y)) return null;
      const id = this.ghostGrid[y * this.world.W + x];
      return id ? this.ghosts.get(id) : null;
    }
    addGhost(p, x, y, dir, settings) {
      const pr = D.protos[p];
      dir = pr.rotatable ? dir : 0;
      const [w, h] = FG.footprint(pr, dir);
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (!this.world.inBounds(xx, yy) || this.world.isWater(xx, yy)) return null;
        if (this.ghostAt(xx, yy) || FG.entAt(this, xx, yy)) return null;
      }
      const gh = { id: this.nextGhost++, p, x, y, dir, w, h, settings: settings || null, t: this.tick };
      this.ghosts.set(gh.id, gh);
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.ghostGrid[yy * this.world.W + xx] = gh.id;
      return gh;
    }
    removeGhost(gh) {
      this.ghosts.delete(gh.id);
      for (let yy = gh.y; yy < gh.y + gh.h; yy++) for (let xx = gh.x; xx < gh.x + gh.w; xx++) {
        const i = yy * this.world.W + xx;
        if (this.ghostGrid[i] === gh.id) this.ghostGrid[i] = 0;
      }
    }
    removeGhostsIn(x, y, w, h) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        const gh = this.ghostAt(xx, yy);
        if (gh) this.removeGhost(gh);
      }
    }
    // Personal drones build ghosts and deconstruct marked entities near the player.
    updateDrones() {
      if (!this.bonus.drones || this.tick % 8 !== 0 || this.player.dead) return;
      const p = this.player;
      const R = 28;
      let best = null, bd = R * R;
      for (const gh of this.ghosts.values()) {
        const d = FG.dist2(gh.x + gh.w / 2, gh.y + gh.h / 2, p.x, p.y);
        if (d < bd && this.player.inv.count(D.protos[gh.p].item) > 0) { bd = d; best = gh; }
      }
      if (best) {
        const item = D.protos[best.p].item;
        const chk = FG.canPlace(this, best.p, best.x, best.y, best.dir, { noReplace: true });
        if (chk.ok) {
          this.removeGhost(best);
          const ent = FG.placeEntity(this, best.p, best.x, best.y, best.dir);
          this.player.inv.remove(item, 1);
          if (best.settings) this.applySettings(ent, best.settings);
          this.effects.push({ type: 'drone', x0: p.x, y0: p.y, x1: best.x + best.w / 2, y1: best.y + best.h / 2, t: 0, life: 20 });
          FG.emit('inventory');
          return;
        }
      }
      // Planned track.
      let bestRail = null;
      bd = R * R;
      const rails = this.player.inv.count('rail');
      for (const pc of this.rail.ghosts.values()) {
        const d = FG.dist2((pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, p.x, p.y);
        if (d < bd && rails >= FG.rails.itemCost(pc.t)) { bd = d; bestRail = pc; }
      }
      if (bestRail) {
        const pc = bestRail;
        if (this.buildRail(pc.ax, pc.ay, pc.ah, pc.t)) {
          this.effects.push({ type: 'drone', x0: p.x, y0: p.y, x1: (pc.ax + pc.bx) / 2, y1: (pc.ay + pc.by) / 2, t: 0, life: 20 });
          return;
        }
        this.rail.ghosts.delete(pc.key);
      }
      for (const pc of this.rail.pieces.values()) {
        if (!pc.decon) continue;
        const cx = (pc.ax + pc.bx) / 2, cy = (pc.ay + pc.by) / 2;
        if (FG.dist2(cx, cy, p.x, p.y) > R * R) continue;
        if (this.pickUpRail(pc)) this.effects.push({ type: 'drone', x0: cx, y0: cy, x1: p.x, y1: p.y, t: 0, life: 20 });
        else pc.decon = false;
        return;
      }
      for (const e of this.ents.values()) {
        if (!e.decon) continue;
        const d = FG.dist2(e.x + e.w / 2, e.y + e.h / 2, p.x, p.y);
        if (d > R * R) continue;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        if (this.pickUpEntity(e)) this.effects.push({ type: 'drone', x0: cx, y0: cy, x1: p.x, y1: p.y, t: 0, life: 20 });
        else e.decon = false;
        return;
      }
    }

    // -------------------------------------------------------------------- tick
    step() {
      if (this.dirty.belts) { FG.belts.recompute(this); this.dirty.belts = false; }
      if (this.dirty.fluid) { FG.fluidsys.recompute(this); this.dirty.fluid = false; }
      if (this.dirty.power) { FG.power.recompute(this); this.dirty.power = false; }
      if (this.dirty.fx) { FG.machines.recomputeEffects(this); this.dirty.fx = false; }
      FG.machines.update(this);
      FG.belts.update(this);
      FG.trains.update(this);
      this.enemies.update();
      FG.power.update(this);
      this.updatePlayer();
      this.updateCrafting();
      this.updateDrones();
      for (let i = this.effects.length - 1; i >= 0; i--) {
        const f = this.effects[i];
        if (++f.t >= f.life) this.effects.splice(i, 1);
      }
      this.tick++;
      this.stats.tick(this.tick);
      if (this.tick % 30 === 0) this.objectives.check();
    }

    onLaunch() {
      this.launches++;
      this.stats.produce('satellite', 0);
      if (!this.won) {
        this.won = true;
        this.wonAt = this.tick;
      }
      FG.emit('launch', this.launches);
    }
  }
  FG.Game = Game;
})();
