---
name: custom-animated-video
description: Turn a script + voiceover + ANY style_bible.json into a finished, frame-by-frame animated MP4 with lip sync, tapered-ink cel art, rim light, cloth physics, parallax camera moves, styled subtitles, style-matched foley/ambience and an auto-ducked, -14 LUFS mix. Use when the user asks to animate a voiceover/narration, make an animated short, explainer or YouTube Short from a script and audio, render a story "in my style", or build a video from a style bible. Renders locally (Playwright + HTML5 canvas + FFmpeg + numpy/scipy, faster-whisper for alignment); no cloud video APIs.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# custom-animated-video

`SKILL_DIR` = the folder holding this file. Runtime inputs, all per project — **never bake a style into the core**:

| flag | meaning |
|---|---|
| `--script` | `script.txt` / `script.md` (the words actually spoken) |
| `--audio` | `voiceover.wav` / `.mp3` |
| `--style` | `style_bible.json` (any shape; normalized automatically) |
| `--bgm` | optional music file (else asset library, else procedural modal drone) |
| `--aspect` | `16:9` (1920×1080, default) or `9:16` (1080×1920) |
| `--subtitles` | `true` / `false` |
| `--out` | output `.mp4` (its folder becomes the work dir unless `--workdir`) |

Pipeline: `normalize_style.py → analyze_audio.py → [you: storyboard.json + scene_drawers.js] → sfx_synth.py → mix_audio.py → render_frames.js (per shot → clip, frames deleted) → concat + mux → QA gate → auto-clean → REVIEW GATE (ship it / change it)`, all driven by `scripts/build_video.py`.

---

## 0 · Self-contained runtime (nothing to install by hand)

Run every command with plain `python3` (>= 3.9). On first use `build_video.py` creates a **private runtime** in
`$SKILL_DIR/.runtime/` and re-launches itself inside it: venv (numpy, scipy, faster-whisper, playwright — which bundles
its own Node.js), the Whisper model (`hf/`), Chromium only if no Chrome/Edge is installed (`browsers/`), and a bundled
ffmpeg only if the system one is missing or lacks libx264/sidechaincompress/loudnorm. Takes 1–3 min once; needs
internet. It never uses or modifies any other Python env, Node install or cache. Shipping deletes it again.
```bash
python3 "$SKILL_DIR/scripts/build_video.py" --check     # bootstraps if needed, then reports READY
```

## 1 · Ingest & validate

```bash
python3 "$SKILL_DIR/scripts/build_video.py" --script script.txt --audio voiceover.wav --style style_bible.json \
        --out project/final_video.mp4 --stage analyze
```
Writes into the work dir: `style.normalized.json`, `audio_timeline.json`, `storyboard.draft.json`. Then **read**:
* the normalizer summary (moods, colours) and any warnings — fix the bible if a mood/colour is missing;
* every segment's `[start - end] text`, every `dramatic_pause` (≥ 0.55 s), and `alignment_coverage` (< 0.6 means
  the script doesn't match the take — fix the script before going on);
* `audio_timeline.json` fields you will use: `segments[].phrases`, `words[]` (start_sec/end_sec), `pauses[]`
  (`start_frame`, `after_word`), `envelope[]` (0..1 per frame), `mouth[]` (`closed|open_small|open_wide`), `viseme[]`.

Read the style bible itself too (palette names, moods, strokes, proportions, architecture/nature prose, `strictly_avoid`).

## 2 · Direct the film → `storyboard.json` (schema: `references/storyboard_schema.json`)

Start from `storyboard.draft.json`, then make it purposeful. **Director rules:**
1. **Shots tile the timeline** (`next.start_sec == prev.end_sec`); cut **inside pauses**, ideally at the pause midpoint,
   never mid-word. A shot is 1.5–6 s; hold ≥ 12 frames at shot starts/ends (the rig does this).
2. **Vary the frame size with the story**: open `wide_establishing` → `medium_tracking` → `close_up_bust` for the
   emotional/dialogue line → release wide or `low_angle_hero` for the climax; `slow_push_in` for revelations,
   `over_shoulder` for listening. Never two identical presets back-to-back unless it is a deliberate continuation.
3. **Every dramatic pause earns something**: a camera hold, a reveal (lamps swell, a cut, a transition), a chime,
   and the BGM swell (automatic). Note it in the shot's `beat`.
4. **One mood per shot** from the user's `lighting_moods`; change mood only on a story turn (and cut on it).
5. **Transitions**: `crossfade` 8–12 frames across a pause for gentle beats, `cut` for energy, `dip_to_black` for time
   jumps, `flash` for impact. Put them where a pause is.
