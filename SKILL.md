---
name: custom-animated-video
version: 1.2.1
description: Turn a script + voiceover + ANY style_bible.json into a finished, frame-by-frame animated MP4 with lip sync, tapered-ink cel art, rim light, cloth physics, parallax camera moves, styled subtitles, style-matched foley/ambience and an auto-ducked, -14 LUFS mix. Use when the user asks to animate a voiceover/narration, make an animated short, explainer or YouTube Short from a script and audio, render a story "in my style", or build a video from a style bible. Renders locally (Playwright + HTML5 canvas + FFmpeg + numpy/scipy, faster-whisper for alignment); no cloud video APIs. Orchestrates specialised subagents (cav-*): Opus makes the creative decisions (storyboard, visual specs, QA), Sonnet/Haiku execute.
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
| `--bgm` | optional music file (else asset library, else procedural drone + Bhairavi motif with reverb) |
| `--aspect` | `16:9` (1920×1080, default) or `9:16` (1080×1920) |
| `--subtitles` | `true` / `false` |
| `--out` | output `.mp4` (its folder is `WORK` unless `--workdir`) |

Pipeline (all driven by `scripts/build_video.py`): `normalize_style → analyze_audio → storyboard.json + visual_specs/ →
drawers/ (_common.js + <scene>.js) → sfx_synth → mix_audio → render_frames (per shot → clip, frames deleted) → concat + mux →
QA frames → auto-clean → review gate`.

## Agents and routing

**Principle: Opus decides, Sonnet/Haiku execute.** Every creative decision (what the film looks and feels like, and what
is wrong with it) is made by Opus. Everything that turns a decision into files, frames and sound runs on Sonnet or Haiku.

| stage | subagent | model · effort | job |
|---|---|---|---|
| 1 ingest | `cav-ingest` | haiku · low | runtime check, `--stage analyze`, writes `WORK/director_brief.json` |
| 2 creative | `cav-storyboarder` | **opus · high** | every creative call: shots/cuts, scene keys, camera, mood, transitions, params, `sound_intent` → `storyboard.json`; executable per-scene specs → `visual_specs/*.md` |
| 3 timing & sound | `cav-timeline` | sonnet · medium | tiling and frame boundaries (no creative edits); `sound_intent` → frame-accurate `sfx_events`/ambience/bgm; applies storyboard tickets |
| 4 draw | `cav-artist` | sonnet · medium | implements the specs literally → `drawers/_common.js` + `drawers/<scene>.js`; preview-verifies; applies drawer tickets |
| 5 build | `cav-builder` | haiku · low | full / incremental / `--apply-review` / `--ship`, audio telemetry |
| 6 QA | `cav-qa-critic` | **opus · medium** | judges frames vs the 6 checks + specs' "Must be visible"; writes `WORK/qa/tickets_r<N>.json`; on the final round `WORK/known_flaws.md` |

**Fast / budget mode** (only if the user asked for fast/budget/cheap/draft): spawn `cav-storyboarder` with
`effort: "medium"` and tell it `mode: fast`. Every other agent is unchanged. Never silently downgrade anything.

### Orchestration rules
* **Single-shot, stateless subagents.** Prompt caches expire after ~5 min and the user review gate can take far longer, so
  never keep a subagent alive across a gate and never `SendMessage` to a finished one. Spawn a **fresh** subagent per task
  with explicit absolute paths and a concise structured brief (below). Run independent work in one message.
* **Brief format** (every delegation): `SKILL_DIR`, `WORK`, the exact `--script/--audio/--style/--aspect/--subtitles/--bgm/--out`
  values, the mode, the input files to read, the files to write, and the shape of the reply you need.
* **Be a relay, not an author.** Pass **file paths** between agents (ticket files, `review_plan.json`, scene key lists).
  Never re-read or re-word specs, tickets or drawers yourself; that would spend tokens and dilute the Opus decisions.
  Read only the agents' short summaries. Never `Read` `audio_timeline.json`; use `WORK/director_brief.json`.
* **Modularity is what saves tokens.** One scene = one spec file = one drawer file. The build hashes each shot against
  `_common.js` + its own `<scene>.js`, so a fix to one scene re-renders only the shots that use it, with no `--only` needed.
* If a `cav-*` subagent type is not available yet in this session (agents registered mid-session may not be listed until a
  restart), **keep the model routing**: call `Agent(subagent_type="general-purpose", model=<m>)` with `model` = `opus` for
  `cav-storyboarder`/`cav-qa-critic`, `sonnet` for `cav-timeline`/`cav-artist`, `haiku` for `cav-ingest`/`cav-builder`. Tell it
  to first read `$SKILL_DIR/agents/<agent-name>.md` and follow it as its instructions, then give the usual brief.
* Make sure the user supplied script, voiceover and style bible; ask (AskUserQuestion) only for what is missing.

## Phase 0 · Register subagents and runtime

