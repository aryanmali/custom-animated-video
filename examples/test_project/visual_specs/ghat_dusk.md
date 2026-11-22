# ghat_dusk
- **Purpose / beat:** a calm establishing look at the river ghat at dusk. The lone figure walks toward the low sun. The same set comes back for the low-angle hero climax.
- **Used by shots:**
  - s1_wide (0.00–3.55, wide_establishing, direction −1, params {pose:'walk', figureX:1500, lampsBloom:true});
  - s3_hero (5.62–7.06, low_angle_hero zoom 1.5→1.62, params {pose:'hold_diya', figureX:1240, arch:false}).
- **Mood:** diya_dusk (key from the left; shadows fall right; rim on the figure's left edge).
- **Subject anchor:** `subject(F)` from `rig(F, figureParams(F))`: x = R.X, y = R.Y − 0.45h, headY = R.Y − 0.92h, facing −1.

## Layers
- sky: `skyLayer(ctx, F)` with the defaults.
- far_bg: `farBank`. far_bg_lights: `farBankLights` (lit windows).
- mid_bg:
  - `river`;
  - shikhara reflection, then the shikhara at x 520, base 630, h 300, wBase 170 (reflection drawn first).
- mid_bg_lights: `riverLights` + `shikharaLights` (same shikhara args).
- action_plane:
  - `ghat` + `ghatLights`;
  - then `drawFigure(ctx, F, figureParams(F))`, so the figure stands on the top tread (y = GHAT_TOP + 1).
- foreground_frame: `archFrame` unless `params.arch === false` (the hero shot drops it to open up the sky).
- overlay:
  - petals: count 14, seed 3, size 7;
  - embers: count 18, seed 8, size 2.2, area y 200–1080;
  - if `params.lampsBloom`: during the dramatic pause, a `screen` wash of mood.key with α = .12·sin(π·p), where p = progress through the pause.

## Params
- `pose`: 'walk' | 'hold_diya'
- `figureX`: start x
- `arch`: false hides the foreground arch
- `lampsBloom`: pause swell

## Must be visible
1. In s1, the figure's feet touch the tread and do not slide between frames 30 and 32 (stance foot is static).
2. There is a warm rim on the figure's left edge only, and at least 5 lit far-bank windows.
3. In s1, the arch frames both top corners. In s3 there is no arch, and the diya is held in the raised hand.
