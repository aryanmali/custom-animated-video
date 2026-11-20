#!/usr/bin/env python3
"""custom-animated-video — end-to-end CLI orchestrator (self-contained: run it with any python3 >= 3.9).

  script + voiceover + style_bible.json -> normalized style -> audio_timeline.json -> storyboard.json (you direct)
  -> scene_drawers.js (you draw) -> stems + ducked/mastered audio -> per-shot clips (frames deleted as soon as each
  clip is encoded) -> final MP4 -> QA keyframes -> auto-clean -> REVIEW GATE: ship it or change it

build:   python3 build_video.py --script script.txt --audio voiceover.wav --style style_bible.json \
             [--storyboard storyboard.json --drawers scene_drawers.js] [--bgm music.mp3] [--aspect 16:9|9:16] \
             [--subtitles true|false] [--out final_video.mp4] [--only s2,s3,audio] [--preview] [--auto]
analyse: ... --stage analyze          (stops after the timeline + draft storyboard)
change:  python3 build_video.py --out final_video.mp4 --apply-review review.json
ship:    python3 build_video.py --out final_video.mp4 --ship [--keep-deps] [--purge-recipe]
check:   python3 build_video.py --check   (also registers the cav-* subagents in ~/.claude/agents/)

Rebuilds are incremental: every shot and the audio mix carry a content hash in build_state.json, so a rerun only
re-renders what changed. --only limits a rerun to the listed shot ids and/or "audio" (and accepts the rest as-is).
First run installs private dependencies into <skill>/.runtime (see runtime.py); "ship" deletes them again.
"""
import argparse, glob, hashlib, json, math, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import runtime  # noqa: E402

SKILL = runtime.SKILL
# files/dirs this pipeline generates inside the work dir (the only things clean/ship ever delete)
GENERATED = ["clips", "frames", "qa", "audio_stems", "master_audio.wav", "mix_report.json", "audio_timeline.json",
             "style.normalized.json", "storyboard.draft.json", "storyboard.prev.json", "build_state.json", "review.json",
             "review_plan.json", "concat.txt", "preview_frames"]
SCRATCH = ["frames", "audio_stems", "concat.txt", "preview_frames"]  # deleted automatically after every successful build


def log(msg):
    print(f"\033[1;33m[build_video]\033[0m {msg}", flush=True)


