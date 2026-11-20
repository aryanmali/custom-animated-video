#!/usr/bin/env python3
"""Audio alignment + vocal envelope extractor  ->  audio_timeline.json

1. Transcribes the voiceover (faster-whisper -> openai-whisper -> energy-only fallback) with word timestamps and
   force-aligns the words of script.txt/.md onto them, so every sentence and phrase gets an exact start/end.
2. Finds silent gaps >= --min-pause (0.55 s) inside the speech and tags them "dramatic_pause" beat opportunities.
3. Writes a frame-by-frame (24 fps by default) vocal RMS envelope in 0..1 plus mouth-state hints
   (closed / open_small / open_wide) and finer viseme hints (rest, MBP, FV, O, E, AI) for lip sync.

usage: python analyze_audio.py --audio voiceover.wav --script script.txt -o audio_timeline.json
                               [--fps 24] [--model small.en] [--engine auto|faster-whisper|whisper|energy]
"""
import argparse, difflib, json, os, re, subprocess, sys
import numpy as np

SR = 16000


# ------------------------------------------------------------------------------------------------------------- audio
def load_audio(path, sr=SR):
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    try:
        raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    except FileNotFoundError:
        sys.exit("[analyze_audio] ffmpeg not found on PATH")
    except subprocess.CalledProcessError as e:
        sys.exit(f"[analyze_audio] ffmpeg could not decode {path}: {e.stderr.decode()[:300]}")
    x = np.frombuffer(raw, dtype=np.float32).copy()
    if x.size == 0:
        sys.exit(f"[analyze_audio] {path} decoded to zero samples")
    return x


