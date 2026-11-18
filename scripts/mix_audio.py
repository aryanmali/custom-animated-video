#!/usr/bin/env python3
"""Frame-synced SFX placement + sidechain-ducked BGM + broadcast loudness  ->  master_audio.wav

* every event from stems_manifest.json is placed at its exact millisecond offset with FFmpeg `adelay`
* the BGM is ducked by the voiceover through FFmpeg `sidechaincompress`; the key signal is level-matched first so the
  ducking depth is predictable (default 15 dB under narration), and the BGM swells back (+3 dB) inside every
  "dramatic_pause" from audio_timeline.json
* two-pass `loudnorm` to -14 LUFS integrated, -1.5 dBTP, 48 kHz / 24-bit
* writes mix_report.json with the measured ducking depth and final loudness

usage: python mix_audio.py --voice voiceover.wav --stems work/audio_stems --timeline audio_timeline.json \
                           -o master_audio.wav [--duck-db 15] [--lufs -14] [--swell-db 3] [--duration 7.06]
"""
import argparse, json, os, re, subprocess, sys
import numpy as np
from scipy.io import wavfile

SR = 48000


def ff(args, capture=True):
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-y"] + args, capture_output=capture, text=True)
    if r.returncode != 0:
        sys.exit(f"[mix_audio] ffmpeg failed:\n{r.stderr[-2500:]}")
    return r.stderr


def load(path, ch=2):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).copy()


def rms_db(x):
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-12))


def speech_mask(tl, n, pad=0.05):
    m = np.zeros(n, bool)
    for w in tl.get("words", []):
        a, b = int((w["start_sec"] - pad) * SR), int((w["end_sec"] + pad) * SR)
        m[max(0, a):min(n, b)] = True
    return m


