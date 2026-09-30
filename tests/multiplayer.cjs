// Multiplayer in real pages: three players in one browser, finding each other through a
// stand-in for claude.ai's shared room (tests/fake-room.js). Ada hosts the Demo factory, Bea
// joins over a direct WebRTC connection, Cy (whose browser has no WebRTC) joins through the
// room relay. Usage: node tests/multiplayer.cjs [url] [outdir]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-room.js') });
  const errors = [];
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  const newPage = async (tag, noRtc) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
    if (noRtc) await p.addInitScript(() => { window.RTCPeerConnection = undefined; });
    await p.goto(url);
    await p.waitForTimeout(900);
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: out + '/' + name + '.png' });
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 30000, polling: 100 }).then(() => true, () => false);
  const openMp = async (p, name) => {
    await p.click('#title-multiplayer');
    await p.waitForSelector('#win-multiplayer');
    await p.fill('#mp-name', name);
    await p.press('#mp-name', 'Tab');
  };
  const state = (p) => p.evaluate(() => {
    const a = FG.app, g = a.game, n = a.net;
    return g && { role: n && n.role, ready: n && (n.role === 'host' || n.ready), tick: g.tick, players: g.players.map((q) => [q.id, q.name, +q.x.toFixed(2), +q.y.toFixed(2)]), local: g.local.id, link: a.mp.linkKind, desyncs: n && n.desyncs, syncs: n && n.syncs };
  });
  // Hashes both sides computed for the same ticks must match.
  const sameWorld = async (p, q) => {
    const a = await p.evaluate(() => Array.from(FG.app.net.hashLog)), b = await q.evaluate(() => Array.from(FG.app.net.hashLog));
    const mb = new Map(b);
    const common = a.filter(([t]) => mb.has(t));
    const bad = common.filter(([t, h]) => mb.get(t) !== h);
    return { n: common.length, bad: bad.length, last: common.length ? common[common.length - 1][0] : null };
  };

  // 1. Ada hosts the Demo factory from the title screen.
  const A = await newPage('Ada');
  await openMp(A, 'Ada');
  await A.selectOption('#mp-src', 'demo');
  await A.waitForTimeout(300);
  await shot(A, 'mp-01-multiplayer-window');
  await A.click('#mp-host');
  const hosting = await until(A, () => FG.app.net && FG.app.net.role === 'host' && FG.app.mp.handle, null, 20000);
  check('Ada hosts the Demo factory and it is advertised in the room', hosting);
  await A.waitForTimeout(500);
  await shot(A, 'mp-02-hosting');

  // 2. Bea sees it listed and joins (direct connection).
  const B = await newPage('Bea');
  await openMp(B, 'Bea');
  const listed = await until(B, () => document.querySelectorAll('#win-multiplayer .mp-game').length > 0, null, 15000);
  const rowText = listed ? await B.textContent('#win-multiplayer .mp-game') : '';
  check('Bea sees Ada’s world in the list', listed && /Ada/.test(rowText) && /1\/8/.test(rowText), rowText);
  await shot(B, 'mp-03-bea-sees-the-world');
  await B.click('#win-multiplayer .mp-game button');
  const joined = await until(B, () => FG.app.net && FG.app.net.ready && !FG.app.titleShown, null, 40000);
  let sb = await state(B), sa = await state(A);
  check('Bea joins and gets the world', joined && sb.players.length === 2 && sa.players.length === 2 && sb.local !== sa.local, JSON.stringify([sa && sa.players, sb && sb.players]));
  check('Bea is connected directly (WebRTC)', sb && sb.link === 'direct', 'link ' + (sb && sb.link));

  // 3. Bea walks east; Ada sees her move.
  const beaId = sb.local;
  const posOn = (p, id) => p.evaluate((id) => { const q = FG.app.game.playerById(id); return q ? [q.x, q.y] : null; }, id);
  const b0 = await posOn(A, beaId);
  await B.bringToFront();
  await B.keyboard.down('KeyD'); await B.waitForTimeout(900); await B.keyboard.up('KeyD');
  await B.waitForTimeout(500);
  const b1 = await posOn(A, beaId), bb = await posOn(B, beaId);
  check('Ada sees Bea walk east', b1 && b0 && b1[0] > b0[0] + 1, JSON.stringify([b0, b1]));
  check('Bea is in the same place on both screens', b1 && bb && Math.abs(b1[0] - bb[0]) < 1.5 && Math.abs(b1[1] - bb[1]) < 0.5, JSON.stringify([b1, bb]));

  // 4. Bea places her stone furnace with a real click; it appears for Ada.
  const spot = await B.evaluate(() => {
    const g = FG.app.game, p = g.local;
    for (let r = 2; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = 2; dx <= r; dx++) {
      const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
      if (FG.canPlace(g, 'stone_furnace', x, y, 0).ok) return [x, y];
    }
    return null;
  });
  await B.evaluate(() => FG.app.setCursor('stone_furnace'));
  const [sx, sy] = await B.evaluate(([x, y]) => FG.app.renderer.toScreen(x + 1, y + 1), spot);
  await B.mouse.move(sx, sy); await B.waitForTimeout(150);
  await B.mouse.down(); await B.mouse.up();
  const built = await until(A, ([x, y]) => { const e = FG.entAt(FG.app.game, x, y); return e && e.p === 'stone_furnace'; }, spot, 5000);
  check('Bea’s furnace appears in Ada’s world', built, JSON.stringify(spot));

  // 5. Chat.
  await B.keyboard.press('Backquote');
  await B.waitForSelector('#chat-input:not([hidden])');
  await B.keyboard.type('hello from Bea');
  await B.keyboard.press('Enter');
  const heard = await until(A, () => /hello from Bea/.test((document.getElementById('chat-log') || {}).textContent || ''), null, 5000);
  check('Ada reads Bea’s chat line', heard);

  // Views from both sides.
  await A.bringToFront();
  await A.waitForTimeout(1200);
  await shot(A, 'mp-04-ada-sees-bea');
  await B.bringToFront();
  await B.waitForTimeout(600);
  await shot(B, 'mp-05-bea-in-adas-world');

  // 6. Cy has no WebRTC: he joins through the room relay.
  const C = await newPage('Cy', true);
  await openMp(C, 'Cy');
  await until(C, () => document.querySelectorAll('#win-multiplayer .mp-game').length > 0, null, 15000);
  await C.click('#win-multiplayer .mp-game button');
  const cJoined = await until(C, () => FG.app.net && FG.app.net.ready && !FG.app.titleShown, null, 60000);
  const sc = await state(C);
  check('Cy joins through the relay', cJoined && sc && sc.link === 'relay' && sc.players.length === 3, JSON.stringify(sc && [sc.link, sc.players.length]));
  await C.bringToFront();
  await C.keyboard.down('KeyS'); await C.waitForTimeout(700); await C.keyboard.up('KeyS');
  await C.waitForTimeout(6000);
  await shot(C, 'mp-06-cy-over-the-relay');
  await A.bringToFront();
  await A.click('#hud-players').catch(() => {});
  await A.waitForTimeout(400);
  await shot(A, 'mp-07-host-players-window');
  await A.keyboard.press('Escape');

  // 7. Everyone's world is the same: compare the fingerprints taken on the same ticks.
  await A.waitForTimeout(4500);
  const ab = await sameWorld(A, B), ac = await sameWorld(A, C);
  sa = await state(A); sb = await state(B);
  const scc = await state(C);
  check('Ada’s and Bea’s worlds match tick for tick', ab.n >= 3 && ab.bad === 0 && !sb.desyncs, JSON.stringify(ab) + ' desyncs ' + sb.desyncs);
  check('Ada’s and Cy’s worlds match over the relay', ac.n >= 1 && ac.bad === 0 && !scc.desyncs, JSON.stringify(ac) + ' desyncs ' + scc.desyncs);
  const lagC = sa.tick - scc.tick;
  check('the relay keeps up (Cy within a second of the host)', lagC < 60, 'host ' + sa.tick + ' Cy ' + scc.tick);

  // 8. Cy leaves; Ada and Bea see it.
  await C.evaluate(() => FG.app.ui.open('multiplayer'));
  await C.click('#mp-stop');
  const left = await until(A, () => FG.app.game.players.length === 2, null, 10000);
  const leftB = await until(B, () => FG.app.game.players.length === 2, null, 10000);
  check('Cy leaves and is gone for both', left && leftB);

  // 9. Ada stops hosting: Bea keeps a single-player copy.
  await A.evaluate(() => FG.app.mp.stop());
  const bSolo = await until(B, () => !FG.app.net && FG.app.game && FG.app.game.players.length === 1 && !FG.app.titleShown, null, 10000);
  check('when the host stops, Bea keeps playing her own copy', bSolo);
  await B.bringToFront();
  await B.waitForTimeout(400);
  await shot(B, 'mp-08-host-left');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
