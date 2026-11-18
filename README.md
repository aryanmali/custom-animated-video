# custom-animated-video

**Script + voiceover + any `style_bible.json` → a finished, lip-synced, sound-designed animated MP4.**
A Claude Skill and a standalone CLI. Everything renders locally: Playwright drives an HTML5 canvas frame by frame,
faster-whisper aligns the voice, numpy/scipy synthesize the sound design, and FFmpeg ducks, masters and muxes.
The core never knows what your style looks like. Every colour, line weight, taper, grain and cadence value comes from
the style bible you pass at run time.

```
                ┌──────────────┐   ┌────────────────────┐
 style_bible ──▶│normalize_style│──▶│ style.normalized   │──────────────────────────────┐
                └──────────────┘   └────────────────────┘                              │
                ┌──────────────┐   ┌────────────────────┐   ┌──────────────────────┐   ▼
 script  ──┬───▶│analyze_audio │──▶│ audio_timeline.json│──▶│ storyboard.json      │ ┌──────────────────┐
 voiceover ┘    │ whisper+align│   │ segments, words,   │   │ (Claude directs:     │ │ render_frames.js │
                │ pauses, 24fps│   │ dramatic_pause,    │   │ shots, moods, camera,│▶│ Playwright+canvas│──▶ frames/*.png
                │ RMS, mouths  │   │ envelope, mouth    │   │ sfx_events)          │ │ canvas_runtime.js│      │
                └──────────────┘   └────────────────────┘   ├──────────────────────┤ │ + scene_drawers  │      │
                                                            │ scene_drawers.js     │▶└──────────────────┘      │
                                                            │ (Claude draws)       │                           │
                                                            └──────────┬───────────┘                           │
                ┌──────────────┐   ┌────────────────────┐              │                                       ▼
 --bgm / assets▶│ sfx_synth    │──▶│ ambience, bgm,     │──┐  ┌────────▼─────────┐             ┌────────────────────┐
                │ assets first,│   │ events/*.wav       │  └─▶│ mix_audio        │──master──▶  │ ffmpeg mux x264/aac│──▶ final.mp4
                │ procedural   │   └────────────────────┘     │ adelay, sidechain│  _audio.wav │ + QA keyframes     │
                └──────────────┘                              │ duck, loudnorm   │             └────────────────────┘
                                                              └──────────────────┘
```

## Install

Copy this folder anywhere (as a Claude Code skill: `~/.claude/skills/custom-animated-video/`). That's it.
The only prerequisite is **python3 ≥ 3.9** and internet on the first run. Everything else installs itself into a
private `.runtime/` folder inside the skill: a venv with numpy, scipy, faster-whisper and Playwright (which bundles its
own Node.js), the Whisper model, Chromium if you have no Chrome/Edge, and an ffmpeg if yours is missing or incomplete.
No global installs, nothing written to `~/.cache`, and no other Python/Node environment touched.
**Shipping a video deletes `.runtime/` again**, and the next run rebuilds it.

```bash
python3 scripts/build_video.py --check          # bootstrap (1–3 min once) and verify
```

## Use

```bash
# 1) analyse: normalized style, aligned timeline, draft storyboard
python3 scripts/build_video.py --script script.txt --audio voiceover.wav --style style_bible.json \
        --out myfilm/final_video.mp4 --stage analyze

# 2) direct + draw: write myfilm/storyboard.json and myfilm/scene_drawers.js (Claude does this; see SKILL.md)
#    quick looks while drawing:  ... --frames 30,110,160

# 3) build (incremental: only changed shots / audio are redone)
python3 scripts/build_video.py --script script.txt --audio voiceover.wav --style style_bible.json \
        --storyboard myfilm/storyboard.json --drawers myfilm/scene_drawers.js \
        --aspect 16:9 --subtitles true [--bgm music.mp3] --out myfilm/final_video.mp4

# 4) review gate: in a terminal you are asked "Ship it / Change it" right away.
#    Change it -> a short questionnaire (which parts, which shots, what's wrong); simple fixes are applied
#    automatically and only the affected shots/audio are rebuilt. From Claude: review.py --questions + --apply-review.
python3 scripts/build_video.py --out myfilm/final_video.mp4 --apply-review review.json

# 5) ship: keep only the video; delete intermediates and the private runtime
python3 scripts/build_video.py --out myfilm/final_video.mp4 --ship
```

| flag | default | |
|---|---|---|
| `--script` / `--audio` / `--style` | required on first build | `.txt/.md`, `.wav/.mp3`, any style bible (remembered afterwards) |
| `--storyboard` / `--drawers` | `<workdir>/storyboard.json`, `<workdir>/scene_drawers.js` | |
| `--bgm` | auto | file > `storyboard.bgm.path` > `assets/bgm/*` > procedural modal drone |
| `--aspect` / `--subtitles` | `16:9` / storyboard | `9:16` renders 1080×1920; karaoke captions in the style's colours |
| `--out` / `--workdir` | `final_video.mp4` / its folder | |
| `--only` | – | `s2,s3,audio`: rebuild just these (others accepted as-is) |
| `--frames` | – | render a few frames to `preview_frames/` for art iteration |
| `--apply-review` | – | apply a `review.json` (ship/change answers) and rebuild only what it touches |
| `--ship` (`--keep-deps`, `--purge-recipe`) | – | keep only the video; delete intermediates (+ runtime unless `--keep-deps`) |
| `--preview` / `--workers` / `--force` | off / cores÷2 / off | half resolution / parallel pages / redo everything |
| `--whisper-model` / `--no-review` / `--clean` / `--check` | `base.en` | |

