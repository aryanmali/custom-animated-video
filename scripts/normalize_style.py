#!/usr/bin/env python3
"""Validate and normalize ANY style_bible.json into the universal contract the renderer reads.

Accepts:
  * the flat contract itself (palette / lighting_moods / strokes / proportions / texture_post / motion_rules / ...)
  * the numbered-section "style bible" format (1_linework_and_stroke_physics, 2_colour_and_lighting_architecture, ...)
  * partial / older bibles: every missing optional field is filled with a sensible default

usage:  python normalize_style.py style_bible.json [-o style.normalized.json] [--strict] [--quiet]
Exit code 1 on fatal errors (no colours at all, malformed JSON). Warnings are printed, never fatal unless --strict.
Pure standard library: runs on any Python 3.8+.
"""
import argparse, copy, json, re, sys

HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
CONTRACT_VERSION = "1.0"

# ----------------------------------------------------------------------------------------------------------- defaults
DEFAULT_PALETTE = {
    "ink": "#2A1209", "paper": "#F1E4CB", "highlight": "#F2C870", "shadow": "#37150E",
    "skin_light": "#D9A27A", "skin_mid": "#B47448", "skin_deep": "#8A5236", "hair": "#1C110D",
}
DEFAULT_MOOD = {"sky": None, "key": "#FFE0B0", "key_dir_deg": 210, "shadow_tint": "#2C3550", "rim": "#FFD9A0",
                "ink": None, "ambient": "#5A6070", "glow": False}
DEFAULT_STROKES = {
    "weights_px": {
        "silhouette_contour": {"min": 2.2, "max": 4.0}, "interior_form_lines": {"min": 1.2, "max": 2.2},
        "fabric_fold_lines": {"min": 0.8, "max": 1.6}, "hair_strands": {"min": 0.6, "max": 1.4},
        "jewelry_ornament": {"min": 0.6, "max": 1.2},
        "face_features": {"eye_upper_lid": 2.4, "brow": 2.0, "nose": 1.1, "lips": 1.2, "lashes": 0.9},
        "midground_architecture": {"min": 1.0, "max": 2.0}, "distant_architecture": {"min": 0.5, "max": 1.0},
        "clouds": {"min": 0.0, "max": 1.0},
    },
    "reference_figure_height_px": 600, "scale_clamp": [0.5, 2.2],
    "taper": {"end_ratio": 0.2, "peak_position": 0.4},
    "shadow_side_multiplier": 1.6, "lit_side_multiplier": 0.75,
    "caps": "round", "joins": "round",
    "line_boil": {"characters_fx": {"enabled": True, "rate_hz": 12, "amplitude_px": 0.55},
                  "backgrounds": {"enabled": False}},
    "ink": {"default": "#2A1209"},
}
DEFAULT_TEXTURE = {
    "order": ["colour_grade", "bloom", "atmospheric_haze", "chromatic_aberration", "paper_texture", "film_grain", "vignette"],
    "paper_texture": {"opacity": 0.04, "blend": "overlay", "static_across_frames": True},
    "film_grain": {"sigma": 0.02, "monochrome": True, "reseed_every_frames": 2},
    "vignette": {"strength": 0.3, "radius": 0.78, "softness": 0.55, "tint": "mood.shadow_tint"},
    "bloom": {"threshold": 0.72, "radius_px": 18, "intensity": 0.5, "intensity_no_glow": 0.18, "tint": "mood.key"},
    "chromatic_aberration": {"max_offset_px": 1.0},
    "colour_grade": {"lift_amount": 0.06, "highlight_amount": 0.05, "saturation_boost": 1.05},
    "atmospheric_haze": {"far_bg": 0.5, "mid_bg": 0.22, "sky": 0.0, "action_plane": 0.0, "foreground_frame": 0.0},
}
DEFAULT_MOTION = {
    "frame_rate": 24, "character_cadence_frames": 2, "camera_cadence_frames": 1,
    "easing": {"camera": "easeInOutSine", "reveal": "easeOutCubic", "character": "easeInOutQuad", "default": "easeInOutSine"},
    "hold_frames_min": 12,
    "walk_cycle": {"frames_per_step": 12, "stride_heads": 1.6, "bob_heads": 0.06, "arm_swing_deg": 22, "torso_lean_deg": 3},
    "cloth": {"segments": 8, "damping": 0.9, "wave_speed": 1.6, "wave_count": 1.25},
    "hair": {"segments": 5, "lag_drawings": 1},
    "particles": {"min": 8, "max": 40},
    "camera_drift_frac_per_sec": [0.02, 0.06],
    "parallax_layers": {"sky": 0.04, "far_bg": 0.18, "mid_bg": 0.5, "action_plane": 1.0, "foreground_frame": 1.4},
}
DEFAULT_PROPORTIONS = {"default_figure": {"heads_tall": 7.5, "shoulder_width_heads": 2.0, "waist_heads": 1.15}}
DEFAULT_SUBTITLES = {
    "font_family": "Georgia, 'Palatino Linotype', 'Book Antiqua', serif", "font_weight": 700,
    "size_px": 54, "fill": None, "outline": None, "highlight": None, "outline_px": 7,
    "max_words_per_line": 7, "position": "lower_third", "uppercase": False,
}
AUDIO_BEDS = ["river", "wind", "rain", "temple_hum", "city_hum", "night", "none"]
FOOTSTEP_SURFACES = ["stone", "wood", "grass", "gravel"]
CHIMES = ["temple_bell", "chime", "singing_bowl", "none"]
DEFAULT_AUDIO = {"ambient_bed": "auto", "footstep_surface": "stone", "accent_chime": "temple_bell", "drone_root_hz": 110.0,
                 "bgm_mode": "auto", "bgm_gain_db": -20.0, "ambience_gain_db": -27.0, "sfx_gain_db": -14.0,
                 "duck_db": 15.0, "pause_swell_db": 3.0, "mood_beds": {}}

