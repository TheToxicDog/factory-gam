// Multiplayer in real browsers: two players (separate browser profiles) host, list, join,
// see each other, build, chat, and a password-protected world. Saves screenshots.
// Usage: node tests/mp-browser.cjs [url] [outdir]   (url of a running server/server.js)
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8124/';
  const out = process.argv[3] || '.';
  // A remote server is reached through the environment's proxy, if it has one.
  const proxy = !/localhost|127\.0\.0\.1/.test(url) && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: proxy ? { server: proxy } : undefined, args: ['--ignore-certificate-errors'] });
  const errors = [];
  const check = (name, cond, info) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (info !== undefined ? '  ' + info : '')); if (!cond) errors.push(name); };
  async function player(name) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await page.goto(url);
    await page.waitForTimeout(1200);
    return page;
  }
  const shot = (page, n) => page.screenshot({ path: out + '/' + n + '.png' });
  const state = (page) => page.evaluate(() => { const a = FG.app, g = a.game; return g ? { tick: g.tick, pid: g.localPid, players: Array.from(g.players.values()).map((p) => [p.id, p.name, p.away, +p.x.toFixed(1), +p.y.toFixed(1)]), furnaces: (g.byKind.furnace || []).length, resyncs: a.net.resyncs || 0, stalled: a.net.ls.stalled, lag: a.net.ls.lag } : null; });

  const A = await player('A');
  await shot(A, 'mp-01-title');
  await A.click('#title-menu .btn:has-text("Multiplayer")');
  await A.waitForTimeout(700);
  await A.fill('#mp-name', 'Ada');
  await A.press('#mp-name', 'Tab');
  await A.click('.swatch >> nth=0');
  await A.waitForTimeout(300);
  await shot(A, 'mp-02-lobbies-empty');
  await A.click('.window .btn.primary:has-text("Host a world")');
  await A.waitForTimeout(300);
  await A.fill('#mh-name', 'Ada\'s Foundry');
  await A.selectOption('#mh-size', '384');
  await shot(A, 'mp-03-host');
  await A.click('.window .btn.primary:has-text("Host world")');
  await A.waitForFunction(() => FG.app.mp && FG.app.game, null, { timeout: 20000 });
  await A.waitForTimeout(1500);
  let sa = await state(A);
  check('host is in their world', sa && sa.pid === 1, JSON.stringify(sa));

  const B = await player('B');
  await B.click('#title-menu .btn:has-text("Multiplayer")');
  await B.waitForTimeout(400);
  await B.fill('#mp-name', 'Bo');
  await B.press('#mp-name', 'Tab');
  await B.click('.swatch >> nth=1');
  await B.waitForSelector('.mp-row', { timeout: 8000 });
  await B.waitForTimeout(300);
  await shot(B, 'mp-04-lobby-list');
  check('lobby appears in the other player\'s list', await B.locator('.mp-row:has-text("Ada\'s Foundry")').count() === 1);
  await B.click('.mp-row:has-text("Ada\'s Foundry") .btn');
  await B.waitForFunction(() => FG.app.mp && FG.app.game, null, { timeout: 20000 });
  await B.waitForTimeout(1500);
  let sb = await state(B);
  check('second player joins as player 2', sb && sb.pid === 2 && sb.players.length === 2, JSON.stringify(sb));

  // B walks right-down toward... A stays at spawn; B walks a little so they don't overlap.
  await B.keyboard.down('KeyD'); await B.waitForTimeout(500); await B.keyboard.up('KeyD');
  await B.waitForTimeout(800);
  sa = await state(A); sb = await state(B);
  const bOnA = sa.players.find((p) => p[0] === 2), bOnB = sb.players.find((p) => p[0] === 2);
  check('host sees the other player move', bOnA && bOnA[3] > 192.5 + 1.5, JSON.stringify(bOnA) + ' vs own ' + JSON.stringify(bOnB));
  await shot(A, 'mp-05-two-players');

  // A places a stone furnace with the real mouse (hotbar slot holding it).
  const slot = await A.evaluate(() => FG.app.hotbar.indexOf('stone_furnace'));
  await A.keyboard.press('Digit' + ((slot + 1) % 10));
  const [fx, fy] = await A.evaluate(() => { const p = FG.app.game.player; return FG.app.renderer.toScreen(p.x - 3, p.y + 3); });
  await A.mouse.move(fx, fy);
  await A.waitForTimeout(100);
  await A.mouse.down(); await A.mouse.up();
  await A.keyboard.press('KeyQ');
  await A.waitForTimeout(1200);
  sa = await state(A); sb = await state(B);
  check('building by the host appears for both', sa.furnaces === 1 && sb.furnaces === 1, sa.furnaces + ' / ' + sb.furnaces);

  // Chat.
  await A.keyboard.press('Slash');
  await A.waitForTimeout(150);
  await A.keyboard.type('welcome to the foundry!');
  await A.keyboard.press('Enter');
  await B.waitForTimeout(800);
  const chatB = await B.evaluate(() => FG.app.net.chat.map((m) => m.name + ': ' + m.text));
  check('chat reaches the other player', chatB.some((t) => t === 'Ada: welcome to the foundry!'), JSON.stringify(chatB));
  await B.waitForTimeout(600);
  await shot(B, 'mp-06-joined-chat');

  // Esc menu in a shared world.
  await A.keyboard.press('Escape');
  await A.waitForTimeout(300);
  await shot(A, 'mp-07-menu');
  await A.keyboard.press('Escape');

  // A password-protected world, hosted by a third player.
  const C = await player('C');
  await C.click('#title-menu .btn:has-text("Multiplayer")');
  await C.waitForTimeout(300);
  await C.fill('#mp-name', 'Cy');
  await C.press('#mp-name', 'Tab');
  await C.click('.window .btn.primary:has-text("Host a world")');
  await C.fill('#mh-name', 'Private works');
  await C.click('.seg button:has-text("Password")');
  await C.fill('#mh-pass', 'gears');
  await C.selectOption('#mh-size', '384');
  await shot(C, 'mp-08-host-password');
  await C.click('.window .btn.primary:has-text("Host world")');
  await C.waitForFunction(() => FG.app.mp && FG.app.game, null, { timeout: 20000 });

  const D = await player('D');
  await D.click('#title-menu .btn:has-text("Multiplayer")');
  await D.fill('#mp-name', 'Dee');
  await D.press('#mp-name', 'Tab');
  await D.waitForSelector('.mp-row:has-text("Private works")', { timeout: 8000 });
  await D.waitForTimeout(300);
  await shot(D, 'mp-09-lobby-list-both');
  await D.click('.mp-row:has-text("Private works") .btn');
  await D.waitForTimeout(300);
  await D.fill('#mj-pass', 'nope');
  await D.click('.window .btn.primary:has-text("Join")');
  await D.waitForTimeout(800);
  await shot(D, 'mp-10-wrong-password');
  const err = await D.textContent('#win-mpjoin');
  check('wrong password is shown', /Wrong password/.test(err));
  await D.fill('#mj-pass', 'gears');
  await D.click('.window .btn.primary:has-text("Join")');
  await D.waitForFunction(() => FG.app.mp && FG.app.game, null, { timeout: 20000 });
  check('right password joins', (await state(D)).players.length === 2);

  // Everyone stays in sync.
  await A.waitForTimeout(4000);
  for (const [n, p] of [['A', A], ['B', B], ['C', C], ['D', D]]) {
    const s = await state(p);
    check(n + ' stays in sync', s.resyncs === 0 && !s.stalled && s.lag < 30, 'resyncs ' + s.resyncs + ' lag ' + s.lag);
  }
  // Same world state: stop both copies, run each to the same tick, compare checksums.
  await A.evaluate(() => { FG.app.net.hold = true; });
  await B.evaluate(() => { FG.app.net.hold = true; });
  await A.waitForTimeout(500);
  const upTo = Math.min(await A.evaluate(() => FG.app.net.ls.u), await B.evaluate(() => FG.app.net.ls.u)) - 1;
  const hashAt = (p) => p.evaluate((t) => { const ls = FG.app.net.ls; ls.advance(t - ls.g.tick); return ls.g.tick === t ? FG.stateHash(ls.g) : 'stuck at ' + ls.g.tick; }, upTo);
  const [ha, hb] = [await hashAt(A), await hashAt(B)];
  check('both browsers hold the identical world', ha === hb && typeof ha === 'number', 'tick ' + upTo + ': ' + ha + ' / ' + hb);
  await A.evaluate(() => { FG.app.net.hold = false; });
  await B.evaluate(() => { FG.app.net.hold = false; });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
