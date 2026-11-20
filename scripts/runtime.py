#!/usr/bin/env python3
"""Self-contained runtime for custom-animated-video.

Everything the skill needs is installed into ONE private folder, `<skill>/.runtime/`, on first use:
  venv/       Python virtualenv with numpy, scipy, faster-whisper, playwright (which bundles its own Node.js)
  hf/         Whisper model cache (HF_HOME) — never touches ~/.cache
  browsers/   Chromium, only if no Google Chrome / Edge is installed (PLAYWRIGHT_BROWSERS_PATH)
  bin/ffmpeg  bundled ffmpeg (imageio-ffmpeg), only if the system ffmpeg is missing or lacks libx264 /
              sidechaincompress / loudnorm
Deleting `.runtime/` (done automatically on "ship it") returns the machine to exactly its previous state; the next
run re-bootstraps. Needs only a python3 >= 3.9 on PATH and internet access the first time.
"""
import hashlib, json, os, shutil, subprocess, sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RT = os.environ.get("CAV_RUNTIME") or os.path.join(SKILL, ".runtime")
VENV = os.path.join(RT, "venv")
REQ = os.path.join(SKILL, "requirements.txt")
STAMP = os.path.join(RT, "stamp.json")
WIN = os.name == "nt"


def venv_python():
    return os.path.join(VENV, "Scripts" if WIN else "bin", "python.exe" if WIN else "python")


def _req_hash():
    return hashlib.sha1(open(REQ, "rb").read()).hexdigest()


def _stamp():
    try:
        return json.load(open(STAMP))
    except Exception:
        return {}


def _save_stamp(d):
    os.makedirs(RT, exist_ok=True)
    json.dump(d, open(STAMP, "w"), indent=1)


def in_runtime():
    return os.path.realpath(sys.prefix) == os.path.realpath(VENV)


def _py_ok(exe):
    try:
        v = subprocess.run([exe, "-c", "import sys;print(sys.version_info[:2]>=(3,9))"], capture_output=True, text=True, timeout=20)
        return v.stdout.strip() == "True"
    except Exception:
        return False


def find_base_python():
    for name in ("python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"):
        p = shutil.which(name)
        if p and _py_ok(p):
            return p
    if _py_ok(sys.executable):
        return sys.executable
    sys.exit("[runtime] need Python >= 3.9 on PATH")


def bootstrap():
    """Make sure .runtime/venv exists with requirements installed, then re-exec this process inside it."""
    st = _stamp()
    ready = os.path.exists(venv_python()) and st.get("req") == _req_hash()
    if not ready:
        base = find_base_python()
        print(f"[runtime] setting up private dependencies in {RT} (one time, ~1-3 min) ...", flush=True)
        if os.path.exists(VENV):
            shutil.rmtree(VENV)
        subprocess.check_call([base, "-m", "venv", VENV])
        pip = [venv_python(), "-m", "pip", "install", "-q", "--disable-pip-version-check"]
        subprocess.check_call(pip + ["--upgrade", "pip"])
        subprocess.check_call(pip + ["-r", REQ])
        st = {"req": _req_hash()}
        _save_stamp(st)
        print("[runtime] dependencies installed", flush=True)
    if not in_runtime():
        os.execv(venv_python(), [venv_python()] + sys.argv)


# --------------------------------------------------------------------------------------------- inside the venv
def _ffmpeg_ok(exe):
    try:
        enc = subprocess.run([exe, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=30).stdout
        fil = subprocess.run([exe, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=30).stdout
        return "libx264" in enc and "sidechaincompress" in fil and "loudnorm" in fil
    except Exception:
        return False


def _resolve_ffmpeg(st):
    if os.environ.get("CAV_FFMPEG") and _ffmpeg_ok(os.environ["CAV_FFMPEG"]):
        return os.environ["CAV_FFMPEG"]
    cached = st.get("ffmpeg")
    if cached and os.path.exists(cached):
        return cached
    sysff = shutil.which("ffmpeg")
    if sysff and not os.environ.get("CAV_FORCE_BUNDLED_FFMPEG") and _ffmpeg_ok(sysff):
        return sysff
    print("[runtime] system ffmpeg missing or incomplete: installing a bundled ffmpeg into the runtime", flush=True)
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--disable-pip-version-check", "imageio-ffmpeg"])
    import importlib, imageio_ffmpeg  # noqa
    importlib.reload(imageio_ffmpeg)
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    if not _ffmpeg_ok(exe):
        sys.exit("[runtime] bundled ffmpeg lacks libx264/sidechaincompress/loudnorm; install a full ffmpeg (brew/apt) or set CAV_FFMPEG")
    return exe


def _resolve_browser(st, env):
    if st.get("browser"):
        return st["browser"]
    from playwright.sync_api import sync_playwright
    os.environ.update(env)
    with sync_playwright() as p:
        for ch in ("chrome", "msedge"):
            try:
                p.chromium.launch(channel=ch).close()
                return ch
            except Exception:
                pass
    print("[runtime] no Chrome/Edge found: downloading Chromium into the runtime", flush=True)
    subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"], env=os.environ)
    return "chromium"


def setup_env():
    """Export the env every sub-step needs (private caches, ffmpeg on PATH, bundled Node + playwright-core)."""
    st = _stamp()
    env = {"HF_HOME": os.path.join(RT, "hf"), "PLAYWRIGHT_BROWSERS_PATH": os.path.join(RT, "browsers"),
           "PYTHONDONTWRITEBYTECODE": "1", "CAV_PYTHON": sys.executable, "HF_HUB_DISABLE_TELEMETRY": "1",
           "HF_HUB_DISABLE_XET": "1"}  # the xet transport can stall on large Whisper weights
    os.environ.update(env)
    sys.dont_write_bytecode = True
    ff = _resolve_ffmpeg(st)
    bindir = os.path.join(RT, "bin")
    os.makedirs(bindir, exist_ok=True)
    link = os.path.join(bindir, "ffmpeg")
    if os.path.realpath(ff) != os.path.realpath(link):
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(ff, link)
    os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
    from playwright._impl._driver import compute_driver_executable
    drv = compute_driver_executable()
    node, cli = (drv if isinstance(drv, tuple) else (None, drv))
    os.environ["CAV_NODE"] = node or shutil.which("node") or "node"
    os.environ["CAV_PLAYWRIGHT_CORE"] = os.path.dirname(cli)
    br = _resolve_browser(st, env)
    os.environ["CAV_BROWSER"] = br
    if st.get("ffmpeg") != ff or st.get("browser") != br:
        st.update({"ffmpeg": ff, "browser": br})
        _save_stamp(st)
    return {"ffmpeg": ff, "node": os.environ["CAV_NODE"], "playwright_core": os.environ["CAV_PLAYWRIGHT_CORE"], "browser": br}


def size_of(path):
    tot = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                tot += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return tot


def delete_runtime():
    """Remove every dependency this skill installed. System tools (python, ffmpeg, Chrome) are never touched."""
    if not os.path.isdir(RT):
        return 0
    n = size_of(RT)
    shutil.rmtree(RT, ignore_errors=True)
    for root, dirs, _ in os.walk(SKILL):
        for d in dirs:
            if d == "__pycache__":
                shutil.rmtree(os.path.join(root, d), ignore_errors=True)
    return n