6. **Sound design (`sfx_events`)** — frame-accurate:
   * footsteps on every heel strike of a walking character (compute frames from your walk rig: one step every
     `walk_cycle.frames_per_step` frames, at the frames where a foot plants), `surface` from the ground you drew
     (or `audio_palette.footstep_surface`); alternate gain ±1.5 dB;
   * `whoosh` on fast camera/cloth moves and into close-ups, `chime` (`temple_bell|chime|singing_bowl`) on reveals
     and endings, `swell` before big cuts: it **starts** at `t_sec` and **peaks at `t_sec + duration_sec`** — put the
     peak on the cut;
   * `ambience` beds per location (`river|wind|rain|temple_hum|city_hum|night`), ~−24…−28 dB; `bgm.gain_db` ~−18…−21.
7. Set `speaker` on shots where an on-screen character mouths the narration.

## 3 · Compile project art → `scene_drawers.js`

A plain browser script that calls `CAV.registerScenes({...})`. Study `examples/test_project/scene_drawers.js`
(full ghat scene, walking rig, lip-synced bust) and `examples/generic_drawers.js` (minimal, style-only).

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

**Art rules (non-negotiable):**
1. Use **only** the user's palette names, mood colours and `CAV.weight()` stroke weights. No hard-coded hex unless the
   bible lacks a needed hue; then derive it with `mix/shadowOf/lightOf` from bible colours.
2. One key light per shot = `F.mood.key_dir_deg`. Every shadow is coloured (`shadowOf`), never grey; ink is the mood
   ink, never `#000`. Respect `strictly_avoid`.
3. **Characters**: build a rig function (joints from `S.proportions`), lay parts back→front in the bible's layering
   order, `celShade` each part, ink silhouettes with `drawTaperedStroke(..., 1.6)`, then one `applyRimLight(parts)`.
   Wrap character/FX drawing in `CAV.withBoil(() => …)` (backgrounds never boil). Walks: plant the stance foot in world
   space (IK) — no foot sliding. Faces facing left/right: compute features from a `forward = facing` sign.
4. **Ground the architecture**: every building sits on something (plinth, steps, bank, street) with a contact line or
   cast shadow; far layers are hazed automatically (`texture_post.atmospheric_haze`) — put lamps/windows in
   `<layer>_lights` so they stay bright; give water reflections; add `chipped()` edges, crack ticks, niches; frame
   with a `foreground_frame` element (arch, pillar, fronds, garland) that slides faster than the subject.
5. Something always drifts (`particles`), flames flicker on twos, cloth/hair always move (`stepClothChain`).
6. Determinism: no `Math.random()`/`Date` — use `rng(seed)`, `hash`, `noise1`. Frames render in parallel, in any order.

**Iterate cheaply:** render 3–4 frames, look, fix, repeat (uses the private runtime; frames land in `WORK/preview_frames/`):
```bash
python3 "$SKILL_DIR/scripts/build_video.py" --script script.txt --audio voiceover.wav --style style_bible.json \
        --storyboard storyboard.json --drawers scene_drawers.js --out project/final_video.mp4 --frames 30,110,160
```
Errors name the scene/layer/frame (`[scene ghat_closeup / layer action_plane / frame 110] …`).

## 4 · Render & mix

```bash
python3 "$SKILL_DIR/scripts/build_video.py" --script script.txt --audio voiceover.wav --style style_bible.json \
        --storyboard storyboard.json --drawers scene_drawers.js [--bgm music.mp3] --aspect 16:9 --subtitles true \
        --out project/final_video.mp4
```
* **Audio**: `sfx_synth.py` (asset library `./assets/sfx`, `./assets/bgm` first, procedural fallback) → `mix_audio.py`
  (events at exact ms via `adelay`, `sidechaincompress` ducking calibrated to `audio_palette.duck_db` (15 dB), +3 dB
  swells in pauses, two-pass `loudnorm` −14 LUFS / −1.5 dBTP). Stems are deleted after the mix.
* **Video**: each shot renders to PNG frames → encoded to `clips/<n>_<id>.mp4` (x264 crf 16) → **frames deleted
  immediately**; clips are concatenated with the master audio (`aac 192k`). `--preview` = half resolution.
* **Incremental**: `build_state.json` hashes every shot and the mix; a rerun re-renders only what changed.
  `--only s2,s3,audio` restricts a rerun to those targets (use it after editing drawers for specific shots — other
  shots are accepted as-is). Shots whose cut points moved, and the shot after any re-rendered shot that crossfades from
  it, are always re-rendered.
* **Auto-clean** after every build: frames, stems, concat list and `__pycache__` are removed; the work dir keeps only
  `final_video.mp4`, small clips/QA/JSON needed for quick changes.
