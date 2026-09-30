// Cogworks Frontier — player commands. Everything a player does to the world (build, mine,
// move items, set a recipe, drive a train...) is a small JSON command run by FG.runCmd. Alone,
// a command runs at once; in multiplayer the host gives each one a tick and every computer
// runs it at that tick, so all copies of the world stay the same (see net.js).
(function () {
  'use strict';
  const D = FG.data;
  const C = (FG.cmds = {});
  const REACH = (FG.REACH = { build: 12, mine: 5, rail: 20 });
  const near = (p, x, y, r) => FG.dist2(p.x, p.y, x, y) <= r * r;
  const lc = (id) => D.items[id].name.toLowerCase();
  const int = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 0);

  // Run command cmd ({t: type, a: args}) as the player with id pid.
  FG.runCmd = function (g, pid, cmd) {
    const p = g.playerById(pid), h = cmd && C[cmd.t];
    if (!p || !h) return;
    g.withPlayer(p, () => {
      try { h(g, p, cmd.a || {}); } catch (e) { console.warn('command failed', cmd.t, e); }
    });
  };

  function carHit(g, carId) { return FG.trains.findCar(g, carId); }
  function inventoryChanged() { FG.emit('inventory'); }

  // ------------------------------------------------------------- movement
  C.input = (g, p, a) => {
    const i = p.input;
    if ('mx' in a) i.mx = Math.sign(int(a.mx));
    if ('my' in a) i.my = Math.sign(int(a.my));
    if ('shoot' in a) i.shoot = !!a.shoot;
    if ('aimX' in a) { i.aimX = +a.aimX || 0; i.aimY = +a.aimY || 0; }
    if ('mine' in a) i.mine = a.mine && typeof a.mine === 'object' ? a.mine : null;
    if ('repair' in a) i.repair = int(a.repair);
  };

  // ------------------------------------------------------------- building
  // Place an item from the inventory, or plan a ghost for drones.
  C.build = (g, p, a) => {
    const it = D.items[a.item];
    if (!it || !it.place) return;
    const pr = D.protos[it.place], dir = int(a.dir) & 3;
    if (a.ghost || p.inv.count(a.item) < 1) {
      if (!g.bonus.drones) return;
      if (FG.canPlace(g, pr.id, a.x, a.y, dir, { noReplace: true, ignorePlayer: true }).ok) g.addGhost(pr.id, a.x, a.y, dir, a.s || null);
      return;
    }
    g.build(a.item, a.x, a.y, dir, a.s || null);
  };
  C.buildGhost = (g, p, a) => {
    const gh = g.ghosts.get(a.id);
    if (!gh) return;
    const item = D.protos[gh.p].item;
    if (!p.inv.count(item)) return;
    g.removeGhost(gh);
    if (!g.build(item, gh.x, gh.y, gh.dir, gh.settings)) g.addGhost(gh.p, gh.x, gh.y, gh.dir, gh.settings);
  };
  C.removeGhost = (g, p, a) => { const gh = g.ghosts.get(a.id); if (gh) g.removeGhost(gh); };
  C.removeRailGhost = (g, p, a) => { g.rail.ghosts.delete(a.key); };
  C.rotate = (g, p, a) => {
    const e = g.ents.get(a.id);
    if (e && !FG.rotateEntity(g, e, !!a.rev) && D.protos[e.p].rotatable) g.msg('Pick it up and place it again to turn it', 'warn');
  };
  C.settings = (g, p, a) => {
    const e = g.ents.get(a.id);
    if (!e || !a.s) return;
    const pr = D.protos[e.p], s = a.s;
    if (s.recipe && pr.kind === 'crafter' && D.recipes[s.recipe] && pr.cats.indexOf(D.recipes[s.recipe].cat) < 0) { g.msg('This machine cannot make that', 'warn'); return; }
    g.applySettings(e, s);
    if (a.say) g.msg(a.say);
  };
  C.recipe = (g, p, a) => {
    const e = g.ents.get(a.id);
    if (!e || !D.recipes[a.r] || e.recipe === a.r) return;
    g.giveOrDrop(FG.machines.setRecipe(g, e, a.r));
  };
  C.rename = (g, p, a) => {
    const e = g.ents.get(a.id);
    const name = String(a.name || '').trim().slice(0, 32);
    if (!e || !name || name === e.name) return;
    const old = e.name;
    e.name = name;
    // Keep schedules pointing here if this was the only stop with the old name.
    if (!FG.trains.stopsNamed(g, old).length) for (const tr of g.rail.trains) for (const s of tr.schedule) if (s.station === old) s.station = name;
    g.msg('Renamed to ' + name);
  };
  C.launch = (g, p, a) => {
    const e = g.ents.get(a.id);
    if (e && e.stages >= D.protos[e.p].stages && e.satellite && !e.launch) { e.launch = 1; FG.emit('sound', 'launch'); }
  };

  // Lay planned track: pieces [ax, ay, ah, t], built while in reach and rails last, the rest
  // left as planned ghosts.
  C.rails = (g, p, a) => {
    const RL = FG.rails;
    let built = 0, ghosts = 0, used = 0, stop = null;
    for (const [ax, ay, ah, t] of a.pieces || []) {
      const pc = RL.makePiece(ax, ay, ah, t);
      if (g.rail.byKey.has(pc.key)) continue;
      const cost = RL.itemCost(t);
      if (!a.ghost && near(p, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, REACH.rail + 2) && p.inv.count('rail') >= cost) {
        if (g.buildRail(ax, ay, ah, t)) { built++; used += cost; continue; }
        stop = 'Something is in the way'; break;
      }
      if (RL.addGhost(g, ax, ay, ah, t)) ghosts++;
    }
    if (built) FG.emit('sound', 'place');
    const bits = [];
    if (built) bits.push('laid ' + built + ' piece' + (built > 1 ? 's' : '') + ' (' + used + ' rails)');
    if (ghosts) bits.push(ghosts + ' planned' + (g.bonus.drones ? ' for drones' : ': walk over and click them to build'));
    if (bits.length > 0 && (built + ghosts > 1 || stop)) g.msg(bits.join(' · ').replace(/^./, (ch) => ch.toUpperCase()), 'info');
    if (stop) g.msg(stop, 'warn');
  };
  // Build a planned piece and the planned track joined to it, as far as the player reaches.
  C.railGhostRun = (g, p, a) => {
    const pc = g.rail.ghosts.get(a.key);
    if (!pc) return;
    const n = g.buildGhostRun(pc, p.x, p.y, REACH.rail);
    if (n) { FG.emit('sound', 'place'); if (n > 1) g.msg('Laid ' + n + ' planned pieces', 'info'); }
    else g.msg('Something is in the way', 'warn');
  };

  // Paste a blueprint at (ax, ay): build what the player carries and reaches, ghost the rest.
  C.paste = (g, p, a) => {
    const bp = a.bp, ax = int(a.ax), ay = int(a.ay);
    if (!bp || !Array.isArray(bp.ents)) return;
    let built = 0, ghosts = 0, skipped = 0;
    const RL = FG.rails;
    for (const [dx, dy, ah, t] of bp.rails || []) {
      const x = ax + dx, y = ay + dy;
      if (g.rail.byKey.has(RL.pieceKeyOf(x, y, ah, t))) continue;
      const pc = RL.makePiece(x, y, ah, t);
      if (!RL.pieceClear(g, pc)) { skipped++; continue; }
      if (p.inv.count('rail') >= RL.itemCost(t) && near(p, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, REACH.rail)) {
        if (g.buildRail(x, y, ah, t)) built++; else skipped++;
      } else if (RL.addGhost(g, x, y, ah, t)) ghosts++;
    }
    for (const b of bp.ents) {
      const pr = D.protos[b.p];
      if (!pr) continue;
      const x = ax + b.dx, y = ay + b.dy;
      if (!FG.canPlace(g, b.p, x, y, b.dir, { noReplace: true }).ok) { skipped++; continue; }
      const [fw, fh] = FG.footprint(pr, b.dir);
      if (p.inv.count(pr.item) > 0 && near(p, x + fw / 2, y + fh / 2, REACH.build)) {
        if (g.build(pr.item, x, y, b.dir, b.settings)) built++;
      } else if (g.addGhost(b.p, x, y, b.dir, b.settings)) ghosts++;
    }
    const bits = [];
    if (built) bits.push('built ' + built);
    if (ghosts) bits.push(ghosts + ' ghosts' + (g.bonus.drones ? '' : ' (bring the items and click them)'));
    if (skipped) bits.push(skipped + ' blocked');
    if (bits.length) g.msg(bits.join(' · ').replace(/^./, (c) => c.toUpperCase()));
  };

  // Pick up (or mark for drones) everything in a rectangle: X-drag, and the cut of Ctrl+X.
  C.decon = (g, p, a) => {
    const x0 = int(a.x0), y0 = int(a.y0), x1 = int(a.x1), y1 = int(a.y1);
    const RL = FG.rails;
    const inside = [], seen = new Set();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const e = FG.entAt(g, x, y);
      if (e && !seen.has(e.id) && e.x >= x0 && e.y >= y0 && e.x + e.w - 1 <= x1 && e.y + e.h - 1 <= y1) { seen.add(e.id); inside.push(e); }
      const gh = g.ghostAt(x, y);
      if (gh) g.removeGhost(gh);
    }
    const inArea = (x, y) => x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1;
    let picked = 0, marked = 0, left = 0, busy = 0;
    // Rail cars first, so the track under them can be picked up too.
    for (const tr of g.rail.trains.slice()) {
      for (let i = tr.cars.length - 1; i >= 0; i--) {
        if (tr.dead) break;
        const pose = FG.trains.carPose(tr, i);
        if (pose.x < x0 || pose.y < y0 || pose.x > x1 + 1 || pose.y > y1 + 1) continue;
        if (near(p, pose.x, pose.y, REACH.build) && g.pickUpCar({ train: tr, car: tr.cars[i], index: i })) picked++;
        else left++;
      }
    }
    for (const e of inside) {
      if (near(p, e.x + e.w / 2, e.y + e.h / 2, REACH.build) && g.pickUpEntity(e)) picked++;
      else if (g.bonus.drones) { e.decon = true; marked++; }
      else left++;
    }
    const railsOut = a.cut
      ? Array.from(g.rail.pieces.values()).filter((pc) => inArea(pc.ax, pc.ay) && inArea(pc.bx, pc.by))
      : Array.from(g.rail.pieces.values()).filter((pc) => inArea((pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2));
    for (const pc of railsOut) {
      if (FG.trains.pieceUnderTrain(g, pc)) { busy++; continue; }
      if (near(p, (pc.ax + pc.bx) / 2, (pc.ay + pc.by) / 2, REACH.rail) && g.pickUpRail(pc)) picked++;
      else if (g.bonus.drones) { pc.decon = true; marked++; }
      else left++;
    }
    RL.removeGhostsIn(g, x0, y0, x1 + 1, y1 + 1);
    const bits = [];
    if (picked) bits.push('picked up ' + picked);
    if (marked) bits.push('drones will remove ' + marked);
    if (left) bits.push(left + ' out of reach');
    if (busy) bits.push(busy + ' track under a train');
    if (bits.length) g.msg(bits.join(' · ').replace(/^./, (c) => c.toUpperCase()), left ? 'warn' : 'info');
  };

  // ---------------------------------------------------------------- items
  // Move up to n of item id from the player into a building. Returns how many moved.
  function giveTo(g, p, ent, id, n) {
    const pr = D.protos[ent.p], it = D.items[id];
    if (!it || n <= 0) return 0;
    if (it.module && ent.modules) {
      if (it.module.prod && pr.kind === 'beacon') { g.msg('Productivity modules cannot go in beacons', 'warn'); return 0; }
      const i = ent.modules.indexOf(null);
      if (i < 0) { g.msg('Module slots are full', 'warn'); return 0; }
      ent.modules[i] = id;
      p.inv.remove(id, 1);
      g.markDirty('fx');
      return 1;
    }
    n = Math.min(n, p.inv.count(id));
    let k = 0;
    if (pr.kind === 'chest') k = n - ent.inv.add(id, n);
    else k = FG.insertItem(g, ent, id, n, 'direct');
    if (k > 0) p.inv.remove(id, k);
    else g.msg(D.items[pr.item].name + ' does not accept ' + it.name, 'warn');
    return k;
  }
  FG.giveTo = giveTo;
  C.give = (g, p, a) => {
    const e = g.ents.get(a.id);
    if (e) { giveTo(g, p, e, a.item, int(a.n)); inventoryChanged(); }
  };
  // Click a building with an item in hand: a handful of fuel, a stack of anything else.
  C.insert = (g, p, a) => {
    const e = g.ents.get(a.id), id = a.item;
    if (!e || !D.items[id]) return;
    const have = p.inv.count(id);
    if (!have) { g.msg('You have no ' + D.items[id].name, 'warn'); return; }
    const burner = D.protos[e.p].burner && D.items[id].fuel;
    const n = a.all ? have : burner ? Math.min(have, 5) : Math.min(have, D.items[id].stack);
    const moved = giveTo(g, p, e, id, n);
    if (moved > 0) g.msg('Inserted ' + moved + ' ' + lc(id), 'info');
    inventoryChanged();
  };
  C.carInsert = (g, p, a) => {
    const hit = carHit(g, a.car), id = a.item;
    if (!hit || !D.items[id]) return;
    const have = p.inv.count(id);
    if (!have) return;
    const n = a.all ? have : Math.min(have, D.items[id].stack);
    const k = FG.trains.carInsert(hit.car, id, n);
    if (k > 0) { p.inv.remove(id, k); g.msg('Inserted ' + k + ' ' + lc(id), 'info'); }
    else g.msg(hit.car.type === 'loco' ? 'Locomotives only take fuel' : 'That wagon is full', 'warn');
    inventoryChanged();
  };
  // From the train window: fuel goes to the locomotives, anything else into the wagons.
  C.trainGive = (g, p, a) => {
    const tr = FG.trains.trainById(g, a.train), id = a.item;
    if (!tr || !D.items[id]) return;
    let left = Math.min(int(a.n), p.inv.count(id)), moved = 0;
    const order = D.items[id].fuel ? tr.cars.filter((c) => c.type === 'loco').concat(tr.cars.filter((c) => c.type === 'wagon')) : tr.cars.filter((c) => c.type === 'wagon');
    for (const car of order) {
      if (left <= 0) break;
      const k = FG.trains.carInsert(car, id, left);
      if (k > 0) { p.inv.remove(id, k); left -= k; moved += k; }
    }
    if (!moved) g.msg('No room for that in this train', 'warn');
    inventoryChanged();
  };
  C.carTake = (g, p, a) => {
    const hit = carHit(g, a.car);
    if (!hit || !D.items[a.item]) return;
    const k = Math.min(int(a.n), p.inv.space(a.item), hit.car.inv.count(a.item));
    if (k <= 0) { g.msg('Inventory full', 'warn'); return; }
    hit.car.inv.remove(a.item, k);
    p.inv.add(a.item, k);
    inventoryChanged();
  };

  // Take items out of one slot of a building's window into the inventory.
  C.take = (g, p, a) => {
    const e = g.ents.get(a.id);
    if (!e) return;
    const take = (id, n) => {
      const k = Math.min(n, p.inv.space(id));
      if (k <= 0) { g.msg('Inventory full', 'warn'); return 0; }
      p.inv.add(id, k);
      return k;
    };
    const fromObj = (key) => { const o = e[key]; if (o) { const k = take(o.id, o.n); o.n -= k; if (!o.n) e[key] = null; } };
    const fromMap = (key, id) => { const m = e[key]; const n = (m && m[id]) || 0; if (n) { const k = take(id, n); m[id] -= k; if (!m[id]) delete m[id]; } };
    switch (a.from) {
      case 'slot': {
        const s = e.inv && e.inv.slots[int(a.i)];
        if (!s) break;
        if (a.all) { const k = take(s.id, e.inv.count(s.id)); e.inv.remove(s.id, k); }
        else { const k = take(s.id, s.n); s.n -= k; if (!s.n) e.inv.slots[int(a.i)] = null; }
        break;
      }
      case 'fuel': case 'ammo': case 'inp': case 'out': fromObj(a.from); break;
      case 'inpk': fromMap('inp', a.key); break;
      case 'outk': fromMap('out', a.key); break;
      case 'module': {
        const i = int(a.i);
        if (e.modules && e.modules[i] && take(e.modules[i], 1)) { e.modules[i] = null; g.markDirty('fx'); }
        break;
      }
      case 'satellite': if (e.satellite && take('satellite', 1)) e.satellite = 0; break;
    }
    inventoryChanged();
  };

  // Ctrl+click: take what a machine has made. If it has made nothing, take its fuel instead,
  // so you can get coal back from any burner (or pull out wood to make room for coal).
  C.quickTake = (g, p, a) => {
    const ent = g.ents.get(a.id);
    if (!ent) return;
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
    const what = got.map(([id, k]) => k + ' ' + lc(id)).join(', ');
    const more = tookProducts && ent.fuel && ent.fuel.n > 0 ? ' · Ctrl+click again for the ' + lc(ent.fuel.id) : '';
    g.msg('Took ' + what + more, 'info');
    if (g.actingLocal) g.effects.push({ type: 'pick', id: got[0][0], x: ent.x + ent.w / 2, y: ent.y + ent.h / 2, t: 0, life: 40 });
    FG.emit('sound', 'pickup');
    inventoryChanged();
  };
  C.quickTakeCar = (g, p, a) => {
    const hit = carHit(g, a.car);
    if (!hit) return;
    const car = hit.car;
    let took = 0;
    for (const s of car.inv.slots) {
      if (!s) continue;
      const k = Math.min(s.n, p.inv.space(s.id));
      if (k <= 0) continue;
      car.inv.remove(s.id, k);
      p.inv.add(s.id, k);
      took += k;
    }
    if (took) { g.msg('Took ' + took + ' items from the ' + (car.type === 'loco' ? 'locomotive' : 'wagon'), 'info'); FG.emit('sound', 'pickup'); inventoryChanged(); }
    else g.msg('Nothing to take', 'warn');
  };

  // Z: one of the held item into a building, a belt lane (tile tx, ty) or a rail car.
  C.drop1 = (g, p, a) => {
    const id = a.item;
    if (!D.items[id] || !p.inv.count(id)) return;
    let put = 0, cx, cy, what = '', onBelt = false;
    if (a.car) {
      const hit = carHit(g, a.car);
      if (!hit) return;
      const pose = FG.trains.carPose(hit.train, hit.index);
      cx = pose.x; cy = pose.y;
      what = D.items[FG.trains.itemFor(hit.car)].name;
      put = FG.trains.carInsert(hit.car, id, 1);
    } else {
      const e = g.ents.get(a.id);
      if (!e) return;
      const pr = D.protos[e.p];
      what = D.items[pr.item].name;
      cx = e.x + e.w / 2; cy = e.y + e.h / 2;
      const node = FG.isBeltKind(pr.kind) && a.tile ? FG.belts.nodeAt(g, a.tile[0], a.tile[1]) : null;
      if (node) {
        onBelt = true;
        cx = a.tile[0] + 0.5; cy = a.tile[1] + 0.5;
        const lane = a.lane ? 1 : 0;
        put = FG.belts.laneInsert(node.lanes[lane], id, Math.min(0.5, node.len * 0.5), node.len) ? 1 : 0;
      } else if (pr.kind === 'chest') put = 1 - e.inv.add(id, 1);
      else put = FG.insertItem(g, e, id, 1, 'direct');
    }
    if (put > 0) {
      p.inv.remove(id, 1);
      if (g.actingLocal) g.effects.push({ type: 'drop', id, x: cx, y: cy, t: 0, life: 30 });
      FG.emit('sound', 'pickup');
      inventoryChanged();
    } else g.msg(onBelt ? 'No room on the belt there' : what + ' can\'t take ' + lc(id), 'warn');
  };

  // Split-stack moves inside the inventory: n of the stack in slot `from` to slot `to` (an
  // empty slot or the same item); a whole stack dropped on a different item swaps with it.
  C.invMove = (g, p, a) => {
    const inv = p.inv, i = int(a.from), j = int(a.to);
    const src = inv.slots[i], dst = inv.slots[j];
    if (!src || i === j || j < 0 || j >= inv.size) return;
    const n = Math.min(int(a.n), src.n);
    if (n <= 0) return;
    if (!dst) inv.slots[j] = { id: src.id, n };
    else if (dst.id === src.id) {
      const k = Math.min(n, D.items[src.id].stack - dst.n);
      if (k <= 0) return;
      dst.n += k; src.n -= k;
      if (src.n <= 0) inv.slots[i] = null;
      inventoryChanged();
      return;
    } else if (n === src.n) { inv.slots[j] = src; inv.slots[i] = dst; inventoryChanged(); return; }
    else return;
    src.n -= n;
    if (src.n <= 0) inv.slots[i] = null;
    inventoryChanged();
  };
  C.invSort = (g, p) => { p.inv.sort(); inventoryChanged(); };

  // ------------------------------------------------------------- crafting
  C.craft = (g, p, a) => {
    const r = D.recipes[a.r];
    if (!r) return;
    if (!g.canHandcraft(r.id)) { g.msg(r.cat === 'advanced' ? r.name + ' can only be made in an assembler' : 'Cannot hand-craft ' + r.name, 'warn'); return; }
    const max = a.n === 'max';
    let k = max ? g.craftableCount(r.id) : Math.max(1, int(a.n));
    while (k > 0 && !g.queueCraft(r.id, k)) k = max ? 0 : k - 1;
    if (!k) g.msg('Missing ingredients for ' + r.name, 'warn');
  };
  C.craftCancel = (g, p, a) => g.cancelCraft(int(a.i));
  C.research = (g, p, a) => { if (D.techs[a.t]) g.queueResearch(a.t, !!a.front); };
  C.researchCancel = (g, p, a) => { if (D.techs[a.t]) g.cancelResearch(a.t); };
  C.skipObjective = (g) => g.objectives.skip();
  // Chat rides the command stream, so everyone sees a line at the same moment.
  C.chat = (g, p, a) => {
    const t = String(a.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
    if (t) FG.emit('chat', p, t);
  };

  // ------------------------------------------------------------ weapons
  C.grenade = (g, p, a) => {
    if (!g.enemies.throwGrenade(+a.x || 0, +a.y || 0)) g.msg(p.inv.count('grenade') ? 'Not ready yet' : 'You have no grenades', 'warn');
  };

  // --------------------------------------------------------------- trains
  C.placeCar = (g, p, a) => {
    const it = D.items[a.item];
    if (!it || !it.car || !p.inv.count(a.item)) return;
    const r = FG.trains.placeCar(g, it.car, +a.x, +a.y, int(a.dir) & 3);
    if (!r.ok) { g.msg(r.reason, 'warn'); return; }
    p.inv.remove(a.item, 1);
    FG.emit('sound', 'place');
    inventoryChanged();
  };
  C.board = (g, p) => {
    if (!FG.trains.board(g)) g.msg('Stand next to a train to get in', 'warn');
    else g.msg(p.vehicle ? 'Aboard · W go · S brake (hold to reverse) · A/D choose turns · Enter to leave' : 'You left the train');
  };
  C.ride = (g, p, a) => {
    const tr = FG.trains.trainById(g, a.train);
    if (!tr) return;
    if (p.vehicle === tr.id) { FG.trains.exit(g); return; }
    const pose = FG.trains.carPose(tr, 0);
    if (FG.dist2(pose.x, pose.y, p.x, p.y) > 144) { g.msg('Walk closer to board', 'warn'); return; }
    p.vehicle = tr.id;
    if (!tr.schedule.length) tr.mode = 'manual';
  };
  C.flipCar = (g, p, a) => {
    const hit = carHit(g, a.car);
    if (!hit) return;
    if (hit.car.type !== 'loco') { g.msg('Only locomotives have a facing', 'warn'); return; }
    if (!FG.trains.flipCar(g, hit.train, hit.index)) g.msg('Stop the train before turning a locomotive', 'warn');
  };
  C.trainMode = (g, p, a) => {
    const tr = FG.trains.trainById(g, a.train);
    if (!tr || (a.mode !== 'auto' && a.mode !== 'manual')) return;
    tr.mode = a.mode;
    if (a.mode === 'auto') tr.state = 'plan';
  };
  // Schedule edits: add a stop, remove one, send the train to one now, or change one.
  C.sched = (g, p, a) => {
    const tr = FG.trains.trainById(g, a.train);
    if (!tr) return;
    const i = int(a.i), e = tr.schedule[i];
    switch (a.op) {
      case 'add': {
        const names = FG.trains.stopNames(g);
        if (!names.length) { g.msg('Place a train stop first', 'warn'); return; }
        const prev = tr.schedule.length ? tr.schedule[tr.schedule.length - 1].station : null;
        tr.schedule.push({ station: names.find((x) => x !== prev) || names[0], cond: tr.schedule.length ? 'empty' : 'full', v: 10 });
        break;
      }
      case 'remove':
        if (!e) return;
        tr.schedule.splice(i, 1);
        if (tr.cur >= tr.schedule.length) tr.cur = 0;
        break;
      case 'go':
        if (!e) return;
        tr.cur = i;
        if (tr.mode === 'auto') tr.state = 'plan';
        break;
      case 'set': {
        if (!e || !a.e) return;
        const s = a.e;
        if (typeof s.station === 'string') { e.station = s.station.slice(0, 32); if (tr.cur === i && tr.state !== 'station') tr.state = 'plan'; }
        if (s.cond === 'full' || s.cond === 'empty' || s.cond === 'time' || s.cond === 'inactive') { e.cond = s.cond; if (!e.v) e.v = 10; }
        if (s.v !== undefined) e.v = FG.clamp(int(s.v) || 10, 1, 600);
        break;
      }
    }
  };
})();
