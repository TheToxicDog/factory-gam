// Simulation throughput check with a large synthetic factory: node tests/perf.js
const { load } = require('./harness');
const FG = load();
const g = new FG.Game({ seed: 5, size: 512, enemies: 'normal' });
const w = g.world;
for (let y = 40; y < 470; y++) for (let x = 40; x < 470; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
for (const id in FG.data.techs) g.completeResearch(id, true);
g.player.x = 30; g.player.y = 30;
const P = (p, x, y, d) => { const c = FG.canPlace(g, p, x, y, d || 0, { ignorePlayer: true }); return c.ok ? FG.placeEntity(g, p, x, y, d || 0) : null; };
let n = 0;
// 12 rows of assembler blocks: belt -> arm -> assembler -> arm -> belt, solar powered
for (let row = 0; row < 12; row++) {
  const y = 50 + row * 30;
  for (let x = 50; x < 450; x++) { P('fast_belt', x, y, 1); P('fast_belt', x, y + 6, 3); }
  for (let k = 0; k < 40; k++) {
    const x = 52 + k * 10;
    P('fast_inserter', x + 1, y + 1, 2);
    const a = P('assembler_2', x, y + 2);
    if (a) { FG.machines.setRecipe(g, a, 'iron_gear'); }
    P('fast_inserter', x + 1, y + 5, 2);
    P('medium_pole', x + 3, y + 3);
    // solar under the row
    P('solar_panel', x + 4, y + 10); P('solar_panel', x + 4, y + 13); P('solar_panel', x + 7, y + 10); P('solar_panel', x + 7, y + 13);
    P('medium_pole', x + 3, y + 12);
  }
  // Loop belts at ends so items circulate
  P('fast_belt', 450, y, 2); for (let yy = y + 1; yy < y + 6; yy++) P('fast_belt', 450, yy, 2); P('fast_belt', 450, y + 6, 3);
  P('fast_belt', 49, y + 6, 0); for (let yy = y + 5; yy > y; yy--) P('fast_belt', 49, yy, 0); P('fast_belt', 49, y, 1);
}
// Seed belts with plates
for (const b of g.byKind.belt) { FG.belts.laneInsert(b.lanes[0], 'iron_plate', 0.25, 1); FG.belts.laneInsert(b.lanes[1], 'iron_plate', 0.75, 1); }
for (const k in g.byKind) n += g.byKind[k].length;
console.log('entities', g.ents.size, Object.fromEntries(Object.entries(g.byKind).map(([k, v]) => [k, v.length])));
let t0 = Date.now();
g.step();
console.log('first step (topology) ms', Date.now() - t0);
t0 = Date.now();
const N = 600;
for (let i = 0; i < N; i++) g.step();
const ms = (Date.now() - t0) / N;
const items = g.byKind.belt.reduce((s, b) => s + b.lanes[0].ids.length + b.lanes[1].ids.length, 0);
console.log('ms per tick', ms.toFixed(3), 'items on belts', items, 'gears made', g.stats.total.p.iron_gear || 0);
// Rebuild cost when placing one entity (topology recompute)
t0 = Date.now();
P('wooden_chest', 460, 30); g.step();
console.log('step after placing an entity ms', Date.now() - t0);
for (const [name, fn] of [['belts', () => FG.belts.recompute(g)], ['fluids', () => FG.fluidsys.recompute(g)], ['power', () => FG.power.recompute(g)], ['fx', () => FG.machines.recomputeEffects(g)]]) {
  const t = Date.now(); fn(); console.log('recompute', name, Date.now() - t, 'ms');
}
