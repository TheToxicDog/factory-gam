// Cogworks Frontier — fluid networks. Connected fluid boxes pool their contents:
// each network holds one fluid, and its capacity is the sum of its boxes.
(function () {
  'use strict';
  const D = FG.data;
  const fluids = (FG.fluidsys = {});

  function boxActive(ent, i) {
    const def = D.protos[ent.p].fb[i];
    if (!def.cond) return true;
    const r = ent.recipe && D.recipes[ent.recipe];
    return !!(r && Object.keys(r.fin).length);
  }

  // Map recipe fluids onto a crafter's fluid boxes.
  fluids.assignRecipe = function (ent) {
    const pr = D.protos[ent.p];
    ent.fmap = { in: {}, out: {} };
    if (!pr.fb) return;
    const r = ent.recipe && D.recipes[ent.recipe];
    if (!r) return;
    for (const io of ['in', 'out']) {
      const list = Object.keys(io === 'in' ? r.fin : r.fout);
      const used = new Set();
      for (const f of list) {
        let idx = pr.fb.findIndex((b, i) => b.io === io && b.prefer === f && !used.has(i));
        if (idx < 0) idx = pr.fb.findIndex((b, i) => b.io === io && !b.prefer && !used.has(i));
        if (idx < 0) idx = pr.fb.findIndex((b, i) => b.io === io && !used.has(i));
        if (idx >= 0) { used.add(idx); ent.fmap[io][f] = idx; }
      }
    }
  };

  fluids.recompute = function (g) {
    // Write network contents back into the boxes so splits keep their fluid.
    for (const net of g.fluidNets || []) {
      for (const b of net.boxes) {
        b.amount = net.cap > 0 ? (net.amount * b.cap) / net.cap : 0;
        b.fluid = net.amount > 0.001 ? net.fluid : null;
      }
    }
    const boxes = [];
    for (const ent of g.ents.values()) {
      if (!ent.fbs) continue;
      const pr = D.protos[ent.p];
      if (pr.kind === 'crafter' && !ent.fmap) fluids.assignRecipe(ent);
      ent.fbs.forEach((b, i) => {
        b.ent = ent;
        b.cap = pr.fb[i].cap;
        b.filter = pr.fb[i].filter || null;
        b.active = boxActive(ent, i);
        b.net = null;
        b.uf = boxes.length;
        boxes.push(b);
      });
    }
    const parent = boxes.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const at = new Map();
    const key = (x, y) => y * 65536 + x;
    for (const b of boxes) {
      if (!b.active) continue;
      for (const c of b.conns) {
        const k = key(c.x, c.y);
        let l = at.get(k);
        if (!l) at.set(k, (l = []));
        l.push({ b, d: c.d });
      }
    }
    for (const b of boxes) {
      if (!b.active) continue;
      for (const c of b.conns) {
        const nx = c.x + FG.DX[c.d], ny = c.y + FG.DY[c.d];
        const l = at.get(key(nx, ny));
        if (!l) continue;
        for (const o of l) if (o.d === FG.opposite(c.d) && o.b.ent !== b.ent) union(b.uf, o.b.uf);
      }
    }
    // Tunnel pipes pair with the next tunnel pipe facing back toward them.
    for (const e of g.byKind.pipe_ug || []) {
      const u = FG.opposite(e.dir);
      const pr = D.protos[e.p];
      for (let d = 1; d <= pr.maxDist; d++) {
        const o = FG.entAt(g, e.x + FG.DX[u] * d, e.y + FG.DY[u] * d);
        if (o && o.p === 'pipe_ug') {
          if (o.dir === u) { union(e.fbs[0].uf, o.fbs[0].uf); e.pairX = o.x; e.pairY = o.y; }
          break;
        }
      }
    }
    const nets = new Map();
    let nid = 1;
    for (const b of boxes) {
      const r = find(b.uf);
      let net = nets.get(r);
      if (!net) nets.set(r, (net = { id: nid++, boxes: [], cap: 0, amount: 0, fluid: null, filter: null, byFluid: {} }));
      net.boxes.push(b);
      net.cap += b.cap;
      if (b.filter && !net.filter) net.filter = b.filter;
      if (b.fluid && b.amount > 0) net.byFluid[b.fluid] = (net.byFluid[b.fluid] || 0) + b.amount;
      b.net = net;
    }
    for (const net of nets.values()) {
      let best = null, amt = 0;
      for (const f in net.byFluid) if (net.byFluid[f] > amt) { amt = net.byFluid[f]; best = f; }
      net.fluid = best;
      net.amount = Math.min(amt, net.cap);
      delete net.byFluid;
    }
    g.fluidNets = Array.from(nets.values());
  };

  fluids.avail = function (box, fluid) {
    const n = box && box.net;
    if (!n || n.fluid !== fluid) return 0;
    return n.amount;
  };
  fluids.room = function (box, fluid) {
    const n = box && box.net;
    if (!n) return 0;
    if (n.fluid && n.fluid !== fluid && n.amount > 0.001) return 0;
    return n.cap - n.amount;
  };
  fluids.push = function (box, fluid, amt) {
    const room = fluids.room(box, fluid);
    const k = Math.min(room, amt);
    if (k <= 0) return 0;
    box.net.fluid = fluid;
    box.net.amount += k;
    return k;
  };
  fluids.pull = function (box, fluid, amt) {
    const n = box && box.net;
    if (!n || n.fluid !== fluid) return 0;
    const k = Math.min(n.amount, amt);
    n.amount -= k;
    if (n.amount < 1e-6) { n.amount = 0; n.fluid = null; }
    return k;
  };
  // Fill level (0..1) and fluid for rendering / tooltips.
  fluids.info = function (box) {
    const n = box && box.net;
    if (!n) return { fluid: null, amount: 0, cap: 0, level: 0 };
    return { fluid: n.fluid, amount: n.amount, cap: n.cap, level: n.cap ? n.amount / n.cap : 0 };
  };
})();
