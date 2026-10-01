// Test stand-in for claude.ai's `permissions`, `user` and `db` capabilities in a page, as far
// as account saves use them. Every call goes to the test process through window.__acct
// (page.exposeFunction), where tests/fake-db.js keeps the store and the account's
// permissions, so several browser contexts act like several computers on one account.
// Injected with addInitScript; the real page never loads it.
(function () {
  if (window.claude && window.claude.use) return;
  const call = async (op, a) => {
    const r = await window.__acct(op, a || {});
    if (r && r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
    return r ? r.result : undefined;
  };
  const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
  const check = (path, even) => {
    const segs = path.split('/');
    if (segs.some((s) => !SEG.test(s)) || (segs.length % 2 === 0) !== even) throw new TypeError('bad path ' + path);
  };
  const snap = (r) => Object.freeze({ exists: !!r.exists, data: () => (r.exists ? Object.freeze(r.data) : undefined) });
  const docRef = (path) => {
    check(path, true);
    return Object.freeze({
      path,
      get: async () => snap(await call('db', { op: 'get', path })),
      set: async (body) => { await call('db', { op: 'set', path, body }); },
      delete: async () => { await call('db', { op: 'delete', path }); },
      collection: (sub) => colRef(path + '/' + sub),
    });
  };
  const colRef = (path) => { check(path, false); return Object.freeze({ path, doc: (id) => docRef(path + '/' + id) }); };
  const db = Object.freeze({ doc: docRef, collection: colRef });
  const user = Object.freeze({ me: () => call('me') });
  const permissions = Object.freeze({ state: (n) => call('state', { name: n }), request: (names) => call('request', { names }) });
  window.claude = {
    use: async (cap) => {
      const avail = await call('available');
      if (cap === 'permissions') return permissions;
      if (cap === 'user') return avail.user ? user : null;
      if (cap === 'db') return avail.db ? db : null;
      return null;
    },
  };
})();
