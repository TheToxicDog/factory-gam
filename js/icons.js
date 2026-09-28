// Cogworks Frontier — item and fluid icons, painted once into small canvases.
(function () {
  'use strict';
  const D = FG.data;
  const S = FG.sprites;
  const I = (FG.icons = {});
  const SIZE = 64;
  const shade = S.shade, circle = S.circle, rr = S.rr;

  function ore(ctx, s, base, speck) {
    const pts = [[0.34, 0.6, 0.2], [0.62, 0.62, 0.22], [0.48, 0.38, 0.2], [0.72, 0.4, 0.14], [0.28, 0.36, 0.13]];
    for (const [x, y, r] of pts) {
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + x * 9;
        const rad = s * r * (0.8 + 0.25 * Math.sin(k * 2.3 + y * 7));
        ctx.lineTo(s * x + Math.cos(a) * rad, s * y + Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.1 + x * 0.3);
      ctx.fill();
      ctx.strokeStyle = shade(base, -0.6);
      ctx.lineWidth = s * 0.025;
      ctx.stroke();
      if (speck) {
        circle(ctx, s * (x - 0.04), s * (y - 0.03), s * 0.035, speck);
        circle(ctx, s * (x + 0.05), s * (y + 0.04), s * 0.025, speck);
      }
    }
  }

  function plateIcon(ctx, s, base) {
    for (let k = 2; k >= 0; k--) {
      const y = s * (0.3 + k * 0.12);
      ctx.beginPath();
      ctx.moveTo(s * 0.18, y + s * 0.12); ctx.lineTo(s * 0.5, y); ctx.lineTo(s * 0.86, y + s * 0.12); ctx.lineTo(s * 0.54, y + s * 0.26);
      ctx.closePath();
      ctx.fillStyle = shade(base, 0.15 - k * 0.12);
      ctx.fill();
      ctx.strokeStyle = shade(base, -0.55);
      ctx.lineWidth = s * 0.025;
      ctx.stroke();
    }
  }

  function board(ctx, s, base, trace, chip) {
    rr(ctx, s * 0.14, s * 0.2, s * 0.72, s * 0.6, s * 0.06);
    ctx.fillStyle = base; ctx.fill();
    ctx.strokeStyle = shade(base, -0.5); ctx.lineWidth = s * 0.03; ctx.stroke();
    ctx.strokeStyle = trace; ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.35); ctx.lineTo(s * 0.4, s * 0.35); ctx.lineTo(s * 0.48, s * 0.45);
    ctx.moveTo(s * 0.2, s * 0.65); ctx.lineTo(s * 0.42, s * 0.65);
    ctx.moveTo(s * 0.8, s * 0.3); ctx.lineTo(s * 0.64, s * 0.3);
    ctx.moveTo(s * 0.8, s * 0.7); ctx.lineTo(s * 0.62, s * 0.58);
    ctx.stroke();
    ctx.fillStyle = chip || '#1e2226';
    ctx.fillRect(s * 0.42, s * 0.38, s * 0.24, s * 0.24);
    for (const [x, y] of [[0.2, 0.35], [0.2, 0.65], [0.8, 0.3], [0.8, 0.7]]) circle(ctx, s * x, s * y, s * 0.035, '#e0c060');
  }

  function flask(ctx, s, color) {
    ctx.beginPath();
    ctx.moveTo(s * 0.4, s * 0.14); ctx.lineTo(s * 0.6, s * 0.14); ctx.lineTo(s * 0.6, s * 0.36);
    ctx.lineTo(s * 0.8, s * 0.78); ctx.quadraticCurveTo(s * 0.82, s * 0.88, s * 0.7, s * 0.88);
    ctx.lineTo(s * 0.3, s * 0.88); ctx.quadraticCurveTo(s * 0.18, s * 0.88, s * 0.2, s * 0.78);
    ctx.lineTo(s * 0.4, s * 0.36); ctx.closePath();
    ctx.fillStyle = 'rgba(220,235,245,0.35)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = color; ctx.fillRect(0, s * 0.5, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(s * 0.3, s * 0.52, s * 0.12, s * 0.3);
    ctx.restore();
    ctx.strokeStyle = '#1e2226'; ctx.lineWidth = s * 0.035; ctx.stroke();
    ctx.fillStyle = '#8a6a4a'; ctx.fillRect(s * 0.37, s * 0.08, s * 0.26, s * 0.08);
  }

  function chip(ctx, s, color, symbol) {
    rr(ctx, s * 0.16, s * 0.16, s * 0.68, s * 0.68, s * 0.1);
    ctx.fillStyle = '#2a2e34'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.05; ctx.stroke();
    ctx.fillStyle = color;
    for (let k = 0; k < 4; k++) {
      ctx.fillRect(s * (0.26 + k * 0.14), s * 0.06, s * 0.05, s * 0.1);
      ctx.fillRect(s * (0.26 + k * 0.14), s * 0.84, s * 0.05, s * 0.1);
    }
    ctx.font = 'bold ' + Math.round(s * 0.36) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(symbol, s * 0.5, s * 0.52);
  }

  function magazine(ctx, s, body, tip) {
    rr(ctx, s * 0.3, s * 0.3, s * 0.4, s * 0.56, s * 0.05);
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = shade(body, -0.6); ctx.lineWidth = s * 0.03; ctx.stroke();
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = tip;
      rr(ctx, s * (0.33 + k * 0.12), s * 0.12, s * 0.09, s * 0.22, s * 0.04); ctx.fill();
    }
  }

  function gun(ctx, s, long) {
    ctx.fillStyle = '#3a3e44';
    ctx.fillRect(s * 0.12, s * 0.38, s * (long ? 0.8 : 0.6), s * 0.14);
    ctx.fillStyle = '#5a4a3a';
    ctx.beginPath();
    ctx.moveTo(s * 0.18, s * 0.5); ctx.lineTo(s * 0.34, s * 0.5); ctx.lineTo(s * 0.3, s * 0.82); ctx.lineTo(s * 0.14, s * 0.82);
    ctx.closePath(); ctx.fill();
    if (long) { ctx.fillStyle = '#3a3e44'; ctx.fillRect(s * 0.44, s * 0.5, s * 0.1, s * 0.22); }
  }

  const PAINT = {
    wood: (c, s) => {
      for (const [y, r] of [[0.62, 0.16], [0.42, 0.15]]) {
        c.fillStyle = '#8a5a2e'; rr(c, s * 0.14, s * y - s * r, s * 0.66, s * r * 2, s * r); c.fill();
        c.strokeStyle = '#4a2e14'; c.lineWidth = s * 0.03; c.stroke();
        circle(c, s * 0.78, s * y, s * r * 0.95, '#d8b07a', '#4a2e14', s * 0.03);
        circle(c, s * 0.78, s * y, s * r * 0.4, null, '#a07a4a', s * 0.02);
      }
    },
    coal: (c, s) => ore(c, s, '#34322f', '#5a5752'),
    stone: (c, s) => ore(c, s, '#a09888'),
    iron_ore: (c, s) => ore(c, s, '#6a7c8c', '#b8cad8'),
    copper_ore: (c, s) => ore(c, s, '#a8643a', '#48c8a8'),
    iron_plate: (c, s) => plateIcon(c, s, '#a8b2bc'),
    copper_plate: (c, s) => plateIcon(c, s, '#d0844a'),
    steel_plate: (c, s) => plateIcon(c, s, '#7a92a6'),
    plastic: (c, s) => {
      for (let k = 0; k < 3; k++) { c.fillStyle = k % 2 ? '#e8e8ec' : '#cfd2da'; rr(c, s * 0.16, s * (0.26 + k * 0.17), s * 0.68, s * 0.14, s * 0.04); c.fill(); c.strokeStyle = '#6a6e78'; c.lineWidth = s * 0.02; c.stroke(); }
    },
    stone_brick: (c, s) => {
      for (const [x, y] of [[0.14, 0.52], [0.5, 0.52], [0.32, 0.3]]) { c.fillStyle = '#b08a6a'; rr(c, s * x, s * y, s * 0.34, s * 0.2, s * 0.03); c.fill(); c.strokeStyle = '#5a4430'; c.lineWidth = s * 0.03; c.stroke(); }
    },
    sulfur: (c, s) => ore(c, s, '#e0d040'),
    solid_fuel: (c, s) => { c.fillStyle = '#7a8a3a'; rr(c, s * 0.22, s * 0.22, s * 0.56, s * 0.56, s * 0.08); c.fill(); c.strokeStyle = '#3a4418'; c.lineWidth = s * 0.03; c.stroke(); c.fillStyle = '#c8d86a'; c.fillRect(s * 0.3, s * 0.3, s * 0.2, s * 0.08); },
    rocket_fuel: (c, s) => { c.fillStyle = '#c8402a'; rr(c, s * 0.3, s * 0.12, s * 0.4, s * 0.76, s * 0.12); c.fill(); c.strokeStyle = '#5a1a10'; c.lineWidth = s * 0.03; c.stroke(); c.fillStyle = '#f0c040'; c.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.1); },
    iron_gear: (c, s) => S.gearShape(c, s * 0.5, s * 0.5, s * 0.36, 9, '#9aa4ae', '#3a3e44'),
    copper_wire: (c, s) => {
      c.strokeStyle = '#d0844a'; c.lineWidth = s * 0.06;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(s * (0.34 + k * 0.1), s * 0.5, s * 0.1, s * 0.28, 0, 0, Math.PI * 2); c.stroke(); }
    },
    circuit: (c, s) => board(c, s, '#3a8a3a', '#b8e090'),
    advanced_circuit: (c, s) => board(c, s, '#a8303a', '#f0a0a0'),
    processing_unit: (c, s) => board(c, s, '#2a4ab0', '#a0c0f8', '#101830'),
    engine_unit: (c, s) => {
      S.plate(c, s * 0.18, s * 0.26, s * 0.64, s * 0.5, s * 0.08, '#7a7060', { noShadow: true });
      S.gearShape(c, s * 0.5, s * 0.5, s * 0.18, 8, '#b0b8c0', '#3a3e44');
      c.fillStyle = '#4a4a4a'; c.fillRect(s * 0.1, s * 0.44, s * 0.1, s * 0.12); c.fillRect(s * 0.8, s * 0.44, s * 0.1, s * 0.12);
    },
    electric_motor: (c, s) => {
      S.plate(c, s * 0.18, s * 0.26, s * 0.64, s * 0.5, s * 0.08, '#3a6a9a', { noShadow: true });
      c.strokeStyle = '#d0844a'; c.lineWidth = s * 0.05;
      for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(s * (0.28 + k * 0.13), s * 0.3); c.lineTo(s * (0.28 + k * 0.13), s * 0.72); c.stroke(); }
    },
    battery: (c, s) => { c.fillStyle = '#4a6a7a'; rr(c, s * 0.3, s * 0.2, s * 0.4, s * 0.64, s * 0.06); c.fill(); c.strokeStyle = '#1e2a30'; c.lineWidth = s * 0.03; c.stroke(); c.fillStyle = '#c0c8d0'; c.fillRect(s * 0.42, s * 0.12, s * 0.16, s * 0.08); c.fillStyle = '#e0d040'; c.fillRect(s * 0.36, s * 0.46, s * 0.28, s * 0.08); },
    low_density: (c, s) => {
      c.strokeStyle = '#c8a878'; c.lineWidth = s * 0.06;
      c.strokeRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
      c.beginPath(); c.moveTo(s * 0.2, s * 0.2); c.lineTo(s * 0.8, s * 0.8); c.moveTo(s * 0.8, s * 0.2); c.lineTo(s * 0.2, s * 0.8); c.stroke();
    },
    guidance_unit: (c, s) => { board(c, s, '#2a2e34', '#6ae0c0', '#0e3a30'); circle(c, s * 0.54, s * 0.5, s * 0.08, '#6ae0c0'); },
    satellite: (c, s) => {
      c.fillStyle = '#2f4f86'; c.fillRect(s * 0.06, s * 0.4, s * 0.3, s * 0.2); c.fillRect(s * 0.64, s * 0.4, s * 0.3, s * 0.2);
      S.plate(c, s * 0.36, s * 0.3, s * 0.28, s * 0.4, s * 0.05, '#c8c0a0', { noShadow: true });
      circle(c, s * 0.5, s * 0.22, s * 0.08, null, '#8a939c', s * 0.03);
    },
    sci_1: (c, s) => flask(c, s, '#d8423a'),
    sci_2: (c, s) => flask(c, s, '#4cae48'),
    sci_mil: (c, s) => flask(c, s, '#8a8f99'),
    sci_3: (c, s) => flask(c, s, '#3b8fe0'),
    sci_4: (c, s) => flask(c, s, '#a24fd0'),
    speed_module: (c, s) => chip(c, s, '#4aa0e8', 'S'),
    efficiency_module: (c, s) => chip(c, s, '#5ac05a', 'E'),
    productivity_module: (c, s) => chip(c, s, '#e8a030', 'P'),
    pistol: (c, s) => gun(c, s, false),
    smg: (c, s) => gun(c, s, true),
    ammo_basic: (c, s) => magazine(c, s, '#c8a040', '#d8b060'),
    ammo_pierce: (c, s) => magazine(c, s, '#a83a2a', '#e0e0e0'),
    grenade: (c, s) => { circle(c, s * 0.5, s * 0.56, s * 0.26, '#4a5a3a', '#1e2418', s * 0.03); c.fillStyle = '#8a939c'; c.fillRect(s * 0.44, s * 0.2, s * 0.12, s * 0.14); },
    rail: (c, s) => { const k = s / 3.4; c.save(); c.scale(k, k); c.translate(0.7, 0.7); S.drawTrack(c, [FG.rails.makePiece(0, 2, 1, 'S')], 40); c.restore(); },
    locomotive: (c, s) => { c.save(); c.translate(s / 2, s / 2); c.rotate(-0.5); S.paintCar(c, 'loco', s * 0.9, s * 0.34, null); c.restore(); },
    cargo_wagon: (c, s) => { c.save(); c.translate(s / 2, s / 2); c.rotate(-0.5); S.paintCar(c, 'wagon', s * 0.9, s * 0.34, null); c.restore(); },
    repair_pack: (c, s) => {
      c.fillStyle = '#c8b050'; rr(c, s * 0.16, s * 0.28, s * 0.68, s * 0.5, s * 0.06); c.fill(); c.strokeStyle = '#4a3a10'; c.lineWidth = s * 0.03; c.stroke();
      c.fillStyle = '#d83a3a'; c.fillRect(s * 0.44, s * 0.36, s * 0.12, s * 0.34); c.fillRect(s * 0.33, s * 0.47, s * 0.34, s * 0.12);
    },
  };

  function fluidIcon(ctx, s, color) {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.12);
    ctx.bezierCurveTo(s * 0.62, s * 0.34, s * 0.78, s * 0.5, s * 0.78, s * 0.64);
    ctx.arc(s * 0.5, s * 0.64, s * 0.28, 0, Math.PI);
    ctx.bezierCurveTo(s * 0.22, s * 0.5, s * 0.38, s * 0.34, s * 0.5, s * 0.12);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = s * 0.04; ctx.stroke();
    circle(ctx, s * 0.4, s * 0.62, s * 0.07, 'rgba(255,255,255,0.45)');
  }

  const canvases = {};
  const urls = {};

  function paintItem(ctx, id, s) {
    if (D.fluids[id]) { fluidIcon(ctx, s, D.fluids[id].color); return; }
    const it = D.items[id];
    if (PAINT[id]) { PAINT[id](ctx, s); return; }
    if (it && it.place) {
      const pr = D.protos[it.place];
      const n = Math.max(pr.w, pr.h);
      const T = (s * 0.86) / n;
      ctx.save();
      ctx.translate((s - pr.w * T) / 2, (s - pr.h * T) / 2);
      S.paintPreview(ctx, pr.id, T);
      ctx.restore();
    }
  }

  I.get = function (id) {
    let c = canvases[id];
    if (!c) {
      c = S.makeCanvas(SIZE, SIZE);
      const ctx = c.getContext('2d');
      paintItem(ctx, id, SIZE);
      canvases[id] = c;
    }
    return c;
  };

  I.url = function (id) {
    if (urls[id]) return urls[id];
    let c = I.get(id);
    if (!(c.toDataURL)) {
      const tmp = document.createElement('canvas');
      tmp.width = SIZE; tmp.height = SIZE;
      tmp.getContext('2d').drawImage(c, 0, 0);
      c = tmp;
    }
    urls[id] = c.toDataURL();
    return urls[id];
  };

  // Warm the cache so the first inventory open is instant.
  I.preload = function () {
    for (const id in D.items) I.get(id);
    for (const id in D.fluids) I.get(id);
  };
})();
