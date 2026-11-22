# Visual spec template (storyboarder → artist contract)

`cav-storyboarder` (Opus) writes one spec per scene: `WORK/visual_specs/<scene_key>.md`, plus `WORK/visual_specs/_common.md`
for everything shared, such as the character rig and recurring props. `cav-artist` (Sonnet) implements each spec
**literally**: `_common.md` → `WORK/drawers/_common.js`, and `<scene_key>.md` → `WORK/drawers/<scene_key>.js`.

**The rule:** every aesthetic decision is made here. The artist must never have to choose a colour, a composition,
a pose, a motif or a motion. A spec is *not* code, but it is precise:
- palette **names** (never hex);
- positions and sizes as **fractions of `F.W`/`F.H`** (or world px when the aspect is fixed);
- motion as a **function of `F.t`/`F.tc`/`F.shotProgress`/`params`**;
- layer by layer.

If you catch yourself writing "something nice", "some decoration" or "appropriate", replace it with the exact thing.

Keep scenes **small and modular**:
- one composition per scene key;
- a wide and a close-up of the same place are two keys;
- variation between shots of the same scene goes in `params`;
- shared things (the character, a recurring prop, the far skyline) go in `_common.md`, so each scene file stays short and
  a QA fix touches one small file.

---

## `_common.md` sections
1. **World constants:** horizon y, ground/tread y, the scale of a standing figure (`h` in px), and any shared skyline or
   terrain functions. Give each a name, so scene files say "use `HORIZON`".
2. **Character rig(s):** for each character:
   - name;
   - proportions source (`S.proportions` keys) and heads tall;
   - part order back→front, with the palette name per part;
   - costume pieces, each marked as cloth chain or rigid;
   - hair (chains: count, length in heads, stiffness);
   - face: features, eye shape, brow, tilak/ornaments, mouth placement for lip sync and its 3/4-view scale;
   - poses by name (`walk`, `hold_diya`, `idle`, …), each described joint by joint (angles, which hand holds what);
   - walk: stride/bob from `walk_cycle`, and the stance foot IK-planted.
   Name the helper functions the artist must expose, e.g. `drawFigure(ctx, F, {x, y, h, facing, pose})` and `rig(F, o)`.
3. **Shared props/motifs:** for each one: name, shape, palette names, light behaviour (`_lights` pass or not), and the
   helper signature.
4. **Namespace:** `CAV.lib.<project>` is where `_common.js` exports its helpers.

## `<scene_key>.md` sections
```markdown
# <scene_key>
Purpose / beat: <what this scene must make the viewer feel; which narration lines play over it>
Used by shots: s1 (0.00–3.55, wide_establishing, params {pose:'walk', figureX:1500}), s3 (...)
Mood(s): diya_dusk (key_dir_deg 200 → light from the left; shadows fall right)
Subject anchor: subject(F) → x = 0.74·W (or figure rig X), y = ground − 0.45·h, headY = ground − 0.92·h, facing −1

## Layers (back → front; each: elements · palette names · placement · motion)
- sky: gradient = mood.sky stops; sun disc 'diya_core' r=0.04·H at (0.08·W, 0.55·H); 3 clouds at …; clouds drift +6 px/s on F.t
- far_bg: <elements, palette, placement, parallax depth if it overrides the style default>
- far_bg_lights: <emissive points: what, where, palette, flicker = noise1(F.tc + k, 4)>
- mid_bg: …
- mid_bg_lights: …
- action_plane: <ground/plinth + the character via CAV.lib.<project>.drawFigure(...) with exact args per params>
- foreground_frame: <framing element that slides faster than the subject; palette; which edge; how far it intrudes>
- overlay: <particles: kind, count, seed, size, area; pause-reveal effects tied to F.pause>

## Params (per-shot switches this scene reads)
- pose: 'walk' | 'hold_diya'   — what changes
- figureX: number (world px)    — figure start x
- arch: boolean (default true)  — draw the foreground arch

## Must be visible (QA checks these on the preview/QA frames)
1. <concrete visible fact, e.g. "rim crescent on the figure's left edge (toward the sun), none on the right">
2. <e.g. "at least 3 lit windows on the far bank, brighter than the haze">
3. <e.g. "arch top corners frame the shot, garland sways (differs between frames 30 and 34)">
```

Composition rules every spec must already satisfy (so the artist never has to judge them): subject on a third, a readable
silhouette, ground contact for every figure and structure, a foreground framing element, ≥ 400 px background margins past
every edge, one key light = `mood.key_dir_deg`, palette names only, and `strictly_avoid` respected.
