/* custom-animated-video — in-browser canvas runtime (style-agnostic).
 *
 * Loaded into a headless Chromium page by render_frames.js. Exposes the global `CAV`:
 *   shader primitives   drawTaperedStroke, applyRimLight, celShade, stepClothChain, drawClothChain,
 *                       drawLipSyncMouth, applyPostProcessing
 *   scene helpers       paintSky, glow, particles, reflection, inkShape, limb, chipped, haze colours, palette lookup
 *   director rig        camera presets, 5-layer parallax, transitions, subtitles, frame driver
 * Nothing in this file knows about any particular visual style: every colour, weight, taper, grain, bloom and
 * cadence value comes from the normalized style bible handed to CAV.init().
 */
(function () {
  'use strict';
  const CAV = (window.CAV = window.CAV || {});
  const TAU = Math.PI * 2;
  const LAYERS = ['sky', 'far_bg', 'mid_bg', 'action_plane', 'foreground_frame'];
  CAV.LAYERS = LAYERS;

  // ============================================================================================ math / random
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = {
    linear: t => t,
    easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInSine: t => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: t => Math.sin((t * Math.PI) / 2),
    easeInOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInCubic: t => t * t * t,
    easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(...n) { // deterministic 0..1 from numbers
    let h = 2166136261;
    for (const v of n) { h ^= Math.floor(v * 1000) | 0; h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function noise1(x, seed = 0) { // smooth value noise
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
  }
  Object.assign(CAV, { clamp, lerp, smoothstep, ease, rng: mulberry32, hash, noise1, TAU });

  // ================================================================================================== colour
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const toHex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  /** Resolve a palette name, "mood.<field>", gradient stop ("dusk[2]") or raw CSS colour to a hex/CSS string. */
  function c(name) {
    if (name == null) return '#ff00ff';
    if (typeof name !== 'string') return name;
    if (name[0] === '#' || name.startsWith('rgb') || name.startsWith('hsl')) return name;
    const S = CAV.style;
    if (name.startsWith('mood.')) return c(CAV.mood[name.slice(5)]);
    if (name.startsWith('ink.')) return S.strokes.ink[name.slice(4)] || S.strokes.ink.default;
    const g = name.match(/^(\w+)\[(\d+)\]$/);
    if (g && S.gradients[g[1]]) return S.gradients[g[1]][Math.min(+g[2], S.gradients[g[1]].length - 1)];
    if (S.palette[name]) return S.palette[name];
    return name;
  }
  const rgb = col => hexToRgb(c(col));
  function mix(a, b, t) { const A = rgb(a), B = rgb(b); return toHex([0, 1, 2].map(i => lerp(A[i], B[i], t))); }
  function rgba(col, a) { const [r, g, b] = rgb(col); return `rgba(${r},${g},${b},${a})`; }
  function lum(col) { const [r, g, b] = rgb(col).map(v => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  /** Coloured cel shadow: local colour mixed toward the mood shadow tint (35–55 %) and multiplied down a touch. */
  function shadowOf(col, amt = 0.45, tint) {
    const T = rgb(tint || CAV.mood.shadow_tint), B = rgb(col);
    const mul = B.map((v, i) => (v * T[i]) / 255);
    return toHex(B.map((v, i) => lerp(v, lerp(T[i], mul[i], 0.5), amt)));
  }
  function lightOf(col, amt = 0.35, light) { return mix(col, light || CAV.mood.key, amt); }
  function sampleGradient(stops, t) {
    stops = Array.isArray(stops) ? stops : CAV.style.gradients[stops] || [stops, stops];
    if (stops.length === 1) return c(stops[0]);
    const x = clamp(t) * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2);
    return mix(stops[i], stops[i + 1], x - i);
  }
  Object.assign(CAV, { c, mix, rgba, rgb, lum, shadowOf, lightOf, sampleGradient, hexToRgb, toHex });

  // ================================================================================================ geometry
  const P = p => (Array.isArray(p) ? { x: p[0], y: p[1] } : p);
  function catmull(points, spacing = 3) {
    const pts = points.map(P);
    if (pts.length < 3) {
      if (pts.length === 2) {
        const n = Math.max(2, Math.ceil(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) / spacing));
        return Array.from({ length: n + 1 }, (_, i) => ({ x: lerp(pts[0].x, pts[1].x, i / n), y: lerp(pts[0].y, pts[1].y, i / n) }));
      }
      return pts;
    }
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  /** Deterministic chipped/wobbly edge for architecture (static: seeded by geometry, never boils). */
  function chipped(points, amp = 1, seed = 1, step = 14) {
    const pts = points.map(P), out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(L / step));
      const nx = -(b.y - a.y) / (L || 1), ny = (b.x - a.x) / (L || 1);
      for (let k = 0; k < n; k++) {
        const t = k / n, j = k === 0 ? 0 : (hash(a.x + t * 7, a.y, seed) - 0.5) * 2 * amp;
        out.push({ x: lerp(a.x, b.x, t) + nx * j, y: lerp(a.y, b.y, t) + ny * j });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  /** Tapered capsule path (limb) from a to b with radii r1 -> r2. Builds the path only. */
  function limb(ctx, a, b, r1, r2, begin = true) {
    a = P(a); b = P(b);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (begin) ctx.beginPath();
    ctx.arc(a.x, a.y, r1, ang + Math.PI / 2, ang - Math.PI / 2);
    ctx.arc(b.x, b.y, r2, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
  }
  function polyPath(ctx, pts, close = true, begin = true) {
    pts = pts.map(P);
    if (begin) ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (close) ctx.closePath();
  }
  Object.assign(CAV, { catmull, chipped, limb, polyPath, P });

  // ========================================================================================= light direction
  /** Key light direction for an angle in degrees, screen space (0 = right, 90 = down, 270 = up), pointing FROM the
   *  subject TOWARD the light. Matches style bibles' `key_dir_deg`. */
  function lightVec(deg) { const r = (deg * Math.PI) / 180; return { x: Math.cos(r), y: Math.sin(r) }; }
  /** Same vector expressed in the current ctx's local coordinates (handles flips / rotations / scales). */
  function localLight(ctx, deg) {
    const L = lightVec(deg), m = ctx.getTransform();
    const det = m.a * m.d - m.b * m.c || 1;
    const x = (m.d * L.x - m.c * L.y) / det, y = (-m.b * L.x + m.a * L.y) / det;
    const n = Math.hypot(x, y) || 1;
    return { x: x / n, y: y / n };
  }
  CAV.lightVec = lightVec; CAV.localLight = localLight;

  // ================================================================================== 1. drawTaperedStroke
  /**
   * Variable-width ink ribbon. Swells toward `peak_position`, tapers to `taperStart`/`taperEnd` × width at the tips,
   * round caps. `shadowBias` thickens the side facing away from the key light (style default 1.6×) and thins the lit
   * side; pass a number (multiplier, current mood light), {factor, keyAngleDeg, lit} or null/0 for symmetric.
   * points: [[x,y]...] or [{x,y}...] in the ctx's current coordinates. opts: {boil, closed, smooth, alpha, spacing,
   * profile:(s)=>0..1, minWidth}
   */
  function drawTaperedStroke(ctx, points, baseWidth, color, taperStart, taperEnd, shadowBias, opts = {}) {
    if (!points || points.length < 2) return;
    const S = CAV.style, tp = S.strokes.taper;
    taperStart = taperStart == null ? tp.end_ratio : taperStart;
    taperEnd = taperEnd == null ? tp.end_ratio : taperEnd;
    const peak = opts.peak == null ? tp.peak_position : opts.peak;
    let pts = points.map(P);
    const boil = opts.boil == null ? CAV._boil : opts.boil;
    if (boil) {
      const amp = (opts.boilAmp != null ? opts.boilAmp : CAV._boilAmp) / Math.sqrt(Math.abs(ctx.getTransform().a * ctx.getTransform().d) || 1);
      const s0 = pts[0].x * 0.37 + pts[0].y * 0.61;
      pts = pts.map((p, i) => ({
        x: p.x + (hash(CAV._boilSeed, i, s0) - 0.5) * 2 * amp,
        y: p.y + (hash(CAV._boilSeed, i, s0 + 9.1) - 0.5) * 2 * amp,
      }));
    }
    if (opts.closed) pts = pts.concat([pts[0], pts[1]]);
    if (opts.smooth !== false) pts = catmull(pts, opts.spacing || 2.5);
    const n = pts.length;
    if (n < 2) return;
    // arc length
    const acc = [0];
    for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = acc[n - 1] || 1;
    // light-aware side bias
    let factor = 1, litF = 1, L = null;
    if (shadowBias) {
      const sb = typeof shadowBias === 'number' ? { factor: shadowBias } : shadowBias;
      factor = sb.factor || S.strokes.shadow_side_multiplier || 1.6;
      litF = sb.lit != null ? sb.lit : S.strokes.lit_side_multiplier || 0.75;
      L = localLight(ctx, sb.keyAngleDeg != null ? sb.keyAngleDeg : CAV.mood.key_dir_deg);
    }
    const prof = opts.profile || (s => {
      if (opts.closed) return 0.85 + 0.15 * Math.sin(s * TAU * 2 + 1.3);
      return s < peak ? taperStart + (1 - taperStart) * ease.easeOutSine(s / peak)
        : taperEnd + (1 - taperEnd) * ease.easeOutSine((1 - s) / (1 - peak));
    });
    const minW = opts.minWidth != null ? opts.minWidth : 0.35;
    const left = [], right = [], hw = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const w = Math.max(minW, baseWidth * prof(acc[i] / total)) / 2;
      let wl = w, wr = w;
      if (L) {
        const s = -(nx * L.x + ny * L.y); // >0: left normal faces away from light (shadow side)
        wl = w * (s > 0 ? 1 + (factor - 1) * s : 1 - (1 - litF) * -s);
        wr = w * (s < 0 ? 1 + (factor - 1) * -s : 1 - (1 - litF) * s);
      }
      left.push({ x: pts[i].x + nx * wl, y: pts[i].y + ny * wl });
      right.push({ x: pts[i].x - nx * wr, y: pts[i].y - ny * wr });
      hw.push((wl + wr) / 2);
    }
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.composite) ctx.globalCompositeOperation = opts.composite;
    ctx.fillStyle = c(color);
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    const e = pts[n - 1], ea = Math.atan2(left[n - 1].y - e.y, left[n - 1].x - e.x);
    ctx.arc(e.x, e.y, Math.max(0.1, hw[n - 1]), ea, ea - Math.PI, true); // round end cap
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    const s0 = pts[0], sa = Math.atan2(right[0].y - s0.y, right[0].x - s0.x);
    ctx.arc(s0.x, s0.y, Math.max(0.1, hw[0]), sa, sa - Math.PI, true); // round start cap
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  CAV.drawTaperedStroke = drawTaperedStroke;

  /** Style line weight for a category ("silhouette_contour", "fabric_fold_lines", "face_features.brow" ...),
   *  scaled by figure height per the style's rule. t picks between min and max. */
  function weight(kind, figureHeight, t = 0.5) {
    const S = CAV.style.strokes; let w = S.weights_px;
    for (const k of kind.split('.')) w = w && w[k];
    let px = typeof w === 'number' ? w : w && w.min != null ? lerp(w.min, w.max, t) : 1.5;
    if (figureHeight) px *= clamp(figureHeight / (S.reference_figure_height_px || 600), S.scale_clamp[0], S.scale_clamp[1]);
    return px;
  }
  CAV.weight = weight;

  // ======================================================================================= offscreen pooling
  const pool = {};
  function off(name) {
    const W = CAV._canvas.width, H = CAV._canvas.height;
    let o = pool[name];
    if (!o || o.canvas.width !== W || o.canvas.height !== H) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      o = pool[name] = { canvas: cv, ctx: cv.getContext('2d', { willReadFrequently: name.startsWith('px') }) };
    }
    o.ctx.setTransform(1, 0, 0, 1, 0, 0);
    o.ctx.globalAlpha = 1; o.ctx.globalCompositeOperation = 'source-over'; o.ctx.filter = 'none';
    o.ctx.clearRect(0, 0, W, H);
    return o;
  }
  CAV.offscreen = off;

  /** Paint a silhouette mask. fn may be one path builder or an ARRAY of builders: each is filled on its own, so
   *  overlapping parts union cleanly (a single path with mixed winding would punch holes and light internal edges). */
  function silhouetteMask(ctx, fn, name) {
    const o = off(name), m = ctx.getTransform();
    o.ctx.setTransform(m);
    o.ctx.fillStyle = '#fff'; o.ctx.strokeStyle = '#fff';
    for (const f of Array.isArray(fn) ? fn : [fn]) { o.ctx.beginPath(); const rule = f(o.ctx); o.ctx.fill(rule === 'evenodd' ? 'evenodd' : 'nonzero'); }
    o.ctx.setTransform(1, 0, 0, 1, 0, 0);
    return o;
  }

  // ============================================================================================ 2. rim light
  /**
   * Crisp directional rim crescent on the light-facing edge of a silhouette, composited with `screen`.
   * drawSilhouetteFn(ctx) builds the silhouette path (it will be filled; return 'evenodd' to use that rule), or pass an
   * array of builders to union several parts. Offset 3–5 px toward the key light.
   * opts: {width: px (default 4), soften: px blur, composite: 'screen', boost: extra 'lighter' pass 0..1}
   */
  function applyRimLight(ctx, drawSilhouetteFn, keyAngleDeg, rimColor, intensity = 1, opts = {}) {
    const dpr = CAV._pxScale || 1;
    const deg = keyAngleDeg == null ? CAV.mood.key_dir_deg : keyAngleDeg;
    const L = lightVec(deg), d = (opts.width != null ? opts.width : 4) * dpr;
    const A = silhouetteMask(ctx, drawSilhouetteFn, 'rimA');
    const R = off('rimB');
    R.ctx.drawImage(A.canvas, 0, 0);
    R.ctx.globalCompositeOperation = 'destination-out';
    R.ctx.drawImage(A.canvas, -L.x * d, -L.y * d); // keep only pixels whose light-ward neighbour is outside
    R.ctx.globalCompositeOperation = 'source-in';
    R.ctx.fillStyle = c(rimColor || CAV.mood.rim);
    R.ctx.fillRect(0, 0, R.canvas.width, R.canvas.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (opts.soften) ctx.filter = `blur(${opts.soften * dpr}px)`;
    ctx.globalCompositeOperation = opts.composite || 'screen';
    ctx.globalAlpha = clamp(intensity, 0, 1);
    ctx.drawImage(R.canvas, 0, 0);
    if (opts.boost) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(intensity * opts.boost); ctx.drawImage(R.canvas, 0, 0); }
    ctx.restore();
  }
  CAV.applyRimLight = applyRimLight;

  /**
   * Hard-edged 2-tone cel shading: base fill + a coloured shadow crescent = shape minus itself shifted toward the
   * light by `offset` (px, or fraction of bbox width when < 1). drawFn builds the path.
   */
  function celShade(ctx, drawFn, base, shadow, keyAngleDeg, offset = 0.1, opts = {}) {
    const deg = keyAngleDeg == null ? CAV.mood.key_dir_deg : keyAngleDeg;
    ctx.save();
    ctx.fillStyle = c(base);
    for (const f of Array.isArray(drawFn) ? drawFn : [drawFn]) { ctx.beginPath(); const rule = f(ctx); ctx.fill(rule === 'evenodd' ? 'evenodd' : 'nonzero'); }
    ctx.restore();
    if (shadow === false) return;
    const sh = shadow ? c(shadow) : shadowOf(base, opts.amount);
    const m = ctx.getTransform(), sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const dpx = offset < 1 ? offset * (opts.width || 100) * sc : offset * sc;
    const L = lightVec(deg);
    const A = silhouetteMask(ctx, drawFn, 'celA');
    const B = off('celB');
    B.ctx.drawImage(A.canvas, 0, 0);
    B.ctx.globalCompositeOperation = 'destination-out';
    B.ctx.drawImage(A.canvas, L.x * dpx, L.y * dpx);
    B.ctx.globalCompositeOperation = 'source-in';
    B.ctx.fillStyle = sh; B.ctx.fillRect(0, 0, B.canvas.width, B.canvas.height);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= opts.alpha == null ? 1 : opts.alpha;
    ctx.drawImage(B.canvas, 0, 0); ctx.restore();
  }
  CAV.celShade = celShade;

  // ========================================================================================= 3. cloth chain
  /**
   * Multi-segment travelling-sine-wave cloth/hair. State-free (a pure function of chain.t), so frames can be rendered
   * in any order or in parallel. chain = {anchor:{x,y}, segments, length, restAngle (deg, 90 = hanging down),
   * stiffness 0..1, amp (deg), waveCount, waveSpeed, phase, t}. windAngle deg (screen), windStrength 0..1,
   * stepImpulse 0..1 (walk/footfall kick). Writes chain.points (segments+1) and chain.twist (per point, -1..1).
   */
  function stepClothChain(chain, windAngle = 180, windStrength = 0.4, stepImpulse = 0) {
    const M = CAV.style.motion_rules.cloth || {};
    const n = chain.segments || M.segments || 8;
    const segLen = (chain.length || 200) / n;
    const t = chain.t != null ? chain.t : CAV.frame ? CAV.frame.tc : 0;
    const damping = chain.damping != null ? chain.damping : M.damping || 0.9;
    const amp = ((chain.amp != null ? chain.amp : 16) * (1.25 - (damping - 0.85) * 2.5) * Math.PI) / 180;
    const count = chain.waveCount || M.wave_count || 1.25, speed = chain.waveSpeed || M.wave_speed || 1.6;
    const phase = chain.phase || 0, stiff = chain.stiffness != null ? chain.stiffness : 0.35;
    const rest = ((chain.restAngle != null ? chain.restAngle : 90) * Math.PI) / 180, wind = (windAngle * Math.PI) / 180;
    const gust = 0.75 + 0.25 * noise1(t * 0.6 + phase, 7);
    const pts = [{ x: chain.anchor.x, y: chain.anchor.y }], twist = [0];
    let x = chain.anchor.x, y = chain.anchor.y;
    for (let k = 0; k < n; k++) {
      const u = (k + 1) / n;
      const w = clamp(windStrength * gust * (0.3 + 0.7 * u) * (1 - stiff * (1 - u)));
      const vx = lerp(Math.cos(rest), Math.cos(wind), w), vy = lerp(Math.sin(rest), Math.sin(wind), w);
      let th = Math.atan2(vy, vx);
      const wave = Math.sin(TAU * (count * u - speed * t) + phase);
      th += amp * Math.pow(u, 1.15) * (0.35 + windStrength) * wave;
      th += stepImpulse * amp * 0.9 * u * Math.sin(TAU * (0.6 * u - 2 * speed * t) + phase * 1.7);
      x += Math.cos(th) * segLen; y += Math.sin(th) * segLen;
      pts.push({ x, y });
      twist.push(Math.cos(TAU * (count * 0.8 * u - speed * t) + phase + 0.6));
    }
    chain.points = pts; chain.twist = twist;
    return pts;
  }
  /** Render a stepped chain as a cel-shaded fabric ribbon with optional zari border band and ink edges. */
  function drawClothChain(ctx, chain, o = {}) {
    const pts = catmull(chain.points, 4);
    const n = pts.length, tw = chain.twist || [];
    const w0 = o.width || 40, w1 = o.endWidth != null ? o.endWidth : w0 * 0.35;
    const L = [], R = [], under = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const s = i / (n - 1), tx2 = s * (tw.length - 1), ti = Math.min(tw.length - 2, Math.floor(tx2)), twv = tw.length > 1 ? lerp(tw[ti], tw[ti + 1], tx2 - ti) : 1;
      const w = lerp(w0, w1, s) * (o.twist === false ? 1 : 0.55 + 0.45 * Math.abs(twv)) / 2;
      L.push({ x: pts[i].x - ty * w, y: pts[i].y + tx * w });
      R.push({ x: pts[i].x + ty * w, y: pts[i].y - tx * w });
      under.push(twv < 0);
    }
    const fill = c(o.fill || 'saffron'), shade = o.shadow ? c(o.shadow) : shadowOf(fill);
    ctx.save();
    // body
    polyPath(ctx, L.concat(R.slice().reverse()));
    ctx.fillStyle = fill; ctx.fill();
    // underside (twisted) panels in shadow colour — hard-edged, cel style
    for (let i = 0; i < n - 1; i++) {
      if (!under[i]) continue;
      polyPath(ctx, [L[i], L[i + 1], R[i + 1], R[i]]); ctx.fillStyle = shade; ctx.fill();
    }
    // shadow half on the side away from light
    const Lv = localLight(ctx, CAV.mood.key_dir_deg);
    const mid = Math.floor(n / 2), nx = L[mid].x - R[mid].x, ny = L[mid].y - R[mid].y;
    const leftIsShadow = nx * Lv.x + ny * Lv.y < 0;
    const edge = leftIsShadow ? L : R, centre = pts;
    polyPath(ctx, edge.map((p, i) => ({ x: lerp(p.x, centre[i].x, 0.55), y: lerp(p.y, centre[i].y, 0.55) }))
      .concat(edge.slice().reverse()));
    ctx.fillStyle = shade; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    if (o.border) { // zari band along the lit edge
      const be = leftIsShadow ? R : L, bw = o.border.width || 8;
      drawTaperedStroke(ctx, be, bw, o.border.color || 'gold', 0.6, 0.3, null, { boil: false });
      if (o.border.inner) drawTaperedStroke(ctx, be.map((p, i) => ({ x: lerp(p.x, centre[i].x, 0.18), y: lerp(p.y, centre[i].y, 0.18) })), bw * 0.45, o.border.inner, 0.6, 0.3, null, { boil: false });
    }
    if (o.folds) { // fold lines radiating from the anchor
      for (let f = 0; f < o.folds; f++) {
        const off = (f + 1) / (o.folds + 1);
        const fl = centre.slice(0, Math.floor(n * (0.5 + 0.4 * hash(f, 3)))).map((p, i) => ({ x: lerp(L[i].x, R[i].x, off), y: lerp(L[i].y, R[i].y, off) }));
        if (fl.length > 2) drawTaperedStroke(ctx, fl, o.foldWidth || weight('fabric_fold_lines', o.figureHeight), o.foldInk || shadowOf(shade, 0.5), 0.15, 0.05);
      }
    }
    if (o.ink !== false) {
      const iw = o.inkWidth || weight('silhouette_contour', o.figureHeight, 0.3);
      drawTaperedStroke(ctx, L, iw, o.ink || CAV.mood.ink, 0.5, 0.15, 1.6);
      drawTaperedStroke(ctx, R, iw, o.ink || CAV.mood.ink, 0.5, 0.15, 1.6);
    }
    ctx.restore();
    return { left: L, right: R, centre: pts };
  }
  CAV.stepClothChain = stepClothChain; CAV.drawClothChain = drawClothChain;

  // ===================================================================================== 4. lip-sync mouth
  /**
   * Style-appropriate mouth at the ctx origin (translate/rotate/scale the ctx to the face first; +x = toward the
   * mouth corner that faces the viewer). mouthState: closed | open_small | open_wide. expression: string
   * (neutral|smile|stern|serene|sad) or {mood, size (mouth width px), viseme, faceless, ink, inner, teeth, lip}.
   */
  function drawLipSyncMouth(ctx, style, mouthState, expression) {
    style = style || CAV.style;
    const ex = typeof expression === 'string' ? { mood: expression } : expression || {};
    if (ex.faceless) return;
    const pal = style.palette, ink = c(ex.ink || style.strokes.ink.skin || style.strokes.ink.default);
    const ff = (style.strokes.weights_px.face_features || {});
    const lw = (ex.lineWidth || ff.lips || 1.2) * (ex.size || 22) / 22 * 1.4;
    const W = ex.size || 22;
    const curve = { smile: -0.22, serene: -0.1, neutral: 0, stern: 0.08, sad: 0.2 }[ex.mood || 'neutral'] || 0;
    const inner = c(ex.inner || pal.maroon_shadow || pal.deep_maroon || mix(ink, '#7a1a1a', 0.5));
    const teeth = c(ex.teeth || pal.jasmine || pal.ivory_cloth || '#f3eee4');
    const lip = c(ex.lip || (pal.skin_shadow_warm ? mix(pal.skin_shadow_warm, pal.petal_red || '#c0504a', 0.25) : '#8a4a3a'));
    const vis = ex.viseme;
    ctx.save();
    const cy = W * curve; // corners' vertical offset (negative = up)
    if (mouthState === 'closed' || !mouthState) {
      const press = vis === 'MBP' ? 1.35 : 1;
      drawTaperedStroke(ctx, [[-W / 2, cy], [-W / 6, 1], [W / 6, 1], [W / 2, cy]], lw * press, ink, 0.25, 0.25, null);
      drawTaperedStroke(ctx, [[-W / 5, W * 0.28], [0, W * 0.32], [W / 5, W * 0.28]], lw * 0.8, lip, 0.2, 0.2, null);
    } else {
      const wide = mouthState === 'open_wide';
      const round = vis === 'O' ? 0.72 : 1, fv = vis === 'FV';
      const hw = (W / 2) * (wide ? 0.95 : 0.78) * round;
      const h = W * (wide ? 0.55 : 0.26) * (vis === 'O' ? 1.15 : 1) * (fv ? 0.6 : 1);
      ctx.beginPath();
      ctx.moveTo(-hw, cy * 0.8);
      ctx.bezierCurveTo(-hw * 0.5, -h * 0.25 + cy * 0.3, hw * 0.5, -h * 0.25 + cy * 0.3, hw, cy * 0.8);
      ctx.bezierCurveTo(hw * 0.6, h * 1.05, -hw * 0.6, h * 1.05, -hw, cy * 0.8);
      ctx.closePath();
      ctx.fillStyle = inner; ctx.fill();
      ctx.save(); ctx.clip();
      if (wide && !fv) { ctx.fillStyle = teeth; ctx.fillRect(-hw, -h, hw * 2, h * 0.62); }
      ctx.fillStyle = mix(inner, pal.petal_red || '#c4504a', 0.35);
      ctx.beginPath(); ctx.ellipse(0, h * 0.85, hw * 0.55, h * 0.4, 0, 0, TAU); ctx.fill();
      ctx.restore();
      drawTaperedStroke(ctx, [[-hw * 1.08, cy * 0.8], [-hw * 0.4, -h * 0.2], [hw * 0.4, -h * 0.2], [hw * 1.08, cy * 0.8]], lw, ink, 0.25, 0.25, null);
      drawTaperedStroke(ctx, [[-hw * 0.5, h * 0.98 + 2], [0, h * 1.08 + 2], [hw * 0.5, h * 0.98 + 2]], lw * 0.75, lip, 0.2, 0.2, null);
    }
    ctx.restore();
  }
  CAV.drawLipSyncMouth = drawLipSyncMouth;

  // =========================================================================================== scene helpers
  /** Posterised vertical sky gradient (printed feel). stops: gradient name or hex list. */
  function paintSky(ctx, stops, x, y, w, h, o = {}) {
    const steps = o.steps || 9;
    stops = stops || CAV.mood.sky;
    for (let i = 0; i < steps; i++) {
      ctx.fillStyle = sampleGradient(stops, o.reverse ? 1 - (i + 0.5) / steps : (i + 0.5) / steps);
      ctx.fillRect(x, y + (h * i) / steps - 0.5, w, h / steps + 1);
    }
  }
  function glow(ctx, x, y, r, color, intensity = 1, op = 'screen') {
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, 0.9 * intensity)); g.addColorStop(0.25, rgba(color, 0.45 * intensity));
    g.addColorStop(1, rgba(color, 0));
    ctx.globalCompositeOperation = op; ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }
  /** Long broken vertical reflection column on water under a light source. */
  function reflection(ctx, x, yTop, width, length, color, t = 0, o = {}) {
    const rows = o.rows || Math.max(6, Math.floor(length / 9));
    ctx.save(); ctx.globalCompositeOperation = o.op || 'screen';
    for (let r = 0; r < rows; r++) {
      const s = r / rows, y = yTop + s * length;
      const jitter = noise1(r * 0.7 + t * 3, x) * width * 0.6;
      const w = width * (0.45 + s * 0.9) * (0.5 + 0.5 * hash(r, Math.floor(t * 12), x));
      ctx.globalAlpha = (1 - s) * (o.alpha || 0.8);
      ctx.fillStyle = c(color);
      ctx.fillRect(x - w / 2 + jitter, y, w, Math.max(1.2, (o.thick || 3) * (1 - s * 0.5)));
    }
    ctx.restore();
  }
  /** Deterministic drifting particles (petals / embers / dust / rain). Uses on-twos time. area = {x,y,w,h}. */
  function particles(ctx, F, o = {}) {
    const kind = o.kind || 'petal', count = o.count || 20, area = o.area || { x: 0, y: 0, w: F.W, h: F.H };
    const t = o.t != null ? o.t : F.tc, seed = o.seed || 1;
    const cols = (o.colors || (kind === 'ember' ? ['gold_glow', 'diya_flame'] : ['petal_red', 'marigold', 'jasmine'])).map(c);
    const vx = o.vx != null ? o.vx : kind === 'rain' ? -60 : -18, vy = o.vy != null ? o.vy : kind === 'ember' ? -26 : kind === 'rain' ? 900 : 14;
    ctx.save();
    for (let k = 0; k < count; k++) {
      const r = mulberry32(seed * 7919 + k * 104729);
      const x0 = r() * area.w, y0 = r() * area.h, sp = 0.6 + r() * 0.8, sz = (o.size || (kind === 'petal' ? 9 : 3)) * (0.6 + r() * 0.8);
      let x = x0 + vx * sp * t + Math.sin(t * (0.8 + r()) + k) * (kind === 'rain' ? 0 : 14);
      let y = y0 + vy * sp * t + Math.cos(t * (0.6 + r()) + k * 1.3) * (kind === 'rain' ? 0 : 8);
      x = area.x + (((x % area.w) + area.w) % area.w); y = area.y + (((y % area.h) + area.h) % area.h);
      const col = cols[k % cols.length], rot = t * (0.6 + r() * 1.4) * (k % 2 ? 1 : -1) + r() * TAU;
      ctx.globalAlpha = (o.alpha || 0.9) * (0.55 + 0.45 * r());
      if (kind === 'petal') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(rot * 1.7)));
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.55, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = shadowOf(col, 0.4); ctx.beginPath(); ctx.ellipse(sz * 0.25, sz * 0.12, sz * 0.6, sz * 0.3, 0, 0, TAU); ctx.fill();
        ctx.restore();
      } else if (kind === 'ember') {
        glow(ctx, x, y, sz * 4, col, 0.5); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, sz * 0.6, 0, TAU); ctx.fill();
      } else if (kind === 'rain') {
        ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + vx * 0.03, y + sz * 9); ctx.stroke();
      } else {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, sz * 0.5, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
  /** Filled + ink-outlined polygon (architecture, props). Edges are separate tapered strokes for a hand-inked feel. */
  function inkShape(ctx, pts, o = {}) {
    pts = pts.map(P);
    if (o.fill) { polyPath(ctx, pts, true); ctx.fillStyle = c(o.fill); ctx.fill(); }
    if (o.ink === false) return;
    const w = o.width || 1.6, ink = o.ink || CAV.mood.ink;
    const closed = o.closed !== false, segs = [];
    if (o.whole) segs.push(closed ? pts.concat([pts[0]]) : pts);
    else for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
    for (const s of segs) drawTaperedStroke(ctx, s, w, ink, o.taper || 0.45, o.taper || 0.45, o.bias === undefined ? 1.6 : o.bias, { boil: false, smooth: s.length > 2 });
  }
  Object.assign(CAV, { paintSky, glow, reflection, particles, inkShape });

  /** Run fn with on-twos line boil on (characters / FX). Backgrounds never boil unless the style enables it. */
  CAV.withBoil = function (fn, on = true) {
    const prev = CAV._boil; CAV._boil = on && !!CAV._boilEnabled; try { fn(); } finally { CAV._boil = prev; }
  };

  // ======================================================================================== 5. post-process
  let paperCache = null;
  function paperTexture(W, H, seed = 11) {
    if (paperCache && paperCache.width === W && paperCache.height === H) return paperCache;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
    const sm = document.createElement('canvas'); sm.width = 64; sm.height = 36;
    const sx = sm.getContext('2d'), id = sx.createImageData(64, 36), r = mulberry32(seed);
    for (let i = 0; i < id.data.length; i += 4) { const v = 100 + r() * 56; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    sx.putImageData(id, 0, 0);
    x.filter = 'blur(18px)'; x.drawImage(sm, 0, 0, W, H); x.filter = 'none';
    x.lineCap = 'round';
    for (let k = 0; k < (W * H) / 900; k++) { // fibres
      const fx = r() * W, fy = r() * H, a = r() * TAU, l = 4 + r() * 22;
      x.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'; x.lineWidth = 0.5 + r() * 0.8;
      x.beginPath(); x.moveTo(fx, fy); x.quadraticCurveTo(fx + Math.cos(a + 0.4) * l * 0.5, fy + Math.sin(a + 0.4) * l * 0.5, fx + Math.cos(a) * l, fy + Math.sin(a) * l); x.stroke();
    }
    paperCache = cv; return cv;
  }
  /**
   * Full-frame post stack in the order the style bible lists: colour_grade, bloom, (atmospheric_haze is applied per
   * parallax layer at paint time), chromatic_aberration, paper_texture, film_grain, vignette. Grain and line boil
   * re-seed on the style's cadence ("on twos"): this function advances CAV._boilSeed for the NEXT drawing pass.
   */
  function applyPostProcessing(ctx, styleBible, frameIdx, mood) {
    const S = styleBible || CAV.style, T = S.texture_post, md = mood || CAV.mood;
    const W = ctx.canvas.width, H = ctx.canvas.height, px = CAV._pxScale || 1;
    const order = T.order || [];
    const pixelOps = { colour_grade: 1, color_grade: 1, chromatic_aberration: 1, film_grain: 1 };
    const cadence = (T.film_grain && T.film_grain.reseed_every_frames) || 2;
    let i = 0;
    while (i < order.length) {
      if (pixelOps[order[i]]) { // merge consecutive pixel ops into one read-modify-write pass
        const run = [];
        while (i < order.length && pixelOps[order[i]]) run.push(order[i++]);
        pixelPass(ctx, run, S, md, Math.floor(frameIdx / cadence), W, H, px);
        continue;
      }
      const op = order[i++];
      if (op === 'bloom') {
        const B = T.bloom || {}; const inten = md.glow ? B.intensity : B.intensity_no_glow != null ? B.intensity_no_glow : 0.18;
        if (!inten) continue;
        const sw = Math.ceil(W / 4), sh = Math.ceil(H / 4);
        const o = off('bloom'); const bx = o.ctx;
        bx.drawImage(ctx.canvas, 0, 0, sw, sh);
        const id = bx.getImageData(0, 0, sw, sh), d = id.data, th = (B.threshold || 0.72) * 255;
        for (let k = 0; k < d.length; k += 4) {
          const l = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
          const f = l > th ? (l - th) / (255 - th) : 0;
          d[k] *= f; d[k + 1] *= f; d[k + 2] *= f;
        }
        bx.putImageData(id, 0, 0);
        const tint = String(B.tint || '').startsWith('mood.') ? md[B.tint.slice(5)] : B.tint;
        if (tint) { bx.globalCompositeOperation = 'multiply'; bx.fillStyle = mix(c(tint), '#ffffff', 0.35); bx.fillRect(0, 0, sw, sh); bx.globalCompositeOperation = 'source-over'; }
        const o2 = off('bloom2');
        o2.ctx.filter = `blur(${((B.radius_px || 18) * px) / 4}px)`; o2.ctx.drawImage(o.canvas, 0, 0, sw, sh, 0, 0, sw, sh); o2.ctx.filter = 'none';
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = clamp(inten * 1.4);
        ctx.imageSmoothingQuality = 'high'; ctx.drawImage(o2.canvas, 0, 0, sw, sh, 0, 0, W, H); ctx.restore();
      } else if (op === 'paper_texture') {
        const pt = T.paper_texture || {}; if (!pt.opacity) continue;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = pt.blend || 'overlay';
        ctx.globalAlpha = clamp(pt.opacity * 4); // texture is mid-grey based; ×4 maps the bible's opacity to visible strength
        ctx.drawImage(paperTexture(W, H), 0, 0); ctx.restore();
      } else if (op === 'vignette') {
        const v = T.vignette || {}; if (!v.strength) continue;
        const tint = String(v.tint || 'mood.shadow_tint').startsWith('mood.') ? md[(v.tint || 'mood.shadow_tint').slice(5)] : v.tint;
        const R = Math.hypot(W, H) / 2, inner = R * (v.radius || 0.78) * (1 - (v.softness || 0.55) * 0.6);
        const g = ctx.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, R * 1.02);
        g.addColorStop(0, rgba(tint, 0)); g.addColorStop(1, rgba(tint, clamp(v.strength * 1.6)));
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
    }
    CAV._boilSeed = Math.floor((frameIdx + 1) / CAV._boilCadence);
  }
  function pixelPass(ctx, ops, S, md, seed, W, H, px) {
    const T = S.texture_post, id = ctx.getImageData(0, 0, W, H), d = id.data;
    const has = n => ops.includes(n);
    const grade = has('colour_grade') || has('color_grade') ? T.colour_grade || {} : null;
    const ca = has('chromatic_aberration') ? (T.chromatic_aberration || {}).max_offset_px * px : 0;
    const gr = has('film_grain') ? T.film_grain || {} : null;
    const src = ca ? d.slice() : null;
    const tint = rgb(md.shadow_tint), key = rgb(md.key);
    const lift = grade ? grade.lift_amount || 0 : 0, hiA = grade ? grade.highlight_amount || 0 : 0, sat = grade ? grade.saturation_boost || 1 : 1;
    const sigma = gr ? (gr.sigma || 0.02) * 255 * 2.2 : 0;
    const cx = W / 2, cy = H / 2, rmax = Math.hypot(cx, cy);
    let h = (seed * 2654435761) >>> 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        let r = d[k], g = d[k + 1], b = d[k + 2];
        if (ca) {
          const dx = (x - cx) / rmax, dy = (y - cy) / rmax, f = ca * Math.hypot(dx, dy);
          const rx = Math.min(W - 1, Math.max(0, Math.round(x + dx * f * 1.0 / Math.max(1e-3, Math.hypot(dx, dy)))));
          const ry = Math.min(H - 1, Math.max(0, Math.round(y + dy * f / Math.max(1e-3, Math.hypot(dx, dy)))));
          const bx = Math.min(W - 1, Math.max(0, 2 * x - rx)), by = Math.min(H - 1, Math.max(0, 2 * y - ry));
          r = src[(ry * W + rx) * 4]; b = src[(by * W + bx) * 4 + 2];
        }
        if (grade) {
          const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const ws = (1 - l) * (1 - l) * lift, wh = l * l * hiA;
          r = r + (tint[0] - r) * ws + (key[0] - r) * wh; g = g + (tint[1] - g) * ws + (key[1] - g) * wh; b = b + (tint[2] - b) * ws + (key[2] - b) * wh;
          if (sat !== 1) { const m = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = m + (r - m) * sat; g = m + (g - m) * sat; b = m + (b - m) * sat; }
        }
        if (gr) {
          h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
          const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, wgt = 0.35 + 2.6 * l * (1 - l);
          const nz = (((h >>> 0) / 4294967296) - 0.5) * sigma * wgt;
          r += nz; g += nz; b += nz;
        }
        d[k] = r; d[k + 1] = g; d[k + 2] = b;
      }
    }
    ctx.putImageData(id, 0, 0);
  }
  CAV.applyPostProcessing = applyPostProcessing;

  // ============================================================================================ camera rig
  const PRESETS = {
    static: { zoom: [1, 1] },
    wide_establishing: { zoom: [1.06, 1.1], driftX: [-0.025, 0.025], tilt: [0, 0] },
    medium_tracking: { zoom: [1.38, 1.42], track: true, lead: 0.08, focusHead: 0.35 },
    over_shoulder: { zoom: [1.6, 1.66], track: true, lead: -0.18, focusHead: 0.15, rot: [-0.6, -0.4] },
    close_up_bust: { zoom: [2.15, 2.28], track: true, focusHead: 0.9, breath: 0.0025 },
    low_angle_hero: { zoom: [1.35, 1.5], track: true, focusHead: -0.25, tilt: [0.9, 1.2], rot: [0.8, 0.3] },
    slow_push_in: { zoom: [1.0, 1.22], track: true, focusHead: 0.5 },
  };
  CAV.CAMERA_PRESETS = PRESETS;
  function resolveCamera(F, scene) {
    const shot = F.shot, cam = shot.camera || {}, pr = PRESETS[cam.preset || 'static'] || PRESETS.static;
    const W = F.W, H = F.H, dur = Math.max(1e-3, shot.end_sec - shot.start_sec);
    const hold = Math.min((CAV.style.motion_rules.hold_frames_min || 12) / F.fps, dur * 0.12);
    const e = ease[cam.ease || CAV.style.motion_rules.easing.camera || 'easeInOutSine'] || ease.easeInOutSine;
    const p = e(clamp((F.tShot - (cam.hold === false ? 0 : hold)) / Math.max(1e-3, dur - 2 * (cam.hold === false ? 0 : hold)))) * (cam.calm ? 0.35 : 1);
    let subj = null;
    if (pr.track || cam.track) {
      if (cam.subject) subj = { x: cam.subject[0], y: cam.subject[1], headY: cam.subject[2] != null ? cam.subject[2] : cam.subject[1] };
      else if (scene && scene.subject) subj = scene.subject(F);
    }
    const z = lerp(...(cam.zoom || pr.zoom || [1, 1]), p);
    let x = W / 2, y = H / 2;
    if (subj) {
      const hy = subj.headY != null ? subj.headY : subj.y;
      x = subj.x + (pr.lead || 0) * W / z * (subj.facing || 1);
      y = lerp(subj.y, hy, pr.focusHead != null ? pr.focusHead : 0.5);
    }
    if (pr.driftX) x += lerp(pr.driftX[0], pr.driftX[1], p) * W * (cam.direction || 1);
    if (cam.offset) { x += cam.offset[0]; y += cam.offset[1]; }
    let C = { x, y, zoom: z, rot: lerp(...(cam.rot || pr.rot || [0, 0]), p), tilt: lerp(...(cam.tilt || pr.tilt || [0, 0]), p) };
    if (cam.from || cam.to) { // explicit keyframes win (any field)
      const A = Object.assign({}, C, cam.from || {}), B = Object.assign({}, C, cam.to || {});
      C = { x: lerp(A.x, B.x, p), y: lerp(A.y, B.y, p), zoom: lerp(A.zoom, B.zoom, p), rot: lerp(A.rot, B.rot, p), tilt: lerp(A.tilt || 0, B.tilt || 0, p) };
    }
    if ((pr.breath || cam.breath) && !cam.calm) { const b = pr.breath || cam.breath; C.zoom *= 1 + b * Math.sin(F.t * 1.3); C.y += Math.sin(F.t * 0.9) * H * b; }
    // keep the frame inside the stage (no empty edges) at action-plane depth
    const hwv = W / 2 / C.zoom, hhv = H / 2 / C.zoom;
    if (cam.clamp !== false) { C.x = clamp(C.x, hwv, W - hwv); C.y = clamp(C.y, hhv, H - hhv); }
    C.progress = p;
    return C;
  }
  function layerTransform(ctx, F, C, depth) {
    const W = F.W, H = F.H;
    const z = 1 + (C.zoom - 1) * depth;
    const cx = W / 2 + (C.x - W / 2) * depth, cy = H / 2 + (C.y - H / 2) * depth - (C.tilt || 0) * (1 - depth) * H * 0.12; // +tilt = look up: far layers sink
    ctx.translate(W / 2, H / 2);
    ctx.rotate(((C.rot || 0) * Math.PI / 180) * Math.min(1, depth + 0.2));
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
  }
  CAV.resolveCamera = resolveCamera;

  // ============================================================================================== subtitles
  function buildCaptions(TL, maxWords) {
    const caps = []; if (!TL || !TL.words || !TL.words.length) return caps;
    let cur = [];
    const pauseAfter = new Set((TL.pauses || []).map(p => p.after_word));
    TL.words.forEach((w, i) => {
      cur.push(w);
      const endPunct = /[.!?…]["')\]]?$/.test(w.text), soft = /[,;:—–]$/.test(w.text);
      if (endPunct || pauseAfter.has(i) || cur.length >= maxWords || (soft && cur.length >= 3) || i === TL.words.length - 1) { caps.push(cur); cur = []; }
    });
    return caps.map((ws, k) => ({ words: ws, start: ws[0].start_sec - 0.12, end: ws[ws.length - 1].end_sec + 0.3, k }))
      .map((cp, k, arr) => (k < arr.length - 1 ? Object.assign(cp, { end: Math.min(cp.end, arr[k + 1].start) }) : cp));
  }
  function drawSubtitles(ctx, F) {
    const st = CAV.style.subtitles, caps = CAV._captions; if (!caps) return;
    const cap = caps.find(cp => F.t >= cp.start && F.t < cp.end); if (!cap) return;
    const W = F.W, H = F.H, u = F.u;
    const size = (st.size_px || 54) * u * (F.aspect === '9:16' ? 1.1 : 1);
    ctx.save();
    const fam = /Devanagari/.test(st.font_family || '') ? st.font_family
      : `${(st.font_family || 'serif').replace(/,?\s*(serif|sans-serif)\s*$/, '')}, 'Noto Serif Devanagari', 'Kohinoor Devanagari', 'Devanagari Sangam MN', 'Nirmala UI', serif`;
    ctx.font = `${st.font_weight || 700} ${size}px ${fam}`;
    ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const words = cap.words.map(w => (st.uppercase ? w.text.toUpperCase() : w.text));
    const space = ctx.measureText(' ').width + (st.outline_px || 7) * u * 0.9, maxW = W * (F.aspect === '9:16' ? 0.84 : 0.72);
    const lines = [[]]; let lw = 0;
    words.forEach((w, i) => { const ww = ctx.measureText(w).width; if (lw + ww > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push(i); lw += ww + space; });
    const fadeIn = clamp((F.t - cap.start) / 0.1), fadeOut = clamp((cap.end - F.t) / 0.12), a = Math.min(fadeIn, fadeOut);
    const pos = st.position || 'lower_third', lineH = size * 1.18;
    const baseY = (pos === 'top' ? H * (F.aspect === '9:16' ? 0.16 : 0.12) + size
      : pos === 'center' ? H * 0.5 - ((lines.length - 1) * lineH) / 2
      : (F.aspect === '9:16' ? H * 0.74 : H * 0.885) - (lines.length - 1) * lineH) + (1 - ease.easeOutCubic(fadeIn)) * 10 * u;
    ctx.globalAlpha = a;
    lines.forEach((ln, li) => {
      const widths = ln.map(i => ctx.measureText(words[i]).width), tot = widths.reduce((s, v) => s + v, 0) + space * (ln.length - 1);
      let x = (W - tot) / 2; const y = baseY + li * size * 1.18;
      ln.forEach((i, j) => {
        const w = cap.words[i], active = F.t >= w.start_sec - 0.04 && F.t < w.end_sec + 0.06;
        ctx.lineWidth = (st.outline_px || 7) * u * 2; ctx.strokeStyle = c(st.outline);
        ctx.shadowColor = rgba(st.outline, 0.45); ctx.shadowBlur = 10 * u; ctx.shadowOffsetY = 3 * u;
        ctx.strokeText(words[i], x, y);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = active ? c(st.highlight) : c(st.fill);
        ctx.fillText(words[i], x, y);
        x += widths[j] + space;
      });
    });
    ctx.restore();
  }
  CAV.drawSubtitles = drawSubtitles;

  // ========================================================================================== frame driver
  const scenes = {};
  CAV.registerScenes = obj => Object.assign(scenes, obj);
  CAV.scenes = scenes;

  CAV.init = function (cfg) {
    CAV.style = cfg.style; CAV.SB = cfg.storyboard; CAV.TL = cfg.timeline || null;
    if (cfg.storyboard.subtitle_style) CAV.style.subtitles = Object.assign({}, CAV.style.subtitles, cfg.storyboard.subtitle_style);
    CAV.W = cfg.W; CAV.H = cfg.H; CAV._pxScale = cfg.scale || 1; CAV.aspect = cfg.aspect;
    CAV.fps = cfg.storyboard.fps || cfg.style.motion_rules.frame_rate || 24;
    const boil = (cfg.style.strokes.line_boil || {}).characters_fx || {};
    CAV._boilEnabled = boil.enabled !== false; CAV._boilAmp = boil.amplitude_px || 0.5;
    CAV._boilCadence = Math.max(1, Math.round(CAV.fps / (boil.rate_hz || 12)));
    CAV._charCadence = cfg.style.motion_rules.character_cadence_frames || 2;
    CAV._boil = false; CAV._boilSeed = 0;
    CAV._subtitles = !!cfg.subtitles;
    CAV._captions = cfg.subtitles ? buildCaptions(CAV.TL, CAV.style.subtitles.max_words_per_line || 7) : null;
    const cv = (CAV._canvas = document.getElementById('c'));
    cv.width = Math.round(cfg.W * CAV._pxScale); cv.height = Math.round(cfg.H * CAV._pxScale);
    CAV._ctx = cv.getContext('2d', { willReadFrequently: true });
    CAV._shots = (CAV.SB.shots || []).slice().sort((a, b) => a.start_sec - b.start_sec);
    const missing = CAV._shots.map(s => s.scene).filter(s => !scenes[s]);
    if (missing.length) throw new Error('scene_drawers.js does not define scene(s): ' + [...new Set(missing)].join(', ') + ' (defined: ' + Object.keys(scenes).join(', ') + ')');
    const missMood = CAV._shots.map(s => s.mood).filter(m => m && !CAV.style.lighting_moods[m]);
    if (missMood.length) throw new Error('unknown mood(s) ' + missMood.join(', ') + '; style has ' + Object.keys(CAV.style.lighting_moods).join(', '));
    return { shots: CAV._shots.length, scenes: Object.keys(scenes), W: cv.width, H: cv.height };
  };

  function frameInfo(i, shot, shotIdx) {
    const fps = CAV.fps, t = i / fps, cad = CAV._charCadence;
    const ic = Math.floor(i / cad) * cad, TL = CAV.TL;
    const moodName = shot.mood || CAV.style.default_mood;
    const mood = Object.assign({ name: moodName }, CAV.style.lighting_moods[moodName]);
    const env = TL && TL.envelope ? TL.envelope[Math.min(TL.envelope.length - 1, ic)] || 0 : 0;
    const mouth = TL && TL.mouth ? TL.mouth[Math.min(TL.mouth.length - 1, ic)] || 'closed' : 'closed';
    const viseme = TL && TL.viseme ? TL.viseme[Math.min(TL.viseme.length - 1, ic)] : 'rest';
    const word = TL && TL.words ? TL.words.find(w => t >= w.start_sec && t <= w.end_sec) || null : null;
    const pause = TL && TL.pauses ? TL.pauses.find(p => t >= p.start_sec && t <= p.end_sec) || null : null;
    const segment = TL && TL.segments ? TL.segments.find(s => t >= s.start_sec - 0.05 && t <= s.end_sec + 0.05) || null : null;
    const dur = shot.end_sec - shot.start_sec;
    const tShot = t - shot.start_sec;
    return {
      i, t, fps, tShot, ic, tc: ic / fps, tcShot: ic / fps - shot.start_sec, shotProgress: clamp(tShot / Math.max(1e-3, dur)),
      W: CAV.W, H: CAV.H, u: Math.min(CAV.W, CAV.H) / 1080, aspect: CAV.aspect,
      shot, shotIdx, params: shot.params || {}, mood, S: CAV.style, light: lightVec(mood.key_dir_deg),
      env, mouth, viseme, speaking: mouth !== 'closed' || env > 0.12, word, pause, segment, TL,
      shotSeed: hash(shotIdx, 17) * 1e6 | 0,
    };
  }

  function drawShot(ctx, i, shotIdx) {
    const shot = CAV._shots[shotIdx], F = frameInfo(i, shot, shotIdx), scene = scenes[shot.scene];
    CAV.frame = F; CAV.mood = F.mood;
    if (scene.setup && !scene.__setupFor) scene.__setupFor = {};
    if (scene.setup && !scene.__setupFor[shotIdx]) { scene.__setupFor[shotIdx] = scene.setup(F) || {}; }
    F.state = scene.__setupFor ? scene.__setupFor[shotIdx] : {};
    const C = (F.cam = resolveCamera(F, scene));
    const depths = Object.assign({}, CAV.style.motion_rules.parallax_layers, scene.parallax || {}, shot.parallax || {});
    const haze = Object.assign({}, CAV.style.texture_post.atmospheric_haze, scene.haze || {}, shot.haze || {});
    const skyStops = CAV.style.gradients[F.mood.sky] || [F.mood.ambient, F.mood.key];
    const sc = CAV._pxScale;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = c(skyStops[0]); ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
    const layers = scene.layers || {};
    for (const name of LAYERS) {
      const fn = layers[name]; if (!fn) continue;
      F.layer = name; F.depth = depths[name] != null ? depths[name] : 1;
      const hz = haze[name] || 0;
      const L = hz > 0 ? off('layer') : null, lc = L ? L.ctx : ctx;
      lc.save();
      lc.setTransform(sc, 0, 0, sc, 0, 0);
      layerTransform(lc, F, C, F.depth);
      CAV._boil = false;
      try { fn(lc, F); } catch (e) { e.message = `[scene ${shot.scene} / layer ${name} / frame ${i}] ` + e.message; throw e; }
      lc.restore();
      if (L) { // atmospheric haze: blend this layer's own pixels toward the sky colour at their screen height
        const g = lc.createLinearGradient(0, 0, 0, lc.canvas.height);
        skyStops.forEach((s, k) => g.addColorStop(k / Math.max(1, skyStops.length - 1), rgba(s, hz)));
        lc.save(); lc.globalCompositeOperation = 'source-atop';
        const hzc = scene.hazeColor ? c(scene.hazeColor) : null;
        lc.fillStyle = hzc ? rgba(hzc, hz) : g; lc.fillRect(0, 0, lc.canvas.width, lc.canvas.height); lc.restore();
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(L.canvas, 0, 0); ctx.restore();
      }
      const lights = layers[name + '_lights']; // emissive pass: same depth, drawn AFTER haze (lamps, windows, flames)
      if (lights) {
        ctx.save(); ctx.setTransform(sc, 0, 0, sc, 0, 0); layerTransform(ctx, F, C, F.depth);
        try { lights(ctx, F); } catch (e) { e.message = `[scene ${shot.scene} / layer ${name}_lights / frame ${i}] ` + e.message; throw e; }
        ctx.restore();
      }
    }
    if (scene.overlay) { ctx.save(); ctx.setTransform(sc, 0, 0, sc, 0, 0); F.layer = 'overlay'; scene.overlay(ctx, F); ctx.restore(); }
    return F;
  }

  CAV.renderFrame = function (i) {
    const ctx = CAV._ctx, t = i / CAV.fps, shots = CAV._shots;
    let k = shots.findIndex(s => t >= s.start_sec && t < s.end_sec);
    if (k < 0) k = t < shots[0].start_sec ? 0 : shots.length - 1;
    CAV._boilSeed = Math.floor(i / CAV._boilCadence);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    let F = drawShot(ctx, i, k);
    const tr = shots[k].transition_in;
    if (k > 0 && tr && tr.type && tr.type !== 'cut') {
      const n = tr.frames || 8, fi = i - Math.round(shots[k].start_sec * CAV.fps);
      if (fi >= 0 && fi < n) {
        const p = ease.easeInOutSine((fi + 1) / (n + 1));
        const A = off('trA'); A.ctx.drawImage(ctx.canvas, 0, 0);
        drawShot(ctx, i, k - 1); // previous shot continues under the transition
        if (tr.type === 'crossfade' || tr.type === 'dissolve') {
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = p; ctx.drawImage(A.canvas, 0, 0); ctx.restore();
        } else if (tr.type === 'dip' || tr.type === 'dip_to_black' || tr.type === 'flash') {
          const col = tr.type === 'flash' ? c(F.mood.key) : c(tr.color || F.mood.ink);
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (p >= 0.5) { ctx.drawImage(A.canvas, 0, 0); }
          ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2; ctx.fillStyle = col; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
        } else if (tr.type === 'wipe') {
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); const w = ctx.canvas.width * p;
          ctx.beginPath(); ctx.rect(0, 0, w, ctx.canvas.height); ctx.clip(); ctx.drawImage(A.canvas, 0, 0); ctx.restore();
        }
        F = Object.assign(frameInfo(i, shots[k], k), { cam: F.cam });
        CAV.frame = F; CAV.mood = F.mood;
      }
    }
    if (CAV.SB.post !== false) applyPostProcessing(ctx, CAV.style, i, F.mood);
    if (CAV._subtitles) { ctx.save(); ctx.setTransform(CAV._pxScale, 0, 0, CAV._pxScale, 0, 0); drawSubtitles(ctx, F); ctx.restore(); }
    return { shot: shots[k].id || k, scene: shots[k].scene };
  };

  CAV.renderFrameToPNG = function (i, type = 'image/png', q) {
    const info = CAV.renderFrame(i);
    return { info, data: CAV._canvas.toDataURL(type, q).split(',')[1] };
  };
})();
