// Cogworks Frontier multiplayer server.
//
// Serves the game's files and hosts lobbies: worlds that players create (from a new map or
// one of their saves) and others join, publicly or with a password. The server runs each
// lobby's world itself at 60 ticks a second. Players send commands; the server stamps each
// with the tick it happens on and relays them to everyone in the lobby, so every browser
// runs an identical copy of the world (lockstep). Checksums catch a copy that drifts, and
// that player reloads from the server's world.
//
// Usage: node server/server.js   (PORT, HOST and DATA_DIR from the environment)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const ws = require('./ws');
const { loadFG } = require('./sim');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const LOBBY_DIR = path.join(DATA_DIR, 'lobbies');

const TICKS = 60;
const STEP_MS = 1000 / TICKS;
const HASH_EVERY = 120;          // ticks between checksums
const MAX_PLAYERS = 8;
const MAX_LOBBIES = 24;
const MAX_LOBBIES_PER_OWNER = 3;
const SAVE_EVERY_MS = 5 * 60 * 1000;
const SLEEP_AFTER_MS = 60 * 1000;         // an empty lobby is saved and unloaded after this
const EXPIRE_AFTER_MS = 14 * 24 * 3600 * 1000; // lobbies nobody visits for this long are deleted
const CLIENT_CMDS_PER_SEC = 150;
const SIZES = [384, 512, 768];
const COLORS = ['#e07a2a', '#3f8fd8', '#5fbf4a', '#d84a8a', '#e0c02a', '#8a5ad8', '#2ac0b0', '#e05040'];

fs.mkdirSync(LOBBY_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const rid = (n) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n);

