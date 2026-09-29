// Multiplayer end-to-end test: starts the server, connects headless clients (each with its
// own copy of the simulation, like separate browsers) and checks lobbies, passwords,
// commands, checksums, drift recovery, rejoining and restarts.
// Usage: node tests/mp.test.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { load } = require('./harness');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cogworks-mp-'));
let server = null;
let failures = 0, passed = 0;
const check = (name, cond, info) => { if (cond) passed++; else failures++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info !== undefined ? '  ' + info : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { const v = fn(); if (v) return v; await sleep(20); }
  throw new Error('timed out waiting for ' + (what || 'condition'));
}

function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DATA }), stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { if (process.env.VERBOSE) process.stdout.write('[server] ' + d); });
  server.stderr.on('data', (d) => process.stdout.write('[server err] ' + d));
  return until(() => server.stdout.readable && serverUp, 5000, 'server').catch(() => {});
}
let serverUp = false;
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/healthz'); if (r.ok) { serverUp = true; return; } } catch (e) { /* not yet */ }
    await sleep(50);
  }
  throw new Error('server did not start');
}

// A headless player: the same lockstep code the browser uses.
class Client {
  constructor(name, token) {
    this.name = name;
    this.token = token;
    this.FG = load();
    this.ls = new this.FG.Lockstep({
      onDesync: (t, h, want) => { this.desyncs++; this.send({ type: 'resync', why: 'tick ' + t }); },
      onResult: (q, r) => { const cb = this.cbs.get(q); if (cb) { this.cbs.delete(q); cb(r); } },
    });
    this.desyncs = 0; this.snaps = 0; this.errors = []; this.chats = []; this.roster = null; this.cbs = new Map(); this.seq = 0;
    this.pendingSnap = null; this.lobby = null; this.closed = null; this.list = null;
  }
  get g() { return this.ls.g; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws'));
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.send({ type: 'hello', token: this.token }); };
      ws.onerror = (e) => reject(e);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          const json = zlib.gunzipSync(Buffer.from(ev.data)).toString('utf8');
          const s = this.pendingSnap; this.pendingSnap = null;
          this.ls.load(json, s.tick, s.pid);
          this.snaps++;
          return;
        }
        const m = JSON.parse(ev.data);
        if (m.type === 'hello') resolve();
        else if (m.type === 'snap') this.pendingSnap = m;
        else if (m.type === 'f') this.ls.addFrames(m.f, m.u);
        else if (m.type === 'joined') this.lobby = m;
        else if (m.type === 'error') this.errors.push(m);
        else if (m.type === 'chat') this.chats.push(m);
        else if (m.type === 'roster') this.roster = m.players;
        else if (m.type === 'closed') this.closed = m;
        else if (m.type === 'lobbies') this.list = m.list;
      };
      this.timer = setInterval(() => this.ls.advance(this.ls.lag > 8 ? 20 : 2), 16);
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  act(c, cb) { const q = ++this.seq; if (cb) this.cbs.set(q, cb); this.send({ type: 'c', c, q }); }
  close() { clearInterval(this.timer); this.ws.close(); }
  get me() { return this.g && this.g.players.get(this.ls.pid); }
}

async function listLobbies() { const r = await fetch('http://127.0.0.1:' + PORT + '/api/lobbies'); return (await r.json()).lobbies; }

