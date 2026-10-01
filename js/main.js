// Cogworks Frontier — boot, title screen, main loop and autosave.
(function () {
  'use strict';
  const D = FG.data;
  const STEP = 1000 / FG.TICKS;
  const AUTOSAVE_TICKS = 2 * 60 * 60;

  const app = (FG.app = {
    game: null,
    cursor: null,
    dir: 0,
    railDir: 0,
    hotbar: new Array(10).fill(null),
    view: { hover: null, build: null, altMode: false, showPollution: false, select: null, mineTarget: null },
    paused: false,
    titleShown: true,
    demo: null,
    blueprint: null,
    copied: null,
  });

  app.renderer = new FG.Renderer(document.getElementById('world'));
  app.ui = new FG.UI(app);
  app.input = new FG.Input(app);
  window.addEventListener('resize', () => app.renderer.resize());

  // Every action on the world goes through here as a command (commands.js): run at once when
  // playing alone, sent to the host in multiplayer (net.js).
  app.act = function (t, a) {
    const g = app.game;
    if (!g || app.titleShown) return;
    const cmd = { t, a: a || {} };
    if (app.net) app.net.command(cmd);
    else FG.runCmd(g, g.local.id, cmd);
  };

  app.setCursor = function (id) {
    if (!id) { app.cursor = null; return; }
    app.cursor = { item: id };
  };

  app.onWindowChange = function () {
    const w = app.ui.win;
    // A multiplayer world never pauses.
    app.paused = !app.net && !!(w && (w.name === 'menu' || w.name === 'saves' || w.name === 'savecode' || w.name === 'account' || w.name === 'newgame' || w.name === 'help' || w.name === 'victory'));
  };

  // Keep the hotbar stocked with placeable items the player picks up.
  function autoHotbar() {
    const g = app.game;
    if (!g || !g.actingLocal) return;
    const t = g.player.inv.totals();
    for (const id of Object.keys(t).sort((a, b) => D.items[a].order - D.items[b].order)) {
      if (!(D.items[id].place || D.items[id].track) || app.hotbar.indexOf(id) >= 0) continue;
      const k = app.hotbar.indexOf(null);
      if (k < 0) return;
      app.hotbar[k] = id;
    }
  }
  FG.on('inventory', autoHotbar);
  app.autoHotbar = autoHotbar;

  app.startGame = function (g, opts) {
    // Starting or loading another world ends a multiplayer session (joining one doesn't).
    if (app.net && !(opts && opts.keepNet)) app.mp.stop();
    if (!app.net) for (const p of g.players.slice()) if (p !== g.local) g.removePlayer(p.id);
    if (app.game && app.game !== g) autosaveCurrent();
    app.game = g;
    app.demo = null;
    app.cursor = null;
    app.dir = 0;
    app.hotbar = g.hotbar && g.hotbar.length === 10 ? g.hotbar.slice() : new Array(10).fill(null);
    g.hotbar = app.hotbar;
    app.titleShown = false;
    app.lastAutosave = g.tick;
    document.getElementById('title').hidden = true;
    document.getElementById('hud').hidden = false;
    if (app.ui.win) app.ui.close();
    app.renderer.cam.x = g.player.x;
    app.renderer.cam.y = g.player.y;
    app.renderer.cam.zoom = 1.2;
    app.renderer.lod0.clear();
    app.renderer.lod1.clear();
    autoHotbar();
    app.ui.updateObjective(true);
    app.onWindowChange();
    app.renderer.canvas.focus({ preventScroll: true });
    app.ui.setKeyboardHint(!document.hasFocus());
  };

  // Keep the running game safe before replacing it (in the account too, when that's on).
  function autosaveCurrent() {
    // A guest's copy of someone else's world is not their autosave.
    if (app.net && app.net.role === 'client') return null;
    if (app.game && !app.titleShown && app.game.tick > 60) return autosave(app.game, { minGap: 0 });
    return null;
  }
  function autosave(g, opts) {
    return FG.saves.autosave(g, opts).then((r) => {
      if (app.game === g && !app.titleShown) app.ui.savedNote(r);
      return r;
    }, (e) => {
      if (app.game === g && !app.titleShown) app.ui.toast('Autosave failed: ' + e.message, 'warn');
      return null;
    });
  }
  app.autosave = autosave;

  app.newGame = function (opts) {
    autosaveCurrent();
    const g = new FG.Game(opts);
    app.startGame(g);
    app.ui.toast('Landed. Follow the objectives at the top left.', 'good');
  };

  // A ready-made mid-game base to explore (see demo.js).
  app.startDemo = function () {
    autosaveCurrent();
    app.startGame(FG.demoFactory());
    app.ui.toast('Demo factory: steam power by the lake, iron miners feeding a smelter column, science, and a copper railway to the south', 'good');
  };

  app.showTitle = function () {
    const saving = autosaveCurrent();
    if (app.net) app.mp.stop(true);
    app.titleShown = true;
    app.game = null;
    document.getElementById('hud').hidden = true;
    document.getElementById('title').hidden = false;
    app.ui.setKeyboardHint(false);
    buildTitleMenu();
    // The autosave finishes in the background; offer Continue once it has.
    if (saving) saving.then(() => { if (app.titleShown) buildTitleMenu(); });
    if (!app.demo) {
      try { app.demo = makeDemo(); } catch (e) { console.error('demo scene failed', e); app.demo = null; }
    }
  };

  // The title menu draws at once from this browser's saves, then again when the account's
  // saves are known (Continue picks whichever autosave is newer).
  let titleRows = null, titleSeq = 0;
  function buildTitleMenu() {
    const seq = ++titleSeq;
    titleRows = null;
    drawTitleMenu();
    FG.saves.list().then((rows) => { if (seq === titleSeq && app.titleShown) { titleRows = rows; drawTitleMenu(); } }, () => {});
  }
  app.buildTitleMenu = buildTitleMenu;
  function drawTitleMenu() {
    const menu = document.getElementById('title-menu');
    menu.innerHTML = '';
    const h = FG.h;
    const rows = titleRows || FG.save.list().map((m) => ({ slot: m.slot, empty: !!m.empty, best: m.empty ? null : m, from: 'browser' }));
    const auto = rows.find((r) => r.slot === 'auto' && !r.empty);
    const hasAny = rows.some((r) => !r.empty);
    const hasAuto = !!auto;
    if (auto) {
      const btn = h('button', { class: 'btn primary', id: 'title-continue', text: 'Continue', title: 'Autosave from ' + new Date(auto.best.when).toLocaleString() + (auto.from === 'account' ? ', in your account' : ''), onclick: async () => {
        btn.disabled = true;
        try { app.startGame(await FG.saves.load('auto')); } catch (e) { app.ui.toast('Could not load the autosave: ' + e.message, 'bad'); }
        btn.disabled = false;
      } });
      menu.appendChild(btn);
    }
    menu.appendChild(h('button', { class: 'btn' + (hasAuto ? '' : ' primary'), text: 'New game', onclick: () => app.ui.open('newgame') }));
    menu.appendChild(h('button', { class: 'btn', id: 'title-multiplayer', text: 'Multiplayer', title: 'Host a world or join one with friends who have this page open', onclick: () => app.ui.open('multiplayer') }));
    menu.appendChild(h('button', { class: 'btn', text: 'Demo factory', title: 'A ready-made base with steam power, miners, belts, smelting, science and a railway', onclick: () => app.startDemo() }));
    if (hasAny) menu.appendChild(h('button', { class: 'btn', text: 'Load game', onclick: () => app.ui.open('saves', 'load') }));
    menu.appendChild(h('button', { class: 'btn', text: 'Import save code', onclick: () => app.ui.open('savecode') }));
    menu.appendChild(h('button', { class: 'btn', text: 'Controls', onclick: () => app.ui.open('help') }));
    drawAccountLine();
  }

  // Under the title menu: whether saves also go to the claude.ai account.
  function drawAccountLine() {
    const el = document.getElementById('title-account');
    if (!el) return;
    const c = FG.cloud;
    el.innerHTML = '';
    el.hidden = c.state === 'none' || c.state === 'unknown';
    if (el.hidden) return;
    const h = FG.h;
    const on = c.state === 'on';
    const text = on ? 'Saving to your account' + (c.name ? ' (' + c.name + ')' : '') : c.state === 'asking' ? 'Waiting for permission…' : 'Save to your claude.ai account';
    el.appendChild(h('button', { class: 'btn small' + (on ? ' on' : ''), id: 'title-account-btn', text: text, title: 'Optional: keep your saves in your claude.ai account so they follow you to other computers', onclick: () => app.ui.open('account') }));
    if (!on) el.appendChild(h('span', { class: 'hint', text: 'Optional. Without it, games save in this browser.' }));
  }
  let seenState = FG.cloud.state, seenBusy = false;
  FG.cloud.onChange((c) => {
    const turned = c.state !== seenState, saved = seenBusy && !c.busy;
    seenState = c.state; seenBusy = c.busy;
    if (!turned && !saved) return;
    if (app.titleShown) { if (turned && (c.state === 'on' || c.state === 'off')) buildTitleMenu(); else drawAccountLine(); }
    if (app.ui.win && app.ui.win.name === 'account') app.ui.open('account');
  });

  // A small working factory that runs behind the title screen.
  function makeDemo() {
    const g = new FG.Game({ seed: 20417, size: 192, enemies: 'off' });
    const w = g.world;
    const cx = w.spawnX, cy = w.spawnY;
    // Clear a work area and lay ore for the scene.
    for (let y = cy - 16; y < cy + 16; y++) for (let x = cx - 26; x < cx + 26; x++) {
      const i = y * w.W + x;
      if (w.terrain[i] >= 4) w.terrain[i] = 0;
      if (w.res[i]) { w.res[i] = 0; w.amt[i] = 0; }
    }
    for (let y = cy - 9; y < cy + 9; y++) for (let x = cx + 8; x < cx + 18; x++) {
      const i = y * w.W + x;
      w.res[i] = (x + y) % 7 === 0 ? FG.RES.COAL : FG.RES.IRON; w.amt[i] = 800 + ((x * 7 + y * 13) % 400);
    }
    for (let y = cy - 14; y < cy - 10; y++) for (let x = cx - 24; x < cx - 14; x++) { const i = y * w.W + x; w.res[i] = FG.RES.TREE; w.amt[i] = 4; }
    const place = (p, x, y, d) => { const c = FG.canPlace(g, p, x, y, d || 0, { ignorePlayer: true }); return c.ok ? FG.placeEntity(g, p, x, y, d || 0) : null; };
    g.player.x = cx - 30; g.player.y = cy + 12;
    // Drills on both sides of a belt, feeding west.
    for (let k = 0; k < 4; k++) {
      const y = cy - 8 + k * 4;
      const a = place('burner_drill', cx + 9, y, 1);
      const b = place('burner_drill', cx + 12, y, 3);
      for (const d of [a, b]) if (d) FG.insertItem(g, d, 'coal', 50, 'direct');
    }
    for (let y = cy - 9; y < cy + 9; y++) place('belt', cx + 11, y, 2);
    place('belt', cx + 11, cy + 9, 3);
    for (let x = cx + 10; x > cx - 6; x--) place('belt', x, cy + 9, 3);
    place('belt', cx - 6, cy + 9, 0);
    for (let y = cy + 8; y > cy - 6; y--) place('belt', cx - 6, y, 0);
    // Furnaces fed by burner arms along the vertical belt.
    for (let k = 0; k < 4; k++) {
      const y = cy - 4 + k * 3;
      const arm = place('burner_inserter', cx - 5, y, 1);
      const f = place('stone_furnace', cx - 4, y);
      const arm2 = place('burner_inserter', cx - 2, y, 1);
      const ch = place('iron_chest', cx - 1, y);
      for (const e of [arm, arm2]) if (e) FG.insertItem(g, e, 'coal', 5, 'direct');
      if (f) FG.insertItem(g, f, 'coal', 50, 'direct');
      void ch;
    }
    // Power and an assembler block.
    FG.placeEntity(g, 'solar_panel', cx - 20, cy - 6, 0);
    FG.placeEntity(g, 'solar_panel', cx - 20, cy - 3, 0);
    place('small_pole', cx - 17, cy - 4);
    const asm = place('assembler_1', cx - 16, cy - 5);
    if (asm) { FG.machines.setRecipe(g, asm, 'iron_gear'); asm.inp.iron_plate = 200; }
    place('lab', cx - 16, cy - 1);
    for (let s = 0; s < 1800; s++) g.step();
    app.renderer.cam.x = cx + 2; app.renderer.cam.y = cy;
    app.renderer.cam.zoom = 1.1;
    return g;
  }

  // ------------------------------------------------------------- main loop
  let acc = 0, last = performance.now(), lastHud = 0;
  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    const R = app.renderer;
    try {
      if (app.titleShown) {
        const g = app.demo;
        if (g) {
          acc += dt;
          let n = 0;
          while (acc >= STEP && n < 4) { g.step(); acc -= STEP; n++; }
          if (n >= 4) acc = 0;
          const t = now / 1000;
          R.cam.x = g.world.spawnX + 2 + Math.sin(t * 0.05) * 6;
          R.cam.y = g.world.spawnY + Math.cos(t * 0.04) * 3;
          R.draw(g, { hover: null, build: null, altMode: false });
        }
      } else if (app.game) {
        const g = app.game;
        app.input.frame();
        if (app.net) app.net.update(dt);
        else if (!app.paused) {
          acc += dt;
          let n = 0;
          while (acc >= STEP && n < 5) { app.input.tick(); g.step(); acc -= STEP; n++; }
          if (n >= 5) acc = 0;
        } else acc = 0;
        // Camera follows the player smoothly.
        R.cam.x += (g.local.x - R.cam.x) * 0.25;
        R.cam.y += (g.local.y - R.cam.y) * 0.25;
        R.draw(g, app.view);
        if (now - lastHud > 100) { lastHud = now; app.ui.updateHud(); }
        if (g.tick - app.lastAutosave > AUTOSAVE_TICKS && !(app.net && app.net.role === 'client')) {
          app.lastAutosave = g.tick;
          autosave(g);
        }
      }
    } catch (err) {
      console.error(err);
      if (!app.errShown) { app.errShown = true; app.ui.toast('Something went wrong: ' + err.message, 'bad'); }
    }
    requestAnimationFrame(frame);
  }

  // Pickups and sounds without a place belong to whoever acted: only theirs play here.
  FG.on('picked', (id, n, x, y) => { if (app.game && app.game.actingLocal) app.game.effects.push({ type: 'pick', id, x, y, t: 0, life: 40 }); });

  // Sound effects (only for the live game, never the title-screen demo).
  const live = () => app.game && !app.titleShown;
  FG.on('sound', (name, x, y) => { if (live() && (x !== undefined || app.game.actingLocal)) FG.sfx.play(name, x, y); });
  FG.on('placed', (e) => { if (live()) FG.sfx.play('place', e.x, e.y); });
  FG.on('research', (tid) => { if (tid && live()) FG.sfx.play('research'); });
  FG.on('objective', () => { if (live()) FG.sfx.play('objective'); });
  FG.on('alert', () => { if (live()) FG.sfx.play('alert'); });

  // Save when the tab is hidden or closing. The browser copy is quick; the account copy
  // goes too unless one was made in the last 15 seconds.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.game && !app.titleShown && app.game.tick > 60 && !(app.net && app.net.role === 'client')) {
      FG.saves.autosave(app.game, { minGap: 15000, noWait: true }).catch(() => {});
    }
  });

  function boot(data) {
    FG.icons.preload();
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
      document.getElementById('touch-note').hidden = false;
    }
    let restored = false;
    if (data && data.save) {
      try { app.startGame(FG.save.deserialize(data.save)); restored = true; } catch (e) { console.warn('hot restore failed', e); }
    }
    if (!restored) app.showTitle();
    requestAnimationFrame(frame);
    // Account saves light up once the platform answers (never asking anything by themselves).
    FG.cloud.init().catch((e) => { console.warn('account saves unavailable', e); });
  }

  // Preserve an in-progress game across live page updates when hosted as an artifact.
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') {
    try { hot.snapshot(() => (app.game && !app.titleShown ? { save: FG.save.serialize(app.game) } : {})); } catch (e) { /* optional */ }
  }
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
