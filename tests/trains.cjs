// Railway play-test with real mouse and keyboard: lay track, stops, cars, schedule, drive.
// Usage: node tests/trains.cjs [url] [outdir]
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
  const [X, Y] = await page.evaluate(() => {
    FG.app.newGame({ seed: 2024, enemies: 'off', size: 384 });
    const g = FG.app.game, w = g.world;
    const X = w.spawnX - 12, Y = w.spawnY - 4;
    for (let y = Y - 12; y < Y + 16; y++) for (let x = X - 8; x < X + 40; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    g.completeResearch('railway', true); g.completeResearch('rail_signals', true);
    const inv = g.player.inv;
    for (const [id, n] of [['rail', 200], ['train_stop', 4], ['locomotive', 2], ['cargo_wagon', 2], ['coal', 50], ['rail_signal', 4], ['iron_plate', 100]]) inv.add(id, n);
    FG.emit('inventory');
    g.player.x = X + 12; g.player.y = Y + 3;
    FG.app.renderer.cam.x = g.player.x; FG.app.renderer.cam.y = g.player.y; FG.app.renderer.cam.zoom = 1.0;
    return [X, Y];
  });
  await page.waitForTimeout(300);
  const scr = (x, y) => page.evaluate(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const hold = (id) => page.evaluate((id) => FG.app.setCursor(id), id);
  const click = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await page.waitForTimeout(60); await page.mouse.down(); await page.mouse.up(); };
  // 1. Drag a track east, then turn north (an L shape).
  await hold('rail');
  let [sx, sy] = await scr(X + 0.5, Y + 0.5);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let k = 1; k <= 24; k++) { const [a, b] = await scr(X + k + 0.5, Y + 0.5); await page.mouse.move(a, b, { steps: 2 }); }
  await page.mouse.up();
  // Walk over (build reach is 12 tiles), then drag from the end of the track to extend it north.
  await page.evaluate(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; FG.app.renderer.cam.x = x; FG.app.renderer.cam.y = y; }, [X + 18, Y - 2]);
  await page.waitForTimeout(150);
  [sx, sy] = await scr(X + 24.5, Y + 0.5);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { const [a, b] = await scr(X + 24.5, Y - k + 0.5); await page.mouse.move(a, b, { steps: 2 }); }
  await page.mouse.up();
  await page.evaluate(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; FG.app.renderer.cam.x = x; FG.app.renderer.cam.y = y; }, [X + 12, Y + 3]);
  await page.waitForTimeout(100);
  const track = await page.evaluate(() => (FG.app.game.byKind.rail || []).map((r) => r.mask));
  const pop = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
  const linked = track.filter((m) => pop(m) === 2).length;
  check('dragged track is one connected line with a curve', track.length === 33 && linked === 31, 'pieces ' + track.length + ', through-pieces ' + linked);
  // A parallel line right next to it must stay separate.
  [sx, sy] = await scr(X + 2.5, Y + 1.5);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let k = 3; k <= 10; k++) { const [a, b] = await scr(X + k + 0.5, Y + 1.5); await page.mouse.move(a, b, { steps: 2 }); }
  await page.mouse.up();
  const sep = await page.evaluate(([X, Y]) => { const g = FG.app.game; const a = FG.trains.railAt(g, X + 5, Y), b = FG.trains.railAt(g, X + 5, Y + 1); return [a.mask, b.mask]; }, [X, Y]);
  check('parallel track does not join', (sep[0] & 4) === 0 && (sep[1] & 1) === 0, JSON.stringify(sep));
  // 2. Stops at both ends: place onto existing track (replaces the rail, keeps connections).
  await hold('train_stop');
  await click(X + 2.5, Y + 0.5);
  await page.evaluate(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; FG.app.renderer.cam.x = x; FG.app.renderer.cam.y = y; }, [X + 16, Y - 2]);
  await page.waitForTimeout(100);
  await click(X + 24.5, Y - 7 + 0.5);
  await page.evaluate(() => { FG.app.cursor = null; });
  const stops = await page.evaluate(() => (FG.app.game.byKind.rail || []).filter((r) => r.p === 'train_stop').map((r) => [r.name, r.mask]));
  check('two stops placed on the track, still connected', stops.length === 2 && stops.every((s) => pop(s[1]) >= 1), JSON.stringify(stops));
  // Rename them through the stop window.
  for (const [x, y, name] of [[X + 24.5, Y - 6.5, 'Depot'], [X + 2.5, Y + 0.5, 'Quarry']]) {
    if (name === 'Quarry') { await page.evaluate(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; FG.app.renderer.cam.x = x; FG.app.renderer.cam.y = y; }, [X + 8, Y + 3]); await page.waitForTimeout(100); }
    await click(x, y);
    await page.waitForTimeout(200);
    await page.fill('#stop-name', name);
    await page.press('#stop-name', 'Enter');
    await page.keyboard.press('Escape');
  }
  const names = await page.evaluate(() => FG.trains.stopNames(FG.app.game));
  check('stops renamed from their window', JSON.stringify(names) === '["Depot","Quarry"]', JSON.stringify(names));
  await page.screenshot({ path: out + '/70-track.png' });
  // 3. Locomotive facing east at the west end, a wagon behind, and a second locomotive facing west.
  await hold('locomotive');
  await page.evaluate(() => { FG.app.dir = 1; });
  await click(X + 8.5, Y + 0.5);
  await hold('cargo_wagon');
  await click(X + 5.5, Y + 0.5);
  await hold('locomotive');
  await page.evaluate(() => { FG.app.dir = 3; });
  await click(X + 2.5, Y + 0.5);
  await page.evaluate(() => { FG.app.cursor = null; });
  const tinfo = await page.evaluate(() => FG.app.game.rail.trains.map((t) => t.cars.map((c) => c.type + (c.flip ? '<' : '>')).join(' ')));
  check('train assembled: loco, wagon, loco facing back', tinfo.length === 1 && tinfo[0] === 'loco> wagon> loco<', JSON.stringify(tinfo));
  await page.screenshot({ path: out + '/71-train-placed.png' });
  // 4. Open the train window, fuel it, build the schedule.
  const [cx, cy] = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; const p = FG.trains.carPose(t, 0); return FG.app.renderer.toScreen(p.x, p.y); });
  await page.mouse.move(cx, cy); await page.waitForTimeout(100);
  await page.screenshot({ path: out + '/72-hover-train.png' });
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(250);
  const winName = await page.evaluate(() => FG.app.ui.win && FG.app.ui.win.name);
  check('clicking a car opens the train window', winName === 'train', winName);
  await page.click('#win-train .grid .slot[data-item="coal"]', { modifiers: ['Shift'] });
  const fuel = await page.evaluate(() => FG.trains.fuelOf(FG.app.game.rail.trains[0]));
  check('fuel loaded from the train window', fuel > 0, 'fuel ' + fuel);
  await page.click('#win-train button:has-text("+ Add stop")');
  await page.click('#win-train button:has-text("+ Add stop")');
  await page.selectOption('#sched-station-0', 'Depot');
  await page.selectOption('#sched-cond-0', 'time');
  await page.fill('#sched-v-0', '3'); await page.press('#sched-v-0', 'Tab');
  await page.selectOption('#sched-station-1', 'Quarry');
  await page.selectOption('#sched-cond-1', 'time');
  await page.fill('#sched-v-1', '3'); await page.press('#sched-v-1', 'Tab');
  await page.click('#win-train .seg button:has-text("Automatic")');
  const sched = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return { mode: t.mode, s: t.schedule.map((e) => e.station + ':' + e.cond + ':' + e.v) }; });
  check('schedule built in the window', sched.mode === 'auto' && JSON.stringify(sched.s) === '["Depot:time:3","Quarry:time:3"]', JSON.stringify(sched));
  await page.screenshot({ path: out + '/73-train-window.png' });
  await page.keyboard.press('Escape');
  // 5. Watch it run there and back.
  let sawDepot = false, sawQuarry = false;
  for (let k = 0; k < 40 && !(sawDepot && sawQuarry); k++) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return { state: t.state, cur: t.cur, arrivals: t.arrivals }; });
    if (st.arrivals >= 1) sawDepot = true;
    if (st.arrivals >= 2) sawQuarry = true;
    if (k === 6) await page.screenshot({ path: out + '/74-train-moving.png' });
  }
  check('train drives to Depot and back to Quarry', sawDepot && sawQuarry, JSON.stringify(await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return { state: t.state, arrivals: t.arrivals, msg: t.msg }; })));
  // 6. Board with Enter and drive manually.
  await page.evaluate(() => { const g = FG.app.game; const t = g.rail.trains[0]; t.mode = 'manual'; const p = FG.trains.carPose(t, 0); g.player.x = p.x; g.player.y = p.y + 1.5; });
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  const aboard = await page.evaluate(() => !!FG.app.game.player.vehicle);
  check('Enter boards the train', aboard);
  // Hold S while stopped to reverse (the train sits at the west end facing the buffer), then W to drive.
  await page.keyboard.down('KeyS'); await page.waitForTimeout(600); await page.keyboard.up('KeyS');
  const before = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return FG.trains.pointAt(t, t.headS); });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return { p: FG.trains.pointAt(t, t.headS), speed: t.speed, you: [FG.app.game.player.x, FG.app.game.player.y] }; });
  check('W drives the train', Math.hypot(after.p[0] - before[0], after.p[1] - before[1]) > 2, JSON.stringify([before, after]));
  await page.screenshot({ path: out + '/75-driving.png' });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Enter');
  const off = await page.evaluate(() => !FG.app.game.player.vehicle);
  check('Enter leaves the train', off);
  // 7. Save and reload keeps the railway.
  const n1 = await page.evaluate(async () => { await FG.save.store(FG.app.game, '2'); FG.app.startGame(await FG.save.loadSlot('2')); return FG.app.game.rail.trains.length + ':' + FG.app.game.rail.trains[0].schedule.length + ':' + FG.trains.stopNames(FG.app.game).join(','); });
  check('railway survives save and load', n1 === '1:2:Depot,Quarry', n1);
  // 8. Copy a piece of track with its stop and paste it: connections come along.
  await page.evaluate(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; FG.app.renderer.cam.x = x; FG.app.renderer.cam.y = y; FG.app.cursor = null; }, [X + 8, Y + 4]);
  await page.waitForTimeout(200);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
  let [ax, ay] = await scr(X + 0.5, Y + 0.5); let [bx, by] = await scr(X + 6.5, Y + 0.5);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 }); await page.mouse.up();
  [ax, ay] = await scr(X + 12.5, Y + 6.5);
  await page.mouse.move(ax, ay); await page.waitForTimeout(150);
  await page.screenshot({ path: out + '/77-paste-preview.png' });
  await page.mouse.down(); await page.mouse.up();
  await page.evaluate(() => { FG.app.cursor = null; });
  const pasted = await page.evaluate(([X, Y]) => { const g = FG.app.game; const out = []; for (let x = X + 9; x <= X + 16; x++) { const r = FG.trains.railAt(g, x, Y + 6); if (r) out.push(r.p === 'train_stop' ? 'S' + r.mask : r.mask); } return out; }, [X, Y]);
  check('pasted track keeps its connections', pasted.length === 7 && pasted.filter((m) => m === 10).length >= 4, JSON.stringify(pasted));
  // 9. X-drag over the train picks up its cars.
  const carsBefore = await page.evaluate(() => FG.app.game.player.inv.count('locomotive') + FG.app.game.player.inv.count('cargo_wagon'));
  const box = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; const ps = t.cars.map((c, i) => FG.trains.carPose(t, i)); const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y); return [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2]; });
  await page.evaluate(([x, y]) => { const g = FG.app.game; g.player.x = x; g.player.y = y + 3; FG.app.renderer.cam.x = x; FG.app.renderer.cam.y = y + 3; }, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyX');
  [ax, ay] = await scr(box[0], box[1]); [bx, by] = await scr(box[2], box[3]);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 });
  await page.screenshot({ path: out + '/78-area-pickup.png' });
  await page.mouse.up();
  const carsAfter = await page.evaluate(() => [FG.app.game.player.inv.count('locomotive') + FG.app.game.player.inv.count('cargo_wagon'), FG.app.game.rail.trains.length]);
  check('X drag picks up the whole train', carsAfter[0] === carsBefore + 3 && carsAfter[1] === 0, JSON.stringify([carsBefore, carsAfter]));
  // 10. Map shows the line.
  await page.keyboard.press('KeyM'); await page.waitForTimeout(600); await page.screenshot({ path: out + '/76-map.png' }); await page.keyboard.press('KeyM');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
})();
