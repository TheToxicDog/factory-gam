// Cogworks Frontier — save games. The world is regenerated from its seed and only
// the changes (mined tiles, buildings, research, enemies) are stored.
(function () {
  'use strict';
  const D = FG.data;
  const save = (FG.save = {});
  const SKIP = new Set(['net', 'tgt', 'outs', 'pair', 'curveIn', 'inDir', 'len', 'speed', 'owner', 'fmap', 'wires', 'target',
    'cap', 'fx', 'want', 'status', 'pairX', 'pairY', 'lastHit', 'dead', 'fbs', 'halves', 'inv', 'ox', 'oy', 'node', 'busy', 'spin']);

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  }
  function unb64(str) {
    const s = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function entToJSON(e) {
    const o = {};
    for (const k in e) if (!SKIP.has(k)) o[k] = e[k];
    if (e.inv) o.inv = e.inv.slots;
    if (e.fbs) o.fbs = e.fbs.map((b) => {
      const n = b.net;
      const amount = n && n.cap ? (n.amount * b.cap) / n.cap : b.amount || 0;
      return { amount: Math.round(amount * 100) / 100, fluid: n ? n.fluid : b.fluid };
    });
    if (e.halves) o.halves = e.halves.map((h) => ({ lanes: h.lanes, part: h.part }));
    return o;
  }

  const P_KEYS = ['id', 'name', 'color', 'away', 'x', 'y', 'hp', 'queue', 'craftProg', 'rounds', 'ammoDmg', 'vehicle', 'dead', 'cd', 'facing', 'walk', 'lastHit', 'repairPool', 'mining', 'trainHit', 'aim'];
  function playerToJSON(p) {
    const o = { inv: p.inv.slots, invSize: p.inv.size };
    for (const k of P_KEYS) if (p[k] !== undefined) o[k] = p[k];
    return o;
  }
  function playerFromJSON(g, o) {
    const pid = o.id || 1;
    const p = g.players.get(pid) || g.addPlayer(pid, o.name, o.color);
    for (const k of P_KEYS) if (o[k] !== undefined) p[k] = o[k];
    p.id = pid;
    p.inv = FG.Inventory.from(o.inv);
    if (o.invSize && p.inv.size < o.invSize) p.inv.resize(o.invSize);
    p.queue = (o.queue || []).filter((q) => D.recipes[q.rid]);
    p.craftProg = p.craftProg || 0; p.rounds = p.rounds || 0; p.ammoDmg = p.ammoDmg || 5;
    p.vehicle = p.vehicle || null;
    return p;
  }

  save.serialize = function (g) {
    const w = g.world;
    const tiles = [];
    for (const i of w.modified) tiles.push(i, w.res[i], w.amt[i]);
    const pol = [];
    for (let c = 0; c < w.pollution.length; c++) if (w.pollution[c] > 0.01) pol.push(c, Math.round(w.pollution[c] * 100) / 100);
    const en = g.enemies;
    const data = {
      v: FG.VERSION,
      opts: g.opts,
      tick: g.tick,
      nextId: g.nextId,
      nextGhost: g.nextGhost,
      world: { tiles, charted: b64(w.charted), pol },
      ents: Array.from(g.ents.values()).map(entToJSON),
      ghosts: Array.from(g.ghosts.values()),
      research: g.research,
      player: playerToJSON(g.localPlayer() || g.player),
      hotbar: g.hotbar || null,
      players: Array.from(g.players.values()).map(playerToJSON),
      inputs: Array.from(g.inputs.entries()),
      localPid: g.localPid, nextPid: g.nextPid, rs: g.rs,
      stats: { total: g.stats.total, sec: g.stats.sec, ten: g.stats.ten, min: g.stats.min, kills: g.stats.kills, pollution: g.stats.pollution, nestsKilled: g.stats.nestsKilled || 0 },
      enemies: {
        evo: en.evo, expandAt: en.expandAt, lastPoll: en.lastPoll,
        nests: en.nests.map((n) => [n.x, n.y, Math.round(n.hp), Math.round(n.budget * 10) / 10]),
        units: en.units.map((u) => [u.type, Math.round(u.x * 10) / 10, Math.round(u.y * 10) / 10, Math.round(u.hp), u.target || 0]),
      },
      trains: FG.trains.serialize(g),
      objectives: g.objectives.idx,
      launches: g.launches, won: g.won, wonAt: g.wonAt || 0,
      lostBuildings: g.lostBuildings || 0,
    };
    return JSON.stringify(data);
  };

  save.deserialize = function (json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const g = new FG.Game(Object.assign({}, data.opts));
    const w = g.world;
    const t = data.world.tiles;
    for (let k = 0; k < t.length; k += 3) {
      const i = t[k];
      w.res[i] = t[k + 1]; w.amt[i] = t[k + 2];
      w.modified.add(i);
    }
    w.charted.set(unb64(data.world.charted).subarray(0, w.charted.length));
    w.pollution.fill(0);
    for (let k = 0; k < data.world.pol.length; k += 2) w.pollution[data.world.pol[k]] = data.world.pol[k + 1];
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;

    g.tick = data.tick;
    for (const o of data.ents) {
      if (!D.protos[o.p]) continue;
      const e = Object.assign({}, o);
      const pr = D.protos[e.p];
      if (o.inv) e.inv = FG.Inventory.from(o.inv);
      if (pr.fb) {
        e.fbs = pr.fb.map((_, i) => ({ amount: (o.fbs && o.fbs[i] && o.fbs[i].amount) || 0, fluid: (o.fbs && o.fbs[i] && o.fbs[i].fluid) || null, net: null, conns: [] }));
      }
      if (pr.kind === 'splitter') {
        e.halves = [0, 1].map((k) => ({ lanes: (o.halves && o.halves[k] && o.halves[k].lanes) || FG.makeLanes(), part: k }));
      }
      FG.initRuntime(e);
      FG.registerEntity(g, e);
      if (e.recipe && pr.kind === 'crafter') FG.fluidsys.assignRecipe(e);
    }
    g.nextId = Math.max(data.nextId, g.nextId);
    for (const gh of data.ghosts || []) {
      if (!D.protos[gh.p]) continue;
      g.ghosts.set(gh.id, gh);
      for (let yy = gh.y; yy < gh.y + gh.h; yy++) for (let xx = gh.x; xx < gh.x + gh.w; xx++) g.ghostGrid[yy * w.W + xx] = gh.id;
    }
    g.nextGhost = data.nextGhost || g.nextGhost;

    // Research: replay effects (inventory size is restored from the save instead).
    const r = data.research;
    for (const tid in r.done) {
      if (!D.techs[tid]) continue;
      g.research.done[tid] = 1;
      for (const u of D.techs[tid].unlocks) g.unlocked[u] = 1;
      for (const ef of D.techs[tid].effects) if (ef.type !== 'inv') g.applyEffect(ef);
    }
    g.research.progress = r.progress || {};
    g.research.queue = (r.queue || []).filter((x) => D.techs[x]);
    g.research.current = r.current && D.techs[r.current] ? r.current : null;

    if (data.players && data.players.length) {
      g.players.clear(); g.inputs.clear();
      for (const o of data.players) playerFromJSON(g, o);
      for (const [pid, inp] of data.inputs || []) if (g.players.has(pid)) g.inputs.set(pid, Object.assign(g.newInput(), inp));
      g.nextPid = data.nextPid || g.nextPid;
      g.localPid = g.players.has(data.localPid) ? data.localPid : g.players.keys().next().value;
    } else {
      playerFromJSON(g, Object.assign({ id: 1 }, data.player));
    }
    g.player = g.localPlayer();
    g.input = g.inputs.get(g.localPid);
    g.hotbar = data.hotbar || (data.player && data.player.hotbar) || null;

    const s = data.stats;
    Object.assign(g.stats, { total: s.total, sec: s.sec || [], ten: s.ten || [], min: s.min || [], kills: s.kills || 0, pollution: s.pollution || 0, nestsKilled: s.nestsKilled || 0 });

    const en = g.enemies;
    for (const n of en.nests.slice()) en.removeNest(n);
    en.evo = data.enemies.evo;
    en.expandAt = data.enemies.expandAt;
    en.lastPoll = data.enemies.lastPoll || g.stats.pollution;
    for (const [x, y, hp, budget] of data.enemies.nests) {
      const n = en.addNest(x, y);
      if (n) { n.hp = hp; n.budget = budget; }
    }
    for (const [type, x, y, hp, target] of data.enemies.units) {
      if (!D.enemies[type]) continue;
      const u = en.spawnUnit(type, x, y, null, target || null);
      u.hp = hp;
    }
    FG.trains.deserialize(g, data.trains);
    for (const o of data.players || [Object.assign({ id: 1 }, data.player)]) { const p = g.players.get(o.id || 1); if (p) p.vehicle = o.vehicle || null; }
    g.objectives.idx = data.objectives || 0;
    g.launches = data.launches || 0;
    g.won = !!data.won;
    g.wonAt = data.wonAt || 0;
    g.lostBuildings = data.lostBuildings || 0;
    g.dirty = { belts: true, power: true, fluid: true, fx: true };
    if (data.rs) g.rs = data.rs >>> 0;
    return g;
  };

  // ------------------------------------------------------ browser storage
  const PREFIX = 'cogworks-save-';

  async function gzip(str) {
    if (typeof CompressionStream === 'undefined') return 'raw:' + str;
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
    return 'gz:' + b64(new Uint8Array(buf));
  }
  async function gunzip(s) {
    if (s.startsWith('raw:')) return s.slice(4);
    if (s.startsWith('{')) return s;
    const bytes = unb64(s.slice(3));
    const ds = new DecompressionStream('gzip');
    return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  }
  save.pack = gzip;
  save.unpack = gunzip;

  save.store = async function (g, slot) {
    const packed = await gzip(save.serialize(g));
    const meta = { slot, when: Date.now(), tick: g.tick, seed: g.opts.seed, size: packed.length };
    try {
      localStorage.setItem(PREFIX + slot, packed);
      localStorage.setItem(PREFIX + slot + '-meta', JSON.stringify(meta));
      return meta;
    } catch (e) {
      throw new Error('Browser storage is full or unavailable. Use "Copy save code" instead.');
    }
  };
  save.list = function () {
    const out = [];
    for (const slot of ['auto', '1', '2', '3']) {
      try {
        const m = localStorage.getItem(PREFIX + slot + '-meta');
        out.push(m ? JSON.parse(m) : { slot, empty: true });
      } catch (e) { out.push({ slot, empty: true }); }
    }
    return out;
  };
  save.loadSlot = async function (slot) {
    let s = null;
    try { s = localStorage.getItem(PREFIX + slot); } catch (e) { s = null; }
    if (!s) throw new Error('That save slot is empty.');
    return save.deserialize(await gunzip(s));
  };
  save.deleteSlot = function (slot) {
    try { localStorage.removeItem(PREFIX + slot); localStorage.removeItem(PREFIX + slot + '-meta'); } catch (e) { /* ignore */ }
  };
})();
