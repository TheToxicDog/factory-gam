// Railway play-test with real mouse and keyboard: plan curved track, stops, cars, schedule, drive.
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
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  await page.goto(url);
  await page.waitForTimeout(1200);
  // A cleared area; X, Y is an even rail point.
  const [X, Y] = await page.evaluate(() => {
    FG.app.newGame({ seed: 2024, enemies: 'off', size: 384 });
    const g = FG.app.game, w = g.world;
    const X = (w.spawnX & ~1) - 30, Y = (w.spawnY & ~1) + 16;
    for (let y = Y - 60; y < Y + 16; y++) for (let x = X - 10; x < X + 80; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    g.completeResearch('railway', true); g.completeResearch('rail_signals', true);
    const inv = g.player.inv;
    for (const [id, n] of [['rail', 200], ['train_stop', 4], ['locomotive', 2], ['cargo_wagon', 2], ['coal', 50], ['rail_signal', 4], ['iron_plate', 100]]) inv.add(id, n);
    FG.emit('inventory');
    return [X, Y];
  });
  const goTo = (x, y, zoom) => page.evaluate(([x, y, z]) => { const g = FG.app.game; g.player.x = x; g.player.y = y; const c = FG.app.renderer.cam; c.x = x; c.y = y; if (z) c.zoom = z; }, [x, y, zoom || 0]);
  const scr = (x, y) => page.evaluate(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const hold = (id) => page.evaluate((id) => FG.app.setCursor(id), id);
  const click = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await page.waitForTimeout(60); await page.mouse.down(); await page.mouse.up(); };
  const drag = async (x0, y0, x1, y1, shot) => {
    const [a, b] = await scr(x0, y0);
    await page.mouse.move(a, b); await page.waitForTimeout(40); await page.mouse.down();
    for (let k = 1; k <= 12; k++) { const [c, d] = await scr(x0 + ((x1 - x0) * k) / 12, y0 + ((y1 - y0) * k) / 12); await page.mouse.move(c, d, { steps: 2 }); await page.waitForTimeout(16); }
    await page.waitForTimeout(120);
    if (shot) await page.screenshot({ path: out + '/' + shot });
    await page.mouse.up();
  };
  // Is there a path of track from rail point a to rail point b?
  const connected = (a, b) => page.evaluate(([a, b]) => {
    const g = FG.app.game, RL = FG.rails;
    const seen = new Set(), stack = [];
    for (let d = 0; d < 8; d++) { const k = RL.stateKey(a[0], a[1], d); stack.push(k); seen.add(k); }
    while (stack.length) {
      const k = stack.pop(), d = k & 7, pk = (k - d) / 8, x = pk & 2047, y = pk >> 11;
      if (x === b[0] && y === b[1]) return true;
      for (const e of RL.outOf(g, x, y, d)) { const s = RL.endState(e), nk = RL.stateKey(s[0], s[1], s[2]); if (!seen.has(nk)) { seen.add(nk); stack.push(nk); } }
    }
    return false;
  }, [a, b]);

  // 1. Hold rails and drag: a straight line east, then from its end up and round to the north-east.
  await goTo(X + 16, Y - 2, 0.75);
  await hold('rail');
  await drag(X, Y, X + 30, Y);
  let info = await page.evaluate(() => ({ n: FG.app.game.rail.pieces.size, rails: FG.app.game.player.inv.count('rail') }));
  check('dragging lays straight track', info.n === 15 && info.rails === 185, JSON.stringify(info));
  // Track pieces are built within 20 tiles of you, so plan the long bend in two drags.
  await goTo(X + 36, Y - 8, 0.6);
  await drag(X + 30, Y, X + 46, Y - 16, '80-planner-preview.png');
  await goTo(X + 46, Y - 26, 0.6);
  await drag(X + 46, Y - 16, X + 50, Y - 40);
  info = await page.evaluate(() => { const g = FG.app.game; const ps = Array.from(g.rail.pieces.values()); return { n: ps.length, curves: ps.filter((p) => p.t !== 'S').length, diag: ps.filter((p) => p.t === 'S' && p.ah & 1).length, rails: g.player.inv.count('rail') }; });
  check('the planner lays curves and diagonals to reach the point', info.curves >= 2 && info.n > 15 && info.rails === 200 - 15 - (info.n - 15 - info.curves) - info.curves * 4, JSON.stringify(info));
  check('the new track joins the old', await connected([X, Y], [X + 50, Y - 40]));
  await page.evaluate(() => { FG.app.cursor = null; });
  await goTo(X + 30, Y - 18, 0.62);
  await page.waitForTimeout(150);
  await page.screenshot({ path: out + '/81-curved-track.png' });

  // 2. Stops beside the track: Depot for northbound trains near the far end, Quarry for westbound at the start.
  // Depot goes beside the start of the last piece, for trains arriving at the far end.
  const dStop = await page.evaluate(([bx, by]) => {
    const g = FG.app.game, RL = FG.rails;
    for (let h = 0; h < 8; h++) for (const e of RL.into(g, bx, by, h)) { const st = RL.startState(e); return st.concat(RL.sideTile(st[0], st[1], st[2])); }
    return null;
  }, [X + 50, Y - 40]);
  check('the track reaches the target point', !!dStop, JSON.stringify(dStop));
  await hold('train_stop');
  const dTile = [dStop[3], dStop[4]];
  await goTo(dStop[0] - 4, dStop[1] + 4, 0.75);
  await click(dTile[0] + 0.5, dTile[1] + 0.5);
  const qTile = await page.evaluate(([x, y]) => FG.rails.sideTile(x, y, 6), [X + 2, Y]);
  await goTo(X + 10, Y - 4, 0.75);
  await click(qTile[0] + 0.5, qTile[1] + 0.5);
  await page.evaluate(() => { FG.app.cursor = null; });
  await page.waitForTimeout(100);
  const stops = await page.evaluate(() => (FG.app.game.byKind.trainstop || []).map((e) => [e.name, e.attached, e.rd]));
  check('two stops placed beside the track, facing the right way', stops.length === 2 && stops.every((s) => s[1]) && stops[0][2] === dStop[2] && stops[1][2] === 6, JSON.stringify(stops));
  for (const [t, name, px, py] of [[dTile, 'Depot', dStop[0] - 4, dStop[1] + 4], [qTile, 'Quarry', X + 10, Y - 4]]) {
    await goTo(px, py);
    await click(t[0] + 0.5, t[1] + 0.5);
    await page.waitForTimeout(200);
    await page.fill('#stop-name', name);
    await page.press('#stop-name', 'Enter');
    await page.keyboard.press('Escape');
  }
  const names = await page.evaluate(() => FG.trains.stopNames(FG.app.game));
  check('stops renamed from their window', JSON.stringify(names) === '["Depot","Quarry"]', JSON.stringify(names));

  // 3. Locomotive facing east, a wagon behind, and a second locomotive facing west.
  await goTo(X + 16, Y - 4, 0.9);
  await hold('locomotive');
  await page.evaluate(() => { FG.app.dir = 1; });
  await click(X + 24, Y);
  await hold('cargo_wagon');
  await click(X + 17, Y);
  await hold('locomotive');
  await page.evaluate(() => { FG.app.dir = 3; });
  await page.mouse.move(...(await scr(X + 10, Y)));
  await page.waitForTimeout(100);
  await page.screenshot({ path: out + '/82-place-car.png' });
  await click(X + 10, Y);
  await page.evaluate(() => { FG.app.cursor = null; });
  const tinfo = await page.evaluate(() => FG.app.game.rail.trains.map((t) => t.cars.map((c) => c.type + (c.flip ? '<' : '>')).join(' ')));
  check('train assembled: loco, wagon, loco facing back', tinfo.length === 1 && tinfo[0] === 'loco> wagon> loco<', JSON.stringify(tinfo));

  // 4. Open the train window, fuel it, build the schedule.
  const [cx, cy] = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; const p = FG.trains.carPose(t, 0); return FG.app.renderer.toScreen(p.x, p.y); });
  await page.mouse.move(cx, cy); await page.waitForTimeout(100);
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
  await page.fill('#sched-v-0', '2'); await page.press('#sched-v-0', 'Tab');
  await page.selectOption('#sched-station-1', 'Quarry');
  await page.selectOption('#sched-cond-1', 'time');
  await page.fill('#sched-v-1', '2'); await page.press('#sched-v-1', 'Tab');
  await page.click('#win-train .seg button:has-text("Automatic")');
  const sched = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return { mode: t.mode, s: t.schedule.map((e) => e.station + ':' + e.cond + ':' + e.v) }; });
  check('schedule built in the window', sched.mode === 'auto' && JSON.stringify(sched.s) === '["Depot:time:2","Quarry:time:2"]', JSON.stringify(sched));
  await page.screenshot({ path: out + '/83-train-window.png' });
  await page.keyboard.press('Escape');

  // 5. Watch it run round the curve to Depot and back.
  await goTo(X + 32, Y - 18, 0.62);
  let sawDepot = false, sawQuarry = false, curveShot = false, onCurve = 0;
  for (let k = 0; k < 120 && !(sawDepot && sawQuarry); k++) {
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => {
      const t = FG.app.game.rail.trains[0];
      const i = t.segs.findIndex((s) => s.s0 + s.len >= t.headS);
      return { state: t.state, arrivals: t.arrivals, curve: i >= 0 && t.segs[i].pc.t !== 'S', speed: t.speed, head: FG.trains.pointAt(t, t.headS) };
    });
    if (st.arrivals >= 1) sawDepot = true;
    if (st.arrivals >= 2) sawQuarry = true;
    if (st.curve && st.speed > 0.1) onCurve++;
    if (st.curve && st.speed > 0.1 && !curveShot) { curveShot = true; await page.screenshot({ path: out + '/84-train-on-curve.png' }); }
  }
  check('train drives round the curve to Depot and back to Quarry', sawDepot && sawQuarry && onCurve > 0, JSON.stringify(await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return { state: t.state, arrivals: t.arrivals, msg: t.msg }; })) + ' curve samples ' + onCurve);

  // 6. Board with Enter and drive by hand.
  await page.evaluate(() => { const g = FG.app.game; const t = g.rail.trains[0]; t.mode = 'manual'; const p = FG.trains.carPose(t, 0); g.player.x = p.x; g.player.y = p.y + 1.8; });
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  check('Enter boards the train', await page.evaluate(() => !!FG.app.game.player.vehicle));
  // It stopped at Quarry facing west into the buffer: hold S to reverse, then W to drive.
  await page.keyboard.down('KeyS'); await page.waitForTimeout(600); await page.keyboard.up('KeyS');
  const before = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return FG.trains.pointAt(t, t.headS); });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1800); await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; return FG.trains.pointAt(t, t.headS); });
  check('W drives the train', Math.hypot(after[0] - before[0], after[1] - before[1]) > 3, JSON.stringify([before, after]));
  await page.screenshot({ path: out + '/85-driving.png' });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Enter');
  check('Enter leaves the train', await page.evaluate(() => !FG.app.game.player.vehicle));

  // 7. A signal snaps beside the track and shows its block.
  await page.evaluate(() => { FG.app.game.rail.trains[0].mode = 'manual'; });
  await goTo(X + 30, Y - 6, 0.9);
  await hold('rail_signal');
  const sTile = await page.evaluate(([x, y]) => FG.rails.sideTile(x, y, 2), [X + 26, Y]);
  await page.mouse.move(...(await scr(sTile[0] + 0.4, sTile[1] + 0.6)));
  await page.waitForTimeout(100);
  await page.screenshot({ path: out + '/86-signal-preview.png' });
  await click(sTile[0] + 0.4, sTile[1] + 0.6);
  await page.evaluate(() => { FG.app.cursor = null; });
  await page.waitForTimeout(100);
  const sig = await page.evaluate(() => { const e = (FG.app.game.byKind.signal || [])[0]; return e && [e.attached, e.rd, e.px, e.py, FG.trains.signalState(FG.app.game, e)]; });
  check('signal snapped beside the track', sig && sig[0] && sig[1] === 2 && sig[2] === X + 26 && sig[3] === Y, JSON.stringify(sig));

  // 8. Save and reload keeps the railway.
  const n1 = await page.evaluate(async () => { const n0 = FG.app.game.rail.pieces.size; await FG.save.store(FG.app.game, '2'); FG.app.startGame(await FG.save.loadSlot('2')); const g = FG.app.game; return [g.rail.pieces.size === n0, g.rail.trains.length, g.rail.trains[0].schedule.length, FG.trains.stopNames(g).join(',')].join(':'); });
  check('railway survives save and load', n1 === 'true:1:2:Depot,Quarry', n1);

  // 9. Copy the curve with Ctrl+C and paste it elsewhere; it lands on the rail grid.
  await goTo(X + 40, Y - 24, 0.62);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
  let [ax, ay] = await scr(X + 29, Y - 42); let [bx, by] = await scr(X + 52, Y + 2);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 }); await page.mouse.up();
  const bp = await page.evaluate(() => FG.app.blueprint && [FG.app.blueprint.rails.length, FG.app.blueprint.ents.length, FG.app.blueprint.w % 2, FG.app.blueprint.h % 2]);
  check('copy picks up track pieces', bp && bp[0] >= 4 && bp[2] === 0 && bp[3] === 0, JSON.stringify(bp));
  await page.keyboard.press('KeyR');
  [ax, ay] = await scr(X + 20, Y - 36);
  await page.mouse.move(ax, ay); await page.waitForTimeout(150);
  await page.screenshot({ path: out + '/87-paste-preview.png' });
  const n2 = await page.evaluate(() => FG.app.game.rail.pieces.size);
  await page.mouse.down(); await page.mouse.up();
  await page.evaluate(() => { FG.app.cursor = null; });
  const n3 = await page.evaluate(() => [FG.app.game.rail.pieces.size, FG.app.game.rail.ghosts.size]);
  check('pasted (rotated) track is built in reach and planned beyond', n3[0] > n2 && n3[0] - n2 + n3[1] === bp[0], JSON.stringify([n3[0] - n2, n3[1], bp[0]]));
  // Walk over to the planned part and click it: the joined planned pieces get built.
  const gp = await page.evaluate(() => { const pc = FG.app.game.rail.ghosts.values().next().value; return pc && [pc.pts[1][0], pc.pts[1][1]]; });
  if (gp) {
    await goTo(gp[0] + 2, gp[1] + 2);
    await page.mouse.move(...(await scr(gp[0], gp[1]))); await page.waitForTimeout(100);
    await page.screenshot({ path: out + '/87b-planned-track.png' });
    await page.mouse.down(); await page.mouse.up();
    const n4 = await page.evaluate(() => [FG.app.game.rail.pieces.size, FG.app.game.rail.ghosts.size]);
    check('clicking planned track builds it', n4[1] < n3[1] && n4[0] - n3[0] === n3[1] - n4[1], JSON.stringify([n3, n4]));
  }

  // 10. X-drag over the train picks up its cars, then over the straight picks up track.
  const carsBefore = await page.evaluate(() => FG.app.game.player.inv.count('locomotive') + FG.app.game.player.inv.count('cargo_wagon'));
  const box = await page.evaluate(() => { const t = FG.app.game.rail.trains[0]; const ps = t.cars.map((c, i) => FG.trains.carPose(t, i)); const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y); return [Math.min(...xs) - 4, Math.min(...ys) - 2, Math.max(...xs) + 4, Math.max(...ys) + 2]; });
  await goTo((box[0] + box[2]) / 2, (box[1] + box[3]) / 2 + 4, 0.75);
  await page.keyboard.press('KeyX');
  [ax, ay] = await scr(box[0], box[1]); [bx, by] = await scr(box[2], box[3]);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 });
  await page.screenshot({ path: out + '/88-area-pickup.png' });
  await page.mouse.up();
  const carsAfter = await page.evaluate(() => [FG.app.game.player.inv.count('locomotive') + FG.app.game.player.inv.count('cargo_wagon'), FG.app.game.rail.trains.length]);
  check('X drag picks up the whole train (and the track under it)', carsAfter[0] === carsBefore + 3 && carsAfter[1] === 0, JSON.stringify([carsBefore, carsAfter]));
  const railsNow = await page.evaluate(() => FG.app.game.player.inv.count('rail'));
  check('picked-up track returns rails', railsNow > 10, 'rails ' + railsNow);

  // 11. Right-click mines one piece of track.
  const mined = await page.evaluate(() => { const g = FG.app.game; const pc = Array.from(g.rail.pieces.values()).find((p) => p.t !== 'S'); return pc ? [(pc.pts[9][0]), (pc.pts[9][1]), g.rail.pieces.size, g.player.inv.count('rail')] : null; });
  await goTo(mined[0] + 3, mined[1] + 3);
  [ax, ay] = await scr(mined[0], mined[1]);
  await page.mouse.move(ax, ay); await page.waitForTimeout(80);
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(700); await page.mouse.up({ button: 'right' });
  const afterMine = await page.evaluate(() => [FG.app.game.rail.pieces.size, FG.app.game.player.inv.count('rail')]);
  check('right-click picks up a curve for 4 rails', afterMine[0] === mined[2] - 1 && afterMine[1] === mined[3] + 4, JSON.stringify([mined.slice(2), afterMine]));

  // 12. Map shows the line.
  await page.keyboard.press('KeyM'); await page.waitForTimeout(600); await page.screenshot({ path: out + '/89-map.png' }); await page.keyboard.press('KeyM');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