// ------------------------------------------------------------------ passwords
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 32).toString('hex'); }
function checkPass(lobby, pass) {
  if (lobby.access !== 'password') return true;
  const h = Buffer.from(hashPass(pass || '', lobby.salt), 'hex');
  const want = Buffer.from(lobby.passHash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

// --------------------------------------------------------------------- lobbies
const lobbies = new Map(); // id -> Lobby

class Lobby {
  constructor(meta) {
    this.id = meta.id;
    this.name = meta.name;
    this.owner = meta.owner;         // owner's client token
    this.ownerName = meta.ownerName;
    this.access = meta.access;       // 'public' | 'password'
    this.salt = meta.salt || null;
    this.passHash = meta.passHash || null;
    this.created = meta.created || Date.now();
    this.lastActive = meta.lastActive || Date.now();
    this.tokens = new Map(meta.tokens || []); // client token -> player id
    this.pidCounter = meta.pidCounter || 2;
    this.info = meta.info || {};    // seed, size, enemies for the list
    this.FG = null;
    this.g = null;
    this.clients = new Set();
    this.queue = [];                 // [pid, command, seq] waiting for the next tick
    this.out = [];                   // frames to broadcast
    this.pendingSnap = new Set();    // clients waiting for a snapshot (joining or resyncing)
    this.normalize = false;
    this.lastSave = Date.now();
    this.emptySince = Date.now();
    this.startedAt = 0;
    this.ticksRun = 0;
  }
  meta() {
    return {
      id: this.id, name: this.name, owner: this.owner, ownerName: this.ownerName, access: this.access,
      salt: this.salt, passHash: this.passHash, created: this.created, lastActive: this.lastActive,
      tokens: Array.from(this.tokens.entries()), pidCounter: this.pidCounter, info: this.info,
    };
  }
  listing() {
    const g = this.g;
    return {
      id: this.id, name: this.name, host: this.ownerName, access: this.access,
      players: this.clients.size, max: MAX_PLAYERS,
      names: Array.from(this.clients).map((c) => c.name).slice(0, MAX_PLAYERS),
      seed: this.info.seed, size: this.info.size, enemies: this.info.enemies,
      played: g ? g.tick : this.info.tick || 0, awake: !!g, created: this.created,
    };
  }
  file(ext) { return path.join(LOBBY_DIR, this.id + ext); }
  // World state as a JSON string (the same format as a browser save).
  snapshot() { return this.FG.save.serialize(this.g); }
  save() {
    if (!this.g) return;
    const json = this.snapshot();
    this.info.tick = this.g.tick;
    writeAtomic(this.file('.save.gz'), zlib.gzipSync(json));
    writeAtomic(this.file('.json'), JSON.stringify(this.meta()));
    this.lastSave = Date.now();
  }
  saveMeta() { writeAtomic(this.file('.json'), JSON.stringify(this.meta())); }
  // Load the world into memory (from disk if it was asleep).
  wake() {
    if (this.g) return;
    this.FG = loadFG();
    const json = zlib.gunzipSync(fs.readFileSync(this.file('.save.gz'))).toString('utf8');
    this.setGame(this.FG.save.deserialize(json));
  }
  setGame(g) {
    this.g = g;
    g.localPid = -1; // the server has no player of its own
    for (const p of g.players.values()) p.away = true;
    this.pidCounter = Math.max(this.pidCounter, g.nextPid);
    this.info.tick = g.tick;
    this.startedAt = Date.now();
    this.ticksRun = 0;
  }
  sleep() {
    if (!this.g) return;
    this.save();
    this.g = null;
    this.FG = null;
    log('lobby', this.id, 'asleep');
  }
  broadcast(msg) { const s = JSON.stringify(msg); for (const c of this.clients) if (c.ready) c.sock.send(s); }

  // Run the ticks that are due. Called by the main loop.
  run(now) {
    const g = this.g;
    if (!g || !this.clients.size) return;
    let due = Math.floor((now - this.startedAt) / STEP_MS) - this.ticksRun;
    if (due > 12) { this.startedAt += (due - 12) * STEP_MS; due = 12; } // overloaded: slow down rather than spiral
    for (let k = 0; k < due; k++) this.tick();
    this.ticksRun += Math.max(0, due);
    this.flush();
  }
  tick() {
    const FG = this.FG;
    let g = this.g;
    const T = g.tick;
    const frame = [T, this.queue.splice(0)];
    let flags = 0;
    if (T % HASH_EVERY === 0) frame[2] = FG.stateHash(g);
    // Run a copy: a handler may keep parts of a command, and the frame goes out afterwards.
    for (const [pid, c] of frame[1]) FG.cmd.exec(g, pid, JSON.parse(JSON.stringify(c)));
    let snap = null;
    if (this.normalize || this.pendingSnap.size) {
      // Everyone rebuilds the world from its save at this tick, so a joining (or drifted)
      // player's copy, loaded from the same save, matches everyone else's exactly.
      flags |= 1;
      snap = this.snapshot();
      g = this.g = FG.save.deserialize(snap);
      g.localPid = -1;
      this.normalize = false;
    }
    if (flags) frame[3] = flags;
    if (frame[1].length || frame[2] !== undefined || flags) this.out.push(frame);
    if (snap) this.sendSnapshots(snap, T);
    g.step();
    if (Date.now() - this.lastSave > SAVE_EVERY_MS) { try { this.save(); } catch (e) { log('save failed', this.id, e.message); } }
  }
  sendSnapshots(json, T) {
    const gz = zlib.gzipSync(json);
    for (const c of this.pendingSnap) {
      if (!this.clients.has(c)) continue;
      // Frames up to T are already in the snapshot; the client skips them.
      c.sock.send(JSON.stringify({ type: 'snap', tick: T, pid: c.pid, bytes: gz.length }));
      c.sock.send(gz);
      c.ready = true;
    }
    this.pendingSnap.clear();
  }
  flush() {
    const msg = JSON.stringify({ type: 'f', f: this.out, u: this.g.tick });
    this.out = [];
    for (const c of this.clients) if (c.ready) c.sock.send(msg);
  }

  join(c, player) {
    this.wake();
    let pid = this.tokens.get(c.token);
    if (!pid) { pid = this.pidCounter++; this.tokens.set(c.token, pid); }
    // One connection per player: a second tab takes over from the first.
    for (const o of this.clients) if (o.pid === pid) { o.sock.send(JSON.stringify({ type: 'kicked', reason: 'You joined this world from another tab' })); this.drop(o); o.lobby = null; }
    c.lobby = this;
    c.pid = pid;
    c.ready = false;
    c.name = player.name;
    this.clients.add(c);
    if (this.clients.size === 1) { this.startedAt = Date.now(); this.ticksRun = 0; }
    this.queue.push([0, { t: 'join', pid, name: player.name, color: player.color }]);
    this.pendingSnap.add(c);
    this.lastActive = Date.now();
    this.saveMeta();
    c.sock.send(JSON.stringify({ type: 'joined', lobby: this.listing(), pid, owner: c.token === this.owner }));
    log('lobby', this.id, 'join', player.name, 'pid', pid, 'players', this.clients.size);
  }
  drop(c) {
    if (!this.clients.has(c)) return;
    this.clients.delete(c);
    this.pendingSnap.delete(c);
    if (this.g) this.queue.push([0, { t: 'leave', pid: c.pid }]);
    this.lastActive = Date.now();
    if (!this.clients.size) {
      this.emptySince = Date.now();
      // Apply the leave before stopping, so the saved world has the player gone.
      if (this.g) { this.tick(); this.out = []; }
      try { this.save(); } catch (e) { log('save failed', this.id, e.message); }
    }
    log('lobby', this.id, 'leave pid', c.pid, 'players', this.clients.size);
  }
  close(reason) {
    for (const c of this.clients) { c.sock.send(JSON.stringify({ type: 'closed', reason })); c.lobby = null; }
    this.clients.clear();
    lobbies.delete(this.id);
    for (const ext of ['.json', '.save.gz']) fs.rm(this.file(ext), { force: true }, () => {});
    log('lobby', this.id, 'closed:', reason);
  }
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// Lobbies survive restarts: they come back asleep and wake when someone joins.
function restoreLobbies() {
  for (const f of fs.readdirSync(LOBBY_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(LOBBY_DIR, f), 'utf8'));
      if (!fs.existsSync(path.join(LOBBY_DIR, meta.id + '.save.gz'))) continue;
      lobbies.set(meta.id, new Lobby(meta));
    } catch (e) { log('could not restore', f, e.message); }
  }
  log('restored', lobbies.size, 'lobbies');
}

// ------------------------------------------------------------------- clients
function sendErr(c, msg, extra) { c.sock.send(JSON.stringify(Object.assign({ type: 'error', msg }, extra || {}))); }

function playerOf(m) {
  const p = m && m.player || {};
  const name = clean(p.name, 20) || 'Engineer';
  const color = typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  return { name, color };
}

function unpackSave(s) {
  if (typeof s !== 'string' || s.length > 20 * 1024 * 1024) throw new Error('Save is too large');
  if (s.startsWith('gz:')) return zlib.gunzipSync(Buffer.from(s.slice(3), 'base64')).toString('utf8');
  if (s.startsWith('raw:')) return s.slice(4);
  return s;
}

function createLobby(c, m) {
  if (lobbies.size >= MAX_LOBBIES) {
    // Make room by retiring the longest-idle empty lobby.
    const idle = Array.from(lobbies.values()).filter((l) => !l.clients.size).sort((a, b) => a.lastActive - b.lastActive)[0];
    if (!idle) return sendErr(c, 'The server is full. Try again later.');
    idle.close('Retired to make room');
  }
  if (Array.from(lobbies.values()).filter((l) => l.owner === c.token).length >= MAX_LOBBIES_PER_OWNER) return sendErr(c, 'You already host ' + MAX_LOBBIES_PER_OWNER + ' worlds. Close one first (Esc menu in that world).');
  const name = clean(m.name, 40) || 'Untitled world';
  const access = m.access === 'password' ? 'password' : 'public';
  const pass = String(m.password || '');
  if (access === 'password' && (pass.length < 1 || pass.length > 64)) return sendErr(c, 'Choose a password (up to 64 characters)');
  const player = playerOf(m);
  const FG = loadFG();
  let g;
  try {
    if (m.save) {
      const json = unpackSave(m.save);
      const data = JSON.parse(json);
      if (!data || !data.opts || SIZES.indexOf(data.opts.size) < 0) throw new Error('That save is not a Cogworks Frontier world');
      g = FG.save.deserialize(data);
    } else {
      const w = m.world || {};
      const size = SIZES.indexOf(w.size) >= 0 ? w.size : 512;
      const seed = (parseInt(w.seed, 10) >>> 0) || ((Math.random() * 1e6) | 0);
      const enemies = ['normal', 'peaceful', 'off'].indexOf(w.enemies) >= 0 ? w.enemies : 'normal';
      const richness = [0.6, 1, 2].indexOf(w.richness) >= 0 ? w.richness : 1;
      g = new FG.Game({ seed, size, enemies, richness });
      g.players.get(1).name = player.name;
    }
  } catch (e) {
    return sendErr(c, 'Could not create the world: ' + e.message);
  }
  const salt = access === 'password' ? rid(16) : null;
  const lobby = new Lobby({
    id: rid(8), name, owner: c.token, ownerName: player.name, access, salt,
    passHash: access === 'password' ? hashPass(pass, salt) : null,
    tokens: [[c.token, g.localPid > 0 ? g.localPid : 1]],
    info: { seed: g.opts.seed, size: g.opts.size, enemies: g.opts.enemies },
  });
  lobby.FG = FG;
  lobby.setGame(g);
  lobbies.set(lobby.id, lobby);
  lobby.save();
  log('lobby', lobby.id, 'created by', player.name, JSON.stringify(lobby.info), access);
  lobby.join(c, player);
}

function onMessage(c, text, binary) {
  if (binary) return;
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  switch (m.type) {
    case 'hello':
      c.token = clean(m.token, 64) || rid(16);
      c.sock.send(JSON.stringify({ type: 'hello', token: c.token }));
      return;
    case 'ping':
      c.rtt = typeof m.rtt === 'number' ? Math.max(0, Math.min(9999, m.rtt)) : c.rtt;
      c.sock.send(JSON.stringify({ type: 'pong', t: m.t }));
      return;
    case 'list':
      c.sock.send(JSON.stringify({ type: 'lobbies', list: publicList() }));
      return;
  }
  if (!c.token) return sendErr(c, 'Say hello first');
  switch (m.type) {
    case 'create':
      if (c.lobby) c.lobby.drop(c);
      return createLobby(c, m);
    case 'join': {
      const lobby = lobbies.get(String(m.id || ''));
      if (!lobby) return sendErr(c, 'That world is no longer hosted', { code: 'gone' });
      if (!checkPass(lobby, m.password)) return sendErr(c, 'Wrong password', { code: 'password' });
      if (lobby.clients.size >= MAX_PLAYERS && !Array.from(lobby.clients).some((o) => o.token === c.token)) return sendErr(c, 'That world is full');
      if (c.lobby) c.lobby.drop(c);
      try { lobby.join(c, playerOf(m)); } catch (e) { log('join failed', e.stack); sendErr(c, 'Could not load that world: ' + e.message); }
      return;
    }
    case 'leave':
      if (c.lobby) { c.lobby.drop(c); c.lobby = null; }
      return;
    case 'c': {
      const lobby = c.lobby;
      if (!lobby || !lobby.g || !c.ready) return;
      const cmd = m.c;
      if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') return;
      if (lobby.FG.cmd.SERVER_ONLY[cmd.t] || lobby.FG.cmd.types.indexOf(cmd.t) < 0) return;
      // Rate limit per connection.
      const now = Date.now();
      c.budget = Math.min(CLIENT_CMDS_PER_SEC, (c.budget || CLIENT_CMDS_PER_SEC) + ((now - (c.budgetAt || now)) / 1000) * CLIENT_CMDS_PER_SEC);
      c.budgetAt = now;
      if (c.budget < 1) return;
      c.budget--;
      lobby.queue.push([c.pid, cmd, typeof m.q === 'number' ? m.q : 0]);
      return;
    }
    case 'resync':
      // The player's copy of the world drifted: everyone rebuilds, and they reload ours.
      if (c.lobby && c.lobby.g && c.ready) { c.lobby.pendingSnap.add(c); c.ready = false; log('lobby', c.lobby.id, 'resync pid', c.pid, m.why || ''); }
      return;
    case 'chat': {
      const text2 = clean(m.text, 200);
      if (!text2 || !c.lobby) return;
      const now = Date.now();
      if (now - (c.lastChat || 0) < 400) return;
      c.lastChat = now;
      const p = c.lobby.g && c.lobby.g.players.get(c.pid);
      c.lobby.broadcast({ type: 'chat', pid: c.pid, name: c.name, color: p ? p.color : '#ccc', text: text2 });
      return;
    }
    case 'close': {
      const lobby = c.lobby;
      if (!lobby || lobby.owner !== c.token) return sendErr(c, 'Only the host can close this world');
      lobby.close('The host closed this world');
      return;
    }
  }
}

function publicList() {
  return Array.from(lobbies.values()).sort((a, b) => (b.clients.size - a.clients.size) || (b.lastActive - a.lastActive)).map((l) => l.listing());
}

// ---------------------------------------------------------------- HTTP server
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const STATIC = [/^\/index\.html$/, /^\/css\/[\w.-]+\.css$/, /^\/js\/[\w.-]+\.js$/, /^\/dist\/[\w.-]+\.html$/];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/api/lobbies') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ lobbies: publicList(), online: countOnline() }));
    return;
  }
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (p === '/' || p === '') p = '/index.html';
  if (!STATIC.some((r) => r.test(p))) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const conns = new Set();
