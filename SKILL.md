---
name: custom-animated-video
version: 1.1.0
description: Turn a script + voiceover + ANY style_bible.json into a finished, frame-by-frame animated MP4 with lip sync, tapered-ink cel art, rim light, cloth physics, parallax camera moves, styled subtitles, style-matched foley/ambience and an auto-ducked, -14 LUFS mix. Use when the user asks to animate a voiceover/narration, make an animated short, explainer or YouTube Short from a script and audio, render a story "in my style", or build a video from a style bible. Renders locally (Playwright + HTML5 canvas + FFmpeg + numpy/scipy, faster-whisper for alignment); no cloud video APIs. Orchestrates specialised subagents (cav-*), each on its own model and effort.
allowed-tools: Agent, Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# custom-animated-video: orchestrator

`SKILL_DIR` = the folder holding this file. You are the **orchestrator**: you keep the user's intent, delegate each stage to a
specialised subagent, and run the review gate yourself. **Never bake a style into the core**; every style value comes from the
user's `style_bible.json`.

| flag | meaning |
|---|---|
| `--script` | `script.txt` / `script.md` (the words actually spoken) |
| `--audio` | `voiceover.wav` / `.mp3` |
| `--style` | `style_bible.json` (any shape; normalized automatically) |
| `--bgm` | optional music file (else asset library, else procedural modal drone) |
| `--aspect` | `16:9` (1920×1080, default) or `9:16` (1080×1920) |
| `--subtitles` | `true` / `false` |
| `--out` | output `.mp4` (its folder is `WORK` unless `--workdir`) |

Pipeline (all driven by `scripts/build_video.py`): `normalize_style → analyze_audio → storyboard.json → scene_drawers.js →
sfx_synth → mix_audio → render_frames (per shot → clip, frames deleted) → concat + mux → QA frames → auto-clean → review gate`.

## Agents and routing

| stage | subagent | model · effort | job |
|---|---|---|---|
| 1 ingest | `cav-ingest` | haiku · low | runtime check, `--stage analyze`, writes `WORK/director_brief.json` |
| 2 direct | `cav-director` | sonnet · medium | `storyboard.json` (7 director rules); shot-only updates |
| 3 draw | `cav-artist` (`cav-artist-fast` in fast/budget mode) | opus · high (sonnet · high) | `scene_drawers.js` (6 art rules) + preview verify; targeted fixes |
| 4 build | `cav-builder` | haiku · low | full / `--only` / `--apply-review` / `--ship`, audio telemetry |
| 5 QA | `cav-qa-critic` | sonnet · medium | inspects `WORK/qa/`, returns `STATUS: PASS|FAIL` + tickets |

Use fast mode **only if the user asked** for fast/budget/cheap/draft. Never silently downgrade the artist.

### Orchestration rules
* **Single-shot, stateless subagents.** Prompt caches expire after ~5 min and the user review gate can take far longer, so
  never keep a subagent alive across a gate and never `SendMessage` to a finished one. Spawn a **fresh** subagent per task
  with explicit absolute paths and a concise structured brief (below). Run independent work in one message.
* **Brief format** (every delegation): `SKILL_DIR`, `WORK`, the exact `--script/--audio/--style/--aspect/--subtitles/--bgm/--out`
  values, the task, the input files to read, the files to write, and the shape of the reply you need.
* **Keep your own context small:** read subagent summaries, not raw files. Never `Read` `audio_timeline.json` (huge per-frame
  arrays). Use `WORK/director_brief.json`.
* If a `cav-*` subagent type is not available yet in this session (agents registered mid-session may not be listed until a
  restart), **keep the model routing**: call `Agent(subagent_type="general-purpose", model=<m>)` with `model` = `haiku` for
  `cav-ingest`/`cav-builder`, `sonnet` for `cav-director`/`cav-artist-fast`/`cav-qa-critic`, `opus` for `cav-artist`, and tell it
  to first read `$SKILL_DIR/agents/<agent-name>.md` and follow it as its instructions, then give the usual brief.
* Make sure the user supplied script, voiceover and style bible; ask (AskUserQuestion) only for what is missing.

## Phase 0 · Register subagents and runtime

