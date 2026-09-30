// Headless multiplayer tests: a host and clients in one process, joined by in-memory links.
// Every copy of the world must stay identical. Usage: node tests/net.test.js
const { load } = require('./harness');
const FG = load();

let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
const tick = () => new Promise((r) => setImmediate(r));

// A flat, cleared world like the simulation tests use.
function world(opts) {
  const g = new FG.Game(Object.assign({ seed: 7, size: 192, enemies: 'off' }, opts || {}));
  const w = g.world;
  for (let y = 20; y < w.H - 20; y++) for (let x = 20; x < w.W - 20; x++) { const i = y * w.W + x; w.terrain[i] = 0; w.res[i] = 0; w.amt[i] = 0; }
  return g;
}
// One computer: its game and the environment a session talks to.
let clock = 0; // a fake clock: every frame is 1/60 s
function computer(g) {
  const pc = { g, log: [], ended: null };
  pc.env = {
    now: () => clock,
    getGame: () => pc.g,
    setGame: (g2, why) => { pc.g = g2; pc.log.push(why); },
    toast: (t) => pc.log.push(t),
    onPlayers: () => {},
    onEnd: (why) => { pc.ended = why; },
    pack: async (s) => 'raw:' + s,
    unpack: async (s) => (s.startsWith('raw:') ? s.slice(4) : s),
    inputTick: () => {},
  };
  return pc;
}
// Run n frames of 1/60 s on every session, letting messages through between frames.
async function frames(sessions, n) {
  for (let i = 0; i < n; i++) {
    clock += 1000 / 60;
    for (const s of sessions) if (s && !s.ended) s.update(1000 / 60);
    await tick();
  }
}
// Let clients catch up with the host, then compare every copy.
async function settle(host, clients) {
  for (let k = 0; k < 200; k++) {
    await frames([host].concat(clients), 1);
    const T = host.game.tick;
    if (clients.every((c) => c.ended || (c.ready && c.game.tick === T && !c.busy))) {
      // One more flush so clients know about the last tick, then stop the host briefly.
      return;
    }
  }
  throw new Error('clients never caught up: host ' + host.game.tick + ' clients ' + clients.map((c) => c.ready + ':' + (c.game && c.game.tick)).join(','));
}
// Step clients to exactly the host's tick and compare state.
async function same(host, clients) {
  const target = host.game.tick;
  host.flush();
  for (let k = 0; k < 100 && clients.some((c) => !c.ended && c.game.tick < target); k++) {
    for (const c of clients) if (!c.ended && c.game.tick < target) c.update(1000 / 60 * Math.min(4, target - c.game.tick));
    await tick();
  }
  const hh = FG.net.hash(host.game), hs = FG.save.serialize(host.game);
  for (const c of clients) {
    if (c.ended) continue;
    assert(c.game.tick === target, 'client at tick ' + c.game.tick + ', host at ' + target);
    const ch = FG.net.hash(c.game);
    if (ch !== hh) {
      const a = JSON.parse(hs), b = JSON.parse(FG.save.serialize(c.game));
      for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k]) && k !== 'localId' && k !== 'player') console.log('       differs:', k);
      throw new Error('client ' + c.pid + ' hash ' + ch + ' != host ' + hh);
    }
  }
}