# ------------------------------------------------------------------------------------------------------------ helpers
warnings = []


def warn(msg):
    warnings.append(msg)


def is_hex(v):
    return isinstance(v, str) and bool(HEX.match(v.strip()))


def norm_hex(v):
    v = v.strip()
    if len(v) == 4:
        v = "#" + "".join(c * 2 for c in v[1:])
    return v.upper()


def deep_merge(base, over):
    """Return base updated recursively with over (over wins). Neither input is mutated."""
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def find_section(raw, *keywords):
    """Find a top-level section by exact name first, then by keyword in a (possibly numbered) key."""
    for kw in keywords:
        if kw in raw and isinstance(raw[kw], dict):
            return raw[kw]
    for k, v in raw.items():
        lk = re.sub(r"^\d+_", "", k.lower())
        if isinstance(v, dict) and any(kw in lk for kw in keywords):
            return v
    return {}


def walk_hex(d, prefix=""):
    """Yield (name, hex) for every colour leaf in a nested dict."""
    for k, v in d.items():
        if k.startswith("_"):
            continue
        if is_hex(v):
            yield k, norm_hex(v)
        elif isinstance(v, dict):
            yield from walk_hex(v, prefix + k + ".")


def luminance(hx):
    hx = hx.lstrip("#")[:6]
    r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


