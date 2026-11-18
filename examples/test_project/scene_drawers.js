/* test_project — scene drawers for "At dusk, the river carries every lamp back home. / Walk slowly. The light
 * remembers you."  Written for the style bible passed with --style (see README.md for the palette names it expects): every colour is a
 * palette name or mood field, every line weight comes from CAV.weight(), and all shading/rim/cloth/mouth work goes
 * through the runtime primitives.
 *
 * Scenes:  ghat_dusk     — wide river ghat at dusk; walking figure (params.pose = 'walk' | 'hold_diya')
 *          ghat_closeup  — dialogue close-up bust of the same figure, lip-synced to the narration
 */
(function () {
  const { c, mix, rgba, shadowOf, lightOf, hash, rng, noise1, clamp, lerp, TAU } = CAV;
  const W = (F) => F.W, H = (F) => F.H;

  // ------------------------------------------------------------------------------------------- shared world
  const HORIZON = 548;           // far-bank waterline
  const GHAT_TOP = 812;          // walking tread
  const wk = (F, n) => CAV.weight(n, 420);

  function skyLayer(ctx, F, o = {}) {
    CAV.paintSky(ctx, F.mood.sky, -400, -400, F.W + 800, HORIZON + 420, { steps: 9 });
    // low sun (key light comes from the left: key_dir_deg ~200)
    const sx = o.sunX || 300, sy = o.sunY || HORIZON - 70;
    CAV.glow(ctx, sx, sy, 420, F.mood.key, 0.55);
    ctx.fillStyle = c('diya_core'); ctx.beginPath(); ctx.arc(sx, sy, 44, 0, TAU); ctx.fill();
    CAV.glow(ctx, sx, sy, 120, 'gold_glow', 0.9);
    // flat-bottomed scalloped cumulus: plum bodies, fiery lit undersides
    const clouds = o.clouds || [[620, 250, 1.0], [1260, 170, 1.3], [1690, 330, 0.8], [180, 120, 0.9]];
    clouds.forEach(([x, y, s], k) => cloud(ctx, x + F.t * 6 * (k % 2 ? 1 : 0.6), y, s, F, k));
  }
  function cloud(ctx, x, y, s, F, seed) {
    const puffs = [[-150, 0, 60], [-90, -38, 72], [-10, -62, 86], [80, -40, 70], [150, -6, 54], [40, 4, 64]];
    const body = mix('plum_shadow', F.mood.ambient, 0.35), lit = mix('flame_orange', 'gold', 0.4);
    const path = (g) => { g.beginPath(); puffs.forEach(([px, py, r]) => { g.moveTo(x + px * s + r * s, y + py * s); g.arc(x + px * s, y + py * s, r * s, 0, TAU); }); g.rect(x - 200 * s, y - 2, 400 * s, 40 * s); };
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 400 * s, y - 200 * s, 800 * s, 200 * s + 26 * s); ctx.clip(); // flat bottom
    CAV.celShade(ctx, path, body, lit, 270, 14 * s); // light from below the horizon: lit undersides
    ctx.restore();
    // lit crest dashes on the light side
    CAV.drawTaperedStroke(ctx, [[x - 190 * s, y + 22 * s], [x - 40 * s, y + 25 * s], [x + 150 * s, y + 20 * s]], 3, lit, 0.1, 0.1, null, { alpha: 0.7 });
  }

  // far bank: hill city of small cubic flat-roofed houses stacked up two slopes, domes + chhatris, a hilltop
  // shikhara; windows lit in the emissive pass
  const hill = x => 105 * Math.exp(-Math.pow((x - 1250) / 520, 2)) + 60 * Math.exp(-Math.pow((x - 230) / 320, 2)) + 14;
  function cityBlocks(seed) {
    const r = rng(seed), out = [], ROWS = 8;
    for (let row = 0; row < ROWS; row++) {
      let x = -260 + r() * 40;
      while (x < 2200) {
        const w = 22 + r() * 30, h = 14 + r() * 20 + (row === 0 ? 8 : 0), k = 1 - row / (ROWS - 0.5);
        const base = HORIZON - hill(x + w / 2) * k - 2;
        out.push({ x, y: base - h, w, h: h + 4, row, dome: r() > 0.9, chhatri: r() > 0.95,
          win: Array.from({ length: (r() * 3) | 0 }, () => [r(), r(), r() > 0.3]) });
        x += w * (0.7 + r() * 0.5);
      }
    }
    return out;
  }
  const CITY = cityBlocks(5);
  function farBank(ctx, F) {
    const back = mix('dusk_mauve_shadow', 'indigo', 0.4), front = mix('indigo', 'plum_shadow', 0.3);
    // hilltop temple silhouettes
    [[1250, HORIZON - hill(1250) - 18, 1], [240, HORIZON - hill(240) - 10, 0.7]].forEach(([x, y, s]) => {
      ctx.fillStyle = back; ctx.beginPath(); ctx.moveTo(x - 34 * s, y + 20);
      ctx.bezierCurveTo(x - 32 * s, y - 50 * s, x - 10 * s, y - 92 * s, x, y - 100 * s); ctx.bezierCurveTo(x + 10 * s, y - 92 * s, x + 32 * s, y - 50 * s, x + 34 * s, y + 20); ctx.fill();
      ctx.fillRect(x - 1.5, y - 118 * s, 3, 20 * s);
    });
    for (const b of CITY) {
      const col = mix(back, front, b.row / 7);
      CAV.inkShape(ctx, [[b.x, b.y + b.h], [b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h]], { fill: col, width: CAV.weight('distant_architecture'), ink: mix(F.mood.ink, col, 0.4) });
      ctx.fillStyle = lightOf(col, 0.18); ctx.fillRect(b.x, b.y, b.w * 0.33, b.h); // lit left faces
      if (b.dome) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y, b.w * 0.4, b.w * 0.46, 0, Math.PI, TAU); ctx.fill();
        ctx.fillRect(b.x + b.w / 2 - 1.2, b.y - b.w * 0.46 - 9, 2.4, 9);
      } else if (b.chhatri) {
        ctx.fillStyle = col; ctx.fillRect(b.x + 3, b.y - 12, 2, 12); ctx.fillRect(b.x + b.w - 5, b.y - 12, 2, 12);
        ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y - 12, b.w * 0.36, b.w * 0.3, 0, Math.PI, TAU); ctx.fill();
      } else { // parapet lip on the flat roof
        ctx.fillStyle = shadowOf(col, 0.3); ctx.fillRect(b.x - 1, b.y, b.w + 2, 3);
      }
    }
    ctx.fillStyle = mix(front, F.mood.shadow_tint, 0.5); ctx.fillRect(-300, HORIZON - 4, F.W + 600, 12); // bank lip
  }
  function farBankLights(ctx, F) {
    for (const b of CITY) for (const [u, v, on] of b.win) {
      if (!on) continue;
      const x = b.x + 6 + u * (b.w - 14), y = b.y + 6 + v * (b.h * 0.6), flick = 0.75 + 0.25 * noise1(F.tc * 2 + x, 3);
      ctx.fillStyle = rgba('gold_glow', 0.85 * flick); ctx.fillRect(x, y, 4, 5);
      if (u > 0.7) CAV.glow(ctx, x + 2, y + 2, 12, 'diya_flame', 0.35 * flick);
    }
  }

  // river (gradient allowed in water), ripple dashes, reflection columns, floating diyas
  function river(ctx, F) {
    const g = ctx.createLinearGradient(0, HORIZON, 0, 1200);
    const sky = F.S.gradients[F.mood.sky];
    g.addColorStop(0, mix(sky[sky.length - 2], 'water_teal', 0.35)); g.addColorStop(0.35, mix('water_teal', F.mood.ambient, 0.35));
    g.addColorStop(1, mix('water_teal', 'cool_teal_shadow', 0.6));
    ctx.fillStyle = g; ctx.fillRect(-400, HORIZON, F.W + 800, 900);
    const r = rng(9);
    for (let k = 0; k < 140; k++) { // horizontal ripple dashes drifting on twos
      const y = HORIZON + 8 + Math.pow(r(), 1.6) * 520, x = ((r() * 2600 - F.tc * (10 + y * 0.02)) % 2600 + 2600) % 2600 - 400;
      const w = 10 + (y - HORIZON) * 0.12 * r();
      ctx.fillStyle = rgba(r() > 0.6 ? lightOf('water_teal', 0.5) : 'cool_teal_shadow', 0.35 + 0.3 * r());
      ctx.fillRect(x, y, w, 1.5 + (y - HORIZON) * 0.006);
    }
  }
  function riverLights(ctx, F, o = {}) {
    CAV.reflection(ctx, o.sunX || 300, HORIZON + 4, 90, 360, 'gold_glow', F.tc, { rows: 36, alpha: 0.75, thick: 4 });
    for (const b of CITY) if (b.win.some(w => w[2]) && hash(b.x) > 0.6)
      CAV.reflection(ctx, b.x + b.w / 2, HORIZON + 6, 10, 70 + hash(b.y) * 60, 'diya_flame', F.tc, { rows: 9, alpha: 0.45, thick: 2 });
    // floating diyas carried downstream (right -> left): "every lamp back home"
    const r = rng(21);
    for (let k = 0; k < 16; k++) {
      const depth = r(), y = HORIZON + 30 + depth * 260, s = 0.45 + depth * 0.9;
      const x = ((r() * 2400 - F.tc * (14 + depth * 30)) % 2400 + 2400) % 2400 - 250;
      diya(ctx, x, y, s, F, k, true);
    }
  }
  function diya(ctx, x, y, s, F, seed, onWater) {
    const fl = 0.9 + 0.2 * hash(F.ic, seed); // flicker on twos
    if (onWater) CAV.reflection(ctx, x, y + 4 * s, 9 * s, 70 * s, 'diya_flame', F.tc + seed, { rows: 8, alpha: 0.6, thick: 2.2 * s });
    CAV.glow(ctx, x, y - 10 * s, 46 * s * fl, 'diya_flame', 0.55);
    ctx.fillStyle = c('terracotta'); ctx.beginPath(); ctx.ellipse(x, y, 13 * s, 5.5 * s, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = shadowOf('terracotta', 0.5); ctx.beginPath(); ctx.ellipse(x, y, 13 * s, 3 * s, 0, 0, TAU); ctx.fill();
    const sway = noise1(F.tc * 3 + seed, 2) * 2 * s;
    ctx.fillStyle = c('diya_flame'); ctx.beginPath();
    ctx.moveTo(x - 4 * s, y - 2 * s); ctx.quadraticCurveTo(x - 5 * s, y - 10 * s * fl, x + sway, y - 19 * s * fl); ctx.quadraticCurveTo(x + 5 * s, y - 10 * s * fl, x + 4 * s, y - 2 * s); ctx.fill();
    ctx.fillStyle = c('diya_core'); ctx.beginPath(); ctx.ellipse(x + sway * 0.3, y - 6 * s, 2 * s, 4.5 * s, 0, 0, TAU); ctx.fill();
  }

  // nagara shikhara on the near bank (mid distance), cel-shaded, ribbed tiers, amalaka + kalash
  function shikhara(ctx, F, x, base, h, wBase) {
    const half = wBase / 2, top = base - h;
    const ink = F.mood.ink, wmid = CAV.weight('midground_architecture');
    // stone island ghat that grounds the temple: three steps descending into the river
    for (let k = 2; k >= 0; k--) {
      const sw = half * 1.7 + k * 46, sy = base + 44 + k * 18;
      ctx.fillStyle = shadowOf('sandstone_dark', 0.45); ctx.fillRect(x - sw, sy, sw * 2, 18);
      ctx.fillStyle = lightOf('sandstone', 0.1); ctx.fillRect(x - sw, sy, sw * 2, 5);
      CAV.drawTaperedStroke(ctx, CAV.chipped([[x - sw, sy], [x + sw, sy]], 0.8, k + 5), wmid, ink, 0.4, 0.4, 1.6, { boil: false });
    }
    const side = (sgn) => { const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push([x + sgn * half * (1 - 0.74 * Math.pow(u, 2.1)) * (1 + 0.05 * Math.sin(Math.PI * u)), base - u * h]); } return pts; };
    const L = side(-1), R = side(1), outline = L.concat(R.slice().reverse());
    const body = (g) => CAV.polyPath(g, outline);
    CAV.celShade(ctx, body, 'sandstone_dark', null, F.mood.key_dir_deg, wBase * 0.22, { width: 1 });
    for (let i = 1; i < 12; i++) CAV.drawTaperedStroke(ctx, [L[i], [x, L[i][1] - 4], R[i]], wmid * 0.7, mix(ink, 'sandstone_dark', 0.3), 0.3, 0.3, null, { boil: false });
    CAV.drawTaperedStroke(ctx, [[x - 2, base], [x - 2, top + 12]], wmid * 0.8, mix(ink, 'sandstone_dark', 0.2), 0.4, 0.2, null, { boil: false });
    CAV.inkShape(ctx, outline, { width: wmid, ink, whole: true });
    // amalaka + kalash
    const ax = x, ay = top - 6;
    ctx.fillStyle = c('sandstone'); ctx.beginPath(); ctx.ellipse(ax, ay, half * 0.34, 9, 0, 0, TAU); ctx.fill();
    CAV.inkShape(ctx, Array.from({ length: 16 }, (_, k) => [ax + Math.cos(k / 16 * TAU) * half * 0.34, ay + Math.sin(k / 16 * TAU) * 9]), { width: wmid * 0.8, ink, whole: true });
    ctx.fillStyle = c('gold_deep'); ctx.beginPath(); ctx.ellipse(ax, ay - 20, 9, 12, 0, 0, TAU); ctx.fill();
    ctx.fillRect(ax - 1.5, ay - 46, 3, 20);
    // saffron flag in the wind (cloth chain)
    const flag = { anchor: { x: ax, y: ay - 44 }, segments: 6, length: 58, restAngle: 0, stiffness: 0.2, amp: 12, phase: 1.2 };
    CAV.stepClothChain(flag, 350, 0.8, 0);
    CAV.drawClothChain(ctx, flag, { width: 18, endWidth: 6, fill: 'saffron', inkWidth: 1.2 });
    // urushringa mini spires
    [-1, 1].forEach(sg => {
      const mx = x + sg * half * 0.95, mh = h * 0.42, mw = wBase * 0.38;
      CAV.celShade(ctx, g => CAV.polyPath(g, [[mx - mw / 2, base], [mx - mw * 0.16, base - mh], [mx + mw * 0.16, base - mh], [mx + mw / 2, base]]), 'sandstone_dark', null, F.mood.key_dir_deg, mw * 0.25, { width: 1 });
      CAV.inkShape(ctx, [[mx - mw / 2, base], [mx - mw * 0.16, base - mh], [mx + mw * 0.16, base - mh], [mx + mw / 2, base]], { width: wmid * 0.8, ink });
    });
    // mandapa plinth + niches
    CAV.celShade(ctx, g => g.rect(x - half * 1.5, base, half * 3, 44), 'sandstone', null, F.mood.key_dir_deg, half * 0.5, { width: 1 });
    CAV.inkShape(ctx, [[x - half * 1.5, base], [x + half * 1.5, base], [x + half * 1.5, base + 44], [x - half * 1.5, base + 44]], { width: wmid, ink });
  }
  /** Broken, darkened reflection of the island temple on the water (drawn on the river, before the lights). */
  function shikharaReflection(ctx, F, x, base, h, wBase) {
    const water = base + 44 + 3 * 18, half = wBase / 2;
    ctx.save();
    ctx.beginPath(); for (let y = water; y < water + h * 0.9; y += 7) ctx.rect(x - half * 2.2 + Math.sin(y * 0.3 + F.tc * 4) * 4, y, half * 4.4, 4.2);
    ctx.clip();
    ctx.fillStyle = rgba(shadowOf('sandstone_dark', 0.6), 0.45);
    ctx.beginPath(); ctx.moveTo(x - half * 1.9, water);
    for (let i = 0; i <= 12; i++) { const u = i / 12; ctx.lineTo(x - half * (1 - 0.74 * Math.pow(u, 2.1)), water + (98 + u * h) * 0.85); }
    for (let i = 12; i >= 0; i--) { const u = i / 12; ctx.lineTo(x + half * (1 - 0.74 * Math.pow(u, 2.1)), water + (98 + u * h) * 0.85); }
    ctx.lineTo(x + half * 1.9, water); ctx.fill();
    ctx.restore();
  }
  function shikharaLights(ctx, F, x, base, h, wBase) {
    [-0.6, 0, 0.6].forEach((u, k) => {
      const nx = x + u * wBase * 0.7, ny = base + 24, fl = 0.85 + 0.15 * hash(F.ic, k + 40);
      ctx.fillStyle = c('umber_shadow'); ctx.beginPath(); ctx.arc(nx, ny, 9, Math.PI, TAU); ctx.rect(nx - 9, ny, 18, 14); ctx.fill();
      CAV.glow(ctx, nx, ny + 4, 34 * fl, 'diya_flame', 0.75);
      ctx.fillStyle = c('diya_core'); ctx.beginPath(); ctx.ellipse(nx, ny + 6, 2.2, 4, 0, 0, TAU); ctx.fill();
    });
  }

  // ghat steps on the near bank: light treads, dark risers, chipped edges, diyas on treads
  const STEPS = Array.from({ length: 7 }, (_, k) => ({ y: GHAT_TOP + k * 38, x: 840 - k * 150 }));
  function ghat(ctx, F) {
    const ink = F.mood.ink, wm = CAV.weight('midground_architecture', null, 0.8);
    const tread = lightOf('sandstone', 0.12), riser = shadowOf('sandstone_dark', 0.5);
    // retaining wall behind the top platform
    CAV.inkShape(ctx, CAV.chipped([[760, GHAT_TOP], [760, GHAT_TOP - 120], [2400, GHAT_TOP - 120], [2400, GHAT_TOP]], 1.2, 3), { fill: shadowOf('sandstone_dark', 0.3), width: wm, ink });
    ctx.fillStyle = lightOf('sandstone', 0.08); ctx.fillRect(756, GHAT_TOP - 132, 1700, 14);
    CAV.drawTaperedStroke(ctx, CAV.chipped([[756, GHAT_TOP - 118], [2400, GHAT_TOP - 118]], 0.8, 9), wm, ink, 0.4, 0.4, 1.6, { boil: false });
    for (let nx = 900; nx < 2400; nx += 210) { // arched lamp niches between pilasters
      ctx.fillStyle = mix('umber_shadow', F.mood.shadow_tint, 0.3);
      ctx.beginPath(); ctx.moveTo(nx - 22, GHAT_TOP - 30); ctx.lineTo(nx - 22, GHAT_TOP - 70); ctx.arc(nx, GHAT_TOP - 70, 22, Math.PI, TAU); ctx.lineTo(nx + 22, GHAT_TOP - 30); ctx.fill();
      CAV.drawTaperedStroke(ctx, [[nx - 26, GHAT_TOP - 28], [nx - 26, GHAT_TOP - 70], [nx, GHAT_TOP - 96], [nx + 26, GHAT_TOP - 70], [nx + 26, GHAT_TOP - 28]], wm * 0.9, ink, 0.3, 0.3, 1.6, { boil: false });
      ctx.fillStyle = shadowOf('sandstone_dark', 0.2); ctx.fillRect(nx + 92, GHAT_TOP - 118, 14, 118);
      CAV.drawTaperedStroke(ctx, [[nx + 106, GHAT_TOP - 118], [nx + 106, GHAT_TOP]], wm * 0.8, ink, 0.4, 0.4, null, { boil: false });
    }
    const r = rng(77);
    for (let k = 0; k < 26; k++) { // brick courses where plaster has fallen + crack ticks
      const bx = 800 + r() * 1500, by = GHAT_TOP - 110 + r() * 90;
      CAV.drawTaperedStroke(ctx, [[bx, by], [bx + 14 + r() * 26, by + (r() - 0.5) * 3]], 1.1, mix(ink, 'brick', 0.4), 0.3, 0.3, null, { boil: false, alpha: 0.7 });
    }
    for (let k = STEPS.length - 1; k >= 0; k--) {
      const s = STEPS[k];
      const top = CAV.chipped([[s.x, s.y], [2500, s.y]], 1.0, 10 + k), fr = [[s.x, s.y], [2500, s.y], [2500, s.y + 38], [s.x - 6, s.y + 38]];
      ctx.fillStyle = riser; CAV.polyPath(ctx, fr); ctx.fill();
      ctx.fillStyle = tread; CAV.polyPath(ctx, [[s.x, s.y], [2500, s.y], [2500, s.y + 10], [s.x - 2, s.y + 10]]); ctx.fill();
      CAV.drawTaperedStroke(ctx, top, wm, ink, 0.3, 0.6, 1.6, { boil: false });
      CAV.drawTaperedStroke(ctx, [[s.x - 6, s.y + 38], [s.x, s.y + 2]], wm, ink, 0.4, 0.4, 1.6, { boil: false });
      for (let j = 0; j < 9; j++) { const jx = s.x + 60 + j * 190 + (k % 2) * 80; CAV.drawTaperedStroke(ctx, [[jx, s.y + 12], [jx + 2, s.y + 37]], 1, mix(ink, riser, 0.5), 0.3, 0.3, null, { boil: false }); }
    }
    // chhatri on the platform: plinth, two visible posts, dome, kalash, hanging bell
    const cx = 1660, cy = GHAT_TOP - 120;
    CAV.celShade(ctx, g => g.rect(cx - 150, cy - 30, 300, 30), 'sandstone', null, F.mood.key_dir_deg, 70, { width: 1 });
    [-120, 108].forEach(px => CAV.celShade(ctx, g => g.rect(cx + px, cy - 260, 14, 230), 'sandstone', null, F.mood.key_dir_deg, 5));
    CAV.celShade(ctx, g => g.rect(cx - 160, cy - 286, 320, 30), 'sandstone', null, F.mood.key_dir_deg, 60);
    [[[cx - 150, cy - 30], [cx + 150, cy - 30], [cx + 150, cy], [cx - 150, cy]], [[cx - 120, cy - 30], [cx - 120, cy - 256], [cx - 106, cy - 256], [cx - 106, cy - 30]], [[cx + 108, cy - 30], [cx + 108, cy - 256], [cx + 122, cy - 256], [cx + 122, cy - 30]], [[cx - 160, cy - 256], [cx + 160, cy - 256], [cx + 160, cy - 286], [cx - 160, cy - 286]]]
      .forEach(p => CAV.inkShape(ctx, CAV.chipped(p, 0.9, p[0][0]), { width: wm, ink }));
    const dome = []; for (let i = 0; i <= 20; i++) { const a = Math.PI + (i / 20) * Math.PI; dome.push([cx + Math.cos(a) * 130, cy - 286 + Math.sin(a) * 134]); }
    CAV.celShade(ctx, g => CAV.polyPath(g, dome, true, false), 'sandstone', null, F.mood.key_dir_deg, 50);
    for (let k = 1; k < 4; k++) CAV.drawTaperedStroke(ctx, dome.slice(3 + k, 18 - k).map(([x, y]) => [x, y + k * 22 + (k * k)]), 1.1, shadowOf('sandstone', 0.6), 0.3, 0.3, null, { boil: false });
    CAV.drawTaperedStroke(ctx, dome, wm * 1.2, ink, 0.4, 0.4, 1.6, { boil: false });
    ctx.fillStyle = c('gold_deep'); ctx.beginPath(); ctx.ellipse(cx, cy - 432, 10, 14, 0, 0, TAU); ctx.fill(); ctx.fillRect(cx - 2, cy - 452, 4, 22);
    // bell (damped pendulum)
    const ang = 0.12 * Math.sin(F.tc * 2.4) * Math.exp(-((F.t % 6) * 0.1));
    ctx.save(); ctx.translate(cx, cy - 256); ctx.rotate(ang);
    CAV.drawTaperedStroke(ctx, [[0, 0], [0, 60]], 2, ink, 0.6, 0.6, null, { boil: false });
    CAV.celShade(ctx, g => { g.moveTo(-16, 92); g.quadraticCurveTo(-16, 56, 0, 56); g.quadraticCurveTo(16, 56, 16, 92); g.closePath(); }, 'gold_deep', null, F.mood.key_dir_deg, 8);
    CAV.inkShape(ctx, [[-16, 92], [-14, 64], [0, 56], [14, 64], [16, 92]], { width: 1.4, ink, closed: true, whole: true });
    ctx.restore();
  }
  function ghatLights(ctx, F) {
    for (let nx = 900; nx < 2400; nx += 210) diya(ctx, nx, GHAT_TOP - 34, 0.75, F, nx, false);
    STEPS.forEach((s, k) => { for (let j = 0; j < 5; j++) { const x = s.x + 90 + j * 260 + (k % 2) * 120; if (x < 2100 && k > 0) diya(ctx, x, s.y + 2, 0.9, F, k * 10 + j, false); } });
    for (let j = 0; j < 4; j++) diya(ctx, 980 + j * 310, GHAT_TOP + 1, 1.0, F, 90 + j, false);
  }

  // foreground: multifoil cusped arch framing the top corners + swaying marigold garland swags
  function archFrame(ctx, F, o = {}) {
    const Wd = F.W, top = o.top != null ? o.top : 120, spring = o.spring != null ? o.spring : 330, pil = o.pillar || 110;
    const stone = mix('teal_stone', 'umber_shadow', 0.55), ink = F.mood.ink;
    const open = (g) => {
      g.moveTo(pil, 1400); g.lineTo(pil, spring);
      const cusps = 9;
      for (let k = 0; k < cusps; k++) { // scalloped intrados
        const a0 = Math.PI + (k / cusps) * Math.PI, a1 = Math.PI + ((k + 1) / cusps) * Math.PI;
        const ex = (a) => [Wd / 2 + Math.cos(a) * (Wd / 2 - pil), spring + Math.sin(a) * (spring - top)];
        const [x0, y0] = ex(a0), [x1, y1] = ex(a1), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const nx = Wd / 2 + Math.cos((a0 + a1) / 2) * (Wd / 2 - pil) * 0.95, ny = spring + Math.sin((a0 + a1) / 2) * (spring - top) * 0.88;
        g.quadraticCurveTo(nx + (nx - mx) * 0.9, ny + (ny - my) * 0.9, x1, y1);
      }
      g.lineTo(Wd - pil, 1400); g.closePath();
    };
    const frame = (g) => { g.rect(-500, -500, Wd + 1000, 2000); open(g); };
    ctx.save();
    ctx.beginPath(); frame(ctx); ctx.fillStyle = stone; ctx.fill('evenodd');
    // carved band + niches on the pillars
    ctx.beginPath(); frame(ctx); ctx.clip('evenodd');
    for (let k = 0; k < 7; k++) { const y = 380 + k * 120; [pil * 0.5, Wd - pil * 0.5].forEach(x => { CAV.drawTaperedStroke(ctx, [[x - 36, y], [x + 36, y]], 2.2, mix(stone, F.mood.rim, 0.25), 0.4, 0.4, null, { boil: false }); }); }
    for (let k = 0; k < 40; k++) { const a = Math.PI + (k / 40) * Math.PI, x = Wd / 2 + Math.cos(a) * (Wd / 2 - pil + 46), y = spring + Math.sin(a) * (spring - top + 40); CAV.glow(ctx, x, y, 3, mix(stone, 'gold', 0.4), 0.6, 'source-over'); }
    ctx.restore();
    CAV.applyRimLight(ctx, g => { g.rect(-500, -500, Wd + 1000, 2000); open(g); return 'evenodd'; }, F.mood.key_dir_deg + 180, F.mood.rim, 0.55, { width: 5 });
    ctx.save(); ctx.beginPath(); open(ctx); ctx.lineWidth = 3.2; ctx.strokeStyle = c(ink); ctx.stroke(); ctx.restore();
    // garland swags (marigold) between the cusps — sway with the breeze
    (o.swags || [[pil - 20, Wd * 0.3, spring - 120, 70, 0], [Wd * 0.7, Wd - pil + 20, spring - 120, 70, 1.7]]).forEach(s => garland(ctx, F, ...s));
  }
  function garland(ctx, F, x0, x1, y, sag, ph) {
    {
      const n = Math.max(12, Math.round((x1 - x0) / 17)), beads = [];
      for (let i = 0; i <= n; i++) { const u = i / n; beads.push([lerp(x0, x1, u) + Math.sin(F.tc * 1.6 + ph) * 6 * Math.sin(Math.PI * u), y + Math.sin(Math.PI * u) * sag * (1 + 0.04 * Math.sin(F.tc * 2 + ph))]); }
      beads.forEach(([bx, by], i) => { ctx.fillStyle = c(i % 3 ? 'marigold' : 'saffron'); ctx.beginPath(); ctx.arc(bx, by, 8.5, 0, TAU); ctx.fill(); ctx.fillStyle = shadowOf('marigold', 0.5); ctx.beginPath(); ctx.arc(bx + 2.5, by + 2.5, 4.5, 0, TAU); ctx.fill(); });
    }
  }

  // ----------------------------------------------------------------------------------- the walking figure
  function rig(F, o) {
    const S = F.S, PR = S.proportions || {}, mh = PR.male_hero || {}, LM = PR.landmarks_in_heads_from_ground_male || {};
    const LB = PR.limb_lengths_heads || {};
    const heads = mh.heads_tall || 8, hu = o.h / heads, f = o.facing || -1, wc = S.motion_rules.walk_cycle;
    const stride = (wc.stride_heads || 1.6) * hu, stepT = (wc.frames_per_step || 12) / F.fps;
    const walking = o.pose === 'walk';
    const tWalk = walking ? F.tcShot : 0;
    const X = o.x + f * (stride / stepT) * tWalk, Y = o.y;
    const phi = walking ? ((tWalk / (2 * stepT)) + 0.25) % 1 : 0;
    const P = (lx, ly) => ({ x: X + f * lx, y: Y - ly });
    const ankleH = (LM.ankle || 0.35) * hu, thigh = (LB.thigh || 1.95) * hu * 0.97, shin = (LB.shin || 1.8) * hu * 0.97;
    const hipH = (LM.hip || 4) * hu - (walking ? (wc.bob_heads || 0.06) * hu * (0.5 + 0.5 * Math.cos(4 * Math.PI * phi)) + 0.04 * hu : 0);
    const lean = walking ? (wc.torso_lean_deg || 3) * Math.PI / 180 : 0;
    const legs = [0, 0.5].map(off => {
      const q = (phi + off) % 1; let fx, lift = 0;
      if (!walking) fx = off ? -0.22 * hu : 0.28 * hu;
      else if (q < 0.5) fx = stride / 2 - (q / 0.5) * stride;             // stance: foot locked in world space
      else { const s = (q - 0.5) / 0.5; fx = -stride / 2 + CAV.ease.easeInOutSine(s) * stride; lift = Math.sin(Math.PI * s) * 0.32 * hu; }
      const hip = { lx: off ? -0.12 * hu : 0.1 * hu, ly: hipH }, ank = { lx: fx, ly: ankleH + lift };
      let dx = ank.lx - hip.lx, dy = ank.ly - hip.ly, d = Math.hypot(dx, dy); const maxD = thigh + shin - 0.5;
      if (d > maxD) { ank.lx = hip.lx + dx / d * maxD; ank.ly = hip.ly + dy / d * maxD; dx = ank.lx - hip.lx; dy = ank.ly - hip.ly; d = maxD; }
      const a = Math.acos(clamp((thigh * thigh + d * d - shin * shin) / (2 * thigh * d), -1, 1)), base = Math.atan2(dy, dx);
      const kA = base + a; // knee bends forward (+lx)
      const knee = { lx: hip.lx + Math.cos(kA) * thigh, ly: hip.ly + Math.sin(kA) * thigh };
      const toeLift = walking && q > 0.42 && q < 0.6 ? 0.35 : 0;
      return { hip: P(hip.lx, hip.ly), knee: P(knee.lx, knee.ly), ank: P(ank.lx, ank.ly), toe: P(ank.lx + 0.75 * hu, ank.ly - ankleH + 0.06 * hu + toeLift * hu * 0.4), heel: P(ank.lx - 0.22 * hu, ankleH * 0.2 + lift), q, lift };
    });
    const sh = (LM.shoulder || 6.55) * hu - (walking ? 0 : 0), up = (lx, ly) => P(lx + Math.sin(lean) * (ly - hipH), ly - (hipH - (LM.hip || 4) * hu));
    const arms = [0, 0.5].map(off => {
      const q = (phi + off) % 1, swing = (walking ? (wc.arm_swing_deg || 22) : 4) * Math.PI / 180 * -Math.cos(TAU * q);
      const s0 = up(off ? -0.35 * hu : 0.1 * hu, sh - 0.12 * hu);
      const ua = (LB.upper_arm || 1.45) * hu, fa = (LB.forearm || 1.25) * hu;
      // angles from straight down, positive = toward the facing direction
      const hold = o.pose === 'hold_diya';
      const th1 = hold ? (off ? 0.2 : 0.42) : swing;
      const el = { x: s0.x + f * Math.sin(th1) * ua, y: s0.y + Math.cos(th1) * ua };
      const th2 = th1 + (hold ? 1.75 : 0.18 + 0.4 * Math.max(0, swing / ((wc.arm_swing_deg || 22) * Math.PI / 180)));
      const wr = { x: el.x + f * Math.sin(th2) * fa, y: el.y + Math.cos(th2) * fa };
      return { sh: s0, el, wr, q };
    });
    return { X, Y, hu, f, P, up, legs, arms, hipH, sh, lean, walking, phi, LM, stepImpulse: walking ? Math.abs(Math.sin(TAU * phi * 2)) : 0 };
  }

  function limbSides(ctx, a, b, r1, r2, w, ink, bias = 1.6) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
    CAV.drawTaperedStroke(ctx, [[a.x + nx * r1, a.y + ny * r1], [b.x + nx * r2, b.y + ny * r2]], w, ink, 0.35, 0.2, bias);
    CAV.drawTaperedStroke(ctx, [[a.x - nx * r1, a.y - ny * r1], [b.x - nx * r2, b.y - ny * r2]], w, ink, 0.35, 0.2, bias);
  }

  function drawFigure(ctx, F, o) {
    const R = rig(F, o), hu = R.hu, f = R.f, ink = F.mood.ink, skinInk = F.S.strokes.ink.skin || ink;
    const skin = 'skin_mid', dhoti = 'cream_cloth', sash = 'saffron';
    const wc = CAV.weight('silhouette_contour', o.h, 0.5), wi = CAV.weight('interior_form_lines', o.h, 0.4), wf = CAV.weight('fabric_fold_lines', o.h, 0.5);
    const key = F.mood.key_dir_deg;
    const [nearLeg, farLeg] = R.legs[0].q < 0.5 && R.walking ? [R.legs[0], R.legs[1]] : [R.legs[0], R.legs[1]];
    const [nearArm, farArm] = [R.arms[1], R.arms[0]];
    const neckB = R.up(0.05 * hu, R.sh + 0.05 * hu), chin = R.up(0.12 * hu, (R.LM.chin || 7) * hu), headC = R.up(0.1 * hu, (R.LM.chin || 7) * hu + 0.5 * hu);
    const waist = R.up(0, (R.LM.waist || 4.8) * hu), chest = R.up(0.08 * hu, (R.LM.chest || 5.8) * hu);
    // contact shadow (flat, ink-tinted, cast away from the light)
    ctx.save(); ctx.fillStyle = rgba(F.mood.shadow_tint, 0.5);
    ctx.beginPath(); ctx.ellipse(R.X + 0.9 * hu, R.Y + 2, 1.9 * hu, 0.22 * hu, 0, 0, TAU); ctx.fill(); ctx.restore();

    // uttariya tail streaming behind (wind blows opposite to the walk + footfall impulse)
    const tailA = R.up(-0.4 * hu, R.sh - 0.1 * hu);
    const tail = { anchor: tailA, segments: 9, length: 2.9 * hu, restAngle: f < 0 ? 70 : 110, stiffness: 0.15, amp: 15, phase: 0.4 };
    CAV.stepClothChain(tail, f < 0 ? 8 : 172, R.walking ? 0.75 : 0.5, R.stepImpulse);

    const parts = []; // silhouette builders for the rim light
    // dhoti leg = one convex cloth volume around hip, knee and bunched ankle (no ball-joint bulge at the knee)
    const hull = (circles) => {
      const pts = []; circles.forEach(([p, r]) => { for (let k = 0; k < 18; k++) pts.push({ x: p.x + Math.cos(k / 18 * TAU) * r, y: p.y + Math.sin(k / 18 * TAU) * r }); });
      pts.sort((a, b) => a.x - b.x || a.y - b.y);
      const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), lo = [], up = [];
      for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const legShape = (L) => (g) => CAV.polyPath(g, hull([[L.hip, 0.62 * hu], [L.knee, 0.42 * hu], [{ x: L.ank.x, y: L.ank.y - 0.12 * hu }, 0.4 * hu]]), true, false);
    const footShape = (L) => (g) => CAV.polyPath(g, [L.heel, { x: L.ank.x, y: L.ank.y - 0.1 * hu }, L.toe, { x: L.toe.x, y: L.toe.y + 0.04 * hu }, { x: L.heel.x, y: L.heel.y + 0.05 * hu }], true, false);
    const armShape = (A) => (g) => { CAV.limb(g, A.sh, A.el, 0.36 * hu, 0.27 * hu, false); g.moveTo(A.el.x, A.el.y); CAV.limb(g, A.el, A.wr, 0.26 * hu, 0.19 * hu, false); g.moveTo(A.wr.x + 0.21 * hu, A.wr.y + 0.12 * hu); g.arc(A.wr.x, A.wr.y + 0.12 * hu, 0.21 * hu, 0, TAU); };
    const torsoShape = (g) => {
      const pts = [R.up(-0.62 * hu, R.sh + 0.06 * hu), R.up(0.2 * hu, R.sh + 0.14 * hu), R.up(0.58 * hu, R.sh - 0.08 * hu), R.up(0.7 * hu, R.sh - 0.85 * hu), R.up(0.46 * hu, (R.LM.waist || 4.8) * hu), R.up(0.45 * hu, R.hipH), R.up(-0.48 * hu, R.hipH), R.up(-0.46 * hu, (R.LM.waist || 4.8) * hu), R.up(-0.78 * hu, R.sh - 0.7 * hu)];
      CAV.polyPath(g, CAV.catmull(pts.concat([pts[0]]), 6), true, false);
    };
    const headShape = (g) => { g.moveTo(headC.x + 0.42 * hu, headC.y); g.ellipse(headC.x, headC.y, 0.4 * hu, 0.52 * hu, f * 0.08, 0, TAU); g.moveTo(headC.x - f * 0.22 * hu + 0.18 * hu, headC.y - 0.62 * hu); g.arc(headC.x - f * 0.22 * hu, headC.y - 0.62 * hu, 0.18 * hu, 0, TAU); };
    const neckShape = (g) => CAV.limb(g, neckB, chin, 0.24 * hu, 0.2 * hu, false);

    CAV.withBoil(() => {
      // back to front (style layering order)
      CAV.drawClothChain(ctx, tail, { width: 0.62 * hu, endWidth: 0.24 * hu, fill: sash, border: { color: 'gold', width: 0.1 * hu, inner: 'gold_deep' }, folds: 2, figureHeight: o.h });
      CAV.celShade(ctx, armShape(farArm), shadowOf(skin, 0.3), null, key, 0.22 * hu); parts.push(armShape(farArm));
      CAV.celShade(ctx, footShape(farLeg), shadowOf(skin, 0.3), null, key, 0.2 * hu);
      CAV.celShade(ctx, legShape(farLeg), shadowOf(dhoti, 0.25), null, key, 0.3 * hu); parts.push(legShape(farLeg), footShape(farLeg));
      limbSides(ctx, farLeg.hip, farLeg.knee, 0.62 * hu, 0.46 * hu, wc * 0.8, ink); limbSides(ctx, farLeg.knee, farLeg.ank, 0.46 * hu, 0.33 * hu, wc * 0.8, ink);
      CAV.celShade(ctx, torsoShape, skin, null, key, 0.38 * hu); parts.push(torsoShape);
      // abs + pec wedges (sharp-cornered shadow shapes)
      const pec = [R.up(0.55 * hu, R.sh - 0.55 * hu), R.up(0.1 * hu, R.sh - 0.95 * hu), R.up(-0.25 * hu, R.sh - 0.8 * hu)];
      CAV.drawTaperedStroke(ctx, pec, wi, skinInk, 0.2, 0.15, 1.6);
      for (let k = 0; k < 3; k++) CAV.drawTaperedStroke(ctx, [R.up(0.25 * hu, R.sh - (1.25 + k * 0.32) * hu), R.up(0.42 * hu, R.sh - (1.3 + k * 0.32) * hu)], wi * 0.7, shadowOf(skin, 0.6), 0.2, 0.2, null);
      CAV.celShade(ctx, legShape(nearLeg), dhoti, null, key, 0.32 * hu); parts.push(legShape(nearLeg));
      CAV.celShade(ctx, footShape(nearLeg), skin, null, key, 0.15 * hu); parts.push(footShape(nearLeg));
      limbSides(ctx, nearLeg.hip, nearLeg.knee, 0.62 * hu, 0.46 * hu, wc, ink); limbSides(ctx, nearLeg.knee, nearLeg.ank, 0.46 * hu, 0.33 * hu, wc, ink);
      // dhoti folds radiating from the waist knot and bunching at the ankles
      [nearLeg, farLeg].forEach((L, k) => {
        for (let j = 0; j < 3; j++) { const t0 = 0.2 + j * 0.25; CAV.drawTaperedStroke(ctx, [{ x: lerp(L.hip.x, L.knee.x, t0) + f * 0.2 * hu, y: lerp(L.hip.y, L.knee.y, t0) }, { x: lerp(L.knee.x, L.ank.x, 0.3 + j * 0.15) - f * 0.1 * hu, y: lerp(L.knee.y, L.ank.y, 0.3 + j * 0.15) }], wf, shadowOf(dhoti, 0.7), 0.15, 0.1, 1.6); }
        CAV.drawTaperedStroke(ctx, [{ x: L.ank.x - 0.3 * hu, y: L.ank.y - 0.35 * hu }, { x: L.ank.x, y: L.ank.y - 0.25 * hu }, { x: L.ank.x + 0.3 * hu, y: L.ank.y - 0.38 * hu }], wf, shadowOf(dhoti, 0.7), 0.2, 0.2, null);
      });
      // front pleats (kachha) swinging between the legs
      const pleat = { anchor: R.up(0.25 * hu, (R.LM.waist || 4.8) * hu - 0.2 * hu), segments: 5, length: 1.9 * hu, restAngle: 90 + f * -6, stiffness: 0.5, amp: 9, phase: 2 };
      CAV.stepClothChain(pleat, f < 0 ? 0 : 180, 0.25, R.stepImpulse);
      CAV.drawClothChain(ctx, pleat, { width: 0.42 * hu, endWidth: 0.55 * hu, fill: dhoti, border: { color: 'gold', width: 0.07 * hu }, folds: 2, figureHeight: o.h, inkWidth: wc * 0.45, twist: false });
      // gold waist belt
      const wb = [R.up(-0.55 * hu, (R.LM.waist || 4.8) * hu - 0.1 * hu), R.up(0.5 * hu, (R.LM.waist || 4.8) * hu - 0.05 * hu)];
      CAV.drawTaperedStroke(ctx, wb, 0.2 * hu, 'gold', 0.9, 0.9, null); CAV.drawTaperedStroke(ctx, wb.map(p => ({ x: p.x, y: p.y + 0.09 * hu })), 0.06 * hu, 'gold_deep', 0.9, 0.9, null);
      // uttariya band across the chest
      const band = [R.up(-0.5 * hu, R.sh), R.up(0.05 * hu, R.sh - 0.7 * hu), R.up(0.55 * hu, R.sh - 1.5 * hu)];
      CAV.drawTaperedStroke(ctx, band, 0.42 * hu, sash, 0.8, 0.6, 1.4); CAV.drawTaperedStroke(ctx, band.map(p => ({ x: p.x + 0.03 * hu, y: p.y + 0.16 * hu })), 0.06 * hu, 'gold', 0.8, 0.6, null);
      // neck + head
      CAV.celShade(ctx, neckShape, skin, null, key, 0.15 * hu); parts.push(neckShape);
      CAV.celShade(ctx, headShape, skin, null, key, 0.22 * hu); parts.push(headShape);
      // hair mass + top-knot (rim-lit along the top)
      const b = -f; // back of the head
      const hair = (g) => { g.moveTo(headC.x + f * 0.22 * hu, headC.y - 0.4 * hu); g.bezierCurveTo(headC.x + b * 0.2 * hu, headC.y - 0.72 * hu, headC.x + b * 0.62 * hu, headC.y - 0.2 * hu, headC.x + b * 0.34 * hu, headC.y + 0.44 * hu); g.lineTo(headC.x + b * 0.08 * hu, headC.y + 0.1 * hu); g.lineTo(headC.x + f * 0.1 * hu, headC.y - 0.22 * hu); g.closePath(); g.moveTo(headC.x + b * 0.22 * hu + 0.18 * hu, headC.y - 0.62 * hu); g.arc(headC.x + b * 0.22 * hu, headC.y - 0.62 * hu, 0.18 * hu, 0, TAU); };
      CAV.celShade(ctx, hair, 'hair', false); parts.push(hair);
      CAV.drawTaperedStroke(ctx, [{ x: headC.x + b * 0.36 * hu, y: headC.y - 0.62 * hu }, { x: headC.x + b * 0.08 * hu, y: headC.y - 0.6 * hu }], 0.07 * hu, 'gold', 0.8, 0.8, null);
      // nose bump + face hints at this scale: eye with flick toward the ear, brow, tilak
      const nose = (g) => CAV.polyPath(g, [{ x: headC.x + f * 0.36 * hu, y: headC.y - 0.05 * hu }, { x: headC.x + f * 0.5 * hu, y: headC.y + 0.12 * hu }, { x: headC.x + f * 0.37 * hu, y: headC.y + 0.16 * hu }], true, false);
      CAV.celShade(ctx, nose, 'skin_mid', false); parts.push(nose);
      const ex = headC.x + f * 0.2 * hu, ey = headC.y - 0.02 * hu;
      CAV.drawTaperedStroke(ctx, [{ x: ex + f * 0.08 * hu, y: ey }, { x: ex - f * 0.1 * hu, y: ey - 0.03 * hu }], CAV.weight('face_features.eye_upper_lid', o.h), skinInk, 0.4, 0.2, null);
      CAV.drawTaperedStroke(ctx, [{ x: ex + f * 0.12 * hu, y: ey - 0.13 * hu }, { x: ex - f * 0.1 * hu, y: ey - 0.16 * hu }], CAV.weight('face_features.brow', o.h), 'hair', 0.4, 0.2, null);
      CAV.drawTaperedStroke(ctx, [{ x: headC.x + f * 0.27 * hu, y: headC.y - 0.42 * hu }, { x: headC.x + f * 0.28 * hu, y: headC.y - 0.24 * hu }], 0.05 * hu, 'vermilion', 0.5, 0.5, null);
      CAV.drawTaperedStroke(ctx, [{ x: headC.x + f * 0.3 * hu, y: headC.y + 0.3 * hu }, { x: headC.x + f * 0.2 * hu, y: headC.y + 0.31 * hu }], 0.03 * hu, skinInk, 0.3, 0.3, null);
      // arms in front
      CAV.celShade(ctx, armShape(nearArm), skin, null, key, 0.22 * hu); parts.push(armShape(nearArm));
      limbSides(ctx, nearArm.sh, nearArm.el, 0.36 * hu, 0.27 * hu, wc * 0.8, skinInk); limbSides(ctx, nearArm.el, nearArm.wr, 0.26 * hu, 0.19 * hu, wc * 0.7, skinInk);
      [nearArm, farArm].forEach(A => { // bajuband + kada
        const m = { x: lerp(A.sh.x, A.el.x, 0.35), y: lerp(A.sh.y, A.el.y, 0.35) }, ang = Math.atan2(A.el.y - A.sh.y, A.el.x - A.sh.x) + Math.PI / 2;
        CAV.drawTaperedStroke(ctx, [{ x: m.x - Math.cos(ang) * 0.3 * hu, y: m.y - Math.sin(ang) * 0.3 * hu }, { x: m.x + Math.cos(ang) * 0.3 * hu, y: m.y + Math.sin(ang) * 0.3 * hu }], 0.13 * hu, 'gold', 0.9, 0.9, null);
        const k2 = { x: lerp(A.el.x, A.wr.x, 0.85), y: lerp(A.el.y, A.wr.y, 0.85) };
        CAV.drawTaperedStroke(ctx, [{ x: k2.x - Math.cos(ang) * 0.2 * hu, y: k2.y - Math.sin(ang) * 0.2 * hu }, { x: k2.x + Math.cos(ang) * 0.2 * hu, y: k2.y + Math.sin(ang) * 0.2 * hu }], 0.09 * hu, 'gold', 0.9, 0.9, null);
      });
      // silhouette ink on torso / head (heavier on shadow side)
      const tor = [R.up(0.42 * hu, R.sh), R.up(0.62 * hu, R.sh - 0.9 * hu), R.up(0.48 * hu, (R.LM.waist || 4.8) * hu)];
      CAV.drawTaperedStroke(ctx, tor, wc, skinInk, 0.3, 0.3, 1.6);
      CAV.drawTaperedStroke(ctx, [R.up(-0.55 * hu, R.sh + 0.02 * hu), R.up(-0.7 * hu, R.sh - 0.8 * hu), R.up(-0.52 * hu, (R.LM.waist || 4.8) * hu)], wc, skinInk, 0.3, 0.3, 1.6);
      const hp = []; for (let k = 0; k <= 24; k++) { const a = (f < 0 ? Math.PI : 0) + (k / 24 - 0.5) * Math.PI * 1.15; hp.push({ x: headC.x + Math.cos(a) * 0.4 * hu, y: headC.y + Math.sin(a) * 0.52 * hu }); }
      CAV.drawTaperedStroke(ctx, hp, wc * 0.8, skinInk, 0.2, 0.2, 1.6);
      if (o.pose === 'hold_diya') {
        const hx = (nearArm.wr.x + farArm.wr.x) / 2, hy = Math.min(nearArm.wr.y, farArm.wr.y) - 0.05 * hu;
        o._diya = { x: hx, y: hy };
      }
    });
    // directional rim light crescent over the whole silhouette
    CAV.applyRimLight(ctx, parts, key, F.mood.rim, 0.85, { width: 3, boost: 0.15 });
    if (o._diya) diya(ctx, o._diya.x, o._diya.y, 1.35, F, 7, false);
    return R;
  }

  const FIG = { x: 1420, y: GHAT_TOP + 1, h: 420, facing: -1 };
  function figureParams(F) {
    const p = F.params, pose = p.pose || 'walk';
    return Object.assign({}, FIG, { x: p.figureX != null ? p.figureX : FIG.x, pose, h: p.figureH || FIG.h });
  }

  CAV.registerScenes({
    ghat_dusk: {
      subject(F) { const o = figureParams(F), R = rig(F, o); return { x: R.X, y: R.Y - o.h * 0.45, headY: R.Y - o.h * 0.92, facing: o.facing }; },
      layers: {
        sky: (ctx, F) => skyLayer(ctx, F),
        far_bg: (ctx, F) => farBank(ctx, F),
        far_bg_lights: (ctx, F) => farBankLights(ctx, F),
        mid_bg: (ctx, F) => { river(ctx, F); shikharaReflection(ctx, F, 520, 630, 300, 170); shikhara(ctx, F, 520, 630, 300, 170); },
        mid_bg_lights: (ctx, F) => { riverLights(ctx, F); shikharaLights(ctx, F, 520, 630, 300, 170); },
        action_plane: (ctx, F) => { ghat(ctx, F); ghatLights(ctx, F); drawFigure(ctx, F, figureParams(F)); },
        foreground_frame: (ctx, F) => { if (F.params.arch !== false) archFrame(ctx, F); },
      },
      overlay: (ctx, F) => {
        CAV.particles(ctx, F, { kind: 'petal', count: 14, seed: 3, size: 7 });
        CAV.particles(ctx, F, { kind: 'ember', count: 18, seed: 8, size: 2.2, area: { x: 0, y: 200, w: F.W, h: 880 } });
        if (F.params.lampsBloom) { // reveal on the dramatic pause: every lamp swells
          const p = F.pause ? clamp((F.t - F.pause.start_sec) / Math.max(0.1, F.pause.end_sec - F.pause.start_sec)) : 0;
          if (p > 0) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba(F.mood.key, 0.12 * Math.sin(Math.PI * p)); ctx.fillRect(0, 0, F.W, F.H); ctx.restore(); }
        }
      },
    },

    // ------------------------------------------------------------------------------- dialogue close-up bust
    ghat_closeup: {
      subject(F) { return { x: 1130, y: 560, headY: 430, facing: -1 }; },
      parallax: { far_bg: 0.12, mid_bg: 0.3 },
      layers: {
        sky: (ctx, F) => { skyLayer(ctx, F, { sunX: 160, sunY: 600, clouds: [[700, 220, 1.4], [1500, 120, 1.1]] }); },
        far_bg: (ctx, F) => { ctx.save(); ctx.translate(0, 120); ctx.scale(1, 1); farBank(ctx, F); ctx.restore(); },
        far_bg_lights: (ctx, F) => { // out-of-focus bokeh of the far bank
          const r = rng(31);
          for (let k = 0; k < 34; k++) { const x = r() * 2100 - 100, y = 560 + r() * 130, s = 10 + r() * 22; CAV.glow(ctx, x, y, s * 2.2, k % 3 ? 'diya_flame' : 'gold_glow', 0.35 + 0.25 * noise1(F.tc + k, 4)); ctx.fillStyle = rgba('gold_glow', 0.22); ctx.beginPath(); ctx.arc(x, y, s * 0.7, 0, TAU); ctx.fill(); }
        },
        mid_bg: (ctx, F) => { ctx.save(); ctx.translate(0, 190); river(ctx, F); ctx.restore(); },
        mid_bg_lights: (ctx, F) => { ctx.save(); ctx.translate(0, 190); CAV.reflection(ctx, 160, HORIZON + 4, 110, 420, 'gold_glow', F.tc, { rows: 40, alpha: 0.7, thick: 5 }); ctx.restore(); },
        action_plane: (ctx, F) => drawBust(ctx, F),
        foreground_frame: (ctx, F) => {
          // dark carved pillar edge at frame left + marigold swag across the top-left
          const stone = mix('teal_stone', 'umber_shadow', 0.6);
          const pil = (g) => { g.moveTo(-400, -300); g.lineTo(420, -300); g.bezierCurveTo(400, 200, 380, 600, 400, 1400); g.lineTo(-400, 1400); g.closePath(); };
          CAV.celShade(ctx, pil, stone, false);
          for (let k = 0; k < 9; k++) { // carved bands and a niche on the pillar face
            CAV.drawTaperedStroke(ctx, [[250, 60 + k * 125], [380, 52 + k * 125]], 3, mix(stone, 'gold', 0.3), 0.3, 0.3, null, { boil: false });
            CAV.drawTaperedStroke(ctx, [[262, 80 + k * 125], [370, 74 + k * 125]], 1.4, mix(stone, F.mood.ink, 0.5), 0.3, 0.3, null, { boil: false });
          }
          CAV.applyRimLight(ctx, pil, 0, F.mood.rim, 0.45, { width: 6 });
          ctx.save(); ctx.beginPath(); pil(ctx); ctx.lineWidth = 3; ctx.strokeStyle = c(F.mood.ink); ctx.stroke(); ctx.restore();
          garland(ctx, F, 330, 1250, -10, 150, 0.4);
        },
      },
      overlay: (ctx, F) => {
        CAV.particles(ctx, F, { kind: 'ember', count: 22, seed: 12, size: 2.6 });
        CAV.particles(ctx, F, { kind: 'petal', count: 8, seed: 5, size: 11 });
      },
    },
  });

  // --------------------------------------------------------------------------------------------- the bust
  function drawBust(ctx, F) {
    const s = 300, X = 1180, Y = 430, f = -1, key = F.mood.key_dir_deg, ink = F.S.strokes.ink.skin || F.mood.ink;
    const p = (x, y) => ({ x: X + x * s, y: Y + y * s });
    const q = (x, y) => p(x, y - 0.15); // shoulders/chest sit higher: strong, short neck
    const figH = s * 8, wc = CAV.weight('silhouette_contour', figH, 0.6), wi = CAV.weight('interior_form_lines', figH, 0.4);
    const skin = 'skin_mid', sash = 'saffron';
    const breathe = Math.sin(F.tc * 1.6) * 0.006;
    const face = [[-0.26, -0.37], [-0.335, -0.15], [-0.322, -0.07], [-0.44, 0.12], [-0.355, 0.17], [-0.362, 0.235], [-0.336, 0.262], [-0.346, 0.3], [-0.315, 0.345], [-0.33, 0.42], [-0.26, 0.49], [-0.05, 0.48], [0.13, 0.33], [0.17, 0.06], [0.12, -0.14], [-0.06, -0.31]].map(([x, y]) => p(x, y));
    const faceShape = (g) => CAV.polyPath(g, CAV.catmull(face.concat([face[0]]), 5), true, false);
    const neckShape = (g) => CAV.polyPath(g, [p(-0.21, 0.44), q(-0.27, 0.95), q(0.36, 0.95), p(0.26, 0.26), p(0.1, 0.3)], true, false);
    const torso = [q(-0.26, 0.86), q(-0.52, 1.05), q(-0.72, 1.5), q(-0.8, 2.7), q(1.45, 2.7), q(1.25, 1.25), q(0.98, 1.0 + breathe), q(0.47, 0.84), q(0.3, 0.82)];
    const torsoShape = (g) => CAV.polyPath(g, CAV.catmull(torso, 8), true, false);
    const hairPts = [[-0.27, -0.38], [-0.22, -0.5], [0, -0.58], [0.26, -0.52], [0.43, -0.3], [0.47, 0], [0.42, 0.24], [0.33, 0.44], [0.22, 0.28], [0.18, 0.02], [0.11, -0.15], [-0.08, -0.3]].map(([x, y]) => p(x, y));
    const hairShape = (g) => { CAV.polyPath(g, CAV.catmull(hairPts.concat([hairPts[0]]), 6), true, false); const b = p(0.14, -0.63); g.moveTo(b.x + 0.14 * s, b.y); g.arc(b.x, b.y, 0.14 * s, 0, TAU); };

    // hair strands & uttariya tail stream to the right (wind from the light side)
    const strands = [0, 1, 2, 3, 4].map(k => ({ anchor: p(0.36 + k * 0.025, -0.15 + k * 0.13), segments: 5, length: s * (0.32 + 0.06 * (k % 3)), restAngle: 100, stiffness: 0.3, amp: 18, phase: k * 0.9, waveSpeed: 1.4 }));
    strands.forEach(ch => CAV.stepClothChain(ch, 12, 0.55, 0));
    const tail = { anchor: q(1.0, 0.98), segments: 9, length: s * 1.45, restAngle: 70, stiffness: 0.1, amp: 16, phase: 0.3 };
    CAV.stepClothChain(tail, 5, 0.7, 0);

    const parts = [faceShape, neckShape, torsoShape, hairShape];
    CAV.withBoil(() => {
      CAV.drawClothChain(ctx, tail, { width: s * 0.36, endWidth: s * 0.12, fill: sash, border: { color: 'gold', width: s * 0.05, inner: 'gold_deep' }, folds: 3, figureHeight: figH });
      strands.forEach(ch => CAV.drawTaperedStroke(ctx, ch.points, s * 0.06, 'hair', 0.9, 0.05, 1.6));
      CAV.celShade(ctx, torsoShape, skin, null, key, s * 0.42);
      // pecs / deltoid wedges + clavicle
      CAV.drawTaperedStroke(ctx, [q(-0.42, 1.18), q(0.1, 1.42), q(0.6, 1.3)], wi * 1.2, ink, 0.2, 0.2, 1.6);
      CAV.drawTaperedStroke(ctx, [q(-0.15, 0.98), q(0.25, 1.02), q(0.6, 0.98)], wi, shadowOf(skin, 0.6), 0.2, 0.2, null);
      CAV.drawTaperedStroke(ctx, [q(0.72, 1.05), q(0.82, 1.4), q(0.75, 1.75)], wi, ink, 0.2, 0.2, 1.6);
      CAV.celShade(ctx, neckShape, skin, null, key, s * 0.16);
      CAV.drawTaperedStroke(ctx, [q(0.05, 0.62), q(0.12, 0.8)], wi * 0.8, shadowOf(skin, 0.6), 0.2, 0.2, null); // sternocleidomastoid
      // rudraksha + gold chain
      for (let k = 0; k <= 16; k++) { const u = k / 16, bx = lerp(-0.18, 0.4, u), by = 0.9 + Math.sin(Math.PI * u) * 0.32; const bd = q(bx, by); ctx.fillStyle = c(k % 4 ? "rust_shadow" : "gold"); ctx.beginPath(); ctx.arc(bd.x, bd.y, 6.5, 0, TAU); ctx.fill(); ctx.fillStyle = rgba("gold_glow", 0.5); ctx.beginPath(); ctx.arc(bd.x - 2, bd.y - 2, 2, 0, TAU); ctx.fill(); }
      const pend = q(0.12, 1.27); ctx.fillStyle = c('gold'); ctx.beginPath(); ctx.ellipse(pend.x, pend.y, 12, 17, 0, 0, TAU); ctx.fill(); ctx.fillStyle = c('vermilion'); ctx.beginPath(); ctx.arc(pend.x, pend.y, 5, 0, TAU); ctx.fill();
      // uttariya over the near shoulder
      const drape = (g) => CAV.polyPath(g, CAV.catmull([q(0.5, 0.86), q(0.95, 0.92), q(1.25, 1.2), q(1.35, 2.2), q(0.85, 2.2), q(0.82, 1.45), q(0.62, 1.05), q(0.5, 0.86)], 8), true, false);
      CAV.celShade(ctx, drape, sash, null, key, s * 0.2);
      CAV.drawTaperedStroke(ctx, CAV.catmull([q(0.5, 0.88), q(0.62, 1.07), q(0.82, 1.47), q(0.85, 2.2)], 8), s * 0.05, 'gold', 0.6, 0.9, null);
      for (let k = 0; k < 3; k++) CAV.drawTaperedStroke(ctx, [q(0.9 + k * 0.08, 1.0), q(1.0 + k * 0.1, 1.5), q(1.02 + k * 0.1, 2.1)], CAV.weight('fabric_fold_lines', figH), shadowOf(sash, 0.7), 0.15, 0.1, 1.6);
      CAV.drawTaperedStroke(ctx, CAV.catmull([q(0.5, 0.86), q(0.95, 0.92), q(1.25, 1.2), q(1.35, 2.2)], 8), wc, F.mood.ink, 0.3, 0.3, 1.6);
      // face, cel-shaded with a crescent toward the ear
      CAV.celShade(ctx, faceShape, skin, null, key, s * 0.17);
      // hair mass + top-knot with gold band; strand flicks at the silhouette
      CAV.celShade(ctx, hairShape, 'hair', mix('hair', F.mood.shadow_tint, 0.3), key, s * 0.08);
      const band = p(0.14, -0.63); CAV.drawTaperedStroke(ctx, [{ x: band.x - 0.13 * s, y: band.y + 0.06 * s }, { x: band.x + 0.12 * s, y: band.y + 0.07 * s }], s * 0.04, 'gold', 0.9, 0.9, null);
      for (let k = 0; k < 9; k++) { const a = -2.6 + k * 0.35, r0 = 0.5, q0 = p(0.08 + Math.cos(a) * r0 * 0.8, -0.1 + Math.sin(a) * r0), q1 = { x: q0.x + Math.cos(a + 0.6) * s * 0.07, y: q0.y + Math.sin(a + 0.6) * s * 0.07 }; CAV.drawTaperedStroke(ctx, [q0, q1], CAV.weight('hair_strands', figH, 0.8), lightOf('hair', 0.25), 0.8, 0.05, null); }
      // ear + earring (damped pendulum)
      CAV.drawTaperedStroke(ctx, CAV.catmull([p(0.1, -0.06), p(0.19, -0.07), p(0.2, 0.06), p(0.14, 0.13)], 4), wi * 1.3, ink, 0.3, 0.4, 1.6);
      const lobe = p(0.14, 0.13), ea = 0.18 * Math.sin(F.tc * 3.1) + 0.05;
      ctx.save(); ctx.translate(lobe.x, lobe.y); ctx.rotate(ea); ctx.strokeStyle = c('gold'); ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0.07 * s, 0.065 * s, 0, TAU); ctx.stroke(); ctx.fillStyle = c('gold_glow'); ctx.beginPath(); ctx.arc(-0.03 * s, 0.03 * s, 3, 0, TAU); ctx.fill(); ctx.restore();
      // brow, eye (almond, heavy upper lid with flick, half-lidded), nose, tilak
      const blink = (F.ic % 60) >= 56; // blink every 2.5 s, on twos
      CAV.drawTaperedStroke(ctx, CAV.catmull([p(-0.3, -0.125), p(-0.22, -0.15), p(-0.12, -0.155)], 4), CAV.weight('face_features.brow', figH) * 1.1, 'hair', 0.5, 0.15, null);
      const e0 = p(-0.275, -0.035), e1 = p(-0.145, -0.055), em = p(-0.21, -0.065);
      if (!blink) {
        ctx.fillStyle = mix('jasmine', F.mood.shadow_tint, 0.18);
        ctx.beginPath(); ctx.moveTo(e0.x, e0.y); ctx.quadraticCurveTo(em.x, em.y - 6, e1.x, e1.y); ctx.quadraticCurveTo(em.x, e0.y + 14, e0.x, e0.y); ctx.fill();
        ctx.save(); ctx.clip(); ctx.fillStyle = c('hair'); ctx.beginPath(); ctx.arc(em.x - 8, em.y + 6, 10, 0, TAU); ctx.fill(); ctx.fillStyle = rgba('diya_core', 0.9); ctx.beginPath(); ctx.arc(em.x - 11, em.y + 3, 2.4, 0, TAU); ctx.fill(); ctx.restore();
        CAV.drawTaperedStroke(ctx, [e0, { x: em.x, y: em.y - 3 }, e1, { x: e1.x + 0.05 * s, y: e1.y - 0.035 * s }], CAV.weight('face_features.eye_upper_lid', figH), 'hair', 0.5, 0.1, null);
        CAV.drawTaperedStroke(ctx, [{ x: e0.x + 8, y: e0.y + 7 }, { x: em.x, y: e0.y + 11 }], CAV.weight('face_features.lashes', figH), ink, 0.2, 0.2, null, { alpha: 0.6 });
      } else {
        CAV.drawTaperedStroke(ctx, [e0, { x: em.x, y: e0.y + 6 }, e1, { x: e1.x + 0.05 * s, y: e1.y - 0.02 * s }], CAV.weight('face_features.eye_upper_lid', figH), 'hair', 0.5, 0.1, null);
      }
      CAV.drawTaperedStroke(ctx, [p(-0.37, 0.12), p(-0.35, 0.145), p(-0.31, 0.14)], CAV.weight('face_features.nose', figH) * 1.6, ink, 0.2, 0.4, null);
      CAV.drawTaperedStroke(ctx, [p(-0.255, -0.36), p(-0.262, -0.22)], s * 0.03, 'vermilion', 0.4, 0.3, null);
      CAV.drawTaperedStroke(ctx, [p(-0.272, -0.36), p(-0.276, -0.26)], s * 0.009, 'gold', 0.4, 0.3, null);
      // lip-synced mouth (3/4 view: frontal shape compressed toward the far corner)
      const m = p(-0.3, 0.27);
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(-0.06); ctx.scale(0.62, 1);
      CAV.drawLipSyncMouth(ctx, F.S, F.mouth, { mood: 'serene', size: s * 0.17, viseme: F.viseme });
      ctx.restore();
      // silhouette contours, heavier on the shadow side
      CAV.drawTaperedStroke(ctx, CAV.catmull(face.slice(0, 13), 4), wc, ink, 0.25, 0.4, 1.6);
      CAV.drawTaperedStroke(ctx, [p(-0.21, 0.47), q(-0.26, 0.9)], wc, ink, 0.4, 0.2, 1.6);
      CAV.drawTaperedStroke(ctx, CAV.catmull(torso.slice(0, 4), 8), wc * 1.1, ink, 0.3, 0.2, 1.6);
      CAV.drawTaperedStroke(ctx, CAV.catmull(hairPts.slice(0, 8), 6), wc * 0.9, mix('hair', ink, 0.5), 0.3, 0.3, 1.6);
    });
    // crisp warm rim on everything that faces the low sun (face profile, throat, chest, hair crown)
    CAV.applyRimLight(ctx, parts, key, F.mood.rim, 1, { width: 5, boost: 0.3 });
    // practical glow from the diya below frame on the jaw (warm bounce)
    CAV.glow(ctx, p(-0.4, 0.9).x, p(-0.4, 0.9).y, s * 0.9, 'diya_flame', 0.18);
  }
})();
