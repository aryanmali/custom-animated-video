/* test_project — drawers/ghat_closeup.js: dialogue close-up bust, lip-synced to the narration
 * One scene per file: the build hashes this file only for shots whose `scene` is "ghat_closeup", so a fix here re-renders
 * just those shots. Shared helpers come from drawers/_common.js (CAV.lib.ghat). Spec: ../visual_specs/ghat_closeup.md
 */
(function () {
  const { c, mix, rgba, shadowOf, lightOf, hash, rng, noise1, clamp, lerp, TAU } = CAV;
  const { HORIZON, GHAT_TOP, wk, skyLayer, cloud, farBank, farBankLights, river, riverLights, diya, shikhara, shikharaReflection, shikharaLights, ghat, ghatLights, archFrame, garland, rig, limbSides, drawFigure, FIG, figureParams } = CAV.lib.ghat;

  CAV.registerScenes({
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