def run(cmd, quiet=False, **kw):
    if not quiet:
        log("$ " + " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd))
    r = subprocess.run([str(c) for c in cmd], **kw)
    if r.returncode != 0:
        sys.exit(f"[build_video] step failed (exit {r.returncode}): {os.path.basename(str(cmd[1] if len(cmd) > 1 else cmd[0]))}")
    return r


def boolish(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def h(*parts):
    m = hashlib.sha1()
    for p in parts:
        m.update(json.dumps(p, sort_keys=True, default=str).encode())
    return m.hexdigest()[:16]


def fhash(path):
    if not path or not os.path.exists(path):
        return None
    return hashlib.sha1(open(path, "rb").read()).hexdigest()[:16]


def human(n):
    return f"{n / 1e9:.2f} GB" if n > 1e9 else f"{n / 1e6:.1f} MB"


def rm(path):
    if os.path.isdir(path):
        n = runtime.size_of(path)
        shutil.rmtree(path, ignore_errors=True)
        return n
    if os.path.lexists(path):
        n = os.path.getsize(path) if os.path.exists(path) else 0
        os.remove(path)
        return n
    return 0


def ff_info(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    dur = re.search(r"Duration: ([\d:.]+)", err)
    vid = re.search(r"Video: (\w+).*?, (\d{2,5})x(\d{2,5}).*?([\d.]+) fps", err)
    aud = re.search(r"Audio: (\w+), (\d+) Hz", err)
    return (f"{vid.group(1)} {vid.group(2)}x{vid.group(3)} @{vid.group(4)}fps" if vid else "?") + \
           (f", {aud.group(1)} {aud.group(2)} Hz" if aud else "") + (f", {dur.group(1)}" if dur else "")


# ----------------------------------------------------------------------------------------- subagent registration
def sync_agents():
    """Copy <skill>/agents/cav-*.md into ~/.claude/agents/ (or $CLAUDE_CONFIG_DIR/agents/) when missing or changed.
    Idempotent, fast (hash compare) and silent unless something was installed/updated. Never fatal."""
    try:
        src = os.path.join(SKILL, "agents")
        if not os.path.isdir(src):
            return []
        cfg = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
        dst = os.path.join(cfg, "agents")
        updated = []
        for f in sorted(glob.glob(os.path.join(src, "cav-*.md"))):
            name = os.path.basename(f)
            target = os.path.join(dst, name)
            if fhash(f) != fhash(target):
                os.makedirs(dst, exist_ok=True)
                shutil.copyfile(f, target)
                updated.append(name)
        if updated:
            log(f"registered subagents in {dst}: {', '.join(updated)} (restart/reload Claude Code if they are not yet listed)")
        return updated
    except Exception as e:  # read-only home, permissions, ...: the pipeline must still run
        log(f"note: could not sync subagents ({e})")
        return []


# ------------------------------------------------------------------------------------------------- draft storyboard
def draft_storyboard(tl, style, aspect, subtitles, drawers_rel):
    """Heuristic first cut: cuts on dramatic pauses, wide -> medium -> close cadence."""
    segs, pauses, fps = tl["segments"], tl.get("pauses", []), tl["fps"]
    moods = list(style["lighting_moods"].keys())
    presets = ["wide_establishing", "medium_tracking", "close_up_bust", "slow_push_in", "over_shoulder", "low_angle_hero"]
    cuts = [0.0]
    for p in pauses:
        if p["end_sec"] - cuts[-1] >= 1.6:
            cuts.append(round((p["start_sec"] + p["end_sec"]) / 2, 3))
    cuts.append(tl["duration_sec"])
    shots = []
    for k in range(len(cuts) - 1):
        a, b = cuts[k], cuts[k + 1]
        lines = [s["text"] for s in segs if s["start_sec"] < b and s["end_sec"] > a]
        shots.append({"id": f"s{k + 1}", "start_sec": a, "end_sec": b, "scene": "generic_landscape",
                      "mood": style.get("default_mood", moods[0]),
                      "camera": {"preset": presets[k % len(presets)] if k < len(cuts) - 2 else "slow_push_in"},
                      "transition_in": None if k == 0 else {"type": "crossfade", "frames": 8},
                      "params": {}, "beat": " / ".join(lines)})
    ev = []
    if pauses:
        ev.append({"t_sec": pauses[0]["start_sec"] + 0.05, "type": "chime", "gain_db": -16, "note": "first dramatic pause"})
    for sh in shots[1:]:
        ev.append({"t_sec": max(0, sh["start_sec"] - 0.6), "type": "swell", "duration_sec": 0.6, "gain_db": -18, "note": "into cut"})
    ev.append({"t_sec": max(0, tl["duration_sec"] - 1.2), "type": "chime", "gain_db": -15, "note": "ending"})
    return {"title": "DRAFT — direct me", "fps": fps, "aspect": aspect, "duration_sec": tl["duration_sec"],
            "audio_timeline": "audio_timeline.json", "drawers": drawers_rel, "subtitles": subtitles,
            "shots": shots, "sfx_events": ev, "bgm": {"mode": "auto"}}


# ------------------------------------------------------------------------------------------------- shot planning
def shot_ranges(sb, fps, total):
    shots, out = sb["shots"], []
    for k, s in enumerate(shots):
        a = 0 if k == 0 else math.ceil(s["start_sec"] * fps - 1e-9)
        b = total - 1 if k == len(shots) - 1 else math.ceil(s["end_sec"] * fps - 1e-9) - 1
        out.append([a, b])
    for k in range(1, len(shots)):
        if abs(shots[k]["start_sec"] - shots[k - 1]["end_sec"]) > 1e-3:
            log(f"WARNING: shots {shots[k - 1].get('id')} and {shots[k].get('id')} do not tile (gap/overlap)")
    return out


def qa_frames(sb, tl, out_video, total, fps, qa_dir):
    shots = sb["shots"]
    first = shots[0]
    talk = next((s for s in shots if s.get("speaker") or (s.get("camera") or {}).get("preset") in ("close_up_bust", "over_shoulder")), shots[len(shots) // 2])
    seg = next((s for s in tl.get("segments", []) if s["end_sec"] > first["start_sec"] and s["start_sec"] < first["end_sec"]), None)
    t_open = (max(seg["start_sec"], first["start_sec"]) + min(seg["end_sec"], first["end_sec"])) / 2 if seg else first["start_sec"] + (first["end_sec"] - first["start_sec"]) * 0.4
    picks = {"opening": min(total - 1, int(t_open * fps)), "dialogue": min(total - 1, int((talk["start_sec"] + talk["end_sec"]) / 2 * fps)),
             "ending": max(0, total - 6)}
    shutil.rmtree(qa_dir, ignore_errors=True)
    os.makedirs(qa_dir, exist_ok=True)
    out = {}
    for name, i in picks.items():
        dst = os.path.join(qa_dir, f"{name}_f{i:05d}.png")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", out_video, "-vf", f"select=eq(n\\,{i})", "-vframes", "1", dst], check=False)
        if os.path.exists(dst):
            out[name] = dst
    if len(out) == 3:
        sheet = os.path.join(qa_dir, "contact_sheet.png")
        ins = sum([["-i", p] for p in out.values()], [])
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y"] + ins + ["-filter_complex",
                        "[0]scale=640:-2[a];[1]scale=640:-2[b];[2]scale=640:-2[c];[a][b][c]hstack=3", sheet], check=False)
        out["contact_sheet"] = sheet
    return out


# --------------------------------------------------------------------------------------------------- clean / ship
def auto_clean(work):
    freed = sum(rm(os.path.join(work, n)) for n in SCRATCH)
    for d in glob.glob(os.path.join(SKILL, "**", "__pycache__"), recursive=True):
        freed += rm(d)
    return freed


def ship(work, out, purge_recipe, keep_deps, recipe_paths):
    if not os.path.exists(out):
        sys.exit(f"[build_video] nothing to ship: {out} does not exist")
    info = ff_info(out) if shutil.which("ffmpeg") else ""
    freed = 0
    for n in GENERATED:
        p = os.path.join(work, n)
        if os.path.realpath(p) != os.path.realpath(out):
            freed += rm(p)
    if purge_recipe:
        for p in recipe_paths:
            if p and os.path.exists(p) and os.path.realpath(os.path.dirname(p)) == os.path.realpath(work):
                freed += rm(p)
    dep = 0 if keep_deps else runtime.delete_runtime()
    log(f"SHIPPED: {out} ({human(os.path.getsize(out))}{', ' + info if info else ''})")
    log(f"deleted {human(freed)} of intermediates" + ("" if keep_deps else f" and {human(dep)} of skill dependencies ({runtime.RT})"))
    kept = [p for p in recipe_paths if p and os.path.exists(p)]
    if kept:
        log("kept the tiny recipe files (re-edit later; --purge-recipe removes them): " + ", ".join(os.path.basename(p) for p in kept))


# --------------------------------------------------------------------------------------------------------- check
def check():
    info = runtime.setup_env()
    print("custom-animated-video dependency check (private runtime: %s)" % runtime.RT)
    rows = [("python (runtime venv)", sys.executable), ("ffmpeg (libx264, sidechaincompress, loudnorm)", info["ffmpeg"]),
            ("node (bundled with playwright)", info["node"]), ("playwright-core", info["playwright_core"]),
            ("browser", info["browser"])]
    for mod in ("numpy", "scipy", "faster_whisper"):
        try:
            m = __import__(mod); rows.append((mod, getattr(m, "__version__", "ok")))
        except Exception as e:
            rows.append((mod, f"MISSING ({e})"))
    for k, v in rows:
        print(f"  {'✘' if 'MISSING' in str(v) else '✔'} {k:48s} {v}")
    print(f"  runtime size: {human(runtime.size_of(runtime.RT))}")
    n = len(glob.glob(os.path.join(SKILL, "agents", "cav-*.md")))
    if n:
        sync_agents()
        print(f"  ✔ {'subagents (cav-*) registered':48s} {n} in {os.path.join(os.environ.get('CLAUDE_CONFIG_DIR') or '~/.claude', 'agents')}")
    ok = not any("MISSING" in str(v) for _, v in rows)
    print("READY" if ok else "MISSING DEPENDENCIES")
    return ok


# ----------------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--script"); ap.add_argument("--audio"); ap.add_argument("--style")
    ap.add_argument("--storyboard"); ap.add_argument("--drawers"); ap.add_argument("--bgm")
    ap.add_argument("--aspect", default=None, choices=["16:9", "9:16", "1:1"])
    ap.add_argument("--subtitles", default=None)
    ap.add_argument("--out", default="final_video.mp4"); ap.add_argument("--workdir")
    ap.add_argument("--stage", default="all", choices=["all", "analyze"])
    ap.add_argument("--only", help="comma list of shot ids and/or 'audio' to rebuild (others are accepted as-is)")
    ap.add_argument("--workers", type=int); ap.add_argument("--preview", action="store_true", help="half resolution, fast")
    ap.add_argument("--auto", action="store_true", help="render the draft storyboard with the generic drawers")
    ap.add_argument("--force", action="store_true", help="redo analysis and every shot")
    ap.add_argument("--whisper-model", default=os.environ.get("CAV_WHISPER_MODEL", "base.en"),
                    help="*.en models are swapped for their multilingual twin when the script is not English")
    ap.add_argument("--language", default=os.environ.get("CAV_LANGUAGE", "auto"), help="spoken language: auto, en, hi, ...")
    ap.add_argument("--keep-frames", action="store_true", help="debug: keep PNG frames after encoding")
    ap.add_argument("--no-review", action="store_true", help="skip the interactive ship/change prompt")
    ap.add_argument("--apply-review", metavar="REVIEW_JSON", help="apply ship/change answers, then rebuild only what they touch")
    ap.add_argument("--ship", action="store_true", help="keep only the final video; delete intermediates + dependencies")
    ap.add_argument("--keep-deps", action="store_true", help="with --ship: keep <skill>/.runtime")
    ap.add_argument("--purge-recipe", action="store_true", help="with --ship: also delete storyboard.json + scene_drawers.js")
    ap.add_argument("--clean", action="store_true", help="delete scratch files only (frames, stems)")
    ap.add_argument("--frames", help="quick look: render only these frame numbers (e.g. 30,110,160) to WORK/preview_frames")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    out = os.path.abspath(a.out)
    work = os.path.abspath(a.workdir or os.path.dirname(out))
    state_path = os.path.join(work, "build_state.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    prev_in = state.get("inputs", {})
    sb_path = os.path.abspath(a.storyboard) if a.storyboard else prev_in.get("storyboard") or os.path.join(work, "storyboard.json")
    drawers = os.path.abspath(a.drawers) if a.drawers else prev_in.get("drawers") or os.path.join(work, "scene_drawers.js")

    sync_agents()                  # keep ~/.claude/agents/cav-*.md current (silent unless it changed something)

    # actions that need no dependencies
    if a.ship:
        return ship(work, out, a.purge_recipe, a.keep_deps, [sb_path, drawers])
    if a.clean:
        return log(f"cleaned {human(auto_clean(work))}")

    runtime.bootstrap()            # re-execs inside <skill>/.runtime/venv (installs it on first run)
    if a.check:
        sys.exit(0 if check() else 1)
    runtime.setup_env()
    PY = sys.executable
    NODE = os.environ["CAV_NODE"]
    S = lambda n: os.path.join(HERE, n)
    os.makedirs(work, exist_ok=True)

    for k in ("script", "audio", "style", "bgm"):  # later rounds only need --out
        if not getattr(a, k) and prev_in.get(k):
            setattr(a, k, prev_in[k])
    for k in ("script", "audio", "style"):
        v = getattr(a, k)
        if not v or not os.path.exists(v):
            sys.exit(f"[build_video] --{k} is required and must exist (got {v!r})")
    a.script, a.audio, a.style = map(os.path.abspath, (a.script, a.audio, a.style))
    if a.bgm:
        a.bgm = os.path.abspath(a.bgm)

    style_n = os.path.join(work, "style.normalized.json")
    tl_path = os.path.join(work, "audio_timeline.json")
    t_start = time.time()

    # 1 — ingest & validate (cached by content hash)
    sh = fhash(a.style)
    if a.force or state.get("style_src") != sh or not os.path.exists(style_n):
        run([PY, S("normalize_style.py"), a.style, "-o", style_n])
    th = h(fhash(a.audio), fhash(a.script), a.whisper_model, a.language, "lang-v2")
    if a.force or state.get("timeline_src") != th or not os.path.exists(tl_path):
        run([PY, S("analyze_audio.py"), "--audio", a.audio, "--script", a.script, "-o", tl_path, "--model", a.whisper_model,
             "--language", a.language])
    style = json.load(open(style_n))
    tl = json.load(open(tl_path))
    state.update({"style_src": sh, "timeline_src": th})
    state.setdefault("inputs", {}).update({"script": a.script, "audio": a.audio, "style": a.style, "bgm": a.bgm})

    # 2 — storyboard (+ review application)
    if not os.path.exists(sb_path) or not os.path.exists(drawers):
        draft = draft_storyboard(tl, style, a.aspect or "16:9", boolish(a.subtitles) if a.subtitles is not None else True,
                                 os.path.relpath(os.path.join(SKILL, "examples", "generic_drawers.js"), work))
        dpath = os.path.join(work, "storyboard.draft.json")
        json.dump(draft, open(dpath, "w"), indent=2)
        if not a.auto:
            json.dump(state, open(state_path, "w"), indent=1)
            log(f"analysis done. Draft storyboard: {dpath}")
            log("NEXT: direct the film — write storyboard.json + scene_drawers.js (SKILL.md §2–3), then rerun with "
                "--storyboard storyboard.json --drawers scene_drawers.js   (or --auto for the generic landscape)")
            return
        sb_path, drawers = dpath, os.path.join(SKILL, "examples", "generic_drawers.js")
        log("--auto: rendering the draft storyboard with the generic, style-only drawers")
    if a.stage == "analyze":
        json.dump(state, open(state_path, "w"), indent=1)
        return log(f"analysis done: {tl_path}")
    sb = json.load(open(sb_path))

    if a.frames:  # art iteration: a handful of full-res frames, no audio / clips / video
        pdir = os.path.join(work, "preview_frames"); rm(pdir)
        run([NODE, S("render_frames.js"), "--style", style_n, "--storyboard", sb_path, "--drawers", drawers, "--timeline", tl_path,
             "--out", pdir, "--aspect", a.aspect or sb.get("aspect", "16:9"), "--frames", a.frames,
             "--subtitles", str(boolish(a.subtitles) if a.subtitles is not None else bool(sb.get("subtitles"))).lower()])
        state.setdefault("inputs", {}).update({"storyboard": sb_path, "drawers": drawers})
        json.dump(state, open(state_path, "w"), indent=1)
        for f in sorted(glob.glob(os.path.join(pdir, "frame_*.png"))):
            print("    " + f)
        return log("preview frames ready (deleted automatically by the next full build)")

    only = set(x.strip() for x in a.only.split(",") if x.strip()) if a.only else None
    if a.apply_review:
        import review
        rv = json.load(open(a.apply_review))
        if rv.get("decision") == "ship":
            return ship(work, out, a.purge_recipe, a.keep_deps, [sb_path, drawers])
        shutil.copy(sb_path, os.path.join(work, "storyboard.prev.json"))
        sb, plan = review.apply(rv, sb)
        json.dump(sb, open(sb_path, "w"), indent=2)
        for x in plan["applied"]:
            log(f"applied: {x}")
        if plan["todo"]:
            json.dump(plan, open(os.path.join(work, "review_plan.json"), "w"), indent=1)
            log("NEEDS AN ART/EDIT PASS before rebuilding (written to review_plan.json):")
            for t in plan["todo"]:
                print(f"    • {t['part']}: shots {t['shots']} issues {t['issues']} notes {t['notes']!r}\n      -> {t['action']}")
            log(f"after editing, rebuild with:  build_video.py --out \"{out}\" --only " + ",".join(plan["only"]))
            state.setdefault("inputs", {}).update({"storyboard": sb_path, "drawers": drawers})
            json.dump(state, open(state_path, "w"), indent=1)
            return
        only = set(plan["only"])

    aspect = a.aspect or sb.get("aspect", "16:9")
    subtitles = boolish(a.subtitles) if a.subtitles is not None else bool(sb.get("subtitles", False))
    fps = sb.get("fps", 24)
    dur = float(sb.get("duration_sec") or tl["duration_sec"])
    total = math.ceil(dur * fps - 1e-9)
    scale = 0.5 if a.preview else 1.0

    # 3 — audio (rebuilt only when its inputs changed)
    ah = h(sb.get("sfx_events"), sb.get("ambience"), sb.get("bgm"), sb.get("mix"), dur, fps, style.get("audio_palette"),
           style.get("lighting_moods"), [s.get("mood") for s in sb["shots"]], fhash(tl_path), fhash(a.audio), fhash(a.bgm),
           fhash(S("sfx_synth.py")), fhash(S("mix_audio.py")))
    master = os.path.join(work, "master_audio.wav")
    audio_stale = a.force or state.get("audio") != ah or not os.path.exists(master)
    if only is not None:
        audio_stale = "audio" in only or not os.path.exists(master)
    if audio_stale:
        stems = os.path.join(work, "audio_stems")
        cmd = [PY, S("sfx_synth.py"), "--storyboard", sb_path, "--style", style_n, "--timeline", tl_path, "--outdir", stems,
               "--assets", os.path.join(os.path.dirname(sb_path), "assets")]
        if a.bgm:
            cmd += ["--bgm", a.bgm]
        run(cmd)
        mix = [PY, S("mix_audio.py"), "--voice", a.audio, "--stems", stems, "--timeline", tl_path, "--style", style_n,
               "-o", master, "--duration", str(dur)]
        if (sb.get("mix") or {}).get("duck_db") is not None:
            mix += ["--duck-db", str(sb["mix"]["duck_db"])]
        run(mix)
        rm(stems)
    else:
        log("audio unchanged: reusing master_audio.wav")
    state["audio"] = ah

    # 4 — per-shot clips: render frames -> encode clip -> delete frames
    ranges = shot_ranges(sb, fps, total)
    glob_h = h(fps, aspect, subtitles, sb.get("subtitle_style"), dur, sb.get("post"), scale, fhash(style_n), fhash(tl_path),
               fhash(drawers), fhash(S("canvas_runtime.js")))
    clips_dir = os.path.join(work, "clips"); os.makedirs(clips_dir, exist_ok=True)
    old_shots = state.get("shots", {})
    new_shots, todo = {}, []
    for k, s in enumerate(sb["shots"]):
        sid = s.get("id") or f"shot{k + 1}"
        prev = sb["shots"][k - 1] if k and (s.get("transition_in") or {}).get("type") not in (None, "cut") else None
        clip = os.path.join(clips_dir, f"{k:03d}_{sid}.mp4")
        new_shots[sid] = {"hash": h(glob_h, s, prev, ranges[k]), "clip": clip, "range": ranges[k]}
        o = old_shots.get(sid, {})
        missing = not os.path.exists(clip) or o.get("clip") != clip or o.get("range") != ranges[k]
        stale = a.force or missing or o.get("hash") != new_shots[sid]["hash"]
        if only is not None:  # explicit scope; moved cuts / missing clips are always rebuilt for safety
            stale = sid in only or missing
        if stale:
            todo.append(k)
    for k in list(todo):  # the next shot's incoming transition draws this shot: re-render it too
        nxt = k + 1
        if nxt < len(sb["shots"]) and (sb["shots"][nxt].get("transition_in") or {}).get("type") not in (None, "cut") and nxt not in todo:
            todo.append(nxt)
    todo.sort()
    keep = {v["clip"] for v in new_shots.values()}
    for f in glob.glob(os.path.join(clips_dir, "*.mp4")):  # clips of shots that no longer exist
        if f not in keep:
            os.remove(f)
    log(f"shots to render: {', '.join(sb['shots'][k].get('id', str(k)) for k in todo) or 'none'} "
        f"(reusing {len(sb['shots']) - len(todo)} cached clip(s))")
    for k in todo:
        s = sb["shots"][k]; sid = s.get("id") or f"shot{k + 1}"; a0, b0 = ranges[k]
        fdir = os.path.join(work, "frames", sid)
        rm(fdir)
        cmd = [NODE, S("render_frames.js"), "--style", style_n, "--storyboard", sb_path, "--drawers", drawers,
               "--timeline", tl_path, "--out", fdir, "--aspect", aspect, "--subtitles", str(subtitles).lower(),
               "--range", f"{a0}-{b0}", "--scale", str(scale)]
        if a.workers:
            cmd += ["--workers", a.workers]
        run(cmd)
        run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-framerate", fps, "-start_number", a0 + 1,
             "-i", os.path.join(fdir, "frame_%05d.png"), "-frames:v", b0 - a0 + 1, "-c:v", "libx264", "-preset", "slow",
             "-crf", 16, "-pix_fmt", "yuv420p", "-r", fps, "-an", new_shots[sid]["clip"]], quiet=True)
        if not a.keep_frames:
            rm(fdir)
        log(f"  clip {sid}: frames {a0}-{b0} encoded" + ("" if a.keep_frames else ", frames deleted"))
    state["shots"] = new_shots

    # 5 — concat clips + master audio -> final video
    concat = os.path.join(work, "concat.txt")
    with open(concat, "w") as fh:
        for k, s in enumerate(sb["shots"]):
            fh.write("file '%s'\n" % new_shots[s.get("id") or f"shot{k + 1}"]["clip"].replace("'", "'\\''"))
    run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-i", master,
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{dur:.3f}",
         "-movflags", "+faststart", out])
    state["inputs"].update({"storyboard": sb_path, "drawers": drawers})
    json.dump(state, open(state_path, "w"), indent=1)

    # 6 — QA keyframes + auto-clean + report
    q = qa_frames(sb, tl, out, total, fps, os.path.join(work, "qa"))
    freed = auto_clean(work)
    log(f"final video: {out}  ({ff_info(out)}, {human(os.path.getsize(out))})")
    log("QA GATE — inspect these frames (rim light, tapered strokes, composition, subtitle legibility):")
    for k, v in q.items():
        print(f"    {k:14s} {v}")
    rep = os.path.join(work, "mix_report.json")
    if os.path.exists(rep):
        r = json.load(open(rep))
        log(f"audio: {r['output_integrated_lufs']:.1f} LUFS, BGM ducked {r['duck_measured_db']:.1f} dB under narration, "
            f"{len(r['events_placed'])} SFX events")
    log(f"auto-clean: removed {human(freed)} of scratch files | work-dir intermediates now "
        f"{human(sum(runtime.size_of(os.path.join(work, n)) if os.path.isdir(os.path.join(work, n)) else (os.path.getsize(os.path.join(work, n)) if os.path.exists(os.path.join(work, n)) else 0) for n in GENERATED))} "
        f"| done in {time.time() - t_start:.1f}s")

    # 7 — REVIEW GATE
    if a.no_review or not sys.stdin.isatty():
        log("REVIEW GATE: ask the user 'Ship it' or 'Change it' (questions: review.py --questions --storyboard "
            f"\"{sb_path}\").  Ship: build_video.py --out \"{out}\" --ship   |   Change: write review.json, then "
            f"build_video.py --out \"{out}\" --apply-review review.json")
        return
    import review
    rv = review.tty_review(sb, out)
    rpath = os.path.join(work, "review.json")
    json.dump(rv, open(rpath, "w"), indent=1)
    if rv["decision"] == "ship":
        return ship(work, out, a.purge_recipe, a.keep_deps, [sb_path, drawers])
    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__), "--out", out, "--workdir", work, "--apply-review", rpath]
             + (["--preview"] if a.preview else []))


if __name__ == "__main__":
    main()
