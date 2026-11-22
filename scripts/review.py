#!/usr/bin/env python3
"""Ship-it / Change-it review gate: one questionnaire, two front ends.

  * Claude:      `python review.py --questions --storyboard storyboard.json`  prints the exact AskUserQuestion payloads
                 (round 1: ship or change; round 2: which parts + which shots; round 3: what's wrong, per part).
                 Claude asks them, writes the answers to review.json, then runs build_video.py --apply-review.
  * Terminal:    build_video.py asks the same questions interactively after every build (when stdin is a TTY).

review.json:
  {"decision": "change", "parts": ["visuals","sound"], "shots": ["s2"] | ["all"],
   "visuals": ["character","motion"], "camera": [], "subtitles": ["bigger"], "sound": ["music_quieter"],
   "notes": {"visuals": "his face looks too long", "sound": "use ~/music/sitar.mp3"}}
Option LABELS or KEYS are both accepted. apply() makes every parametric fix itself (subtitles, mix levels, framing),
returns the art tickets that need a human/Claude edit, and the minimal rebuild targets (shot ids and/or "audio").
"""
import argparse, copy, json, os, sys

PARTS = [("visuals", "Visuals", "Characters, backgrounds, colours or motion look wrong"),
         ("camera", "Camera & editing", "Framing, camera movement, cut timing or transitions"),
         ("subtitles", "Subtitles", "Captions on/off, size or position"),
         ("sound", "Sound", "Music, sound effects, ambience or the mix balance")]
DETAIL = {
    "visuals": ("What isn't working in the visuals?", "Visuals", [
        ("character", "Character", "Pose, face, anatomy or costume look off"),
        ("background", "Background", "Setting, buildings, props or composition"),
        ("lighting", "Colours & lighting", "Mood, palette, too dark or too bright"),
        ("motion", "Motion", "Walk, cloth/hair, lip sync or particles feel wrong")]),
    "camera": ("What should change in the camera and editing?", "Camera", [
        ("tighter", "Tighter framing", "Zoom in closer on the subject (applied automatically)"),
        ("wider", "Wider framing", "Show more of the scene (applied automatically)"),
        ("calmer", "Calmer camera", "Less camera movement (applied automatically)"),
        ("cuts", "Cut timing / transitions", "Cuts land wrong, shots too long or short, different transitions")]),
    "subtitles": ("What should change in the subtitles?", "Subtitles", [
        ("off", "Turn them off", "Remove captions from the video"),
        ("bigger", "Bigger", "Increase caption size by 20%"),
        ("smaller", "Smaller", "Decrease caption size by 20%"),
        ("top", "Move to the top", "Place captions at the top of the frame")]),
    "sound": ("What should change in the sound?", "Sound", [
        ("music_quieter", "Music quieter", "Lower the background music by 3 dB"),
        ("music_louder", "Music louder", "Raise the background music by 3 dB"),
        ("sfx_quieter", "Effects quieter", "Lower sound effects and ambience by 3 dB"),
        ("sfx_louder", "Effects louder", "Raise sound effects and ambience by 3 dB")]),
}
PRESET_ZOOM = {"static": [1, 1], "wide_establishing": [1.06, 1.1], "medium_tracking": [1.38, 1.42], "over_shoulder": [1.6, 1.66],
               "close_up_bust": [2.15, 2.28], "low_angle_hero": [1.35, 1.5], "slow_push_in": [1.0, 1.22]}


