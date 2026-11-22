# ghat_closeup
- **Purpose / beat:** dialogue intimacy. The figure says "Walk slowly." straight from the river bank, lit by the low sun on the left and a diya bounce from below.
- **Used by shots:** s2_closeup (3.55–5.62, close_up_bust zoom 1.04→1.1, crossfade-in 10 frames, speaker 'hero').
- **Mood:** diya_dusk.
- **Subject anchor:** x 1130, y 560, headY 430, facing −1. Parallax override: far_bg .12, mid_bg .3 (a shallow, calm background).

## Layers
- sky: `skyLayer` with sunX 160, sunY 600, clouds [[700,220,1.4],[1500,120,1.1]].
- far_bg: `farBank` translated down 120 px.
- far_bg_lights: out-of-focus bokeh of the far bank:
  - 34 discs, `rng(31)`, x ∈ [−100, 2000], y 560–690, radius 10–32;
  - each disc is a glow at 2.2·r, 'diya_flame' (every 3rd 'gold_glow'), α .35 + .25·noise1(F.tc+k, 4);
  - core disc 'gold_glow' α .22.
- mid_bg: `river` translated down 190.
- mid_bg_lights: sun reflection column at x 160 ('gold_glow', 40 rows, α .7), same translate.
- action_plane: `drawBust` (defined in this scene file), with these rules:
  - **Placement and part list:** bust at X 1180, Y 430, scale s = 300. Parts: face, neck, torso, hair, top-knot.
  - **Face:** 3/4 profile facing left. Strong short neck, pecs/clavicle form lines.
  - **Ornaments and drape:** rudraksha beads ('rust_shadow', every 4th 'gold') with a gold pendant and a 'vermilion' centre. Uttariya 'saffron' over the near shoulder with a 'gold' border, plus a cloth-chain tail streaming right. Hair: 5 'hair' strand chains streaming right. Gold earring swinging at 0.18·sin(3.1·F.tc) rad.
  - **Eyes, brow, tilak:** half-lidded almond eye that blinks every 60 frames (on twos). 'hair' brow. Tilak: 'vermilion' with a 'gold' line.
  - **Mouth:** `drawLipSyncMouth` at p(−0.3, 0.27), rotated −0.06 rad, scaled 0.62 in x (3/4 view), mood 'serene'.
  - **Rim and glow:** a single `applyRimLight` over [face, neck, torso, hair] (width 5, boost .3). Warm 'diya_flame' glow on the jaw from below.
- foreground_frame:
  - dark carved pillar on the left edge (to x ≈ 420), colour `mix('teal_stone','umber_shadow',.6)`, cel-shaded;
  - 9 carved bands ('gold'-tinted) and a faint rim;
  - marigold garland swag from x 330 to 1250 at y −10, sag 150.
- overlay: embers (22, seed 12, size 2.6); petals (8, seed 5, size 11).

## Must be visible
1. The face points left (the same way as the body), and the mouth is open on 'Walk' in the dialogue QA frame.
2. The rim is on the left/front edges only, with no glowing seam between the neck and torso.
3. The pillar fills the left edge, and the bokeh discs are visibly soft and warm.
