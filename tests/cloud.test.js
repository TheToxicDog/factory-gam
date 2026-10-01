// Headless tests for account saves (cloud.js) against a fake claude.ai store that keeps the
// platform's rules: private per-viewer subtrees, 256 KiB documents, view-only access.
// Usage: node tests/cloud.test.js
const { load } = require('./harness');
const { createBackend, dbFor } = require('./fake-db');

let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}
// A fake claude.ai page host: permissions, user and db for one viewer.
function fakeClaude(backend, opts) {
  const o = Object.assign({ uid: 'u_alice', name: 'Alice', db: 'prompt', user: 'prompt', answer: 'granted' }, opts);
  const asked = [];
  const perms = {
    state: async (n) => { const m = {}; if (o.db) m.db = o.db; if (o.user) m.user = o.user; return n ? m[n] || 'unavailable' : m; },
    request: async (names) => { asked.push(names); const m = {}; for (const n of names) if (o[n]) { if (o[n] === 'prompt') o[n] = o.answer; m[n] = o[n]; } return m; },
  };
  const user = { me: async () => ({ id: o.uid, name: o.uid ? o.name : '', avatarUrl: '', color: '#888', email: null, isOwner: false, canEdit: false }) };
  const used = [];
  const claude = { use: async (cap) => { used.push(cap); return cap === 'permissions' ? perms : cap === 'user' ? user : cap === 'db' ? (o.db ? dbFor(backend, o.uid) : null) : null; } };
  return { claude, asked, used, o };
}
function boot(extra) {
  const localStorage = fakeStorage();
  const FG = load(Object.assign({ localStorage }, extra || {}));
  return { FG, localStorage };
}
function world(FG, seed) {
  const g = new FG.Game({ seed: seed || 7, size: 192, enemies: 'off' });
  for (let i = 0; i < 200; i++) g.step();
  return g;
}
const docsUnder = (b, prefix) => Array.from(b.docs.keys()).filter((k) => k.startsWith(prefix));

