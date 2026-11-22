# _common: "Every lamp back home" (16:9, 1920×1080)
Namespace: `CAV.lib.ghat`. It exports every helper below; scene files destructure it.

## World constants
- `HORIZON` = 548 (far-bank waterline). `GHAT_TOP` = 812 (walking tread of the top ghat step).
- Standing figure height `h` = 420 px. Default figure `FIG = {x:1420, y:GHAT_TOP+1, h:420, facing:-1}` (faces left, toward the sun).

## Shared world helpers
- `skyLayer(ctx, F, {sunX=300, sunY=HORIZON-70, clouds})`:
  - mood.sky gradient;
  - sun disc 'diya_core', r=44, with a mood.key glow (r 420, α .55) and a 'gold_glow' glow (r 120);
  - flat-bottomed scalloped cumulus: bodies `mix('plum_shadow', mood.ambient, .35)`, undersides `mix('flame_orange','gold',.4)`;
  - default clouds at [620,250,1.0] [1260,170,1.3] [1690,330,.8] [180,120,.9], drifting +6 px/s (×0.6 on even clouds) on F.t.
- `farBank` / `farBankLights`:
  - hill city of small cubic flat-roofed houses stacked on two slopes (Gaussian hills centred at x 1250 and x 230);
  - domes and chhatris; a hilltop shikhara silhouette at x 1250 and x 240;
  - lit left faces = `lightOf(col, .18)`;
  - windows lit in the `_lights` pass.
- `river` / `riverLights`:
  - water gradient 'water_teal' → mood.ambient;
  - ripple dashes;
  - sun reflection column via `CAV.reflection`;
  - floating diyas drawn with `diya`.
- `diya(ctx, x, y, s, F, seed, onWater)`: terracotta lamp with a 'diya_flame'/'diya_core' flame flickering on F.tc.
- `shikhara(ctx, F, x, base, h, wBase)` + `shikharaReflection` + `shikharaLights`:
  - nagara temple, cel-shaded 'sandstone'/'sandstone_dark';
  - ribbed tiers, amalaka + kalash ('gold');
  - reflection in the river; niche lamps in the `_lights` pass.
- `ghat` / `ghatLights`:
  - 7 steps `STEPS[k] = {y: GHAT_TOP + 38k, x: 840 − 150k}`: light treads, dark risers, `chipped` edges;
  - retaining wall behind the top platform with arched lamp niches every 210 px from x 900;
  - diyas on the treads, lit in the `_lights` pass.
- `archFrame(ctx, F)`:
  - multifoil (9-cusp) cusped arch framing both top corners, 'teal_stone' cel-shaded, ink contour;
  - marigold `garland` swags hanging across the opening.
- `garland(ctx, F, x0, x1, y, sag, phase)`: 'marigold'/'saffron' beads on a catenary, swaying on F.tc.

## Character: the walker (one rig, used by both scenes)
- Proportions from `S.proportions` (`heads_tall` default 8; limb lengths from `limb_lengths_heads`); `hu = h/heads`.
- Part order, back→front, with palette names:
  1. far arm 'skin_mid'
  2. far leg 'skin_mid'
  3. dhoti 'cream_cloth' (pleats = cloth chain)
  4. torso 'skin_mid'
  5. near leg
  6. uttariya 'saffron' with a 'gold'/'gold_deep' zari border (cloth chain, streams behind)
  7. near arm
  8. head + hair 'hair' + top-knot
- Every part is `celShade`d. Contours use `drawTaperedStroke(…, 1.6)` with `CAV.weight('silhouette_contour', h, .5)`.
- One `applyRimLight` over the array of part builders.
- Contact shadow: flat ellipse in mood.shadow_tint (α .5), cast to the right (away from the light).
- `rig(F, o)`:
  - walk = stride `walk_cycle.stride_heads` (1.6), step every `walk_cycle.frames_per_step` frames;
  - bob `bob_heads`, torso lean `torso_lean_deg`;
  - stance foot locked in world space (IK) while the body advances `facing · stride/stepT` px/s on `F.tcShot`.
- Poses:
  - `walk`;
  - `hold_diya`: standing; the near forearm raised, palm up at chest height, holding a diya (scale 1.35) that is drawn last.
- Exports `drawFigure(ctx, F, o)`, `rig(F, o)`, `figureParams(F)` (merges `FIG` with `params.figureX/figureH/pose`).
