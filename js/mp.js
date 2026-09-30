// Cogworks Frontier — multiplayer in the app: hosting, joining, the Multiplayer window, the
// players list on the HUD and chat. The lockstep itself is net.js; connections netlink.js.
(function () {
  'use strict';
  const D = FG.data;
  const h = FG.h;
  const app = FG.app;
  const L = FG.netlink;

  const mp = (app.mp = { handle: null, kind: null, status: '', joining: false });

  // ----------------------------------------------------------------- name
  mp.name = function () {
    let n = null;
    try { n = localStorage.getItem('cogworks-name'); } catch (e) { /* storage blocked */ }
    return n || 'Engineer ' + (10 + ((Math.random() * 90) | 0));
  };
  mp.setName = function (n) {
    n = FG.net.cleanName(n);
    try { localStorage.setItem('cogworks-name', n); } catch (e) { /* storage blocked */ }
    return n;
  };

  // The environment a session talks to (see net.js).
  const env = {
    getGame: () => app.game,
    setGame: (g, why) => {
      if (why === 'joined') {
        app.startGame(g, { keepNet: true });
        app.input.sentInput = Object.assign({}, g.local.input);
        app.ui.toast('Joined ' + (app.net && app.net.world ? app.net.world : 'the world') + '. Press ` to chat.', 'good');
        mp.joining = false;
        app.ui.close();
      } else swapGame(g);
    },
    toast: (text, kind) => app.ui.toast(text, kind),
    onPlayers: () => { app.ui.updatePlayers(true); if (mp.handle && app.net && app.net.role === 'host') mp.handle.update({ players: app.net.roster().filter((r) => !r.joining).length }); if (app.ui.isOpen('multiplayer') && app.ui.win.refresh) app.ui.win.refresh(); },
    onEnd: (why) => mp.ended(why),
    pack: (s) => FG.save.pack(s),
    unpack: (s) => FG.save.unpack(s),
    inputTick: () => app.input.tick(),
  };
  mp.env = env;

  // A snapshot reload in the middle of play: keep your hand, hotbar and camera.
  function swapGame(g) {
    const old = app.game;
    g.hotbar = app.hotbar;
    app.game = g;
    if (app.ui.win && (app.ui.win.name === 'entity' || app.ui.win.name === 'train')) app.ui.close();
    app.input.sentInput = Object.assign({}, g.local.input);
    app.renderer.lod0.clear();
    app.renderer.lod1.clear();
    void old;
  }

  // ------------------------------------------------------------- hosting
  // Host the running game (or start one first): others can join from their Multiplayer window.
  mp.host = async function (g) {
    if (g && g !== app.game) app.startGame(g);
    if (!app.game) return;
    if (app.net) { app.ui.toast('Already in a multiplayer game', 'warn'); return; }
    const name = mp.name();
    const world = name + '’s world';
    app.net = new FG.net.Host(env, { pid: FG.net.playerId(), name, world });
    mp.kind = 'host';
    app.ui.updatePlayers(true);
    try {
      mp.handle = await L.hostOnRoom({ world, host: name, players: 1 }, (link) => { if (app.net && app.net.role === 'host') app.net.accept(link); else link.close(); });
    } catch (e) { console.warn('could not open the room', e); mp.handle = null; }
    if (!app.net) { if (mp.handle) mp.handle.close(); mp.handle = null; return; }
    if (mp.handle) app.ui.toast('Hosting ' + world + ': friends with this page open click Multiplayer and join', 'good');
    else app.ui.toast('Hosting: the page’s shared room is not available here, so friends join with a code (Multiplayer window)', 'warn');
    if (app.ui.isOpen('multiplayer') && app.ui.win.refresh) app.ui.win.refresh();
  };

  // ------------------------------------------------------------- joining
  mp.join = async function (advert) {
    if (mp.joining) return;
    if (app.net) mp.stop(true);
    mp.joining = true;
    mp.status = 'Joining ' + advert.world + '…';
    refreshWin();
    try {
      const link = await L.joinOnRoom(advert, (s) => { mp.status = s; refreshWin(); });
      startClient(link);
    } catch (e) {
      mp.joining = false;
      mp.status = 'Could not join: ' + (e && e.message ? e.message : e);
      refreshWin();
    }
  };
  function startClient(link) {
    mp.joining = true;
    mp.status = 'Downloading the world…';
    refreshWin();
    app.net = new FG.net.Client(env, link, { pid: FG.net.playerId(), name: mp.name() });
    mp.kind = 'client';
    mp.linkKind = link.kind;
    // No answer at all: give up. (A big world over the room relay can take a while to arrive,
    // so once the host has answered, wait longer for it.)
    const net = app.net;
    setTimeout(() => { if (app.net === net && !net.pid && !net.ended) net.finish('The host did not answer'); }, 30000);
    setTimeout(() => { if (app.net === net && !net.ready && !net.ended) net.finish('The host did not send the world'); }, 300000);
    const tick = setInterval(() => {
      if (app.net !== net || net.ready || net.ended) { clearInterval(tick); return; }
      const f = link.progress && link.progress();
      const s = net.pid ? 'Downloading the world' + (f !== null && f !== undefined ? '… ' + Math.round(f * 100) + '%' : '…') : 'Waiting for the host…';
      if (s !== mp.status) { mp.status = s; refreshWin(); }
    }, 300);
  }
  mp.startClient = startClient;
  function refreshWin() { if (app.ui.isOpen('multiplayer') && app.ui.win.refresh) app.ui.win.refresh(); }

  // The session ended from the other side (host left, connection lost, turned away).
  mp.ended = function (why) {
    const wasJoining = mp.joining || (app.net && !app.net.ready);
    app.net = null;
    mp.kind = null;
    mp.joining = false;
    if (mp.handle) { mp.handle.close(); mp.handle = null; }
    const g = app.game;
    if (wasJoining || !g || app.titleShown) {
      mp.status = why;
      refreshWin();
      app.ui.toast(why, 'warn');
      return;
    }
    // Keep playing your own copy of the world.
    for (const p of g.players.slice()) if (p !== g.local) g.removePlayer(p.id);
    app.ui.updatePlayers(true);
    app.ui.toast(why + '. You can keep playing your own copy: save it from the menu to keep it.', 'warn');
  };

  // Leave (client) or stop hosting (host). quiet: no message.
  mp.stop = function (quiet) {
    const net = app.net;
    if (!net) return;
    app.net = null;
    const role = mp.kind;
    mp.kind = null;
    mp.joining = false;
    if (mp.handle) { mp.handle.close(); mp.handle = null; }
    net.end('The host closed the world');
    const g = app.game;
    if (g) for (const p of g.players.slice()) if (p !== g.local) g.removePlayer(p.id);
    app.ui.updatePlayers(true);
    if (!quiet) app.ui.toast(role === 'host' ? 'Stopped hosting: your world is single-player again' : 'You left the world', 'info');
  };

  FG.on('chat', (p, text) => app.ui.chatLine(p, text));

  // ------------------------------------------------------------------- UI
  const U = FG.UI.prototype;
  U.build_multiplayer = function () {
    const ui = this;
    const w = this.frame('multiplayer', 'Multiplayer');
    const body = h('div', { class: 'mp' });
    w.body.append(body);
    let adverts = [];
    let offAdverts = null;
    const nameInput = h('input', { type: 'text', id: 'mp-name', value: mp.name(), maxlength: '24', 'aria-label': 'Your name', style: 'font:600 15px var(--font-ui);width:200px' });
    nameInput.addEventListener('change', () => { nameInput.value = mp.setName(nameInput.value); });
    const render = () => {
      body.innerHTML = '';
      const net = app.net;
      if (net && !(net.role === 'client' && !net.ready)) { renderSession(net); return; }
      body.appendChild(h('div', { class: 'rowx', style: 'display:flex;gap:10px;align-items:center;margin-bottom:10px' }, h('label', { class: 'label', for: 'mp-name', text: 'Your name' }), nameInput));
      // Join
      const join = h('div', { class: 'pane mp-pane' }, h('h3', { text: 'Join a world' }));
      if (mp.status) join.appendChild(h('div', { class: 'hint mp-status', text: mp.status }));
      if (mp.joining) join.appendChild(h('button', { class: 'btn small', id: 'mp-cancel', text: 'Cancel', onclick: () => { if (app.net && app.net.role === 'client') app.net.finish('Cancelled'); mp.joining = false; mp.status = ''; render(); } }));
      if (!L.lobby.room) {
        join.appendChild(h('div', { class: 'hint', text: L.lobby.tried
          ? 'Finding games needs this page’s shared room, which is only there on claude.ai for signed-in people the artifact is shared with (not by a public link). You can still join a friend directly with codes below.'
          : 'Looking for games…' }));
      } else if (!adverts.length) {
        join.appendChild(h('div', { class: 'hint', text: 'Nobody is hosting right now. When a friend with this page open hosts a world, it appears here.' }));
      } else {
        const list = h('div', { class: 'slots-list' });
        for (const a of adverts) {
          const full = a.max && a.players >= a.max, old = a.v !== FG.net.PROTO;
          list.appendChild(h('div', { class: 'srow mp-game' },
            h('div', { class: 'meta' }, h('b', { text: a.world }), h('div', { text: 'Hosted by ' + a.host + ' · ' + a.players + '/' + (a.max || FG.net.MAX_PLAYERS) + ' players' + (old ? ' · different version' : '') })),
            h('button', { class: 'btn small primary', text: 'Join', disabled: full || old || mp.joining, onclick: () => mp.join(a) })));
        }
        join.appendChild(list);
      }
      // Host
      const hostPane = h('div', { class: 'pane mp-pane' }, h('h3', { text: 'Host a world' }));
      if (app.game && !app.titleShown) {
        hostPane.append(h('div', { class: 'hint', text: 'Let friends join the world you are playing now. They drop in next to you with a starter kit.' }),
          h('button', { class: 'btn primary', id: 'mp-host-current', text: 'Open this world to others', onclick: () => mp.host() }));
      } else {
        const src = h('select', { id: 'mp-src', 'aria-label': 'World to host' },
          h('option', { value: 'new', text: 'A new world' }), h('option', { value: 'demo', text: 'The Demo factory' }));
        if (FG.save.list().some((m) => m.slot === 'auto' && !m.empty)) src.appendChild(h('option', { value: 'auto', text: 'Your autosave' }));
        for (const m of FG.save.list()) if (m.slot !== 'auto' && !m.empty) src.appendChild(h('option', { value: m.slot, text: 'Save slot ' + m.slot }));
        const enemies = h('select', { id: 'mp-enemies', 'aria-label': 'Enemies' }, h('option', { value: 'normal', text: 'Enemies: normal' }), h('option', { value: 'peaceful', text: 'Enemies: peaceful' }), h('option', { value: 'off', text: 'Enemies: none' }));
        src.addEventListener('change', () => { enemies.hidden = src.value !== 'new'; });
        hostPane.append(h('div', { class: 'rowx', style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, src, enemies),
          h('button', { class: 'btn primary', id: 'mp-host', text: 'Host', style: 'margin-top:8px', onclick: async () => {
            let g = null;
            try {
              if (src.value === 'new') g = new FG.Game({ enemies: enemies.value, size: 512 });
              else if (src.value === 'demo') g = FG.demoFactory();
              else g = await FG.save.loadSlot(src.value);
            } catch (e) { ui.toast('Could not load that world: ' + e.message, 'bad'); return; }
            ui.close();
            mp.host(g);
          } }));
      }
      // Codes
      const codes = h('details', { class: 'mp-codes' }, h('summary', { text: 'Connect directly with codes (no shared room needed)' }));
      codes.append(h('div', { class: 'hint', text: 'For computers on one network without the shared room: the joiner makes a join code, the host turns it into an answer code, the joiner pastes that back.' }),
        codeJoin(ui));
      body.append(h('div', { class: 'panes' }, join, hostPane), codes);
    };
    const renderSession = (net) => {
      const g = app.game;
      const role = net.role === 'host' ? 'Hosting' : 'Playing in';
      const box = h('div', { class: 'pane mp-pane', style: 'min-width:min(520px, calc(100vw - 60px))' },
        h('h3', { text: role + ' ' + (net.world || (g && g.local.name + '’s world')) }));
      if (net.role === 'host') {
        box.appendChild(h('div', { class: 'hint', text: mp.handle ? 'Friends who have this page open click Multiplayer and pick your world. Traffic goes directly between your browsers when it can.' : 'The shared room is not available here: add players with codes below.' }));
      } else box.appendChild(h('div', { class: 'hint', text: (mp.linkKind === 'relay' ? 'Connected through the room (a direct connection was not possible).' : 'Connected directly to the host.') + (net.lag ? ' Round trip ' + net.lag + ' ms.' : '') }));
      const list = h('div', { class: 'slots-list', id: 'mp-players' });
      for (const r of net.roster()) {
        list.appendChild(h('div', { class: 'srow' }, h('span', { class: 'mp-dot', style: 'background:' + (r.color || '#888') }),
          h('div', { class: 'meta' }, h('b', { text: r.name }), h('div', { text: (r.you ? 'You' : '') + (r.host ? (r.you ? ' · host' : 'Host') : '') + (r.joining ? 'Joining…' : '') }))));
      }
      box.appendChild(list);
      if (net.role === 'host') box.appendChild(h('details', { class: 'mp-codes' }, h('summary', { text: 'Add a player with a code' }), codeHost(ui)));
      box.appendChild(h('div', { class: 'actions' },
        h('button', { class: 'btn danger', id: 'mp-stop', text: net.role === 'host' ? 'Stop hosting' : 'Leave the world', onclick: () => { mp.stop(); ui.close(); } })));
      body.appendChild(box);
    };
    w.refresh = render;
    render();
    L.connectLobby().then(() => {
      if (!ui.isOpen('multiplayer')) return;
      offAdverts = L.onAdverts((list) => { adverts = list; if (ui.isOpen('multiplayer') && !(document.activeElement && document.activeElement.tagName === 'TEXTAREA')) render(); });
      render();
    });
    w.onClose = () => { if (offAdverts) offAdverts(); };
    let last = 0;
    w.update = () => { const now = performance.now(); if (now - last > 1000 && app.net) { last = now; if (!document.activeElement || document.activeElement.tagName !== 'TEXTAREA') render(); } };
    return w;
  };

  // Joiner side of the code exchange.
  function codeJoin(ui) {
    const box = h('div', { class: 'mp-code-box' });
    const out = h('textarea', { id: 'mp-join-code', readonly: true, spellcheck: 'false', placeholder: 'Your join code appears here', 'aria-label': 'Your join code' });
    const inp = h('textarea', { id: 'mp-answer-code', spellcheck: 'false', placeholder: 'Paste the host’s answer code', 'aria-label': 'Answer code from the host' });
    let pending = null;
    const make = h('button', { class: 'btn', id: 'mp-make-code', text: 'Make a join code', onclick: async () => {
      if (!L.rtcSupported()) { ui.toast('This browser cannot connect directly', 'bad'); return; }
      make.disabled = true;
      try { if (pending) pending.cancel(); pending = await L.codeOffer(); out.value = pending.code; copy(out, ui); }
      catch (e) { ui.toast('Could not make a code: ' + e.message, 'bad'); }
      make.disabled = false;
    } });
    const go = h('button', { class: 'btn primary', id: 'mp-use-answer', text: 'Connect', onclick: async () => {
      if (!pending) { ui.toast('Make a join code first', 'warn'); return; }
      go.disabled = true;
      mp.status = 'Connecting…';
      try { const link = await pending.finish(inp.value); pending = null; startClient(link); }
      catch (e) { ui.toast('Could not connect: ' + e.message, 'bad'); mp.status = ''; }
      go.disabled = false;
    } });
    box.append(h('div', { class: 'label', text: '1. Send this to the host' }), out, make, h('div', { class: 'label', text: '2. Paste their answer' }), inp, go);
    return box;
  }
  // Host side: turn a join code into an answer code, then wait for the connection.
  function codeHost(ui) {
    const box = h('div', { class: 'mp-code-box' });
    const inp = h('textarea', { id: 'mp-host-join-code', spellcheck: 'false', placeholder: 'Paste the player’s join code', 'aria-label': 'Join code from the player' });
    const out = h('textarea', { id: 'mp-host-answer', readonly: true, spellcheck: 'false', placeholder: 'Your answer code appears here', 'aria-label': 'Answer code for the player' });
    const go = h('button', { class: 'btn primary', id: 'mp-make-answer', text: 'Make an answer code', onclick: async () => {
      if (!app.net || app.net.role !== 'host') return;
      go.disabled = true;
      try {
        const r = await L.codeAnswer(inp.value);
        out.value = r.code;
        copy(out, ui);
        r.link.then((link) => { if (app.net && app.net.role === 'host') app.net.accept(link); else link.close(); }, () => ui.toast('That player did not connect', 'warn'));
      } catch (e) { ui.toast('Could not read that code: ' + e.message, 'bad'); }
      go.disabled = false;
    } });
    box.append(h('div', { class: 'label', text: '1. Paste their join code' }), inp, go, h('div', { class: 'label', text: '2. Send them this answer' }), out);
    return box;
  }
  async function copy(ta, ui) {
    try { await navigator.clipboard.writeText(ta.value); ui.toast('Code copied', 'good'); }
    catch (e) { ta.focus(); ta.select(); }
  }

  // Players on the HUD (only in multiplayer).
  U.updatePlayers = function (force) {
    let el = document.getElementById('hud-players');
    if (!el) {
      el = h('div', { id: 'hud-players', class: 'card', hidden: true });
      document.getElementById('hud-right').appendChild(el);
      el.addEventListener('click', () => this.open('multiplayer'));
    }
    const net = app.net, g = app.game;
    if (!net || !g) { el.hidden = true; el.dataset.k = ''; return; }
    const rows = net.roster();
    const key = rows.map((r) => r.pid + r.name + r.color + (r.joining ? 'j' : '')).join('|') + (net.lag || 0 > 0 ? '' : '');
    if (!force && el.dataset.k === key) return;
    el.dataset.k = key;
    el.hidden = false;
    el.innerHTML = '';
    el.appendChild(h('div', { class: 'eyebrow', text: net.role === 'host' ? 'Hosting · ' + rows.length + ' / ' + FG.net.MAX_PLAYERS : 'Multiplayer' }));
    for (const r of rows) el.appendChild(h('div', { class: 'mp-row' }, h('span', { class: 'mp-dot', style: 'background:' + (r.color || '#888') }), h('span', { text: r.name + (r.you ? ' (you)' : '') + (r.joining ? ' · joining' : '') })));
  };

  // Chat: ` opens a line; messages show above the hotbar for a while.
  U.chatLine = function (p, text) {
    let log = document.getElementById('chat-log');
    if (!log) { log = h('div', { id: 'chat-log', 'aria-live': 'polite' }); document.getElementById('hud').appendChild(log); }
    const line = h('div', { class: 'chat-line' }, h('b', { style: 'color:' + (p.color || '#f0a830'), text: p.name + ': ' }), h('span', { text }));
    log.appendChild(line);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 12000);
    FG.sfx.play('craft');
  };
  U.openChat = function () {
    if (!app.net) { this.toast('Chat is for multiplayer games', 'info'); return; }
    let box = document.getElementById('chat-input');
    if (!box) {
      box = h('input', { id: 'chat-input', type: 'text', maxlength: '160', placeholder: 'Say something · Enter to send · Esc to cancel', 'aria-label': 'Chat message' });
      box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { if (box.value.trim()) app.act('chat', { text: box.value }); box.value = ''; box.hidden = true; app.renderer.canvas.focus({ preventScroll: true }); }
        else if (e.key === 'Escape') { box.value = ''; box.hidden = true; app.renderer.canvas.focus({ preventScroll: true }); }
      });
      document.getElementById('hud').appendChild(box);
    }
    box.hidden = false;
    setTimeout(() => box.focus(), 0);
  };
  void D;
})();
