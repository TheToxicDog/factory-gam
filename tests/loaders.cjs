// Loaders with real clicks, drags and keys: chest to belt to chest, a furnace fed and emptied
// by loaders, every tier, a wagon, the window and the demo factory's loader.
// Usage: node tests/loaders.cjs [url] [outdir]
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
  const shot = (name) => page.screenshot({ path: out + '/' + name + '.png' });
  await page.goto(url);
  await wait(1200);
  const [X, Y] = await ev(() => {
    FG.app.newGame({ seed: 4242, enemies: 'off', size: 384 });
    const g = FG.app.game, w = g.world;
    const X = w.spawnX - 10, Y = w.spawnY - 8;
    for (let y = Y - 6; y < Y + 26; y++) for (let x = X - 6; x < X + 30; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    for (const t of ['automation', 'logistics', 'logistic_science', 'logistics_2', 'steel']) g.completeResearch(t, true);
    const inv = g.player.inv;
    inv.slots.fill(null);
    for (const [id, n] of [['loader', 10], ['fast_loader', 4], ['express_loader', 4], ['belt', 100], ['fast_belt', 40], ['express_belt', 40], ['iron_chest', 10],
      ['iron_plate', 200], ['copper_plate', 200], ['iron_ore', 100], ['coal', 50], ['stone_furnace', 2]]) inv.add(id, n);
    FG.emit('inventory');
    g.player.x = X + 7.5; g.player.y = Y + 2.5;
    const c = FG.app.renderer.cam; c.x = X + 8; c.y = Y + 1; c.zoom = 1.6;
    return [X, Y];
  });
  await wait(300);
  const scr = (x, y) => ev(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const hover = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await wait(80); };
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
  const ent = (x, y) => ev(([x, y]) => {
    const e = FG.entAt(FG.app.game, x, y);
    if (!e) return null;
    return { p: e.p, x: e.x, y: e.y, dir: e.dir, lm: e.lm, status: e.status, filter: e.filter, n: e.inv ? e.inv.totals() : null, lanes: e.lanes ? e.lanes[0].ids.length + e.lanes[1].ids.length : 0 };
  }, [x, y]);
  const empty = () => ev(() => { FG.app.cursor = null; });
  const view = (x, y, zoom) => ev(([x, y, zoom]) => { const c = FG.app.renderer.cam; c.x = x; c.y = y; c.zoom = zoom; }, [x, y, zoom]);
  // Move the player; the camera glides after them, so let it settle before clicking.
  const standAt = async (x, y) => { await ev(([x, y]) => { const p = FG.app.game.player; p.x = x; p.y = y; }, [x, y]); await wait(700); };
  const srcCount = () => ev(([x, y]) => FG.entAt(FG.app.game, x, y).inv.totals(), [X, Y]);

  // 1. A chest of plates, a loader pointed away from it (it unloads), a belt, and a loader
  //    pointed at a second chest (it loads).
  await hold('iron_chest');
  await clickAt(X + 0.5, Y + 0.5);
  await hold('iron_plate');
  await clickAt(X + 0.5, Y + 0.5); // a stack of plates into the chest, twice
  await clickAt(X + 0.5, Y + 0.5);
  await hold('copper_plate');
  await clickAt(X + 0.5, Y + 0.5);
  await hold('loader', 1);
  await hover(X + 2, Y + 0.5);
  await wait(150);
  const pv1 = await ev(() => { const b = FG.app.view.build; return b && b.previews[0]; });
  check('the preview of a loader pointed away from a chest shows it unloading', pv1 && pv1.lm === 'out' && pv1.x === X + 1, JSON.stringify(pv1));
  await shot('80-loader-preview-unloads');
  await clickAt(X + 2, Y + 0.5);
  const u = await ent(X + 1, Y);
  check('placed as an unloading loader', u && u.p === 'loader' && u.lm === 'out' && u.dir === 1, JSON.stringify(u));
  await hold('belt');
  await drag([[X + 3.5, Y + 0.5], [X + 10.5, Y + 0.5]]);
  await hold('iron_chest');
  await clickAt(X + 13.5, Y + 0.5);
  await hold('loader', 1);
  await hover(X + 12, Y + 0.5);
  await wait(150);
  const pv2 = await ev(() => { const b = FG.app.view.build; return b && b.previews[0]; });
  check('pointed at a chest, the preview shows it loading', pv2 && pv2.lm === 'in' && pv2.x === X + 11, JSON.stringify(pv2));
  await shot('81-loader-preview-loads');
  await clickAt(X + 12, Y + 0.5);
  await empty();
  await wait(9000); // a yellow belt takes about 6 s to cross
  const dst = await ent(X + 13, Y), l2 = await ent(X + 11, Y);
  const moved = dst && dst.n ? (dst.n.iron_plate || 0) + (dst.n.copper_plate || 0) : 0;
  check('plates travel chest -> loader -> belt -> loader -> chest', l2.lm === 'in' && moved > 30, moved + ' plates, loader ' + l2.status);
  await hover(X + 1.5, Y + 0.5);
  await wait(200);
  await shot('82-loaders-chest-to-chest');
  const hoverText = await ev(() => document.getElementById('hud-hover').textContent);
  check('hovering a loader says what it unloads, and that it is working', /Unloading from/.test(hoverText) && /iron chest/.test(hoverText) && /Unloading/.test(hoverText.split('Items')[0]), hoverText.slice(0, 120));

  // 2. The loader window: switch mode, pick a filter.
  await clickAt(X + 1.5, Y + 0.5);
  await wait(250);
  check('clicking a loader opens its window', await ev(() => FG.app.ui.win && FG.app.ui.win.name === 'entity'));
  await page.click('#win-entity .slot.filter');
  await wait(150);
  await page.click('#win-entity .recipe-picker .slot[data-item="copper_plate"]').catch(async () => {
    // fall back to finding the copper icon by its tooltip id
    const els = await page.$$('#win-entity .recipe-picker .slot');
    for (const el of els) { const id = await el.evaluate((n) => n.dataset.id || n.dataset.item || ''); if (id === 'copper_plate') { await el.click(); break; } }
  });
  await wait(200);
  const s0 = await srcCount();
  await shot('83-loader-window');
  const uf = await ent(X + 1, Y);
  check('the filter picker sets a filter', uf.filter === 'copper_plate', JSON.stringify(uf.filter));
  await page.click('#win-entity .seg button:has-text("Load")');
  await wait(120);
  const sw = await ent(X + 1, Y);
  check('the Load button turns it round to load the chest', sw.lm === 'in' && sw.dir === 3, JSON.stringify(sw));
  await page.click('#win-entity .seg button:has-text("Unload")');
  await wait(120);
  check('and Unload turns it back', (await ent(X + 1, Y)).lm === 'out');
  await page.keyboard.press('Escape');
  await wait(150);
  // R over the loading loader swaps it too.
  await hover(X + 11.5, Y + 0.5);
  await page.keyboard.press('KeyR');
  await wait(100);
  const r1 = await ent(X + 11, Y);
  await page.keyboard.press('KeyR');
  await wait(100);
  const r2 = await ent(X + 11, Y);
  check('R over a loader swaps loading and unloading, and back', r1.lm === 'out' && r1.dir === 3 && r2.lm === 'in' && r2.dir === 1, JSON.stringify([r1.lm, r1.dir, r2.lm, r2.dir]));
  await wait(3000);
  const s1 = await srcCount();
  check('with a copper filter only copper leaves the chest', s0.iron_plate > 0 && s1.iron_plate === s0.iron_plate && s1.copper_plate < s0.copper_plate, JSON.stringify([s0, s1]));

  // 3. A furnace fed and emptied by loaders: ore chest -> loader -> belt -> loader -> furnace
  //    -> loader -> belt -> loader -> plate chest.
  const Y2 = Y + 5;
  await standAt(X + 9.5, Y2 + 3.5);
  await hold('iron_chest'); await clickAt(X + 0.5, Y2 + 0.5);
  await hold('iron_ore'); await clickAt(X + 0.5, Y2 + 0.5);
  await hold('stone_furnace'); await clickAt(X + 9, Y2 + 1);
  await hold('coal'); await clickAt(X + 9, Y2 + 1);
  await hold('iron_chest'); await clickAt(X + 17.5, Y2 + 0.5);
  await hold('loader', 1);
  await clickAt(X + 2, Y2 + 0.5); // unloads the ore chest
  await clickAt(X + 7, Y2 + 0.5); // loads the furnace
  await clickAt(X + 11, Y2 + 0.5); // unloads the furnace
  await clickAt(X + 16, Y2 + 0.5); // loads the plate chest
  await hold('belt');
  await drag([[X + 3.5, Y2 + 0.5], [X + 5.5, Y2 + 0.5]]);
  await drag([[X + 12.5, Y2 + 0.5], [X + 14.5, Y2 + 0.5]]);
  await empty();
  const modes = await ev(([X, Y2]) => [1, 6, 10, 15].map((dx) => FG.entAt(FG.app.game, X + dx, Y2).lm), [X, Y2]);
  check('each loader guessed its mode from where the chest or furnace is', JSON.stringify(modes) === '["out","in","out","in"]', JSON.stringify(modes));
  await view(X + 9, Y2 + 1, 1.6);
  await wait(12000);
  const plates = await ent(X + 17, Y2);
  const fur = await ev(([x, y]) => { const f = FG.entAt(FG.app.game, x, y); return { inp: f.inp, out: f.out, status: f.status }; }, [X + 8, Y2]);
  check('the furnace is fed ore and its plates are loaded out into the chest', plates.n && plates.n.iron_plate >= 2 && (!fur.inp || fur.inp.n <= 2), JSON.stringify([plates.n, fur]));
  await hover(X + 10.5, Y2 + 0.5);
  await wait(200);
  await shot('84-loaders-feed-and-empty-a-furnace');

  // 4. Every tier, chest to chest.
  const Y3 = Y + 9;
  await standAt(X + 8.5, Y3 + 1.5);
  for (const [k, ld, belt] of [[0, 'fast_loader', 'fast_belt'], [2, 'express_loader', 'express_belt']]) {
    const y = Y3 + k;
    await ev(([x, y]) => { const e = FG.placeEntity(FG.app.game, 'iron_chest', x, y); e.inv.add('iron_gear', 1000); }, [X, y]);
    await hold(ld, 1);
    await clickAt(X + 2, y + 0.5);
    await hold(belt);
    await drag([[X + 3.5, y + 0.5], [X + 12.5, y + 0.5]]);
    await hold('iron_chest'); await clickAt(X + 15.5, y + 0.5);
    await hold(ld, 1); await clickAt(X + 14, y + 0.5);
  }
  await empty();
  await view(X + 8, Y3 + 1, 1.6);
  await wait(6000);
  await hover(X + 8, Y3 - 2);
  await shot('85-fast-and-express-loaders');
  const tiers = await ev(([X, Y3]) => [0, 2].map((k) => { const c = FG.entAt(FG.app.game, X + 15, Y3 + k); return c && c.inv ? c.inv.count('iron_gear') : -1; }), [X, Y3]);
  check('fast and express loaders move gears chest to chest', tiers[0] > 20 && tiers[1] > tiers[0], JSON.stringify(tiers));

  // 5. Loaders filling a stopped wagon from a chest, and emptying it on the far side.
  const [TX, TY] = await ev(([X, Y]) => {
    const g = FG.app.game, RL = FG.rails, TR = FG.trains;
    const ty = Math.floor((Y + 20) / 2) * 2, tx = Math.floor((X - 4) / 2) * 2;
    let st = [tx, ty, 2];
    for (let k = 0; k < 16; k++) { RL.build(g, st[0], st[1], st[2], 'S'); st = RL.endOf(st[0], st[1], st[2], 'S'); }
    const w = TR.placeCar(g, 'wagon', tx + 14, ty, 1);
    return [w.ok ? tx : null, ty];
  }, [X, Y]);
  check('a wagon stands on a short track', TX !== null);
  await standAt(TX + 10.5, TY - 3.5);
  // The wagon covers x TX+11..TX+17 on rows TY-1..TY. Above it: chest, unloading loader,
  // loading loader pointing down into the wagon. Below: a loader unloading it into a chest.
  await ev(([x, y]) => { const e = FG.placeEntity(FG.app.game, 'iron_chest', x, y); e.inv.add('copper_plate', 400); }, [TX + 14, TY - 6]);
  await hold('loader', 2);
  await clickAt(TX + 14.5, TY - 4); // unloads the chest above it
  await clickAt(TX + 14.5, TY - 2); // loads the wagon below it
  await hold('iron_chest'); await clickAt(TX + 12.5, TY + 3.5);
  await hold('loader', 0);
  await hover(TX + 12.5, TY + 2);
  await wait(150);
  const pvW = await ev(() => { const b = FG.app.view.build; return b && b.previews[0]; });
  await empty();
  const wl = await ev(([x, y]) => [FG.entAt(FG.app.game, x, y - 5).lm, FG.entAt(FG.app.game, x, y - 3).lm], [TX + 14, TY + 0]);
  check('above the wagon: an unloader under the chest, a loader into the wagon', JSON.stringify(wl) === '["out","in"]', JSON.stringify(wl) + ' preview below ' + JSON.stringify(pvW));
  await view(TX + 14, TY - 2, 1.4);
  await wait(4000);
  const cargo = await ev(() => { const tr = FG.app.game.rail.trains[0]; return tr ? FG.trains.cargoTotals(tr) : null; });
  check('the loaders fill the wagon', cargo && cargo.copper_plate > 20, JSON.stringify(cargo));
  await hover(TX + 14.5, TY - 2);
  await wait(200);
  await shot('86-loaders-fill-a-wagon');

  // 6. The crafting menu lists loaders under Logistics.
  await page.keyboard.press('KeyE');
  await wait(300);
  await page.click('#win-inventory .tab:has-text("Logistics")').catch(() => {});
  await wait(150);
  const slot = await page.$('#win-inventory .craft-grid .slot[data-recipe="loader"]');
  if (slot) { await slot.hover(); await wait(400); }
  check('the crafting menu has the loader recipe', !!slot);
  await shot('87-loader-recipe');
  await page.keyboard.press('Escape');

  // 7. The demo factory's loader at the end of the plate belt.
  await ev(() => FG.app.startDemo());
  await wait(1200);
  await ev(() => { const g = FG.app.game; g.player.x = 219.5; g.player.y = 162.5; const c = FG.app.renderer.cam; c.x = 222; c.y = 166; c.zoom = 1.6; });
  await wait(300);
  await hover(222.5, 164.5);
  await wait(300);
  const dl = await ent(222, 164);
  check('the demo factory has a loader filling its plate chest', dl && dl.p === 'loader' && dl.lm === 'in', JSON.stringify(dl));
  await shot('88-demo-plate-loader');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
