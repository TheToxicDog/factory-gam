// Cogworks Frontier — player commands. Everything a player does to the world goes through
// here as a small plain object ({ t: type, ...args }), so a multiplayer server can stamp it
// with a tick and every copy of the world applies it at the same moment. In single player
// commands run straight away. Handlers run with g.player set to the acting player.
(function () {
  'use strict';
  const D = FG.data;
  const BUILD_REACH = 12, RAIL_REACH = 20;
  const SLACK = 2.5; // the player may have moved a little between clicking and the command landing

  const H = {};
  const cmd = (FG.cmd = { H, BUILD_REACH, RAIL_REACH, MINE_REACH: 5, SERVER_ONLY: { join: 1, leave: 1 } });

  cmd.exec = function (g, pid, c) {
    const fn = c && typeof c.t === 'string' && Object.prototype.hasOwnProperty.call(H, c.t) ? H[c.t] : null;
    if (!fn) return undefined;
    if (cmd.SERVER_ONLY[c.t]) { try { return fn(g, null, c); } catch (e) { return undefined; } }
    if (!g.players.has(pid)) return undefined;
    return g.asPlayer(pid, (p) => {
      try { return fn(g, p, c); } catch (e) { if (typeof console !== 'undefined') console.warn('command ' + c.t + ' failed:', e && e.message); return undefined; }
    });
  };

  // ---------------------------------------------------------------- helpers
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const int = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.trunc(v) : d);
  const item = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(D.items, id) ? id : null);
  const near = (p, x, y, r) => FG.dist2(p.x, p.y, x, y) <= (r + SLACK) * (r + SLACK);
  const entOf = (g, id) => { const e = g.ents.get(id); return e && !e.dead ? e : null; };
  const nearEnt = (p, e) => near(p, e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH);
  const nameOf = (id) => (D.items[id] ? D.items[id].name : id);
  const entName = (e) => nameOf(D.protos[e.p].item);
  function settingsOf(s) {
    if (!s || typeof s !== 'object') return undefined;
    const o = {};
    if (typeof s.recipe === 'string' && D.recipes[s.recipe]) o.recipe = s.recipe;
    if (s.filter === null || item(s.filter)) o.filter = s.filter;
    if (s.lm === 'in' || s.lm === 'out') o.lm = s.lm;
    if (s.prio === 0 || s.prio === 1 || s.prio === -1) o.prio = s.prio;
    if (typeof s.rd === 'number') o.rd = int(s.rd, 0) & 7;
    if (typeof s.name === 'string') o.name = s.name.slice(0, 32);
    return o;
  }
  function takeToPlayer(g, p, id, n) {
    const k = Math.min(n, p.inv.space(id));
    if (k <= 0) { g.msg('Inventory full', 'warn'); return 0; }
    p.inv.add(id, k);
    FG.emit('inventory');
    return k;
  }

  // ------------------------------------------------------------ movement
  H.in = (g, p, c) => {
    const i = g.input;
    i.mx = Math.max(-1, Math.min(1, int(c.mx, 0)));
    i.my = Math.max(-1, Math.min(1, int(c.my, 0)));
    i.shoot = !!c.sh;
    i.aimX = num(c.ax, i.aimX);
    i.aimY = num(c.ay, i.aimY);
    i.repair = int(c.rep, 0);
    const m = c.mine;
    if (m && typeof m === 'object' && ['car', 'ent', 'rail', 'res'].indexOf(m.kind) >= 0) {
      i.mine = { kind: m.kind, id: int(m.id, 0), x: int(m.x, 0), y: int(m.y, 0), key: String(m.key || '').slice(0, 32), cx: num(m.cx, 0), cy: num(m.cy, 0) };
    } else i.mine = null;
  };

  // ------------------------------------------------------ crafting & research
  H.craft = (g, p, c) => {
    const r = D.recipes[c.r];
    if (!r) return 0;
    if (!g.canHandcraft(r.id)) { g.msg(r.cat === 'advanced' ? r.name + ' can only be made in an assembler' : 'Cannot hand-craft ' + r.name, 'warn'); return 0; }
    let k = c.all ? g.craftableCount(r.id) : Math.max(1, Math.min(1000, int(c.n, 1)));
    while (k > 0 && !g.queueCraft(r.id, k)) k = c.all ? 0 : k - 1;
    if (!k) g.msg('Missing ingredients for ' + r.name, 'warn');
    return k;
  };
  H.uncraft = (g, p, c) => { g.cancelCraft(int(c.i, -1)); };
  H.research = (g, p, c) => { if (D.techs[c.id] && !g.research.done[c.id]) g.queueResearch(c.id, !!c.front); };
  H.unresearch = (g, p, c) => { if (D.techs[c.id]) g.cancelResearch(c.id); };
  H.objSkip = (g) => { g.objectives.skip(); };

  // ---------------------------------------------------------------- inventory
  H.sort = (g, p) => { p.inv.sort(); FG.emit('inventory'); };
  // Move up to `want` of the n items split off slot i into slot j (see UI.putHeld).
  H.move = (g, p, c) => {
    const inv = p.inv, i = int(c.i, -1), j = int(c.j, -1);
    if (i < 0 || j < 0 || i >= inv.size || j >= inv.size || i === j) return 0;
    const src = inv.slots[i];
    if (!src || src.id !== c.id) return 0;
    const n = Math.max(1, Math.min(int(c.n, 1), src.n));
    const want = Math.max(1, int(c.want, n));
    const dst = inv.slots[j];
    let k = 0;
    if (!dst) {
      k = Math.min(want, n);
      inv.slots[j] = { id: src.id, n: k };
    } else if (dst.id === src.id) {
      k = Math.min(want, n, D.items[src.id].stack - dst.n);
      if (!k) { g.msg('That stack is full', 'warn'); return 0; }
      dst.n += k;
    } else if (n === src.n) {
      inv.slots[j] = src; inv.slots[i] = dst;
      FG.emit('inventory');
      return n;
    } else { g.msg('Put it in an empty slot or on the same item', 'warn'); return 0; }
    src.n -= k;
    if (src.n <= 0) inv.slots[i] = null;
    FG.emit('inventory');
    return k;
  };

  // --------------------------------------------------------- machine windows
  // Put n of an item from the inventory into a machine (modules go in module slots).
  function toEntity(g, p, ent, id, n) {
    const pr = D.protos[ent.p];
    const it = D.items[id];
    n = Math.min(n, p.inv.count(id));
    if (n <= 0) return 0;
    if (it.module && ent.modules) {
      if (it.module.prod && pr.kind === 'beacon') { g.msg('Productivity modules cannot go in beacons', 'warn'); return 0; }
      const i = ent.modules.indexOf(null);
      if (i < 0) { g.msg('Module slots are full', 'warn'); return 0; }
      ent.modules[i] = id;
      p.inv.remove(id, 1);
      g.markDirty('fx');
      FG.emit('inventory');
      return 1;
    }
    let k = 0;
    if (pr.kind === 'chest') k = n - ent.inv.add(id, n);
    else k = FG.insertItem(g, ent, id, n, 'direct');
    if (k > 0) { p.inv.remove(id, k); FG.emit('inventory'); }
    else g.msg(entName(ent) + ' does not accept ' + it.name, 'warn');
    return k;
  }
  H.toEnt = (g, p, c) => {
    const ent = entOf(g, c.e), id = item(c.id);
    if (!ent || !id || !nearEnt(p, ent)) return 0;
    return toEntity(g, p, ent, id, Math.max(1, int(c.n, 1)));
  };
  // Take from one of a machine's slots into the inventory.
  H.take = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (!ent || !nearEnt(p, ent)) return 0;
    const pr = D.protos[ent.p];
    const stack = (key) => {
      const s = ent[key];
      if (!s || !s.n) return 0;
      const k = takeToPlayer(g, p, s.id, s.n);
      s.n -= k;
      if (!s.n) ent[key] = null;
      return k;
    };
    switch (c.s) {
      case 'fuel': return stack('fuel');
      case 'ammo': return pr.kind === 'turret' ? stack('ammo') : 0;
      case 'inp1': return pr.kind === 'furnace' ? stack('inp') : 0;
      case 'out1': return pr.kind === 'furnace' ? stack('out') : 0;
      case 'inp': case 'out': {
        const map = ent[c.s], id = item(c.id);
        if (!map || typeof map !== 'object' || !id || !map[id]) return 0;
        const k = takeToPlayer(g, p, id, map[id]);
        map[id] -= k;
        if (!map[id]) delete map[id];
        return k;
      }
      case 'mod': {
        const i = int(c.i, -1);
        if (!ent.modules || !ent.modules[i]) return 0;
        if (!takeToPlayer(g, p, ent.modules[i], 1)) return 0;
        ent.modules[i] = null;
        g.markDirty('fx');
        return 1;
      }
      case 'sat':
        if (ent.satellite && takeToPlayer(g, p, 'satellite', 1)) { ent.satellite = 0; return 1; }
        return 0;
      case 'chest': {
        if (!ent.inv) return 0;
        const i = int(c.i, -1), s = ent.inv.slots[i];
        if (!s) return 0;
        if (c.all) { const k = takeToPlayer(g, p, s.id, ent.inv.count(s.id)); ent.inv.remove(s.id, k); return k; }
        const k = takeToPlayer(g, p, s.id, s.n);
        s.n -= k;
        if (!s.n) ent.inv.slots[i] = null;
        return k;
      }
    }
    return 0;
  };
  H.recipe = (g, p, c) => {
    const ent = entOf(g, c.e), r = D.recipes[c.r];
    if (!ent || !r) return;
    const pr = D.protos[ent.p];
    if (pr.kind !== 'crafter' || pr.cats.indexOf(r.cat) < 0 || !g.recipeEnabled(r.id) || (!pr.fb && Object.keys(r.fin).length)) return;
    g.giveOrDrop(FG.machines.setRecipe(g, ent, r.id));
  };
  H.set = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (!ent) return;
    const pr = D.protos[ent.p];
    if (c.k === 'prio' && pr.kind === 'splitter' && (c.v === 0 || c.v === 1 || c.v === -1)) ent.prio = c.v;
    if (c.k === 'filter' && (pr.filter || pr.kind === 'splitter' || pr.kind === 'loader') && (c.v === null || item(c.v))) ent.filter = c.v;
  };
  H.lm = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (ent && D.protos[ent.p].kind === 'loader' && (c.v === 'in' || c.v === 'out') && ent.lm !== c.v) FG.rotateEntity(g, ent);
  };
  H.rot = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (!ent) return;
    if (!nearEnt(p, ent)) { g.msg('Out of reach', 'warn'); return; }
    if (!FG.rotateEntity(g, ent, !!c.rev) && D.protos[ent.p].rotatable) g.msg('Pick it up and place it again to turn it', 'warn');
  };
  H.launch = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (!ent) return false;
    const pr = D.protos[ent.p];
    if (pr.kind === 'uplink' && ent.stages >= pr.stages && ent.satellite && !ent.launch) { ent.launch = 1; return true; }
    return false;
  };
  H.rename = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (!ent || D.protos[ent.p].kind !== 'trainstop') return;
    const name = String(c.name || '').trim().slice(0, 32);
    if (!name || name === ent.name) return;
    const old = ent.name;
    ent.name = name;
    // Keep schedules pointing here if this was the only stop with the old name.
    if (!FG.trains.stopsNamed(g, old).length) for (const tr of g.rail.trains) for (const e of tr.schedule) if (e.station === old) e.station = name;
    g.msg('Renamed to ' + name);
  };
  H.paste = (g, p, c) => {
    const ent = entOf(g, c.e), s = settingsOf(c.s);
    if (!ent || !s || !nearEnt(p, ent)) return;
    const pr = D.protos[ent.p];
    if (s.recipe && pr.kind === 'crafter' && pr.cats.indexOf(D.recipes[s.recipe].cat) < 0) { g.msg('This machine cannot make that', 'warn'); return; }
    g.applySettings(ent, s);
    g.msg('Settings pasted');
  };

  // --------------------------------------------------------------------- trains
  const trainOf = (g, id) => { const tr = FG.trains.trainById(g, id); return tr && !tr.dead ? tr : null; };
  H.trMode = (g, p, c) => {
    const tr = trainOf(g, c.tr);
    if (!tr || (c.v !== 'auto' && c.v !== 'manual')) return;
    tr.mode = c.v;
    if (c.v === 'auto') tr.state = 'plan';
  };
  H.trRide = (g, p, c) => {
    const tr = trainOf(g, c.tr);
    if (!tr) return;
    if (p.vehicle === tr.id) { FG.trains.exit(g); return; }
    const pose = FG.trains.carPose(tr, 0);
    if (FG.dist2(pose.x, pose.y, p.x, p.y) > 144 + 40) { g.msg('Walk closer to board', 'warn'); return; }
    p.vehicle = tr.id;
    if (!tr.schedule.length) tr.mode = 'manual';
  };
  H.flip = (g, p, c) => {
    const hit = FG.trains.findCar(g, c.car);
    if (!hit) return false;
    if (hit.car.type !== 'loco') { g.msg('Only locomotives have a facing', 'warn'); return false; }
    if (!FG.trains.flipCar(g, hit.train, hit.index)) { g.msg('Stop the train before turning a locomotive', 'warn'); return false; }
    return true;
  };
  H.trTake = (g, p, c) => {
    const hit = FG.trains.findCar(g, c.car), id = item(c.id);
    if (!hit || !id) return 0;
    const k = Math.min(int(c.n, 0), hit.car.inv.count(id), p.inv.space(id));
    if (k <= 0) { g.msg('Inventory full', 'warn'); return 0; }
    hit.car.inv.remove(id, k);
    p.inv.add(id, k);
    FG.emit('inventory');
    return k;
  };
  H.trLoad = (g, p, c) => {
    const tr = trainOf(g, c.tr), id = item(c.id);
    if (!tr || !id) return 0;
    let left = Math.min(int(c.n, 0), p.inv.count(id)), moved = 0;
    const order = D.items[id].fuel ? tr.cars.filter((x) => x.type === 'loco').concat(tr.cars.filter((x) => x.type === 'wagon')) : tr.cars.filter((x) => x.type === 'wagon');
    for (const car of order) {
      if (left <= 0) break;
      const k = FG.trains.carInsert(car, id, left);
      if (k > 0) { p.inv.remove(id, k); left -= k; moved += k; }
    }
    if (!moved) g.msg('No room for that in this train', 'warn');
    FG.emit('inventory');
    return moved;
  };
  H.sched = (g, p, c) => {
    const tr = trainOf(g, c.tr);
    if (!tr) return;
    const i = int(c.i, -1), e = tr.schedule[i];
    switch (c.op) {
      case 'add': {
        const n = FG.trains.stopNames(g);
        if (!n.length) { g.msg('Place a train stop first', 'warn'); return; }
        if (tr.schedule.length >= 40) return;
        const prev = tr.schedule.length ? tr.schedule[tr.schedule.length - 1].station : null;
        tr.schedule.push({ station: n.find((x) => x !== prev) || n[0], cond: tr.schedule.length ? 'empty' : 'full', v: 10 });
        return;
      }
      case 'del':
        if (!e) return;
        tr.schedule.splice(i, 1);
        if (tr.cur >= tr.schedule.length) tr.cur = 0;
        return;
      case 'station':
        if (!e || typeof c.v !== 'string') return;
        e.station = c.v.slice(0, 32);
        if (tr.cur === i && tr.state !== 'station') tr.state = 'plan';
        return;
      case 'cond':
        if (!e || ['full', 'empty', 'time', 'inactive'].indexOf(c.v) < 0) return;
        e.cond = c.v;
        if (!e.v) e.v = 10;
        return;
      case 'v':
        if (e) e.v = FG.clamp(int(c.v, 10) || 10, 1, 600);
        return;
      case 'go':
        if (!e) return;
        tr.cur = i;
        if (tr.mode === 'auto') tr.state = 'plan';
    }
  };
  H.board = (g, p) => {
    if (!FG.trains.board(g)) { g.msg('Stand next to a train to get in', 'warn'); return false; }
    g.msg(p.vehicle ? 'Aboard · W go · S brake (hold to reverse) · A/D choose turns · Enter to leave' : 'You left the train');
    return true;
  };

  // ------------------------------------------------------------------- combat
  H.grenade = (g, p, c) => {
    if (!g.enemies.throwGrenade(num(c.x, p.x), num(c.y, p.y))) { g.msg(p.inv.count('grenade') ? 'Not ready yet' : 'You have no grenades', 'warn'); return false; }
    return true;
  };

  // ----------------------------------------------------------------- building
  // Build the held item at (x, y), or plan a ghost for drones. With `turn`, first turn the
  // belt the drag just placed at turn[0], turn[1] to face turn[2].
  H.build = (g, p, c) => {
    const itemId = item(c.item);
    if (!itemId || !D.items[itemId].place) return null;
    const pr = D.protos[D.items[itemId].place];
    const x = int(c.x, 0), y = int(c.y, 0), dir = int(c.dir, 0) & 3;
    if (!g.world.inBounds(x, y)) return null;
    const settings = settingsOf(c.s);
    if (Array.isArray(c.turn)) {
      const prev = FG.entAt(g, int(c.turn[0], -1), int(c.turn[1], -1)), d = int(c.turn[2], 0) & 3;
      if (prev && D.protos[prev.p].kind === 'belt' && prev.dir !== d && near(p, prev.x + 0.5, prev.y + 0.5, BUILD_REACH)) {
        const res = FG.replaceEntity(g, prev, prev.p, d);
        g.giveOrDrop(res.leftovers.filter((l) => l[0] !== D.protos[prev.p].item));
      }
    }
    const [fw, fh] = FG.footprint(pr, pr.rotatable ? dir : 0);
    const ghost = !!c.ghost;
    if (!ghost && !near(p, x + fw / 2, y + fh / 2, BUILD_REACH)) { g.msg('Out of reach', 'warn'); return null; }
    if (ghost || p.inv.count(itemId) < 1) {
      if (!g.bonus.drones) { if (!ghost) g.msg('You have no ' + D.items[itemId].name, 'warn'); return null; }
      const chk = FG.canPlace(g, pr.id, x, y, dir, { noReplace: true, ignorePlayer: true });
      if (!chk.ok) return null;
      const gh = g.addGhost(pr.id, x, y, dir, settings);
      return gh ? { ghost: gh.id } : null;
    }
    const chk = FG.canPlace(g, pr.id, x, y, dir);
    if (!chk.ok) {
      if (chk.reason && chk.reason !== 'Space is occupied') g.msg(chk.reason, 'warn');
      return null;
    }
    const ent = g.build(itemId, x, y, dir, settings);
    return ent ? { id: ent.id, dir: ent.dir, ug: ent.ug } : null;
  };
  // Build a ghost from the inventory by clicking it.
  H.ghostBuild = (g, p, c) => {
    const gh = g.ghosts.get(c.gh);
    if (!gh) return false;
    const it = D.protos[gh.p].item;
    if (!p.inv.count(it)) { g.msg('You have no ' + D.items[it].name, 'warn'); return false; }
    if (!near(p, gh.x + gh.w / 2, gh.y + gh.h / 2, BUILD_REACH)) { g.msg('Out of reach', 'warn'); return false; }
    g.removeGhost(gh);
    if (!g.build(it, gh.x, gh.y, gh.dir, gh.settings)) { g.addGhost(gh.p, gh.x, gh.y, gh.dir, gh.settings); return false; }
    return true;
  };
  H.ghostDel = (g, p, c) => { const gh = g.ghosts.get(c.gh); if (gh) g.removeGhost(gh); };
  H.railGhostDel = (g, p, c) => { if (typeof c.key === 'string') g.rail.ghosts.delete(c.key); };

  H.car = (g, p, c) => {
    const itemId = item(c.item);
    if (!itemId || !D.items[itemId].car) return false;
    if (!p.inv.count(itemId)) { g.msg('You have no ' + D.items[itemId].name, 'warn'); return false; }
    const x = num(c.x, 0), y = num(c.y, 0);
    if (!near(p, x, y, BUILD_REACH)) { g.msg('Out of reach', 'warn'); return false; }
    const r = FG.trains.placeCar(g, D.items[itemId].car, x, y, int(c.dir, 0) & 3);
    if (!r.ok) { g.msg(r.reason, 'warn'); return false; }
    p.inv.remove(itemId, 1);
    FG.emit('sound', 'place');
    FG.emit('inventory');
    return true;
  };

  // Z: put one of an item into a machine, chest, belt tile (lane) or rail car.
  H.drop1 = (g, p, c) => {
    const id = item(c.id);
    if (!id || !p.inv.count(id)) return 0;
    let put, cx, cy, what, onBelt = false;
    if (c.car) {
      const hit = FG.trains.findCar(g, c.car);
      if (!hit) return 0;
      const pose = FG.trains.carPose(hit.train, hit.index);
      cx = pose.x; cy = pose.y;
      what = D.items[FG.trains.itemFor(hit.car)].name;
      put = () => FG.trains.carInsert(hit.car, id, 1);
    } else {
      const e = entOf(g, c.e);
      if (!e) return 0;
      const pr = D.protos[e.p];
      cx = e.x + e.w / 2; cy = e.y + e.h / 2;
      what = D.items[pr.item].name;
      const node = FG.isBeltKind(pr.kind) && Array.isArray(c.tile) ? FG.belts.nodeAt(g, int(c.tile[0], -1), int(c.tile[1], -1)) : null;
      if (node) {
        onBelt = true;
        cx = int(c.tile[0], 0) + 0.5; cy = int(c.tile[1], 0) + 0.5;
        const lane = c.lane ? 1 : 0;
        put = () => (FG.belts.laneInsert(node.lanes[lane], id, Math.min(0.5, node.len * 0.5), node.len) ? 1 : 0);
      } else if (pr.kind === 'chest') put = () => 1 - e.inv.add(id, 1);
      else put = () => FG.insertItem(g, e, id, 1, 'direct');
    }
    if (!near(p, cx, cy, BUILD_REACH)) { g.msg('Out of reach', 'warn'); return 0; }
    if (put() > 0) {
      p.inv.remove(id, 1);
      g.effects.push({ type: 'drop', id, x: cx, y: cy, t: 0, life: 30 });
      FG.emit('sound', 'pickup');
      FG.emit('inventory');
      return 1;
    }
    g.msg(onBelt ? 'No room on the belt there' : what + ' can\'t take ' + nameOf(id).toLowerCase(), 'warn');
    return 0;
  };
  H.insCar = (g, p, c) => {
    const hit = FG.trains.findCar(g, c.car), id = item(c.id);
    if (!hit || !id) return 0;
    const pose = FG.trains.carPose(hit.train, hit.index);
    if (!near(p, pose.x, pose.y, BUILD_REACH)) { g.msg('Out of reach', 'warn'); return 0; }
    const have = p.inv.count(id);
    if (!have) return 0;
    const n = c.all ? have : Math.min(have, D.items[id].stack);
    const k = FG.trains.carInsert(hit.car, id, n);
    if (k > 0) { p.inv.remove(id, k); g.msg('Inserted ' + k + ' ' + nameOf(id).toLowerCase(), 'info'); FG.emit('inventory'); }
    else g.msg(hit.car.type === 'loco' ? 'Locomotives only take fuel' : 'That wagon is full', 'warn');
    return k;
  };
  H.insEnt = (g, p, c) => {
    const ent = entOf(g, c.e), id = item(c.id);
    if (!ent || !id) return 0;
    if (!nearEnt(p, ent)) { g.msg('Out of reach', 'warn'); return 0; }
    const have = p.inv.count(id);
    if (!have) { g.msg('You have no ' + nameOf(id), 'warn'); return 0; }
    // Fuel goes in a handful at a time so one click doesn't empty your pockets.
    const burner = D.protos[ent.p].burner && D.items[id].fuel;
    const n = c.all ? have : burner ? Math.min(have, 5) : Math.min(have, D.items[id].stack);
    const moved = toEntity(g, p, ent, id, n);
    if (moved > 0) g.msg('Inserted ' + moved + ' ' + nameOf(id).toLowerCase(), 'info');
    return moved;
  };
  // Ctrl+click: take what a machine has made. If it has made nothing, take its fuel instead,
  // so you can get coal back from any burner (or pull out wood to make room for coal).
  H.qtake = (g, p, c) => {
    const ent = entOf(g, c.e);
    if (!ent) return;
    if (!nearEnt(p, ent)) { g.msg('Out of reach', 'warn'); return; }
    const inv = p.inv, got = [];
    let full = false;
    const take = (id, n, remove) => {
      const k = Math.min(n, inv.space(id));
      if (k < n) full = true;
      if (k <= 0) return;
      remove(k);
      inv.add(id, k);
      got.push([id, k]);
    };
    for (const [id, n] of FG.outputsOf(g, ent)) take(id, n, (k) => FG.takeOutput(g, ent, id, k));
    const tookProducts = got.length > 0;
    if (!tookProducts && ent.fuel && ent.fuel.n > 0) {
      const f = ent.fuel;
      take(f.id, f.n, (k) => { f.n -= k; if (!f.n) ent.fuel = null; });
    }
    if (!got.length) { g.msg(full ? 'Inventory full' : 'Nothing to take', 'warn'); return; }
    const what = got.map(([id, k]) => k + ' ' + nameOf(id).toLowerCase()).join(', ');
    const more = tookProducts && ent.fuel && ent.fuel.n > 0 ? ' · Ctrl+click again for the ' + nameOf(ent.fuel.id).toLowerCase() : '';
    g.msg('Took ' + what + more, 'info');
    g.effects.push({ type: 'pick', id: got[0][0], x: ent.x + ent.w / 2, y: ent.y + ent.h / 2, t: 0, life: 40 });
    FG.emit('sound', 'pickup');
    FG.emit('inventory');
  };
  H.qtakeCar = (g, p, c) => {
    const hit = FG.trains.findCar(g, c.car);
    if (!hit) return;
    const pose = FG.trains.carPose(hit.train, hit.index);
    if (!near(p, pose.x, pose.y, BUILD_REACH)) { g.msg('Out of reach', 'warn'); return; }
    const inv = p.inv, car = hit.car;
    let took = 0;
    for (const s of car.inv.slots) {
      if (!s) continue;
      const k = Math.min(s.n, inv.space(s.id));
      if (k <= 0) continue;
      car.inv.remove(s.id, k);
      inv.add(s.id, k);
      took += k;
    }
    if (took) { g.msg('Took ' + took + ' items from the ' + (car.type === 'loco' ? 'locomotive' : 'wagon'), 'info'); FG.emit('sound', 'pickup'); FG.emit('inventory'); }
    else g.msg('Nothing to take', 'warn');
  };

  // ------------------------------------------------------------------ rails
  const railPiece = (a) => Array.isArray(a) && a.length === 4 && typeof a[3] === 'string' && FG.rails.itemCost(a[3]) ? [int(a[0], 0), int(a[1], 0), int(a[2], 0) & 7, a[3]] : null;
  // Click planned track: build it and the planned track joined to it, as far as you reach.
  H.railRun = (g, p, c) => {
    const pc = g.rail.ghosts.get(c.key);
    if (!pc) return 0;
    const cost = FG.rails.itemCost(pc.t);
    if (p.inv.count('rail') < cost) { g.msg('You need ' + cost + ' rail' + (cost > 1 ? 's' : '') + ' for this piece', 'warn'); return 0; }
    const n = g.buildGhostRun(pc, p.x, p.y, RAIL_REACH);
    if (n) { FG.emit('sound', 'place'); if (n > 1) g.msg('Laid ' + n + ' planned pieces', 'info'); }
    else g.msg('Something is in the way', 'warn');
    return n;
  };
  // Lay a planned run of track: pieces in reach are built from rails in the inventory; the
  // rest are left planned.
  H.rails = (g, p, c) => {
    if (!Array.isArray(c.pieces) || c.pieces.length > 400) return;
    const RL = FG.rails;
    let built = 0, ghosts = 0, used = 0, stop = null;
    for (const raw of c.pieces) {
      const a = railPiece(raw);
      if (!a) continue;
      const pc = RL.makePiece(a[0], a[1], a[2], a[3]);
      if (g.rail.byKey.has(pc.key)) continue;
      const cost = RL.itemCost(pc.t);
      const reach = near(p, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, RAIL_REACH);
      if (!c.ghostOnly && reach && p.inv.count('rail') >= cost) {
        if (g.buildRail(pc.ax, pc.ay, pc.ah, pc.t)) { built++; used += cost; continue; }
        stop = 'Something is in the way'; break;
      }
      if (RL.addGhost(g, pc.ax, pc.ay, pc.ah, pc.t)) ghosts++;
    }
    if (built) FG.emit('sound', 'place');
    const bits = [];
    if (built) bits.push('laid ' + built + ' piece' + (built > 1 ? 's' : '') + ' (' + used + ' rails)');
    if (ghosts) bits.push(ghosts + ' planned' + (g.bonus.drones ? ' for drones' : ': walk over and click them to build'));
    if (bits.length > 0 && (built + ghosts > 1 || stop)) g.msg(bits.join(' · ').replace(/^./, (ch) => ch.toUpperCase()), 'info');
    if (stop) g.msg(stop, 'warn');
  };

  // ------------------------------------------------------------ area & blueprints
  // Pick up (or mark for drones) everything in an area, as X-drag and Ctrl+X do.
  H.area = (g, p, c) => {
    const x0 = int(c.x0, 0), y0 = int(c.y0, 0), x1 = int(c.x1, 0), y1 = int(c.y1, 0);
    if (x1 < x0 || y1 < y0 || (x1 - x0) * (y1 - y0) > 200 * 200) return;
    const inside = [], seen = new Set();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const e = FG.entAt(g, x, y);
      if (e && !seen.has(e.id) && e.x >= x0 && e.y >= y0 && e.x + e.w - 1 <= x1 && e.y + e.h - 1 <= y1) { seen.add(e.id); inside.push(e); }
      const gh = g.ghostAt(x, y);
      if (gh) g.removeGhost(gh);
    }
    const RL = FG.rails;
    const inArea = (x, y) => x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1;
    let picked = 0, marked = 0, left = 0;
    // Rail cars first, so the track under them can be picked up too.
    for (const tr of g.rail.trains.slice()) {
      for (let i = tr.cars.length - 1; i >= 0; i--) {
        if (tr.dead) break;
        const ps = FG.trains.carPose(tr, i);
        if (ps.x < x0 || ps.y < y0 || ps.x > x1 + 1 || ps.y > y1 + 1) continue;
        if (near(p, ps.x, ps.y, BUILD_REACH) && g.pickUpCar({ train: tr, car: tr.cars[i], index: i })) picked++;
        else left++;
      }
    }
    for (const e of inside) {
      if (nearEnt(p, e) && g.pickUpEntity(e)) picked++;
      else if (g.bonus.drones) { e.decon = true; marked++; }
      else left++;
    }
    const all = Array.from(g.rail.pieces.values());
    const railsOut = c.mode === 'cut' ? all.filter((pc) => inArea(pc.ax, pc.ay) && inArea(pc.bx, pc.by)) : all.filter((pc) => inArea((pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2));
    let busy = 0;
    for (const pc of railsOut) {
      if (FG.trains.pieceUnderTrain(g, pc)) { busy++; continue; }
      if (near(p, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, RAIL_REACH) && g.pickUpRail(pc)) picked++;
      else if (g.bonus.drones) { pc.decon = true; marked++; }
      else left++;
    }
    RL.removeGhostsIn(g, x0, y0, x1 + 1, y1 + 1);
    const bits = [];
    if (picked) bits.push('picked up ' + picked);
    if (marked) bits.push('drones will remove ' + marked);
    if (left) bits.push(left + ' out of reach');
    if (busy) bits.push(busy + ' track under a train');
    if (bits.length) g.msg(bits.join(' · ').replace(/^./, (ch) => ch.toUpperCase()), left ? 'warn' : 'info');
  };
  H.bp = (g, p, c) => {
    const bp = c.bp;
    if (!bp || !Array.isArray(bp.ents) || bp.ents.length > 3000 || (bp.rails && (!Array.isArray(bp.rails) || bp.rails.length > 1000))) return;
    const ax = int(c.ax, 0), ay = int(c.ay, 0);
    let built = 0, ghosts = 0, skipped = 0;
    const RL = FG.rails;
    for (const raw of bp.rails || []) {
      const a = railPiece(raw);
      if (!a) continue;
      const x = ax + a[0], y = ay + a[1];
      if (g.rail.byKey.has(RL.pieceKeyOf(x, y, a[2], a[3]))) continue;
      const pc = RL.makePiece(x, y, a[2], a[3]);
      if (!RL.pieceClear(g, pc)) { skipped++; continue; }
      if (p.inv.count('rail') >= RL.itemCost(a[3]) && near(p, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, RAIL_REACH)) {
        if (g.buildRail(x, y, a[2], a[3])) built++; else skipped++;
      } else if (RL.addGhost(g, x, y, a[2], a[3])) ghosts++;
    }
    for (const b of bp.ents) {
      if (!b || !D.protos[b.p] || !D.protos[b.p].item) continue;
      const pr = D.protos[b.p];
      const x = ax + int(b.dx, 0), y = ay + int(b.dy, 0), dir = int(b.dir, 0) & 3;
      if (!g.world.inBounds(x, y)) { skipped++; continue; }
      const chk = FG.canPlace(g, b.p, x, y, dir, { noReplace: true });
      if (!chk.ok) { skipped++; continue; }
      const [fw, fh] = FG.footprint(pr, dir);
      const s = settingsOf(b.settings);
      if (p.inv.count(pr.item) > 0 && near(p, x + fw / 2, y + fh / 2, BUILD_REACH)) {
        if (g.build(pr.item, x, y, dir, s)) built++;
      } else if (g.addGhost(b.p, x, y, dir, s)) ghosts++;
    }
    const bits = [];
    if (built) bits.push('built ' + built);
    if (ghosts) bits.push(ghosts + ' ghosts' + (g.bonus.drones ? '' : ' (bring the items and click them)'));
    if (skipped) bits.push(skipped + ' blocked');
    if (bits.length) g.msg(bits.join(' · ').replace(/^./, (ch) => ch.toUpperCase()));
  };

  // ------------------------------------------------ players (issued by the server)
  H.join = (g, p, c) => {
    const pid = int(c.pid, 0);
    if (pid <= 0) return;
    let q = g.players.get(pid);
    const fresh = !q;
    if (!q) q = g.addPlayer(pid, c.name, c.color);
    q.away = false;
    if (typeof c.name === 'string') q.name = c.name.slice(0, 20);
    if (typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)) q.color = c.color;
    if (fresh || q.dead) { q.x = g.world.spawnX + 0.5 + (pid % 4) * 0.6; q.y = g.world.spawnY + 0.5; }
    g.inputs.set(pid, g.newInput());
    if (g.nextPid <= pid) g.nextPid = pid + 1;
    g.ctxWrap(() => g.msg(q.name + ' joined', 'good'), pid);
  };
  H.leave = (g, p, c) => {
    const q = g.players.get(int(c.pid, 0));
    if (!q || q.away) return;
    if (q.vehicle) g.asPlayer(q.id, () => FG.trains.exit(g));
    q.away = true;
    q.mining = null;
    g.inputs.set(q.id, g.newInput());
    g.ctxWrap(() => g.msg(q.name + ' left', 'info'), q.id);
  };

  cmd.types = Object.keys(H);
})();
