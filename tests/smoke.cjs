// Browser smoke test: loads the game, starts a new game, plays a few actions, reports errors.
// Usage: node tests/smoke.mjs [url] [outdir]
const { chromium } = require('playwright');
(async () => {
const url = process.argv[2] || 'http://localhost:8123/index.html';
const out = process.argv[3] || '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url);
await page.waitForTimeout(2500);
await page.screenshot({ path: out + '/01-title.png' });
// New game via UI
await page.click('#title-menu .btn:has-text("New game")');
await page.waitForTimeout(300);
await page.screenshot({ path: out + '/02-newgame.png' });
await page.fill('#ng-seed', '12345');
await page.click('.window .btn.primary:has-text("Start")');
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '/03-ingame.png' });
// Walk a bit
await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD');
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
await page.screenshot({ path: out + '/04-inventory.png' });
await page.keyboard.press('KeyE');
await page.keyboard.press('KeyT');
await page.waitForTimeout(400);
await page.screenshot({ path: out + '/05-tech.png' });
await page.keyboard.press('KeyT');
await page.keyboard.press('KeyH');
await page.waitForTimeout(300);
await page.screenshot({ path: out + '/06-help.png' });
await page.keyboard.press('Escape');
const state = await page.evaluate(() => ({ tick: FG.app.game.tick, ents: FG.app.game.ents.size, px: FG.app.game.player.x }));
console.log('state', JSON.stringify(state));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
})();
