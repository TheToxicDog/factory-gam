// Headless simulation tests: node tests/sim.test.js
const { load } = require('./harness');
const FG = load();
const D = FG.data;

let failures = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

// A game with a cleared, flat work area near spawn and no enemies.
function newGame(opts) {
  const g = new FG.Game(Object.assign({ seed: 42, size: 256, enemies: 'off' }, opts || {}));
  const w = g.world;
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
    const i = y * w.W + x;
    if (x > 20 && y > 20 && x < w.W - 20 && y < w.H - 20) { w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
  }
  g.player.x = 30; g.player.y = 30; // keep the player out of the way
  return g;
}
function ore(g, type, x0, y0, w, h, amt) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * g.world.W + x;
    g.world.res[i] = FG.RES[type]; g.world.amt[i] = amt || 1000; g.world.modified.add(i);
  }
}
function water(g, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.world.terrain[y * g.world.W + x] = FG.T.WATER;
}
function place(g, p, x, y, dir) {
  const c = FG.canPlace(g, p, x, y, dir || 0);
  if (!c.ok) throw new Error('cannot place ' + p + ' at ' + x + ',' + y + ': ' + c.reason);
  return FG.placeEntity(g, p, x, y, dir || 0);
}
// A block of solar panels wired together with steel poles.
function solarField(g, x0, y0, cols, rows) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 + c * 8, y = y0 + r * 3;
    place(g, 'solar_panel', x, y);
    place(g, 'medium_pole', x + 3, y + 1);
    place(g, 'solar_panel', x + 4, y);
  }
  place(g, 'medium_pole', x0 + cols * 8 - 1, y0 + rows * 3 - 2);
}
function run(g, ticks) { for (let i = 0; i < ticks; i++) g.step(); }
const N = 0, E = 1, S = 2, W = 3;

console.log('Data integrity');

test('every recipe category has a machine that can run it', () => {
  const cats = new Set(['crafting']);
  for (const id in D.protos) { const pr = D.protos[id]; if (pr.cats) pr.cats.forEach((c) => cats.add(c)); if (pr.kind === 'furnace') cats.add('smelting'); }
  for (const id in D.recipes) assert(cats.has(D.recipes[id].cat), id + ' category ' + D.recipes[id].cat + ' has no machine');
});

test('every ingredient can be obtained', () => {
  const raw = new Set(['wood', 'coal', 'stone', 'iron_ore', 'copper_ore', 'water', 'crude_oil', 'steam']);
  const made = new Set(raw);
  for (const id in D.recipes) { for (const o in D.recipes[id].out) made.add(o); for (const o in D.recipes[id].fout) made.add(o); }
  for (const id in D.recipes) {
    const r = D.recipes[id];
    for (const i in r.ing) assert(made.has(i), id + ' needs ' + i + ' which nothing makes');
    for (const i in r.fin) assert(made.has(i), id + ' needs fluid ' + i + ' which nothing makes');
  }
});

test('every recipe is available at start or unlocked by research', () => {
  for (const id in D.recipes) assert(D.recipes[id].start || D.recipeTech[id], id + ' is never unlocked');
});

test('every building has an obtainable recipe', () => {
  for (const id in D.items) if (D.items[id].place) assert(D.recipeFor[id], 'no recipe makes ' + id);
});

test('research tree is reachable in order, with packs unlocked before use', () => {
  const g = new FG.Game({ seed: 1, size: 128, enemies: 'off' });
  const packTech = {};
  for (const tid in D.techs) for (const u of D.techs[tid].unlocks) if (D.items[u] && D.items[u].sub === 'science') packTech[u] = tid;
  let progress = true, rounds = 0;
  while (progress && rounds++ < 100) {
    progress = false;
    for (const tid in D.techs) {
      if (g.research.done[tid] || g.techState(tid) !== 'available') continue;
      const t = D.techs[tid];
      for (const p in t.cost) assert(p === 'sci_1' || g.research.done[packTech[p]], tid + ' uses ' + p + ' before it is unlocked');
      // every ingredient chain of the needed packs must be unlocked
      g.completeResearch(tid, true);
      progress = true;
    }
  }
  const missing = Object.keys(D.techs).filter((t) => !g.research.done[t]);
  assert(!missing.length, 'unreachable techs: ' + missing.join(', '));
});

test('science pack recipes only use already-unlocked recipes', () => {
  // Walk the tree; when a pack is unlocked, all its ingredients' recipes must be unlocked too (or be raw).
  const g = new FG.Game({ seed: 1, size: 128, enemies: 'off' });
  const raw = new Set(['wood', 'coal', 'stone', 'iron_ore', 'copper_ore']);
  const need = (item, seen) => {
    if (raw.has(item) || seen.has(item)) return null;
    seen.add(item);
    const r = D.recipeFor[item];
    if (!r) return null;
    if (!g.recipeEnabled(r.id)) return r.id;
    for (const i in r.ing) { const m = need(i, seen); if (m) return m; }
    return null;
  };
  const order = Object.values(D.techs).sort((a, b) => a.order - b.order);
  let rounds = 0, left = order.length;
  while (left && rounds++ < 100) {
    for (const t of order) {
      if (g.research.done[t.id] || g.techState(t.id) !== 'available') continue;
      g.completeResearch(t.id, true);
      left--;
      for (const u of t.unlocks) {
        const it = D.items[u];
        if (it && it.sub === 'science') { const m = need(u, new Set()); assert(!m, 'pack ' + u + ' needs locked recipe ' + m + ' when unlocked by ' + t.id); }
      }
    }
  }
});

console.log('Simulation tests');

test('burner drill feeds a stone furnace directly', () => {
  const g = newGame();
  ore(g, 'IRON', 100, 100, 2, 2);
  const d = place(g, 'burner_drill', 100, 100, E); // output at x=102
  const f = place(g, 'stone_furnace', 102, 100);
  FG.insertItem(g, d, 'coal', 10, 'direct');
  FG.insertItem(g, f, 'coal', 10, 'direct');
  run(g, 60 * 30);
  assert(f.out && f.out.id === 'iron_plate' && f.out.n >= 5, 'expected plates, got ' + JSON.stringify(f.out));
  assert(d.status === 'working' || d.status === 'waiting_space', 'drill status ' + d.status);
});

test('straight belt carries 15 items/s when fully compressed', () => {
  const g = newGame();
  const belts = [];
  for (let x = 60; x < 80; x++) belts.push(place(g, 'belt', x, 60, E));
  run(g, 1);
  const first = belts[0], last = belts[belts.length - 1];
  let out = 0;
  for (let t = 0; t < 60 * 30; t++) {
    for (const L of [0, 1]) FG.belts.laneInsert(first.lanes[L], 'iron_plate', 0.125, 1);
    g.step();
    for (const L of [0, 1]) {
      const ln = last.lanes[L];
      while (ln.pos.length && ln.pos[0] >= 0.8) { ln.ids.shift(); ln.pos.shift(); if (t >= 1200) out++; }
    }
  }
  const rate = out / 10;
  assert(rate > 14.5 && rate < 15.5, 'throughput ' + rate);
});

