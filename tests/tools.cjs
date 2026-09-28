// Blueprint, deconstruction, drones, pipette and rotation flows with real input.
// Usage: node tests/tools.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const check = async (name, cond, info) => console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '') + '   [bp ' + (await page.evaluate(() => FG.app && FG.app.blueprint ? FG.app.blueprint.ents.map((e) => e.p).join('+') : '-')) + ']');
  await page.goto(url);
  await page.waitForTimeout(1200);
  const base = await page.evaluate(() => {
    FG.app.newGame({ seed: 555, enemies: 'off', size: 384 });
    const g = FG.app.game, w = g.world;
    const X = w.spawnX - 10, Y = w.spawnY - 8;
    for (let y = Y - 10; y < Y + 30; y++) for (let x = X - 10; x < X + 40; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    const inv = g.player.inv;
    for (const [id, n] of [['belt', 100], ['inserter', 20], ['assembler_1', 6], ['small_pole', 20], ['iron_chest', 10], ['underground_belt', 10], ['pipe_ug', 10], ['pipe', 20], ['splitter', 4]]) inv.add(id, n);
    FG.emit('inventory');
    g.player.x = X + 6; g.player.y = Y + 10;
    FG.app.renderer.cam.x = g.player.x; FG.app.renderer.cam.y = g.player.y;
    return [X, Y];
  });
  const [X, Y] = base;
  await page.waitForTimeout(300);
  const scr = (x, y) => page.evaluate(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const click = async (x, y, opts) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await page.waitForTimeout(50); await page.mouse.down(opts); await page.mouse.up(opts); };
  const place = async (item, x, y, dir) => { await page.evaluate(([it, d]) => { FG.app.setCursor(it); FG.app.dir = d; }, [item, dir || 0]); await click(x, y); };
  // Small cell: assembler with an inserter and a chest
  await place('assembler_1', X + 2.5, Y + 2.5);
  await place('inserter', X + 4.5, Y + 2.5, 1);
  await place('iron_chest', X + 5.5, Y + 2.5);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const a = FG.app.game.byKind.crafter[0]; FG.machines.setRecipe(FG.app.game, a, 'iron_gear'); });
  // Copy with Ctrl+C + drag
  await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
  let [ax, ay] = await scr(X + 0.5, Y + 0.5); let [bx, by] = await scr(X + 6.5, Y + 4.5);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 5 }); await page.mouse.up();
  const bp = await page.evaluate(() => FG.app.cursor && FG.app.cursor.bp && FG.app.cursor.bp.ents.length);
  await check('Ctrl+C drag copies a blueprint', bp === 3, 'ents=' + bp);
  // Paste 8 tiles lower
  await page.waitForTimeout(100);
  await click(X + 3.5, Y + 11.5);
  const n1 = await page.evaluate(() => ({ crafters: FG.app.game.byKind.crafter.length, recipes: FG.app.game.byKind.crafter.map((a) => a.recipe) }));
  await check('paste builds a copy with the recipe', n1.crafters === 2 && n1.recipes[1] === 'iron_gear', JSON.stringify(n1));
  await page.screenshot({ path: out + '/60-paste.png' });
  // Rotate the blueprint and paste again
  await page.keyboard.press('KeyR');
  await click(X + 14.5, Y + 4.5);
  const n2 = await page.evaluate(() => (FG.app.game.byKind.inserter || []).map((e) => e.dir));
  await check('rotated paste turns the arm', n2.length === 3 && n2[2] === 2, JSON.stringify(n2));
  await page.keyboard.press('Escape');
  // Deconstruct area with X + drag
  await page.keyboard.press('KeyX');
  [ax, ay] = await scr(X + 11.5, Y + 0.5); [bx, by] = await scr(X + 18.5, Y + 9.5);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 5 }); await page.mouse.up();
  const n3 = await page.evaluate(() => ({ crafters: FG.app.game.byKind.crafter.length, inv: FG.app.game.player.inv.count('assembler_1') }));
  await check('X drag picks up an area', n3.crafters === 2 && n3.inv === 4, JSON.stringify(n3));
  // Pipette with Q on the chest
  const [cx, cy] = await scr(X + 5.5, Y + 2.5);
  await page.mouse.move(cx, cy); await page.waitForTimeout(80);
  await page.keyboard.press('KeyQ');
  const cur = await page.evaluate(() => FG.app.cursor && FG.app.cursor.item);
  await check('Q copies the hovered building into hand', cur === 'iron_chest', cur);
  await page.keyboard.press('KeyQ');
  // Rotate a placed inserter with R while hovering
  const [ix, iy] = await scr(X + 4.5, Y + 2.5);
  await page.mouse.move(ix, iy); await page.waitForTimeout(80);
  await page.keyboard.press('KeyR');
  const d1 = await page.evaluate(() => FG.app.game.byKind.inserter[0].dir);
  await check('R rotates the hovered arm', d1 === 2, 'dir=' + d1);
  // Tunnel belts: place entrance then exit, check pairing and types
  await place('underground_belt', X + 0.5, Y + 16.5, 1);
  await place('underground_belt', X + 4.5, Y + 16.5, 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const ug = await page.evaluate(() => FG.app.game.byKind.underground.map((u) => [u.ug, !!u.pair]));
  await check('tunnel belts pair as entrance + exit', JSON.stringify(ug) === JSON.stringify([['in', true], ['out', true]]), JSON.stringify(ug));
  // Tunnel pipes auto-face each other
  await place('pipe_ug', X + 8.5, Y + 16.5, 3);
  await place('pipe_ug', X + 13.5, Y + 16.5, 3);
  await page.keyboard.press('Escape');
  const pu = await page.evaluate(() => FG.app.game.byKind.pipe_ug.map((p) => p.dir));
  await check('second tunnel pipe flips to pair', JSON.stringify(pu) === '[3,1]', JSON.stringify(pu));
  // Drones: research and paste as ghosts without items
  await page.evaluate(() => { const g = FG.app.game; g.completeResearch('drones', true); g.player.inv.remove('assembler_1', 99); });
  await page.evaluate(() => { FG.app.cursor = { bp: FG.app.blueprint }; });
  console.log('    before paste', await page.evaluate(() => JSON.stringify({ cur: !!(FG.app.cursor && FG.app.cursor.bp), bp: FG.app.blueprint, crafters: FG.app.game.byKind.crafter.map((a) => [a.x, a.y]), p: [FG.app.game.player.x, FG.app.game.player.y] })));
  await click(X + 16.5, Y + 12.5);
  console.log('    after paste', await page.evaluate(() => JSON.stringify({ crafters: FG.app.game.byKind.crafter.map((a) => [a.x, a.y]), ghosts: Array.from(FG.app.game.ghosts.values()).map((g) => [g.p, g.x, g.y]), toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent) })));
  const gh = await page.evaluate(() => FG.app.game.ghosts.size);
  await check('paste without items leaves ghosts', gh >= 1, 'ghosts=' + gh);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { FG.app.game.player.inv.add('assembler_1', 1); FG.app.game.player.x += 8; FG.app.renderer.cam.x = FG.app.game.player.x; });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ ghosts: FG.app.game.ghosts.size, crafters: FG.app.game.byKind.crafter.length }));
  await check('drones build ghosts from inventory', after.crafters === 3, JSON.stringify(after));
  await page.screenshot({ path: out + '/61-drones.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
