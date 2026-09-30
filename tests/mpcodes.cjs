// Multiplayer without the shared room (the page opened from a file, or by a public link): two
// players connect directly by trading a join code and an answer code.
// Usage: node tests/mpcodes.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  const page = async (tag) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
    await p.goto(url);
    await p.waitForTimeout(900);
    return p;
  };
  const until = (p, fn, ms) => p.waitForFunction(fn, null, { timeout: ms || 30000, polling: 100 }).then(() => true, () => false);

  // Host: start a game, open it to others; with no room, players come in by code.
  const A = await page('host');
  await A.evaluate(() => FG.app.newGame({ seed: 555, enemies: 'off', size: 384 }));
  await A.waitForTimeout(300);
  await A.evaluate(() => FG.app.ui.open('multiplayer'));
  await A.fill('#mp-name', 'Hal');
  await A.press('#mp-name', 'Tab');
  await A.click('#mp-host-current');
  const hosting = await until(A, () => FG.app.net && FG.app.net.role === 'host');
  check('hosting without a room', hosting && (await A.evaluate(() => !FG.app.mp.handle)));

  // Joiner: make a join code from the title screen.
  const B = await page('guest');
  await B.click('#title-multiplayer');
  await B.fill('#mp-name', 'Gus');
  await B.press('#mp-name', 'Tab');
  const noRoomText = await B.textContent('#win-multiplayer');
  check('the window explains the room is missing and offers codes', /shared room/.test(noRoomText) && /codes/.test(noRoomText));
  await B.click('#win-multiplayer .mp-codes summary');
  await B.click('#mp-make-code');
  await until(B, () => document.getElementById('mp-join-code').value.startsWith('CWJ-'), 15000);
  const joinCode = await B.inputValue('#mp-join-code');
  check('a join code is made', joinCode.startsWith('CWJ-') && joinCode.length < 3000, joinCode.length + ' characters');
  await B.screenshot({ path: out + '/mp-10-join-code.png' });

  // Host pastes it and gets an answer code.
  await A.evaluate(() => FG.app.ui.open('multiplayer'));
  await A.click('#win-multiplayer .mp-codes summary');
  await A.fill('#mp-host-join-code', joinCode);
  await A.click('#mp-make-answer');
  await until(A, () => document.getElementById('mp-host-answer').value.startsWith('CWH-'), 15000);
  const answer = await A.inputValue('#mp-host-answer');
  check('the host makes an answer code', answer.startsWith('CWH-'), answer.length + ' characters');
  await A.screenshot({ path: out + '/mp-11-answer-code.png' });

  // Joiner pastes the answer and connects.
  await B.fill('#mp-answer-code', answer);
  await B.click('#mp-use-answer');
  const joined = await until(B, () => FG.app.net && FG.app.net.ready && !FG.app.titleShown, 40000);
  const st = await B.evaluate(() => ({ players: FG.app.game.players.map((p) => p.name), link: FG.app.mp.linkKind }));
  check('the guest joins with the codes', joined && st.players.length === 2 && st.players.indexOf('Hal') >= 0 && st.players.indexOf('Gus') >= 0, JSON.stringify(st));
  await B.waitForTimeout(3000);
  const a = await A.evaluate(() => Array.from(FG.app.net.hashLog)), b = new Map(await B.evaluate(() => Array.from(FG.app.net.hashLog)));
  const common = a.filter(([t]) => b.has(t));
  check('both worlds match', common.length >= 1 && common.every(([t, h]) => b.get(t) === h), common.length + ' checks');
  await B.screenshot({ path: out + '/mp-12-joined-by-code.png' });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
