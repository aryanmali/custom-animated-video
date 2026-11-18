#!/usr/bin/env node
/* custom-animated-video — style-agnostic Playwright + HTML5 canvas frame renderer.
 *
 * usage:
 *   node render_frames.js --style style.normalized.json --storyboard storyboard.json --drawers scene_drawers.js
 *        [--timeline audio_timeline.json] [--out frames/] [--aspect 16:9|9:16] [--subtitles true|false]
 *        [--frames 0,48,120 | --range 0-167] [--every N] [--scale 0.5] [--workers 4] [--format png|jpeg]
 *
 * The page loads canvas_runtime.js (shader primitives, camera rig, post, subtitles) and then the project's
 * scene_drawers.js, which registers scenes with CAV.registerScenes({...}). Every frame is a pure function of its
 * index, so frames render in parallel across --workers pages and partial re-renders are safe.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) a[key] = true; else { a[key] = v; i++; }
  }
  return a;
}
const bool = v => v === true || /^(1|true|yes|on)$/i.test(String(v));
const die = m => { console.error('[render_frames] ' + m); process.exit(1); };

function loadPlaywright() {
  // 1) playwright-core bundled inside the skill's private runtime (python playwright driver), 2) any local install
  if (process.env.CAV_PLAYWRIGHT_CORE) {
    try { return require(process.env.CAV_PLAYWRIGHT_CORE); } catch (e) { console.warn('[render_frames] CAV_PLAYWRIGHT_CORE unusable: ' + e.message); }
  }
  const roots = [path.join(__dirname, '..'), process.cwd(), __dirname];
  for (const mod of ['playwright', 'playwright-core']) {
    for (const r of roots) {
      try { return require(require.resolve(mod, { paths: [r] })); } catch (_) { /* next */ }
    }
  }
  die('playwright not found. Run the pipeline through build_video.py (it sets up a private runtime), ' +
      'or install playwright-core (npm) yourself.');
}

