// Account saves in real pages: Alice turns them on, plays and autosaves on one computer, then
// opens the game on another computer and continues from her account. Also checks the visit
// with no account (signed out) and view-only access. The claude.ai store is faked by
// tests/fake-db.js behind tests/fake-account.js. Usage: node tests/account.cjs [url] [outdir]
const { chromium } = require('playwright');
const path = require('path');
const { createBackend } = require('./fake-db');
(async () => {
  const url = process.argv[2] || 'http://localhost:8123/index.html';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const backend = createBackend();
  const errors = [];
  let fails = 0;
  const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
  const shot = (p, name) => p.screenshot({ path: out + '/' + name + '.png' });
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 15000, polling: 100 }).then(() => true, () => false);

  // One account's permissions are shared by every computer it signs in on.
  const alice = { uid: 'u_alice', name: 'Alice', perms: { db: 'prompt', user: 'prompt' }, answer: 'granted', dialogs: 0 };
  // A computer: its own browser storage, signed in as `acct` (or signed out: null).
  async function computer(tag, acct, opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.exposeFunction('__acct', async (op, a) => {
      try {
        if (op === 'available') return { result: { db: opts.noDb ? false : true, user: true } };
        if (op === 'state') {
          const m = opts.noDb ? {} : Object.assign({}, acct ? acct.perms : { db: 'granted', user: 'granted' });
          return { result: a.name ? m[a.name] || 'unavailable' : m };
        }
        if (op === 'request') {
          const m = {};
          const p = acct ? acct.perms : { db: 'granted', user: 'granted' };
          if (acct && a.names.some((n) => p[n] === 'prompt')) acct.dialogs++;
          for (const n of a.names) { if (opts.noDb && n === 'db') continue; if (p[n] === 'prompt') p[n] = acct.answer; m[n] = p[n]; }
          return { result: m };
        }
        if (op === 'me') return { result: { id: acct ? acct.uid : null, name: acct ? acct.name : '', avatarUrl: '', color: '#888', email: null, isOwner: false, canEdit: false } };
        if (op === 'db') return { result: backend.call(acct ? acct.uid : null, a.op, a.path, a.body) };
      } catch (e) { return { error: { code: e.code || 'invalid_argument', message: e.message } }; }
      return { error: { code: 'invalid_argument', message: 'unknown op ' + op } };
    });
    await ctx.addInitScript({ path: path.join(__dirname, 'fake-account.js') });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
    await p.goto(url);
    await p.waitForTimeout(900);
    return p;
  }
  const state = (p) => p.evaluate(() => FG.cloud.state);

  // ---- Computer one: off until Alice turns it on.
  const A = await computer('one', alice);
  check('off by default, with no dialog and no store calls', (await state(A)) === 'off' && alice.dialogs === 0 && backend.calls === 0);
  const line = await A.textContent('#title-account');
  check('the title screen offers account saves without requiring them', /Save to your claude\.ai account/.test(line) && /Optional/.test(line), line);
  await shot(A, 'acct-01-title-offer');

  await A.evaluate(() => FG.app.newGame({ seed: 4242, enemies: 'off', size: 384 }));
  await A.waitForTimeout(400);
  check('playing without an account works', (await A.evaluate(() => !!FG.app.game && FG.app.game.tick > 0)) && backend.calls === 0);

  // Pause menu → Account saves → Turn on.
  await A.keyboard.press('Escape');
  await A.waitForTimeout(200);
  await A.click('#win-menu button:has-text("Account saves: off")');
  await shot(A, 'acct-02-window-off');
  await A.click('#acct-on');
  const on = await until(A, () => FG.cloud.state === 'on');
  check('turning it on asks once and connects', on && alice.dialogs === 1, 'dialogs ' + alice.dialogs);
  const turnedOnSaved = await until(A, () => document.querySelector('#win-account .acct-last') && /Last saved to your account/.test(document.querySelector('#win-account .acct-last').textContent));
  check('the current game goes to the account straight away', turnedOnSaved && backend.docs.has('data/users/u_alice/save-auto'));
  await A.waitForTimeout(400);
  await shot(A, 'acct-03-window-on');
  await A.click('#win-account button:has-text("Back")');
  await A.keyboard.press('Escape');
  await A.waitForTimeout(200);

  // Play on a little, then the timed autosave.
  await A.keyboard.down('d'); await A.waitForTimeout(900); await A.keyboard.up('d');
  const before = JSON.parse(backend.docs.get('data/users/u_alice/save-auto'));
  // (Account autosaves are spaced at least a minute apart; pretend that minute has passed.)
  await A.evaluate(() => { FG.saves.lastAccountAuto = 0; const g = FG.app.game; FG.app.lastAutosave = g.tick - 2 * 60 * 60 - 1; });
  await A.evaluate(() => new Promise((r) => setTimeout(r, 2500)));
  const after = JSON.parse(backend.docs.get('data/users/u_alice/save-auto'));
  check('the timed autosave reaches the account', after.when > before.when && after.tick > before.tick, before.tick + ' -> ' + after.tick);
  const note = await A.evaluate(() => ({ text: document.getElementById('hud-saved').textContent, shown: !document.getElementById('hud-saved').hidden }));
  check('a quiet note says it autosaved', /in your account/.test(note.text), JSON.stringify(note));
  await shot(A, 'acct-04-autosaved');

  // Save to slot 1 from the Save window.
  await A.evaluate(() => FG.app.ui.open('saves', 'save'));
  await A.click('#win-saves .srow[data-slot="1"] button:has-text("Save here")');
  const slotShown = await until(A, () => /this browser and your account/i.test(document.querySelector('#win-saves .srow[data-slot="1"]').textContent));
  check('a manual save goes to both places', slotShown && backend.docs.has('data/users/u_alice/save-1'));
  await shot(A, 'acct-05-save-window');
  await A.evaluate(() => FG.app.ui.close());

  // Leaving for the title saves once more.
  const posA = await A.evaluate(() => ({ x: FG.app.game.local.x, y: FG.app.game.local.y }));
  await A.evaluate(() => FG.app.showTitle());
  await A.waitForTimeout(1500);
  const final = JSON.parse(backend.docs.get('data/users/u_alice/save-auto'));
  check('quitting to the title saves to the account', final.when >= after.when);
  await shot(A, 'acct-06-title-on');

  // ---- Computer two: same account, nothing in this browser. It connects by itself.
  const B = await computer('two', alice);
  const bOn = await until(B, () => FG.cloud.state === 'on');
  check('another computer connects without asking again', bOn && alice.dialogs === 1);
  const cont = await until(B, () => !!document.getElementById('title-continue'));
  const bLocal = await B.evaluate(() => FG.save.list().every((m) => m.empty));
  check('Continue appears from the account alone', cont && bLocal);
  await shot(B, 'acct-07-second-computer-title');
  await B.click('#title-continue');
  const loaded = await until(B, () => !!FG.app.game && !FG.app.titleShown);
  // (The world has run on for a moment by the time it is looked at.)
  const bg = await B.evaluate(() => ({ tick: FG.app.game.tick, seed: FG.app.game.opts.seed, x: FG.app.game.local.x, y: FG.app.game.local.y }));
  check('it continues the same world where Alice left it', loaded && bg.seed === 4242 && bg.tick >= final.tick && bg.tick - final.tick < 60 && Math.abs(bg.x - posA.x) < 0.01 && Math.abs(bg.y - posA.y) < 0.01, JSON.stringify(bg) + ' vs ' + JSON.stringify(posA) + ' saved at tick ' + final.tick);
  await B.waitForTimeout(500);
  await shot(B, 'acct-08-continued');
  await B.evaluate(() => FG.app.ui.open('saves', 'load'));
  const loadRows = await until(B, () => /In your account/.test(document.querySelector('#win-saves .srow[data-slot="1"]').textContent));
  check('the Load window lists the account saves', loadRows);
  await shot(B, 'acct-09-load-window');

  // ---- Signed out (or a public link): browser saves only, explained.
  const C = await computer('signed-out', null, { noDb: true });
  check('a visit without an account says what is possible', (await state(C)) === 'unavailable');
  await C.click('#title-account-btn');
  const cText = await C.textContent('#win-account');
  check('...and keeps browser saves and codes', /signed in/.test(cText) && /save codes/.test(cText), cText.slice(0, 120));
  await shot(C, 'acct-10-unavailable');

  // ---- View-only access: can't write, says so.
  const viewer = { uid: 'u_vic', name: 'Vic', perms: { db: 'prompt', user: 'prompt' }, answer: 'granted', dialogs: 0 };
  backend.readonly.add('u_vic');
  const V = await computer('view-only', viewer);
  await V.click('#title-account-btn');
  await V.click('#acct-on');
  const ro = await until(V, () => FG.cloud.state === 'readonly');
  check('view-only access is explained', ro && /view-only/.test(await V.textContent('#win-account')));
  await shot(V, 'acct-11-view-only');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? fails + ' checks failed' : 'all checks passed');
  await browser.close();
})();
