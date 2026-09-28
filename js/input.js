// Cogworks Frontier — keyboard and mouse: walking, building, mining, blueprints.
(function () {
  'use strict';
  const D = FG.data;
  const BUILD_REACH = 12;
  const MINE_REACH = 5;

  class Input {
    constructor(app) {
      this.app = app;
      this.keys = new Set();
      this.mouse = { sx: 0, sy: 0, wx: 0, wy: 0, tx: 0, ty: 0, left: false, right: false, over: false };
      this.mode = null; // pending area selection: copy | cut | decon
      this.drag = null;
      this.repairPool = 0;
      this.lastWarn = 0;
      const cv = app.renderer.canvas;
      cv.addEventListener('mousedown', (e) => this.onDown(e));
      window.addEventListener('mouseup', (e) => this.onUp(e));
      window.addEventListener('mousemove', (e) => this.onMove(e));
      cv.addEventListener('mouseenter', () => { this.mouse.over = true; });
      cv.addEventListener('mouseleave', () => { this.mouse.over = false; });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      window.addEventListener('keydown', (e) => this.onKey(e, true));
      window.addEventListener('keyup', (e) => this.onKey(e, false));
      window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    }
    get g() { return this.app.game; }

    warn(text) {
      const now = performance.now();
      if (now - this.lastWarn < 900) return;
      this.lastWarn = now;
      this.app.ui.toast(text, 'warn');
    }
    inReach(x, y, r) {
      const p = this.g.player;
      return FG.dist2(p.x, p.y, x, y) <= r * r;
    }

    // ----------------------------------------------------------- keyboard
    typing(e) {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    }
    onKey(e, down) {
      if (this.typing(e)) return;
      const code = e.code;
      if (down) this.keys.add(code); else this.keys.delete(code);
      const app = this.app;
      if (!down || !app.game || app.titleShown) {
        if (down && code === 'Escape' && app.ui.win) app.ui.close();
        return;
      }
      const ui = app.ui;
      if (e.altKey && (code === 'AltLeft' || code === 'AltRight')) { e.preventDefault(); app.view.altMode = !app.view.altMode; return; }
      if (e.ctrlKey || e.metaKey) {
        if (code === 'KeyC') { e.preventDefault(); this.mode = 'copy'; ui.toast('Drag over buildings to copy them', 'info'); }
        else if (code === 'KeyX') { e.preventDefault(); this.mode = 'cut'; ui.toast('Drag over buildings to cut them', 'info'); }
        else if (code === 'KeyV') { e.preventDefault(); if (app.blueprint) { app.cursor = { bp: app.blueprint }; } else ui.toast('Nothing copied yet: press Ctrl+C and drag first', 'warn'); }
        return;
      }
      switch (code) {
        case 'Escape':
          if (this.mode) { this.mode = null; app.view.select = null; }
          else if (ui.win) ui.close();
          else if (app.cursor) app.cursor = null;
          else ui.open('menu');
          break;
        case 'KeyE': ui.toggle('inventory'); break;
        case 'KeyT': ui.toggle('tech'); break;
        case 'KeyP': ui.toggle('stats'); break;
        case 'KeyM': ui.toggle('map'); break;
        case 'KeyH': case 'F1': e.preventDefault(); ui.toggle('help'); break;
        case 'KeyF': app.view.showPollution = !app.view.showPollution; ui.toast(app.view.showPollution ? 'Pollution overlay on' : 'Pollution overlay off'); break;
        case 'KeyQ': this.pipette(); break;
        case 'KeyR': this.rotate(e.shiftKey); break;
        case 'KeyX': this.mode = 'decon'; ui.toast('Drag over buildings to pick them up', 'info'); break;
        case 'KeyG': {
          const [wx, wy] = [this.mouse.wx, this.mouse.wy];
          if (!this.g.enemies.throwGrenade(wx, wy)) this.warn(this.g.player.inv.count('grenade') ? 'Not ready yet' : 'You have no grenades');
          break;
        }
        case 'Space': e.preventDefault(); break;
        default:
          if (/^Digit[0-9]$/.test(code)) {
            const n = parseInt(code.slice(5), 10);
            this.hotbarClick(n === 0 ? 9 : n - 1, 0);
          }
      }
    }

    pipette() {
      const app = this.app;
      if (app.cursor) { app.cursor = null; return; }
      const hv = app.view.hover;
      const ent = hv && (hv.ent || hv.ghost);
      if (!ent) return;
      const item = D.protos[ent.p].item;
      if (this.g.player.inv.count(item) > 0) app.cursor = { item };
      else if (this.g.bonus.drones) app.cursor = { item, ghost: true };
      else { this.warn('You have no ' + D.items[item].name); return; }
      if (D.protos[ent.p].rotatable) app.dir = ent.dir;
    }

    rotate(reverse) {
      const app = this.app;
      const c = app.cursor;
      if (c && c.bp) { app.cursor = { bp: rotateBlueprint(c.bp, reverse) }; app.blueprint = app.cursor.bp; return; }
      if (c && c.item && D.items[c.item].place) { app.dir = (app.dir + (reverse ? 3 : 1)) & 3; return; }
      const hv = app.view.hover;
      if (hv && hv.ent) {
        const e = hv.ent;
        if (!this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
        if (!FG.rotateEntity(this.g, e, reverse) && D.protos[e.p].rotatable) this.warn('Pick it up and place it again to turn it');
      }
    }

    hotbarClick(i, button) {
      const app = this.app;
      if (!app.game) return;
      if (button === 2) { app.hotbar[i] = null; return; }
      const c = app.cursor;
      const id = app.hotbar[i];
      if (c && c.item && c.item !== id && !c.ghost && button === 0 && this.mouse.overHotbar) { app.hotbar[i] = c.item; return; }
      if (!id) { if (c && c.item) app.hotbar[i] = c.item; return; }
      if (c && c.item === id) { app.cursor = null; return; }
      if (this.g.player.inv.count(id) > 0) app.setCursor(id);
      else if (this.g.bonus.drones && D.items[id].place) app.cursor = { item: id, ghost: true };
      else this.warn('You have no ' + D.items[id].name);
    }

    // -------------------------------------------------------------- mouse
    onWheel(e) {
      e.preventDefault();
      const cam = this.app.renderer.cam;
      cam.zoom = FG.clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.3, 2.6);
    }
    onMove(e) {
      const m = this.mouse;
      m.sx = e.clientX; m.sy = e.clientY;
      m.overHotbar = !!(e.target && e.target.closest && e.target.closest('#hotbar'));
    }
    onDown(e) {
      const app = this.app;
      if (!app.game || app.titleShown) return;
      if (app.ui.win && app.ui.win.name !== 'entity' && app.ui.win.name !== 'inventory') app.ui.close();
      e.preventDefault();
      this.app.renderer.canvas.focus && this.app.renderer.canvas.focus();
      const m = this.mouse;
      if (e.button === 2) {
        m.right = true;
        if (e.shiftKey) { this.copySettings(); m.right = false; return; }
        const hv = app.view.hover;
        if (hv && hv.ghost && !hv.ent) { this.g.removeGhost(hv.ghost); m.right = false; }
        return;
      }
      if (e.button !== 0) return;
      m.left = true;
      if (this.mode) {
        app.view.select = { x0: m.tx, y0: m.ty, x1: m.tx, y1: m.ty, mode: this.mode };
        return;
      }
      this.leftAction(e);
    }
    onUp(e) {
      const m = this.mouse;
      if (e.button === 2) m.right = false;
      if (e.button === 0) {
        m.left = false;
        this.drag = null;
        const s = this.app.view.select;
        if (s) { this.finishSelect(s); this.app.view.select = null; this.mode = null; }
      }
    }

    leftAction(e) {
      const app = this.app, g = this.g;
      const c = app.cursor;
      const hv = app.view.hover;
      if (c && c.bp) { this.pasteBlueprint(c.bp); return; }
      if (c && c.item) {
        const it = D.items[c.item];
        if (hv && hv.ent && (e.ctrlKey || !it.place)) { this.insertInto(hv.ent, c.item, e.ctrlKey); return; }
        if (it.place) { this.drag = { last: null, placed: [] }; this.dragBuild(); return; }
        if (c.item === 'grenade') { g.enemies.throwGrenade(this.mouse.wx, this.mouse.wy); return; }
        if (it.repair) return; // handled continuously in update()
        return;
      }
      if (!hv) return;
      if (hv.ent) {
        const e2 = hv.ent;
        if (!this.inReach(e2.x + e2.w / 2, e2.y + e2.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
        if (e.ctrlKey) { this.quickTake(e2); return; }
        if (e.shiftKey) { this.pasteSettings(e2); return; }
        app.ui.open('entity', e2);
        return;
      }
      if (hv.ghost) {
        const gh = hv.ghost;
        const item = D.protos[gh.p].item;
        if (!g.player.inv.count(item)) { this.warn('You have no ' + D.items[item].name); return; }
        if (!this.inReach(gh.x + gh.w / 2, gh.y + gh.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
        g.removeGhost(gh);
        if (!g.build(item, gh.x, gh.y, gh.dir, gh.settings)) g.addGhost(gh.p, gh.x, gh.y, gh.dir, gh.settings);
      }
    }

    insertInto(ent, id, all) {
      const g = this.g;
      if (!this.inReach(ent.x + ent.w / 2, ent.y + ent.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
      const have = g.player.inv.count(id);
      if (!have) { this.warn('You have no ' + D.items[id].name); this.app.cursor = null; return; }
      const n = all ? have : Math.min(have, D.items[id].stack);
      const before = g.player.inv.count(id);
      this.app.ui.transferToEntity(ent, id, n);
      const moved = before - g.player.inv.count(id);
      if (moved > 0) FG.emit('message', 'Inserted ' + moved + ' ' + D.items[id].name.toLowerCase(), 'info');
      if (!g.player.inv.count(id)) this.app.cursor = null;
    }

    quickTake(ent) {
      const g = this.g;
      let took = 0;
      for (const [id, n] of FG.outputsOf(g, ent)) {
        const k = Math.min(n, g.player.inv.space(id));
        if (k <= 0) continue;
        FG.takeOutput(g, ent, id, k);
        g.player.inv.add(id, k);
        took += k;
      }
      this.app.ui.toast(took ? 'Took ' + took + ' items' : 'Nothing to take', took ? 'info' : 'warn');
    }

    copySettings() {
      const hv = this.app.view.hover;
      if (!hv || !hv.ent) return;
      const e = hv.ent;
      this.app.copied = { recipe: e.recipe || null, filter: e.filter, prio: e.prio };
      this.app.ui.toast('Settings copied' + (e.recipe ? ': ' + D.recipes[e.recipe].name : ''));
    }
    pasteSettings(e) {
      const s = this.app.copied;
      if (!s) { this.warn('Shift+right-click a machine first to copy its settings'); return; }
      const pr = D.protos[e.p];
      if (s.recipe && pr.kind === 'crafter' && pr.cats.indexOf(D.recipes[s.recipe].cat) < 0) { this.warn('This machine cannot make that'); return; }
      this.g.applySettings(e, s);
      this.app.ui.toast('Settings pasted');
    }

    // ---------------------------------------------------------- building
    previewFor(itemId, dir) {
      const pr = D.protos[D.items[itemId].place];
      const d = pr.rotatable ? dir : 0;
      const [fw, fh] = FG.footprint(pr, d);
      const x = Math.round(this.mouse.wx - fw / 2), y = Math.round(this.mouse.wy - fh / 2);
      return { p: pr.id, x, y, dir: d, fw, fh };
    }

    tryBuild(itemId, x, y, dir, ghost, settings) {
      const g = this.g;
      const pr = D.protos[D.items[itemId].place];
      const [fw, fh] = FG.footprint(pr, pr.rotatable ? dir : 0);
      if (!this.inReach(x + fw / 2, y + fh / 2, BUILD_REACH) && !ghost) { this.warn('Out of reach'); return null; }
      if (ghost || g.player.inv.count(itemId) < 1) {
        if (!g.bonus.drones && !ghost) { this.warn('You have no ' + D.items[itemId].name); return null; }
        if (!g.bonus.drones) return null;
        const chk = FG.canPlace(g, pr.id, x, y, dir, { noReplace: true, ignorePlayer: true });
        if (!chk.ok) return null;
        return g.addGhost(pr.id, x, y, dir, settings);
      }
      const chk = FG.canPlace(g, pr.id, x, y, dir);
      if (!chk.ok) {
        if (chk.reason && chk.reason !== 'Space is occupied') this.warn(chk.reason);
        return null;
      }
      const ent = g.build(itemId, x, y, dir, settings);
      if (ent && pr.kind === 'underground' && ent.ug === 'out') this.app.dir = ent.dir;
      if (!g.player.inv.count(itemId) && !g.bonus.drones) this.app.cursor = null;
      return ent;
    }

    dragBuild() {
      const app = this.app;
      const c = app.cursor;
      if (!c || !c.item || !this.drag) return;
      const pr = D.protos[D.items[c.item].place];
      const pv = this.previewFor(c.item, app.dir);
      const last = this.drag.last;
      if (last && last[0] === pv.x && last[1] === pv.y) return;
      if (pr.kind === 'belt' && last) {
        // Walk tile by tile toward the mouse, turning belts to follow the drag.
        let [x, y] = last;
        let guard = 0;
        while ((x !== pv.x || y !== pv.y) && guard++ < 64) {
          const dx = pv.x - x, dy = pv.y - y;
          let d;
          if (Math.abs(dx) >= Math.abs(dy)) d = dx > 0 ? 1 : 3; else d = dy > 0 ? 2 : 0;
          const prev = FG.entAt(this.g, x, y);
          if (prev && this.drag.placed.indexOf(prev.id) >= 0 && prev.dir !== d && D.protos[prev.p].kind === 'belt') {
            const res = FG.replaceEntity(this.g, prev, prev.p, d);
            this.g.giveOrDrop(res.leftovers.filter((l) => l[0] !== D.protos[prev.p].item));
            this.drag.placed.push(res.ent.id);
          }
          x += FG.DX[d]; y += FG.DY[d];
          app.dir = d;
          const ent = this.tryBuild(c.item, x, y, d, c.ghost);
          if (ent) this.drag.placed.push(ent.id);
          if (!app.cursor) break;
        }
        this.drag.last = [pv.x, pv.y];
        return;
      }
      const ent = this.tryBuild(c.item, pv.x, pv.y, pv.dir, c.ghost);
      if (ent) this.drag.placed.push(ent.id);
      this.drag.last = [pv.x, pv.y];
    }

    // --------------------------------------------------------- blueprints
    finishSelect(s) {
      const g = this.g, app = this.app;
      const x0 = Math.min(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), x1 = Math.max(s.x0, s.x1), y1 = Math.max(s.y0, s.y1);
      const inside = [];
      const seen = new Set();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const e = FG.entAt(g, x, y);
        if (e && !seen.has(e.id) && e.x >= x0 && e.y >= y0 && e.x + e.w - 1 <= x1 && e.y + e.h - 1 <= y1) { seen.add(e.id); inside.push(e); }
        const gh = g.ghostAt(x, y);
        if (gh && s.mode !== 'copy') g.removeGhost(gh);
      }
      if (s.mode === 'copy' || s.mode === 'cut') {
        if (!inside.length) { app.ui.toast('No buildings in that area', 'warn'); return; }
        const bx = Math.min(...inside.map((e) => e.x)), by = Math.min(...inside.map((e) => e.y));
        const bw = Math.max(...inside.map((e) => e.x + e.w)) - bx, bh = Math.max(...inside.map((e) => e.y + e.h)) - by;
        const bp = {
          w: bw, h: bh,
          ents: inside.map((e) => ({ p: e.p, dx: e.x - bx, dy: e.y - by, dir: e.dir, settings: { recipe: e.recipe || null, filter: e.filter, prio: e.prio } })),
        };
        app.blueprint = bp;
        app.cursor = { bp };
        app.ui.toast((s.mode === 'cut' ? 'Cut ' : 'Copied ') + inside.length + ' buildings · click to paste, R to rotate', 'good');
      }
      if (s.mode === 'cut' || s.mode === 'decon') {
        let picked = 0, marked = 0, left = 0;
        for (const e of inside) {
          if (this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH) && g.pickUpEntity(e)) picked++;
          else if (g.bonus.drones) { e.decon = true; marked++; }
          else left++;
        }
        const bits = [];
        if (picked) bits.push('picked up ' + picked);
        if (marked) bits.push('drones will remove ' + marked);
        if (left) bits.push(left + ' out of reach');
        if (bits.length) app.ui.toast(bits.join(' · ').replace(/^./, (c) => c.toUpperCase()), left ? 'warn' : 'info');
      }
    }

    blueprintAnchor(bp) {
      return [Math.round(this.mouse.wx - bp.w / 2), Math.round(this.mouse.wy - bp.h / 2)];
    }

    pasteBlueprint(bp) {
      const g = this.g;
      const [ax, ay] = this.blueprintAnchor(bp);
      let built = 0, ghosts = 0, skipped = 0;
      for (const b of bp.ents) {
        const x = ax + b.dx, y = ay + b.dy;
        const pr = D.protos[b.p];
        const chk = FG.canPlace(g, b.p, x, y, b.dir, { noReplace: true });
        if (!chk.ok) { skipped++; continue; }
        const [fw, fh] = FG.footprint(pr, b.dir);
        if (g.player.inv.count(pr.item) > 0 && this.inReach(x + fw / 2, y + fh / 2, BUILD_REACH)) {
          if (g.build(pr.item, x, y, b.dir, b.settings)) built++;
        } else if (g.addGhost(b.p, x, y, b.dir, b.settings)) ghosts++;
      }
      const bits = [];
      if (built) bits.push('built ' + built);
      if (ghosts) bits.push(ghosts + ' ghosts' + (g.bonus.drones ? '' : ' (bring the items and click them)'));
      if (skipped) bits.push(skipped + ' blocked');
      if (bits.length) this.app.ui.toast(bits.join(' · ').replace(/^./, (c) => c.toUpperCase()));
    }

    // ------------------------------------------------------ per-frame update
    frame() {
      const app = this.app, g = this.g;
      if (!g) return;
      const R = app.renderer, m = this.mouse;
      const [wx, wy] = R.toWorld(m.sx, m.sy);
      m.wx = wx; m.wy = wy;
      m.tx = Math.floor(wx); m.ty = Math.floor(wy);
      const view = app.view;
      // Hover target.
      const hv = { tile: [m.tx, m.ty] };
      if (m.over && g.world.inBounds(m.tx, m.ty)) {
        for (const u of g.enemies.units) if (FG.dist2(u.x, u.y, wx, wy) < 0.5) { hv.enemy = u; break; }
        if (!hv.enemy && g.enemies.nestTiles.size) {
          const n = g.enemies.nestTiles.get(m.ty * g.world.W + m.tx);
          if (n) hv.enemy = { x: n.x + 1, y: n.y + 1, hp: n.hp };
        }
        hv.ent = FG.entAt(g, m.tx, m.ty);
        if (!hv.ent) hv.ghost = g.ghostAt(m.tx, m.ty);
        const i = m.ty * g.world.W + m.tx;
        if (!hv.ent && g.world.res[i] && g.world.amt[i] > 0) hv.res = true;
      }
      view.hover = m.over ? hv : null;
      if (view.select) { view.select.x1 = m.tx; view.select.y1 = m.ty; }
      // Build preview.
      view.build = null;
      view.outOfReach = false;
      view.reach = BUILD_REACH;
      const c = app.cursor;
      if (m.over && c && c.bp && !view.select) {
        const [ax, ay] = this.blueprintAnchor(c.bp);
        view.build = {
          p: c.bp.ents[0].p,
          previews: c.bp.ents.map((b) => ({ p: b.p, x: ax + b.dx, y: ay + b.dy, dir: b.dir, ok: FG.canPlace(g, b.p, ax + b.dx, ay + b.dy, b.dir, { noReplace: true }).ok })),
        };
      } else if (m.over && c && c.item && D.items[c.item].place && !view.select) {
        const pv = this.previewFor(c.item, app.dir);
        const chk = FG.canPlace(g, pv.p, pv.x, pv.y, pv.dir);
        const reach = this.inReach(pv.x + pv.fw / 2, pv.y + pv.fh / 2, BUILD_REACH);
        const have = g.player.inv.count(c.item) > 0;
        view.outOfReach = !reach && !c.ghost;
        view.build = { p: pv.p, previews: [{ p: pv.p, x: pv.x, y: pv.y, dir: pv.dir, ok: chk.ok && (reach || c.ghost) && (have || g.bonus.drones) }], showPoles: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') };
        if (m.left && this.drag) this.dragBuild();
      }
      R.canvas.classList.toggle('cursor-build', !!(c && (c.bp || (c.item && D.items[c.item].place))) || !!this.mode);
      view.showPoleAreas = false;
    }

    // Called every simulation tick: translate held keys into game input.
    tick() {
      const app = this.app, g = this.g;
      if (!g) return;
      const k = this.keys;
      const inp = g.input;
      inp.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      inp.my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
      inp.shoot = k.has('Space');
      inp.aimX = this.mouse.wx; inp.aimY = this.mouse.wy;
      inp.mine = null;
      app.view.mineTarget = null;
      const m = this.mouse;
      const hv = app.view.hover;
      if (m.right && hv && !app.titleShown) {
        if (hv.ent) {
          const e = hv.ent;
          if (this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH)) {
            inp.mine = { kind: 'ent', id: e.id, key: 'e' + e.id };
            app.view.mineTarget = { cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
          } else this.warn('Out of reach');
        } else if (hv.res) {
          const [x, y] = hv.tile;
          if (g.world.res[y * g.world.W + x] === FG.RES.OIL) { this.warn('Crude oil needs a pumpjack'); }
          else if (this.inReach(x + 0.5, y + 0.5, MINE_REACH)) {
            inp.mine = { kind: 'res', x, y, key: 'r' + x + ',' + y };
            app.view.mineTarget = { cx: x + 0.5, cy: y + 0.5 };
          } else this.warn('Too far away to mine: walk closer');
        }
      }
      // Continuous repair while holding a repair kit.
      const c = app.cursor;
      if (m.left && c && c.item === 'repair_pack' && hv && hv.ent) {
        const e = hv.ent, pr = D.protos[e.p];
        if (e.hp < pr.hp && this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH)) {
          if (this.repairPool <= 0) {
            if (g.player.inv.remove('repair_pack', 1)) { this.repairPool = D.items.repair_pack.repair; g.stats.consume('repair_pack', 1); }
          }
          if (this.repairPool > 0) { const k = Math.min(2, pr.hp - e.hp, this.repairPool); e.hp += k; this.repairPool -= k; }
          if (!g.player.inv.count('repair_pack') && this.repairPool <= 0) app.cursor = null;
        }
      }
    }
  }

  function rotateBlueprint(bp, reverse) {
    const turns = reverse ? 3 : 1;
    let cur = bp;
    for (let t = 0; t < turns; t++) {
      const ents = cur.ents.map((b) => {
        const pr = D.protos[b.p];
        const [fw, fh] = FG.footprint(pr, b.dir);
        const rot = pr.rotatable || pr.w !== pr.h;
        return { p: b.p, dx: cur.h - (b.dy + fh), dy: b.dx, dir: rot ? (b.dir + 1) & 3 : b.dir, settings: b.settings };
      });
      cur = { w: cur.h, h: cur.w, ents };
    }
    return cur;
  }

  FG.Input = Input;
})();