test('belt curves keep items flowing and side-loading merges', () => {
  const g = newGame();
  // East along y=60 then turn south at x=70.
  for (let x = 60; x < 70; x++) place(g, 'belt', x, 60, E);
  for (let y = 60; y < 70; y++) place(g, 'belt', 70, y, S);
  // A side-loader coming from the east into (70, 65).
  for (let x = 75; x > 70; x--) place(g, 'belt', x, 65, W);
  run(g, 1);
  const c = FG.belts.nodeAt(g, 70, 60);
  assert(c.curveIn, 'corner should be curved');
  FG.belts.laneInsert(FG.belts.nodeAt(g, 60, 60).lanes[0], 'iron_plate', 0.5, 1);
  FG.belts.laneInsert(FG.belts.nodeAt(g, 75, 65).lanes[1], 'copper_plate', 0.5, 1);
  run(g, 60 * 12);
  const end = FG.belts.nodeAt(g, 70, 69);
  const all = end.lanes[0].ids.concat(end.lanes[1].ids);
  assert(all.indexOf('iron_plate') >= 0, 'iron should reach end of turn: ' + JSON.stringify(end.lanes));
  assert(all.indexOf('copper_plate') >= 0, 'side-loaded copper should reach end');
});

test('tunnel belts pair and pass items underground', () => {
  const g = newGame();
  place(g, 'belt', 60, 60, E);
  const a = place(g, 'underground_belt', 61, 60, E);
  const b = place(g, 'underground_belt', 65, 60, E);
  place(g, 'belt', 66, 60, E);
  run(g, 1);
  assert(a.ug === 'in' && b.ug === 'out', 'types ' + a.ug + '/' + b.ug);
  assert(a.pair === b, 'paired');
  FG.belts.laneInsert(FG.belts.nodeAt(g, 60, 60).lanes[0], 'iron_gear', 0.5, 1);
  run(g, 60 * 5);
  const end = FG.belts.nodeAt(g, 66, 60);
  assert(end.lanes[0].ids[0] === 'iron_gear', 'gear arrives: ' + JSON.stringify(end.lanes));
});

test('splitter divides a stream evenly', () => {
  const g = newGame();
  place(g, 'belt', 60, 61, E);
  place(g, 'splitter', 61, 60, E); // covers (61,60) and (61,61)
  const o1 = [], o2 = [];
  for (let x = 62; x < 70; x++) { o1.push(place(g, 'belt', x, 60, E)); o2.push(place(g, 'belt', x, 61, E)); }
  run(g, 1);
  const src = FG.belts.nodeAt(g, 60, 61);
  let a = 0, b = 0;
  for (let t = 0; t < 60 * 20; t++) {
    FG.belts.laneInsert(src.lanes[0], 'iron_plate', 0.125, 1);
    g.step();
    for (const [list, add] of [[o1, () => a++], [o2, () => b++]]) {
      const ln = list[list.length - 1].lanes[0];
      while (ln.pos.length && ln.pos[0] >= 0.8) { ln.ids.shift(); ln.pos.shift(); add(); }
    }
  }
  assert(a > 20 && b > 20 && Math.abs(a - b) <= 2, 'split ' + a + '/' + b);
});

test('arms move plates from chest to furnace-free chest via belt', () => {
  const g = newGame();
  const c1 = place(g, 'iron_chest', 60, 60);
  const arm = place(g, 'burner_inserter', 61, 60, E);
  place(g, 'belt', 62, 60, S);
  place(g, 'belt', 62, 61, S);
  place(g, 'belt', 62, 62, S);
  const arm2 = place(g, 'burner_inserter', 62, 63, S);
  const c2 = place(g, 'wooden_chest', 62, 64);
  c1.inv.add('iron_plate', 20);
  c1.inv.add('coal', 5); // burner arms refuel themselves from the chest
  FG.insertItem(g, arm2, 'coal', 2, 'direct');
  run(g, 60 * 40);
  assert(c2.inv.count('iron_plate') >= 10, 'moved ' + c2.inv.count('iron_plate') + ' arm status ' + arm.status + '/' + arm2.status);
});

function powerPlant(g, x, y) {
  // Water to the west of the pump.
  water(g, x - 4, y - 2, 4, 6);
  const pump = place(g, 'offshore_pump', x, y, E);
  const boiler = place(g, 'boiler', x + 1, y - 1, N); // 3x2: water in at left (x+1,y) facing west... rotate
  return { pump, boiler };
}

test('steam power runs an assembler making gears', () => {
  const g = newGame();
  water(g, 50, 50, 6, 20);
  const pump = place(g, 'offshore_pump', 56, 60, E); // faces east, water to the west
  // Boiler facing north: water inputs at its left/right ends of the bottom row.
  const boiler = place(g, 'boiler', 57, 59, N); // tiles x57..59, y59..60; water conn at (57,60) west -> pump at (56,60)
  const engine = place(g, 'steam_engine', 57, 54, N); // x57..59, y54..58, steam conn at (58,58) south -> boiler steam out (58,59) north
  FG.insertItem(g, boiler, 'coal', 50, 'direct');
  place(g, 'small_pole', 60, 56);
  const asm = place(g, 'assembler_1', 61, 55);
  FG.machines.setRecipe(g, asm, 'iron_gear');
  asm.inp.iron_plate = 100;
  run(g, 60 * 30);
  assert(pump.status === 'working' || pump.status === 'output_full', 'pump ' + pump.status);
  assert(boiler.status === 'working' || boiler.status === 'output_full', 'boiler ' + boiler.status);
  assert((asm.out.iron_gear || 0) >= 10, 'gears ' + JSON.stringify(asm.out) + ' status ' + asm.status + ' net ' + (asm.net && asm.net.sat));
  assert(engine.out > 0 || g.powerNets[0].engOut > 0, 'engine producing');
});

test('labs research technology with packs', () => {
  const g = newGame();
  const s = place(g, 'solar_panel', 60, 60);
  place(g, 'small_pole', 63, 61);
  const lab = place(g, 'lab', 64, 60);
  lab.inp.sci_1 = 20;
  g.queueResearch('automation');
  g.tick = 0;
  run(g, 60 * 110);
  assert(g.research.done.automation, 'automation researched, progress ' + g.research.progress.automation + ' status ' + lab.status + ' sat ' + (lab.net && lab.net.sat));
  assert(g.recipeEnabled('assembler_1'), 'assembler unlocked');
});

test('hand crafting plans intermediate crafts', () => {
  const g = newGame();
  g.player.inv = new FG.Inventory(60);
  g.player.inv.add('iron_plate', 20);
  g.player.inv.add('stone', 10);
  assert(g.craftableCount('burner_drill') === 2, 'craftable ' + g.craftableCount('burner_drill'));
  assert(g.queueCraft('burner_drill', 1), 'queued');
  run(g, 60 * 10);
  assert(g.player.inv.count('burner_drill') === 1, 'crafted drill');
  assert(g.player.inv.count('iron_plate') === 11, 'plates left ' + g.player.inv.count('iron_plate'));
});

test('electric drills fill a belt; arms feed an electric chain', () => {
  const g = newGame();
  ore(g, 'COPPER', 100, 100, 3, 3, 5000);
  place(g, 'solar_panel', 95, 95);
  place(g, 'solar_panel', 95, 98);
  place(g, 'solar_panel', 95, 101);
  place(g, 'small_pole', 98, 99);
  const d = place(g, 'electric_drill', 99, 99, E); // footprint 99..101; output at (102,100)
  for (let y = 97; y < 106; y++) place(g, 'belt', 102, y, S);
  g.tick = 0;
  run(g, 60 * 20);
  let items = 0;
  for (let y = 97; y < 106; y++) { const n = FG.belts.nodeAt(g, 102, y); items += n.lanes[0].ids.length + n.lanes[1].ids.length; }
  assert(items >= 5, 'items on belt ' + items + ' drill ' + d.status);
});

