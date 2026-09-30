// Cogworks Frontier — canvas renderer for the world, buildings, belts and effects.
(function () {
  'use strict';
  const D = FG.data;
  const S = FG.sprites;
  const T0 = 32; // screen pixels per tile at zoom 1

  // ----------------------------------------------------------- terrain art
  const TERRAIN = [
    [77, 107, 47], // grass
    [108, 106, 56], // dry grass
    [178, 152, 100], // sand
    [119, 89, 58], // dirt
    [44, 93, 140], // water
    [31, 70, 114], // deep water
  ];
  const rgb = (c, k) => 'rgb(' + Math.round(c[0] * k) + ',' + Math.round(c[1] * k) + ',' + Math.round(c[2] * k) + ')';
  let shadeNoise = null, shadeSeed = -1;
  const ORE_COL = { 1: ['#5f7384', '#b7c9d6'], 2: ['#a3603a', '#4ec9a6'], 3: ['#2a2927', '#4a4844'], 4: ['#9c9383', '#c8bfae'] };

  function paintChunk(world, cx, cy, P) {
    const C = FG.CHUNK;
    const c = S.makeCanvas(C * P, C * P);
    const ctx = c.getContext('2d');
    const W = world.W;
    const x0 = cx * C, y0 = cy * C;
    if (shadeSeed !== world.seed) { shadeNoise = FG.makeNoise(world.seed + 991); shadeSeed = world.seed; }
    const terr = (x, y) => (world.inBounds(x, y) ? world.terrain[y * W + x] : 5);
    for (let ty = 0; ty < C; ty++) {
      for (let tx = 0; tx < C; tx++) {
        const x = x0 + tx, y = y0 + ty;
        if (x >= world.W || y >= world.H) continue;
        const i = y * W + x;
        const t = world.terrain[i], v = world.variant[i];
        // Smooth large-scale shading plus a whisper of per-tile variation.
        const k0 = 0.9 + shadeNoise(x / 14, y / 14, 2) * 0.2 + ((v % 5) - 2) * 0.008;
        ctx.fillStyle = rgb(TERRAIN[t], k0);
        ctx.fillRect(tx * P, ty * P, P, P);
        if (P >= 8) {
          const k = P / 16;
          // Dither into neighbouring terrain so borders are not blocky.
          for (let d = 0; d < 4; d++) {
            const nt = terr(x + FG.DX[d], y + FG.DY[d]);
            if (nt === t || (nt >= 4) !== (t >= 4)) continue;
            ctx.fillStyle = rgb(TERRAIN[nt], k0);
            for (let s = 0; s < 5; s++) {
              const a = ((v * (s + 7) * 13 + d * 31) % 16) * k;
              const b = (((v >> 2) * (s + 3) * 7 + d * 17) % (5 + s)) * k;
              const px = FG.DX[d] ? (FG.DX[d] > 0 ? P - b - 2 * k : b) : a;
              const py = FG.DY[d] ? (FG.DY[d] > 0 ? P - b - 2 * k : b) : a;
              ctx.fillRect(tx * P + px, ty * P + py, 2 * k, 2 * k);
            }
          }
          // texture specks
          ctx.fillStyle = t >= 4 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
          for (let s = 0; s < 3; s++) {
            const hx = ((v * (s + 3) * 7) % 14) + 1, hy = ((v * (s + 5) * 11) % 14) + 1;
            ctx.fillRect(tx * P + hx * k, ty * P + hy * k, 2 * k, (t >= 4 ? 1 : 2) * k);
          }
          if (t < 4) {
            // shoreline foam
            const wet = (dx, dy) => world.inBounds(x + dx, y + dy) && world.terrain[(y + dy) * W + x + dx] >= 4;
            ctx.fillStyle = 'rgba(210,190,140,0.35)';
            if (wet(0, -1)) ctx.fillRect(tx * P, ty * P, P, 2 * k);
            if (wet(0, 1)) ctx.fillRect(tx * P, ty * P + P - 2 * k, P, 2 * k);
            if (wet(-1, 0)) ctx.fillRect(tx * P, ty * P, 2 * k, P);
            if (wet(1, 0)) ctx.fillRect(tx * P + P - 2 * k, ty * P, 2 * k, P);
          }
        }
      }
    }
    // Resources and obstacles on top.
    for (let ty = 0; ty < C; ty++) {
      for (let tx = 0; tx < C; tx++) {
        const x = x0 + tx, y = y0 + ty;
        if (x >= world.W || y >= world.H) continue;
        const i = y * W + x;
        const r = world.res[i];
        if (!r || world.amt[i] <= 0) continue;
        const v = world.variant[i];
        const px = tx * P, py = ty * P;
        if (P < 8) {
          ctx.fillStyle = r === 6 ? '#2a4a1e' : r === 7 ? '#8a8378' : r === 5 ? '#141210' : ORE_COL[r][0];
          ctx.fillRect(px, py, P, P);
          continue;
        }
        if (r >= 1 && r <= 4) {
          const [base, hi] = ORE_COL[r];
          const n = Math.min(4, 1 + Math.floor(world.amt[i] / 350));
          for (let s = 0; s < n; s++) {
            const ox = (((v >> s) * 37 + s * 53) % 10) / 16 + 0.1, oy = (((v >> (s + 1)) * 29 + s * 71) % 10) / 16 + 0.1;
            const rad = P * (0.16 + ((v + s * 17) % 5) * 0.015);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath(); ctx.arc(px + ox * P + P * 0.04, py + oy * P + P * 0.06, rad, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = base;
            ctx.beginPath(); ctx.arc(px + ox * P, py + oy * P, rad, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = hi;
            ctx.fillRect(px + ox * P - rad * 0.4, py + oy * P - rad * 0.4, Math.max(1, rad * 0.45), Math.max(1, rad * 0.45));
          }
        } else if (r === 5) {
          ctx.fillStyle = 'rgba(10,8,6,0.8)';
          ctx.beginPath(); ctx.ellipse(px + P / 2, py + P / 2, P * 0.9, P * 0.7, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(80,60,120,0.35)';
          ctx.beginPath(); ctx.ellipse(px + P * 0.4, py + P * 0.4, P * 0.3, P * 0.18, 0, 0, Math.PI * 2); ctx.fill();
        } else if (r === 6) {
          const g = ['#2f5a24', '#376628', '#2a4f20'][v % 3];
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.beginPath(); ctx.ellipse(px + P * 0.62, py + P * 0.72, P * 0.5, P * 0.32, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#4a3220';
          ctx.fillRect(px + P * 0.44, py + P * 0.5, P * 0.14, P * 0.3);
          for (const [ox, oy, rr] of [[0.5, 0.36, 0.34], [0.34, 0.48, 0.24], [0.66, 0.46, 0.24]]) {
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(px + ox * P, py + oy * P, rr * P, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath(); ctx.arc(px + P * 0.44, py + P * 0.3, P * 0.12, 0, Math.PI * 2); ctx.fill();
        } else if (r === 7) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath(); ctx.ellipse(px + P * 0.56, py + P * 0.62, P * 0.46, P * 0.34, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#8a8378';
          ctx.beginPath(); ctx.ellipse(px + P * 0.5, py + P * 0.5, P * 0.44, P * 0.34, 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#a8a092';
          ctx.beginPath(); ctx.ellipse(px + P * 0.42, py + P * 0.42, P * 0.2, P * 0.14, 0.3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    return c;
  }

  // ---------------------------------------------------------------- renderer
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.lod0 = new Map(); // chunk index -> {c, v, used}
      this.lod1 = new Map();
      this.frame = 0;
      this.dark = null;
      this.iconColor = {};
      this.resize();
    }
    resize() {
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      this.dpr = dpr;
      const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.W = w; this.H = h;
    }
    get T() { return T0 * this.cam.zoom; }
    toScreen(wx, wy) { const T = this.T; return [(wx - this.cam.x) * T + this.W / 2, (wy - this.cam.y) * T + this.H / 2]; }
    toWorld(sx, sy) { const T = this.T; return [(sx - this.W / 2) / T + this.cam.x, (sy - this.H / 2) / T + this.cam.y]; }

    chunkImage(g, c, lod) {
      const map = lod ? this.lod1 : this.lod0;
      const v = g.world.chunkVersion[c];
      let e = map.get(c);
      if (e && e.v === v) { e.used = this.frame; return e.c; }
      const cx = c % g.world.CW, cy = (c / g.world.CW) | 0;
      const img = paintChunk(g.world, cx, cy, lod ? 4 : 16);
      map.set(c, { c: img, v, used: this.frame });
      if (!lod && map.size > 56) {
        let oldest = null, ou = Infinity;
        for (const [k, val] of map) if (val.used < ou) { ou = val.used; oldest = k; }
        map.delete(oldest);
      }
      return img;
    }

    avgColor(id) {
      if (this.iconColor[id]) return this.iconColor[id];
      let col = '#888';
      try {
        const c = FG.icons.get(id);
        const d = c.getContext('2d').getImageData(0, 0, 64, 64).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        if (n) col = 'rgb(' + ((r / n) | 0) + ',' + ((g / n) | 0) + ',' + ((b / n) | 0) + ')';
      } catch (e) { /* ignore */ }
      this.iconColor[id] = col;
      return col;
    }

    // Draw a cached sprite for an entity footprint at world (x, y).
    blit(sp, x, y, alpha) {
      const T = this.T, k = T / S.T;
      const [sx, sy] = this.toScreen(x, y);
      const ctx = this.ctx;
      if (alpha !== undefined) ctx.globalAlpha = alpha;
      ctx.drawImage(sp.canvas, sx - sp.pad * k, sy - sp.pad * k, sp.canvas.width * k, sp.canvas.height * k);
      if (alpha !== undefined) ctx.globalAlpha = 1;
    }

    draw(g, view) {
      this.frame++;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#0d0c0b';
      ctx.fillRect(0, 0, this.W, this.H);
      const T = this.T;
      const [wx0, wy0] = this.toWorld(0, 0);
      const [wx1, wy1] = this.toWorld(this.W, this.H);
      const C = FG.CHUNK;
      const w = g.world;
      const cx0 = Math.max(0, Math.floor(wx0 / C)), cy0 = Math.max(0, Math.floor(wy0 / C));
      const cx1 = Math.min(w.CW - 1, Math.floor(wx1 / C)), cy1 = Math.min(w.CH - 1, Math.floor(wy1 / C));
      const lod = T < 14 ? 1 : 0;
      ctx.imageSmoothingEnabled = lod === 1;
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const img = this.chunkImage(g, cy * w.CW + cx, lod);
        const [sx, sy] = this.toScreen(cx * C, cy * C);
        ctx.drawImage(img, Math.floor(sx), Math.floor(sy), Math.ceil(C * T) + 1, Math.ceil(C * T) + 1);
      }
      ctx.imageSmoothingEnabled = true;

      // Ground decals.
      for (const f of g.effects) if (f.type === 'splat') {
        const [sx, sy] = this.toScreen(f.x, f.y);
        ctx.globalAlpha = 0.55 * (1 - f.t / f.life);
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.ellipse(sx, sy, f.r * T * 0.9, f.r * T * 0.6, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Gather visible entities.
      const ground = [], objects = [], arms = [];
      const seen = new Set();
      for (let cy = Math.max(0, cy0 - 1); cy <= cy1; cy++) for (let cx = Math.max(0, cx0 - 1); cx <= cx1; cx++) {
        const set = g.chunkEnts[cy * w.CW + cx];
        if (!set) continue;
        for (const id of set) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = g.ents.get(id);
          if (!e || e.x > wx1 + 1 || e.y > wy1 + 1 || e.x + e.w < wx0 - 1 || e.y + e.h < wy0 - 1) continue;
          const k = D.protos[e.p].kind;
          if (k === 'belt' || k === 'underground' || k === 'splitter' || k === 'loader' || k === 'pipe' || k === 'pipe_ug') ground.push(e);
          else objects.push(e);
          if (k === 'inserter') arms.push(e);
        }
      }
      this.drawRails(g, wx0, wy0, wx1, wy1, view);
      this.drawGround(g, ground, view);
      objects.sort((a, b) => a.y + a.h - (b.y + b.h));
      for (const e of objects) this.drawEntity(g, e, view);
      for (const e of arms) this.drawArm(g, e);
      this.drawTrains(g, wx0, wy0, wx1, wy1, view);
      this.drawGhosts(g, wx0, wy0, wx1, wy1);
      this.drawEnemies(g, wx0, wy0, wx1, wy1);
      this.drawPlayer(g);
      this.drawWires(g, objects);
      this.drawEffects(g);
      this.drawNight(g, objects);
      if (view.showPollution) this.drawPollution(g, cx0, cy0, cx1, cy1);
      this.drawOverlays(g, objects.concat(ground), view);
    }

    // -------------------------------------------------------------- track
    // Map world units to screen pixels on the canvas context.
    worldTransform() {
      const T = this.T, d = this.dpr;
      this.ctx.setTransform(d * T, 0, 0, d * T, d * (this.W / 2 - this.cam.x * T), d * (this.H / 2 - this.cam.y * T));
    }
    drawRails(g, wx0, wy0, wx1, wy1, view) {
      const R = g.rail, RL = FG.rails;
      const vis = (pc) => { const b = S.trackBox(pc); return b[0] < wx1 && b[2] > wx0 && b[1] < wy1 && b[3] > wy0; };
      const list = [], ends = [];
      for (const pc of R.pieces.values()) {
        if (!vis(pc)) continue;
        list.push(pc);
        // Buffer stops where the track ends.
        if (!R.out.has(RL.stateKey(pc.bx, pc.by, pc.bh))) ends.push([pc.bx, pc.by, pc.bh]);
        if (!R.out.has(RL.stateKey(pc.ax, pc.ay, RL.opp8(pc.ah)))) ends.push([pc.ax, pc.ay, RL.opp8(pc.ah)]);
      }
      const ghosts = [];
      for (const pc of R.ghosts.values()) if (vis(pc)) ghosts.push(pc);
      const plan = view.railPlan;
      if (!list.length && !ghosts.length && !plan) return;
      const ctx = this.ctx;
      ctx.save();
      this.worldTransform();
      S.drawTrack(ctx, list, this.T, { ends });
      const marked = list.filter((pc) => pc.decon);
      if (marked.length) S.drawTrack(ctx, marked, this.T, { alpha: 0.5, tint: 'rgba(224,85,63,0.8)' });
      if (ghosts.length) S.drawTrack(ctx, ghosts, this.T, { alpha: 0.35, tint: 'rgba(88,166,216,0.7)' });
      if (plan) {
        const fresh = plan.pieces.filter((pc) => !pc.exists);
        S.drawTrack(ctx, fresh, this.T, { alpha: 0.5, tint: plan.ok ? 'rgba(122,192,90,0.75)' : 'rgba(224,85,63,0.8)' });
        const reuse = plan.pieces.filter((pc) => pc.exists);
        if (reuse.length) S.drawTrack(ctx, reuse, this.T, { alpha: 0.25, tint: 'rgba(240,230,210,0.6)' });
        if (plan.point) {
          ctx.fillStyle = plan.ok ? '#7ac05a' : '#e0553f';
          ctx.beginPath(); ctx.arc(plan.point[0], plan.point[1], 0.28, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    // -------------------------------------------------------------- belts
    drawGround(g, list, view) {
      const ctx = this.ctx, T = this.T;
      const tick = g.tick;
      const hoods = [];
      const nodes = [];
      for (const e of list) {
        const pr = D.protos[e.p];
        if (pr.kind === 'pipe' || pr.kind === 'pipe_ug') { this.drawPipe(g, e); continue; }
        const frame = Math.floor(tick * (pr.speed / FG.TICKS) * 32) & 7;
        if (pr.kind === 'belt') {
          let shape = 0;
          if (e.curveIn && e.inDir !== e.dir) shape = e.inDir === FG.rightOf(e.dir) ? 1 : 2;
          this.blit(S.belt(pr.tier, shape, e.dir, frame), e.x, e.y);
          nodes.push(e);
        } else if (pr.kind === 'underground') {
          this.blit(S.belt(pr.tier, 0, e.dir, frame), e.x, e.y);
          nodes.push(e);
          hoods.push(e);
        } else if (pr.kind === 'splitter') {
          for (const h of e.halves) { this.blit(S.belt(pr.tier, 0, e.dir, frame), h.x, h.y); nodes.push(h); }
          hoods.push(e);
        } else if (pr.kind === 'loader') {
          this.blit(S.belt(pr.tier, 0, e.dir, frame), e.node.x, e.node.y);
          nodes.push(e.node);
          hoods.push(e);
        }
      }
      // Items on lanes.
      const small = T < 11;
      const sz = T * 0.42;
      const pos = [0, 0];
      for (const n of nodes) {
        const [lo, hi] = FG.belts.visibleRange(n);
        for (let L = 0; L < 2; L++) {
          const lane = n.lanes[L];
          for (let i = 0; i < lane.ids.length; i++) {
            const p = lane.pos[i];
            if (p < lo || p > hi) continue;
            FG.belts.itemPos(n, L, p, pos);
            const [sx, sy] = this.toScreen(pos[0], pos[1]);
            if (small) { ctx.fillStyle = this.avgColor(lane.ids[i]); ctx.fillRect(sx - 1, sy - 1, 2, 2); }
            else ctx.drawImage(FG.icons.get(lane.ids[i]), sx - sz / 2, sy - sz / 2, sz, sz);
          }
        }
      }
      for (const e of hoods) {
        const pr = D.protos[e.p];
        if (pr.kind === 'underground') this.blit(S.hood(pr.tier, e.ug === 'in', e.dir), e.x, e.y);
        else if (pr.kind === 'loader') this.blit(S.loader(pr.tier, e.lm !== 'out', e.dir), e.x, e.y);
        else this.blit(S.splitter(pr.tier, e.dir), e.x, e.y);
      }
    }

    drawPipe(g, e) {
      const ctx = this.ctx, T = this.T;
      const pr = D.protos[e.p];
      const [sx, sy] = this.toScreen(e.x + 0.5, e.y + 0.5);
      const box = e.fbs[0];
      const info = FG.fluidsys.info(box);
      let mask = 0;
      if (pr.kind === 'pipe') {
        for (let d = 0; d < 4; d++) {
          const o = FG.entAt(g, e.x + FG.DX[d], e.y + FG.DY[d]);
          if (!o || !o.fbs) continue;
          const back = FG.opposite(d);
          if (o.fbs.some((b) => b.conns.some((c) => c.x === e.x + FG.DX[d] && c.y === e.y + FG.DY[d] && c.d === back))) mask |= 1 << d;
        }
      } else mask = 1 << e.dir;
      ctx.lineCap = 'round';
      const seg = (w, col) => {
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.beginPath();
        let any = false;
        for (let d = 0; d < 4; d++) if (mask & (1 << d)) { ctx.moveTo(sx, sy); ctx.lineTo(sx + FG.DX[d] * T * 0.5, sy + FG.DY[d] * T * 0.5); any = true; }
        if (!any) { ctx.moveTo(sx - T * 0.2, sy); ctx.lineTo(sx + T * 0.2, sy); }
        ctx.stroke();
      };
      seg(T * 0.42, '#2c3136');
      seg(T * 0.3, '#8a959f');
      if (info.fluid && info.level > 0.01) seg(T * 0.12, S.rgba(D.fluids[info.fluid].color, 0.4 + info.level * 0.6));
      circle(ctx, sx, sy, T * 0.2, '#6a757f');
      if (pr.kind === 'pipe_ug') {
        ctx.fillStyle = '#4a545c';
        S.rr(ctx, sx - T * 0.3, sy - T * 0.3, T * 0.6, T * 0.6, T * 0.1); ctx.fill();
        ctx.fillStyle = '#1e2226';
        const bd = FG.opposite(e.dir);
        ctx.fillRect(sx + FG.DX[bd] * T * 0.18 - T * 0.2 * (FG.DY[bd] ? 1 : 0.3), sy + FG.DY[bd] * T * 0.18 - T * 0.2 * (FG.DX[bd] ? 1 : 0.3), T * (FG.DY[bd] ? 0.4 : 0.12), T * (FG.DX[bd] ? 0.4 : 0.12));
      }
    }

    // ----------------------------------------------------------- entities
    drawEntity(g, e, view) {
      const ctx = this.ctx, T = this.T;
      const pr = D.protos[e.p];
      this.blit(S.entity(e.p, e.dir), e.x, e.y);
      const [sx, sy] = this.toScreen(e.x, e.y);
      const W = e.w * T, H = e.h * T;
      const working = e.status === 'working' || e.status === 'low_power';
      const t = g.tick;
      switch (pr.kind) {
        case 'signal': {
          const st = FG.trains.signalState(g, e);
          const lamp = st === 'free' ? '#7ac05a' : st === 'reserved' ? '#e8c547' : st === 'occupied' ? '#e0553f' : '#5a5650';
          ctx.save(); ctx.translate(sx, sy); S.paintSignal(ctx, T, pr.role, e.rd || 0, lamp); ctx.restore();
          break;
        }
        case 'trainstop':
          ctx.save(); ctx.translate(sx, sy); S.paintStop(ctx, T, e.rd || 0); ctx.restore();
          break;
        case 'drill': {
          const cx = sx + W / 2, cy = sy + H / 2 + T * 0.1;
          const r = W * 0.28;
          const a = working ? t * 0.08 : 0;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = T * 0.08;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) { const aa = a + (k * Math.PI * 2) / 3; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(aa) * r, cy + Math.sin(aa) * r); }
          ctx.stroke();
          circle(ctx, cx, cy, T * 0.1, '#9aa4ae');
          if (pr.burner && working) this.fire(sx + T * 1.52, sy + T * 1.52, T * 0.18, t);
          break;
        }
        case 'furnace':
          if (working) {
            if (pr.id === 'electric_furnace') { circle(ctx, sx + W / 2, sy + H / 2, T * 0.3, 'rgba(255,140,40,' + (0.6 + 0.3 * Math.sin(t * 0.2)) + ')'); }
            else this.fire(sx + W / 2, sy + H * 0.63, T * 0.28, t);
          }
          break;
        case 'boiler':
          if (working) {
            const [fx, fy] = this.rotPoint(e, 1.5, 1.33);
            this.fire(fx, fy, T * 0.3, t);
          }
          break;
        case 'crafter': case 'uplink': {
          if (pr.id === 'chem_plant') {
            if (working) for (let k = 0; k < 3; k++) circle(ctx, sx + W * (0.3 + k * 0.2), sy + H * (0.35 + 0.1 * Math.sin(t * 0.1 + k)), T * 0.06, 'rgba(200,255,230,0.7)');
          } else if (pr.id === 'refinery') {
            if (working) { const [fx, fy] = this.rotPoint(e, 3.3, 1.5); this.fire(fx, fy - T * 0.2, T * 0.25, t); }
          } else if (pr.kind === 'uplink') {
            this.drawUplink(g, e, sx, sy, W);
          } else {
            const a = working ? t * 0.05 : 0;
            ctx.save(); ctx.translate(sx + W / 2, sy + H / 2); ctx.rotate(a);
            S.gearShape(ctx, 0, 0, T * 0.5, 8, '#8a939c', '#3a3e44');
            ctx.restore();
          }
          if (e.recipe && (view.altMode || T > 40) && pr.kind !== 'uplink') {
            const r = D.recipes[e.recipe];
            const id = r.main;
            const s = T * 1.1;
            ctx.fillStyle = 'rgba(20,18,16,0.55)';
            circle(ctx, sx + W / 2, sy + H / 2, s * 0.62, 'rgba(20,18,16,0.55)');
            ctx.drawImage(FG.icons.get(id), sx + W / 2 - s / 2, sy + H / 2 - s / 2, s, s);
          }
          break;
        }
        case 'lab':
          if (working) circle(ctx, sx + W / 2, sy + H / 2, T * (0.6 + 0.08 * Math.sin(t * 0.15)), 'rgba(160,220,255,0.35)');
          break;
        case 'engine': {
          const [fx, fy] = this.rotPoint(e, 1.5, 3.35);
          const a = t * 0.02 * ((e.out || 0) / 900) * 6;
          e.spin = (e.spin || 0) + ((e.out || 0) / 900) * 0.25;
          ctx.save(); ctx.translate(fx, fy); ctx.rotate(e.spin || a);
          ctx.strokeStyle = '#8a939c'; ctx.lineWidth = T * 0.14;
          ctx.beginPath(); ctx.moveTo(-T * 0.8, 0); ctx.lineTo(T * 0.8, 0); ctx.moveTo(0, -T * 0.8); ctx.lineTo(0, T * 0.8); ctx.stroke();
          ctx.restore();
          circle(ctx, fx, fy, T * 0.2, '#5a6068');
          break;
        }
        case 'pumpjack': {
          const ph = working ? Math.sin(t * 0.06) : 0;
          const [cx, cy] = this.rotPoint(e, 1.5, 1.5);
          ctx.save(); ctx.translate(cx, cy);
          ctx.strokeStyle = '#2a2622'; ctx.lineWidth = T * 0.3;
          ctx.beginPath(); ctx.moveTo(-T * 1.1, ph * T * 0.3); ctx.lineTo(T * 1.1, -ph * T * 0.3); ctx.stroke();
          ctx.strokeStyle = '#c8a040'; ctx.lineWidth = T * 0.18;
          ctx.beginPath(); ctx.moveTo(-T * 1.1, ph * T * 0.3); ctx.lineTo(T * 1.1, -ph * T * 0.3); ctx.stroke();
          circle(ctx, 0, 0, T * 0.18, '#4a4436');
          ctx.restore();
          break;
        }
        case 'accumulator': {
          const f = e.charge / D.protos[e.p].capacity;
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sx + T * 0.3, sy + H - T * 0.3, W - T * 0.6, T * 0.12);
          ctx.fillStyle = '#6ad0ff'; ctx.fillRect(sx + T * 0.3, sy + H - T * 0.3, (W - T * 0.6) * f, T * 0.12);
          break;
        }
        case 'beacon':
          if (working) circle(ctx, sx + W / 2, sy + H / 2, T * (0.35 + 0.1 * Math.sin(t * 0.1)), 'rgba(190,170,255,0.5)');
          break;
        case 'turret': case 'laser':
          S.paintTurretHead(ctx, pr, sx + W / 2, sy + H / 2, e.angle, T);
          break;
        case 'solar': {
          const l = g.daylight();
          if (l > 0) { ctx.fillStyle = 'rgba(255,255,255,' + 0.06 * l + ')'; ctx.fillRect(sx + T * 0.2, sy + T * 0.2, W - T * 0.4, H * 0.3); }
          break;
        }
      }
      if (e.hp < pr.hp) {
        const f = Math.max(0, e.hp / pr.hp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx + W * 0.15, sy - T * 0.18, W * 0.7, T * 0.1);
        ctx.fillStyle = f > 0.5 ? '#7ac05a' : f > 0.25 ? '#e8c547' : '#e0553f';
        ctx.fillRect(sx + W * 0.15, sy - T * 0.18, W * 0.7 * f, T * 0.1);
      }
      if (e.decon) {
        ctx.strokeStyle = '#e0553f'; ctx.lineWidth = Math.max(2, T * 0.08);
        ctx.beginPath(); ctx.moveTo(sx + T * 0.2, sy + T * 0.2); ctx.lineTo(sx + W - T * 0.2, sy + H - T * 0.2);
        ctx.moveTo(sx + W - T * 0.2, sy + T * 0.2); ctx.lineTo(sx + T * 0.2, sy + H - T * 0.2); ctx.stroke();
      }
    }

    // Screen position of a local point (north frame) on a rotated entity.
    rotPoint(e, lx, ly) {
      const pr = D.protos[e.p];
      let x = lx, y = ly, w = pr.w, h = pr.h;
      for (let i = 0; i < (pr.rotatable ? e.dir : 0); i++) { const nx = h - y, ny = x; x = nx; y = ny; const t = w; w = h; h = t; }
      return this.toScreen(e.x + x, e.y + y);
    }

    fire(x, y, r, t) {
      const ctx = this.ctx;
      const f = 0.8 + 0.2 * Math.sin(t * 0.5) + 0.1 * Math.sin(t * 1.3);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6 * f);
      gr.addColorStop(0, 'rgba(255,230,140,0.95)');
      gr.addColorStop(0.4, 'rgba(255,140,40,0.8)');
      gr.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, r * 1.6 * f, 0, Math.PI * 2); ctx.fill();
    }

    drawUplink(g, e, sx, sy, W) {
      const ctx = this.ctx, T = this.T;
      const pr = D.protos[e.p];
      const f = e.stages / pr.stages;
      ctx.strokeStyle = '#3a3e44'; ctx.lineWidth = T * 0.25;
      ctx.beginPath(); ctx.arc(sx + W / 2, sy + W / 2, T * 2.6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#f0a830';
      ctx.beginPath(); ctx.arc(sx + W / 2, sy + W / 2, T * 2.6, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
      if (e.stages > 0 || e.launch > 0) {
        const lift = e.launch > 0 ? Math.pow(e.launch / 600, 2.2) * 40 : 0;
        const cx = sx + W / 2, cy = sy + W / 2 - lift * T;
        const h = T * (0.8 + 2.2 * Math.min(1, f));
        if (e.launch > 0) this.fire(cx, cy + h * 0.6, T * 0.9, g.tick);
        S.plate(ctx, cx - T * 0.45, cy - h / 2, T * 0.9, h, T * 0.4, '#dcd6c8', { noShadow: true });
        ctx.fillStyle = '#c8402a'; ctx.fillRect(cx - T * 0.45, cy - h / 2 + T * 0.3, T * 0.9, T * 0.2);
      }
    }

    drawArm(g, e) {
      const ctx = this.ctx, T = this.T;
      const pr = D.protos[e.p];
      const [cx, cy] = this.toScreen(e.x + 0.5, e.y + 0.5);
      // Angle sweeps from the pickup side (behind) to the drop side (front).
      const back = FG.opposite(e.dir);
      const a0 = Math.atan2(FG.DY[back], FG.DX[back]);
      const a = a0 + e.t * Math.PI;
      const len = T * (pr.reach === 2 ? 1.75 : 0.85) * (0.75 + 0.25 * Math.abs(Math.cos(e.t * Math.PI)));
      const hx = cx + Math.cos(a) * len, hy = cy + Math.sin(a) * len;
      const ex = cx + Math.cos(a) * len * 0.5 - Math.sin(a) * T * 0.12, ey = cy + Math.sin(a) * len * 0.5 + Math.cos(a) * T * 0.12;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = T * 0.12;
      ctx.beginPath(); ctx.moveTo(cx + 3, cy + 4); ctx.lineTo(ex + 3, ey + 4); ctx.lineTo(hx + 3, hy + 4); ctx.stroke();
      ctx.strokeStyle = pr.tint; ctx.lineWidth = T * 0.1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
      circle(ctx, ex, ey, T * 0.06, '#3a3e44');
      circle(ctx, hx, hy, T * 0.07, '#3a3e44');
      if (e.hand) {
        const s = T * 0.4;
        ctx.drawImage(FG.icons.get(e.hand.id), hx - s / 2, hy - s / 2, s, s);
      }
    }

    drawGhosts(g, wx0, wy0, wx1, wy1) {
      if (!g.ghosts.size) return;
      const ctx = this.ctx;
      for (const gh of g.ghosts.values()) {
        if (gh.x > wx1 || gh.y > wy1 || gh.x + gh.w < wx0 || gh.y + gh.h < wy0) continue;
        this.drawProtoPreview(gh.p, gh.x, gh.y, gh.dir, 0.4, '#58a6d8', gh.settings && gh.settings.rd, gh.settings && gh.settings.lm);
      }
      ctx.globalAlpha = 1;
    }

    drawProtoPreview(p, x, y, dir, alpha, tint, rd, lm) {
      const ctx = this.ctx, T = this.T;
      const pr = D.protos[p];
      const [fw, fh] = FG.footprint(pr, dir);
      const [sx, sy] = this.toScreen(x, y);
      ctx.globalAlpha = alpha;
      if (pr.kind === 'belt' || pr.kind === 'underground') this.blit(S.belt(pr.tier, 0, dir, 0), x, y, alpha);
      else if (pr.kind === 'splitter') {
        const [ax, ay] = FG.rotLocal(0, 0, 2, 1, dir), [bx, by] = FG.rotLocal(1, 0, 2, 1, dir);
        this.blit(S.belt(pr.tier, 0, dir, 0), x + ax, y + ay, alpha);
        this.blit(S.belt(pr.tier, 0, dir, 0), x + bx, y + by, alpha);
        this.blit(S.splitter(pr.tier, dir), x, y, alpha);
      } else if (pr.kind === 'loader') {
        const t = FG.loaderTiles(x, y, dir, lm);
        this.blit(S.belt(pr.tier, 0, dir, 0), t.bx, t.by, alpha);
        this.blit(S.loader(pr.tier, lm !== 'out', dir), x, y, alpha);
      } else if (pr.kind === 'signal' || pr.kind === 'trainstop') {
        ctx.save(); ctx.translate(sx, sy);
        if (pr.kind === 'signal') S.paintSignal(ctx, T, pr.role, rd || 0, '#7ac05a'); else S.paintStop(ctx, T, rd || 0);
        ctx.restore();
      } else if (pr.kind === 'pipe') {
        ctx.fillStyle = '#8a959f'; ctx.fillRect(sx + T * 0.3, sy + T * 0.3, T * 0.4, T * 0.4);
      } else this.blit(S.entity(p, dir), x, y, alpha);
      if (pr.kind === 'underground') this.blit(S.hood(pr.tier, true, dir), x, y, alpha);
      ctx.globalAlpha = 1;
      if (pr.rotatable || pr.kind === 'inserter') {
        // direction arrow
        const cx = sx + (fw * T) / 2, cy = sy + (fh * T) / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.save(); ctx.translate(cx, cy); ctx.rotate((dir * Math.PI) / 2);
        ctx.beginPath(); ctx.moveTo(0, -T * 0.35); ctx.lineTo(T * 0.2, -T * 0.08); ctx.lineTo(-T * 0.2, -T * 0.08); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      if (tint) {
        ctx.fillStyle = S.rgba(tint, 0.18);
        ctx.fillRect(sx, sy, fw * T, fh * T);
      }
    }

    // ------------------------------------------------------------- trains
    drawTrains(g, wx0, wy0, wx1, wy1, view) {
      const ctx = this.ctx, T = this.T;
      for (const tr of g.rail.trains) {
        for (let i = 0; i < tr.cars.length; i++) {
          const c = tr.cars[i];
          const p = FG.trains.carPose(tr, i);
          if (p.x < wx0 - 3 || p.y < wy0 - 3 || p.x > wx1 + 3 || p.y > wy1 + 3) continue;
          const [sx, sy] = this.toScreen(p.x, p.y);
          let icon = null;
          if (c.type === 'wagon') { const s = c.inv.slots.find((x) => x); if (s) icon = FG.icons.get(s.id); }
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.angle + (c.flip ? Math.PI : 0));
          S.paintCar(ctx, c.type, T * FG.trains.CAR_LEN, T * FG.trains.CAR_W, icon);
          ctx.restore();
          // coupler to the next car
          if (i < tr.cars.length - 1) {
            const q = FG.trains.carPose(tr, i + 1);
            const [ax, ay] = this.toScreen(p.bx, p.by), [bx, by] = this.toScreen(q.fx, q.fy);
            ctx.strokeStyle = '#1e2124'; ctx.lineWidth = Math.max(2, T * 0.12);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          }
        }
      }
    }

    // ------------------------------------------------------------ enemies
    drawEnemies(g, wx0, wy0, wx1, wy1) {
      const ctx = this.ctx, T = this.T;
      const en = g.enemies;
      for (const n of en.nests) {
        if (n.x > wx1 + 2 || n.y > wy1 + 2 || n.x + 2 < wx0 - 2 || n.y + 2 < wy0 - 2) continue;
        const [sx, sy] = this.toScreen(n.x + 1, n.y + 1);
        const pulse = 1 + 0.05 * Math.sin(g.tick * 0.05 + n.anim);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(sx + T * 0.1, sy + T * 0.2, T * 1.2, T * 0.9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5a3050';
        ctx.beginPath(); ctx.ellipse(sx, sy, T * 1.1 * pulse, T * 0.9 * pulse, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7a4068';
        ctx.beginPath(); ctx.ellipse(sx - T * 0.15, sy - T * 0.15, T * 0.7, T * 0.55, 0.3, 0, Math.PI * 2); ctx.fill();
        for (let k = 0; k < 3; k++) {
          const a = k * 2.1 + n.anim;
          circle(ctx, sx + Math.cos(a) * T * 0.45, sy + Math.sin(a) * T * 0.35, T * 0.14, '#e8a0c8');
          circle(ctx, sx + Math.cos(a) * T * 0.45, sy + Math.sin(a) * T * 0.35, T * 0.07, '#2a0e22');
        }
        if (n.hp < D.NEST_HP) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - T, sy - T * 1.3, T * 2, T * 0.12);
          ctx.fillStyle = '#e0553f'; ctx.fillRect(sx - T, sy - T * 1.3, T * 2 * (n.hp / D.NEST_HP), T * 0.12);
        }
      }
      for (const u of en.units) {
        if (u.x > wx1 + 1 || u.y > wy1 + 1 || u.x < wx0 - 1 || u.y < wy0 - 1) continue;
        const def = D.enemies[u.type];
        const [sx, sy] = this.toScreen(u.x, u.y);
        const s = def.size * T;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(u.angle);
        ctx.strokeStyle = S.shade(def.color, -0.5); ctx.lineWidth = Math.max(1, s * 0.12);
        const lg = Math.sin(u.anim * 3) * s * 0.3;
        ctx.beginPath();
        for (const k of [-1, 1]) {
          ctx.moveTo(s * 0.2, 0); ctx.lineTo(s * 0.45 + lg * k, k * s * 0.8);
          ctx.moveTo(-s * 0.1, 0); ctx.lineTo(-s * 0.1 - lg * k, k * s * 0.85);
          ctx.moveTo(-s * 0.4, 0); ctx.lineTo(-s * 0.6 + lg * k, k * s * 0.7);
        }
        ctx.stroke();
        ctx.fillStyle = S.shade(def.color, -0.2);
        ctx.beginPath(); ctx.ellipse(-s * 0.35, 0, s * 0.42, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.ellipse(s * 0.2, 0, s * 0.34, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        circle(ctx, s * 0.45, -s * 0.1, s * 0.07, '#200');
        circle(ctx, s * 0.45, s * 0.1, s * 0.07, '#200');
        ctx.restore();
      }
      for (const s of en.shots) {
        const f = s.t / s.life;
        const x = s.x0 + (s.x1 - s.x0) * f, y = s.y0 + (s.y1 - s.y0) * f - Math.sin(f * Math.PI) * 2;
        const [sx, sy] = this.toScreen(x, y);
        circle(ctx, sx, sy, T * 0.15, '#4a5a3a', '#111', 1);
      }
    }

    // Every player, each in their own colour; with company, names over their heads.
    drawPlayer(g) {
      for (const p of g.players) if (p !== g.local) this.drawOnePlayer(p, true);
      if (g.local) this.drawOnePlayer(g.local, g.players.length > 1);
    }
    drawOnePlayer(p, tag) {
      if (p.dead) return;
      const ctx = this.ctx, T = this.T;
      const [sx, sy] = this.toScreen(p.x, p.y);
      const bob = Math.sin(p.walk * 0.35) * T * 0.04;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(sx + T * 0.06, sy + T * 0.3, T * 0.34, T * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      const ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][p.facing];
      ctx.save(); ctx.translate(sx, sy - T * 0.25 + bob); ctx.rotate(ang + Math.PI / 2);
      // legs
      const sw = Math.sin(p.walk * 0.35) * T * 0.12;
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-T * 0.16, T * 0.05 + sw, T * 0.12, T * 0.22);
      ctx.fillRect(T * 0.04, T * 0.05 - sw, T * 0.12, T * 0.22);
      // backpack
      ctx.fillStyle = '#5a5f66';
      S.rr(ctx, -T * 0.2, T * 0.02, T * 0.4, T * 0.22, T * 0.05); ctx.fill();
      // body
      ctx.fillStyle = p.color || '#e07a2a';
      S.rr(ctx, -T * 0.24, -T * 0.2, T * 0.48, T * 0.34, T * 0.12); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(1, T * 0.03); ctx.stroke();
      // helmet
      circle(ctx, 0, -T * 0.16, T * 0.16, '#e8e2d4', '#5a5448', Math.max(1, T * 0.03));
      ctx.fillStyle = '#2a4a6a';
      ctx.fillRect(-T * 0.1, -T * 0.3, T * 0.2, T * 0.08);
      ctx.restore();
      if (p.hp < p.maxHp) {
        const f = p.hp / p.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - T * 0.35, sy - T * 0.8, T * 0.7, T * 0.08);
        ctx.fillStyle = f > 0.5 ? '#7ac05a' : '#e0553f'; ctx.fillRect(sx - T * 0.35, sy - T * 0.8, T * 0.7 * f, T * 0.08);
      }
      if (tag && p.name) {
        ctx.font = '600 ' + Math.round(FG.clamp(T * 0.34, 11, 15)) + 'px "Barlow Semi Condensed", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const w = ctx.measureText(p.name).width + 10, ty = sy - T * (p.hp < p.maxHp ? 0.86 : 0.72);
        ctx.fillStyle = 'rgba(20,18,16,0.72)';
        ctx.fillRect(sx - w / 2, ty - 16, w, 16);
        ctx.fillStyle = p.color || '#f0a830';
        ctx.fillRect(sx - w / 2, ty - 2, w, 2);
        ctx.fillStyle = '#efe6d6';
        ctx.fillText(p.name, sx, ty - 2);
      }
    }

    drawWires(g, objects) {
      const ctx = this.ctx, T = this.T;
      ctx.lineWidth = Math.max(1, T * 0.035);
      ctx.strokeStyle = 'rgba(40,30,20,0.85)';
      ctx.beginPath();
      for (const e of objects) {
        if (!e.wires) continue;
        const [ax, ay] = this.toScreen(e.x + e.w / 2, e.y + e.h / 2 - 0.4);
        for (const id of e.wires) {
          if (id < e.id) continue;
          const o = g.ents.get(id);
          if (!o) continue;
          const [bx, by] = this.toScreen(o.x + o.w / 2, o.y + o.h / 2 - 0.4);
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + T * 0.4, bx, by);
        }
      }
      ctx.stroke();
      // wires to off-screen poles that start on screen are covered by the above
    }

    drawEffects(g) {
      const ctx = this.ctx, T = this.T;
      for (const f of g.effects) {
        if (f.type === 'tracer') {
          const [ax, ay] = this.toScreen(f.x0, f.y0), [bx, by] = this.toScreen(f.x1, f.y1);
          ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - f.t / f.life; ctx.lineWidth = f.width || 1.5;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (f.type === 'boom') {
          const [sx, sy] = this.toScreen(f.x, f.y);
          const k = f.t / f.life;
          const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, f.r * T * (0.5 + k));
          gr.addColorStop(0, 'rgba(255,230,160,' + (1 - k) + ')');
          gr.addColorStop(0.5, 'rgba(255,120,40,' + 0.7 * (1 - k) + ')');
          gr.addColorStop(1, 'rgba(60,40,30,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(sx, sy, f.r * T * (0.5 + k), 0, Math.PI * 2); ctx.fill();
        } else if (f.type === 'drone') {
          const k = f.t / f.life;
          const [sx, sy] = this.toScreen(f.x0 + (f.x1 - f.x0) * k, f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 1.2);
          circle(ctx, sx, sy, T * 0.14, '#e8e2d4', '#3a3e44', 1);
          circle(ctx, sx, sy, T * 0.05, '#58a6d8');
        } else if (f.type === 'pick') {
          const k = f.t / f.life;
          const [sx, sy] = this.toScreen(f.x, f.y - k * 0.8);
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(FG.icons.get(f.id), sx - T * 0.25, sy - T * 0.25, T * 0.5, T * 0.5);
          ctx.globalAlpha = 1;
        } else if (f.type === 'drop') {
          // An item put in by hand sinks into its target.
          const k = f.t / f.life;
          const [sx, sy] = this.toScreen(f.x, f.y - 0.8 + k * 0.8);
          ctx.globalAlpha = 1 - k * k;
          const s = T * (0.5 - k * 0.2);
          ctx.drawImage(FG.icons.get(f.id), sx - s / 2, sy - s / 2, s, s);
          ctx.globalAlpha = 1;
        }
      }
    }

    drawNight(g, objects) {
      const light = g.daylight();
      const dark = (1 - light) * 0.62;
      if (dark < 0.02) return;
      const w = Math.ceil(this.W / 4), h = Math.ceil(this.H / 4);
      if (!this.dark || this.dark.width !== w || this.dark.height !== h) this.dark = S.makeCanvas(w, h);
      const dc = this.dark.getContext('2d');
      dc.globalCompositeOperation = 'source-over';
      dc.clearRect(0, 0, w, h);
      dc.fillStyle = 'rgba(6,10,28,' + dark + ')';
      dc.fillRect(0, 0, w, h);
      dc.globalCompositeOperation = 'destination-out';
      const T = this.T / 4;
      const hole = (wx, wy, r, a) => {
        const [sx, sy] = this.toScreen(wx, wy);
        const x = sx / 4, y = sy / 4;
        const gr = dc.createRadialGradient(x, y, 0, x, y, r * T);
        gr.addColorStop(0, 'rgba(0,0,0,' + a + ')');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        dc.fillStyle = gr;
        dc.beginPath(); dc.arc(x, y, r * T, 0, Math.PI * 2); dc.fill();
      };
      for (const p of g.players) if (!p.dead) hole(p.x, p.y, 9, 0.9);
      for (const tr of g.rail.trains) tr.cars.forEach((c, i) => {
        if (c.type !== 'loco') return;
        const p = FG.trains.carPose(tr, i);
        const sgn = c.flip ? -1 : 1;
        hole(p.x + Math.cos(p.angle) * sgn * 6, p.y + Math.sin(p.angle) * sgn * 6, 5.5, 0.85);
      });
      for (const e of objects) {
        const k = D.protos[e.p].kind;
        if (e.status !== 'working') continue;
        if (k === 'furnace' || k === 'boiler' || k === 'lab' || k === 'crafter' || k === 'uplink') hole(e.x + e.w / 2, e.y + e.h / 2, 2.5 + e.w, 0.7);
      }
      this.ctx.drawImage(this.dark, 0, 0, this.W, this.H);
    }

    drawPollution(g, cx0, cy0, cx1, cy1) {
      const ctx = this.ctx, C = FG.CHUNK, T = this.T;
      const w = g.world;
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const p = w.pollution[cy * w.CW + cx];
        if (p < 1) continue;
        const [sx, sy] = this.toScreen(cx * C, cy * C);
        ctx.fillStyle = 'rgba(200,40,30,' + Math.min(0.45, 0.05 + Math.log10(p) * 0.1) + ')';
        ctx.fillRect(sx, sy, C * T, C * T);
      }
    }

    // ---------------------------------------------------------- overlays
    drawOverlays(g, list, view) {
      const ctx = this.ctx, T = this.T;
      // status badges
      if (T >= 14) {
        for (const e of list) {
          const badge = STATUS_BADGE[e.status];
          if (!badge) continue;
          const k = D.protos[e.p].kind;
          if (k === 'inserter' && e.status !== 'no_power' && e.status !== 'no_fuel') continue;
          if (k === 'loader') continue; // a backed-up belt is a loader doing its job
          if (k === 'turret' && e.status !== 'no_ammo') continue;
          const [sx, sy] = this.toScreen(e.x + e.w / 2, e.y + e.h / 2);
          const pulse = e.status === 'no_power' || e.status === 'no_fuel' ? 0.7 + 0.3 * Math.sin(g.tick * 0.12) : 1;
          const r = Math.min(T * 0.34, 13);
          ctx.globalAlpha = pulse;
          circle(ctx, sx, sy, r, badge[1], 'rgba(0,0,0,0.6)', 2);
          ctx.fillStyle = '#1a1714';
          ctx.font = 'bold ' + Math.round(r * 1.3) + 'px "Barlow Semi Condensed", sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(badge[0], sx, sy + 1);
          ctx.globalAlpha = 1;
        }
      }
      // alt-mode: chest contents and arm filters
      if (view.altMode && T >= 18) {
        for (const e of list) {
          const pr = D.protos[e.p];
          let id = null;
          if (pr.kind === 'chest') { const s = e.inv.slots.find((x) => x); id = s && s.id; }
          else if (pr.kind === 'furnace' && e.recipe) id = D.recipes[e.recipe].main;
          else if ((pr.kind === 'inserter' || pr.kind === 'splitter' || pr.kind === 'loader') && e.filter) id = e.filter;
          if (!id) continue;
          const [sx, sy] = this.toScreen(e.x + e.w / 2, e.y + e.h / 2);
          const s = T * 0.62;
          circle(ctx, sx, sy, s * 0.6, 'rgba(20,18,16,0.6)');
          ctx.drawImage(FG.icons.get(id), sx - s / 2, sy - s / 2, s, s);
        }
      }
      // train stop names
      if (T >= 16) {
        ctx.font = '600 ' + Math.round(FG.clamp(T * 0.36, 11, 16)) + 'px "Barlow Semi Condensed", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        for (const e of list) {
          if (D.protos[e.p].kind !== 'trainstop') continue;
          const [sx, sy] = this.toScreen(e.x + 0.5, e.y);
          const w = ctx.measureText(e.name).width + 10;
          ctx.fillStyle = 'rgba(20,18,16,0.8)';
          ctx.fillRect(sx - w / 2, sy - T * 0.15 - 18, w, 18);
          ctx.fillStyle = '#f0a830';
          ctx.fillText(e.name, sx, sy - T * 0.15 - 3);
        }
      }
      // hover selection
      const h = view.hover;
      if (h && h.car) {
        const i = h.car.index, tr = h.car.train;
        for (let k = 0; k < tr.cars.length; k++) {
          const p = FG.trains.carPose(tr, k);
          const [ax, ay] = this.toScreen(p.x, p.y);
          ctx.save(); ctx.translate(ax, ay); ctx.rotate(p.angle);
          ctx.strokeStyle = k === i ? '#f0a830' : 'rgba(240,168,48,0.35)'; ctx.lineWidth = 2;
          const L = FG.trains.CAR_LEN, Wd = FG.trains.CAR_W;
          ctx.strokeRect(-T * (L / 2 + 0.05), -T * (Wd / 2 + 0.05), T * (L + 0.1), T * (Wd + 0.1));
          ctx.restore();
        }
      } else if (h && (h.rail || h.railGhost)) {
        ctx.save();
        this.worldTransform();
        S.drawTrack(ctx, [(h.rail || h.railGhost).pc], T, { alpha: 0.25, tint: 'rgba(240,168,48,0.9)' });
        ctx.restore();
      } else if (h && h.ent) {
        const e = h.ent;
        const [sx, sy] = this.toScreen(e.x, e.y);
        this.brackets(sx, sy, e.w * T, e.h * T, '#f0a830');
        const pr = D.protos[e.p];
        if (pr.kind === 'pole') this.poleArea(e.x, e.y, e.w, e.h, pr.supply, false);
        if (pr.kind === 'drill') { const a = FG.drillArea(pr, e.x, e.y, e.w, e.h); this.area(a[0], a[1], a[2] - a[0], a[3] - a[1], '#7ac05a'); }
        if (pr.kind === 'inserter') this.armTargets(e.x, e.y, e.dir, pr.reach);
        if (pr.kind === 'loader') this.loaderHint(g, { cx: e.node.cx, cy: e.node.cy });
        if (pr.kind === 'turret' || pr.kind === 'laser') this.rangeCircle(e.x + 1, e.y + 1, pr.range);
        if (pr.kind === 'beacon') this.area(e.x - pr.range, e.y - pr.range, e.w + pr.range * 2, e.h + pr.range * 2, '#b0a8e8');
      } else if (h && h.tile) {
        const [sx, sy] = this.toScreen(h.tile[0], h.tile[1]);
        const r = g.world.res[h.tile[1] * g.world.W + h.tile[0]];
        if (r && r !== FG.RES.OIL) this.brackets(sx, sy, T, T, 'rgba(240,168,48,0.7)');
      }
      if (h && h.enemy) {
        const [sx, sy] = this.toScreen(h.enemy.x - 0.5, h.enemy.y - 0.5);
        this.brackets(sx, sy, T, T, '#e0553f');
      }
      // rail car placement preview
      if (view.carPreview) {
        const cp = view.carPreview;
        ctx.globalAlpha = 0.6;
        const [ax, ay] = this.toScreen(cp.x, cp.y);
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(cp.angle);
        const L = FG.trains.CAR_LEN, Wd = FG.trains.CAR_W;
        S.paintCar(ctx, cp.type, T * L, T * Wd, null);
        ctx.fillStyle = cp.ok ? 'rgba(122,192,90,0.3)' : 'rgba(224,85,63,0.35)';
        ctx.fillRect(-T * L / 2, -T * Wd / 2, T * L, T * Wd);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      // build preview
      const b = view.build;
      if (b) {
        for (const pv of b.previews) {
          this.drawProtoPreview(pv.p, pv.x, pv.y, pv.dir, 0.6, pv.ok ? '#7ac05a' : '#e0553f', pv.rd, pv.lm);
        }
        const pr = D.protos[b.p];
        const first = b.previews[0];
        if (first) {
          if (pr.kind === 'pole') {
            this.poleArea(first.x, first.y, pr.w, pr.h, pr.supply, true);
            this.poleLinks(g, first.x + pr.w / 2, first.y + pr.h / 2, pr.reach);
          }
          if (pr.kind === 'drill') { const [fw, fh] = FG.footprint(pr, first.dir); const a = FG.drillArea(pr, first.x, first.y, fw, fh); this.area(a[0], a[1], a[2] - a[0], a[3] - a[1], '#7ac05a'); }
          if (pr.kind === 'inserter') this.armTargets(first.x, first.y, first.dir, pr.reach);
          if (pr.kind === 'turret' || pr.kind === 'laser') this.rangeCircle(first.x + 1, first.y + 1, pr.range);
          if (pr.kind === 'beacon') this.area(first.x - pr.range, first.y - pr.range, 3 + pr.range * 2, 3 + pr.range * 2, '#b0a8e8');
          if (pr.kind === 'underground') this.ugHint(g, first, pr);
          if (pr.kind === 'loader') this.loaderHint(g, FG.loaderTiles(first.x, first.y, first.dir, first.lm));
          if (b.showPoles) this.allPoleAreas(g);
        }
      } else if (view.showPoleAreas) this.allPoleAreas(g);
      // selection rectangle (copy / deconstruct)
      if (view.select) {
        const s = view.select;
        const [ax, ay] = this.toScreen(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
        const [bx, by] = this.toScreen(Math.max(s.x0, s.x1) + 1, Math.max(s.y0, s.y1) + 1);
        ctx.fillStyle = s.mode === 'decon' ? 'rgba(224,85,63,0.15)' : 'rgba(88,166,216,0.15)';
        ctx.fillRect(ax, ay, bx - ax, by - ay);
        ctx.strokeStyle = s.mode === 'decon' ? '#e0553f' : '#58a6d8';
        ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(ax, ay, bx - ax, by - ay);
        ctx.setLineDash([]);
      }
      // hand-mining progress
      const m = g.player.mining;
      if (m && view.mineTarget) {
        const t = view.mineTarget;
        const [sx, sy] = this.toScreen(t.cx, t.cy + 0.7);
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(sx - T * 0.5, sy, T, T * 0.14);
        ctx.fillStyle = '#f0a830'; ctx.fillRect(sx - T * 0.5, sy, T * m.prog, T * 0.14);
      }
      // reach circle hint while building far away
      if (view.outOfReach) {
        const [sx, sy] = this.toScreen(g.player.x, g.player.y);
        ctx.strokeStyle = 'rgba(224,85,63,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(sx, sy, view.reach * T, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    brackets(x, y, w, h, col) {
      const ctx = this.ctx;
      const k = Math.min(w, h) * 0.28;
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y + k); ctx.lineTo(x, y); ctx.lineTo(x + k, y);
      ctx.moveTo(x + w - k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + k);
      ctx.moveTo(x + w, y + h - k); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - k, y + h);
      ctx.moveTo(x + k, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - k);
      ctx.stroke();
    }
    area(x, y, w, h, col) {
      const ctx = this.ctx, T = this.T;
      const [sx, sy] = this.toScreen(x, y);
      ctx.fillStyle = S.rgba(col, 0.12); ctx.fillRect(sx, sy, w * T, h * T);
      ctx.strokeStyle = S.rgba(col, 0.6); ctx.lineWidth = 1.5; ctx.strokeRect(sx, sy, w * T, h * T);
    }
    poleArea(x, y, w, h, supply, strong) {
      const cx = x + w / 2, cy = y + h / 2;
      this.area(cx - supply, cy - supply, supply * 2, supply * 2, strong ? '#58a6d8' : '#58a6d8');
    }
    allPoleAreas(g) {
      const ctx = this.ctx, T = this.T;
      ctx.fillStyle = 'rgba(88,166,216,0.08)';
      for (const p of g.byKind.pole || []) {
        const s = D.protos[p.p].supply;
        const [sx, sy] = this.toScreen(p.x + p.w / 2 - s, p.y + p.h / 2 - s);
        ctx.fillRect(sx, sy, s * 2 * T, s * 2 * T);
      }
    }
    poleLinks(g, x, y, reach) {
      const ctx = this.ctx;
      const [sx, sy] = this.toScreen(x, y);
      ctx.strokeStyle = 'rgba(88,166,216,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (const p of g.byKind.pole || []) {
        const r = Math.min(reach, D.protos[p.p].reach);
        const px = p.x + p.w / 2, py = p.y + p.h / 2;
        if (FG.dist2(px, py, x, y) <= r * r) { const [bx, by] = this.toScreen(px, py); ctx.moveTo(sx, sy); ctx.lineTo(bx, by); }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    armTargets(x, y, dir, reach) {
      const ctx = this.ctx, T = this.T;
      const [px, py] = this.toScreen(x - FG.DX[dir] * reach + 0.5, y - FG.DY[dir] * reach + 0.5);
      const [dx, dy] = this.toScreen(x + FG.DX[dir] * reach + 0.5, y + FG.DY[dir] * reach + 0.5);
      circle(ctx, px, py, T * 0.18, null, '#7ac05a', 2.5);
      circle(ctx, dx, dy, T * 0.18, 'rgba(240,168,48,0.5)', '#f0a830', 2.5);
    }
    rangeCircle(x, y, r) {
      const ctx = this.ctx, T = this.T;
      const [sx, sy] = this.toScreen(x, y);
      ctx.fillStyle = 'rgba(224,85,63,0.06)';
      ctx.strokeStyle = 'rgba(224,85,63,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, r * T, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // The tile a loader fills or empties: green over a chest, machine or wagon, amber if bare.
    loaderHint(g, t) {
      const ctx = this.ctx, T = this.T;
      const ok = FG.belts.isStore(g, t.cx, t.cy);
      const [sx, sy] = this.toScreen(t.cx, t.cy);
      ctx.fillStyle = ok ? 'rgba(122,192,90,0.18)' : 'rgba(240,168,48,0.12)';
      ctx.fillRect(sx, sy, T, T);
      this.brackets(sx + T * 0.1, sy + T * 0.1, T * 0.8, T * 0.8, ok ? '#7ac05a' : '#f0a830');
    }
    ugHint(g, pv, pr) {
      // Show where a tunnel belt placed here would pair.
      const back = FG.opposite(pv.dir);
      for (let d = 1; d <= pr.maxDist; d++) {
        const x = pv.x + FG.DX[back] * d, y = pv.y + FG.DY[back] * d;
        const e = FG.entAt(g, x, y);
        if (e && e.p === pr.id && e.dir === pv.dir) {
          if (e.ug === 'in') {
            const [ax, ay] = this.toScreen(x + 0.5, y + 0.5), [bx, by] = this.toScreen(pv.x + 0.5, pv.y + 0.5);
            const ctx = this.ctx;
            ctx.strokeStyle = 'rgba(122,192,90,0.9)'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
          }
          return;
        }
      }
      const ex = pv.x + FG.DX[pv.dir] * pr.maxDist, ey = pv.y + FG.DY[pv.dir] * pr.maxDist;
      this.area(Math.min(pv.x, ex), Math.min(pv.y, ey), Math.abs(ex - pv.x) + 1, Math.abs(ey - pv.y) + 1, '#e2b33a');
    }
  }

  function circle(ctx, x, y, r, fill, stroke, lw) { S.circle(ctx, x, y, r, fill, stroke, lw); }

  // status -> [glyph, colour]
  const STATUS_BADGE = {
    no_power: ['⚡', '#e0553f'],
    low_power: ['⚡', '#e8c547'],
    no_fuel: ['!', '#e0553f'],
    no_input: ['…', '#e8c547'],
    output_full: ['▲', '#e8c547'],
    no_ore: ['×', '#e0553f'],
    no_recipe: ['?', '#a89a86'],
    waiting_space: ['▲', '#e8c547'],
    no_water: ['~', '#e8c547'],
    no_ammo: ['!', '#e0553f'],
    no_research: ['?', '#a89a86'],
  };
  Renderer.STATUS_BADGE = STATUS_BADGE;

  // ------------------------------------------------------------- map views
  // Paint an overview of the charted world into a canvas (minimap / big map).
  Renderer.prototype.drawMap = function (g, canvas, cx, cy, scale, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const w = g.world, C = FG.CHUNK;
    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = '#0d0c0b';
    ctx.fillRect(0, 0, cw, ch);
    const toM = (x, y) => [(x - cx) * scale + cw / 2, (y - cy) * scale + ch / 2];
    ctx.imageSmoothingEnabled = scale < 4;
    for (let c = 0; c < w.CW * w.CH; c++) {
      const x = (c % w.CW) * C, y = ((c / w.CW) | 0) * C;
      const [sx, sy] = toM(x, y);
      if (sx > cw || sy > ch || sx + C * scale < 0 || sy + C * scale < 0) continue;
      if (!w.charted[c]) continue;
      ctx.drawImage(this.chunkImage(g, c, 1), sx, sy, C * scale + 0.5, C * scale + 0.5);
      if (opts.pollution && w.pollution[c] > 1) {
        ctx.fillStyle = 'rgba(210,40,30,' + Math.min(0.5, 0.05 + Math.log10(w.pollution[c]) * 0.12) + ')';
        ctx.fillRect(sx, sy, C * scale, C * scale);
      }
    }
    // Entities
    for (const e of g.ents.values()) {
      const [sx, sy] = toM(e.x, e.y);
      if (sx > cw || sy > ch || sx < -10 || sy < -10) continue;
      const k = D.protos[e.p].kind;
      ctx.fillStyle = k === 'signal' || k === 'trainstop' ? '#8a8078' : k === 'belt' || k === 'underground' || k === 'splitter' || k === 'loader' ? '#c8a040' : k === 'pole' ? '#7a8a9a' : k === 'pipe' || k === 'pipe_ug' ? '#6a8aa8' : k === 'turret' || k === 'laser' || k === 'wall' ? '#b0b0b0' : '#9ab0c8';
      ctx.fillRect(sx, sy, Math.max(1, e.w * scale), Math.max(1, e.h * scale));
    }
    // Enemies (only in charted chunks)
    ctx.fillStyle = '#e0303a';
    for (const n of g.enemies.nests) {
      if (!w.charted[w.chunkIndexAt(n.x, n.y)]) continue;
      const [sx, sy] = toM(n.x, n.y);
      ctx.fillRect(sx, sy, Math.max(2, 2 * scale), Math.max(2, 2 * scale));
    }
    for (const u of g.enemies.units) {
      if (!w.charted[w.chunkIndexAt(u.x, u.y)]) continue;
      const [sx, sy] = toM(u.x, u.y);
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
    // Track
    if (g.rail.pieces.size) {
      ctx.save();
      ctx.strokeStyle = '#8a8078';
      ctx.lineWidth = Math.max(1.2, scale * 1.4);
      ctx.beginPath();
      for (const pc of g.rail.pieces.values()) {
        const [ax, ay] = toM(pc.ax, pc.ay), [bx, by] = toM(pc.bx, pc.by);
        const m = 10 * scale;
        if ((ax < -m && bx < -m) || (ax > cw + m && bx > cw + m) || (ay < -m && by < -m) || (ay > ch + m && by > ch + m)) continue;
        ctx.moveTo(ax, ay);
        for (let i = 4; i < pc.pts.length - 1 && pc.t !== 'S'; i += 4) { const [x, y] = toM(pc.pts[i][0], pc.pts[i][1]); ctx.lineTo(x, y); }
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Trains
    ctx.fillStyle = '#ff8a3a';
    for (const tr of g.rail.trains) for (let i = 0; i < tr.cars.length; i++) {
      const p = FG.trains.carPose(tr, i);
      const [sx, sy] = toM(p.x, p.y);
      ctx.fillRect(sx - Math.max(1.5, scale), sy - Math.max(1.5, scale), Math.max(3, scale * 2), Math.max(3, scale * 2));
    }
    // Players (you last, on top, in amber)
    ctx.strokeStyle = '#1a1714';
    for (const p of g.players.filter((q) => q !== g.local).concat([g.local || g.player])) {
      const [px, py] = toM(p.x, p.y);
      ctx.fillStyle = p === (g.local || g.player) ? '#f0a830' : p.color || '#58a6d8';
      ctx.beginPath(); ctx.arc(px, py, Math.max(3, scale * 1.5), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (opts.viewRect) {
      const [ax, ay] = toM(opts.viewRect[0], opts.viewRect[1]);
      const [bx, by] = toM(opts.viewRect[2], opts.viewRect[3]);
      ctx.strokeStyle = 'rgba(240,230,210,0.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
    }
  };

  FG.Renderer = Renderer;
})();