```bash
AGENTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents" && mkdir -p "$AGENTS_DIR" && for f in "$SKILL_DIR"/agents/cav-*.md; do cmp -s "$f" "$AGENTS_DIR/$(basename "$f")" || cp "$f" "$AGENTS_DIR/"; done; rm -f "$AGENTS_DIR/cav-director.md" "$AGENTS_DIR/cav-artist-fast.md"
```
(Portable on macOS and Linux. `build_video.py` also keeps them synced on every run and removes the two retired v1 agents. The
line above guarantees it on the first turn.) The private runtime (`$SKILL_DIR/.runtime/`: venv, Whisper model, browser, ffmpeg
if needed) is bootstrapped by `cav-ingest` via `build_video.py --check` (1–3 min once, internet needed; never touches other
envs). Decide `WORK` (`dirname(--out)`) and `mkdir -p` it.

## Phase 1 · Ingest → `cav-ingest`

Delegate. Expect `STATUS: ok|needs_user` and `WORK/director_brief.json`.
* `alignment_coverage < 0.6` → the script does not match the take: **stop and ask the user** (fix the script / confirm /
  provide a new take). Spelling-only differences are fine.
* A required mood/palette entry missing → ask whether to add it to the bible or accept the defaults.
* Otherwise continue; surface warnings in your next user-facing message.

## Phase 2 · Creative → `cav-storyboarder` (opus · high)

Inputs: `WORK/director_brief.json`, `WORK/storyboard.draft.json`. Outputs: `WORK/storyboard.json` (creative fields +
`sound_intent`, empty `sfx_events`), `WORK/visual_specs/_common.md` and one `WORK/visual_specs/<scene>.md` per scene key.
Its reply lists the scene keys and suggested artist batches. Do not second-guess its creative choices. Only if the reply
reports a broken rule (tiling, shot length), send one fresh targeted call naming it.

## Phase 3 · Timing & sound → `cav-timeline` (sonnet · medium)

Mode `full`. It makes `storyboard.json` frame-accurate and fills `sfx_events`/`ambience`/`bgm` from `sound_intent`. If it
returns `NEEDS_STORYBOARDER: …`, pass exactly those lines to a fresh `cav-storyboarder` (targeted), then re-run `cav-timeline`.

## Phase 4 · Draw → `cav-artist` (sonnet · medium)

* ≤ 4 scenes: one artist owns `_common.js` + all scenes.
* More scenes: first one artist owns `_common.js` + the first batch, then up to **3 parallel** artists (one message), each
  owning a disjoint list of scene keys. None of them touches `_common.js`.
Each artist writes `WORK/drawers/…` and verifies with a `--frames` preview (zero load/draw errors). Storyboard or spec
problems come back in its reply. Route them to `cav-storyboarder` (creative) or `cav-timeline` (timing); never fix them yourself.

## Phase 5 · Build → `cav-builder` (haiku · low)

Full build with `--drawers WORK/drawers` (it passes `--no-review`; the gate is yours). Expect `BUILD: ok`, ducking within
±1 dB of target, ≈ −14 LUFS, and `WORK/qa/` frames. On `failed`, send the named drawer file / `[scene / layer / frame]` error
to a fresh `cav-artist` (fix mode, error text in the brief), or a timing error to `cav-timeline`, then rebuild.

## Phase 6 · QA loop → `cav-qa-critic` (opus · medium); **max 2 fix rounds**

Always run before the user sees anything. Rounds:
```
QA r1 ─PASS→ review gate
  └FAIL→ fix round 1 → rebuild → QA r2 ─PASS→ review gate
                                   └FAIL→ fix round 2 → rebuild → QA r3 (verify only, final) ─PASS→ review gate
                                                                     └FAIL→ WORK/known_flaws.md → review gate
```
A **fix round** = relay the ticket file, unchanged, straight to the executors:
1. If the QA reply counts drawer tickets: one fresh `cav-artist` in fix mode with `tickets: WORK/qa/tickets_r<N>.json`.
   When the tickets span more than 3 scene files, use up to 3 parallel artists, each given the same file plus a disjoint
   scene-key list.
2. If it counts storyboard tickets: a fresh `cav-timeline` in tickets mode with the same file path (in parallel with step 1).
3. `cav-builder` incremental rebuild: the same full-build command, **without `--only`**. Each shot's hash covers its
   storyboard entry, its range and its scene file, so exactly the shots touched by the fixes re-render (the log says why).
   `--only` would risk skipping other shots of a changed scene.
4. A fresh `cav-qa-critic` with `round: N+1`, the previous ticket file, and the rebuilt shot ids. Round 3 is verify only and
   writes `WORK/known_flaws.md` on FAIL.

Never run a 4th QA round or a 3rd fix round. Remaining flaws are the user's call at the review gate.

## Phase 7 · REVIEW GATE (you, in the main session; never skip, never decide for the user)