// Which side of a vertical belt tile a lane's items sit on: -1 west, +1 east.
function laneSide(g, x, y, L) {
  const n = FG.belts.nodeAt(g, x, y), p = [0, 0];
  FG.belts.itemPos(n, L, 0.5, p);
  return Math.sign(p[0] - (x + 0.5));
}
function laneCounts(g, x, y0, y1) {
  const c = { west: 0, east: 0 };
  for (let y = y0; y <= y1; y++) {
    const n = FG.belts.nodeAt(g, x, y);
    for (const L of [0, 1]) c[laneSide(g, x, y, L) < 0 ? 'west' : 'east'] += n.lanes[L].ids.length;
  }
  return c;
}

test('drills drop ore on the near lane of a belt', () => {
  const g = newGame();
  ore(g, 'IRON', 96, 96, 12, 12, 5000);
  solarField(g, 60, 90, 2, 4);
  for (let y = 95; y <= 110; y++) place(g, 'belt', 102, y, N);
  place(g, 'electric_drill', 99, 100, E); // west of the belt, output (102, 101)
  place(g, 'medium_pole', 98, 104);
  place(g, 'medium_pole', 90, 104); place(g, 'medium_pole', 82, 104);
  run(g, 60 * 15);
  let c = laneCounts(g, 102, 95, 110);
  assert(c.west > 3 && c.east === 0, 'electric drill on the west fills the west lane: ' + JSON.stringify(c));
  // A burner drill on the east side fills the east lane.
  const b = place(g, 'burner_drill', 103, 104, W);
  FG.insertItem(g, b, 'coal', 20, 'direct');
  run(g, 60 * 15);
  c = laneCounts(g, 102, 95, 110);
  assert(c.east > 1 && c.west > 3, 'burner drill on the east fills the east lane: ' + JSON.stringify(c));
});

test('arms put items on the far lane and pick up from either lane', () => {
  const g = newGame();
  solarField(g, 60, 90, 2, 4);
  for (let y = 95; y <= 106; y++) place(g, 'belt', 102, y, N);
  const src = place(g, 'iron_chest', 100, 104);
  src.inv.add('iron_plate', 200);
  place(g, 'inserter', 101, 104, E); // west of the belt, dropping east onto it
  for (const [x, y] of [[98, 101], [104, 96], [90, 101], [82, 101]]) place(g, 'medium_pole', x, y);
  run(g, 60 * 6);
  const c = laneCounts(g, 102, 95, 106);
  assert(c.east > 3 && c.west === 0, 'items placed from the west land on the east (far) lane: ' + JSON.stringify(c));
  // An arm on the east side takes them off, though they are on its near lane.
  const out = place(g, 'iron_chest', 104, 98);
  const east = place(g, 'inserter', 103, 98, E); // picks from the belt at (102, 98)
  run(g, 60 * 8);
  assert(out.inv.count('iron_plate') > 3, 'arm on the other side picks from its near lane: ' + out.inv.count('iron_plate'));
  // An arm on the west side takes from its far lane too (with the first arm gone).
  FG.removeEntity(g, east);
  const out2 = place(g, 'iron_chest', 100, 96);
  place(g, 'inserter', 101, 96, W);
  run(g, 60 * 8);
  assert(out2.inv.count('iron_plate') > 3, 'arm on the same side picks from its far lane: ' + out2.inv.count('iron_plate'));
});

