// Keyboard focus when the game is embedded in another page (as the artifact is): Tab must not
// send focus out of the game, clicking the world must win it back, and a focused HUD button
// must not swallow Space / Enter. Usage: node tests/focus.cjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  // A host page on another origin with its own button and text box, like a chat page around the game.
  await page.setContent('<body style="margin:0;background:#222"><div style="height:44px;padding:8px;color:#ccc;font:14px sans-serif">Host page <button id="hostbtn">Share</button> <input id="hostinput" placeholder="Reply..."></div>' +
    '<iframe id="game" src="' + url + '" style="width:1400px;height:830px;border:0"></iframe></body>');
  await page.waitForTimeout(1800);
  const frame = page.frames().find((f) => f.url().startsWith(url.split('/index')[0]));
  frame.page().on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await frame.click('#title-menu .btn:has-text("New game")');
  await frame.selectOption('#ng-enemies', 'off');
  await frame.click('.window .btn.primary:has-text("Start")');
  await page.waitForTimeout(700);
  const walk = async () => {
    const a = await frame.evaluate(() => [FG.app.game.player.x, FG.app.game.player.y]);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(350); await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyA'); await page.waitForTimeout(350); await page.keyboard.up('KeyA');
    const b = await frame.evaluate(() => [FG.app.game.player.x, FG.app.game.player.y]);
    return Math.abs(b[0] - a[0]) > 0.01 || (await frame.evaluate(() => FG.app.game.player.walk)) > 0 ? 'walks' : 'stuck';
  };
  const walkDist = async () => {
    const a = await frame.evaluate(() => FG.app.game.player.x);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
    return (await frame.evaluate(() => FG.app.game.player.x)) - a;
  };
  const hint = () => frame.evaluate(() => !document.getElementById('focus-hint').hidden);
  const world = async () => { await page.mouse.click(700, 520); await page.waitForTimeout(120); };

  await world();
  check('after clicking the world, D walks', (await walkDist()) > 1);
  for (let k = 1; k <= 4; k++) await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  const inGame = await frame.evaluate(() => document.hasFocus());
  const d1 = await walkDist();
  check('pressing Tab four times keeps the keyboard in the game', inGame && d1 > 1, 'focused ' + inGame + ', walked ' + d1.toFixed(2));
  // The host page grabs focus (e.g. you click its text box): the game says so, then a click on
  // the world brings the keyboard back.
  await page.click('#hostinput');
  await page.waitForTimeout(150);
  check('the banner appears when the host page has the keyboard', await hint());
  await page.screenshot({ path: out + '/70-keyboard-paused-banner.png' });
  await world();
  const d2 = await walkDist();
  check('clicking the world takes the keyboard back', d2 > 1 && !(await hint()), 'walked ' + d2.toFixed(2));
  // Space and Enter while a HUD button has focus go to the game, not the button.
  const obj0 = await frame.evaluate(() => FG.app.game.objectives.idx);
  await frame.focus('#hud .skip');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const obj1 = await frame.evaluate(() => FG.app.game.objectives.idx);
  check('Space and Enter do not press a focused Skip button', obj1 === obj0, obj0 + ' -> ' + obj1);
  const d3 = await walkDist();
  check('and walking still works afterwards', d3 > 1, 'walked ' + d3.toFixed(2));
  void walk;
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
