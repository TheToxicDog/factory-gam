// Player-style check: coal on a belt that turns a corner, an arm at the corner feeding a boiler.
// Built with real clicks, drags and keys. Usage: node tests/corner.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  await page.goto(url);
  await wait(1200);
  const [X, Y] = await ev(() => {
    FG.app.newGame({ seed: 4242, enemies: 'off', size: 384 });
    const g = FG.app.game, w = g.world;
    const X = w.spawnX - 8, Y = w.spawnY - 4;
    for (let y = Y - 10; y < Y + 12; y++) for (let x = X - 8; x < X + 24; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    const inv = g.player.inv;
    for (const [id, n] of [['boiler', 2], ['belt', 50], ['burner_inserter', 6], ['inserter', 4], ['coal', 100], ['wood', 20], ['iron_chest', 2], ['medium_pole', 4], ['solar_panel', 4]]) inv.add(id, n);
    FG.emit('inventory');
    g.player.x = X + 6.5; g.player.y = Y + 6.5;
    const c = FG.app.renderer.cam; c.x = X + 6; c.y = Y + 2; c.zoom = 1.5;
    return [X, Y];
  });
  await wait(300);
  const scr = (x, y) => ev(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const hover = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await wait(70); };
  const hold = async (id, dir) => {
    await ev((id) => FG.app.setCursor(id), id);
    if (dir !== undefined) { const d0 = await ev(() => FG.app.dir); for (let k = 0; k < ((dir - d0 + 4) % 4); k++) await page.keyboard.press('KeyR'); }
  };
  const clickAt = async (x, y) => { await hover(x, y); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const drag = async (pts) => {
    await hover(pts[0][0], pts[0][1]); await page.mouse.down();
    for (const [x, y] of pts.slice(1)) { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy, { steps: 6 }); await wait(40); }
    await page.mouse.up(); await wait(80);
  };
  const ent = (x, y) => ev(([x, y]) => { const e = FG.entAt(FG.app.game, x, y); return e ? { p: e.p, dir: e.dir, x: e.x, y: e.y, status: e.status, fuel: e.fuel ? e.fuel.id + ':' + e.fuel.n : null, curve: !!e.curveIn } : null; }, [x, y]);

  // Layout A: belt runs east, turns north at the corner (X+6, Y+4) and carries on. Arm east of
  // the corner picks from it and drops into a boiler.
  await hold('belt');
  await drag([[X + 0.5, Y + 4.5], [X + 6.5, Y + 4.5], [X + 6.5, Y - 2.5]]);
  const corner = await ent(X + 6, Y + 4);
  check('dragged belt turns the corner', corner && corner.p === 'belt' && corner.dir === 0 && corner.curve, JSON.stringify(corner));
  await hold('boiler', 0);
  await clickAt(X + 9.5, Y + 4.5); // 3x2 centred near (X+9..X+10)
  await hold('burner_inserter', 1); // picks from the west (the corner), drops east
  await clickAt(X + 7.5, Y + 4.5);
  const arm = await ent(X + 7, Y + 4), boiler = await ent(X + 8, Y + 4);
  check('burner arm next to the corner, facing the boiler', arm && arm.p === 'burner_inserter' && arm.dir === 1 && boiler && boiler.p === 'boiler', JSON.stringify([arm, boiler]));
  // Coal onto the start of the belt: a chest and an arm, like a player would.
  await hold('iron_chest');
  await clickAt(X - 1.5, Y + 4.5);
  await hold('burner_inserter', 1);
  await clickAt(X - 0.5, Y + 4.5);
  await ev(() => { FG.app.cursor = null; });
  // Fill the chest by clicking it with coal, fuel the loader arm by Z.
  await hold('coal');
  await clickAt(X - 1.5, Y + 4.5);
  await hover(X - 0.5, Y + 4.5); await page.keyboard.press('KeyZ');
  await hover(X + 7.5, Y + 4.5); await page.keyboard.press('KeyZ'); // one coal to start the corner arm
  await ev(() => { FG.app.cursor = null; });
  await wait(9000);
  const b1 = await ent(X + 8, Y + 4), a1 = await ent(X + 7, Y + 4);
  check('the corner arm fills the boiler with coal', b1.fuel && /^coal:/.test(b1.fuel), JSON.stringify([a1, b1]));
  await hover(X + 7.5, Y + 4.5);
  await page.screenshot({ path: out + '/60-corner-arm-into-boiler.png' });

  // Layout B: the belt ends at the corner; arm on the outside of the turn feeding a boiler that
  // was hand-fuelled with wood first. A burner holds one fuel at a time, so the arm cannot add
  // coal until the wood is gone: Ctrl+click the boiler takes the wood back.
  const [BX, BY] = [X + 13, Y + 6];
  await ev(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; const c = FG.app.renderer.cam; c.x = x; c.y = y - 2; }, [BX - 3.5, BY + 3.5]); // stand clear of the build
  await wait(400);
  await hold('belt', 1);
  await drag([[BX - 4.5, BY + 0.5], [BX + 0.5, BY + 0.5]]); // belts BX-5 .. BX, heading east
  await hold('belt', 0);
  await clickAt(BX + 0.5, BY + 0.5); // turn the last tile north: it becomes the corner
  const c2 = await ent(BX, BY);
  check('last belt tile turned into a corner', c2 && c2.dir === 0 && c2.curve, JSON.stringify(c2));
  await hold('boiler', 0);
  await clickAt(BX + 1.6, BY - 2); // boiler over (BX..BX+2, BY-3..BY-2)
  await hold('burner_inserter', 0); // picks from the corner to the south, drops north into the boiler
  await clickAt(BX + 0.5, BY - 0.5);
  await hold('wood');
  await clickAt(BX + 1.6, BY - 2.4); // hand-fuel the boiler with wood
  await hold('iron_chest');
  await clickAt(BX - 6.5, BY + 0.5);
  await hold('burner_inserter', 1);
  await clickAt(BX - 5.5, BY + 0.5);
  await hold('coal');
  await clickAt(BX - 6.5, BY + 0.5); // coal into the chest
  await hover(BX - 5.5, BY + 0.5); await page.keyboard.press('KeyZ'); // one coal to fuel the loader arm
  await ev(() => { FG.app.cursor = null; });
  await wait(8000);
  let b2 = await ent(BX, BY - 2), a2 = await ent(BX, BY - 1);
  check('with wood in the boiler the arm says so', b2 && /^wood:/.test(b2.fuel) && a2.status === 'other_fuel', JSON.stringify([a2, b2]));
  await hover(BX + 0.5, BY - 0.5);
  await wait(200);
  await page.screenshot({ path: out + '/61-arm-says-other-fuel.png' });
  const woodBefore = await ev(() => FG.app.game.player.inv.count('wood'));
  await hover(BX + 1.6, BY - 2.4);
  await page.keyboard.down('Control'); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Control');
  await wait(150);
  const woodAfter = await ev(() => FG.app.game.player.inv.count('wood'));
  check('Ctrl+click takes the wood back out of the boiler', woodAfter > woodBefore, woodBefore + ' -> ' + woodAfter + ' wood');
  await page.screenshot({ path: out + '/62-ctrl-click-took-wood.png' });
  await wait(5000);
  b2 = await ent(BX, BY - 2); a2 = await ent(BX, BY - 1);
  check('then the arm loads coal from the corner into the boiler', b2.fuel && /^coal:/.test(b2.fuel), JSON.stringify([a2, b2]));
  await page.screenshot({ path: out + '/63-coal-in-boiler.png' });

  // Ctrl+click elsewhere: a furnace gives its plates first, then its coal; a burner drill its coal.
  const F = await ev(([x, y]) => {
    const g = FG.app.game;
    const f = FG.placeEntity(g, 'stone_furnace', x, y);
    f.fuel = { id: 'coal', n: 7 }; f.out = { id: 'iron_plate', n: 12 };
    const d = FG.placeEntity(g, 'burner_drill', x + 3, y, 0);
    d.fuel = { id: 'coal', n: 4 };
    return [f.x, f.y, d.x, d.y];
  }, [X + 2, Y + 7]);
  const ctrlClick = async (x, y) => { await hover(x, y); await page.keyboard.down('Control'); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Control'); await wait(120); };
  const invOf = () => ev(() => { const i = FG.app.game.player.inv; return [i.count('iron_plate'), i.count('coal')]; });
  const i0 = await invOf();
  await ctrlClick(F[0] + 1, F[1] + 1);
  const i1 = await invOf();
  const t1 = await ev(() => { const t = document.querySelectorAll('#toasts .toast'); return t[t.length - 1].textContent; });
  check('Ctrl+click a furnace takes its plates first', i1[0] === i0[0] + 12 && i1[1] === i0[1] && /again for the coal/.test(t1), JSON.stringify([i0, i1, t1]));
  await page.screenshot({ path: out + '/64-ctrl-click-furnace.png' });
  await ctrlClick(F[0] + 1, F[1] + 1);
  const i2 = await invOf();
  check('Ctrl+click again takes its coal', i2[1] === i1[1] + 7, JSON.stringify([i1, i2]));
  const drillFuel = await ev(([x, y]) => { const d = FG.entAt(FG.app.game, x, y); return d.fuel ? d.fuel.n : 0; }, [F[2], F[3]]);
  await ctrlClick(F[2] + 1, F[3] + 1);
  const i3 = await invOf();
  check('Ctrl+click a burner drill takes its coal', drillFuel > 0 && i3[1] === i2[1] + drillFuel, JSON.stringify([i2, i3, drillFuel]));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
