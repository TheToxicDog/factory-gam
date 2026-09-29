// Cogworks Frontier — keyboard and mouse: walking, building, mining, blueprints.
(function () {
  'use strict';
  const D = FG.data;
  const BUILD_REACH = 12;
  const MINE_REACH = 5;
  const RAIL_REACH = 20; // track pieces are long, so the planner reaches further
  // Heading (0 = north, clockwise in eighths) closest to the vector (dx, dy).
  const dir8 = (dx, dy) => Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)) & 7;

  class Input {
    constructor(app) {
      this.app = app;
      this.keys = new Set();
      this.mouse = { sx: 0, sy: 0, wx: 0, wy: 0, tx: 0, ty: 0, left: false, right: false, over: false };
      this.mode = null; // pending area selection: copy | cut | decon
      this.drag = null;
      this.repairPool = 0;
      this.lastWarn = 0;
      this.zDone = new Set(); // targets that already got one item during this Z press
      const cv = app.renderer.canvas;
      // The canvas holds keyboard focus while you play. When the game runs inside a frame (as
      // an embedded artifact), focus can move to the host page, and then keys stop reaching the
      // game. Any click that isn't on a text field takes it back.
      cv.tabIndex = -1;
      window.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select')) return;
        if (document.activeElement !== cv || !document.hasFocus()) cv.focus({ preventScroll: true });
      }, true);
      window.addEventListener('focus', () => app.ui && app.ui.setKeyboardHint(false));
      window.addEventListener('blur', () => app.ui && app.ui.setKeyboardHint(true));
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
      // Tab would move focus to buttons, or out of the game altogether when it is embedded.
      if (code === 'Tab') { e.preventDefault(); return; }
      // A button clicked earlier keeps focus; Space or Enter would press it again (and the
      // objective's Skip button would skip an objective), so hand them to the game instead.
      const act = document.activeElement;
      if (act && act.tagName === 'BUTTON' && (code === 'Space' || code === 'Enter' || code === 'NumpadEnter')) {
        e.preventDefault();
        act.blur();
      }
      if (e.altKey && (code === 'AltLeft' || code === 'AltRight')) { e.preventDefault(); app.view.altMode = !app.view.altMode; return; }
      if (e.ctrlKey || e.metaKey) {
        if (code === 'KeyC') { e.preventDefault(); this.mode = 'copy'; ui.toast('Drag over buildings to copy them', 'info'); }
        else if (code === 'KeyX') { e.preventDefault(); this.mode = 'cut'; ui.toast('Drag over buildings to cut them', 'info'); }
        else if (code === 'KeyV') { e.preventDefault(); if (app.blueprint) { app.cursor = { bp: app.blueprint }; } else ui.toast('Nothing copied yet: press Ctrl+C and drag first', 'warn'); }
        return;
      }
      switch (code) {
        case 'Escape':
          if (ui.held) ui.dropHeld();
          else if (this.mode) { this.mode = null; app.view.select = null; }
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
        case 'Slash': if (app.mp) { e.preventDefault(); ui.openChat(); } break;
        case 'KeyQ': this.pipette(); break;
        case 'KeyR': this.rotate(e.shiftKey); break;
        case 'KeyX': this.mode = 'decon'; ui.toast('Drag over buildings to pick them up', 'info'); break;
        case 'KeyZ':
          if (!e.repeat) { this.zDone.clear(); this.dropOne(true); }
          break;
        case 'Enter': case 'NumpadEnter':
          e.preventDefault();
          app.act({ t: 'board' });
          break;
        case 'KeyG': {
          app.act({ t: 'grenade', x: this.mouse.wx, y: this.mouse.wy });
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
      if (hv && hv.car) {
        const item = FG.trains.itemFor(hv.car.car);
        if (this.g.player.inv.count(item) > 0) app.cursor = { item };
        else this.warn('You have no ' + D.items[item].name);
        return;
      }
      if (hv && hv.rail && !hv.ent) {
        if (this.g.player.inv.count('rail') > 0) app.cursor = { item: 'rail' };
        else this.warn('You have no rails');
        return;
      }
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
      if (c && c.item && D.items[c.item].track) { app.railDir = ((app.railDir || 0) + (reverse ? 7 : 1)) & 7; this.railCache = null; return; }
      if (c && c.item && (D.items[c.item].place || D.items[c.item].car)) { app.dir = (app.dir + (reverse ? 3 : 1)) & 3; return; }
      const hv = app.view.hover;
      if (hv && hv.car) {
        if (hv.car.car.type !== 'loco') { this.warn('Only locomotives have a facing'); return; }
        app.act({ t: 'flip', car: hv.car.car.id });
        return;
      }
      if (hv && hv.ent) {
        const e = hv.ent;
        if (!this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
        app.act({ t: 'rot', e: e.id, rev: !!reverse });
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
      if (app.ui.held) { app.ui.dropHeld(); e.preventDefault(); return; } // clicking away puts a split stack back
      if (app.ui.win && app.ui.win.name !== 'entity' && app.ui.win.name !== 'inventory') app.ui.close();
      e.preventDefault();
      const m = this.mouse;
      if (e.button === 2) {
        m.right = true;
        if (e.shiftKey) { this.copySettings(); m.right = false; return; }
        const hv = app.view.hover;
        if (hv && hv.ghost && !hv.ent) { app.act({ t: 'ghostDel', gh: hv.ghost.id }); m.right = false; }
        else if (hv && hv.railGhost) { app.act({ t: 'railGhostDel', key: hv.railGhost.pc.key }); m.right = false; }
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
        if (this.drag && this.drag.rail) this.railCommit();
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
        if (it.car) { this.placeCar(c.item); return; }
        if (it.track && hv && hv.railGhost) { this.buildRailGhost(hv.railGhost.pc); return; }
        if (it.track) { this.railStart(); return; }
        if (hv && hv.car && !it.place) { this.insertIntoCar(hv.car, c.item, e.ctrlKey); return; }
        if (hv && hv.ent && (e.ctrlKey || !it.place)) { this.insertInto(hv.ent, c.item, e.ctrlKey); return; }
        if (it.place) { this.drag = { last: null, placed: new Map() }; this.dragBuild(); return; }
        if (c.item === 'grenade') { app.act({ t: 'grenade', x: this.mouse.wx, y: this.mouse.wy }); return; }
        if (it.repair) return; // handled continuously in update()
        return;
      }
      if (!hv) return;
      if (hv.car) {
        const p = FG.trains.carPose(hv.car.train, hv.car.index);
        if (!this.inReach(p.x, p.y, BUILD_REACH)) { this.warn('Out of reach'); return; }
        if (e.ctrlKey) { this.quickTakeCar(hv.car); return; }
        app.ui.open('train', hv.car);
        return;
      }
      if (hv.ent) {
        const e2 = hv.ent;
        if (!this.inReach(e2.x + e2.w / 2, e2.y + e2.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
        if (e.ctrlKey) { this.quickTake(e2); return; }
        if (e.shiftKey) { this.pasteSettings(e2); return; }
        app.ui.open('entity', e2);
        return;
      }
      if (hv.railGhost) { this.buildRailGhost(hv.railGhost.pc); return; }
      if (hv.ghost) {
        const gh = hv.ghost;
        const item = D.protos[gh.p].item;
        if (!g.player.inv.count(item)) { this.warn('You have no ' + D.items[item].name); return; }
        if (!this.inReach(gh.x + gh.w / 2, gh.y + gh.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
        app.act({ t: 'ghostBuild', gh: gh.id });
      }
    }

    placeCar(itemId) {
      const g = this.g;
      const m = this.mouse;
      if (!g.player.inv.count(itemId)) { this.warn('You have no ' + D.items[itemId].name); this.app.cursor = null; return; }
      if (!this.inReach(m.wx, m.wy, BUILD_REACH)) { this.warn('Out of reach'); return; }
      const plan = FG.trains.planCar(g, m.wx, m.wy, this.app.dir);
      if (!plan.ok) { this.warn(plan.reason); return; }
      this.app.act({ t: 'car', item: itemId, x: m.wx, y: m.wy, dir: this.app.dir });
    }

    // Z: put one of the held item into the machine, chest, belt or rail car under the cursor.
    // Keep Z held and sweep the mouse to put one into each thing you pass over.
    dropOne(pressed) {
      const app = this.app, g = this.g, m = this.mouse;
      const c = app.cursor, hv = app.view.hover;
      if (!g || app.titleShown) return;
      if (!c || !c.item || c.ghost) { if (pressed) this.warn('Hold an item first, then press Z over a machine'); return; }
      const id = c.item, name = D.items[id].name;
      if (!hv || !(hv.ent || hv.car)) { if (pressed) this.warn('Point at a machine, chest, belt or train to put one ' + name.toLowerCase() + ' in'); return; }
      let key, cx, cy;
      const c2 = { t: 'drop1', id };
      if (hv.car) {
        const hit = hv.car, p = FG.trains.carPose(hit.train, hit.index);
        key = 'c' + hit.car.id; cx = p.x; cy = p.y;
        c2.car = hit.car.id;
      } else {
        const e = hv.ent, pr = D.protos[e.p];
        key = 'e' + e.id; cx = e.x + e.w / 2; cy = e.y + e.h / 2;
        c2.e = e.id;
        const node = FG.isBeltKind(pr.kind) ? FG.belts.nodeAt(g, hv.tile[0], hv.tile[1]) : null;
        if (node) {
          // On a belt: one item per tile, on the lane nearest the cursor.
          key += ':' + hv.tile.join(',');
          cx = hv.tile[0] + 0.5; cy = hv.tile[1] + 0.5;
          const r = FG.rightOf(node.dir);
          c2.tile = hv.tile.slice();
          c2.lane = (m.wx - cx) * FG.DX[r] + (m.wy - cy) * FG.DY[r] >= 0 ? 1 : 0;
        }
      }
      if (this.zDone.has(key)) return;
      this.zDone.add(key);
      if (!g.player.inv.count(id)) { app.cursor = null; return; }
      if (!this.inReach(cx, cy, BUILD_REACH)) { this.warn('Out of reach'); return; }
      app.act(c2);
    }

    insertIntoCar(hit, id, all) {
      const g = this.g;
      const p = FG.trains.carPose(hit.train, hit.index);
      if (!this.inReach(p.x, p.y, BUILD_REACH)) { this.warn('Out of reach'); return; }
      if (!g.player.inv.count(id)) { this.app.cursor = null; return; }
      this.app.act({ t: 'insCar', car: hit.car.id, id, all: !!all });
    }

    insertInto(ent, id, all) {
      const g = this.g;
      if (!this.inReach(ent.x + ent.w / 2, ent.y + ent.h / 2, BUILD_REACH)) { this.warn('Out of reach'); return; }
      if (!g.player.inv.count(id)) { this.warn('You have no ' + D.items[id].name); this.app.cursor = null; return; }
      this.app.act({ t: 'insEnt', e: ent.id, id, all: !!all });
    }

    // Ctrl+click: take what a machine has made. If it has made nothing, take its fuel instead,
    // so you can get coal back from any burner (or pull out wood to make room for coal).
    quickTake(ent) { this.app.act({ t: 'qtake', e: ent.id }); }
    // Ctrl+click a rail car: a wagon's cargo, or a locomotive's fuel.
    quickTakeCar(hit) { this.app.act({ t: 'qtakeCar', car: hit.car.id }); }

    copySettings() {
      const hv = this.app.view.hover;
      if (!hv || !hv.ent) return;
      const e = hv.ent;
      this.app.copied = { recipe: e.recipe || null, filter: e.filter, prio: e.prio, name: e.name };
      this.app.ui.toast('Settings copied' + (e.recipe ? ': ' + D.recipes[e.recipe].name : ''));
    }
    pasteSettings(e) {
      const s = this.app.copied;
      if (!s) { this.warn('Shift+right-click a machine first to copy its settings'); return; }
      const pr = D.protos[e.p];
      if (s.recipe && pr.kind === 'crafter' && pr.cats.indexOf(D.recipes[s.recipe].cat) < 0) { this.warn('This machine cannot make that'); return; }
      this.app.act({ t: 'paste', e: e.id, s });
    }

    // ---------------------------------------------------------- building
    previewFor(itemId, dir) {
      const pr = D.protos[D.items[itemId].place];
      if (FG.rails.isSideKind(pr.kind)) {
        // Signals and stops snap to the right-hand side of the nearest track.
        const sn = FG.rails.snapSide(this.g, this.mouse.wx, this.mouse.wy);
        if (sn) return { p: pr.id, x: sn.tx, y: sn.ty, dir: 0, fw: 1, fh: 1, rd: sn.pd };
        return { p: pr.id, x: Math.floor(this.mouse.wx), y: Math.floor(this.mouse.wy), dir: 0, fw: 1, fh: 1, rd: this.app.railDir || 0, loose: true };
      }
      let d = pr.rotatable ? dir : 0;
      const [fw0, fh0] = FG.footprint(pr, d);
      const x = Math.round(this.mouse.wx - fw0 / 2), y = Math.round(this.mouse.wy - fh0 / 2);
      d = this.smartDir(pr, x, y, d);
      const [fw, fh] = FG.footprint(pr, d);
      // A loader loads a container it points at and unloads one behind it; upgrading one in
      // place keeps its mode.
      let lm;
      if (pr.kind === 'loader') {
        const old = FG.entAt(this.g, x, y);
        const same = old && D.protos[old.p].kind === 'loader' && old.x === x && old.y === y && old.dir === d;
        lm = same ? old.lm : FG.belts.guessLoaderMode(this.g, x, y, d);
      }
      return { p: pr.id, x, y, dir: d, fw, fh, lm };
    }

    // Orient pumps toward water and pair tunnel pipes automatically.
    smartDir(pr, x, y, d) {
      const g = this.g, w = g.world;
      if (pr.kind === 'offshore') {
        const ok = (dd) => w.isWater(x - FG.DX[dd], y - FG.DY[dd]) && w.inBounds(x - FG.DX[dd], y - FG.DY[dd]);
        if (!ok(d)) for (let k = 0; k < 4; k++) if (ok(k)) return k;
      }
      if (pr.kind === 'pipe_ug') {
        for (let k = 1; k <= pr.maxDist; k++) {
          const e = FG.entAt(g, x + FG.DX[d] * k, y + FG.DY[d] * k);
          if (!e || e.p !== 'pipe_ug') continue;
          if (e.dir === d) return FG.opposite(d);
          break;
        }
      }
      return d;
    }

    // Checks what it can locally, then asks for the build. Returns true if it asked.
    tryBuild(itemId, x, y, dir, ghost, settings, turn) {
      const g = this.g, app = this.app;
      const pr = D.protos[D.items[itemId].place];
      const [fw, fh] = FG.footprint(pr, pr.rotatable ? dir : 0);
      if (!this.inReach(x + fw / 2, y + fh / 2, BUILD_REACH) && !ghost) { this.warn('Out of reach'); return false; }
      if (ghost || g.player.inv.count(itemId) < 1) {
        if (!g.bonus.drones && !ghost) { this.warn('You have no ' + D.items[itemId].name); return false; }
        if (!g.bonus.drones) return false;
        if (!FG.canPlace(g, pr.id, x, y, dir, { noReplace: true, ignorePlayer: true }).ok) return false;
      } else {
        const chk = FG.canPlace(g, pr.id, x, y, dir);
        if (!chk.ok) {
          if (chk.reason && chk.reason !== 'Space is occupied') this.warn(chk.reason);
          if (!turn) return false;
        }
      }
      app.act({ t: 'build', item: itemId, x, y, dir, ghost: !!ghost, s: settings, turn }, (r) => {
        if (r && pr.kind === 'underground' && r.ug === 'out') app.dir = r.dir;
      });
      return true;
    }

    dragBuild() {
      const app = this.app;
      const c = app.cursor;
      if (!c || !c.item || !this.drag) return;
      const pr = D.protos[D.items[c.item].place];
      const pv = this.previewFor(c.item, app.dir);
      const last = this.drag.last;
      if (last && last[0] === pv.x && last[1] === pv.y) return;
      if (FG.rails.isSideKind(pr.kind)) {
        if (last) return;
        this.drag.last = [pv.x, pv.y];
        if (pv.loose) { this.warn('Place it beside a track'); return; }
        this.tryBuild(c.item, pv.x, pv.y, 0, c.ghost, { rd: pv.rd });
        return;
      }
      if (pr.kind === 'belt' && last) {
        // Walk tile by tile toward the mouse, turning belts to follow the drag.
        let [x, y] = last;
        let guard = 0;
        while ((x !== pv.x || y !== pv.y) && guard++ < 64) {
          const dx = pv.x - x, dy = pv.y - y;
          let d;
          if (Math.abs(dx) >= Math.abs(dy)) d = dx > 0 ? 1 : 3; else d = dy > 0 ? 2 : 0;
          // Turn the belt this drag just laid behind us to follow the corner.
          const pk = x + ',' + y;
          const turn = this.drag.placed.has(pk) && this.drag.placed.get(pk) !== d ? [x, y, d] : undefined;
          if (turn) this.drag.placed.set(pk, d);
          x += FG.DX[d]; y += FG.DY[d];
          app.dir = d;
          if (this.tryBuild(c.item, x, y, d, c.ghost, undefined, turn)) this.drag.placed.set(x + ',' + y, d);
          if (!app.cursor) break;
        }
        this.drag.last = [pv.x, pv.y];
        return;
      }
      if (this.tryBuild(c.item, pv.x, pv.y, pv.dir, c.ghost, pv.lm ? { lm: pv.lm } : undefined)) this.drag.placed.set(pv.x + ',' + pv.y, pv.dir);
      this.drag.last = [pv.x, pv.y];
    }

    // ------------------------------------------------------ rail planner
    // Press on a rail point and drag: the planner lays straights, diagonals and curves
    // (reusing existing track) to reach the point under the mouse. A click lays one piece.
    // Click planned track: build it and the planned track joined to it, as far as you reach.
    buildRailGhost(pc) {
      const g = this.g, m = this.mouse;
      const cost = FG.rails.itemCost(pc.t);
      if (g.player.inv.count('rail') < cost) { this.warn('You need ' + cost + ' rail' + (cost > 1 ? 's' : '') + ' for this piece'); return; }
      if (!this.inReach(m.wx, m.wy, RAIL_REACH)) { this.warn('Out of reach'); return; }
      this.app.act({ t: 'railRun', key: pc.key });
    }
    railStart() {
      const [x, y] = FG.rails.snapPoint(this.mouse.wx, this.mouse.wy);
      this.drag = { rail: true, sx: x, sy: y };
      this.railCache = null;
    }
    railPlanFor() {
      const g = this.g, RL = FG.rails, app = this.app, R = g.rail;
      const [tx, ty] = RL.snapPoint(this.mouse.wx, this.mouse.wy);
      const d = this.drag && this.drag.rail ? this.drag : null;
      const key = (d ? d.sx + ',' + d.sy + '>' : '') + tx + ',' + ty + ':' + app.railDir + ':' + R.nextPiece + ':' + R.pieces.size;
      let plan = this.railCache && this.railCache.key === key ? this.railCache.plan : null;
      if (!plan) {
        let steps;
        if (!d || (d.sx === tx && d.sy === ty)) {
          // One straight piece: carry on from a dead end here, else use the chosen heading.
          let h = app.railDir || 0;
          for (let k = 0; k < 8; k++) if (R.out.has(RL.stateKey(tx, ty, RL.opp8(k))) && !R.out.has(RL.stateKey(tx, ty, k))) { h = k; break; }
          steps = [{ ax: tx, ay: ty, ah: h, t: 'S' }];
          steps.reached = true;
        } else steps = RL.plan(g, RL.startsAt(g, d.sx, d.sy, dir8(tx - d.sx, ty - d.sy)), tx, ty);
        const pieces = steps.map((st) => { const pc = RL.makePiece(st.ax, st.ay, st.ah, st.t); pc.exists = R.byKey.has(pc.key); return pc; });
        const clear = pieces.every((pc) => pc.exists || RL.pieceClear(g, pc));
        const need = pieces.reduce((n, pc) => n + (pc.exists ? 0 : RL.itemCost(pc.t)), 0);
        plan = { pieces, need, reached: !!steps.reached && clear, point: [tx, ty] };
        this.railCache = { key, plan };
      }
      plan.ok = plan.reached && (g.player.inv.count('rail') >= plan.need || !!g.bonus.drones);
      return plan;
    }
    railCommit() {
      const g = this.g, RL = FG.rails, app = this.app;
      const plan = this.railPlanFor();
      this.railCache = null;
      if (!plan.reached) { this.warn('Track cannot reach there'); return; }
      const ghostOnly = !!(app.cursor && app.cursor.ghost);
      const pieces = plan.pieces.filter((pc) => !g.rail.byKey.has(pc.key)).map((pc) => [pc.ax, pc.ay, pc.ah, pc.t]);
      if (pieces.length) app.act({ t: 'rails', pieces, ghostOnly });
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
      }
      const RL = FG.rails;
      const inArea = (x, y) => x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1;
      const railsIn = Array.from(g.rail.pieces.values()).filter((pc) => inArea(pc.ax, pc.ay) && inArea(pc.bx, pc.by));
      if (s.mode === 'copy' || s.mode === 'cut') {
        if (!inside.length && !railsIn.length) { app.ui.toast('No buildings in that area', 'warn'); return; }
        const xs = [], ys = [], xe = [], ye = [];
        for (const e of inside) { xs.push(e.x); ys.push(e.y); xe.push(e.x + e.w); ye.push(e.y + e.h); }
        for (const pc of railsIn) { xs.push(pc.ax, pc.bx); ys.push(pc.ay, pc.by); xe.push(pc.ax, pc.bx); ye.push(pc.ay, pc.by); }
        let bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xe) - bx, bh = Math.max(...ye) - by;
        if (railsIn.length) {
          // Track sits on a 2-tile grid, so keep the blueprint aligned to it.
          const ex = Math.max(...xe), ey = Math.max(...ye);
          bx = Math.floor(bx / 2) * 2; by = Math.floor(by / 2) * 2;
          bw = Math.ceil((ex - bx) / 2) * 2; bh = Math.ceil((ey - by) / 2) * 2;
        }
        const bp = {
          w: bw, h: bh,
          ents: inside.map((e) => ({ p: e.p, dx: e.x - bx, dy: e.y - by, dir: e.dir, settings: { recipe: e.recipe || null, filter: e.filter, prio: e.prio, rd: e.rd, name: e.name, lm: e.lm } })),
          rails: railsIn.map((pc) => [pc.ax - bx, pc.ay - by, pc.ah, pc.t]),
        };
        app.blueprint = bp;
        app.cursor = { bp };
        const what = [];
        if (inside.length) what.push(inside.length + ' buildings');
        if (railsIn.length) what.push(railsIn.length + ' pieces of track');
        app.ui.toast((s.mode === 'cut' ? 'Cut ' : 'Copied ') + what.join(' and ') + ' · click to paste, R to rotate', 'good');
      }
      if (s.mode === 'cut' || s.mode === 'decon') app.act({ t: 'area', mode: s.mode, x0, y0, x1, y1 });
    }

    blueprintAnchor(bp) {
      if (bp.rails && bp.rails.length) return [Math.round((this.mouse.wx - bp.w / 2) / 2) * 2, Math.round((this.mouse.wy - bp.h / 2) / 2) * 2];
      return [Math.round(this.mouse.wx - bp.w / 2), Math.round(this.mouse.wy - bp.h / 2)];
    }

    pasteBlueprint(bp) {
      const [ax, ay] = this.blueprintAnchor(bp);
      this.app.act({ t: 'bp', bp: { ents: bp.ents, rails: bp.rails || [] }, ax, ay });
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
        hv.car = FG.trains.carAtPoint(g, wx, wy);
        hv.ent = hv.car ? null : FG.entAt(g, m.tx, m.ty);
        if (!hv.ent && !hv.car) hv.ghost = g.ghostAt(m.tx, m.ty);
        if (!hv.ent && !hv.car && !hv.ghost) hv.rail = FG.rails.pieceNear(g, wx, wy, 0.95);
        if (!hv.ent && !hv.car && !hv.ghost && !hv.rail) hv.railGhost = FG.rails.ghostNear(g, wx, wy, 0.95);
        const i = m.ty * g.world.W + m.tx;
        if (!hv.ent && !hv.car && !hv.rail && g.world.res[i] && g.world.amt[i] > 0) hv.res = true;
      }
      view.hover = m.over ? hv : null;
      if (view.select) { view.select.x1 = m.tx; view.select.y1 = m.ty; }
      // Build preview.
      view.build = null;
      view.railPlan = null;
      view.outOfReach = false;
      view.reach = BUILD_REACH;
      let c = app.cursor;
      // Let go of an item once the last one is used (drones can still plan ghosts of it).
      if (c && c.item && !c.ghost && !g.player.inv.count(c.item) && !(g.bonus.drones && D.items[c.item].place)) { app.cursor = c = null; }
      view.held = c && c.item ? c.item : g.enemies.playerGun();
      view.aim = { aimX: wx, aimY: wy };
      if (m.over && c && c.bp && !view.select) {
        const [ax, ay] = this.blueprintAnchor(c.bp);
        view.build = {
          p: c.bp.ents.length ? c.bp.ents[0].p : null,
          previews: c.bp.ents.map((b) => ({ p: b.p, x: ax + b.dx, y: ay + b.dy, dir: b.dir, rd: b.settings && b.settings.rd, lm: b.settings && b.settings.lm, ok: FG.canPlace(g, b.p, ax + b.dx, ay + b.dy, b.dir, { noReplace: true }).ok })),
        };
        if (c.bp.rails && c.bp.rails.length) {
          const pieces = c.bp.rails.map(([dx, dy, ah, t]) => { const pc = FG.rails.makePiece(ax + dx, ay + dy, ah, t); pc.exists = g.rail.byKey.has(pc.key); return pc; });
          view.railPlan = { pieces, ok: pieces.every((pc) => pc.exists || FG.rails.pieceClear(g, pc)) };
        }
      } else if (m.over && c && c.item && D.items[c.item].track && !view.select) {
        view.railPlan = this.railPlanFor();
      } else if (m.over && c && c.item && D.items[c.item].place && !view.select) {
        const pv = this.previewFor(c.item, app.dir);
        const chk = FG.canPlace(g, pv.p, pv.x, pv.y, pv.dir);
        const reach = this.inReach(pv.x + pv.fw / 2, pv.y + pv.fh / 2, BUILD_REACH);
        const have = g.player.inv.count(c.item) > 0;
        view.outOfReach = !reach && !c.ghost;
        view.build = { p: pv.p, previews: [{ p: pv.p, x: pv.x, y: pv.y, dir: pv.dir, rd: pv.rd, lm: pv.lm, ok: chk.ok && !pv.loose && (reach || c.ghost) && (have || g.bonus.drones) }], showPoles: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') };
        if (m.left && this.drag) this.dragBuild();
      }
      view.carPreview = null;
      if (m.over && c && c.item && D.items[c.item].car) {
        const TR = FG.trains;
        const plan = TR.planCar(g, wx, wy, app.dir);
        let pose = { x: wx, y: wy, angle: (app.dir - 1) * Math.PI / 2 };
        if (plan.ok && plan.segs) {
          let s0 = 0;
          for (const sg of plan.segs) { sg.s0 = s0; s0 += sg.len; }
          pose = TR.carPose({ segs: plan.segs, headS: plan.headS, cars: [{}] }, 0);
        } else if (plan.ok && plan.attach) {
          // Just past the end of the train, continuing its heading.
          const tr = plan.attach.train, front = plan.attach.front;
          const p = TR.pointAt(tr, front ? tr.headS : tr.headS - TR.trainLen(tr));
          const k = (front ? 1 : -1) * (TR.GAP + TR.CAR_LEN / 2);
          pose = { x: p[0] + Math.cos(p[2]) * k, y: p[1] + Math.sin(p[2]) * k, angle: p[2] };
        }
        view.carPreview = Object.assign(pose, { type: D.items[c.item].car, ok: plan.ok });
      }
      R.canvas.classList.toggle('cursor-build', !!(c && (c.bp || (c.item && (D.items[c.item].place || D.items[c.item].car || D.items[c.item].track)))) || !!this.mode);
      view.showPoleAreas = false;
    }

    // Called every simulation tick (every frame in multiplayer): turn held keys and buttons
    // into the player's input.
    tick() {
      const app = this.app, g = this.g;
      if (!g) return;
      const k = this.keys;
      const inp = { t: 'in', mx: 0, my: 0, sh: false, ax: this.mouse.wx, ay: this.mouse.wy, mine: null, rep: 0 };
      if (!app.chatOpen) {
        inp.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        inp.my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
        inp.sh = k.has('Space');
      }
      app.view.mineTarget = null;
      if (k.has('KeyZ')) this.dropOne(false);
      else if (this.zDone.size) this.zDone.clear();
      const m = this.mouse;
      const hv = app.view.hover;
      if (m.right && hv && !app.titleShown) {
        if (hv.car) {
          const p = FG.trains.carPose(hv.car.train, hv.car.index);
          if (this.inReach(p.x, p.y, BUILD_REACH)) {
            inp.mine = { kind: 'car', id: hv.car.car.id, key: 'c' + hv.car.car.id };
            app.view.mineTarget = { cx: p.x, cy: p.y };
          } else this.warn('Out of reach');
        } else if (hv.ent) {
          const e = hv.ent;
          if (this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH)) {
            inp.mine = { kind: 'ent', id: e.id, key: 'e' + e.id };
            app.view.mineTarget = { cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
          } else this.warn('Out of reach');
        } else if (hv.rail) {
          const pc = hv.rail.pc;
          if (this.inReach(m.wx, m.wy, BUILD_REACH)) {
            inp.mine = { kind: 'rail', id: pc.id, key: 'p' + pc.id };
            app.view.mineTarget = { cx: m.wx, cy: m.wy };
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
        if (e.hp < pr.hp && this.inReach(e.x + e.w / 2, e.y + e.h / 2, BUILD_REACH)) inp.rep = e.id;
      }
      app.setInput(inp);
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
        let settings = b.settings;
        if (settings && settings.rd !== undefined) settings = Object.assign({}, settings, { rd: (settings.rd + 2) & 7 });
        return { p: b.p, dx: cur.h - (b.dy + fh), dy: b.dx, dir: rot ? (b.dir + 1) & 3 : b.dir, settings };
      });
      // A point (x, y) turns to (h - y, x); headings turn a quarter.
      const rails = (cur.rails || []).map(([dx, dy, ah, t]) => [cur.h - dy, dx, (ah + 2) & 7, t]);
      cur = { w: cur.h, h: cur.w, ents, rails };
    }
    return cur;
  }

  FG.Input = Input;
})();
