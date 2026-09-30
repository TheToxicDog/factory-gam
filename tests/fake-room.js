// Test stand-in for claude.ai's `room` capability (see the platform's room.d.ts), for pages
// in one browser: presence, peers, onPeers, named rooms, emit/on, over BroadcastChannel.
// Injected by the browser tests with page.addInitScript; the real page never loads it.
(function () {
  if (window.claude && window.claude.use) return;
  const LAT = 40; // ms of delivery delay, like a real relay
  const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  const me = rid();

  function makeRoom(name) {
    const ch = new BroadcastChannel('fakeroom:' + name);
    const peers = new Map(); // peer -> {presence, seen, updatedAt}
    const mine = { presence: {}, seen: Date.now(), updatedAt: Date.now() };
    peers.set(me, mine);
    const listeners = new Set(), topicL = new Map();
    let snapshot = [];
    let pend = { joined: new Set(), left: new Set(), updated: new Set() };
    let timer = null, alive = true;
    const view = (id) => { const p = peers.get(id); return Object.freeze({ peer: id, by: null, isMe: id === me, sameTab: id === me, kind: 'viewer', guest: false, presence: Object.freeze(p.presence), updatedAt: p.updatedAt }); };
    const rebuild = () => { snapshot = Object.freeze(Array.from(peers.keys()).map(view)); };
    rebuild();
    const fire = () => {
      timer = null;
      rebuild();
      const pick = (set) => snapshot.filter((p) => set.has(p.peer));
      const change = { peers: snapshot, joined: pick(pend.joined), updated: pick(pend.updated), left: Array.from(pend.left).map((id) => Object.freeze({ peer: id, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: {}, updatedAt: Date.now() })) };
      pend = { joined: new Set(), left: new Set(), updated: new Set() };
      for (const f of listeners) try { f(change); } catch (e) { console.error(e); }
    };
    const soon = () => { if (!timer) timer = setTimeout(fire, 16); };
    const post = (m) => { if (alive) setTimeout(() => { try { ch.postMessage(m); } catch (e) { /* closed */ } }, LAT); };
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === me || !alive) return;
      if (m.type === 'bye') { if (peers.delete(m.from)) { pend.left.add(m.from); soon(); } return; }
      let p = peers.get(m.from);
      if (!p) { p = { presence: {}, seen: Date.now(), updatedAt: Date.now() }; peers.set(m.from, p); pend.joined.add(m.from); if (m.type !== 'hello-reply') post({ type: 'hello-reply', from: me, presence: mine.presence }); }
      p.seen = Date.now();
      if (m.type === 'hello') post({ type: 'hello-reply', from: me, presence: mine.presence });
      if (m.presence && JSON.stringify(m.presence) !== JSON.stringify(p.presence)) { p.presence = m.presence; p.updatedAt = Date.now(); if (!pend.joined.has(m.from)) pend.updated.add(m.from); }
      if (m.type === 'emit') { const l = topicL.get(m.topic); if (l) for (const f of l) f(Object.freeze({ peer: m.from, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, topic: m.topic, data: m.data })); }
      soon();
    };
    post({ type: 'hello', from: me, presence: mine.presence });
    const beat = setInterval(() => {
      post({ type: 'beat', from: me, presence: mine.presence });
      const now = Date.now();
      for (const [id, p] of peers) if (id !== me && now - p.seen > 5000) { peers.delete(id); pend.left.add(id); soon(); }
    }, 1000);
    window.addEventListener('pagehide', () => { try { ch.postMessage({ type: 'bye', from: me }); } catch (e) { /* closed */ } });
    let presTimer = null;
    const api = {
      name,
      emit(topic, data) { post({ type: 'emit', from: me, topic, data }); const l = topicL.get(topic); if (l) for (const f of l) f(Object.freeze({ peer: me, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, topic, data })); return Promise.resolve(); },
      on(topic, fn) { if (!topicL.has(topic)) topicL.set(topic, new Set()); topicL.get(topic).add(fn); return () => topicL.get(topic).delete(fn); },
      presence(patch) {
        const next = Object.assign({}, mine.presence);
        for (const k in patch) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
        const size = new TextEncoder().encode(JSON.stringify(next)).length;
        if (size > 4096) return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB (' + size + ')' });
        mine.presence = JSON.parse(JSON.stringify(next));
        mine.updatedAt = Date.now();
        pend.updated.add(me);
        soon();
        // Coalesced, about 30 a second.
        if (!presTimer) presTimer = setTimeout(() => { presTimer = null; post({ type: 'presence', from: me, presence: mine.presence }); }, 33);
        return Promise.resolve();
      },
      peers() { return snapshot; },
      onPeers(fn) { listeners.add(fn); setTimeout(() => { rebuild(); fn({ peers: snapshot, joined: snapshot, left: [], updated: [] }); }, 0); return () => listeners.delete(fn); },
      connected() { return true; },
      onConnection(fn) { setTimeout(() => fn(true), 0); return () => {}; },
      leave() { alive = false; clearInterval(beat); try { ch.postMessage({ type: 'bye', from: me }); } catch (e) { /* closed */ } ch.close(); listeners.clear(); return Promise.resolve(); },
    };
    return api;
  }

  const lobby = makeRoom('lobby');
  const named = new Map();
  lobby.join = (name) => {
    if (window.__noNamedRooms) return Promise.reject({ code: 'not_permitted', message: 'named rooms are off' });
    if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) return Promise.reject({ code: 'invalid_argument', message: 'bad room name' });
    if (!named.has(name)) { const r = makeRoom('n:' + name); const leave = r.leave; r.leave = () => { named.delete(name); return leave(); }; named.set(name, r); }
    return new Promise((r) => setTimeout(() => r(named.get(name)), LAT));
  };
  lobby.sendToClaudeSession = () => Promise.reject({ code: 'claude_unavailable' });
  lobby.canSendToClaudeSession = () => Promise.resolve('off');
  window.claude = { use: (cap) => new Promise((r) => setTimeout(() => r(cap === 'room' ? lobby : null), 30)) };
  window.__fakeRoomPeer = me;
})();