test('every kind of arm takes coal off a belt corner into a boiler, from either side', () => {
  const bad = [];
  let cases = 0;
  for (let dout = 0; dout < 4; dout++) for (const turn of ['L', 'R']) {
    const din = turn === 'L' ? FG.rightOf(dout) : FG.leftOf(dout);
    const free = [0, 1, 2, 3].filter((d) => d !== FG.opposite(din) && d !== dout);
    for (const side of free) for (const arm of ['burner_inserter', 'inserter', 'fast_inserter', 'long_inserter']) {
      const g = newGame();
      const cx = 128, cy = 128, DX = FG.DX, DY = FG.DY;
      // Coal comes along a belt heading `din`, turns the corner and leaves heading `dout`.
      for (let k = 6; k >= 1; k--) place(g, 'belt', cx - DX[din] * k, cy - DY[din] * k, din);
      place(g, 'belt', cx, cy, dout);
      for (let k = 1; k <= 4; k++) place(g, 'belt', cx + DX[dout] * k, cy + DY[dout] * k, dout);
      const sx = cx - DX[din] * 7, sy = cy - DY[din] * 7;
      place(g, 'iron_chest', sx - DX[din], sy - DY[din]).inv.add('coal', 400);
      place(g, 'burner_inserter', sx, sy, din).fuel = { id: 'coal', n: 5 };
      // The arm stands beside the corner (a long arm one tile further out) and drops into a boiler.
      const r = arm === 'long_inserter' ? 2 : 1;
      const ax = cx + DX[side] * r, ay = cy + DY[side] * r;
      const a = place(g, arm, ax, ay, side);
      if (arm === 'burner_inserter') a.fuel = { id: 'coal', n: 1 };
      const tx = ax + DX[side] * r, ty = ay + DY[side] * r;
      let boiler = null;
      for (const [ox, oy] of [[0, 0], [-1, 0], [-2, 0], [0, -1], [-1, -1], [-2, -1]]) {
        if (FG.canPlace(g, 'boiler', tx + ox, ty + oy, 0).ok) { boiler = place(g, 'boiler', tx + ox, ty + oy, 0); break; }
      }
      if (arm !== 'burner_inserter') {
        // Power: a charged accumulator and a pole beside the arm.
        let pole = null, acc = null;
        for (const [ox, oy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          if (FG.canPlace(g, 'medium_pole', ax + ox, ay + oy, 0).ok) { pole = place(g, 'medium_pole', ax + ox, ay + oy); break; }
        }
        for (let oy = -3; oy <= 2 && !acc; oy++) for (let ox = -3; ox <= 2 && !acc; ox++) {
          if (FG.canPlace(g, 'accumulator', pole.x + ox, pole.y + oy, 0).ok) acc = place(g, 'accumulator', pole.x + ox, pole.y + oy);
        }
        acc.charge = D.protos.accumulator.capacity;
      }
      run(g, 60 * 20);
      cases++;
      if (!boiler || !boiler.fuel || boiler.fuel.n < 1) bad.push([din, dout, side, arm, a.status, boiler ? 'no coal' : 'no boiler'].join(' '));
    }
  }
  assert(!bad.length, bad.length + ' of ' + cases + ' layouts failed:\n       ' + bad.join('\n       '));
});

test('an arm picks up an item waiting at the very end of a belt', () => {
  const g = newGame();
  // Coal runs east to a dead end at x=105; the arm stands beside that last tile.
  for (let x = 100; x <= 105; x++) place(g, 'belt', x, 100, E);
  const ch = place(g, 'iron_chest', 98, 100); ch.inv.add('coal', 50);
  place(g, 'burner_inserter', 99, 100, E).fuel = { id: 'coal', n: 5 };
  const arm = place(g, 'burner_inserter', 105, 99, N); // picks from (105,100), drops into (105,98)
  arm.fuel = { id: 'coal', n: 1 };
  const out = place(g, 'iron_chest', 105, 98);
  run(g, 60 * 20);
  assert(out.inv.count('coal') > 5, 'coal picked from the end tile: ' + out.inv.count('coal') + ' ' + arm.status);
});

test('an arm explains a burner already burning a different fuel', () => {
  const g = newGame();
  const ch = place(g, 'iron_chest', 100, 100); ch.inv.add('coal', 50);
  const arm = place(g, 'burner_inserter', 101, 100, E);
  arm.fuel = { id: 'coal', n: 2 };
  const b = place(g, 'boiler', 102, 99, E); // (102..103, 99..101) covers (102,100)
  FG.insertItem(g, b, 'wood', 5, 'direct');
  run(g, 60 * 3);
  assert(b.fuel.id === 'wood' && arm.status === 'other_fuel', 'status ' + arm.status);
  b.fuel = null;
  run(g, 60 * 3);
  assert(b.fuel && b.fuel.id === 'coal', 'coal goes in once the wood is out: ' + JSON.stringify(b.fuel));
});

test('an arm facing a stocked machine says so instead of waiting for items', () => {
  const g = newGame();
  solarField(g, 60, 90, 2, 4);
  for (const [x, y] of [[98, 101], [90, 101], [82, 101]]) place(g, 'medium_pole', x, y);
  const src = place(g, 'iron_chest', 100, 100);
  src.inv.add('coal', 200);
  const arm = place(g, 'inserter', 101, 100, E);
  const f = place(g, 'stone_furnace', 102, 100);
  run(g, 60 * 20);
  assert(f.fuel && f.fuel.n > 0, 'furnace fuelled');
  assert(arm.status === 'target_full', 'status ' + arm.status);
  src.inv.remove('coal', 200);
  run(g, 60 * 3);
  assert(arm.status === 'waiting', 'nothing left to take: ' + arm.status);
});

test('oil: pumpjack -> refinery -> chemical plant makes plastic', () => {
  const g = newGame();
  const W0 = g.world.W;
  g.world.res[101 * W0 + 101] = FG.RES.OIL; g.world.amt[101 * W0 + 101] = 100;
  for (const id of ['oil_processing', 'plastics']) g.completeResearch(id, true);
  solarField(g, 60, 60, 4, 6);
  place(g, 'big_pole', 93, 78);
  place(g, 'big_pole', 98, 98);
  place(g, 'big_pole', 98, 106);
  const pj = place(g, 'pumpjack', 100, 100, S); // output at (101,102) facing south -> (101,103)
  for (let y = 103; y < 106; y++) place(g, 'pipe', 101, y);
  const ref = place(g, 'refinery', 100, 106, S); // rotated 180: inputs now at top
  FG.machines.setRecipe(g, ref, 'basic_refining');
  run(g, 5);
  // Check that the refinery crude input box is connected to the pipe network.
  const crude = ref.fbs[ref.fmap.in.crude_oil];
  assert(crude.net && crude.net.boxes.length > 2, 'crude input connected (' + (crude.net && crude.net.boxes.length) + ')');
  // Petroleum output: after rotating south, outputs are at the bottom row.
  const pet = ref.fbs[ref.fmap.out.petroleum];
  const c = pet.conns[0];
  let x = c.x + FG.DX[c.d], y = c.y + FG.DY[c.d];
  const pipes = [];
  for (let k = 0; k < 2; k++) { pipes.push(place(g, 'pipe', x, y)); y += 1; }
  const chem = place(g, 'chem_plant', x - 2, y, S); // 180: inputs at top row
  FG.machines.setRecipe(g, chem, 'plastic');
  chem.inp.coal = 50;
  place(g, 'big_pole', x - 4, y + 1);
  place(g, 'big_pole', 93, y);
  run(g, 60 * 60);
  assert(g.stats.total.p.crude_oil > 100, 'crude ' + g.stats.total.p.crude_oil + ' pj ' + pj.status);
  assert(g.stats.total.p.petroleum > 50, 'petroleum ' + g.stats.total.p.petroleum + ' refinery ' + ref.status);
  assert((chem.out.plastic || 0) > 5, 'plastic ' + JSON.stringify(chem.out) + ' chem ' + chem.status);
});

test('gun turret defends against a crawler', () => {
  const g = newGame({ enemies: 'normal' });
  g.enemies.nests.length = 0; g.enemies.nestTiles.clear();
  const t = place(g, 'gun_turret', 100, 100);
  FG.insertItem(g, t, 'ammo_basic', 10, 'direct');
  const u = g.enemies.spawnUnit('crawler', 110, 101, null, t.id);
  run(g, 60 * 5);
  assert(g.enemies.units.indexOf(u) < 0, 'crawler should be dead (hp ' + u.hp + ')');
  assert(g.stats.kills === 1, 'kills ' + g.stats.kills);
  assert(!t.dead && t.hp > 300, 'turret intact ' + t.hp);
});

test('crawlers chew through an undefended building', () => {
  const g = newGame({ enemies: 'normal' });
  g.enemies.nests.length = 0; g.enemies.nestTiles.clear();
  const c = place(g, 'wooden_chest', 100, 100);
  for (let i = 0; i < 4; i++) g.enemies.spawnUnit('crawler', 110 + i, 100, null, c.id);
  run(g, 60 * 20);
  assert(c.dead, 'chest should be destroyed, hp ' + c.hp);
});

test('fast replace upgrades belts keeping items', () => {
  const g = newGame();
  const b = place(g, 'belt', 60, 60, E);
  run(g, 1);
  FG.belts.laneInsert(b.lanes[0], 'coal', 0.5, 1);
  const chk = FG.canPlace(g, 'fast_belt', 60, 60, E);
  assert(chk.ok && chk.replace === b, 'replaceable');
  const res = FG.replaceEntity(g, b, 'fast_belt', E);
  assert(res.ent.lanes[0].ids[0] === 'coal', 'items kept');
});

// ------------------------------------------------------------------ trains
const RL = FG.rails, TR = FG.trains;
// Lay pieces (S straight, L/R curve) from rail point (x, y) heading d. Returns the rail
// points visited as [x, y, heading], ending with the final state.
function track(g, x, y, d, types) {
  const pts = [[x, y, d]];
  for (const t of types) {
    assert(RL.build(g, x, y, d, t), 'track ' + t + ' at ' + x + ',' + y + ' heading ' + d);
    [x, y, d] = RL.endOf(x, y, d, t);
    pts.push([x, y, d]);
  }
  return pts;
}
const S_ = (n) => new Array(n).fill('S');
// Clockwise rounded rectangle from (x, y) heading east: n pieces across, m down.
function loop(g, x, y, n, m) {
  let pts = [];
  let st = [x, y, 2];
  for (let k = 0; k < 4; k++) {
    const p = track(g, st[0], st[1], st[2], S_(k % 2 ? m : n).concat(['R', 'R']));
    pts = pts.concat(p.slice(0, -1));
    st = p[p.length - 1];
  }
  assert(st[0] === x && st[1] === y && st[2] === 2, 'loop closes at ' + st);
  return pts;
}
// A signal or stop beside rail point (x, y) for trains heading d.
function side(g, proto, x, y, d, name, optional) {
  const [tx, ty] = RL.sideTile(x, y, d);
  if (optional && !FG.canPlace(g, proto, tx, ty, 0).ok) return null;
  const e = place(g, proto, tx, ty);
  e.rd = d;
  if (name) e.name = name;
  g.rail.dirty = true;
  return e;
}
function fuel(tr) { for (const c of tr.cars) if (c.type === 'loco') c.inv.add('coal', 50); }
// The train's path is continuous, covers the whole train, and cars keep their length.
function intact(tr) {
  if (tr.headS - TR.trainLen(tr) < -1e-6) return 'tail off track (' + (tr.headS - TR.trainLen(tr)).toFixed(3) + ')';
  if (tr.headS > tr.endS + 1e-6) return 'head past the end of its path';
  for (let i = 1; i < tr.segs.length; i++) {
    const a = RL.endState(tr.segs[i - 1]), b = RL.startState(tr.segs[i]);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return 'path broken at ' + i;
  }
  for (let i = 0; i < tr.cars.length; i++) {
    const p = TR.carPose(tr, i);
    const len = Math.hypot(p.fx - p.bx, p.fy - p.by);
    if (len < TR.CAR_LEN * 0.95 || len > TR.CAR_LEN + 1e-6) return 'car ' + i + ' length ' + len.toFixed(2);
  }
  return null;
}
function allIntact(g) { for (const tr of g.rail.trains) { const bad = intact(tr); if (bad) return 'train ' + tr.id + ': ' + bad; } return null; }
// Cars of different trains never overlap (bodies shrunk a little so touching is fine).
function segSeg(a, b) {
  const ps = (px, py, s) => TR.segDist(px, py, s);
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const A1 = [a.bx, a.by], A2 = [a.fx, a.fy], B1 = [b.bx, b.by], B2 = [b.fx, b.fy];
  if (cross(A1, A2, B1) * cross(A1, A2, B2) < 0 && cross(B1, B2, A1) * cross(B1, B2, A2) < 0) return 0;
  return Math.min(ps(A1[0], A1[1], b), ps(A2[0], A2[1], b), ps(B1[0], B1[1], a), ps(B2[0], B2[1], a));
}
function shrink(p, k) {
  const dx = p.fx - p.bx, dy = p.fy - p.by, l = Math.hypot(dx, dy) || 1;
  return { fx: p.fx - (dx / l) * k, fy: p.fy - (dy / l) * k, bx: p.bx + (dx / l) * k, by: p.by + (dy / l) * k };
}
function noOverlap(g) {
  const cars = [];
  for (const tr of g.rail.trains) for (let i = 0; i < tr.cars.length; i++) cars.push([tr.id, shrink(TR.carPose(tr, i), 0.5)]);
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    if (cars[i][0] === cars[j][0]) continue;
    if (segSeg(cars[i][1], cars[j][1]) < 0.8) return false;
  }
  return true;
}
function head(tr) { return TR.pointAt(tr, tr.headS); }