(async () => {
  await test('a save goes to the account and comes back identical', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice', 'Alice');
    const g = world(FG);
    const text = await FG.save.pack(FG.save.serialize(g));
    const meta = await FG.cloud.storeText('1', text, g);
    assert(meta.parts >= 1 && meta.tick === g.tick, JSON.stringify(meta));
    const list = await FG.cloud.list();
    assert(!list.find((r) => r.slot === '1').empty && list.find((r) => r.slot === '2').empty, JSON.stringify(list));
    const back = await FG.cloud.loadText('1');
    assert(back === text, 'text differs');
    const g2 = FG.save.deserialize(await FG.save.unpack(back));
    assert(FG.net.hash(g2) === FG.net.hash(g), 'world differs');
    // Everything lives in the viewer's own private subtree.
    assert(Array.from(b.docs.keys()).every((k) => k.startsWith('data/users/u_alice/')), Array.from(b.docs.keys()).join(','));
  });

  await test('a big save is split into parts under the document limit, and old parts are removed', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    const big = 'raw:' + 'x'.repeat(520000);
    const m1 = await FG.cloud.storeText('2', big, g);
    assert(m1.parts === 3, 'parts ' + m1.parts);
    assert(docsUnder(b, 'data/users/u_alice/save-2.').length === 3);
    assert(Array.from(b.docs.values()).every((t) => Buffer.byteLength(t) <= 256 * 1024));
    assert((await FG.cloud.loadText('2')) === big);
    const small = 'raw:' + 'y'.repeat(1000);
    await FG.cloud.storeText('2', small, g);
    assert(docsUnder(b, 'data/users/u_alice/save-2.').length === 1, 'old generation left: ' + docsUnder(b, 'data/users/u_alice/save-2.').join(','));
    assert((await FG.cloud.loadText('2')) === small);
  });

  await test('a save cut off half way leaves the previous one loadable and no stray parts', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    const first = 'raw:' + 'a'.repeat(450000);
    await FG.cloud.storeText('auto', first, g);
    const before = docsUnder(b, 'data/users/u_alice/save-auto.').sort().join();
    b.failNext.push({ op: 'set', match: /save-auto\.[^.]+\.1$/, code: 'quota_exceeded' });
    let msg = '';
    try { await FG.cloud.storeText('auto', 'raw:' + 'b'.repeat(450000), g); } catch (e) { msg = e.message; }
    assert(/storage is full/.test(msg), 'message: ' + msg);
    assert(FG.cloud.state === 'on', 'state ' + FG.cloud.state);
    assert((await FG.cloud.loadText('auto')) === first, 'previous save lost');
    assert(docsUnder(b, 'data/users/u_alice/save-auto.').sort().join() === before, 'stray parts left');
  });

  await test('a brief outage is retried once', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    b.failNext.push({ op: 'set', match: /save-3$/, code: 'unavailable' });
    await FG.cloud.storeText('3', 'raw:{}', g);
    assert((await FG.cloud.loadText('3')) === 'raw:{}');
  });

  await test('a damaged save is refused rather than loaded', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    const m = await FG.cloud.storeText('1', 'raw:' + 'z'.repeat(300000), g);
    const p = 'data/users/u_alice/save-1.' + m.gen + '.1';
    b.docs.set(p, JSON.stringify({ d: 'zz' }));
    let msg = '';
    try { await FG.cloud.loadText('1'); } catch (e) { msg = e.message; }
    assert(/whole/.test(msg), msg);
  });

  await test('other viewers can neither read nor write your saves', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    await FG.cloud.storeText('1', 'raw:{}', g);
    const bob = dbFor(b, 'u_bob');
    assert(!(await bob.doc('data/users/u_alice/save-1').get()).exists);
    let code = '';
    try { await bob.doc('data/users/u_alice/save-1').set({ v: 9 }); } catch (e) { code = e.code; }
    assert(code === 'invalid_argument');
  });

  await test('view-only access turns account saves into read-only and says so', async () => {
    const { FG } = boot();
    const b = createBackend();
    b.readonly.add('u_alice');
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    let failed = false;
    try { await FG.cloud.storeText('1', 'raw:{}', g); } catch (e) { failed = true; }
    assert(failed && FG.cloud.state === 'readonly', FG.cloud.state);
  });

  await test('slots: saving writes both places, loading takes the newer copy, and falls back', async () => {
    const { FG, localStorage } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG, 11);
    const out = await FG.saves.store(g, '1');
    assert(out.local && out.account, JSON.stringify(out));
    let rows = await FG.saves.list();
    let r = rows.find((x) => x.slot === '1');
    assert(r.local && r.account && !r.empty, JSON.stringify(r));
    // Another computer saved later: the account copy is newer.
    for (let i = 0; i < 120; i++) g.step();
    await new Promise((res) => setTimeout(res, 5));
    await FG.cloud.storeText('1', await FG.save.pack(FG.save.serialize(g)), g);
    r = (await FG.saves.list()).find((x) => x.slot === '1');
    assert(r.from === 'account' && r.best.tick === g.tick, JSON.stringify(r));
    const g2 = await FG.saves.load('1');
    assert(g2.tick === g.tick, 'loaded tick ' + g2.tick + ' want ' + g.tick);
    // The account copy breaks: the browser copy still loads.
    const meta = JSON.parse(b.docs.get('data/users/u_alice/save-1'));
    b.docs.delete('data/users/u_alice/save-1.' + meta.gen + '.0');
    const g3 = await FG.saves.load('1');
    assert(g3.tick === out.local.tick, 'fallback tick ' + g3.tick);
    // Deleting removes both.
    await FG.saves.remove('1');
    r = (await FG.saves.list()).find((x) => x.slot === '1');
    assert(r.empty && !localStorage.getItem('cogworks-save-1') && docsUnder(b, 'data/users/u_alice/save-1').length === 0, JSON.stringify(r));
  });

  await test('slots: a full browser still saves to the account', async () => {
    const { FG, localStorage } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    const g = world(FG);
    const out = await FG.saves.store(g, '2');
    assert(!out.local && out.account && out.errors.length === 1, JSON.stringify(out));
    const g2 = await FG.saves.load('2');
    assert(g2.tick === g.tick);
  });

  await test('autosaves go to the account at most once a minute unless asked', async () => {
    const { FG } = boot();
    const b = createBackend();
    FG.cloud.attach(dbFor(b, 'u_alice'), 'u_alice');
    const g = world(FG);
    const a = await FG.saves.autosave(g);
    assert(a.local && a.account, 'first');
    const c = await FG.saves.autosave(g);
    assert(c.local && !c.account, 'second should be browser only');
    const d = await FG.saves.autosave(g, { minGap: 0 });
    assert(d.account, 'forced');
  });

  await test('without account saves, everything stays in the browser', async () => {
    const { FG } = boot();
    assert(FG.cloud.state === 'unknown');
    const g = world(FG);
    const out = await FG.saves.store(g, '1');
    assert(out.local && !out.account && !out.errors.length);
    const rows = await FG.saves.list();
    assert(rows.find((x) => x.slot === '1').from === 'browser');
  });

  // ---- turning it on, through the platform's permission and identity calls
  await test('not on claude.ai: nothing to offer', async () => {
    const { FG } = boot({ window: {} });
    assert((await FG.cloud.init()) === 'none');
  });

  await test('on claude.ai, off by default: no dialog, no store calls', async () => {
    const b = createBackend();
    const f = fakeClaude(b);
    const { FG } = boot({ window: { claude: f.claude } });
    assert((await FG.cloud.init()) === 'off');
    assert(f.asked.length === 0 && b.calls === 0 && f.used.indexOf('db') < 0, JSON.stringify(f));
  });

  await test('turning it on asks once, checks it can write, then saves', async () => {
    const b = createBackend();
    const f = fakeClaude(b);
    const { FG, localStorage } = boot({ window: { claude: f.claude } });
    await FG.cloud.init();
    assert((await FG.cloud.turnOn()) === 'on');
    assert(f.asked.length === 1 && f.asked[0].join() === 'db,user', JSON.stringify(f.asked));
    assert(FG.cloud.name === 'Alice' && localStorage.getItem('cogworks-cloud') === 'on');
    const g = world(FG);
    assert((await FG.saves.store(g, 'auto')).account);
  });

  await test('another computer that already has permission connects by itself and finds the save', async () => {
    const b = createBackend();
    const one = fakeClaude(b);
    const A = boot({ window: { claude: one.claude } });
    await A.FG.cloud.turnOn();
    const g = world(A.FG, 21);
    await A.FG.saves.store(g, 'auto');
    const two = fakeClaude(b, { db: 'granted', user: 'granted' });
    const B = boot({ window: { claude: two.claude } });
    assert((await B.FG.cloud.init()) === 'on', B.FG.cloud.state);
    assert(two.asked.length === 0);
    const r = (await B.FG.saves.list()).find((x) => x.slot === 'auto');
    assert(r.from === 'account' && !r.local);
    const g2 = await B.FG.saves.load('auto');
    assert(B.FG.net.hash(g2) === A.FG.net.hash(g));
  });

  await test('turned off on this computer stays off', async () => {
    const b = createBackend();
    const f = fakeClaude(b, { db: 'granted', user: 'granted' });
    const { FG, localStorage } = boot({ window: { claude: f.claude } });
    localStorage.setItem('cogworks-cloud', 'off');
    assert((await FG.cloud.init()) === 'off');
    assert(b.calls === 0);
  });

  await test('declining permission leaves browser saves working', async () => {
    const b = createBackend();
    const f = fakeClaude(b, { answer: 'denied' });
    const { FG } = boot({ window: { claude: f.claude } });
    await FG.cloud.init();
    assert((await FG.cloud.turnOn()) === 'denied');
    const out = await FG.saves.store(world(FG), '1');
    assert(out.local && !out.account);
    // The refusal stands on the next visit, with no dialog and no store calls.
    const again = boot({ window: { claude: f.claude } });
    assert((await again.FG.cloud.init()) === 'denied' && f.asked.length === 1 && b.calls === 0);
  });

  await test('without the permissions API, only reconnect someone who chose it here', async () => {
    const b = createBackend();
    const f = fakeClaude(b, { db: 'granted', user: 'granted' });
    const claude = { use: async (cap) => (cap === 'permissions' ? null : f.claude.use(cap)) };
    const A = boot({ window: { claude } });
    assert((await A.FG.cloud.init()) === 'off' && b.calls === 0);
    const B = boot({ window: { claude } });
    B.localStorage.setItem('cogworks-cloud', 'on');
    assert((await B.FG.cloud.init()) === 'on');
  });

  await test('signed out, or opened by a public link: unavailable', async () => {
    const b = createBackend();
    const f = fakeClaude(b, { uid: null });
    const A = boot({ window: { claude: f.claude } });
    assert((await A.FG.cloud.turnOn()) === 'unavailable');
    const g = fakeClaude(b, { db: null, user: null });
    const B = boot({ window: { claude: g.claude } });
    assert((await B.FG.cloud.init()) === 'unavailable');
  });

  await test('view-only access is found out when turning it on', async () => {
    const b = createBackend();
    b.readonly.add('u_alice');
    const f = fakeClaude(b);
    const { FG, localStorage } = boot({ window: { claude: f.claude } });
    assert((await FG.cloud.turnOn()) === 'readonly');
    assert(localStorage.getItem('cogworks-cloud') !== 'on');
  });

  console.log(failures ? failures + ' failed, ' + passed + ' passed' : 'all ' + passed + ' passed');
  process.exit(failures ? 1 : 0);
})();