```bash
AGENTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents" && mkdir -p "$AGENTS_DIR" && for f in "$SKILL_DIR"/agents/cav-*.md; do cmp -s "$f" "$AGENTS_DIR/$(basename "$f")" || cp "$f" "$AGENTS_DIR/"; done
```
(Portable on macOS and Linux. `build_video.py` also keeps them synced on every run; the line above guarantees it on the first
turn.) The private runtime (`$SKILL_DIR/.runtime/`: venv, Whisper model, browser, ffmpeg if needed) is bootstrapped by
`cav-ingest` via `build_video.py --check` (1–3 min once, internet needed; never touches other envs). Decide `WORK`
(`dirname(--out)`) and `mkdir -p` it.

## Phase 1 · Ingest → `cav-ingest`

Delegate. Expect `STATUS: ok|needs_user` and `WORK/director_brief.json`.
* `alignment_coverage < 0.6` → the script does not match the take: **stop and ask the user** (fix script / confirm / provide a
  new take). Spelling-only differences are fine.
* A required mood/palette entry missing → ask whether to add it to the bible or accept the defaults.
* Otherwise continue; surface warnings in your next user-facing message.

## Phase 2 · Direct → `cav-director`

Inputs: `WORK/director_brief.json`, `WORK/storyboard.draft.json`, `references/storyboard_schema.json`. Output
`WORK/storyboard.json`. Sanity-check the reply (tiling, pause-midpoint cuts, 1.5–6 s shots, camera variety, sfx present).
Not satisfied → one fresh `cav-director` call with specific corrections.

## Phase 3 · Draw → `cav-artist` (or `cav-artist-fast`)

Inputs: `WORK/storyboard.json`, `WORK/style.normalized.json`, the user's bible, plus the original CLI args for preview renders.
Output `WORK/scene_drawers.js`, verified with a `--frames` preview (zero `[scene / layer / frame]` errors). The
artist's job is art only; storyboard changes it needs are reported back to you for `cav-director`.

## Phase 4 · Build → `cav-builder`

Full build to `--out` (it passes `--no-review`; the gate is yours). Expect `BUILD: ok`, ducking within ±1 dB of target,
≈ −14 LUFS, and `WORK/qa/` frames. On `failed`, route the named `[scene / layer / frame]` error to `cav-artist` (or a timing
error to `cav-director`), then rebuild with `--only`.

## Phase 5 · QA → `cav-qa-critic`

Always run before the user sees anything. On `STATUS: FAIL`:
1. Tickets with `target_file: scene_drawers.js` → fresh `cav-artist` (fix mode, ticket list in the brief).
   Tickets with `storyboard.json` → fresh `cav-director` (targeted update), then `cav-artist` if scene keys changed.
2. `cav-builder` with `--only <affected shot ids>`.
3. Fresh `cav-qa-critic` on the new frames.
**Max 2 auto-fix loops**; then tell the user what still fails and let them decide (continue to the review gate or direct a fix).

## Phase 6 · REVIEW GATE (you, in the main session; never skip, never decide for the user)

```bash
python3 "$SKILL_DIR/scripts/review.py" --questions --storyboard WORK/storyboard.json --video project/final_video.mp4
```
Ask with **AskUserQuestion**, at most three quick calls (tell them the video path and what QA confirmed):
1. **round1** · "Ship it or change it?"
2. If *Change it*, **round2** in ONE call: *Which parts?* (Visuals / Camera & editing / Subtitles / Sound, multi) and *Which
   moments?* (Whole video or specific shots, multi).
3. ONE call with the **round3** question for each selected part (multi; "Other" = free text):
   Visuals → Character · Background · Colours & lighting · Motion; Camera → Tighter · Wider · Calmer · Cut timing/transitions;
   Subtitles → Turn off · Bigger · Smaller · Move to top; Sound → Music quieter/louder · Effects quieter/louder.

Write the answers to `WORK/review.json`:
```json
{"decision": "change", "parts": ["visuals", "sound"], "shots": ["s2 3.5-5.6s"],
 "visuals": ["Character", "Motion"], "sound": ["Music quieter"],
 "notes": {"visuals": "face looks too long", "sound": "use ~/music/sitar.mp3"}}
```
Then:
* **Parametric changes** (framing tighter/wider/calmer, subtitles off/size/position, music/effects ±3 dB) → `cav-builder`
  with `--apply-review WORK/review.json`. It rebuilds only the affected targets (sound → audio + remux; camera → those shots;
  subtitles → all shots).
