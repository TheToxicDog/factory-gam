// Cogworks Frontier — multiplayer sessions (lockstep, like Factorio).
//
// Every computer runs the same simulation. The host decides the order of play: it collects
// every player's commands (commands.js), gives each one the tick it runs on, and streams
// "run up to tick T, with these commands" to everyone. A client only simulates ticks the host
// has confirmed, so all copies stay identical.
//
// Joining: the host adds the new player, saves the world, and every computer (the host too)
// reloads that same snapshot, so all copies restart from identical state. Every two seconds
// each computer hashes its world; a client that differs from the host asks for a fresh
// snapshot, which repairs it.
//
// This file knows nothing about networks or the page: a session talks through a "link"
// ({send(obj), onmessage, onclose, close()}, see netlink.js) and an environment `env`:
//   getGame(), setGame(g, why), toast(text, kind), onPlayers(), onEnd(reason),
//   pack(str) -> Promise<str>, unpack(str) -> Promise<str>, inputTick()
(function () {
  'use strict';
  const D = FG.data;
  const net = (FG.net = {});
  const PROTO = 1;
  const STEP = 1000 / FG.TICKS;
  const HASH_EVERY = 120; // ticks between world checks
  const MAX_PLAYERS = 8;
  net.PROTO = PROTO;
  net.MAX_PLAYERS = MAX_PLAYERS;

  // ------------------------------------------------------------ world hash
  // A cheap fingerprint of the simulation: two copies with different state (almost surely)
  // hash differently. Floats are rounded so both sides agree on "the same".
  net.hash = function (g) {
    let h = 0x811c9dc5 >>> 0;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    const num = (v) => mix(Math.round((v || 0) * 1000));
    const str = (s) => { s = String(s); for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
    mix(g.tick); mix(g.nextId); mix(g.rng.s); mix(g.ents.size); mix(g.ghosts.size);
    for (const e of g.ents.values()) {
      mix(e.id); mix(e.x); mix(e.y); mix(e.dir); num(e.hp);
      if (e.prog !== undefined) num(e.prog);
      if (e.energy !== undefined) num(e.energy);
      if (e.fuel) { str(e.fuel.id); mix(e.fuel.n); }
      if (e.inv) for (const s of e.inv.slots) if (s) { str(s.id); mix(s.n); }
      if (e.lanes) for (const l of e.lanes) { mix(l.ids.length); for (const p of l.pos) num(p); }
      if (e.halves) for (const hh of e.halves) for (const l of hh.lanes) mix(l.ids.length);
      if (e.hand) mix(e.hand.n);
      if (e.st !== undefined) { mix(e.st); num(e.t); }
      if (e.inp && typeof e.inp === 'object') for (const k in e.inp) { const v = e.inp[k]; mix(typeof v === 'number' ? v : v && v.n); }
      if (e.out && typeof e.out === 'object') for (const k in e.out) { const v = e.out[k]; mix(typeof v === 'number' ? v : v && v.n); }
    }
    for (const p of g.players) {
      str(p.id); num(p.x); num(p.y); num(p.hp); mix(p.queue.length); num(p.craftProg);
      for (const s of p.inv.slots) if (s) { str(s.id); mix(s.n); }
    }
    for (const u of g.enemies.units) { num(u.x); num(u.y); num(u.hp); }
    mix(g.enemies.nests.length);
    for (const tr of g.rail.trains) { mix(tr.id); num(tr.headS); num(tr.speed); mix(tr.cars.length); }
    mix(g.rail.pieces.size);
    const r = g.research;
    str(r.current || ''); mix(Object.keys(r.done).length);
    if (r.current) mix(r.progress[r.current] || 0);
    return h >>> 0;
  };

  function logHash(log, t, hh) {
    log.set(t, hh);
    if (log.size > 40) log.delete(log.keys().next().value);
  }

  // Commands only the host issues (a player leaving); clients may never send them.
  FG.cmds._leave = (g, p, a) => g.removePlayer(a.id);

  // A player id that stays the same across visits from this browser.
  net.playerId = function () {
    let id = null;
    try { id = localStorage.getItem('cogworks-player-id'); } catch (e) { /* storage blocked */ }
    if (!id) {
      id = 'u' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem('cogworks-player-id', id); } catch (e) { /* storage blocked */ }
    }
    return id;
  };
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24) || 'Engineer';
  net.cleanName = cleanName;

  // ------------------------------------------------------------------ host
  class Host {
    constructor(env, opts) {
      this.env = env;
      this.role = 'host';
      this.pid = opts.pid;
      this.world = cleanName(opts.world || 'Factory');
      this.clients = new Map(); // link -> {link, pid, name, color, state: 'hello'|'joining'|'ready', kind}
      this.queue = []; // [pid, cmd] waiting for the next tick
      this.out = []; // [tick, pid, cmd] run since the last flush
      this.hashes = []; // [tick, hash] since the last flush
      this.acc = 0;
      this.hashLog = new Map(); // recent tick -> hash (for checking and tests)
      this.syncs = 0;
      this.syncing = false;
      this.needSync = false;
      this.lastSync = -1e9;
      this.resyncAt = 0;
      this.ended = false;
      this.now = () => (env.now ? env.now() : Date.now());
      const g = env.getGame();
      // The host plays as their browser's player id (so a saved world knows them next time).
      if (g.local.id !== this.pid) {
        const k = g.offline.findIndex((p) => p.id === this.pid);
        if (k >= 0) g.offline.splice(k, 1);
        g.local.id = this.pid;
      }
      g.local.name = cleanName(opts.name || g.local.name);
      if (opts.color) g.local.color = opts.color;
      // Players left over from an earlier session wait offline until they come back.
      for (const p of g.players.slice()) if (p !== g.local) g.removePlayer(p.id);
    }
    get game() { return this.env.getGame(); }

    // A new connection (from netlink.js). It must say hello first.
    accept(link) {
      const c = { link, state: 'hello', pid: null, name: '', color: null, kind: link.kind || 'link', rate: 0, rateAt: 0 };
      this.clients.set(link, c);
      link.onmessage = (m) => this.onMessage(c, m);
      link.onclose = (why) => this.drop(c, why || 'disconnected');
      // Nobody should hang around without saying who they are.
      c.timer = setTimeout(() => { if (c.state === 'hello') { this.send(c, { k: 'kick', why: 'No hello from this player' }); this.drop(c, 'no hello'); } }, 15000);
    }
    send(c, m) { try { c.link.send(m); } catch (e) { this.drop(c, 'send failed'); } }

    onMessage(c, m) {
      if (!m || typeof m !== 'object' || this.ended) return;
      switch (m.k) {
        case 'hello': {
          if (c.state !== 'hello') return;
          clearTimeout(c.timer);
          if (m.v !== PROTO) { this.send(c, { k: 'kick', why: 'That copy of the game is a different version: reload both pages' }); this.drop(c, 'version'); return; }
          const g = this.game;
          if (g.players.length + this.joining().length >= MAX_PLAYERS) { this.send(c, { k: 'kick', why: 'This world is full (' + MAX_PLAYERS + ' players)' }); this.drop(c, 'full'); return; }
          // Two tabs of one browser share an id: give the second its own.
          let pid = String(m.id || 'guest').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'guest';
          const taken = (id) => id === this.pid || g.players.some((p) => p.id === id) || Array.from(this.clients.values()).some((o) => o !== c && o.pid === id);
          if (taken(pid)) { let k = 2; while (taken(pid + '-' + k)) k++; pid = pid + '-' + k; }
          c.pid = pid;
          c.name = cleanName(m.name);
          const used = new Set(g.players.map((p) => p.color).concat(this.joining().map((o) => o.color)));
          c.color = FG.PLAYER_COLORS.find((col) => !used.has(col)) || FG.PLAYER_COLORS[0];
          c.state = 'joining';
          this.send(c, { k: 'welcome', pid, world: this.world, host: g.local.name });
          this.needSync = true;
          this.env.toast(c.name + ' is joining…', 'info');
          this.env.onPlayers();
          break;
        }
        case 'c': {
          if (c.state !== 'ready' || !m.c || typeof m.c.t !== 'string' || m.c.t[0] === '_' || !FG.cmds[m.c.t]) return;
          // A flood of commands is a bug or abuse: cap it.
          const now = this.now();
          if (now - c.rateAt > 1000) { c.rateAt = now; c.rate = 0; }
          if (++c.rate > 400) return;
          this.queue.push([c.pid, m.c]);
          break;
        }
        case 'desync':
          // Resync soon, but not more than once every few seconds.
          if (c.state === 'ready' && !this.resyncAt) { this.resyncAt = Math.max(this.now(), this.lastSync + 3000); this.env.toast('Resyncing ' + c.name + '’s copy of the world', 'info'); }
          break;
        case 'ping': this.send(c, { k: 'pong', t: m.t }); break;
        case 'bye': this.drop(c, 'left'); break;
      }
    }
    joining() { return Array.from(this.clients.values()).filter((c) => c.state === 'joining'); }
    ready() { return Array.from(this.clients.values()).filter((c) => c.state === 'ready'); }

    drop(c, why) {
      if (!this.clients.has(c.link)) return;
      clearTimeout(c.timer);
      this.clients.delete(c.link);
      try { c.link.close(); } catch (e) { /* already closed */ }
      if (c.pid && this.game.playerById(c.pid)) {
        // Everyone removes the player on the same tick.
        this.queue.push([this.pid, { t: '_leave', a: { id: c.pid } }]);
        this.env.toast(c.name + ' left' + (why && why !== 'left' ? ' (' + why + ')' : ''), 'info');
      }
      this.env.onPlayers();
    }

    // Your own actions: run on the next tick like everyone else's.
    command(cmd) { if (!this.ended) this.queue.push([this.pid, cmd]); }

    // Called once per frame by the main loop.
    update(dt) {
      if (this.ended || this.syncing) return;
      if (this.resyncAt && this.now() >= this.resyncAt) { this.resyncAt = 0; this.needSync = true; }
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 5 && !this.syncing) { this.env.inputTick(); this.step(); this.acc -= STEP; n++; }
      if (n >= 5) this.acc = 0;
      this.flush();
    }
    step() {
      if (this.needSync) { this.sync(); return; }
      const g = this.game, T = g.tick;
      if (T % HASH_EVERY === 0) { const hh = net.hash(g); this.hashes.push([T, hh]); logHash(this.hashLog, T, hh); }
      const q = this.queue;
      this.queue = [];
      for (const [pid, cmd] of q) { FG.runCmd(g, pid, cmd); this.out.push([T, pid, cmd]); }
      g.step();
    }
    // Tell everyone how far to run, with the commands to run on the way.
    flush() {
      const g = this.game;
      if (!g) return;
      const ready = this.ready();
      if (ready.length) {
        const m = { k: 't', to: g.tick, c: this.out };
        if (this.hashes.length) m.h = this.hashes;
        for (const c of ready) this.send(c, m);
      }
      this.out = [];
      this.hashes = [];
    }

    // Everyone (host included) reloads one snapshot: new players join the world here.
    async sync() {
      this.syncing = true;
      this.needSync = false;
      this.resyncAt = 0;
      this.lastSync = this.now();
      this.syncs++;
      this.flush();
      const g = this.game;
      const joining = this.joining();
      for (const c of joining) g.addPlayer(c.pid, c.name, c.color);
      // Anyone the world knows who is no longer connected goes offline.
      const live = new Set([this.pid].concat(Array.from(this.clients.values()).filter((c) => c.state !== 'hello').map((c) => c.pid)));
      for (const p of g.players.slice()) if (!live.has(p.id)) g.removePlayer(p.id);
      const json = FG.save.serialize(g);
      const g2 = FG.save.deserialize(json);
      g2.local = g2.player = g2.playerById(this.pid) || g2.players[0];
      this.env.setGame(g2, 'sync');
      let packed;
      try { packed = await this.env.pack(json); } catch (e) { packed = 'raw:' + json; }
      if (this.ended) return;
      for (const c of joining) if (this.clients.has(c.link)) { c.state = 'ready'; this.env.toast(c.name + ' joined', 'good'); }
      for (const c of this.ready()) this.send(c, { k: 'snap', tick: g2.tick, data: packed });
      this.syncing = false;
      this.acc = 0;
      this.env.onPlayers();
    }

    // Everyone in this session: [{pid, name, color, you, state}]
    roster() {
      const g = this.game, out = [];
      for (const p of g.players) out.push({ pid: p.id, name: p.name, color: p.color, you: p.id === this.pid, host: p.id === this.pid });
      for (const c of this.joining()) out.push({ pid: c.pid, name: c.name, color: c.color, joining: true });
      return out;
    }

    end(why) {
      if (this.ended) return;
      this.ended = true;
      for (const c of Array.from(this.clients.values())) { this.send(c, { k: 'bye', why: why || 'The host closed the world' }); clearTimeout(c.timer); try { c.link.close(); } catch (e) { /* closed */ } }
      this.clients.clear();
      const g = this.game;
      if (g) for (const p of g.players.slice()) if (p !== g.local) g.removePlayer(p.id);
    }
  }
  net.Host = Host;

  // ---------------------------------------------------------------- client
  class Client {
    constructor(env, link, opts) {
      this.env = env;
      this.role = 'client';
      this.link = link;
      this.id = opts.pid;
      this.name = cleanName(opts.name);
      this.pid = null;
      this.world = '';
      this.hostName = '';
      this.ready = false;
      this.allowed = 0;
      this.q = []; // [tick, pid, cmd] to run
      this.hostHash = new Map(); // tick -> hash
      this.myHash = new Map();
      this.acc = 0;
      this.inbox = [];
      this.busy = false;
      this.ended = false;
      this.desyncAt = -1e9;
      this.desyncs = 0;
      this.hashLog = new Map();
      this.lag = 0;
      this.now = () => (env.now ? env.now() : Date.now());
      link.onmessage = (m) => { this.inbox.push(m); this.pump(); };
      link.onclose = (why) => this.finish(why ? 'Lost the connection to the host (' + why + ')' : 'Lost the connection to the host');
      link.send({ k: 'hello', v: PROTO, id: this.id, name: this.name });
    }
    get game() { return this.env.getGame(); }

    // Messages are handled one at a time, in order (loading a snapshot takes a moment).
    async pump() {
      if (this.busy) return;
      this.busy = true;
      try {
        while (this.inbox.length && !this.ended) await this.handle(this.inbox.shift());
      } catch (e) { console.error('multiplayer message failed', e); }
      this.busy = false;
    }
    async handle(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.k) {
        case 'welcome':
          this.pid = String(m.pid);
          this.world = cleanName(m.world);
          this.hostName = cleanName(m.host);
          this.env.onPlayers();
          break;
        case 'snap': {
          const json = await this.env.unpack(m.data);
          const g = FG.save.deserialize(json);
          const me = g.playerById(this.pid);
          if (!me) throw new Error('snapshot has no player ' + this.pid);
          g.local = g.player = me;
          this.q = this.q.filter((r) => r[0] >= g.tick);
          this.hostHash.clear(); this.myHash.clear();
          this.allowed = Math.max(g.tick, this.allowed);
          const first = !this.ready;
          this.ready = true;
          this.acc = 0;
          this.env.setGame(g, first ? 'joined' : 'sync');
          this.env.onPlayers();
          break;
        }
        case 't':
          if (!this.ready) return;
          for (const r of m.c || []) this.q.push(r);
          if (m.to > this.allowed) this.allowed = m.to;
          for (const [t, hsh] of m.h || []) { this.hostHash.set(t, hsh); this.compare(t); }
          if (m.c && m.c.some((r) => r[2] && r[2].t === '_leave')) setTimeout(() => this.env.onPlayers(), 0);
          break;
        case 'kick': this.finish(m.why || 'The host turned you away'); break;
        case 'bye': this.finish(m.why || 'The host closed the world'); break;
        case 'pong': this.lag = this.now() - m.t; break;
      }
    }
    compare(t) {
      if (!this.hostHash.has(t) || !this.myHash.has(t)) return;
      const ok = this.hostHash.get(t) === this.myHash.get(t);
      this.hostHash.delete(t); this.myHash.delete(t);
      if (!ok) this.desyncs++;
      if (!ok && this.now() - this.desyncAt > 3000) {
        this.desyncAt = this.now();
        console.warn('world out of step at tick ' + t + ': asking the host for a fresh copy');
        this.link.send({ k: 'desync', t });
      }
    }

    command(cmd) { if (this.ready && !this.ended) this.link.send({ k: 'c', c: cmd }); }

    update(dt) {
      if (!this.ready || this.ended || this.busy) return;
      const g = this.game;
      const behind = this.allowed - g.tick;
      if (behind <= 0) { this.acc = 0; return; }
      this.acc += dt;
      let n = Math.floor(this.acc / STEP);
      // Fallen behind the host (a slow frame, a hiccup): catch up quickly.
      if (behind > 8) n = Math.max(n, Math.min(behind - 2, 30));
      n = Math.min(n, behind, 30);
      for (let i = 0; i < n; i++) { this.env.inputTick(); this.step(); }
      this.acc = FG.clamp(this.acc - n * STEP, 0, STEP * 2);
      if (this.now() - (this.pingAt || 0) > 2000) { this.pingAt = this.now(); this.link.send({ k: 'ping', t: this.pingAt }); }
    }
    step() {
      const g = this.game, T = g.tick;
      if (T % HASH_EVERY === 0) { const hh = net.hash(g); this.myHash.set(T, hh); logHash(this.hashLog, T, hh); this.compare(T); }
      while (this.q.length && this.q[0][0] < T) this.q.shift(); // from before a snapshot
      while (this.q.length && this.q[0][0] === T) { const r = this.q.shift(); FG.runCmd(g, r[1], r[2]); }
      g.step();
      if (this.myHash.size > 8) for (const k of Array.from(this.myHash.keys()).slice(0, this.myHash.size - 8)) this.myHash.delete(k);
    }

    roster() {
      const g = this.game;
      if (!g || !this.ready) return [];
      return g.players.map((p) => ({ pid: p.id, name: p.name, color: p.color, you: p.id === this.pid, host: false }));
    }

    finish(why) {
      if (this.ended) return;
      this.ended = true;
      try { this.link.close(); } catch (e) { /* closed */ }
      this.env.onEnd(why);
    }
    end() {
      if (this.ended) return;
      try { this.link.send({ k: 'bye' }); } catch (e) { /* closed */ }
      this.ended = true;
      try { this.link.close(); } catch (e) { /* closed */ }
    }
  }
  net.Client = Client;

  // An in-memory pair of links (tests, and two players in one page).
  net.localPair = function (delay) {
    const mk = () => ({ kind: 'local', onmessage: null, onclose: null, closed: false });
    const a = mk(), b = mk();
    const deliver = (to, m) => {
      const copy = JSON.parse(JSON.stringify(m));
      const go = () => { if (!to.closed && to.onmessage) to.onmessage(copy); };
      if (delay) setTimeout(go, delay); else queueMicrotask(go);
    };
    a.send = (m) => { if (!a.closed) deliver(b, m); };
    b.send = (m) => { if (!b.closed) deliver(a, m); };
    const close = (x, y) => () => { if (x.closed) return; x.closed = y.closed = true; queueMicrotask(() => { if (y.onclose) y.onclose('closed'); }); };
    a.close = close(a, b); b.close = close(b, a);
    return [a, b];
  };
  void D;
})();
