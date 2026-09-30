// Cogworks Frontier — trains. A train is a chain of cars riding a path of rail pieces
// (see rails.js). It reserves the track ahead of it, and automatic trains obey signal
// blocks: an automatic train may only enter a block no other train holds.
(function () {
  'use strict';
  const D = FG.data;
  const RL = FG.rails;
  const T = (FG.trains = {});

  const CAR_LEN = 6; // body length in tiles
  const GAP = 1; // coupling gap
  const PITCH = CAR_LEN + GAP; // distance between car fronts
  const CAR_W = 1.6;
  const MAX_SPEED = 0.5; // tiles per tick
  const BRAKE = 0.01; // tiles per tick^2
  const ACCEL = 0.005;
  const LOCO_KW = 600;
  const WAGON_SLOTS = 20, LOCO_SLOTS = 3;
  Object.assign(T, { PITCH, CAR_LEN, CAR_W, GAP, MAX_SPEED, BRAKE, WAGON_SLOTS, LOCO_SLOTS });

  const roleOf = (e) => D.protos[e.p].role;
  T.isSignal = (e) => D.protos[e.p].kind === 'signal';

  T.init = function (g) {
    g.rail = {
      trains: [], res: new Map(), claims: new Map(),
      nextTrain: 1, nextCar: 1, carTiles: new Map(), carSig: '', stopCounter: 0, dirty: true,
    };
    RL.init(g);
  };

  // ------------------------------------------------------------ reservations
  // A piece is free for a train when neither it nor any track overlapping it is held by
  // another train.
  function pieceFree(g, tr, pc) {
    const R = g.rail;
    const o = R.res.get(pc.id);
    if (o !== undefined && o !== tr.id) return false;
    const cf = R.conf.get(pc.id);
    if (cf) for (const id of cf) { const w = R.res.get(id); if (w !== undefined && w !== tr.id) return false; }
    return true;
  }
  T.pieceReserved = (g, pc) => g.rail.res.has(pc.id);
  // Is some part of a train standing on this piece (not just reserving it ahead)?
  T.pieceUnderTrain = function (g, pc) {
    for (const tr of g.rail.trains) {
      const tail = tr.headS - T.trainLen(tr);
      for (const sg of tr.segs) if (sg.pc === pc && sg.s0 < tr.headS && sg.s0 + sg.len > tail) return tr;
    }
    return null;
  };

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
  // Lamp colour for a signal: the block it guards is free, reserved, or has a train in it.
  T.signalState = function (g, e) {
    if (!e.attached) return 'none';
    const R = g.rail;
    const out = RL.outOf(g, e.px, e.py, e.rd);
    if (!out.length) return 'none';
    const bid = R.blockOf.get(out[0].pc.id);
    const s = R.claims.get(bid);
    if (!s || !s.size) return 'free';
    for (const id of s) { const t = T.trainById(g, id); if (t && t.blocks.has(bid)) return 'occupied'; }
    return 'reserved';
  };

  function reserveSeg(g, tr, sg) {
    const R = g.rail;
    R.res.set(sg.pc.id, tr.id);
    const bid = R.blockOf.get(sg.pc.id);
    if (bid === undefined) return;
    tr.blocks.set(bid, (tr.blocks.get(bid) || 0) + 1);
    tr.pre.delete(bid);
    claim(R, tr, bid);
  }
  // Call after sg has left tr.segs.
  function releaseSeg(g, tr, sg) {
    const R = g.rail;
    if (R.res.get(sg.pc.id) === tr.id && !tr.segs.some((o) => o.pc === sg.pc)) R.res.delete(sg.pc.id);
    const bid = R.blockOf.get(sg.pc.id);
    if (bid === undefined || !tr.blocks.has(bid)) return;
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
  // Rebuild every reservation and claim from the trains' paths.
  function rebuildAll(g) {
    const R = g.rail;
    R.res = new Map();
    R.claims = new Map();
    for (const tr of R.trains) {
      tr.blocks = new Map();
      tr.pre = new Set();
      for (const sg of tr.segs) reserveSeg(g, tr, sg);
    }
  }

  // --------------------------------------------------------------- geometry
  const mkSeg = (e) => ({ pc: e.pc, fwd: e.fwd, s0: 0, len: e.pc.len, end: false, dest: false });
  function relayout(tr) {
    let s = 0;
    for (const sg of tr.segs) { sg.s0 = s; s += sg.len; }
    tr.endS = s;
  }
  function segIndexAt(tr, s) {
    const l = tr.segs;
    let lo = 0, hi = l.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (l[mid].s0 <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  // World position [x, y, heading angle] at distance s along a train's path.
  function pointAt(tr, s, out) {
    const sg = tr.segs[segIndexAt(tr, s)];
    return RL.posAt(sg.pc, s - sg.s0, sg.fwd, out);
  }
  T.pointAt = pointAt;
  T.trainLen = (tr) => tr.cars.length * PITCH - GAP;

  // Car i rides on two bogies; its body spans the chord between them.
  const pf = [0, 0, 0], pb = [0, 0, 0];
  T.carPose = function (tr, i) {
    const f = tr.headS - i * PITCH;
    pointAt(tr, f, pf);
    pointAt(tr, f - CAR_LEN, pb);
    return { fx: pf[0], fy: pf[1], bx: pb[0], by: pb[1], x: (pf[0] + pb[0]) / 2, y: (pf[1] + pb[1]) / 2, angle: Math.atan2(pf[1] - pb[1], pf[0] - pb[0]) };
  };

  // ---------------------------------------------------------------- trains
  function newTrain(g) {
    const tr = {
      id: g.rail.nextTrain++, cars: [], segs: [], headS: 0, endS: 0, speed: 0,
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

  // Choose among track continuing from a point: steer < 0 prefers left, > 0 right.
  function pickNext(list, steer) {
    if (!list.length) return null;
    const order = steer < 0 ? ['L', 'S', 'R'] : steer > 0 ? ['R', 'S', 'L'] : ['S', 'L', 'R'];
    for (const o of order) for (const e of list) if (RL.turnOf(e) === o) return e;
    return list[0];
  }
  function nextOf(g, sg, steer) {
    const [x, y, h] = RL.endState(sg);
    return pickNext(RL.outOf(g, x, y, h), steer || 0);
  }
  function prevOf(g, sg) {
    const [x, y, h] = RL.startState(sg);
    return pickNext(RL.into(g, x, y, h), 0);
  }

  // Where would a car go for the world point (wx, wy), facing roughly dir?
  // Returns { ok, reason, attach: { train, front } } or { ok, segs, headS }.
  T.planCar = function (g, wx, wy, dir) {
    for (const tr of g.rail.trains) {
      if (tr.speed !== 0) continue;
      const L = T.trainLen(tr);
      const hp = pointAt(tr, tr.headS), tp = pointAt(tr, tr.headS - L);
      const hi = pointAt(tr, tr.headS - CAR_LEN / 2), ti = pointAt(tr, tr.headS - L + CAR_LEN / 2);
      const dh = Math.hypot(wx - hp[0], wy - hp[1]), dt = Math.hypot(wx - tp[0], wy - tp[1]);
      if (dh < 4.5 && dh < Math.hypot(wx - hi[0], wy - hi[1])) return { ok: true, attach: { train: tr, front: true } };
      if (dt < 4.5 && dt < Math.hypot(wx - ti[0], wy - ti[1])) return { ok: true, attach: { train: tr, front: false } };
    }
    const near = RL.pieceNear(g, wx, wy, 1.6);
    if (!near) return { ok: false, reason: 'Place it on a rail' };
    const pc = near.pc;
    const fwd = Math.cos(near.angle) * FG.DX[dir & 3] + Math.sin(near.angle) * FG.DY[dir & 3] >= -1e-6;
    const segs = [mkSeg({ pc, fwd })];
    const lay = () => { let s = 0; for (const sg of segs) { sg.s0 = s; s += sg.len; } return s; };
    const SHORT = { ok: false, reason: 'Not enough track here: a car needs ' + (CAR_LEN + GAP) + ' tiles' };
    let head = (fwd ? near.s : pc.len - near.s) + CAR_LEN / 2;
    let end = lay();
    const growFront = () => {
      while (end < head + GAP / 2) {
        const n = nextOf(g, segs[segs.length - 1], 0);
        if (!n) return false;
        segs.push(mkSeg(n));
        end = lay();
      }
      return true;
    };
    // Slide back from a dead end ahead, then forward from a dead end behind.
    if (!growFront()) head = end - GAP / 2;
    while (head - CAR_LEN - GAP / 2 < 0) {
      const p = prevOf(g, segs[0]);
      if (!p) break;
      segs.unshift(mkSeg(p));
      head += p.pc.len;
      end = lay();
    }
    if (head - CAR_LEN - GAP / 2 < -1e-6) {
      head = CAR_LEN + GAP / 2;
      if (!growFront()) return SHORT;
    }
    // Trim track the car does not touch.
    while (segs.length > 1 && segs[segs.length - 1].s0 >= head + GAP / 2) { segs.pop(); end = lay(); }
    while (segs.length > 1 && segs[0].s0 + segs[0].len <= head - CAR_LEN - GAP / 2) {
      head -= segs.shift().len;
      end = lay();
    }
    const nobody = { id: -1 };
    for (const sg of segs) if (!pieceFree(g, nobody, sg.pc)) return { ok: false, reason: 'A train is in the way' };
    return { ok: true, segs, headS: head };
  };

  T.placeCar = function (g, type, wx, wy, dir) {
    const plan = T.planCar(g, wx, wy, dir);
    if (!plan.ok) return plan;
    const car = newCar(g, type);
    if (plan.attach) {
      const tr = plan.attach.train;
      // Face the way the player is pointing, relative to the train's direction.
      const s = plan.attach.front ? tr.headS : tr.headS - T.trainLen(tr);
      const a = pointAt(tr, s - 0.25), b = pointAt(tr, s + 0.25);
      car.flip = (b[0] - a[0]) * FG.DX[dir & 3] + (b[1] - a[1]) * FG.DY[dir & 3] < 0;
      if (!attachCar(g, tr, car, plan.attach.front)) return { ok: false, reason: 'Not enough free track to couple there' };
      return { ok: true, train: tr, car };
    }
    const tr = newTrain(g);
    tr.segs = plan.segs;
    relayout(tr);
    tr.headS = plan.headS;
    tr.cars.push(car);
    for (const sg of tr.segs) reserveSeg(g, tr, sg);
    return { ok: true, train: tr, car };
  };

  function attachCar(g, tr, car, front) {
    truncate(g, tr);
    if (front) {
      const added = [];
      while (tr.endS < tr.headS + PITCH - 1e-6) {
        const n = nextOf(g, tr.segs[tr.segs.length - 1], 0);
        if (!n || !pieceFree(g, tr, n.pc)) {
          for (const sg of added) { tr.segs.pop(); releaseSeg(g, tr, sg); }
          relayout(tr);
          return false;
        }
        const sg = mkSeg(n);
        tr.segs.push(sg);
        added.push(sg);
        relayout(tr);
        reserveSeg(g, tr, sg);
      }
      tr.headS += PITCH;
      tr.cars.unshift(car);
    } else {
      let tailS = tr.headS - T.trainLen(tr) - PITCH;
      while (tailS < 0) {
        const p = prevOf(g, tr.segs[0]);
        if (!p || !pieceFree(g, tr, p.pc)) { releaseBehind(g, tr); return false; }
        const sg = mkSeg(p);
        tr.segs.unshift(sg);
        relayout(tr);
        tr.headS += sg.len;
        tailS += sg.len;
        reserveSeg(g, tr, sg);
      }
      tr.cars.push(car);
    }
    tr.route = null;
    return true;
  }

  // Drop reserved track beyond the head (only while stopped or replanning).
  function truncate(g, tr) {
    const hi = segIndexAt(tr, tr.headS - 1e-6);
    while (tr.segs.length - 1 > hi) releaseSeg(g, tr, tr.segs.pop());
    const last = tr.segs[tr.segs.length - 1];
    last.end = false; last.dest = false;
    relayout(tr);
    releasePre(g, tr);
    tr.arrive = false;
  }

  // Forget track the whole train has passed.
  function releaseBehind(g, tr) {
    let tailS = tr.headS - T.trainLen(tr);
    while (tr.segs.length > 1 && tr.segs[0].s0 + tr.segs[0].len <= tailS - 1e-6) {
      const sg = tr.segs.shift();
      releaseSeg(g, tr, sg);
      const L = sg.len;
      tr.headS -= L;
      tailS -= L;
      for (const o of tr.segs) o.s0 -= L;
      tr.endS -= L;
    }
  }

  function reverseTrain(g, tr) {
    truncate(g, tr);
    const tailS = tr.headS - T.trainLen(tr);
    tr.segs.reverse();
    for (const sg of tr.segs) { sg.fwd = !sg.fwd; sg.end = false; sg.dest = false; }
    relayout(tr);
    tr.headS = tr.endS - tailS;
    tr.cars.reverse();
    for (const c of tr.cars) c.flip = !c.flip;
    tr.route = null;
    releaseBehind(g, tr);
  }
  T.reverse = function (g, tr) { if (tr.speed === 0) reverseTrain(g, tr); };

  function destroyTrain(g, tr) {
    const segs = tr.segs;
    tr.segs = [];
    for (const sg of segs) releaseSeg(g, tr, sg);
    releasePre(g, tr);
    const R = g.rail;
    R.trains.splice(R.trains.indexOf(tr), 1);
    tr.dead = true;
    exitAll(g, tr);
  }
  // Everyone riding a train that is gone gets out.
  function exitAll(g, tr) {
    for (const p of g.players) if (p.vehicle === tr.id) g.withPlayer(p, () => T.exit(g));
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
    back.segs = tr.segs.map((sg) => mkSeg(sg));
    relayout(back);
    back.headS = tr.headS - (i + 1) * PITCH;
    tr.cars = tr.cars.slice(0, i);
    tr.speed = 0;
    tr.route = null;
    if (tr.state === 'moving') tr.state = 'plan';
    // Trim each train to its own stretch of track, then rebuild reservations.
    back.segs.length = segIndexAt(back, back.headS - 1e-6) + 1;
    relayout(back);
    rebuildAll(g);
    releaseBehind(g, tr);
    releaseBehind(g, back);
    rebuildAll(g);
  };

  // --------------------------------------------------------------- driving
  // Blocks an automatic train must claim to enter traversal e: the next block, and past a
  // chain signal every block up to and including the one after the next plain signal.
  function neededBlocks(g, tr, e) {
    const R = g.rail;
    const first = R.blockOf.get(e.pc.id);
    const out = [first];
    const [x, y, h] = RL.startState(e);
    const sig = R.signals.get(RL.stateKey(x, y, h));
    if (!sig || roleOf(sig) !== 'chain') return out;
    let chain = true, lastB = first;
    const route = tr.route || [];
    for (let i = 1; i < route.length && chain; i++) {
      const b = R.blockOf.get(route[i].pc.id);
      if (b === lastB) continue;
      const [sx, sy, sh] = RL.startState(route[i]);
      const s2 = R.signals.get(RL.stateKey(sx, sy, sh));
      out.push(b);
      lastB = b;
      chain = !!s2 && roleOf(s2) === 'chain';
    }
    return out;
  }

  // Try to add the next piece of track in front of the train.
  function appendNext(g, tr, manual) {
    const R = g.rail;
    const last = tr.segs[tr.segs.length - 1];
    if (last.end) return false;
    let e;
    if (manual) {
      e = nextOf(g, last, tr.ctrl.steer);
      if (!e) { last.end = true; return false; }
    } else {
      if (!tr.route || !tr.route.length) return false;
      e = tr.route[0];
      const a = RL.endState(last), b = RL.startState(e);
      if (e.pc.dead || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) { tr.route = null; return false; }
    }
    if (!pieceFree(g, tr, e.pc)) { tr.blocked = 'train'; return false; }
    if (!manual) {
      const bid = R.blockOf.get(e.pc.id), cur = R.blockOf.get(last.pc.id);
      if (bid !== cur && !tr.blocks.has(bid) && !tr.pre.has(bid)) {
        const need = neededBlocks(g, tr, e);
        for (const b of need) if (!blockFree(R, tr, b)) { tr.blocked = 'signal'; return false; }
        for (const b of need) { if (!tr.blocks.has(b)) tr.pre.add(b); claim(R, tr, b); }
      }
      tr.route.shift();
    }
    const sg = mkSeg(e);
    if (!manual && !tr.route.length) { sg.end = true; sg.dest = true; }
    sg.s0 = tr.endS;
    tr.endS += sg.len;
    tr.segs.push(sg);
    reserveSeg(g, tr, sg);
    tr.blocked = null;
    if (sg.dest) tr.arrive = true;
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

  T.stopsNamed = (g, name) => (g.byKind.trainstop || []).filter((e) => e.name === name);
  T.stopNames = function (g) {
    const set = new Set();
    for (const e of g.byKind.trainstop || []) set.add(e.name);
    return Array.from(set).sort();
  };

  // Shortest route to any stop with the scheduled name. May reverse a stopped train.
  function plan(g, tr, avoidTrains) {
    const R = g.rail;
    const entry = tr.schedule[tr.cur];
    if (!entry) { tr.state = 'no_schedule'; return false; }
    const stops = T.stopsNamed(g, entry.station);
    const targets = new Set(stops.filter((e) => e.attached).map((e) => RL.stateKey(e.px, e.py, e.rd)));
    if (!targets.size) {
      tr.state = 'no_path';
      tr.msg = stops.length ? '“' + entry.station + '” is not beside any track' : 'No stop named “' + entry.station + '”';
      tr.retryAt = g.tick + 120;
      return false;
    }
    if (tr.speed === 0) truncate(g, tr);
    const last = tr.segs[tr.segs.length - 1];
    const keyOf = (st) => RL.stateKey(st[0], st[1], st[2]);
    if (targets.has(keyOf(RL.endState(last))) && tr.headS >= tr.endS - 0.05) { arrive(g, tr); return true; }
    // A stop already under the train counts as arrived; one under it facing back needs a flip.
    let flipOnly = false;
    if (tr.speed === 0) {
      const tail = tr.headS - T.trainLen(tr);
      for (const sg of tr.segs) {
        const s = sg.s0 + sg.len;
        if (s >= tail - 0.05 && s <= tr.headS + 0.05 && targets.has(keyOf(RL.endState(sg)))) { arrive(g, tr); return true; }
        const st = RL.startState(sg);
        if (sg.s0 >= tail - 0.05 && sg.s0 <= tr.headS + 0.05 && targets.has(RL.stateKey(st[0], st[1], RL.opp8(st[2])))) flipOnly = true;
      }
    }
    const heap = new FG.Heap();
    const best = new Map(), prev = new Map();
    const start = (k, cost, tag) => { if (!best.has(k) || cost < best.get(k)) { best.set(k, cost); prev.set(k, tag); heap.push(cost, k); } };
    if (T.canForward(tr)) start(keyOf(RL.endState(last)), 0, 'fwd');
    const canRev = tr.speed === 0 && T.canReverse(tr);
    if (canRev) { const st = RL.startState(tr.segs[0]); start(RL.stateKey(st[0], st[1], RL.opp8(st[2])), 20, 'rev'); }
    let goal = -1, iter = 0;
    const done = new Set();
    while (heap.size && iter++ < 200000) {
      const k = heap.pop();
      if (done.has(k)) continue;
      done.add(k);
      if (targets.has(k)) { goal = k; break; }
      const d = k & 7, pk = (k - d) / 8;
      const x = pk & 2047, y = pk >> 11;
      if (RL.oneWayBlocked(g, x, y, d)) continue;
      const c0 = best.get(k);
      for (const e of RL.outOf(g, x, y, d)) {
        let c = c0 + e.pc.len + (e.pc.t === 'S' ? 0 : 0.5);
        if (avoidTrains) { const o = R.res.get(e.pc.id); if (o !== undefined && o !== tr.id) c += 60; }
        const nk = keyOf(RL.endState(e));
        if (!best.has(nk) || c < best.get(nk)) { best.set(nk, c); prev.set(nk, { k, e }); heap.push(c, nk); }
      }
    }
    if (goal < 0) {
      if (canRev && flipOnly) { reverseTrain(g, tr); arrive(g, tr); return true; }
      tr.state = 'no_path';
      tr.msg = T.canReverse(tr) ? 'No track leads to “' + entry.station + '”'
        : 'No way forward to “' + entry.station + '”. Build a loop, or add a locomotive facing backwards';
      tr.retryAt = g.tick + 120;
      return false;
    }
    const path = [];
    let k = goal, rev = false;
    for (;;) {
      const p = prev.get(k);
      if (typeof p === 'string') { rev = p === 'rev'; break; }
      path.push(p.e);
      k = p.k;
    }
    path.reverse();
    if (rev) reverseTrain(g, tr);
    tr.route = path;
    tr.state = 'moving';
    tr.msg = null;
    tr.stuck = 0;
    if (!path.length) {
      // The stop is at the end of the track the train already holds.
      const L = tr.segs[tr.segs.length - 1];
      L.end = true; L.dest = true;
      tr.arrive = true;
    }
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
        const last = tr.segs[tr.segs.length - 1];
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
    RL.recompute(g);
    // Derail trains whose occupied track vanished; cut paths short where track ahead did.
    for (const tr of R.trains.slice()) {
      if (tr.route && tr.route.some((e) => e.pc.dead)) tr.route = null;
      // Track that vanished behind the tail is simply forgotten.
      const tailS = tr.headS - T.trainLen(tr);
      let cut = -1;
      tr.segs.forEach((sg, i) => { if (sg.pc.dead && sg.s0 + sg.len <= tailS + 1e-6) cut = i; });
      if (cut >= 0) {
        for (const sg of tr.segs.splice(0, cut + 1)) tr.headS -= sg.len;
        relayout(tr);
      }
      const bad = tr.segs.findIndex((sg) => sg.pc.dead);
      const last = tr.segs[tr.segs.length - 1];
      if (bad < 0) {
        if (!last.dest) last.end = false; // new track may continue past a dead end
        continue;
      }
      if (tr.segs[bad].s0 < tr.headS - 1e-6) {
        R.trains.splice(R.trains.indexOf(tr), 1);
        tr.dead = true;
        exitAll(g, tr);
        g.msg('A train derailed when its track was removed', 'bad');
        continue;
      }
      tr.segs.length = bad;
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
    const R = g.rail, W = g.world.W;
    let sig = '';
    for (const tr of R.trains) if (tr.speed === 0) sig += tr.id + ':' + tr.headS.toFixed(3) + ':' + tr.cars.length + ':' + tr.segs[0].pc.id + ';';
    if (sig === R.carSig) return;
    R.carSig = sig;
    R.carTiles.clear();
    const p = [0, 0, 0];
    for (const tr of R.trains) {
      if (tr.speed !== 0) continue;
      tr.cars.forEach((car, i) => {
        car.train = tr;
        const f = tr.headS - i * PITCH;
        for (let s = f - CAR_LEN + 0.25; s < f; s += 0.5) {
          pointAt(tr, s, p);
          const nx = -Math.sin(p[2]), ny = Math.cos(p[2]);
          for (const o of [-0.7, -0.25, 0.25, 0.7]) R.carTiles.set(Math.floor(p[1] + ny * o) * W + Math.floor(p[0] + nx * o), car);
        }
      });
    }
  }
  T.carAtTile = function (g, x, y) { return g.rail.carTiles.get(y * g.world.W + x) || null; };

  // Cars hit the player and creatures in their way.
  function collisions(g) {
    const reach = CAR_W / 2 + 0.3;
    for (const tr of g.rail.trains) {
      if (tr.speed < 0.02) continue;
      for (let i = 0; i < tr.cars.length; i++) {
        const pose = T.carPose(tr, i);
        for (const p of g.players) {
          if (p.dead || p.vehicle === tr.id || Math.abs(p.x - pose.x) >= 5 || Math.abs(p.y - pose.y) >= 5 || segDist(p.x, p.y, pose) >= reach || g.tick - (p.trainHit || -99) <= 30) continue;
          p.trainHit = g.tick;
          p.hp -= 300 * tr.speed;
          p.lastHit = g.tick;
          const nx = -Math.sin(pose.angle), ny = Math.cos(pose.angle);
          const side = (p.x - pose.x) * nx + (p.y - pose.y) * ny >= 0 ? 1 : -1;
          p.x += nx * side * 1.6; p.y += ny * side * 1.6;
          g.withPlayer(p, () => g.msg('Hit by a train!', 'bad'));
          if (p.hp <= 0) g.enemies.playerDied(p);
        }
        for (const u of g.enemies.units) if (Math.abs(u.x - pose.x) < 4.5 && Math.abs(u.y - pose.y) < 4.5 && segDist(u.x, u.y, pose) < reach + 0.1) u.hp = 0;
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
        if (Math.abs(pose.x - x) > 4 || Math.abs(pose.y - y) > 4) continue;
        if (segDist(x, y, pose) < CAR_W / 2) return { train: tr, car: tr.cars[i], index: i };
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
    for (const s of [1.7, -1.7, 2.7, -2.7, 3.7, -3.7]) {
      const x = pose.x + nx * s, y = pose.y + ny * s;
      if (!g.playerBlocked(x, y)) { p.x = x; p.y = y; return; }
    }
    p.x = pose.x + nx * 1.7; p.y = pose.y + ny * 1.7;
  };

  // ----------------------------------------------------------- saving
  T.serialize = function (g) {
    const R = g.rail;
    return {
      nextTrain: R.nextTrain, nextCar: R.nextCar, stopCounter: R.stopCounter,
      track: RL.serialize(g),
      trains: R.trains.map((tr) => ({
        id: tr.id, headS: tr.headS, speed: tr.speed, mode: tr.mode, schedule: tr.schedule, cur: tr.cur, state: tr.state,
        wait: tr.wait, arrivals: tr.arrivals, energy: tr.energy,
        cars: tr.cars.map((c) => ({ id: c.id, type: c.type, inv: c.inv.slots, flip: c.flip, hp: c.hp })),
        segs: tr.segs.map((sg) => [sg.pc.ax, sg.pc.ay, sg.pc.ah, sg.pc.t, sg.fwd ? 1 : 0, sg.end ? 1 : 0, sg.dest ? 1 : 0]),
      })),
    };
  };
  T.deserialize = function (g, data) {
    const R = g.rail;
    if (!data) return;
    R.nextTrain = data.nextTrain || 1;
    R.nextCar = data.nextCar || 1;
    R.stopCounter = data.stopCounter || 0;
    RL.deserialize(g, data.track);
    R.trains = [];
    for (const o of data.trains || []) {
      const segs = [];
      for (const s of o.segs || []) {
        const pc = R.byKey.get(RL.pieceKeyOf(s[0], s[1], s[2], s[3]));
        if (!pc) { segs.length = 0; break; }
        // The stored start is where the piece was built from, not necessarily this piece's A end.
        const sg = mkSeg({ pc, fwd: pc.ax === s[0] && pc.ay === s[1] && pc.ah === s[2] ? !!s[4] : !s[4] });
        sg.end = !!s[5]; sg.dest = !!s[6];
        segs.push(sg);
      }
      if (!segs.length) continue;
      const tr = newTrain(g);
      R.nextTrain = Math.max(R.nextTrain, o.id + 1);
      tr.id = o.id;
      Object.assign(tr, { headS: o.headS, speed: o.speed, mode: o.mode, schedule: o.schedule || [], cur: o.cur || 0, wait: o.wait || 0, arrivals: o.arrivals || 0, energy: o.energy || 0 });
      tr.state = o.state === 'moving' ? 'plan' : o.state === 'station' ? 'station' : o.mode === 'manual' ? 'manual' : 'plan';
      if (o.state === 'moving') tr.speed = 0;
      tr.cars = o.cars.map((c) => ({ id: c.id, type: c.type, inv: FG.Inventory.from(c.inv), flip: !!c.flip, hp: c.hp || 600 }));
      tr.segs = segs;
      relayout(tr);
      // A moving train was mid-journey: stop it where it is and let it replan.
      if (o.state === 'moving') {
        tr.segs.length = segIndexAt(tr, tr.headS - 1e-6) + 1;
        const L = tr.segs[tr.segs.length - 1];
        L.end = false; L.dest = false;
        relayout(tr);
      }
    }
    R.dirty = true;
  };
})();
