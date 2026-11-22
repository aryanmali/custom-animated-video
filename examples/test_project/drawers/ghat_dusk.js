/* test_project — drawers/ghat_dusk.js: wide river ghat at dusk; walking figure (params.pose = 'walk' | 'hold_diya')
 * One scene per file: the build hashes this file only for shots whose `scene` is "ghat_dusk", so a fix here re-renders
 * just those shots. Shared helpers come from drawers/_common.js (CAV.lib.ghat). Spec: ../visual_specs/ghat_dusk.md
 */
(function () {
  const { c, mix, rgba, shadowOf, lightOf, hash, rng, noise1, clamp, lerp, TAU } = CAV;
  const { HORIZON, GHAT_TOP, wk, skyLayer, cloud, farBank, farBankLights, river, riverLights, diya, shikhara, shikharaReflection, shikharaLights, ghat, ghatLights, archFrame, garland, rig, limbSides, drawFigure, FIG, figureParams } = CAV.lib.ghat;

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

  });
})();
