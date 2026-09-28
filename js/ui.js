// Cogworks Frontier — DOM interface: HUD, windows, tooltips and toasts.
(function () {
  'use strict';
  const D = FG.data;

  // ------------------------------------------------------------ DOM helper
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { for (const k of kid) add(el, k); return; }
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  FG.h = h;

  const nameOf = (id) => (D.items[id] ? D.items[id].name : D.fluids[id] ? D.fluids[id].name : id);
  const entName = (e) => nameOf(D.protos[e.p].item);
  const icon = (id) => FG.icons.url(id);
  const img = (id, size) => h('img', { src: icon(id), alt: '', width: size || 24, height: size || 24 });

  const STATUS = {
    working: ['Working', 'good'], idle: ['Idle', ''], no_power: ['No power', 'bad'], low_power: ['Low power', 'warn'],
    no_fuel: ['Out of fuel', 'bad'], no_input: ['Waiting for ingredients', 'warn'], no_recipe: ['No recipe set', ''],
    output_full: ['Output full', 'warn'], no_ore: ['Ore depleted', 'bad'], waiting_space: ['Output blocked', 'warn'],
    no_research: ['No research selected', ''], no_target: ['Nothing to drop into', 'warn'], no_source: ['Nothing to pick from', 'warn'],
    waiting: ['Waiting for items', ''], target_full: ['Target has enough', ''], other_fuel: ['Target is burning a different fuel', 'warn'], no_water: ['No water', 'warn'], no_ammo: ['Out of ammo', 'bad'],
    ready: ['Ready to launch', 'good'], need_satellite: ['Needs a Survey satellite', 'warn'], launching: ['Launching', 'good'],
  };
  // Loaders read differently loading ('in') and unloading ('out').
  const LOADER_STATUS = {
    'in:working': ['Loading', 'good'], 'in:waiting': ['Waiting for items', ''], 'in:target_full': ['Target is full', 'warn'], 'in:no_target': ['Nothing to load into', 'warn'],
    'out:working': ['Unloading', 'good'], 'out:waiting': ['Nothing left to unload', ''], 'out:output_full': ['Belt is backed up', ''], 'out:no_source': ['Nothing to unload from', 'warn'],
  };
  // What a loader fills or empties, in words.
  function loaderTarget(g, e) {
    const st = FG.belts.loaderStore(g, e.node);
    if (!st) return 'nothing';
    if (st.car) return st.car.type === 'loco' ? 'locomotive' : 'wagon';
    return nameOf(D.protos[st.ent.p].item).toLowerCase();
  }
  function statusOf(e) {
    const pr = D.protos[e.p];
    if (pr.kind === 'loader') return LOADER_STATUS[e.lm + ':' + e.status] || STATUS[e.status] || null;
    if (pr.kind === 'pole') {
      const n = e.net;
      if (!n) return ['Not connected', ''];
      if (n.demand <= 0) return [n.supply > 0 ? 'Network idle' : 'No generation', n.supply > 0 ? 'good' : 'bad'];
      return n.sat >= 0.999 ? ['Network satisfied', 'good'] : ['Network ' + Math.round(n.sat * 100) + '% satisfied', n.sat > 0.5 ? 'warn' : 'bad'];
    }
    if (pr.kind === 'engine') return (e.out || 0) > 1 ? ['Generating', 'good'] : e.net ? ['Idle', ''] : ['Not connected to a pole', 'warn'];
    if (pr.kind === 'solar') return e.net ? ['Generating', 'good'] : ['Not connected to a pole', 'warn'];
    if (pr.kind === 'accumulator') return e.net ? ['Storing energy', 'good'] : ['Not connected to a pole', 'warn'];
    if (pr.kind === 'trainstop') return e.attached ? ['Stop “' + e.name + '”', 'good'] : ['Not beside any track', 'bad'];
    if (pr.kind === 'signal') {
      const st = FG.trains.signalState(FG.app.game, e);
      if (st === 'none') return e.attached ? ['No track beyond this signal', 'warn'] : ['Not beside any track', 'bad'];
      return st === 'free' ? ['Block clear', 'good'] : st === 'reserved' ? ['Block reserved by a train', 'warn'] : ['Block occupied', 'bad'];
    }
    if (pr.kind === 'chest' || pr.kind === 'wall' || pr.kind === 'pipe' || pr.kind === 'pipe_ug' || pr.kind === 'tank' || FG.isBeltKind(pr.kind)) return null;
    if (FG.power.isElectric(pr) && !e.net && pr.kind !== 'engine') return ['Not connected to a pole', 'bad'];
    return STATUS[e.status] || [e.status, ''];
  }
  const COND_TEXT = { full: 'until the cargo is full', empty: 'until the cargo is empty', time: 'for a set time', inactive: 'until loading stops' };
  function trainStatus(g, tr) {
    if (!tr.cars.some((c) => c.type === 'loco')) return ['Needs a locomotive', 'bad'];
    if (tr.noFuel && tr.state !== 'station') return ['Out of fuel', 'bad'];
    if (tr.mode === 'manual') return [tr.speed > 0 ? 'Driving manually' : 'Manual control', ''];
    const e = tr.schedule[tr.cur];
    switch (tr.state) {
      case 'no_schedule': return ['No schedule: add a stop below', 'warn'];
      case 'no_path': return [tr.msg || 'No path', 'bad'];
      case 'station': {
        let t = 'At ' + (e ? e.station : 'stop') + ', waiting ' + (e ? COND_TEXT[e.cond] : '');
        if (e && e.cond === 'time') t += ' (' + Math.max(0, Math.ceil((e.v || 10) - tr.wait / 60)) + 's left)';
        return [t, 'good'];
      }
      case 'moving':
        if (tr.speed === 0 && tr.blocked === 'signal') return ['Waiting at a signal', 'warn'];
        if (tr.speed === 0 && tr.blocked === 'train') return ['Waiting for another train to clear the track', 'warn'];
        return ['Heading to ' + (e ? e.station : '?'), 'good'];
    }
    return ['Planning a route', ''];
  }
  FG.trainStatus = trainStatus;

  function statusPill(e) {
    const s = statusOf(e);
    return s ? h('span', { class: 'status ' + s[1], text: s[0] }) : null;
  }

  function slotEl(id, n, opts) {
    opts = opts || {};
    const el = h('div', { class: 'slot' + (id ? '' : ' empty') + (opts.cls ? ' ' + opts.cls : '') });
    setSlot(el, id, n);
    if (opts.tip !== false && id) el.dataset.item = id;
    if (opts.onDown) el.addEventListener('mousedown', (ev) => { ev.preventDefault(); opts.onDown(ev); });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return el;
  }
  function setSlot(el, id, n, missing) {
    const key = (id || '') + ':' + (n === undefined ? '' : n) + ':' + (missing ? 1 : 0);
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.style.backgroundImage = id ? 'url(' + icon(id) + ')' : '';
    el.classList.toggle('empty', !id);
    el.classList.toggle('missing', !!missing);
    if (id) el.dataset.item = id; else delete el.dataset.item;
    let c = el.querySelector('.n');
    const txt = n === undefined || n === null || n === '' ? '' : typeof n === 'number' ? FG.fmt(n) : n;
    if (txt !== '') {
      if (!c) { c = h('span', { class: 'n' }); el.appendChild(c); }
      c.textContent = txt;
    } else if (c) c.remove();
  }

  // ----------------------------------------------------------------- UI
  class UI {
    constructor(app) {
      this.app = app;
      this.$ = (id) => document.getElementById(id);
      this.win = null; // { name, el, update, arg }
      this.alerts = [];
      this.lastHud = 0;
      this.lastMini = 0;
      this.mapView = null;
      this.hotbarEls = [];
      // A stack split off in the inventory window, following the mouse until it is put down.
      this.held = null; // { i: source slot, id, n }
      this.heldEl = h('div', { class: 'slot held-stack', hidden: true });
      document.body.appendChild(this.heldEl);
      document.addEventListener('mousemove', (ev) => { if (this.held) this.placeHeldEl(ev.clientX, ev.clientY); });
      this.setupTooltip();
      this.setupHud();
      // Ignore events from the title-screen demo factory.
      const live = () => this.app.game && !this.app.titleShown;
      FG.on('message', (text, kind) => { if (live()) this.toast(text, kind); });
      FG.on('research', (tid) => { if (tid && live()) this.toast('Researched ' + D.techs[tid].name, 'research'); });
      FG.on('objective', (o) => { if (live()) this.toast('Objective complete: ' + o.text, 'good'); });
      FG.on('alert', (a) => { if (live()) this.alert(a); });
      FG.on('launch', () => { if (live()) this.open('victory'); });
    }

    get g() { return this.app.game; }

    // ------------------------------------------------------------ tooltip
    setupTooltip() {
      const tip = this.$('tooltip');
      this.tipEl = tip;
      document.addEventListener('mouseover', (ev) => {
        const t = ev.target.closest && ev.target.closest('[data-item],[data-recipe],[data-tech],[data-text]');
        if (!t) { tip.hidden = true; return; }
        let html = null;
        if (t.dataset.recipe) html = this.recipeTip(t.dataset.recipe, t.dataset.mode);
        else if (t.dataset.tech) html = this.techTip(t.dataset.tech);
        else if (t.dataset.item) html = this.itemTip(t.dataset.item);
        else html = '<div>' + t.dataset.text + '</div>';
        if (!html) { tip.hidden = true; return; }
        tip.innerHTML = html;
        tip.hidden = false;
        this.placeTip(ev);
      });
      document.addEventListener('mousemove', (ev) => { if (!tip.hidden) this.placeTip(ev); });
    }
    placeTip(ev) {
      const tip = this.tipEl;
      const r = tip.getBoundingClientRect();
      let x = ev.clientX + 16, y = ev.clientY + 16;
      if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 12;
      if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
      tip.style.left = Math.max(4, x) + 'px';
      tip.style.top = Math.max(4, y) + 'px';
    }
    ingHtml(map, fluid) {
      return Object.keys(map).map((k) => '<span><img src="' + icon(k) + '">' + FG.fmt(map[k]) + (fluid ? '' : '×') + '</span>').join('');
    }
    itemTip(id) {
      if (D.fluids[id]) return '<h4>' + D.fluids[id].name + '</h4><div class="muted">Fluid</div>';
      const it = D.items[id];
      if (!it) return null;
      const r = D.recipeFor[id];
      let s = '<h4>' + it.name + '</h4>';
      if (r && this.g) s += this.recipeBody(r, true);
      if (it.fuel) s += '<div class="muted">Fuel value: ' + (it.fuel / 1000) + ' MJ</div>';
      if (it.place) {
        const pr = D.protos[it.place];
        const bits = [];
        if (pr.power && !pr.burner) bits.push('Uses ' + FG.fmtPower(pr.power) + ' electric');
        if (pr.burner) bits.push('Burns fuel (' + FG.fmtPower(pr.power) + ')');
        if (pr.speed && !FG.isBeltKind(pr.kind)) bits.push('Speed ' + pr.speed);
        if (FG.isBeltKind(pr.kind)) bits.push(Math.round(pr.speed * 8) + ' items/s');
        if (pr.kind === 'loader') bits.push('Point it at a chest to fill it, away to empty it');
        if (pr.maxDist) bits.push('Max length ' + pr.maxDist);
        if (pr.supply) bits.push('Supply area ' + pr.supply * 2 + '×' + pr.supply * 2 + ', wire reach ' + pr.reach);
        if (pr.pollution) bits.push('Pollution ' + pr.pollution + '/min');
        if (pr.modules) bits.push(pr.modules + ' module slots');
        if (pr.kind === 'inserter') bits.push((60 / (pr.swing * 2)).toFixed(2) + ' swings/s');
        if (pr.range) bits.push('Range ' + pr.range);
        bits.push(pr.w + '×' + pr.h);
        s += '<div class="muted">' + bits.join(' · ') + '</div>';
      }
      if (it.module) {
        const m = it.module, parts = [];
        if (m.speed) parts.push('Speed ' + (m.speed > 0 ? '+' : '') + Math.round(m.speed * 100) + '%');
        if (m.prod) parts.push('Productivity +' + Math.round(m.prod * 100) + '%');
        if (m.power) parts.push('Energy ' + (m.power > 0 ? '+' : '') + Math.round(m.power * 100) + '%');
        if (m.pollution) parts.push('Pollution +' + Math.round(m.pollution * 100) + '%');
        s += '<div class="muted">' + parts.join(' · ') + '</div>';
      }
      if (it.ammo) s += '<div class="muted">' + it.ammo.dmg + ' damage × ' + it.ammo.rounds + ' rounds</div>';
      if (it.gun) s += '<div class="muted">Hold Space to fire at the nearest enemy</div>';
      if (id === 'grenade') s += '<div class="muted">Press G to throw at the cursor (35 area damage)</div>';
      if (it.repair) s += '<div class="muted">Hold it and left-click damaged buildings</div>';
      return s;
    }
    recipeBody(r, compact) {
      let s = '<div class="ing">' + this.ingHtml(r.ing) + this.ingHtml(r.fin, true) + '<span class="muted">⏱ ' + r.time + 's</span></div>';
      const outs = Object.assign({}, r.out, r.fout);
      if (!compact || Object.keys(outs).length > 1 || (outs[r.main] || 0) > 1) s += '<div class="ing">→ ' + this.ingHtml(outs) + '</div>';
      const where = { crafting: 'Hand or assembler', advanced: 'Assembler only', smelting: 'Furnace', chemistry: 'Chemical plant', refining: 'Oil refinery', uplink: 'Orbital Uplink' }[r.cat];
      s += '<div class="muted">' + where + '</div>';
      if (this.g && !this.g.recipeEnabled(r.id)) {
        const t = D.recipeTech[r.id];
        s += '<div class="warn">Locked: research ' + (t ? D.techs[t].name : '?') + '</div>';
      }
      return s;
    }
    recipeTip(rid, mode) {
      const r = D.recipes[rid];
      if (!r) return null;
      let s = '<h4>' + r.name + '</h4>' + this.recipeBody(r, false);
      if (mode === 'hand' && this.g) {
        const n = this.g.craftableCount(rid);
        s += n ? '<div class="good">Can craft ' + n + ' · click 1, right-click 5, shift-click all</div>' : '<div class="warn">Missing ingredients</div>';
      }
      return s;
    }
    techTip(tid) {
      const t = D.techs[tid];
      let s = '<h4>' + t.name + '</h4>';
      s += '<div class="ing">' + this.ingHtml(t.cost) + '<span class="muted">× ' + t.units + ' · ' + t.time + 's each</span></div>';
      if (t.unlocks.length) s += '<div class="muted">Unlocks: ' + t.unlocks.map((u) => D.recipes[u].name).join(', ') + '</div>';
      if (t.desc) s += '<div class="muted">' + t.desc + '</div>';
      for (const ef of t.effects) {
        const txt = { inv: '+' + ef.v + ' inventory slots', hand: '+' + ef.v + ' arm hand size', lab_speed: '+' + Math.round(ef.v * 100) + '% lab speed', mining_prod: '+' + Math.round(ef.v * 100) + '% mining productivity', bullet_dmg: '+' + Math.round(ef.v * 100) + '% bullet damage', fire_rate: '+' + Math.round(ef.v * 100) + '% fire rate', laser_dmg: '+' + Math.round(ef.v * 100) + '% laser damage', drones: 'Personal construction drones' }[ef.type];
        if (txt) s += '<div class="good">' + txt + '</div>';
      }
      if (t.prereq.length) s += '<div class="muted">Requires: ' + t.prereq.map((p) => D.techs[p].name).join(', ') + '</div>';
      const st = this.g && this.g.techState(tid);
      if (st === 'available') s += '<div class="muted">Click to queue · shift-click to research now</div>';
      if (st === 'locked') s += '<div class="muted">Click to queue it with its prerequisites</div>';
      return s;
    }

    // --------------------------------------------------------------- HUD
    setupHud() {
      this.$('hud-research').addEventListener('click', () => this.toggle('tech'));
      this.$('minimap-wrap').addEventListener('click', () => this.toggle('map'));
      const hb = this.$('hotbar');
      for (let i = 0; i < 10; i++) {
        const el = slotEl(null, undefined, {
          onDown: (ev) => this.app.input.hotbarClick(i, ev.button),
        });
        el.appendChild(h('span', { class: 'key', text: String((i + 1) % 10) }));
        hb.appendChild(el);
        this.hotbarEls.push(el);
      }
      this.$('hud-objective').addEventListener('click', (ev) => {
        if (ev.target.classList.contains('skip')) { this.g.objectives.skip(); this.updateObjective(true); }
        else this.$('hud-objective').classList.toggle('collapsed');
      });
      FG.on('objectives', () => { if (this.app.game && !this.app.titleShown) this.updateObjective(true); });
    }

    updateObjective(force) {
      const g = this.g;
      const o = g.objectives.current;
      const key = o ? o.id : 'none';
      if (!force && this.objKey === key) return;
      this.objKey = key;
      const el = this.$('hud-objective');
      el.innerHTML = '';
      el.classList.toggle('done', !o);
      const n = g.objectives.idx + 1, total = g.objectives.list.length;
      if (!o) {
        el.append(h('div', { class: 'eyebrow', text: 'All objectives complete' }), h('h2', { text: 'The frontier is yours' }), h('p', { text: 'Keep expanding: every research and every upgrade still counts.' }));
        return;
      }
      el.append(
        h('div', { class: 'row' }, h('span', { class: 'eyebrow', text: 'Objective ' + n + ' / ' + total }), h('button', { class: 'skip', text: 'Skip', title: 'Skip this objective' })),
        h('h2', { text: o.text }),
        h('p', { text: o.hint }),
      );
    }

    updateHud() {
      const g = this.g, app = this.app;
      if (!g) return;
      this.updateObjective(false);
      // research card
      const r = g.research;
      const rc = this.$('hud-research');
      const cur = r.current && D.techs[r.current];
      const rkey = (cur ? cur.id : '') + ':' + (cur ? r.progress[cur.id] || 0 : 0);
      if (rc.dataset.k !== rkey) {
        rc.dataset.k = rkey;
        rc.innerHTML = '';
        if (cur) {
          const p = (r.progress[cur.id] || 0) / cur.units;
          rc.append(h('div', { class: 'eyebrow', text: 'Researching' }),
            h('div', { class: 'row' }, h('div', { class: 'icon', style: 'background-image:url(' + icon(cur.icon) + ')' }),
              h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'name', text: cur.name }),
                h('div', { class: 'bar' }, h('i', { style: 'width:' + (p * 100).toFixed(1) + '%' })))));
        } else {
          rc.append(h('div', { class: 'eyebrow', text: 'Research' }), h('div', { class: 'name', style: 'color:var(--muted);font-size:14px;margin-top:3px', text: 'Nothing queued · press T' }));
        }
      }
      // clock
      const light = g.daylight();
      const tod = light > 0.9 ? 'Day' : light > 0.1 ? (((g.tick + 2500) % 25000) / 25000 < 0.6 ? 'Dusk' : 'Dawn') : 'Night';
      const evo = g.opts.enemies === 'off' ? '' : ' · Evolution <b>' + (g.enemies.evo * 100).toFixed(1) + '%</b>';
      const clk = '<span><b class="num">' + FG.fmtTime(g.tick) + '</b></span><span>' + tod + '</span><span>' + evo.replace(' · ', '') + '</span>' + (app.paused ? '<span style="color:var(--warn)">Paused</span>' : '');
      if (this.$('hud-clock').dataset.k !== clk) { this.$('hud-clock').dataset.k = clk; this.$('hud-clock').innerHTML = clk; }
      // vitals
      const p = g.player;
      const gun = g.enemies.playerGun();
      const ammo = p.inv.count('ammo_basic') + p.inv.count('ammo_pierce');
      const vit = '<div>Health <span class="num" style="float:right">' + Math.ceil(Math.max(0, p.hp)) + '/' + p.maxHp + '</span></div><div class="bar"><i style="width:' + Math.max(0, (p.hp / p.maxHp) * 100) + '%;background:' + (p.hp / p.maxHp > 0.4 ? 'var(--good)' : 'var(--bad)') + '"></i></div><div>' + (gun ? nameOf(gun) : 'Unarmed') + ' · <span class="num">' + ammo + '</span> mags</div>';
      if (this.$('hud-vitals').dataset.k !== vit) { this.$('hud-vitals').dataset.k = vit; this.$('hud-vitals').innerHTML = vit; }
      // hand
      const c = app.cursor;
      let hand;
      if (!c) hand = '<b>Empty hand</b><div>Press E or a number key</div>';
      else if (c.bp) hand = '<b>Blueprint</b><div>' + c.bp.ents.length + ' buildings' + (c.bp.rails && c.bp.rails.length ? ' · ' + c.bp.rails.length + ' track' : '') + ' · R rotate · Q clear</div>';
      else {
        const n = p.inv.count(c.item);
        hand = '<b>' + nameOf(c.item) + '</b><div>' + (c.ghost ? 'Ghost placement' : '<span class="num">' + n + '</span> in inventory') + ' · ' + (D.items[c.item].track ? 'Drag to lay track · R turns a single piece · ' : D.items[c.item].place && D.protos[D.items[c.item].place].rotatable ? 'R rotate · ' : '') + (c.ghost ? '' : 'Z put one in · ') + 'Q clear</div>';
      }
      if (this.$('hud-hand').dataset.k !== hand) { this.$('hud-hand').dataset.k = hand; this.$('hud-hand').innerHTML = hand; }
      // hotbar
      for (let i = 0; i < 10; i++) {
        const id = app.hotbar[i];
        const el = this.hotbarEls[i];
        setSlot(el, id, id ? p.inv.count(id) : undefined);
        el.classList.toggle('ghosted', !!id && p.inv.count(id) === 0);
        el.classList.toggle('active', !!(c && c.item && c.item === id));
        if (!el.querySelector('.key')) el.appendChild(h('span', { class: 'key', text: String((i + 1) % 10) }));
      }
      // craft queue
      const q = p.queue;
      const qk = q.map((x) => x.rid + x.n).join(',') + ':' + Math.floor(p.craftProg * 20);
      const qe = this.$('hud-queue');
      if (qe.dataset.k !== qk) {
        qe.dataset.k = qk;
        qe.innerHTML = '';
        q.slice(0, 14).forEach((x, i) => {
          const r = D.recipes[x.rid];
          const el = slotEl(r.main, x.n, { onDown: () => this.g.cancelCraft(i) });
          el.dataset.text = 'Crafting ' + r.name + ' × ' + x.n + ' (click to cancel)';
          delete el.dataset.item;
          if (i === 0) el.appendChild(h('div', { class: 'prog', style: 'width:' + p.craftProg * 100 + '%' }));
          qe.appendChild(el);
        });
      }
      this.updateHover();
      this.updateAlerts();
      if (performance.now() - (this.lastAutoHotbar || 0) > 1000) { this.lastAutoHotbar = performance.now(); if (app.autoHotbar) app.autoHotbar(); }
      if (performance.now() - this.lastMini > 400) {
        this.lastMini = performance.now();
        const R = app.renderer;
        const [x0, y0] = R.toWorld(0, 0), [x1, y1] = R.toWorld(R.W, R.H);
        R.drawMap(g, this.$('minimap'), g.player.x, g.player.y, 1.5, { viewRect: [x0, y0, x1, y1], pollution: app.view.showPollution });
      }
      if (this.win && this.win.update) this.win.update();
    }

    updateHover() {
      const el = this.$('hud-hover');
      const hv = this.app.view.hover;
      const g = this.g;
      if (!hv || (!hv.ent && !hv.res && !hv.enemy && !hv.ghost && !hv.car && !hv.rail && !hv.railGhost) || this.win) { el.hidden = true; return; }
      const parts = [];
      if (hv.car) {
        const tr = hv.car.train, car = hv.car.car;
        const kv = (k, v) => parts.push(h('div', { class: 'kv' }, h('span', { text: k }), h('span', { class: 'num', text: v })));
        parts.push(h('h3', { text: nameOf(FG.trains.itemFor(car)) + (car.type === 'loco' && car.flip ? ' (facing back)' : '') }));
        const st = trainStatus(g, tr);
        parts.push(h('div', null, h('span', { class: 'status ' + st[1], text: st[0] })));
        kv('Speed', Math.round(tr.speed * 60 * 3.6) + ' km/h');
        kv('Train', tr.cars.filter((c) => c.type === 'loco').length + ' loco · ' + tr.cars.filter((c) => c.type === 'wagon').length + ' wagons');
        if (car.type === 'loco') kv('Fuel', String(FG.trains.fuelOf(tr)));
        else {
          const t = car.inv.totals();
          const keys = Object.keys(t).slice(0, 12);
          if (keys.length) parts.push(h('div', { class: 'chips' }, keys.map((k) => slotEl(k, t[k], { tip: false }))));
          else kv('Cargo', 'empty');
        }
        parts.push(h('div', { class: 'kv', style: 'margin-top:6px;font-size:12px' }, h('span', { text: 'Click to open · Ctrl+click take its contents · Enter to ride · R turns a stopped locomotive' })));
      } else if (hv.rail) {
        const pc = hv.rail.pc;
        const kind = pc.t !== 'S' ? 'Curved rail' : pc.ah & 1 ? 'Diagonal rail' : 'Straight rail';
        parts.push(h('h3', { text: kind }));
        const busy = FG.trains.pieceUnderTrain(g, pc) ? 'A train is on it' : FG.trains.pieceReserved(g, pc) ? 'Reserved by a train' : 'Clear';
        parts.push(h('div', { class: 'kv' }, h('span', { text: 'Worth' }), h('span', { class: 'num', text: FG.rails.itemCost(pc.t) + ' rail' + (FG.rails.itemCost(pc.t) > 1 ? 's' : '') })));
        parts.push(h('div', { class: 'kv' }, h('span', { text: 'Track' }), h('span', { text: busy })));
        parts.push(h('div', { class: 'kv', style: 'margin-top:6px;font-size:12px' }, h('span', { text: 'Right-click to pick up · Q to take rails in hand' })));
      } else if (hv.railGhost) {
        const pc = hv.railGhost.pc, n = FG.rails.itemCost(pc.t);
        parts.push(h('h3', { text: 'Planned track' }));
        parts.push(h('div', { class: 'kv' }, h('span', { text: 'Needs' }), h('span', { class: 'num', text: n + ' rail' + (n > 1 ? 's' : '') })));
        parts.push(h('div', { class: 'kv', style: 'margin-top:6px;font-size:12px' }, h('span', { text: 'Click to build it and the planned track joined to it · right-click to cancel' })));
      } else if (hv.ent) {
        const e = hv.ent;
        const pr = D.protos[e.p];
        parts.push(h('h3', { text: entName(e) }));
        const st = statusPill(e);
        if (st) parts.push(h('div', null, st));
        const kv = (k, v) => parts.push(h('div', { class: 'kv' }, h('span', { text: k }), h('span', { class: 'num', text: v })));
        if (e.recipe && (pr.kind === 'crafter' || pr.kind === 'furnace')) kv('Recipe', D.recipes[e.recipe].name);
        if (e.prog !== undefined && (e.crafting || e.working || pr.kind === 'drill')) kv('Progress', Math.round(Math.min(1, e.prog) * 100) + '%');
        if (pr.kind === 'drill') kv('Ore left in area', FG.fmt(this.oreUnder(e)));
        if (pr.kind === 'lab' && g.research.current) kv('Research', D.techs[g.research.current].name);
        if (pr.burner) kv('Fuel', e.fuel ? nameOf(e.fuel.id) + ' × ' + e.fuel.n : e.energy > 0 ? 'burning' : 'none');
        if (e.want !== undefined && FG.power.isElectric(pr) && pr.kind !== 'engine' && pr.kind !== 'solar' && pr.kind !== 'accumulator') kv('Power', FG.fmtPower(e.want || 0));
        if (pr.kind === 'engine') kv('Output', FG.fmtPower(e.out || 0) + ' / ' + FG.fmtPower(pr.max));
        if (pr.kind === 'solar') kv('Output', FG.fmtPower(pr.peak * g.daylight()));
        if (pr.kind === 'accumulator') kv('Charge', Math.round((e.charge / pr.capacity) * 100) + '%');
        if (pr.kind === 'pole' && e.net) { kv('Demand', FG.fmtPower(e.net.demand)); kv('Capacity', FG.fmtPower(e.net.supply)); }
        if (e.fbs) {
          for (const b of e.fbs) {
            const info = FG.fluidsys.info(b);
            if (info.fluid) { kv(nameOf(info.fluid), FG.fmt(info.amount) + ' / ' + FG.fmt(info.cap)); break; }
          }
        }
        if (pr.kind === 'uplink') kv('Stages', e.stages + ' / ' + pr.stages);
        if (pr.kind === 'turret') kv('Ammo', e.ammo ? nameOf(e.ammo.id) + ' × ' + e.ammo.n : 'none');
        if (pr.kind === 'chest') {
          const t = e.inv.totals();
          const keys = Object.keys(t).slice(0, 12);
          if (keys.length) parts.push(h('div', { class: 'chips' }, keys.map((k) => slotEl(k, t[k], { tip: false }))));
          else kv('Contents', 'empty');
        }
        if (FG.isBeltKind(pr.kind)) {
          let n = 0;
          const lanes = e.lanes ? [e.lanes] : e.halves.map((x) => x.lanes);
          for (const ls of lanes) for (const l of ls) n += l.ids.length;
          kv('Items on belt', String(n));
          kv('Throughput', Math.round(pr.speed * 8) + ' items/s');
        }
        if (pr.kind === 'loader') {
          kv(e.lm === 'out' ? 'Unloading from' : 'Loading into', loaderTarget(g, e));
          if (e.filter) kv('Filter', nameOf(e.filter));
        }
        if (pr.kind === 'inserter' && e.filter) kv('Filter', nameOf(e.filter));
        if (e.hp < pr.hp) kv('Health', Math.ceil(e.hp) + ' / ' + pr.hp);
        parts.push(h('div', { class: 'kv', style: 'margin-top:6px;font-size:12px' }, h('span', { text: pr.kind === 'loader' ? 'Click open · right-click pick up · R swaps loading and unloading' : 'Click open · Ctrl+click take items' + (pr.burner ? ' or fuel' : '') + ' · right-click pick up · R rotate' })));
      } else if (hv.ghost) {
        parts.push(h('h3', { text: 'Ghost: ' + nameOf(D.protos[hv.ghost.p].item) }));
        parts.push(h('div', { class: 'kv' }, h('span', { text: g.bonus.drones ? 'Drones will build it when you have the item nearby' : 'Click with an empty hand to build it from your inventory' })));
      } else if (hv.enemy) {
        const u = hv.enemy;
        const def = u.type ? D.enemies[u.type] : null;
        parts.push(h('h3', { text: def ? def.name : 'Hive' }));
        parts.push(h('div', { class: 'kv' }, h('span', { text: 'Health' }), h('span', { class: 'num', text: Math.ceil(u.hp) + ' / ' + (def ? def.hp : D.NEST_HP) })));
        parts.push(h('div', { class: 'kv' }, h('span', { text: 'Hold Space to shoot' })));
      } else if (hv.res) {
        const [x, y] = hv.tile;
        const i = y * g.world.W + x;
        const r = g.world.res[i];
        parts.push(h('h3', { text: FG.RES_NAME[r] }));
        if (r === FG.RES.OIL) parts.push(h('div', { class: 'kv' }, h('span', { text: 'Yield' }), h('span', { class: 'num', text: g.world.amt[i] + '%' })));
        else if (r === FG.RES.TREE || r === FG.RES.ROCK) parts.push(h('div', { class: 'kv' }, h('span', { text: 'Gives' }), h('span', { class: 'num', text: g.world.amt[i] + ' ' + nameOf(FG.RES_ITEM[r]).toLowerCase() })));
        else parts.push(h('div', { class: 'kv' }, h('span', { text: 'Amount' }), h('span', { class: 'num', text: FG.fmt(g.world.amt[i]) })));
        parts.push(h('div', { class: 'kv', style: 'margin-top:6px;font-size:12px' }, h('span', { text: r === FG.RES.OIL ? 'Needs a pumpjack' : 'Hold right-click to mine' })));
      }
      el.innerHTML = '';
      el.append.apply(el, parts);
      el.hidden = false;
    }

    oreUnder(e) {
      const pr = D.protos[e.p], w = this.g.world;
      const a = FG.drillArea(pr, e.x, e.y, e.w, e.h);
      let n = 0;
      for (let y = a[1]; y < a[3]; y++) for (let x = a[0]; x < a[2]; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = y * w.W + x;
        if (w.res[i] >= 1 && w.res[i] <= 4) n += w.amt[i];
      }
      return n;
    }

    // Shown while keystrokes are not reaching the game (focus is on another window or frame).
    setKeyboardHint(on) {
      const el = this.$('focus-hint');
      if (!el) return;
      el.hidden = !(on && this.app.game && !this.app.titleShown);
    }

    // ------------------------------------------------------ toasts/alerts
    toast(text, kind) {
      if (kind === 'warn' && FG.sfx) FG.sfx.play('warn');
      const box = this.$('toasts');
      const el = h('div', { class: 'toast ' + (kind || ''), text });
      box.appendChild(el);
      while (box.children.length > 4) box.firstChild.remove();
      setTimeout(() => el.remove(), kind === 'good' || kind === 'research' ? 4500 : 3500);
    }
    alert(a) {
      this.alerts.push(Object.assign({ at: performance.now() }, a));
      if (this.alerts.length > 4) this.alerts.shift();
      this.alertsDirty = true;
    }
    updateAlerts() {
      const now = performance.now();
      const before = this.alerts.length;
      this.alerts = this.alerts.filter((a) => now - a.at < 12000);
      if (!this.alertsDirty && before === this.alerts.length) return;
      this.alertsDirty = false;
      const box = this.$('alerts');
      box.innerHTML = '';
      for (const a of this.alerts) {
        const el = h('div', { class: 'alert ' + (a.kind || ''), style: 'cursor:pointer' }, h('b', { text: a.kind === 'wave' ? 'Incoming' : 'Attack' }), h('span', { text: a.text }));
        el.addEventListener('click', () => { this.open('map', { x: a.x, y: a.y }); });
        box.appendChild(el);
      }
    }

    // ------------------------------------------------------------ windows
    isOpen(name) { return !!(this.win && this.win.name === name); }
    toggle(name, arg) { if (this.isOpen(name)) this.close(); else this.open(name, arg); }
    close() {
      if (!this.win) return;
      this.dropHeld();
      if (this.win.onClose) this.win.onClose();
      this.win.el.remove();
      this.win = null;
      this.$('tooltip').hidden = true;
      this.app.onWindowChange();
    }
    frame(name, title, sub) {
      const el = h('div', { class: 'window', id: 'win-' + name, role: 'dialog', 'aria-label': title });
      const header = h('header', null, h('h2', null, title, sub ? h('span', { class: 'sub', text: sub }) : null),
        h('button', { class: 'close', 'aria-label': 'Close', text: '✕', onclick: () => this.close() }));
      const body = h('div', { class: 'body' });
      el.append(header, body);
      return { el, body, header };
    }
    open(name, arg) {
      if (this.win) this.close();
      const builder = this['build_' + name];
      if (!builder) return;
      const w = builder.call(this, arg);
      if (!w) return;
      w.name = name;
      w.arg = arg;
      this.win = w;
      this.$('windows').appendChild(w.el);
      if (w.update) w.update();
      this.app.onWindowChange();
    }

    // Player inventory grid (shared by several windows). onSlot(index, slot, ev)
    // With opts.split, right-click splits a stack: half of it follows the mouse until you
    // click a slot to put it down (right-click puts down one at a time).
    invGrid(onSlot, opts) {
      opts = opts || {};
      const grid = h('div', { class: 'grid' });
      const els = [];
      const g = this.g;
      const update = () => {
        if (els.length !== g.player.inv.size) build();
        const H = this.held;
        g.player.inv.slots.forEach((s, i) => {
          const src = opts.split && H && H.i === i && s && s.id === H.id;
          setSlot(els[i], s && s.id, s ? (src ? s.n - H.n || '' : s.n) : undefined);
          els[i].classList.toggle('held-src', !!src);
        });
      };
      const down = (i, ev) => {
        const s = g.player.inv.slots[i];
        if (opts.split && this.held) { this.putHeld(i, ev.button === 2 ? 1 : this.held.n); update(); return; }
        if (!s) return;
        if (opts.split && ev.button === 2) {
          this.held = { i, id: s.id, n: ev.shiftKey ? s.n : Math.ceil(s.n / 2) };
          this.placeHeldEl(ev.clientX, ev.clientY);
          update();
          return;
        }
        onSlot(i, s, ev);
      };
      const build = () => {
        grid.innerHTML = '';
        els.length = 0;
        for (let i = 0; i < g.player.inv.size; i++) {
          const el = slotEl(null, undefined, { onDown: (ev) => down(i, ev) });
          els.push(el);
          grid.appendChild(el);
        }
      };
      build();
      return { el: grid, update };
    }

    // Put up to `want` of the held stack into slot j (an empty slot or the same item). A
    // whole held stack dropped on a different item swaps places with it.
    putHeld(j, want) {
      const inv = this.g.player.inv, H = this.held;
      const src = inv.slots[H.i];
      if (!src || src.id !== H.id) { this.dropHeld(); return; }
      H.n = Math.min(H.n, src.n);
      if (j === H.i) { this.dropHeld(); return; }
      const dst = inv.slots[j];
      let k = 0;
      if (!dst) {
        k = Math.min(want, H.n);
        inv.slots[j] = { id: H.id, n: k };
      } else if (dst.id === H.id) {
        k = Math.min(want, H.n, D.items[H.id].stack - dst.n);
        if (!k) { this.toast('That stack is full', 'warn'); return; }
        dst.n += k;
      } else if (H.n === src.n) {
        inv.slots[j] = src; inv.slots[H.i] = dst;
        this.dropHeld();
        FG.emit('inventory');
        return;
      } else { this.toast('Put it in an empty slot or on the same item', 'warn'); return; }
      src.n -= k; H.n -= k;
      if (src.n <= 0) inv.slots[H.i] = null;
      if (H.n <= 0) this.dropHeld(); else this.placeHeldEl();
      FG.emit('inventory');
    }
    // Let go of a split stack: it was never taken out of its slot, so nothing is lost.
    dropHeld() {
      if (!this.held) return;
      this.held = null;
      this.heldEl.hidden = true;
      if (this.win && this.win.update) this.win.update(true);
    }
    placeHeldEl(x, y) {
      const H = this.held, el = this.heldEl;
      if (!H) return;
      if (x !== undefined) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
      setSlot(el, H.id, H.n);
      el.hidden = false;
    }

    // -------------------------------------------------- inventory window
    build_inventory() {
      const g = this.g, app = this.app;
      const w = this.frame('inventory', 'Inventory');
      const inv = this.invGrid((i, s) => { app.setCursor(s.id); this.close(); }, { split: true });
      const sortBtn = h('button', { class: 'btn small', text: 'Sort', onclick: () => { g.player.inv.sort(); inv.update(); } });
      const left = h('div', { class: 'pane' }, h('div', { class: 'pane-head' }, h('h3', { text: 'Your inventory' }), sortBtn), inv.el,
        h('div', { class: 'hint', text: 'Click an item to hold it: click the world to build, click a machine to fill it, or press Z over a machine to put in one. Right-click a stack to split off half (shift+right-click takes it all), then click a slot to put it down; right-click puts down one at a time.' }));
      const groups = [['logistics', 'Logistics', 'belt'], ['production', 'Production', 'assembler_1'], ['intermediate', 'Intermediates', 'circuit'], ['combat', 'Combat', 'gun_turret']];
      let tab = this.craftTab || 'logistics';
      const tabs = h('div', { class: 'tabs' });
      const grid = h('div', { class: 'craft-grid' });
      const tabBody = h('div', { class: 'tabbody' }, grid);
      const renderTabs = () => {
        tabs.innerHTML = '';
        for (const [id, label, ic] of groups) {
          tabs.appendChild(h('button', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; this.craftTab = id; renderTabs(); renderGrid(); } }, img(ic, 20), label));
        }
      };
      const slots = [];
      const renderGrid = () => {
        grid.innerHTML = '';
        slots.length = 0;
        let lastSub = null;
        const list = Object.values(D.recipes)
          .filter((r) => (r.cat === 'crafting' || r.cat === 'advanced') && g.recipeEnabled(r.id) && D.items[r.main] && D.items[r.main].group === tab)
          .sort((a, b) => D.items[a.main].order - D.items[b.main].order);
        for (const r of list) {
          const sub = D.items[r.main].sub;
          if (lastSub !== null && sub !== lastSub) {
            const pad = (10 - (slots.length % 10)) % 10;
            for (let k = 0; k < pad; k++) grid.appendChild(h('div'));
            slots.length += pad;
          }
          lastSub = sub;
          const el = slotEl(r.main, undefined, {
            tip: false,
            onDown: (ev) => {
              if (!g.canHandcraft(r.id)) { this.toast(r.cat === 'advanced' ? r.name + ' can only be made in an assembler' : 'Cannot hand-craft ' + r.name, 'warn'); return; }
              const n = ev.shiftKey ? g.craftableCount(r.id) : ev.button === 2 ? 5 : 1;
              let k = n;
              while (k > 0 && !g.queueCraft(r.id, k)) k = ev.shiftKey ? 0 : k - 1;
              if (!k) this.toast('Missing ingredients for ' + r.name, 'warn');
              update();
            },
          });
          el.dataset.recipe = r.id;
          el.dataset.mode = 'hand';
          el._r = r;
          grid.appendChild(el);
          slots.push(el);
        }
        if (!list.length) grid.appendChild(h('div', { class: 'hint', style: 'grid-column:1/-1', text: 'Nothing unlocked here yet. Research unlocks more recipes.' }));
      };
      const update = () => {
        inv.update();
        const vinv = g.virtualInv();
        for (const el of slots) {
          if (!el || !el._r) continue;
          const r = el._r;
          const ok = g.canHandcraft(r.id) && g.planCraft(r.id, 1, Object.assign({}, vinv), [], 0);
          el.classList.toggle('cant', !ok);
          const have = g.player.inv.count(r.main);
          setSlot(el, r.main, have || undefined);
        }
      };
      renderTabs();
      renderGrid();
      const right = h('div', { class: 'pane' }, h('h3', { text: 'Crafting' }), tabs, tabBody,
        h('div', { class: 'hint', text: 'Missing parts are crafted automatically when you have the raw materials. Right-click crafts 5, shift-click crafts as many as possible.' }));
      w.body.append(h('div', { class: 'panes' }, left, right));
      let last = 0;
      w.update = (now2) => { const now = performance.now(); if (!now2 && now - last < 150) return; last = now; update(); };
      return w;
    }

    // ---------------------------------------------------- entity window
    build_entity(ent) {
      if (!ent || ent.dead) return null;
      const g = this.g, app = this.app;
      const pr = D.protos[ent.p];
      const w = this.frame('entity', entName(ent));
      const statusLine = h('div');
      const machine = h('div', { class: 'machine' });
      const put = function () { add(machine, Array.prototype.slice.call(arguments)); };
      const updaters = [];
      const upd = (fn) => updaters.push(fn);
      const give = (list) => { g.giveOrDrop(list); };
      const takeToPlayer = (id, n) => {
        const k = Math.min(n, g.player.inv.space(id));
        if (k <= 0) { this.toast('Inventory full', 'warn'); return 0; }
        g.player.inv.add(id, k);
        return k;
      };

      // Module slots
      const moduleRow = () => {
        if (!ent.modules) return null;
        const els = ent.modules.map((m, i) => slotEl(m, undefined, {
          onDown: () => {
            if (!ent.modules[i]) return;
            if (takeToPlayer(ent.modules[i], 1)) { ent.modules[i] = null; g.markDirty('fx'); }
          },
        }));
        upd(() => ent.modules.forEach((m, i) => setSlot(els[i], m)));
        return h('div', { class: 'group' }, h('div', { class: 'label', text: 'Modules' }), h('div', { class: 'slots' }, els));
      };

      const fuelSlot = () => {
        const el = slotEl(null, undefined, { onDown: () => { if (ent.fuel) { const k = takeToPlayer(ent.fuel.id, ent.fuel.n); ent.fuel.n -= k; if (!ent.fuel.n) ent.fuel = null; } } });
        upd(() => setSlot(el, ent.fuel && ent.fuel.id, ent.fuel ? ent.fuel.n : undefined));
        el.dataset.text = 'Fuel: coal, wood or solid fuel';
        return h('div', { class: 'group' }, h('div', { class: 'label', text: 'Fuel' }), el);
      };
      const progressBar = (getter, cls) => {
        const bar = h('div', { class: 'bar ' + (cls || 'amber') + ' progress-line' }, h('i'));
        upd(() => { bar.firstChild.style.width = Math.min(100, getter() * 100) + '%'; });
        return bar;
      };
      const fluidBox = (box, label) => {
        const fill = h('i');
        const bar = h('div', { class: 'fluidbar' }, fill);
        const txt = h('div', { class: 'num', style: 'font-size:12px' });
        const lab = h('div', { class: 'label', text: label || 'Fluid' });
        upd(() => {
          const info = FG.fluidsys.info(box);
          fill.style.height = (info.level * 100).toFixed(1) + '%';
          fill.style.background = info.fluid ? D.fluids[info.fluid].color : 'transparent';
          txt.textContent = info.fluid ? nameOf(info.fluid) + ' ' + FG.fmt(info.amount) + '/' + FG.fmt(info.cap) : 'Empty · ' + FG.fmt(info.cap) + ' cap';
          if (!box.net) txt.textContent = label === 'Input' || label === 'Output' ? 'Not used by this recipe' : 'Not connected';
        });
        return h('div', { class: 'group', style: 'align-items:flex-start' }, lab, h('div', { class: 'rowx' }, bar, txt));
      };
      const kvs = (rows) => {
        const dl = h('dl', { class: 'kvs' });
        const cells = rows.map(([k]) => { const dd = h('dd'); dl.append(h('dt', { text: k }), dd); return dd; });
        upd(() => rows.forEach(([, fn], i) => { const v = fn(); if (cells[i].textContent !== v) cells[i].textContent = v; }));
        return dl;
      };
      const powerRow = () => {
        if (!FG.power.isElectric(pr) || pr.kind === 'engine' || pr.kind === 'solar' || pr.kind === 'accumulator') return null;
        return kvs([['Power use', () => (ent.net ? FG.fmtPower(ent.want || 0) : 'not connected')], ['Speed bonus', () => Math.round(ent.fx.speed * 100) + '%'], ['Productivity', () => Math.round(ent.fx.prod * 100) + '%']]);
      };

      switch (pr.kind) {
        case 'chest': {
          const grid = h('div', { class: 'grid' });
          const els = ent.inv.slots.map((s, i) => {
            const el = slotEl(null, undefined, {
              onDown: (ev) => {
                const s2 = ent.inv.slots[i];
                if (!s2) return;
                if (ev.shiftKey) { const n = ent.inv.count(s2.id); const k = takeToPlayer(s2.id, n); ent.inv.remove(s2.id, k); }
                else { const k = takeToPlayer(s2.id, s2.n); s2.n -= k; if (!s2.n) ent.inv.slots[i] = null; }
              },
            });
            grid.appendChild(el);
            return el;
          });
          upd(() => ent.inv.slots.forEach((s, i) => setSlot(els[i], s && s.id, s ? s.n : undefined)));
          put(grid, h('div', { class: 'hint', text: 'Click a stack to take it · shift-click takes every stack of that item · click your inventory to store.' }));
          break;
        }
        case 'furnace': {
          const inEl = slotEl(null, undefined, { onDown: () => { if (ent.inp) { const k = takeToPlayer(ent.inp.id, ent.inp.n); ent.inp.n -= k; if (!ent.inp.n) ent.inp = null; } } });
          const outEl = slotEl(null, undefined, { onDown: () => { if (ent.out) { const k = takeToPlayer(ent.out.id, ent.out.n); ent.out.n -= k; if (!ent.out.n) ent.out = null; } } });
          upd(() => { setSlot(inEl, ent.inp && ent.inp.id, ent.inp ? ent.inp.n : undefined); setSlot(outEl, ent.out && ent.out.id, ent.out ? ent.out.n : undefined); });
          put(h('div', { class: 'rowx' },
            pr.burner ? fuelSlot() : null,
            h('div', { class: 'group' }, h('div', { class: 'label', text: 'Input' }), inEl),
            h('span', { class: 'arrow', text: '→' }),
            h('div', { class: 'group' }, h('div', { class: 'label', text: 'Output' }), outEl)),
          progressBar(() => ent.prog), powerRow(), moduleRow(),
          h('div', { class: 'hint', text: 'Furnaces pick their recipe from the input: ore → plates, stone → bricks, iron plates → steel (after research).' }));
          break;
        }
        case 'drill': {
          put(h('div', { class: 'rowx' }, pr.burner ? fuelSlot() : null,
            kvs([['Mining speed', () => (pr.speed * FG.speedMult(ent)).toFixed(2) + '/s'], ['Ore left', () => FG.fmt(this.oreUnder(ent))], ['Last mined', () => (ent.lastOre ? nameOf(ent.lastOre) : '—')], ['Productivity', () => Math.round((g.bonus.miningProd + ent.fx.prod) * 100) + '%']])),
          progressBar(() => ent.prog), powerRow(), moduleRow(),
          h('div', { class: 'hint', text: 'Drills drop ore on the tile in front of them: a belt, a furnace, a chest or another burner drill (as fuel).' }));
          break;
        }
        case 'pumpjack': {
          const i = (ent.y + 1) * g.world.W + ent.x + 1;
          put(kvs([['Well yield', () => g.world.amt[i] + '%'], ['Output', () => ((10 * g.world.amt[i]) / 100 * FG.speedMult(ent)).toFixed(1) + ' crude/s']]), fluidBox(ent.fbs[0], 'Output'), powerRow(), moduleRow());
          break;
        }
        case 'crafter': case 'uplink': {
          const recipeArea = h('div');
          const io = h('div', { class: 'rowx' });
          const buildIO = () => {
            io.innerHTML = '';
            const r = ent.recipe && D.recipes[ent.recipe];
            if (!r) return;
            const inEls = Object.keys(r.ing).map((id) => {
              const el = slotEl(id, 0, { onDown: () => { const n = ent.inp[id] || 0; if (n) { const k = takeToPlayer(id, n); ent.inp[id] -= k; if (!ent.inp[id]) delete ent.inp[id]; } } });
              upd(() => setSlot(el, id, (ent.inp[id] || 0) + '/' + r.ing[id], (ent.inp[id] || 0) < r.ing[id]));
              return el;
            });
            const outEls = Object.keys(r.out).map((id) => {
              const el = slotEl(id, 0, { onDown: () => { const n = ent.out[id] || 0; if (n) { const k = takeToPlayer(id, n); ent.out[id] -= k; if (!ent.out[id]) delete ent.out[id]; } } });
              upd(() => setSlot(el, id, ent.out[id] || 0));
              return el;
            });
            const fIn = Object.keys(r.fin).map((f) => fluidBox(ent.fbs[ent.fmap.in[f]], 'Input'));
            const fOut = Object.keys(r.fout).map((f) => fluidBox(ent.fbs[ent.fmap.out[f]], 'Output'));
            add(io, [
              inEls.length ? h('div', { class: 'group' }, h('div', { class: 'label', text: 'Ingredients' }), h('div', { class: 'slots' }, inEls)) : null,
              fIn,
              h('span', { class: 'arrow', text: '→' }),
              outEls.length ? h('div', { class: 'group' }, h('div', { class: 'label', text: 'Products' }), h('div', { class: 'slots' }, outEls)) : null,
              fOut]);
          };
          const showRecipe = () => {
            recipeArea.innerHTML = '';
            const r = ent.recipe && D.recipes[ent.recipe];
            if (pr.kind === 'uplink') {
              recipeArea.append(h('div', { class: 'recipe-current' }, h('div', null, h('div', { style: 'font-weight:700;font-size:17px', text: 'Uplink stages' }),
                h('div', { class: 'hint', text: 'Each stage consumes 5 composite frames, 5 guidance computers and 5 rocket fuel.' }))));
              return;
            }
            const cur = h('div', { class: 'recipe-current' }, slotEl(r ? r.main : null, undefined, { tip: false }),
              h('div', null, h('div', { style: 'font-weight:700;font-size:17px', text: r ? r.name : 'No recipe' }), h('div', { class: 'hint', text: r ? r.time + 's base time · ' + (r.time / (pr.speed * FG.speedMult(ent))).toFixed(2) + 's here' : 'Choose what this machine makes.' })),
              h('button', { class: 'btn small', text: r ? 'Change recipe' : 'Choose recipe', onclick: () => picker.hidden = !picker.hidden }));
            if (r) cur.firstChild.dataset.recipe = r.id;
            recipeArea.append(cur);
          };
          const picker = h('div', { class: 'recipe-picker', hidden: !!ent.recipe });
          if (pr.kind !== 'uplink') {
            const list = Object.values(D.recipes).filter((r) => pr.cats.indexOf(r.cat) >= 0 && g.recipeEnabled(r.id) && (pr.fb || !Object.keys(r.fin).length))
              .sort((a, b) => ((D.items[a.main] || { order: 999 }).order - (D.items[b.main] || { order: 999 }).order));
            for (const r of list) {
              const el = slotEl(r.main, undefined, {
                tip: false,
                onDown: () => {
                  give(FG.machines.setRecipe(g, ent, r.id));
                  picker.hidden = true;
                  showRecipe(); rebuildIO();
                },
              });
              el.dataset.recipe = r.id;
              picker.appendChild(el);
            }
            if (!list.length) picker.appendChild(h('div', { class: 'hint', text: 'No recipes unlocked for this machine yet.' }));
          }
          const ioUpdaters = [];
          const rebuildIO = () => {
            // Drop updaters created by the previous IO build.
            for (const f of ioUpdaters) { const k = updaters.indexOf(f); if (k >= 0) updaters.splice(k, 1); }
            const before = updaters.length;
            buildIO();
            ioUpdaters.length = 0;
            for (let k = before; k < updaters.length; k++) ioUpdaters.push(updaters[k]);
          };
          showRecipe();
          rebuildIO();
          put(recipeArea, picker, io, progressBar(() => ent.prog));
          if (pr.kind === 'uplink') {
            const satEl = slotEl('satellite', 0, { onDown: () => { if (ent.satellite && takeToPlayer('satellite', 1)) ent.satellite = 0; } });
            const launch = h('button', { class: 'btn primary', text: 'Launch', onclick: () => { if (ent.stages >= pr.stages && ent.satellite && !ent.launch) { ent.launch = 1; FG.sfx.play('launch'); this.close(); } } });
            const stages = h('div', { class: 'bar good progress-line' }, h('i'));
            const stTxt = h('div', { class: 'num' });
            upd(() => {
              setSlot(satEl, 'satellite', ent.satellite ? 1 : 0, !ent.satellite);
              stages.firstChild.style.width = (ent.stages / pr.stages) * 100 + '%';
              stTxt.textContent = ent.stages + ' / ' + pr.stages + ' stages';
              launch.disabled = !(ent.stages >= pr.stages && ent.satellite) || ent.launch > 0;
            });
            put(h('div', { class: 'rowx' }, h('div', { class: 'group' }, h('div', { class: 'label', text: 'Payload' }), satEl),
              h('div', { class: 'group' }, h('div', { class: 'label', text: 'Construction' }), stages, stTxt), launch));
          }
          put(powerRow(), moduleRow());
          if (pr.fb && pr.id.indexOf('assembler') === 0) put(h('div', { class: 'hint', text: 'Recipes with a fluid ingredient take it through the pipe connection on the marked side (rotate with R).' }));
          break;
        }
        case 'lab': {
          const packs = ['sci_1', 'sci_2', 'sci_mil', 'sci_3', 'sci_4'];
          const els = packs.map((id) => {
            const el = slotEl(id, 0, { onDown: () => { const n = ent.inp[id] || 0; if (n) { const k = takeToPlayer(id, n); ent.inp[id] -= k; if (!ent.inp[id]) delete ent.inp[id]; } } });
            upd(() => {
              const t = g.research.current && D.techs[g.research.current];
              setSlot(el, id, ent.inp[id] || 0, !!(t && t.cost[id] && !(ent.inp[id] > 0)));
            });
            return el;
          });
          put(h('div', { class: 'group' }, h('div', { class: 'label', text: 'Research packs' }), h('div', { class: 'slots' }, els)),
            kvs([['Researching', () => (g.research.current ? D.techs[g.research.current].name : 'nothing (press T)')], ['Progress', () => { const t = g.research.current; return t ? (g.research.progress[t] || 0) + ' / ' + D.techs[t].units + ' units' : '—'; }]]),
            progressBar(() => ent.prog, 'blue'), powerRow(), moduleRow(),
            h('button', { class: 'btn small', text: 'Open research', onclick: () => this.open('tech') }));
          break;
        }
        case 'boiler':
          put(h('div', { class: 'rowx' }, fuelSlot(), fluidBox(ent.fbs[0], 'Water in'), fluidBox(ent.fbs[1], 'Steam out')),
            h('div', { class: 'hint', text: 'Water enters from the pump side connections; steam leaves from the top. One boiler feeds two steam engines.' }));
          break;
        case 'engine':
          put(kvs([['Output', () => FG.fmtPower(ent.out || 0) + ' / ' + FG.fmtPower(pr.max)]]), fluidBox(ent.fbs[0], 'Steam'), this.networkBlock(ent, upd));
          break;
        case 'solar':
          put(kvs([['Output', () => FG.fmtPower(pr.peak * g.daylight()) + ' / ' + FG.fmtPower(pr.peak)], ['Daylight', () => Math.round(g.daylight() * 100) + '%']]), this.networkBlock(ent, upd));
          break;
        case 'accumulator':
          put(kvs([['Charge', () => FG.fmt(ent.charge / 1000) + ' / ' + pr.capacity / 1000 + ' MJ']]), progressBar(() => ent.charge / pr.capacity, 'blue'), this.networkBlock(ent, upd));
          break;
        case 'pole':
          put(this.networkBlock(ent, upd));
          break;
        case 'offshore':
          put(kvs([['Pumping', () => pr.rate + ' water/s']]), fluidBox(ent.fbs[0], 'Output'));
          break;
        case 'pipe': case 'pipe_ug': case 'tank':
          put(fluidBox(ent.fbs[0], 'Contents'), h('div', { class: 'hint', text: 'Connected pipes share one pool of fluid. Each network holds a single fluid type.' }));
          break;
        case 'inserter': {
          const hand = slotEl(null, undefined, { tip: true });
          upd(() => setSlot(hand, ent.hand && ent.hand.id, ent.hand ? ent.hand.n : undefined));
          put(h('div', { class: 'rowx' }, pr.burner ? fuelSlot() : null, h('div', { class: 'group' }, h('div', { class: 'label', text: 'Holding' }), hand),
            kvs([['Swings', () => (60 / (pr.swing * 2)).toFixed(2) + '/s'], ['Hand size', () => String(1 + g.bonus.hand)]])));
          if (pr.filter) put(this.filterPicker(ent, upd, 'Only moves this item'));
          put(h('div', { class: 'hint', text: 'Arms take from the tile behind them and drop on the tile in front. They only take what the target can use.' }));
          break;
        }
        case 'splitter': {
          const seg = h('div', { class: 'seg' });
          const opts = [[0, 'Left'], [-1, 'Balanced'], [1, 'Right']];
          const renderSeg = () => { seg.innerHTML = ''; for (const [v, l] of opts) seg.appendChild(h('button', { class: ent.prio === v ? 'on' : '', text: l, onclick: () => { ent.prio = v; renderSeg(); } })); };
          renderSeg();
          put(h('div', { class: 'group' }, h('div', { class: 'label', text: 'Output priority' }), seg), this.filterPicker(ent, upd, 'Filtered item goes to the priority side (left if balanced)'));
          break;
        }
        case 'loader': {
          const seg = h('div', { class: 'seg' });
          const renderSeg = () => {
            seg.innerHTML = '';
            seg.dataset.lm = ent.lm;
            for (const [v, l] of [['in', 'Load'], ['out', 'Unload']]) seg.appendChild(h('button', { class: ent.lm === v ? 'on' : '', text: l, onclick: () => { if (ent.lm !== v) FG.rotateEntity(g, ent); renderSeg(); } }));
          };
          renderSeg();
          upd(() => { if (seg.dataset.lm !== ent.lm) renderSeg(); });
          put(h('div', { class: 'group' }, h('div', { class: 'label', text: 'Mode' }), seg),
            kvs([['Hood end', () => (ent.lm === 'out' ? 'unloading ' : 'loading ') + loaderTarget(g, ent)], ['Speed', () => Math.round(pr.speed * 8) + ' items/s'],
              ['On the belt end', () => String(ent.lanes[0].ids.length + ent.lanes[1].ids.length)]]),
            this.filterPicker(ent, upd, 'Only moves this item'),
            h('div', { class: 'hint', text: 'A loader moves items between its belt end and the chest, machine or stopped wagon at its hood, on both lanes at full belt speed. The arrow shows the way items go: point it at a chest to fill it, away from one to empty it. Machines only get what they need, as from an arm. Switching mode (or R) turns it round in place.' }));
          break;
        }
        case 'turret': {
          const el = slotEl(null, undefined, { onDown: () => { if (ent.ammo) { const k = takeToPlayer(ent.ammo.id, ent.ammo.n); ent.ammo.n -= k; if (!ent.ammo.n) ent.ammo = null; } } });
          upd(() => setSlot(el, ent.ammo && ent.ammo.id, ent.ammo ? ent.ammo.n : undefined, !ent.ammo));
          put(h('div', { class: 'rowx' }, h('div', { class: 'group' }, h('div', { class: 'label', text: 'Ammo' }), el), kvs([['Range', () => pr.range + ' tiles'], ['Rounds in gun', () => String(ent.rounds)]])),
            h('div', { class: 'hint', text: 'Click magazines in your inventory to load them. Arms can keep turrets supplied from a belt.' }));
          break;
        }
        case 'laser':
          put(kvs([['Range', () => pr.range + ' tiles'], ['Energy buffer', () => Math.round((ent.buf / (pr.shot * 2)) * 100) + '%']]), this.networkBlock(ent, upd));
          break;
        case 'beacon':
          put(moduleRow(), kvs([['Range', () => pr.range + ' tiles around'], ['Transfers', () => pr.efficiency * 100 + '% of module effects']]), h('div', { class: 'hint', text: 'Beacons share speed and efficiency modules with every machine in range. Productivity modules do not work in beacons.' }));
          break;
        case 'wall':
          put(kvs([['Health', () => Math.ceil(ent.hp) + ' / ' + pr.hp]]));
          break;
        case 'trainstop':
        case 'signal': {
          if (pr.kind === 'trainstop') {
            const input = h('input', { type: 'text', id: 'stop-name', value: ent.name, maxlength: '32', 'aria-label': 'Stop name', style: 'font:600 16px var(--font-ui)' });
            input.addEventListener('change', () => this.renameStop(ent, input.value));
            input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); });
            put(h('div', { class: 'group' }, h('label', { class: 'label', for: 'stop-name', text: 'Stop name' }), input),
              kvs([['Trains heading here', () => String(g.rail.trains.filter((t) => t.mode === 'auto' && t.schedule[t.cur] && t.schedule[t.cur].station === ent.name && t.state !== 'station').length)],
                ['Trains stopped here', () => String(g.rail.trains.filter((t) => t.state === 'station' && t.schedule[t.cur] && t.schedule[t.cur].station === ent.name).length)]]),
              h('div', { class: 'hint', text: 'Trains travelling this way (the stop is on their right) halt with their nose level with it. Stops with the same name share traffic: a train goes to the nearest one. Arms beside the track load and unload stopped wagons.' }));
          } else {
            put(h('div', { class: 'hint', text: pr.role === 'chain'
              ? 'A chain signal lets a train in only when it can also get through the next signal. Put them at the entrances of junctions so trains never stop inside one.'
              : 'A rail signal splits the track into blocks. Only one automatic train may be in a block at a time; others wait before the signal. Signals guard trains passing on their right: a track signalled on one side only is one-way.' }));
          }
          break;
        }
        default:
          if (FG.isBeltKind(pr.kind)) put(kvs([['Speed', () => Math.round(pr.speed * 8) + ' items/s'], ['Type', () => (pr.kind === 'underground' ? (ent.ug === 'in' ? 'Entrance' : 'Exit') + (ent.pair ? ', paired' : ', not paired') : pr.kind)]]));
      }

      const inv = this.invGrid((i, s, ev) => this.transferToEntity(ent, s.id, ev.shiftKey ? g.player.inv.count(s.id) : ev.button === 2 ? Math.ceil(s.n / 2) : s.n));
      const right = h('div', { class: 'pane' }, h('h3', { text: 'Your inventory' }), inv.el, h('div', { class: 'hint', text: 'Click to move a stack in · right-click moves half · shift-click moves all of that item.' }));
      const left = h('div', { class: 'pane' }, statusLine, machine);
      w.body.append(h('div', { class: 'panes' }, left, right));
      w.update = () => {
        if (ent.dead) { this.close(); return; }
        inv.update();
        const st = statusPill(ent);
        const key = st ? st.textContent + st.className : '';
        if (statusLine.dataset.k !== key) { statusLine.dataset.k = key; statusLine.innerHTML = ''; if (st) statusLine.appendChild(st); }
        for (const f of updaters) f();
      };
      w.ent = ent;
      return w;
    }

    transferToEntity(ent, id, n) {
      const g = this.g;
      const pr = D.protos[ent.p];
      const it = D.items[id];
      if (it.module && ent.modules) {
        if (it.module.prod && pr.kind === 'beacon') { this.toast('Productivity modules cannot go in beacons', 'warn'); return; }
        const i = ent.modules.indexOf(null);
        if (i < 0) { this.toast('Module slots are full', 'warn'); return; }
        ent.modules[i] = id;
        g.player.inv.remove(id, 1);
        g.markDirty('fx');
        return;
      }
      let k = 0;
      if (pr.kind === 'chest') k = n - ent.inv.add(id, n);
      else k = FG.insertItem(g, ent, id, n, 'direct');
      if (k > 0) g.player.inv.remove(id, k);
      else this.toast(entName(ent) + ' does not accept ' + it.name, 'warn');
    }

    renameStop(ent, name) {
      const g = this.g;
      name = (name || '').trim().slice(0, 32);
      if (!name || name === ent.name) return;
      const old = ent.name;
      ent.name = name;
      // Keep schedules pointing here if this was the only stop with the old name.
      if (!FG.trains.stopsNamed(g, old).length) for (const tr of g.rail.trains) for (const e of tr.schedule) if (e.station === old) e.station = name;
      this.toast('Renamed to ' + name);
    }

    build_train(hit) {
      const g = this.g, app = this.app;
      const tr = hit.train;
      if (!tr || tr.dead) return null;
      const w = this.frame('train', 'Train');
      const status = h('div');
      const left = h('div', { class: 'pane machine', style: 'min-width:min(460px, calc(100vw - 60px))' });
      const carUpd = [], schedUpd = [];
      const takeToPlayer = (inv, id, n) => {
        const k = Math.min(n, g.player.inv.space(id));
        if (k <= 0) { this.toast('Inventory full', 'warn'); return; }
        inv.remove(id, k);
        g.player.inv.add(id, k);
      };
      // Mode and boarding
      const seg = h('div', { class: 'seg' });
      const renderSeg = () => {
        seg.innerHTML = '';
        for (const [v, l] of [['auto', 'Automatic'], ['manual', 'Manual']]) {
          seg.appendChild(h('button', { class: tr.mode === v ? 'on' : '', text: l, onclick: () => {
            tr.mode = v;
            if (v === 'auto') tr.state = 'plan';
            renderSeg();
          } }));
        }
      };
      renderSeg();
      const rideBtn = h('button', { class: 'btn small', text: g.player.vehicle === tr.id ? 'Get out' : 'Get in', onclick: () => {
        if (g.player.vehicle === tr.id) FG.trains.exit(g);
        else { const p = FG.trains.carPose(tr, 0); if (FG.dist2(p.x, p.y, g.player.x, g.player.y) > 144) { this.toast('Walk closer to board', 'warn'); return; } g.player.vehicle = tr.id; if (!tr.schedule.length) tr.mode = 'manual'; }
        this.close();
      } });
      left.append(status, h('div', { class: 'rowx' }, h('span', { class: 'label', text: 'Control' }), seg, rideBtn));
      // Cars: fuel and cargo
      const carsBox = h('div', { class: 'group train-cars' });
      const renderCars = () => {
        carsBox.innerHTML = '';
        carUpd.length = 0;
        carsBox.appendChild(h('div', { class: 'label', text: 'Cars (front first)' }));
        tr.cars.forEach((car, i) => {
          const row = h('div', { class: 'car-row' });
          const tag = h('div', { class: 'car-tag' },
            h('b', { text: (i + 1) + '. ' + (car.type === 'loco' ? 'Locomotive' : 'Wagon') }),
            car.type === 'loco' ? h('span', { text: car.flip ? 'faces back ←' : 'faces front →' }) : null);
          const grid = h('div', { class: 'grid', style: car.type === 'loco' ? 'grid-template-columns:repeat(3, var(--slot))' : '' });
          const els = car.inv.slots.map((_, j) => {
            const el = slotEl(null, undefined, { onDown: (ev) => { const sl = car.inv.slots[j]; if (sl) takeToPlayer(car.inv, sl.id, ev.shiftKey ? car.inv.count(sl.id) : sl.n); } });
            grid.appendChild(el);
            return el;
          });
          carUpd.push(() => car.inv.slots.forEach((sl, j) => setSlot(els[j], sl && sl.id, sl ? sl.n : undefined)));
          row.append(tag, grid);
          if (car.type === 'loco') row.appendChild(h('button', { class: 'btn small', text: 'Turn', title: 'Turn this locomotive around (train must be stopped)', onclick: () => {
            if (!FG.trains.flipCar(g, tr, i)) this.toast('Stop the train first', 'warn'); else renderCars();
          } }));
          carsBox.appendChild(row);
        });
      };
      renderCars();
      // Schedule editor
      const sched = h('div', { class: 'group' });
      const renderSched = () => {
        sched.innerHTML = '';
        schedUpd.length = 0;
        sched.appendChild(h('div', { class: 'label', text: 'Schedule' }));
        const names = FG.trains.stopNames(g);
        tr.schedule.forEach((e, i) => {
          const stSel = h('select', { id: 'sched-station-' + i, 'aria-label': 'Stop' });
          for (const n of new Set(names.concat([e.station]))) stSel.appendChild(h('option', { value: n, text: n, selected: n === e.station }));
          stSel.addEventListener('change', () => { e.station = stSel.value; if (tr.cur === i && tr.state !== 'station') tr.state = 'plan'; });
          const cond = h('select', { id: 'sched-cond-' + i, 'aria-label': 'Wait condition' });
          for (const [v, l] of [['full', 'until full'], ['empty', 'until empty'], ['time', 'for seconds'], ['inactive', 'until idle for seconds']]) cond.appendChild(h('option', { value: v, text: l, selected: v === e.cond }));
          const val = h('input', { type: 'number', id: 'sched-v-' + i, min: '1', max: '600', value: String(e.v || 10), style: 'width:64px', 'aria-label': 'Seconds' });
          val.hidden = e.cond !== 'time' && e.cond !== 'inactive';
          cond.addEventListener('change', () => { e.cond = cond.value; if (!e.v) e.v = 10; val.hidden = e.cond !== 'time' && e.cond !== 'inactive'; });
          val.addEventListener('change', () => { e.v = FG.clamp(parseInt(val.value, 10) || 10, 1, 600); });
          const cur = h('span', { class: 'num', style: 'width:18px;color:var(--amber)', text: '' });
          schedUpd.push(() => { cur.textContent = tr.cur === i && tr.mode === 'auto' ? '▶' : ''; });
          sched.appendChild(h('div', { class: 'sched-row' },
            cur, stSel, h('span', { class: 'hint', text: 'wait' }), cond, val,
            h('button', { class: 'btn small', text: 'Go now', title: 'Send the train here next', onclick: () => { tr.cur = i; if (tr.mode === 'auto') tr.state = 'plan'; } }),
            h('button', { class: 'btn small danger', text: '✕', 'aria-label': 'Remove stop', onclick: () => { tr.schedule.splice(i, 1); if (tr.cur >= tr.schedule.length) tr.cur = 0; renderSched(); } })));
        });
        const add = h('button', { class: 'btn small', text: '+ Add stop', onclick: () => {
          const n = FG.trains.stopNames(g);
          if (!n.length) { this.toast('Place a train stop first', 'warn'); return; }
          const prev = tr.schedule.length ? tr.schedule[tr.schedule.length - 1].station : null;
          tr.schedule.push({ station: n.find((x) => x !== prev) || n[0], cond: tr.schedule.length ? 'empty' : 'full', v: 10 });
          renderSched();
        } });
        sched.appendChild(h('div', { style: 'margin-top:4px' }, add));
        if (!tr.schedule.length) sched.appendChild(h('div', { class: 'hint', text: 'Add stops, then switch to Automatic. A typical route: wait at the mine until full, then at the base until empty.' }));
      };
      renderSched();
      left.append(carsBox, sched, h('div', { class: 'hint', text: 'A train only drives the way a locomotive faces. For stations at the end of a line, add a second locomotive facing back, or build a loop.' }));
      const inv = this.invGrid((i, sl, ev) => {
        const id = sl.id;
        let left2 = ev.shiftKey ? g.player.inv.count(id) : ev.button === 2 ? Math.ceil(sl.n / 2) : sl.n;
        let moved = 0;
        const order = D.items[id].fuel ? tr.cars.filter((c) => c.type === 'loco').concat(tr.cars.filter((c) => c.type === 'wagon')) : tr.cars.filter((c) => c.type === 'wagon');
        for (const car of order) {
          if (left2 <= 0) break;
          const k = FG.trains.carInsert(car, id, left2);
          if (k > 0) { g.player.inv.remove(id, k); left2 -= k; moved += k; }
        }
        if (!moved) this.toast('No room for that in this train', 'warn');
      });
      const right = h('div', { class: 'pane' }, h('h3', { text: 'Your inventory' }), inv.el, h('div', { class: 'hint', text: 'Click fuel to load the locomotives, anything else goes into the wagons. Right-click moves half a stack.' }));
      w.body.append(h('div', { class: 'panes' }, left, right));
      let lastCars = tr.cars.length;
      w.update = () => {
        if (tr.dead) { this.close(); return; }
        if (tr.cars.length !== lastCars) { lastCars = tr.cars.length; renderCars(); }
        inv.update();
        const st = trainStatus(g, tr);
        const k = st.join('|');
        if (status.dataset.k !== k) { status.dataset.k = k; status.innerHTML = ''; status.appendChild(h('span', { class: 'status ' + st[1], text: st[0] })); }
        for (const f of carUpd) f();
        for (const f of schedUpd) f();
      };
      return w;
    }

    networkBlock(ent, upd) {
      const net = () => ent.net;
      const box = h('div', { class: 'group' }, h('div', { class: 'label', text: 'Electric network' }));
      const dl = h('dl', { class: 'kvs' });
      const rows = [
        ['Satisfaction', () => (net() ? Math.round(net().sat * 100) + '%' : 'not connected')],
        ['Demand', () => (net() ? FG.fmtPower(net().demand) : '—')],
        ['Generating', () => (net() ? FG.fmtPower(net().production || 0) : '—')],
        ['Steam capacity', () => (net() ? FG.fmtPower(net().engines.reduce((s, e) => s + D.protos[e.p].max, 0)) : '—')],
        ['Solar now', () => (net() ? FG.fmtPower(net().solar || 0) : '—')],
        ['Stored', () => (net() ? FG.fmt((net().stored || 0) / 1000) + ' MJ' : '—')],
        ['Machines', () => (net() ? String(net().consumers.length) : '—')],
      ];
      const cells = rows.map(([k]) => { const dd = h('dd'); dl.append(h('dt', { text: k }), dd); return dd; });
      upd(() => rows.forEach(([, f], i) => { cells[i].textContent = f(); }));
      box.appendChild(dl);
      return box;
    }

    filterPicker(ent, upd, hint) {
      const g = this.g;
      const slot = slotEl(null, undefined, { cls: 'filter', onDown: () => { list.hidden = !list.hidden; } });
      slot.dataset.text = 'Click to choose a filter';
      upd(() => setSlot(slot, ent.filter, undefined));
      const list = h('div', { class: 'recipe-picker', hidden: true });
      const ids = Object.keys(D.items).filter((id) => {
        const r = D.recipeFor[id];
        return !r || g.recipeEnabled(r.id) || D.items[id].sub === 'raw';
      }).sort((a, b) => D.items[a].order - D.items[b].order);
      list.appendChild(h('button', { class: 'btn small', style: 'grid-column: span 3', text: 'No filter', onclick: () => { ent.filter = null; list.hidden = true; } }));
      for (const id of ids) list.appendChild(slotEl(id, undefined, { onDown: () => { ent.filter = id; list.hidden = true; } }));
      return h('div', { class: 'group' }, h('div', { class: 'label', text: 'Filter' }), h('div', { class: 'rowx' }, slot, h('span', { class: 'hint', text: hint })), list);
    }

    // ---------------------------------------------------- research window
    build_tech() {
      const g = this.g;
      const w = this.frame('tech', 'Research');
      const side = h('div', { class: 'tech-side' });
      const tiers = h('div', { class: 'tech-tiers' });
      const packsKey = (t) => Object.keys(t.cost).sort().join('+');
      const TIER = [
        ['sci_1', 'Mechanics pack'], ['sci_1+sci_2', 'Mechanics + Logistics'], ['sci_1+sci_2+sci_mil', 'With Defense packs'],
        ['sci_1+sci_2+sci_3', 'With Chemistry packs'], ['sci_1+sci_2+sci_3+sci_mil', 'Chemistry + Defense'], ['sci_1+sci_2+sci_3+sci_4', 'With Industry packs'],
      ];
      const cards = {};
      for (const [key, label] of TIER) {
        const list = Object.values(D.techs).filter((t) => packsKey(t) === key).sort((a, b) => a.order - b.order);
        if (!list.length) continue;
        const packs = key.split('+');
        const cardsEl = h('div', { class: 'cards' });
        for (const t of list) {
          const card = h('div', { class: 'tcard', 'data-tech': t.id }, img(t.icon, 40),
            h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 't', text: t.name }), h('div', { class: 'c', text: t.units + ' × ' + t.time + 's' }), h('div', { class: 'mini' }, h('i'))));
          card.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            if (g.research.done[t.id]) return;
            if (ev.button === 2) g.cancelResearch(t.id);
            else g.queueResearch(t.id, ev.shiftKey);
            update(true);
          });
          card.addEventListener('contextmenu', (ev) => ev.preventDefault());
          cards[t.id] = card;
          cardsEl.appendChild(card);
        }
        tiers.appendChild(h('div', { class: 'tier' }, h('h3', null, packs.map((p) => img(p, 18)), h('span', { class: 'eyebrow', style: 'color:var(--muted)', text: label })), cardsEl));
      }
      w.body.append(side, tiers);
      let lastKey = '';
      const update = (force) => {
        const r = g.research;
        const key = JSON.stringify([r.current, r.queue, Object.keys(r.done).length, r.current ? r.progress[r.current] : 0]);
        if (!force && key === lastKey) return;
        lastKey = key;
        for (const id in cards) {
          const st = g.techState(id);
          const c = cards[id];
          c.className = 'tcard ' + st + (r.queue.indexOf(id) >= 0 ? ' queued' : '') + (r.current === id ? ' current' : '');
          c.querySelector('.mini > i').style.width = ((r.progress[id] || 0) / D.techs[id].units) * 100 + '%';
        }
        side.innerHTML = '';
        const cur = r.current && D.techs[r.current];
        const box = h('div', { class: 'tech-current' });
        if (cur) {
          box.append(h('div', { class: 'eyebrow', text: 'Researching now' }), h('div', { class: 'rowx', style: 'display:flex;gap:8px;align-items:center;margin-top:6px' }, img(cur.icon, 36), h('div', { class: 'name', text: cur.name })),
            h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: 'width:' + ((r.progress[cur.id] || 0) / cur.units) * 100 + '%' })),
            h('div', { class: 'num', style: 'font-size:12px;color:var(--muted);margin-top:4px', text: (r.progress[cur.id] || 0) + ' / ' + cur.units + ' units' }),
            h('div', { class: 'hint', style: 'margin-top:6px', text: 'Labs need: ' + Object.keys(cur.cost).map(nameOf).join(', ') }));
        } else box.append(h('div', { class: 'eyebrow', text: 'Idle' }), h('div', { class: 'hint', style: 'margin-top:6px', text: 'Pick a technology on the right. Build labs, power them and feed them research packs.' }));
        side.appendChild(box);
        if (r.queue.length) {
          side.appendChild(h('h3', { class: 'eyebrow', style: 'color:var(--muted)', text: 'Queue · right-click removes' }));
          const q = h('div', { class: 'tech-queue' });
          for (const id of r.queue) {
            const el = h('div', { class: 'q', 'data-tech': id }, img(D.techs[id].icon, 24), D.techs[id].name);
            el.addEventListener('mousedown', (ev) => { ev.preventDefault(); g.cancelResearch(id); update(true); });
            el.addEventListener('contextmenu', (ev) => ev.preventDefault());
            q.appendChild(el);
          }
          side.appendChild(q);
        }
        const done = Object.keys(r.done).length, total = Object.keys(D.techs).length;
        side.appendChild(h('div', { class: 'hint', text: done + ' of ' + total + ' technologies researched.' }));
      };
      w.update = update;
      return w;
    }

    // ------------------------------------------------------- stats window
    build_stats() {
      const g = this.g;
      const w = this.frame('stats', 'Production');
      let tab = 'items', win = '1m';
      const tabs = h('div', { class: 'tabs' });
      const winSeg = h('div', { class: 'seg' });
      const content = h('div', { class: 'tabbody' });
      const renderTabs = () => {
        tabs.innerHTML = '';
        for (const [id, l] of [['items', 'Items'], ['fluids', 'Fluids'], ['power', 'Power'], ['threat', 'Pollution & threat']]) tabs.appendChild(h('button', { class: 'tab' + (tab === id ? ' on' : ''), text: l, onclick: () => { tab = id; renderTabs(); render(true); } }));
        winSeg.innerHTML = '';
        for (const x of ['1m', '10m', '1h']) winSeg.appendChild(h('button', { class: win === x ? 'on' : '', text: x, onclick: () => { win = x; renderTabs(); render(true); } }));
      };
      let last = 0;
      const render = (force) => {
        const now = performance.now();
        if (!force && now - last < 1000) return;
        last = now;
        content.innerHTML = '';
        if (tab === 'items' || tab === 'fluids') {
          const rates = g.stats.rates(win);
          const ids = Object.keys(rates).filter((id) => (tab === 'fluids' ? !!D.fluids[id] : !!D.items[id]) && (rates[id].p > 0.001 || rates[id].c > 0.001));
          ids.sort((a, b) => Math.max(rates[b].p, rates[b].c) - Math.max(rates[a].p, rates[a].c));
          if (!ids.length) { content.appendChild(h('div', { class: 'hint', text: 'Nothing produced in this window yet.' })); return; }
          const max = Math.max.apply(null, ids.map((id) => Math.max(rates[id].p, rates[id].c)));
          const table = h('table', { class: 'stat-table' }, h('thead', null, h('tr', null, h('th', { text: 'Item' }), h('th', { text: 'Made /min', style: 'text-align:right' }), h('th', { text: 'Used /min', style: 'text-align:right' }), h('th', { text: 'Balance' }))));
          const tb = h('tbody');
          for (const id of ids) {
            const r = rates[id];
            tb.appendChild(h('tr', { 'data-item': id }, h('td', null, img(id, 24), nameOf(id)), h('td', { class: 'r', text: FG.fmt(r.p) }), h('td', { class: 'r', text: FG.fmt(r.c) }),
              h('td', { class: 'bars' }, h('div', { class: 'dualbar' }, h('i', { style: 'width:' + (r.p / max) * 100 + '%;background:var(--good)' })), h('div', { class: 'dualbar' }, h('i', { style: 'width:' + (r.c / max) * 100 + '%;background:var(--bad)' })))));
          }
          table.appendChild(tb);
          content.appendChild(h('div', { class: 'stat-scroll' }, table));
          content.appendChild(h('div', { class: 'legend', style: 'margin-top:8px' }, h('span', null, h('i', { style: 'background:var(--good)' }), 'Produced'), h('span', null, h('i', { style: 'background:var(--bad)' }), 'Consumed')));
        } else if (tab === 'power') {
          const s = g.stats.pwSec;
          const cv = h('canvas', { class: 'chart', width: 720, height: 220 });
          content.append(cv, h('div', { class: 'legend', style: 'margin-top:8px' },
            h('span', null, h('i', { style: 'background:#f0a830' }), 'Steam'), h('span', null, h('i', { style: 'background:#58a6d8' }), 'Solar'),
            h('span', null, h('i', { style: 'background:#b0a8e8' }), 'Accumulators'), h('span', null, h('i', { style: 'background:#e0553f' }), 'Consumption')));
          const cur = s[s.length - 1] || { prod: 0, use: 0 };
          content.appendChild(h('div', { class: 'num', style: 'margin-top:6px;color:var(--muted)', text: 'Now: ' + FG.fmtPower(cur.prod) + ' generated · ' + FG.fmtPower(cur.use) + ' used · last 2 minutes' }));
          this.drawPowerChart(cv, s);
        } else {
          const en = g.enemies;
          let totalPol = 0;
          for (const p of g.world.pollution) totalPol += p;
          const r1 = g.stats.sec.length;
          const dl = h('dl', { class: 'kvs' });
          const row = (k, v) => dl.append(h('dt', { text: k }), h('dd', { text: v }));
          row('Pollution in the air', FG.fmt(totalPol));
          row('Total pollution emitted', FG.fmt(g.stats.pollution));
          row('Enemy mode', g.opts.enemies === 'normal' ? 'Normal' : g.opts.enemies === 'peaceful' ? 'Peaceful (they only fight back)' : 'No enemies');
          row('Hive evolution', (en.evo * 100).toFixed(1) + '%');
          row('Known hives', String(en.nests.length));
          row('Creatures active', String(en.units.length));
          row('Creatures killed', String(g.stats.kills));
          row('Hives destroyed', String(g.stats.nestsKilled || 0));
          row('Buildings lost', String(g.lostBuildings || 0));
          content.append(dl, h('div', { class: 'hint', style: 'margin-top:10px', text: 'Pollution drifts from your machines and is absorbed by grass and forests. When it reaches a hive, the hive spends it to send attack waves. Evolution rises with time, pollution and destroyed hives, bringing tougher creatures. Press F to see the pollution cloud.' }));
          void r1;
        }
      };
      renderTabs();
      w.body.append(h('div', { class: 'pane-head', style: 'margin-bottom:0' }, tabs, winSeg), content);
      render(true);
      w.update = () => render(false);
      return w;
    }

    drawPowerChart(cv, s) {
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      ctx.fillStyle = '#161411'; ctx.fillRect(0, 0, W, H);
      const max = Math.max(1, ...s.map((x) => Math.max(x.prod, x.use))) * 1.15;
      ctx.strokeStyle = 'rgba(179,165,144,0.12)'; ctx.lineWidth = 1;
      ctx.fillStyle = '#85786a'; ctx.font = '12px "IBM Plex Mono", monospace';
      for (let k = 0; k <= 4; k++) {
        const y = H - 18 - ((H - 30) * k) / 4;
        ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 6, y); ctx.stroke();
        ctx.fillText(FG.fmtPower((max * k) / 4), 4, y + 4);
      }
      if (s.length < 2) return;
      const X = (i) => 60 + ((W - 66) * i) / 119;
      const Y = (v) => H - 18 - ((H - 30) * v) / max;
      const off = 120 - s.length;
      // stacked area: steam, solar, acc
      const layers = [['steam', '#f0a830'], ['solar', '#58a6d8'], ['acc', '#b0a8e8']];
      let base = s.map(() => 0);
      for (const [k, col] of layers) {
        const top = s.map((x, i) => base[i] + (x[k] || 0));
        ctx.beginPath();
        s.forEach((_, i) => { const x = X(i + off); if (i === 0) ctx.moveTo(x, Y(top[i])); else ctx.lineTo(x, Y(top[i])); });
        for (let i = s.length - 1; i >= 0; i--) ctx.lineTo(X(i + off), Y(base[i]));
        ctx.closePath();
        ctx.fillStyle = col + '99'; ctx.fill();
        base = top;
      }
      ctx.strokeStyle = '#e0553f'; ctx.lineWidth = 2;
      ctx.beginPath();
      s.forEach((x, i) => { if (i === 0) ctx.moveTo(X(i + off), Y(x.use)); else ctx.lineTo(X(i + off), Y(x.use)); });
      ctx.stroke();
      const lx = X(s.length - 1 + off), ly = Y(s[s.length - 1].use);
      ctx.fillStyle = '#e0553f'; ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // -------------------------------------------------------- map window
    build_map(focus) {
      const g = this.g;
      const w = this.frame('map', 'Map', 'Drag to pan · wheel to zoom');
      const cv = h('canvas', { id: 'bigmap' });
      const legend = h('div', { id: 'map-legend', class: 'card' },
        h('span', null, h('i', { style: 'background:#f0a830;border-radius:50%' }), 'You'), h('span', null, h('i', { style: 'background:#9ab0c8' }), 'Buildings'),
        h('span', null, h('i', { style: 'background:#c8a040' }), 'Belts'), h('span', null, h('i', { style: 'background:#e0303a' }), 'Hives & creatures'));
      const polBtn = h('button', { class: 'btn small' + (this.app.view.showPollution ? ' on' : ''), text: 'Pollution', onclick: () => { this.app.view.showPollution = !this.app.view.showPollution; polBtn.classList.toggle('on', this.app.view.showPollution); draw(); } });
      w.header.insertBefore(polBtn, w.header.lastChild);
      w.body.append(cv, legend);
      const view = this.mapView || { x: g.player.x, y: g.player.y, s: 2 };
      if (focus) { view.x = focus.x; view.y = focus.y; } else { view.x = g.player.x; view.y = g.player.y; }
      this.mapView = view;
      const draw = () => {
        const r = cv.getBoundingClientRect();
        if (cv.width !== Math.round(r.width) || cv.height !== Math.round(r.height)) { cv.width = Math.round(r.width); cv.height = Math.round(r.height); }
        this.app.renderer.drawMap(g, cv, view.x, view.y, view.s, { pollution: this.app.view.showPollution });
      };
      let drag = null;
      cv.addEventListener('mousedown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }; cv.style.cursor = 'grabbing'; });
      const mm = (ev) => { if (!drag) return; view.x = drag.vx - (ev.clientX - drag.x) / view.s; view.y = drag.vy - (ev.clientY - drag.y) / view.s; draw(); };
      const mu = () => { drag = null; cv.style.cursor = 'grab'; };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
      cv.addEventListener('wheel', (ev) => { ev.preventDefault(); view.s = FG.clamp(view.s * (ev.deltaY < 0 ? 1.25 : 0.8), 0.4, 12); draw(); }, { passive: false });
      let last = 0;
      w.update = () => { const now = performance.now(); if (now - last > 500) { last = now; draw(); } };
      w.onClose = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      requestAnimationFrame(draw);
      return w;
    }

    // ------------------------------------------------------ menu windows
    build_menu() {
      const app = this.app;
      const w = this.frame('menu', 'Paused');
      const b = (label, fn, cls) => h('button', { class: 'btn ' + (cls || ''), style: 'justify-content:flex-start;min-width:240px', text: label, onclick: fn });
      w.body.append(h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
        b('Resume', () => this.close(), 'primary'),
        b('Save game', () => this.open('saves', 'save')),
        b('Load game', () => this.open('saves', 'load')),
        b('Copy or import a save code', () => this.open('savecode')),
        b('Controls and tips', () => this.open('help')),
        b(FG.sfx.enabled() ? 'Sound: on' : 'Sound: off', (ev) => { FG.sfx.setEnabled(!FG.sfx.enabled()); ev.target.textContent = FG.sfx.enabled() ? 'Sound: on' : 'Sound: off'; }),
        b('New game', () => this.open('newgame')),
        b('Quit to title', () => { this.close(); app.showTitle(); })));
      return w;
    }

    build_saves(mode) {
      const app = this.app;
      const w = this.frame('saves', mode === 'save' ? 'Save game' : 'Load game');
      const list = h('div', { class: 'slots-list' });
      const render = () => {
        list.innerHTML = '';
        for (const m of FG.save.list()) {
          if (mode === 'save' && m.slot === 'auto') continue;
          const label = m.slot === 'auto' ? 'Autosave' : 'Slot ' + m.slot;
          const meta = m.empty ? 'Empty' : new Date(m.when).toLocaleString() + ' · played ' + FG.fmtTime(m.tick) + ' · ' + Math.round(m.size / 1024) + ' KB';
          const row = h('div', { class: 'srow' }, h('div', { class: 'meta' }, h('b', { text: label }), h('div', { text: meta })));
          if (mode === 'save') row.appendChild(h('button', { class: 'btn small primary', text: m.empty ? 'Save here' : 'Overwrite', onclick: async () => {
            try { await FG.save.store(app.game, m.slot); this.toast('Saved to ' + label.toLowerCase(), 'good'); render(); } catch (e) { this.toast(e.message, 'bad'); }
          } }));
          else if (!m.empty) row.appendChild(h('button', { class: 'btn small primary', text: 'Load', onclick: async () => {
            try { const g = await FG.save.loadSlot(m.slot); app.startGame(g); this.toast('Loaded ' + label.toLowerCase(), 'good'); } catch (e) { this.toast('Could not load: ' + e.message, 'bad'); }
          } }));
          if (!m.empty && m.slot !== 'auto') row.appendChild(h('button', { class: 'btn small danger', text: 'Delete', onclick: () => { FG.save.deleteSlot(m.slot); render(); } }));
          list.appendChild(row);
        }
      };
      render();
      w.body.append(list, h('div', { class: 'hint', style: 'margin-top:10px', text: 'Saves live in this browser only. To move a game elsewhere, use a save code.' }),
        h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Back', onclick: () => (app.game && !app.titleShown ? this.open('menu') : this.close()) })));
      return w;
    }

    build_savecode() {
      const app = this.app;
      const w = this.frame('savecode', 'Save codes');
      const out = h('textarea', { id: 'save-code-out', readonly: true, spellcheck: 'false', 'aria-label': 'Current save code' });
      const inp = h('textarea', { id: 'save-code-in', spellcheck: 'false', placeholder: 'Paste a save code here', 'aria-label': 'Save code to import' });
      const copyBtn = h('button', { class: 'btn', text: 'Copy code', onclick: async () => {
        try { await navigator.clipboard.writeText(out.value); this.toast('Save code copied', 'good'); }
        catch (e) { out.focus(); out.select(); this.toast('Press Ctrl+C to copy the selected code', 'warn'); }
      } });
      const file = h('input', { type: 'file', id: 'save-file', accept: '.txt,.json,.cogworks', style: 'max-width:240px' });
      file.addEventListener('change', async () => { const f = file.files[0]; if (f) inp.value = (await f.text()).trim(); });
      const load = h('button', { class: 'btn primary', text: 'Load this code', onclick: async () => {
        try {
          const text = inp.value.trim();
          const json = text.startsWith('{') ? text : await FG.save.unpack(text);
          app.startGame(FG.save.deserialize(json));
          this.toast('Save code loaded', 'good');
        } catch (e) { this.toast('That code could not be read. Check it was copied completely.', 'bad'); }
      } });
      if (app.game && !app.titleShown) FG.save.pack(FG.save.serialize(app.game)).then((s) => { out.value = s; });
      else out.value = 'Start or load a game to get its save code.';
      w.body.append(h('div', { class: 'pane', style: 'min-width:min(560px, calc(100vw - 60px))' },
        h('h3', { text: 'This game' }), out, h('div', { class: 'actions', style: 'margin-top:0' }, copyBtn),
        h('h3', { text: 'Import' }), inp, h('div', { class: 'actions', style: 'margin-top:0;justify-content:space-between' }, file, load)));
      return w;
    }

    build_newgame() {
      const app = this.app;
      const w = this.frame('newgame', 'New game');
      const seed = h('input', { type: 'text', id: 'ng-seed', value: String((Math.random() * 1e6) | 0), inputmode: 'numeric' });
      const enemies = h('select', { id: 'ng-enemies' }, h('option', { value: 'normal', text: 'Normal: pollution provokes attacks' }), h('option', { value: 'peaceful', text: 'Peaceful: hives only defend themselves' }), h('option', { value: 'off', text: 'None: no hives at all' }));
      const rich = h('select', { id: 'ng-rich' }, h('option', { value: '1', text: 'Normal' }), h('option', { value: '2', text: 'Rich (double ore)' }), h('option', { value: '0.6', text: 'Poor' }));
      const size = h('select', { id: 'ng-size' }, h('option', { value: '512', text: '512 × 512 tiles' }), h('option', { value: '384', text: '384 × 384 (faster)' }), h('option', { value: '768', text: '768 × 768 (huge)' }));
      w.body.append(h('div', { class: 'form' },
        h('label', { for: 'ng-seed', text: 'Map seed' }), seed,
        h('label', { for: 'ng-enemies', text: 'Enemies' }), enemies,
        h('label', { for: 'ng-rich', text: 'Resources' }), rich,
        h('label', { for: 'ng-size', text: 'Map size' }), size),
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Cancel', onclick: () => this.close() }),
        h('button', { class: 'btn primary', text: 'Start', onclick: () => {
          const s = parseInt(seed.value.replace(/\D/g, ''), 10) || ((Math.random() * 1e6) | 0);
          this.close();
          app.newGame({ seed: s, enemies: enemies.value, richness: parseFloat(rich.value), size: parseInt(size.value, 10) });
        } })));
      return w;
    }

    build_help() {
      const w = this.frame('help', 'Controls');
      const keys = [
        ['Walk', 'W A S D'], ['Mine / pick up', 'Hold right-click'], ['Open machine', 'Left-click'], ['Place building', 'Left-click (drag for lines)'],
        ['Rotate', 'R  (Shift+R back)'], ['Clear hand / copy building', 'Q'], ['Inventory & crafting', 'E'], ['Research', 'T'],
        ['Production stats', 'P'], ['Map', 'M'], ['Detail overlay', 'Alt'], ['Pollution overlay', 'F'],
        ['Hotbar', '1 – 0'], ['Put one held item into a machine', 'Z (hold and sweep for more)'], ['Split a stack', 'Right-click it in the inventory'], ['Take products (then fuel)', 'Ctrl+click'], ['Copy / paste settings', 'Shift+R-click / Shift+click'], ['Shoot nearest enemy', 'Hold Space'],
        ['Throw grenade', 'G'], ['Copy area as blueprint', 'Ctrl+C then drag'], ['Cut area', 'Ctrl+X then drag'], ['Paste blueprint', 'Ctrl+V'],
        ['Remove area', 'X then drag'], ['Board or leave a train', 'Enter'], ['Drive a train', 'W / S, A / D at junctions'], ['Zoom', 'Mouse wheel'], ['Pause menu', 'Esc'], ['Show all pole coverage', 'Shift (holding a pole)'],
      ];
      w.body.append(h('div', { class: 'help-grid' }, keys.map(([a, k]) => h('div', null, h('span', { text: a }), h('kbd', { text: k })))),
        h('ul', { class: 'help-tips' },
          h('li', { text: 'Burner drills drop ore into whatever is in front of them. A drill facing a stone furnace is a complete mine-and-smelt line.' }),
          h('li', { text: 'Arms (inserters) move items from behind them to the tile in front, and only take what the target needs.' }),
          h('li', { text: 'Belts have two lanes. Arms put items on the far lane and pick up from either lane; drills drop ore on the lane nearest them; a belt feeding into the side of another fills one lane.' }),
          h('li', { text: 'Loaders (Logistics research) move a whole belt of items into or out of a chest, machine or stopped wagon. The arrow shows the way items go: point it at a chest to fill it, away from one to empty it. R swaps loading and unloading.' }),
          h('li', { text: 'Power: water pump on a shore → boiler (fuel it) → steam engines. Poles connect machines inside their blue area.' }),
          h('li', { text: 'Machines show a badge when stuck: lightning for power, … for missing ingredients, ▲ for a full output.' }),
          h('li', { text: 'Pollution provokes the native hives. Put turrets and walls between your factory and them, and keep turrets fed with magazines.' }),
          h('li', { text: 'After researching Construction drones, blueprints and ghosts build themselves while you stand near them with the items.' }),
          h('li', { text: 'Trains: hold rails and drag from a point to where you want the track to go; the planner lays straights, diagonals and smooth curves on a 2-tile grid and joins existing track. Put named train stops beside the track, place a locomotive and wagons on it, fuel it and give it a schedule. Rail signals keep several trains on one network apart.' })));
      return w;
    }

    build_victory() {
      const g = this.g;
      const w = this.frame('victory', 'Uplink established');
      w.el.classList.add('victory');
      const made = Object.values(g.stats.total.p).reduce((a, b) => a + b, 0);
      w.body.append(h('div', { class: 'eyebrow', text: 'Launch ' + g.launches }), h('div', { class: 'big', text: 'Signal received' }),
        h('p', { style: 'max-width:52ch;color:var(--muted)', text: 'Your satellite is in orbit and the frontier is connected. The factory can keep growing: every research, upgrade and launch still counts.' }),
        h('dl', { class: 'kvs', style: 'margin-top:10px' },
          h('dt', { text: 'Time to launch' }), h('dd', { text: FG.fmtTime(g.wonAt || g.tick) }),
          h('dt', { text: 'Items produced' }), h('dd', { text: FG.fmt(made) }),
          h('dt', { text: 'Buildings standing' }), h('dd', { text: String(g.ents.size) }),
          h('dt', { text: 'Technologies' }), h('dd', { text: Object.keys(g.research.done).length + ' / ' + Object.keys(D.techs).length }),
          h('dt', { text: 'Creatures defeated' }), h('dd', { text: String(g.stats.kills) })),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', text: 'Keep building', onclick: () => this.close() })));
      return w;
    }
  }

  FG.UI = UI;
  FG.ui = { slotEl, setSlot, nameOf, entName, statusOf };
})();