* **Art / cut tickets** (visuals, cut timing, free-text notes) → `--apply-review` also writes `WORK/review_plan.json` and
  prints the exact `--only` command. Delegate **only the affected shots** to a fresh `cav-director` (cut timing/camera pacing)
  and/or `cav-artist` (visuals), giving `review_plan.json` and the notes → `cav-builder --only <shots>` → `cav-qa-critic` on the
  changed shots → **back to round 1**.
Loop until *Ship it*. `storyboard.prev.json` holds the pre-change storyboard if the user wants to undo.

## Phase 7 · Ship → `cav-builder`

On *Ship it*, delegate `--ship` (`--keep-deps` if the user will make another video soon; `--purge-recipe` only if asked). It keeps
only the final video (plus the user's inputs and the few-KB `storyboard.json` / `scene_drawers.js` recipe) and deletes every
generated file and `$SKILL_DIR/.runtime/`. Tell the user: the video path, its spec line (resolution/fps/duration), and the disk
space freed. System tools (python3, ffmpeg, Chrome) are never touched.

---

## Guarantees the subagents must preserve (full detail in their files)

**Director:** shots tile; cuts at pause midpoints; 1.5–6 s; varied presets; `beat` on every pause; one mood/shot; transitions on
pauses; `speaker` on lip-sync shots; frame-accurate `sfx_events` (footsteps per `walk_cycle.frames_per_step`, ±1.5 dB
alternation; `swell` peaks at `t_sec + duration_sec` on the cut; `ambience` −24…−28 dB; `bgm.gain_db` −18…−21).
**Art:** palette-only colour, no hex, no `#000`, `shadowOf` shadows, one key light `F.mood.key_dir_deg`, five parallax layers +
`_lights`, ≥ 400 px margins, grounded architecture, `celShade` + `drawTaperedStroke(…, 1.6)` + one array-based `applyRimLight`,
IK-planted feet, cloth chains, lip-sync mouths, `CAV.withBoil` on twos (`tc`) for characters/FX only, deterministic RNG.
**Audio:** sfx assets first then procedural; `sidechaincompress` ducking ±1 dB of `audio_palette.duck_db` (15), +3 dB pause swells,
two-pass `loudnorm` −14 LUFS / −1.5 dBTP; stems deleted after the mix.
**Build:** per-shot clips (x264 crf 16) with frames deleted immediately; `build_state.json` hashes make reruns incremental;
`--only s2,s3,audio` restricts a rerun; shots whose cuts moved, and a crossfade follower of any re-rendered shot, always re-render.
Flags: `--preview --workers N --force --frames a,b,c --apply-review --ship --keep-deps --purge-recipe --stage analyze --check --auto`.
Art API: `references/art_reference.md` · schemas: `references/storyboard_schema.json`, `references/style_schema.json`.

## Troubleshooting
* `alignment_coverage` low → script and take differ; fix `script.txt`.
* **Hindi / Devanagari (and other non-English) scripts** are supported: the script's language is auto-detected and an
  English-only `*.en` Whisper model is swapped for its multilingual twin (`base.en` → `small`); sentences also split on
  `।`/`॥`. Force with `--language hi` / `CAV_LANGUAGE`; if Hindi coverage stays < 0.6, pass `--whisper-model medium`.
  Subtitles fall back to Devanagari fonts automatically.
* `scene_drawers.js does not define scene(s)` → storyboard `scene` keys must match `registerScenes` keys.
* Ducking far from target → breaths/music bleed; pass `--duck-db` or raise `bgm.gain_db`.
* Blank/black frames → a layer threw; read the `[scene / layer / frame]` error. Slow renders → `--workers N`, `--preview`.
* Runtime broken/stale → delete `$SKILL_DIR/.runtime/` and run `--check`. Offline → set `CAV_RUNTIME`; the aligner falls back to
  energy-only segmentation without a Whisper model.
* New subagents not listed in the current session → they are registered on disk; start a new Claude Code session or use the
  `general-purpose` fallback above (with the matching `model`).
