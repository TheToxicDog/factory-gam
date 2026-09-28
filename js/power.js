// Cogworks Frontier — electric networks built from poles; generation and demand.
(function () {
  'use strict';
  const D = FG.data;
  const power = (FG.power = {});
  const ELECTRIC_KINDS = { drill: 1, pumpjack: 1, furnace: 1, crafter: 1, lab: 1, inserter: 1, beacon: 1, uplink: 1, laser: 1, engine: 1, solar: 1, accumulator: 1 };

  power.isElectric = function (pr) {
    return ELECTRIC_KINDS[pr.kind] && !pr.burner;
  };

  function poleCenter(p) { return [p.x + p.w / 2, p.y + p.h / 2]; }

  power.recompute = function (g) {
    const poles = g.byKind.pole || [];
    const CELL = 32;
    const grid = new Map();
    const key = (cx, cy) => cy * 4096 + cx;
    for (const p of poles) {
      const [x, y] = poleCenter(p);
      const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(p);
    }
    const near = (x, y, r, fn) => {
      const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
      const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const l = grid.get(key(cx, cy));
        if (l) for (const p of l) fn(p);
      }
    };
    // Union poles within reach of each other.
    const parent = new Map();
    for (const p of poles) parent.set(p, p);
    const find = (p) => { while (parent.get(p) !== p) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); } return p; };
    for (const p of poles) {
      const pr = D.protos[p.p];
      const [x, y] = poleCenter(p);
      const cands = [];
      near(x, y, 30, (o) => {
        if (o === p) return;
        const reach = Math.min(pr.reach, D.protos[o.p].reach);
        const [ox, oy] = poleCenter(o);
        const d2 = FG.dist2(x, y, ox, oy);
        if (d2 <= reach * reach) {
          cands.push([d2, o]);
          const a = find(p), b = find(o);
          if (a !== b) parent.set(b, a);
        }
      });
      cands.sort((a, b) => a[0] - b[0]);
      p.wires = cands.slice(0, 4).map((c) => c[1].id);
    }
    const nets = new Map();
    let nid = 1;
    for (const p of poles) {
      const r = find(p);
      let net = nets.get(r);
      if (!net) nets.set(r, (net = { id: nid++, poles: [], consumers: [], engines: [], solars: [], accs: [], sat: 0, demand: 0, supply: 0, cap: 0 }));
      net.poles.push(p);
      p.net = net;
    }
    // Attach electric entities to any pole whose supply area overlaps them.
    for (const e of g.ents.values()) {
      const pr = D.protos[e.p];
      if (!power.isElectric(pr)) continue;
      e.net = null;
      e.want = e.want || 0;
      near(e.x + e.w / 2, e.y + e.h / 2, 8, (p) => {
        if (e.net) return;
        const s = D.protos[p.p].supply;
        const [px, py] = poleCenter(p);
        if (e.x < px + s && e.x + e.w > px - s && e.y < py + s && e.y + e.h > py - s) e.net = p.net;
      });
      if (!e.net) continue;
      if (pr.kind === 'engine') e.net.engines.push(e);
      else if (pr.kind === 'solar') e.net.solars.push(e);
      else if (pr.kind === 'accumulator') e.net.accs.push(e);
      else e.net.consumers.push(e);
    }
    g.powerNets = Array.from(nets.values());
  };

  // Called at the end of each tick: settle generation against demand.
  power.update = function (g) {
    const STEAM = D.STEAM_KJ;
    const light = g.daylight();
    let totalProd = 0, totalUse = 0, steamOut = 0, solarOut = 0, accOut = 0;
    for (const net of g.powerNets || []) {
      let demand = 0;
      for (const c of net.consumers) { demand += c.want || 0; }
      let solar = 0;
      for (const s of net.solars) solar += D.protos[s.p].peak * light;
      // Steam engines: split each steam network's contents among its engines.
      const perNet = new Map();
      for (const e of net.engines) {
        const b = e.fbs[0];
        if (!b.net) continue;
        perNet.set(b.net, (perNet.get(b.net) || 0) + 1);
      }
      let engCap = 0;
      for (const e of net.engines) {
        const b = e.fbs[0];
        let cap = 0;
        if (b.net && b.net.fluid === 'steam') {
          const share = b.net.amount / perNet.get(b.net);
          cap = Math.min(D.protos[e.p].max, share * STEAM * FG.TICKS);
        }
        e.cap = cap;
        engCap += cap;
      }
      let accCap = 0, accRoom = 0;
      for (const a of net.accs) {
        const pr = D.protos[a.p];
        accCap += Math.min(pr.rate, a.charge * FG.TICKS);
        accRoom += Math.min(pr.rate, (pr.capacity - a.charge) * FG.TICKS);
      }
      const gen = solar + engCap;
      let engOut = 0, accFlow = 0, sat;
      if (demand <= 0) {
        sat = gen + accCap > 0 ? 1 : 0;
      } else if (gen >= demand) {
        sat = 1;
      } else {
        const dis = Math.min(accCap, demand - gen);
        accFlow = -dis;
        sat = (gen + dis) / demand;
      }
      const solarUsed = Math.min(solar, demand);
      engOut = Math.min(engCap, Math.max(0, demand - solarUsed));
      if (gen > demand) {
        const charge = Math.min(accRoom, gen - demand);
        accFlow = charge;
        engOut = Math.min(engCap, Math.max(0, demand + charge - solar));
      }
      // Apply accumulator flow evenly.
      if (accFlow !== 0 && net.accs.length) {
        const per = accFlow / FG.TICKS / net.accs.length;
        for (const a of net.accs) {
          const pr = D.protos[a.p];
          a.charge = FG.clamp(a.charge + per, 0, pr.capacity);
        }
      }
      // Engines burn steam proportionally to their share of output.
      if (engOut > 0 && engCap > 0) {
        const f = engOut / engCap;
        for (const e of net.engines) {
          const out = e.cap * f;
          e.out = out;
          if (out > 0) FG.fluidsys.pull(e.fbs[0], 'steam', out / FG.TICKS / STEAM);
        }
      } else for (const e of net.engines) e.out = 0;
      net.sat = Math.min(1, sat);
      net.demand = demand;
      net.supply = gen + accCap;
      net.production = engOut + Math.min(solar, demand + Math.max(0, accFlow)) + Math.max(0, -accFlow);
      net.solar = solar;
      net.engOut = engOut;
      net.accFlow = accFlow;
      net.stored = net.accs.reduce((s, a) => s + a.charge, 0);
      totalProd += net.production;
      totalUse += demand * net.sat;
      steamOut += engOut;
      solarOut += Math.min(solar, demand + Math.max(0, accFlow));
      accOut += Math.max(0, -accFlow);
    }
    g.stats.power(totalProd, totalUse, steamOut, solarOut, accOut);
  };
})();
