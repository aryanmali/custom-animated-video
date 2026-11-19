# Art reference: CAV primitives, frame object, coordinates

Read by `cav-artist` / `cav-artist-fast`. Rules live in the agent files; this is the API.

```js
(function () {
  const { c, mix, rgba, shadowOf, lightOf, rng, noise1, hash, clamp, lerp, TAU } = CAV;
  CAV.registerScenes({
    my_scene: {
      subject(F) { return { x, y, headY, facing }; },        // camera tracking target (world units)
      parallax: { mid_bg: 0.45 },                          // optional per-scene depth overrides
      layers: {                                            // back -> front; each gets its own parallax + haze
        sky(ctx, F) {}, far_bg(ctx, F) {}, mid_bg(ctx, F) {}, action_plane(ctx, F) {}, foreground_frame(ctx, F) {},
        far_bg_lights(ctx, F) {},                          // "<layer>_lights": emissive pass, same depth, AFTER haze
      },
      overlay(ctx, F) {},                                  // screen space: particles, flashes
    },
  });
})();
```

**Coordinates.** World units = the output frame for the chosen aspect (`F.W×F.H`: 1920×1080 or 1080×1920); `F.u` =
short side / 1080. The camera transforms each layer; paint backgrounds with ≥ 400 px margins past every edge
(camera drift, zoom < 1 on far layers, rotation). Compose for `F.aspect` (9:16 needs vertical stacking).

**Frame object `F`.** `i, t, fps, tShot, shotProgress, ic/tc/tcShot` (character time **on twos** — animate
characters/FX/cloth/flames with `tc`, camera with `t`), `W, H, u, aspect, params, mood {sky,key,key_dir_deg,
shadow_tint,rim,ink,ambient,glow,name}, S` (normalized style), `light` (unit vector toward the key), `env` (0..1),
`mouth, viseme, speaking, word, segment, pause` (current dramatic pause or null), `cam, layer, depth`.

**Shader primitives (use them; they encode the style rules):**
| call | does |
|---|---|
| `CAV.drawTaperedStroke(ctx, pts, baseWidth, color, taperStart, taperEnd, shadowBias, opts)` | variable-width ink ribbon: swells to `strokes.taper.peak_position`, tips at 0.2×, round caps; `shadowBias` 1.6 = heavier on the side away from the key, thinner on the lit side (flip-aware). `opts.boil` overrides line boil |
| `CAV.applyRimLight(ctx, silhouette, keyAngleDeg, rimColor, intensity, {width:3-5, boost})` | crisp rim crescent on light-facing edges, `screen`-composited. `silhouette` = path builder or **array of builders** (one per body part: never one path with mixed winding) |
| `CAV.celShade(ctx, pathFn | [fns], base, shadow|null|false, keyAngleDeg, offset)` | 2-tone hard cel: base + coloured crescent shadow (shape minus itself shifted toward the light). `null` shadow = `shadowOf(base)` |
| `CAV.stepClothChain(chain, windAngle, windStrength, stepImpulse)` → `chain.points` | travelling-sine cloth/hair (scarf, uttariya, cape, dhoti pleat, hair strand); pure function of `chain.t`/`F.tc` |
| `CAV.drawClothChain(ctx, chain, {width,endWidth,fill,shadow,border:{color,width,inner},folds,ink})` | renders the chain as a cel-shaded fabric ribbon with zari border and fold lines |
| `CAV.drawLipSyncMouth(ctx, F.S, F.mouth, {mood, size, viseme:F.viseme})` | mouth at ctx origin; translate/rotate/scale to the face first (scale x ≈ 0.6 for 3/4 view) |
| `CAV.applyPostProcessing(ctx, style, i, mood)` | grade, bloom, CA, paper, grain, vignette per `texture_post.order` — called by the runtime; don't call it yourself |
| helpers | `CAV.weight(kind, figureH, t)`, `c(name)`, `mix`, `rgba`, `shadowOf(col, amt)`, `lightOf`, `paintSky(ctx, stops, x,y,w,h, {steps})`, `glow`, `reflection`, `particles(ctx,F,{kind:'petal'|'ember'|'dust'|'rain'})`, `inkShape(ctx, pts, {fill,width,ink})`, `chipped(pts, amp, seed)`, `limb(ctx,a,b,r1,r2)`, `polyPath`, `catmull`, `withBoil(fn)`, `rng(seed)`, `noise1`, `hash`, `ease.*` |

## Preview

**Iterate cheaply:** render 3–4 frames, look, fix, repeat (uses the private runtime; frames land in `WORK/preview_frames/`):
```bash
python3 "$SKILL_DIR/scripts/build_video.py" --script script.txt --audio voiceover.wav --style style_bible.json \
        --storyboard storyboard.json --drawers scene_drawers.js --out project/final_video.mp4 --frames 30,110,160
```
Errors name the scene/layer/frame (`[scene ghat_closeup / layer action_plane / frame 110] …`).
