// Cogworks Frontier — per-tick behaviour of drills, furnaces, assemblers, labs,
// boilers, pumps, arms and the Orbital Uplink.
(function () {
  'use strict';
  const D = FG.data;
  const FL = () => FG.fluidsys;
  const M = (FG.machines = {});

  // Recipes whose output may receive productivity bonuses.
  function prodAllowed(r) {
    if (!r) return false;
    if (r.cat === 'smelting' || r.cat === 'refining') return true;
    if (r.cat === 'uplink') return false;
    const it = D.items[r.main];
    return !it || it.group === 'intermediate';
  }
  M.prodAllowed = prodAllowed;

  function pollute(g, e, perMin) {
    if (!perMin) return;
    const k = perMin * (1 + e.fx.pollution) * FG.powerMult(e) / 3600;
    g.pollute(e.x, e.y, k);
  }

  // ---------------------------------------------------------------- drills
  function mineOne(g, e) {
    const pr = D.protos[e.p];
    const w = g.world;
    const a = FG.drillArea(pr, e.x, e.y, e.w, e.h);
    const aw = a[2] - a[0], ah = a[3] - a[1];
    const total = aw * ah;
    for (let k = 0; k < total; k++) {
      const idx = (e.cursor + k) % total;
      const x = a[0] + (idx % aw), y = a[1] + ((idx / aw) | 0);
      if (!w.inBounds(x, y)) continue;
      const i = y * w.W + x;
      const r = w.res[i];
      if (r >= FG.RES.IRON && r <= FG.RES.STONE && w.amt[i] > 0) {
        w.amt[i]--;
        w.modified.add(i);
        if (w.amt[i] <= 0) { w.res[i] = 0; w.amt[i] = 0; w.touchChunk(x, y); }
        e.cursor = (idx + 1) % total;
        return FG.RES_ITEM[r];
      }
    }
    return null;
  }
  M.mineOne = mineOne;

  M.drillOutput = function (g, e) {
    const b = e.outBuf;
    if (!b) return true;
    const node = FG.belts.nodeAt(g, e.ox, e.oy);
    while (b.n > 0) {
      if (node) {
        if (!FG.belts.dropOn(node, b.id, e.dir)) break;
      } else {
        const car = FG.trains.carAtTile(g, e.ox, e.oy);
        const t = car ? null : FG.entAt(g, e.ox, e.oy);
        if (car) {
          if (FG.trains.carInsert(car, b.id, 1) < 1) break;
        } else if (!t || t === e || FG.insertItem(g, t, b.id, 1, 'direct') < 1) break;
      }
      b.n--;
    }
    if (b.n <= 0) e.outBuf = null;
    return !e.outBuf;
  };

  function updateDrill(g, e) {
    const pr = D.protos[e.p];
    e.want = pr.drain || 0;
    if (e.outBuf && !M.drillOutput(g, e)) { e.status = 'waiting_space'; return; }
    if (e.depleted) { e.status = 'no_ore'; return; }
    let sf = 1;
    if (pr.burner) {
      if (!FG.burnerDraw(g, e, pr.power / FG.TICKS)) { e.status = 'no_fuel'; return; }
    } else {
      e.want = pr.power * FG.powerMult(e);
      sf = FG.sat(e);
      if (sf <= 0) { e.status = 'no_power'; return; }
    }
    e.prog += (pr.speed * FG.speedMult(e) * sf) / FG.TICKS;
    pollute(g, e, pr.pollution);
    if (e.prog >= 1) {
      e.prog -= 1;
      const id = mineOne(g, e);
      if (!id) { e.depleted = true; e.status = 'no_ore'; return; }
      e.lastOre = id;
      let n = 1;
      e.bonus += g.bonus.miningProd + e.fx.prod;
      while (e.bonus >= 1) { e.bonus -= 1; n++; }
      e.outBuf = { id, n };
      g.stats.produce(id, n);
      M.drillOutput(g, e);
    }
    e.status = sf < 1 ? 'low_power' : 'working';
  }

  function updatePumpjack(g, e) {
    const pr = D.protos[e.p];
    const i = (e.y + 1) * g.world.W + e.x + 1;
    const yieldPct = g.world.amt[i];
    e.want = pr.power * FG.powerMult(e);
    const sf = FG.sat(e);
    if (sf <= 0) { e.status = 'no_power'; return; }
    const amt = (10 * yieldPct / 100) * FG.speedMult(e) * sf / FG.TICKS * (1 + e.fx.prod);
    const k = FL().push(e.fbs[0], 'crude_oil', amt);
    if (k <= 0) { e.status = 'output_full'; e.want = pr.drain; return; }
    g.stats.produce('crude_oil', k);
    pollute(g, e, pr.pollution);
    e.status = sf < 1 ? 'low_power' : 'working';
  }

  // --------------------------------------------------------------- furnaces
  function updateFurnace(g, e) {
    const pr = D.protos[e.p];
    e.want = pr.drain || 0;
    if (!e.crafting) {
      const r = e.inp && D.smeltingByInput[e.inp.id];
      if (!r || !g.recipeEnabled(r.id)) { e.status = e.inp ? 'no_recipe' : 'no_input'; return; }
      const need = r.ing[e.inp.id];
      if (e.inp.n < need) { e.status = 'no_input'; return; }
      const outId = r.main, outN = r.out[outId];
      if (e.out && (e.out.id !== outId || e.out.n + outN > D.items[outId].stack)) { e.status = 'output_full'; return; }
      e.inp.n -= need;
      g.stats.consume(e.inp.id, need);
      if (!e.inp.n) e.inp = null;
      e.recipe = r.id;
      e.crafting = true;
      e.prog = 0;
    }
    const r = D.recipes[e.recipe];
    let sf = 1;
    if (pr.burner) {
      if (!FG.burnerDraw(g, e, pr.power / FG.TICKS)) { e.status = 'no_fuel'; return; }
    } else {
      e.want = pr.power * FG.powerMult(e);
      sf = FG.sat(e);
      if (sf <= 0) { e.status = 'no_power'; return; }
    }
    e.prog += (pr.speed * FG.speedMult(e) * sf) / (r.time * FG.TICKS);
    pollute(g, e, pr.pollution);
    e.status = sf < 1 ? 'low_power' : 'working';
    if (e.prog >= 1) {
      const outId = r.main;
      let n = r.out[outId];
      e.bonus += e.fx.prod;
      while (e.bonus >= 1) { e.bonus -= 1; n += r.out[outId]; }
      if (e.out) e.out.n += n; else e.out = { id: outId, n };
      g.stats.produce(outId, n);
      e.crafting = false;
      e.prog = 0;
    }
  }

  // ------------------------------------------------------ assemblers et al.
  function box(e, io, fluid) {
    const idx = e.fmap && e.fmap[io][fluid];
    return idx === undefined ? null : e.fbs[idx];
  }

  function outputRoom(e, r) {
    for (const o in r.out) {
      const cap = Math.max(D.items[o].stack, r.out[o] * 2);
      if ((e.out[o] || 0) + r.out[o] > cap) return false;
    }
    for (const f in r.fout) if (FL().room(box(e, 'out', f), f) < r.fout[f] - 1e-6) return false;
    return true;
  }

  function updateCrafter(g, e) {
    const pr = D.protos[e.p];
    e.want = pr.drain || 0;
    const r = e.recipe && D.recipes[e.recipe];
    if (!r) { e.status = 'no_recipe'; return; }
    if (pr.kind === 'uplink') {
      if (e.launch > 0) {
        e.launch++;
        e.status = 'launching';
        if (e.launch > 600) { e.launch = 0; e.stages = 0; e.satellite = 0; g.onLaunch(e); }
        return;
      }
      if (e.stages >= pr.stages) { e.status = e.satellite ? 'ready' : 'need_satellite'; return; }
    }
    if (!e.crafting) {
      if (!outputRoom(e, r)) { e.status = 'output_full'; return; }
      for (const i in r.ing) if ((e.inp[i] || 0) < r.ing[i]) { e.status = 'no_input'; return; }
      for (const f in r.fin) if (FL().avail(box(e, 'in', f), f) < r.fin[f] - 1e-6) { e.status = 'no_input'; return; }
      for (const i in r.ing) {
        e.inp[i] -= r.ing[i];
        if (!e.inp[i]) delete e.inp[i];
        g.stats.consume(i, r.ing[i]);
      }
      for (const f in r.fin) { FL().pull(box(e, 'in', f), f, r.fin[f]); g.stats.consume(f, r.fin[f]); }
      e.crafting = true;
      e.prog = 0;
    }
    e.want = pr.power * FG.powerMult(e);
    const sf = FG.sat(e);
    if (sf <= 0) { e.status = 'no_power'; return; }
    if (e.prog < 1) {
      e.prog += (pr.speed * FG.speedMult(e) * sf) / (r.time * FG.TICKS);
      pollute(g, e, pr.pollution);
    }
    e.status = sf < 1 ? 'low_power' : 'working';
    if (e.prog >= 1) {
      for (const f in r.fout) if (FL().room(box(e, 'out', f), f) < r.fout[f] - 1e-6) { e.prog = 1; e.status = 'output_full'; e.want = pr.drain || 0; return; }
      let times = 1;
      if (prodAllowed(r)) {
        e.bonus += e.fx.prod;
        while (e.bonus >= 1) { e.bonus -= 1; times++; }
      }
      for (let t = 0; t < times; t++) {
        for (const o in r.out) { e.out[o] = (e.out[o] || 0) + r.out[o]; g.stats.produce(o, r.out[o]); }
        for (const f in r.fout) { const k = FL().push(box(e, 'out', f), f, r.fout[f]); g.stats.produce(f, k); }
      }
      if (pr.kind === 'uplink') e.stages++;
      e.crafting = false;
      e.prog = 0;
    }
  }

  // --------------------------------------------------------------------- labs
  function updateLab(g, e) {
    const pr = D.protos[e.p];
    e.want = pr.drain || 0;
    const tid = g.research.current;
    const t = tid && D.techs[tid];
    if (!t) { e.status = 'no_research'; e.working = false; return; }
    if (!e.working) {
      for (const k in t.cost) if ((e.inp[k] || 0) < t.cost[k]) { e.status = 'no_input'; return; }
      for (const k in t.cost) {
        e.inp[k] -= t.cost[k];
        if (!e.inp[k]) delete e.inp[k];
        g.stats.consume(k, t.cost[k]);
      }
      e.working = true;
      e.prog = 0;
      e.tech = tid;
    }
    e.want = pr.power * FG.powerMult(e);
    const sf = FG.sat(e);
    if (sf <= 0) { e.status = 'no_power'; return; }
    const tt = D.techs[e.tech] || t;
    e.prog += (pr.speed * (1 + g.bonus.labSpeed) * FG.speedMult(e) * sf) / (tt.time * FG.TICKS);
    e.status = sf < 1 ? 'low_power' : 'working';
    if (e.prog >= 1) {
      e.working = false;
      e.prog = 0;
      g.researchUnit(e.tech);
    }
  }

  // ------------------------------------------------------------------ energy
  function updateBoiler(g, e) {
    const water = e.fbs[0], steam = e.fbs[1];
    const room = FL().room(steam, 'steam');
    const avail = FL().avail(water, 'water');
    const k = Math.min(1, room, avail);
    if (k <= 1e-6) { e.status = avail <= 0 ? 'no_water' : 'output_full'; return; }
    if (!FG.burnerDraw(g, e, k * D.STEAM_KJ)) { e.status = 'no_fuel'; return; }
    FL().pull(water, 'water', k);
    FL().push(steam, 'steam', k);
    g.stats.produce('steam', k);
    pollute(g, e, D.protos[e.p].pollution * k);
    e.status = 'working';
  }

  function updateOffshore(g, e) {
    const k = FL().push(e.fbs[0], 'water', D.protos[e.p].rate / FG.TICKS);
    if (k > 0) g.stats.produce('water', k);
    e.status = k > 0 ? 'working' : 'output_full';
  }

  // -------------------------------------------------------------------- arms
  function srcAt(g, x, y) {
    const node = FG.belts.nodeAt(g, x, y);
    if (node) return { node };
    // Arms reach into rail cars stopped on the track.
    const car = FG.trains.carAtTile(g, x, y);
    if (car) return { car };
    const ent = FG.entAt(g, x, y);
    if (ent && FG.rails.isSideKind(D.protos[ent.p].kind)) return null;
    return ent ? { ent } : null;
  }

  function wantFor(g, dst, filter) {
    if (dst.node) return (id) => (filter && id !== filter ? 0 : 1);
    if (dst.car) return (id) => (filter && id !== filter ? 0 : FG.trains.carAccept(dst.car, id, 'inserter'));
    const pr = D.protos[dst.ent.p];
    if (pr.kind === 'pole' || pr.kind === 'wall' || FG.isBeltKind(pr.kind)) return () => 0;
    return (id) => (filter && id !== filter ? 0 : FG.acceptCount(g, dst.ent, id, 'inserter'));
  }

  function takeFrom(g, src, want, max) {
    if (src.node) return FG.belts.pickFrom(src.node, want, max);
    if (src.car) {
      for (const [id, n] of FG.trains.carOutputs(src.car)) {
        const w = want(id);
        if (w <= 0) continue;
        const k = FG.trains.carTake(src.car, id, Math.min(n, max, w));
        if (k > 0) return { id, n: k };
      }
      return null;
    }
    const e = src.ent;
    for (const [id, n] of FG.outputsOf(g, e)) {
      const w = want(id);
      if (w <= 0) continue;
      const k = FG.takeOutput(g, e, id, Math.min(n, max, w));
      if (k > 0) return { id, n: k };
    }
    return null;
  }

  function updateInserter(g, e) {
    const pr = D.protos[e.p];
    const r = pr.reach;
    const px = e.x - FG.DX[e.dir] * r, py = e.y - FG.DY[e.dir] * r;
    const dx = e.x + FG.DX[e.dir] * r, dy = e.y + FG.DY[e.dir] * r;
    const electric = !pr.burner;
    const moving = e.st === 1 || e.st === 3;
    let sf = 1;
    if (electric) {
      e.want = moving || e.st === 0 ? pr.power * 0.5 : pr.drain;
      sf = FG.sat(e);
      if (sf <= 0) { e.status = 'no_power'; e.want = pr.power; return; }
    }
    if (e.st === 0) {
      const src = srcAt(g, px, py);
      const dst = srcAt(g, dx, dy);
      // Burner arms refuel themselves from whatever they pick up from.
      if (pr.burner && !FG.hasFuel(e) && src) {
        const got = takeFrom(g, src, (id) => (D.items[id].fuel ? 1 : 0), 1);
        if (got) { e.fuel = { id: got.id, n: got.n }; }
      }
      if (!dst) { e.status = 'no_target'; return; }
      if (!src) { e.status = 'no_source'; return; }
      const want = wantFor(g, dst, pr.filter ? e.filter : null);
      const hand = 1 + g.bonus.hand;
      const got = takeFrom(g, src, want, hand);
      if (!got) { e.status = 'waiting'; if (electric) e.want = pr.drain; return; }
      e.hand = got;
      e.st = 1;
      e.t = 0;
    }
    if (e.st === 1 || e.st === 3) {
      if (pr.burner && !FG.burnerDraw(g, e, pr.power / FG.TICKS)) { e.status = 'no_fuel'; return; }
      e.want = electric ? pr.power : 0;
      const step = sf / pr.swing;
      if (e.st === 1) { e.t += step; if (e.t >= 1) { e.t = 1; e.st = 2; } }
      else { e.t -= step; if (e.t <= 0) { e.t = 0; e.st = 0; } }
      e.status = 'working';
      if (e.st !== 2) return;
    }
    if (e.st === 2) {
      if (!e.hand) { e.st = 3; return; }
      const dst = srcAt(g, dx, dy);
      if (!dst) { e.status = 'no_target'; return; }
      if (dst.node) {
        while (e.hand.n > 0 && FG.belts.dropOn(dst.node, e.hand.id, e.dir)) e.hand.n--;
      } else {
        const k = dst.car ? FG.trains.carInsert(dst.car, e.hand.id, e.hand.n) : FG.insertItem(g, dst.ent, e.hand.id, e.hand.n, 'inserter');
        e.hand.n -= k;
      }
      if (e.hand.n <= 0) { e.hand = null; e.st = 3; e.status = 'working'; }
      else { e.status = 'output_full'; if (electric) e.want = pr.drain; }
    }
  }

  // ------------------------------------------------------------ module effects
  function moduleFx(list, mult, allowProd) {
    const fx = { speed: 0, prod: 0, power: 0, pollution: 0 };
    for (const m of list) {
      if (!m) continue;
      const me = D.items[m].module;
      fx.speed += (me.speed || 0) * mult;
      fx.power += (me.power || 0) * mult;
      fx.pollution += (me.pollution || 0) * mult;
      if (allowProd) fx.prod += (me.prod || 0) * mult;
    }
    return fx;
  }

  M.recomputeEffects = function (g) {
    const beacons = g.byKind.beacon || [];
    for (const e of g.ents.values()) {
      const pr = D.protos[e.p];
      if (!e.fx) continue;
      const fx = e.modules && pr.kind !== 'beacon' ? moduleFx(e.modules, 1, true) : { speed: 0, prod: 0, power: 0, pollution: 0 };
      if (pr.modules && pr.kind !== 'beacon') {
        for (const b of beacons) {
          const bp = D.protos[b.p];
          const r = bp.range;
          if (e.x < b.x + b.w + r && e.x + e.w > b.x - r && e.y < b.y + b.h + r && e.y + e.h > b.y - r) {
            const bf = moduleFx(b.modules, bp.efficiency, false);
            fx.speed += bf.speed; fx.power += bf.power; fx.pollution += bf.pollution;
          }
        }
      }
      e.fx = fx;
    }
  };

  function updateBeacon(g, e) {
    const pr = D.protos[e.p];
    const any = e.modules.some((m) => m);
    e.want = any ? pr.power : 0;
    e.status = any ? (FG.sat(e) > 0 ? 'working' : 'no_power') : 'idle';
  }

  M.update = function (g) {
    const bk = g.byKind;
    const run = (list, fn) => { if (list) for (let i = 0; i < list.length; i++) fn(g, list[i]); };
    run(bk.offshore, updateOffshore);
    run(bk.boiler, updateBoiler);
    run(bk.drill, updateDrill);
    run(bk.pumpjack, updatePumpjack);
    run(bk.furnace, updateFurnace);
    run(bk.crafter, updateCrafter);
    run(bk.uplink, updateCrafter);
    run(bk.lab, updateLab);
    run(bk.inserter, updateInserter);
    run(bk.beacon, updateBeacon);
  };

  M.setRecipe = function (g, e, rid) {
    const leftovers = [];
    if (e.recipe === rid) return leftovers;
    for (const k in e.inp) leftovers.push([k, e.inp[k]]);
    for (const k in e.out) leftovers.push([k, e.out[k]]);
    const old = e.crafting && e.recipe && D.recipes[e.recipe];
    if (old) for (const k in old.ing) leftovers.push([k, old.ing[k]]);
    e.inp = {};
    e.out = {};
    e.crafting = false;
    e.prog = 0;
    e.recipe = rid;
    FG.fluidsys.assignRecipe(e);
    g.markDirty('fluid');
    return leftovers;
  };
})();