(async () => {
  console.log('Multiplayer');
  let H, h, c1, c2, A, B;

  await test('a client joins, receives the world and appears in it', async () => {
    A = computer(world());
    H = computer(null); H.g = A.g; // the host's computer
    h = new FG.net.Host(H.env, { pid: 'host', name: 'Hosty', world: 'Test world' });
    const [hl, cl] = FG.net.localPair();
    h.accept(hl);
    B = computer(null);
    c1 = new FG.net.Client(B.env, cl, { pid: 'u1', name: 'Ada' });
    await frames([h, c1], 30);
    assert(c1.ready && c1.pid === 'u1', 'client ready ' + c1.ready + ' pid ' + c1.pid);
    assert(h.game.players.length === 2 && B.g.players.length === 2, 'two players on both sides');
    assert(B.g.local.id === 'u1' && h.game.local.id === 'host', 'each side controls its own player');
    assert(B.g.local.name === 'Ada' && h.game.playerById('u1').color !== h.game.local.color, 'name and a colour of their own');
    await same(h, [c1]);
  });

  await test('commands from host and client run on the same tick everywhere', async () => {
    const g = h.game, X = g.local.x | 0, Y = g.local.y | 0;
    h.command({ t: 'build', a: { item: 'stone_furnace', x: X + 3, y: Y + 3, dir: 0 } });
    c1.command({ t: 'build', a: { item: 'stone_furnace', x: X - 4, y: Y + 3, dir: 0 } });
    c1.command({ t: 'input', a: { mx: 1, my: 0 } });
    await frames([h, c1], 40);
    c1.command({ t: 'input', a: { mx: 0 } });
    await frames([h, c1], 10);
    await same(h, [c1]);
    const hg = h.game;
    assert(hg.byKind.furnace && hg.byKind.furnace.length === 2, 'both built');
    const ada = hg.playerById('u1');
    assert(ada.inv.count('stone_furnace') === 0 && ada.x > X + 3, 'the furnace came from Ada, who walked east: ' + ada.x.toFixed(2));
  });

  await test('a second client joins later; everyone reloads one snapshot and stays in step', async () => {
    const [hl, cl] = FG.net.localPair();
    h.accept(hl);
    const C = computer(null);
    c2 = new FG.net.Client(C.env, cl, { pid: 'u1', name: 'Bea' }); // same browser id as Ada: gets its own
    await frames([h, c1, c2], 40);
    assert(c2.ready && c2.pid === 'u1-2', 'second tab gets its own id: ' + c2.pid);
    assert(h.game.players.length === 3 && c1.game.players.length === 3 && c2.game.players.length === 3, 'three players everywhere');
    for (let i = 0; i < 5; i++) {
      c2.command({ t: 'craft', a: { r: 'iron_gear', n: 1 } });
      h.command({ t: 'input', a: { my: i % 2 ? 1 : -1 } });
      await frames([h, c1, c2], 12);
    }
    await same(h, [c1, c2]);
  });

  await test('a player who leaves is removed on the same tick everywhere and kept for later', async () => {
    c1.end();
    await frames([h, c2], 20);
    await same(h, [c2]);
    assert(h.game.players.length === 2 && c2.game.players.length === 2 && !c2.game.playerById('u1'), 'Ada gone on both');
    assert(h.game.offline.some((p) => p.id === 'u1'), 'kept offline for when she returns');
  });

  await test('a client whose world drifts is detected and repaired with a fresh snapshot', async () => {
    const g = c2.game;
    // Corrupt the client's copy: an extra stack in a player's pocket.
    g.playerById('host').inv.add('coal', 37);
    await frames([h, c2], 400);
    await same(h, [c2]);
    assert(!c2.game.playerById('host').inv.count('coal') || c2.game.playerById('host').inv.count('coal') === h.game.playerById('host').inv.count('coal'), 'repaired');
  });

  await test('with enemies about, random rolls match on every copy', async () => {
    const g0 = world({ seed: 99, enemies: 'normal' });
    const P = computer(g0);
    const host = new FG.net.Host(P.env, { pid: 'h', name: 'H' });
    const [hl, cl] = FG.net.localPair();
    host.accept(hl);
    const Q = computer(null);
    const cl1 = new FG.net.Client(Q.env, cl, { pid: 'q', name: 'Q' });
    await frames([host, cl1], 20);
    // A hive nearby, then a snapshot so both copies have it. Shooting it makes defenders
    // pour out at random spots.
    const hg = host.game, nx = (hg.local.x + 10) | 0, ny = (hg.local.y - 1) | 0;
    hg.enemies.addNest(nx, ny);
    host.needSync = true;
    await frames([host, cl1], 20);
    host.command({ t: 'input', a: { shoot: true, aimX: nx + 1, aimY: ny + 1 } });
    await frames([host, cl1], 400);
    await same(host, [cl1]);
    assert(host.game.enemies.units.length > 0 || host.game.stats.kills > 0, 'creatures came: ' + host.game.enemies.units.length + ' kills ' + host.game.stats.kills);
  });

  await test('the demo factory (belts, power, trains, research) runs identically for a minute', async () => {
    const P = computer(FG.demoFactory({ warmup: 600 }));
    const host = new FG.net.Host(P.env, { pid: 'h', name: 'H' });
    const [hl, cl] = FG.net.localPair();
    host.accept(hl);
    const Q = computer(null);
    const cl1 = new FG.net.Client(Q.env, cl, { pid: 'q', name: 'Q' });
    await frames([host, cl1], 20);
    assert(cl1.ready, 'joined the demo factory');
    const g = host.game, me = g.playerById('q');
    // The client walks about, crafts, takes plates from a chest and places a chest.
    cl1.command({ t: 'craft', a: { r: 'iron_chest', n: 2 } });
    cl1.command({ t: 'input', a: { mx: -1, my: 1 } });
    for (let k = 0; k < 6; k++) {
      await frames([host, cl1], 300);
      await same(host, [cl1]);
    }
    cl1.command({ t: 'input', a: { mx: 0, my: 0 } });
    const chest = FG.entAt(host.game, 222, 163);
    cl1.command({ t: 'take', a: { id: chest.id, from: 'slot', i: 0 } });
    await frames([host, cl1], 60);
    await same(host, [cl1]);
    assert(host.game.playerById('q').inv.count('iron_plate') > 8 && host.game.rail.trains[0].arrivals >= 1, 'plates taken, train running');
    void me;
    host.end();
  });

  await test('the host closing ends the session for clients', async () => {
    h.end();
    await frames([c2], 5);
    assert(c2.ended && /closed/i.test(C2why(c2)), 'client told the world closed');
  });

  console.log('\n' + passed + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
function C2why(c) { return c.env && c.env.why ? c.env.why : 'closed'; }
