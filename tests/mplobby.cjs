// Multiplayer where the room refuses named rooms and the joiner has no WebRTC: the handshake
// and the relay both run in the shared lobby. Usage: node tests/mplobby.cjs [url]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.__noNamedRooms = true; });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-room.js') });
  const errors = [];
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  const until = (p, fn, ms) => p.waitForFunction(fn, null, { timeout: ms || 30000, polling: 100 }).then(() => true, () => false);
  const page = async (tag, noRtc) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    if (noRtc) await p.addInitScript(() => { window.RTCPeerConnection = undefined; });
    await p.goto(url);
    await p.waitForTimeout(900);
    return p;
  };
  const A = await page('host');
  await A.click('#title-multiplayer');
  await A.fill('#mp-name', 'Lo'); await A.press('#mp-name', 'Tab');
  await A.selectOption('#mp-src', 'new');
  await A.selectOption('#mp-enemies', 'off');
  await A.click('#mp-host');
  check('hosts with named rooms refused', await until(A, () => FG.app.net && FG.app.mp.handle, 20000));
  const B = await page('guest', true);
  await B.click('#title-multiplayer');
  await B.fill('#mp-name', 'Bee'); await B.press('#mp-name', 'Tab');
  await until(B, () => document.querySelectorAll('#win-multiplayer .mp-game').length > 0, 15000);
  await B.click('#win-multiplayer .mp-game button');
  const ok = await until(B, () => FG.app.net && FG.app.net.ready && !FG.app.titleShown, 60000);
  const kind = await B.evaluate(() => FG.app.mp.linkKind);
  check('joins through the lobby relay', ok && kind === 'relay', 'link ' + kind);
  await B.keyboard.down('KeyD'); await B.waitForTimeout(600); await B.keyboard.up('KeyD');
  await B.waitForTimeout(5000);
  const a = await A.evaluate(() => Array.from(FG.app.net.hashLog)), b = new Map(await B.evaluate(() => Array.from(FG.app.net.hashLog)));
  const common = a.filter(([t]) => b.has(t));
  check('worlds match', common.length >= 1 && common.every(([t, h]) => b.get(t) === h), common.length + ' checks');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