async function launch(chromium) {
  const tries = [];
  if (process.env.CAV_CHROME_PATH) tries.push({ executablePath: process.env.CAV_CHROME_PATH });
  const pref = process.env.CAV_BROWSER; // resolved once by runtime.py: chrome | msedge | chromium
  if (pref === 'chromium') tries.push({}, { channel: 'chrome' });
  else if (pref === 'msedge') tries.push({ channel: 'msedge' }, { channel: 'chrome' }, {});
  else tries.push({ channel: 'chrome' }, {}, { channel: 'msedge' });
  const common = { headless: true, args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--disable-lcd-text'] };
  let last;
  for (const t of tries) {
    try { return await chromium.launch(Object.assign({}, common, t)); } catch (e) { last = e; }
  }
  die('could not launch Chrome/Chromium. Run via build_video.py (downloads Chromium into the private runtime if needed) or set CAV_CHROME_PATH.\n' + (last && last.message));
}

function readJSON(p, what) {
  if (!p) die(`--${what} is required`);
  if (!fs.existsSync(p)) die(`${what} not found: ${p}`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { die(`${what} is not valid JSON (${p}): ${e.message}`); }
}

function ensureNormalized(stylePath) {
  const raw = readJSON(stylePath, 'style');
  if (raw._normalized) return raw;
  const py = process.env.CAV_PYTHON || 'python3';
  console.log('[render_frames] style is not normalized; running normalize_style.py');
  const out = execFileSync(py, [path.join(__dirname, 'normalize_style.py'), stylePath], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return JSON.parse(out);
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.help || a.h) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).join('\n')); return; }
  const style = ensureNormalized(a.style);
  const sbPath = a.storyboard; const SB = readJSON(sbPath, 'storyboard');
  const sbDir = path.dirname(path.resolve(sbPath));
  const tlPath = a.timeline || (SB.audio_timeline && path.resolve(sbDir, SB.audio_timeline));
  const TL = tlPath && fs.existsSync(tlPath) ? readJSON(tlPath, 'timeline') : null;
  if (!TL) console.warn('[render_frames] no audio_timeline.json: lip sync and subtitles disabled');
  const drawers = a.drawers || (SB.drawers && path.resolve(sbDir, SB.drawers));
  if (!drawers || !fs.existsSync(drawers)) die('--drawers scene_drawers.js not found: ' + drawers);

  const aspect = a.aspect || SB.aspect || '16:9';
  const [W, H] = aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080];
  const scale = parseFloat(a.scale || '1');
  const subtitles = a.subtitles !== undefined ? bool(a.subtitles) : !!SB.subtitles;
  const fps = SB.fps || style.motion_rules.frame_rate || 24;
  const duration = SB.duration_sec || (TL && TL.duration_sec) || Math.max(...SB.shots.map(s => s.end_sec));
  const total = Math.ceil(duration * fps - 1e-6);
  const outDir = path.resolve(a.out || path.join(sbDir, 'frames'));
  fs.mkdirSync(outDir, { recursive: true });
  const fmt = a.format === 'jpeg' || a.format === 'jpg' ? 'jpeg' : 'png';

  let frames;
  if (a.frames) frames = String(a.frames).split(',').map(s => parseInt(s, 10)).filter(n => n >= 0 && n < total);
  else {
    let [s, e] = [0, total - 1];
    if (a.range) { const m = String(a.range).split('-').map(Number); s = m[0]; e = Math.min(total - 1, m[1]); }
    const every = parseInt(a.every || '1', 10);
    frames = []; for (let i = s; i <= e; i += every) frames.push(i);
  }
  if (!frames.length) die('no frames to render');

  const workers = Math.max(1, Math.min(parseInt(a.workers || String(Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2)))), 10), frames.length));
  const runtime = fs.readFileSync(path.join(__dirname, 'canvas_runtime.js'), 'utf8');
  const drawerSrc = fs.readFileSync(drawers, 'utf8');
  const { chromium } = loadPlaywright();
  const browser = await launch(chromium);
  const t0 = Date.now();
  console.log(`[render_frames] ${style.meta.style_name} | ${aspect} ${Math.round(W * scale)}x${Math.round(H * scale)} @${fps}fps | ` +
              `${frames.length}/${total} frames | ${SB.shots.length} shots | subtitles=${subtitles} | workers=${workers} -> ${outDir}`);

  // contiguous chunks per worker (keeps any per-shot setup cache warm)
  const chunks = Array.from({ length: workers }, (_, w) => frames.slice(Math.floor((w * frames.length) / workers), Math.floor(((w + 1) * frames.length) / workers)));
  let done = 0, lastLog = 0;
  const errors = [];
  await Promise.all(chunks.map(async (chunk, w) => {
    if (!chunk.length) return;
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', e => errors.push(`[worker ${w}] page error: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${w}] ${m.text()}`); });
    await page.setContent('<!doctype html><html><body style="margin:0;background:#000"><canvas id="c"></canvas></body></html>');
    await page.addScriptTag({ content: runtime });
    try { await page.addScriptTag({ content: drawerSrc + '\n//# sourceURL=' + path.basename(drawers) }); }
    catch (e) { die('scene_drawers.js failed to load: ' + e.message); }
    if (errors.length) die(errors.join('\n'));
    const info = await page.evaluate(cfg => window.CAV.init(cfg), { style, storyboard: SB, timeline: TL, W, H, scale, aspect, subtitles })
      .catch(e => die('init failed: ' + e.message));
    if (w === 0) console.log(`[render_frames] scenes: ${info.scenes.join(', ')}`);
    for (const i of chunk) {
      let res;
      try {
        res = await page.evaluate(([i, t]) => window.CAV.renderFrameToPNG(i, t, 0.95), [i, 'image/' + fmt]);
      } catch (e) { die(`frame ${i} failed: ${e.message}`); }
      fs.writeFileSync(path.join(outDir, `frame_${String(i + 1).padStart(5, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(res.data, 'base64'));
      done++;
      if (Date.now() - lastLog > 4000 || done === frames.length) {
        lastLog = Date.now();
        const el = (Date.now() - t0) / 1000;
        console.log(`[render_frames] ${done}/${frames.length} (${(done / el).toFixed(1)} fps, eta ${Math.round((frames.length - done) / (done / el))}s)`);
      }
    }
    await page.close();
  }));
  await browser.close();
  if (errors.length) console.warn(errors.join('\n'));
  fs.writeFileSync(path.join(outDir, 'render_manifest.json'), JSON.stringify({ aspect, W: Math.round(W * scale), H: Math.round(H * scale), fps, total_frames: total,
    rendered: frames.length, format: fmt, pattern: `frame_%05d.${fmt === 'jpeg' ? 'jpg' : 'png'}`, seconds: (Date.now() - t0) / 1000 }, null, 1));
  console.log(`[render_frames] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => die(e.stack || e.message));
