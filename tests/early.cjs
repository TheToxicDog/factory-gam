// Plays the opening minutes like a player would: walk, mine, chop, craft, build. No item cheats.
// Usage: node tests/early.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const check = (name, cond, info) => console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : ''));
  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.click('#title-menu .btn:has-text("New game")');
  await page.fill('#ng-seed', '4242');
  await page.selectOption('#ng-enemies', 'off');
  await page.click('.window .btn.primary:has-text("Start")');
  await page.waitForTimeout(600);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const find = (res, near) => ev(([res, near]) => {
    const g = FG.app.game, w = g.world;
    let best = null, bd = 1e9;
    const px = near ? near[0] : g.player.x, py = near ? near[1] : g.player.y;
    for (let y = Math.floor(py) - 60; y < py + 60; y++) for (let x = Math.floor(px) - 60; x < px + 60; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = y * w.W + x;
      if (w.res[i] !== FG.RES[res] || w.amt[i] <= 0) continue;
      const d = FG.dist2(x + 0.5, y + 0.5, px, py);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  }, [res, near]);
  // Walk toward a world point using WASD, steering each 100ms.
  const walkTo = async (tx, ty, within) => {
    for (let i = 0; i < 120; i++) {
      const p = await ev(() => [FG.app.game.player.x, FG.app.game.player.y]);
      const dx = tx - p[0], dy = ty - p[1];
      if (Math.hypot(dx, dy) < within) break;
      const keys = [];
      if (dx > 0.3) keys.push('KeyD'); if (dx < -0.3) keys.push('KeyA');
      if (dy > 0.3) keys.push('KeyS'); if (dy < -0.3) keys.push('KeyW');
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(90);
      for (const k of keys) await page.keyboard.up(k);
    }
    const p = await ev(() => [FG.app.game.player.x, FG.app.game.player.y]);
    return Math.hypot(tx - p[0], ty - p[1]);
  };
  const screen = (x, y) => ev(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const mineAt = async (x, y, ms) => {
    const [sx, sy] = await screen(x + 0.5, y + 0.5);
    await page.mouse.move(sx, sy);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(ms);
    await page.mouse.up({ button: 'right' });
  };
  const count = (id) => ev((id) => FG.app.game.player.inv.count(id), id);

  // Iron ore by hand
  const iron = await find('IRON');
  let d = await walkTo(iron[0] + 0.5, iron[1] + 2.5, 1.5);
  check('walked to iron ore', d < 3, 'dist ' + d.toFixed(1));
  for (let k = 0; k < 4 && (await count('iron_ore')) < 10; k++) {
    await mineAt(iron[0], iron[1], 3000);
  }
  check('mined 10 iron ore by hand', (await count('iron_ore')) >= 10, 'ore=' + (await count('iron_ore')));
  // Stone
  const stone = await find('STONE');
  d = await walkTo(stone[0] + 0.5, stone[1] + 2.5, 1.5);
  for (let k = 0; k < 4 && (await count('stone')) < 12; k++) await mineAt(stone[0], stone[1], 3200);
  check('mined stone', (await count('stone')) >= 10, 'stone=' + (await count('stone')));
  // A tree for wood
  const tree = await find('TREE');
  d = await walkTo(tree[0] + 0.5, tree[1] + 2, 1.5);
  await mineAt(tree[0], tree[1], 1100);
  check('chopped a tree', (await count('wood')) >= 8, 'wood=' + (await count('wood')));
  await page.waitForTimeout(700);
  const obj = await ev(() => FG.app.game.objectives.idx);
  check('first two objectives completed', obj >= 2, 'objective index ' + obj);
  // Craft a stone furnace from the crafting menu (Production tab).
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  await page.click('#win-inventory .tab:has-text("Production")');
  await page.waitForTimeout(100);
  await page.click('#win-inventory .craft-grid .slot[data-recipe="stone_furnace"]');
  await page.waitForTimeout(1200);
  check('crafted a stone furnace', (await count('stone_furnace')) >= 2, 'furnaces=' + (await count('stone_furnace')));
  await page.screenshot({ path: out + '/30-crafting.png' });
  await page.keyboard.press('KeyE');
  // Back to iron: place drill + furnace
  await walkTo(iron[0] + 0.5, iron[1] + 3.5, 1.2);
  const plan = await ev(([ix, iy]) => {
    const g = FG.app.game;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = ix + dx, y = iy + dy;
      if (FG.canPlace(g, 'burner_drill', x, y, 1).ok && FG.canPlace(g, 'stone_furnace', x + 2, y, 0).ok) return [x, y];
    }
    return null;
  }, iron);
  check('found a spot for drill + furnace', !!plan, JSON.stringify(plan));
  await page.keyboard.press('Digit1');
  const dirNow = await ev(() => FG.app.dir);
  for (let k = 0; k < ((1 - dirNow + 4) % 4); k++) await page.keyboard.press('KeyR');
  let [sx, sy] = await screen(plan[0] + 1, plan[1] + 1);
  await page.mouse.move(sx, sy); await page.waitForTimeout(80);
  await page.mouse.down(); await page.mouse.up();
  const slot = await ev(() => FG.app.hotbar.indexOf('stone_furnace'));
  await page.keyboard.press('Digit' + (slot + 1));
  [sx, sy] = await screen(plan[0] + 3, plan[1] + 1);
  await page.mouse.move(sx, sy); await page.waitForTimeout(80);
  await page.mouse.down(); await page.mouse.up();
  await page.keyboard.press('KeyQ');
  // Fuel both with wood via inventory click then click on building
  for (const [x, y] of [[plan[0] + 1, plan[1] + 1], [plan[0] + 3, plan[1] + 1]]) {
    await page.keyboard.press('KeyE'); await page.waitForTimeout(150);
    await page.click('#win-inventory .grid .slot[data-item="wood"]');
    [sx, sy] = await screen(x, y);
    await page.mouse.move(sx, sy); await page.waitForTimeout(60);
    await page.mouse.down(); await page.mouse.up();
    await page.keyboard.press('KeyQ');
  }
  const st = await ev(() => ({ drill: FG.app.game.byKind.drill[0].status, fuelD: FG.app.game.byKind.drill[0].fuel, furnace: (FG.app.game.byKind.furnace || [])[0] }));
  check('drill fuelled and running', st.drill === 'working' || st.drill === 'waiting_space', JSON.stringify({ d: st.drill, f: st.fuelD }));
  await page.waitForTimeout(15000);
  const plates = await ev(() => { const f = FG.app.game.byKind.furnace[0]; return f && f.out ? f.out.n : 0; });
  check('first automated iron plates', plates >= 2, 'plates=' + plates);
  await page.screenshot({ path: out + '/31-first-line.png' });
  const o2 = await ev(() => [FG.app.game.objectives.idx, FG.app.game.objectives.current.text]);
  console.log('  objective now:', o2[0], o2[1]);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
