// Cogworks Frontier — saves in your claude.ai account (optional), and the save slots that
// combine them with this browser's.
//
// On claude.ai the page can keep each player's saves in their own account: a private corner
// of the artifact's database (data/users/<your id>/) that nobody else can read, the artifact's
// owner included. Turning it on asks once for permission; after that every save and autosave
// also goes to the account, and Continue picks up the newest copy on any computer.
// Nothing requires it: without it, saves stay in this browser (and save codes still work).
//
// A save is the same compressed text as a save code. Documents hold at most 256 KiB, so a
// big world is split into numbered parts. Each save writes a fresh generation of parts, then
// the slot's index document that points at them, then removes the previous generation: a
// save interrupted half way leaves the last good one intact.
(function () {
  'use strict';
  const cloud = (FG.cloud = {
    // unknown: still looking · none: not on claude.ai · unavailable: on claude.ai, but this
    // visit can't keep account data (signed out, or opened by a public link) · off: available,
    // not turned on · asking: waiting on the permission dialog · on · readonly: this person's
    // access to the game can't write · denied: they declined permission · error
    state: 'unknown', uid: null, name: '', db: null,
    lastSaved: 0, lastError: '', busy: false,
  });
  const SLOTS = ['auto', '1', '2', '3'];
  const PART = 200000; // characters per part document (a document holds at most 256 KiB)
  const PREF = 'cogworks-cloud';
  const listeners = [];
  cloud.SLOTS = SLOTS;
  cloud.onChange = (fn) => { listeners.push(fn); };
  const changed = () => { for (const f of listeners) try { f(cloud); } catch (e) { console.error(e); } };
  const set = (state, err) => { cloud.state = state; if (err !== undefined) cloud.lastError = err; changed(); return state; };

  // 'on' / 'off' once the player chose on this computer, '' before.
  function pref() { try { return localStorage.getItem(PREF) || ''; } catch (e) { return ''; } }
  function setPref(on) { try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ } }
  const api = () => (typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? window.claude : null);

  // Look around without asking anything. Connect if the player already allowed it (here or
  // on another computer) and hasn't turned account saves off on this one.
  cloud.init = async function () {
    const c = api();
    if (!c) return set('none');
    const perms = await c.use('permissions').catch(() => null);
    if (pref() === 'off') return set('off');
    // Without a way to check permission first, only reconnect someone who chose this here.
    if (!perms) return pref() === 'on' ? connect(false) : set('off');
    const st = await perms.state().catch(() => ({}));
    if (!st.db) return set('unavailable');
    if (st.db === 'denied' || st.user === 'denied') return set('denied');
    // Connecting while permission is still to be asked would pop up a dialog nobody asked for.
    if (st.db !== 'granted' || (st.user && st.user !== 'granted')) return set('off');
    return connect(pref() !== 'on');
  };

  // The player asked for account saves: ask permission, connect, check we can write.
  cloud.turnOn = async function () {
    const c = api();
    if (!c) return set('none');
    set('asking');
    const perms = await c.use('permissions').catch(() => null);
    if (perms) {
      const st = await perms.request(['db', 'user']).catch(() => ({}));
      if (!st.db) return set('unavailable');
      if (st.db === 'denied' || st.user === 'denied') return set('denied');
    }
    return connect(true);
  };
  cloud.turnOff = function () { setPref(false); cloud.db = null; return set('off'); };

  async function connect(probe) {
    const c = api();
    const [db, user] = await Promise.all([c.use('db').catch(() => null), c.use('user').catch(() => null)]);
    if (!db || !user) return set('unavailable');
    const me = await user.me();
    if (!me.id) return set('unavailable');
    cloud.db = db;
    cloud.uid = me.id;
    cloud.name = me.name || '';
    if (probe) {
      // A first write tells us whether this person may keep data here (view-only access can't).
      try { await retry(() => col().doc('settings').set({ accountSaves: true })); }
      catch (e) {
        cloud.db = null;
        if (e && e.code === 'invalid_argument') return set('readonly');
        return set('error', describe(e));
      }
    }
    setPref(true);
    return set('on', '');
  }
  // For tests: use a store directly.
  cloud.attach = function (db, uid, name) { cloud.db = db; cloud.uid = uid; cloud.name = name || ''; return set('on', ''); };

  const col = () => cloud.db.collection('data/users/' + cloud.uid);
  // A brief platform hiccup is worth one more try.
  async function retry(fn) {
    try { return await fn(); } catch (e) {
      if (!e || (e.code !== 'unavailable' && e.code !== 'resource_exhausted')) throw e;
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      return fn();
    }
  }
  function describe(e) {
    const code = e && e.code;
    if (code === 'quota_exceeded') return 'The game\'s account storage is full. Your saves are still in this browser.';
    if (code === 'revoked') return 'Access to account saves ended. Reload the page to try again.';
    if (code === 'unavailable' || code === 'resource_exhausted') return 'Account storage is busy. It will try again at the next save.';
    return (e && e.message) || String(e);
  }
  // Writes go one at a time, in order.
  let chain = Promise.resolve();
  const queue = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  function sum(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h >>> 0;
  }
  let genSeq = 0;

  // Keep packed save text in an account slot. Resolves the slot's new entry.
  cloud.storeText = function (slot, text, g) {
    if (cloud.state !== 'on') return Promise.reject(new Error('Account saves are off'));
    const info = { tick: g.tick, seed: g.opts.seed };
    return queue(async () => {
      if (cloud.state !== 'on') throw new Error('Account saves are off');
      cloud.busy = true; changed();
      const gen = Date.now().toString(36) + (genSeq++ % 36).toString(36);
      const parts = Math.max(1, Math.ceil(text.length / PART));
      let written = 0, indexing = false;
      try {
        for (let i = 0; i < parts; i++) {
          const body = { d: text.slice(i * PART, (i + 1) * PART) };
          await retry(() => col().doc('save-' + slot + '.' + gen + '.' + i).set(body));
          written = i + 1;
        }
        const index = col().doc('save-' + slot);
        const before = await retry(() => index.get());
        const meta = { v: 1, slot, when: Date.now(), tick: info.tick, seed: info.seed, size: text.length, gen, parts, sum: sum(text) };
        indexing = true;
        await retry(() => index.set(meta));
        // The previous generation is no longer needed.
        const old = before.exists ? before.data() : null;
        if (old && old.gen && old.gen !== gen) await dropParts(slot, old);
        cloud.lastSaved = meta.when;
        cloud.lastError = '';
        return meta;
      } catch (e) {
        // Don't leave behind the parts of a save that never got its index. (Once the index
        // write has started it may have landed, so its parts must stay.)
        if (!indexing && written && cloud.db) await dropParts(slot, { gen, parts: written });
        cloud.lastError = describe(e);
        // Our documents are well-formed, so a refused write means this person's access changed.
        if (e && e.code === 'invalid_argument') { cloud.db = null; set('readonly'); }
        if (e && e.code === 'revoked') { cloud.db = null; set('error'); }
        throw new Error(cloud.lastError);
      } finally { cloud.busy = false; changed(); }
    });
  };
  async function dropParts(slot, meta) {
    for (let i = 0; i < (meta.parts | 0); i++) {
      try { await col().doc('save-' + slot + '.' + meta.gen + '.' + i).delete(); } catch (e) { /* leftover, harmless */ }
    }
  }

  // What each account slot holds: [{slot, when, tick, size, seed} or {slot, empty: true}]
  cloud.list = async function () {
    if (cloud.state !== 'on') return SLOTS.map((slot) => ({ slot, empty: true }));
    const snaps = await Promise.all(SLOTS.map((slot) => retry(() => col().doc('save-' + slot).get()).catch(() => null)));
    return SLOTS.map((slot, i) => {
      const d = snaps[i] && snaps[i].exists ? snaps[i].data() : null;
      return d && d.parts ? { slot, when: d.when, tick: d.tick, size: d.size, seed: d.seed } : { slot, empty: true };
    });
  };

  cloud.loadText = async function (slot) {
    if (cloud.state !== 'on') throw new Error('Account saves are off');
    const s = await retry(() => col().doc('save-' + slot).get());
    const d = s.exists ? s.data() : null;
    if (!d || !d.parts) throw new Error('That account slot is empty.');
    const parts = await Promise.all(Array.from({ length: d.parts }, (_, i) => retry(() => col().doc('save-' + slot + '.' + d.gen + '.' + i).get())));
    if (parts.some((p) => !p.exists)) throw new Error('Part of that save is missing.');
    const text = parts.map((p) => p.data().d).join('');
    if (sum(text) !== d.sum) throw new Error('That save did not arrive whole.');
    return text;
  };

  cloud.remove = function (slot) {
    if (cloud.state !== 'on') return Promise.resolve();
    return queue(async () => {
      const index = col().doc('save-' + slot);
      const s = await retry(() => index.get());
      const d = s.exists ? s.data() : null;
      await retry(() => index.delete());
      if (d && d.gen) await dropParts(slot, d);
    });
  };

  // ------------------------------------------------ slots in both places
  // Each slot lives in this browser and, with account saves on, in the account. Saving writes
  // both; loading takes whichever copy is newer.
  const saves = (FG.saves = {});

  // [{slot, local, account, best, from}] where local/account are entries or null, best the
  // newer of the two and from 'browser' or 'account'.
  saves.list = async function () {
    const local = FG.save.list();
    const acc = await cloud.list().catch(() => SLOTS.map((slot) => ({ slot, empty: true })));
    return SLOTS.map((slot, i) => {
      const l = local[i] && !local[i].empty ? local[i] : null;
      const a = acc[i] && !acc[i].empty ? acc[i] : null;
      // The same save in both places (written together) loads from the browser, the quicker.
      const same = !!(l && a && l.tick === a.tick && l.seed === a.seed);
      const best = l && a ? (!same && a.when > l.when ? a : l) : l || a;
      return { slot, local: l, account: a, same, best, from: best ? (best === a ? 'account' : 'browser') : null, empty: !best };
    });
  };

  // Save to every place available. Resolves {local, account, errors}; rejects only when
  // nothing could be saved.
  saves.store = async function (g, slot, opts) {
    const text = await FG.save.pack(FG.save.serialize(g));
    const out = { local: null, account: null, errors: [] };
    try { out.local = FG.save.storeText(slot, text, g); } catch (e) { out.errors.push(e.message); }
    const toAccount = cloud.state === 'on' && !(opts && opts.localOnly);
    if (toAccount) {
      const p = cloud.storeText(slot, text, g).then((m) => { out.account = m; }, (e) => { out.errors.push(e.message); });
      // Leaving the page can't wait on the network; the account copy finishes if it can.
      if (!(opts && opts.noWait)) await p;
    }
    if (!out.local && !out.account && !(toAccount && opts && opts.noWait)) throw new Error(out.errors[0] || 'Could not save');
    return out;
  };

  // Load the newest copy of a slot, falling back to the other copy if that one fails.
  saves.load = async function (slot, from) {
    const row = (await saves.list()).find((r) => r.slot === slot);
    if (!row || row.empty) throw new Error('That save slot is empty.');
    const order = from ? [from] : [row.from, row.from === 'account' ? 'browser' : 'account'];
    let err = null;
    for (const src of order) {
      if (src === 'account' && !row.account) continue;
      if (src === 'browser' && !row.local) continue;
      try {
        if (src === 'browser') return await FG.save.loadSlot(slot);
        return FG.save.deserialize(await FG.save.unpack(await cloud.loadText(slot)));
      } catch (e) { err = err || e; }
    }
    throw err || new Error('That save slot is empty.');
  };

  saves.remove = async function (slot) {
    FG.save.deleteSlot(slot);
    await cloud.remove(slot).catch(() => {});
  };

  // Autosave. Browser copies are quick; account copies are spaced out (minGap ms apart).
  saves.lastAccountAuto = 0;
  saves.autosave = function (g, opts) {
    opts = opts || {};
    const now = Date.now();
    const gap = opts.minGap === undefined ? 60000 : opts.minGap;
    const account = cloud.state === 'on' && !cloud.busy && now - saves.lastAccountAuto >= gap;
    if (account) saves.lastAccountAuto = now;
    return saves.store(g, 'auto', { localOnly: !account, noWait: opts.noWait });
  };
})();
