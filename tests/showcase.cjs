// Builds a scene with every building type and screenshots it for visual review.
// Usage: node tests/showcase.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    FG.app.newGame({ seed: 99, enemies: 'normal', size: 384 });
    const g = FG.app.game, w = g.world, D = FG.data;
    for (const id in D.techs) g.completeResearch(id, true);
    const X = w.spawnX - 30, Y = w.spawnY - 20;
    for (let y = Y - 4; y < Y + 44; y++) for (let x = X - 4; x < X + 70; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let y = Y; y < Y + 14; y++) for (let x = X; x < X + 3; x++) w.terrain[y * w.W + x] = FG.T.WATER;
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    g.enemies.buildPathGrid();
    const P = (p, x, y, d) => { const c = FG.canPlace(g, p, x, y, d || 0, { ignorePlayer: true }); if (!c.ok) { console.warn('cannot place', p, x, y, c.reason); return null; } return FG.placeEntity(g, p, x, y, d || 0); };
    // Steam power
    P('offshore_pump', X + 3, Y + 10, 1);
    const b1 = P('boiler', X + 4, Y + 9, 0);
    P('steam_engine', X + 4, Y + 4, 0);
    P('steam_engine', X + 4, Y - 1, 0);
    const b2 = P('boiler', X + 7, Y + 9, 0);
    P('steam_engine', X + 7, Y + 4, 0);
    P('steam_engine', X + 7, Y - 1, 0);
    FG.insertItem(g, b1, 'coal', 50, 'direct');
    FG.insertItem(g, b2, 'coal', 50, 'direct');
    P('small_pole', X + 10, Y + 3);
    P('small_pole', X + 10, Y + 8);
    for (const yy of [6, 13, 20, 27, 34]) for (let k = 0; k < 7; k++) P('medium_pole', X + 14 + k * 8, Y + yy);
    // Ore line: chest -> belt -> arms -> furnaces
    const src = P('steel_chest', X + 10, Y + 12);
    if (src) src.inv.add('iron_ore', 1000);
    P('fast_inserter', X + 11, Y + 12, 1);
    for (let x = X + 12; x < X + 30; x++) P('belt', x, Y + 12, 1);
    P('belt', X + 30, Y + 12, 2);
    for (let k = 0; k < 4; k++) {
      const x = X + 14 + k * 3;
      P('inserter', x, Y + 11, 0);
      const f = P('stone_furnace', x, Y + 9);
      FG.insertItem(g, f, 'coal', 50, 'direct');
      P('long_inserter', x + 1, Y + 8, 0);
    }
    for (let x = X + 13; x < X + 28; x++) P('fast_belt', x, Y + 6, 1);
    // Splitter + tunnel
    P('belt', X + 30, Y + 13, 2);
    P('splitter', X + 30, Y + 14, 2);
    P('underground_belt', X + 30, Y + 15, 2);
    P('underground_belt', X + 30, Y + 19, 2);
    P('belt', X + 30, Y + 20, 2);
    P('belt', X + 31, Y + 15, 2); P('belt', X + 31, Y + 16, 3);
    // Assemblers
    const a1 = P('assembler_1', X + 34, Y + 9); if (a1) { FG.machines.setRecipe(g, a1, 'iron_gear'); a1.inp.iron_plate = 100; }
    const a2 = P('assembler_2', X + 38, Y + 9, 0); if (a2) { FG.machines.setRecipe(g, a2, 'circuit'); a2.inp.iron_plate = 50; a2.inp.copper_wire = 150; }
    const a3 = P('assembler_3', X + 42, Y + 9, 0); if (a3) { FG.machines.setRecipe(g, a3, 'sci_1'); a3.inp.copper_plate = 50; a3.inp.iron_gear = 50; }
    P('inserter', X + 37, Y + 10, 1);
    const fi = P('filter_inserter', X + 41, Y + 10, 1); if (fi) fi.filter = 'circuit';
    // Labs
    for (let k = 0; k < 3; k++) { const l = P('lab', X + 34 + k * 4, Y + 17); if (l) l.inp = { sci_1: 50, sci_2: 50, sci_3: 50 }; }
    g.research.done.mining_prod_3 = 0; delete g.research.done.mining_prod_3; g.queueResearch('mining_prod_3');
    // Solar + accumulators + beacon
    for (let k = 0; k < 4; k++) P('solar_panel', X + 50 + (k % 2) * 3, Y + 8 + Math.floor(k / 2) * 3);
    P('accumulator', X + 57, Y + 8); P('accumulator', X + 57, Y + 10);
    const bc = P('beacon', X + 46, Y + 9); if (bc) bc.modules = ['speed_module', 'speed_module'];
    if (a3) a3.modules = ['productivity_module', 'productivity_module', 'speed_module', null];
    g.markDirty('fx');
    // Chests, walls, turrets
    const ch = P('wooden_chest', X + 36, Y + 14); if (ch) ch.inv.add('iron_gear', 30);
    P('iron_chest', X + 37, Y + 14);
    for (let x = X + 50; x < X + 64; x++) P('stone_wall', x, Y + 30);
    const t1 = P('gun_turret', X + 52, Y + 28); if (t1) FG.insertItem(g, t1, 'ammo_basic', 50, 'direct');
    const t2 = P('laser_turret', X + 58, Y + 28);
    // Oil
    const W0 = w.W; w.res[(Y + 33) * W0 + X + 11] = FG.RES.OIL; w.amt[(Y + 33) * W0 + X + 11] = 120;
    const pj = P('pumpjack', X + 10, Y + 32, 1); // output east
    for (let x = X + 13; x < X + 16; x++) P('pipe', x, Y + 33);
    const ref = P('refinery', X + 16, Y + 29, 1); if (ref) FG.machines.setRecipe(g, ref, 'basic_refining');
    const chem = P('chem_plant', X + 24, Y + 30, 1); if (chem) { FG.machines.setRecipe(g, chem, 'plastic'); chem.inp.coal = 50; }
    P('storage_tank', X + 24, Y + 35);
    P('pipe_ug', X + 28, Y + 36, 3); P('pipe_ug', X + 34, Y + 36, 1);
    P('medium_pole', X + 22, Y + 33); P('medium_pole', X + 14, Y + 31); P('big_pole', X + 30, Y + 30); P('big_pole', X + 45, Y + 28);
    // Uplink
    const up = P('uplink', X + 36, Y + 30); if (up) up.stages = 25;
    // Enemies nearby
    g.enemies.addNest(X + 62, Y + 36);
    g.enemies.spawnUnit('crawler', X + 60, Y + 34, null, null);
    g.enemies.spawnUnit('brute', X + 62, Y + 34, null, null);
    g.enemies.spawnUnit('titan', X + 64, Y + 33, null, null);
    g.player.x = X + 32; g.player.y = Y + 22;
    for (let s = 0; s < 600; s++) g.step();
    FG.app.renderer.cam.x = g.player.x; FG.app.renderer.cam.y = g.player.y;
    return { X, Y, ents: g.ents.size, statuses: Array.from(g.ents.values()).filter((e) => e.status && e.status !== 'idle').reduce((m, e) => { const k = e.p + ':' + e.status; m[k] = (m[k] || 0) + 1; return m; }, {}) };
  });
  console.log(JSON.stringify(info, null, 1));
  const shot = async (name, zoom, dx, dy, alt, tick) => {
    await page.evaluate(([z, dx, dy, alt, tick]) => {
      const R = FG.app.renderer, g = FG.app.game;
      g.player.x = FG.app.showX + dx; g.player.y = FG.app.showY + dy;
      R.cam.x = g.player.x; R.cam.y = g.player.y; R.cam.zoom = z; FG.app.view.altMode = alt;
      if (tick !== null) g.tick = tick;
    }, [zoom, dx, dy, alt, tick]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: out + '/' + name + '.png' });
  };
  await page.evaluate(([X, Y]) => { FG.app.showX = X; FG.app.showY = Y; }, [info.X, info.Y]);
  await shot('20-showcase-power', 1.2, 18, 10, false, null);
  await shot('21-showcase-assembly', 1.3, 42, 14, true, null);
  await shot('22-showcase-oil', 1.1, 26, 32, false, null);
  await shot('23-showcase-zoomout', 0.45, 32, 20, false, null);
  await shot('24-showcase-night', 1.0, 44, 22, false, 25000 * 0.6);
  await shot('25-showcase-far', 0.3, 32, 20, false, 5000);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