# ------------------------------------------------------------------------------------------------------- normalizer
def normalize(raw):
    if not isinstance(raw, dict):
        raise ValueError("style bible must be a JSON object")
    if raw.get("_normalized"):  # already in contract form: only fill fields a newer contract version added
        skel = {"subtitles": DEFAULT_SUBTITLES, "audio_palette": DEFAULT_AUDIO, "texture_post": DEFAULT_TEXTURE,
                "motion_rules": DEFAULT_MOTION, "strokes": DEFAULT_STROKES, "proportions": DEFAULT_PROPORTIONS,
                "palette_groups": {}, "shading": {}, "characters": {}, "architecture": {}, "nature": {},
                "strictly_avoid": []}
        out = deep_merge(skel, raw)
        if out.get("default_mood") not in out.get("lighting_moods", {}):
            out["default_mood"] = next(iter(out["lighting_moods"]))
        return out
    already = False
    meta_in = raw.get("meta", {}) if isinstance(raw.get("meta"), dict) else {}

    # -- sections (flat names win, numbered-section names are the fallback)
    colour = find_section(raw, "colour_and_lighting", "color_and_lighting", "colour", "color", "lighting")
    lines = find_section(raw, "strokes", "linework", "line", "stroke")
    texture = find_section(raw, "texture_post", "texture", "post_processing", "post")
    chars = find_section(raw, "character", "costume")
    arch = find_section(raw, "architecture", "environment")
    nature = find_section(raw, "nature", "foliage", "elements")
    motion = find_section(raw, "motion_rules", "motion", "temporal", "animation")

    # -- palette: flat name->hex map + groups (kept for drawers that want "shadow_tones" etc.)
    pal_src = raw.get("palette") if isinstance(raw.get("palette"), dict) else colour.get("palette", {})
    groups, flat, gradients = {}, {}, {}
    for gname, gval in (pal_src or {}).items():
        if is_hex(gval):
            flat[gname] = norm_hex(gval)
        elif isinstance(gval, dict):
            if gname in ("atmosphere_gradients", "gradients"):
                continue
            groups[gname] = {k: norm_hex(v) for k, v in walk_hex(gval)}
            for k, v in groups[gname].items():
                flat.setdefault(k, v)
    grad_src = raw.get("gradients") or (pal_src or {}).get("atmosphere_gradients") or (pal_src or {}).get("gradients") or {}
    for gname, stops in grad_src.items():
        if isinstance(stops, list) and stops and all(is_hex(s) for s in stops):
            gradients[gname] = [norm_hex(s) for s in stops]
        else:
            warn(f"gradient '{gname}' ignored: needs a list of hex colours")
    if not flat:
        # last resort: harvest every hex anywhere in the colour section
        flat = dict(walk_hex(colour))
    if not flat:
        raise ValueError("no colours found: style bible needs a palette (name -> #hex)")
    for k, v in DEFAULT_PALETTE.items():
        if k not in flat:
            flat[k] = v
    # ink aliases: ink_strokes group or outline_colour_rules
    ink_map = {}
    ink_map.update(groups.get("ink_strokes", {}))
    ocr = lines.get("outline_colour_rules", {}) if isinstance(lines.get("outline_colour_rules"), dict) else {}
    for k, v in ocr.items():
        if is_hex(v):
            ink_map.setdefault(k.replace("_ink", ""), norm_hex(v))
    if isinstance(lines.get("ink"), dict):
        ink_map.update({k: norm_hex(v) for k, v in lines["ink"].items() if is_hex(v)})
    ink_map.setdefault("default", flat.get("ink", DEFAULT_PALETTE["ink"]))
    flat["ink"] = ink_map["default"]

    # -- lighting moods
    moods_src = raw.get("lighting_moods") or colour.get("moods") or colour.get("lighting_moods") or raw.get("moods") or {}
    moods = {}
    for name, m in moods_src.items():
        if name.startswith("_") or not isinstance(m, dict):
            continue
        mm = deep_merge(DEFAULT_MOOD, m)
        for ck in ("key", "shadow_tint", "rim", "ambient", "ink"):
            v = mm.get(ck)
            if isinstance(v, str) and not is_hex(v):
                if v in flat:
                    mm[ck] = flat[v]
                else:
                    warn(f"mood '{name}'.{ck}='{v}' is not a colour; default used")
                    mm[ck] = DEFAULT_MOOD.get(ck)
            elif is_hex(v):
                mm[ck] = norm_hex(v)
        mm["ink"] = mm.get("ink") or ink_map["default"]
        sky = mm.get("sky")
        if isinstance(sky, list):
            gradients[f"{name}_sky"] = [norm_hex(s) for s in sky if is_hex(s)]
            mm["sky"] = f"{name}_sky"
        elif not sky or sky not in gradients:
            if sky:
                warn(f"mood '{name}' sky gradient '{sky}' not found; synthesized from ambient/key")
            gradients[f"{name}_sky"] = [mm["shadow_tint"], mm["ambient"], mm["key"]]
            mm["sky"] = f"{name}_sky"
        try:
            mm["key_dir_deg"] = float(mm.get("key_dir_deg", 210)) % 360
        except (TypeError, ValueError):
            warn(f"mood '{name}' key_dir_deg invalid; 210 used")
            mm["key_dir_deg"] = 210.0
        mm["glow"] = bool(mm.get("glow"))
        moods[name] = mm
    if not moods:
        warn("no lighting moods found: a single 'default' mood was synthesized from the palette")
        dark = sorted(flat.values(), key=luminance)
        moods["default"] = deep_merge(DEFAULT_MOOD, {"shadow_tint": dark[min(1, len(dark) - 1)], "ink": ink_map["default"],
                                                      "key": flat.get("highlight"), "rim": flat.get("highlight")})
        gradients["default_sky"] = [dark[0], dark[len(dark) // 2], dark[-1]]
        moods["default"]["sky"] = "default_sky"
    default_mood = raw.get("default_mood") if raw.get("default_mood") in moods else next(iter(moods))

    # -- strokes
    strokes = copy.deepcopy(DEFAULT_STROKES)
    weights = lines.get("weights_px") or lines.get("line_weights_px")
    if isinstance(weights, dict):
        strokes["weights_px"] = deep_merge(strokes["weights_px"], {k: v for k, v in weights.items() if not k.startswith("_")})
        rule = weights.get("_scale_rule", "")
        mh = re.search(r"height is (\d+)px", rule)
        if mh:
            strokes["reference_figure_height_px"] = int(mh.group(1))
        mc = re.search(r"clamp to \[([\d.]+)x,\s*([\d.]+)x\]", rule)
        if mc:
            strokes["scale_clamp"] = [float(mc.group(1)), float(mc.group(2))]
    taper = lines.get("taper", {})
    if isinstance(taper, dict):
        for k in ("end_ratio", "peak_position"):
            if isinstance(taper.get(k), (int, float)):
                strokes["taper"][k] = float(taper[k])
    wb = lines.get("weight_bias") or lines.get("shadow_side_multiplier")
    if isinstance(wb, (int, float)):
        strokes["shadow_side_multiplier"] = float(wb)
    elif isinstance(wb, str):
        mb = re.search(r"([\d.]+)x heavier", wb)
        if mb:
            strokes["shadow_side_multiplier"] = float(mb.group(1))
    if isinstance(lines.get("line_boil"), dict):
        strokes["line_boil"] = deep_merge(strokes["line_boil"], lines["line_boil"])
    strokes["ink"] = ink_map
    lit_override = ocr.get("lit_edge_ink_override")
    if lit_override:
        strokes["lit_edge_note"] = lit_override

    # -- texture / post
    tex = copy.deepcopy(DEFAULT_TEXTURE)
    for k, v in (texture or {}).items():
        if k == "atmospheric_haze" and isinstance(v, str):
            tex["atmospheric_haze_note"] = v
            mr = re.findall(r"(\d+)-(\d+)%", v)
            if mr:
                lo, hi = (int(x) / 100 for x in mr[0])
                tex["atmospheric_haze"]["far_bg"] = hi * 0.9
                tex["atmospheric_haze"]["mid_bg"] = lo * 0.75
        elif isinstance(v, dict) and isinstance(tex.get(k), dict):
            tex[k] = deep_merge(tex[k], v)
        else:
            tex[k] = v
    fg = tex["film_grain"]
    if isinstance(fg.get("reseed"), str):
        mr = re.search(r"every (\d+) frames", fg["reseed"])
        fg["reseed_every_frames"] = int(mr.group(1)) if mr else (2 if "twos" in fg["reseed"] else 1)
    bl = tex["bloom"]
    if isinstance(bl.get("only_if"), str):
        mi = re.search(r"intensity ([\d.]+)", bl["only_if"])
        if mi:
            bl["intensity_no_glow"] = float(mi.group(1))

    # -- motion
    mot = copy.deepcopy(DEFAULT_MOTION)
    if isinstance(motion, dict):
        if isinstance(motion.get("frame_rate"), (int, float)):
            mot["frame_rate"] = int(motion["frame_rate"])
        cad = motion.get("cadence", {})
        if isinstance(cad, dict) and "twos" in str(cad.get("characters_and_fx", "")):
            mot["character_cadence_frames"] = 2
        elif isinstance(cad, dict) and "ones" in str(cad.get("characters_and_fx", "")):
            mot["character_cadence_frames"] = 1
        if isinstance(motion.get("walk_cycle"), dict):
            mot["walk_cycle"] = deep_merge(mot["walk_cycle"], {k: v for k, v in motion["walk_cycle"].items()
                                                               if isinstance(v, (int, float))})
        sec = motion.get("secondary_motion", {})
        if isinstance(sec, dict) and isinstance(sec.get("cloth"), str):
            ms = re.search(r"(\d+)-(\d+) segments", sec["cloth"])
            if ms:
                mot["cloth"]["segments"] = (int(ms.group(1)) + int(ms.group(2))) // 2
            md = re.search(r"damping ([\d.]+)-([\d.]+)", sec["cloth"])
            if md:
                mot["cloth"]["damping"] = (float(md.group(1)) + float(md.group(2))) / 2
        sg = str(motion.get("shot_grammar", ""))
        md = re.search(r"\((\d+)-(\d+)% frame width per second\)", sg)
        if md:
            mot["camera_drift_frac_per_sec"] = [int(md.group(1)) / 100, int(md.group(2)) / 100]
        for k, v in motion.items():
            if k not in mot and not k.startswith("_"):
                mot[k] = v  # keep notes (easing prose, smear rules, ...) for the drawer author

    # -- proportions
    props = chars.get("proportions") if isinstance(chars.get("proportions"), dict) else raw.get("proportions")
    proportions = copy.deepcopy(props) if isinstance(props, dict) and props else {}
    proportions.setdefault("default_figure", copy.deepcopy(DEFAULT_PROPORTIONS["default_figure"]))

    # -- subtitles (style-coloured)
    subs = deep_merge(DEFAULT_SUBTITLES, raw.get("subtitles", {}))
    light = sorted(flat.values(), key=luminance)
    subs["fill"] = subs["fill"] or flat.get("cream_cloth") or flat.get("paper") or flat.get("jasmine") or light[-1]
    subs["outline"] = subs["outline"] or ink_map["default"]
    subs["highlight"] = subs["highlight"] or flat.get("gold") or flat.get("highlight") or flat.get("marigold")

    # -- audio palette (optional) + per-mood bed suggestions
    audio = deep_merge(DEFAULT_AUDIO, raw.get("audio_palette", {}))
    if audio["ambient_bed"] not in AUDIO_BEDS + ["auto"]:
        warn(f"audio_palette.ambient_bed '{audio['ambient_bed']}' unknown; using auto ({AUDIO_BEDS})")
        audio["ambient_bed"] = "auto"
    if audio["footstep_surface"] not in FOOTSTEP_SURFACES:
        warn(f"audio_palette.footstep_surface '{audio['footstep_surface']}' unknown; using stone")
        audio["footstep_surface"] = "stone"
    if audio["accent_chime"] not in CHIMES:
        warn(f"audio_palette.accent_chime '{audio['accent_chime']}' unknown; using temple_bell")
        audio["accent_chime"] = "temple_bell"
    for name in moods:
        if name in audio["mood_beds"]:
            continue
        n = name.lower()
        bed = ("rain" if any(w in n for w in ("monsoon", "rain", "storm")) else
               "river" if any(w in n for w in ("dusk", "ghat", "river", "aarti", "sunset")) else
               "night" if any(w in n for w in ("night", "moon")) else
               "temple_hum" if any(w in n for w in ("temple", "saffron", "mono", "divine")) else
               "city_hum" if any(w in n for w in ("neon", "city", "office", "street")) else "wind")
        audio["mood_beds"][name] = bed

    W = meta_in.get("canvas", {}).get("width", 1920) if isinstance(meta_in.get("canvas"), dict) else 1920
    H = meta_in.get("canvas", {}).get("height", 1080) if isinstance(meta_in.get("canvas"), dict) else 1080
    out = {
        "_contract_version": CONTRACT_VERSION,
        "_normalized": True,
        "meta": {"style_name": meta_in.get("style_name") or raw.get("style_name") or "Untitled style",
                 "one_line": meta_in.get("one_line", ""), "design_canvas": {"width": W, "height": H}},
        "palette": flat,
        "palette_groups": groups,
        "gradients": gradients,
        "lighting_moods": moods,
        "default_mood": default_mood,
        "strokes": strokes,
        "proportions": proportions,
        "texture_post": tex,
        "motion_rules": mot,
        "subtitles": subs,
        "audio_palette": audio,
        # descriptive sections are passed through verbatim for the scene-drawer author
        "shading": {k: v for k, v in colour.items() if k not in ("palette", "moods", "lighting_moods")},
        "characters": {k: v for k, v in chars.items() if k != "proportions"},
        "architecture": arch,
        "nature": nature,
        "strictly_avoid": raw.get("strictly_avoid", []),
    }
    if already:  # re-normalizing a normalized file must be idempotent
        out = deep_merge(out, {k: v for k, v in raw.items() if k in ("subtitles", "audio_palette", "texture_post")})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("style")
    ap.add_argument("-o", "--out", help="write normalized JSON here (default: stdout)")
    ap.add_argument("--strict", action="store_true", help="treat warnings as errors")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    try:
        raw = json.load(open(a.style, encoding="utf-8"))
        out = normalize(raw)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"[normalize_style] FATAL: {e}", file=sys.stderr)
        sys.exit(1)
    for w in warnings:
        print(f"[normalize_style] warning: {w}", file=sys.stderr)
    if a.strict and warnings:
        sys.exit(1)
    text = json.dumps(out, indent=2, ensure_ascii=False)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text)
        if not a.quiet:
            print(f"[normalize_style] {out['meta']['style_name']}: {len(out['palette'])} colours, "
                  f"{len(out['lighting_moods'])} moods ({', '.join(out['lighting_moods'])}), "
                  f"{len(out['gradients'])} gradients -> {a.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
