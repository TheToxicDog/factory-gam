// Opens the machine window and hover panel for every building type and reports script errors.
// Usage: node tests/windows.cjs [url]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1000);
  const protos = await page.evaluate(() => {
    FG.app.newGame({ seed: 8, enemies: 'off', size: 256 });
    const g = FG.app.game, w = g.world;
    for (const id in FG.data.techs) g.completeResearch(id, true);
    return Object.keys(FG.data.protos);
  });
  let opened = 0;
  for (const p of protos) {
    const r = await page.evaluate((p) => {
      const g = FG.app.game, w = g.world;
      const X = w.spawnX - 5, Y = w.spawnY - 5;
      for (const e of Array.from(g.ents.values())) FG.removeEntity(g, e);
      for (let y = Y - 6; y < Y + 14; y++) for (let x = X - 6; x < X + 14; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = FG.RES.IRON; w.amt[i] = 500; }
      w.terrain[(Y + 4) * w.W + X - 1] = FG.T.WATER;
      w.res[(Y + 1) * w.W + X + 1] = FG.RES.OIL;
      const dir = p === 'offshore_pump' ? 1 : 0;
      const c = FG.canPlace(g, p, X, Y + (p === 'offshore_pump' ? 4 : 0), dir, { ignorePlayer: true });
      if (!c.ok) return { skip: c.reason };
      const e = FG.placeEntity(g, p, X, Y + (p === 'offshore_pump' ? 4 : 0), dir);
      g.player.x = X - 3; g.player.y = Y - 3;
      for (let i = 0; i < 5; i++) g.step();
      FG.app.ui.open('entity', e);
      const ok = FG.app.ui.win && FG.app.ui.win.name === 'entity';
      for (let i = 0; i < 3; i++) FG.app.ui.updateHud();
      FG.app.ui.close();
      FG.app.view.hover = { ent: e, tile: [e.x, e.y] };
      FG.app.ui.updateHover();
      FG.app.renderer.draw(g, FG.app.view);
      return { ok };
    }, p);
    if (r.ok) opened++;
    else console.log('  ' + p + ': ' + JSON.stringify(r));
  }
  console.log('opened', opened, 'of', protos.length, 'windows');
  // Other windows and their tabs.
  await page.evaluate(() => { const g = FG.app.game; g.research.done = {}; g.unlocked = {}; });
  await page.keyboard.press('KeyT'); await page.waitForTimeout(200);
  await page.click('.tcard[data-tech="automation"]');
  await page.click('.tcard[data-tech="logistics_2"]', { modifiers: ['Shift'] });
  const q = await page.evaluate(() => FG.app.game.research.queue.slice());
  console.log('  research queue after clicks', JSON.stringify(q));
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
  for (const t of ['Fluids', 'Power', 'Pollution & threat', 'Items']) { await page.click('#win-stats .tab:has-text("' + t + '")'); await page.waitForTimeout(150); }
  await page.click('#win-stats .seg button:has-text("10m")'); await page.waitForTimeout(150);
  await page.keyboard.press('KeyP');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.click('.window .btn:has-text("Save game")'); await page.waitForTimeout(150);
  await page.click('#win-saves .btn.primary >> nth=0'); await page.waitForTimeout(600);
  const saved = await page.evaluate(() => FG.save.list().filter((m) => !m.empty).map((m) => m.slot));
  console.log('  saved slots', JSON.stringify(saved));
  await page.click('#win-saves .btn:has-text("Back")'); await page.waitForTimeout(150);
  await page.click('.window .btn:has-text("Copy or import a save code")'); await page.waitForTimeout(900);
  const code = await page.evaluate(() => document.getElementById('save-code-out').value.length);
  console.log('  save code length', code);
  await page.evaluate(() => { document.getElementById('save-code-in').value = document.getElementById('save-code-out').value; });
  await page.click('#win-savecode .btn.primary:has-text("Load this code")'); await page.waitForTimeout(800);
  console.log('  loaded from code, window now', await page.evaluate(() => FG.app.ui.win && FG.app.ui.win.name), 'paused', await page.evaluate(() => FG.app.paused));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.click('.window .btn:has-text("Quit to title")'); await page.waitForTimeout(600);
  const title = await page.evaluate(() => [FG.app.titleShown, Array.from(document.querySelectorAll('#title-menu .btn')).map((b) => b.textContent)]);
  console.log('  title after quit', JSON.stringify(title));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