If `WORK/known_flaws.md` exists, tell the user its path and flaw count before asking.

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
* **Art / cut / free-text tickets**: `--apply-review` also writes `WORK/review_plan.json` (each item names its `agent`) and
  prints the exact `--only` command. Route by that field, passing the file path, not your own summary:
  * visuals / free-text → fresh `cav-storyboarder` (targeted; `effort: "medium"` for small notes, default high for a
    redesign). It returns `CHANGED_SCENES`/`CHANGED_SHOTS` → `cav-artist` (review mode, **only those scene keys**);
  * cut timing → `cav-storyboarder` (targeted) → `cav-timeline` (re-tile, re-time sfx);
  * sound notes → `cav-timeline` (review mode).
  Then `cav-builder` (incremental, no `--only`: the per-scene cache finds every affected shot) → **one** `cav-qa-critic` pass on the changed shots
  (`round: review`, "append" flaws to `WORK/known_flaws.md` on FAIL; no automatic fix loop) → **back to round 1**.
Loop until *Ship it*. `storyboard.prev.json` holds the pre-change storyboard if the user wants to undo.

## Phase 8 · Ship → `cav-builder`

On *Ship it*, delegate `--ship` (`--keep-deps` if the user will make another video soon; `--purge-recipe` only if asked). It keeps
only the final video (plus the user's inputs and the few-KB recipe: `storyboard.json`, `drawers/`, `visual_specs/`,
`known_flaws.md`) and deletes every generated file and `$SKILL_DIR/.runtime/`. Tell the user: the video path, its spec line (resolution/fps/duration), and the disk
space freed. System tools (python3, ffmpeg, Chrome) are never touched.

---

## Guarantees the subagents must preserve (full detail in their files)

**Storyboarder + timeline:** shots tile; cuts at pause midpoints; 1.5–4 s; varied presets; `beat` on every pause; one
mood/shot; transitions on pauses; `speaker` on lip-sync shots; frame-accurate `sfx_events` (footsteps per `walk_cycle.frames_per_step`, ±1.5 dB
alternation; `swell` peaks at `t_sec + duration_sec` on the cut; `ambience` −24…−28 dB; `bgm.gain_db` −18…−21).
**Specs:** every aesthetic choice decided in `visual_specs/` (palette names, positions, motion, "Must be visible").
**Art:** one scene per `drawers/<scene>.js`, shared rig in `_common.js`; palette-only colour, no hex, no `#000`,
`shadowOf` shadows, one key light `F.mood.key_dir_deg`, five parallax layers + `_lights`, ≥ 400 px margins, grounded architecture, `celShade` + `drawTaperedStroke(…, 1.6)` + one array-based `applyRimLight`,
IK-planted feet, cloth chains, lip-sync mouths, `CAV.withBoil` on twos (`tc`) for characters/FX only, deterministic RNG.
**Audio:** sfx assets first then procedural; `sidechaincompress` ducking ±1 dB of `audio_palette.duck_db` (15), +3 dB pause swells,
two-pass `loudnorm` −14 LUFS / −1.5 dBTP; stems deleted after the mix.
**Build:** per-shot clips (x264 crf 16) with frames deleted immediately; `build_state.json` hashes make reruns incremental;
with `drawers/` each shot hashes only `_common*.js` + its own scene file (the log prints why each shot re-renders);
`--only s2,s3,audio` restricts a rerun; shots whose cuts moved, and a crossfade follower of any re-rendered shot, always re-render.
Flags: `--preview --workers N --force --frames a,b,c --apply-review --ship --keep-deps --purge-recipe --stage analyze --check --auto`.
Art API: `references/art_reference.md` · schemas: `references/storyboard_schema.json`, `references/style_schema.json`.

## Troubleshooting
* `alignment_coverage` low → script and take differ; fix `script.txt`.
* **Hindi / Devanagari (and other non-English) scripts** are supported: the script's language is auto-detected and an
  English-only `*.en` Whisper model is swapped for its multilingual twin (`base.en` → `small`); sentences also split on
  `।`/`॥`. Force with `--language hi` / `CAV_LANGUAGE`; if Hindi coverage stays < 0.6, pass `--whisper-model medium`.
  Subtitles fall back to Devanagari fonts automatically.
* `drawers do not define scene(s)` → every storyboard `scene` key needs `drawers/<key>.js` registering exactly that key.
* `drawer <file> failed to load` → syntax/runtime error at load in that file (often `CAV.lib.<project>` used before
  `_common.js` exported it).
* Ducking far from target → breaths/music bleed; pass `--duck-db` or raise `bgm.gain_db`.
* Blank/black frames → a layer threw; read the `[scene / layer / frame]` error. Slow renders → `--workers N`, `--preview`.
* Runtime broken/stale → delete `$SKILL_DIR/.runtime/` and run `--check`. Offline → set `CAV_RUNTIME`; the aligner falls back to
  energy-only segmentation without a Whisper model.
* New subagents not listed in the current session → they are registered on disk; start a new Claude Code session or use the
  `general-purpose` fallback above (with the matching `model`). Stale `cav-director`/`cav-artist-fast` entries are removed on
  the next `build_video.py` run.
