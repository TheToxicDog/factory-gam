// Item handling with real keys and clicks: Z puts one held item into machines, belts and
// chests; the inventory splits stacks. Usage: node tests/handling.cjs [url] [outdir]
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
    const X = w.spawnX - 6, Y = w.spawnY - 4;
    for (let y = Y - 6; y < Y + 12; y++) for (let x = X - 6; x < X + 20; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
    for (let c = 0; c < w.chunkVersion.length; c++) w.chunkVersion[c]++;
    const P = (p, x, y, d) => FG.placeEntity(g, p, x, y, d || 0);
    for (let k = 0; k < 3; k++) P('stone_furnace', X + k * 3, Y);
    P('iron_chest', X + 10, Y);
    for (let y = Y - 2; y <= Y + 6; y++) P('belt', X + 13, y, 0);
    const inv = g.player.inv;
    inv.slots.fill(null);
    for (const [id, n] of [['coal', 47], ['iron_ore', 30], ['iron_gear', 10], ['iron_plate', 100], ['copper_plate', 20]]) inv.add(id, n);
    FG.emit('inventory');
    g.player.x = X + 6.5; g.player.y = Y + 4.5;
    const c = FG.app.renderer.cam; c.x = X + 6.5; c.y = Y + 2; c.zoom = 1.6;
    return [X, Y];
  });
  await wait(300);
  const scr = (x, y) => ev(([x, y]) => FG.app.renderer.toScreen(x, y), [x, y]);
  const hover = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.move(sx, sy); await wait(80); };
  const fuelOf = () => ev(([X, Y]) => [0, 1, 2].map((k) => { const f = FG.entAt(FG.app.game, X + k * 3, Y); return f.fuel ? f.fuel.n : 0; }), [X, Y]);
  const count = (id) => ev((id) => FG.app.game.player.inv.count(id), id);
  const lastToast = () => ev(() => { const t = document.querySelectorAll('#toasts .toast'); return t.length ? t[t.length - 1].textContent : ''; });

  // 1. Z puts one coal into a furnace.
  await ev(() => FG.app.setCursor('coal'));
  await hover(X + 1, Y + 1);
  await page.keyboard.press('KeyZ');
  await wait(120);
  check('Z puts one coal into the furnace', JSON.stringify(await fuelOf()) === '[1,0,0]' && (await count('coal')) === 46, JSON.stringify([await fuelOf(), await count('coal')]));
  await page.screenshot({ path: out + '/50-z-one-into-furnace.png' });
  // 2. Holding Z and sweeping puts one into each furnace passed over.
  await page.keyboard.down('KeyZ');
  for (let k = 0; k < 3; k++) { await hover(X + k * 3 + 1, Y + 1); await wait(60); }
  await wait(100);
  await page.screenshot({ path: out + '/51-z-sweep.png' });
  await hover(X + 7, Y + 1); // back over the last one: still only one each per press
  await wait(80);
  await page.keyboard.up('KeyZ');
  check('holding Z and sweeping adds one to each furnace', JSON.stringify(await fuelOf()) === '[2,1,1]' && (await count('coal')) === 43, JSON.stringify([await fuelOf(), await count('coal')]));
  // 3. Z over a belt drops one on the lane under the cursor.
  await ev(() => FG.app.setCursor('iron_ore'));
  await hover(X + 13.25, Y + 4.5); // west half of a north-going belt
  await page.keyboard.press('KeyZ');
  await hover(X + 13.75, Y + 2.5); // east half, another tile
  await page.keyboard.press('KeyZ');
  await wait(60);
  const lanes = await ev(([X, Y]) => { const g = FG.app.game; let l0 = 0, l1 = 0; for (let y = Y - 2; y <= Y + 6; y++) { const n = FG.belts.nodeAt(g, X + 13, y); l0 += n.lanes[0].ids.length; l1 += n.lanes[1].ids.length; } return [l0, l1]; }, [X, Y]);
  check('Z drops one ore on each belt lane it points at', lanes[0] === 1 && lanes[1] === 1, JSON.stringify(lanes));
  await wait(400);
  await page.screenshot({ path: out + '/52-z-onto-belt.png' });
  // 4. Chest, and a machine that won't take the item.
  await hover(X + 10.5, Y + 0.5);
  await page.keyboard.press('KeyZ');
  check('Z puts one into a chest', await ev(([X, Y]) => FG.entAt(FG.app.game, X + 10, Y).inv.count('iron_ore'), [X, Y]) === 1);
  await ev(() => FG.app.setCursor('iron_gear'));
  await hover(X + 4, Y + 1);
  await page.keyboard.press('KeyZ');
  await wait(100);
  check('a furnace refuses gears with a message', (await count('iron_gear')) === 10 && /can't take/.test(await lastToast()), await lastToast());
  await ev(() => { FG.app.cursor = null; });
  await wait(1000);
  await page.keyboard.press('KeyZ');
  await wait(100);
  check('Z with an empty hand explains itself', /Hold an item/.test(await lastToast()), await lastToast());

  // 5. Stack splitting in the inventory.
  await page.keyboard.press('KeyE');
  await wait(300);
  const slots = () => ev(() => FG.app.game.player.inv.slots.map((s) => (s ? s.id + ':' + s.n : '')));
  const slotSel = (i) => '#win-inventory .grid .slot:nth-child(' + (i + 1) + ')';
  let s0 = await slots();
  const coalAt = s0.findIndex((s) => s.startsWith('coal:'));
  const firstEmpty = () => slots().then((s) => s.indexOf(''));
  await page.click(slotSel(coalAt), { button: 'right' });
  await wait(100);
  const e1 = await firstEmpty();
  const [ex, ey] = await ev((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, slotSel(e1));
  await page.mouse.move(ex + 8, ey + 6);
  await wait(150);
  await page.screenshot({ path: out + '/53-split-stack-in-hand.png' });
  const held = await ev(() => FG.app.ui.held && FG.app.ui.held.n);
  check('right-click picks up half a stack', held === 22, 'holding ' + held + ' of 43 coal');
  await page.click(slotSel(e1));
  await wait(100);
  let s1 = await slots();
  check('clicking an empty slot puts the half down', s1[coalAt] === 'coal:21' && s1[e1] === 'coal:22' && (await count('coal')) === 43, JSON.stringify([s1[coalAt], s1[e1]]));
  // Right-click the new stack, then right-click empty slots to put down one at a time.
  await page.click(slotSel(e1), { button: 'right' });
  const singles = [];
  for (let k = 0; k < 3; k++) { const e = (await slots()).findIndex((s, i) => s === '' && singles.indexOf(i) < 0); singles.push(e); await page.click(slotSel(e), { button: 'right' }); await wait(60); }
  await page.mouse.move(ex + 60, ey + 50);
  await wait(150);
  await page.screenshot({ path: out + '/54-split-one-at-a-time.png' });
  s1 = await slots();
  check('right-click puts down one at a time', singles.every((i) => s1[i] === 'coal:1') && s1[e1] === 'coal:19', JSON.stringify(singles.map((i) => s1[i]).concat(s1[e1])));
  await page.keyboard.press('Escape'); // put the rest back
  await wait(100);
  check('Escape puts a split stack back and keeps the window open', !(await ev(() => FG.app.ui.held)) && (await ev(() => FG.app.ui.isOpen('inventory'))) && (await count('coal')) === 43);
  // Shift+right-click takes a whole stack; dropping it on another item swaps them.
  s1 = await slots();
  const plateAt = s1.findIndex((s) => s.startsWith('iron_plate:')), cuAt = s1.findIndex((s) => s.startsWith('copper_plate:'));
  await page.click(slotSel(plateAt), { button: 'right', modifiers: ['Shift'] });
  await page.click(slotSel(cuAt));
  s1 = await slots();
  check('a whole stack swaps places with another item', s1[plateAt].startsWith('copper_plate:') && s1[cuAt] === 'iron_plate:100', JSON.stringify([s1[plateAt], s1[cuAt]]));
  const total = await ev(() => JSON.stringify(FG.app.game.player.inv.totals()));
  check('splitting never loses items', total === JSON.stringify({ coal: 43, iron_ore: 27, iron_gear: 10, iron_plate: 100, copper_plate: 20 }) || JSON.parse(total).coal === 43, total);
  // Left-click still takes an item in hand for building.
  await page.click(slotSel(cuAt));
  await wait(100);
  check('left-click still picks an item to hold', (await ev(() => FG.app.cursor && FG.app.cursor.item)) === 'iron_plate' && !(await ev(() => FG.app.ui.win)));
  await ev(() => { FG.app.cursor = null; });

  // 6. In a machine window, right-click moves half a stack.
  await hover(X + 10.5, Y + 0.5);
  await page.mouse.down(); await page.mouse.up();
  await wait(250);
  s1 = await slots();
  const pl = s1.findIndex((s) => s === 'iron_plate:100');
  const grids = await page.$$('#win-entity .grid');
  const mine = grids[grids.length - 1]; // the chest's own grid comes first
  const slotEls = await mine.$$('.slot');
  await slotEls[pl].click({ button: 'right' });
  await wait(150);
  const chestPlates = await ev(([X, Y]) => FG.entAt(FG.app.game, X + 10, Y).inv.count('iron_plate'), [X, Y]);
  check('right-click in a chest window moves half a stack', chestPlates === 50 && (await count('iron_plate')) === 50, chestPlates + ' in chest');
  await page.screenshot({ path: out + '/55-chest-half-stack.png' });
  await page.keyboard.press('Escape');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
