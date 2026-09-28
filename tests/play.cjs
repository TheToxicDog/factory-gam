// Scripted play-through using real mouse and keyboard input in Chromium.
// Usage: node tests/play.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1500);
  const check = (name, cond, info) => console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : ''));
  await page.evaluate(() => FG.app.newGame({ seed: 777, enemies: 'off', size: 384 }));
  await page.waitForTimeout(500);
  // Teleport next to the closest iron ore tile.
  const spot = await page.evaluate(() => {
    const g = FG.app.game, w = g.world;
    let best = null, bd = 1e9;
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const i = y * w.W + x;
      if (w.res[i] !== FG.RES.IRON) continue;
      // want a 2x2 of iron plus free tiles east
      let ok = true;
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 5; xx++) {
        const j = yy * w.W + xx;
        if (w.isWater(xx, yy) || w.hasObstacle(xx, yy)) ok = false;
        if (xx < x + 2 && w.res[j] !== FG.RES.IRON) ok = false;
      }
      if (!ok) continue;
      const d = FG.dist2(x, y, w.spawnX, w.spawnY);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    g.player.x = best[0] + 1; g.player.y = best[1] + 3.5;
    return best;
  });
  await page.waitForTimeout(400);
  const toScreen = async (wx, wy) => page.evaluate(([x, y]) => FG.app.renderer.toScreen(x, y), [wx, wy]);
  // 1. Mine iron ore by hand.
  let [sx, sy] = await toScreen(spot[0] + 0.5, spot[1] + 0.5);
  await page.mouse.move(sx, sy);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(3200);
  await page.mouse.up({ button: 'right' });
  const ore = await page.evaluate(() => FG.app.game.player.inv.count('iron_ore'));
  check('hand mining gives iron ore', ore >= 3, 'ore=' + ore);
  await page.screenshot({ path: out + '/10-mining.png' });
  // 2. Place burner drill (hotbar 1) facing east on the ore.
  await page.keyboard.press('Digit1');
  await page.keyboard.press('KeyR'); // face east
  [sx, sy] = await toScreen(spot[0] + 1, spot[1] + 1);
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(100);
  await page.screenshot({ path: out + '/11-preview.png' });
  await page.mouse.down(); await page.mouse.up();
  const drill = await page.evaluate(() => { const d = (FG.app.game.byKind.drill || [])[0]; return d && { x: d.x, y: d.y, dir: d.dir, ox: d.ox, oy: d.oy }; });
  check('burner drill placed', !!drill, JSON.stringify(drill));
  // 3. Place stone furnace at the drill output.
  await page.keyboard.press('Digit2');
  [sx, sy] = await toScreen(drill.ox + 1, drill.oy + 1);
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(100);
  await page.mouse.down(); await page.mouse.up();
  const furnace = await page.evaluate(() => { const f = (FG.app.game.byKind.furnace || [])[0]; return f && { x: f.x, y: f.y }; });
  check('furnace placed at the drill output', !!furnace && furnace.x === drill.ox, JSON.stringify(furnace));
  // 4. Fuel both with wood: open inventory, click wood, click the drill, then the furnace.
  await page.keyboard.press('Escape'); // clear cursor
  await page.evaluate(() => { FG.app.game.player.inv.add('wood', 20); FG.app.game.player.inv.add('coal', 120); });
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  await page.click('#win-inventory .grid .slot[data-item="coal"]');
  await page.waitForTimeout(100);
  [sx, sy] = await toScreen(drill.x + 1, drill.y + 1);
  await page.mouse.move(sx, sy); await page.waitForTimeout(50);
  await page.mouse.down(); await page.mouse.up();
  [sx, sy] = await toScreen(furnace.x + 1, furnace.y + 1);
  await page.mouse.move(sx, sy); await page.waitForTimeout(50);
  await page.mouse.down(); await page.mouse.up();
  const fuel = await page.evaluate(() => [FG.app.game.byKind.drill[0].fuel, FG.app.game.byKind.furnace[0].fuel]);
  check('drill and furnace fuelled by clicking with coal', fuel[0] && fuel[1], JSON.stringify(fuel));
  await page.waitForTimeout(12000);
  const plates = await page.evaluate(() => { const f = FG.app.game.byKind.furnace[0]; return f.out ? f.out.n : 0; });
  check('furnace produced iron plates', plates >= 1, 'plates=' + plates);
  await page.screenshot({ path: out + '/12-mine-smelt.png' });
  // 5. Hover and open the furnace window.
  await page.keyboard.press('Escape');
  await page.mouse.move(sx, sy); await page.waitForTimeout(200);
  await page.screenshot({ path: out + '/13-hover.png' });
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => FG.app.ui.win && FG.app.ui.win.name);
  check('clicking the furnace opens its window', open === 'entity', open);
  await page.screenshot({ path: out + '/14-furnace-window.png' });
  await page.keyboard.press('Escape');
  // 6. Drag a belt line east then south.
  await page.evaluate(() => { FG.app.game.player.inv.add('belt', 50); FG.emit('inventory'); FG.app.game.player.inv.add('inserter', 10); FG.app.game.player.inv.add('small_pole', 10); FG.app.game.player.inv.add('solar_panel', 4); FG.app.game.player.inv.add('assembler_1', 2); FG.app.game.player.inv.add('iron_chest', 4); FG.emit('inventory'); });
  await page.waitForTimeout(150);
  const beltSlot = await page.evaluate(() => FG.app.hotbar.indexOf('belt'));
  await page.keyboard.press('Digit' + ((beltSlot + 1) % 10));
  const by = spot[1] + 5;
  [sx, sy] = await toScreen(spot[0] - 3 + 0.5, by + 0.5);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { const [x2, y2] = await toScreen(spot[0] - 3 + k + 0.5, by + 0.5); await page.mouse.move(x2, y2, { steps: 3 }); }
  for (let k = 1; k <= 3; k++) { const [x2, y2] = await toScreen(spot[0] + 3 + 0.5, by + k + 0.5); await page.mouse.move(x2, y2, { steps: 3 }); }
  await page.mouse.up();
  const belts = await page.evaluate(() => (FG.app.game.byKind.belt || []).map((b) => [b.x, b.y, b.dir]));
  const east = belts.filter((b) => b[2] === 1).length, south = belts.filter((b) => b[2] === 2).length;
  check('dragged belts follow the drag', belts.length >= 9 && east >= 5 && south >= 3, 'n=' + belts.length + ' east=' + east + ' south=' + south);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/15-belts.png' });
  // 7. Solar + pole + assembler set to gears via UI.
  await page.keyboard.press('Escape');
  const place = async (item, x, y, dir) => {
    await page.evaluate(([it, d]) => { FG.app.setCursor(it); FG.app.dir = d; }, [item, dir || 0]);
    const [px, py] = await toScreen(x, y);
    await page.mouse.move(px, py); await page.waitForTimeout(40);
    await page.mouse.down(); await page.mouse.up();
  };
  const ax = spot[0] - 6, ay = spot[1] + 8;
  await page.evaluate(([x, y]) => { FG.app.game.player.x = x; FG.app.game.player.y = y; }, [ax + 2, ay - 1.5]);
  await page.waitForTimeout(200);
  await place('solar_panel', ax + 1.5, ay + 1.5);
  await place('solar_panel', ax + 1.5, ay + 4.5);
  await place('small_pole', ax + 3.5, ay + 3.5);
  await place('assembler_1', ax + 5.5, ay + 2.5);
  await page.keyboard.press('Escape');
  const asm = await page.evaluate(() => { const a = (FG.app.game.byKind.crafter || [])[0]; return a && { x: a.x, y: a.y }; });
  check('assembler placed', !!asm, JSON.stringify(asm));
  const [cx, cy] = await toScreen(asm.x + 1.5, asm.y + 1.5);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/16-assembler-window.png' });
  await page.click('#win-entity .recipe-picker .slot[data-recipe="iron_gear"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => FG.app.game.player.inv.add('iron_plate', 50));
  await page.waitForTimeout(200);
  await page.click('#win-entity .grid .slot[data-item="iron_plate"]');
  await page.waitForTimeout(3000);
  const gears = await page.evaluate(() => { const a = FG.app.game.byKind.crafter[0]; return { recipe: a.recipe, out: a.out, status: a.status, inp: a.inp }; });
  check('assembler makes gears from inserted plates', gears.recipe === 'iron_gear' && (gears.out.iron_gear || 0) >= 1, JSON.stringify(gears));
  await page.screenshot({ path: out + '/17-assembler-running.png' });
  await page.keyboard.press('Escape');
  // 8. Stats + map windows open without errors.
  await page.keyboard.press('KeyP'); await page.waitForTimeout(1200); await page.screenshot({ path: out + '/18-stats.png' }); await page.keyboard.press('KeyP');
  await page.keyboard.press('KeyM'); await page.waitForTimeout(700); await page.screenshot({ path: out + '/19-map.png' }); await page.keyboard.press('KeyM');
  // 9. Save to slot, reload, continue.
  await page.evaluate(async () => { await FG.save.store(FG.app.game, '1'); });
  const n1 = await page.evaluate(() => FG.app.game.ents.size);
  await page.evaluate(async () => { FG.app.startGame(await FG.save.loadSlot('1')); });
  const n2 = await page.evaluate(() => FG.app.game.ents.size);
  check('save slot round trip', n1 === n2 && n1 > 5, n1 + ' -> ' + n2);
  await page.waitForTimeout(500);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
