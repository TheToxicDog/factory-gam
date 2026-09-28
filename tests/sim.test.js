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
// Lay track through a list of [x, y] tiles, placing `proto` pieces where given.
function lay(g, pts, special) {
  special = special || {};
  let prev = null;
  for (const [x, y] of pts) {
    let e = FG.trains.railAt(g, x, y);
    if (!e) e = place(g, special[x + ',' + y] || 'rail', x, y);
    if (prev) FG.trains.connect(g, prev, e);
    prev = e;
  }
}
function line(x0, y0, x1, y1) {
  const out = [];
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  out.push([x, y]);
  while (x !== x1 || y !== y1) { x += dx; y += dy; out.push([x, y]); }
  return out;
}
function rect(x0, y0, x1, y1) {
  return line(x0, y0, x1, y0).concat(line(x1, y0 + 1, x1, y1), line(x1 - 1, y1, x0, y1), line(x0, y1 - 1, x0, y0 + 1));
}
function fuel(tr) { for (const c of tr.cars) if (c.type === 'loco') c.inv.add('coal', 50); }
// Cars keep their length and the train's track always covers its tail.
function intact(tr) {
  if (tr.headS - FG.trains.trainLen(tr) < tr.tiles[0].s0 - 1e-6) return 'tail off track';
  for (let i = 0; i < tr.cars.length; i++) {
    const p = FG.trains.carPose(tr, i);
    const len = Math.hypot(p.fx - p.bx, p.fy - p.by);
    if (len < 1.6 || len > 2.41) return 'car ' + i + ' length ' + len.toFixed(2);
  }
  return null;
}
function allIntact(g) { for (const tr of g.rail.trains) { const bad = intact(tr); if (bad) return 'train ' + tr.id + ': ' + bad; } return null; }
function noOverlap(g) {
  const seen = new Map();
  for (const tr of g.rail.trains) for (let i = 0; i < tr.cars.length; i++) {
    const p = FG.trains.carPose(tr, i);
    for (const [id, q] of seen) if (id !== tr.id && Math.hypot(p.x - q.x, p.y - q.y) < 1.5) return false;
    seen.set(tr.id + ':' + i, p);
  }
  return true;
}

test('train runs a schedule between two stops', () => {
  const g = newGame();
  lay(g, line(60, 80, 110, 80), { '64,80': 'train_stop', '106,80': 'train_stop' });
  const a = FG.trains.railAt(g, 64, 80), b = FG.trains.railAt(g, 106, 80);
  a.name = 'Mine'; b.name = 'Base';
  let r = FG.trains.placeCar(g, 'loco', 70, 80, 1);
  assert(r.ok, 'place loco: ' + r.reason);
  const tr = r.train;
  r = FG.trains.placeCar(g, 'wagon', 67, 80, 1);
  assert(r.ok && r.train === tr && tr.cars.length === 2, 'couple wagon: ' + r.reason);
  r = FG.trains.placeCar(g, 'loco', 64, 80, 3); // rear locomotive facing west
  assert(r.ok && r.train === tr && tr.cars.length === 3 && tr.cars[2].flip, 'rear loco faces back');
  fuel(tr);
  tr.schedule = [{ station: 'Base', cond: 'time', v: 2 }, { station: 'Mine', cond: 'time', v: 2 }];
  tr.mode = 'auto';
  let arrivedBase = false, arrivedMine = false;
  for (let t = 0; t < 60 * 40 && !(arrivedBase && arrivedMine); t++) {
    g.step();
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
    const head = FG.trains.pointAt(tr, tr.headS);
    if (tr.state === 'station' && Math.abs(head[0] - 107) < 0.6) arrivedBase = true;
    if (arrivedBase && tr.state === 'station' && Math.abs(head[0] - 64) < 1.1) arrivedMine = true;
  }
  assert(arrivedBase, 'reached Base: state ' + tr.state + ' ' + tr.msg + ' head ' + FG.trains.pointAt(tr, tr.headS));
  assert(arrivedMine, 'came back to Mine (reversing): state ' + tr.state + ' head ' + FG.trains.pointAt(tr, tr.headS));
  assert(g.stats.total.c.coal > 0, 'locomotive burned fuel');
});

