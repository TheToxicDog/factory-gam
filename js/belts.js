// Cogworks Frontier — conveyor belts, tunnel belts and splitters.
// Every belt tile (and each half of a splitter) is a "node" with two lanes.
// Lane items are stored front-first: pos[0] is the item closest to the exit.
(function () {
  'use strict';
  const D = FG.data;
  const DX = FG.DX, DY = FG.DY;
  const SP = 0.25; // minimum spacing between item centres on a lane (4 per lane per tile)
  const belts = (FG.belts = { SPACING: SP });

  // Node lookup: the belt-like thing occupying a tile.
  function nodeAt(g, x, y) {
    const e = FG.entAt(g, x, y);
    if (!e) return null;
    const k = D.protos[e.p].kind;
    if (k === 'belt' || k === 'underground') return e;
    if (k === 'splitter') return e.halves[0].x === x && e.halves[0].y === y ? e.halves[0] : e.halves[1];
    if (k === 'loader') return e.node.x === x && e.node.y === y ? e.node : null; // the hood tile is not a belt
    return null;
  }
  belts.nodeAt = nodeAt;

  function kindOf(node) {
    if (node.loader) return 'loader';
    if (node.halves === undefined && node.part !== undefined) return 'split';
    const k = D.protos[node.p].kind;
    if (k === 'underground') return node.ug === 'in' ? 'ug_in' : 'ug_out';
    return 'belt';
  }
  belts.kindOf = kindOf;

  // Does this node push items out of its front edge onto the next tile?
  function outputsByTile(node) {
    const k = kindOf(node);
    return k === 'belt' || k === 'ug_out' || k === 'split' || (k === 'loader' && node.owner.lm === 'out');
  }

  belts.guessUndergroundType = function (g, ent) {
    const pr = D.protos[ent.p];
    const back = FG.opposite(ent.dir);
    for (let d = 1; d <= pr.maxDist; d++) {
      const e = FG.entAt(g, ent.x + DX[back] * d, ent.y + DY[back] * d);
      if (e && e.p === ent.p && e.dir === ent.dir) {
        return e.ug === 'in' ? 'out' : 'in';
      }
    }
    return 'in';
  };

  // Loader mode for a loader placed at (x, y) facing dir (the way items travel): load into a
  // container ahead, unload one behind; failing that, follow a belt feeding in or leading away.
  const STORE_KINDS = { chest: 1, furnace: 1, crafter: 1, uplink: 1, lab: 1, boiler: 1, turret: 1, drill: 1 };
  function isStore(g, x, y) {
    if (FG.trains.carAtTile(g, x, y)) return true;
    const e = FG.entAt(g, x, y);
    return !!e && !!STORE_KINDS[D.protos[e.p].kind];
  }
  belts.isStore = isStore;
  belts.guessLoaderMode = function (g, x, y, dir) {
    const tIn = FG.loaderTiles(x, y, dir, 'in'), tOut = FG.loaderTiles(x, y, dir, 'out');
    const ahead = [tIn.cx, tIn.cy], behind = [tOut.cx, tOut.cy];
    if (isStore(g, ahead[0], ahead[1])) return 'in';
    if (isStore(g, behind[0], behind[1])) return 'out';
    const nb = nodeAt(g, behind[0], behind[1]);
    if (nb && nb.dir === dir && (!nb.loader || nb.owner.lm === 'out')) return 'in';
    const na = nodeAt(g, ahead[0], ahead[1]);
    if (na && na.dir === dir && (!na.loader || na.owner.lm === 'in')) return 'out';
    return 'in';
  };

  function nodeSpeed(node) {
    const ent = node.owner || node;
    return D.protos[ent.p].speed / FG.TICKS;
  }

  // Recompute shapes, output targets and update order for all belt nodes.
  belts.recompute = function (g) {
    const nodes = [];
    for (const e of g.byKind.belt || []) nodes.push(e);
    for (const e of g.byKind.underground || []) nodes.push(e);
    for (const e of g.byKind.splitter || []) {
      e.halves[0].owner = e; e.halves[1].owner = e;
      nodes.push(e.halves[0], e.halves[1]);
    }
    for (const e of g.byKind.loader || []) nodes.push(FG.computeLoaderNode(e));
    for (const n of nodes) {
      n.len = 1;
      n.speed = nodeSpeed(n);
      n.pair = null;
      n.curveIn = null;
      n.inDir = n.dir;
      n.tgt = null;
      if (n.part !== undefined) n.dir = n.owner.dir;
    }
    // Pair tunnel belts.
    for (const e of g.byKind.underground || []) {
      if (e.ug !== 'in') continue;
      const pr = D.protos[e.p];
      for (let d = 1; d <= pr.maxDist; d++) {
        const o = FG.entAt(g, e.x + DX[e.dir] * d, e.y + DY[e.dir] * d);
        if (o && o.p === e.p && o.dir === e.dir) {
          if (o.ug === 'out') { e.pair = o; o.pair = e; e.len = d; }
          break;
        }
      }
    }
    // Curves: a belt with no rear feeder and exactly one side feeder bends.
    for (const n of nodes) {
      if (kindOf(n) !== 'belt') continue;
      const d = n.dir;
      const rear = nodeAt(g, n.x - DX[d], n.y - DY[d]);
      const hasRear = rear && rear.dir === d && outputsByTile(rear);
      if (hasRear) continue;
      const l = FG.leftOf(d), r = FG.rightOf(d);
      const ln = nodeAt(g, n.x + DX[l], n.y + DY[l]);
      const rn = nodeAt(g, n.x + DX[r], n.y + DY[r]);
      const fromL = ln && ln.dir === r && outputsByTile(ln);
      const fromR = rn && rn.dir === l && outputsByTile(rn);
      if (fromL && !fromR) { n.curveIn = ln; n.inDir = r; }
      else if (fromR && !fromL) { n.curveIn = rn; n.inDir = l; }
    }
    // Output targets.
    for (const n of nodes) {
      const k = kindOf(n);
      if (k === 'ug_in') { n.tgt = n.pair ? { node: n.pair, mode: 'cont' } : { mode: 'none' }; continue; }
      if (k === 'split') continue; // splitters resolve outputs per half below
      if (k === 'loader' && n.owner.lm !== 'out') { n.tgt = { mode: 'none' }; continue; } // it feeds its container
      n.tgt = targetFrom(g, n, n.x, n.y, n.dir);
    }
    for (const e of g.byKind.splitter || []) {
      e.outs = e.halves.map((h) => targetFrom(g, h, h.x, h.y, e.dir));
      e.halves[0].tgt = e.halves[1].tgt = { mode: 'none' };
    }
    // Reverse topological order: downstream nodes update before the nodes feeding them.
    const N = nodes.length;
    for (let i = 0; i < N; i++) nodes[i]._i = i;
    const downCount = new Int32Array(N);
    const upHead = new Int32Array(N).fill(-1);
    const upNext = new Int32Array(N * 2 + 2);
    const upFrom = new Int32Array(N * 2 + 2);
    let E = 0;
    const link = (a, b) => {
      if (!b || b._i === undefined || a === b || nodes[b._i] !== b) return;
      // skip duplicate edges (a splitter half feeding the same node twice)
      for (let e = upHead[b._i]; e >= 0; e = upNext[e]) if (upFrom[e] === a._i) return;
      downCount[a._i]++;
      upFrom[E] = a._i; upNext[E] = upHead[b._i]; upHead[b._i] = E; E++;
    };
    for (const n of nodes) {
      if (n.part !== undefined) {
        for (const o of n.owner.outs) if (o.node) link(n, o.node);
      } else if (n.tgt && n.tgt.node) link(n, n.tgt.node);
    }
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    const done = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!downCount[i]) queue[qt++] = i;
    const order = [];
    let scan = 0;
    while (order.length < N) {
      let i;
      if (qh < qt) i = queue[qh++];
      else {
        // Cycle: break it at the first remaining node.
        while (done[scan]) scan++;
        i = scan;
      }
      if (done[i]) continue;
      done[i] = 1;
      order.push(nodes[i]);
      for (let e = upHead[i]; e >= 0; e = upNext[e]) {
        const u = upFrom[e];
        if (--downCount[u] === 0 && !done[u]) queue[qt++] = u;
      }
    }
    g.beltOrder = order;
  };

  // Resolve where items leaving `src` (at x, y heading dir) go.
  function targetFrom(g, src, x, y, dir) {
    const tx = x + DX[dir], ty = y + DY[dir];
    const n = nodeAt(g, tx, ty);
    if (!n) return { mode: 'none' };
    const k = kindOf(n);
    if (k === 'split') {
      return n.owner.dir === dir ? { node: n, mode: 'cont' } : { mode: 'none' };
    }
    // A loading loader takes a belt running straight into its belt end, nothing from the side.
    if (k === 'loader') return n.owner.lm === 'in' && n.dir === dir ? { node: n, mode: 'cont' } : { mode: 'none' };
    if (k === 'ug_out') {
      if (n.dir === dir || n.dir === FG.opposite(dir)) return { mode: 'none' };
      return { node: n, mode: 'side', lane: dir === FG.rightOf(n.dir) ? 0 : 1 };
    }
    if (n.dir === dir) return { node: n, mode: 'cont' };
    if (n.dir === FG.opposite(dir)) return { mode: 'none' };
    if (k === 'belt' && n.curveIn === src) return { node: n, mode: 'cont' };
    return { node: n, mode: 'side', lane: dir === FG.rightOf(n.dir) ? 0 : 1 };
  }

  // Insert an item into a lane at position `at` if there is room around it.
  function laneInsert(lane, id, at, len) {
    const ids = lane.ids, pos = lane.pos;
    if (at < SP * 0.5 - 1e-6 || at > len - SP * 0.5 + 1e-6) return false;
    let i = 0;
    while (i < pos.length && pos[i] > at) i++;
    if (i > 0 && pos[i - 1] - at < SP - 1e-6) return false;
    if (i < pos.length && at - pos[i] < SP - 1e-6) return false;
    ids.splice(i, 0, id);
    pos.splice(i, 0, at);
    return true;
  }
  belts.laneInsert = laneInsert;

  // Move the items on one lane. `out` describes where the front item goes.
  function updateLane(node, lane, L, out) {
    const ids = lane.ids;
    const n = ids.length;
    if (!n) return;
    const pos = lane.pos;
    const len = node.len, v = node.speed;
    let p = pos[0] + v;
    let prev;
    let start = 1;
    if (out.mode === 'cont') {
      const tl = out.node.lanes[L];
      const tn = tl.ids.length;
      if (tn) {
        const lim = len + tl.pos[tn - 1] - SP;
        if (p > lim) p = lim;
      }
      if (p >= len) {
        tl.ids.push(ids[0]);
        tl.pos.push(p - len);
        ids.shift(); pos.shift();
        start = 0;
      } else pos[0] = p;
      prev = p;
    } else if (out.mode === 'side') {
      if (p >= len) {
        const tnode = out.node;
        if (laneInsert(tnode.lanes[out.lane], ids[0], tnode.len * 0.5, tnode.len)) {
          ids.shift(); pos.shift();
          start = 0;
        } else { p = len; pos[0] = p; }
      } else pos[0] = p;
      prev = p;
    } else {
      const lim = len - SP * 0.5;
      if (p > lim) p = Math.max(pos[0], lim);
      pos[0] = p;
      prev = p;
    }
    for (let i = start; i < ids.length; i++) {
      let q = pos[i] + v;
      if (q > prev - SP) q = Math.max(pos[i], prev - SP);
      pos[i] = q;
      prev = q;
    }
  }

  function updateSplitterLane(s, half, L) {
    const lane = half.lanes[L];
    if (!lane.ids.length) return;
    const pos = lane.pos;
    const v = half.speed;
    let p = pos[0] + v;
    let prev = p;
    let start = 1;
    if (p >= 1) {
      const id = lane.ids[0];
      let order;
      if (s.filter) order = id === s.filter ? [s.prio === 1 ? 1 : 0] : [s.prio === 1 ? 0 : 1];
      else if (s.prio >= 0) order = [s.prio, 1 - s.prio];
      else order = s.toggle[L] ? [1, 0] : [0, 1];
      let moved = false;
      for (const o of order) {
        const t = s.outs[o];
        if (t.mode === 'cont') {
          const tl = t.node.lanes[L];
          const entry = p - 1;
          if (!tl.ids.length || tl.pos[tl.ids.length - 1] - entry >= SP) {
            tl.ids.push(id); tl.pos.push(entry);
            moved = true;
          }
        } else if (t.mode === 'side') {
          moved = laneInsert(t.node.lanes[t.lane], id, t.node.len * 0.5, t.node.len);
        }
        if (moved) {
          if (s.prio < 0 && !s.filter) s.toggle[L] = o === 0 ? 1 : 0;
          break;
        }
      }
      if (moved) { lane.ids.shift(); pos.shift(); start = 0; }
      else { p = 1; pos[0] = p; }
    } else pos[0] = p;
    prev = p;
    for (let i = start; i < lane.ids.length; i++) {
      let q = pos[i] + v;
      if (q > prev - SP) q = Math.max(pos[i], prev - SP);
      pos[i] = q;
      prev = q;
    }
  }

  const NONE = { mode: 'none' };

  // ---------------------------------------------------------------- loaders
  // What sits past a loader's hood: a stopped rail car, or a building with an inventory.
  function storeFor(g, n) {
    const car = FG.trains.carAtTile(g, n.cx, n.cy);
    if (car) return { car };
    const e = FG.entAt(g, n.cx, n.cy);
    return e && STORE_KINDS[D.protos[e.p].kind] ? { ent: e } : null;
  }
  belts.loaderStore = storeFor;
  // Put one item in, with the same limits an arm uses (a furnace gets a few ore, not a stack).
  function storePut(g, st, id) {
    if (st.car) return FG.trains.carAccept(st.car, id, 'inserter') > 0 && FG.trains.carInsert(st.car, id, 1) > 0;
    return FG.insertItem(g, st.ent, id, 1, 'inserter') > 0;
  }
  // Take one item out (a chest's contents, a machine's products), honouring the filter.
  function storeTake(g, st, filter) {
    const list = st.car ? FG.trains.carOutputs(st.car) : FG.outputsOf(g, st.ent);
    for (const [id, n] of list) {
      if (n <= 0 || (filter && id !== filter)) continue;
      if ((st.car ? FG.trains.carTake(st.car, id, 1) : FG.takeOutput(g, st.ent, id, 1)) > 0) return id;
    }
    return null;
  }
  function updateLoader(g, n) {
    const e = n.owner;
    if (e.dead) return;
    const st = storeFor(g, n);
    if (e.lm === 'out') {
      const out = n.tgt || NONE;
      updateLane(n, n.lanes[0], 0, out);
      updateLane(n, n.lanes[1], 1, out);
      if (!st) { e.status = 'no_source'; return; }
      let moved = false, room = false;
      for (let L = 0; L < 2; L++) {
        const lane = n.lanes[L], m = lane.ids.length;
        // Enter behind the last item, keeping the lane fully packed.
        const at = m ? Math.min(lane.pos[m - 1] - SP, n.speed) : 0;
        if (at < -1e-9) continue;
        room = true;
        const id = storeTake(g, st, e.filter);
        if (!id) break;
        lane.ids.push(id); lane.pos.push(Math.max(0, at));
        moved = true;
      }
      // On a packed belt there is room only every few ticks: still working at full speed.
      if (moved) e.busy = g.tick;
      e.status = g.tick - (e.busy || -1e9) <= Math.ceil(SP / n.speed) + 1 ? 'working' : room ? 'waiting' : 'output_full';
      return;
    }
    // The front item goes in as soon as it would reach the hood this tick, before the lane
    // moves, so the items behind it never lose a step (a packed express belt stays at 45/s).
    const lim = n.len - SP * 0.5;
    let moved = false, waiting = false, blocked = false;
    for (let L = 0; L < 2; L++) {
      const lane = n.lanes[L];
      if (lane.ids.length && lane.pos[0] + n.speed >= lim - 1e-6) {
        const id = lane.ids[0];
        if (st && (!e.filter || id === e.filter) && storePut(g, st, id)) { lane.ids.shift(); lane.pos.shift(); moved = true; }
        else blocked = true;
      }
      updateLane(n, lane, L, NONE);
      if (lane.ids.length && lane.pos[0] < lim - 1e-6) waiting = true;
    }
    e.status = !st ? 'no_target' : moved || waiting ? 'working' : blocked ? 'target_full' : 'waiting';
  }

  belts.update = function (g) {
    const order = g.beltOrder;
    if (!order) return;
    for (let i = 0; i < order.length; i++) {
      const n = order[i];
      if (n.loader) { updateLoader(g, n); continue; }
      if (n.part !== undefined) {
        const s = n.owner;
        if (s.dead) continue;
        updateSplitterLane(s, n, 0);
        updateSplitterLane(s, n, 1);
      } else {
        if (n.dead) continue;
        const out = n.tgt || NONE;
        updateLane(n, n.lanes[0], 0, out);
        updateLane(n, n.lanes[1], 1, out);
      }
    }
  };

  // Lane 0 is the belt's left lane and lane 1 its right, looking along the travel direction.
  // Something reaching over a belt in direction `md` has a near lane and a far lane.
  belts.laneFor = function (node, md, near) {
    if (md === FG.rightOf(node.dir)) return near ? 0 : 1; // reaching in from the belt's left
    if (md === FG.leftOf(node.dir)) return near ? 1 : 0; // reaching in from the belt's right
    return 1; // along the belt: no near or far side
  };
  // Drop an item onto a belt tile, reaching in direction `md`. Arms put items on the far
  // lane; drills (near = true) put ore on the lane on their own side.
  belts.dropOn = function (node, id, md, near) {
    const lane = belts.laneFor(node, md, near);
    const at = Math.min(0.5, node.len * 0.5);
    return laneInsert(node.lanes[lane], id, at, node.len);
  };
  // Items on the belt tile within an arm's grab window (see pickFrom).
  belts.pickableIds = function (node) {
    const hi = Math.min(node.len, 1), ids = new Set();
    for (const lane of node.lanes) lane.pos.forEach((p, i) => { if (p >= 0.1 && p <= hi) ids.add(lane.ids[i]); });
    return ids;
  };

  // Pick an item near the middle of a belt tile, from either lane (whichever acceptable item
  // is closest to the grab point, as in Factorio). want(id) > 0 means acceptable.
  belts.pickFrom = function (node, want, max) {
    let best = -1, bestLane = -1, bestD = 9;
    let id = null;
    const hi = Math.min(node.len, 1);
    for (let L = 0; L < 2; L++) {
      const lane = node.lanes[L];
      for (let i = 0; i < lane.ids.length; i++) {
        const p = lane.pos[i];
        if (p < 0.1 || p > hi) continue; // includes an item waiting at the very end to side-load
        const d = Math.abs(p - 0.55);
        if (d < bestD && want(lane.ids[i]) > 0) { bestD = d; best = i; bestLane = L; }
      }
    }
    if (best < 0) return null;
    const lane = node.lanes[bestLane];
    id = lane.ids[best];
    lane.ids.splice(best, 1); lane.pos.splice(best, 1);
    let n = 1;
    // With bigger hands, grab more of the same item from the pickup window.
    for (let L = 0; L < 2 && n < max; L++) {
      const ln = node.lanes[L];
      for (let i = ln.ids.length - 1; i >= 0 && n < max; i--) {
        if (ln.ids[i] === id && ln.pos[i] >= 0.1 && ln.pos[i] <= hi - 0.05) { ln.ids.splice(i, 1); ln.pos.splice(i, 1); n++; }
      }
    }
    return { id, n };
  };

  // World position of an item on a node's lane (for rendering).
  const LANE_OFF = 0.23;
  belts.itemPos = function (node, L, p, out) {
    const d = node.dir;
    const side = L === 0 ? FG.leftOf(d) : FG.rightOf(d);
    const cx = node.x + 0.5, cy = node.y + 0.5;
    if (node.curveIn && node.inDir !== d) {
      const din = node.inDir;
      // Pivot is the inner corner shared by the entry and exit edges.
      const px = cx - DX[din] * 0.5 + DX[d] * 0.5;
      const py = cy - DY[din] * 0.5 + DY[d] * 0.5;
      const sideIn = L === 0 ? FG.leftOf(din) : FG.rightOf(din);
      const ex = cx - DX[din] * 0.5 + DX[sideIn] * LANE_OFF;
      const ey = cy - DY[din] * 0.5 + DY[sideIn] * LANE_OFF;
      const xx = cx + DX[d] * 0.5 + DX[side] * LANE_OFF;
      const xy = cy + DY[d] * 0.5 + DY[side] * LANE_OFF;
      const a0 = Math.atan2(ey - py, ex - px);
      let a1 = Math.atan2(xy - py, xx - px);
      let da = a1 - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const r = Math.sqrt((ex - px) * (ex - px) + (ey - py) * (ey - py));
      const a = a0 + da * FG.clamp(p, 0, 1);
      out[0] = px + Math.cos(a) * r;
      out[1] = py + Math.sin(a) * r;
      return out;
    }
    const along = p - 0.5;
    out[0] = cx + DX[d] * along + DX[side] * LANE_OFF;
    out[1] = cy + DY[d] * along + DY[side] * LANE_OFF;
    return out;
  };

  // Items that are visible for a node (tunnel belts hide the underground part).
  belts.visibleRange = function (node) {
    const k = kindOf(node);
    if (k === 'loader') return [0, 1.01];
    if (k === 'ug_in') return [0, 0.5];
    if (k === 'ug_out') return [0.5, 1.01];
    return [0, 1.01];
  };
})();