def pause_envelope(tl, n, swell_db, ramp=0.25):
    """Gain curve (linear) that lifts the BGM by swell_db inside dramatic pauses with raised-cosine ramps."""
    g = np.zeros(n)
    for p in tl.get("pauses", []):
        if p.get("type") != "dramatic_pause":
            continue
        a, b = int(p["start_sec"] * SR), int(p["end_sec"] * SR)
        r = int(min(ramp, (p["end_sec"] - p["start_sec"]) / 2) * SR)
        seg = np.ones(max(0, b - a))
        if r > 0 and len(seg) > 2 * r:
            w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, r))
            seg[:r] = w; seg[-r:] = w[::-1]
        g[a:a + len(seg)] = np.maximum(g[a:a + len(seg)], seg[:max(0, min(len(seg), n - a))])
    return 10 ** (swell_db * g / 20)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", required=True)
    ap.add_argument("--stems", required=True, help="folder written by sfx_synth.py (stems_manifest.json)")
    ap.add_argument("--timeline", required=True)
    ap.add_argument("-o", "--out", default="master_audio.wav")
    ap.add_argument("--duck-db", type=float, default=None)
    ap.add_argument("--swell-db", type=float, default=None)
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--true-peak", type=float, default=-1.5)
    ap.add_argument("--duration", type=float, default=None)
    ap.add_argument("--style", help="normalized style (reads audio_palette.duck_db / pause_swell_db)")
    a = ap.parse_args()

    tl = json.load(open(a.timeline))
    man = json.load(open(os.path.join(a.stems, "stems_manifest.json")))
    aps = json.load(open(a.style)).get("audio_palette", {}) if a.style else {}
    duck = a.duck_db if a.duck_db is not None else float(aps.get("duck_db", 15))
    swell = a.swell_db if a.swell_db is not None else float(aps.get("pause_swell_db", 3))
    dur = a.duration or man.get("duration_sec") or tl["duration_sec"]
    work = os.path.join(a.stems, "_mix"); os.makedirs(work, exist_ok=True)

    # ---- 1. pre-process in numpy: pause swells on the BGM, level-matched sidechain key from the voice
    voice = load(a.voice)
    n = int(round(dur * SR))
    voice = np.pad(voice, ((0, max(0, n - len(voice))), (0, 0)))[:n]
    bgm = load(os.path.join(a.stems, man["bgm"]["file"]))
    bgm = np.pad(bgm, ((0, max(0, n - len(bgm))), (0, 0)))[:n]
    bgm *= pause_envelope(tl, n, swell)[:, None]
    wavfile.write(os.path.join(work, "bgm_swelled.wav"), SR, bgm.astype(np.float32))
    sm = speech_mask(tl, n)
    v_speech_db = float(rms_db(voice[sm]) if sm.any() else rms_db(voice))
    KEY_DB = -12.0                              # speech RMS of the key after matching
    key_gain_db = KEY_DB - v_speech_db
    RATIO = 20.0
    thr_db = KEY_DB - duck / (1 - 1 / RATIO)    # over-threshold * (1 - 1/ratio) == requested duck depth

    # ---- 2. FFmpeg graph: voice + ducked BGM + ambience + delayed events -> amix
    inputs = ["-i", a.voice, "-i", os.path.join(work, "bgm_swelled.wav"), "-i", os.path.join(a.stems, man["ambience"]["file"])]
    ev = man.get("events", [])
    for e in ev:
        inputs += ["-i", os.path.join(a.stems, e["file"])]
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    pre = os.path.join(work, "premaster.wav"); bgm_mon = os.path.join(work, "bgm_ducked.wav")
    raw_bg = bgm * 10 ** (man["bgm"]["gain_db"] / 20)

    def render(thr_db):
        thr_lin = max(0.000976563, 10 ** (thr_db / 20))
        g = [f"[0:a]{fmt},highpass=f=70,apad=whole_dur={dur},asplit=2[vo][vk]",
             f"[vk]volume={key_gain_db:.2f}dB[key]",
             f"[1:a]{fmt},volume={man['bgm']['gain_db']:.2f}dB[bg]",
             f"[bg][key]sidechaincompress=threshold={thr_lin:.6f}:ratio={RATIO}:attack=20:release=450:knee=3:makeup=1:detection=rms:link=average[bgd]",
             "[bgd]asplit=2[bgmix][bgmon]",
             f"[2:a]{fmt},volume={man['ambience']['gain_db']:.2f}dB[amb]"]
        labels = ["[vo]", "[bgmix]", "[amb]"]
        for k, e in enumerate(ev):
            ms = max(0, int(round(e["t_sec"] * 1000)))
            g.append(f"[{k + 3}:a]{fmt},adelay={ms}|{ms},volume={e['gain_db']:.2f}dB[e{k}]")
            labels.append(f"[e{k}]")
        g.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{dur},"
                 f"afade=t=out:st={max(0, dur - 0.25):.3f}:d=0.25[mix]")
        ff(inputs + ["-filter_complex", ";".join(g), "-map", "[mix]", "-c:a", "pcm_f32le", pre,
                     "-map", "[bgmon]", "-c:a", "pcm_f32le", "-t", str(dur), bgm_mon])
        bd = load(bgm_mon)[:n]
        sp = sm[:len(bd)]
        return bd, ((rms_db(raw_bg[:len(bd)][sp]) - rms_db(bd[sp])) if sp.any() else duck)

    # closed loop: speech RMS dips between words, so measure the real depth and correct the threshold (max 3 passes)
    hist = []
    for it in range(5):
        bd, duck_meas = render(thr_db)
        hist.append((thr_db, duck_meas))
        if abs(duck_meas - duck) <= 0.6:
            break
        if len(hist) >= 2 and abs(hist[-1][1] - hist[-2][1]) > 0.05:   # secant step on the measured response
            slope = (hist[-1][1] - hist[-2][1]) / (hist[-1][0] - hist[-2][0])
            thr_db -= max(-12.0, min(12.0, (duck_meas - duck) / slope))
        else:
            thr_db -= (duck - duck_meas) / (1 - 1 / RATIO)
        thr_db = max(-58.0, thr_db)

    # ---- 3. two-pass loudnorm -> -14 LUFS
    meas = ff(["-i", pre, "-af", f"loudnorm=I={a.lufs}:TP={a.true_peak}:LRA=11:print_format=json", "-f", "null", "-"])
    m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", meas, re.S).group(0))
    ln = (f"loudnorm=I={a.lufs}:TP={a.true_peak}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true:print_format=json")
    out2 = ff(["-i", pre, "-af", ln + ",aresample=48000", "-ar", "48000", "-c:a", "pcm_s24le", a.out])
    m2 = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", out2, re.S)[-1])

    # ---- 4. verify: ducking depth (BGM during speech vs. during pauses / unducked), final loudness
    sp = sm[:len(bd)]
    pm = np.zeros(len(bd), bool)
    for p in tl.get("pauses", []):
        pm[int(p["start_sec"] * SR):int(p["end_sec"] * SR)] = True
    report = {
        "master": os.path.abspath(a.out), "duration_sec": dur, "target_lufs": a.lufs,
        "output_integrated_lufs": float(m2.get("output_i", "nan")), "output_true_peak_db": float(m2.get("output_tp", "nan")),
        "duck_target_db": duck, "duck_measured_db": round(float(duck_meas), 2),
        "bgm_rms_speech_db": round(float(rms_db(bd[sp])), 2) if sp.any() else None,
        "bgm_rms_pause_db": round(float(rms_db(bd[pm])), 2) if pm.any() else None,
        "pause_swell_db": swell, "sidechain": {"key_gain_db": round(key_gain_db, 2), "threshold_db": round(thr_db, 2), "ratio": RATIO},
        "events_placed": [{"type": e["type"], "t_ms": int(round(e["t_sec"] * 1000)), "frame": e["frame"], "source": e["source"]} for e in ev],
        "bgm_source": man["bgm"].get("source"),
    }
    json.dump(report, open(os.path.join(os.path.dirname(os.path.abspath(a.out)), "mix_report.json"), "w"), indent=1)
    print(f"[mix_audio] {len(ev)} events placed | BGM ducked {duck_meas:.1f} dB under narration (target {duck:.0f}) | "
          f"pause swell +{swell:.0f} dB | {report['output_integrated_lufs']:.1f} LUFS, TP {report['output_true_peak_db']:.1f} dB -> {a.out}")


if __name__ == "__main__":
    main()