def shot_options(sb):
    shots = sb["shots"]
    def label(s):
        return f"{s.get('id', '?')} {s['start_sec']:.1f}-{s['end_sec']:.1f}s"
    def desc(s):
        cam = (s.get("camera") or {}).get("preset", "static").replace("_", " ")
        return f"{cam}, {s.get('scene')}" + (f" — {s['beat'][:70]}" if s.get("beat") else "")
    opts = [{"label": "Whole video", "description": "Every shot"}]
    if len(shots) <= 3:
        opts += [{"label": label(s), "description": desc(s)} for s in shots]
    else:  # three groups of consecutive shots
        k = -(-len(shots) // 3)
        for g in range(0, len(shots), k):
            grp = shots[g:g + k]
            opts.append({"label": f"{grp[0].get('id')}–{grp[-1].get('id')} {grp[0]['start_sec']:.0f}-{grp[-1]['end_sec']:.0f}s",
                         "description": "Shots " + ", ".join(s.get("id", "?") for s in grp) + " (type exact ids in Other)"})
    return opts


def questions(sb, video_path=""):
    r1 = [{"question": f"Your video is ready{(' at ' + video_path) if video_path else ''}. Ship it or change it?",
           "header": "Review", "multiSelect": False,
           "options": [{"label": "Ship it", "description": "Keep only the final video; delete all intermediate files and the skill's installed dependencies"},
                       {"label": "Change it", "description": "Answer a few quick questions; only the affected parts are rebuilt"}]}]
    r2 = [{"question": "Which parts need changing?", "header": "Parts", "multiSelect": True,
           "options": [{"label": l, "description": d} for _, l, d in PARTS]},
          {"question": "Which moments of the video? (pick all that apply)", "header": "Shots", "multiSelect": True,
           "options": shot_options(sb)}]
    r3 = {k: {"question": q + " (add specifics in Other)", "header": h, "multiSelect": True,
              "options": [{"label": l, "description": d} for _, l, d in opts]} for k, (q, h, opts) in DETAIL.items()}
    return {"round1": r1, "round2": r2, "round3_by_part": r3,
            "how_to": "Ask round1. If 'Change it': ask round2 (both questions in one call), then ONE call with the "
                      "round3 questions for each selected part (max 4). Free text from 'Other' goes into notes[part]. "
                      "Write review.json and run build_video.py --apply-review review.json."}


def _norm(part, vals):
    out = []
    table = {l.lower(): k for k, l, _ in DETAIL[part][2]} if part in DETAIL else {}
    keys = {k for k, _, _ in DETAIL[part][2]} if part in DETAIL else set()
    for v in vals or []:
        v2 = str(v).strip()
        if v2 in keys:
            out.append(v2)
        elif v2.lower() in table:
            out.append(table[v2.lower()])
    return out


def _resolve_shots(sb, sel):
    ids = [s.get("id") for s in sb["shots"]]
    if not sel or any(str(x).lower() in ("all", "whole video") for x in sel):
        return ids
    out = []
    for x in sel:
        x = str(x)
        for sid in ids:
            if sid and (x == sid or x.split(" ")[0] == sid or ("–" in x and sid in _range(ids, x))):
                out.append(sid)
    return sorted(set(out), key=ids.index) or ids


def _range(ids, label):
    a, b = label.split(" ")[0].split("–")
    return ids[ids.index(a):ids.index(b) + 1] if a in ids and b in ids else []


def apply(review, sb):
    """Mutates a copy of the storyboard. Returns (new_sb, plan)."""
    sb = copy.deepcopy(sb)
    parts = [p for p in (review.get("parts") or []) if p in DETAIL] or \
            [k for k, l, _ in PARTS if l in (review.get("parts") or [])]
    shots = _resolve_shots(sb, review.get("shots"))
    notes = review.get("notes") or {}
    only, todo, applied = set(), [], []
    byid = {s.get("id"): s for s in sb["shots"]}
    for part in parts:
        ticks = _norm(part, review.get(part))
        if part == "visuals":
            only.update(shots)
            todo.append({"part": "visuals", "shots": shots, "issues": ticks, "notes": notes.get("visuals", ""),
                         "agent": "cav-storyboarder (targeted: specs/params/mood) -> cav-artist (CHANGED_SCENES only)",
                         "action": "update visual_specs/<scene>.md (and shot params/mood in storyboard.json), then re-implement "
                                   "only the changed drawers/<scene>.js files"})
        elif part == "camera":
            for sid in shots:
                cam = byid[sid].setdefault("camera", {})
                z = list(cam.get("zoom") or PRESET_ZOOM.get(cam.get("preset", "static"), [1, 1]))
                if "tighter" in ticks:
                    cam["zoom"] = [round(z[0] * 1.15, 3), round(z[1] * 1.15, 3)]; applied.append(f"{sid}: framing tighter")
                if "wider" in ticks:
                    cam["zoom"] = [round(max(1.0, z[0] / 1.15), 3), round(max(1.0, z[1] / 1.15), 3)]; applied.append(f"{sid}: framing wider")
                if "calmer" in ticks:
                    cam["calm"] = True; applied.append(f"{sid}: calmer camera")
            only.update(shots)
            if "cuts" in ticks or notes.get("camera"):
                todo.append({"part": "camera", "shots": shots, "issues": [t for t in ticks if t == "cuts"], "notes": notes.get("camera", ""),
                             "agent": "cav-storyboarder (targeted: cut points/transitions) -> cav-timeline (re-tile, re-time sfx)",
                             "action": "adjust start_sec/end_sec/transition_in in storyboard.json (cut inside pauses); "
                                       "re-time sfx_events; neighbours of moved cuts are rebuilt automatically"})
                only.add("audio")
        elif part == "subtitles":
            st = sb.setdefault("subtitle_style", {})
            if "off" in ticks:
                sb["subtitles"] = False; applied.append("subtitles off")
            else:
                sb["subtitles"] = True
            if "bigger" in ticks:
                st["size_px"] = round(st.get("size_px", 54) * 1.2, 1); applied.append(f"subtitles {st['size_px']}px")
            if "smaller" in ticks:
                st["size_px"] = round(st.get("size_px", 54) / 1.2, 1); applied.append(f"subtitles {st['size_px']}px")
            if "top" in ticks:
                st["position"] = "top"; applied.append("subtitles at top")
            only.update(s.get("id") for s in sb["shots"])  # captions are drawn into every shot
            if notes.get("subtitles"):
                todo.append({"part": "subtitles", "shots": "all", "issues": [], "notes": notes["subtitles"],
                             "agent": "cav-storyboarder (targeted: subtitle_style)",
                             "action": "edit storyboard.subtitle_style (font_family, fill, outline, highlight, uppercase, max_words_per_line)"})
        elif part == "sound":
            bg = sb.setdefault("bgm", {"mode": "auto"})
            d_music = (-3 if "music_quieter" in ticks else 0) + (3 if "music_louder" in ticks else 0)
            d_fx = (-3 if "sfx_quieter" in ticks else 0) + (3 if "sfx_louder" in ticks else 0)
            if d_music:
                bg["gain_db"] = round(bg.get("gain_db", -20) + d_music, 1); applied.append(f"music {d_music:+d} dB")
            if d_fx:
                for e in sb.get("sfx_events", []):
                    e["gain_db"] = round(e.get("gain_db", -14) + d_fx, 1)
                for a in sb.get("ambience", []):
                    a["gain_db"] = round(a.get("gain_db", -27) + d_fx, 1)
                applied.append(f"effects/ambience {d_fx:+d} dB")
            only.add("audio")
            if notes.get("sound"):
                todo.append({"part": "sound", "shots": shots, "issues": [], "notes": notes["sound"],
                             "agent": "cav-timeline (review mode)",
                             "action": "edit sfx_events / ambience / bgm in storyboard.json, or pass --bgm <file>; "
                                       "storyboard.mix.duck_db changes ducking depth"})
    return sb, {"only": sorted(only, key=lambda x: (x == "audio", x)), "applied": applied, "todo": todo, "shots": shots}


# ---------------------------------------------------------------------------------------------- terminal UI
def _ask(q):
    print("\n" + q["question"])
    for i, o in enumerate(q["options"], 1):
        print(f"  {i}. {o['label']:24s} {o['description']}")
    print(f"  {len(q['options']) + 1}. Other (type it)")
    while True:
        raw = input("  > " + ("numbers, comma separated: " if q["multiSelect"] else "number: ")).strip()
        try:
            picks = [int(x) for x in raw.replace(" ", "").split(",") if x]
        except ValueError:
            continue
        if picks and all(1 <= p <= len(q["options"]) + 1 for p in picks) and (q["multiSelect"] or len(picks) == 1):
            labels = [q["options"][p - 1]["label"] for p in picks if p <= len(q["options"])]
            other = input("  your note: ").strip() if len(q["options"]) + 1 in picks else ""
            return labels, other


def tty_review(sb, video_path):
    Q = questions(sb, video_path)
    dec, _ = _ask(Q["round1"][0])
    if dec and dec[0] == "Ship it":
        return {"decision": "ship"}
    parts_l, pnote = _ask(Q["round2"][0])
    shots_l, snote = _ask(Q["round2"][1])
    rev = {"decision": "change", "parts": [k for k, l, _ in PARTS if l in parts_l], "shots": shots_l + ([snote] if snote else []), "notes": {}}
    for part in rev["parts"]:
        labels, note = _ask(Q["round3_by_part"][part])
        rev[part] = labels
        if note:
            rev["notes"][part] = note
    if pnote:
        rev["notes"]["general"] = pnote
    return rev


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--storyboard", required=True)
    ap.add_argument("--questions", action="store_true", help="print the AskUserQuestion payloads for this video")
    ap.add_argument("--video", default="")
    a = ap.parse_args()
    sb = json.load(open(a.storyboard))
    if a.questions:
        print(json.dumps(questions(sb, a.video), indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
