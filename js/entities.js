// Cogworks Frontier — entity lifecycle: inventories, placement, removal and item exchange.
(function () {
  'use strict';
  const D = FG.data;

  // ------------------------------------------------------------ inventory
  class Inventory {
    constructor(n) { this.slots = new Array(n).fill(null); }
    get size() { return this.slots.length; }
    count(id) {
      let c = 0;
      for (const s of this.slots) if (s && s.id === id) c += s.n;
      return c;
    }
    space(id) {
      const st = D.items[id].stack;
      let c = 0;
      for (const s of this.slots) {
        if (!s) c += st;
        else if (s.id === id) c += st - s.n;
      }
      return c;
    }
    add(id, n) {
      if (n <= 0) return 0;
      const st = D.items[id].stack;
      for (const s of this.slots) {
        if (s && s.id === id && s.n < st) {
          const k = Math.min(st - s.n, n);
          s.n += k; n -= k;
          if (!n) return 0;
        }
      }
      for (let i = 0; i < this.slots.length; i++) {
        if (!this.slots[i]) {
          const k = Math.min(st, n);
          this.slots[i] = { id, n: k }; n -= k;
          if (!n) return 0;
        }
      }
      return n;
    }
    remove(id, n) {
      let got = 0;
      for (let i = this.slots.length - 1; i >= 0 && got < n; i--) {
        const s = this.slots[i];
        if (s && s.id === id) {
          const k = Math.min(s.n, n - got);
          s.n -= k; got += k;
          if (!s.n) this.slots[i] = null;
        }
      }
      return got;
    }
    isEmpty() { return this.slots.every((s) => !s); }
    totals() {
      const t = {};
      for (const s of this.slots) if (s) t[s.id] = (t[s.id] || 0) + s.n;
      return t;
    }
    // Can every [id, n] pair fit at once?
    canFit(list) {
      const tmp = new Inventory(this.slots.length);
      tmp.slots = this.slots.map((s) => (s ? { id: s.id, n: s.n } : null));
      for (const [id, n] of list) if (tmp.add(id, n) > 0) return false;
      return true;
    }
    resize(n) {
      const extra = [];
      if (n < this.slots.length) {
        for (const s of this.slots.slice(n)) if (s) extra.push([s.id, s.n]);
        this.slots.length = n;
      } else while (this.slots.length < n) this.slots.push(null);
      return extra;
    }
    sort() {
      const t = this.totals();
      const ids = Object.keys(t).sort((a, b) => D.items[a].order - D.items[b].order);
      this.slots.fill(null);
      for (const id of ids) this.add(id, t[id]);
    }
    toJSON() { return this.slots; }
    static from(arr) {
      const inv = new Inventory(arr.length);
      inv.slots = arr.map((s) => (s && D.items[s.id] ? { id: s.id, n: s.n } : null));
      return inv;
    }
  }
  FG.Inventory = Inventory;

  // --------------------------------------------------------------- helpers
  const BELT_KINDS = { belt: 1, underground: 1, splitter: 1 };
  FG.isBeltKind = (k) => !!BELT_KINDS[k];

  function makeLanes() { return [{ ids: [], pos: [] }, { ids: [], pos: [] }]; }
  FG.makeLanes = makeLanes;

  function tilesOf(ent) {
    const out = [];
    for (let y = 0; y < ent.h; y++) for (let x = 0; x < ent.w; x++) out.push([ent.x + x, ent.y + y]);
    return out;
  }
  FG.tilesOf = tilesOf;

  FG.entAt = function (g, x, y) {
    if (!g.world.inBounds(x, y)) return null;
    const id = g.world.ent[y * g.world.W + x];
    return id ? g.ents.get(id) : null;
  };

  FG.center = (e) => [e.x + e.w / 2, e.y + e.h / 2];

  // World-space fluid connections for an entity (depends on direction).
  function computeFluidConns(ent) {
    const pr = D.protos[ent.p];
    if (!pr.fb) return;
    ent.fbs.forEach((box, i) => {
      box.conns = pr.fb[i].conns.map(([lx, ly, d]) => {
        const [rx, ry] = FG.rotLocal(lx, ly, pr.w, pr.h, ent.dir);
        return { x: ent.x + rx, y: ent.y + ry, d: (d + ent.dir) & 3 };
      });
    });
  }
  FG.computeFluidConns = computeFluidConns;

  // Output tile for drills (in front of the drill).
  function computeDrillOut(ent) {
    const pr = D.protos[ent.p];
    const [rx, ry] = FG.rotLocal(pr.out[0], pr.out[1], pr.w, pr.h, ent.dir);
    ent.ox = ent.x + rx;
    ent.oy = ent.y + ry;
  }

  // Splitter halves: half 0 is on the left relative to the travel direction.
  function computeSplitterHalves(ent) {
    const pr = D.protos[ent.p];
    for (let k = 0; k < 2; k++) {
      const [rx, ry] = FG.rotLocal(k, 0, pr.w, pr.h, ent.dir);
      const h = ent.halves[k];
      h.x = ent.x + rx; h.y = ent.y + ry; h.dir = ent.dir;
    }
  }

  function initKind(g, ent) {
    const pr = D.protos[ent.p];
    ent.hp = pr.hp;
    if (pr.burner) { ent.fuel = null; ent.energy = 0; }
    if (pr.modules) ent.modules = new Array(pr.modules).fill(null);
    if (pr.fb) {
      ent.fbs = pr.fb.map(() => ({ amount: 0, fluid: null, net: null, conns: [] }));
      computeFluidConns(ent);
    }
    switch (pr.kind) {
      case 'chest': ent.inv = new Inventory(pr.slots); break;
      case 'belt': ent.lanes = makeLanes(); break;
      case 'underground': ent.lanes = makeLanes(); ent.ug = ent.ug || 'in'; break;
      case 'splitter':
        ent.halves = [{ lanes: makeLanes(), part: 0 }, { lanes: makeLanes(), part: 1 }];
        ent.toggle = [0, 0];
        ent.prio = -1; // output priority: -1 none, 0 left, 1 right
        ent.filter = null;
        computeSplitterHalves(ent);
        break;
      case 'inserter': ent.st = 0; ent.t = 0; ent.hand = null; ent.filter = null; break;
      case 'drill': ent.prog = 0; ent.outBuf = null; ent.bonus = 0; ent.cursor = 0; computeDrillOut(ent); break;
      case 'pumpjack': ent.prog = 0; break;
      case 'furnace': ent.inp = null; ent.out = null; ent.prog = 0; ent.crafting = false; ent.recipe = null; ent.bonus = 0; break;
      case 'crafter': ent.recipe = null; ent.inp = {}; ent.out = {}; ent.prog = 0; ent.crafting = false; ent.bonus = 0; break;
      case 'uplink': ent.recipe = 'uplink_stage'; ent.inp = {}; ent.out = {}; ent.prog = 0; ent.crafting = false; ent.stages = 0; ent.satellite = 0; ent.launch = 0; break;
      case 'lab': ent.inp = {}; ent.prog = 0; ent.working = false; break;
      case 'accumulator': ent.charge = 0; break;
      case 'turret': ent.ammo = null; ent.rounds = 0; ent.cd = 0; ent.angle = -Math.PI / 2; ent.target = null; break;
      case 'laser': ent.buf = 0; ent.cd = 0; ent.angle = -Math.PI / 2; ent.target = null; break;
    }
    ent.status = 'idle';
    ent.fx = { speed: 0, prod: 0, power: 0, pollution: 0 };
  }

  // Registry bookkeeping shared by placement and loading.
  FG.registerEntity = function (g, ent) {
    g.ents.set(ent.id, ent);
    const W = g.world.W;
    for (let y = 0; y < ent.h; y++)
      for (let x = 0; x < ent.w; x++) g.world.ent[(ent.y + y) * W + ent.x + x] = ent.id;
    const kind = D.protos[ent.p].kind;
    (g.byKind[kind] = g.byKind[kind] || []).push(ent);
    const c = g.world.chunkIndexAt(ent.x, ent.y);
    (g.chunkEnts[c] = g.chunkEnts[c] || new Set()).add(ent.id);
    g.markDirty(kind);
    g.world.chart((ent.x / FG.CHUNK) | 0, (ent.y / FG.CHUNK) | 0, 1);
  };

  function unregister(g, ent) {
    g.ents.delete(ent.id);
    const W = g.world.W;
    for (let y = 0; y < ent.h; y++)
      for (let x = 0; x < ent.w; x++) {
        const i = (ent.y + y) * W + ent.x + x;
        if (g.world.ent[i] === ent.id) g.world.ent[i] = 0;
      }
    const kind = D.protos[ent.p].kind;
    const list = g.byKind[kind];
    const k = list.indexOf(ent);
    if (k >= 0) list.splice(k, 1);
    const c = g.world.chunkIndexAt(ent.x, ent.y);
    if (g.chunkEnts[c]) g.chunkEnts[c].delete(ent.id);
    g.markDirty(kind);
    ent.dead = true;
  }

  // ----------------------------------------------------------- placement
  const REPLACE_GROUPS = { belt: 'belt', underground: 'underground', splitter: 'splitter', inserter: 'inserter', chest: 'chest', pole: 'pole' };
  function replaceGroup(pr) {
    if (REPLACE_GROUPS[pr.kind]) return REPLACE_GROUPS[pr.kind];
    if (pr.kind === 'crafter' && pr.cats.indexOf('crafting') >= 0) return 'assembler';
    if (pr.kind === 'furnace' && pr.burner) return 'burnerfurnace';
    return null;
  }

  // Returns { ok, reason, replace } for placing proto at (x, y) facing dir.
  FG.canPlace = function (g, protoId, x, y, dir, opts) {
    opts = opts || {};
    const pr = D.protos[protoId];
    const [w, h] = FG.footprint(pr, dir);
    const world = g.world;
    let replace = null;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!world.inBounds(xx, yy)) return { ok: false, reason: 'Out of bounds' };
        if (world.isWater(xx, yy)) return { ok: false, reason: 'Cannot build on water' };
        if (world.hasObstacle(xx, yy)) return { ok: false, reason: 'Blocked by a tree or boulder' };
        const other = FG.entAt(g, xx, yy);
        if (other) {
          const op = D.protos[other.p];
          const grp = replaceGroup(pr);
          if (!opts.noReplace && grp && grp === replaceGroup(op) && other.x === x && other.y === y && other.w === w && other.h === h && (other.p !== protoId || other.dir !== dir)) {
            replace = other;
          } else return { ok: false, reason: 'Space is occupied' };
        }
      }
    }
    if (g.enemies && g.enemies.nestBlocks(x, y, w, h)) return { ok: false, reason: 'Enemy nest in the way' };
    if (pr.solid && g.player && !opts.ignorePlayer) {
      const p = g.player;
      if (p.x + 0.3 > x && p.x - 0.3 < x + w && p.y + 0.3 > y && p.y - 0.3 < y + h) return { ok: false, reason: 'You are standing there' };
    }
    if (pr.kind === 'drill') {
      const area = FG.drillArea(pr, x, y, w, h);
      let found = false;
      for (let yy = area[1]; yy < area[3] && !found; yy++)
        for (let xx = area[0]; xx < area[2]; xx++) {
          if (!world.inBounds(xx, yy)) continue;
          const i = yy * world.W + xx;
          const r = world.res[i];
          if (r >= FG.RES.IRON && r <= FG.RES.STONE && world.amt[i] > 0) { found = true; break; }
        }
      if (!found) return { ok: false, reason: 'No minable ore under the drill' };
    }
    if (pr.kind === 'pumpjack') {
      const i = (y + 1) * world.W + x + 1;
      if (world.res[i] !== FG.RES.OIL) return { ok: false, reason: 'Must be centred on an oil well' };
    }
    if (pr.kind === 'offshore') {
      const bx = x - FG.DX[dir], by = y - FG.DY[dir];
      if (!world.isWater(bx, by) || !world.inBounds(bx, by)) return { ok: false, reason: 'Must face away from water, placed on the shore' };
    }
    return { ok: true, replace };
  };

  FG.drillArea = function (pr, x, y, w, h) {
    const pad = (pr.area - pr.w) / 2;
    return [x - pad, y - pad, x + w + pad, y + h + pad];
  };

  FG.placeEntity = function (g, protoId, x, y, dir, extra) {
    const pr = D.protos[protoId];
    dir = pr.rotatable ? dir & 3 : 0;
    const [w, h] = FG.footprint(pr, dir);
    const ent = { id: g.nextId++, p: protoId, x, y, dir, w, h };
    if (extra && extra.ug) ent.ug = extra.ug;
    initKind(g, ent);
    if (pr.kind === 'underground' && !(extra && extra.ug)) ent.ug = FG.belts.guessUndergroundType(g, ent);
    FG.registerEntity(g, ent);
    if (g.ghostAt) g.removeGhostsIn(x, y, w, h);
    FG.emit('placed', ent);
    return ent;
  };

  // Every item held by an entity (plus the entity itself) as [id, n] pairs.
  FG.entityContents = function (g, ent, includeSelf) {
    const out = {};
    const add = (id, n) => { if (id && n > 0) out[id] = (out[id] || 0) + n; };
    const pr = D.protos[ent.p];
    if (includeSelf !== false) add(pr.item, 1);
    if (ent.inv) for (const s of ent.inv.slots) if (s) add(s.id, s.n);
    if (ent.fuel) add(ent.fuel.id, ent.fuel.n);
    if (ent.hand) add(ent.hand.id, ent.hand.n);
    if (ent.outBuf) add(ent.outBuf.id, ent.outBuf.n);
    if (ent.modules) for (const m of ent.modules) add(m, 1);
    if (ent.ammo) add(ent.ammo.id, ent.ammo.n);
    if (pr.kind === 'furnace') {
      if (ent.inp) add(ent.inp.id, ent.inp.n);
      if (ent.out) add(ent.out.id, ent.out.n);
    } else if (ent.inp) {
      for (const k in ent.inp) add(k, ent.inp[k]);
      if (ent.out) for (const k in ent.out) add(k, ent.out[k]);
    }
    if (ent.satellite) add('satellite', ent.satellite);
    const lanesOf = (lanes) => { for (const l of lanes) for (const id of l.ids) add(id, 1); };
    if (ent.lanes) lanesOf(ent.lanes);
    if (ent.halves) for (const h of ent.halves) lanesOf(h.lanes);
    return Object.keys(out).map((k) => [k, out[k]]);
  };

  FG.removeEntity = function (g, ent) {
    unregister(g, ent);
    FG.emit('removed', ent);
  };

  // Fast replace: upgrade or re-orient an entity in place, keeping compatible state.
  FG.replaceEntity = function (g, old, protoId, dir) {
    const pr = D.protos[protoId];
    const op = D.protos[old.p];
    const leftovers = [];
    const keep = {};
    for (const k of ['inv', 'recipe', 'inp', 'out', 'fuel', 'energy', 'filter', 'modules', 'lanes', 'halves', 'toggle', 'prio', 'hand', 'st', 't', 'ug', 'prog', 'crafting', 'bonus']) {
      if (old[k] !== undefined) keep[k] = old[k];
    }
    unregister(g, old);
    const ent = FG.placeEntity(g, protoId, old.x, old.y, dir, { ug: keep.ug });
    if (pr.kind === op.kind) {
      for (const k in keep) if (ent[k] !== undefined) ent[k] = keep[k];
      if (ent.inv && pr.slots !== op.slots) for (const x of ent.inv.resize(pr.slots)) leftovers.push(x);
      if (ent.modules && old.modules && pr.modules !== op.modules) {
        const m = old.modules.slice(0, pr.modules);
        for (const x of old.modules.slice(pr.modules)) if (x) leftovers.push([x, 1]);
        while (m.length < pr.modules) m.push(null);
        ent.modules = m;
      }
      if (pr.kind === 'splitter') computeSplitterHalves(ent);
      if (ent.hp !== undefined) ent.hp = Math.min(pr.hp, ent.hp);
    } else {
      for (const x of FG.entityContents(g, old, false)) leftovers.push(x);
    }
    leftovers.push([op.item, 1]);
    FG.emit('removed', old);
    return { ent, leftovers };
  };

  FG.rotateEntity = function (g, ent, reverse) {
    const pr = D.protos[ent.p];
    if (!pr.rotatable) return false;
    if (pr.kind === 'underground') {
      ent.ug = ent.ug === 'in' ? 'out' : 'in';
      ent.dir = FG.opposite(ent.dir);
      ent.lanes = makeLanes();
      g.markDirty('underground');
      return true;
    }
    if (pr.w !== pr.h) return false;
    ent.dir = (ent.dir + (reverse ? 3 : 1)) & 3;
    if (ent.fbs) computeFluidConns(ent);
    if (pr.kind === 'drill') computeDrillOut(ent);
    if (pr.kind === 'inserter' && ent.st !== 0) { ent.st = ent.hand ? 1 : 3; }
    g.markDirty(pr.kind);
    return true;
  };

  // ------------------------------------------------------- item exchange
  // How many of `id` will `ent` accept? mode: 'inserter' (automation limits) or 'direct'.
  FG.acceptCount = function (g, ent, id, mode) {
    const pr = D.protos[ent.p];
    const it = D.items[id];
    const auto = mode === 'inserter';
    switch (pr.kind) {
      case 'chest': return ent.inv.space(id);
      case 'furnace': {
        let n = 0;
        const r = D.smeltingByInput[id];
        if (r && g.recipeEnabled(r.id) && (!ent.inp || ent.inp.id === id)) {
          const lim = auto ? Math.max(2, r.ing[id] * 2) : it.stack;
          n = lim - (ent.inp ? ent.inp.n : 0);
        }
        if (n <= 0 && pr.burner && it.fuel && (!ent.fuel || ent.fuel.id === id)) {
          n = (auto ? 5 : it.stack) - (ent.fuel ? ent.fuel.n : 0);
        }
        return Math.max(0, n);
      }
      case 'drill': case 'boiler': case 'inserter':
        if (pr.burner && it.fuel && (!ent.fuel || ent.fuel.id === id)) return Math.max(0, (auto ? 5 : it.stack) - (ent.fuel ? ent.fuel.n : 0));
        return 0;
      case 'crafter': case 'uplink': {
        if (pr.kind === 'uplink' && id === 'satellite') return ent.satellite ? 0 : 1;
        const r = ent.recipe && D.recipes[ent.recipe];
        if (!r || !r.ing[id]) return 0;
        const need = r.ing[id];
        const lim = auto ? Math.max(2, need * 2) : Math.max(it.stack, need * 2);
        return Math.max(0, lim - (ent.inp[id] || 0));
      }
      case 'lab':
        if (it.sub !== 'science') return 0;
        return Math.max(0, (auto ? 2 : it.stack) - (ent.inp[id] || 0));
      case 'turret':
        if (!it.ammo) return 0;
        if (ent.ammo && ent.ammo.id !== id) return 0;
        return Math.max(0, (auto ? 10 : it.stack) - (ent.ammo ? ent.ammo.n : 0));
    }
    return 0;
  };

  // Insert up to n items; returns how many were inserted.
  FG.insertItem = function (g, ent, id, n, mode) {
    const k = Math.min(n, FG.acceptCount(g, ent, id, mode));
    if (k <= 0) return 0;
    const pr = D.protos[ent.p];
    const it = D.items[id];
    switch (pr.kind) {
      case 'chest': return n - ent.inv.add(id, k) - (n - k);
      case 'furnace':
        if (D.smeltingByInput[id] && (!ent.inp || ent.inp.id === id) && !(pr.burner && it.fuel && ent.fuel && ent.fuel.id === id)) {
          if (ent.inp) ent.inp.n += k; else ent.inp = { id, n: k };
          return k;
        }
        if (ent.fuel) ent.fuel.n += k; else ent.fuel = { id, n: k };
        return k;
      case 'drill': case 'boiler': case 'inserter':
        if (ent.fuel) ent.fuel.n += k; else ent.fuel = { id, n: k };
        return k;
      case 'crafter': case 'uplink': case 'lab':
        if (pr.kind === 'uplink' && id === 'satellite') { ent.satellite = 1; return 1; }
        ent.inp[id] = (ent.inp[id] || 0) + k;
        return k;
      case 'turret':
        if (ent.ammo) ent.ammo.n += k; else ent.ammo = { id, n: k };
        return k;
    }
    return 0;
  };

  // Items an inserter (or the player) may take out of an entity: [[id, n], ...]
  FG.outputsOf = function (g, ent) {
    const pr = D.protos[ent.p];
    switch (pr.kind) {
      case 'chest': {
        const t = ent.inv.totals();
        return Object.keys(t).map((k) => [k, t[k]]);
      }
      case 'furnace': return ent.out ? [[ent.out.id, ent.out.n]] : [];
      case 'crafter': case 'uplink': return Object.keys(ent.out).filter((k) => ent.out[k] > 0).map((k) => [k, ent.out[k]]);
    }
    return [];
  };

  FG.takeOutput = function (g, ent, id, n) {
    const pr = D.protos[ent.p];
    switch (pr.kind) {
      case 'chest': return ent.inv.remove(id, n);
      case 'furnace': {
        if (!ent.out || ent.out.id !== id) return 0;
        const k = Math.min(n, ent.out.n);
        ent.out.n -= k;
        if (!ent.out.n) ent.out = null;
        return k;
      }
      case 'crafter': case 'uplink': {
        const k = Math.min(n, ent.out[id] || 0);
        ent.out[id] -= k;
        if (!ent.out[id]) delete ent.out[id];
        return k;
      }
    }
    return 0;
  };

  // --------------------------------------------------------------- energy
  // Burner: draw kJ from buffer, burning fuel when needed. Returns true on success.
  FG.burnerDraw = function (g, ent, kj) {
    if (ent.energy >= kj) { ent.energy -= kj; return true; }
    if (ent.fuel && ent.fuel.n > 0) {
      const id = ent.fuel.id;
      ent.energy += D.items[id].fuel;
      ent.fuel.n--;
      if (!ent.fuel.n) ent.fuel = null;
      g.stats.consume(id, 1);
      ent.energy -= kj;
      return true;
    }
    return false;
  };
  FG.hasFuel = (ent) => ent.energy > 0 || (ent.fuel && ent.fuel.n > 0);

  // Electric satisfaction for an entity (0..1).
  FG.sat = (ent) => (ent.net ? ent.net.sat : 0);
  FG.powerMult = (ent) => Math.max(0.2, 1 + ent.fx.power);
  FG.speedMult = (ent) => Math.max(0.2, 1 + ent.fx.speed);
})();