console.log('Railways');
test('rail pieces sit on a 2-tile grid and curves turn 45 degrees', () => {
  for (let d = 0; d < 8; d++) for (const t of RL.TYPES) {
    const [x, y, h] = RL.endOf(100, 100, d, t);
    assert(x % 2 === 0 && y % 2 === 0, 'end on the grid ' + [d, t, x, y]);
    assert(h === (t === 'S' ? d : t === 'R' ? (d + 1) & 7 : (d + 7) & 7), 'heading after ' + t);
    // The same piece seen from its other end is the mirror curve.
    const back = RL.endOf(x, y, RL.opp8(h), t === 'S' ? 'S' : t === 'L' ? 'R' : 'L');
    assert(back[0] === 100 && back[1] === 100 && back[2] === RL.opp8(d), 'reversible ' + [d, t] + ' -> ' + back);
    assert(RL.pieceKeyOf(100, 100, d, t) === RL.pieceKeyOf(x, y, RL.opp8(h), t === 'S' ? 'S' : t === 'L' ? 'R' : 'L'), 'one key per piece');
  }
  // Two curves make a smooth 90 degree turn spanning 12 x 12 tiles.
  const a = RL.endOf(0 + 100, 100, 2, 'R'), b = RL.endOf(a[0], a[1], a[2], 'R');
  assert(b[0] === 112 && b[1] === 112 && b[2] === 4, 'quarter turn ' + b);
});

test('track is smooth: joints match in position and heading, curves have a wide radius', () => {
  const g = newGame();
  const pts = track(g, 60, 60, 2, ['S', 'R', 'S', 'L', 'S', 'S', 'R', 'R', 'L', 'S']);
  const segs = [];
  let st = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const out = RL.outOf(g, st[0], st[1], st[2]);
    const next = out.find((e) => { const s = RL.endState(e); return s[0] === pts[i + 1][0] && s[1] === pts[i + 1][1]; });
    assert(next, 'piece ' + i + ' reachable');
    segs.push(next);
    st = RL.endState(next);
  }
  const p = [0, 0, 0], q = [0, 0, 0];
  let minR = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const e = segs[i];
    if (i > 0) {
      RL.posAt(segs[i - 1].pc, segs[i - 1].pc.len, segs[i - 1].fwd, p);
      RL.posAt(e.pc, 0, e.fwd, q);
      let da = Math.abs(p[2] - q[2]) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      assert(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6, 'joint ' + i + ' position');
      assert(da < 0.03, 'joint ' + i + ' heading differs by ' + da.toFixed(3));
    }
    if (e.pc.t !== 'S') for (let s = 0.5; s < e.pc.len - 0.5; s += 0.5) {
      RL.posAt(e.pc, s, true, p); RL.posAt(e.pc, s + 0.5, true, q);
      let da = Math.abs(q[2] - p[2]); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > 1e-6) minR = Math.min(minR, 0.5 / da);
    }
  }
  assert(minR > 7, 'tightest curve radius ' + minR.toFixed(1) + ' tiles');
  // The bed covers tiles under the track and nothing can be built there.
  const c = FG.canPlace(g, 'wooden_chest', 61, 59, 0);
  assert(!c.ok && /Track/.test(c.reason), 'track blocks buildings: ' + c.reason);
});

test('the rail planner routes straights, diagonals and curves around obstacles', () => {
  const g = newGame();
  place(g, 'iron_chest', 100, 90);
  const steps = RL.plan(g, RL.startsAt(g, 60, 80, 2), 130, 110);
  assert(steps.reached, 'planner reached the target');
  let x = 60, y = 80, d = steps[0].ah;
  for (const st of steps) {
    assert(st.ax === x && st.ay === y && st.ah === d, 'continuous plan');
    [x, y, d] = RL.endOf(st.ax, st.ay, st.ah, st.t);
  }
  assert(x === 130 && y === 110, 'ends at the target');
  assert(steps.some((s) => s.t !== 'S'), 'uses curves');
  assert(steps.some((s) => s.t === 'S' && (s.ah & 1)), 'uses a diagonal');
  for (const st of steps) assert(RL.build(g, st.ax, st.ay, st.ah, st.t), 'buildable');
  assert(FG.entAt(g, 100, 90), 'chest untouched');
  // Planning from the end of existing track continues it instead of starting fresh.
  const more = RL.plan(g, RL.startsAt(g, 130, 110), 150, 110);
  assert(more.reached && more[0].ax === 130 && more[0].ay === 110, 'extends from the end');
  assert(RL.axisAt(g, 130, 110, more[0].ah), 'continues along the existing track');
});

