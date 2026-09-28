// Cogworks Frontier — procedural building art. Everything is drawn with canvas
// primitives (no image assets) and cached per prototype and direction.
(function () {
  'use strict';
  const D = FG.data;
  const S = (FG.sprites = {});

  // ------------------------------------------------------------ colour utils
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(h, amt) {
    const [r, g, b] = hexToRgb(h);
    const f = (c) => Math.round(FG.clamp(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt), 0, 255));
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  S.shade = shade;
  S.rgba = function (h, a) { const [r, g, b] = hexToRgb(h); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  S.rr = rr;

  // A bevelled plate: the basic shape of most machines.
  function plate(ctx, x, y, w, h, r, base, opts) {
    opts = opts || {};
    ctx.save();
    if (!opts.noShadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      rr(ctx, x + w * 0.04, y + h * 0.07, w, h, r);
      ctx.fill();
    }
    rr(ctx, x, y, w, h, r);
    const gr = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    gr.addColorStop(0, shade(base, 0.18));
    gr.addColorStop(1, shade(base, -0.18));
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.03);
    ctx.strokeStyle = shade(base, -0.55);
    ctx.stroke();
    // top-left highlight
    ctx.beginPath();
    ctx.moveTo(x + r, y + ctx.lineWidth);
    ctx.lineTo(x + w - r, y + ctx.lineWidth);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.restore();
  }
  S.plate = plate;

  function circle(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  S.circle = circle;

  function rivets(ctx, x, y, w, h, T, color) {
    const r = T * 0.035;
    for (const [px, py] of [[x + T * 0.12, y + T * 0.12], [x + w - T * 0.12, y + T * 0.12], [x + T * 0.12, y + h - T * 0.12], [x + w - T * 0.12, y + h - T * 0.12]]) {
      circle(ctx, px, py, r, color || 'rgba(0,0,0,0.45)');
    }
  }

  function gearShape(ctx, cx, cy, r, teeth, color, hole) {
    ctx.beginPath();
    const n = teeth * 2;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = i % 2 ? r * 0.78 : r;
      const a0 = a - Math.PI / n * 0.45, a1 = a + Math.PI / n * 0.45;
      ctx.lineTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
      ctx.lineTo(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();
    if (hole) circle(ctx, cx, cy, r * 0.3, hole);
  }
  S.gearShape = gearShape;

  // Pipe stub pointing out of a machine at local tile (tx, ty) toward dir.
  function stub(ctx, T, tx, ty, d, color) {
    const cx = (tx + 0.5) * T, cy = (ty + 0.5) * T;
    const ex = cx + FG.DX[d] * T * 0.5, ey = cy + FG.DY[d] * T * 0.5;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = shade(color || '#7c8791', -0.5);
    ctx.lineWidth = T * 0.36;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = color || '#7c8791';
    ctx.lineWidth = T * 0.26;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = shade(color || '#7c8791', -0.3);
    const fx = ex - FG.DX[d] * T * 0.08, fy = ey - FG.DY[d] * T * 0.08;
    ctx.fillRect(fx - (FG.DX[d] ? T * 0.06 : T * 0.22), fy - (FG.DY[d] ? T * 0.06 : T * 0.22), FG.DX[d] ? T * 0.12 : T * 0.44, FG.DY[d] ? T * 0.12 : T * 0.44);
    ctx.restore();
  }

  function hazard(ctx, x, y, w, h, s) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#e8b030'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2a2622';
    for (let k = -h; k < w + h; k += s * 2) {
      ctx.beginPath();
      ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + s, y + h); ctx.lineTo(x + k + s + h, y); ctx.lineTo(x + k + h, y);
      ctx.fill();
    }
    ctx.restore();
  }
  S.hazard = hazard;

  // ------------------------------------------------------------ painters
  // Each painter draws the north-facing footprint w*T x h*T at the origin.
  const P = {};

  P.chest = function (ctx, T, pr) {
    const col = pr.id === 'wooden_chest' ? '#8a5a2e' : pr.id === 'iron_chest' ? '#8a939c' : '#5e7486';
    const m = T * 0.1;
    plate(ctx, m, m + T * 0.04, T - 2 * m, T - 2 * m - T * 0.04, T * 0.08, col);
    ctx.fillStyle = shade(col, -0.35);
    if (pr.id === 'wooden_chest') {
      for (let k = 1; k < 3; k++) ctx.fillRect(m, m + (T - 2 * m) * k / 3, T - 2 * m, T * 0.03);
    } else {
      ctx.fillRect(m, T * 0.42, T - 2 * m, T * 0.08);
      rivets(ctx, m, m, T - 2 * m, T - 2 * m, T);
    }
    ctx.fillStyle = '#d8b050';
    ctx.fillRect(T * 0.44, T * 0.4, T * 0.12, T * 0.14);
  };

  P.tank = function (ctx, T) {
    circle(ctx, T * 1.56, T * 1.62, T * 1.35, 'rgba(0,0,0,0.35)');
    const gr = ctx.createRadialGradient(T * 1.2, T * 1.1, T * 0.2, T * 1.5, T * 1.5, T * 1.4);
    gr.addColorStop(0, '#9aa6ad'); gr.addColorStop(1, '#4e5a62');
    circle(ctx, T * 1.5, T * 1.5, T * 1.35, gr, '#2a3034', T * 0.05);
    circle(ctx, T * 1.5, T * 1.5, T * 0.9, null, 'rgba(0,0,0,0.3)', T * 0.04);
    circle(ctx, T * 1.5, T * 1.5, T * 0.25, '#6a767e', '#2a3034', T * 0.04);
  };

  P.pole = function (ctx, T, pr) {
    if (pr.id === 'big_pole') {
      ctx.strokeStyle = '#5c666e';
      ctx.lineWidth = T * 0.1;
      ctx.strokeRect(T * 0.3, T * 0.3, T * 1.4, T * 1.4);
      ctx.beginPath();
      ctx.moveTo(T * 0.3, T * 0.3); ctx.lineTo(T * 1.7, T * 1.7);
      ctx.moveTo(T * 1.7, T * 0.3); ctx.lineTo(T * 0.3, T * 1.7);
      ctx.stroke();
      plate(ctx, T * 0.7, T * 0.7, T * 0.6, T * 0.6, T * 0.08, '#7a848c');
      return;
    }
    const wood = pr.id === 'small_pole';
    const col = wood ? '#7a4f2a' : '#6a7680';
    circle(ctx, T * 0.55, T * 0.58, T * 0.2, 'rgba(0,0,0,0.35)');
    circle(ctx, T * 0.5, T * 0.5, T * 0.17, col, shade(col, -0.5), T * 0.04);
    ctx.fillStyle = shade(col, -0.15);
    ctx.fillRect(T * 0.18, T * 0.42, T * 0.64, T * 0.12);
    circle(ctx, T * 0.2, T * 0.48, T * 0.06, '#cfd6da');
    circle(ctx, T * 0.8, T * 0.48, T * 0.06, '#cfd6da');
  };

  P.pipe_ug = function (ctx, T) {
    stub(ctx, T, 0, 0, 0, '#7c8791');
    plate(ctx, T * 0.18, T * 0.3, T * 0.64, T * 0.55, T * 0.12, '#6c7780');
    ctx.fillStyle = '#23282c';
    ctx.fillRect(T * 0.3, T * 0.62, T * 0.4, T * 0.14);
  };

  P.offshore = function (ctx, T) {
    stub(ctx, T, 0, 0, 0, '#7c8791');
    plate(ctx, T * 0.14, T * 0.3, T * 0.72, T * 0.66, T * 0.1, '#4f7ea8');
    circle(ctx, T * 0.5, T * 0.64, T * 0.16, '#2a4a66', '#1a2a3a', T * 0.03);
  };

  P.boiler = function (ctx, T) {
    stub(ctx, T, 0, 1, 3); stub(ctx, T, 2, 1, 1); stub(ctx, T, 1, 0, 0);
    plate(ctx, T * 0.1, T * 0.2, T * 2.8, T * 1.7, T * 0.25, '#8a5a3a');
    ctx.fillStyle = '#2a1a12';
    rr(ctx, T * 1.1, T * 1.05, T * 0.8, T * 0.55, T * 0.1); ctx.fill();
    ctx.fillStyle = shade('#8a5a3a', -0.3);
    for (let k = 0; k < 3; k++) ctx.fillRect(T * (0.35 + k * 0.95), T * 0.35, T * 0.35, T * 0.12);
  };

  P.engine = function (ctx, T) {
    stub(ctx, T, 1, 0, 0); stub(ctx, T, 1, 4, 2);
    plate(ctx, T * 0.2, T * 0.3, T * 2.6, T * 4.4, T * 0.3, '#6d7a52');
    ctx.fillStyle = shade('#6d7a52', -0.35);
    ctx.fillRect(T * 0.55, T * 0.8, T * 1.9, T * 1.6);
    circle(ctx, T * 1.5, T * 3.35, T * 0.95, '#3c4336', '#20241c', T * 0.06);
  };

  P.solar = function (ctx, T) {
    plate(ctx, T * 0.06, T * 0.06, T * 2.88, T * 2.88, T * 0.08, '#3a4250');
    const gr = ctx.createLinearGradient(0, 0, T * 3, T * 3);
    gr.addColorStop(0, '#2f4f86'); gr.addColorStop(0.5, '#1f3462'); gr.addColorStop(1, '#2a4a7e');
    ctx.fillStyle = gr;
    ctx.fillRect(T * 0.2, T * 0.2, T * 2.6, T * 2.6);
    ctx.strokeStyle = 'rgba(200,220,255,0.25)';
    ctx.lineWidth = Math.max(1, T * 0.03);
    for (let k = 1; k < 4; k++) {
      ctx.beginPath(); ctx.moveTo(T * 0.2 + (T * 2.6 * k) / 4, T * 0.2); ctx.lineTo(T * 0.2 + (T * 2.6 * k) / 4, T * 2.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(T * 0.2, T * 0.2 + (T * 2.6 * k) / 4); ctx.lineTo(T * 2.8, T * 0.2 + (T * 2.6 * k) / 4); ctx.stroke();
    }
  };

  P.accumulator = function (ctx, T) {
    plate(ctx, T * 0.1, T * 0.1, T * 1.8, T * 1.8, T * 0.12, '#5a6068');
    for (const [x, y] of [[0.6, 0.6], [1.4, 0.6], [0.6, 1.4], [1.4, 1.4]]) {
      circle(ctx, T * x, T * y, T * 0.3, '#8a9aa6', '#2e343a', T * 0.04);
      circle(ctx, T * x, T * y, T * 0.12, '#3a4046');
    }
  };

  P.drill = function (ctx, T, pr) {
    const big = pr.w === 3;
    const col = big ? '#5f7a3c' : '#6a5a48';
    const W = pr.w * T;
    plate(ctx, T * 0.1, T * 0.12, W - T * 0.2, W - T * 0.2, T * 0.2, col);
    // output chute toward the front (north)
    const ox = (pr.out[0] + 0.5) * T;
    ctx.fillStyle = shade(col, -0.4);
    ctx.beginPath();
    ctx.moveTo(ox - T * 0.28, T * 0.3); ctx.lineTo(ox + T * 0.28, T * 0.3); ctx.lineTo(ox + T * 0.16, -T * 0.05); ctx.lineTo(ox - T * 0.16, -T * 0.05);
    ctx.closePath(); ctx.fill();
    circle(ctx, W / 2, W / 2 + T * 0.1, W * 0.3, shade(col, -0.45), shade(col, -0.7), T * 0.05);
    if (!big) {
      ctx.fillStyle = '#2a1a12';
      ctx.fillRect(T * 1.3, T * 1.35, T * 0.45, T * 0.35);
    }
    rivets(ctx, T * 0.1, T * 0.12, W - T * 0.2, W - T * 0.2, T);
  };

  P.pumpjack = function (ctx, T) {
    stub(ctx, T, 1, 0, 0);
    plate(ctx, T * 0.15, T * 0.3, T * 2.7, T * 2.5, T * 0.2, '#6a6048');
    circle(ctx, T * 1.5, T * 1.9, T * 0.55, '#2a2622', '#16140f', T * 0.05);
  };

  P.furnace = function (ctx, T, pr) {
    const W = pr.w * T;
    if (pr.id === 'stone_furnace') {
      const gr = ctx.createRadialGradient(W * 0.4, W * 0.35, W * 0.1, W / 2, W / 2, W * 0.6);
      gr.addColorStop(0, '#a39a8c'); gr.addColorStop(1, '#6a635a');
      circle(ctx, W / 2 + T * 0.05, W / 2 + T * 0.1, W * 0.44, 'rgba(0,0,0,0.35)');
      circle(ctx, W / 2, W / 2, W * 0.44, gr, '#3a362f', T * 0.05);
      ctx.strokeStyle = 'rgba(40,35,30,0.45)';
      ctx.lineWidth = T * 0.04;
      for (let a = 0; a < 6; a++) {
        ctx.beginPath();
        ctx.arc(W / 2, W / 2, W * 0.32, (a / 6) * Math.PI * 2, (a / 6) * Math.PI * 2 + 0.7);
        ctx.stroke();
      }
      ctx.fillStyle = '#1e1714';
      rr(ctx, W * 0.34, W * 0.52, W * 0.32, W * 0.22, T * 0.1); ctx.fill();
      return;
    }
    if (pr.id === 'steel_furnace') {
      plate(ctx, T * 0.1, T * 0.1, W - T * 0.2, W - T * 0.2, T * 0.25, '#5a6470');
      ctx.fillStyle = '#1e1714';
      rr(ctx, W * 0.3, W * 0.48, W * 0.4, W * 0.26, T * 0.1); ctx.fill();
      rivets(ctx, T * 0.1, T * 0.1, W - T * 0.2, W - T * 0.2, T);
      return;
    }
    plate(ctx, T * 0.1, T * 0.1, W - T * 0.2, W - T * 0.2, T * 0.25, '#8a6a58');
    ctx.strokeStyle = '#c8874a';
    ctx.lineWidth = T * 0.1;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath(); ctx.arc(W / 2, W / 2, T * (0.45 + k * 0.28), 0, Math.PI * 2); ctx.stroke();
    }
    circle(ctx, W / 2, W / 2, T * 0.3, '#2a1a12');
  };

  const ASM_COL = { assembler_1: '#6f7e8c', assembler_2: '#4a78a8', assembler_3: '#3a9a8a' };
  P.crafter = function (ctx, T, pr) {
    const W = pr.w * T, H = pr.h * T;
    if (pr.id === 'chem_plant') {
      for (const [x, y, d] of [[0, 2, 2], [2, 2, 2], [0, 0, 0], [2, 0, 0]]) stub(ctx, T, x, y, d, '#7c8791');
      plate(ctx, T * 0.15, T * 0.25, W - T * 0.3, H - T * 0.5, T * 0.3, '#b08a5a');
      for (const [x, y] of [[0.95, 1.1], [2.05, 1.1], [1.5, 2.0]]) {
        circle(ctx, T * x, T * y, T * 0.42, '#e6dcc4', '#5a4a32', T * 0.05);
        circle(ctx, T * x, T * y, T * 0.2, '#8ac0b0');
      }
      return;
    }
    if (pr.id === 'refinery') {
      for (const [x, y, d] of [[1, 4, 2], [3, 4, 2], [0, 0, 0], [2, 0, 0], [4, 0, 0]]) stub(ctx, T, x, y, d, '#7c8791');
      plate(ctx, T * 0.2, T * 0.35, W - T * 0.4, H - T * 0.7, T * 0.3, '#7a6a5a');
      for (const [x, y, r] of [[1.4, 1.6, 0.8], [3.3, 1.5, 0.65], [2.6, 3.3, 0.75]]) {
        circle(ctx, T * x + T * 0.08, T * y + T * 0.12, T * r, 'rgba(0,0,0,0.3)');
        circle(ctx, T * x, T * y, T * r, '#c8b89a', '#4a3a2a', T * 0.06);
        circle(ctx, T * x, T * y, T * r * 0.5, null, 'rgba(0,0,0,0.25)', T * 0.05);
      }
      return;
    }
    const col = ASM_COL[pr.id] || '#6f7e8c';
    if (pr.fb) stub(ctx, T, 1, 0, 0, '#7c8791');
    plate(ctx, T * 0.12, T * 0.12, W - T * 0.24, H - T * 0.24, T * 0.3, col);
    ctx.fillStyle = shade(col, -0.4);
    rr(ctx, T * 0.55, T * 0.55, W - T * 1.1, H - T * 1.1, T * 0.2); ctx.fill();
    rivets(ctx, T * 0.12, T * 0.12, W - T * 0.24, H - T * 0.24, T);
  };

  P.lab = function (ctx, T) {
    plate(ctx, T * 0.12, T * 0.12, T * 2.76, T * 2.76, T * 0.4, '#5a6470');
    const gr = ctx.createRadialGradient(T * 1.3, T * 1.2, T * 0.1, T * 1.5, T * 1.5, T * 1.1);
    gr.addColorStop(0, '#bfe6ff'); gr.addColorStop(0.6, '#3a86c8'); gr.addColorStop(1, '#1f3e66');
    circle(ctx, T * 1.5, T * 1.5, T * 0.95, gr, '#1a2a3a', T * 0.06);
  };

  P.beacon = function (ctx, T) {
    plate(ctx, T * 0.2, T * 0.2, T * 2.6, T * 2.6, T * 0.3, '#4a4a60');
    circle(ctx, T * 1.5, T * 1.5, T * 0.85, '#6a6a8a', '#2a2a3a', T * 0.06);
    circle(ctx, T * 1.5, T * 1.5, T * 0.35, '#b0a8e8');
  };

  P.uplink = function (ctx, T) {
    const W = 7 * T;
    plate(ctx, T * 0.1, T * 0.1, W - T * 0.2, W - T * 0.2, T * 0.4, '#5a5f66');
    hazard(ctx, T * 0.5, T * 0.5, W - T, T * 0.4, T * 0.3);
    hazard(ctx, T * 0.5, W - T * 0.9, W - T, T * 0.4, T * 0.3);
    circle(ctx, W / 2, W / 2, T * 2.2, '#34383e', '#1e2226', T * 0.1);
    circle(ctx, W / 2, W / 2, T * 1.6, '#23262a');
    ctx.strokeStyle = '#8a939c'; ctx.lineWidth = T * 0.15;
    for (let a = 0; a < 4; a++) {
      const ang = a * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(ang) * T * 1.7, W / 2 + Math.sin(ang) * T * 1.7);
      ctx.lineTo(W / 2 + Math.cos(ang) * T * 3, W / 2 + Math.sin(ang) * T * 3);
      ctx.stroke();
    }
  };

  P.turret = function (ctx, T) {
    plate(ctx, T * 0.15, T * 0.15, T * 1.7, T * 1.7, T * 0.3, '#6a6048');
    circle(ctx, T, T, T * 0.62, '#4a4436', '#2a261e', T * 0.05);
  };
  P.laser = function (ctx, T) {
    plate(ctx, T * 0.15, T * 0.15, T * 1.7, T * 1.7, T * 0.3, '#5a5a66');
    circle(ctx, T, T, T * 0.62, '#3a3a46', '#1e1e26', T * 0.05);
  };
  P.wall = function (ctx, T) {
    plate(ctx, T * 0.04, T * 0.04, T * 0.92, T * 0.92, T * 0.08, '#8a8378', { noShadow: false });
    ctx.strokeStyle = 'rgba(40,35,30,0.4)';
    ctx.lineWidth = T * 0.04;
    ctx.beginPath(); ctx.moveTo(T * 0.04, T * 0.5); ctx.lineTo(T * 0.96, T * 0.5);
    ctx.moveTo(T * 0.5, T * 0.04); ctx.lineTo(T * 0.5, T * 0.5); ctx.moveTo(T * 0.3, T * 0.5); ctx.lineTo(T * 0.3, T * 0.96);
    ctx.stroke();
  };

  // Inserter base only (the arm is dynamic).
  P.inserter = function (ctx, T, pr) {
    circle(ctx, T * 0.53, T * 0.56, T * 0.26, 'rgba(0,0,0,0.3)');
    plate(ctx, T * 0.26, T * 0.26, T * 0.48, T * 0.48, T * 0.1, '#5a5f66', { noShadow: true });
    circle(ctx, T * 0.5, T * 0.5, T * 0.13, pr.tint);
  };

  // --------------------------------------------------------------- belts
  const BELT_COL = { 1: '#e2b33a', 2: '#e04a3a', 3: '#3aa0e0' };
  S.beltColor = (tier) => BELT_COL[tier];

  // Belt tile: shape 0 straight, 1 curve from left, 2 curve from right. frame 0..7.
  function paintBelt(ctx, T, tier, shape, frame) {
    const col = BELT_COL[tier];
    ctx.save();
    if (shape === 0) {
      ctx.fillStyle = '#34302c';
      ctx.fillRect(T * 0.06, 0, T * 0.88, T);
      ctx.fillStyle = '#23201d';
      ctx.fillRect(T * 0.12, 0, T * 0.76, T);
      ctx.fillStyle = shade(col, -0.35);
      ctx.fillRect(T * 0.06, 0, T * 0.06, T);
      ctx.fillRect(T * 0.88, 0, T * 0.06, T);
      ctx.strokeStyle = S.rgba(col, 0.5);
      ctx.lineWidth = Math.max(1, T * 0.05);
      const off = (frame / 8) * T * 0.25;
      ctx.beginPath();
      for (let k = -1; k < 5; k++) {
        const y = T - (k * T * 0.25 + off);
        ctx.moveTo(T * 0.2, y + T * 0.08); ctx.lineTo(T * 0.5, y - T * 0.04); ctx.lineTo(T * 0.8, y + T * 0.08);
      }
      ctx.stroke();
    } else {
      // Curve: items enter from the left (shape 1) or right (shape 2) edge and exit north.
      const fromLeft = shape === 1;
      const px = fromLeft ? 0 : T, py = 0;
      const a0 = fromLeft ? Math.PI / 2 : Math.PI / 2, a1 = fromLeft ? 0 : Math.PI;
      ctx.beginPath();
      ctx.arc(px, py, T * 0.94, fromLeft ? 0 : Math.PI / 2, fromLeft ? Math.PI / 2 : Math.PI);
      ctx.arc(px, py, T * 0.06, fromLeft ? Math.PI / 2 : Math.PI, fromLeft ? 0 : Math.PI / 2, true);
      ctx.closePath();
      ctx.fillStyle = '#34302c'; ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, T * 0.88, fromLeft ? 0 : Math.PI / 2, fromLeft ? Math.PI / 2 : Math.PI);
      ctx.arc(px, py, T * 0.12, fromLeft ? Math.PI / 2 : Math.PI, fromLeft ? 0 : Math.PI / 2, true);
      ctx.closePath();
      ctx.fillStyle = '#23201d'; ctx.fill();
      ctx.strokeStyle = S.rgba(col, 0.5);
      ctx.lineWidth = Math.max(1, T * 0.05);
      const len = (Math.PI / 2) * T * 0.5;
      const off = (frame / 8) * T * 0.25;
      ctx.beginPath();
      for (let k = -1; k < 5; k++) {
        const s = k * T * 0.25 + off;
        const f = s / len;
        if (f < 0 || f > 1) continue;
        // progress along arc from entry (side) to exit (top)
        const ang = fromLeft ? a0 - f * (a0 - a1) : a0 + f * (a1 - a0);
        const dirA = fromLeft ? ang - Math.PI / 2 : ang + Math.PI / 2;
        const mx = px + Math.cos(ang) * T * 0.5, my = py + Math.sin(ang) * T * 0.5;
        const ix = px + Math.cos(ang) * T * 0.2, iy = py + Math.sin(ang) * T * 0.2;
        const ox = px + Math.cos(ang) * T * 0.8, oy = py + Math.sin(ang) * T * 0.8;
        const bx = -Math.cos(dirA) * T * 0.1, by = -Math.sin(dirA) * T * 0.1;
        ctx.moveTo(ix + bx, iy + by); ctx.lineTo(mx, my); ctx.lineTo(ox + bx, oy + by);
      }
      ctx.stroke();
      ctx.fillStyle = shade(col, -0.35);
      ctx.beginPath(); ctx.arc(px, py, T * 0.94, fromLeft ? 0 : Math.PI / 2, fromLeft ? Math.PI / 2 : Math.PI); ctx.arc(px, py, T * 0.88, fromLeft ? Math.PI / 2 : Math.PI, fromLeft ? 0 : Math.PI / 2, true); ctx.fill();
    }
    ctx.restore();
  }

  function paintUndergroundHood(ctx, T, tier, isIn) {
    const col = BELT_COL[tier];
    // Hood covers the far half (entrance) or near half (exit) of the tile, north-facing.
    const y = isIn ? 0 : T * 0.5;
    plate(ctx, T * 0.02, y - T * 0.04, T * 0.96, T * 0.58, T * 0.12, col, { noShadow: true });
    ctx.fillStyle = '#1a1714';
    if (isIn) ctx.fillRect(T * 0.14, T * 0.44, T * 0.72, T * 0.08);
    else ctx.fillRect(T * 0.14, T * 0.48, T * 0.72, T * 0.08);
    ctx.fillStyle = shade(col, -0.45);
    ctx.fillRect(T * 0.3, y + T * 0.12, T * 0.4, T * 0.07);
  }

  // Loader hood over one tile of a north-facing 1x2 loader (items travel north). Loading, the
  // hood is the top tile (the container is above it); unloading, it is the bottom tile. Its
  // mouth always opens onto the belt end, where the two tiles meet (y = T).
  function paintLoaderHood(ctx, T, tier, isIn) {
    const col = BELT_COL[tier];
    const y0 = isIn ? 0 : T;
    ctx.save();
    // housing, overhanging the belt end a little so items slide under it
    const top = isIn ? y0 + T * 0.02 : y0 - T * 0.1, h = T * 1.06;
    plate(ctx, T * 0.02, top, T * 0.96, h, T * 0.14, '#57534c');
    // tier-coloured side cheeks
    ctx.fillStyle = col;
    ctx.fillRect(T * 0.07, top + T * 0.12, T * 0.1, h - T * 0.24);
    ctx.fillRect(T * 0.83, top + T * 0.12, T * 0.1, h - T * 0.24);
    ctx.fillStyle = shade(col, -0.45);
    ctx.fillRect(T * 0.07, top + T * 0.12, T * 0.03, h - T * 0.24);
    ctx.fillRect(T * 0.9, top + T * 0.12, T * 0.03, h - T * 0.24);
    // mouth onto the belt end
    ctx.fillStyle = '#16130f';
    const my = isIn ? T * 0.9 : T - T * 0.06;
    rr(ctx, T * 0.2, my, T * 0.6, T * 0.16, T * 0.04); ctx.fill();
    // lip where it meets the container
    ctx.fillStyle = shade('#57534c', -0.35);
    ctx.fillRect(T * 0.16, isIn ? y0 + T * 0.05 : y0 + T * 0.87, T * 0.68, T * 0.07);
    // chevrons: the way items travel
    ctx.strokeStyle = col;
    ctx.lineWidth = T * 0.09;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const cy = y0 + T * 0.5;
    for (const k of [-0.13, 0.13]) {
      ctx.beginPath();
      ctx.moveTo(T * 0.32, cy + T * (k + 0.1)); ctx.lineTo(T * 0.5, cy + T * (k - 0.08)); ctx.lineTo(T * 0.68, cy + T * (k + 0.1));
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintSplitterBody(ctx, T, tier) {
    const col = BELT_COL[tier];
    plate(ctx, T * 0.02, T * 0.32, T * 1.96, T * 0.36, T * 0.1, col, { noShadow: true });
    ctx.fillStyle = shade(col, -0.45);
    ctx.fillRect(T * 0.2, T * 0.46, T * 1.6, T * 0.08);
    circle(ctx, T, T * 0.5, T * 0.12, '#2a2622');
  }

  // --------------------------------------------------------------- rails
  // Track is drawn in world units (ctx scaled so 1 unit = 1 tile) from each piece's
  // centre line: ballast, sleepers, then two steel rails.
  const GAUGE = 0.6;
  function trackArt(pc) {
    if (pc.art) return pc.art;
    const n = pc.t === 'S' ? 1 : pc.pts.length - 1;
    const left = [], right = [];
    const p = [0, 0, 0];
    for (let i = 0; i <= n; i++) {
      FG.rails.posAt(pc, (pc.len * i) / n, true, p);
      const nx = -Math.sin(p[2]), ny = Math.cos(p[2]);
      left.push([p[0] + nx * GAUGE, p[1] + ny * GAUGE]);
      right.push([p[0] - nx * GAUGE, p[1] - ny * GAUGE]);
    }
    const ties = [];
    const k = Math.max(1, Math.round(pc.len / 0.5));
    for (let i = 0; i < k; i++) {
      FG.rails.posAt(pc, ((i + 0.5) * pc.len) / k, true, p);
      const nx = -Math.sin(p[2]) * 0.82, ny = Math.cos(p[2]) * 0.82;
      ties.push([p[0] + nx, p[1] + ny, p[0] - nx, p[1] - ny]);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pc.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    pc.art = { left, right, ties, box: [x0 - 1.2, y0 - 1.2, x1 + 1.2, y1 + 1.2] };
    return pc.art;
  }
  S.trackBox = (pc) => trackArt(pc).box;
  const polyline = (ctx, pts) => { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
  const centre = (ctx, pc) => { ctx.moveTo(pc.pts[0][0], pc.pts[0][1]); for (let i = 1; i < pc.pts.length; i++) ctx.lineTo(pc.pts[i][0], pc.pts[i][1]); };

  // Draw pieces. ctx must map world units to pixels; px is pixels per tile.
  // opts: { tint, alpha, ends: [[x, y, heading], ...] buffer stops }
  S.drawTrack = function (ctx, pieces, px, opts) {
    opts = opts || {};
    if (!pieces.length) return;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    const stroke = (w, col, fn) => {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath();
      for (const pc of pieces) fn(pc);
      ctx.stroke();
    };
    stroke(1.8, '#5f5850', (pc) => centre(ctx, pc));
    stroke(1.4, '#7a7168', (pc) => centre(ctx, pc));
    const fine = px >= 12;
    if (fine) stroke(0.2, '#4a3524', (pc) => { for (const t of trackArt(pc).ties) { ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); } });
    const rails = (pc) => { const a = trackArt(pc); polyline(ctx, a.left); polyline(ctx, a.right); };
    stroke(fine ? 0.2 : Math.max(0.2, 1.5 / px), '#2c2f33', rails);
    if (fine) stroke(0.1, '#a7b0b8', rails);
    if (opts.tint) {
      ctx.globalAlpha = 1;
      stroke(0.35, opts.tint, (pc) => centre(ctx, pc));
    }
    if (opts.ends) for (const [x, y, h] of opts.ends) {
      const u = FG.rails.unit(h), nx = -u[1], ny = u[0];
      const cx = x - u[0] * 0.25, cy = y - u[1] * 0.25;
      ctx.strokeStyle = '#b8342a'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(cx + nx * 0.75, cy + ny * 0.75); ctx.lineTo(cx - nx * 0.75, cy - ny * 0.75); ctx.stroke();
      ctx.strokeStyle = '#f0e0c0'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(cx + nx * 0.12, cy + ny * 0.12); ctx.lineTo(cx - nx * 0.12, cy - ny * 0.12); ctx.stroke();
    }
    ctx.restore();
  };

  // Signal post on a 1x1 tile at (x, y) px, guarding travel heading rd.
  S.paintSignal = function (ctx, T, role, rd, lamp) {
    ctx.save();
    ctx.translate(T / 2, T / 2);
    ctx.rotate((rd * Math.PI) / 4);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rr(ctx, -T * 0.16, -T * 0.26, T * 0.36, T * 0.6, T * 0.08); ctx.fill();
    ctx.fillStyle = '#2c2f33';
    rr(ctx, -T * 0.2, -T * 0.3, T * 0.4, T * (role === 'chain' ? 0.62 : 0.46), T * 0.08); ctx.fill();
    circle(ctx, 0, -T * 0.16, T * 0.12, lamp || '#7ac05a');
    if (role === 'chain') circle(ctx, 0, T * 0.14, T * 0.1, '#58a6d8');
    ctx.restore();
  };
  // Train stop beside the track: a platform edge along the rails and an upright sign.
  S.paintStop = function (ctx, T, rd) {
    ctx.save();
    ctx.translate(T / 2, T / 2);
    ctx.save();
    ctx.rotate((rd * Math.PI) / 4);
    ctx.fillStyle = '#6a655c';
    ctx.fillRect(-T * 0.5, -T * 0.45, T * 0.3, T * 0.9);
    hazard(ctx, -T * 0.5, -T * 0.45, T * 0.12, T * 0.9, T * 0.08);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(T * 0.02, -T * 0.16, T * 0.12, T * 0.56);
    ctx.fillStyle = '#3a3e44';
    ctx.fillRect(-T * 0.05, -T * 0.2, T * 0.1, T * 0.58);
    rr(ctx, -T * 0.34, -T * 0.46, T * 0.68, T * 0.34, T * 0.06);
    ctx.fillStyle = '#e08a2a'; ctx.fill();
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(-T * 0.22, -T * 0.34, T * 0.44, T * 0.09);
    ctx.restore();
  };

  // Rail car body, drawn along +x with the car's front at +x. len/wid in pixels.
  S.paintCar = function (ctx, type, len, wid, cargoIcon) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    rr(ctx, -len / 2 + wid * 0.12, -wid / 2 + wid * 0.2, len, wid, wid * 0.18); ctx.fill();
    if (type === 'loco') {
      const body = '#c4532e';
      plate(ctx, -len / 2, -wid / 2, len, wid, wid * 0.18, body, { noShadow: true });
      ctx.fillStyle = shade(body, -0.35);
      ctx.fillRect(-len * 0.36, -wid * 0.3, len * 0.5, wid * 0.6);
      ctx.fillStyle = '#e8c24a';
      ctx.fillRect(-len * 0.36, -wid * 0.06, len * 0.5, wid * 0.12);
      // cab at the front
      ctx.fillStyle = '#2b2f36';
      rr(ctx, len * 0.18, -wid * 0.38, len * 0.24, wid * 0.76, wid * 0.1); ctx.fill();
      ctx.fillStyle = '#8fc4e8';
      ctx.fillRect(len * 0.34, -wid * 0.3, len * 0.05, wid * 0.6);
      circle(ctx, len * 0.48, 0, wid * 0.1, '#fff3c0');
    } else {
      const body = '#76644f';
      plate(ctx, -len / 2, -wid / 2, len, wid, wid * 0.12, body, { noShadow: true });
      ctx.strokeStyle = shade(body, -0.4); ctx.lineWidth = Math.max(1, wid * 0.05);
      for (let k = 1; k < 6; k++) { const x = -len / 2 + (len * k) / 6; ctx.beginPath(); ctx.moveTo(x, -wid / 2 + 2); ctx.lineTo(x, wid / 2 - 2); ctx.stroke(); }
      ctx.fillStyle = shade(body, -0.25);
      ctx.fillRect(-len * 0.44, -wid * 0.36, len * 0.88, wid * 0.72);
      if (cargoIcon) {
        const s = wid * 0.9;
        ctx.drawImage(cargoIcon, -s / 2, -s / 2, s, s);
      }
    }
    ctx.restore();
  };

  // --------------------------------------------------------------- caches
  const cache = new Map();
  S.T = 64; // cached sprite resolution per tile

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  S.makeCanvas = makeCanvas;

  // Rotate painter output: paint north then rotate into dir.
  function rotated(w, h, dir, T, paint) {
    const [fw, fh] = dir & 1 ? [h, w] : [w, h];
    const pad = T; // allow stubs to poke outside the footprint
    const c = makeCanvas(fw * T + pad * 2, fh * T + pad * 2);
    const ctx = c.getContext('2d');
    ctx.translate(pad + (fw * T) / 2, pad + (fh * T) / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.translate((-w * T) / 2, (-h * T) / 2);
    paint(ctx);
    return { canvas: c, pad };
  }

  S.entity = function (protoId, dir) {
    const key = protoId + ':' + dir;
    let s = cache.get(key);
    if (s) return s;
    const pr = D.protos[protoId];
    const painter = P[pr.id] || P[pr.kind];
    s = rotated(pr.w, pr.h, pr.rotatable ? dir : 0, S.T, (ctx) => { if (painter) painter(ctx, S.T, pr); });
    cache.set(key, s);
    return s;
  };

  S.belt = function (tier, shape, dir, frame) {
    const key = 'belt' + tier + ':' + shape + ':' + dir + ':' + frame;
    let s = cache.get(key);
    if (s) return s;
    s = rotated(1, 1, dir, S.T, (ctx) => paintBelt(ctx, S.T, tier, shape, frame));
    cache.set(key, s);
    return s;
  };

  S.hood = function (tier, isIn, dir) {
    const key = 'hood' + tier + ':' + isIn + ':' + dir;
    let s = cache.get(key);
    if (s) return s;
    s = rotated(1, 1, dir, S.T, (ctx) => paintUndergroundHood(ctx, S.T, tier, isIn));
    cache.set(key, s);
    return s;
  };

  S.splitter = function (tier, dir) {
    const key = 'split' + tier + ':' + dir;
    let s = cache.get(key);
    if (s) return s;
    s = rotated(2, 1, dir, S.T, (ctx) => paintSplitterBody(ctx, S.T, tier));
    cache.set(key, s);
    return s;
  };

  S.loader = function (tier, isIn, dir) {
    const key = 'loader' + tier + ':' + isIn + ':' + dir;
    let s = cache.get(key);
    if (s) return s;
    s = rotated(1, 2, dir, S.T, (ctx) => paintLoaderHood(ctx, S.T, tier, isIn));
    cache.set(key, s);
    return s;
  };

  // Static preview used for item icons and build ghosts of belt-like things.
  S.paintPreview = function (ctx, protoId, T) {
    const pr = D.protos[protoId];
    if (pr.kind === 'belt') { paintBelt(ctx, T, pr.tier, 0, 0); return; }
    if (pr.kind === 'underground') { paintBelt(ctx, T, pr.tier, 0, 0); paintUndergroundHood(ctx, T, pr.tier, true); return; }
    if (pr.kind === 'loader') {
      ctx.save(); ctx.translate(0, T); paintBelt(ctx, T, pr.tier, 0, 0); ctx.restore();
      paintLoaderHood(ctx, T, pr.tier, true);
      return;
    }
    if (pr.kind === 'splitter') {
      paintBelt(ctx, T, pr.tier, 0, 0);
      ctx.save(); ctx.translate(T, 0); paintBelt(ctx, T, pr.tier, 0, 0); ctx.restore();
      paintSplitterBody(ctx, T, pr.tier);
      return;
    }
    if (pr.kind === 'signal') { S.paintSignal(ctx, T, pr.role, 0, '#7ac05a'); return; }
    if (pr.kind === 'trainstop') { S.paintStop(ctx, T, 0); return; }
    if (pr.kind === 'pipe') {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3a4046'; ctx.lineWidth = T * 0.4;
      ctx.beginPath(); ctx.moveTo(0, T * 0.5); ctx.lineTo(T, T * 0.5); ctx.stroke();
      ctx.strokeStyle = '#8a959f'; ctx.lineWidth = T * 0.28;
      ctx.beginPath(); ctx.moveTo(0, T * 0.5); ctx.lineTo(T, T * 0.5); ctx.stroke();
      ctx.restore();
      return;
    }
    if (pr.kind === 'inserter') {
      P.inserter(ctx, T, pr);
      ctx.strokeStyle = pr.tint; ctx.lineWidth = T * 0.1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(T * 0.5, T * 0.5); ctx.lineTo(T * 0.5, T * 0.08); ctx.stroke();
      return;
    }
    if (pr.kind === 'turret' || pr.kind === 'laser') {
      const painter = P[pr.kind];
      painter(ctx, T, pr);
      S.paintTurretHead(ctx, pr, T, T, -Math.PI / 2, T);
      return;
    }
    const painter = P[pr.id] || P[pr.kind];
    if (painter) painter(ctx, T, pr);
  };

  S.paintTurretHead = function (ctx, pr, cx, cy, angle, T) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    if (pr.kind === 'laser') {
      ctx.fillStyle = '#2a2a33';
      ctx.fillRect(0, -T * 0.12, T * 0.85, T * 0.24);
      ctx.fillStyle = '#d83a4a';
      ctx.fillRect(T * 0.7, -T * 0.06, T * 0.2, T * 0.12);
      circle(ctx, 0, 0, T * 0.42, '#6a6a7a', '#2a2a33', T * 0.05);
      circle(ctx, 0, 0, T * 0.15, '#d83a4a');
    } else {
      ctx.fillStyle = '#26221a';
      ctx.fillRect(0, -T * 0.16, T * 0.95, T * 0.1);
      ctx.fillRect(0, T * 0.06, T * 0.95, T * 0.1);
      plate(ctx, -T * 0.4, -T * 0.34, T * 0.8, T * 0.68, T * 0.14, '#8a7a52', { noShadow: true });
    }
    ctx.restore();
  };
})();