function countOnline() { let n = 0; for (const l of lobbies.values()) n += l.clients.size; return n; }

server.on('upgrade', (req, sock) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { sock.destroy(); return; }
  const s = ws.accept(req, sock);
  if (!s) return;
  const c = { sock: s, token: null, lobby: null, pid: 0, ready: false, name: '', rtt: 0 };
  conns.add(c);
  s.on('message', (text, binary) => {
    try { onMessage(c, text, binary); } catch (e) { log('message error', e.stack); }
  });
  s.on('close', () => {
    conns.delete(c);
    if (c.lobby) { c.lobby.drop(c); c.lobby = null; }
  });
});

// ------------------------------------------------------------------ main loop
function loop() {
  const now = Date.now();
  for (const l of lobbies.values()) {
    try { l.run(now); } catch (e) {
      log('lobby', l.id, 'crashed:', e.stack);
      l.close('The world hit an error on the server and was closed');
    }
  }
}
setInterval(loop, 5);

// Player lists with pings, and housekeeping.
setInterval(() => {
  const now = Date.now();
  for (const l of lobbies.values()) {
    if (l.clients.size) {
      l.broadcast({ type: 'roster', players: Array.from(l.clients).map((c) => ({ pid: c.pid, name: c.name, ping: Math.round(c.rtt || 0), host: c.token === l.owner })) });
    } else {
      if (l.g && now - l.emptySince > SLEEP_AFTER_MS) l.sleep();
      if (now - l.lastActive > EXPIRE_AFTER_MS) l.close('Expired');
    }
  }
}, 2000);

function shutdown() {
  log('shutting down: saving lobbies');
  for (const l of lobbies.values()) { try { if (l.g) l.save(); } catch (e) { log('save failed', l.id, e.message); } }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

restoreLobbies();
server.listen(PORT, HOST, () => log('Cogworks Frontier server on http://' + HOST + ':' + PORT));