test('signals and stops snap beside the track, on the right of the way they guard', () => {
  const g = newGame();
  track(g, 60, 80, 2, S_(10));
  const e = RL.snapSide(g, 69.4, 81.6);
  assert(e && e.px === 70 && e.py === 80 && e.pd === 2 && e.tx === 69 && e.ty === 81, 'south side guards eastbound ' + JSON.stringify(e));
  const w = RL.snapSide(g, 70.5, 78.4);
  assert(w && w.px === 70 && w.pd === 6 && w.tx === 70 && w.ty === 78, 'north side guards westbound ' + JSON.stringify(w));
  const s = side(g, 'rail_signal', 70, 80, 2);
  run(g, 1);
  assert(s.attached && s.px === 70 && s.py === 80, 'signal attached');
  assert(TR.signalState(g, s) === 'free', 'clear block ' + TR.signalState(g, s));
  const loose = place(g, 'rail_signal', 90, 70);
  run(g, 1);
  assert(!loose.attached && TR.signalState(g, loose) === 'none', 'a signal away from track does nothing');
});

test('train runs a schedule between two stops, reversing with a rear locomotive', () => {
  const g = newGame();
  track(g, 60, 80, 2, S_(30));
  side(g, 'train_stop', 116, 80, 2, 'Base');
  side(g, 'train_stop', 64, 80, 6, 'Mine');
  let r = TR.placeCar(g, 'loco', 100, 80, E);
  assert(r.ok, 'place loco: ' + r.reason);
  const tr = r.train;
  r = TR.placeCar(g, 'wagon', 93, 80, E);
  assert(r.ok && r.train === tr && tr.cars.length === 2, 'couple wagon: ' + r.reason);
  r = TR.placeCar(g, 'loco', 86, 80, W);
  assert(r.ok && r.train === tr && tr.cars.length === 3 && tr.cars[2].flip, 'rear loco faces back');
  fuel(tr);
  tr.schedule = [{ station: 'Base', cond: 'time', v: 2 }, { station: 'Mine', cond: 'time', v: 2 }];
  tr.mode = 'auto';
  let base = false, mine = false;
  for (let t = 0; t < 60 * 40 && !(base && mine); t++) {
    g.step();
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
    if (tr.state === 'station' && Math.abs(head(tr)[0] - 116) < 0.01) base = true;
    if (base && tr.state === 'station' && Math.abs(head(tr)[0] - 64) < 0.01) mine = true;
  }
  assert(base, 'reached Base: ' + tr.state + ' ' + tr.msg + ' head ' + head(tr));
  assert(mine, 'came back to Mine: ' + tr.state + ' ' + tr.msg + ' head ' + head(tr));
  assert(g.stats.total.c.coal > 0, 'locomotive burned fuel');
});

test('a train follows curves and diagonals around a loop at speed', () => {
  const g = newGame();
  const pts = loop(g, 60, 60, 12, 6);
  side(g, 'train_stop', 72, 60, 2, 'Top');
  side(g, 'train_stop', 72, 96, 6, 'Bottom');
  const tr = TR.placeCar(g, 'loco', 70, 60, E).train;
  TR.placeCar(g, 'wagon', 63, 60, E);
  fuel(tr);
  tr.schedule = [{ station: 'Bottom', cond: 'time', v: 0.5 }, { station: 'Top', cond: 'time', v: 0.5 }];
  tr.mode = 'auto';
  let maxV = 0, onCurve = false, minX = 1e9, maxX = -1e9;
  for (let t = 0; t < 60 * 60; t++) {
    g.step();
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
    maxV = Math.max(maxV, tr.speed);
    const sg = tr.segs[Math.min(tr.segs.length - 1, tr.segs.findIndex((s) => s.s0 + s.len >= tr.headS))];
    if (sg && sg.pc.t !== 'S' && tr.speed > 0.2) onCurve = true;
    const h = head(tr); minX = Math.min(minX, h[0]); maxX = Math.max(maxX, h[0]);
  }
  assert(tr.arrivals >= 4, 'laps completed: ' + tr.arrivals + ' ' + tr.state + ' ' + tr.msg);
  assert(maxV > 0.45, 'reached full speed ' + maxV.toFixed(2));
  assert(onCurve, 'took a curve at speed');
  assert(minX < 52 && maxX > 92, 'went all the way round: ' + minX.toFixed(1) + '..' + maxX.toFixed(1) + ' (' + pts.length + ' points)');
});

test('arms load a wagon at one stop and unload it at another', () => {
  const g = newGame();
  track(g, 40, 80, 2, S_(40));
  side(g, 'train_stop', 60, 80, 6, 'Load');
  side(g, 'train_stop', 116, 80, 2, 'Drop');
  const tr = TR.placeCar(g, 'loco', 100, 80, E).train;
  TR.placeCar(g, 'wagon', 93, 80, E);
  const rear = TR.placeCar(g, 'loco', 86, 80, W);
  assert(rear.ok && tr.cars.length === 3, 'rear loco coupled: ' + rear.reason);
  fuel(tr);
  // Loading beside the wagon (x 67..73 heading west at Load), from the north.
  const src = place(g, 'iron_chest', 70, 77);
  src.inv.add('iron_plate', 3200);
  const arm = place(g, 'fast_inserter', 70, 78, S);
  place(g, 'solar_panel', 66, 73); place(g, 'solar_panel', 72, 73); place(g, 'small_pole', 71, 76);
  // Unloading at Drop (wagon over x 103..109 heading east), to the south.
  const dst = place(g, 'steel_chest', 106, 82);
  place(g, 'fast_inserter', 106, 81, S);
  place(g, 'solar_panel', 102, 84); place(g, 'solar_panel', 106, 84); place(g, 'small_pole', 105, 83);
  tr.schedule = [{ station: 'Load', cond: 'time', v: 8 }, { station: 'Drop', cond: 'empty' }];
  tr.mode = 'auto';
  run(g, 60 * 50);
  const inDst = dst.inv.count('iron_plate');
  assert(inDst > 10, 'plates delivered: ' + inDst + ' state ' + tr.state + ' cur ' + tr.cur + ' cargo ' + JSON.stringify(TR.cargoTotals(tr)) + ' arm ' + arm.status + ' head ' + head(tr));
  assert(tr.arrivals >= 2, 'arrivals ' + tr.arrivals);
});

