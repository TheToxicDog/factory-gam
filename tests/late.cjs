// Late-game checks in the browser: an attack wave against turrets, and the uplink launch.
// Usage: node tests/late.cjs [url] [outdir]
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
  // --- Attack wave
  const setup = await page.evaluate(() => {
    FG.app.newGame({ seed: 31337, enemies: 'normal', size: 384 });
    const g = FG.app.game, w = g.world, en = g.enemies;
    const X = w.spawnX, Y = w.spawnY;
    for (let y = Y - 30; y < Y + 30; y++) for (let x = X - 30; x < X + 40; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    en.buildPathGrid();
    const P = (p, x, y, d) => { const c = FG.canPlace(g, p, x, y, d || 0, { ignorePlayer: true }); return c.ok ? FG.placeEntity(g, p, x, y, d || 0) : null; };
    const target = P('stone_furnace', X, Y);
    const turrets = [];
    for (const [dx, dy] of [[6, -3], [6, 2], [-8, -3], [-8, 2]]) { const t = P('gun_turret', X + dx, Y + dy); FG.insertItem(g, t, 'ammo_basic', 30, 'direct'); turrets.push(t.id); }
    // Nest 45 tiles east with pending attackers.
    const n = en.addNest(X + 45, Y);
    n.pending = ['crawler', 'crawler', 'crawler', 'crawler', 'crawler', 'crawler'];
    en.launchAttack(n);
    g.player.x = X - 3; g.player.y = Y + 6;
    return { units: en.units.length, turrets };
  });
  check('attack wave launched', setup.units === 6, 'units=' + setup.units);
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const g = FG.app.game; const u = g.enemies.units[0]; if (u) { g.player.x = u.x - 12; g.player.y = u.y + 3; } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/50-wave.png' });
  await page.waitForTimeout(9000);
  const res = await page.evaluate(() => ({ units: FG.app.game.enemies.units.length, kills: FG.app.game.stats.kills, lost: FG.app.game.lostBuildings || 0, alerts: FG.app.ui.alerts.length }));
  check('turrets destroyed the wave', res.units === 0 && res.kills >= 6, JSON.stringify(res));
  await page.screenshot({ path: out + '/51-after-wave.png' });
  // --- Player shooting a nest with Space
  const nestHp = await page.evaluate(() => { const g = FG.app.game; const n = g.enemies.nests.find((n) => Math.abs(n.x - g.world.spawnX - 45) < 2); g.player.x = n.x - 8; g.player.y = n.y + 1; g.player.inv.add('ammo_basic', 50); return n.hp; });
  await page.waitForTimeout(300);
  await page.keyboard.down('Space');
  await page.waitForTimeout(6000);
  await page.keyboard.up('Space');
  const nestAfter = await page.evaluate(() => { const g = FG.app.game; const n = g.enemies.nests.find((n) => Math.abs(n.x - g.world.spawnX - 45) < 2); return { hp: n ? n.hp : 0, playerHp: g.player.hp, dead: g.player.dead, kills: g.stats.kills }; });
  check('shooting damages the hive', nestAfter.hp < nestHp, JSON.stringify(nestAfter));
  await page.screenshot({ path: out + '/52-shooting.png' });
  // --- Uplink launch
  const up = await page.evaluate(() => {
    const g = FG.app.game, w = g.world;
    for (const id in FG.data.techs) g.completeResearch(id, true);
    const X = w.spawnX - 20, Y = w.spawnY + 10;
    const P = (p, x, y, d) => { const c = FG.canPlace(g, p, x, y, d || 0, { ignorePlayer: true }); return c.ok ? FG.placeEntity(g, p, x, y, d || 0) : null; };
    for (let k = 0; k < 6; k++) P('solar_panel', X - 10 + (k % 2) * 3, Y + Math.floor(k / 2) * 3);
    P('medium_pole', X - 4, Y + 3);
    P('medium_pole', X - 1, Y + 3);
    const u = P('uplink', X, Y);
    u.stages = 39;
    u.inp = { low_density: 5, guidance_unit: 5, rocket_fuel: 5 };
    g.player.x = X + 3; g.player.y = Y + 9;
    g.player.inv.add('satellite', 1);
    return { id: u && u.id };
  });
  check('uplink placed', !!up.id);
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => { const u = FG.app.game.byKind.uplink[0]; return { stages: u.stages, status: u.status }; });
  check('final stage built', st.stages === 40, JSON.stringify(st));
  // Insert satellite by clicking: hold satellite and click the uplink
  await page.evaluate(() => FG.app.setCursor('satellite'));
  let [sx, sy] = await page.evaluate(() => { const u = FG.app.game.byKind.uplink[0]; return FG.app.renderer.toScreen(u.x + 3.5, u.y + 3.5); });
  await page.mouse.move(sx, sy); await page.waitForTimeout(80);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);
  const win = await page.evaluate(() => FG.app.ui.win && FG.app.ui.win.name);
  check('uplink window opens', win === 'entity', win);
  await page.screenshot({ path: out + '/53-uplink.png' });
  await page.click('#win-entity .btn.primary:has-text("Launch")');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out + '/54-launching.png' });
  await page.waitForTimeout(8000);
  const v = await page.evaluate(() => ({ win: FG.app.ui.win && FG.app.ui.win.name, launches: FG.app.game.launches, won: FG.app.game.won }));
  check('launch leads to victory', v.won && v.win === 'victory', JSON.stringify(v));
  await page.screenshot({ path: out + '/55-victory.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
