#!/usr/bin/env python3
"""Style-matched procedural ambience, foley and BGM generator (with asset-library resolution first).

For every sound it needs, it first looks for a real recording in ./assets/sfx or ./assets/bgm (project), then in the
skill's own assets/ folders; only if none matches does it synthesize warm, organic, non-harsh audio with numpy/scipy.

Asset matching (case-insensitive, .wav .mp3 .flac .ogg .m4a .aiff):
  footstep_<surface>*  |  <surface>_footstep*  |  footstep*          e.g. footstep_stone_01.wav
  chime_<variant>*     |  <variant>*            (temple_bell, chime, singing_bowl)
  whoosh* | cloth*     |  swell* | riser*
  bed_<name>* | <name>_ambience* | <name>*     (river, wind, rain, temple_hum, city_hum, night)     -> assets/sfx
  bgm_<mood>* | <mood>* | bgm*                                                                    -> assets/bgm
Several matches for one kind rotate deterministically per event, so footsteps vary.

Batch mode (used by build_video.py):
  python sfx_synth.py --storyboard storyboard.json --style style.normalized.json --timeline audio_timeline.json \
                      --outdir work/audio_stems [--bgm custom.mp3] [--assets ./assets]
  -> ambience.wav, bgm.wav, events/evt_###.wav, stems_manifest.json
Single sound:
  python sfx_synth.py --kind footstep --surface gravel --out step.wav
  python sfx_synth.py --kind bed --name rain --duration 10 --out rain.wav
  python sfx_synth.py --kind bgm --mood diya_dusk --root-hz 110 --duration 20 --out pad.wav
"""
import argparse, glob, json, os, subprocess, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aiff", ".aif")
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ============================================================================================================ utils
def rng(seed):
    return np.random.default_rng(int(seed) & 0xFFFFFFFF)


def sos(kind, f, order=2):
    nyq = SR / 2
    if kind == "band":
        return signal.butter(order, [max(10, f[0]) / nyq, min(f[1], nyq * 0.98) / nyq], btype="band", output="sos")
    return signal.butter(order, min(f, nyq * 0.98) / nyq, btype=kind, output="sos")


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x, axis=0)


def pink(n, r):
    """Pink noise via FFT 1/f shaping."""
    w = r.standard_normal(n)
    X = np.fft.rfft(w)
    f = np.arange(len(X)); f[0] = 1
    y = np.fft.irfft(X / np.sqrt(f), n)
    return y / (np.std(y) + 1e-9)


def brown(n, r):
    y = np.cumsum(r.standard_normal(n))
    y = filt(y, "high", 20)
    return y / (np.std(y) + 1e-9)


def smooth_noise(n, r, rate_hz, lo=0.0, hi=1.0):
    """Slow random control signal in [lo, hi] (for gusts, swells)."""
    k = max(2, int(n / SR * rate_hz) + 3)
    pts = r.random(k)
    x = np.linspace(0, k - 1, n)
    y = np.interp(x, np.arange(k), pts)
    y = filt(y, "low", max(0.2, rate_hz), 1)
    y = (y - y.min()) / (np.ptp(y) + 1e-9)
    return lo + (hi - lo) * y


def env_ad(n, a, d, curve=4.0):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.exp(-(t - a) * curve / max(d, 1e-3)))
    return e