test('signalled loop keeps three trains apart', () => {
  const g = newGame();
  const pts = loop(g, 60, 60, 20, 10);
  // Two stops and signals along the loop (clockwise travel).
  side(g, 'train_stop', 84, 60, 2, 'North');
  side(g, 'train_stop', 84, 104, 6, 'South');
  pts.forEach(([x, y, d], i) => { if (i % 6 === 3) side(g, 'rail_signal', x, y, d, null, true); });
  const trains = [];
  for (const [x, y, dir] of [[76, 60, E], [112, 84, S], [90, 104, W]]) {
    const r = TR.placeCar(g, 'loco', x, y, dir);
    assert(r.ok, 'place ' + x + ',' + y + ': ' + r.reason);
    fuel(r.train);
    r.train.schedule = [{ station: 'North', cond: 'time', v: 1 }, { station: 'South', cond: 'time', v: 1 }];
    r.train.mode = 'auto';
    trains.push(r.train);
  }
  let ok = true;
  for (let t = 0; t < 60 * 90; t++) {
    g.step();
    if (t % 3 === 0 && !noOverlap(g)) { ok = false; break; }
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(ok, 'trains overlapped');
  const arrivals = trains.map((t) => t.arrivals);
  assert(arrivals.every((a) => a >= 3), 'every train keeps running: ' + arrivals + ' states ' + trains.map((t) => t.state + '/' + t.blocked + '/' + t.msg));
});

test('chain signals keep level crossings moving without collisions', () => {
  const g = newGame();
  // Two loops crossing at four points: A is wide, B is tall.
  const A = loop(g, 60, 80, 40, 10), B = loop(g, 90, 50, 10, 40);
  side(g, 'train_stop', 100, 80, 2, 'A1'); side(g, 'train_stop', 100, 124, 6, 'A2');
  side(g, 'train_stop', 100, 50, 2, 'B1'); side(g, 'train_stop', 100, 154, 6, 'B2');
  const onA = new Set(A.map(([x, y]) => x + ',' + y)), onB = new Set(B.map(([x, y]) => x + ',' + y));
  for (const [pts, other] of [[A, onB], [B, onA]]) {
    const cross = [];
    pts.forEach(([x, y], i) => { if (other.has(x + ',' + y)) cross.push(i); });
    assert(cross.length === 4, 'four crossings, got ' + cross.length);
    const near = (i) => cross.some((c) => Math.abs(c - i) <= 3 || Math.abs(c - i) >= pts.length - 3);
    for (const c of cross) {
      const b = pts[(c - 2 + pts.length) % pts.length], a = pts[(c + 2) % pts.length];
      side(g, 'chain_signal', b[0], b[1], b[2]);
      side(g, 'rail_signal', a[0], a[1], a[2]);
    }
    pts.forEach(([x, y, d], i) => { if (i % 8 === 5 && !near(i)) side(g, 'rail_signal', x, y, d, null, true); });
  }
  const trains = [];
  const add = (x, y, dir, s1, s2) => {
    const r = TR.placeCar(g, 'loco', x, y, dir);
    assert(r.ok, 'place ' + x + ',' + y + ' ' + r.reason);
    const w = TR.placeCar(g, 'wagon', x - FG.DX[dir] * 7, y - FG.DY[dir] * 7, dir);
    assert(w.ok && w.train === r.train, 'wagon ' + w.reason);
    fuel(r.train);
    r.train.schedule = [{ station: s1, cond: 'time', v: 1 }, { station: s2, cond: 'time', v: 1 }];
    r.train.mode = 'auto';
    trains.push(r.train);
  };
  add(110, 80, E, 'A2', 'A1'); add(96, 124, W, 'A1', 'A2');
  add(122, 104, S, 'B2', 'B1'); add(78, 100, N, 'B1', 'B2');
  let ok = true;
  for (let t = 0; t < 60 * 150; t++) {
    g.step();
    if (t % 3 === 0 && !noOverlap(g)) { ok = false; break; }
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(ok, 'trains overlapped');
  const arr = trains.map((t) => t.arrivals);
  assert(arr.every((a) => a >= 3), 'all trains keep moving: ' + arr + ' states ' + trains.map((t) => t.state + '/' + t.blocked + '/' + t.speed.toFixed(2)));
});

test('a wye junction and a balloon loop serve three trains', () => {
  const g = newGame();
  const X = 80, Y = 140;
  const lay = (x, y, d, types) => track(g, x, y, d, types).pop();
  const main = loop(g, X, Y, 30, 8);
  lay(X + 24, Y, 2, ['L', 'L']); // branch up to the stem
  lay(X + 36, Y - 12, 4, ['L', 'L']); // and back down into the loop
  const Q = lay(X + 36, Y - 12, 0, S_(6));
  const back = lay(Q[0], Q[1], 0, ['R', 'R', 'L', 'L', 'L', 'L'].concat(S_(12), ['L', 'L', 'L', 'L', 'R', 'R']));
  assert(back[0] === Q[0] && back[1] === Q[1] && back[2] === 4, 'balloon returns down the stem ' + back);
  side(g, 'train_stop', Q[0], Q[1] - 36, 6, 'Mine');
  side(g, 'train_stop', X + 30, Y + 40, 6, 'Smelter');
  main.forEach(([x, y, d], i) => { if (i % 9 === 4 && !(y === Y && x >= X + 16 && x <= X + 56)) side(g, 'rail_signal', x, y, d, null, true); });
  side(g, 'chain_signal', X + 20, Y, 2);
  side(g, 'rail_signal', X + 52, Y, 2);
  side(g, 'rail_signal', X + 36, Y - 14, 0);
  side(g, 'rail_signal', X + 36, Y - 14, 4);
  const trains = [];
  for (const [x, y, dir] of [[X + 10, Y + 40, W], [X + 46, Y + 40, W], [X + 14, Y, E]]) {
    const tr = TR.placeCar(g, 'loco', x, y, dir).train;
    for (let k = 1; k <= 2; k++) assert(TR.placeCar(g, 'wagon', x - FG.DX[dir] * 7 * k, y - FG.DY[dir] * 7 * k, dir).train === tr, 'wagon coupled');
    fuel(tr);
    tr.schedule = [{ station: 'Mine', cond: 'time', v: 2 }, { station: 'Smelter', cond: 'time', v: 2 }];
    tr.mode = 'auto';
    trains.push(tr);
  }
  let ok = true;
  for (let t = 0; t < 60 * 150; t++) {
    g.step();
    if (t % 3 === 0 && !noOverlap(g)) { ok = false; break; }
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(ok, 'trains overlapped');
  const arr = trains.map((t) => t.arrivals);
  assert(arr.every((a) => a >= 6), 'all trains keep cycling: ' + arr + ' ' + trains.map((t) => t.state + '/' + t.blocked + '/' + t.msg));
});

test('a one-way track is never driven against its signals', () => {
  const g = newGame();
  // A loop with signals facing clockwise only; the stop is reached by going round.
  const pts = loop(g, 60, 60, 12, 6);
  pts.forEach(([x, y, d], i) => { if (i % 5 === 2) side(g, 'rail_signal', x, y, d); });
  side(g, 'train_stop', 70, 60, 2, 'Top');
  // Loco sitting just past the stop, facing clockwise, with a rear loco that could reverse.
  const tr = TR.placeCar(g, 'loco', 82, 60, E).train;
  TR.placeCar(g, 'loco', 75, 60, W);
  fuel(tr);
  tr.schedule = [{ station: 'Top', cond: 'time', v: 1 }];
  tr.mode = 'auto';
  let backwards = false;
  for (let t = 0; t < 60 * 40 && tr.arrivals < 1; t++) {
    g.step();
    const lead = tr.cars[0];
    if (tr.speed > 0 && lead.flip) backwards = true;
  }
  assert(tr.arrivals >= 1, 'arrived: ' + tr.state + ' ' + tr.msg);
  assert(!backwards, 'went round the loop instead of reversing against the signals');
});

test('trains meeting head-on stop instead of colliding', () => {
  const g = newGame();
  track(g, 60, 80, 2, S_(30));
  side(g, 'train_stop', 62, 80, 6, 'W');
  side(g, 'train_stop', 118, 80, 2, 'E');
  const a = TR.placeCar(g, 'loco', 72, 80, E).train;
  const b = TR.placeCar(g, 'loco', 108, 80, W).train;
  fuel(a); fuel(b);
  a.schedule = [{ station: 'E', cond: 'time', v: 1 }]; a.mode = 'auto';
  b.schedule = [{ station: 'W', cond: 'time', v: 1 }]; b.mode = 'auto';
  let ok = true;
  for (let t = 0; t < 60 * 20; t++) { g.step(); if (!noOverlap(g)) { ok = false; break; } }
  assert(ok, 'no collision');
  assert(a.speed === 0 && b.speed === 0, 'both stopped: ' + a.speed + ',' + b.speed);
});

test('manual driving follows the steer at a junction', () => {
  const g = newGame();
  track(g, 60, 80, 2, S_(20));
  track(g, 76, 80, 2, ['L', 'L'].concat(S_(6))); // branch curving north
  const tr = TR.placeCar(g, 'loco', 70, 80, E).train;
  TR.placeCar(g, 'wagon', 63, 80, E);
  fuel(tr);
  tr.mode = 'manual';
  tr.ctrl = { throttle: 1, steer: -1 };
  let turned = false;
  for (let t = 0; t < 60 * 10; t++) {
    g.step();
    if (head(tr)[1] < 72) turned = true;
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(turned, 'train turned north at the junction: head ' + head(tr));
  assert(tr.speed === 0, 'stopped at the end of the branch');
});

test('removing a middle car splits the train', () => {
  const g = newGame();
  track(g, 40, 80, 2, S_(40));
  const tr = TR.placeCar(g, 'loco', 90, 80, E).train;
  TR.placeCar(g, 'wagon', 83, 80, E);
  TR.placeCar(g, 'wagon', 76, 80, E);
  TR.placeCar(g, 'loco', 69, 80, E);
  assert(tr.cars.length === 4, 'four cars ' + tr.cars.length);
  TR.removeCar(g, tr, 1);
  assert(g.rail.trains.length === 2, 'split into two trains');
  const [a, b] = g.rail.trains;
  assert(a.cars.length === 1 && b.cars.length === 2, 'sizes ' + a.cars.length + '/' + b.cars.length);
  run(g, 5);
  assert(noOverlap(g) && !allIntact(g), 'no overlap after split');
});

test('picking up track under a train is refused; removing it ahead reroutes', () => {
  const g = newGame();
  track(g, 60, 80, 2, S_(20));
  const tr = TR.placeCar(g, 'loco', 70, 80, E).train;
  run(g, 2);
  const under = RL.pieceNear(g, 70, 80).pc, ahead = RL.pieceNear(g, 95, 80).pc;
  assert(!g.pickUpRail(under), 'refused under train');
  assert(g.pickUpRail(ahead) && g.player.inv.count('rail') === 1, 'removed ahead, rail returned');
  run(g, 2);
  assert(g.rail.trains.length === 1 && !tr.dead, 'train still there');
  // A curve is worth four rails.
  const c = RL.build(g, 100, 60, 2, 'R');
  assert(g.pickUpRail(c) && g.player.inv.count('rail') === 5, 'curve refunds 4');
});

if (FG.demoFactory) {
  test('the demo factory builds cleanly and every part of it runs', () => {
    const g = FG.demoFactory();
    assert(!g.demo.failed.length, 'everything placed: ' + g.demo.failed.join('; '));
    const t0 = Object.assign({}, g.stats.total.p);
    const r0 = g.research.progress.fast_inserter || 0;
    run(g, 60 * 150);
    const made = (id) => (g.stats.total.p[id] || 0) - (t0[id] || 0);
    assert(made('iron_ore') > 200 && made('iron_plate') > 200, 'iron mined and smelted: ' + made('iron_ore') + ' / ' + made('iron_plate'));
    assert(made('copper_plate') > 30, 'copper arrives by train and is smelted: ' + made('copper_plate'));
    assert(made('sci_1') >= 12 && made('iron_gear') > 10, 'science packs made: ' + made('sci_1'));
    assert(made('coal') > 10, 'coal outpost mines: ' + made('coal'));
    assert((g.research.progress.fast_inserter || 0) > r0 || g.research.done.fast_inserter, 'labs research');
    assert(g.byKind.boiler.every((b) => b.status === 'working') && g.byKind.engine.some((e) => e.out > 0), 'steam power runs');
    assert(g.demo.train.arrivals >= 3, 'the copper train runs: ' + g.demo.train.arrivals + ' ' + g.demo.train.state);
    assert(!g.byKind.inserter.some((e) => e.status === 'no_power') && !g.byKind.drill.some((e) => e.status === 'no_power'), 'everything is powered');
  });
}

if (FG.save) {
  test('save and load round-trip preserves the factory', () => {
    const g = newGame();
    ore(g, 'IRON', 100, 100, 2, 2);
    const d = place(g, 'burner_drill', 100, 100, E);
    const f = place(g, 'stone_furnace', 102, 100);
    FG.insertItem(g, d, 'coal', 10, 'direct');
    FG.insertItem(g, f, 'coal', 10, 'direct');
    g.queueResearch('automation');
    run(g, 600);
    const asm = place(g, 'assembler_1', 110, 110);
    FG.machines.setRecipe(g, asm, 'iron_gear');
    asm.out.iron_gear = 7; asm.inp.iron_plate = 9;
    const belt = place(g, 'belt', 110, 115, E);
    run(g, 1);
    FG.belts.laneInsert(belt.lanes[0], 'coal', 0.5, 1);
    track(g, 120, 120, 2, S_(20));
    side(g, 'train_stop', 150, 120, 2, 'Depot');
    track(g, 150, 120, 2, ['R', 'L']);
    const loco = TR.placeCar(g, 'loco', 126, 120, E).train;
    fuel(loco);
    loco.schedule = [{ station: 'Depot', cond: 'time', v: 30 }];
    loco.mode = 'auto';
    run(g, 40);
    const mid = head(loco);
    const plates = asm.inp.iron_plate;
    const json = FG.save.serialize(g);
    const g2 = FG.save.deserialize(json);
    assert(g2.ents.size === g.ents.size, 'entity count');
    assert(g2.world.amt[100 * g.world.W + 100] === g.world.amt[100 * g.world.W + 100], 'ore amounts preserved');
    assert(g2.research.current === 'automation', 'research preserved');
    const a2 = FG.entAt(g2, 110, 110);
    assert(a2.out && a2.out.iron_gear === 7 && a2.inp.iron_plate === plates && a2.crafting === asm.crafting && a2.recipe === 'iron_gear', 'assembler contents preserved ' + JSON.stringify([a2.out, a2.inp]));
    assert(FG.entAt(g2, 110, 115).lanes[0].ids[0] === 'coal', 'belt items preserved');
    assert(g2.rail.pieces.size === g.rail.pieces.size, 'track preserved');
    assert(g2.rail.trains.length === 1 && TR.stopsNamed(g2, 'Depot').length === 1, 'train and stop preserved');
    const t2 = g2.rail.trains[0];
    assert(Math.hypot(head(t2)[0] - mid[0], head(t2)[1] - mid[1]) < 0.01, 'train position preserved');
    run(g2, 60 * 10);
    assert(t2.state === 'station' && Math.abs(head(t2)[0] - 150) < 0.01, 'loaded train reaches its stop: ' + t2.state + ' ' + head(t2));
    const before = f.out ? f.out.n : 0;
    run(g2, 900);
    const f2 = FG.entAt(g2, 102, 100);
    assert(f2.out && f2.out.n > before, 'still smelting after load: ' + before + ' -> ' + JSON.stringify(f2.out));
  });
}

console.log('\n' + passed + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
