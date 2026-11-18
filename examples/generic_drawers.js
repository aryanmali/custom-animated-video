/* Generic, style-only scene drawers (fallback for `build_video.py --auto`).
 * Knows nothing about any particular style: it reads the active mood (sky gradient, key/rim/shadow/ink) and the
 * palette sorted by luminance, so ANY normalized style_bible.json yields a coherent, on-palette moving landscape:
 * posterised sky + sun, three hazed hill ranges, water with reflections, a lone figure silhouette with rim light,
 * foreground fronds, drifting particles. Replace with bespoke drawers for real projects.
 */
(function () {
  const { c, mix, rgba, shadowOf, rng, noise1, TAU, lum } = CAV;
  function pal(F) {
    const cols = Object.values(F.S.palette).filter(v => typeof v === 'string' && v[0] === '#');
    const byL = cols.slice().sort((a, b) => lum(a) - lum(b));
    const mid = byL.filter(v => lum(v) > 0.18 && lum(v) < 0.6);
    return { dark: byL[1] || byL[0], mid: mid.length ? mid : byL, light: byL[byL.length - 2] || byL[byL.length - 1] };
  }
  function ridge(ctx, F, y, amp, seed, col, step = 40) {
    ctx.beginPath(); ctx.moveTo(-400, F.H + 400);
    for (let x = -400; x <= F.W + 400; x += step) ctx.lineTo(x, y - amp * (0.5 + 0.5 * noise1(x / 260, seed)) - amp * 0.4 * noise1(x / 90, seed + 3));
    ctx.lineTo(F.W + 400, F.H + 400); ctx.closePath();
    ctx.fillStyle = c(col); ctx.fill();
  }
  const horizon = F => F.H * 0.62;
  CAV.registerScenes({
    generic_landscape: {
      subject(F) { return { x: F.W * 0.62, y: horizon(F) + F.H * 0.12, headY: horizon(F) - F.H * 0.02 }; },
      layers: {
        sky(ctx, F) {
          CAV.paintSky(ctx, F.mood.sky, -400, -400, F.W + 800, horizon(F) + 420, { steps: 9 });
          const L = F.light, sx = F.W / 2 + L.x * F.W * 0.35, sy = horizon(F) - 60 + Math.min(0, L.y) * 300;
          CAV.glow(ctx, sx, sy, 380, F.mood.key, 0.5); ctx.fillStyle = mix(F.mood.key, '#ffffff', 0.55); ctx.beginPath(); ctx.arc(sx, sy, 42, 0, TAU); ctx.fill();
        },
        far_bg(ctx, F) { const p = pal(F); ridge(ctx, F, horizon(F) - 30, 120, 2, mix(p.mid[0], F.mood.shadow_tint, 0.5)); },
        mid_bg(ctx, F) {
          const p = pal(F);
          ridge(ctx, F, horizon(F) + 10, 70, 5, mix(p.mid[Math.floor(p.mid.length / 2)], F.mood.shadow_tint, 0.35));
          const g = ctx.createLinearGradient(0, horizon(F) + 40, 0, F.H + 300);
          g.addColorStop(0, mix(F.S.gradients[F.mood.sky].slice(-1)[0], F.mood.shadow_tint, 0.4)); g.addColorStop(1, c(F.mood.shadow_tint));
          ctx.fillStyle = g; ctx.fillRect(-400, horizon(F) + 40, F.W + 800, F.H);
        },
        mid_bg_lights(ctx, F) { const L = F.light; CAV.reflection(ctx, F.W / 2 + L.x * F.W * 0.35, horizon(F) + 44, 80, 300, F.mood.key, F.tc, { rows: 30, alpha: 0.6 }); },
        action_plane(ctx, F) {
          const p = pal(F), gy = horizon(F) + F.H * 0.2;
          ctx.fillStyle = c(p.dark); ctx.fillRect(-400, gy, F.W + 800, F.H);
          CAV.drawTaperedStroke(ctx, [[-400, gy], [F.W + 400, gy + 4]], 3, F.mood.ink, 0.5, 0.5, null, { boil: false });
          // a simple standing figure silhouette (capsules), rim-lit
          const x = F.W * 0.62, h = F.H * 0.34, hu = h / 8, breathe = Math.sin(F.tc * 1.4) * hu * 0.03;
          const parts = [
            g => CAV.limb(g, { x: x - hu * 0.3, y: gy - 4 * hu }, { x: x - hu * 0.35, y: gy }, hu * 0.4, hu * 0.25, false),
            g => CAV.limb(g, { x: x + hu * 0.3, y: gy - 4 * hu }, { x: x + hu * 0.35, y: gy }, hu * 0.4, hu * 0.25, false),
            g => CAV.limb(g, { x, y: gy - 4.2 * hu }, { x, y: gy - 6.3 * hu + breathe }, hu * 0.85, hu * 1.05, false),
            g => { g.moveTo(x + hu * 0.45, gy - 7.35 * hu); g.arc(x, gy - 7.35 * hu + breathe, hu * 0.45, 0, TAU); },
          ];
          const cape = { anchor: { x, y: gy - 6.2 * hu }, segments: 8, length: hu * 4, restAngle: 95, amp: 14 }; // behind the body
          CAV.stepClothChain(cape, (F.mood.key_dir_deg + 180) % 360, 0.5, 0);
          CAV.withBoil(() => CAV.drawClothChain(ctx, cape, { width: hu * 1.6, endWidth: hu * 2.2, fill: p.mid[p.mid.length - 1], ink: F.mood.ink }));
          CAV.withBoil(() => CAV.celShade(ctx, parts, mix(p.dark, F.mood.shadow_tint, 0.3), false));
          CAV.applyRimLight(ctx, parts, F.mood.key_dir_deg, F.mood.rim, 0.9, { width: 4 });
        },
        foreground_frame(ctx, F) {
          const p = pal(F), r = rng(4);
          for (let k = 0; k < 7; k++) { // dark fronds framing the bottom corners
            const left = k < 4, bx = left ? -60 + k * 50 : F.W + 60 - (k - 4) * 60, by = F.H + 40;
            const tip = { x: bx + (left ? 1 : -1) * (180 + r() * 160) + Math.sin(F.tc * 1.2 + k) * 10, y: by - 260 - r() * 200 };
            CAV.drawTaperedStroke(ctx, [[bx, by], [(bx + tip.x) / 2, (by + tip.y) / 2 - 30], [tip.x, tip.y]], 46, shadowOf(p.dark, 0.3), 0.9, 0.05, null);
          }
        },
      },
      overlay(ctx, F) { CAV.particles(ctx, F, { kind: 'dust', count: 30, seed: 2, colors: [F.mood.key, F.mood.rim], size: 3 }); },
    },
  });
})();
