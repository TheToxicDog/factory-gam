// Cogworks Frontier — railways. Track is a grid of rail tiles joined only where it was
// laid (mask bits N/E/S/W). Trains follow a list of tiles, reserve the track ahead of them,
// and obey signal blocks: an automatic train may only enter a block no other train holds.
(function () {
  'use strict';
  const D = FG.data;
  const DX = FG.DX, DY = FG.DY;
  const T = (FG.trains = {});

  const PITCH = 3; // distance between car fronts
  const CAR_LEN = 2.4;
  const GAP = PITCH - CAR_LEN;
  const MAX_SPEED = 0.3; // tiles per tick
  const BRAKE = 0.008; // tiles per tick^2
  const ACCEL = 0.004;
  const LOCO_KW = 600;
  const WAGON_SLOTS = 20, LOCO_SLOTS = 3;
  Object.assign(T, { PITCH, CAR_LEN, GAP, MAX_SPEED, BRAKE, WAGON_SLOTS, LOCO_SLOTS });

  const key = (g, x, y) => y * g.world.W + x;
  const roleOf = (e) => D.protos[e.p].role;
  const isSignal = (e) => { const r = roleOf(e); return r === 'signal' || r === 'chain'; };
  T.isSignal = isSignal;

  T.init = function (g) {
    g.rail = {
      trains: [], res: new Map(), blockOf: new Map(), claims: new Map(),
      nextTrain: 1, nextCar: 1, carTiles: new Map(), stopCounter: 0, dirty: true,
    };
  };

  // ---------------------------------------------------------------- track
  T.railAt = function (g, x, y) {
    const e = FG.entAt(g, x, y);
    return e && D.protos[e.p].kind === 'rail' ? e : null;
  };
  // The rail connected to `a` in direction d, if the track is joined both ways.
  T.linked = function (g, a, d) {
    if (!a || !(a.mask & (1 << d))) return null;
    const b = T.railAt(g, a.x + DX[d], a.y + DY[d]);
    return b && b.mask & (1 << FG.opposite(d)) ? b : null;
  };
  const dirBetween = (a, b) => (b.x > a.x ? 1 : b.x < a.x ? 3 : b.y > a.y ? 2 : 0);
  T.connect = function (g, a, b) {
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
    const d = dirBetween(a, b);
    a.mask |= 1 << d;
    b.mask |= 1 << FG.opposite(d);
    g.rail.dirty = true;
    return true;
  };
  // Join a newly placed piece to dead-end track along the build axis.
  T.autoConnect = function (g, e, dir) {
    for (const d of [dir & 3, FG.opposite(dir & 3)]) {
      const n = T.railAt(g, e.x + DX[d], e.y + DY[d]);
      if (!n) continue;
      const bits = popcount(n.mask);
      if (bits <= 1 && !(n.mask & (1 << FG.opposite(d)))) T.connect(g, e, n);
    }
  };
  function popcount(m) { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }
  T.popcount = popcount;

  T.onRailRemoved = function (g, e) {
    for (let d = 0; d < 4; d++) {
      const n = T.railAt(g, e.x + DX[d], e.y + DY[d]);
      if (n && n !== e) n.mask &= ~(1 << FG.opposite(d));
    }
    g.rail.dirty = true;
  };

  // Is a rail tile under (or reserved by) a train?
  T.tileBusy = function (g, x, y) { return g.rail.res.has(key(g, x, y)); };

  // --------------------------------------------------------------- blocks
  function recomputeBlocks(g) {
    const R = g.rail;
    R.blockOf = new Map();
    let id = 1;
    for (const e of g.byKind.rail || []) {
      const k0 = key(g, e.x, e.y);
      if (R.blockOf.has(k0)) continue;
      const bid = id++;
      R.blockOf.set(k0, bid);
      if (isSignal(e)) continue; // every signal is a one-tile block of its own
      const stack = [e];
      while (stack.length) {
        const c = stack.pop();
        for (let d = 0; d < 4; d++) {
          const n = T.linked(g, c, d);
          if (!n || isSignal(n)) continue;
          const nk = key(g, n.x, n.y);
          if (R.blockOf.has(nk)) continue;
          R.blockOf.set(nk, bid);
          stack.push(n);
        }
      }
    }
  }

  function claim(R, tr, bid) {
    let s = R.claims.get(bid);
    if (!s) R.claims.set(bid, (s = new Set()));
    s.add(tr.id);
  }
  function unclaim(R, tr, bid) {
    const s = R.claims.get(bid);
    if (!s) return;
    s.delete(tr.id);
    if (!s.size) R.claims.delete(bid);
  }
  function blockFree(R, tr, bid) {
    const s = R.claims.get(bid);
    if (!s) return true;
    for (const id of s) if (id !== tr.id) return false;
    return true;
  }
  T.blockState = function (g, x, y) {
    const R = g.rail;
    const bid = R.blockOf.get(key(g, x, y));
    if (!bid || !R.claims.has(bid)) return 'free';
    return R.res.has(key(g, x, y)) ? 'occupied' : 'reserved';
  };

  function reserveTile(g, tr, t) {
    const R = g.rail, k = key(g, t.x, t.y);
    R.res.set(k, tr.id);
    const bid = R.blockOf.get(k);
    if (!bid) return;
    tr.blocks.set(bid, (tr.blocks.get(bid) || 0) + 1);
    tr.pre.delete(bid);
    claim(R, tr, bid);
  }
  function releaseTile(g, tr, t) {
    const R = g.rail, k = key(g, t.x, t.y);
    if (R.res.get(k) === tr.id && !tr.tiles.some((o) => o !== t && o.x === t.x && o.y === t.y)) R.res.delete(k);
    const bid = R.blockOf.get(k);
    if (!bid || !tr.blocks.has(bid)) return;
    const c = tr.blocks.get(bid) - 1;
    if (c <= 0) {
      tr.blocks.delete(bid);
      if (!tr.pre.has(bid)) unclaim(R, tr, bid);
    } else tr.blocks.set(bid, c);
  }
  function releasePre(g, tr) {
    for (const b of tr.pre) if (!tr.blocks.has(b)) unclaim(g.rail, tr, b);
    tr.pre.clear();
  }

  // Rebuild every reservation and claim from the trains' tile lists.
  function rebuildAll(g) {
    const R = g.rail;
    R.res = new Map();
    R.claims = new Map();
    for (const tr of R.trains) {
      tr.blocks = new Map();
      tr.pre = new Set();
      for (const t of tr.tiles) reserveTile(g, tr, t);
    }
  }

  // --------------------------------------------------------------- geometry
  function tileLen(t) { return t.hin === t.hout ? 1 : Math.PI / 4; }
  function relayout(tr) {
    let s = 0;
    for (const t of tr.tiles) { t.len = tileLen(t); t.s0 = s; s += t.len; }
    tr.endS = s;
  }
  function tileIndexAt(tr, s) {
    const tl = tr.tiles;
    let lo = 0, hi = tl.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tl[mid].s0 <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  // World position at distance s along a train's track.
  function pointAt(tr, s, out) {
    out = out || [0, 0];
    const t = tr.tiles[tileIndexAt(tr, s)];
    const f = FG.clamp((s - t.s0) / t.len, 0, 1);
    const cx = t.x + 0.5, cy = t.y + 0.5;
    if (t.hin === t.hout) {
      out[0] = cx + DX[t.hin] * (f - 0.5);
      out[1] = cy + DY[t.hin] * (f - 0.5);
      return out;
    }
    const px = cx - DX[t.hin] * 0.5 + DX[t.hout] * 0.5, py = cy - DY[t.hin] * 0.5 + DY[t.hout] * 0.5;
    const ex = cx - DX[t.hin] * 0.5, ey = cy - DY[t.hin] * 0.5;
    const xx = cx + DX[t.hout] * 0.5, xy = cy + DY[t.hout] * 0.5;
    const a0 = Math.atan2(ey - py, ex - px);
    let da = Math.atan2(xy - py, xx - px) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const a = a0 + da * f;
    out[0] = px + Math.cos(a) * 0.5;
    out[1] = py + Math.sin(a) * 0.5;
    return out;
  }
  T.pointAt = pointAt;
  T.trainLen = (tr) => tr.cars.length * PITCH - GAP;

  // Front and back points of car i.
  T.carPose = function (tr, i) {
    const f = tr.headS - i * PITCH, b = f - CAR_LEN;
    const pf = pointAt(tr, f), pb = pointAt(tr, b);
    return { fx: pf[0], fy: pf[1], bx: pb[0], by: pb[1], x: (pf[0] + pb[0]) / 2, y: (pf[1] + pb[1]) / 2, angle: Math.atan2(pf[1] - pb[1], pf[0] - pb[0]) };
  };

  // ---------------------------------------------------------------- trains
  function newTrain(g) {
    const tr = {
      id: g.rail.nextTrain++, cars: [], tiles: [], headS: 0, endS: 0, speed: 0,
      mode: 'manual', schedule: [], cur: 0, state: 'idle', wait: 0, idle: 0, lastCargo: '',
      route: null, arrive: false, blocks: new Map(), pre: new Set(), energy: 0, arrivals: 0,
      stuck: 0, retryAt: 0, ctrl: { throttle: 0, steer: 0 }, revHold: 0, blocked: null, msg: null,
    };
    g.rail.trains.push(tr);
    return tr;
  }
  function newCar(g, type) {
    return { id: g.rail.nextCar++, type, inv: new FG.Inventory(type === 'loco' ? LOCO_SLOTS : WAGON_SLOTS), flip: false, hp: type === 'loco' ? 1000 : 600 };
  }
  T.itemFor = (car) => (car.type === 'loco' ? 'locomotive' : 'cargo_wagon');

  // Continue along the track from tile t (leaving through t.hout). Prefers straight.
  function nextTile(g, t, steer) {
    const a = T.railAt(g, t.x, t.y);
    const nb = T.linked(g, a, t.hout);
    if (!nb) return null;
    const hin = t.hout;
    const order = steer < 0 ? [FG.leftOf(hin), hin, FG.rightOf(hin)] : steer > 0 ? [FG.rightOf(hin), hin, FG.leftOf(hin)] : [hin, FG.leftOf(hin), FG.rightOf(hin)];
    let hout = hin, end = true;
    for (const d of order) if (T.linked(g, nb, d)) { hout = d; end = false; break; }
    return { x: nb.x, y: nb.y, hin, hout, end, e: nb };
  }
  // Step backwards from tile t (entering it through t.hin): the tile before it.
  function prevTile(g, t) {
    const a = T.railAt(g, t.x, t.y);
    const back = FG.opposite(t.hin);
    const nb = T.linked(g, a, back);
    if (!nb) return null;
    const r = back;
    for (const d of [r, FG.leftOf(r), FG.rightOf(r)]) {
      if (T.linked(g, nb, d)) return { x: nb.x, y: nb.y, hin: FG.opposite(d), hout: t.hin };
    }
    return { x: nb.x, y: nb.y, hin: t.hin, hout: t.hin };
  }

  // Can a car go at (x, y)? Returns { ok, reason, attach: {train, front} | null, tiles }
  T.planCar = function (g, x, y, dir) {
    const e = T.railAt(g, x, y);
    if (!e) return { ok: false, reason: 'Place it on a rail' };
    if (T.tileBusy(g, x, y)) return { ok: false, reason: 'A train is already there' };
    // Couple to a stopped train whose end is next to this tile.
    for (const tr of g.rail.trains) {
      if (tr.speed !== 0) continue;
      const head = pointAt(tr, tr.headS), tail = pointAt(tr, tr.headS - T.trainLen(tr));
      const cx = x + 0.5, cy = y + 0.5;
      if (FG.dist2(cx, cy, head[0], head[1]) < 2.4 * 2.4) return { ok: true, attach: { train: tr, front: true } };
      if (FG.dist2(cx, cy, tail[0], tail[1]) < 2.4 * 2.4) return { ok: true, attach: { train: tr, front: false } };
    }
    const SHORT = { ok: false, reason: 'Lay more track first: a car needs 3 tiles' };
    let h = -1;
    for (const d of [dir & 3, FG.rightOf(dir), FG.leftOf(dir), FG.opposite(dir)]) if (T.linked(g, e, d)) { h = d; break; }
    if (h < 0) return SHORT;
    // The car faces h; it enters this tile from another connected side (straight if possible).
    let entry = -1;
    for (const d of [FG.opposite(h), FG.leftOf(h), FG.rightOf(h)]) if (T.linked(g, e, d)) { entry = d; break; }
    const mid = { x: e.x, y: e.y, hin: entry >= 0 ? FG.opposite(entry) : h, hout: h };
    const f1 = nextTile(g, mid, 0);
    if (!f1) return SHORT;
    if (entry >= 0) {
      const pb = prevTile(g, mid);
      if (!pb) return SHORT;
      return checkTiles(g, [pb, mid, f1]);
    }
    // Dead end behind this tile: shift the car one tile forward.
    if (f1.end) return SHORT;
    const f2 = nextTile(g, f1, 0);
    if (!f2) return SHORT;
    return checkTiles(g, [mid, f1, f2]);
  };
  function checkTiles(g, tiles) {
    for (const t of tiles) if (T.tileBusy(g, t.x, t.y)) return { ok: false, reason: 'A train is in the way' };
    return { ok: true, tiles: tiles.map((t) => ({ x: t.x, y: t.y, hin: t.hin, hout: t.hout })) };
  }

  T.placeCar = function (g, type, x, y, dir) {
    const plan = T.planCar(g, x, y, dir);
    if (!plan.ok) return plan;
    const car = newCar(g, type);
    if (plan.attach) {
      const tr = plan.attach.train;
      // Face the way the player is pointing, relative to the train's direction.
      const s = plan.attach.front ? tr.headS : tr.headS - T.trainLen(tr);
      const a = pointAt(tr, s - 0.25), b = pointAt(tr, s + 0.25);
      car.flip = (b[0] - a[0]) * DX[dir & 3] + (b[1] - a[1]) * DY[dir & 3] < 0;
      if (!attachCar(g, tr, car, plan.attach.front)) return { ok: false, reason: 'Not enough track to couple there' };
      return { ok: true, train: tr, car };
    }
    const tr = newTrain(g);
    tr.tiles = plan.tiles;
    relayout(tr);
    tr.headS = tr.endS - GAP / 2;
    tr.cars.push(car);
    for (const t of tr.tiles) reserveTile(g, tr, t);
    return { ok: true, train: tr, car };
  };

  function attachCar(g, tr, car, front) {
    truncate(g, tr);
    if (front) {
      // Extend the track ahead by PITCH.
      const added = [];
      let need = tr.headS + PITCH - tr.endS;
      let last = tr.tiles[tr.tiles.length - 1];
      while (need > 1e-6) {
        const n = nextTile(g, last, 0);
        if (!n || T.tileBusy(g, n.x, n.y)) { for (const t of added) { tr.tiles.pop(); releaseTile(g, tr, t); } relayout(tr); return false; }
        last.hout = n.hin;
        const t = { x: n.x, y: n.y, hin: n.hin, hout: n.hout };
        tr.tiles.push(t);
        added.push(t);
        relayout(tr);
        reserveTile(g, tr, t);
        need = tr.headS + PITCH - tr.endS;
        last = t;
      }
      tr.headS += PITCH;
      tr.cars.unshift(car);
    } else {
      let tailS = tr.headS - T.trainLen(tr) - PITCH;
      while (tailS < 0) {
        const p = prevTile(g, tr.tiles[0]);
        if (!p || T.tileBusy(g, p.x, p.y)) return false;
        const t = { x: p.x, y: p.y, hin: p.hin, hout: p.hout };
        tr.tiles.unshift(t);
        relayout(tr);
        const L = t.len;
        tr.headS += L;
        tailS += L;
        reserveTile(g, tr, t);
      }
      tr.cars.push(car);
    }
    tr.route = null;
    return true;
  }

  // Drop reserved tiles beyond the head (only while stopped or replanning).
  function truncate(g, tr) {
    const hi = tileIndexAt(tr, tr.headS - 1e-6);
    while (tr.tiles.length - 1 > hi) releaseTile(g, tr, tr.tiles.pop());
    const last = tr.tiles[tr.tiles.length - 1];
    last.end = false; last.dest = false;
    relayout(tr);
    releasePre(g, tr);
    tr.arrive = false;
  }

  function releaseBehind(g, tr) {
    let tailS = tr.headS - T.trainLen(tr);
    while (tr.tiles.length > 1 && tr.tiles[0].s0 + tr.tiles[0].len <= tailS - 1e-6) {
      const t = tr.tiles.shift();
      releaseTile(g, tr, t);
      const L = t.len;
      tr.headS -= L;
      tailS -= L;
      for (const o of tr.tiles) o.s0 -= L;
      tr.endS -= L;
    }
  }

  function reverseTrain(g, tr) {
    truncate(g, tr);
    const tailS = tr.headS - T.trainLen(tr);
    tr.tiles.reverse();
    for (const t of tr.tiles) { const hin = FG.opposite(t.hout); t.hout = FG.opposite(t.hin); t.hin = hin; t.end = false; t.dest = false; }
    relayout(tr);
    tr.headS = tr.endS - tailS;
    tr.cars.reverse();
    for (const c of tr.cars) c.flip = !c.flip;
    tr.route = null;
    releaseBehind(g, tr);
  }
  T.reverse = function (g, tr) { if (tr.speed === 0) reverseTrain(g, tr); };

  function destroyTrain(g, tr) {
    for (const t of tr.tiles) releaseTile(g, tr, t);
    releasePre(g, tr);
    const R = g.rail;
    R.trains.splice(R.trains.indexOf(tr), 1);
    tr.dead = true;
    if (g.player.vehicle === tr.id) T.exit(g);
  }

  // Remove car at index i: shrinks or splits the train.
  T.removeCar = function (g, tr, i) {
    if (tr.cars.length === 1) { destroyTrain(g, tr); return; }
    if (i === 0) {
      tr.cars.shift();
      tr.headS -= PITCH;
      truncate(g, tr);
      tr.route = null;
      if (tr.state === 'moving') tr.state = 'plan';
      return;
    }
    if (i === tr.cars.length - 1) { tr.cars.pop(); releaseBehind(g, tr); return; }
    const back = newTrain(g);
    back.cars = tr.cars.slice(i + 1);
    back.tiles = tr.tiles.map((t) => ({ x: t.x, y: t.y, hin: t.hin, hout: t.hout }));
    relayout(back);
    back.headS = tr.headS - (i + 1) * PITCH;
    back.speed = 0;
    tr.cars = tr.cars.slice(0, i);
    tr.speed = 0;
    tr.route = null;
    if (tr.state === 'moving') tr.state = 'plan';
    // Trim each train to its own stretch of track, then rebuild reservations.
    const hi = tileIndexAt(back, back.headS - 1e-6);
    back.tiles.length = hi + 1;
    relayout(back);
    rebuildAll(g);
    releaseBehind(g, tr);
    releaseBehind(g, back);
    rebuildAll(g);
  };

  // --------------------------------------------------------------- driving
  function neededBlocks(g, tr, nb) {
    const R = g.rail;
    const first = R.blockOf.get(key(g, nb.x, nb.y));
    const out = [first];
    if (!isSignal(nb)) return out;
    let chain = roleOf(nb) === 'chain';
    let lastB = first;
    const route = tr.route || [];
    for (let i = 1; i < route.length; i++) {
      const [x, y] = route[i];
      const b = R.blockOf.get(key(g, x, y));
      if (b === lastB) continue;
      const e = T.railAt(g, x, y);
      if (e && isSignal(e)) {
        if (!chain) break;
        out.push(b); lastB = b;
        chain = roleOf(e) === 'chain';
        continue;
      }
      out.push(b); lastB = b;
      if (!chain) break;
    }
    return out;
  }

  // Try to add the next tile of track in front of the train.
  function appendNext(g, tr, manual) {
    const R = g.rail;
    const last = tr.tiles[tr.tiles.length - 1];
    if (last.end) return false;
    const a = T.railAt(g, last.x, last.y);
    const nb = T.linked(g, a, last.hout);
    if (!nb) { last.end = true; return false; }
    if (!manual) {
      if (!tr.route || !tr.route.length) return false;
      const r = tr.route[0];
      if (r[0] !== nb.x || r[1] !== nb.y) { tr.route = null; return false; }
    }
    const k = key(g, nb.x, nb.y);
    const owner = R.res.get(k);
    if (owner !== undefined && owner !== tr.id) { tr.blocked = 'train'; return false; }
    if (!manual) {
      const bid = R.blockOf.get(k), cur = R.blockOf.get(key(g, last.x, last.y));
      if (bid !== cur && !tr.blocks.has(bid) && !tr.pre.has(bid)) {
        const need = neededBlocks(g, tr, nb);
        for (const b of need) if (!blockFree(R, tr, b)) { tr.blocked = 'signal'; return false; }
        for (const b of need) { if (!tr.blocks.has(b)) tr.pre.add(b); claim(R, tr, b); }
      }
    }
    const hin = last.hout;
    let hout = hin, end = false, dest = false;
    if (!manual) {
      tr.route.shift();
      const r2 = tr.route[0];
      if (r2) hout = dirBetween(nb, { x: r2[0], y: r2[1] });
      else { end = true; dest = true; }
    } else {
      const n = nextTile(g, last, tr.ctrl.steer);
      hout = n.hout; end = n.end;
    }
    const t = { x: nb.x, y: nb.y, hin, hout, end, dest };
    t.len = tileLen(t);
    t.s0 = tr.endS;
    tr.endS += t.len;
    tr.tiles.push(t);
    reserveTile(g, tr, t);
    tr.blocked = null;
    if (dest) tr.arrive = true;
    return true;
  }

  // Cars store `flip` when they face against the train's current direction.
  function locosOf(tr) { return tr.cars.filter((c) => c.type === 'loco' && !c.flip); }
  T.canForward = (tr) => tr.cars.some((c) => c.type === 'loco' && !c.flip);
  T.canReverse = (tr) => tr.cars.some((c) => c.type === 'loco' && c.flip);
  T.flipCar = function (g, tr, i) {
    if (tr.speed !== 0 || !tr.cars[i]) return false;
    tr.cars[i].flip = !tr.cars[i].flip;
    tr.route = null;
    if (tr.state === 'moving') tr.state = 'plan';
    return true;
  };

  function burn(g, tr, kj) {
    if (tr.energy >= kj) { tr.energy -= kj; return true; }
    for (const c of tr.cars) {
      if (c.type !== 'loco') continue;
      for (const s of c.inv.slots) {
        if (!s || !D.items[s.id].fuel) continue;
        tr.energy += D.items[s.id].fuel;
        g.stats.consume(s.id, 1);
        c.inv.remove(s.id, 1);
        tr.energy -= kj;
        return true;
      }
    }
    return false;
  }
  T.fuelOf = function (tr) {
    let n = 0;
    for (const c of tr.cars) if (c.type === 'loco') for (const s of c.inv.slots) if (s && D.items[s.id].fuel) n += s.n;
    return n;
  };

  function cargoKey(tr) {
    let s = '';
    for (const c of tr.cars) if (c.type === 'wagon') for (const x of c.inv.slots) s += x ? x.id + x.n + ',' : '-,';
    return s;
  }
  function cargoFull(tr) {
    let any = false;
    for (const c of tr.cars) {
      if (c.type !== 'wagon') continue;
      any = true;
      for (const s of c.inv.slots) if (!s || s.n < D.items[s.id].stack) return false;
    }
    return any;
  }
  function cargoEmpty(tr) {
    for (const c of tr.cars) if (c.type === 'wagon' && !c.inv.isEmpty()) return false;
    return true;
  }
  T.cargoTotals = function (tr) {
    const t = {};
    for (const c of tr.cars) if (c.type === 'wagon') for (const s of c.inv.slots) if (s) t[s.id] = (t[s.id] || 0) + s.n;
    return t;
  };

  T.stopsNamed = function (g, name) {
    return (g.byKind.rail || []).filter((e) => roleOf(e) === 'stop' && e.name === name);
  };
  T.stopNames = function (g) {
    const set = new Set();
    for (const e of g.byKind.rail || []) if (roleOf(e) === 'stop') set.add(e.name);
    return Array.from(set).sort();
  };

  // Shortest route to any stop with the scheduled name. May reverse a stopped train.
  function plan(g, tr, avoidTrains) {
    const R = g.rail;
    const entry = tr.schedule[tr.cur];
    if (!entry) { tr.state = 'no_schedule'; return false; }
    const targets = new Set(T.stopsNamed(g, entry.station).map((e) => key(g, e.x, e.y)));
    if (!targets.size) { tr.state = 'no_path'; tr.msg = 'No stop named “' + entry.station + '”'; tr.retryAt = g.tick + 120; return false; }
    if (tr.speed === 0) truncate(g, tr);
    const H = tr.tiles[tr.tiles.length - 1];
    if (targets.has(key(g, H.x, H.y)) && tr.headS >= tr.endS - 0.05) { arrive(g, tr); return true; }
    // A stop already under the train counts as arrived.
    if (tr.speed === 0) {
      const lo = tileIndexAt(tr, tr.headS - T.trainLen(tr) + 0.05);
      for (let i = lo; i < tr.tiles.length; i++) if (targets.has(key(g, tr.tiles[i].x, tr.tiles[i].y))) { arrive(g, tr); return true; }
    }
    const starts = [];
    const f = T.canForward(tr) && T.linked(g, T.railAt(g, H.x, H.y), H.hout);
    if (f) starts.push({ x: f.x, y: f.y, hin: H.hout, cost: 0, rev: false });
    if (tr.speed === 0 && T.canReverse(tr)) {
      const T0 = tr.tiles[0];
      const r = FG.opposite(T0.hin);
      const b = T.linked(g, T.railAt(g, T0.x, T0.y), r);
      if (b) starts.push({ x: b.x, y: b.y, hin: r, cost: 3, rev: true });
      // A train sitting on its target stop in reverse can also just flip.
      if (targets.has(key(g, T0.x, T0.y)) && !f) starts.push({ flipOnly: true, cost: 1, rev: true });
    }
    const heap = new FG.Heap();
    const best = new Map();
    const prev = new Map();
    const W = g.world.W;
    for (const s of starts) {
      if (s.flipOnly) continue;
      const id = key(g, s.x, s.y) * 4 + s.hin;
      if (!best.has(id) || best.get(id) > s.cost) { best.set(id, s.cost); prev.set(id, s.rev ? -2 : -1); heap.push(s.cost, id); }
    }
    let goal = -1, iter = 0;
    const done = new Set();
    while (heap.size && iter++ < 400000) {
      const id = heap.pop();
      if (done.has(id)) continue;
      done.add(id);
      const tk = id >> 2, hin = id & 3;
      if (targets.has(tk)) { goal = id; break; }
      const x = tk % W, y = (tk / W) | 0;
      const e = T.railAt(g, x, y);
      const c0 = best.get(id);
      for (const d of [hin, FG.leftOf(hin), FG.rightOf(hin)]) {
        const n = T.linked(g, e, d);
        if (!n) continue;
        const nk = key(g, n.x, n.y);
        let c = c0 + (d === hin ? 1 : 1.3);
        if (avoidTrains) { const o = R.res.get(nk); if (o !== undefined && o !== tr.id) c += 40; }
        const nid = nk * 4 + d;
        if (!best.has(nid) || c < best.get(nid)) { best.set(nid, c); prev.set(nid, id); heap.push(c, nid); }
      }
    }
    if (goal < 0) {
      if (starts.some((s) => s.flipOnly)) { reverseTrain(g, tr); arrive(g, tr); return true; }
      tr.state = 'no_path';
      tr.msg = T.canReverse(tr) ? 'No track leads to “' + entry.station + '”'
        : 'No way forward to “' + entry.station + '”. Build a loop, or add a locomotive facing backwards';
      tr.retryAt = g.tick + 120;
      return false;
    }
    const path = [];
    let id = goal, rev = false;
    for (;;) {
      const tk = id >> 2;
      path.push([tk % W, (tk / W) | 0]);
      const p = prev.get(id);
      if (p < 0) { rev = p === -2; break; }
      id = p;
    }
    path.reverse();
    if (rev) reverseTrain(g, tr);
    tr.route = path;
    tr.state = 'moving';
    tr.msg = null;
    tr.stuck = 0;
    return true;
  }

  function arrive(g, tr) {
    tr.state = 'station';
    tr.speed = 0;
    tr.wait = 0;
    tr.idle = 0;
    tr.lastCargo = cargoKey(tr);
    tr.arrivals++;
    tr.route = null;
    tr.arrive = false;
    releasePre(g, tr);
  }

  function waitDone(tr) {
    const e = tr.schedule[tr.cur];
    if (!e) return true;
    switch (e.cond) {
      case 'full': return cargoFull(tr);
      case 'empty': return cargoEmpty(tr);
      case 'time': return tr.wait >= (e.v || 10) * FG.TICKS;
      case 'inactive': return tr.idle >= (e.v || 5) * FG.TICKS;
    }
    return true;
  }

  function autoLogic(g, tr) {
    if (!tr.schedule.length) { tr.state = 'no_schedule'; return; }
    if (tr.cur >= tr.schedule.length) tr.cur = 0;
    switch (tr.state) {
      case 'station': {
        tr.wait++;
        const ck = cargoKey(tr);
        if (ck !== tr.lastCargo) { tr.lastCargo = ck; tr.idle = 0; } else tr.idle++;
        if (waitDone(tr)) {
          tr.cur = (tr.cur + 1) % tr.schedule.length;
          plan(g, tr, false);
        }
        return;
      }
      case 'moving':
        if (!tr.route && !tr.arrive && tr.speed === 0) plan(g, tr, false);
        return;
      case 'no_path':
        if (g.tick >= tr.retryAt && tr.speed === 0) plan(g, tr, false);
        return;
      default:
        if (tr.speed === 0) plan(g, tr, false);
    }
  }

  function updateTrain(g, tr) {
    const locos = locosOf(tr);
    const manual = tr.mode === 'manual';
    if (!manual) autoLogic(g, tr);
    let wantMove;
    if (manual) {
      if (tr.state !== 'manual') {
        tr.state = 'manual'; tr.route = null; tr.arrive = false; releasePre(g, tr);
        const last = tr.tiles[tr.tiles.length - 1];
        last.end = false; last.dest = false;
      }
      const c = tr.ctrl;
      if (c.throttle < 0 && tr.speed === 0) {
        if (++tr.revHold === 18) {
          if (T.canReverse(tr)) reverseTrain(g, tr);
          else g.msg('No locomotive faces backwards on this train', 'warn');
        }
      } else tr.revHold = 0;
      wantMove = c.throttle > 0;
    } else wantMove = tr.state === 'moving';
    if (!locos.length) wantMove = false;
    if (wantMove) {
      const need = (tr.speed * tr.speed) / (2 * BRAKE) + tr.speed + 1.2;
      let guard = 0;
      while (tr.endS - tr.headS < need && guard++ < 16) if (!appendNext(g, tr, manual)) break;
    }
    const stopS = tr.endS;
    let target = wantMove ? MAX_SPEED : 0;
    target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(0, stopS - tr.headS)));
    tr.noFuel = false;
    if (tr.speed < target - 1e-9) {
      const a = ACCEL * Math.min(1, (locos.length * 2.5) / tr.cars.length);
      if (burn(g, tr, (LOCO_KW / FG.TICKS) * locos.length)) tr.speed = Math.min(target, tr.speed + a);
      else tr.noFuel = true;
    } else if (tr.speed > target) {
      const dec = manual && tr.ctrl.throttle === 0 && target > 0 ? 0.001 : BRAKE;
      tr.speed = Math.max(target, tr.speed - dec);
    } else if (tr.speed > 0 && tr.speed >= MAX_SPEED - 1e-9) burn(g, tr, (LOCO_KW / FG.TICKS / 4) * locos.length);
    tr.headS = Math.min(tr.headS + tr.speed, stopS);
    if (tr.speed > 0 && stopS - tr.headS < 1e-4) { tr.headS = stopS; tr.speed = 0; }
    releaseBehind(g, tr);
    if (!manual && tr.state === 'moving' && tr.arrive && tr.headS >= tr.endS - 1e-3) arrive(g, tr);
    if (!manual && tr.state === 'moving' && tr.speed === 0 && !tr.arrive) {
      if (++tr.stuck > 300) { tr.stuck = 0; plan(g, tr, true); }
    } else tr.stuck = 0;
  }

  // ------------------------------------------------------------ recompute
  function recompute(g) {
    const R = g.rail;
    recomputeBlocks(g);
    // Validate each train's track; derail trains whose occupied track vanished.
    for (const tr of R.trains.slice()) {
      let bad = -1;
      for (let i = 0; i < tr.tiles.length; i++) {
        const t = tr.tiles[i];
        const e = T.railAt(g, t.x, t.y);
        if (!e) { bad = i; break; }
        if (i > 0) {
          const p = tr.tiles[i - 1];
          if (T.linked(g, T.railAt(g, p.x, p.y), p.hout) !== e) { bad = i; break; }
        }
      }
      if (bad < 0) continue;
      const tailS = tr.headS - T.trainLen(tr);
      const headIdx = tileIndexAt(tr, tr.headS - 1e-6);
      if (bad <= headIdx || tr.tiles[bad].s0 < tailS) {
        R.trains.splice(R.trains.indexOf(tr), 1);
        tr.dead = true;
        if (g.player.vehicle === tr.id) T.exit(g);
        g.msg('A train derailed when its track was removed', 'bad');
        continue;
      }
      tr.tiles.length = bad;
      const last = tr.tiles[tr.tiles.length - 1];
      last.end = false; last.dest = false;
      relayout(tr);
      tr.route = null;
      tr.arrive = false;
      tr.speed = Math.min(tr.speed, Math.sqrt(2 * BRAKE * Math.max(0, tr.endS - tr.headS)));
      if (tr.state === 'moving') tr.state = 'plan';
    }
    rebuildAll(g);
    R.dirty = false;
  }
  T.recompute = recompute;

  // Map tiles under stopped cars so arms can load and unload them.
  function mapCars(g) {
    const R = g.rail;
    R.carTiles.clear();
    for (const tr of R.trains) {
      if (tr.speed !== 0) continue;
      tr.cars.forEach((car, i) => {
        car.train = tr;
        const f = tr.headS - i * PITCH, b = f - CAR_LEN;
        const i0 = tileIndexAt(tr, b + 0.05), i1 = tileIndexAt(tr, f - 0.05);
        for (let j = i0; j <= i1; j++) {
          const t = tr.tiles[j];
          const k = key(g, t.x, t.y);
          R.carTiles.set(k, car);
        }
      });
    }
  }
  T.carAtTile = function (g, x, y) { return g.rail.carTiles.get(key(g, x, y)) || null; };

  // Cars hit the player and creatures in their way.
  function collisions(g) {
    const p = g.player;
    for (const tr of g.rail.trains) {
      if (tr.speed < 0.02) continue;
      for (let i = 0; i < tr.cars.length; i++) {
        const pose = T.carPose(tr, i);
        if (!p.dead && p.vehicle !== tr.id && segDist(p.x, p.y, pose) < 0.65 && g.tick - (p.trainHit || -99) > 30) {
          p.trainHit = g.tick;
          p.hp -= 300 * tr.speed;
          p.lastHit = g.tick;
          const nx = -Math.sin(pose.angle), ny = Math.cos(pose.angle);
          const side = (p.x - pose.x) * nx + (p.y - pose.y) * ny >= 0 ? 1 : -1;
          p.x += nx * side * 1.2; p.y += ny * side * 1.2;
          g.msg('Hit by a train!', 'bad');
          if (p.hp <= 0) g.enemies.playerDied();
        }
        for (const u of g.enemies.units) if (Math.abs(u.x - pose.x) < 2.5 && Math.abs(u.y - pose.y) < 2.5 && segDist(u.x, u.y, pose) < 0.7) u.hp = 0;
      }
    }
  }
  function segDist(x, y, pose) {
    const ax = pose.bx, ay = pose.by, bx = pose.fx, by = pose.fy;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = FG.clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
  }
  T.segDist = segDist;

  // Car under a world point (for hovering and clicking).
  T.carAtPoint = function (g, x, y) {
    for (const tr of g.rail.trains) {
      for (let i = 0; i < tr.cars.length; i++) {
        const pose = T.carPose(tr, i);
        if (Math.abs(pose.x - x) > 2 || Math.abs(pose.y - y) > 2) continue;
        if (segDist(x, y, pose) < 0.45) return { train: tr, car: tr.cars[i], index: i };
      }
    }
    return null;
  };
  T.findCar = function (g, carId) {
    for (const tr of g.rail.trains) {
      const i = tr.cars.findIndex((c) => c.id === carId);
      if (i >= 0) return { train: tr, car: tr.cars[i], index: i };
    }
    return null;
  };
  T.trainById = (g, id) => g.rail.trains.find((t) => t.id === id) || null;

  T.update = function (g) {
    const R = g.rail;
    if (R.dirty) recompute(g);
    for (const tr of R.trains.slice()) if (!tr.dead) updateTrain(g, tr);
    mapCars(g);
    collisions(g);
  };

  // ---------------------------------------------------------- car contents
  T.carAccept = function (car, id, mode) {
    const it = D.items[id];
    if (car.type === 'loco') {
      if (!it.fuel) return 0;
      const lim = mode === 'inserter' ? 10 : 1e9;
      return Math.max(0, Math.min(car.inv.space(id), lim - car.inv.count(id)));
    }
    return car.inv.space(id);
  };
  T.carInsert = function (car, id, n) {
    const k = Math.min(n, T.carAccept(car, id, 'direct'));
    if (k <= 0) return 0;
    return k - car.inv.add(id, k);
  };
  T.carOutputs = function (car) {
    if (car.type !== 'wagon') return [];
    const t = car.inv.totals();
    return Object.keys(t).map((k) => [k, t[k]]);
  };
  T.carTake = function (car, id, n) { return car.type === 'wagon' ? car.inv.remove(id, n) : 0; };

  // ------------------------------------------------------------ riding
  T.board = function (g) {
    const p = g.player;
    if (p.vehicle) { T.exit(g); return true; }
    let best = null, bd = 3.5;
    for (const tr of g.rail.trains) for (let i = 0; i < tr.cars.length; i++) {
      const d = segDist(p.x, p.y, T.carPose(tr, i));
      if (d < bd) { bd = d; best = tr; }
    }
    if (!best) return false;
    p.vehicle = best.id;
    if (!best.schedule.length) best.mode = 'manual';
    return true;
  };
  T.exit = function (g) {
    const p = g.player;
    const tr = T.trainById(g, p.vehicle);
    p.vehicle = null;
    if (!tr) return;
    tr.ctrl = { throttle: 0, steer: 0 };
    const pose = T.carPose(tr, 0);
    const nx = -Math.sin(pose.angle), ny = Math.cos(pose.angle);
    for (const s of [1.4, -1.4, 2.4, -2.4]) {
      const x = pose.x + nx * s, y = pose.y + ny * s;
      if (!g.playerBlocked(x, y)) { p.x = x; p.y = y; return; }
    }
    p.x = pose.x + nx * 1.4; p.y = pose.y + ny * 1.4;
  };

  // ----------------------------------------------------------- saving
  T.serialize = function (g) {
    const R = g.rail;
    return {
      nextTrain: R.nextTrain, nextCar: R.nextCar, stopCounter: R.stopCounter,
      trains: R.trains.map((tr) => ({
        id: tr.id, headS: tr.headS, speed: tr.speed, mode: tr.mode, schedule: tr.schedule, cur: tr.cur, state: tr.state,
        wait: tr.wait, arrivals: tr.arrivals, energy: tr.energy,
        cars: tr.cars.map((c) => ({ id: c.id, type: c.type, inv: c.inv.slots, flip: c.flip, hp: c.hp })),
        tiles: tr.tiles.map((t) => [t.x, t.y, t.hin, t.hout, t.end ? 1 : 0, t.dest ? 1 : 0]),
      })),
    };
  };
  T.deserialize = function (g, data) {
    const R = g.rail;
    if (!data) return;
    R.nextTrain = data.nextTrain || 1;
    R.nextCar = data.nextCar || 1;
    R.stopCounter = data.stopCounter || 0;
    R.trains = [];
    for (const o of data.trains || []) {
      const tr = newTrain(g);
      R.nextTrain = Math.max(R.nextTrain, o.id + 1);
      tr.id = o.id;
      Object.assign(tr, { headS: o.headS, speed: o.speed, mode: o.mode, schedule: o.schedule || [], cur: o.cur || 0, wait: o.wait || 0, arrivals: o.arrivals || 0, energy: o.energy || 0 });
      tr.state = o.state === 'moving' ? 'plan' : o.state === 'station' ? 'station' : o.mode === 'manual' ? 'manual' : 'plan';
      if (o.state === 'moving') tr.speed = 0;
      tr.cars = o.cars.map((c) => ({ id: c.id, type: c.type, inv: FG.Inventory.from(c.inv), flip: !!c.flip, hp: c.hp || 600 }));
      tr.tiles = o.tiles.map((t) => ({ x: t[0], y: t[1], hin: t[2], hout: t[3], end: !!t[4], dest: !!t[5] }));
      relayout(tr);
      // A moving train was mid-journey: stop it where it is and let it replan.
      if (o.state === 'moving') {
        const hi = tileIndexAt(tr, tr.headS - 1e-6);
        tr.tiles.length = hi + 1;
        tr.tiles[hi].end = false; tr.tiles[hi].dest = false;
        relayout(tr);
      }
    }
    R.dirty = true;
  };
})();
