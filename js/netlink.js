// Cogworks Frontier — multiplayer connections for net.js.
//
// Finding each other: everyone with the artifact open shares its `room` (a claude.ai
// capability). A host advertises its world there; others see it listed and click Join.
// Game traffic then goes straight between the two browsers over a WebRTC data channel (on one
// network it never leaves it). If a direct connection can't be made, the same messages are
// relayed through the room instead: slower, but it works anywhere the room does.
// Without a room (the page opened from a file, or by a public link), two players can still
// connect directly by trading two codes.
(function () {
  'use strict';
  const L = (FG.netlink = {});
  const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const CHUNK = 16000; // data channel message size
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // --------------------------------------------------------- data channel
  L.rtcSupported = () => typeof RTCPeerConnection === 'function';

  // Wait for the connection's own address candidates, so one offer or answer holds all of
  // them (no back-and-forth of candidates).
  function gathered(pc, ms) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(resolve, ms || 2500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
    });
  }

  // A link over an open RTCDataChannel: JSON messages, big ones split into chunks.
  class RtcLink {
    constructor(pc, dc) {
      this.kind = 'direct';
      this.pc = pc; this.dc = dc;
      this.onmessage = null; this.onclose = null;
      this.closed = false;
      this.parts = new Map();
      this.nextId = 1;
      dc.onmessage = (e) => this.receive(e.data);
      dc.onclose = () => this.shut('closed');
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.shut('connection ' + pc.connectionState);
      });
    }
    send(obj) {
      if (this.closed || this.dc.readyState !== 'open') return;
      const s = JSON.stringify(obj);
      if (s.length <= CHUNK) { this.dc.send('m' + s); return; }
      const id = this.nextId++, n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) this.dc.send('c' + id + ':' + i + ':' + n + ':' + s.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    // How much of a big incoming message has arrived (0..1), or null.
    progress() {
      let best = null;
      for (const p of this.parts.values()) best = Math.max(best || 0, p.got / p.bits.length);
      return best;
    }
    receive(data) {
      if (typeof data !== 'string') return;
      let s = null;
      if (data[0] === 'm') s = data.slice(1);
      else if (data[0] === 'c') {
        const a = data.indexOf(':'), b = data.indexOf(':', a + 1), c = data.indexOf(':', b + 1);
        const id = data.slice(1, a), i = +data.slice(a + 1, b), n = +data.slice(b + 1, c);
        let p = this.parts.get(id);
        if (!p) this.parts.set(id, (p = { got: 0, bits: new Array(n) }));
        if (p.bits[i] === undefined) { p.bits[i] = data.slice(c + 1); p.got++; }
        if (p.got < n) return;
        this.parts.delete(id);
        s = p.bits.join('');
      }
      if (s === null) return;
      let m;
      try { m = JSON.parse(s); } catch (e) { return; }
      if (this.onmessage) this.onmessage(m);
    }
    shut(why) {
      if (this.closed) return;
      this.closed = true;
      try { this.dc.close(); } catch (e) { /* closed */ }
      try { this.pc.close(); } catch (e) { /* closed */ }
      if (this.onclose) this.onclose(why);
    }
    close() { this.shut('closed'); }
  }
  L.RtcLink = RtcLink;

  // Joiner side: make an offer. Resolves {pc, dc, offer}.
  L.makeOffer = async function () {
    const pc = new RTCPeerConnection(RTC_CFG);
    const dc = pc.createDataChannel('cogworks', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return { pc, dc, offer: pc.localDescription.sdp };
  };
  // Joiner side: take the host's answer and wait for the channel to open.
  L.finishOffer = async function (pc, dc, answer, ms) {
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await opened(dc, ms);
    return new RtcLink(pc, dc);
  };
  // Host side: answer an offer. Resolves {answer, link: Promise<RtcLink>}.
  L.answerOffer = async function (offer, ms) {
    const pc = new RTCPeerConnection(RTC_CFG);
    const dcP = new Promise((resolve) => { pc.ondatachannel = (e) => resolve(e.channel); });
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    const link = (async () => {
      const dc = await Promise.race([dcP, wait(ms || 12000).then(() => null)]);
      if (!dc) { pc.close(); throw new Error('no data channel'); }
      await opened(dc, ms);
      return new RtcLink(pc, dc);
    })();
    link.catch(() => {});
    return { answer: pc.localDescription.sdp, link, pc };
  };
  function opened(dc, ms) {
    return new Promise((resolve, reject) => {
      if (dc.readyState === 'open') { resolve(); return; }
      const t = setTimeout(() => reject(new Error('the direct connection did not open')), ms || 10000);
      dc.addEventListener('open', () => { clearTimeout(t); resolve(); });
      dc.addEventListener('close', () => { clearTimeout(t); reject(new Error('the direct connection closed')); });
    });
  }

  // ------------------------------------------------------- relay via room
  // A reliable, ordered stream through room presence. Each side publishes, per partner, the
  // text it still owes them (in numbered fragments) and how far it has read their text;
  // presence always carries the latest state, so nothing is lost when an update is skipped.
  const FRAG = 800; // characters per fragment (presence strings stay small)
  const BUDGET = 2600; // characters of fragments across all streams in one presence update
  class RelayHub {
    constructor(room, me) {
      this.room = room; this.me = me;
      this.streams = new Map(); // peer -> RelayLink
      this.timer = null;
      this.budget = BUDGET;
      this.off = room.onPeers((ch) => this.onPeers(ch), () => { for (const s of this.streams.values()) s.shut('room closed'); });
    }
    open(peer) {
      let s = this.streams.get(peer);
      if (!s || s.closed) {
        s = new RelayLink(this, peer);
        this.streams.set(peer, s);
        // They may have started talking before we opened our end.
        const p = this.room.peers().find((x) => x.peer === peer);
        const rl = p && p.presence && p.presence.rl;
        if (rl && rl[this.me]) s.receive(rl[this.me]);
      }
      return s;
    }
    onPeers(ch) {
      for (const p of ch.peers) {
        const s = this.streams.get(p.peer);
        const rl = p.presence && p.presence.rl;
        if (s && rl && rl[this.me]) s.receive(rl[this.me]);
      }
      for (const p of ch.left) { const s = this.streams.get(p.peer); if (s) s.shut('left'); }
    }
    schedule() {
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = null; this.publish(); }, 40);
    }
    publish() {
      const rl = {};
      const live = Array.from(this.streams.values()).filter((s) => !s.closed);
      const share = Math.max(FRAG + 40, Math.floor(this.budget / Math.max(1, live.length)));
      let more = false;
      for (const s of live) {
        s.cut();
        const f = [];
        let used = 0;
        for (const x of s.frags) {
          const len = x.length + 8;
          if (f.length && used + len > share) { more = true; break; }
          f.push(x); used += len;
        }
        rl[s.peer] = { a: s.recv, s: s.base, f };
      }
      // Too big with everything else in our presence: send smaller windows.
      this.room.presence({ rl }).catch((e) => { if (e && e.code === 'invalid_argument' && this.budget > FRAG) { this.budget = Math.max(FRAG, this.budget >> 1); this.schedule(); } });
      // Keep going while there is unsent text (the partner's acks trim it).
      if (more || live.some((s) => s.pending)) this.schedule();
    }
    close() {
      if (this.off) this.off();
      for (const s of this.streams.values()) s.shut('closed');
      this.room.presence({ rl: null }).catch(() => {});
    }
  }
  L.RelayHub = RelayHub;

  class RelayLink {
    constructor(hub, peer) {
      this.kind = 'relay';
      this.hub = hub; this.peer = peer;
      this.onmessage = null; this.onclose = null;
      this.closed = false;
      this.pending = ''; // text not yet cut into fragments
      this.frags = []; // unacknowledged fragments, the first numbered `base`
      this.base = 1;
      this.recv = 0; // last fragment number read from the partner
      this.buf = ''; // partner text not yet parsed into messages
      this.heard = Date.now();
      this.watch = setInterval(() => { if (Date.now() - this.heard > 30000) this.shut('no answer for 30 s'); }, 5000);
    }
    send(obj) {
      if (this.closed) return;
      const s = JSON.stringify(obj);
      this.pending += s.length + ':' + s; // length-prefixed messages
      this.hub.schedule();
    }
    cut() {
      while (this.pending.length) { this.frags.push(this.pending.slice(0, FRAG)); this.pending = this.pending.slice(FRAG); }
    }
    receive(st) {
      if (this.closed || !st) return;
      this.heard = Date.now();
      // Their ack trims what we owe them.
      const a = st.a | 0;
      if (a >= this.base) { this.frags.splice(0, Math.min(this.frags.length, a - this.base + 1)); this.base = a + 1; }
      // Their fragments: take the ones we have not read, in order.
      const f = Array.isArray(st.f) ? st.f : [];
      let got = false;
      for (let j = 0; j < f.length; j++) {
        const seq = (st.s | 0) + j;
        if (seq !== this.recv + 1 || typeof f[j] !== 'string') continue;
        this.buf += f[j];
        this.recv = seq;
        got = true;
      }
      if (got) { this.hub.schedule(); this.parse(); }
    }
    progress() {
      const c = this.buf.indexOf(':');
      const n = c > 0 ? parseInt(this.buf.slice(0, c), 10) : 0;
      return n > 4000 ? Math.min(1, (this.buf.length - c - 1) / n) : null;
    }
    parse() {
      for (;;) {
        const c = this.buf.indexOf(':');
        if (c < 0) return;
        const n = parseInt(this.buf.slice(0, c), 10);
        if (!(n >= 0) || this.buf.length < c + 1 + n) return;
        const s = this.buf.slice(c + 1, c + 1 + n);
        this.buf = this.buf.slice(c + 1 + n);
        let m;
        try { m = JSON.parse(s); } catch (e) { continue; }
        if (this.onmessage && !this.closed) this.onmessage(m);
      }
    }
    shut(why) {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.watch);
      this.hub.streams.delete(this.peer);
      if (this.onclose) this.onclose(why);
    }
    close() { this.shut('closed'); }
  }
  L.RelayLink = RelayLink;

  // ---------------------------------------------------------------- lobby
  // The room everyone with the artifact open shares; hosts advertise there.
  const lobby = (L.lobby = { room: null, tried: false, me: null, listeners: [], adverts: [] });
  L.connectLobby = async function () {
    if (lobby.tried) return lobby.room;
    lobby.tried = true;
    const c = typeof window !== 'undefined' && window.claude;
    if (!c || typeof c.use !== 'function') return null;
    let room = null;
    try { room = await c.use('room'); } catch (e) { room = null; }
    if (!room) return null;
    lobby.room = room;
    room.onPeers((ch) => {
      const me = ch.peers.find((p) => p.sameTab);
      if (me) lobby.me = me.peer;
      lobby.adverts = ch.peers.filter((p) => !p.sameTab && p.presence && p.presence.cw && p.presence.cw.code).map((p) => {
        const a = p.presence.cw;
        return { peer: p.peer, code: String(a.code), world: String(a.world || 'World').slice(0, 24), host: String(a.host || 'Someone').slice(0, 24), players: a.players | 0, max: a.max | 0, v: a.v, guest: p.guest };
      });
      for (const f of lobby.listeners) f(lobby.adverts);
    }, () => { lobby.adverts = []; for (const f of lobby.listeners) f([]); });
    return room;
  };
  L.onAdverts = function (fn) { lobby.listeners.push(fn); fn(lobby.adverts); return () => { const i = lobby.listeners.indexOf(fn); if (i >= 0) lobby.listeners.splice(i, 1); }; };
  L.advertise = function (info) { if (lobby.room) lobby.room.presence({ cw: info }).catch(() => {}); };
  L.unadvertise = function () { if (lobby.room) lobby.room.presence({ cw: null }).catch(() => {}); };

  // Wait for my own peer label in a (named) room.
  function myPeer(room, ms) {
    return new Promise((resolve) => {
      const find = () => { const me = room.peers().find((p) => p.sameTab); return me && me.peer; };
      const now = find();
      if (now) { resolve(now); return; }
      const t = setTimeout(() => { off(); resolve(find()); }, ms || 8000);
      const off = room.onPeers(() => { const p = find(); if (p) { clearTimeout(t); off(); resolve(p); } });
    });
  }
  const code6 = () => Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x').padEnd(6, 'x');
  // Each game gets its own named room; where named rooms are not allowed, the lobby itself
  // carries the handshake and relay (every field is addressed to one peer, so games don't mix).
  async function gameRoom(lob, code) {
    try { return await lob.join('cw-' + code); } catch (e) { console.warn('named room refused, using the lobby', e); }
    return { presence: (p) => lob.presence(p), peers: () => lob.peers(), onPeers: (f, e) => lob.onPeers(f, e), leave: () => Promise.resolve() };
  }

  // Offers and answers travel compressed: presence is small.
  const packSdp = async (sdp) => (await FG.save.pack(sdp)).replace(/^gz:/, 'z').replace(/^raw:/, 'r');
  const unpackSdp = async (s) => FG.save.unpack(s[0] === 'z' ? 'gz:' + s.slice(1) : s[0] === 'r' ? 'raw:' + s.slice(1) : s);

  // ------------------------------------------------------ host in a room
  // Open a hosted game to the room: advertise it, answer joiners' offers, relay for those who
  // cannot connect directly. onLink(link) is called for each new connection.
  L.hostOnRoom = async function (info, onLink) {
    const lob = await L.connectLobby();
    if (!lob) return null;
    const code = code6();
    const room = await gameRoom(lob, code);
    const me = await myPeer(room);
    if (!me) throw new Error('could not join the room');
    const hub = new RelayHub(room, me);
    const answers = {}; // joiner peer -> {n, sdp}
    const seen = new Set();
    await room.presence({ cwh: 1 });
    const off = room.onPeers(async (ch) => {
      for (const p of ch.peers) {
        const sig = p.presence && p.presence.sig;
        if (!sig || sig.to !== me || p.sameTab) continue;
        const key = p.peer + ':' + sig.n;
        if (sig.relay) {
          if (seen.has(key + ':r')) continue;
          seen.add(key + ':r');
          delete answers[p.peer];
          room.presence({ ans: Object.assign({}, answers) }).catch(() => {});
          onLink(hub.open(p.peer));
        } else if (sig.offer && !seen.has(key)) {
          seen.add(key);
          if (!L.rtcSupported()) continue;
          try {
            const r = await L.answerOffer(await unpackSdp(sig.offer));
            answers[p.peer] = { n: sig.n, sdp: await packSdp(r.answer) };
            room.presence({ ans: Object.assign({}, answers) }).catch(() => {});
            r.link.then((link) => {
              delete answers[p.peer];
              room.presence({ ans: Object.assign({}, answers) }).catch(() => {});
              onLink(link);
            }, () => { /* they will fall back to the relay */ });
          } catch (e) { console.warn('could not answer a joiner', e); }
        }
      }
      for (const p of ch.left) delete answers[p.peer];
    });
    const advert = Object.assign({ code, v: FG.net.PROTO, max: FG.net.MAX_PLAYERS }, info);
    L.advertise(advert);
    return {
      code,
      update(patch) { Object.assign(advert, patch); L.advertise(advert); },
      close() { off(); hub.close(); L.unadvertise(); room.presence({ cwh: null, ans: null }).catch(() => {}); room.leave().catch(() => {}); },
    };
  };

  // ------------------------------------------------------ join in a room
  // Connect to an advertised game. status(text) reports progress. Resolves a link.
  L.joinOnRoom = async function (advert, status) {
    const lob = await L.connectLobby();
    if (!lob) throw new Error('multiplayer needs the shared room of this page');
    status('Joining ' + advert.world + '…');
    const room = await gameRoom(lob, advert.code);
    const me = await myPeer(room);
    const host = await new Promise((resolve) => {
      // The host's peer label is the same in every room: prefer the one that advertised.
      const find = () => { const h = room.peers().find((p) => p.presence && p.presence.cwh && !p.sameTab && (!advert.peer || p.peer === advert.peer)); return h && h.peer; };
      const now = find();
      if (now) { resolve(now); return; }
      const t = setTimeout(() => { off(); resolve(find()); }, 10000);
      const off = room.onPeers(() => { const h = find(); if (h) { clearTimeout(t); off(); resolve(h); } });
    });
    if (!me || !host) { room.leave().catch(() => {}); throw new Error('the host is not answering'); }
    const n = Math.random().toString(36).slice(2, 8);
    const leave = () => { room.presence({ sig: null }).catch(() => {}); };
    let link = null;
    if (L.rtcSupported()) {
      status('Connecting directly…');
      try {
        const o = await L.makeOffer();
        await room.presence({ sig: { to: host, n, offer: await packSdp(o.offer) } });
        const answer = await new Promise((resolve, reject) => {
          const look = () => { const h = room.peers().find((p) => p.peer === host); const a = h && h.presence && h.presence.ans && h.presence.ans[me]; return a && a.n === n ? a.sdp : null; };
          const now = look();
          if (now) { resolve(now); return; }
          const t = setTimeout(() => { off(); reject(new Error('no answer')); }, 12000);
          const off = room.onPeers(() => { const a = look(); if (a) { clearTimeout(t); off(); resolve(a); } });
        });
        link = await L.finishOffer(o.pc, o.dc, await unpackSdp(answer), 10000);
      } catch (e) {
        console.warn('direct connection failed, relaying through the room', e);
        link = null;
      }
    }
    if (!link) {
      status('Connecting through the room…');
      const hub = new RelayHub(room, me);
      await room.presence({ sig: { to: host, n, relay: 1 } });
      link = hub.open(host);
      const close = link.close.bind(link);
      link.close = () => { close(); hub.close(); room.leave().catch(() => {}); };
    } else {
      leave();
      const close = link.close.bind(link);
      link.close = () => { close(); room.leave().catch(() => {}); };
    }
    return link;
  };

  // ------------------------------------------------- codes (no room at all)
  // Offers and answers as short-ish text to copy between computers.
  const packCode = async (prefix, sdp) => prefix + (await packSdp(sdp));
  async function unpackCode(prefix, code) {
    code = String(code || '').trim().replace(/\s+/g, '');
    if (code.indexOf(prefix) !== 0) throw new Error('That does not look like the right code');
    return unpackSdp(code.slice(prefix.length));
  }
  // Joiner: make a code to give the host. Resolves {code, finish(answerCode) -> Promise<link>}.
  L.codeOffer = async function () {
    const o = await L.makeOffer();
    return {
      code: await packCode('CWJ-', o.offer),
      finish: async (answerCode) => L.finishOffer(o.pc, o.dc, await unpackCode('CWH-', answerCode), 20000),
      cancel: () => { try { o.pc.close(); } catch (e) { /* closed */ } },
    };
  };
  // Host: answer a joiner's code. Resolves {code, link: Promise<link>}.
  L.codeAnswer = async function (joinCode) {
    const r = await L.answerOffer(await unpackCode('CWJ-', joinCode), 120000);
    return { code: await packCode('CWH-', r.answer), link: r.link };
  };
})();