test('arms load a wagon at one stop and unload it at another', () => {
  const g = newGame();
  lay(g, line(50, 80, 110, 80), { '66,80': 'train_stop', '106,80': 'train_stop' });
  FG.trains.railAt(g, 66, 80).name = 'Load';
  FG.trains.railAt(g, 106, 80).name = 'Drop';
  const tr = FG.trains.placeCar(g, 'loco', 66, 80, 1).train;
  FG.trains.placeCar(g, 'wagon', 63, 80, 1);
  const rear = FG.trains.placeCar(g, 'loco', 60, 80, 3);
  assert(rear.ok && tr.cars.length === 3, 'rear loco coupled: ' + rear.reason);
  fuel(tr);
  // Loading: chest -> arm -> wagon (wagon sits over tiles 61..63 when the loco front is at the stop)
  const src = place(g, 'iron_chest', 62, 82);
  src.inv.add('iron_plate', 3200);
  const arm = place(g, 'fast_inserter', 62, 81, 0);
  place(g, 'solar_panel', 55, 83); place(g, 'solar_panel', 58, 83); place(g, 'small_pole', 61, 83);
  // Unloading at Drop: wagon over 101..103
  const dst = place(g, 'steel_chest', 102, 82);
  place(g, 'fast_inserter', 102, 81, 2);
  place(g, 'solar_panel', 95, 83); place(g, 'solar_panel', 98, 83); place(g, 'small_pole', 101, 83);
  tr.schedule = [{ station: 'Load', cond: 'time', v: 8 }, { station: 'Drop', cond: 'empty' }];
  tr.mode = 'auto';
  run(g, 60 * 50);
  const inDst = dst.inv.count('iron_plate');
  assert(inDst > 10, 'plates delivered: ' + inDst + ' state ' + tr.state + ' cur ' + tr.cur + ' cargo ' + JSON.stringify(FG.trains.cargoTotals(tr)) + ' arm ' + arm.status);
  assert(tr.arrivals >= 2, 'arrivals ' + tr.arrivals);
});

