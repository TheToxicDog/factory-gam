// Cogworks Frontier — railway track, modelled on Factorio's rail grid.
// Track runs between rail points on a 2-tile grid. Pieces are straight (orthogonal or
// diagonal) or curved (a smooth 45° arc). A piece starts at a point with a heading
// (8 directions) and ends at another point with a heading; trains can use it both ways.
(function () {
  'use strict';
  const RL = (FG.rails = {});
  const DX8 = [0, 1, 1, 1, 0, -1, -1, -1];
  const DY8 = [-1, -1, 0, 1, 1, 1, 0, -1];
  RL.DX8 = DX8; RL.DY8 = DY8;
  const opp8 = (d) => (d + 4) & 7;
  RL.opp8 = opp8;
  const rotQ = (v, q) => { let x = v[0], y = v[1]; for (let i = 0; i < q; i++) { const t = x; x = -y; y = t; } return [x, y]; };
  // Curve displacements in the frame where the start heading is north (orthogonal)
  // or north-east (diagonal). Two curves make a 90° turn spanning 12 x 12 tiles.
  const ORTHO = { R: [4, -8], L: [-4, -8] };
  const DIAG = { R: [8, -4], L: [4, -8] };
  RL.TYPES = ['S', 'L', 'R'];
  RL.itemCost = (t) => (t === 'S' ? 1 : 4);
  const unit = (d) => { const l = d & 1 ? Math.SQRT1_2 : 1; return [DX8[d] * l, DY8[d] * l]; };
  RL.unit = unit;

  // End point and heading of a piece of type t leaving (x, y) heading d.
  RL.endOf = function (x, y, d, t) {
    if (t === 'S') return [x + 2 * DX8[d], y + 2 * DY8[d], d];
    const even = (d & 1) === 0;
    const q = even ? d >> 1 : (d - 1) >> 1;
    const v = rotQ((even ? ORTHO : DIAG)[t], q);
    return [x + v[0], y + v[1], t === 'R' ? (d + 1) & 7 : (d + 7) & 7];
  };

  const pointKey = (x, y) => (y << 11) | x;
  const stateKey = (x, y, d) => ((y << 11) | x) * 8 + d;
  RL.pointKey = pointKey;
  RL.stateKey = stateKey;

  // ------------------------------------------------------------ geometry
  // A curve is a circular arc (radius ~9.66) joined to a short diagonal straight, so the
  // two ends meet other track tangentially and the tightest bend stays gentle.
  const ARC_R = 4 / (Math.SQRT1_2 - (1 - Math.SQRT1_2));
  const ARC_TAIL = (8 - Math.SQRT1_2 * ARC_R) / Math.SQRT1_2;
  RL.ARC_R = ARC_R;
  RL.makePiece = function (ax, ay, ah, t) {
    const [bx, by, bh] = RL.endOf(ax, ay, ah, t);
    const pts = [], angs = [];
    const ang = (d) => Math.atan2(DY8[d], DX8[d]);
    if (t === 'S') { pts.push([ax, ay], [bx, by]); angs.push(ang(ah), ang(ah)); }
    else {
      const sgn = t === 'R' ? 1 : -1;
      const a0 = ang(ah);
      const arc = (x0, y0) => {
        const N = 18;
        for (let i = 1; i <= N; i++) {
          const a = a0 + (sgn * (Math.PI / 4) * i) / N;
          pts.push([x0 + sgn * ARC_R * (Math.sin(a) - Math.sin(a0)), y0 - sgn * ARC_R * (Math.cos(a) - Math.cos(a0))]);
          angs.push(a);
        }
      };
      pts.push([ax, ay]); angs.push(a0);
      if ((ah & 1) === 0) {
        arc(ax, ay);
        pts.push([bx, by]); angs.push(a0 + (sgn * Math.PI) / 4);
      } else {
        const u = unit(ah);
        const sx = ax + u[0] * ARC_TAIL, sy = ay + u[1] * ARC_TAIL;
        pts.push([sx, sy]); angs.push(a0);
        arc(sx, sy);
        RL.lastArcError = Math.hypot(pts[pts.length - 1][0] - bx, pts[pts.length - 1][1] - by);
        pts[pts.length - 1] = [bx, by];
      }
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const pc = { id: 0, t, ax, ay, ah, bx, by, bh, pts, angs, cum, len: cum[cum.length - 1] };
    pc.key = pieceKey(pc);
    pc.tiles = coveredTiles(pc);
    return pc;
  };
  function pieceKey(pc) {
    const a = pc.ax + ',' + pc.ay + ',' + pc.ah + '>' + pc.bx + ',' + pc.by + ',' + pc.bh;
    const b = pc.bx + ',' + pc.by + ',' + opp8(pc.bh) + '>' + pc.ax + ',' + pc.ay + ',' + opp8(pc.ah);
    return a < b ? a : b;
  }
  RL.pieceKeyOf = (ax, ay, ah, t) => {
    const [bx, by, bh] = RL.endOf(ax, ay, ah, t);
    return pieceKey({ ax, ay, ah, bx, by, bh });
  };

  // Position (and tangent angle) at distance s along a piece, travelling forwards or backwards.
  RL.posAt = function (pc, s, fwd, out) {
    out = out || [0, 0, 0];
    if (!fwd) s = pc.len - s;
    s = FG.clamp(s, 0, pc.len);
    const cum = pc.cum;
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const a = pc.pts[lo], b = pc.pts[lo + 1];
    const seg = cum[lo + 1] - cum[lo] || 1;
    const f = (s - cum[lo]) / seg;
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = pc.angs[lo] + (pc.angs[lo + 1] - pc.angs[lo]) * f + (fwd ? 0 : Math.PI);
    return out;
  };

  // Tiles under a piece: the 2-tile-wide bed along its centre line.
  function coveredTiles(pc) {
    const seen = new Set();
    const out = [];
    const p = [0, 0, 0];
    const n = Math.max(2, Math.ceil(pc.len / 0.25));
    for (let i = 0; i < n; i++) {
      RL.posAt(pc, ((i + 0.5) / n) * pc.len, true, p);
      const nx = -Math.sin(p[2]), ny = Math.cos(p[2]);
      for (const o of [-0.9, -0.45, 0, 0.45, 0.9]) {
        const tx = Math.floor(p[0] + nx * o), ty = Math.floor(p[1] + ny * o);
        const k = ty * 4096 + tx;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([tx, ty]);
      }
    }
    return out;
  }

  // ------------------------------------------------------------- network
  RL.init = function (g) {
    const R = g.rail;
    R.pieces = new Map();
    R.byKey = new Map();
    R.out = new Map(); // stateKey -> [{ pc, fwd }] pieces leaving a point with that heading
    R.atPoint = new Map(); // pointKey -> [pc]
    R.tilePieces = new Map(); // world tile index -> Set(piece id)
    R.signals = new Map(); // stateKey -> signal entity (for trains travelling that way)
    R.signalPoints = new Set();
    R.stopsAt = new Map(); // stateKey -> [stop entities]
    R.blockOf = new Map(); // piece id -> block id
    R.conf = new Map(); // piece id -> Set(piece ids it physically overlaps)
    R.ghosts = new Map(); // piece key -> planned piece
    R.nextPiece = 1;
  };

  const push = (m, k, v) => { let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(v); };
  const pull = (m, k, f) => { const l = m.get(k); if (!l) return; const i = l.findIndex(f); if (i >= 0) l.splice(i, 1); if (!l.length) m.delete(k); };

  RL.add = function (g, pc) {
    const R = g.rail;
    if (R.byKey.has(pc.key)) return R.byKey.get(pc.key);
    pc.id = R.nextPiece++;
    R.pieces.set(pc.id, pc);
    R.byKey.set(pc.key, pc);
    push(R.out, stateKey(pc.ax, pc.ay, pc.ah), { pc, fwd: true });
    push(R.out, stateKey(pc.bx, pc.by, opp8(pc.bh)), { pc, fwd: false });
    push(R.atPoint, pointKey(pc.ax, pc.ay), pc);
    push(R.atPoint, pointKey(pc.bx, pc.by), pc);
    const W = g.world.W;
    for (const [x, y] of pc.tiles) {
      const k = y * W + x;
      let s = R.tilePieces.get(k);
      if (!s) R.tilePieces.set(k, (s = new Set()));
      s.add(pc.id);
      g.world.touchChunk(x, y);
    }
    R.dirty = true;
    return pc;
  };
  RL.remove = function (g, pc) {
    const R = g.rail;
    if (!R.pieces.has(pc.id)) return;
    R.pieces.delete(pc.id);
    R.byKey.delete(pc.key);
    pull(R.out, stateKey(pc.ax, pc.ay, pc.ah), (e) => e.pc === pc);
    pull(R.out, stateKey(pc.bx, pc.by, opp8(pc.bh)), (e) => e.pc === pc);
    pull(R.atPoint, pointKey(pc.ax, pc.ay), (e) => e === pc);
    pull(R.atPoint, pointKey(pc.bx, pc.by), (e) => e === pc);
    const W = g.world.W;
    for (const [x, y] of pc.tiles) {
      const k = y * W + x;
      const s = R.tilePieces.get(k);
      if (s) { s.delete(pc.id); if (!s.size) R.tilePieces.delete(k); }
    }
    pc.dead = true;
    R.dirty = true;
  };

  RL.tileHasRail = (g, x, y) => g.rail.tilePieces.has(y * g.world.W + x);
  RL.outOf = (g, x, y, d) => g.rail.out.get(stateKey(x, y, d)) || [];
  // Pieces arriving at (x, y) with heading d, as traversals.
  RL.into = (g, x, y, d) => RL.outOf(g, x, y, opp8(d)).map((e) => ({ pc: e.pc, fwd: !e.fwd }));
  RL.hasPoint = (g, x, y) => g.rail.atPoint.has(pointKey(x, y));
  // Is there track through point (x, y) along direction d (either way)?
  RL.axisAt = (g, x, y, d) => g.rail.out.has(stateKey(x, y, d)) || g.rail.out.has(stateKey(x, y, opp8(d)));

  // Traversal end state and start state.
  RL.endState = (e) => (e.fwd ? [e.pc.bx, e.pc.by, e.pc.bh] : [e.pc.ax, e.pc.ay, opp8(e.pc.ah)]);
  RL.startState = (e) => (e.fwd ? [e.pc.ax, e.pc.ay, e.pc.ah] : [e.pc.bx, e.pc.by, opp8(e.pc.bh)]);
  // Classify a traversal relative to its travel direction: 'S', 'L' or 'R'.
  RL.turnOf = function (e) {
    if (e.pc.t === 'S') return 'S';
    return e.fwd ? e.pc.t : e.pc.t === 'L' ? 'R' : 'L';
  };

  // Can a new piece go here? (bounds, water, buildings, hives)
  RL.pieceClear = function (g, pc) {
    const w = g.world;
    if (pc.ax < 2 || pc.ay < 2 || pc.bx < 2 || pc.by < 2 || pc.ax > w.W - 2 || pc.bx > w.W - 2 || pc.ay > w.H - 2 || pc.by > w.H - 2) return false;
    for (const [x, y] of pc.tiles) {
      if (!w.inBounds(x, y) || w.isWater(x, y)) return false;
      if (FG.entAt(g, x, y)) return false;
      if (g.enemies && g.enemies.nestBlocks(x, y, 1, 1)) return false;
    }
    return true;
  };

  // Lay a piece (clearing trees and boulders under it). Returns the piece.
  RL.build = function (g, ax, ay, ah, t) {
    const key = RL.pieceKeyOf(ax, ay, ah, t);
    if (g.rail.byKey.has(key)) return g.rail.byKey.get(key);
    const pc = RL.makePiece(ax, ay, ah, t);
    if (!RL.pieceClear(g, pc)) return null;
    const w = g.world;
    for (const [x, y] of pc.tiles) {
      const i = y * w.W + x;
      if (w.res[i] === FG.RES.TREE || w.res[i] === FG.RES.ROCK) { w.res[i] = 0; w.amt[i] = 0; w.modified.add(i); w.touchChunk(x, y); }
    }
    return RL.add(g, pc);
  };

  // Piece whose centre line passes nearest to a world point.
  RL.pieceNear = function (g, wx, wy, maxDist) {
    const R = g.rail, W = g.world.W;
    const ids = new Set();
    const tx = Math.floor(wx), ty = Math.floor(wy);
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
      const s = R.tilePieces.get(y * W + x);
      if (s) for (const id of s) ids.add(id);
    }
    let best = null, bd = maxDist || 1.2;
    const p = [0, 0, 0];
    for (const id of ids) {
      const pc = R.pieces.get(id);
      const n = Math.ceil(pc.len / 0.25);
      for (let i = 0; i <= n; i++) {
        RL.posAt(pc, (i / n) * pc.len, true, p);
        const d = Math.hypot(p[0] - wx, p[1] - wy);
        if (d < bd) { bd = d; best = { pc, s: (i / n) * pc.len, dist: d, angle: p[2] }; }
      }
    }
    return best;
  };

  // ------------------------------------------------------------- planner
  // A* over rail states from `starts` to the grid point (tx, ty). Existing track is reused
  // cheaply; new pieces must be clear. Returns [{ ax, ay, ah, t, exists }] (may be partial).
  RL.plan = function (g, starts, tx, ty, maxNodes) {
    maxNodes = maxNodes || 9000;
    const heap = new FG.Heap();
    const best = new Map(), prev = new Map(), clear = new Map();
    const h = (x, y) => Math.hypot(x - tx, y - ty);
    let closest = null, cd = Infinity;
    for (const s of starts) {
      const k = stateKey(s.x, s.y, s.d);
      best.set(k, s.cost || 0);
      prev.set(k, null);
      heap.push((s.cost || 0) + h(s.x, s.y) * 1.25, k);
    }
    let goal = -1, n = 0;
    const done = new Set();
    const W = g.world.W;
    while (heap.size && n++ < maxNodes) {
      const k = heap.pop();
      if (done.has(k)) continue;
      done.add(k);
      const d = k & 7, pk = (k - d) / 8, x = pk & 2047, y = pk >> 11;
      const dist = h(x, y);
      if (dist < cd) { cd = dist; closest = k; }
      if (x === tx && y === ty) { goal = k; break; }
      const c0 = best.get(k);
      for (const t of RL.TYPES) {
        const [bx, by, bh] = RL.endOf(x, y, d, t);
        if (bx < 2 || by < 2 || bx > W - 2 || by > g.world.H - 2) continue;
        const key = RL.pieceKeyOf(x, y, d, t);
        const exists = g.rail.byKey.has(key);
        let c;
        if (exists) c = (t === 'S' ? (d & 1 ? 2.83 : 2) : 9.3) * 0.35;
        else {
          let ok = clear.get(key);
          if (ok === undefined) { ok = RL.pieceClear(g, RL.makePiece(x, y, d, t)); clear.set(key, ok); }
          if (!ok) continue;
          c = t === 'S' ? (d & 1 ? 2.83 : 2) : 9.3 * 1.25;
        }
        const nk = stateKey(bx, by, bh);
        const nc = c0 + c;
        if (!best.has(nk) || nc < best.get(nk)) {
          best.set(nk, nc);
          prev.set(nk, { k, x, y, d, t, exists });
          heap.push(nc + h(bx, by) * 1.25, nk);
        }
      }
    }
    const end = goal >= 0 ? goal : closest;
    const out = [];
    for (let k = end; k !== null && prev.get(k);) {
      const p = prev.get(k);
      out.push({ ax: p.x, ay: p.y, ah: p.d, t: p.t, exists: p.exists });
      k = p.k;
    }
    out.reverse();
    out.reached = goal >= 0;
    return out;
  };

  // Planner start states at a grid point: continue existing track there, or any heading.
  RL.startsAt = function (g, x, y, prefer) {
    const starts = [];
    for (let d = 0; d < 8; d++) {
      if (RL.axisAt(g, x, y, d)) starts.push({ x, y, d, cost: prefer !== undefined && d !== prefer ? 0.5 : 0 });
    }
    if (!starts.length) for (let d = 0; d < 8; d++) starts.push({ x, y, d, cost: prefer !== undefined && d !== prefer ? 1.5 : 0 });
    return starts;
  };
  RL.snapPoint = (wx, wy) => [Math.round(wx / 2) * 2, Math.round(wy / 2) * 2];

  // -------------------------------------------------- signals, stops, blocks
  // Heading leaving point (x, y) along piece p, or -1 if p does not end there.
  RL.leaveAt = (p, x, y) => (p.ax === x && p.ay === y ? p.ah : p.bx === x && p.by === y ? opp8(p.bh) : -1);
  // Do a and b meet at a point along the same axis (end to end, or forking)?
  function axisJoin(a, b, endOnly) {
    for (const [x, y] of [[a.ax, a.ay], [a.bx, a.by]]) {
      const ha = RL.leaveAt(a, x, y), hb = RL.leaveAt(b, x, y);
      if (hb < 0) continue;
      if (ha === opp8(hb) || (!endOnly && ha === hb)) return true;
    }
    return false;
  }
  RL.endToEnd = (a, b) => axisJoin(a, b, true);

  // Signals and stops stand on a tile to the right of the track, just before the rail
  // point they guard. The point follows from the tile and the rail heading rd.
  const sideOffset = (d) => { const ur = unit((d + 2) & 7), ud = unit(d); return [ur[0] * 1.55 - ud[0] * 0.55, ur[1] * 1.55 - ud[1] * 0.55]; };
  RL.attachPoint = function (tx, ty, d) {
    const o = sideOffset(d);
    return [Math.round((tx + 0.5 - o[0]) / 2) * 2, Math.round((ty + 0.5 - o[1]) / 2) * 2];
  };
  RL.sideTile = function (px, py, d) {
    const o = sideOffset(d);
    return [Math.floor(px + o[0]), Math.floor(py + o[1])];
  };
  // Best spot beside the track near a world point: { px, py, pd, tx, ty } or null.
  RL.snapSide = function (g, wx, wy) {
    const [sx, sy] = RL.snapPoint(wx, wy);
    let best = null, bd = 2.2;
    for (let py = sy - 2; py <= sy + 2; py += 2) for (let px = sx - 2; px <= sx + 2; px += 2) {
      if (!RL.hasPoint(g, px, py)) continue;
      for (let d = 0; d < 8; d++) {
        if (!RL.axisAt(g, px, py, d)) continue;
        const o = sideOffset(d);
        const cx = px + o[0], cy = py + o[1];
        const dist = Math.hypot(cx - wx, cy - wy);
        if (dist < bd) { bd = dist; best = { px, py, pd: d, tx: Math.floor(cx), ty: Math.floor(cy) }; }
      }
    }
    return best;
  };
  RL.isSideKind = (k) => k === 'signal' || k === 'trainstop';

  RL.recompute = function (g) {
    const R = g.rail;
    R.signals = new Map();
    R.signalPoints = new Set();
    R.stopsAt = new Map();
    const attach = (e) => {
      const [px, py] = RL.attachPoint(e.x, e.y, e.rd || 0);
      e.px = px; e.py = py;
      e.attached = RL.axisAt(g, px, py, e.rd || 0);
      return e.attached;
    };
    for (const e of g.byKind.signal || []) {
      if (!attach(e)) continue;
      R.signals.set(stateKey(e.px, e.py, e.rd), e);
      R.signalPoints.add(pointKey(e.px, e.py));
    }
    for (const e of g.byKind.trainstop || []) if (attach(e)) push(R.stopsAt, stateKey(e.px, e.py, e.rd), e);
    // Blocks: track joined at unsignalled points, plus track that overlaps. At a signal,
    // pieces leaving the point the same way stay together; the two sides split.
    const parent = new Map();
    for (const id of R.pieces.keys()) parent.set(id, id);
    const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); };
    for (const [pk, list] of R.atPoint) {
      if (!R.signalPoints.has(pk)) { for (let i = 1; i < list.length; i++) union(list[0].id, list[i].id); continue; }
      const x = pk & 2047, y = pk >> 11;
      const side = new Map();
      for (const pc of list) {
        const h = RL.leaveAt(pc, x, y);
        if (side.has(h)) union(side.get(h), pc.id); else side.set(h, pc.id);
      }
    }
    R.conf = new Map();
    const addConf = (a, b) => { let s = R.conf.get(a); if (!s) R.conf.set(a, (s = new Set())); s.add(b); };
    for (const s of R.tilePieces.values()) {
      if (s.size < 2) continue;
      const ids = Array.from(s);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = R.pieces.get(ids[i]), b = R.pieces.get(ids[j]);
        if (!axisJoin(a, b, false)) union(a.id, b.id);
        if (!axisJoin(a, b, true)) { addConf(a.id, b.id); addConf(b.id, a.id); }
      }
    }
    R.blockOf = new Map();
    for (const id of R.pieces.keys()) R.blockOf.set(id, find(id));
  };

  // Travelling heading d through point (x, y): forbidden when only the opposite way is signalled.
  RL.oneWayBlocked = function (g, x, y, d) {
    const R = g.rail;
    if (!R.signalPoints.has(pointKey(x, y))) return false;
    return R.signals.has(stateKey(x, y, opp8(d))) && !R.signals.has(stateKey(x, y, d));
  };

  // ------------------------------------------------------------- ghosts
  // Planned track waiting for drones (or for the player to bring rails).
  RL.addGhost = function (g, ax, ay, ah, t) {
    const key = RL.pieceKeyOf(ax, ay, ah, t);
    const G = g.rail.ghosts;
    if (G.has(key) || g.rail.byKey.has(key)) return null;
    const pc = RL.makePiece(ax, ay, ah, t);
    if (!RL.pieceClear(g, pc)) return null;
    G.set(key, pc);
    return pc;
  };
  // Planned piece whose centre line passes near a world point.
  RL.ghostNear = function (g, wx, wy, maxDist) {
    let best = null, bd = maxDist || 1;
    for (const pc of g.rail.ghosts.values()) {
      if (Math.min(pc.ax, pc.bx) - 2 > wx || Math.max(pc.ax, pc.bx) + 2 < wx || Math.min(pc.ay, pc.by) - 2 > wy || Math.max(pc.ay, pc.by) + 2 < wy) continue;
      for (const [x, y] of pc.pts) {
        const d = Math.hypot(x - wx, y - wy);
        if (d < bd) { bd = d; best = { pc, dist: d }; }
      }
      if (pc.t === 'S') {
        // Straight pieces have only two points: measure to the segment.
        const dx = pc.bx - pc.ax, dy = pc.by - pc.ay, l2 = dx * dx + dy * dy;
        const t = FG.clamp(((wx - pc.ax) * dx + (wy - pc.ay) * dy) / l2, 0, 1);
        const d = Math.hypot(pc.ax + dx * t - wx, pc.ay + dy * t - wy);
        if (d < bd) { bd = d; best = { pc, dist: d }; }
      }
    }
    return best;
  };
  RL.removeGhostsIn = function (g, x0, y0, x1, y1) {
    let n = 0;
    for (const [k, pc] of g.rail.ghosts) {
      const mx = (pc.ax + pc.bx) / 2, my = (pc.ay + pc.by) / 2;
      if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1) { g.rail.ghosts.delete(k); n++; }
    }
    return n;
  };

  // ------------------------------------------------------------- saving
  const pack = (pc) => [pc.ax, pc.ay, pc.ah, pc.t];
  RL.serialize = (g) => ({ pieces: Array.from(g.rail.pieces.values()).map(pack), ghosts: Array.from(g.rail.ghosts.values()).map(pack) });
  RL.deserialize = function (g, data) {
    if (!data) return;
    for (const [ax, ay, ah, t] of data.pieces || []) RL.add(g, RL.makePiece(ax, ay, ah, t));
    for (const [ax, ay, ah, t] of data.ghosts || []) RL.addGhost(g, ax, ay, ah, t);
  };
})();