Check the printed lines: ducking within ±1 dB of target, ~−14 LUFS.

## 5 · Mandatory visual QA gate (before you show the user anything)

`build_video.py` extracts the **opening**, **dialogue close-up** and **ending** frames to `WORK/qa/` (+ `contact_sheet.png`).
**Read all three images** and check, fixing and re-rendering (`--only <shot>`) anything that fails:
- [ ] rim light: a thin warm crescent on the light side only — no glowing internal seams, no blown-out outlines
- [ ] tapered strokes: lines swell and taper, heavier on the shadow side; no uniform vector lines or black ink
- [ ] composition: subject on a third, readable silhouette, ground contact, foreground frame, no empty frame edges
- [ ] architecture grounded (base/steps/shadow), hazed with depth; lights bright
- [ ] subtitles (if on): fully legible, inside the safe area, active word highlighted, not covering the face
- [ ] faces point the way the body faces; mouths open on speech in the dialogue frame
Spot-check motion with `--frames a,a+1,a+2,a+4` (drawings should change every 2 frames).

## 6 · REVIEW GATE — always ask "Ship it or Change it?" (never skip, never decide for the user)

Get the exact questions for this video (shot options are generated from the storyboard):
```bash
python3 "$SKILL_DIR/scripts/review.py" --questions --storyboard storyboard.json --video project/final_video.mp4
```
Ask with **AskUserQuestion**, at most three quick calls:
1. **round1** — "Ship it or change it?" (tell them the video path and what the QA gate confirmed).
2. If *Change it*: **round2** in ONE call — *Which parts?* (Visuals / Camera & editing / Subtitles / Sound, multi)
   and *Which moments?* (Whole video or specific shots, multi).
3. ONE call with the **round3** question for each selected part (multi-select; "Other" = free-text notes):
   * Visuals → Character · Background · Colours & lighting · Motion
   * Camera → Tighter framing · Wider framing · Calmer camera · Cut timing / transitions
   * Subtitles → Turn them off · Bigger · Smaller · Move to the top
   * Sound → Music quieter · Music louder · Effects quieter · Effects louder

Write the answers to `WORK/review.json` (labels or keys both work):
```json
{"decision": "change", "parts": ["visuals", "sound"], "shots": ["s2 3.5-5.6s"],
 "visuals": ["Character", "Motion"], "sound": ["Music quieter"],
 "notes": {"visuals": "face looks too long", "sound": "use ~/music/sitar.mp3"}}
```
then run `python3 "$SKILL_DIR/scripts/build_video.py" --out project/final_video.mp4 --apply-review WORK/review.json`
(inputs are remembered from the first build). It:
* **applies parametric fixes itself** — framing tighter/wider/calmer, subtitles off/size/position, music/effects ±3 dB —
  and rebuilds only the affected targets (sound → audio + remux only; camera → those shots; subtitles → all shots);
* for **art tickets** (visuals, cut timing, free-text notes) it writes `review_plan.json`, prints what to change and the
  exact `--only` rebuild command. Make those edits (scene_drawers.js / storyboard.json, only for the listed shots),
  rebuild with that command, re-run the QA gate on the changed shots, then **go back to round 1**.
Loop until the user picks *Ship it*. `storyboard.prev.json` holds the pre-change storyboard if they want to undo.

## 7 · Ship it

```bash
python3 "$SKILL_DIR/scripts/build_video.py" --out project/final_video.mp4 --ship
```
Keeps **only the final video** (plus the user's own inputs and the few-KB `storyboard.json` / `scene_drawers.js`
recipe; add `--purge-recipe` to drop those too). Deletes every generated file (clips, QA frames, audio, timeline,
state) **and the skill's private runtime** `$SKILL_DIR/.runtime/` (venv, model, browser, bundled ffmpeg) so the machine
is left clean; `--keep-deps` keeps the runtime for another video soon. System tools (python3, ffmpeg, Chrome) are never
touched. Deliver: the video path, its spec line, and what was freed.

## Troubleshooting
* `alignment_coverage` low → script and take differ; fix `script.txt` (spelling-only differences are fine).
* `scene_drawers.js does not define scene(s)` → storyboard `scene` keys must match `registerScenes` keys.
* Ducking far from target → the voice has long breaths/music bleed; pass `--duck-db` or raise `bgm.gain_db`.
* Blank/black frames → a layer threw; read the `[scene / layer / frame]` error. Slow renders → `--workers N`, `--preview`.
* Runtime broken or stale → delete `$SKILL_DIR/.runtime/` and run `--check` (it rebuilds). Offline → set `CAV_RUNTIME`
  to an existing runtime; the aligner falls back to energy-only segmentation if no Whisper model is available.