def frame_rms_db(x, hop, win):
    """RMS (dB) of windows of length win centred every hop samples."""
    n = int(np.ceil(len(x) / hop))
    pad = np.pad(x, (win // 2, win))
    idx = (np.arange(n) * hop).astype(int)
    out = np.empty(n)
    for i, s in enumerate(idx):
        seg = pad[s:s + win]
        out[i] = 10 * np.log10(np.mean(seg * seg) + 1e-12)
    return out


def speech_threshold_db(db):
    peak = np.percentile(db, 99)
    floor = np.percentile(db, 8)
    # midway-ish between the noise floor and speech, never closer than 30 dB under the peak
    return max(floor + 0.35 * (peak - floor), peak - 38.0), peak, floor


def find_silences(x, min_len, sr=SR):
    hop = int(0.01 * sr)
    db = frame_rms_db(x, hop, int(0.03 * sr))
    thr, peak, floor = speech_threshold_db(db)
    silent = db < thr
    # close tiny speech blips (< 60 ms) inside silences and tiny gaps (< 80 ms) inside speech
    def runs(mask):
        out, start = [], None
        for i, m in enumerate(mask):
            if m and start is None:
                start = i
            elif not m and start is not None:
                out.append((start, i)); start = None
        if start is not None:
            out.append((start, len(mask)))
        return out
    for a, b in runs(~silent):
        if b - a < 6:
            silent[a:b] = True
    for a, b in runs(silent):
        if b - a < 8:
            silent[a:b] = False
    regions = [(a * hop / sr, b * hop / sr) for a, b in runs(silent)]
    speech = [(a * hop / sr, b * hop / sr) for a, b in runs(~silent)]
    return [r for r in regions if r[1] - r[0] >= min_len], speech, {"threshold_db": round(float(thr), 1),
                                                                   "peak_db": round(float(peak), 1),
                                                                   "floor_db": round(float(floor), 1)}


# ------------------------------------------------------------------------------------------------------------ script
def read_script(path):
    if not path:
        return ""
    t = open(path, encoding="utf-8").read()
    if path.lower().endswith(".md"):
        t = re.sub(r"^#.*$", "", t, flags=re.M)               # headings
        t = re.sub(r"^\s*\|?\s*-{3,}.*$", "", t, flags=re.M)  # table rules
        t = re.sub(r"[*_`>]", "", t)
        t = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", t)
    return t.strip()


def split_sentences(text):
    text = re.sub(r"[ \t]+", " ", text)
    parts = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts += [p.strip() for p in re.split(r"(?<=[.!?…।॥])\s+(?=[\"'“‘(\[]?[A-Z0-9ऀ-ॿ])", line) if p.strip()]
    return parts


def split_phrases(sentence):
    ph = [p.strip() for p in re.split(r"(?<=[,;:—–])\s+|\s+[—–-]{1,2}\s+", sentence) if p.strip()]
    return ph or [sentence]


def norm_tok(w):
    import unicodedata
    w = unicodedata.normalize("NFC", w).lower().replace("’", "'")
    w = w.replace("\u093c", "").replace("\u0901", "\u0902")  # Devanagari: drop nukta, chandrabindu->anusvara
    w = re.sub(r"[^a-z0-9'\u0900-\u0963\u0966-\u097f]", "", w)
    return w.strip("'")


DEVANAGARI = re.compile(r"[\u0900-\u097f]")


def detect_language(text):
    """'hi' when the script is mostly Devanagari, else 'en' (None when there is no script)."""
    if not text:
        return None
    letters = [c for c in text if c.isalpha()]
    dev = sum(1 for c in letters if DEVANAGARI.match(c))
    return "hi" if letters and dev / len(letters) > 0.3 else "en"


def resolve_model(model, lang):
    """English-only (*.en) Whisper models cannot hear Hindi: swap to the multilingual twin."""
    if lang and lang != "en" and model.endswith(".en"):
        base = model[:-3]
        return "small" if base in ("tiny", "base") else base
    return model


# rough Devanagari -> Latin map, only used to pick lip-sync visemes
_DEV_LAT = {**{c: "a" for c in "अआऐऔािैौ"}, **{c: "i" for c in "इईएिीे"}, **{c: "u" for c in "उऊओुूो"},
            **{c: "m" for c in "मबभपफ"}, **{c: "v" for c in "वफ"}, "ं": "m", "ँ": "m"}


def latinize(w):
    if not DEVANAGARI.search(w):
        return w
    return "".join(_DEV_LAT.get(c, "a" if DEVANAGARI.match(c) and c not in "्ःऽ" else "") for c in w)


# --------------------------------------------------------------------------------------------------------- ASR paths
def asr_faster_whisper(path, model, prompt, language=None):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device="cpu", compute_type="int8")
    lang = "en" if model.endswith(".en") else language
    segs, info = m.transcribe(path, word_timestamps=True, language=lang, initial_prompt=(prompt or None) and prompt[:600],
                              vad_filter=False, beam_size=5, condition_on_previous_text=False)
    words = []
    for s in segs:
        for w in (s.words or []):
            words.append({"word": w.word.strip(), "start": float(w.start), "end": float(w.end),
                          "prob": round(float(w.probability), 3)})
    return words


def asr_openai_whisper(path, model, prompt, language=None):
    import whisper
    m = whisper.load_model(model.replace(".en", "") if model.endswith(".en") and model.startswith("large") else model)
    r = m.transcribe(path, word_timestamps=True, language=language, initial_prompt=prompt[:600] if prompt else None)
    return [{"word": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"]),
             "prob": round(float(w.get("probability", 1.0)), 3)} for s in r["segments"] for w in s.get("words", [])]


# --------------------------------------------------------------------------------------------------------- alignment
def align_script(script_words, asr_words, speech_span):
    """Return list of (start, end) for each script word. Matched words take ASR times; the rest are interpolated."""
    a = [norm_tok(w) for w in script_words]
    b = [norm_tok(w["word"]) for w in asr_words]
    times = [None] * len(a)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                if tag == "equal" or difflib.SequenceMatcher(None, a[i1 + k], b[j1 + k]).ratio() >= 0.5:
                    times[i1 + k] = (asr_words[j1 + k]["start"], asr_words[j1 + k]["end"])
        elif tag == "replace" and (i2 - i1) >= 1 and (j2 - j1) >= 1:
            # unequal block: spread the ASR block span over the script words by character weight
            t0, t1 = asr_words[j1]["start"], asr_words[j2 - 1]["end"]
            wts = np.array([max(1, len(x)) for x in a[i1:i2]], float)
            cum = np.concatenate([[0], np.cumsum(wts)]) / wts.sum()
            for k in range(i2 - i1):
                times[i1 + k] = (t0 + (t1 - t0) * cum[k], t0 + (t1 - t0) * cum[k + 1])
    matched = sum(t is not None for t in times)
    # interpolate the gaps between anchors
    s0, s1 = speech_span
    i = 0
    while i < len(times):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(times) and times[j] is None:
            j += 1
        left = times[i - 1][1] if i > 0 else s0
        right = times[j][0] if j < len(times) else s1
        right = max(right, left + 0.08 * (j - i))
        wts = np.array([max(1, len(x)) for x in a[i:j]], float)
        cum = np.concatenate([[0], np.cumsum(wts)]) / wts.sum()
        for k in range(j - i):
            times[i + k] = (left + (right - left) * cum[k], left + (right - left) * cum[k + 1])
        i = j
    return times, matched


def energy_only_words(script_words, speech_regions):
    """No ASR: distribute script words across detected speech regions by character weight."""
    if not speech_regions:
        return [(0, 0)] * len(script_words)
    total = sum(b - a for a, b in speech_regions)
    wts = np.array([max(1, len(norm_tok(w))) + 1 for w in script_words], float)
    cum = np.concatenate([[0], np.cumsum(wts)]) / wts.sum() * total

    def at(d):  # map a "speech-time" offset to real time, skipping silences
        for a, b in speech_regions:
            if d <= b - a:
                return a + d
            d -= b - a
        return speech_regions[-1][1]
    return [(at(cum[k]), at(cum[k + 1])) for k in range(len(script_words))]


# ----------------------------------------------------------------------------------------------- envelope and mouth
def vocal_envelope(x, fps, sr=SR):
    hop = sr / fps
    n = int(np.ceil(len(x) / hop))
    win = int(hop * 1.5)
    pad = np.pad(x, (win // 2, win))
    db = np.array([10 * np.log10(np.mean(pad[int(i * hop):int(i * hop) + win] ** 2) + 1e-12) for i in range(n)])
    peak = np.percentile(db, 98)
    lo = peak - 22.0  # ~22 dB of useful vocal dynamics: wider ranges saturate and every frame reads "wide open"
    env = np.clip((db - lo) / (peak - lo), 0, 1) ** 1.5
    # fast attack, soft release (mouths close a touch slower than they open)
    out = np.zeros_like(env)
    prev = 0.0
    for i, v in enumerate(env):
        prev = v if v > prev else prev * 0.55 + v * 0.45
        out[i] = prev
    return out


VOWEL_O = set("ouw")
VOWEL_AI = set("a")
VOWEL_E = set("eiy")


def mouth_tracks(env, words, fps):
    n = len(env)
    mouth, vis = ["closed"] * n, ["rest"] * n
    for i in range(n):
        t = (i + 0.5) / fps
        w = next((w for w in words if w["start"] - 0.03 <= t <= w["end"] + 0.03), None)
        e = float(env[i])
        if w is None or e < 0.1:
            continue
        letters = re.sub(r"[^a-z]", "", latinize(w["text"]).lower()) or "a"
        frac = min(0.999, max(0.0, (t - w["start"]) / max(1e-3, w["end"] - w["start"])))
        ch = letters[int(frac * len(letters))]
        if ch in "mbp":
            mouth[i], vis[i] = "closed", "MBP"
        elif ch in "fv":
            mouth[i], vis[i] = "open_small", "FV"
        elif ch in VOWEL_O:
            mouth[i], vis[i] = ("open_wide" if e > 0.62 else "open_small"), "O"
        elif ch in VOWEL_AI:
            mouth[i], vis[i] = ("open_wide" if e > 0.5 else "open_small"), "AI"
        elif ch in VOWEL_E:
            mouth[i], vis[i] = ("open_wide" if e > 0.62 else "open_small"), "E"
        else:
            mouth[i], vis[i] = ("open_wide" if e > 0.72 else "open_small"), "AI" if e > 0.72 else "E"
    # de-flicker: no state lasts a single frame
    for i in range(1, n - 1):
        if mouth[i] != mouth[i - 1] and mouth[i] != mouth[i + 1]:
            mouth[i], vis[i] = mouth[i - 1], vis[i - 1]
    return mouth, vis


# ------------------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--script", help="script.txt / script.md (optional: without it, ASR text is used)")
    ap.add_argument("-o", "--out", default="audio_timeline.json")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--model", default=os.environ.get("CAV_WHISPER_MODEL", "base.en"))
    ap.add_argument("--language", default=os.environ.get("CAV_LANGUAGE", "auto"),
                    help="spoken language for Whisper: auto (from the script's script/alphabet), en, hi, ...")
    ap.add_argument("--engine", default="auto", choices=["auto", "faster-whisper", "whisper", "energy"])
    ap.add_argument("--min-pause", type=float, default=0.55)
    a = ap.parse_args()

    x = load_audio(a.audio)
    duration = len(x) / SR
    script = read_script(a.script)
    lang = detect_language(script) if a.language == "auto" else a.language
    model = resolve_model(a.model, lang)
    if model != a.model:
        print(f"[analyze_audio] script language '{lang}': using multilingual Whisper '{model}' instead of '{a.model}'",
              file=sys.stderr)
    silences, speech, levels = find_silences(x, a.min_pause)
    speech_span = (speech[0][0], speech[-1][1]) if speech else (0.0, duration)

    asr, engine = [], "energy"
    order = {"auto": ["faster-whisper", "whisper"], "faster-whisper": ["faster-whisper"], "whisper": ["whisper"],
             "energy": []}[a.engine]
    for eng in order:
        try:
            asr = (asr_faster_whisper if eng == "faster-whisper" else asr_openai_whisper)(a.audio, model, script, lang)
            engine = eng
            if asr:
                break
        except Exception as e:  # missing package, no model offline, ...
            print(f"[analyze_audio] {eng} unavailable ({type(e).__name__}: {str(e)[:120]}); falling back", file=sys.stderr)
    if not script:
        if not asr:
            sys.exit("[analyze_audio] no script and no ASR engine available: cannot know the words")
        script = " ".join(w["word"] for w in asr)

    sentences = split_sentences(script)
    tokens, owner = [], []
    for si, s in enumerate(sentences):
        for w in s.split():
            if norm_tok(w):
                tokens.append(w); owner.append(si)
    if asr:
        times, matched = align_script(tokens, asr, speech_span)
        coverage = matched / max(1, len(tokens))
    else:
        times, coverage = energy_only_words(tokens, speech), 0.0
    words = [{"i": i, "text": w, "start_sec": round(t[0], 3), "end_sec": round(t[1], 3), "segment": owner[i]}
             for i, (w, t) in enumerate(zip(tokens, times))]

    segments, wi = [], 0
    for si, s in enumerate(sentences):
        ws = [w for w in words if w["segment"] == si]
        if not ws:
            continue
        phrases, k = [], 0
        for ph in split_phrases(s):
            n = len([t for t in ph.split() if norm_tok(t)])
            pw = ws[k:k + n] or ws[-1:]
            phrases.append({"text": ph, "start_sec": pw[0]["start_sec"], "end_sec": pw[-1]["end_sec"],
                            "word_range": [pw[0]["i"], pw[-1]["i"]]})
            k += n
        segments.append({"id": si, "text": s, "start_sec": ws[0]["start_sec"], "end_sec": ws[-1]["end_sec"],
                         "word_range": [ws[0]["i"], ws[-1]["i"]], "phrases": phrases})

    # pauses: silences strictly inside the speech, plus the lead-in / tail
    pauses, edges = [], []
    for s0, s1 in silences:
        if s1 <= speech_span[0] + 1e-3:
            edges.append({"type": "lead_in", "start_sec": round(s0, 3), "end_sec": round(s1, 3)})
            continue
        if s0 >= speech_span[1] - 1e-3:
            edges.append({"type": "tail", "start_sec": round(s0, 3), "end_sec": round(s1, 3)})
            continue
        after = max([sg["id"] for sg in segments if sg["end_sec"] <= s0 + 0.15] or [None], key=lambda v: -1 if v is None else v)
        prev_w = [w["i"] for w in words if w["end_sec"] <= s0 + 0.15]
        pauses.append({"type": "dramatic_pause", "start_sec": round(s0, 3), "end_sec": round(s1, 3),
                       "duration_sec": round(s1 - s0, 3), "after_segment": after,
                       "after_word": prev_w[-1] if prev_w else None,
                       "start_frame": int(round(s0 * a.fps)), "end_frame": int(round(s1 * a.fps)),
                       "suggested_use": ["camera_hold", "visual_reveal", "bgm_swell"]})
    # also honour ASR word gaps that the energy gate missed (breathy pauses)
    for w0, w1 in zip(words, words[1:]):
        g0, g1 = w0["end_sec"], w1["start_sec"]
        if g1 - g0 >= a.min_pause and not any(p["start_sec"] < g1 and p["end_sec"] > g0 for p in pauses):
            pauses.append({"type": "dramatic_pause", "start_sec": g0, "end_sec": g1, "duration_sec": round(g1 - g0, 3),
                           "after_segment": w0["segment"], "after_word": w0["i"], "start_frame": int(round(g0 * a.fps)),
                           "end_frame": int(round(g1 * a.fps)), "suggested_use": ["camera_hold", "visual_reveal", "bgm_swell"],
                           "source": "word_gap"})
    pauses.sort(key=lambda p: p["start_sec"])

    env = vocal_envelope(x, a.fps)
    mouth, vis = mouth_tracks(env, [{"text": w["text"], "start": w["start_sec"], "end": w["end_sec"]} for w in words], a.fps)
    total_frames = int(np.ceil(duration * a.fps))
    env, mouth, vis = env[:total_frames], mouth[:total_frames], vis[:total_frames]

    out = {
        "version": "1.0", "audio": os.path.abspath(a.audio), "fps": a.fps,
        "duration_sec": round(duration, 3), "total_frames": total_frames,
        "engine": engine, "model": model if engine != "energy" else None, "language": lang,
        "alignment_coverage": round(coverage, 3), "levels": levels,
        "speech_span": [round(speech_span[0], 3), round(speech_span[1], 3)],
        "segments": segments, "words": words, "pauses": pauses, "edges": edges,
        "asr_words": asr,
        "envelope": [round(float(v), 3) for v in env], "mouth": mouth, "viseme": vis,
    }
    json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"[analyze_audio] {duration:.2f}s, {total_frames} frames @ {a.fps}fps, engine={engine}, "
          f"aligned {coverage:.0%} of {len(tokens)} script words, {len(segments)} segments, "
          f"{len(pauses)} dramatic pause(s) -> {a.out}")
    for sg in segments:
        print(f"   [{sg['start_sec']:6.2f} - {sg['end_sec']:6.2f}] {sg['text']}")
    for p in pauses:
        aw = words[p["after_word"]]["text"] if p.get("after_word") is not None else "-"
        print(f"   pause {p['start_sec']:.2f}-{p['end_sec']:.2f} ({p['duration_sec']:.2f}s) after \"{aw}\"")
    if asr and coverage < 0.6:
        print("[analyze_audio] WARNING: under 60% of script words matched the audio: check the script matches the take",
              file=sys.stderr)


if __name__ == "__main__":
    main()