(async () => {
  try {
    startServer(); await waitUp();
    console.log('Server on port ' + PORT);

    const a = new Client('Ada', 'tokenAda0001'), b = new Client('Bo', 'tokenBo00002');
    await a.connect(); await b.connect();

    // --- A hosts a public world
    a.send({ type: 'create', name: 'Ada\'s factory', access: 'public', world: { seed: 4242, size: 384, enemies: 'normal', richness: 1 }, player: { name: 'Ada', color: '#e07a2a' } });
    await until(() => a.g && a.snaps === 1, 15000, 'A snapshot');
    check('host gets a world', !!a.g && a.ls.pid === 1, 'pid ' + a.ls.pid);
    let list = await listLobbies();
    check('lobby is listed publicly', list.length === 1 && list[0].name === 'Ada\'s factory' && list[0].access === 'public' && list[0].players === 1, JSON.stringify(list[0]));

    // --- B joins
    b.send({ type: 'join', id: list[0].id, player: { name: 'Bo', color: '#3f8fd8' } });
    await until(() => b.g && b.snaps === 1, 15000, 'B snapshot');
    await until(() => a.g.players.size === 2 && !a.g.players.get(b.ls.pid).away, 5000, 'A sees B');
    check('joiner gets its own player', b.ls.pid === 2 && b.g.players.size === 2, 'pid ' + b.ls.pid);
    check('both see both names', a.g.players.get(2).name === 'Bo' && b.g.players.get(1).name === 'Ada');

    // --- both act: A walks right, B crafts and builds
    a.act({ t: 'in', mx: 1, my: 0, sh: false, ax: 0, ay: 0, mine: null, rep: 0 });
    let crafted = null;
    b.act({ t: 'craft', r: 'iron_gear', n: 2 }, (r) => { crafted = r; });
    await sleep(600);
    a.act({ t: 'in', mx: 0, my: 0, sh: false, ax: 0, ay: 0, mine: null, rep: 0 });
    await until(() => crafted !== null, 5000, 'craft result');
    check('command results come back to the sender', crafted === 2, 'crafted ' + crafted);
    const bx0 = b.g.players.get(1).x;
    await sleep(2500);
    check('B sees A walk', b.g.players.get(1).x > b.g.world.spawnX + 2, 'A.x on B = ' + b.g.players.get(1).x.toFixed(2) + ' (was ' + bx0.toFixed(2) + ')');
    check('B crafted gears (as seen by A)', a.g.players.get(2).inv.count('iron_gear') >= 2, 'gears ' + a.g.players.get(2).inv.count('iron_gear'));
    // Place a furnace near B.
    const bp = b.me;
    let built = null;
    b.act({ t: 'build', item: 'stone_furnace', x: Math.floor(bp.x) + 2, y: Math.floor(bp.y) + 2, dir: 0 }, (r) => { built = r; });
    await until(() => built !== null || b.errors.length, 5000, 'build');
    await sleep(300);
    check('building shows up for the other player', a.g.byKind.furnace && a.g.byKind.furnace.length === 1, JSON.stringify(built));

    // --- chat
    a.send({ type: 'chat', text: 'hello there' });
    await until(() => b.chats.length, 3000, 'chat');
    check('chat reaches the other player', b.chats[0].text === 'hello there' && b.chats[0].name === 'Ada');

    // --- checksums agree over time
    await sleep(3000);
    await until(() => a.g.tick === b.g.tick || Math.abs(a.ls.u - b.ls.u) < 3, 3000);
    const target = Math.min(a.ls.u, b.ls.u);
    a.ls.advance(target - a.g.tick); b.ls.advance(target - b.g.tick);
    check('no drift so far', a.desyncs === 0 && b.desyncs === 0, 'desyncs ' + a.desyncs + '/' + b.desyncs);
    check('identical worlds at the same tick', a.g.tick === b.g.tick && a.FG.stateHash(a.g) === b.FG.stateHash(b.g), 'tick ' + a.g.tick + '/' + b.g.tick);

    // --- drift recovery: corrupt B's copy
    const beforeSnaps = b.snaps;
    b.me.inv.add('iron_plate', 7);
    await until(() => b.snaps > beforeSnaps, 8000, 'resync');
    await sleep(2500);
    check('drifted player is detected and reloaded', b.desyncs >= 1 && b.snaps > beforeSnaps, 'desyncs ' + b.desyncs);
    check('reloaded copy matches again', b.me.inv.count('iron_plate') === a.g.players.get(2).inv.count('iron_plate'), b.me.inv.count('iron_plate') + ' vs ' + a.g.players.get(2).inv.count('iron_plate'));
    const d0 = b.desyncs;
    await sleep(3000);
    check('no further drift after reload', b.desyncs === d0 && a.desyncs === 0);

    // --- password lobby
    const c = new Client('Cy', 'tokenCy00003');
    await c.connect();
    c.send({ type: 'create', name: 'Secret base', access: 'password', password: 'hunter2', world: { seed: 7, size: 384, enemies: 'off' }, player: { name: 'Cy' } });
    await until(() => c.g, 15000, 'C world');
    list = await listLobbies();
    const sec = list.find((l) => l.name === 'Secret base');
    check('password lobby is listed as locked', sec && sec.access === 'password');
    check('listing never includes the password', !JSON.stringify(list).includes('hunter2'));
    const d = new Client('Di', 'tokenDi00004');
    await d.connect();
    d.send({ type: 'join', id: sec.id, password: 'wrong', player: { name: 'Di' } });
    await until(() => d.errors.length, 3000, 'wrong password');
    check('wrong password is refused', d.errors[0].code === 'password' && !d.g);
    d.send({ type: 'join', id: sec.id, password: 'hunter2', player: { name: 'Di' } });
    await until(() => d.g, 15000, 'D joins');
    check('right password lets you in', d.g.players.size === 2);

    // --- rejoin keeps your character
    const gearsBefore = a.g.players.get(2).inv.count('iron_gear');
    b.close();
    await until(() => a.g.players.get(2).away, 5000, 'B away');
    check('leaving marks the player away', a.g.players.get(2).away === true);
    const b2 = new Client('Bo', 'tokenBo00002');
    await b2.connect();
    b2.send({ type: 'join', id: list.find((l) => l.name === 'Ada\'s factory').id, player: { name: 'Bo' } });
    await until(() => b2.g, 15000, 'B rejoins');
    check('rejoining gets the same character back', b2.ls.pid === 2 && b2.me.inv.count('iron_gear') === gearsBefore, 'gears ' + b2.me.inv.count('iron_gear'));

    // --- restart: worlds persist
    const tickBefore = a.g.tick;
    a.close(); b2.close(); c.close(); d.close();
    await sleep(500);
    server.kill('SIGTERM');
    await new Promise((r) => server.once('exit', r));
    serverUp = false;
    startServer(); await waitUp();
    list = await listLobbies();
    check('lobbies survive a server restart', list.length === 2 && list.every((l) => !l.awake), JSON.stringify(list.map((l) => [l.name, l.players, l.played])));
    const e = new Client('Ada', 'tokenAda0001');
    await e.connect();
    e.send({ type: 'join', id: list.find((l) => l.name === 'Ada\'s factory').id, player: { name: 'Ada' } });
    await until(() => e.g, 15000, 'rejoin after restart');
    check('world continues where it was', e.g.tick >= tickBefore - 5 && e.ls.pid === 1 && e.g.byKind.furnace.length === 1, 'tick ' + e.g.tick + ' vs ' + tickBefore);
    // Host closes the world.
    e.send({ type: 'close' });
    await until(() => e.closed, 3000, 'close');
    list = await listLobbies();
    check('host can close their world', !list.some((l) => l.name === 'Ada\'s factory'));
    e.close();
  } catch (err) {
    failures++;
    console.log('  FAIL ' + (err && err.stack || err));
  } finally {
    if (server) server.kill('SIGTERM');
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\n' + passed + ' passed, ' + failures + ' failed');
    setTimeout(() => process.exit(failures ? 1 : 0), 300);
  }
})();
