// Test stand-in for claude.ai's `db` store (see the platform's db.d.ts), as far as account
// saves use it: documents by path, per-viewer private subtrees under data/users/<id>/, the
// 256 KiB document limit, view-only access that can't write, and injectable failures.
// backend.call(uid, op, path, body) does one operation for viewer `uid`; dbFor(backend, uid)
// gives that viewer the db API in Node. The browser tests reach the same backend through
// page.exposeFunction (see account.cjs).
const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
function err(code, message) { const e = new Error(message); e.code = code; return e; }
function checkPath(path, even) {
  const segs = path.split('/');
  if (segs.some((s) => !SEG.test(s) || s === '.' || s === '..' || s.length > 200)) throw new TypeError('bad path segment in ' + path);
  if ((segs.length % 2 === 0) !== even) throw new TypeError((even ? 'document' : 'collection') + ' path has ' + segs.length + ' segments: ' + path);
}

function createBackend() {
  const docs = new Map(); // path -> JSON text
  const b = {
    docs,
    readonly: new Set(), // viewer ids with view-only access
    failNext: [], // [{op, match: RegExp, code}] — the next matching call fails once
    calls: 0,
    writes: 0,
    call(uid, op, path, body) {
      b.calls++;
      checkPath(path, true);
      const f = b.failNext.findIndex((x) => x.op === op && x.match.test(path));
      if (f >= 0) { const x = b.failNext.splice(f, 1)[0]; throw err(x.code, 'injected ' + x.code); }
      const segs = path.split('/');
      const mine = segs[0] === 'data' && segs[1] === 'users' ? segs[2] === uid : true;
      if (op === 'get') {
        if (!mine || !docs.has(path)) return { exists: false };
        return { exists: true, data: JSON.parse(docs.get(path)) };
      }
      if (!mine || b.readonly.has(uid) || !uid) throw err('invalid_argument', 'write not allowed at ' + path);
      if (op === 'delete') { docs.delete(path); b.writes++; return {}; }
      if (op === 'set') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw err('invalid_argument', 'body must be an object');
        const text = JSON.stringify(body);
        if (Buffer.byteLength(text) > 256 * 1024) throw err('invalid_argument', 'document over 256 KiB');
        docs.set(path, text);
        b.writes++;
        return {};
      }
      throw err('invalid_argument', 'unknown op ' + op);
    },
  };
  return b;
}

// The db API (just the parts account saves use) for one viewer, over a backend call function.
function dbOver(call) {
  const snap = (r) => ({ exists: !!r.exists, data: () => (r.exists ? Object.freeze(r.data) : undefined) });
  const docRef = (path) => {
    checkPath(path, true);
    return {
      path,
      get: async () => snap(await call('get', path)),
      set: async (body) => { await call('set', path, body); },
      delete: async () => { await call('delete', path); },
      collection: (sub) => colRef(path + '/' + sub),
    };
  };
  const colRef = (path) => {
    checkPath(path, false);
    return { path, doc: (id) => docRef(path + '/' + id) };
  };
  return { doc: docRef, collection: colRef };
}
function dbFor(backend, uid) {
  return dbOver(async (op, path, body) => { await null; return backend.call(uid, op, path, body); });
}

if (typeof module !== 'undefined') module.exports = { createBackend, dbFor, dbOver };