test('signalled loop keeps three trains apart', () => {
  const g = newGame();
  const loop = rect(60, 60, 120, 90);
  const special = {};
  // A signal every 12 tiles and two stops.
  loop.forEach(([x, y], i) => { if (i % 12 === 6) special[x + ',' + y] = 'rail_signal'; });
  special['90,60'] = 'train_stop';
  special['90,90'] = 'train_stop';
  lay(g, loop, special);
  FG.trains.connect(g, FG.trains.railAt(g, 60, 61), FG.trains.railAt(g, 60, 60));
  FG.trains.railAt(g, 90, 60).name = 'North';
  FG.trains.railAt(g, 90, 90).name = 'South';
  const trains = [];
  for (const [x, y] of [[70, 60], [120, 75], [75, 90]]) {
    const r = FG.trains.placeCar(g, 'loco', x, y, x === 120 ? 2 : y === 60 ? 1 : 3);
    assert(r.ok, 'place ' + x + ',' + y + ': ' + r.reason);
    fuel(r.train);
    r.train.schedule = [{ station: 'North', cond: 'time', v: 1 }, { station: 'South', cond: 'time', v: 1 }];
    r.train.mode = 'auto';
    trains.push(r.train);
  }
  let ok = true;
  for (let t = 0; t < 60 * 90; t++) {
    g.step();
    if (t % 5 === 0 && !noOverlap(g)) { ok = false; break; }
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(ok, 'trains overlapped');
  const arrivals = trains.map((t) => t.arrivals);
  assert(arrivals.every((a) => a >= 3), 'every train keeps running: ' + arrivals + ' states ' + trains.map((t) => t.state + '/' + t.blocked));
});

test('chain signals keep a level crossing moving without collisions', () => {
  const g = newGame();
  // Two loops that cross each other twice: A (wide) and B (tall).
  const A = rect(60, 80, 140, 100), B = rect(90, 60, 110, 120);
  const special = {};
  const crossings = [[90, 80], [110, 80], [90, 100], [110, 100]];
  const isCross = (x, y) => crossings.some(([a, b]) => a === x && b === y);
  // Chain signals 2 tiles before each crossing, rail signals 2 tiles after (in loop order).
  for (const loop of [A, B]) {
    loop.forEach(([x, y], i) => {
      if (isCross(x, y)) {
        const [bx, by] = loop[(i - 2 + loop.length) % loop.length];
        const [ax, ay] = loop[(i + 2) % loop.length];
        special[bx + ',' + by] = 'chain_signal';
        special[ax + ',' + ay] = 'rail_signal';
      }
    });
  }
  // Signals around the rest of each loop.
  for (const loop of [A, B]) loop.forEach(([x, y], i) => { if (i % 15 === 7 && !special[x + ',' + y] && !isCross(x, y)) special[x + ',' + y] = 'rail_signal'; });
  special['70,80'] = 'train_stop'; special['130,100'] = 'train_stop';
  special['100,60'] = 'train_stop'; special['100,120'] = 'train_stop';
  lay(g, A, special); FG.trains.connect(g, FG.trains.railAt(g, 60, 81), FG.trains.railAt(g, 60, 80));
  lay(g, B, special); FG.trains.connect(g, FG.trains.railAt(g, 90, 61), FG.trains.railAt(g, 90, 60));
  FG.trains.railAt(g, 70, 80).name = 'A1'; FG.trains.railAt(g, 130, 100).name = 'A2';
  FG.trains.railAt(g, 100, 60).name = 'B1'; FG.trains.railAt(g, 100, 120).name = 'B2';
  const trains = [];
  const add = (x, y, dir, s1, s2) => {
    const r = FG.trains.placeCar(g, 'loco', x, y, dir);
    assert(r.ok, 'place ' + x + ',' + y + ' ' + r.reason);
    FG.trains.placeCar(g, 'wagon', x - FG.DX[dir] * 3, y - FG.DY[dir] * 3, dir);
    fuel(r.train);
    r.train.schedule = [{ station: s1, cond: 'time', v: 1 }, { station: s2, cond: 'time', v: 1 }];
    r.train.mode = 'auto';
    trains.push(r.train);
  };
  add(78, 80, 1, 'A2', 'A1'); add(125, 100, 3, 'A1', 'A2');
  add(110, 70, 2, 'B2', 'B1'); add(90, 112, 0, 'B1', 'B2');
  let ok = true;
  for (let t = 0; t < 60 * 120; t++) {
    g.step();
    if (t % 4 === 0 && !noOverlap(g)) { ok = false; break; }
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(ok, 'trains overlapped');
  const arr = trains.map((t) => t.arrivals);
  assert(arr.every((a) => a >= 3), 'all trains keep moving: ' + arr + ' states ' + trains.map((t) => t.state + '/' + t.blocked + '/' + t.speed.toFixed(2)));
});

test('trains meeting head-on stop instead of colliding', () => {
  const g = newGame();
  lay(g, line(60, 80, 120, 80), { '61,80': 'train_stop', '119,80': 'train_stop' });
  FG.trains.railAt(g, 61, 80).name = 'W';
  FG.trains.railAt(g, 119, 80).name = 'E';
  const a = FG.trains.placeCar(g, 'loco', 70, 80, 1).train;
  const b = FG.trains.placeCar(g, 'loco', 110, 80, 3).train;
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
  lay(g, line(60, 80, 90, 80));
  lay(g, line(75, 80, 75, 60));
  const tr = FG.trains.placeCar(g, 'loco', 64, 80, 1).train;
  fuel(tr);
  tr.mode = 'manual';
  tr.ctrl = { throttle: 1, steer: -1 };
  FG.trains.placeCar(g, 'wagon', 61, 80, 1);
  let turned = false;
  for (let t = 0; t < 60 * 10; t++) {
    g.step();
    const p = FG.trains.pointAt(tr, tr.headS); if (p[1] < 76) turned = true;
    const bad = allIntact(g);
    if (bad) throw new Error('at tick ' + t + ' ' + bad);
  }
  assert(turned, 'train turned north at the junction: head ' + FG.trains.pointAt(tr, tr.headS));
});

test('removing a middle car splits the train', () => {
  const g = newGame();
  lay(g, line(60, 80, 100, 80));
  const tr = FG.trains.placeCar(g, 'loco', 80, 80, 1).train;
  FG.trains.placeCar(g, 'wagon', 77, 80, 1);
  FG.trains.placeCar(g, 'wagon', 74, 80, 1);
  FG.trains.placeCar(g, 'loco', 71, 80, 1);
  assert(tr.cars.length === 4, 'four cars ' + tr.cars.length);
  FG.trains.removeCar(g, tr, 1);
  assert(g.rail.trains.length === 2, 'split into two trains');
  const [a, b] = g.rail.trains;
  assert(a.cars.length === 1 && b.cars.length === 2, 'sizes ' + a.cars.length + '/' + b.cars.length);
  run(g, 5);
  assert(noOverlap(g), 'no overlap after split');
});

test('picking up track under a train is refused; removing it ahead reroutes', () => {
  const g = newGame();
  lay(g, line(60, 80, 100, 80));
  const tr = FG.trains.placeCar(g, 'loco', 70, 80, 1).train;
  run(g, 2);
  assert(!g.pickUpEntity(FG.trains.railAt(g, 70, 80)), 'refused under train');
  assert(g.pickUpEntity(FG.trains.railAt(g, 90, 80)), 'removed ahead');
  run(g, 2);
  assert(g.rail.trains.length === 1 && !tr.dead, 'train still there');
});

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
    lay(g, line(120, 120, 150, 120), { '140,120': 'train_stop' });
    FG.trains.railAt(g, 140, 120).name = 'Depot';
    const loco = FG.trains.placeCar(g, 'loco', 124, 120, 1).train;
    fuel(loco);
    loco.schedule = [{ station: 'Depot', cond: 'time', v: 30 }];
    loco.mode = 'auto';
    run(g, 40);
    const midX = FG.trains.pointAt(loco, loco.headS)[0];
    const plates = asm.inp.iron_plate;
    const json = FG.save.serialize(g);
    const g2 = FG.save.deserialize(json);
    assert(g2.ents.size === g.ents.size, 'entity count');
    assert(g2.world.amt[100 * g.world.W + 100] === g.world.amt[100 * g.world.W + 100], 'ore amounts preserved');
    assert(g2.research.current === 'automation', 'research preserved');
    const a2 = FG.entAt(g2, 110, 110);
    assert(a2.out && a2.out.iron_gear === 7 && a2.inp.iron_plate === plates && a2.crafting === asm.crafting && a2.recipe === 'iron_gear', 'assembler contents preserved ' + JSON.stringify([a2.out, a2.inp]));
    assert(FG.entAt(g2, 110, 115).lanes[0].ids[0] === 'coal', 'belt items preserved');
    assert(g2.rail.trains.length === 1 && FG.trains.railAt(g2, 140, 120).name === 'Depot', 'train and stop preserved');
    const t2 = g2.rail.trains[0];
    assert(Math.abs(FG.trains.pointAt(t2, t2.headS)[0] - midX) < 0.5, 'train position preserved');
    run(g2, 60 * 10);
    assert(t2.state === 'station' && Math.abs(FG.trains.pointAt(t2, t2.headS)[0] - 141) < 0.6, 'loaded train reaches its stop: ' + t2.state + ' ' + FG.trains.pointAt(t2, t2.headS));
    const before = f.out ? f.out.n : 0;
    run(g2, 900);
    const f2 = FG.entAt(g2, 102, 100);
    assert(f2.out && f2.out.n > before, 'still smelting after load: ' + before + ' -> ' + JSON.stringify(f2.out));
  });
}

console.log('\n' + passed + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
