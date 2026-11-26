#!/usr/bin/env python3
"""Stacked-alpha tip burst: Chromium plays the MP4; WebKit composites stills.

Playwright's Linux WebKit build crashes on any H.264 video (even a 320x180
baseline file). Ecamm Live / Safari on Mac play this stacked MP4 normally.
WebKit is still tested here by running the same WebGL/2D compositor on
stacked stills extracted from the shipped MP4.
"""
import base64, os, pathlib, subprocess, sys, time
from playwright.sync_api import sync_playwright

PORT = int(os.environ.get('PORT', '3067'))
BASE = f'http://127.0.0.1:{PORT}'
SHOTS = '/workspace/kk-app-shots/'
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STILL_DIR = pathlib.Path('/tmp/kk-burst2/still')
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(STILL_DIR, exist_ok=True)

FRAMES = [('fireball', 0.70), ('money', 8.00), ('smoke', 12.50), ('end', 16.30)]

results = []
def rec(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS ' if ok else 'FAIL ') + name + ((' — ' + str(detail)) if detail and not ok else ''), flush=True)

def extract_stills():
    mp4 = os.path.join(REPO, 'public/fx/tip-burst-stacked.mp4')
    for name, t in FRAMES:
        out = STILL_DIR / f'{name}.png'
        if out.exists() and out.stat().st_size > 1000:
            continue
        subprocess.check_call(['ffmpeg','-y','-ss',str(t),'-i',mp4,'-frames:v','1',str(out)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

SEEK = """
async (t) => {
  const v = document.querySelector('.kkfx video');
  const c = document.querySelector('.kkfx canvas');
  if (!v || !c) return {ok:false, reason:'missing'};
  v.pause();
  await new Promise((resolve) => {
    if (Math.abs((v.currentTime||0) - t) < 0.03 && v.readyState >= 2) return resolve();
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    try { v.currentTime = t; } catch (e) {}
    setTimeout(done, 1800);
  });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 80));
  return {ok:true, t:v.currentTime, painter:c.dataset.kkfxPainter||'', dur:v.duration, w:v.videoWidth, h:v.videoHeight};
}
"""

START = """
(bg) => {
  const stage = document.querySelector('#ovStage, .ov-stage') || document.body;
  document.body.style.background = bg;
  stage.style.background = bg;
  if (window.KKOverlayFX) {
    KKOverlayFX.celebrate(stage, {title:'Piano Man', artist:'Billy Joel', requester:'Kyle', tipCents:1000, test:true, kind:'song'});
  }
  return !!(window.KKOverlayFX && stage);
}
"""

STILL_JS = """
async ([bg, dataUrl]) => {
  const stage = document.querySelector('#ovStage, .ov-stage') || document.body;
  document.body.style.background = bg;
  stage.style.background = bg;
  const old = stage.querySelector('.kkfx');
  if (old) old.remove();
  return await KKOverlayFX.compositeStill(stage, dataUrl, {title:'Piano Man', artist:'Billy Joel', requester:'Kyle', tipCents:1000});
}
"""

proc = None
if not os.environ.get('NO_START'):
    data = f'/tmp/kk-burst-ui-{PORT}'
    os.makedirs(data, exist_ok=True)
    proc = subprocess.Popen(['node','server.js'], cwd=REPO,
                            env={**os.environ, 'DATA_DIR': data, 'PORT': str(PORT)},
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    t0=time.time()
    while time.time()-t0 < 90:
        line = proc.stdout.readline()
        if not line: break
        if b'listening on port' in line:
            break
    else:
        print('server failed to start'); sys.exit(1)
    time.sleep(0.3)

def launch(p, name):
    if name == 'chromium':
        try:
            return p.chromium.launch(channel='chrome', headless=True)
        except Exception:
            return p.chromium.launch(headless=True)
    return p.webkit.launch(headless=True)

def run_matrix(browser, engine, viewport, tag_prefix):
    for bg_name, bg in (('dark','#0a0a0a'), ('white','#ffffff')):
        ctx = browser.new_context(viewport=viewport, device_scale_factor=2,
                                  is_mobile=viewport['width']<500, has_touch=viewport['width']<500)
        pg = ctx.new_page()
        pg.goto(BASE+'/?view=overlay', wait_until='domcontentloaded', timeout=60000)
        pg.wait_for_function('() => !!window.KKOverlayFX', timeout=15000)
        pg.wait_for_timeout(400)
        ok = pg.evaluate(START, bg)
        rec(f'[{engine}/{tag_prefix}/{bg_name}] celebrate started', bool(ok))
        pg.wait_for_selector('.kkfx canvas', timeout=10000)
        pg.wait_for_timeout(500)
        painter = pg.locator('.kkfx canvas').get_attribute('data-kkfx-painter')
        rec(f'[{engine}/{tag_prefix}/{bg_name}] painter', painter in ('webgl','2d'), painter)
        for fname, t in FRAMES:
            info = pg.evaluate(SEEK, t)
            rec(f'[{engine}/{tag_prefix}/{bg_name}] seek {fname}', bool(info) and info.get('ok'), info)
            pg.screenshot(path=SHOTS + f'burst-{engine}-{tag_prefix}-{bg_name}-{fname}.png')
        ctx.close()

def run_stills(browser, engine):
    extract_stills()
    data_urls = []
    for fname, _t in FRAMES:
        raw = (STILL_DIR / f'{fname}.png').read_bytes()
        data_urls.append((fname, 'data:image/png;base64,' + base64.b64encode(raw).decode()))
    for tag, viewport in (('desktop', {'width':1280,'height':720}), ('phone', {'width':390,'height':844})):
        for bg_name, bg in (('dark','#0a0a0a'), ('white','#ffffff')):
            ctx = browser.new_context(viewport=viewport, device_scale_factor=2,
                                      is_mobile=viewport['width']<500, has_touch=viewport['width']<500)
            pg = ctx.new_page()
            pg.goto(BASE+'/?view=overlay', wait_until='domcontentloaded', timeout=60000)
            pg.wait_for_function('() => !!(window.KKOverlayFX && KKOverlayFX.compositeStill)', timeout=15000)
            for fname, data in data_urls:
                info = pg.evaluate(STILL_JS, [bg, data])
                rec(f'[{engine}/{tag}/{bg_name}] still {fname}', bool(info) and info.get('painter') in ('webgl','2d'), info)
                pg.screenshot(path=SHOTS + f'burst-{engine}-{tag}-{bg_name}-{fname}.png')
            ctx.close()

try:
    extract_stills()
    with sync_playwright() as p:
        for engine in ('chromium', 'webkit'):
            try:
                br = launch(p, engine)
            except Exception as e:
                rec(f'{engine} launch', False, e)
                continue
            rec(f'{engine} launch', True)
            if engine == 'chromium':
                run_matrix(br, engine, {'width':1280,'height':720}, 'desktop')
                run_matrix(br, engine, {'width':390,'height':844}, 'phone')
            else:
                run_stills(br, engine)
            br.close()
except Exception as e:
    rec('runner', False, str(e))
    raise
finally:
    if proc:
        proc.kill()

fails=sum(1 for _,ok,_ in results if not ok)
print('FAILS', fails)
sys.exit(1 if fails else 0)
