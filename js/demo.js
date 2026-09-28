// Cogworks Frontier — "Demo factory": a ready-made mid-game base on the real terrain of
// seed 2024, for exploring every system without the early grind. Everything is placed
// through the normal building code, then the simulation runs for a while so belts are
// full and machines are busy when you arrive.
(function () {
  'use strict';
  const D = FG.data;

  FG.demoFactory = function (opts) {
    opts = opts || {};
    const g = new FG.Game({ seed: 2024, size: 384, enemies: opts.enemies || 'peaceful' });
    const w = g.world;
    const RL = FG.rails, TR = FG.trains;
    const failed = [];

    // Chop trees and boulders out of an area, as a player would before building.
    const clear = (x, y, cw, ch) => {
      for (let yy = y; yy < y + ch; yy++) for (let xx = x; xx < x + cw; xx++) {
        if (!w.inBounds(xx, yy)) continue;
        const i = yy * w.W + xx;
        if (w.res[i] === FG.RES.TREE || w.res[i] === FG.RES.ROCK) { w.res[i] = 0; w.amt[i] = 0; w.modified.add(i); w.touchChunk(xx, yy); }
      }
    };
    const put = (p, x, y, dir, fill) => {
      const pr = D.protos[p];
      const [fw, fh] = FG.footprint(pr, pr.rotatable ? dir || 0 : 0);
      clear(x, y, fw, fh);
      const c = FG.canPlace(g, p, x, y, dir || 0, { ignorePlayer: true });
      if (!c.ok) { failed.push(p + '@' + x + ',' + y + ': ' + c.reason); return null; }
      const e = FG.placeEntity(g, p, x, y, dir || 0);
      if (fill) for (const [id, n] of fill) FG.insertItem(g, e, id, n, 'direct');
      return e;
    };
    const belt = (x0, y0, x1, y1, dir, kind) => {
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      for (let x = x0, y = y0; ; x += dx, y += dy) {
        put(kind || 'belt', x, y, dir);
        if (x === x1 && y === y1) break;
      }
    };
    const COAL = [['coal', 50]];
    const N = 0, E = 1, S = 2, W = 3;

    // Research: everything this base uses; the labs are working on Fast arms.
    for (const t of ['automation', 'logistics', 'steel', 'logistic_science', 'logistics_2', 'engine', 'railway', 'power_distribution', 'turrets', 'military']) g.completeResearch(t, true);

    // --- Steam power on the lake shore: pump -> 2 boilers -> 4 steam engines.
    put('offshore_pump', 200, 166, E);
    for (const bx of [201, 204]) {
      put('boiler', bx, 165, N, COAL);
      put('steam_engine', bx, 160, N);
      put('steam_engine', bx, 155, N);
      // Boilers are stoked from a coal chest by burner arms.
      put('burner_inserter', bx + 1, 167, N, [['coal', 5]]);
      const ch = put('iron_chest', bx + 1, 168);
      if (ch) ch.inv.add('coal', 800);
    }
    for (const [x, y] of [[200, 161], [207, 161], [213, 164]]) put('medium_pole', x, y);

    // --- Iron: 8 electric drills either side of a belt running north into the smelters.
    belt(217, 196, 217, 165, N);
    for (const y of [185, 188, 191, 194]) {
      put('electric_drill', 214, y, E);
      put('electric_drill', 218, y, W);
    }
    for (const [x, y] of [[213, 187], [213, 193], [221, 187], [221, 193]]) put('medium_pole', x, y);

    // --- Smelting column: arm -> stone furnace -> arm -> plate belt.
    for (let y = 166; y <= 180; y += 2) {
      put('inserter', 218, y, E);
      put('stone_furnace', 219, y, 0, COAL);
      put('inserter', 221, y, E);
    }
    for (const y of [169, 175, 181]) put('medium_pole', 218, y);
    belt(222, 181, 222, 166, N);
    put('iron_chest', 222, 163);
    put('loader', 222, 164, N); // plates off the belt and into the chest
    put('medium_pole', 223, 166);

    // --- Science: gears and Mechanics packs, carried by belt to two labs.
    const gears = put('assembler_1', 224, 170);
    const packs = put('assembler_1', 224, 174);
    if (gears) FG.machines.setRecipe(g, gears, 'iron_gear');
    if (packs) FG.machines.setRecipe(g, packs, 'sci_1');
    put('inserter', 223, 171, E); // plates in
    put('inserter', 225, 173, S); // gears across
    put('inserter', 227, 175, W); // copper in
    const copper = put('iron_chest', 228, 175);
    if (copper) copper.inv.add('copper_plate', 400);
    put('inserter', 225, 177, S); // packs out
    belt(225, 178, 232, 178, E);
    for (const lx of [226, 230]) { put('lab', lx, 180); put('inserter', lx + 1, 179, S); }
    for (const [x, y] of [[223, 174], [229, 175], [229, 181]]) put('medium_pole', x, y);
    g.queueResearch('fast_inserter');
    g.queueResearch('walls');

    // --- The first thing every player builds: a burner drill feeding a stone furnace.
    put('burner_drill', 210, 190, W, COAL);
    put('stone_furnace', 208, 190, 0, COAL);

    // --- Coal outpost: burner drills that fuel each other, one filling a chest.
    for (const [x, y] of [[170, 196], [170, 199]]) {
      put('burner_drill', x, y, E, [['coal', 5]]);
      put('burner_drill', x + 2, y, W, [['coal', 5]]);
    }
    put('burner_drill', 174, 197, E, [['coal', 50]]);
    put('wooden_chest', 176, 197);

    // --- Copper railway: drills load a wagon at the mine; arms unload it into furnaces.
    for (const [x, y, d, t] of [[202, 184, 4, 22]]) {
      let st = [x, y, d];
      for (let k = 0; k < t; k++) {
        const pc = RL.makePiece(st[0], st[1], st[2], 'S');
        for (const [tx, ty] of pc.tiles) clear(tx, ty, 1, 1);
        if (!RL.build(g, st[0], st[1], st[2], 'S')) failed.push('rail@' + st);
        st = RL.endOf(st[0], st[1], st[2], 'S');
      }
    }
    const stop = (px, py, d, name) => {
      const [tx, ty] = RL.sideTile(px, py, d);
      const e = put('train_stop', tx, ty);
      if (e) { e.rd = d; e.name = name; }
      g.rail.dirty = true;
    };
    stop(202, 226, 4, 'Copper mine');
    stop(202, 186, 0, 'Copper unload');
    for (const y of [213, 216]) {
      put('electric_drill', 198, y, E);
      put('electric_drill', 203, y, W);
    }
    for (const y of [193, 195, 197]) {
      put('inserter', 203, y, E);
      put('stone_furnace', 204, y, 0, COAL);
      put('inserter', 206, y, E);
      put('iron_chest', 207, y);
    }
    for (const [x, y] of [[206, 194], [206, 202], [206, 210], [206, 217], [197, 217]]) put('medium_pole', x, y);
    let train = null;
    const lead = TR.placeCar(g, 'loco', 202, 189, N);
    if (lead.ok) {
      train = lead.train;
      TR.placeCar(g, 'wagon', 202, 196, N);
      TR.placeCar(g, 'loco', 202, 203, S);
      for (const c of train.cars) if (c.type === 'loco') c.inv.add('coal', 50);
      train.schedule = [{ station: 'Copper mine', cond: 'time', v: 30 }, { station: 'Copper unload', cond: 'empty' }];
      train.mode = 'auto';
    } else failed.push('train: ' + lead.reason);

    // --- A little defence on the east side.
    put('gun_turret', 234, 172, 0, [['ammo_basic', 50]]);
    put('gun_turret', 234, 184, 0, [['ammo_basic', 50]]);

    // The player, with a kit for carrying on.
    const p = g.player;
    p.x = 212.5; p.y = 176.5;
    p.inv = new FG.Inventory(60);
    for (const [id, n] of [['iron_plate', 200], ['copper_plate', 100], ['iron_gear', 50], ['circuit', 50], ['coal', 100], ['belt', 200], ['inserter', 40],
      ['electric_drill', 8], ['stone_furnace', 16], ['assembler_1', 4], ['medium_pole', 20], ['iron_chest', 10], ['rail', 100], ['train_stop', 2], ['lab', 2],
      ['gun_turret', 2], ['ammo_basic', 100], ['pistol', 1], ['burner_drill', 2]]) p.inv.add(id, n);
    g.objectives.idx = g.objectives.list.findIndex((o) => o.id === 'assembler');

    // Let it run for a bit so the belts fill and the train gets going.
    const warm = opts.warmup === undefined ? 100 * FG.TICKS : opts.warmup;
    for (let i = 0; i < warm; i++) g.step();
    g.demo = { failed, train };
    return g;
  };
})();