**Disk hygiene is automatic.** Frames are deleted as soon as each shot's clip is encoded, and stems as soon as the
mix is mastered. Between builds a project holds only the final video, a few MB of clips, the master audio, QA frames
and small JSON files. After shipping, only the video remains.

## What you get

* **Alignment.** Every sentence and phrase gets exact start/end times, and every word too (script words forced onto
  ASR word timings, interpolated where ASR differs). Silent gaps of 0.55 s or more are tagged `dramatic_pause`, with
  camera-hold / reveal / BGM-swell hints. The analyzer also writes a 24 fps vocal RMS envelope and
  `closed/open_small/open_wide` mouth states, plus viseme hints. Fallbacks: faster-whisper → openai-whisper →
  energy-only.
* **Renderer.** Five parallax planes (`sky`, `far_bg`, `mid_bg`, `action_plane`, `foreground_frame`), each with
  per-layer atmospheric haze and an emissive `_lights` pass. Six camera presets with easing, holds, tracking and
  low-angle tilt. Cuts, crossfades, dips, flashes and wipes. Characters animate on twos and the camera on ones, with
  on-twos line boil. The full post stack follows the bible's order.
* **Primitives.** `drawTaperedStroke`, `applyRimLight`, `celShade`, `stepClothChain` + `drawClothChain`,
  `drawLipSyncMouth`, `applyPostProcessing`, plus sky, glow, reflection, particle, chipped-edge and limb helpers.
* **Sound.**
  * Asset library first: name files `footstep_stone_01.wav`, `chime_temple_bell.wav`, `bed_river.wav` or
    `bgm_<mood>.mp3`.
  * Otherwise procedural, warm and non-harsh: beds (river, wind, rain, temple_hum, city_hum, night), foley
    (footsteps on stone, wood, grass or gravel, cloth whoosh, temple bell, chime, singing bowl, low swell) and a
    tanpura-style modal drone with a pad.
  * Events are placed to the millisecond. The BGM ducks under the voice via `sidechaincompress`, calibrated in a
    closed loop to the requested depth (15 dB by default), and swells +3 dB in pauses. Two-pass `loudnorm` brings the
    mix to −14 LUFS.
* **QA and review.** The opening, dialogue and ending keyframes plus a contact sheet are written to `qa/`, and
  `mix_report.json` records the measured ducking, loudness and event placements. Then the ship-it/change-it gate runs.

## The style contract

`references/style_schema.json` documents the normalized form. `normalize_style.py` accepts:
* the flat contract (`palette`, `lighting_moods`, `strokes`, `proportions`, `texture_post`, `motion_rules`,
  `audio_palette`, `subtitles`);
* numbered "style bible" sections (`1_linework_and_stroke_physics`, `2_colour_and_lighting_architecture.moods`,
  `3_texture_and_post_processing`, …). Prose rules such as "1.6x heavier", "6-10 segments, damping 0.88-0.94" or
  "every 2 frames" are parsed into numbers;
* partial bibles, down to just `{"palette": {...}}`. Every missing field gets a default and a warning.

Optional `audio_palette`:
```json
"audio_palette": { "ambient_bed": "auto", "footstep_surface": "stone", "accent_chime": "temple_bell",
                   "drone_root_hz": 110, "duck_db": 15, "pause_swell_db": 3 }
```

## Example

`examples/test_project/` is the integration test: a 7-second, two-sentence poem ("At dusk, the river carries every
lamp back home. / Walk slowly. The light remembers you."). It has a ghat at dusk with a walking figure, a lip-synced
dialogue close-up and a low-angle hero ending, and renders end to end in about 30 s on an Apple-silicon laptop.
It ships the script, storyboard and bespoke drawers only; bring your own voiceover and a style bible with the palette
names listed in `examples/test_project/README.md`. To try the pipeline with any style at all, use `--auto`
(generic drawers).

## Layout
```
custom-animated-video/
├── SKILL.md  README.md  requirements.txt
├── references/  style_schema.json  storyboard_schema.json
├── scripts/     normalize_style.py  analyze_audio.py  render_frames.js  canvas_runtime.js
│                sfx_synth.py  mix_audio.py  build_video.py  review.py  runtime.py
├── examples/    generic_drawers.js  test_project/{README.md, script.txt, storyboard.json, scene_drawers.js}
├── .runtime/    (created on first run, deleted on ship: venv, model, browser, ffmpeg)
└── assets/      sfx/  bgm/   (drop recordings here to override procedural sound)
```

MIT licensed.
