// Cogworks Frontier — multiplayer client: connects to the lobby server, hosts or joins a
// world, and keeps the local copy of it in lockstep (see lockstep.js and server/).
(function () {
  'use strict';
  const STEP = 1000 / FG.TICKS;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('cogworks-mp-' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cogworks-mp-' + k, v); } catch (e) { /* private mode */ } },
  };
  const COLORS = ['#e07a2a', '#3f8fd8', '#5fbf4a', '#d84a8a', '#e0c02a', '#8a5ad8', '#2ac0b0', '#e05040'];

  async function gunzip(buf) {
    const ds = new DecompressionStream('gzip');
    return await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
  }

  class Net {
    constructor(app) {
      this.app = app;
      this.ws = null;
      this.live = false;       // playing in a lobby
      this.lobby = null;       // listing of the lobby we are in
      this.owner = false;
      this.roster = [];
      this.chat = [];
      this.rtt = 0;
      this.acc = 0;
      this.seq = 0;
      this.cbs = new Map();
      this.lastIn = null;
      this.lastInKey = '';
      this.lastAimAt = 0;
      this.pendingSnap = null;
      this.waiter = null;      // { resolve, reject } for create/join
      this.joinArgs = null;    // to rejoin after a dropped connection
      this.ls = new FG.Lockstep({
        onReplace: (g) => this.onReplace(g),
        onDesync: (t) => { this.resyncs = (this.resyncs || 0) + 1; this.sendRaw({ type: 'resync', why: 'checksum at tick ' + t }); },
        onResult: (q, r) => { const cb = this.cbs.get(q); if (cb) { this.cbs.delete(q); try { cb(r); } catch (e) { console.error(e); } } },
      });
      let token = LS.get('token', '');
      if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); LS.set('token', token); }
      this.token = token;
      setInterval(() => this.ping(), 2000);
    }

    // ------------------------------------------------------------ settings
    get profile() {
      return { name: LS.get('name', ''), color: LS.get('color', COLORS[(this.token.charCodeAt(0) + this.token.charCodeAt(1)) % COLORS.length]) };
    }
    setProfile(name, color) { LS.set('name', String(name || '').slice(0, 20)); if (color) LS.set('color', color); }
    get colors() { return COLORS; }
    // Which server to use: the one serving the page, unless the player chose another.
    get server() {
      const saved = LS.get('server', '');
      if (saved) return saved;
      if (location.protocol === 'http:' || location.protocol === 'https:') return location.host;
      return '';
    }
    setServer(s) { LS.set('server', String(s || '').trim().replace(/^\w+:\/\//, '').replace(/\/.*$/, '')); }
    httpBase() { return (location.protocol === 'https:' ? 'https://' : 'http://') + this.server; }
    wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + this.server + '/ws'; }

    async fetchLobbies() {
      if (!this.server) throw new Error('Choose a server first');
      const r = await fetch(this.httpBase() + '/api/lobbies', { cache: 'no-store' });
      if (!r.ok) throw new Error('The server answered ' + r.status);
      return r.json();
    }

    // ---------------------------------------------------------- connection
    connect() {
      if (this.ws && this.ws.readyState === 1 && this.hello) return Promise.resolve();
      if (this.connecting) return this.connecting;
      this.connecting = new Promise((resolve, reject) => {
        let ws;
        try { ws = new WebSocket(this.wsUrl()); } catch (e) { this.connecting = null; reject(new Error('Cannot reach ' + this.server)); return; }
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        this.hello = false;
        const fail = () => { this.connecting = null; reject(new Error('Could not connect to ' + this.server)); };
        ws.onerror = fail;
        ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: this.token }));
        ws.onmessage = (ev) => {
          if (!this.hello) {
            const m = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
            if (m && m.type === 'hello') { this.hello = true; this.connecting = null; ws.onerror = null; resolve(); }
            return;
          }
          this.onMessage(ev.data);
        };
        ws.onclose = () => { if (this.ws === ws) this.onClosed(); };
      });
      return this.connecting;
    }
    sendRaw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

    // Host a world: opts { name, access, password, world | save }.
    async host(opts) {
      await this.connect();
      this.joinArgs = null;
      const p = this.profile;
      this.sendRaw(Object.assign({ type: 'create', player: { name: p.name || 'Engineer', color: p.color } }, opts));
      return this.waitJoin();
    }
    async join(id, password) {
      await this.connect();
      const p = this.profile;
      this.joinArgs = { id, password };
      this.sendRaw({ type: 'join', id, password, player: { name: p.name || 'Engineer', color: p.color } });
      return this.waitJoin();
    }
    waitJoin() {
      return new Promise((resolve, reject) => {
        this.waiter = { resolve, reject };
        setTimeout(() => { if (this.waiter && this.waiter.resolve === resolve) { this.waiter = null; reject(new Error('The server took too long to answer')); } }, 30000);
      });
    }
    leave() {
      this.sendRaw({ type: 'leave' });
      this.live = false;
      this.lobby = null;
      this.joinArgs = null;
      this.ls.g = null;
      this.ls.frames.clear();
      this.ls.u = -1; this.ls.skip = -1;
      this.roster = [];
      this.chat = [];
    }
    closeLobby() { this.sendRaw({ type: 'close' }); }
    say(text) { text = String(text || '').trim(); if (text) this.sendRaw({ type: 'chat', text }); }

    onClosed() {
      this.hello = false;
      if (!this.live) return;
      // Try to get back into the same world once; otherwise go back to the title screen.
      const args = this.joinArgs || (this.lobby ? { id: this.lobby.id } : null);
      this.live = false;
      this.app.ui.toast('Lost the connection to the server. Reconnecting…', 'warn');
      setTimeout(async () => {
        try {
          if (!args) throw new Error('no lobby');
          await this.join(args.id, args.password);
          this.app.ui.toast('Reconnected', 'good');
        } catch (e) {
          this.app.ui.toast('Could not reconnect: ' + e.message, 'bad');
          this.leave();
          this.app.showTitle();
        }
      }, 1200);
    }

    onMessage(data) {
      if (typeof data !== 'string') { this.onSnapshot(data); return; }
      const m = JSON.parse(data);
      switch (m.type) {
        case 'f': this.ls.addFrames(m.f, m.u); break;
        case 'snap': this.pendingSnap = m; break;
        case 'joined': this.lobby = m.lobby; this.owner = !!m.owner; this.ls.pid = m.pid; break;
        case 'pong': this.rtt = Math.round(performance.now() - m.t); break;
        case 'roster': this.roster = m.players; break;
        case 'chat':
          this.chat.push({ name: m.name, color: m.color, text: m.text, at: performance.now() });
          if (this.chat.length > 50) this.chat.shift();
          if (this.app.ui.onChat) this.app.ui.onChat();
          FG.sfx && FG.sfx.play && FG.sfx.play('alert');
          break;
        case 'error':
          if (this.waiter) { const w = this.waiter; this.waiter = null; const err = new Error(m.msg); err.code = m.code; w.reject(err); }
          else this.app.ui.toast(m.msg, 'bad');
          break;
        case 'kicked': case 'closed':
          this.app.ui.toast(m.reason || 'You left the world', 'warn');
          this.leave();
          this.app.showTitle();
          break;
      }
    }
    async onSnapshot(buf) {
      const meta = this.pendingSnap;
      this.pendingSnap = null;
      if (!meta) return;
      let json;
      try { json = await gunzip(buf); } catch (e) { this.app.ui.toast('Could not read the world from the server', 'bad'); return; }
      const first = !this.live;
      const g = this.ls.load(json, meta.tick, meta.pid);
      this.acc = 0;
      this.lastInKey = '';
      if (first) {
        this.live = true;
        this.app.startGame(g, { mp: true });
        if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(this.lobby); }
      }
    }
    onReplace(g) { if (this.live && this.app.game !== g) this.app.replaceGame(g); }

    // ------------------------------------------------------------- playing
    send(c, cb) {
      const q = ++this.seq;
      if (cb) { this.cbs.set(q, cb); if (this.cbs.size > 500) this.cbs.delete(this.cbs.keys().next().value); }
      this.sendRaw({ type: 'c', c, q });
    }
    // Movement and aim: send when something changes (aim at most ~12 times a second).
    setInput(inp) {
      const key = inp.mx + ',' + inp.my + ',' + (inp.sh ? 1 : 0) + ',' + (inp.mine ? inp.mine.key : '') + ',' + inp.rep;
      const now = performance.now();
      const last = this.lastIn;
      const aimMoved = !last || Math.abs(inp.ax - last.ax) + Math.abs(inp.ay - last.ay) > 0.4;
      if (key !== this.lastInKey || (aimMoved && now - this.lastAimAt > 80)) {
        this.lastInKey = key;
        this.lastIn = inp;
        this.lastAimAt = now;
        inp.ax = Math.round(inp.ax * 100) / 100; inp.ay = Math.round(inp.ay * 100) / 100;
        this.send(inp);
      }
    }
    // Run the local world toward the server's tick. Called every animation frame.
    step(dt) {
      const ls = this.ls;
      if (!ls.g || ls.stalled || this.hold) return;
      const lag = ls.lag;
      if (lag > 60 * 45) { ls.stalled = true; this.sendRaw({ type: 'resync', why: 'fell behind' }); return; }
      this.acc = Math.min(this.acc + dt, STEP * 4);
      let n = Math.floor(this.acc / STEP);
      this.acc -= n * STEP;
      if (lag > 3) n += Math.ceil((lag - 3) / 5);
      if (lag > 300) n = Math.min(lag, 600);
      n = Math.min(n, lag);
      if (n > 0) ls.advance(n);
    }
    ping() { if (this.ws && this.ws.readyState === 1 && this.hello) this.sendRaw({ type: 'ping', t: performance.now(), rtt: this.rtt }); }
  }
  FG.Net = Net;
})();
