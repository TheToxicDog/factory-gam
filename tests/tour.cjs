// Guided tour of the Demo factory with real clicks and keys, screenshotting structures and UI.
// Usage: node tests/tour.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  let fails = 0, shots = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  const shot = async (name) => { shots++; await page.screenshot({ path: out + '/' + name + '.png' }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const scr = (x, y) => ev(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  // Stand on a free tile near (cx, cy) and look there (a short walk, done instantly).
  const view = (cx, cy, zoom) => ev(([cx, cy, zoom]) => {
    const g = FG.app.game;
    let best = [cx, cy];
    for (let r = 0; r < 12; r++) {
      let found = null;
      for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
        if (FG.entAt(g, x, y) || FG.rails.tileHasRail(g, x, y) || g.playerBlocked(x + 0.5, y + 0.5)) continue;
        found = [x + 0.5, y + 0.5]; break;
      }
      if (found) { best = found; break; }
    }
    g.player.x = best[0]; g.player.y = best[1];
    const c = FG.app.renderer.cam; c.x = cx; c.y = cy; c.zoom = zoom;
  }, [cx, cy, zoom]);
  const hover = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await wait(150); };
  const clickAt = async (x, y) => { await hover(x, y); await page.mouse.down(); await page.mouse.up(); await wait(250); };
  const close = async () => { await page.keyboard.press('Escape'); await wait(120); };
  const winName = () => ev(() => FG.app.ui.win && FG.app.ui.win.name);
  const status = (x, y) => ev(([x, y]) => { const e = FG.entAt(FG.app.game, x, y); return e ? e.status : null; }, [x, y]);

  // 1. Title screen, then the Demo factory button.
  await page.goto(url);
  await wait(1500);
  await shot('01-title-screen');
  await page.click('#title-menu .btn:has-text("Demo factory")');
  await wait(900);
  const started = await ev(() => !!FG.app.game && !FG.app.titleShown && FG.app.game.demo && FG.app.game.demo.failed.length === 0);
  check('Demo factory starts from the title screen', started);
  await shot('02-arrival');

  // 2. Steam power.
  await view(205.5, 161, 1.25);
  await wait(300);
  await shot('03-steam-power');
  await hover(202.5, 157.5);
  await shot('04-steam-engine-hover');
  await clickAt(202.5, 165.8);
  check('boiler window opens', (await winName()) === 'entity');
  await shot('05-boiler-window');
  await close();
  await clickAt(205.5, 157.5);
  await shot('06-steam-engine-window');
  await close();
  await clickAt(207.5, 161.5);
  await shot('07-power-pole-window');
  await close();
  const power = await ev(() => { const g = FG.app.game; return { boilers: g.byKind.boiler.map((b) => b.status), out: g.byKind.engine.reduce((s, e) => s + (e.out || 0), 0) }; });
  check('boilers burning and engines generating', power.boilers.every((s) => s === 'working') && power.out > 0, JSON.stringify(power));

  // 3. Iron mining.
  await view(217.5, 190, 1.05);
  await wait(300);
  await shot('08-electric-miners');
  await clickAt(215.5, 189.5);
  await shot('09-drill-window');
  await close();
  await view(217.5, 183.5, 2.4);
  await wait(400);
  await shot('10-belt-closeup');
  const onBelt = await ev(() => { let n = 0; for (const e of FG.app.game.byKind.belt) for (const l of e.lanes) n += l.ids.length; return n; });
  check('ore riding the belts', onBelt > 20, onBelt + ' items on belts');

  // 4. Smelting column.
  await view(220, 173, 1.25);
  await wait(300);
  await shot('11-smelting-column');
  await hover(218.5, 172.5);
  await shot('12-inserter-hover');
  await clickAt(220, 173);
  await shot('13-furnace-window');
  await close();
  check('furnaces smelting', (await status(219, 172)) === 'working', await status(219, 172));

  // 5. Science: gears, packs, labs.
  await view(227.5, 175.5, 1.35);
  await wait(300);
  await shot('14-science-block');
  await clickAt(225.5, 175.5);
  await shot('15-assembler-window');
  await page.click('#win-entity button:has-text("Change recipe")');
  await wait(200);
  await shot('16-recipe-picker');
  await close();
  await clickAt(227.5, 181.5);
  await shot('17-lab-window');
  await close();
  await page.keyboard.press('KeyT');
  await wait(400);
  await shot('18-research-tree');
  await close();
  const research = await ev(() => { const g = FG.app.game; return [g.research.current, g.research.progress[g.research.current] || 0]; });
  check('labs researching', !!research[0], JSON.stringify(research));

  // 6. First-hour setups: burner miner into a furnace, and the self-fuelling coal outpost.
  await view(209.5, 191, 2.0);
  await wait(300);
  await shot('19-burner-miner-and-furnace');
  await view(174, 198.5, 1.7);
  await wait(300);
  await shot('20-coal-outpost');

  // 7. Copper railway: wait for the train at each end.
  const waitStation = async (name) => {
    for (let k = 0; k < 400; k++) {
      const s = await ev(() => { const t = FG.app.game.demo.train; return t.state === 'station' ? t.schedule[t.cur].station : null; });
      if (s === name) return true;
      await wait(100);
    }
    return false;
  };
  check('train reaches the copper mine', await waitStation('Copper mine'));
  await view(207.5, 214, 1.05);
  await wait(900);
  await shot('21-copper-mine-loading');
  check('train reaches the unloading station', await waitStation('Copper unload'));
  await view(207.5, 195, 1.3);
  await wait(1200);
  await shot('22-unloading-into-furnaces');
  const loco = await ev(() => { const t = FG.app.game.demo.train; const p = FG.trains.carPose(t, 0); return [p.x, p.y]; });
  await clickAt(loco[0], loco[1]);
  check('train window opens', (await winName()) === 'train');
  await shot('23-train-window');
  await close();

  // 8. Defence and the whole base.
  await view(232, 178, 1.2);
  await wait(300);
  await shot('24-gun-turrets');
  await view(203, 187, 0.42);
  await wait(500);
  await shot('25-base-overview');
  await view(220, 176, 0.8);
  await page.keyboard.down('Alt'); await page.keyboard.up('Alt');
  await wait(400);
  await shot('26-alt-mode-overlay');
  await page.keyboard.down('Alt'); await page.keyboard.up('Alt');

  // 9. Player windows.
  await page.keyboard.press('KeyE');
  await wait(400);
  await shot('27-inventory-crafting');
  const craft = await page.$('#win-inventory .craft-grid .slot[data-recipe="electric_drill"]') || await page.$('#win-inventory .craft-grid .slot');
  if (craft) { await craft.hover(); await wait(400); await shot('28-recipe-tooltip'); }
  await page.click('#win-inventory .tab:has-text("Logistics")').catch(() => {});
  await page.click('#win-inventory .craft-grid .slot[data-recipe="belt"]').catch(() => {});
  await page.click('#win-inventory .craft-grid .slot[data-recipe="belt"]').catch(() => {});
  await wait(300);
  await shot('29-crafting-queue');
  const queued = await ev(() => FG.app.game.player.queue.length);
  check('hand crafting queued from the inventory', queued > 0, 'queue ' + queued);
  await close();
  await page.keyboard.press('KeyP');
  await wait(500);
  await shot('30-production-stats');
  await page.click('#win-stats .tab:has-text("Power")').catch(() => {});
  await wait(300);
  await shot('31-power-stats');
  await close();
  await page.keyboard.press('KeyM');
  await wait(600);
  await shot('32-map');
  await close();

  // 10. Building by hand: an electric drill on iron, a pole, and a belt dragged away from it.
  await view(226, 191, 1.1);
  await ev(() => FG.app.setCursor('electric_drill'));
  const dirNow = await ev(() => FG.app.dir);
  for (let k = 0; k < ((1 - dirNow + 4) % 4); k++) await page.keyboard.press('KeyR');
  await hover(223.5, 190.5);
  await shot('33-placing-a-drill');
  await page.mouse.down(); await page.mouse.up();
  const drill = await ev(() => { const e = FG.entAt(FG.app.game, 223, 190); return e && { p: e.p, dir: e.dir, x: e.x, y: e.y, ox: e.ox, oy: e.oy }; });
  check('placed an electric drill facing east', drill && drill.p === 'electric_drill' && drill.dir === 1, JSON.stringify(drill));
  await ev(() => FG.app.setCursor('medium_pole'));
  await clickAt(drill.x + 1.5, drill.y + 3.5);
  // Drag a belt east from the tile the drill drops ore on.
  await ev(() => FG.app.setCursor('belt'));
  let [ax, ay] = await scr(drill.ox + 0.5, drill.oy + 0.5);
  await page.mouse.move(ax, ay); await page.mouse.down();
  for (let x = drill.ox + 1; x <= drill.ox + 8; x++) { const [bx, by] = await scr(x + 0.5, drill.oy + 0.5); await page.mouse.move(bx, by, { steps: 2 }); await wait(30); }
  await shot('34-dragging-a-belt');
  await page.mouse.up();
  await ev(() => { FG.app.cursor = null; });
  const newBelts = await ev((d) => { let n = 0; for (let x = d.ox; x <= d.ox + 8; x++) { const e = FG.entAt(FG.app.game, x, d.oy); if (e && e.p === 'belt' && e.dir === 1) n++; } return n; }, drill);
  check('dragged a belt line', newBelts >= 8, newBelts + ' belts');
  await wait(5000);
  const drillSt = await status(drill.x, drill.y);
  const oreOnNew = await ev((d) => { let n = 0; for (let x = d.ox; x <= d.ox + 8; x++) { const e = FG.entAt(FG.app.game, x, d.oy); if (e && e.lanes) for (const l of e.lanes) n += l.ids.length; } return n; }, drill);
  check('ore rides the new belt', oreOnNew > 0, oreOnNew + ' ore');
  check('the new drill mines onto the new belt', drillSt === 'working' || drillSt === 'waiting_space', drillSt);
  await shot('35-new-drill-running');

  // 11. Blueprint copy and paste preview.
  await view(220, 170, 1.0);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
  [ax, ay] = await scr(218, 166); let [bx, by] = await scr(222, 170);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 }); await page.mouse.up();
  await hover(230, 164);
  await wait(200);
  await shot('36-blueprint-paste-preview');
  await page.keyboard.press('KeyQ');

  // 12. Pollution and night.
  await view(212, 180, 0.5);
  await page.keyboard.press('KeyF');
  await wait(400);
  await shot('37-pollution-overlay');
  await page.keyboard.press('KeyF');
  await ev(() => { const g = FG.app.game; for (let i = 0; i < 16000 && g.daylight() > 0.02; i++) g.step(); });
  await view(214, 172, 0.9);
  await wait(600);
  await shot('38-factory-at-night');

  // 13. Menus.
  await page.keyboard.press('Escape');
  await wait(300);
  await shot('39-pause-menu');
  await page.click('.window .btn:has-text("Save game")');
  await wait(300);
  await shot('40-save-slots');
  await close();
  await page.keyboard.press('KeyH');
  await wait(300);
  await shot('41-controls-help');
  await close();
  await page.keyboard.press('Escape');
  await wait(200);
  const entsBefore = await ev(() => FG.app.game.ents.size);
  await page.click('.window .btn:has-text("Quit to title")');
  let hasContinue = false;
  for (let k = 0; k < 30 && !hasContinue; k++) { await wait(100); hasContinue = !!(await page.$('#title-menu .btn:has-text("Continue")')); }
  check('quitting autosaves and the title offers Continue', hasContinue);
  await shot('42-title-with-continue');
  await page.click('#title-menu .btn:has-text("New game")');
  await wait(300);
  await shot('43-new-game-dialog');
  await page.click('.window .btn:has-text("Cancel")');
  await wait(200);
  await page.click('#title-menu .btn:has-text("Continue")');
  await wait(1200);
  const resumed = await ev(() => FG.app.game && !FG.app.titleShown && FG.app.game.ents.size);
  check('Continue brings the demo base back', resumed === entsBefore, resumed + ' vs ' + entsBefore + ' buildings');

  console.log(shots + ' screenshots');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