def fade(x, fin=0.02, fout=0.05):
    n = len(x)
    a, b = int(fin * SR), int(fout * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim == 2 else np.linspace(1, 0, b)
    return x


def stereo(mono, pan=0.0, width=0.0, r=None):
    """Constant-power pan; width>0 adds a decorrelated side component."""
    l, rr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    out = np.stack([mono * l * np.sqrt(2), mono * rr * np.sqrt(2)], axis=1)
    if width and r is not None:
        side = filt(r.standard_normal(len(mono)) * np.abs(mono).mean(), "band", (300, 4000)) * width * 0.0
        out += np.stack([side, -side], axis=1)
    return out


def warm(x, drive=1.2):
    """Soft tape-ish saturation + gentle top roll-off: keeps everything non-harsh."""
    y = np.tanh(x * drive) / np.tanh(drive)
    return filt(y, "low", 9000, 1)


def norm(x, peak_db=-1.0):
    p = np.max(np.abs(x)) + 1e-9
    return x * (10 ** (peak_db / 20) / p)


def write(path, x):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    wavfile.write(path, SR, np.clip(x, -1, 1).astype(np.float32))


def load(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


# ================================================================================================= asset resolution
def find_asset(roots, patterns, seed=0):
    hits = []
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        files = [f for f in glob.glob(os.path.join(root, "**", "*"), recursive=True) if f.lower().endswith(EXTS)]
        for pat in patterns:
            m = sorted(f for f in files if os.path.basename(f).lower().startswith(pat.lower()))
            if m:
                hits = m
                break
        if hits:
            break
    return hits[seed % len(hits)] if hits else None


def resolve(kind, sub, roots_sfx, roots_bgm, seed):
    pats = {
        "footstep": [f"footstep_{sub}", f"{sub}_footstep", f"footsteps_{sub}", "footstep"],
        "chime": [f"chime_{sub}", f"{sub}", "bell", "chime"],
        "whoosh": ["whoosh", "cloth", "rustle"],
        "swell": ["swell", "riser", "transition"],
        "bed": [f"bed_{sub}", f"{sub}_ambience", f"{sub}_bed", f"{sub}"],
        "bgm": [f"bgm_{sub}", f"{sub}", "bgm"],
    }.get(kind, [kind])
    return find_asset(roots_bgm if kind == "bgm" else roots_sfx, pats, seed)


# ======================================================================================================= ambience
def bed(name, dur, seed=1):
    n = int(dur * SR)
    r = rng(seed)
    if name == "river":
        body = filt(pink(n, r), "band", (120, 2200))
        flow = smooth_noise(n, r, 0.35, 0.6, 1.0)
        lap = np.zeros(n)  # gentle laps / bubbles: soft low sine blips
        for _ in range(int(dur * 3.5)):
            i = r.integers(0, max(1, n - SR))
            f0 = r.uniform(180, 520); L = int(SR * r.uniform(0.04, 0.12))
            t = np.arange(L) / SR
            lap[i:i + L] += np.sin(2 * np.pi * (f0 + 400 * t) * t) * np.hanning(L) * r.uniform(0.15, 0.4)
        hiss = filt(r.standard_normal(n), "band", (1800, 5500)) * 0.12 * smooth_noise(n, r, 0.8, 0.4, 1)
        mono = body * flow * 0.5 + lap * 0.6 + hiss
        x = np.stack([mono, np.roll(mono, int(0.013 * SR)) * 0.9 + filt(pink(n, r), "band", (150, 1800)) * 0.12], axis=1)
    elif name == "wind":
        g = smooth_noise(n, r, 0.25, 0.25, 1.0)
        w = filt(pink(n, r), "band", (180, 1200)) * g
        leaves = filt(r.standard_normal(n), "band", (2500, 7000)) * smooth_noise(n, r, 2.0, 0, 1) ** 3 * g * 0.35
        mono = w + leaves
        x = np.stack([mono, np.roll(mono, int(0.021 * SR))], axis=1)
    elif name == "rain":
        dense = filt(r.standard_normal(n), "band", (800, 6500)) * 0.35
        drops = np.zeros(n)
        for i in r.integers(0, n - 2000, size=int(dur * 600)):
            L = r.integers(80, 400); drops[i:i + L] += r.standard_normal(L) * np.exp(-np.arange(L) / (L / 5)) * r.uniform(0.2, 1)
        drops = filt(drops, "band", (1200, 8000))
        roof = filt(brown(n, r), "low", 300) * 0.25
        mono = dense + drops * 0.5 + roof
        x = np.stack([mono, np.roll(mono, int(0.017 * SR)) * 0.95], axis=1)
    elif name == "temple_hum":
        t = np.arange(n) / SR
        f = 98.0 + r.uniform(-3, 3)
        hum = sum(a * np.sin(2 * np.pi * f * k * t + r.uniform(0, 6)) for k, a in [(1, 1), (2, 0.5), (3, 0.28), (4.02, 0.12)])
        hum *= 0.6 + 0.4 * smooth_noise(n, r, 0.2, 0, 1)
        crowd = filt(pink(n, r), "band", (250, 1400)) * 0.22 * smooth_noise(n, r, 0.4, 0.4, 1)
        mono = hum * 0.35 + crowd
        x = np.stack([mono, np.roll(mono, int(0.011 * SR))], axis=1)
    elif name == "city_hum":
        mono = filt(brown(n, r), "low", 220) * 0.6 + filt(pink(n, r), "band", (300, 2000)) * 0.15 * smooth_noise(n, r, 0.15, 0.3, 1)
        x = np.stack([mono, np.roll(mono, int(0.02 * SR))], axis=1)
    elif name == "night":
        t = np.arange(n) / SR
        crick = np.zeros(n)
        for k in range(3):
            f0, rate = r.uniform(4200, 5200), r.uniform(14, 22)
            gate = (np.sin(2 * np.pi * rate * t + k) > 0.55).astype(float) * (np.sin(2 * np.pi * 0.7 * t + k * 2) > -0.2)
            crick += np.sin(2 * np.pi * f0 * t) * filt(gate, "low", 120, 1) * 0.12
        mono = crick + filt(pink(n, r), "band", (150, 900)) * 0.18
        x = np.stack([mono, np.roll(mono, int(0.009 * SR)) * 0.9], axis=1)
    else:
        return np.zeros((n, 2))
    x = warm(norm(x, -6), 1.1)
    return fade(norm(x, -6), 1.0, 1.0)


# ========================================================================================================== foley
def footstep(surface="stone", seed=0):
    r = rng(seed * 31 + 7)
    L = int(SR * 0.45); t = np.arange(L) / SR; x = np.zeros(L)
    if surface == "stone":
        heel = filt(r.standard_normal(L), "band", (900, 3800)) * env_ad(L, 0.002, 0.045, 5)
        thump = np.sin(2 * np.pi * r.uniform(70, 95) * t) * env_ad(L, 0.003, 0.07, 5) * 0.9
        toe_i = int(SR * r.uniform(0.07, 0.1))
        toe = np.zeros(L); toe[toe_i:] = (filt(r.standard_normal(L - toe_i), "band", (1500, 5000)) * env_ad(L - toe_i, 0.001, 0.03, 5)) * 0.45
        grit = filt(r.standard_normal(L), "high", 3000) * env_ad(L, 0.01, 0.12, 4) * 0.08
        x = heel + thump + toe + grit
    elif surface == "wood":
        for f0, a, d in [(r.uniform(160, 200), 1.0, 0.12), (r.uniform(380, 460), 0.6, 0.08), (r.uniform(850, 1000), 0.3, 0.05)]:
            x += np.sin(2 * np.pi * f0 * t) * env_ad(L, 0.002, d, 5) * a
        x += filt(r.standard_normal(L), "band", (700, 2500)) * env_ad(L, 0.001, 0.03, 5) * 0.5
    elif surface == "grass":
        crunch = filt(r.standard_normal(L), "band", (1800, 7000)) * (r.random(L) > 0.6) * env_ad(L, 0.02, 0.18, 3)
        x = crunch * 0.8 + filt(r.standard_normal(L), "low", 400) * env_ad(L, 0.01, 0.08, 4) * 0.4
    elif surface == "gravel":
        for _ in range(int(r.integers(25, 45))):
            i = int(r.uniform(0, 0.16) * SR); g = int(r.integers(60, 260))
            if i + g < L:
                x[i:i + g] += r.standard_normal(g) * np.exp(-np.arange(g) / (g / 4)) * r.uniform(0.2, 1)
        x = filt(x, "band", (900, 6500)) + np.sin(2 * np.pi * 80 * t) * env_ad(L, 0.004, 0.06, 5) * 0.5
    x = warm(norm(x, -3), 1.3)
    return fade(stereo(x, r.uniform(-0.12, 0.12)), 0.001, 0.08)


def whoosh(dur=0.7, seed=0):
    r = rng(seed + 101)
    n = int(dur * SR); t = np.linspace(0, 1, n)
    noise = pink(n, r)
    shape = np.sin(np.pi * t ** 0.8) ** 2
    # swept band: cloth flutter (AM at ~22 Hz) through a rising-then-falling band
    out = np.zeros(n); hop = 2048
    for i in range(0, n, hop):
        c = 500 + 2200 * np.sin(np.pi * (i / n)) ** 1.5
        seg = noise[i:i + hop]
        out[i:i + hop] = filt(seg, "band", (c * 0.6, c * 1.6), 1)
    flutter = 0.7 + 0.3 * np.sin(2 * np.pi * (18 + 8 * t) * t * dur)
    x = warm(norm(out * shape * flutter, -3), 1.1)
    pan = np.linspace(-0.5, 0.5, n)
    return fade(np.stack([x * np.cos((pan + 1) * np.pi / 4), x * np.sin((pan + 1) * np.pi / 4)], axis=1) * 1.41, 0.01, 0.1)


BELL_PARTIALS = [(0.5, 1.0, 1.0), (1.0, 0.8, 0.75), (1.183, 0.55, 0.6), (1.506, 0.42, 0.5), (2.0, 0.35, 0.42),
                 (2.514, 0.22, 0.32), (2.662, 0.18, 0.28), (3.011, 0.12, 0.22), (4.166, 0.06, 0.15)]


def chime(variant="temple_bell", seed=0, length=4.0):
    r = rng(seed + 211)
    n = int(length * SR); t = np.arange(n) / SR; x = np.zeros(n)
    if variant == "singing_bowl":
        f0 = r.uniform(220, 300)
        for k, (ratio, amp) in enumerate([(1, 1), (2.71, 0.5), (5.15, 0.22)]):
            beat = 1 + 0.25 * np.sin(2 * np.pi * r.uniform(0.6, 1.8) * t)
            x += np.sin(2 * np.pi * f0 * ratio * t) * amp * beat * np.exp(-t / (length * 0.5 / (k + 1)))
        x *= np.minimum(1, t / 0.08)
    elif variant == "chime":
        for _ in range(int(r.integers(4, 7))):
            i = int(r.uniform(0, 0.9) * SR); f0 = r.choice([1318.5, 1568.0, 1760.0, 2093.0, 2349.3])
            L = n - i; tt = np.arange(L) / SR
            x[i:] += sum(np.sin(2 * np.pi * f0 * k * tt) * a * np.exp(-tt / (1.4 / k)) for k, a in [(1, 1), (2.76, 0.3), (5.4, 0.1)]) * r.uniform(0.4, 1)
    else:  # temple_bell: inharmonic bronze partials, long hum, soft strike
        f0 = r.uniform(560, 660)
        for ratio, amp, dec in BELL_PARTIALS:
            det = 1 + r.uniform(-0.002, 0.002)
            x += np.sin(2 * np.pi * f0 * ratio * det * t + r.uniform(0, 6)) * amp * np.exp(-t / (length * dec * 0.6))
        strike = filt(r.standard_normal(n), "band", (1500, 5000)) * env_ad(n, 0.001, 0.02, 6) * 0.25
        x = x * np.minimum(1, t / 0.004) + strike
    x = warm(norm(x, -3), 1.05)
    # small room: two early reflections + a soft tail
    wet = np.zeros_like(x)
    for d, g in [(0.031, 0.35), (0.057, 0.25), (0.11, 0.15)]:
        k = int(d * SR); wet[k:] += x[:-k] * g
    out = np.stack([x + wet * 0.8, x + np.roll(wet, 331) * 0.8], axis=1)
    return fade(norm(out, -3), 0.001, 0.4)


def swell(dur=1.0, seed=0, root_hz=55.0):
    """Soft low-end transition swell: filtered noise rise + sub sine bloom peaking at the cut, short tail."""
    r = rng(seed + 307)
    tail = 0.6
    n = int((dur + tail) * SR); t = np.arange(n) / SR
    rise = np.clip(t / dur, 0, 1) ** 2.2
    fall = np.where(t > dur, np.exp(-(t - dur) / 0.18), 1)
    e = rise * fall
    noise = filt(pink(n, r), "low", 900) * 0.5
    sub = np.sin(2 * np.pi * (root_hz * (0.92 + 0.08 * np.clip(t / dur, 0, 1))) * t)
    harm = np.sin(2 * np.pi * root_hz * 2 * t) * 0.25 + np.sin(2 * np.pi * root_hz * 3 * t) * 0.08
    x = (noise + sub * 0.9 + harm) * e
    x = warm(norm(x, -3), 1.3)
    return fade(stereo(x, 0.0), 0.05, 0.25)


# =========================================================================================================== bgm
MOOD_MODES = {  # semitone sets layered over the drone; warm moods lean major, dark/cool moods lean minor/phrygian
    "warm": [0, 7, 12, 16, 19], "dark": [0, 7, 12, 15, 19], "mystic": [0, 1, 7, 12, 13], "bright": [0, 4, 7, 12, 19],
}


def mood_mode(mood_name, mood):
    n = (mood_name or "").lower()
    if any(w in n for w in ("neon", "night", "moon", "monsoon", "storm", "noir", "rain")):
        return "dark"
    if any(w in n for w in ("mono", "divine", "parchment", "saffron")):
        return "mystic"
    if any(w in n for w in ("day", "temple_day", "dawn")):
        return "bright"
    return "warm"


def bgm(dur, root_hz=110.0, mode="warm", seed=0, pauses=()):
    """Warm modal underscore: tanpura-style plucked drone (Pa-Sa'-Sa'-Sa cycle with jawari buzz) + slow pad."""
    r = rng(seed + 401)
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    # tanpura plucks
    cycle = [1.5, 2.0, 2.0, 1.0]
    period = 0.95
    k = 0
    while k * period < dur:
        i0 = int(k * period * SR); f = root_hz * cycle[k % 4] / 2
        L = min(n - i0, int(SR * 4.5)); tt = np.arange(L) / SR
        tone = np.zeros(L)
        for h in range(1, 14):  # jawari: bright harmonics that bloom then fade slowly
            bloom = np.minimum(1, tt / (0.15 + 0.04 * h)) * np.exp(-tt / (2.6 / (1 + 0.15 * h)))
            tone += np.sin(2 * np.pi * f * h * (1 + 0.0007 * h) * tt + r.uniform(0, 6)) * bloom / h ** 1.1
        out[i0:i0 + L] += tone * np.exp(-tt / 3.2) * r.uniform(0.8, 1.0)
        k += 1
    out = filt(out, "low", 3200, 2) * 0.55
    # pad: slow chords from the mode, detuned for warmth
    semis = MOOD_MODES.get(mode, MOOD_MODES["warm"])
    pad = np.zeros(n)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t)
    for j, s in enumerate(semis):
        f = root_hz * 2 ** (s / 12)
        for det in (-0.004, 0.004):
            pad += np.sin(2 * np.pi * f * (1 + det) * t + j) * (0.32 if s in (0, 7, 12) else 0.16 * lfo)
    pad = filt(pad, "low", 1800, 2) * smooth_noise(n, r, 0.12, 0.65, 1.0)
    sub = np.sin(2 * np.pi * root_hz / 2 * t) * 0.18
    # slow evolving motif in Bhairavi (Sa re ga ma Pa dha ni), soft sine/triangle notes with long envelopes
    phrases = [[7, 5, 3, 1, 0], [0, 3, 5, 7], [8, 7, 5, 3, 5], [3, 1, 0, 1, 3], [10, 8, 7, 5, 7], [5, 3, 1, 0]]
    mel = np.zeros(n)
    tt0 = 2.5 + r.uniform(0, 1.0); pi = 0
    while tt0 < dur - 1.0:
        ph = phrases[(pi * 5 + int(r.integers(0, 2))) % len(phrases)]
        tn = tt0
        for s in ph:
            i0 = int(tn * SR)
            if i0 >= n:
                break
            f = root_hz * 2 * 2 ** (s / 12)
            L = min(n - i0, int(SR * 3.2)); u = np.arange(L) / SR
            env = np.minimum(1, u / 0.35) * np.exp(-u / 1.1)
            tri = signal.sawtooth(2 * np.pi * f * u, 0.5)
            vib = np.sin(2 * np.pi * f * u + 0.24 * np.sin(2 * np.pi * 4.5 * u) * np.minimum(1, u / 1.0))
            mel[i0:i0 + L] += (0.7 * vib + 0.12 * tri) * env * r.uniform(0.75, 1.0)
            tn += r.uniform(1.5, 2.2)
        tt0 = tn + r.uniform(4.0, 7.5)  # long breathing rests so narration stays clear
        pi += 1
    mel = filt(mel, "low", 1600, 2)
    mel *= smooth_noise(n, r, 0.05, 0.5, 1.0)
    dry = out + pad * 0.35 + sub + mel * 0.22
    # light reverb: decaying noise impulse response (deterministic), ~2.2 s
    L = int(2.2 * SR); ir_t = np.arange(L) / SR
    ir = r.standard_normal(L) * np.exp(-ir_t / 0.55)
    ir = filt(ir, "low", 4500, 2); ir[0] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    ir2 = np.roll(ir, 37)
    wet = signal.fftconvolve(dry, ir)[:n]
    wet2 = signal.fftconvolve(dry, ir2)[:n]
    xl = dry * 0.78 + wet * 0.35
    xr = np.roll(dry, int(0.012 * SR)) * 0.75 + wet2 * 0.35
    st = np.stack([warm(norm(xl, -3), 1.1), warm(norm(xr, -3), 1.1)], axis=1)
    return fade(norm(st, -3), 1.2, 1.5)


# ========================================================================================================== batch
def batch(a):
    sb = json.load(open(a.storyboard))
    style = json.load(open(a.style)) if a.style else {}
    tl = json.load(open(a.timeline)) if a.timeline and os.path.exists(a.timeline) else {}
    ap = style.get("audio_palette", {})
    fps = sb.get("fps", 24)
    dur = float(sb.get("duration_sec") or tl.get("duration_sec") or max(s["end_sec"] for s in sb["shots"]))
    proj = os.path.dirname(os.path.abspath(a.storyboard))
    assets = a.assets or os.path.join(proj, "assets")
    roots_sfx = [os.path.join(assets, "sfx"), os.path.join(os.getcwd(), "assets", "sfx"), os.path.join(SKILL_DIR, "assets", "sfx")]
    roots_bgm = [os.path.join(assets, "bgm"), os.path.join(os.getcwd(), "assets", "bgm"), os.path.join(SKILL_DIR, "assets", "bgm")]
    os.makedirs(os.path.join(a.outdir, "events"), exist_ok=True)
    manifest = {"sr": SR, "duration_sec": dur, "events": [], "sources": {}}

    # ---- ambience: explicit storyboard beds, else one bed per shot from the style's mood->bed map
    amb_spec = sb.get("ambience")
    if not amb_spec:
        amb_spec = []
        for s in sb["shots"]:
            name = ap.get("ambient_bed") if ap.get("ambient_bed") not in (None, "auto") else ap.get("mood_beds", {}).get(s.get("mood"), "wind")
            amb_spec.append({"start_sec": s["start_sec"], "end_sec": s["end_sec"], "bed": name})
    amb = np.zeros((int(dur * SR) + SR, 2))
    for k, b in enumerate(amb_spec):
        if b.get("bed", "none") == "none":
            continue
        s0, s1 = float(b.get("start_sec", 0)), float(b.get("end_sec", dur))
        L = int((s1 - s0 + 1.2) * SR)
        src = resolve("bed", b["bed"], roots_sfx, roots_bgm, k)
        if src:
            x = load(src)
            x = np.tile(x, (int(np.ceil(L / len(x))), 1))[:L]
            x = fade(x, 0.6, 0.6)
        else:
            x = bed(b["bed"], L / SR, seed=k + 3)
        g = 10 ** (float(b.get("gain_db", ap.get("ambience_gain_db", -27))) / 20)  # absolute bed gain baked into the stem
        i0 = max(0, int((s0 - 0.6) * SR))
        seg = x[:len(amb) - i0] * g
        amb[i0:i0 + len(seg)] += seg
        manifest["sources"][f"ambience[{k}]:{b['bed']}"] = src or "procedural"
    write(os.path.join(a.outdir, "ambience.wav"), amb[:int(dur * SR)])
    manifest["ambience"] = {"file": "ambience.wav", "gain_db": 0.0}  # per-bed gains are already baked in

    # ---- bgm: --bgm file > storyboard bgm.path > assets/bgm match > procedural modal drone
    bspec = sb.get("bgm", {}) or {}
    mood0 = sb["shots"][0].get("mood") or style.get("default_mood")
    bpath = a.bgm or (bspec.get("path") and os.path.join(proj, bspec["path"]))
    if not bpath and bspec.get("mode", "auto") != "procedural":
        bpath = resolve("bgm", mood0 or "", roots_sfx, roots_bgm, 0)
    if bspec.get("mode") == "none":
        x = np.zeros((int(dur * SR), 2)); src = "none"
    elif bpath:
        x = load(bpath); src = bpath
        if len(x) < dur * SR:  # loop with a crossfade
            reps = int(np.ceil(dur * SR / len(x))) + 1
            x = np.concatenate([x] * reps)
        x = fade(x[:int(dur * SR)].copy(), 0.8, 1.5)
    else:
        root = float(bspec.get("root_hz") or ap.get("drone_root_hz", 110))
        x = bgm(dur, root, bspec.get("mode_override") or mood_mode(mood0, style.get("lighting_moods", {}).get(mood0, {})), seed=1)
        src = f"procedural modal drone + Bhairavi motif, reverb (root {root:.0f} Hz, {mood_mode(mood0, {})})"
    write(os.path.join(a.outdir, "bgm.wav"), x)
    manifest["bgm"] = {"file": "bgm.wav", "gain_db": float(bspec.get("gain_db", ap.get("bgm_gain_db", -20))), "source": src}

    # ---- frame-accurate events
    for k, e in enumerate(sb.get("sfx_events", [])):
        t0 = float(e["frame"]) / fps if "frame" in e else float(e.get("t_sec", 0))
        typ = e.get("type", "chime")
        sub = e.get("surface") or e.get("variant") or (ap.get("footstep_surface") if typ == "footstep" else ap.get("accent_chime") if typ in ("chime", "bell") else "")
        src = resolve("chime" if typ == "bell" else typ, sub, roots_sfx, roots_bgm, k)
        if src:
            x = load(src)
        elif typ == "footstep":
            x = footstep(sub or "stone", seed=k)
        elif typ in ("whoosh", "cloth", "rustle"):
            x = whoosh(float(e.get("duration_sec", 0.7)), seed=k)
        elif typ in ("swell", "transition", "riser"):
            x = swell(float(e.get("duration_sec", 1.0)), seed=k, root_hz=float(ap.get("drone_root_hz", 110)) / 2)
            t0 = max(0.0, t0)  # swell peaks at t0 + duration (the cut)
        elif typ in ("chime", "bell"):
            x = chime(sub or "temple_bell", seed=k, length=float(e.get("duration_sec", 3.5)))
        else:
            print(f"[sfx_synth] unknown sfx type '{typ}' (event {k}); skipped", file=sys.stderr)
            continue
        if e.get("pan") is not None:
            p = float(e["pan"]); x = x * np.array([np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)]) * 1.41
        fn = f"events/evt_{k:03d}_{typ}.wav"
        write(os.path.join(a.outdir, fn), x)
        manifest["events"].append({"file": fn, "t_sec": round(t0, 4), "frame": int(round(t0 * fps)), "type": typ,
                                   "gain_db": float(e.get("gain_db", ap.get("sfx_gain_db", -14))), "source": src or "procedural"})
    json.dump(manifest, open(os.path.join(a.outdir, "stems_manifest.json"), "w"), indent=1)
    nproc = sum(1 for ev in manifest["events"] if ev["source"] == "procedural")
    print(f"[sfx_synth] ambience ({', '.join(f'{k}={v}' for k, v in manifest['sources'].items())}), bgm ({manifest['bgm']['source']}), "
          f"{len(manifest['events'])} events ({nproc} procedural) -> {a.outdir}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--storyboard"); ap.add_argument("--style"); ap.add_argument("--timeline")
    ap.add_argument("--outdir"); ap.add_argument("--bgm"); ap.add_argument("--assets")
    ap.add_argument("--kind", choices=["footstep", "whoosh", "chime", "swell", "bed", "bgm"])
    ap.add_argument("--surface", default="stone"); ap.add_argument("--variant", default="temple_bell")
    ap.add_argument("--name", default="river"); ap.add_argument("--mood", default="warm")
    ap.add_argument("--root-hz", type=float, default=110.0); ap.add_argument("--duration", type=float, default=8.0)
    ap.add_argument("--seed", type=int, default=0); ap.add_argument("--out")
    a = ap.parse_args()
    if a.storyboard:
        if not a.outdir:
            sys.exit("--outdir is required with --storyboard")
        return batch(a)
    if not (a.kind and a.out):
        sys.exit("give --storyboard ... --outdir, or --kind ... --out")
    x = {"footstep": lambda: footstep(a.surface, a.seed), "whoosh": lambda: whoosh(a.duration, a.seed),
         "chime": lambda: chime(a.variant, a.seed), "swell": lambda: swell(a.duration, a.seed, a.root_hz / 2),
         "bed": lambda: bed(a.name, a.duration, a.seed),
         "bgm": lambda: bgm(a.duration, a.root_hz, a.mood if a.mood in MOOD_MODES else mood_mode(a.mood, {}), a.seed)}[a.kind]()
    write(a.out, x)
    print(f"[sfx_synth] {a.kind} -> {a.out} ({len(x) / SR:.2f}s)")


if __name__ == "__main__":
    main()
